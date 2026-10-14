import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { handlePool, newPoolCache, POOL_TASKS } from '../src/pool-tasks.js';
import { poolClient, TIMEOUT } from '../src/app/pool.js';
import { loadPool, fromPool } from '../src/fragrantica.js';
import { gapContext, gapReport } from '../src/gaps.js';
import { signalsOf, PREFER_VALUE } from '../src/candidates.js';

const dir = new URL('../data/fragrantica/', import.meta.url);
const load = async path => {
  const file = new URL(path, dir);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
};
// As the app has them: string ids.
const raw = JSON.parse(readFileSync(new URL('../data/collection.json', import.meta.url))).fragrances;
const owned = raw.map(f => ({ ...f, id: String(f.id) }));
const named = name => owned.find(f => f.name === name);
const statuses = [];
const cache = newPoolCache({ load, onStatus: s => statuses.push(s) });

// One question, answered; fails the test on an error answer.
async function ask(type, payload = {}) {
  const answer = await handlePool({ id: type, type, payload }, cache);
  assert.equal(answer.error, undefined, `${type}: ${answer.error} ${answer.detail ?? ''}`);
  assert.equal(answer.id, type);
  // Every answer crosses postMessage as it is.
  assert.deepEqual(structuredClone(answer.result), answer.result);
  return answer.result;
}
const failure = async (type, payload = {}) => (await handlePool({ id: 0, type, payload }, cache)).error;
const isRecord = r => r && typeof r.id === 'string' && r.accords && Object.keys(r.accords).length > 0 && r.season && r.dayNight;
const ownedIds = new Set(owned.map(f => f.id));
const valueOf = r => signalsOf(r).value;

test('the pool loads once, says so, and every question is listed', async () => {
  const { count } = await ask('warm');
  const pool = await loadPool(load);
  assert.equal(count, pool.count);
  await ask('warm');
  assert.deepEqual(statuses, ['loading', 'ready']);
  assert.deepEqual(POOL_TASKS.sort(), ['check', 'dupes', 'liked', 'moreLike', 'notes', 'records', 'report', 'styles', 'warm']);
});

test('report is the gap finder’s, with a record for every bottle it suggests', async () => {
  const report = await ask('report', { owned: raw, k: 3 });
  const pool = await loadPool(load);
  const records = Array.from({ length: pool.count }, (_, i) => fromPool(pool, i));
  const direct = gapReport(gapContext({ owned, records, byId: new Map(records.map(r => [r.id, r])) }), { k: 3 });
  assert.deepEqual(report.picks.map(p => p.id), direct.picks.map(p => p.id), 'numeric ids read like string ones');
  assert.deepEqual(report.gaps, direct.gaps);
  assert.equal(report.preferValue, true, 'David’s wardrobe prefers great value');
  for (const p of report.picks) {
    assert.ok(isRecord(p.record) && p.record.extras, p.name);
    assert.ok(!ownedIds.has(p.id));
    assert.ok(valueOf(p.record) >= PREFER_VALUE, `${p.name} is great value`);
    if (p.twin) assert.equal(p.twin.record.id, p.twin.id);
    if (p.nearest) assert.equal(p.nearest.record.id, p.nearest.id);
  }
  // The same wardrobe and settings reuse the context; the other value setting keeps both.
  const kept = cache.gaps.length;
  await ask('report', { owned, k: 3 });
  assert.equal(cache.gaps.length, kept);
  const open = await ask('report', { owned, k: 8, preferValue: false });
  assert.equal(open.preferValue, false);
  assert.ok(open.picks.some(p => !(valueOf(p.record) >= PREFER_VALUE)), 'off lets lower value in');
  assert.equal(cache.gaps.length, 2);
});

test('report takes a climate, shares or "How you wear" settings, and a changed record', async () => {
  // No local climate yet (null) is the default climate; settings work as shares.
  const plain = await ask('report', { owned, summary: null, uses: { office: 'never' }, k: 1 });
  assert.ok(plain.coverage.filter(c => c.use === 'office').every(c => c.status === 'off'));
  assert.match(await failure('report', { owned, shares: {} }), /sharesFrom/);
  // A record changed under the same id makes a new context.
  const before = (await ask('report', { owned, k: 1 })).coverage;
  const changed = owned.map(f => (f.name === 'Cream Velvet' ? { ...f, accords: { citrus: 100, aquatic: 80 } } : f));
  const after = (await ask('report', { owned: changed, k: 1 })).coverage;
  assert.notDeepEqual(after.find(c => c.cell === 'cozy:night:mild').top, before.find(c => c.cell === 'cozy:night:mild').top);
});

