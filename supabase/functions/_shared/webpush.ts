// Web Push без внешних библиотек: только WebCrypto (есть и в Deno, и в браузере, и в Node 20+).
//   • шифрование содержимого — RFC 8291 (aes128gcm, RFC 8188);
//   • подпись отправителя — VAPID, RFC 8292 (JWT ES256).
// Проверено обратной расшифровкой эталонной библиотекой http_ece (scripts/local-test/webpush.check.ts).

export type PushSubscription = { endpoint: string; p256dh: string; auth: string };
export type VapidKeys = { publicKey: string; privateJwk: JsonWebKey; subject: string };
export type PushResult = { ok: boolean; status: number; gone: boolean; error?: string };

const enc = new TextEncoder();
// Байты на обычном ArrayBuffer — так их принимает WebCrypto в строгих типах TS 5.7+.
type Bytes = Uint8Array<ArrayBuffer>;

export function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(str: string): Bytes {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

/** Новая пара VAPID-ключей: publicKey — для браузера (applicationServerKey), privateJwk — секрет сервера. */
export async function generateVapidKeys(subject: string): Promise<VapidKeys> {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  const privateJwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  return { publicKey: b64urlEncode(raw), privateJwk, subject };
}

/** Заголовок Authorization по VAPID для конкретного push-сервиса (aud = его origin). */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, ttlSeconds = 12 * 3600): Promise<string> {
  const aud = new URL(endpoint).origin;
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64urlEncode(enc.encode(JSON.stringify({
    aud,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    sub: keys.subject,
  })));
  const key = await crypto.subtle.importKey("jwk", { ...keys.privateJwk, key_ops: ["sign"] },
    { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  // WebCrypto отдаёт подпись сразу в формате r||s (64 байта) — именно он нужен JWT.
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${b64urlEncode(sig)}, k=${keys.publicKey}`;
}

/** Зашифровать содержимое для одного получателя (aes128gcm, одна запись). */
export async function encryptPayload(sub: PushSubscription, payload: Uint8Array): Promise<Bytes> {
  const uaPublic = b64urlDecode(sub.p256dh);
  const authSecret = b64urlDecode(sub.auth);
  if (uaPublic.length !== 65 || authSecret.length !== 16) throw new Error("Неверные ключи подписки");
  if (payload.length > 3800) throw new Error("Слишком длинное уведомление");

  const as = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256));

  const ikm = await hkdf(authSecret, shared, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const salt: Bytes = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const plain = concat(payload, new Uint8Array([2])); // 0x02 — разделитель последней записи
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, plain));

  const rs = 4096;
  const header = concat(salt, new Uint8Array([rs >>> 24, (rs >>> 16) & 255, (rs >>> 8) & 255, rs & 255, 65]), asPublic);
  return concat(header, cipher);
}

/** Отправить одно уведомление. gone=true — подписка умерла (удалить из базы). */
export async function sendPush(
  sub: PushSubscription,
  message: unknown,
  keys: VapidKeys,
  opts: { ttl?: number; urgency?: "very-low" | "low" | "normal" | "high"; topic?: string } = {},
): Promise<PushResult> {
  try {
    const body = await encryptPayload(sub, enc.encode(JSON.stringify(message)));
    const headers: Record<string, string> = {
      Authorization: await vapidAuthorization(sub.endpoint, keys),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(opts.ttl ?? 3 * 24 * 3600),
      Urgency: opts.urgency ?? "normal",
    };
    // Topic: новое уведомление того же типа заменяет недоставленное старое (не копятся).
    if (opts.topic) headers.Topic = opts.topic;
    const res = await fetch(sub.endpoint, { method: "POST", headers, body });
    const gone = res.status === 404 || res.status === 410;
    const ok = res.status >= 200 && res.status < 300;
    const error = ok ? undefined : `${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`;
    if (ok) await res.body?.cancel().catch(() => {});
    return { ok, status: res.status, gone, error };
  } catch (e) {
    return { ok: false, status: 0, gone: false, error: String((e as Error)?.message ?? e).slice(0, 200) };
  }
}
