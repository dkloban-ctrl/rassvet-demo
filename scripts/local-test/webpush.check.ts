// Проверка Web Push-модуля серверной функции против эталонной реализации http_ece.
// Запуск:  npm i --no-save http_ece@1.2.0 && node --experimental-strip-types scripts/local-test/webpush.check.ts
import { createECDH, randomBytes } from "node:crypto";
import assert from "node:assert/strict";
// @ts-ignore — у http_ece нет типов
import ece from "http_ece";
import {
  b64urlDecode,
  b64urlEncode,
  encryptPayload,
  generateVapidKeys,
  vapidAuthorization,
} from "../../supabase/functions/_shared/webpush.ts";

let passed = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed++;
  console.log(`ok - ${name}`);
}

// «Браузер»: его ключи, как их отдаёт pushManager.subscribe().
const ua = createECDH("prime256v1");
ua.generateKeys();
const authSecret = randomBytes(16);
const sub = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
  p256dh: b64urlEncode(new Uint8Array(ua.getPublicKey())),
  auth: b64urlEncode(new Uint8Array(authSecret)),
};

await check("base64url туда-обратно", () => {
  const bytes = new Uint8Array(randomBytes(33));
  assert.deepEqual(b64urlDecode(b64urlEncode(bytes)), bytes);
});

await check("браузер расшифровывает наше уведомление (RFC 8291)", async () => {
  const message = JSON.stringify({ title: "Новый листок недели", body: "Ёлки, «кавычки», emoji 🌅", url: "/leaflet/" });
  const body = await encryptPayload(sub, new TextEncoder().encode(message));
  const plain = ece.decrypt(Buffer.from(body), {
    version: "aes128gcm",
    privateKey: ua,
    authSecret,
  });
  assert.equal(plain.toString("utf8"), message);
});

await check("каждое шифрование уникально (свежие соль и ключ)", async () => {
  const p = new TextEncoder().encode("x");
  const a = await encryptPayload(sub, p);
  const b = await encryptPayload(sub, p);
  assert.notDeepEqual(a.slice(0, 16), b.slice(0, 16));
});

await check("испорченные ключи подписки отвергаются", async () => {
  await assert.rejects(encryptPayload({ ...sub, auth: "AAAA" }, new Uint8Array([1])));
});

await check("VAPID: JWT подписан нашим ключом, aud = origin сервиса", async () => {
  const keys = await generateVapidKeys("mailto:test@example.org");
  assert.equal(b64urlDecode(keys.publicKey).length, 65);
  const authz = await vapidAuthorization(sub.endpoint, keys);
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(authz);
  assert.ok(m, authz);
  const [, h, c, s, k] = m!;
  assert.equal(k, keys.publicKey);
  const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(c)));
  assert.equal(claims.aud, "https://fcm.googleapis.com");
  assert.equal(claims.sub, "mailto:test@example.org");
  assert.ok(claims.exp > Date.now() / 1000 && claims.exp <= Date.now() / 1000 + 24 * 3600);
  const pub = await crypto.subtle.importKey("raw", b64urlDecode(k), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, b64urlDecode(s), new TextEncoder().encode(`${h}.${c}`));
  assert.ok(valid, "подпись не сходится");
});


// ── Тексты уведомлений ──
const { buildMessage, clip, leafletEmail, plain } = await import("../../supabase/functions/send-notifications/messages.ts");
await check("обрезка по слову с многоточием", () => {
  assert.equal(clip("короткий", 20), "короткий");
  const c = clip("Что для тебя значит доверие к Богу, когда всё идёт не так, как ты хотел?", 40);
  assert.ok(c.length <= 40 && c.endsWith("…") && !c.includes("  "), c);
});
await check("markdown превращается в простой текст", () => {
  assert.equal(plain("## Заголовок\n**жирный** и [ссылка](https://x)"), "Заголовок\nжирный и ссылка");
});
await check("в пуше из ящика нет ни имён, ни текста", () => {
  for (const k of ["inbox_new", "inbox_reply"] as const) {
    const m = buildMessage(k, { body: "секретный текст", title: "Маша" });
    assert.ok(!JSON.stringify(m).includes("секрет") && !JSON.stringify(m).includes("Маша"));
  }
});
await check("уведомление укладывается в лимит push-сервиса", async () => {
  const m = buildMessage("question", { body: "я".repeat(5000) });
  const body = await encryptPayload(sub, new TextEncoder().encode(JSON.stringify(m)));
  assert.ok(body.length < 4096);
});
await check("письмо родителю экранирует HTML и содержит ссылку", () => {
  const mail = leafletEmail({ title: "<script>x</script>", body: "Текст", verse_ref: "Ин 3:16", verse_text: "Ибо так возлюбил" }, "Ольга", "https://app.example/");
  assert.ok(!mail.html.includes("<script>"));
  assert.ok(mail.html.includes("https://app.example/leaflet/") && mail.text.includes("https://app.example/leaflet/"));
  assert.ok(mail.text.startsWith("Здравствуйте, Ольга!"));
});
console.log(`итого ${passed}`);
