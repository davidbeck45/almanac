// Offline support. App files: network first so edits show up immediately,
// cache as fallback. Bottle images: cache first. Weather is never cached
// here; the app keeps its own last forecast in localStorage.
// App files always revalidate with the server: GitHub Pages lets browsers
// keep files for 10 minutes, and a fresh main.js importing a stale module
// fails to load at all. The worker sends the saved copy's ETag (or date)
// itself, so a file that hasn't changed costs a 304 even after the browser
// has let its own HTTP cache go.
// A launch doesn't wait on a slow line, though, and it's one version
// throughout, never a mix. When the app's page hasn't come within
// NETWORK_WAIT_MS, the saved page opens, and that page (and the workers it
// starts) loads every app file from the same cache. When the page comes but
// late (past SLOW_MS), or a file's check passes SLOW_MS, while everything so
// far came back unchanged, the rest of that launch comes from the cache too:
// what it already has is the cache's version. Once anything came back
// changed (a new version is out), the launch waits for the network, so
// versions don't mix. Whichever happens first decides, for the files
// already in flight as well. The cache catches up on a launch where the
// network answers in time, or when a new sw.js installs.
const CACHE = 'scentcast-v22';
const NETWORK_WAIT_MS = 2500;
const SLOW_MS = 1000;
// Dataset files (data/fragrantica/) load a shard at a time as people search
// and add bottles; they keep their own small cache instead of the shell's.
// Each Discover answer reads a few about shards (x/), so it holds plenty.
// They change only with a dataset rebuild: a saved one answers at once, and
// the worker checks it with the server behind it.
const DATA_CACHE = 'scentcast-data';
const DATA_MAX = 120;
// The suggestion pool's three files (data/fragrantica/pool*.json) keep a
// cache of their own, never trimmed: shards coming and going in the data
// cache must not push them out, or the gap finder and Discover go dark offline.
const POOL_CACHE = 'scentcast-pool';
// Bottle photos from other hosts. They come back opaque (no CORS headers),
// so the worker can't see whether one failed; a capped cache keeps a bad
// one from sticking around for good. Chrome counts each opaque response as
// about 7 MB of quota, so the cap is about the wardrobe's photos (offline),
// not every photo browsed: the HTTP cache keeps those for weeks anyway.
const IMAGE_CACHE = 'scentcast-images';
const IMAGE_MAX = 30;
const SHELL = [
  './',
  'manifest.webmanifest',
  'data/collection.json',
  'data/catalog.json',
  'src/tokens.css',
  'src/css/base.css',
  'src/css/components.css',
  'src/css/shell.css',
  'src/css/wear.css',
  'src/css/wardrobe.css',
  'src/css/discover.css',
  'src/css/bottle.css',
  'src/main.js',
  'src/app/early.js',
  'src/app/pool.js',
  'src/app/router.js',
  'src/app/sheets.js',
  'src/app/shell.js',
  'src/app/state.js',
  'src/views/bottle.js',
  'src/views/bottle-check.js',
  'src/views/bottle-crowd.js',
  'src/views/bottle-dupes.js',
  'src/views/bottle-reviews.js',
  'src/views/bottle-skin.js',
  'src/views/bottle-spray.js',
  'src/views/bottle-styles.js',
  'src/views/compare.js',
  'src/views/discover.js',
  'src/views/discover/query.js',
  'src/views/discover/templates.js',
  'src/views/sections.js',
  'src/views/settings.js',
  'src/views/wardrobe.js',
  'src/views/wardrobe/insights.js',
  'src/views/wardrobe/parts.js',
  'src/views/wardrobe/wishlist.js',
  'src/views/wear.js',
  'src/views/wear/pickers.js',
  'src/views/wear/trip.js',
  'src/views/wear/when.js',
  'src/ui.js',
  'src/ui/components.js',
  'src/accords.js',
  'src/api.js',
  'src/candidates.js',
  'src/climate.js',
  'src/collections.js',
  'src/custom.js',
  'src/discover.js',
  'src/doubles.js',
  'src/engine.js',
  'src/events.js',
  'src/fragella.js',
  'src/fragrantica.js',
  'src/gaps.js',
  'src/hidden.js',
  'src/history.js',
  'src/layering.js',
  'src/location.js',
  'src/occasions.js',
  'src/pack.js',
  'src/pool-tasks.js',
  'src/pool-worker.js',
  'src/profiles.js',
  'src/scene.js',
  'src/scent-styles.js',
  'src/similar.js',
  'src/skin.js',
  'src/spray.js',
  'src/theme.js',
  'src/uses.js',
  'src/weather.js',
  'src/wishlist.js',
  'src/wmo.js',
  'fonts/fraunces.woff2',
  'fonts/fraunces-italic.woff2',
  'fonts/inter.woff2',
  'icons/icon.svg',
];
const IMAGE_HOSTS = ['fimgs.net', 'cdn.fragella.com'];
const KEEP = [CACHE, DATA_CACHE, POOL_CACHE, IMAGE_CACHE];

// Install revalidates each file with the server (`no-cache`), so it never
// takes a stale copy, but a file the page just loaded comes back as a
// near-empty 304 instead of downloading again.
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(path => new Request(path, { cache: 'no-cache' })))).then(() => self.skipWaiting()));
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

// The version a response is, by its ETag (else Last-Modified).
const version = res => res.headers.get('etag') ?? res.headers.get('last-modified');

