// Discover in the terminal (scripts/recommend.mjs --style, --notes,
// --more-like, --dupes). Each run is a process of its own, so they run side
// by side, and this file apart from discover.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/recommend.mjs', import.meta.url));
const cli = (...args) => new Promise(resolve => {
  execFile(process.execPath, [script, ...args], { encoding: 'utf8' }, (err, stdout, stderr) => resolve({ status: err ? err.code ?? 1 : 0, stdout, stderr }));
});

test('the CLI answers Discover questions', async () => {
  const [style, notes, vanila, lavendar, rated, like, dupes, bad, lean, top0, and, comma, likeComma, liked] = await Promise.all([
    cli('--style', 'skin scent,clean', '--all', '--top', '5', '--json'),
    cli('--notes', 'iris leather', '--season', 'winter', '--slot', 'night', '--lean', 'masculine', '--min-value', '3', '--json'),
    cli('--notes', 'vanila', '--top', '2'),
    cli('--notes', 'lavendar', '--top', '2'),
    cli('--style', 'skin', '--top', '3', '--min-rating', '4.2', '--json'),
    cli('--more-like', 'Liquid Brun,Amber Empire', '--top', '3'),
    cli('--dupes', 'Aventus'),
    cli('--style', 'wet dog'),
    cli('--notes', 'iris', '--lean', 'manly'),
    cli('--style', 'skin', '--top', '0'),
    cli('--notes', 'and'),
    cli('--style', ','),
    cli('--more-like', ','),
    // "liked" falls back to the wardrobe's own mix when none of the loved styles is left.
    cli('--style', 'liked', '--top', '2', '--exclude', 'Sandalwood & Musk,Meant To Be Seen,Cedrus Blanc,Jake,Shiyaaka Sky'),
  ]);
  const styled = JSON.parse(style.stdout);
  assert.deepEqual([styled.styles, styled.mode, styled.results.length], [['skin', 'clean'], 'all', 5]);
  assert.ok(styled.results.every(r => (r.styles.includes('Skin scent') || r.styles.includes('Clean')) && r.why));
  assert.ok(styled.results.every(r => Array.isArray(r.twins) && 'smellsLike' in r));
  const found = JSON.parse(notes.stdout);
  assert.equal(found.results.length, 10);
  assert.ok(found.results.every(r => r.value >= 3 && r.matched.length === 2));
  assert.match(vanila.stderr, /did you mean "vanilla"/);
  assert.match(lavendar.stderr, /Reading "lavendar" as "lavender"/);
  assert.match(rated.stdout, /"rating": 4\.[2-9]/);
  assert.match(like.stdout, /^More like Liquid Brun \+ Amber Empire:\n 1\. .+ · .+ · \d{4} · \d\.\d\d★ · value \d\.\d · Shares /);
  assert.match(dupes.stdout, /Smells like it for far less:\n {2}Club de Nuit Intense Man · Armaf/);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /No style called "wet dog"/);
  assert.match(lean.stderr, /--lean takes feminine, unisex, masculine/);
  // Nothing to ask about fails plainly rather than printing an empty list.
  assert.match(top0.stderr, /--top takes 1 or more/);
  assert.match(and.stderr, /Name a note or accord/);
  assert.match(comma.stderr, /Name a style/);
  assert.match(likeComma.stderr, /Name a bottle/);
  assert.match(liked.stdout, /^More \S/);
});

test('--styles, --more-like and --dupes find a bottle as --check does: the famous one, not a 0-vote namesake', async () => {
  const [styles, dupes] = await Promise.all([cli('--styles', 'Baccarat Rouge', '--json'), cli('--dupes', 'ombre leather', '--json')]);
  assert.deepEqual([JSON.parse(styles.stdout).name, JSON.parse(styles.stdout).brand], ['Baccarat Rouge 540', 'Maison Francis Kurkdjian']);
  const family = JSON.parse(dupes.stdout);
  assert.equal(family.brand, 'Tom Ford');
  assert.ok(family.cheaper.length + family.siblings.length > 0, 'it has smells-like votes');
});
