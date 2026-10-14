import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fromFragrantica, fragranticaLibrary, loadPool, fromPool, brandCase, noteCase } from '../src/fragrantica.js';
import { performanceRating, steadyShares } from '../src/engine.js';
import { DATASET_VERSION } from '../src/profiles.js';
import { nameMatches } from '../src/collections.js';

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

test('a famous bottle leads its 0-vote namesakes, whatever year the dataset puts after its name', async () => {
  const first = async q => (await library.search(q))[0];
  assert.deepEqual([(await first('ombre leather')).name, (await first('ombre leather')).brand], ['Ombré Leather (2018)', 'Tom Ford']);
  assert.equal((await first('baccarat rouge')).name, 'Baccarat Rouge 540', 'Nish Parfum’s clone named Baccarat Rouge follows');
  assert.equal((await first('opium')).name, 'Opium (1977)', 'the whole name typed leads Black Opium');
  assert.equal((await first('khamrah')).name, 'Khamrah');
  // A pasted list ticks the hit whose name was typed: the famous one.
  for (const [q, brand] of [['ombre leather', 'Tom Ford'], ['opium', 'Yves Saint Laurent']]) {
    assert.equal((await library.search(q)).find(h => nameMatches(q, h))?.brand, brand, q);
  }
});

test('notes written in lowercase read in title case, in records and the built wardrobe', () => {
  assert.deepEqual(['oak moss', 'elemi', 'ylang-ylang', 'fleur de sel', 'Tonka Bean', 'iso E Super'].map(noteCase),
    ['Oak Moss', 'Elemi', 'Ylang-Ylang', 'Fleur de Sel', 'Tonka Bean', 'iso E Super']);
  const lower = r => Object.values(r.notes ?? {}).flat().filter(n => n === n.toLowerCase());
  const rows = Object.entries(JSON.parse(readFileSync(new URL('r/0.json', dir)))).map(([id, row]) => fromFragrantica(id, row));
  assert.deepEqual(rows.flatMap(lower), []);
  for (const r of rows) for (const n of Object.keys(r.noteVotes ?? {})) assert.ok(Object.values(r.notes).flat().includes(n), `${r.name}: ${n}`);
  assert.deepEqual(wardrobe.flatMap(lower), [], 'npm run build:data writes them so');
});

test('brands written in capitals read in title case, as the build writes them; short acronyms stay', async () => {
  assert.deepEqual(['MAISON ASRAR', 'PARIS CORNER', 'ALREHAB PERFUMES', 'D’ORSAY', 'BDK Parfums', 'YSL', 'ZARA', 'Lattafa'].map(brandCase),
    ['Maison Asrar', 'Paris Corner', 'Alrehab Perfumes', 'D’Orsay', 'BDK Parfums', 'YSL', 'ZARA', 'Lattafa']);
  // The wardrobe's, a dataset record's, its pool row's and a search hit's agree.
  const legacy = wardrobe.find(f => f.name === 'Legacy');
  assert.equal(legacy.brand, 'Maison Asrar');
  assert.equal((await library.records([String(legacy.id)])).get(String(legacy.id)).brand, 'Maison Asrar');
  const pool = await loadPool(async path => {
    const file = new URL(path, dir);
    return existsSync(file) ? readFileSync(file, 'utf8') : null;
  });
  const choco = fromPool(pool, pool.cols.n.findIndex((n, i) => n === 'Choco Musk' && pool.brands[pool.cols.b[i]] === 'ALREHAB PERFUMES'));
  assert.equal(choco.brand, 'Alrehab Perfumes');
  assert.ok(choco.url.includes('/perfume/'), 'its page link keeps Fragrantica’s slug');
  assert.ok((await library.search('choco musk alrehab')).some(h => h.brand === 'Alrehab Perfumes'));
  assert.ok(wardrobe.every(f => f.brand === brandCase(f.brand)));
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

test('season and day/night votes steady on their own when a row has only one', () => {
  const row = { s: 'X/Y', n: 'Y', b: 'X', a: { woody: 100, amber: 80 } };
  const nightOnly = fromFragrantica('1', { ...row, v: [0, 0, 0, 0, 0, 3] });
  assert.equal(nightOnly.seasonVotes, undefined);
  assert.deepEqual(nightOnly.timeVotes, { day: 0, night: 3 });
  assert.equal(nightOnly.dayNight.night, 1, 'the raw split');
  assert.ok(steadyShares(nightOnly).dayNight.night < 0.85, 'three votes barely count');
  assert.equal(steadyShares(nightOnly).season, nightOnly.season, 'the season estimate passes through');
  const seasonOnly = fromFragrantica('2', { ...row, v: [2, 0, 0, 0, 0, 0] });
  assert.equal(seasonOnly.timeVotes, undefined);
  assert.ok(steadyShares(seasonOnly).season.winter < 0.9);
  assert.equal(steadyShares(seasonOnly).dayNight, seasonOnly.dayNight);
});

test('a library file the server won’t give fails as a sentence without its status code', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response('busy', { status: 503 });
  try {
    await assert.rejects(fragranticaLibrary().search('sauvage'), err => err.message === 'The fragrance library didn’t load. Try again.' && err.detail === 'HTTP 503');
  } finally {
    globalThis.fetch = real;
  }
});
