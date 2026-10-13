// Offline support. App files: network first so edits show up immediately,
// cache as fallback. Bottle images and fonts: cache first. Weather is never
// cached here; the app keeps its own last forecast in localStorage.
// App files always revalidate with the server: GitHub Pages lets browsers
// keep files for 10 minutes, and a fresh main.js importing a stale module
// fails to load at all.
const CACHE = 'scentcast-v9';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'data/collection.json',
  'data/catalog.json',
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
  'src/theme.js',
  'icons/icon.svg',
];
const CACHE_FIRST_HOSTS = ['fimgs.net', 'cdn.fragella.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(path => new Request(path, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req.mode === 'navigate' ? req.url : req, { cache: 'no-cache' })
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true })),
    );
  } else if (CACHE_FIRST_HOSTS.includes(url.hostname)) {
    e.respondWith(
      caches.match(req).then(hit => hit ?? fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return res;
      })),
    );
  }
});
