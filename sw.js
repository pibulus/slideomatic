// Placeholder value in git: scripts/stamp-sw-version.mjs overwrites this
// with the real deploy's commit hash as Netlify's build command, so the
// service worker's fetch handler is guaranteed to change on every deploy
// and returning visitors' browsers actually notice new CSS/JS.
const CACHE_VERSION = 'slideomatic-507b8df9e609';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/deck.html',
  '/collections.html',
  '/manifest.webmanifest',
  '/css/main.css',
  '/css/variables.css',
  '/css/base.css',
  '/css/layout.css',
  '/css/slides.css',
  '/css/ui.css',
  '/css/drawers.css',
  '/css/modals.css',
  '/css/animations.css',
  '/css/edit-drawer.css',
  '/css/theme-drawer.css',
  '/css/landing.css',
  '/css/collections.css',
  '/css/accordion.css',
  '/css/custom-select.css',
  '/css/print.css',
  '/main.js',
  '/modules/pwa.js',
  '/js/vendor/browser-image-compression.js',
  '/guide.json',
  '/favicon.svg',
  '/slides.json',
  '/theme.json',
  '/catalog.json',
  '/deck-collections.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      // addAll() rejects the whole install if ANY asset 404s — one renamed
      // file would silently kill the service worker forever. Cache each
      // asset independently instead.
      .then((cache) => Promise.allSettled(SHELL_ASSETS.map((asset) => cache.add(asset))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('slideomatic-') && !key.startsWith(CACHE_VERSION))
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/.netlify/functions/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, '/index.html'));
    return;
  }

  if (isStaticAsset(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

function isStaticAsset(pathname) {
  return /\.(?:css|js|json|webmanifest|png|jpg|jpeg|webp|avif|gif|svg|ico)$/i.test(pathname);
}

async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const response = await fetch(request);
    // Never cache error responses — a transient 404/500 would otherwise be
    // served forever.
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // caches.match() searches shell + runtime; cache.match() ignored the
    // precached shell entirely, breaking first-launch offline.
    return (await caches.match(request)) ||
      (fallbackUrl ? await caches.match(fallbackUrl) : null) ||
      Response.error();
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await caches.match(request);
  const fresh = fetch(request).then((response) => {
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => null);

  return cached || fresh || Response.error();
}
