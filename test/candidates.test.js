import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { loadPool, fromPool, fragranticaLibrary, loadAbout } from '../src/fragrantica.js';
import { customRecord } from '../src/custom.js';
import {
  FAMILY_MULT, MIN_RATING, poolRowOf, signalsOf, genderLean, leanWindow, allowContext, allow, poolNorms, candidateQuality,
  valueSlope, preferValueDefault, familyIndex, ownedVectors, novelty, cheaperTwin, riskOf, reachMult,
} from '../src/candidates.js';

const dir = new URL('../data/fragrantica/', import.meta.url);
const load = async path => {
  const file = new URL(path, dir);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
};
const pool = await loadPool(load);
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
    const { clones, owners, ...mine } = signalsOf(f), { clones: none, owners: about, ...row } = signalsOf(at(f.id));
    assert.deepEqual(mine, row, f.name);
    // The pool keeps owners to a quarter of a doubling.
    assert.ok(Math.abs(about / owners - 1) < 0.1, `${f.name}: ${owners} owners, ${about} in the pool`);
    assert.deepEqual(none, []);
    compared++;
  }
  assert.ok(compared >= 18);
  assert.ok(signalsOf(owned('Liquid Brun')).clones.length, 'owned records carry clones');
  assert.equal(signalsOf(at(9828)).alt[0], '34696', 'ids as strings');
});

test('a bottle the dataset lacks has no signals, and reads as unknown', () => {
  const mine = customRecord({ name: 'Mine', accords: ['vanilla', 'amber'] });
  const s = signalsOf(mine, byId);
  assert.equal(s.known, false);
  assert.equal(s.value, null);
  assert.deepEqual([s.like, s.family, s.alt, s.flags], [[], [], [], []]);
  assert.deepEqual(riskOf(mine), { level: 'unknown', reasons: ['There’s no crowd data on it yet.'], major: false });
  assert.equal(genderLean(mine), 0);
  assert.equal(genderLean({ ...mine, gender: 'men' }), 0.68);
  // Without signals, Hawas Atlantis would pass for a safe buy.
  assert.equal(riskOf({ ...at(112309), extras: undefined }).level, 'unknown');
});

test('about data stands in for the pool’s signals', () => {
  for (const f of [...wardrobe, ...brooke]) {
    const about = signalsOf({ id: 'x', about: f.about }), x = signalsOf(f);
    assert.ok(Math.abs(about.value - x.value) <= 0.011, `${f.name} value ${about.value} ${x.value}`);
    assert.deepEqual([about.lean, about.flags, about.like], [x.lean, x.flags, x.like], f.name);
    assert.ok(about.family.every(id => x.family.includes(id)) && about.family.length >= x.family.length - 1, f.name);
  }
  const sauvage = { ...at(31861), extras: undefined, about: owned('Sauvage').about };
  assert.equal(riskOf(sauvage).level, 'medium', 'polarizing, from its about flags');
});

test('a visitor’s bottles from r/ read their signals from the pool, else their about data', async () => {
  const library = fragranticaLibrary(load);
  for (const built of [wardrobe, brooke]) {
    const loaded = await library.records(built.map(f => String(f.id)));
    const plain = built.map(f => loaded.get(String(f.id)));
    assert.ok(plain.every(r => r && !r.extras));
    const visitor = await Promise.all(plain.map(async r => (byId.has(r.id) ? r : { ...r, about: await loadAbout(r.id, load) })));
    assert.deepEqual(leanWindow(visitor, undefined, byId), leanWindow(built));
    assert.ok(Math.abs(valueSlope(visitor, norms, byId) - valueSlope(built, norms)) < 0.005);
    assert.equal(preferValueDefault(visitor, byId), preferValueDefault(built));
    const theirs = familyIndex(byId, visitor), ours = familyIndex(byId, built);
    if (built === brooke) assert.ok(records.every(r => theirs.dupeOf(r)?.kind === ours.dupeOf(r)?.kind));
    // r/ has no curated originals: voters' links make Absolu Aventus a twin of Supremacy CE instead.
    else assert.deepEqual([theirs.dupeOf(at(84112)).kind, ours.dupeOf(at(84112)).kind], ['near', 'original']);
  }
  const plain = [...(await library.records(brooke.map(f => String(f.id)))).values()];
  assert.ok(leanWindow(plain)[1] < 0.5, 'without the pool, her unisex labels say little');
  assert.ok(leanWindow(plain, undefined, byId)[1] > 0.7);
});

