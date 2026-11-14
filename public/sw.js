// Service worker «Рассвета»: кэширует оболочку приложения (HTML, JS, CSS, иконки),
// чтобы оно открывалось быстро и при плохой связи, и показывает пуш-уведомления.
// Данные из базы НЕ кэшируются — они всегда свежие и проходят проверку прав на сервере.
const CACHE = "rassvet-shell-v2";
const SCOPE = self.registration.scope;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([SCOPE, SCOPE + "manifest.webmanifest", SCOPE + "icon-192.png"])).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || !e.request.url.startsWith(SCOPE)) return; // Supabase и прочее — мимо кэша
  if (e.request.mode === "navigate") {
    // Страницы: сначала сеть, при отсутствии связи — кэш.
    e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request).then((r) => r || caches.match(SCOPE))));
    return;
  }
  if (url.pathname.includes("/_next/static/") || /\.(png|svg|webmanifest|css|js)$/.test(url.pathname)) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; })));
  }
});

// ── Пуш-уведомления ──
// Содержимое приходит зашифрованным от функции send-notifications: { title, body, url, tag }.
self.addEventListener("push", (e) => {
  let msg = {};
  try { msg = e.data ? e.data.json() : {}; } catch { msg = { body: e.data && e.data.text() }; }
  const title = msg.title || "Рассвет";
  e.waitUntil(self.registration.showNotification(title, {
    body: msg.body || "",
    icon: SCOPE + "icon-192.png",
    badge: SCOPE + "icon-192.png",
    tag: msg.tag || undefined,          // новое того же типа заменяет старое, а не копится
    renotify: !!msg.tag,
    lang: "ru",
    data: { url: new URL(msg.url || "", SCOPE).href },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || SCOPE;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.startsWith(SCOPE)) {
        await w.focus();
        if ("navigate" in w) return w.navigate(target).catch(() => self.clients.openWindow(target));
        return;
      }
    }
    return self.clients.openWindow(target);
  })());
});

// Браузер сам сменил подписку (истёк ключ и т. п.): приложение при следующем открытии
// увидит «выключено» и предложит включить снова. Сервер старую подписку удалит по 410.
