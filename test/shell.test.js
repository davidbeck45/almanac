import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

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
