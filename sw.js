// Service worker «Рассвета»: кэширует оболочку приложения (HTML, JS, CSS, иконки),
// чтобы оно открывалось быстро и при плохой связи. Данные из базы НЕ кэшируются —
// они всегда свежие и проходят проверку прав на сервере.
const CACHE = "rassvet-shell-v1";
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
