// Service worker: makes JR's Footy installable and playable offline.
// Files are served from the cache straight away and refreshed in the
// background, so the next launch always has the latest version.
const CACHE = 'jrfooty-v1';
const CORE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'vendor/three.module.min.js',
  'src/main.js',
  'src/config.js',
  'src/util.js',
  'src/input.js',
  'src/audio.js',
  'src/ui.js',
  'src/store.js',
  'src/season.js',
  'src/sim/match.js',
  'src/sim/ai.js',
  'src/gfx/renderer.js',
  'src/gfx/stadium.js',
  'src/gfx/players.js',
  'src/gfx/textures.js',
  'fonts/barlow-condensed-latin-600-normal.woff2',
  'fonts/barlow-condensed-latin-700-normal.woff2',
  'fonts/barlow-condensed-latin-700-italic.woff2',
  'fonts/barlow-condensed-latin-800-italic.woff2',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const fresh = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || fresh;
    }),
  );
});
