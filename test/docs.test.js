// What CLAUDE.md and the READMEs say about the code, where it can drift:
// the dataset README names every file in data/fragrantica/ (its licence note
// covers each), the modules Insights and the Wishlist load on demand stay out
// of the boot graph, a bottle page's shopping order reads as the page does,
// its order slots are the registry's, the --journal example names the file
// Export saves, the code names, paths and files CLAUDE.md gives are still in
// the repo, and nothing tracked points at the git-excluded sweep notes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { SECTIONS, sectionsFor } from '../src/views/bottle.js';
import '../src/views/sections.js';
import { riskWord } from '../src/ui.js';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const claude = read('CLAUDE.md');

// The text files under some folders of the repo, as { path, text }.
const filesUnder = (dirs, ext = /\.(js|mjs|py|html|css|json|qml|md|sh)$/) => dirs.flatMap(dir =>
  readdirSync(new URL(`${dir}/`, root), { recursive: true }).filter(f => ext.test(f))
    .map(f => ({ path: `${dir}/${f}`, text: read(`${dir}/${f}`) })));

// The modules main.js loads, following static imports (as test/shell.test.js).
function moduleGraph(file = 'src/main.js', seen = new Set()) {
  if (seen.has(file)) return seen;
  seen.add(file);
  for (const [, dep] of read(file).matchAll(/^\s*import\s[^'"]*['"](\.{1,2}\/[\w/.-]+\.js)['"]/gm)) moduleGraph(normalize(join(dirname(file), dep)), seen);
  return seen;
}

