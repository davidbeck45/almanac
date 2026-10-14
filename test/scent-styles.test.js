import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { ACCORDS } from '../src/accords.js';
import { customRecord } from '../src/custom.js';
import { fragranticaLibrary } from '../src/fragrantica.js';
import { STYLES, STYLE_MIN, WEARS_CLOSE, styleScores, topOf, shownOf, leanOf, closeOf, topStyles, wearsClose, styleMix } from '../src/scent-styles.js';
import { EXEMPLARS, HOLDOUT } from './style-exemplars.js';

const dir = new URL('../data/fragrantica/', import.meta.url);
const library = fragranticaLibrary(async path => {
  const file = new URL(path, dir);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
});
const wardrobe = JSON.parse(readFileSync(new URL('../data/collection.json', import.meta.url))).fragrances;
const SCENT = STYLES.filter(s => s.kind === 'scent').map(s => s.id);

// A scent style counts when it's among the bottle's two best scent styles;
// Intimate when the bottle wears close.
function hitRate(set, records) {
  let hits = 0, total = 0;
  const misses = [];
  for (const [style, ids] of Object.entries(set)) {
    for (const id of ids) {
      const record = records.get(String(id));
      assert.ok(record, `id ${id} is in the dataset`);
      const scores = styleScores(record);
      const hit = style === 'intimate' ? closeOf(scores) : topOf(scores, 2, 0).some(s => s.id === style);
      total++;
      if (hit) hits++; else misses.push(`${record.name} (${style} ${scores[style]})`);
    }
  }
  return { rate: hits / total, misses };
}

const loadAll = async set => library.records([...new Set(Object.values(set).flat().map(String))]);
const shown = scores => topOf(scores).map(s => s.id);

test('canonical bottles show their style', async () => {
  const { rate, misses } = hitRate(EXEMPLARS, await loadAll(EXEMPLARS));
  assert.ok(rate >= 0.9, `top-2 rate ${rate.toFixed(3)}; misses: ${misses.join(', ')}`);
});

test('held-out bottles show their style', async () => {
  const { rate, misses } = hitRate(HOLDOUT, await loadAll(HOLDOUT));
  assert.ok(rate >= 0.8, `top-2 rate ${rate.toFixed(3)}; misses: ${misses.join(', ')}`);
});

test('soapy iris is Clean only when nothing warms it', async () => {
  const records = await library.records(['39029', '14840', '49696', '140083', '45668']);
  const scores = id => styleScores(records.get(id));
  assert.ok(topOf(scores('39029'), 2, 0).some(s => s.id === 'clean'), 'Prada L\'Homme');
  for (const id of ['14840', '49696', '140083']) {
    assert.ok(!shown(scores(id)).includes('clean'), `${records.get(id).name}: ${shown(scores(id)).join(', ')}`);
  }
  // A metallic milk is still a gourmand (Dent de Lait).
  assert.ok(shown(scores('45668')).includes('gourmand'), shown(scores('45668')).join(', '));
});

test('the wardrobe reads as David knows it', () => {
  const byName = name => wardrobe.find(f => f.name === name);
  const top = name => topStyles(byName(name), 2, 0).map(s => s.id);
  assert.equal(top('Cedrus Blanc')[0], 'clean');
  assert.ok(top('Sandalwood & Musk').includes('skin'), top('Sandalwood & Musk').join(', '));
  assert.ok(wearsClose(byName('Jake')));
  assert.equal(top('Cream Velvet')[0], 'vanilla');
  assert.equal(top('Atlantis Extrait')[0], 'aquatic');
  assert.equal(top('Infini Rose')[0], 'rose');
  assert.ok(!wearsClose(byName('Liquid Brun')), 'a loud gourmand is not intimate');
});

test('every accord the engine knows sits in some style', () => {
  const named = new Set(STYLES.flatMap(s => [...Object.keys(s.acc ?? {}), ...Object.keys(s.against ?? {})]));
  assert.deepEqual(Object.keys(ACCORDS).filter(a => !named.has(a)), [],
    'add these to a style\'s acc (it is that style) or against (it pulls away from one) in src/scent-styles.js');
  assert.deepEqual([...named].filter(a => !ACCORDS[a]), [], 'style tables name accords src/accords.js lacks');
});

