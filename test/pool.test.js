import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fromPool, fromFragrantica, loadPool, loadAbout, FLAGS } from '../src/fragrantica.js';
import { rank } from '../src/engine.js';
import { OCCASIONS } from '../src/occasions.js';

const dir = new URL('../data/fragrantica/', import.meta.url);
const load = async path => {
  const file = new URL(path, dir);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
};
const pool = await loadPool(load);
// Every id in r/, and the rows of an eighth of it (parsing all 512 files takes seconds).
const shardText = n => readFileSync(new URL(`r/${n}.json`, dir), 'utf8');
const inLibrary = new Set(Array.from({ length: 512 }, (_, n) => [...shardText(n).matchAll(/"(\d+)":\{"s":/g)].map(m => Number(m[1]))).flat());
const rows = Object.assign({}, ...Array.from({ length: 64 }, (_, n) => JSON.parse(shardText(n))));
const sample = pool.cols.id.flatMap((id, i) => (id % 512 < 64 ? [i] : []));
const built = stem => JSON.parse(readFileSync(new URL(`../data/${stem}.json`, import.meta.url))).fragrances;
const gzKB = path => gzipSync(readFileSync(new URL(path, dir)), { level: 9 }).length / 1024;

test('pool records are the r/ records, with the same names, links and votes', () => {
  assert.ok(sample.length > 1000);
  for (const i of sample) {
    const id = pool.cols.id[i], p = fromPool(pool, i), r = fromFragrantica(id, rows[id]);
    for (const key of ['id', 'name', 'brand', 'year', 'gender', 'url', 'thumb', 'ratingVotes', 'accords', 'seasonVotes', 'timeVotes', 'season', 'dayNight']) {
      assert.deepEqual(p[key], r[key], `${r.name} ${key}`);
    }
    assert.ok(Math.abs(p.rating - r.rating) < 0.0051, r.name);
    assert.equal(Boolean(p.like), Boolean(r.like), r.name);
    assert.equal(Boolean(p.performance), Boolean(r.performance), r.name);
  }
});

test('pool records score as r/ records do, to the rounding of a few inputs', () => {
  const P = sample.map(i => fromPool(pool, i));
  const R = sample.map(i => fromFragrantica(pool.cols.id[i], rows[pool.cols.id[i]]));
  const windows = [
    [{ feelsF: 92, humidity: 75, category: 'clear', date: new Date('2026-08-10T14:00'), lat: 40 }, 'day'],
    [{ feelsF: 28, humidity: 60, category: 'clear', date: new Date('2026-01-10T20:00'), lat: 40 }, 'night'],
    [{ feelsF: 58, humidity: 60, category: 'rain', date: new Date('2026-09-28T20:00'), lat: 40 }, 'night'],
  ];
  let worst = 0;
  for (const [conditions, slot] of windows) {
    for (const occasion of [null, ...OCCASIONS]) {
      const want = new Map(rank(R, conditions, slot, { occasion }).map(s => [s.fragrance.id, s.score]));
      for (const s of rank(P, conditions, slot, { occasion })) worst = Math.max(worst, Math.abs(s.score - want.get(s.fragrance.id)));
    }
  }
  assert.ok(worst < 0.005, `largest score gap ${worst}`);
});

test('pool notes are each bottle’s strongest, in its tiers', () => {
  assert.ok(pool.noteList, 'pool-notes.json loaded');
  const sauvage = fromPool(pool, pool.index.get('31861'));
  assert.ok(sauvage.notes.base.includes('Ambroxan') && sauvage.notes.top.length);
  assert.equal(sauvage.noteVotes.Ambroxan, 1000, 'the top note');
  assert.ok(Object.values(sauvage.notes).flat().length <= 8);
});

test('every id the pool names is in r/', () => {
  for (let i = 0; i < pool.count; i++) {
    for (const id of [pool.cols.id[i], ...pool.cols.like[i], ...pool.cols.alt[i]]) assert.ok(inLibrary.has(id), `${id}`);
  }
});

test('the pool stays small and carries its license', () => {
  const pool = gzKB('pool.json'), notes = gzKB('pool-notes.json');
  assert.ok(pool + notes < 750, `pool ${pool.toFixed(0)} KB + notes ${notes.toFixed(0)} KB gzipped`);
  for (const file of ['pool.json', 'pool-notes.json']) {
    const { license } = JSON.parse(readFileSync(new URL(file, dir)));
    assert.match(license, /CC BY-NC-SA 4\.0/);
    assert.match(license, /Le Decanteur/);
  }
});

test('pool signals: brigaded pages, cheaper alternatives, value', () => {
  assert.deepEqual(pool.flags, FLAGS);
  const at = id => fromPool(pool, pool.index.get(id)).extras;
  assert.ok(at('28286').flags.includes('brigaded'), 'SpongeBob: far more ratings than owners');
  assert.ok(!at('9828').flags.includes('brigaded'));
  assert.equal(at('9828').alt[0], 34696, 'Aventus -> Club de Nuit Intense Man');
  assert.ok(at('9828').value < 2 && at('34696').value > 4);
  const values = pool.cols.val.filter(Boolean).sort((a, b) => a - b);
  const median = values[values.length >> 1] / 100;
  assert.ok(median > 2.8 && median < 3.3, `median value ${median}`);
});

test('wardrobe, catalog and originals carry the about data and signals', async () => {
  for (const stem of ['collection', 'catalog', 'originals']) {
    for (const f of built(stem)) {
      // A bottle newer than the dataset (added with the extractor) has neither.
      if (!inLibrary.has(Number(f.id))) {
        assert.ok(!f.about && !f.extras, f.name);
        continue;
      }
      assert.ok(f.about && f.extras && f.sentiment, `${f.name}: run python3 scripts/decant.py extras`);
      assert.equal(typeof f.extras.safe, 'number', f.name);
      const shard = await loadAbout(f.id, load);
      if (!shard) continue; // under 30 rating votes
      const { sentiment, ...about } = shard;
      assert.deepEqual(about, f.about, `${f.name}: about shard and extras.jsonl agree`);
      assert.equal(Object.keys(sentiment).length, 5);
    }
  }
});

test('a dupe’s original carries its signals and sibling clones', () => {
  const dupes = built('collection').filter(f => f.original);
  assert.ok(dupes.length >= 18);
  for (const f of dupes) {
    assert.ok(f.original.extras && Array.isArray(f.original.siblings), f.name);
    assert.ok(!f.original.siblings.includes(f.id), `${f.name} is not its own sibling`);
  }
  const cream = dupes.find(f => f.name === 'Cream Velvet');
  assert.ok(cream.original.siblings.includes(93628), 'Bianco Latte’s clones include Lattafa Eclaire');
  assert.ok(cream.original.extras.value < cream.extras.value, 'the dupe is the better value');
});

test('about shards parse, for bottles with 30 or more votes', async () => {
  const names = readdirSync(new URL('x/', dir));
  assert.equal(names.length, 512);
  for (const name of names) {
    for (const [id, x] of Object.entries(JSON.parse(readFileSync(new URL(`x/${name}`, dir))))) {
      assert.equal(Number(id) % 512, Number(name.split('.')[0]));
      assert.ok(x.h.length === 5 && x.h.reduce((a, b) => a + b) >= 30, id);
    }
  }
  const aventus = await loadAbout('9828', load);
  assert.ok(aventus.perfumers.includes('Erwin Creed'));
  assert.equal(aventus.line, 'Aventus');
  assert.equal(aventus.pros.length, 3);
  assert.equal(aventus.cons.length, 2);
  assert.equal(aventus.smellsLike[0].id, 34696);
  assert.equal(aventus.alsoLiked.length, 10);
  assert.ok(aventus.value.avg < 2 && aventus.owners.have > aventus.owners.had);
  assert.equal(await loadAbout('999999999', load), null);
  assert.equal(await loadAbout('my:abc', load), null);
});

test('the default loader fetches next to this module, so a Worker under src/ finds the files', async t => {
  const asked = [];
  t.mock.method(globalThis, 'fetch', async url => {
    asked.push(String(url));
    return new Response(readFileSync(new URL(url)));
  });
  const aventus = await loadAbout('9828');
  assert.equal(aventus.line, 'Aventus');
  assert.deepEqual(asked, [String(new URL(`x/${9828 % 512}.json`, dir))]);
});
