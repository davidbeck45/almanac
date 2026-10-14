import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { handlePool, newPoolCache, poolServer, POOL_TASKS, QUICK } from '../src/pool-tasks.js';
import { poolClient, inlineWorker } from '../src/app/pool.js';
import { loadPool, fromPool, loadAbout } from '../src/fragrantica.js';
import { gapContext, gapReport } from '../src/gaps.js';
import { signalsOf, PREFER_VALUE } from '../src/candidates.js';
import { DEMO_LIKED } from '../src/discover.js';

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
  // The liked styles ride along to buyCheck: Glossier You adds to the skin scents David likes.
  const pool = await loadPool(load);
  const you = Array.from({ length: pool.count }, (_, i) => fromPool(pool, i)).find(r => r.name === 'You' && r.brand === 'Glossier');
  assert.equal((await ask('check', { owned, id: you.id, liked: DEMO_LIKED })).verdict, 'Good');
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

  // A bottle page sends the about data it has: the same answer, without loading its shard again.
  const shards = [];
  const tracked = newPoolCache({ load: async path => { shards.push(path); return load(path); } });
  const about = await loadAbout('9828', load);
  const sent = (await handlePool({ id: 1, type: 'dupes', payload: { owned, id: '9828', about } }, tracked)).result;
  assert.deepEqual(sent, aventus);
  assert.ok(!shards.includes(`x/${9828 % 512}.json`), shards.join(' '));

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


test('bottles switched off cover nothing, but are never suggested back, nor their originals', async () => {
  // Each of David's bottles in the pool, switched off in turn as Manage does.
  const pool = await loadPool(load);
  for (const off of owned.filter(f => pool.index.has(f.id))) {
    const on = owned.filter(f => f !== off);
    const report = await ask('report', { owned: on, exclude: [off], k: 5, preferValue: false });
    const like = await ask('moreLike', { owned: on, exclude: [off.id], seeds: [on[0].id], k: 10, preferValue: false });
    for (const p of [...report.picks, ...like.picks]) {
      assert.ok(![off.id, String(off.original?.id)].includes(p.id), `${off.name} switched off comes back as ${p.record.name}`);
    }
  }
  const velvet = named('Cream Velvet'), on = owned.filter(f => f !== velvet);
  // It covers nothing: the grid is the one without it.
  const without = await ask('report', { owned: on, k: 1 });
  const off = await ask('report', { owned: on, exclude: [velvet], k: 1 });
  assert.deepEqual(off.coverage, without.coverage);
  // Checks and dupes call it owned (without `exclude` it checks as a strong fit).
  const self = await ask('check', { owned: on, exclude: [velvet.id], id: velvet.id });
  assert.deepEqual([self.verdict, self.reasons[0]], ['Redundant', 'You own it.']);
  const original = await ask('check', { owned: on, exclude: [velvet], id: String(velvet.original.id) });
  assert.deepEqual([original.verdict, original.reasons[0]], ['Redundant', 'The original of your Cream Velvet.']);
  const family = await ask('dupes', { owned: on, exclude: [velvet], id: String(velvet.original.id) });
  const entries = [family.original, ...family.cheaper, ...family.siblings].filter(Boolean);
  assert.ok(entries.every(e => e.owned === owned.some(f => f.id === e.id)), 'owned marks follow the whole list');
  // Ids the dataset doesn't have are only left out.
  assert.equal((await ask('styles', { owned, exclude: ['my:gone', null], styles: ['skin'], k: 1 })).picks.length, 1);
});

test('a pool file that doesn’t read fails as a sentence, to the asker and to the status', async () => {
  const heard = [];
  const cut = newPoolCache({ load: async path => (path === 'pool.json' ? '{"count": 3, "na' : load(path)), onStatus: (s, e) => heard.push(e ? `${s}: ${e}` : s) });
  const answer = await handlePool({ id: 1, type: 'warm' }, cut);
  assert.equal(answer.error, 'The fragrance library didn’t load. Try again.');
  assert.match(answer.detail, /JSON/);
  assert.deepEqual(heard, ['loading', 'error: The fragrance library didn’t load. Try again.']);
});

