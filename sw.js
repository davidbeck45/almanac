// Offline support. App files: network first so edits show up immediately,
// cache as fallback. Bottle images: cache first. Weather is never cached
// here; the app keeps its own last forecast in localStorage.
// App files always revalidate with the server: GitHub Pages lets browsers
// keep files for 10 minutes, and a fresh main.js importing a stale module
// fails to load at all.
const CACHE = 'scentcast-v13';
// Dataset files (data/fragrantica/) load a shard at a time as people search
// and add bottles; they keep their own small cache instead of the shell's.
const DATA_CACHE = 'scentcast-data';
const DATA_MAX = 60;
// Bottle photos from other hosts. They come back opaque (no CORS headers),
// so the worker can't see whether one failed; a capped cache keeps a bad
// one from sticking around for good, and the cap bounds the padding Chrome
// counts per opaque response against the quota.
const IMAGE_CACHE = 'scentcast-images';
const IMAGE_MAX = 150;
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'data/collection.json',
  'data/catalog.json',
  'src/tokens.css',
  'src/styles.css',
  'src/main.js',
  'src/ui.js',
  'src/engine.js',
  'src/accords.js',
  'src/occasions.js',
  'src/weather.js',
  'src/wmo.js',
  'src/scene.js',
  'src/location.js',
  'src/history.js',
  'src/hidden.js',
  'src/collections.js',
  'src/api.js',
  'src/fragella.js',
  'src/fragrantica.js',
  'src/profiles.js',
  'src/custom.js',
  'src/layering.js',
  'src/scent-styles.js',
  'src/skin.js',
  'src/pack.js',
  'src/theme.js',
  'fonts/fraunces.woff2',
  'fonts/fraunces-italic.woff2',
  'fonts/inter.woff2',
  'icons/icon.svg',
];
const IMAGE_HOSTS = ['fimgs.net', 'cdn.fragella.com'];
const KEEP = [CACHE, DATA_CACHE, IMAGE_CACHE];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(path => new Request(path, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => !KEEP.includes(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Drops the oldest entries past `max` (Cache keys come back in insertion order).
async function trim(cache, max) {
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - max)).map(k => cache.delete(k)));
}

async function put(name, key, res, max) {
  const cache = await caches.open(name);
  await cache.put(key, res);
  if (max) await trim(cache, max);
}

// The app's page, at the scope's root or as index.html.
function isAppPage(url) {
  const root = new URL(self.registration.scope).pathname;
  return url.pathname === root || url.pathname === `${root}index.html`;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    // Every visit to the app (?loc=, ?c=, ?view=…) is the same page: one
    // cache entry. Other files opened in a tab (data/collection.json, say)
    // go straight to the network, so they can't stand in for the app offline.
    const appPage = req.mode === 'navigate' && isAppPage(url);
    if (req.mode === 'navigate' && !appPage) return;
    const key = appPage ? './' : req;
    const data = url.pathname.includes('/data/fragrantica/');
    e.respondWith(
      fetch(appPage ? req.url : req, { cache: 'no-cache' })
        .then(res => {
          if (res.ok) e.waitUntil(put(data ? DATA_CACHE : CACHE, key, res.clone(), data ? DATA_MAX : 0));
          return res;
        })
        .catch(async () => (await caches.match(key, { ignoreSearch: true })) ?? Response.error()),
    );
  } else if (IMAGE_HOSTS.includes(url.hostname)) {
    e.respondWith(
      caches.match(req).then(hit => hit ?? fetch(req).then(res => {
        if (res.ok || res.type === 'opaque') e.waitUntil(put(IMAGE_CACHE, req, res.clone(), IMAGE_MAX));
        return res;
      })),
    );
  }
});
