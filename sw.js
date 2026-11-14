const CACHE_PREFIX = 'forest-field-pwa-';
const CACHE_VERSION = 'v1';
const SHELL_CACHE = CACHE_PREFIX + CACHE_VERSION;
const RUNTIME_CACHE = CACHE_PREFIX + 'runtime-' + CACHE_VERSION;
const APP_SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    for (const url of APP_SHELL) {
      try { await cache.add(new Request(url, { cache: 'reload' })); }
      catch (error) { console.warn('App shell cache skipped:', url, error); }
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== SHELL_CACHE && key !== RUNTIME_CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Never cache authentication, Firestore, or other application data/API responses.
  if (/^(firestore|identitytoolkit|securetoken|firebaseinstallations)\.googleapis\.com$/i.test(url.hostname) || /\/google\.firestore\.v1\.Firestore\//i.test(url.pathname)) return;

  // App navigation: prefer the latest deployed HTML, but fall back to the installed shell offline.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      try {
        const response = await fetch(request);
        if (response && response.ok) await cache.put('./index.html', response.clone());
        return response;
      } catch (_) {
        return (await cache.match('./index.html')) || (await cache.match('./')) || new Response('オフラインです。インターネット接続後に再度お試しください。', { headers: { 'Content-Type': 'text/plain; charset=utf-8' }, status: 503 });
      }
    })());
    return;
  }

  // Cache the app's own static assets and the app's third-party JS libraries only.
  const isAppAsset = url.origin === self.location.origin;
  const isLibraryScript = (url.hostname === 'www.gstatic.com' || url.hostname === 'cdn.jsdelivr.net') && (request.destination === 'script' || /\.m?js(?:$|\?)/i.test(url.pathname));
  if (!isAppAsset && !isLibraryScript) return;

  event.respondWith((async () => {
    const cache = await caches.open(RUNTIME_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response && (response.ok || response.type === 'opaque')) {
        try { await cache.put(request, response.clone()); } catch (_) {}
      }
      return response;
    } catch (error) {
      if (cached) return cached;
      throw error;
    }
  })());
});
