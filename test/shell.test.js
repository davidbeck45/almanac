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
function serviceWorker(scope = 'https://example.org/scentcast/') {
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
    return new Response(`${pathname} from the network (${version})`, { status: net.status, headers: { etag: `"${version}"` } });
  };
  const context = { self, caches, fetch, Response, URL, setTimeout, clearTimeout };
  vm.runInNewContext(sw, context);
  async function get(path, mode = 'cors', { clientId = '', resultingClientId = '' } = {}) {
    let responded = null;
    const waits = [];
    listeners.fetch({ request: { method: 'GET', url: new URL(path, scope).href, mode }, clientId, resultingClientId, respondWith: p => { responded = p; }, waitUntil: p => waits.push(p) });
    const res = await responded;
    await Promise.all(waits);
    return res ? res.text() : null;
  }
  const cached = (name, path) => stores.get(name)?.get(new URL(path, scope).href)?.clone();
  return { get, cached, net, puts, wait: Number(sw.match(/const NETWORK_WAIT_MS = (\d+)/)[1]), slow: Number(sw.match(/const SLOW_MS = (\d+)/)[1]) };
}

test('the service worker keeps one copy of the app page, and other pages opened in a tab never replace it', async () => {
  const CACHE = sw.match(/const CACHE = '([\w-]+)'/)[1];
  const w = serviceWorker();
  assert.equal(await w.get('?loc=40.71,-74.01,New%20York&view=week', 'navigate'), '/scentcast/ from the network (v1)');
  assert.equal(await w.cached(CACHE, './').text(), '/scentcast/ from the network (v1)');

  for (const page of ['data/collection.json', 'dev/og.html', 'fonts/OFL-Inter.txt']) {
    assert.equal(await w.get(page, 'navigate'), null, `${page} opened in a tab goes straight to the network`);
  }
  assert.equal(await w.cached(CACHE, './').text(), '/scentcast/ from the network (v1)');

  // A module the page loads is cached under its own URL.
  await w.get('src/main.js');
  assert.equal(await w.cached(CACHE, 'src/main.js').text(), '/scentcast/src/main.js from the network (v1)');

  // Errors are never cached.
  w.net.status = 404;
  await w.get('src/gone.js');
  assert.equal(w.cached(CACHE, 'src/gone.js'), undefined);

  // Offline, any visit to the app opens the saved page.
  w.net.online = false;
  assert.equal(await w.get('index.html?c=1,2&n=Brooke', 'navigate'), '/scentcast/ from the network (v1)');
  assert.equal(await w.get('?theme=gruvbox', 'navigate'), '/scentcast/ from the network (v1)');
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
  w.net.delay = w.wait + 400;
  const start = Date.now();
  assert.equal(await w.get('', 'navigate', { resultingClientId: 'b' }), '/scentcast/ from the network (v1)');
  assert.ok(Date.now() - start < w.wait + 300, 'it didn’t wait for the network');
  w.net.delay = 0;
  assert.equal(await w.get('src/main.js', 'cors', { clientId: 'b' }), '/scentcast/src/main.js from the network (v1)');
  assert.equal(await w.get('src/pool-worker.js', 'cors', { clientId: 'b', resultingClientId: 'worker' }), '/scentcast/src/pool-worker.js from the network (v2)', 'a file it never saved comes from the network');
  assert.equal(await w.get('src/main.js', 'cors', { clientId: 'worker' }), '/scentcast/src/main.js from the network (v1)', 'the worker keeps to the page’s version');
  await new Promise(r => setTimeout(r, 500)); // the late page lands
  assert.equal(await w.cached(CACHE, './').text(), '/scentcast/ from the network (v1)', 'the late page isn’t saved over the version its files are');
  // A launch where the network answers in time takes the new version.
  assert.equal(await w.get('', 'navigate', { resultingClientId: 'c' }), '/scentcast/ from the network (v2)');
  assert.equal(await w.get('src/main.js', 'cors', { clientId: 'c' }), '/scentcast/src/main.js from the network (v2)');
  // Offline, at once.
  w.net.online = false;
  assert.equal(await w.get('', 'navigate', { resultingClientId: 'd' }), '/scentcast/ from the network (v2)');
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
  assert.equal(await w.get('', 'navigate', { resultingClientId: 'a' }), '/scentcast/ from the network (v1)');
  assert.equal(await w.get('src/main.js', 'cors', { clientId: 'a' }), '/scentcast/src/main.js from the network (v1)');
  assert.equal(w.net.sent, sent, 'nothing downloaded again');
  assert.equal(w.net.notModified, 2);
  // A new version downloads.
  w.net.version = 'v2';
  assert.equal(await w.get('src/main.js', 'cors', { clientId: 'a' }), '/scentcast/src/main.js from the network (v2)');
  assert.equal(w.net.sent, sent + 1);
});

