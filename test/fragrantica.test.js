import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fromFragrantica, fragranticaLibrary } from '../src/fragrantica.js';
import { performanceRating, steadyShares } from '../src/engine.js';
import { DATASET_VERSION } from '../src/profiles.js';

const dir = new URL('../data/fragrantica/', import.meta.url);
const library = fragranticaLibrary(async path => {
  const file = new URL(path, dir);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
});
const wardrobe = JSON.parse(readFileSync(new URL('../data/collection.json', import.meta.url))).fragrances;
const sum = o => Object.values(o).reduce((a, b) => a + b, 0);

test('dataset records match the wardrobe we scraped ourselves', async () => {
  const records = await library.records(wardrobe.map(f => String(f.id)));
  assert.equal(records.size, wardrobe.length);
  const gaps = [];
  for (const f of wardrobe) {
    const r = records.get(String(f.id));
    assert.equal(r.url, f.url, f.name);
    assert.equal(r.gender, f.gender, f.name);
    for (const s of ['winter', 'spring', 'summer', 'fall']) assert.ok(Math.abs(r.season[s] - f.season[s]) < 0.03, `${f.name} ${s}`);
    assert.ok(Math.abs(r.dayNight.night - f.dayNight.night) < 0.03, f.name);
    for (const [a, w] of Object.entries(r.accords)) if (a in f.accords) gaps.push(Math.abs(w - f.accords[a]));
  }
  // Accord bars: the dataset's strengths, drawn as our extractor reads them
  // (a few drift as votes come in between scrapes).
  gaps.sort((a, b) => a - b);
  assert.ok(gaps[gaps.length >> 1] <= 1, `median gap ${gaps[gaps.length >> 1]}`);
  assert.ok(gaps[Math.floor(gaps.length * 0.9)] <= 3, `90th percentile gap ${gaps[Math.floor(gaps.length * 0.9)]}`);
});

test('search finds a bottle by brand and name, whole names first', async () => {
  const [top] = await library.search('Dior Sauvage');
  assert.equal(top.id, '31861');
  assert.equal(top.name, 'Sauvage');
  assert.ok(top.stub, 'results are light until loaded');
  assert.equal((await library.search('liquid brun'))[0].brand, 'French Avenue');
  const [terre] = await library.search('terre d’hermes');
  assert.equal(terre.name, 'Terre d\'Hermès', 'accents and apostrophes don’t matter');
  const [brx] = await library.search('MFK Baccarat Rouge 540');
  assert.equal(brx.name, 'Baccarat Rouge 540', 'a word the bottle lacks is forgiven when nothing has them all');
  assert.deepEqual(await library.search('qqqxzzv'), []);
  assert.deepEqual(await library.search('a'), []);
});

test('records load by id; ids the dataset lacks are left out', async () => {
  const found = await library.records(['31861', '999999999', 'fg:abc', 'my:x']);
  assert.deepEqual([...found.keys()], ['31861']);
  const sauvage = found.get('31861');
  assert.equal(sauvage.source, 'fragrantica');
  assert.ok(sauvage.ratingVotes > 30000);
  assert.ok(sauvage.notes.top.length && sauvage.noteVotes.Ambroxan > sauvage.noteVotes.Cedar);
  assert.ok(sauvage.like && Math.abs(sum(sauvage.like.season) - 1) < 0.01, 'smells-like neighbours’ votes');
});

test('a bottle nobody has voted on carries its accords’ estimate', () => {
  const r = fromFragrantica('1', { s: 'X/Y', n: 'Y', b: 'X', a: { citrus: 100, aquatic: 60, green: 40 } });
  assert.equal(r.seasonVotes, undefined);
  assert.ok(Math.abs(sum(r.season) - 1) < 0.01);
  assert.ok(r.season.summer + r.season.spring > 0.6, 'fresh accords lean warm');
  assert.equal(steadyShares(r), r, 'and passes through like other estimates');
});

test('Fragrantica longevity and sillage stand in for Parfumo’s on its scale', () => {
  const r = fromFragrantica('1', { s: 'X/Y', n: 'Y', b: 'X', a: { woody: 100 }, l: [4.2, 500], si: [3.1, 480] });
  const p = performanceRating(r);
  assert.equal(p.votes, 480);
  assert.ok(p.longevity > 8.5 && p.longevity < 9.5, `${p.longevity}`);
  assert.ok(p.sillage > 8.5 && p.sillage < 9.3, `${p.sillage}`);
  const both = { ...r, parfumo: { longevity: 6, sillage: 5, votes: 40 } };
  assert.equal(performanceRating(both).longevity, 6, 'Parfumo first');
});

test('accord profiles are fitted to this version of the dataset', () => {
  const meta = JSON.parse(readFileSync(new URL('meta.json', dir)));
  assert.equal(DATASET_VERSION, meta.version, 'run `node scripts/fit-profiles.mjs --write`');
});
