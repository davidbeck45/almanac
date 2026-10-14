import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { loadPool, fromPool } from '../src/fragrantica.js';
import { customRecord } from '../src/custom.js';
import {
  FAMILY_MULT, signalsOf, genderLean, leanWindow, allowContext, allow, poolNorms, candidateQuality,
  valueSlope, preferValueDefault, familyIndex, cheaperTwin, riskOf,
} from '../src/candidates.js';

const dir = new URL('../data/fragrantica/', import.meta.url);
const pool = await loadPool(async path => {
  const file = new URL(path, dir);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
});
const records = Array.from({ length: pool.count }, (_, i) => fromPool(pool, i));
const byId = new Map(records.map(r => [r.id, r]));
const built = stem => JSON.parse(readFileSync(new URL(`../data/${stem}.json`, import.meta.url))).fragrances;
const wardrobe = built('collection'), brooke = built('catalog');
const owned = name => wardrobe.find(f => f.name === name);
const at = id => byId.get(String(id));
const norms = poolNorms(records);
const family = familyIndex(byId, wardrobe);

test('signals read the same from an owned record and its pool row', () => {
  let compared = 0;
  for (const f of wardrobe) {
    if (!byId.has(String(f.id))) continue;
    const { clones, ...mine } = signalsOf(f), { clones: none, ...row } = signalsOf(at(f.id));
    assert.deepEqual(mine, row, f.name);
    assert.deepEqual(none, []);
    compared++;
  }
  assert.ok(compared >= 18);
  assert.ok(signalsOf(owned('Liquid Brun')).clones.length, 'owned records carry clones');
  assert.equal(signalsOf(at(9828)).alt[0], '34696', 'ids as strings');
});

test('a bottle the dataset lacks has no signals, and reads as unknown', () => {
  const mine = customRecord({ name: 'Mine', accords: ['vanilla', 'amber'] });
  const s = signalsOf(mine);
  assert.equal(s.known, false);
  assert.equal(s.value, null);
  assert.deepEqual([s.like, s.family, s.alt, s.flags], [[], [], [], []]);
  assert.deepEqual(riskOf(mine), { level: 'low', reasons: [] });
  assert.equal(genderLean(mine), 0);
  assert.equal(genderLean({ ...mine, gender: 'men' }), 0.68);
  assert.equal(signalsOf(mine), signalsOf(mine), 'cached');
});

test('voters’ links mark twins, originals, versions and family of what David owns', () => {
  const supremacy = owned("Supremacy Collector's Edition Pour Homme");
  // Absolu Aventus 2023 is the original of his Supremacy CE.
  const original = family.dupeOf(at(84112));
  assert.equal(original.kind, 'original');
  assert.equal(original.mult, FAMILY_MULT.original);
  assert.equal(original.via, supremacy);
  // Aventus is a twin of that original; Club de Nuit Intense Man a twin of Aventus.
  assert.equal(family.dupeOf(at(9828)).kind, 'near');
  const cdnim = family.dupeOf(at(34696));
  assert.equal(cdnim.kind, 'family');
  assert.equal(cdnim.mult, 0.6);
  assert.equal(cdnim.via, supremacy);
  assert.match(cdnim.text, /through Aventus$/);
  // His own bottle, a twin of it, a version of it, and a stranger.
  assert.equal(family.dupeOf(at(94713)).kind, 'owned');
  assert.equal(family.dupeOf(at(94713)).mult, 0);
  assert.equal(family.dupeOf(at(123526)).text, 'Voters call it a twin of your Liquid Brun');
  const elixir = records.find(r => r.brand === 'Dior' && r.name === 'Sauvage Elixir');
  assert.deepEqual([family.dupeOf(elixir).kind, family.dupeOf(elixir).mult], ['flanker', 0.3]);
  const noir = records.find(r => r.brand === 'Afnan' && r.name === 'Supremacy Noir');
  assert.notEqual(family.dupeOf(noir)?.kind, 'flanker', 'a version that smells different is a new direction');
  assert.equal(family.dupeOf(at(704)), null, 'Angel');
  assert.ok(family.near > 50 && family.near < 200 && family.family > 50 && family.family < 300, `${family.near} near, ${family.family} family`);
});

test('a bottle outside the pool is placed by its own links', () => {
  // As if loaded from r/ with signals but no id anyone links to.
  assert.equal(family.dupeOf({ ...at(34696), id: 'x1' })?.kind, 'family', 'its family has Aventus');
  assert.equal(family.dupeOf({ ...at(123526), id: 'x2' })?.kind, 'near', 'its family has Liquid Brun');
  assert.equal(family.dupeOf({ ...at(704), id: 'x3' }), null);
});