test('check says whether a bottle is worth buying, by id or record, one or several', async () => {
  const tonka = await ask('check', { owned, id: '76063', liked: ['skin', 'gourmand', 'vanilla', 'nope'] });
  assert.equal(tonka.verdict, 'Strong fit');
  assert.equal(tonka.record.name, 'Shalimar Millésime Tonka');
  assert.ok(isRecord(tonka.record) && tonka.reasons.length >= 2 && tonka.preferValue === true);
  assert.ok(tonka.styles.some(s => s.id === 'vanilla'));
  assert.ok(tonka.likedShown.includes('vanilla') && tonka.likedShown.every(id => ['skin', 'gourmand', 'vanilla'].includes(id)));
  // An owned dupe's original is redundant, and names the owned bottle it overlaps.
  const althair = await ask('check', { owned, record: { id: '84109' } });
  assert.equal(althair.verdict, 'Redundant');
  assert.ok(isRecord(althair.overlap.record));
  // A visitor's bottle outside the pool reads its about data.
  const several = await ask('check', { owned, ids: ['76063', '12807', 'my:abc'] });
  assert.deepEqual(several.checks.map(c => c.name ?? c.missing), ['Shalimar Millésime Tonka', 'Olympic Amber', true]);
  assert.notEqual(several.checks[1].risk.level, 'unknown');
  assert.match(await failure('check', { owned, id: '999999999' }), /isn’t in the fragrance library/);
  assert.match(await failure('check', { owned }), /Say which bottle/);
});

test('liked styles start on what someone says they love, else what the wardrobe leans toward', async () => {
  const stated = await ask('liked', { owned, stated: ['skin', 'clean', 'intimate'] });
  assert.equal(stated.from, 'stated');
  assert.deepEqual(stated.styles.map(s => s.id), ['skin', 'clean', 'intimate']);
  for (const s of stated.styles) {
    assert.equal(s.ids.length, s.count);
    assert.deepEqual(s.ids.map(id => owned.find(f => f.id === id).name), s.bottles);
  }
  const leaning = await ask('liked', { owned });
  assert.equal(leaning.from, 'wardrobe');
  assert.ok(leaning.styles.length && !leaning.styles.every(s => s.stated));
  // Styles the wardrobe holds none of fall back to its own lean.
  assert.equal((await ask('liked', { owned: [named('Jake')], stated: ['gourmand'] })).from, 'wardrobe');
});

test('styles, more like and notes come back as picks with records, value preferred', async () => {
  const skin = await ask('styles', { owned, styles: ['skin', 'clean', 'intimate', 'nope'], k: 8 });
  assert.deepEqual(skin.styles, ['skin', 'clean', 'intimate']);
  assert.equal(skin.picks.length, 8);
  const open = await ask('styles', { owned, styles: ['skin', 'clean', 'intimate'], k: 8, preferValue: false });
  assert.ok(open.picks.some(p => !(p.value >= PREFER_VALUE)), 'off lets lower value in');
  // A floor of their own stays when it's higher.
  const high = await ask('styles', { owned, styles: ['skin'], k: 5, filters: { minValue: 4.2 } });
  assert.ok(high.picks.every(p => p.value >= 4.2));

  // Seeds by id or record, owned or not.
  const like = await ask('moreLike', { owned, seeds: [named('Liquid Brun').id, named('Amber Empire')], k: 6 });
  assert.equal(like.from, 'given');
  assert.deepEqual(like.seeds.map(s => s.name), ['Liquid Brun', 'Amber Empire']);
  assert.ok(like.seeds.every(s => !('about' in s)), 'seeds come back without their about data');
  assert.ok(like.picks.some(p => p.alsoLiked > 0), 'fans of the seeds also like some');
  assert.deepEqual((await ask('moreLike', { owned, seeds: ['9828'], k: 1 })).seeds.map(s => s.name), ['Aventus']);
  const worn = await ask('moreLike', { owned, history: [{ id: named('Jake').id, dateISO: '2026-10-10', slot: 'day' }], todayISO: '2026-10-14', k: 3 });
  assert.equal(worn.from, 'worn');
  assert.deepEqual(worn.seeds.map(s => s.name), ['Jake']);
  assert.match(await failure('moreLike', { owned, seeds: ['my:none'] }), /None of those bottles/);

  const notes = await ask('notes', { owned, query: 'iris leather', k: 6 });
  assert.deepEqual(notes.terms, ['iris', 'leather']);
  assert.ok(notes.picks.every(p => p.matched.length === 2));
  const typo = await ask('notes', { owned, query: 'iris qqzzx' });
  assert.deepEqual([typo.unknown, typo.picks], [['qqzzx'], []]);

  for (const p of [...skin.picks, ...open.picks, ...like.picks, ...notes.picks]) {
    assert.ok(isRecord(p.record) && p.record.extras && p.id === p.record.id, p.id);
    assert.ok(!ownedIds.has(p.id), `${p.record.name} isn’t owned`);
    assert.ok(typeof p.why === 'string' && p.why.length, p.record.name);
    if (p.twin) assert.ok(isRecord(p.twin.record));
    if (p.clonesOf) assert.ok(isRecord(p.clonesOf.record));
    for (const r of p.alike ?? []) assert.ok(isRecord(r));
  }
  for (const p of [...skin.picks, ...like.picks, ...notes.picks]) assert.ok(p.value >= PREFER_VALUE, `${p.record.name} is great value`);
  assert.match(await failure('styles', { owned, styles: ['skin'], filters: { lean: 'sideways' } }), /Lean is feminine, unisex or masculine/);
  assert.deepEqual((await ask('styles', { owned, styles: [] })).picks, []);
});

