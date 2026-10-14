// What CLAUDE.md and the READMEs say about the code, where it can drift:
// the dataset README names every file in data/fragrantica/ (its licence note
// covers each), the modules Insights and the Wishlist load on demand stay out
// of the boot graph, a bottle page's shopping order reads as the page does,
// and the --journal example names the file Export saves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { sectionsFor } from '../src/views/bottle.js';
import '../src/views/sections.js';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const claude = read('CLAUDE.md');

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
  assert.match(read('src/views/wardrobe.js'), /a\.download = `scentcast-journal-\$\{deviceToday\(\)\}\.json`/, 'named by the device’s date, not UTC’s');
  assert.ok(/--journal scentcast-journal-\d{4}-\d{2}-\d{2}\.json/.test(read('README.md')), 'README.md runs --journal on scentcast-journal-<date>.json');
});