test('a download that stalls fails as out of reach, and a refused one says so', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const real = globalThis.fetch;
  let aborted = 0, status = 200;
  // Files that send a few bytes, then nothing, until their signal aborts.
  globalThis.fetch = async (url, { signal }) => (status !== 200 ? new Response('', { status }) : new Response(new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode('{"cou'));
      signal.addEventListener('abort', () => { aborted++; c.error(new Error('aborted')); });
    },
  })));
  try {
    const answer = handlePool({ id: 1, type: 'warm' }, newPoolCache());
    for (let i = 0; i < 5; i++) await new Promise(setImmediate);
    t.mock.timers.tick(29_000);
    assert.equal(aborted, 0, 'a slow line is left alone');
    t.mock.timers.tick(1_000);
    assert.equal((await answer).error, 'Can’t reach the fragrance library. Check your connection.');
    assert.ok(aborted > 0);
    status = 503;
    assert.equal((await handlePool({ id: 2, type: 'warm' }, newPoolCache())).error, 'The fragrance library didn’t load (503).');
  } finally {
    globalThis.fetch = real;
  }
});

test('records never waits for the pool: r/ records before it’s in, its rows after', async () => {
  const heard = [];
  const fresh = newPoolCache({ load, onStatus: s => heard.push(s) });
  const before = (await handlePool({ id: 1, type: 'records', payload: { ids: ['76063'] } }, fresh)).result;
  assert.equal(before.records[0].name, 'Shalimar Millésime Tonka');
  assert.ok(!before.records[0].extras);
  assert.deepEqual(heard, [], 'it doesn’t start the pool either');
  await handlePool({ id: 2, type: 'warm' }, fresh);
  assert.ok((await handlePool({ id: 3, type: 'records', payload: { ids: ['76063'] } }, fresh)).result.records[0].extras);
});

test('lists don’t fetch about data for vote counts nobody shows, and poolOnly records skip r/', async () => {
  const paths = [];
  const counted = newPoolCache({ load: path => { paths.push(path); return load(path); } });
  const run = async (type, payload) => {
    const answer = await handlePool({ id: 1, type, payload }, counted);
    assert.equal(answer.error, undefined, answer.error);
    return answer.result;
  };
  await run('warm', {});
  const fetched = prefix => paths.filter(p => p.startsWith(prefix)).length;
  paths.length = 0;
  // By bottle and a notes search, with picks that copy something.
  const plain = [...(await run('moreLike', { owned, seeds: ['9828'], k: 10 })).picks, ...(await run('notes', { owned, query: 'amber vanilla', k: 10 })).picks];
  const copies = plain.filter(p => p.clonesOf);
  assert.ok(copies.length, 'some picks copy a bottle');
  assert.ok(copies.every(p => p.clonesOf.up == null && !/\(\d+ to \d+\)/.test(p.why)));
  // Aventus's own about data is read for "fans also like"; nothing for the picks.
  assert.equal(fetched('x/'), 1, paths.join(' '));
  paths.length = 0;
  const voted = (await run('moreLike', { owned, seeds: ['9828'], k: 10, cloneVotes: true })).picks.filter(p => p.clonesOf);
  assert.ok(voted.some(p => p.clonesOf.up > 0) && fetched('x/') > 0, 'asked for, the votes come');

  // A name search asks whether its exact hits are well known: pool rows only.
  paths.length = 0;
  const { records, missing } = await run('records', { ids: ['76063', '12807', 'my:x'], poolOnly: true });
  assert.deepEqual(records.map(r => r.name), ['Shalimar Millésime Tonka']);
  assert.deepEqual(missing, ['12807', 'my:x']);
  assert.equal(fetched('r/'), 0);
});

// ---------------------------------------------------------------- the server

// Waits (real time) until `fn()` holds.
async function until(fn, ms = 10_000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise(resolve => setTimeout(resolve, 2));
  }
}
const said = posted => posted.map(m => (m.type === 'start' ? `start ${m.id}` : ['status', 'ready'].includes(m.type) ? m.status ?? m.type : `${m.error ? 'error' : 'answer'} ${m.id}`));

