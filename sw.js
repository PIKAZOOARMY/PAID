const APP_CACHE = 'pikazoo-app-v1';
const IMG_CACHE = 'pikazoo-images-v1';
const APP_SHELL = ['./', './index.html', './manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE)
      .then((cache) => cache.addAll(APP_SHELL).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== APP_CACHE && k !== IMG_CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

function isBypassRequest(url) {
  const host = url.hostname;
  return (
    host.includes('firestore.googleapis.com') ||
    host.includes('identitytoolkit.googleapis.com') ||
    host.includes('securetoken.googleapis.com') ||
    host.includes('firebase.googleapis.com') ||
    host.includes('firebaseinstallations.googleapis.com') ||
    host === 'api.github.com'
  );
}

function isImageRequest(request, url) {
  if (request.destination === 'image') return true;
  return /\.(jpg|jpeg|png|webp|gif|bmp|ico)(\?.*)?$/i.test(url.pathname);
}

function isVideoRequest(request, url) {
  if (request.destination === 'video') return true;
  return /\.(mp4|mov|webm|mkv|avi|m4v|3gp)(\?.*)?$/i.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (isBypassRequest(url) || isVideoRequest(req, url)) return;

  // 1. Images (.jpg, .png, .webp, thumbnails, icons) -> Cache-First (Data Save)
  if (isImageRequest(req, url)) {
    event.respondWith(
      caches.open(IMG_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        try {
          const res = await fetch(req);
          if (res && (res.ok || res.type === 'opaque')) {
            cache.put(req, res.clone()).catch(() => {});
          }
          return res;
        } catch (err) {
          return cached || Response.error();
        }
      })
    );
    return;
  }

  // 2. HTML Navigation -> Cache-First fast load (background update checker handles fresh HTML)
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.open(APP_CACHE).then(async (cache) => {
        const cleanUrl = new URL('./index.html', self.location.href).toString();
        const cached = (await cache.match(cleanUrl)) || (await cache.match('./'));
        if (cached) return cached;
        try {
          const netRes = await fetch(req);
          if (netRes && netRes.ok) cache.put(cleanUrl, netRes.clone()).catch(() => {});
          return netRes;
        } catch (err) {
          return Response.error();
        }
      })
    );
    return;
  }
});

// Check if index.html changed on server (even without changing sw.js)
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'CHECK_HTML_UPDATE') {
    event.waitUntil((async () => {
      try {
        const htmlUrl = new URL('./index.html', self.location.href).toString();
        const cache = await caches.open(APP_CACHE);
        const cachedRes = await cache.match(htmlUrl);
        const netRes = await fetch(htmlUrl + '?v=' + Date.now(), { cache: 'no-store' });
        if (!netRes || !netRes.ok) return;

        const netText = await netRes.clone().text();
        if (cachedRes) {
          const oldText = await cachedRes.text();
          if (oldText && oldText !== netText) {
            await cache.put(htmlUrl, netRes);
            const clients = await self.clients.matchAll({ type: 'window' });
            clients.forEach((c) => c.postMessage({ type: 'UPDATE_READY' }));
          }
        } else {
          await cache.put(htmlUrl, netRes);
        }
      } catch (err) {}
    })());
  } else if (data.type === 'CLEAR_APP_CACHE') {
    event.waitUntil((async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach((c) => c.postMessage({ type: 'CACHE_CLEARED' }));
    })());
  }
});