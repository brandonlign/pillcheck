// Offline support. The app shell is network-first (always fresh when online);
// retained model assets, fonts and runtime are cache-first after first use.
const SHELL = "pillcheck-shell-v16";
const ASSETS = "pillcheck-assets-finetune-v2-plan1";
const shell = ["/", "/index.html", "/style.css", "/fonts.css", "/app.js", "/core.js", "/icons.js", "/recognition.js", "/recognition-core.js", "/icon.svg", "/manifest.webmanifest"];
// Demo sample photos are small; precache them so the demo works offline.
const samples = ["/examples/dose-two.jpg", "/examples/pill-4.jpg", "/examples/flip-front.jpg", "/examples/flip-back.jpg", "/examples/manifest.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    Promise.all([caches.open(SHELL).then((c) => c.addAll(shell)), caches.open(ASSETS).then((c) => c.addAll(samples))]).then(() =>
      self.skipWaiting(),
    ),
  );
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== ASSETS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  if (/^\/(models|vendor|fonts|examples|img)\//.test(url.pathname)) {
    e.respondWith(
      caches.open(ASSETS).then(async (c) => {
        const hit = await c.match(e.request);
        if (hit) return hit;
        const res = await fetch(e.request);
        if (res.ok) c.put(e.request, res.clone());
        return res;
      }),
    );
    return;
  }
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) caches.open(SHELL).then((c) => c.put(e.request, res.clone()));
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("/index.html"))),
  );
});