test('the dataset README names every file in its folder', () => {
  const readme = read('data/fragrantica/README.md');
  const named = new Set([...readme.matchAll(/^- `([\w./-]+)/gm)].map(m => m[1]));
  for (const e of readdirSync(new URL('data/fragrantica/', root), { withFileTypes: true })) {
    if (e.name === 'README.md') continue;
    const name = e.isDirectory() ? `${e.name}/` : e.name;
    assert.ok(named.has(name), `data/fragrantica/README.md has no bullet for ${name}`);
  }
});

test('what Insights and the Wishlist load on demand is outside the boot graph', () => {
  const sentence = claude.match(/Neither loads ([^:]+) at boot: `loadLib\(\)` imports them/);
  assert.ok(sentence, 'CLAUDE.md still says what Insights and the Wishlist load on demand');
  const lazy = [...sentence[1].matchAll(/`([\w-]+\.js)`/g)].map(m => m[1]);
  assert.ok(lazy.length >= 3);
  const graph = moduleGraph();
  const parts = read('src/views/wardrobe/parts.js');
  for (const file of lazy) {
    assert.ok(!graph.has(`src/${file}`), `CLAUDE.md says ${file} loads on demand, but main.js imports it`);
    assert.ok(parts.includes(`import('../../${file}')`), `loadLib() imports ${file}`);
  }
});

test('a bottle page you shop from reads in the order CLAUDE.md gives', () => {
  const sentence = claude.match(/For a bottle you don't own the page reads in shopping order \(`shopOrder`\): ([^\n]+?)\.\n/)[1];
  // The words each section goes by in that sentence.
  const words = [
    ['check', 'the buy check'], ['why', 'how it would do now'], ['styles', 'its style'], ['accords', 'accords'],
    ['notes', 'notes'], ['dupes', 'what it smells like'], ['crowd', 'what voters say'], ['reviews', 'pros and cons'],
    ['seasons', 'its seasons'], ['spray', 'spraying'], ['layering', 'layering'],
  ];
  const at = Object.fromEntries(words.map(([id, w]) => [id, sentence.indexOf(w)]));
  for (const [id, w] of words) assert.ok(at[id] >= 0, `"${w}" (${id}) is in the sentence`);
  const page = sectionsFor({ owned: false, inMine: false }).map(s => s.id).filter(id => id in at);
  assert.deepEqual([...page].sort((a, b) => at[a] - at[b]), page, `the page's order: ${page.join(', ')}`);
});

test("README's --journal example names the file Export saves", () => {
  assert.match(read('src/views/wardrobe.js'), /a\.download = `almanac-journal-\$\{deviceToday\(\)\}\.json`/, 'named by the device’s date, not UTC’s');
  assert.ok(/--journal almanac-journal-\d{4}-\d{2}-\d{2}\.json/.test(read('README.md')), 'README.md runs --journal on almanac-journal-<date>.json');
});

test('CLAUDE.md lists every bottle-page section at its order slot', () => {
  const list = claude.match(/The slots by `order`[^:]*: ([^\n]+)\.\n/)?.[1];
  assert.ok(list, 'CLAUDE.md still lists the slots under "The bottle page"');
  // "`spray` 250 (800)": its order, then the shopOrder in brackets.
  const slots = [...list.matchAll(/`([\w-]+)` (\d+)(?: \((?:[^()]*?)(\d+)\))?/g)]
    .map(([, id, order, shop]) => ({ id, order: Number(order), shopOrder: shop ? Number(shop) : undefined }));
  const registry = SECTIONS.map(({ id, order, shopOrder }) => ({ id, order, shopOrder }));
  assert.deepEqual(slots, registry);
});

test('the want-list functions CLAUDE.md names are exported and used', () => {
  const sentence = claude.match(/`src\/wishlist.js` keeps the want list[^\n]*?\. (`addWant`[^\n]*?)\.\n/)?.[1];
  assert.ok(sentence, 'CLAUDE.md still lists the want list\'s functions');
  const names = [...sentence.matchAll(/`(\w+)`/g)].map(m => m[1]);
  const wishlist = read('src/wishlist.js');
  const src = filesUnder(['src'], /\.js$/).map(f => f.text).join('\n');
  for (const name of names) {
    assert.ok(new RegExp(`^export (?:const|function) ${name}\\b`, 'm').test(wishlist), `src/wishlist.js exports ${name}`);
    const uses = src.match(new RegExp(`\\b${name}\\b`, 'g'))?.length ?? 0;
    assert.ok(uses > 1, `${name} is used in src/, not only declared`);
  }
});

test("the buy check reads the liked styles through the function CLAUDE.md names", () => {
  const name = claude.match(/the buy check \(`bottle-check.js`\): [^\n]*?the styles you like \(`(\w+)`/)?.[1];
  assert.ok(name, 'CLAUDE.md names how the buy check reads the liked styles');
  assert.ok(new RegExp(`\\b${name}\\(`).test(read('src/views/bottle-check.js')), `bottle-check.js calls ${name}`);
});

test("Insights' risk words in CLAUDE.md are riskWord's", () => {
  const words = claude.match(/blind-buy risk in `riskWord`'s words \(([^)]+)\)/)?.[1].split(', ');
  assert.ok(words, 'CLAUDE.md says which words Insights uses for risk');
  const said = new Set(['high', 'medium', 'low'].flatMap(level => [riskWord(level), riskWord(level, 80)]));
  assert.deepEqual(new Set(words), said);
});

test('the code names, paths and files CLAUDE.md gives are in the repo', () => {
  const code = filesUnder(['src', 'scripts', 'dev', 'worker', 'omarchy'], /\.(js|mjs|py|html|css|json|qml|toml|sh)$/)
    .map(f => f.text).concat(read('sw.js'), read('index.html')).join('\n');
  const quoted = new Set([...claude.matchAll(/`([^`\n]+)`/g)].map(m => m[1]));
  // Names from outside the code: a Claude in Chrome tool, Parfumo's brand slugs.
  const outside = new Set(['get_page_text', 'Afnan_Perfumes', 'Goldfield__Banks']);
  // camelCase, snake_case and CONSTANT names, called or not ("`rank`" is a word too, so skip plain ones).
  const names = [...quoted].map(q => q.match(/^([A-Za-z_$][\w$]*)(?:\(.*\))?$/)?.[1])
    .filter(n => n && /[a-z][A-Z]|_|^[A-Z][A-Z0-9]+$/.test(n) && !outside.has(n));
  assert.ok(names.length > 200, `${names.length} names`);
  const gone = names.filter(n => !new RegExp(`(?<![\\w$])${n.replace(/\$/g, '\\$')}(?![\\w$])`).test(code));
  assert.deepEqual(gone, [], 'CLAUDE.md names these, but no code does');
  // Paths from the repo root, and bare file names ("`bottle-check.js`").
  const ignored = new Set(['worker/.dev.vars']); // git leaves it out
  const paths = [...quoted].filter(q => /^(src|scripts|dev|test|data|worker|omarchy|fonts|icons)\/[\w./-]+$/.test(q) && !ignored.has(q));
  assert.deepEqual(paths.filter(p => !existsSync(new URL(p, root))), [], 'CLAUDE.md names these paths');
  const files = new Set([readdirSync(root), ...['src', 'scripts', 'dev', 'test', 'worker', 'omarchy', 'data'].map(dir =>
    readdirSync(new URL(`${dir}/`, root), { recursive: true }).filter(f => !/^fragrantica\/[rix]\//.test(f)))]
    .flat().map(f => f.split('/').at(-1)));
  const bare = [...quoted].filter(q => /^[\w.-]+\.(js|mjs|css|py|json|jsonl|html|toml)$/.test(q));
  assert.deepEqual(bare.filter(f => !files.has(f)), [], 'CLAUDE.md names these files');
});

test('nothing points at the sweep notes, which git leaves out', () => {
  const notes = new RegExp(['\\.sweep/', 'shell-map'].join('|'));
  const files = [...filesUnder(['src', 'scripts', 'dev', 'test', 'omarchy']),
    ...['CLAUDE.md', 'README.md', 'index.html', 'sw.js', 'data/fragrantica/README.md'].map(path => ({ path, text: read(path) }))];
  const hits = files.filter(f => f.path !== 'test/docs.test.js' && notes.test(f.text)).map(f => f.path);
  assert.deepEqual(hits, [], 'point these at CLAUDE.md instead');
});
