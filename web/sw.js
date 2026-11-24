// Service worker: maakt de app installeerbaar en bruikbaar zonder internet.
// Alles gaat eerst via het netwerk (zodat je altijd de nieuwste versie en
// uitslagen ziet) en valt enkel zonder verbinding terug op de bewaarde kopie.
const VERSION = 'v4';
const SHELL = `shell-${VERSION}`;
const DATA = 'data-v1';
const SHELL_FILES = [
  './', 'index.html', 'style.css', 'app.js', 'stats.js', 'generator.js', 'charts.js', 'dom.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  // cache: 'reload' = rechtstreeks van de server, niet uit de browsercache
  event.waitUntil(caches.open(SHELL)
    .then((c) => c.addAll(SHELL_FILES.map((f) => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== SHELL && key !== DATA) await caches.delete(key);
    const hadOldVersion = (await caches.keys()).some((k) => k.startsWith('shell-') && k !== SHELL);
    for (const key of await caches.keys()) if (key !== SHELL && key !== DATA) await caches.delete(key);
    await self.clients.claim();
    // Nieuwe versie geïnstalleerd: open vensters meteen herladen met de nieuwe app.
    if (hadOldVersion) {
      for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url).catch(() => {});
    }
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // enkel eigen bestanden
  if (url.pathname.includes('/data/')) {
    event.respondWith(networkFirst(req));
  } else {
    event.respondWith(networkFirstShell(req));
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

async function networkFirstShell(req) {
  const cache = await caches.open(SHELL);
  try {
    // max. 4 s wachten op het netwerk; daarna (of offline) de bewaarde versie
    const res = await Promise.race([
      // een paginaverzoek (navigate) mag niet met extra opties gekopieerd worden: haal de URL op
      fetch(req.mode === 'navigate' ? req.url : req, { cache: 'no-cache' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000)),
    ]);
    if (res.ok) await cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = (await cache.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? await cache.match('index.html') : null);
    if (hit) return hit;
    throw err;
  }
}
