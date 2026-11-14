// Пуш-уведомления в браузере: поддержка, подписка, отписка.
// Подписку сохраняет база (push_subscribe) — она же проверяет, что адрес принадлежит
// настоящему push-сервису, и привязывает устройство к тому, кто сейчас вошёл.

import { supabase } from "./supabase";

export type PushState =
  | "unsupported"     // браузер не умеет
  | "ios-install"     // iPhone/iPad: сначала установить на экран «Домой»
  | "denied"          // запрещено в настройках браузера
  | "off"             // можно включить
  | "on";             // включено на этом устройстве

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as { standalone?: boolean }).standalone === true;

function supported() {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  const base = process.env.NEXT_PUBLIC_BASE_PATH || "";
  const existing = await navigator.serviceWorker.getRegistration(`${base}/`);
  if (existing) return existing;
  // На localhost SwRegister не регистрирует воркер — регистрируем по требованию.
  return navigator.serviceWorker.register(`${base}/sw.js`, { scope: `${base}/` });
}

export async function pushState(): Promise<PushState> {
  if (typeof window === "undefined") return "unsupported";
  if (!supported()) return isIos() && !isStandalone() ? "ios-install" : "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.getRegistration((process.env.NEXT_PUBLIC_BASE_PATH || "") + "/");
  const sub = await reg?.pushManager.getSubscription();
  if (!sub || Notification.permission !== "granted") return "off";
  // Подписка в браузере есть — но наша ли она в базе (могли войти под другим на этом телефоне)?
  const { data } = await supabase.from("push_subscriptions").select("id").eq("endpoint", sub.endpoint).maybeSingle();
  return data ? "on" : "off";
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "===".slice((base64.length + 3) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const b64url = (buf: ArrayBuffer | null) =>
  buf ? btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : "";

/** Включить уведомления на этом устройстве. Вызывать только по нажатию кнопки. */
export async function enablePush(): Promise<PushState> {
  if (!supported()) return isIos() ? "ios-install" : "unsupported";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";

  const { data: key, error: keyErr } = await supabase.rpc("push_public_key");
  if (keyErr) throw keyErr;
  if (!key) throw new Error("Уведомления пока не настроены на сервере");

  const reg = await registration();
  if (!reg) return "unsupported";
  await navigator.serviceWorker.ready;
  const appKey = urlBase64ToUint8Array(key as string);
  let sub = await reg.pushManager.getSubscription();
  // Ключ сервера сменили — старая подписка больше не работает, переподписываемся.
  if (sub && b64url(sub.options.applicationServerKey) !== key) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });

  const { error } = await supabase.rpc("push_subscribe", {
    p_endpoint: sub.endpoint,
    p_p256dh: b64url(sub.getKey("p256dh")),
    p_auth: b64url(sub.getKey("auth")),
    p_user_agent: navigator.userAgent.slice(0, 300),
  });
  if (error) throw error;
  return "on";
}

/** Выключить на этом устройстве (и при выходе из аккаунта — чтобы чужие уведомления не приходили). */
export async function disablePush(): Promise<void> {
  if (!supported()) return;
  const reg = await navigator.serviceWorker.getRegistration((process.env.NEXT_PUBLIC_BASE_PATH || "") + "/");
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
  await sub.unsubscribe().catch(() => {});
}
