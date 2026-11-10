// A newer version of the app taking over this page mid-visit. sw.js installs
// a new version as soon as the browser finds it (skipWaiting), deletes the
// old one's cache and takes over the open pages (clients.claim), so from
// then on every file this page loads late (a lazy import, the pool worker
// and its modules) is the new version's, which needn't fit the modules the
// page started with. So the page reloads into the new version whole: at its
// next page change (the URL holds the new route by then), or as soon as it's
// out of sight.
// A worker taking over isn't always a new version for the page: the first
// visit's own install, or a launch that already loaded the new version's
// files from the network while the new sw.js installed behind it. The page
// knows which version its files are (VERSION), and it's outdated only once
// that version's cache is gone.

// The version this page's files are: sw.js's CACHE, the cache they're saved
// in. test/shell.test.js holds the two equal, so bump both.
export const VERSION = 'almanac-v26';

/**
 * Watches `workers` (navigator.serviceWorker) for another version taking
 * over; `reload` runs once one has and `doc` is out of sight. `caches` is
 * the page's Cache Storage. -> a function saying whether this page is
 * outdated, for the shell to reload at the next page change.
 */
export function watchVersion(workers, doc, { caches = globalThis.caches, reload }) {
  if (!workers || !caches) return () => false;
  let outdated = false;
  workers.addEventListener('controllerchange', async () => {
    await activated(workers.controller);
    // A storage error says nothing about the version: the page stays.
    if (await caches.has(VERSION).catch(() => true)) return;
    outdated = true;
    if (doc.hidden) reload();
  });
  doc.addEventListener('visibilitychange', () => {
    if (outdated && doc.hidden) reload();
  });
  return () => outdated;
}

// A worker takes over the page as it starts activating, and deletes the old
// cache before it's activated.
function activated(worker) {
  const done = () => !worker || worker.state === 'activated' || worker.state === 'redundant';
  return new Promise(resolve => {
    if (done()) return resolve();
    worker.addEventListener('statechange', function settled() {
      if (!done()) return;
      worker.removeEventListener('statechange', settled);
      resolve();
    });
  });
}
