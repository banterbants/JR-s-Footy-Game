// Service worker: makes JR's Footy installable, playable offline and self-updating.
//
// Every file is answered from the cache straight away (so the game opens
// instantly, even with no connection) and re-checked against the server in the
// background. When anything has changed, the page is told so it can swap to the
// new version.
const CACHE = 'jrfooty-v6';
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
  'src/emblems.js',
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
  'branding/logo.svg',
  'icons/favicon-48.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  // "reload" skips the browser's own HTTP cache so we always store the newest files
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(CORE.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(async (keys) => {
      const old = keys.filter((k) => k !== CACHE);
      await Promise.all(old.map((k) => caches.delete(k)));
      await self.clients.claim();
      // replacing an earlier install: let any open page know there's a new version
      if (old.length) await announce();
    }),
  );
});

let announcing = null;

/** Tell open pages a new version is ready (once, after the downloads settle). */
function announce() {
  if (!announcing) {
    announcing = new Promise((resolve) => setTimeout(resolve, 2500)).then(async () => {
      announcing = null;
      const pages = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const page of pages) page.postMessage({ type: 'update-ready' });
    });
  }
  return announcing;
}

async function sameBody(a, b) {
  const [x, y] = await Promise.all([a.arrayBuffer(), b.arrayBuffer()]);
  if (x.byteLength !== y.byteLength) return false;
  const u = new Uint8Array(x);
  const v = new Uint8Array(y);
  for (let i = 0; i < u.length; i++) if (u[i] !== v[i]) return false;
  return true;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req, { ignoreSearch: true });
      // keep a private copy for comparing: the original is handed to the page
      const previous = cached ? cached.clone() : null;
      const refresh = (async () => {
        try {
          // "no-cache" makes the browser check with the server instead of trusting an old copy
          const res = await fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' });
          if (res && res.ok) {
            const changed = previous ? !(await sameBody(previous, res.clone())) : false;
            await cache.put(req, res.clone());
            if (changed) await announce();
          }
          return res;
        } catch (_) {
          return cached;
        }
      })();
      event.waitUntil(refresh.then(() => {}, () => {}));
      return cached || refresh;
    })(),
  );
});