test('the server answers quick questions at once, the rest in turn, and drops one cancelled before it starts', async () => {
  assert.deepEqual([...QUICK].sort(), ['liked', 'records']);
  let open;
  const gate = new Promise(resolve => { open = resolve; });
  const posted = [];
  const serve = poolServer(data => posted.push(structuredClone(data)), { load: async path => (path.startsWith('pool') ? gate.then(() => load(path)) : load(path)) });
  serve({ id: 1, type: 'warm', payload: {} });
  serve({ id: 2, type: 'styles', payload: { owned, styles: ['skin'], k: 2 } });
  serve({ id: 3, type: 'notes', payload: { owned, query: 'iris', k: 2 } });
  serve({ type: 'cancel', id: 3 });
  serve({ id: 4, type: 'liked', payload: { owned } });
  await until(() => posted.some(m => m.id === 4 && m.result));
  assert.deepEqual(said(posted), ['start 1', 'loading', 'start 4', 'answer 4'], 'liked doesn’t wait for the pool’s download');
  open();
  await until(() => posted.some(m => m.id === 2 && m.result));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(said(posted).slice(4), ['ready', 'answer 1', 'start 2', 'answer 2'], 'the cancelled one never starts');
});

test('an answer that can’t be posted comes back as an apology, and the next question still runs', async () => {
  const posted = [];
  let thrown = false;
  const serve = poolServer(data => {
    if (data.id === 1 && data.type === 'nope' && !thrown) {
      thrown = true;
      throw new DOMException('#<Object> could not be cloned.', 'DataCloneError');
    }
    posted.push(data);
  });
  serve({ id: 1, type: 'nope' });
  serve({ id: 2, type: 'nope' });
  await until(() => posted.some(m => m.id === 2 && m.error));
  const one = posted.find(m => m.id === 1 && m.error);
  assert.equal(one.error, 'Something went wrong working that out. Try again.');
  assert.match(one.detail, /could not be cloned/);
});

test('the worker script says it’s ready and serves questions', async () => {
  const posted = [];
  globalThis.self = { postMessage: data => posted.push(structuredClone(data)) };
  try {
    await import('../src/pool-worker.js');
    assert.deepEqual(posted[0], { type: 'ready' });
    self.onmessage({ data: { id: 7, type: 'liked', payload: { owned } } });
    await until(() => posted.some(m => m.id === 7 && m.result));
    assert.deepEqual(said(posted), ['ready', 'start 7', 'answer 7']);
    assert.equal(posted.at(-1).result.from, 'wardrobe');
  } finally {
    delete globalThis.self;
  }
});

// ---------------------------------------------------------------- the client

// A Worker stand-in: what's posted, and answers sent back by hand.
class FakeWorker {
  static made = [];
  constructor(kind = 'worker') {
    this.kind = kind;
    this.posted = [];
    this.terminated = false;
    FakeWorker.made.push(this);
  }
  postMessage(msg) { this.posted.push(structuredClone(msg)); }
  terminate() { this.terminated = true; }
  reply(data) { this.onmessage({ data: structuredClone(data) }); }
  start(q) { this.reply({ type: 'start', id: q.id }); }
  questions() { return this.posted.filter(m => m.type !== 'cancel'); }
  cancels() { return this.posted.filter(m => m.type === 'cancel').map(m => m.id); }
}
const fakeClient = (options = {}) => {
  FakeWorker.made = [];
  return poolClient({ worker: () => new FakeWorker(), inline: () => new FakeWorker('inline'), ...options });
};
const lastWorker = () => FakeWorker.made.at(-1);
const poolRecord = (id, extra = {}) => ({ id, source: 'fragrantica', name: `Bottle ${id}`, accords: { musky: 100 }, extras: { value: 4 }, ...extra });
// Whether a promise has settled, without waiting for it.
const watch = promise => {
  const w = { done: false, value: undefined, error: undefined };
  promise.then(v => Object.assign(w, { done: true, value: v }), e => Object.assign(w, { done: true, error: e }));
  return w;
};
const settle = () => new Promise(setImmediate);

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
  assert.deepEqual(w.cancels(), [q1.id], 'the worker drops it if it hasn’t started');
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
  assert.equal(w.cancels().length, 1);
  w.reply({ id: w.questions().at(-1).id, type: 'notes', result: { query: 'iris leather' } });
  assert.equal((await third).query, 'iris leather');
});

