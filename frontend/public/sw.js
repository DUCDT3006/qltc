// The build replaces these two names with the exact files referenced by index.html.
const JS_ASSET = '__QLTC_JS_ASSET__';
const CSS_ASSET = '__QLTC_CSS_ASSET__';
const CACHE_NAME = `qltc-shell-${JS_ASSET.slice(-18)}-${CSS_ASSET.slice(-18)}`;
const SHELL = ['/', JS_ASSET, CSS_ASSET, '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (event) => {
  // Keep the previous worker active if the new shell cannot be cached in full.
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith('qltc-shell-') && key !== CACHE_NAME)
      .map((key) => caches.delete(key))
  )).then(() => self.clients.claim()));
});

async function fetchWithTimeout(request) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    return await fetch(request, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function networkFirst(request, fallback) {
  try {
    const response = await fetchWithTimeout(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(fallback || request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(fallback || request);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin ||
      url.pathname === '/api' || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html')) {
    event.respondWith(networkFirst(request, '/'));
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    if (url.pathname === JS_ASSET || url.pathname === CSS_ASSET) {
      event.respondWith(caches.match(request).then((cached) => cached ||
        fetch(request).then(async (response) => {
          if (response.ok) await (await caches.open(CACHE_NAME)).put(request, response.clone());
          return response;
        })));
    } else {
      // Older builds reused /assets/index.js and /assets/index.css across releases.
      event.respondWith(networkFirst(request));
    }
    return;
  }

  if (url.pathname.endsWith('.svg') || url.pathname.endsWith('.webmanifest')) {
    event.respondWith(caches.match(request).then((cached) => cached || networkFirst(request)));
  }
});
