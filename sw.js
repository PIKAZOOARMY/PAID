/* Pikazoo Premium - Service Worker
   IMPORTANT: Jab bhi index.html ya koi file update karo, neeche VERSION ka number badal do.
   Phir sab members ko "Update available" notification aa jayegi aur app khud refresh hogi. */
const VERSION = 'v1.0.1';

const SHELL_CACHE = 'pz-shell-' + VERSION;
const IMG_CACHE = 'pz-img-v1';      // images har update ke baad bhi save rehti hain
const LIB_CACHE = 'pz-lib-v1';      // firebase js + fonts
const SHELL = ['./index.html', './manifest.json', './icons/icon-192.png', './icons/icon-512.png'];
const MAX_IMAGES = 400;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keep = [SHELL_CACHE, IMG_CACHE, LIB_CACHE, 'pz-media-v1'];
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => keep.indexOf(k) === -1).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

async function trim(cacheName, max) {
  const c = await caches.open(cacheName);
  const ks = await c.keys();
  for (let i = 0; i < ks.length - max; i++) await c.delete(ks[i]);
}

function cacheable(res) {
  return res && (res.ok || res.type === 'opaque');
}

async function cacheFirst(req, cacheName, limit) {
  const c = await caches.open(cacheName);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (cacheable(res)) {
    c.put(req, res.clone()).then(() => limit && trim(cacheName, limit)).catch(() => {});
  }
  return res;
}

async function staleWhileRevalidate(req, cacheName) {
  const c = await caches.open(cacheName);
  const hit = await c.match(req);
  const net = fetch(req).then((res) => {
    if (cacheable(res)) c.put(req, res.clone()).catch(() => {});
    return res;
  }).catch(() => hit);
  return hit || net;
}

async function navigate(req) {
  const c = await caches.open(SHELL_CACHE);
  try {
    const res = await Promise.race([
      fetch(req),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))
    ]);
    if (res && res.ok) c.put('./index.html', res.clone()).catch(() => {});
    return res;
  } catch (err) {
    const hit = await c.match('./index.html');
    if (hit) return hit;
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Admin panel kabhi cache nahi hota
  if (url.origin === self.location.origin && url.pathname.endsWith('/keys.html')) return;

  // Video: SW touch nahi karta, page khud cache karta hai
  if (req.destination === 'video' || url.pathname.endsWith('.mp4') || req.headers.has('range')) return;

  // Page open
  if (req.mode === 'navigate' && url.origin === self.location.origin) {
    e.respondWith(navigate(req));
    return;
  }

  // Firebase JS libraries (version wali files)
  if (url.hostname === 'www.gstatic.com' && url.pathname.indexOf('/firebasejs/') === 0) {
    e.respondWith(cacheFirst(req, LIB_CACHE));
    return;
  }

  // Google Fonts
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(staleWhileRevalidate(req, LIB_CACHE));
    return;
  }

  // Images / thumbnails / icons: ek dafa download, phir cache se (data bachat)
  if (req.destination === 'image') {
    e.respondWith(cacheFirst(req, IMG_CACHE, MAX_IMAGES));
    return;
  }

  // Apni site ki baaki static files
  if (url.origin === self.location.origin) {
    e.respondWith(staleWhileRevalidate(req, SHELL_CACHE));
  }
  // Firestore, GitHub API, YouTube, video: SW touch nahi karta (always live)
});