test('a slow check on an unchanged launch takes the rest of the launch from the cache', async () => {
  const w = serviceWorker();
  await w.get('', 'navigate');
  for (const f of ['src/main.js', 'src/app/shell.js', 'src/engine.js']) await w.get(f);
  await w.get('', 'navigate', { resultingClientId: 'a' });
  assert.equal(await w.get('src/main.js', 'cors', { clientId: 'a' }), '/scentcast/src/main.js from the network (v1)');
  // The shell's check is slow: the saved copy answers at SLOW_MS, and the
  // files after it don't wait on the network at all.
  w.net.slow['src/app/shell.js'] = w.slow + 1500;
  let start = Date.now();
  assert.equal(await w.get('src/app/shell.js', 'cors', { clientId: 'a' }), '/scentcast/src/app/shell.js from the network (v1)');
  assert.ok(Date.now() - start < w.slow + 400, 'it waited no longer than SLOW_MS');
  w.net.delay = w.slow + 1500;
  start = Date.now();
  assert.equal(await w.get('src/engine.js', 'cors', { clientId: 'a' }), '/scentcast/src/engine.js from the network (v1)');
  assert.ok(Date.now() - start < 300, 'the rest came from the cache at once');
  // A page that came in time but slow does the same from the start.
  w.net.slow = {};
  w.net.delay = w.slow + 300;
  await w.get('', 'navigate', { resultingClientId: 'b' });
  w.net.delay = w.slow + 1500;
  start = Date.now();
  await w.get('src/main.js', 'cors', { clientId: 'b' });
  assert.ok(Date.now() - start < 300, 'a slow page puts its files on the cache');
});

test('a launch that met a new version waits for the network, so versions never mix', async () => {
  const w = serviceWorker();
  await w.get('', 'navigate');
  for (const f of ['src/main.js', 'src/app/shell.js']) await w.get(f);
  // The page itself is new: no file may come from the cache.
  w.net.version = 'v2';
  await w.get('', 'navigate', { resultingClientId: 'a' });
  w.net.delay = w.slow + 300;
  assert.equal(await w.get('src/main.js', 'cors', { clientId: 'a' }), '/scentcast/src/main.js from the network (v2)', 'it waited past SLOW_MS');
  // The page is as saved, but a file comes back new: from there it waits too.
  w.net.delay = 0;
  await w.get('', 'navigate', { resultingClientId: 'b' });
  w.net.version = 'v3';
  assert.equal(await w.get('src/main.js', 'cors', { clientId: 'b' }), '/scentcast/src/main.js from the network (v3)');
  w.net.delay = w.slow + 300;
  assert.equal(await w.get('src/app/shell.js', 'cors', { clientId: 'b' }), '/scentcast/src/app/shell.js from the network (v3)', 'not the saved v2 beside a v3 main.js');
});

test('dataset files answer from the cache at once and are checked behind it', async () => {
  const w = serviceWorker();
  w.net.version = 'v2';
  await w.get('data/fragrantica/pool.json');
  w.net.version = 'v3';
  assert.equal(await w.get('data/fragrantica/pool.json'), '/scentcast/data/fragrantica/pool.json from the network (v2)', 'the saved copy first');
  assert.equal(await w.get('data/fragrantica/pool.json'), '/scentcast/data/fragrantica/pool.json from the network (v3)', 'the check behind it saved the new one');
  w.net.version = 'v4';
  await w.get('data/fragrantica/x/7.json');
  w.net.version = 'v5';
  assert.equal(await w.get('data/fragrantica/x/7.json'), '/scentcast/data/fragrantica/x/7.json from the network (v4)', 'a shard too');
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

test('the suggestion pool’s files stay cached offline, however many dataset shards come and go', async () => {
  const max = Number(sw.match(/const DATA_MAX = (\d+)/)[1]);
  const w = serviceWorker();
  const pool = ['pool.json', 'pool-notes.json', 'pool-styles.json'].map(f => `data/fragrantica/${f}`);
  for (const path of pool) await w.get(path);
  for (let i = 0; i < max + 20; i++) await w.get(`data/fragrantica/x/${i}.json`);
  w.net.online = false;
  for (const path of pool) assert.equal(await w.get(path), `/scentcast/${path} from the network (v1)`, `${path} is still there`);
  assert.equal(await w.get(`data/fragrantica/x/${max + 19}.json`), `/scentcast/data/fragrantica/x/${max + 19}.json from the network (v1)`);
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

test('Wear this is for windows dated today: at night, tomorrow’s daytime can’t be logged yet', async () => {
  const { state, canWear } = await import('../src/app/state.js');
  const tonight = { dateISO: '2026-10-14', slot: 'night' }, tomorrow = { dateISO: '2026-10-15', slot: 'day' };
  try {
    // 22:49: the day window has rolled over to tomorrow's.
    state.wx = { todayISO: '2026-10-14', day: tomorrow, night: tonight };
    assert.equal(canWear(tonight), true);
    assert.equal(canWear(tomorrow), false, 'Now’s Day toggle and Week’s tomorrow offer no Wear this');
    assert.equal(canWear({ dateISO: '2026-10-16', slot: 'day' }), false);
    state.wx = { todayISO: '2026-10-14', day: { dateISO: '2026-10-14', slot: 'day' }, night: tonight };
    assert.equal(canWear({ dateISO: '2026-10-14', slot: 'day' }), true);
  } finally {
    state.wx = null;
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