test('an owned bottle under another id is its pool row', () => {
  const aventus = { ...at(9828), id: 'fg:creed-aventus', extras: undefined, source: 'fragella' };
  assert.equal(poolRowOf(aventus, byId), at(9828));
  assert.equal(signalsOf(aventus, byId), signalsOf(at(9828)));
  assert.equal(allow(at(9828), allowContext([aventus], { byId })), false);
  assert.equal(familyIndex(byId, [aventus]).dupeOf(at(9828)).kind, 'owned');
  assert.equal(familyIndex(byId, [aventus]).dupeOf(at(34696)).kind, 'near');
  // Hand-entered without a brand: a name alone doesn't make it a pool bottle.
  assert.equal(poolRowOf(customRecord({ name: 'Aventus', accords: ['fruity'] }), byId), null);
  assert.equal(poolRowOf(customRecord({ name: 'Aventus', brand: 'Creed', accords: ['fruity'] }), byId), at(9828));
  assert.equal(poolRowOf({ id: '999999999', name: 'Aventus', brand: 'Creed' }, byId), null, 'another dataset bottle');
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
  const kinds = {};
  for (const r of records) {
    const kind = family.dupeOf(r)?.kind;
    kinds[kind] = (kinds[kind] ?? 0) + 1;
  }
  assert.deepEqual([kinds.near, kinds.family], [family.near, family.family], 'counts as placed');
});

test('novelty measures against owned bottles and their originals’ pool rows', () => {
  const vecs = ownedVectors(wardrobe, byId);
  assert.equal(vecs.length, wardrobe.length + wardrobe.filter(f => f.original).length);
  assert.ok(vecs.every(v => v.vector.acc.size), 'originals compare by their pool rows');
  const supremacy = owned("Supremacy Collector's Edition Pour Homme");
  const absolu = novelty(at(84112), vecs, family);
  assert.equal(absolu.nearest.via, supremacy);
  assert.ok(absolu.sim > 0.99 && absolu.mult < 0.1);
  const cdnim = novelty(at(34696), vecs, family);
  assert.equal(cdnim.dupe.kind, 'family');
  assert.ok(cdnim.mult <= 0.6 && cdnim.mult > 0.3, `${cdnim.mult}`);
  const angel = novelty(at(704), vecs, family);
  assert.equal(angel.dupe, null);
  assert.ok(angel.mult > 0.9 && angel.sim < 0.65, `${angel.sim}`);
  assert.equal(novelty(at(704), [], family).mult, 1);
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
  assert.ok(allowContext(wardrobe).owned.size === wardrobe.length);
  assert.ok(allow(at(34696), allowContext(wardrobe.slice(0, 2))));
});