test('scores are 0..1 for every style, top styles are scent styles from the threshold', () => {
  for (const f of wardrobe) {
    const scores = styleScores(f);
    assert.deepEqual(Object.keys(scores), STYLES.map(s => s.id));
    for (const v of Object.values(scores)) assert.ok(v >= 0 && v <= 1, `${f.name}: ${v}`);
    const top = topStyles(f);
    assert.ok(top.length <= 3);
    for (const s of top) assert.ok(SCENT.includes(s.id) && s.score >= STYLE_MIN, `${f.name}: ${s.id}`);
  }
});

test('a hand-entered bottle gets styles from its accords alone and never wears close', () => {
  const mine = customRecord({ name: 'My musk', accords: ['musky', 'powdery', 'woody'] });
  assert.equal(topStyles(mine)[0].id, 'skin');
  assert.ok(styleScores(mine).intimate < WEARS_CLOSE);
  assert.ok(!wearsClose(mine));
  assert.deepEqual(topStyles({ name: 'Empty', accords: {}, notes: {} }), []);
});

test('a bottle no style clears shows its nearest as a lean, from a tenth under the line', () => {
  const zero = Object.fromEntries(STYLES.map(s => [s.id, 0]));
  assert.deepEqual(shownOf({ ...zero, skin: 0.54, whiteFloral: 0.53 }), [{ id: 'skin', label: 'Leans skin scent', score: 0.54, leans: true }]);
  assert.deepEqual(shownOf({ ...zero, skin: 0.44 }), [], 'too far under says nothing');
  assert.deepEqual(shownOf({ ...zero, skin: 0.6, clean: 0.5 }), topOf({ ...zero, skin: 0.6, clean: 0.5 }), 'a clear style needs no lean');
  // Pages and Compare read topStyles, which leans the same way.
  const vetiver = { name: 'Vetiver', accords: { woody: 100, earthy: 70, citrus: 50 }, notes: {} };
  assert.deepEqual(topStyles(vetiver), shownOf(styleScores(vetiver)));
});

test('the rules read stored scores like live ones', () => {
  for (const f of wardrobe) {
    const scores = JSON.parse(JSON.stringify(styleScores(f)));
    assert.deepEqual(topOf(scores), topStyles(f));
    assert.equal(closeOf(scores), wearsClose(f));
  }
  const stored = new Map(wardrobe.map(f => [f.id, styleScores(f)]));
  assert.deepEqual(styleMix(wardrobe, f => stored.get(f.id)), styleMix(wardrobe));
});

test('the style mix counts each bottle\'s lean and the close wearers', () => {
  const mix = styleMix(wardrobe);
  assert.equal(mix.total, wardrobe.length);
  assert.equal(Object.values(mix.counts).reduce((a, b) => a + b, 0), wardrobe.reduce((n, f) => n + leanOf(styleScores(f)).length, 0));
  assert.ok(mix.counts.vanilla >= mix.counts.skin, 'the wardrobe leans warm and sweet');
  assert.ok(mix.ids.clean.includes(wardrobe.find(f => f.name === 'Cedrus Blanc').id));
  assert.equal(mix.intimate, mix.intimateIds.length);
  assert.ok(mix.intimateIds.includes(wardrobe.find(f => f.name === 'Jake').id));
});

test('scoring is fast enough to run over the dataset', async () => {
  const shards = Array.from({ length: 8 }, (_, i) => JSON.parse(readFileSync(new URL(`r/${i * 64}.json`, dir), 'utf8')));
  const ids = shards.flatMap(rows => Object.keys(rows));
  const records = [...(await library.records(ids)).values()];
  assert.ok(records.length > 1000);
  styleScores(records[0]);
  const start = performance.now();
  for (const r of records) styleScores(r);
  const perRecord = (performance.now() - start) / records.length;
  // About 10 µs in Node on a laptop; a generous bound for slow machines.
  assert.ok(perRecord < 0.1, `${(perRecord * 1000).toFixed(1)} µs per record`);
});