test('dupes finds the smells-like family, and records loads bottles pool first', async () => {
  const brun = await ask('dupes', { owned, id: named('Liquid Brun').id });
  assert.equal(brun.record.name, 'Liquid Brun');
  assert.equal(brun.original.name, 'Althaïr');
  assert.ok(isRecord(brun.original.record) && brun.original.built);
  const aventus = await ask('dupes', { owned, id: '9828' });
  assert.ok(aventus.cheaper.length >= 3 && aventus.cheaper.every(e => isRecord(e.record) && !('about' in e.record)));

  const { records, missing } = await ask('records', { ids: ['76063', 12807, 'my:x', '76063'] });
  assert.deepEqual(records.map(r => r.name), ['Shalimar Millésime Tonka', 'Olympic Amber']);
  assert.ok(records[0].extras && !records[1].extras, 'the pool’s row, else the r/ record');
  assert.deepEqual(missing, ['my:x']);
});

test('errors come back as sentences, never thrown', async () => {
  assert.equal(await failure('nope'), 'Unknown question "nope".');
  assert.match(await failure('styles', { styles: ['skin'] }), /Send the wardrobe/);
  // A bug reads as a plain apology, with the real message kept for the console.
  const bug = await handlePool({ id: 1, type: 'liked', payload: { owned: [null] } }, cache);
  assert.equal(bug.error, 'Something went wrong working that out. Try again.');
  assert.ok(bug.detail);
  assert.equal((await handlePool(null, cache)).error, 'Unknown question "undefined".');
  // The library out of reach.
  const offline = newPoolCache({ load: async () => { throw new Error('Can’t reach the fragrance library. Check your connection.'); } });
  assert.match((await handlePool({ id: 2, type: 'styles', payload: { owned, styles: ['skin'] } }, offline)).error, /Can’t reach/);
});

// ---------------------------------------------------------------- the client

// A Worker stand-in: what's posted, and answers sent back by hand.
class FakeWorker {
  static made = [];
  constructor() {
    this.posted = [];
    this.terminated = false;
    FakeWorker.made.push(this);
  }
  postMessage(msg) { this.posted.push(structuredClone(msg)); }
  terminate() { this.terminated = true; }
  reply(data) { this.onmessage({ data: structuredClone(data) }); }
  questions() { return this.posted.filter(m => m.type !== 'cancel'); }
}
const fakeClient = (options = {}) => {
  FakeWorker.made = [];
  return poolClient({ worker: () => new FakeWorker(), inline: () => { throw new Error('no inline here'); }, ...options });
};
const lastWorker = () => FakeWorker.made.at(-1);
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const poolRecord = (id, extra = {}) => ({ id, source: 'fragrantica', name: `Bottle ${id}`, accords: { musky: 100 }, extras: { value: 4 }, ...extra });

