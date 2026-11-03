import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const sw = read('sw.js');
const html = read('index.html');
const SHELL = JSON.parse(sw.match(/const SHELL = (\[[\s\S]*?\]);/)[1].replace(/'/g, '"').replace(/,\s*\]/, ']'));

// The modules main.js loads, following static imports (paths from the repo
// root), and main.js's own `await import()` of the shell, which it loads
// right after starting the forecast. Other modules' dynamic imports load on
// demand and stay out.
function moduleGraph(file = 'src/main.js', seen = new Set()) {
  if (seen.has(file)) return seen;
  seen.add(file);
  const source = read(file);
  const deps = [...source.matchAll(/^\s*import\s[^'"]*['"](\.{1,2}\/[\w/.-]+\.js)['"]/gm)];
  if (file === 'src/main.js') deps.push(...source.matchAll(/await import\(['"](\.{1,2}\/[\w/.-]+\.js)['"]\)/g));
  for (const [, dep] of deps) moduleGraph(normalize(join(dirname(file), dep)), seen);
  return seen;
}

// Every app file under src/, subfolders included.
const appFiles = (dir = 'src') => readdirSync(new URL(`${dir}/`, root), { withFileTypes: true })
  .flatMap(e => (e.isDirectory() ? appFiles(`${dir}/${e.name}`) : /\.(js|css)$/.test(e.name) ? [`${dir}/${e.name}`] : []));
const stylesheets = [...html.matchAll(/<link rel="stylesheet" href="(src\/[\w/.-]+\.css)">/g)].map(m => m[1]);

test('the service worker precaches every app file, and they all exist', () => {
  const src = appFiles();
  for (const file of src) assert.ok(SHELL.includes(file), `${file} is missing from SHELL in sw.js (bump CACHE too)`);
  for (const path of SHELL) if (path !== './') assert.ok(existsSync(new URL(path, root)), `${path} is in SHELL but not on disk`);
  assert.ok(!SHELL.some(p => p.startsWith('data/fragrantica/')), 'dataset files load on demand, not at install');
});

test('index.html preloads the whole module graph and the self-hosted fonts', () => {
  const preloaded = new Set([...html.matchAll(/<link rel="modulepreload" href="(src\/[\w/.-]+\.js)">/g)].map(m => m[1]));
  const graph = moduleGraph();
  graph.delete('src/main.js');
  assert.deepEqual([...preloaded].sort(), [...graph].sort(), 'modulepreload links match what main.js imports');

  const fonts = [...html.matchAll(/<link rel="preload" href="(fonts\/[\w-]+\.woff2)" as="font" type="font\/woff2" crossorigin>/g)].map(m => m[1]);
  assert.deepEqual(fonts, ['fonts/inter.woff2'], 'Inter alone: preloading Fraunces too held the first paint back');
  for (const font of fonts) {
    assert.ok(existsSync(new URL(font, root)), `${font} exists`);
    assert.ok(SHELL.includes(font), `${font} works offline`);
    assert.ok(read('src/tokens.css').includes(`url('../${font}')`), `${font} has an @font-face`);
  }
  assert.ok(!/fonts\.(googleapis|gstatic)\.com/.test(html + sw), 'no third-party font requests');
});

test('index.html links every stylesheet, tokens first', () => {
  const css = appFiles().filter(f => f.endsWith('.css'));
  assert.deepEqual([...stylesheets].sort(), css.sort(), 'each stylesheet under src/ is linked once');
  assert.equal(stylesheets[0], 'src/tokens.css', 'tokens load before the components that use them');
  assert.equal(stylesheets[1], 'src/css/base.css');
});

test('the stylesheets take their colors from the tokens, so every theme follows', () => {
  for (const file of stylesheets.filter(f => f !== 'src/tokens.css')) {
    const css = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
    // Raw colors left in components: black at an alpha for shadows goes
    // through --shade, and the masks need opaque #000.
    const literals = css.match(/#[0-9a-f]{3,8}\b|rgba?\((?!var\()[^)]*\)/gi) ?? [];
    const allowed = literals.filter(c => !/^#000$|%23000/.test(c));
    assert.deepEqual(allowed, [], `${file}: use a color role from src/tokens.css`);
    const sizes = new Set([...css.matchAll(/font-size:\s*([^;}]+)/g)].map(m => m[1].trim()));
    for (const size of sizes) assert.match(size, /^var\(--fs-[\w-]+\)$/, `${file}: font-size ${size} is not on the type scale`);
  }
});

// Runs sw.js against an in-memory Cache Storage and a fake network. The
// network answers after `net.delay` ms (or `net.slow[path]`), each file with
// an ETag of `net.version`, and a 304 when asked with that ETag already;
// `puts` counts the writes into Cache Storage, `net.sent` the bodies sent.
function serviceWorker(scope = 'https://example.org/almanac/') {
  const listeners = {};
  const stores = new Map();
  const puts = [];
  const href = key => new URL(typeof key === 'string' ? key : key.url, `${scope}sw.js`).href;
  const bare = url => url.replace(/\?.*$/, '');
  const find = (m, key, ignoreSearch) => {
    for (const [url, res] of m) if (url === href(key) || (ignoreSearch && bare(url) === bare(href(key)))) return res.clone();
  };
  const store = name => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    return {
      put: async (key, res) => { puts.push(href(key)); m.set(href(key), res); },
      keys: async () => [...m.keys()].map(url => ({ url })),
      delete: async key => m.delete(href(key)),
      match: async (key, { ignoreSearch } = {}) => find(m, key, ignoreSearch),
    };
  };
  const net = { online: true, status: 200, delay: 0, slow: {}, version: 'v1', sent: 0, notModified: 0 };
  const self = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    registration: { scope },
    location: new URL(`${scope}sw.js`),
  };
  const caches = {
    open: async name => store(name),
    match: async (key, { ignoreSearch } = {}) => {
      for (const m of stores.values()) {
        const hit = find(m, key, ignoreSearch);
        if (hit) return hit;
      }
    },
  };
  const fetch = async (input, init = {}) => {
    const version = net.version;
    const { pathname } = new URL(typeof input === 'string' ? input : input.url);
    const delay = net.slow[pathname.replace(new URL(scope).pathname, '')] ?? net.delay;
    if (delay) await new Promise(r => setTimeout(r, delay));
    if (!net.online) throw new TypeError('Failed to fetch');
    const asked = init.headers?.['If-None-Match'];
    if (asked === `"${version}"` && net.status === 200) {
      net.notModified++;
      return new Response(null, { status: 304, headers: { etag: `"${version}"` } });
    }
    net.sent++;
    if (net.status !== 200) return new Response(`${pathname}: ${net.status}`, { status: net.status });
    return new Response(`${pathname} from the network (${version})`, { headers: { etag: `"${version}"` } });
  };
  const context = { self, caches, fetch, Response, URL, setTimeout, clearTimeout };
  // The waits for a slow network, cut short so the suite doesn't sit through them.
  const [, waitMs, slowMs] = sw.match(/const NETWORK_WAIT_MS = (\d+);\nconst SLOW_MS = (\d+);/).map(Number);
  assert.ok(slowMs < waitMs, 'a slow page still comes in time');
  vm.runInNewContext(sw.replace(/const NETWORK_WAIT_MS = \d+;/, `const NETWORK_WAIT_MS = ${TEST_WAIT_MS};`)
    .replace(/const SLOW_MS = \d+;/, `const SLOW_MS = ${TEST_SLOW_MS};`), context);
  async function get(path, mode = 'cors', { clientId = '', resultingClientId = '' } = {}) {
    let responded = null;
    const waits = [];
    listeners.fetch({ request: { method: 'GET', url: new URL(path, scope).href, mode }, clientId, resultingClientId, respondWith: p => { responded = p; }, waitUntil: p => waits.push(p) });
    const res = await responded;
    await Promise.all(waits);
    return res ? res.text() : null;
  }
  const cached = (name, path) => stores.get(name)?.get(new URL(path, scope).href)?.clone();
  return { get, cached, net, puts, wait: TEST_WAIT_MS, slow: TEST_SLOW_MS };
}
// sw.js's waits, cut short in the same order (SLOW_MS under NETWORK_WAIT_MS).
const TEST_WAIT_MS = 400;
const TEST_SLOW_MS = 200;

test('the service worker keeps one copy of the app page, and other pages opened in a tab never replace it', async () => {
  const CACHE = sw.match(/const CACHE = '([\w-]+)'/)[1];
  const w = serviceWorker();
  assert.equal(await w.get('?loc=40.71,-74.01,New%20York&view=week', 'navigate'), '/almanac/ from the network (v1)');
  assert.equal(await w.cached(CACHE, './').text(), '/almanac/ from the network (v1)');

  for (const page of ['data/collection.json', 'dev/og.html', 'fonts/OFL-Inter.txt']) {
    assert.equal(await w.get(page, 'navigate'), null, `${page} opened in a tab goes straight to the network`);
  }
  assert.equal(await w.cached(CACHE, './').text(), '/almanac/ from the network (v1)');

  // A module the page loads is cached under its own URL.
  await w.get('src/main.js');
  assert.equal(await w.cached(CACHE, 'src/main.js').text(), '/almanac/src/main.js from the network (v1)');

  // Errors are never cached.
  w.net.status = 404;
  await w.get('src/gone.js');
  assert.equal(w.cached(CACHE, 'src/gone.js'), undefined);

  // Offline, any visit to the app opens the saved page.
  w.net.online = false;
  assert.equal(await w.get('index.html?c=1,2&n=Brooke', 'navigate'), '/almanac/ from the network (v1)');
  assert.equal(await w.get('?theme=gruvbox', 'navigate'), '/almanac/ from the network (v1)');
});

test('the service worker installs by revalidating, not downloading the app again', () => {
  assert.match(sw, /new Request\(path, \{ cache: 'no-cache' \}\)/);
  assert.ok(!/cache: 'reload'/.test(sw), 'reload skips the HTTP cache the page just filled');
});

test('a launch on a slow line opens the saved app, one version throughout', async () => {
  const CACHE = sw.match(/const CACHE = '([\w-]+)'/)[1];
  const w = serviceWorker();
  await w.get('', 'navigate');
  await w.get('src/main.js', 'cors', { clientId: 'a' });
  // A new version is out, but the line is slow: the saved page opens without
  // waiting it out, and its files and its worker's come from the cache.
  w.net.version = 'v2';
  w.net.delay = w.wait + 200;
  const start = Date.now();
  assert.equal(await w.get('', 'navigate', { resultingClientId: 'b' }), '/almanac/ from the network (v1)');
  assert.ok(Date.now() - start < w.wait + 150, 'it didn’t wait for the network');
  w.net.delay = 0;
  assert.equal(await w.get('src/main.js', 'cors', { clientId: 'b' }), '/almanac/src/main.js from the network (v1)');
  assert.equal(await w.get('src/pool-worker.js', 'cors', { clientId: 'b', resultingClientId: 'worker' }), '/almanac/src/pool-worker.js from the network (v2)', 'a file it never saved comes from the network');
  assert.equal(await w.get('src/main.js', 'cors', { clientId: 'worker' }), '/almanac/src/main.js from the network (v1)', 'the worker keeps to the page’s version');
  await new Promise(r => setTimeout(r, w.wait + 200)); // the late page lands
  assert.equal(await w.cached(CACHE, './').text(), '/almanac/ from the network (v1)', 'the late page isn’t saved over the version its files are');
  // A launch where the network answers in time takes the new version.
  assert.equal(await w.get('', 'navigate', { resultingClientId: 'c' }), '/almanac/ from the network (v2)');
  assert.equal(await w.get('src/main.js', 'cors', { clientId: 'c' }), '/almanac/src/main.js from the network (v2)');
  // Offline, at once.
  w.net.online = false;
  assert.equal(await w.get('', 'navigate', { resultingClientId: 'd' }), '/almanac/ from the network (v2)');
});

test('the service worker leaves a file it already holds alone', async () => {
  const w = serviceWorker();
  await w.get('', 'navigate');
  await w.get('src/main.js');
  await w.get('data/fragrantica/pool.json');
  const before = w.puts.length;
  await w.get('', 'navigate');
  await w.get('src/main.js');
  await w.get('data/fragrantica/pool.json');
  assert.equal(w.puts.length, before, 'same ETag, no write');
  w.net.version = 'v2';
  await w.get('src/main.js');
  assert.equal(w.puts.length, before + 1, 'a new version is saved');
});

test('a file the worker holds costs a 304, even once the browser’s own cache has let it go', async () => {
  const w = serviceWorker();
  await w.get('', 'navigate');
  await w.get('src/main.js');
  const sent = w.net.sent;
  // The fake network has no HTTP cache: only the worker's own ETag makes it a 304.
  assert.equal(await w.get('', 'navigate', { resultingClientId: 'a' }), '/almanac/ from the network (v1)');
  assert.equal(await w.get('src/main.js', 'cors', { clientId: 'a' }), '/almanac/src/main.js from the network (v1)');
  assert.equal(w.net.sent, sent, 'nothing downloaded again');
  assert.equal(w.net.notModified, 2);
  // A new version downloads.
  w.net.version = 'v2';
  assert.equal(await w.get('src/main.js', 'cors', { clientId: 'a' }), '/almanac/src/main.js from the network (v2)');
  assert.equal(w.net.sent, sent + 1);
});

test('a slow check on an unchanged launch takes the rest of the launch from the cache', async () => {
  const w = serviceWorker();
  await w.get('', 'navigate');
  for (const f of ['src/main.js', 'src/app/shell.js', 'src/engine.js']) await w.get(f);
  await w.get('', 'navigate', { resultingClientId: 'a' });
  assert.equal(await w.get('src/main.js', 'cors', { clientId: 'a' }), '/almanac/src/main.js from the network (v1)');
  // The shell's check is slow: the saved copy answers at SLOW_MS, and the
  // files after it don't wait on the network at all.
  w.net.slow['src/app/shell.js'] = w.slow * 3;
  let start = Date.now();
  assert.equal(await w.get('src/app/shell.js', 'cors', { clientId: 'a' }), '/almanac/src/app/shell.js from the network (v1)');
  assert.ok(Date.now() - start < w.slow * 2, 'it waited no longer than SLOW_MS');
  w.net.delay = w.slow * 3;
  start = Date.now();
  assert.equal(await w.get('src/engine.js', 'cors', { clientId: 'a' }), '/almanac/src/engine.js from the network (v1)');
  assert.ok(Date.now() - start < w.slow / 2, 'the rest came from the cache at once');
  // A page that came in time but slow does the same from the start.
  w.net.slow = {};
  w.net.delay = (w.slow + w.wait) / 2;
  await w.get('', 'navigate', { resultingClientId: 'b' });
  w.net.delay = w.slow * 3;
  start = Date.now();
  await w.get('src/main.js', 'cors', { clientId: 'b' });
  assert.ok(Date.now() - start < w.slow / 2, 'a slow page puts its files on the cache');
});

test('a launch that met a new version waits for the network, so versions never mix', async () => {
  const w = serviceWorker();
  await w.get('', 'navigate');
  for (const f of ['src/main.js', 'src/app/shell.js']) await w.get(f);
  // The page itself is new: no file may come from the cache.
  w.net.version = 'v2';
  await w.get('', 'navigate', { resultingClientId: 'a' });
  w.net.delay = w.slow * 1.5;
  assert.equal(await w.get('src/main.js', 'cors', { clientId: 'a' }), '/almanac/src/main.js from the network (v2)', 'it waited past SLOW_MS');
  // The page is as saved, but a file comes back new: from there it waits too.
  w.net.delay = 0;
  await w.get('', 'navigate', { resultingClientId: 'b' });
  w.net.version = 'v3';
  assert.equal(await w.get('src/main.js', 'cors', { clientId: 'b' }), '/almanac/src/main.js from the network (v3)');
  w.net.delay = w.slow * 1.5;
  assert.equal(await w.get('src/app/shell.js', 'cors', { clientId: 'b' }), '/almanac/src/app/shell.js from the network (v3)', 'not the saved v2 beside a v3 main.js');
});

test('files in flight together keep to the launch’s one decision, whichever file makes it', async () => {
  const CACHE = sw.match(/const CACHE = '([\w-]+)'/)[1];
  const launch = async () => {
    const w = serviceWorker();
    await w.get('', 'navigate');
    for (const f of ['src/main.js', 'src/app/shell.js']) await w.get(f);
    await w.get('', 'navigate', { resultingClientId: 'a' }); // the page as saved
    w.net.version = 'v2'; // a deploy that changed only modules
    return w;
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // main.js comes back new while shell.js's check is still out: past SLOW_MS
  // shell.js waits for the network instead of taking its saved copy.
  let w = await launch();
  w.net.slow = { 'src/main.js': w.slow / 4, 'src/app/shell.js': w.slow * 3 };
  assert.deepEqual(await Promise.all([w.get('src/main.js', 'cors', { clientId: 'a' }), w.get('src/app/shell.js', 'cors', { clientId: 'a' })]),
    ['/almanac/src/main.js from the network (v2)', '/almanac/src/app/shell.js from the network (v2)'], 'one version: the new one');
  // shell.js's check passes SLOW_MS first (the line is slow), then main.js,
  // asked a little later, comes back new: it's the saved copy too, and the
  // late answer isn't saved over it.
  w = await launch();
  w.net.slow = { 'src/app/shell.js': w.slow * 3, 'src/main.js': w.slow * 0.75 };
  const shell = w.get('src/app/shell.js', 'cors', { clientId: 'a' });
  await sleep(w.slow / 2);
  assert.deepEqual(await Promise.all([w.get('src/main.js', 'cors', { clientId: 'a' }), shell]),
    ['/almanac/src/main.js from the network (v1)', '/almanac/src/app/shell.js from the network (v1)'], 'one version: the saved one');
  assert.equal(await w.cached(CACHE, 'src/main.js').text(), '/almanac/src/main.js from the network (v1)');
});

test('a server error is no answer: the saved copy opens the app, page, modules and wardrobe alike', async () => {
  const CACHE = sw.match(/const CACHE = '([\w-]+)'/)[1];
  const w = serviceWorker();
  await w.get('', 'navigate');
  for (const f of ['src/main.js', 'src/app/shell.js', 'data/collection.json']) await w.get(f);
  // The page comes, then GitHub Pages answers 503 for the rest: each file
  // the launch asks for is the saved copy, as is one from a page the worker
  // didn't open (the first visit that installed it).
  await w.get('', 'navigate', { resultingClientId: 'a' });
  w.net.status = 503;
  assert.equal(await w.get('src/main.js', 'cors', { clientId: 'a' }), '/almanac/src/main.js from the network (v1)');
  assert.equal(await w.get('data/collection.json', 'cors', { clientId: 'a' }), '/almanac/data/collection.json from the network (v1)', 'not "Collection missing"');
  assert.equal(await w.get('src/app/shell.js'), '/almanac/src/app/shell.js from the network (v1)', 'without a launch too');
  // A launch whose page met the error opens the saved app, as offline.
  assert.equal(await w.get('', 'navigate', { resultingClientId: 'b' }), '/almanac/ from the network (v1)');
  assert.equal(await w.get('src/main.js', 'cors', { clientId: 'b' }), '/almanac/src/main.js from the network (v1)');
  assert.equal(await w.cached(CACHE, 'src/app/shell.js').text(), '/almanac/src/app/shell.js from the network (v1)', 'and the error isn’t saved over it');
  // A file it never saved has nothing better to give: the error goes
  // through, and the page says the app didn't finish loading.
  assert.equal(await w.get('src/app/version.js', 'cors', { clientId: 'a' }), '/almanac/src/app/version.js: 503');
  // Once the server's back, so is the network's copy.
  w.net.status = 200;
  w.net.version = 'v2';
  assert.equal(await w.get('src/main.js'), '/almanac/src/main.js from the network (v2)');
});

test('a page reloads into another version once that version takes over, never for its own', async () => {
  const { VERSION, watchVersion } = await import('../src/app/version.js');
  assert.equal(VERSION, sw.match(/const CACHE = '([\w-]+)'/)[1], 'src/app/version.js names the cache sw.js keeps this version in: bump both');
  const tick = () => new Promise(resolve => setTimeout(resolve));
  const page = cached => {
    const workers = new EventTarget(), doc = Object.assign(new EventTarget(), { hidden: false });
    let reloads = 0;
    const outdated = watchVersion(workers, doc, { caches: { has: async name => cached.includes(name) }, reload: () => reloads++ });
    return {
      outdated,
      reloads: () => reloads,
      // A worker takes the page over as it starts activating; it's deleted
      // the caches it doesn't keep once it's activated.
      async takeOver() {
        const worker = workers.controller = Object.assign(new EventTarget(), { state: 'activating' });
        workers.dispatchEvent(new Event('controllerchange'));
        await tick();
        assert.equal(outdated(), false, 'not before it’s activated');
        worker.state = 'activated';
        worker.dispatchEvent(new Event('statechange'));
        await tick();
      },
      hide() { doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange')); },
    };
  };
  // A first visit's own install, or a launch whose files came from the
  // network while the new sw.js installed behind it: its version's cache is
  // there, and nothing reloads.
  let p = page([VERSION, 'almanac-data']);
  await p.takeOver();
  p.hide();
  assert.equal(p.outdated(), false);
  assert.equal(p.reloads(), 0);
  // Another version took over and deleted this one's cache: the next page
  // change reloads, and so does going out of sight.
  p = page(['almanac-v999', 'almanac-data']);
  await p.takeOver();
  assert.equal(p.outdated(), true);
  assert.equal(p.reloads(), 0, 'not under someone’s eyes');
  p.hide();
  assert.equal(p.reloads(), 1);
  // Out of sight already when it took over.
  p = page([]);
  p.hide();
  await p.takeOver();
  assert.equal(p.reloads(), 1);
  assert.equal(watchVersion(undefined, new EventTarget(), { reload() {} })(), false, 'no service workers, never outdated');
});

test('a module that doesn’t arrive leaves a message with Reload, not a blank page', async () => {
  const main = read('src/main.js');
  const caught = main.slice(main.indexOf("await import('./app/shell.js')"));
  assert.match(caught, /^await import\('\.\/app\/shell\.js'\)\.catch\(/, 'main.js catches the shell’s import');
  assert.ok(caught.indexOf('boot(') > caught.indexOf('});'), 'and only the import: an error in boot never wipes a page that works');
  const { showUnloaded } = await import('../src/app/early.js');
  let reloaded = false, onClick = null;
  const button = { addEventListener: (type, fn) => { if (type === 'click') onClick = fn; } };
  let skipped = false;
  const els = { nav: { hidden: false }, main: { innerHTML: '', querySelector: () => button } };
  showUnloaded({ getElementById: id => els[id], querySelector: () => ({ remove() { skipped = true; } }) }, () => { reloaded = true; });
  assert.equal(els.nav.hidden, true, 'no empty tab bar');
  assert.ok(skipped, 'nor a skip link to nowhere');
  assert.match(els.main.innerHTML, /role="alert"/);
  assert.match(els.main.innerHTML, /<h1>Almanac didn’t finish loading<\/h1>/);
  assert.match(els.main.innerHTML, /<button class="btn primary" type="button">Reload<\/button>/);
  onClick();
  assert.ok(reloaded);
});

test('dataset files answer from the cache at once and are checked behind it', async () => {
  const w = serviceWorker();
  w.net.version = 'v2';
  await w.get('data/fragrantica/pool.json');
  w.net.version = 'v3';
  assert.equal(await w.get('data/fragrantica/pool.json'), '/almanac/data/fragrantica/pool.json from the network (v2)', 'the saved copy first');
  assert.equal(await w.get('data/fragrantica/pool.json'), '/almanac/data/fragrantica/pool.json from the network (v3)', 'the check behind it saved the new one');
  w.net.version = 'v4';
  await w.get('data/fragrantica/x/7.json');
  w.net.version = 'v5';
  assert.equal(await w.get('data/fragrantica/x/7.json'), '/almanac/data/fragrantica/x/7.json from the network (v4)', 'a shard too');
});

test('the forecast goes out before the app loads, from a module that imports almost nothing', async () => {
  assert.deepEqual([...moduleGraph('src/app/early.js')].sort(), ['src/app/early.js', 'src/location.js', 'src/weather.js', 'src/wmo.js'],
    'weather.js stays clear of the engine (its dew point lives in wmo.js)');
  const main = read('src/main.js');
  assert.ok(main.indexOf('startForecast()') < main.indexOf("await import('./app/shell.js')"), 'main.js starts the forecast, then loads the shell');
  const { startForecast, locationFromURL } = await import('../src/app/early.js');
  assert.deepEqual(locationFromURL(new URLSearchParams('loc=40.71,-74.01,New%20York')), { name: 'New York', lat: 40.71, lon: -74.01 });
  assert.equal(locationFromURL(new URLSearchParams('loc=nowhere')), null);
  const realFetch = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async url => { asked.push(String(url)); throw new TypeError('Failed to fetch'); };
  try {
    const early = startForecast('?loc=40.71,-74.01,New%20York');
    assert.deepEqual(early.loc, { name: 'New York', lat: 40.71, lon: -74.01 });
    await assert.rejects(early.forecast);
    assert.ok(asked.some(u => u.includes('latitude=40.71')), 'the request went out');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('the offline copy installs without waiting on the forecast', () => {
  const shell = read('src/app/shell.js');
  const boot = shell.slice(shell.indexOf('export async function boot('));
  const register = boot.indexOf("navigator.serviceWorker.register('sw.js')");
  assert.ok(register > 0 && register < boot.indexOf('await refreshWeather()'), 'registered before boot waits on the forecast');
});

test('the suggestion pool’s files stay cached offline, however many dataset shards come and go', async () => {
  const max = Number(sw.match(/const DATA_MAX = (\d+)/)[1]);
  const w = serviceWorker();
  const pool = ['pool.json', 'pool-notes.json', 'pool-styles.json'].map(f => `data/fragrantica/${f}`);
  for (const path of pool) await w.get(path);
  for (let i = 0; i < max + 20; i++) await w.get(`data/fragrantica/x/${i}.json`);
  w.net.online = false;
  for (const path of pool) assert.equal(await w.get(path), `/almanac/${path} from the network (v1)`, `${path} is still there`);
  assert.equal(await w.get(`data/fragrantica/x/${max + 19}.json`), `/almanac/data/fragrantica/x/${max + 19}.json from the network (v1)`);
  assert.equal(await w.get('data/fragrantica/x/0.json'), '', 'the oldest shards make room');
});

test('a climate archive that fails isn’t asked again by every pool question', async () => {
  const { state, localClimate, retryClimate } = await import('../src/app/state.js');
  const realFetch = globalThis.fetch;
  let asked = 0;
  globalThis.fetch = async url => {
    if (String(url).includes('archive')) asked++;
    return new Response('{}', { status: 503 });
  };
  try {
    state.loc = { name: 'Testville', lat: 12.5, lon: -45.25 };
    assert.equal(await localClimate(), null, 'the default climate meanwhile');
    assert.equal(await localClimate(), null);
    assert.equal(asked, 1, 'once, not once per question');
    assert.equal(await localClimate(Date.now() + 11 * 60 * 1000), null);
    assert.equal(asked, 2, 'again after a while');
    retryClimate();
    await localClimate();
    assert.equal(asked, 3, 'and again once back online');
  } finally {
    globalThis.fetch = realFetch;
    state.loc = null;
  }
});

test('David’s wardrobe loads with the catalog beside it, and a server’s error page is no wardrobe', async () => {
  const { state, loadBottles } = await import('../src/app/state.js');
  const realFetch = globalThis.fetch;
  const answers = {};
  globalThis.fetch = async url => answers[url] ?? new Response('down', { status: 503 });
  try {
    answers['data/collection.json'] = Response.json({ fetched: '2026-10-30', fragrances: [{ id: 12, name: 'Twelve' }] });
    await loadBottles();
    assert.deepEqual(state.demo.fragrances.map(f => f.id), ['12'], 'ids as strings');
    assert.deepEqual(state.catalog, [], 'a catalog that doesn’t load only misses its bottles');
    state.demo = null;
    delete answers['data/collection.json'];
    await assert.rejects(loadBottles(), /503/, 'the shell says the wardrobe is missing, with Try again');
    assert.equal(state.demo, null);
  } finally {
    globalThis.fetch = realFetch;
    state.demo = null;
  }
});

test('Wear this is for windows dated today until each is over: at night, tomorrow’s daytime can’t be logged yet', async () => {
  const { state, canWear } = await import('../src/app/state.js');
  const tonight = { dateISO: '2026-10-14', slot: 'night' }, tomorrow = { dateISO: '2026-10-15', slot: 'day' };
  const today = { dateISO: '2026-10-14', slot: 'day' };
  // The place's wall clock, UTC-4 as its forecast says.
  const at = hhmm => Date.parse(`2026-10-14T${hhmm}:00Z`) + 4 * 3600e3;
  try {
    state.forecast = { utc_offset_seconds: -4 * 3600 };
    state.wx = { todayISO: '2026-10-14' };
    // 22:49: the day window has rolled over to tomorrow's.
    assert.equal(canWear(tonight, null, at('22:49')), true);
    assert.equal(canWear(tomorrow, null, at('22:49')), false, 'Now’s Day toggle and Week’s tomorrow offer no Wear this');
    assert.equal(canWear({ dateISO: '2026-10-16', slot: 'day' }, null, at('22:49')), false);
    assert.equal(canWear(today, null, at('22:49')), false, 'today’s daytime is over');
    assert.equal(canWear(today, null, at('16:59')), true);
    // By the clock, not the forecast as last read: an hour turned since it was read is over still.
    assert.equal(canWear(tonight, null, at('23:01')), false);
    // A list ranked somewhere else (a trip, another city) reads that place's
    // clock: at 22:49 here it's 11:49 tomorrow in Tokyo.
    const tokyo = { name: 'Tokyo', lat: 35.68, lon: 139.69, timezone: 'Asia/Tokyo' };
    assert.equal(canWear(tomorrow, tokyo, at('22:49')), true, 'Tokyo’s day under way');
    assert.equal(canWear(tonight, tokyo, at('22:49')), false, 'over there since 11 pm');
    state.forecast = null;
    assert.equal(canWear(tonight, null, at('20:00')), false, 'no forecast, no windows');
    assert.equal(canWear(tomorrow, tokyo, at('22:49')), true, 'a trip’s windows need no forecast of home’s');
  } finally {
    state.wx = null;
    state.forecast = null;
  }
});

test('a link’s ?ctx= can’t name a property every object has', async () => {
  const { state } = await import('../src/app/state.js');
  const { bottleModel } = await import('../src/views/bottle.js');
  const [f] = JSON.parse(read('data/collection.json')).fragrances;
  const id = String(f.id);
  state.bottles.set(id, { ...f, id });
  try {
    for (const ctx of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      assert.equal(state.contexts[ctx], undefined, ctx);
      assert.equal(bottleModel({ dest: 'bottle', arg: id, query: { ctx } }).f.id, id, `?ctx=${ctx} opens the page`);
    }
  } finally {
    state.bottles.delete(id);
  }
});

test('a link’s ?theme= shows for the visit, and only Settings saves a theme', async () => {
  const { savePrefs, chooseTheme } = await import('../src/app/state.js');
  const { setTheme } = await import('../src/theme.js');
  const store = new Map();
  globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  const saved = () => JSON.parse(store.get('scentcast.prefs')).theme;
  try {
    setTheme('gruvbox'); // ?theme=gruvbox, no theme saved
    savePrefs(); // picking an occasion, say
    assert.equal(saved(), undefined, 'the link’s theme isn’t the device’s');
    chooseTheme('gruvbox');
    assert.equal(saved(), 'gruvbox');
    setTheme('default'); // ?theme=default on a device that saved gruvbox
    savePrefs();
    assert.equal(saved(), 'gruvbox', 'a link doesn’t lose the saved one either');
  } finally {
    delete globalThis.localStorage;
    setTheme('default');
  }
});