test('the pool’s status follows the worker, for skeletons', async () => {
  const client = fakeClient();
  const heard = [];
  const stop = client.onStatus((status, error) => heard.push(error ? `${status}: ${error}` : status));
  assert.equal(client.status(), 'idle');
  client.ask('liked', { owned: [] }).catch(() => {});
  client.ask('records', { ids: [] }).catch(() => {});
  assert.equal(client.status(), 'idle', 'liked and records don’t load the pool');
  client.warm();
  assert.equal(client.status(), 'loading');
  const w = lastWorker();
  assert.deepEqual(w.questions().map(q => q.type), ['liked', 'records', 'warm']);
  client.warm();
  assert.equal(w.questions().length, 3, 'warming twice asks once');
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

test('the clock runs from when a question starts, and stops while the pool downloads', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const client = fakeClient({ timeout: 1000 });
  const report = watch(client.ask('report', { owned: [] }, { channel: 'ins-report' }));
  const check = watch(client.ask('check', { owned: [], id: '1' }, { channel: 'bp-check' }));
  const w = lastWorker();
  w.reply({ type: 'ready' });
  const [q1, q2] = w.questions();
  w.start(q1);
  w.reply({ type: 'status', status: 'loading' });
  // A slow line: the download takes ten timeouts, and nothing fails.
  for (let i = 0; i < 10; i++) t.mock.timers.tick(1000);
  await settle();
  assert.ok(!report.done && !check.done && !w.terminated);
  w.reply({ type: 'status', status: 'ready' });
  t.mock.timers.tick(900);
  w.reply({ id: q1.id, type: 'report', result: { picks: [] } });
  w.start(q2);
  t.mock.timers.tick(900);
  w.reply({ id: q2.id, type: 'check', result: { verdict: 'Good' } });
  await settle();
  assert.deepEqual([report.value.picks, check.value.verdict, w.terminated], [[], 'Good', false]);
});

test('a question stuck running fails alone; the worker is replaced and the rest go to the new one', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const client = fakeClient({ timeout: 1000 });
  const stuck = watch(client.ask('report', { owned: [] }));
  const next = watch(client.ask('check', { owned: [], id: '1' }));
  const w = lastWorker();
  w.reply({ type: 'ready' });
  w.reply({ type: 'status', status: 'ready' });
  const [q1, q2] = w.questions();
  // Questions waiting their turn have no clock of their own: the one running does.
  t.mock.timers.tick(5000);
  w.start(q1);
  t.mock.timers.tick(999);
  await settle();
  assert.ok(!stuck.done && !next.done);
  t.mock.timers.tick(1);
  await settle();
  assert.match(stuck.error?.message, /took too long/);
  assert.ok(w.terminated && !next.done);
  assert.equal(client.status(), 'loading', 'the new worker loads the pool again');
  const w2 = lastWorker();
  assert.notEqual(w2, w);
  assert.deepEqual(w2.questions().map(q => q.id), [q2.id]);
  w.reply({ id: q2.id, type: 'check', result: { verdict: 'Old' } });
  w2.reply({ type: 'ready' });
  w2.start(q2);
  w2.reply({ id: q2.id, type: 'check', result: { verdict: 'Good' } });
  await settle();
  assert.equal(next.value.verdict, 'Good', 'only the current worker is heard');
});

test('a Worker that isn’t up in time, or errs before, hands its questions to the main thread', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const client = fakeClient({ timeout: 1000 });
  const a = watch(client.ask('styles', { owned: [] }));
  t.mock.timers.tick(999);
  assert.equal(FakeWorker.made.length, 1);
  t.mock.timers.tick(1);
  const main = lastWorker();
  assert.deepEqual([FakeWorker.made[0].terminated, main.kind], [true, 'inline']);
  assert.equal(main.questions().length, 1);
  main.reply({ type: 'ready' });
  main.reply({ id: main.questions()[0].id, type: 'styles', result: { picks: [] } });
  client.ask('records', { ids: [] }).catch(() => {});
  assert.equal(FakeWorker.made.length, 2, 'no more Workers');
  await settle();
  assert.deepEqual(a.value.picks, []);

  const other = fakeClient();
  const b = watch(other.ask('notes', { query: 'fig' }));
  lastWorker().onerror({ preventDefault() {} });
  assert.equal(lastWorker().kind, 'inline');
  lastWorker().reply({ id: lastWorker().questions()[0].id, type: 'notes', result: { query: 'fig' } });
  await settle();
  assert.equal(b.value.query, 'fig');
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
  assert.equal(lastWorker().kind, 'worker');
});