test('the client answers by id, and hands on the records an answer names', async () => {
  const client = fakeClient();
  const kept = [];
  client.onRecords(list => kept.push(...list.map(r => r.id)));
  const mine = poolRecord('1');
  const answer = client.ask('styles', { owned: [mine], styles: ['skin'] });
  const w = lastWorker();
  w.reply({ type: 'ready' });
  const [q] = w.questions();
  assert.equal(q.type, 'styles');
  w.reply({ id: q.id, type: 'styles', result: { picks: [{ record: poolRecord('2'), nearest: { record: mine }, alike: [poolRecord('3')] }] }, ms: { total: 5 } });
  const result = await answer;
  assert.equal(result.ms.total, 5);
  assert.deepEqual(kept.sort(), ['2', '3'], 'the wardrobe sent with it is left out');
  // A second question goes to the same worker.
  client.ask('records', { ids: ['4'] }).catch(() => {});
  assert.equal(FakeWorker.made.length, 1);
  assert.equal(w.questions().length, 2);
});

test('a newer question on a channel replaces the older, which answers stale and is dropped', async () => {
  const client = fakeClient();
  const first = client.ask('notes', { query: 'ir' }, { channel: 'disc-notes' });
  const other = client.ask('notes', { query: 'fig' }, { channel: 'disc-other' });
  const loose = client.ask('notes', { query: 'oud' });
  const second = client.ask('notes', { query: 'iris' }, { channel: 'disc-notes' });
  assert.deepEqual(await first, { stale: true });
  const w = lastWorker();
  const [q1, q2, q3, q4] = w.questions();
  assert.deepEqual(w.posted.filter(m => m.type === 'cancel'), [{ type: 'cancel', id: q1.id }], 'the worker drops it if it hasn’t started');
  // An answer to the replaced question, arriving anyway, is ignored.
  w.reply({ id: q1.id, type: 'notes', result: { query: 'ir' } });
  w.reply({ id: q4.id, type: 'notes', result: { query: 'iris' } });
  w.reply({ id: q2.id, type: 'notes', result: { query: 'fig' } });
  w.reply({ id: q3.id, type: 'notes', error: 'Nope.', detail: 'raw' });
  assert.equal((await second).query, 'iris');
  assert.equal((await other).query, 'fig', 'other channels are left alone');
  await assert.rejects(loose, err => err.message === 'Nope.' && err.detail === 'raw');
  // A channel is free again once answered.
  const third = client.ask('notes', { query: 'iris leather' }, { channel: 'disc-notes' });
  assert.equal(w.posted.filter(m => m.type === 'cancel').length, 1);
  w.reply({ id: w.questions().at(-1).id, type: 'notes', result: { query: 'iris leather' } });
  assert.equal((await third).query, 'iris leather');
});

test('the pool’s status follows the worker, for skeletons', async () => {
  const client = fakeClient();
  const heard = [];
  const stop = client.onStatus((status, error) => heard.push(error ? `${status}: ${error}` : status));
  assert.equal(client.status(), 'idle');
  client.ask('liked', { owned: [] }).catch(() => {});
  assert.equal(client.status(), 'idle', 'liked needs no pool');
  client.warm();
  assert.equal(client.status(), 'loading');
  const w = lastWorker();
  assert.deepEqual(w.questions().map(q => q.type), ['liked', 'warm']);
  client.warm();
  assert.equal(w.questions().length, 2, 'warming twice asks once');
  w.reply({ type: 'status', status: 'loading' });
  w.reply({ type: 'status', status: 'ready' });
  assert.equal(client.status(), 'ready');
  client.ask('styles', { owned: [] }).catch(() => {});
  assert.equal(client.status(), 'ready');
  w.reply({ type: 'status', status: 'error', error: 'Can’t reach the fragrance library.' });
  stop();
  w.reply({ type: 'status', status: 'ready' });
  assert.deepEqual(heard, ['loading', 'ready', 'error: Can’t reach the fragrance library.']);
});

test('a question that takes too long fails, with everything waiting, and the next starts a fresh worker', async () => {
  const client = fakeClient({ timeout: 20 });
  const slow = client.ask('report', { owned: [] });
  const queued = client.ask('check', { owned: [], id: '1' }, { timeout: TIMEOUT });
  const w = lastWorker();
  await assert.rejects(slow, /took too long/);
  await assert.rejects(queued, /took too long/);
  assert.ok(w.terminated);
  assert.equal(client.status(), 'error');
  const again = client.ask('records', { ids: ['1'] });
  assert.equal(client.status(), 'loading');
  assert.equal(FakeWorker.made.length, 2);
  const w2 = lastWorker();
  w2.reply({ id: w2.questions()[0].id, type: 'records', result: { records: [], missing: ['1'] } });
  assert.deepEqual((await again).missing, ['1']);
});