test('suggestions leave out owned bottles, originals, brigaded ones, low ratings and other leans', () => {
  const ctx = allowContext(wardrobe);
  assert.equal(allow(at(28286), ctx), false, 'SpongeBob is brigaded');
  assert.equal(allow(at(94713), ctx), false, 'Liquid Brun is owned');
  assert.equal(allow(at(84112), ctx), false, 'Absolu Aventus 2023 is an owned dupe’s original');
  assert.equal(allow(at(112309), ctx), false, 'Hawas Atlantis rates 3.3');
  assert.equal(allow(at(34696), ctx), true, 'Club de Nuit Intense Man passes; the family index marks it down');
  assert.equal(allow(at(9828), allowContext(wardrobe, { minValue: 3.8 })), false, 'Aventus is poor value');
  // David owns crowd-feminine and masculine bottles; Brooke's lean feminine.
  const [lo, hi] = ctx.lean;
  assert.ok(lo <= genderLean(owned('Cream Velvet')) - 0.2 && hi === 1, `${lo}..${hi}`);
  assert.equal(allow(at(34696), allowContext(brooke)), false, 'too masculine for Brooke');
  assert.deepEqual(leanWindow(wardrobe.slice(0, 2)), [-1, 1], 'too few bottles to say');
  assert.ok(allow(at(34696), allowContext(wardrobe.slice(0, 2))));
});

test('quality counts rating, keeping and value, and value counts more for a clone buyer', () => {
  assert.ok(Math.abs(norms.rating - 4.02) < 0.05 && Math.abs(norms.value - 3.0) < 0.2, JSON.stringify(norms));
  const david = valueSlope(wardrobe, norms), hers = valueSlope(brooke, norms);
  assert.ok(david > 0.15 && david <= 0.25, `David ${david}`);
  assert.ok(hers < 0.1, `Brooke ${hers}`);
  assert.equal(preferValueDefault(wardrobe), true);
  assert.equal(preferValueDefault(brooke), false);
  for (const r of records.slice(0, 500)) {
    const q = candidateQuality(r, norms, { valueSlope: david });
    assert.ok(q.mult >= 0.5 && q.mult <= 1.52, `${r.name} ${q.mult}`);
  }
  const cheap = candidateQuality(at(34696), norms, { valueSlope: david }).mult;
  const dear = candidateQuality(at(9828), norms, { valueSlope: david }).mult;
  assert.ok(cheap > dear, 'Club de Nuit Intense Man over Aventus for David');
  // Few votes lean on the pool's median rating.
  const few = { ...at(34696), extras: undefined, rating: 5, ratingVotes: 10 };
  assert.ok(candidateQuality(few, norms).rating < 4.05);
});

test('a cheaper twin is a real, better-value clone', () => {
  const twin = cheaperTwin(at(9828), byId);
  assert.equal(twin.record.name, 'Club de Nuit Intense Man');
  assert.ok(twin.value >= signalsOf(at(9828)).value + 1);
  assert.match(twin.text, /^Club de Nuit Intense Man by Armaf smells like it/);
  assert.equal(cheaperTwin(at(84109), byId).record.name, 'Liquid Brun', 'Althaïr');
  assert.equal(cheaperTwin(at(34696), byId), null, 'already the cheap one');
});

test('risk names what makes a blind buy risky', () => {
  const hawas = riskOf(at(112309));
  assert.equal(hawas.level, 'high');
  assert.ok(hawas.reasons.some(r => r.includes('divides')) && hawas.reasons.some(r => r.includes('blind buy')));
  const sauvage = riskOf(at(31861));
  assert.equal(sauvage.level, 'medium', 'polarizing');
  assert.ok(riskOf(at(28286)).reasons.some(r => r.includes('voting campaign')));
  assert.deepEqual(riskOf(at(9828)), { level: 'low', reasons: ['Reviewers say it was reformulated.'] });
  assert.equal(riskOf(at(34696)).level, 'low');
  const levels = { low: 0, medium: 0, high: 0 };
  for (const r of records) levels[riskOf(r).level]++;
  assert.ok(levels.high < 0.12 * records.length && levels.low > 0.6 * records.length, JSON.stringify(levels));
});

test('bottles with no lean at all leave the window to the rest', () => {
  const blank = customRecord({ name: 'Blank', accords: ['vanilla'] });
  assert.deepEqual(leanWindow([blank, blank, blank]), [-1, 1]);
  const men = [at(34696), at(9828), at(31861)];
  assert.deepEqual(leanWindow([...men, blank, blank]), leanWindow(men));
});
