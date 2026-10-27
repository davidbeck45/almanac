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
  // 722 KB in October 2026, over the ~600 aimed for: see CLAUDE.md for what trims it.
  const pool = gzKB('pool.json'), notes = gzKB('pool-notes.json');
  assert.ok(pool + notes < 730, `pool ${pool.toFixed(0)} KB + notes ${notes.toFixed(0)} KB gzipped`);
  for (const file of ['pool.json', 'pool-notes.json']) {
    const { license } = JSON.parse(readFileSync(new URL(file, dir)));
    assert.match(license, /CC BY-NC-SA 4\.0/);
    assert.match(license, /Le Decanteur/);
  }
});

test('pool signals: brigaded pages, cheaper alternatives, value', () => {
  assert.deepEqual(pool.flags, FLAGS);
  const at = id => fromPool(pool, pool.index.get(id)).extras;
  assert.ok(at('28286').flags.includes('brigaded'), 'SpongeBob: far more ratings than owners, nearly all love');
  assert.ok(at('81774').flags.includes('brigaded'), 'Le Male Pride 2023: review-bombed');
  assert.ok(!at('85363').flags.includes('brigaded'), 'Myriad: rated from testers, an ordinary spread');
  assert.ok(!at('9828').flags.includes('brigaded'));
  assert.equal(at('9828').alt[0], 34696, 'Aventus -> Club de Nuit Intense Man');
  assert.ok(at('9828').value < 2 && at('34696').value > 4);
  const values = pool.cols.val.filter(Boolean).sort((a, b) => a - b);
  const median = values[values.length >> 1] / 100;
  assert.ok(median > 2.8 && median < 3.3, `median value ${median}`);
});

test('pool owners and reach: owners to a quarter of a doubling, reach a share of the fans’ other loves', async () => {
  for (const id of ['48100', '96622', '112348', '9828']) {
    const { extras } = fromPool(pool, pool.index.get(id)), about = await loadAbout(id, load);
    assert.ok(Math.abs(extras.owners / about.owners.have - 1) < 0.1, `${id}: ${extras.owners} vs ${about.owners.have}`);
    assert.ok(extras.reach >= 0 && extras.reach <= 1);
  }
  const reach = pool.cols.rc.filter(x => x >= 0).sort((a, b) => a - b);
  assert.ok(reach[reach.length >> 1] >= 70, `median reach ${reach[reach.length >> 1]}`);
  assert.ok(fromPool(pool, pool.index.get('96622')).extras.reach < 0.1, 'Granado Íris: its fans love Brazilian bottles');
  // A house's best known bottles reach no further than the house does, plus a little: Granado's Bossa and
  // Phebo's Limão Siciliano had 0.40 and 0.55 of their own; Le Labo's and Riiffs' stand.
  const reachOf = id => fromPool(pool, pool.index.get(id)).extras.reach;
  assert.ok(reachOf('63970') <= 0.21 && reachOf('25456') <= 0.3, `${reachOf('63970')}, ${reachOf('25456')}`);
  assert.ok(reachOf('10131') > 0.9 && reachOf('124649') > 0.25, 'Another 13, Zenith');
  // A mist is said so by its name, page or the members' summary; a perfume called a mist isn't one.
  assert.ok((await loadAbout('112348', load)).flags.includes('mist'), 'Book Loft, in its about data too');
  assert.ok(!fromPool(pool, pool.index.get('496')).extras.flags.includes('mist'), 'Cashmere Mist');
  // A name says so only with the kind: not a plain "spray" or "brume" (801 sea spray, Thomas Kosmala's Brume Radieuse).
  for (const id of ['51012', '53744']) assert.ok(!(await loadAbout(id, load)).flags.includes('mist'), id);
  for (const id of ['37572', '43933']) assert.ok((await loadAbout(id, load)).flags.includes('mist'), id); // Miss Dior Brume Soyeuse pour le Corps, Sauvage Very Cool Spray
});

test('discontinued only when a con says so of the bottle itself', () => {
  const at = id => fromPool(pool, pool.index.get(id)).extras.flags;
  for (const id of ['81508', '102208', '65051']) {
    // Acqua di Giò Parfum ("an alternative to the discontinued Profumo"), Y Le Parfum 2025, Gentleman EDT Intense
    assert.ok(!at(id).includes('discontinued'), id);
  }
  assert.ok(!at('109989').includes('discontinued') && at('109989').includes('hardToFind'), 'Cedar Chic: hard to find in stock');
  assert.ok(at('29727').includes('discontinued'), 'Acqua di Giò Profumo');
});

test('family links: the smells-like votes strong enough to call two bottles one scent', () => {
  const aventus = fromPool(pool, pool.index.get('9828')).extras;
  assert.equal(aventus.like.length, 3);
  assert.ok(aventus.family.includes(34696) && aventus.family.length > 3, 'Club de Nuit Intense Man and more clones');
  for (let i = 0; i < pool.count; i++) {
    const { like, family } = fromPool(pool, i).extras;
    assert.ok(like.length <= 3 && family.every(id => pool.cols.like[i].includes(id)));
  }
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
