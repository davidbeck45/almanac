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

// The modules main.js loads, following static imports (paths from the repo root).
function moduleGraph(file = 'src/main.js', seen = new Set()) {
  if (seen.has(file)) return seen;
  seen.add(file);
  for (const [, dep] of read(file).matchAll(/^\s*import\s[^'"]*['"](\.{1,2}\/[\w/.-]+\.js)['"]/gm)) moduleGraph(normalize(join(dirname(file), dep)), seen);
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
  assert.ok(fonts.length >= 2);
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
// network answers after `net.delay` ms, each file with an ETag of
// `net.version`; `puts` counts the writes into Cache Storage.
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
  const net = { online: true, status: 200, delay: 0, version: 'v1' };
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
  const fetch = async input => {
    const version = net.version;
    if (net.delay) await new Promise(r => setTimeout(r, net.delay));
    if (!net.online) throw new TypeError('Failed to fetch');
    const { pathname } = new URL(typeof input === 'string' ? input : input.url);
    return new Response(`${pathname} from the network (${version})`, { status: net.status, headers: { etag: `"${version}"` } });
  };
  const context = { self, caches, fetch, Response, URL, setTimeout, clearTimeout };
  // The wait for a slow network, cut short so the suite doesn't sit through it.
  assert.match(sw, /const NETWORK_WAIT_MS = \d+;/);
  vm.runInNewContext(sw.replace(/const NETWORK_WAIT_MS = \d+;/, `const NETWORK_WAIT_MS = ${TEST_WAIT_MS};`), context);
  async function get(path, mode = 'cors', { clientId = '', resultingClientId = '' } = {}) {
    let responded = null;
    const waits = [];
    listeners.fetch({ request: { method: 'GET', url: new URL(path, scope).href, mode }, clientId, resultingClientId, respondWith: p => { responded = p; }, waitUntil: p => waits.push(p) });
    const res = await responded;
    await Promise.all(waits);
    return res ? res.text() : null;
  }
  const cached = (name, path) => stores.get(name)?.get(new URL(path, scope).href)?.clone();
  return { get, cached, net, puts, wait: TEST_WAIT_MS };
}
const TEST_WAIT_MS = 120;

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
  w.net.delay = w.wait + 200;
  const start = Date.now();
  assert.equal(await w.get('', 'navigate', { resultingClientId: 'b' }), '/scentcast/ from the network (v1)');
  assert.ok(Date.now() - start < w.wait + 150, 'it didn’t wait for the network');
  w.net.delay = 0;
  assert.equal(await w.get('src/main.js', 'cors', { clientId: 'b' }), '/scentcast/src/main.js from the network (v1)');
  assert.equal(await w.get('src/pool-worker.js', 'cors', { clientId: 'b', resultingClientId: 'worker' }), '/scentcast/src/pool-worker.js from the network (v2)', 'a file it never saved comes from the network');
  assert.equal(await w.get('src/main.js', 'cors', { clientId: 'worker' }), '/scentcast/src/main.js from the network (v1)', 'the worker keeps to the page’s version');
  await new Promise(r => setTimeout(r, w.wait + 200)); // the late page lands
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
