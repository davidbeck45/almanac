import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACCORDS } from '../src/accords.js';
import { fitAccordWeights, bandedWeights, votedBottles, BAND } from '../scripts/fit-accords.mjs';

const load = f => JSON.parse(readFileSync(new URL(`../data/${f}.json`, import.meta.url))).fragrances;

test('every accord in the data has a weight and color', () => {
  const unknown = [...new Set(votedBottles().flatMap(f => Object.keys(f.accords)))]
    .filter(a => !ACCORDS[a]);
  assert.deepEqual(unknown, [], 'add these to src/accords.js (the engine ignores unknown accords)');
});

test('accord weights are fitted to the bottles in data/', () => {
  const fitted = fitAccordWeights(votedBottles());
  const stale = Object.entries(fitted)
    .filter(([a, w]) => Math.abs(ACCORDS[a].weight - w) > BAND)
    .map(([a, w]) => `${a} ${ACCORDS[a].weight} -> ${+w.toFixed(2)}`);
  assert.deepEqual(stale, [], 'the data changed since the last fit; run `npm run fit`');
});

test('a refit moves a weight only once its fit leaves the band, so one bottle more moves few', () => {
  const current = { a: 0.2, b: 0.2, c: -0.3 };
  assert.deepEqual(bandedWeights({ a: 0.136, b: 0.12, c: -0.3 }, current), { a: 0.2, b: 0.1, c: -0.3 }, 'within the band it stays; past it, the fit to 0.05');
  // Each voted bottle added to the weights the rest would settle on. Rounding alone moved
  // 4.7 weights a bottle (12 for Jean Lowe Summer Vibes with its Sun Song); the band, 0.3.
  const all = votedBottles(), full = fitAccordWeights(all);
  const weights = Object.fromEntries(Object.entries(ACCORDS).map(([a, m]) => [a, m.weight]));
  const moved = (x, y) => Object.keys(x).filter(a => Math.abs(x[a] - y[a]) > 1e-9).length;
  const adds = all.map(f => {
    const before = bandedWeights(fitAccordWeights(all.filter(g => g !== f)), weights);
    return moved(bandedWeights(full, before), before);
  });
  const mean = adds.reduce((s, n) => s + n, 0) / adds.length;
  assert.ok(mean <= 0.6 && Math.max(...adds) <= 5, `${mean.toFixed(2)} a bottle, at most ${Math.max(...adds)}`);
});