test('on the main thread the same server answers, quick ones first, one replaced before its turn never runs', async () => {
  let open;
  const gate = new Promise(resolve => { open = resolve; });
  const log = [];
  // The server with a pool that can't be reached, once let through.
  const module = async () => ({
    poolServer: post => poolServer(data => { log.push(data); post(data); }, {
      load: () => gate.then(() => { throw new Error('Can’t reach the fragrance library. Check your connection.'); }),
    }),
  });
  const client = poolClient({ worker: () => null, inline: () => inlineWorker(module) });
  const warm = watch(client.ask('warm'));
  const replaced = client.ask('nope', {}, { channel: 'c' });
  const kept = watch(client.ask('nope', {}, { channel: 'c' }));
  const liked = await client.ask('liked', { owned });
  assert.equal(liked.from, 'wardrobe');
  assert.deepEqual(await replaced, { stale: true });
  assert.ok(!warm.done, 'liked didn’t wait for the pool');
  open();
  await until(() => warm.done && kept.done);
  assert.equal(warm.error.message, 'Can’t reach the fragrance library. Check your connection.');
  assert.equal(kept.error.message, 'Unknown question "nope".');
  assert.deepEqual(log.filter(m => m.type === 'start').map(m => m.id), [1, 4, 3], 'the replaced question never started');
  assert.equal(client.status(), 'error');

  // The code can't load: a plain error, and the next ask tries again.
  let tries = 0;
  const failing = async () => { tries++; throw new Error('import failed'); };
  const offline = poolClient({ worker: () => null, inline: () => inlineWorker(failing) });
  await assert.rejects(offline.ask('records', { ids: [] }), /Can’t reach the fragrance library/);
  await assert.rejects(offline.ask('records', { ids: [] }), /Can’t reach/);
  assert.equal(tries, 2);
  assert.equal(offline.status(), 'error');
  const blocked = poolClient({ worker: () => { throw new Error('blocked'); }, inline: () => inlineWorker(failing) });
  await assert.rejects(blocked.ask('records', { ids: [] }), /Can’t reach/);
  await assert.rejects(blocked.ask('records', { ids: [] }), /Can’t reach/, 'a failed question doesn’t stall the next');
});

test('the app’s client runs the real questions, with poolInputs, and keeps their bottles for findRecord', async () => {
  // In Node there's no Worker: the app's client runs the server on this
  // thread, fetching data/fragrantica/ next to src/ (read from disk here).
  const real = globalThis.fetch;
  globalThis.fetch = async url => {
    const file = fileURLToPath(url);
    return existsSync(file) ? { ok: true, status: 200, text: async () => readFileSync(file, 'utf8') } : { ok: false, status: 404 };
  };
  try {
    const { askPool, poolStatus } = await import('../src/app/pool.js');
    const { state, findRecord, keepBottles, poolInputs, setPreferValue } = await import('../src/app/state.js');
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

    // David's wardrobe with Legacy switched off (Jake is off by default).
    state.demo = { fragrances: owned };
    state.hiding.hidden.add(named('Legacy').id);
    const inputs = await poolInputs();
    assert.deepEqual(inputs.exclude.map(f => f.name).sort(), ['Jake', 'Legacy']);
    assert.equal(inputs.owned.length, owned.length - 2);
    assert.deepEqual([inputs.summary, inputs.preferValue], [null, null], 'no place, no setting: the defaults');
    assert.ok(Math.abs(Object.values(inputs.shares).reduce((a, b) => a + b, 0) - 1) < 1e-9);
    const report = await askPool('report', { ...inputs, k: 5 }, { channel: 'ins-report' });
    assert.ok(report.picks.length && report.picks.every(p => !['Jake', 'Legacy'].includes(p.record.name)));
    assert.equal(report.preferValue, true);
    const legacy = await askPool('check', { ...inputs, id: named('Legacy').id }, { channel: 'bp-check' });
    assert.deepEqual([legacy.verdict, legacy.reasons[0]], ['Redundant', 'You own it.']);
    setPreferValue(false);
    assert.equal((await askPool('report', { ...(await poolInputs()), k: 1 })).preferValue, false);
  } finally {
    globalThis.fetch = real;
  }
});
