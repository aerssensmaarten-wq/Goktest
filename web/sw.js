// Service worker: maakt de app installeerbaar en bruikbaar zonder internet.
// - App-bestanden: direct uit de cache, op de achtergrond ververst.
// - Uitslagen (data/json): altijd eerst het netwerk (nieuwste trekkingen),
//   bij geen verbinding de laatst opgeslagen versie.
const VERSION = 'v3';
const SHELL = `shell-${VERSION}`;
const DATA = 'data-v1';
const SHELL_FILES = [
  './', 'index.html', 'style.css', 'app.js', 'stats.js', 'generator.js', 'charts.js', 'dom.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== SHELL && key !== DATA) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // enkel eigen bestanden
  if (url.pathname.includes('/data/')) {
    event.respondWith(networkFirst(req));
  } else {
    event.respondWith(staleWhileRevalidate(req, event));
  }
});

const MAX_AGE = 6 * 60 * 60 * 1000; // achtergrondverversing hoogstens om de 6 uur

async function store(cache, req, res) {
  // bewaar met tijdstempel zodat we weten hoe oud de kopie is
  const headers = new Headers(res.headers);
  headers.set('x-sw-fetched', String(Date.now()));
  const body = await res.clone().blob();
  await cache.put(req, new Response(body, { status: res.status, statusText: res.statusText, headers }));
}

async function networkFirst(req) {
  const cache = await caches.open(DATA);
  try {
    const res = await fetch(req, { cache: 'no-cache' });
    if (res.ok) await store(cache, req, res);
    return res;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw err;
  }
}

// De app vraagt om alle uitslagen alvast te bewaren, zodat elk spel ook offline werkt.
self.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg.type !== 'prefetch' || !Array.isArray(msg.urls)) return;
  event.waitUntil((async () => {
    const cache = await caches.open(DATA);
    for (const u of msg.urls.slice(0, 50)) {
      let url;
      try { url = new URL(u, self.location.href); } catch { continue; }
      if (url.origin !== self.location.origin || !url.pathname.includes('/data/json/')) continue;
      const hit = await cache.match(url.href);
      const age = hit ? Date.now() - Number(hit.headers.get('x-sw-fetched') || 0) : Infinity;
      if (age < MAX_AGE) continue;
      try {
        const res = await fetch(url.href, { cache: 'no-cache' });
        if (res.ok) await store(cache, url.href, res);
      } catch { /* offline: later opnieuw */ }
    }
  })());
});

async function staleWhileRevalidate(req, event) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(req, { ignoreSearch: true });
  const update = fetch(req).then((res) => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  if (hit) { event.waitUntil(update); return hit; }
  return (await update) || (await cache.match('index.html')) || Response.error();
}
