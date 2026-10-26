/* Service worker: app shell offline + faster lists on slow internet.
   Live streams, video and audio are never cached. */
const VERSION = 'v1';
const SHELL = 'shell-' + VERSION, LISTS = 'lists-' + VERSION, LIBS = 'libs-' + VERSION;
const FILES = ['./', './index.html', './manifest.json', './offline.html', './favicon.ico',
  './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  const keep = [SHELL, LISTS, LIBS];
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => !keep.includes(k)).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function timeout(ms) { return new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)); }

async function networkFirst(req, cacheName, ms) {
  const cache = await caches.open(cacheName);
  try {
    const res = await Promise.race([fetch(req), timeout(ms)]);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw err;
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const net = fetch(req).then(res => { if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()); return res; }).catch(() => null);
  return hit || (await net) || Response.error();
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);

  // Pages: network first, then cache, then offline page
  if (req.mode === 'navigate') {
    e.respondWith(networkFirst(req, SHELL, 5000).catch(() => caches.match('./offline.html')));
    return;
  }
  // Own files (icons, manifest, ...)
  if (url.origin === location.origin) {
    e.respondWith(staleWhileRevalidate(req, SHELL));
    return;
  }
  // Libraries and fonts
  if (/(^|\.)cdnjs\.cloudflare\.com$|fonts\.googleapis\.com$|fonts\.gstatic\.com$/.test(url.hostname)) {
    e.respondWith(staleWhileRevalidate(req, LIBS));
    return;
  }
  // Channel lists and radio station lists: network first with fallback to last saved copy
  if (url.hostname === 'iptv-org.github.io' && url.pathname.endsWith('.m3u') && !url.pathname.endsWith('/index.m3u') ||
      /radio-browser\.info$/.test(url.hostname)) {
    e.respondWith(networkFirst(req, LISTS, 7000));
    return;
  }
  // Everything else (live streams, video, audio): straight to network
});