test('quality counts rating, keeping and value, and value counts more for a clone buyer', () => {
  assert.ok(Math.abs(norms.rating - 4.02) < 0.05 && Math.abs(norms.value - 3.0) < 0.2, JSON.stringify(norms));
  const david = valueSlope(wardrobe, norms), hers = valueSlope(brooke, norms);
  assert.ok(david > 0.15 && david <= 0.25, `David ${david}`);
  assert.ok(hers < 0.1, `Brooke ${hers}`);
  assert.equal(preferValueDefault(wardrobe), true);
  assert.equal(preferValueDefault(brooke), false);
  // One bottle says nothing about how someone buys.
  assert.equal(valueSlope([at(34696)], norms), valueSlope([], norms));
  assert.equal(preferValueDefault([at(34696), at(34696)]), false);
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

test('body mists stay out of suggestions unless asked for, and so does reach, a little', () => {
  const ctx = allowContext(wardrobe, { byId });
  const mists = records.filter(r => r.extras.flags.includes('mist'));
  assert.ok(mists.length >= 50 && mists.length <= 150, `${mists.length} mists`);
  for (const id of ['87258', '112348', '43933']) assert.ok(at(id).extras.flags.includes('mist'), at(id).name); // Phlur Vanilla Skin Fragrance Mist, Book Loft, Sauvage Very Cool Spray
  for (const id of ['496', '1281', '72665']) assert.ok(!at(id).extras.flags.includes('mist'), at(id).name); // Cashmere Mist, Iris Silver Mist, Missing Person
  const loft = at('112348');
  assert.equal(allow(loft, { ...ctx, minRating: 0 }), false);
  assert.equal(allow(loft, { ...allowContext(wardrobe, { byId, mists: true }), minRating: 0 }), true);
  // Reach: Granado's Íris and Phebo's Entrelaço have fans of their own; Sauvage EDP's like the world's best sellers.
  assert.ok(at('96622').extras.reach < 0.1 && at('105693').extras.reach < 0.1 && at('48100').extras.reach > 0.9);
  assert.equal(reachMult(null), 1);
  assert.equal(reachMult(0.85), 1);
  assert.ok(Math.abs(reachMult(0) - 0.8) < 1e-12 && reachMult(0.2) > 0.8 && reachMult(0.2) < 1);
  const q = r => candidateQuality(r, norms).mult;
  assert.ok(Math.abs(q(at('96622')) / q({ ...at('96622'), extras: { ...at('96622').extras, reach: 0.85 } }) - 0.8) < 1e-9);
  // The pool keeps owners to a quarter of a doubling.
  for (const r of [at('48100'), at('96622'), loft]) assert.ok(r.extras.owners > 400 && r.extras.owners < 40000, r.name);
});

test('a cheaper twin is a real, better-value clone', () => {
  const twin = cheaperTwin(at(9828), byId);
  assert.equal(twin.record.name, 'Club de Nuit Intense Man');
  assert.ok(twin.value >= signalsOf(at(9828)).value + 1);
  assert.match(twin.text, /^Club de Nuit Intense Man by Armaf smells like it/);
  assert.equal(cheaperTwin(at(84109), byId).record.name, 'Liquid Brun', 'Althaïr');
  assert.equal(cheaperTwin(at(34696), byId), null, 'already the cheap one');
  // David owns Althaïr's twin.
  const ctx = allowContext(wardrobe, { byId });
  assert.deepEqual([cheaperTwin(at(84109), byId, ctx).owned, cheaperTwin(at(84109), byId, ctx).text], [true, 'You own its twin, Liquid Brun.']);
  assert.equal(cheaperTwin(at(9828), byId, ctx).owned, false);
  for (const r of records) {
    const twin = cheaperTwin(r, byId);
    if (twin) assert.ok(twin.record.rating >= MIN_RATING, `${r.name}: ${twin.record.name} ${twin.record.rating}`);
  }
});

test('risk names what makes a blind buy risky', () => {
  const hawas = riskOf(at(112309));
  assert.equal(hawas.level, 'high');
  assert.ok(hawas.reasons.some(r => r.includes('divides')) && hawas.reasons.some(r => r.includes('blind buy')));
  const sauvage = riskOf(at(31861));
  assert.equal(sauvage.level, 'medium', 'polarizing');
  assert.ok(riskOf(at(28286)).reasons.some(r => r.includes('voting campaign')));
  assert.deepEqual(riskOf(at(9828)), { level: 'low', reasons: ['Reviewers say it was reformulated.'], major: false });
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
