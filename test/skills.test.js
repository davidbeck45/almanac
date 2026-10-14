// What the project skills (.claude/skills/) say about the code, where it can
// drift: the CLAUDE.md sections they point at are still headings, the files
// they name exist, the flags they pass are ones the scripts take, the
// gallery's screens are the ui-check table's, its waits name classes the
// templates still draw, and nothing points at the git-excluded sweep notes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const skills = readdirSync(new URL('.claude/skills/', root)).map(name => ({
  name,
  text: read(`.claude/skills/${name}/SKILL.md`),
  files: readdirSync(new URL(`.claude/skills/${name}/`, root)).map(f => read(`.claude/skills/${name}/${f}`)).join('\n'),
}));
const skill = name => skills.find(s => s.name === name);

test('each skill is named for its folder and says when to use it', () => {
  assert.ok(skills.length >= 2);
  for (const { name, text } of skills) {
    const front = text.match(/^---\n([\s\S]*?)\n---\n/)?.[1];
    assert.ok(front, `${name}: frontmatter`);
    assert.match(front, new RegExp(`^name: ${name}$`, 'm'));
    assert.match(front, /^description: \S.{40,}$/m);
  }
});

test('the CLAUDE.md sections the skills point at are its headings', () => {
  const headings = new Set([...read('CLAUDE.md').matchAll(/^##+ (.+)$/gm)].map(m => m[1]));
  for (const { name, text } of skills) {
    // CLAUDE.md's "Discover", or CLAUDE.md's "Gap finder and buy check" and "Discover" sections
    for (const [, list] of text.matchAll(/CLAUDE\.md's ((?:"[^"]+"(?:,? and |, )?)+)/g)) {
      for (const [, section] of list.matchAll(/"([^"]+)"/g)) assert.ok(headings.has(section), `${name} points at CLAUDE.md's "${section}"`);
    }
  }
});

test('the files the skills name exist', () => {
  for (const { name, files } of skills) {
    for (const [path] of files.matchAll(/(?<![\w.-])(?:\.claude|dev|scripts|src|test|data)\/[\w./-]*\w\.(?:mjs|js|sh|md|json|html|css|py)\b/g)) {
      assert.ok(existsSync(new URL(path, root)), `${name} names ${path}`);
    }
  }
});

test('the flags the skills pass are ones the scripts take', () => {
  const recommend = read('scripts/recommend.mjs');
  const options = recommend.slice(recommend.indexOf('parseArgs({'), recommend.indexOf('} catch', recommend.indexOf('parseArgs({')));
  const cli = new Set([...options.matchAll(/^\s+'?([\w-]+)'?: \{ type:/gm)].map(m => `--${m[1]}`));
  assert.ok(cli.has('--gaps') && cli.has('--more-like'));
  const shoot = new Set(read('dev/shoot.mjs').match(/const USAGE = [\s\S]*?;\n/)[0].match(/--[\w-]+/g));
  const others = new Set(['--import', '--journal', '--bind']); // node's, init.mjs's, http.server's
  const flags = text => new Set(text.match(/(?<![\w-])--[a-z][\w-]*/g));
  for (const flag of flags(skill('buy-advice').text)) assert.ok(cli.has(flag), `buy-advice passes ${flag} to recommend.mjs`);
  for (const flag of flags(skill('ui-check').files)) assert.ok(cli.has(flag) || shoot.has(flag) || others.has(flag), `ui-check passes ${flag}`);
});

test("the gallery shoots ui-check's table, waiting on classes the templates draw", () => {
  const { text, files } = skill('ui-check');
  const table = [...text.matchAll(/^\| [^|]+ \| `(#\/[^`]+)`[^|]* \| `([^`]+)` \|$/gm)].map(([, route, wait]) => ({ route, wait }));
  const gallery = [...read('.claude/skills/ui-check/gallery.sh').matchAll(/^ {2}'(\w+)\|([^|]+)\|([^']+)'$/gm)].map(([, , route, wait]) => ({ route, wait }));
  assert.ok(gallery.length >= 10);
  assert.deepEqual(gallery, table);
  const src = readdirSync(new URL('src/', root), { recursive: true }).filter(f => f.endsWith('.js')).map(f => read(`src/${f}`)).join('\n');
  // --wait .pick, "wait for `.wish-reasons`", and the table's
  const waits = [...files.matchAll(/--wait '?([.#][^'\s]+)/g), ...files.matchAll(/wait (?:for|on) `([.#][^`]+)`/g), ...table.map(t => [, t.wait])];
  const classes = new Set(waits
    .flatMap(([, sel]) => sel.match(/\.[\w-]+/g) ?? []).map(c => c.slice(1)));
  for (const name of classes) assert.match(src, new RegExp(`(?<![\\w-])${name}(?![\\w-])`), `src/ draws .${name}`);
});

test('no skill points at the sweep notes, which git leaves out', () => {
  // Spelled apart so test/docs.test.js's own scan doesn't find it here.
  const notes = new RegExp(`\\.${'sweep'}/|shell${'-'}map`);
  for (const { name, files } of skills) assert.doesNotMatch(files, notes, name);
});
