import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { loadPool, fromPool } from '../src/fragrantica.js';
import { customRecord } from '../src/custom.js';
import { ACCORD_SHARE, scentVector, similarity, centroid, sharedTraits, nearestOf } from '../src/similar.js';

const dir = new URL('../data/fragrantica/', import.meta.url);
const pool = await loadPool(async path => {
  const file = new URL(path, dir);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
});
const inPool = id => fromPool(pool, pool.index.get(String(id)));
const wardrobe = JSON.parse(readFileSync(new URL('../data/collection.json', import.meta.url))).fragrances;
const owned = name => wardrobe.find(f => f.name === name);

const liquidBrun = inPool(94713), althair = inPool(84109), atlantis = inPool(113595);
const cdnim = inPool(34696), aventus = inPool(9828), sauvage = inPool(31861), angel = inPool(704);

test('dupes score high, different directions low', () => {
  assert.ok(similarity(liquidBrun, althair) > 0.85, `Liquid Brun–Althaïr ${similarity(liquidBrun, althair)}`);
  assert.ok(similarity(cdnim, aventus) > 0.7, `CDNIM–Aventus ${similarity(cdnim, aventus)}`);
  assert.ok(similarity(atlantis, liquidBrun) < 0.25, `Atlantis–Liquid Brun ${similarity(atlantis, liquidBrun)}`);
  assert.ok(similarity(sauvage, angel) < 0.15, `Sauvage–Angel ${similarity(sauvage, angel)}`);
});

test('similarity is symmetric, within 0..1, and 1 for a bottle with itself', () => {
  const sample = Array.from({ length: 120 }, (_, k) => fromPool(pool, (k * 7919) % pool.count));
  for (let i = 0; i < sample.length; i++) {
    const a = sample[i], b = sample[(i * 31 + 5) % sample.length];
    const ab = similarity(a, b);
    assert.ok(ab >= 0 && ab <= 1 + 1e-9, `${a.name}–${b.name} ${ab}`);
    assert.ok(Math.abs(ab - similarity(b, a)) < 1e-12);
    assert.ok(Math.abs(similarity(a, a) - 1) < 1e-9, a.name);
  }
});

test('an owned bottle matches its own pool row: notes compare on the pool’s footing', () => {
  for (const f of wardrobe) {
    const i = pool.index.get(String(f.id));
    if (i == null) continue;
    assert.ok(similarity(f, fromPool(pool, i)) > 0.9, f.name);
  }
});

test('vectors are cached per record and pass through', () => {
  const v = scentVector(liquidBrun);
  assert.equal(scentVector(liquidBrun), v);
  assert.equal(scentVector(v), v);
  assert.ok(v.notes.size <= 8 && v.acc.size > 0);
  assert.ok(Math.abs([...v.acc.values()].reduce((s, x) => s + x * x, 0) - 1) < 1e-9, 'unit');
});

test('a bottle without notes compares on accords alone', () => {
  const mine = customRecord({ name: 'Mine', accords: ['vanilla', 'sweet', 'warm spicy', 'amber'] });
  const x = scentVector(mine), y = scentVector(liquidBrun);
  assert.equal(x.notes.size, 0);
  let acc = 0;
  for (const [k, w] of x.acc) acc += w * (y.acc.get(k) ?? 0);
  assert.ok(Math.abs(similarity(mine, liquidBrun) - acc) < 1e-12);
  assert.ok(similarity(mine, liquidBrun) > similarity(mine, atlantis));
  assert.equal(ACCORD_SHARE, 0.6);
});

test('a centroid sits between what it was made of', () => {
  const both = centroid([owned('Liquid Brun'), owned('Amber Empire')]);
  assert.ok(similarity(both, owned('Liquid Brun')) > similarity(both, atlantis));
  assert.ok(similarity(both, owned('Amber Empire')) > similarity(both, atlantis));
  assert.ok(Math.abs(similarity(centroid([liquidBrun]), liquidBrun) - 1) < 1e-9);
  // Weights pull it toward one side.
  const leaning = centroid([liquidBrun, atlantis], [3, 1]);
  assert.ok(similarity(leaning, liquidBrun) > similarity(leaning, atlantis));
});

test('shared traits name what two bottles have in common, strongest first', () => {
  const shared = sharedTraits(liquidBrun, althair);
  assert.ok(shared.length <= 4 && shared.length >= 3);
  assert.ok(shared.some(t => t.includes('vanilla')), shared.join(', '));
  assert.equal(new Set(shared.map(t => t.split(' ').pop().replace(/[eys]+$/, ''))).size, shared.length, 'one name per thing');
  assert.deepEqual(sharedTraits(liquidBrun, althair, 2), shared.slice(0, 2));
  assert.ok(!sharedTraits(sauvage, angel).includes('vanilla'));
});

test('nearestOf finds the closest of a list', () => {
  const list = wardrobe.map(f => scentVector(f));
  const { index, sim } = nearestOf(althair, list);
  assert.equal(wardrobe[index].name, 'Liquid Brun');
  assert.ok(sim > 0.85);
  assert.deepEqual(nearestOf(althair, []), { index: -1, sim: 0 });
});