// Saves a response. A capped cache always takes it (put moves it to the end,
// so the shards in use stay); the others skip a file they already hold in
// this version, rather than rewrite the whole app on every launch.
async function put(name, key, res, max) {
  const cache = await caches.open(name);
  if (!max) {
    const saved = await cache.match(key);
    if (saved && version(res) != null && version(saved) === version(res)) return;
  }
  await cache.put(key, res);
  if (max) await trim(cache, max);
}

// Each launch's one decision, shared by the page and the workers it starts:
// { cached } once its app files come from the cache, { changed } once one
// came back changed from the network. Ids of clients long gone fall off the
// front.
const launches = new Map();
function launchOf(id, launch) {
  if (!id) return;
  launches.set(id, launch);
  if (launches.size > 30) launches.delete(launches.keys().next().value);
}
const late = ms => new Promise(resolve => setTimeout(resolve, ms, 'late'));

// The app's page, at the scope's root or as index.html.
function isAppPage(url) {
  const root = new URL(self.registration.scope).pathname;
  return url.pathname === root || url.pathname === `${root}index.html`;
}

// The network's copy of a file. With a saved copy, the request carries its
// ETag and date, and a 304 is answered with the saved copy.
function fresh(url, hit) {
  const tag = hit?.headers.get('etag'), date = hit?.headers.get('last-modified');
  if (!tag && !date) return fetch(url, { cache: 'no-cache' });
  const headers = {};
  if (tag) headers['If-None-Match'] = tag;
  if (date) headers['If-Modified-Since'] = date;
  return fetch(url, { headers, cache: 'no-store' }).then(res => (res.status === 304 ? hit.clone() : res));
}
// Whether the network's answer is another version than the saved copy.
const changed = (res, hit) => !hit || version(res) == null || version(res) !== version(hit);

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
    const pool = data && /\/data\/fragrantica\/pool[\w-]*\.json$/.test(url.pathname);
    const [store, max] = pool ? [POOL_CACHE, 0] : data ? [DATA_CACHE, DATA_MAX] : [CACHE, 0];
    const saved = () => caches.open(store).then(c => c.match(key, { ignoreSearch: true }));
    const keep = res => {
      if (res.ok) e.waitUntil(put(store, key, res.clone(), max));
      return res;
    };

    if (data) {
      e.respondWith(saved().then(hit => {
        const checked = fresh(req.url, hit).then(keep);
        if (!hit) return checked;
        e.waitUntil(checked.catch(() => {}));
        return hit;
      }).catch(() => Response.error()));
      return;
    }

    if (appPage) {
      e.respondWith((async () => {
        const hit = await saved();
        const started = Date.now();
        const page = fresh(req.url, hit);
        if (!hit) return page.then(keep).catch(() => Response.error());
        // The network's answer if it comes in time; else the saved app (and
        // the late answer isn't saved: its files would be another version).
        // A server error (an outage) counts as no answer.
        const first = await Promise.race([page.catch(() => 'failed'), late(NETWORK_WAIT_MS)]);
        if (first instanceof Response && first.ok) {
          const launch = { changed: changed(first, hit), cached: false };
          // Unchanged but slow: the line is, so the files come from the cache.
          launch.cached = !launch.changed && Date.now() - started > SLOW_MS;
          launchOf(e.resultingClientId, launch);
          return keep(first);
        }
        page.catch(() => {});
        launchOf(e.resultingClientId, { changed: false, cached: true });
        return hit;
      })());
      return;
    }

    // An app file. A worker the page starts shares its launch, and the
    // launch decides once: from the cache (a slow check) or from the network
    // (a new version), whichever comes first, and every file after keeps to
    // it, those already in flight too.
    const launch = launches.get(e.clientId);
    if (launch) launchOf(e.resultingClientId, launch);
    e.respondWith((async () => {
      const hit = await saved();
      if (hit && launch?.cached) return hit;
      const net = fresh(req.url, hit);
      const network = () => net.then(res => {
        if (launch && !launch.cached && res.ok && changed(res, hit)) launch.changed = true;
        return keep(res);
      }).catch(async () => hit ?? (await caches.match(key, { ignoreSearch: true })) ?? Response.error());
      // Nothing saved, or no launch to decide for (the page didn't open
      // through this worker), or a new version coming in: wait for the network.
      if (!hit || !launch || launch.changed) return network();
      const first = await Promise.race([net.catch(() => 'failed'), late(SLOW_MS)]);
      // Another file's check passed SLOW_MS meanwhile: the launch is the
      // saved version (a late answer isn't saved).
      if (launch.cached) {
        net.catch(() => {});
        return hit;
      }
      if (first instanceof Response) {
        if (first.ok && changed(first, hit)) launch.changed = true;
        return keep(first);
      }
      // Slow, but another file came back new meanwhile: this one waits too.
      if (first === 'late' && launch.changed) return network();
      // Offline, or the line is slow: the saved copy, and the rest of the
      // launch from the cache.
      if (first === 'late') launch.cached = true;
      net.catch(() => {});
      return hit;
    })());
  } else if (IMAGE_HOSTS.includes(url.hostname)) {
    e.respondWith(
      caches.match(req).then(hit => hit ?? fetch(req).then(res => {
        if (res.ok || res.type === 'opaque') e.waitUntil(put(IMAGE_CACHE, req, res.clone(), IMAGE_MAX));
        return res;
      })),
    );
  }
});
