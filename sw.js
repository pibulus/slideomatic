// Placeholder value in git: scripts/stamp-sw-version.mjs overwrites this
// with the real deploy's commit hash as Netlify's build command, so the
// service worker's fetch handler is guaranteed to change on every deploy
// and returning visitors' browsers actually notice new CSS/JS.
const CACHE_VERSION = 'slideomatic-v2-20261108p';
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
  '/css/deck-panel.css',
  '/css/landing.css',
  '/css/collections.css',
  '/css/accordion.css',
  '/css/custom-select.css',
  '/css/print.css',
  '/main.js',
  '/modules/accordion.js',
  '/modules/base64-tokens.js',
  '/modules/cheat-codes.js',
  '/modules/constants.js',
  '/modules/custom-select.js',
  '/modules/deck-panel.js',
  '/modules/deck-persistence.js',
  '/modules/dom-refs.js',
  '/modules/drawer-base.js',
  '/modules/edit-drawer.js',
  '/modules/edit-drawer-forms.js',
  '/modules/haptics.js',
  '/modules/hud.js',
  '/modules/image-ai.js',
  '/modules/image-render.js',
  '/modules/image-search-ui.js',
  '/modules/image-upload.js',
  '/modules/image-utils.js',
  '/modules/keyboard-nav.js',
  '/modules/lazy-images.js',
  '/modules/markdown.js',
  '/modules/navigation.js',
  '/modules/onboarding.js',
  '/modules/pdf-export.js',
  '/modules/pwa.js',
  '/modules/radio-dock.js',
  '/modules/settings-modal.js',
  '/modules/share-modal.js',
  '/modules/share-password-modal.js',
  '/modules/slide-actions.js',
  '/modules/slide-image-ui.js',
  '/modules/slide-index.js',
  '/modules/slide-rendering.js',
  '/modules/slide-templates.js',
  '/modules/speaker-notes.js',
  '/modules/state.js',
  '/modules/theme-drawer.js',
  '/modules/theme-manager.js',
  '/modules/touch-nav.js',
  '/modules/utils.js',
  '/modules/validation.js',
  '/modules/voice-modes.js',
  '/js/vendor/browser-image-compression.js',
  '/guide.json',
  '/favicon.svg',
  '/slides.json',
  '/theme.json',
  '/themes/vaporwave.json',
  '/themes/slack.json',
  '/themes/gameboy.json',
  '/templates/the-pitch.json',
  '/templates/the-talk.json',
  '/templates/show-and-tell.json',
  '/templates/the-weird-one.json',
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
  // The deploy stamp always goes to the network — a cached stamp reports the
  // build this client installed, not the one the server is serving.
  if (url.pathname === '/version.json') return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, '/index.html'));
    return;
  }

  if (isCodeAsset(url.pathname)) {
    // Code and styles go to the network first. Serving this build's HTML
    // beside last build's CSS is exactly how the edit drawer once rendered
    // unstyled with two close buttons and a visible hidden title: every
    // class name still matched, so nothing errored, it just looked broken.
    // Worst case offline we fall back to the cached copy.
    event.respondWith(networkFirst(request));
    return;
  }

  if (isMediaAsset(url.pathname)) {
    // Images and fonts are big and effectively versioned by filename, so
    // stale-while-revalidate stays correct and instant.
    event.respondWith(staleWhileRevalidate(request));
  }
});

function isCodeAsset(pathname) {
  return /\.(?:css|js|mjs|json|webmanifest)$/i.test(pathname);
}

function isMediaAsset(pathname) {
  return /\.(?:png|jpg|jpeg|webp|avif|gif|svg|ico|woff2?)$/i.test(pathname);
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
      (request.mode === 'navigate' ? await caches.match(request, { ignoreSearch: true }) : null) ||
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
