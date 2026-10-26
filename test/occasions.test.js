import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { OCCASIONS, OCCASION_SCALE, occasionById } from '../src/occasions.js';
import { fitOccasionScale } from '../scripts/fit-occasions.mjs';
import { ACCORDS } from '../src/accords.js';
import { occasionRaw } from '../src/engine.js';

const dir = new URL('../data/', import.meta.url);
const all = readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'dupes.json')
  .flatMap(f => JSON.parse(readFileSync(new URL(f, dir))).fragrances);
const byName = name => all.find(f => f.name === name);

test('every common accord has an explicit entry in every occasion profile', () => {
  // An accord a profile leaves out counts as 0 but still dilutes the average,
  // so leaving one out should be a choice: 0 marks it considered and neutral.
  const strength = {};
  let total = 0;
  for (const f of all) for (const [a, s] of Object.entries(f.accords)) { strength[a] = (strength[a] ?? 0) + s; total += s; }
  const common = Object.keys(strength).filter(a => strength[a] / total > 0.015);
  assert.ok(common.length >= 15, common.join(', '));
  const missing = OCCASIONS.flatMap(o => common.filter(a => !(a in o.profile)).map(a => `${o.id}: ${a}`));
  assert.deepEqual(missing, []);
});

test('profiles only name accords the engine knows, within -1..1', () => {
  for (const o of OCCASIONS) {
    for (const [a, v] of Object.entries(o.profile)) {
      assert.ok(ACCORDS[a], `${o.id}: unknown accord ${a}`);
      assert.ok(v >= -1 && v <= 1, `${o.id}: ${a} ${v}`);
    }
  }
});

test('every occasion says how much of it is spent outside, a night in none of it', () => {
  // The engine's cold penalty and the spray guide's cold step both read it.
  for (const o of OCCASIONS) assert.ok(Number.isFinite(o.outside) && o.outside >= 0 && o.outside <= 1, `${o.id}: ${o.outside}`);
  assert.equal(occasionById('cozy').outside, 0);
  assert.equal(occasionById('outdoors').outside, 1);
  assert.ok(occasionById('office').outside < occasionById('date').outside && occasionById('date').outside < occasionById('nightout').outside);
});

test('an aquatic suits the office better than a boozy leather, on accords alone', () => {
  const accordsOnly = f => ({ ...f, parfumo: undefined, performance: undefined });
  const office = occasionById('office');
  assert.ok(occasionRaw(accordsOnly(byName('Atlantis Extrait')), office) > occasionRaw(accordsOnly(byName('CH Men Prive')), office));
  const cozy = occasionById('cozy');
  assert.ok(occasionRaw(accordsOnly(byName('Liquid Brun')), cozy) > occasionRaw(accordsOnly(byName('Essence de Blanc')), cozy));
});

test('the occasion scale is fitted to these profiles and this dataset', () => {
  const { scale } = fitOccasionScale();
  assert.deepEqual(OCCASION_SCALE, scale, 'run `node scripts/fit-occasions.mjs --write`');
});
