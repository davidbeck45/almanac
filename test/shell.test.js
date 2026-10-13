import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const sw = read('sw.js');
const html = read('index.html');
const SHELL = JSON.parse(sw.match(/const SHELL = (\[[\s\S]*?\]);/)[1].replace(/'/g, '"').replace(/,\s*\]/, ']'));

// The modules main.js loads, following static imports.
function moduleGraph(file = 'main.js', seen = new Set()) {
  if (seen.has(file)) return seen;
  seen.add(file);
  for (const [, dep] of read(`src/${file}`).matchAll(/^\s*import\s[^'"]*['"]\.\/([\w-]+\.js)['"]/gm)) moduleGraph(dep, seen);
  return seen;
}

test('the service worker precaches every app file, and they all exist', () => {
  const src = readdirSync(new URL('src/', root)).filter(f => /\.(js|css)$/.test(f)).map(f => `src/${f}`);
  for (const file of src) assert.ok(SHELL.includes(file), `${file} is missing from SHELL in sw.js (bump CACHE too)`);
  for (const path of SHELL) if (path !== './') assert.ok(existsSync(new URL(path, root)), `${path} is in SHELL but not on disk`);
  assert.ok(!SHELL.some(p => p.startsWith('data/fragrantica/')), 'dataset files load on demand, not at install');
});

test('index.html preloads the whole module graph and the self-hosted fonts', () => {
  const preloaded = new Set([...html.matchAll(/<link rel="modulepreload" href="src\/([\w-]+\.js)">/g)].map(m => m[1]));
  const graph = moduleGraph();
  graph.delete('main.js');
  assert.deepEqual([...preloaded].sort(), [...graph].sort(), 'modulepreload links match what main.js imports');

  const fonts = [...html.matchAll(/<link rel="preload" href="(fonts\/[\w-]+\.woff2)" as="font" type="font\/woff2" crossorigin>/g)].map(m => m[1]);
  assert.ok(fonts.length >= 2);
  for (const font of fonts) {
    assert.ok(existsSync(new URL(font, root)), `${font} exists`);
    assert.ok(SHELL.includes(font), `${font} works offline`);
    assert.ok(read('src/tokens.css').includes(`url('../${font}')`), `${font} has an @font-face`);
  }
  assert.ok(!/fonts\.(googleapis|gstatic)\.com/.test(html + sw), 'no third-party font requests');
  assert.ok(html.indexOf('src/tokens.css') < html.indexOf('src/styles.css'), 'tokens load before the components that use them');
});

test('the stylesheet takes its colors from the tokens, so every theme follows', () => {
  const css = read('src/styles.css').replace(/\/\*[\s\S]*?\*\//g, '');
  // Raw colors left in components: black at an alpha for shadows goes
  // through --shade, and the masks need opaque #000.
  const literals = css.match(/#[0-9a-f]{3,8}\b|rgba?\((?!var\()[^)]*\)/gi) ?? [];
  const allowed = literals.filter(c => !/^#000$|%23000/.test(c));
  assert.deepEqual(allowed, [], 'use a color role from src/tokens.css');
  const sizes = new Set([...css.matchAll(/font-size:\s*([^;}]+)/g)].map(m => m[1].trim()));
  for (const size of sizes) assert.match(size, /^var\(--fs-[\w-]+\)$/, `font-size ${size} is not on the type scale`);
});

// Runs sw.js against an in-memory Cache Storage and a fake network.
function serviceWorker(scope = 'https://example.org/scentcast/') {
  const listeners = {};
  const stores = new Map();
  const href = key => new URL(typeof key === 'string' ? key : key.url, `${scope}sw.js`).href;
  const bare = url => url.replace(/\?.*$/, '');
  const store = name => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    return {
      put: async (key, res) => void m.set(href(key), res),
      keys: async () => [...m.keys()].map(url => ({ url })),
      delete: async key => m.delete(href(key)),
    };
  };
  const net = { online: true, status: 200 };
  const self = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    registration: { scope },
    location: new URL(`${scope}sw.js`),
  };
  const caches = {
    open: async name => store(name),
    match: async (key, { ignoreSearch } = {}) => {
      for (const m of stores.values()) {
        for (const [url, res] of m) if (url === href(key) || (ignoreSearch && bare(url) === bare(href(key)))) return res.clone();
      }
    },
  };
  const fetch = async input => {
    if (!net.online) throw new TypeError('Failed to fetch');
    const { pathname } = new URL(typeof input === 'string' ? input : input.url);
    return new Response(`${pathname} from the network`, { status: net.status });
  };
  vm.runInNewContext(sw, { self, caches, fetch, Response, URL });
  async function get(path, mode = 'cors') {
    let responded = null;
    const waits = [];
    listeners.fetch({ request: { method: 'GET', url: new URL(path, scope).href, mode }, respondWith: p => { responded = p; }, waitUntil: p => waits.push(p) });
    const res = await responded;
    await Promise.all(waits);
    return res ? res.text() : null;
  }
  const cached = (name, path) => stores.get(name)?.get(new URL(path, scope).href)?.clone();
  return { get, cached, net };
}

test('the service worker keeps one copy of the app page, and other pages opened in a tab never replace it', async () => {
  const CACHE = sw.match(/const CACHE = '([\w-]+)'/)[1];
  const w = serviceWorker();
  assert.equal(await w.get('?loc=40.71,-74.01,New%20York&view=week', 'navigate'), '/scentcast/ from the network');
  assert.equal(await w.cached(CACHE, './').text(), '/scentcast/ from the network');

  for (const page of ['data/collection.json', 'dev/og.html', 'fonts/OFL-Inter.txt']) {
    assert.equal(await w.get(page, 'navigate'), null, `${page} opened in a tab goes straight to the network`);
  }
  assert.equal(await w.cached(CACHE, './').text(), '/scentcast/ from the network');

  // A module the page loads is cached under its own URL.
  await w.get('src/main.js');
  assert.equal(await w.cached(CACHE, 'src/main.js').text(), '/scentcast/src/main.js from the network');

  // Errors are never cached.
  w.net.status = 404;
  await w.get('src/gone.js');
  assert.equal(w.cached(CACHE, 'src/gone.js'), undefined);

  // Offline, any visit to the app opens the saved page.
  w.net.online = false;
  assert.equal(await w.get('index.html?c=1,2&n=Brooke', 'navigate'), '/scentcast/ from the network');
  assert.equal(await w.get('?theme=gruvbox', 'navigate'), '/scentcast/ from the network');
});