test('without module Workers the questions run on the main thread, one at a time', async () => {
  // A Worker that fails before it's ready: its questions move to the main thread.
  const ran = [];
  const inline = async onStatus => {
    onStatus('loading');
    return async msg => {
      ran.push(msg.payload.query ?? msg.type);
      await tick();
      onStatus('ready');
      return { id: msg.id, type: msg.type, result: { query: msg.payload.query, record: poolRecord('9') } };
    };
  };
  const client = fakeClient({ inline });
  const kept = [];
  client.onRecords(list => kept.push(...list.map(r => r.id)));
  const a = client.ask('notes', { query: 'a' }, { channel: 'c' });
  const b = client.ask('notes', { query: 'b' });
  lastWorker().onerror({ preventDefault() {} });
  const c = client.ask('notes', { query: 'c' }, { channel: 'c' });
  assert.equal(FakeWorker.made.length, 1, 'no more Workers');
  assert.deepEqual(await a, { stale: true });
  assert.equal((await b).query, 'b');
  assert.equal((await c).query, 'c');
  assert.deepEqual(ran, ['b', 'c'], 'a question replaced before its turn never runs');
  assert.equal(client.status(), 'ready');
  assert.deepEqual(kept, ['9', '9']);

  // No Worker at all, and the code can't load: a plain error, and the next ask tries again.
  let tries = 0;
  const offline = poolClient({ worker: () => null, inline: async () => { tries++; throw new Error('import failed'); } });
  await assert.rejects(offline.ask('records', { ids: [] }), /Can’t reach the fragrance library/);
  await assert.rejects(offline.ask('records', { ids: [] }), /Can’t reach/);
  assert.equal(tries, 2);
  assert.equal(offline.status(), 'error');
  const broken = poolClient({ worker: () => { throw new Error('blocked'); }, inline: () => { throw new Error('no'); } });
  await assert.rejects(broken.ask('records', { ids: [] }), /Can’t reach/);
  await assert.rejects(broken.ask('records', { ids: [] }), /Can’t reach/, 'a failed question doesn’t stall the next');
});

test('a worker that breaks after it’s ready fails what’s waiting, and the next ask starts another', async () => {
  const client = fakeClient();
  const q = client.ask('styles', { owned: [] });
  const w = lastWorker();
  w.reply({ type: 'ready' });
  w.onerror({ preventDefault() {} });
  await assert.rejects(q, /Something went wrong/);
  assert.ok(w.terminated);
  client.ask('styles', { owned: [] }).catch(() => {});
  assert.equal(FakeWorker.made.length, 2);
});

test('the app’s client runs the real questions and keeps their bottles for findRecord', async () => {
  // In Node there's no Worker: the app's client runs pool-tasks on this thread,
  // fetching data/fragrantica/ next to src/ (read from disk here).
  const real = globalThis.fetch;
  globalThis.fetch = async url => {
    const file = fileURLToPath(url);
    return existsSync(file) ? { ok: true, status: 200, text: async () => readFileSync(file, 'utf8') } : { ok: false, status: 404 };
  };
  try {
    const { askPool, poolStatus } = await import('../src/app/pool.js');
    const { state, findRecord, keepBottles } = await import('../src/app/state.js');
    const answer = await askPool('styles', { owned, styles: ['clean'], k: 3 }, { channel: 'test' });
    assert.equal(poolStatus(), 'ready');
    for (const p of answer.picks) assert.equal(findRecord(p.id)?.name, p.record.name);
    assert.ok(!state.bottles.has(named('Jake').id), 'owned bottles stay where they are');
    // Seen in r/ too, a bottle keeps every note and its pool signals.
    const [pick] = answer.picks;
    const full = { ...pick.record, notes: { top: ['a', 'b'], mid: ['c'], base: ['d', 'e', 'f'] } };
    delete full.extras;
    keepBottles([full]);
    assert.deepEqual(state.bottles.get(pick.id).notes, full.notes);
    assert.deepEqual(state.bottles.get(pick.id).extras, pick.record.extras);
    keepBottles([pick.record]);
    assert.deepEqual(state.bottles.get(pick.id).notes, full.notes, 'a pool record doesn’t replace it');
  } finally {
    globalThis.fetch = real;
  }
});
