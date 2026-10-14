// Every question the app asks of the suggestion pool, answered in one place:
// src/pool-worker.js serves them in a module Worker (poolServer), src/app/
// pool.js asks them (or serves them on the main thread when module Workers
// fail), and tests run them in Node. A cache (newPoolCache) loads the pool,
// its notes and its style scores once, and keeps each wardrobe's gap and
// Discover contexts for the last few wardrobes asked about, so only the
// first ask pays for them.
//
// handlePool({ id, type, payload }, cache) -> { id, type, result, ms } or,
// when it fails, { id, type, error } with a message fit to show (`detail`
// holds the raw one for a bug); `id` is the asker's, echoed. Payloads are
// plain JSON; `owned` is the wardrobe's engine records (activeFragrances()),
// `exclude` the bottles it has switched off (ids or records): they cover
// nothing, but are never suggested back, nor their twins, originals or
// look-alikes, and checks and dupes call them owned. preferValue true or
// false turns "Prefer great value" on or off (only bottles voters value
// PREFER_VALUE or more, everywhere), null the wardrobe's default
// (preferValueDefault). mists: true lets the gap finder suggest body mists
// (Discover's lists take FILTERS' `mists`). src/app/state.js poolInputs()
// fills all of these but mists.
// Every bottle an answer brings in comes with its full engine record
// (`record`, ids as strings); owned ones may come as stubs (the asker has
// them). The questions that suggest bottles say which preferValue they
// used. By type, payload -> result:
//   report   { owned, exclude?, summary?, shares? | uses?, preferValue?, mists?, k? }
//            -> gapReport; each pick's twin and nearest carry their records
//   check    { owned, exclude?, id | record (or ids | records), liked?, summary?, shares? | uses?, preferValue?, mists? }
//            -> checkJSON plus the bottle's record, styles and the liked styles it shows
//               ({ checks } for several)
//   liked    { owned, stated? } -> { styles: likedStyles with ids, from: 'stated' | 'wardrobe' }
//   styles   { owned, exclude?, styles, mode?, k?, filters?, preferValue? } -> { styles, mode, picks }
//   moreLike { owned, exclude?, seeds? (ids or records; else the most worn: history, todayISO), k?, filters?, preferValue? }
//            -> { seeds, from: 'given' | 'worn' | 'rated', picks }
//   notes    { owned, exclude?, query, filters?, k?, preferValue? } -> searchNotes' fields, its results as `picks`
//   dupes    { owned, exclude?, id | record } -> { record, original, cheaper, siblings }
//   records  { ids } -> { records (pool rows once the pool is in, else r/), missing }
//   warm     {} -> { count }: loads the pool
// Picks are src/discover.js's (record, styles, nearest, clonesOf, twin,
// alike, risk, …) with `why`, the line whyLine writes.
import { loadPool, fromPool, loadPoolStyles, loadAbout, fragranticaLibrary } from './fragrantica.js';
import { poolRowOf, preferValueDefault, familyIndex, ownedVectors, PREFER_VALUE } from './candidates.js';
import { gapContext, gapReport, buyCheck, checkJSON, DEFAULT_CLIMATE } from './gaps.js';
import { sharesFrom } from './uses.js';
import {
  discoverContext, likedStyles, moreOfStyles, defaultSeeds, moreLike, searchNotes, dupeIds, dupesOf, whyLine, addCloneVotes, scoresOf,
} from './discover.js';
import { STYLES, STYLE_MIN, styleMix, topOf, closeOf } from './scent-styles.js';

// Wardrobes whose contexts are kept: two lets "Prefer great value" flip, or
// Mine and David's take turns, without working a context out again.
const KEEP = 2;
const DATA = new URL('../data/fragrantica/', import.meta.url);
const STYLE_IDS = new Set(STYLES.map(s => s.id));

const UNREACHABLE = 'Can’t reach the fragrance library. Check your connection.';
// A file that sends nothing new for STALL ms is out of reach: a stalled line
// fails the questions waiting on it rather than holding them for good.
const STALL = 30_000;

async function fetchLoad(path) {
  const stop = new AbortController();
  let timer = null, res = null;
  const wait = () => {
    clearTimeout(timer);
    timer = setTimeout(() => stop.abort(), STALL);
  };
  try {
    wait();
    res = await fetch(new URL(path, DATA), { signal: stop.signal });
    if (res.ok && !res.body) return await res.text();
    if (res.ok) {
      const reader = res.body.getReader(), text = new TextDecoder();
      let out = '';
      for (;;) {
        wait();
        const { done, value } = await reader.read();
        if (done) return out + text.decode();
        out += text.decode(value, { stream: true });
      }
    }
  } catch {
    throw new Error(UNREACHABLE);
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 404) return null;
  throw new Error(`The fragrance library didn’t load (${res.status}).`);
}

/**
 * A cache for handlePool. `load(path)` resolves a file under
 * data/fragrantica/ as text, or null when there's none (default: fetch next
 * to src/); `onStatus(status, error)` hears 'loading', 'ready' and 'error' as
 * the pool loads.
 */
export function newPoolCache({ load = fetchLoad, onStatus = null } = {}) {
  return { load, onStatus, pool: null, ready: null, owned: [], gaps: [], discover: [], library: fragranticaLibrary(load) };
}

// Errors from the modules and the loader are written to be read; anything
// else is a bug, which the app shouldn't show as it is.
const BUGS = [TypeError, RangeError, ReferenceError, SyntaxError];
const isBug = err => BUGS.some(E => err instanceof E);
const SORRY = 'Something went wrong working that out. Try again.';
const UNREADABLE = 'The fragrance library didn’t load. Try again.';

// The pool's records, loaded once: { records, byId, styles }, also kept as
// cache.ready once in. Its files go through a loader of its own, so once the
// records are made nothing holds the parsed columns (src/fragrantica.js
// caches them per loader). A file that doesn't read (cut short) fails as
// UNREADABLE, the parser's message kept as `detail`.
function poolOf(cache) {
  cache.pool ??= (async () => {
    cache.onStatus?.('loading');
    const own = path => cache.load(path);
    const [parsed, styles] = await Promise.all([loadPool(own), loadPoolStyles(own)]);
    const records = Array.from({ length: parsed.count }, (_, i) => fromPool(parsed, i));
    cache.ready = { records, byId: new Map(records.map(r => [r.id, r])), styles };
    cache.onStatus?.('ready');
    return cache.ready;
  })().catch(err => {
    cache.pool = null;
    const shown = isBug(err) ? Object.assign(new Error(UNREADABLE), { detail: err.message }) : err;
    cache.onStatus?.('error', shown.message);
    throw shown;
  });
  return cache.pool;
}

// The last KEEP values made under different keys, newest first.
function kept(list, key, make) {
  const i = list.findIndex(e => e.key === key);
  if (i >= 0) {
    const [hit] = list.splice(i, 1);
    list.unshift(hit);
    return hit.value;
  }
  const value = make();
  list.unshift({ key, value });
  if (list.length > KEEP) list.length = KEEP;
  // A promise that fails isn't kept: the next ask tries again.
  if (value instanceof Promise) {
    value.catch(() => {
      const j = list.findIndex(e => e.value === value);
      if (j >= 0) list.splice(j, 1);
    });
  }
  return value;
}

// The wardrobe sent, ids as strings (the app's are; data/collection.json's are numbers).
function ownedOf(p) {
  if (!Array.isArray(p.owned)) throw new Error('Send the wardrobe (owned) with the question.');
  return p.owned.map(r => (typeof r.id === 'string' ? r : { ...r, id: String(r.id) }));
}

// What a wardrobe's contexts are kept by: its records as they score (one
// changed under the same id, by skin nudges or a re-import, makes a new
// one), leaving out what no score reads.
const UNSCORED = new Set(['layeredWith', 'sentiment', 'description', 'url', 'thumb', 'about']);
const ownedKey = owned => JSON.stringify(owned, (k, v) => (UNSCORED.has(k) ? undefined : v));

// A record's about data (loadAbout), or null; never rejects.
const aboutOf = (cache, id) => (/^\d+$/.test(String(id)) ? loadAbout(id, cache.load).catch(() => null) : Promise.resolve(null));

// A record with its about data attached when its signals need it: a
// visitor's bottle outside the pool (src/candidates.js).
async function withAbout(cache, record, pool) {
  if (record.extras || record.about || poolRowOf(record, pool.byId)) return record;
  const about = await aboutOf(cache, record.id);
  return about ? { ...record, about } : record;
}

// The bottles the wardrobe switched off (`exclude`) as records: as sent,
// else their pool row or r/ record, else just the id (a visitor's bottle
// the dataset lacks).
async function hiddenOf(cache, p, pool) {
  const sent = (Array.isArray(p.exclude) ? p.exclude : []).filter(x => x != null)
    .map(x => (typeof x === 'object' ? { ...x, id: String(x.id) } : { id: String(x) }));
  const lookup = sent.filter(f => !f.accords && !pool.byId.has(f.id)).map(f => f.id);
  const found = lookup.length ? await cache.library.records(lookup).catch(() => new Map()) : new Map();
  return Promise.all(sent.map(f => (f.accords ? withAbout(cache, f, pool) : pool.byId.get(f.id) ?? found.get(f.id) ?? f)));
}

// The wardrobe as the contexts read it, the bottles it switched off, and their key.
function ownedFor(cache, p, pool) {
  const owned = ownedOf(p), key = `${ownedKey(owned)}\n${ownedKey(p.exclude ?? [])}`;
  return kept(cache.owned, key, async () => {
    const [list, hidden] = await Promise.all([Promise.all(owned.map(r => withAbout(cache, r, pool))), hiddenOf(cache, p, pool)]);
    return { key, list, hidden };
  });
}

/**
 * A context with the switched-off bottles (`hidden`, records) counted as
 * owned wherever owned ones are left out (`allowKey`'s owned and originals,
 * the smells-like family, the look-alike vectors), but not in what the
 * wardrobe covers, leans toward or likes: never suggested back, nor their
 * twins, originals or look-alikes, and checks call them owned. `allowKey`
 * is 'allow' for gapContext's, 'allowed' for discoverContext's. The CLI's
 * --exclude goes through it too.
 */
export function excluding(ctx, allowKey, hidden) {
  if (!hidden.length) return ctx;
  const allowed = ctx[allowKey], owned = new Set(allowed.owned), originals = new Set(allowed.originals);
  for (const f of hidden) {
    owned.add(f.id);
    const row = poolRowOf(f, ctx.byId);
    if (row) owned.add(String(row.id));
    if (f.original) originals.add(String(f.original.id));
  }
  const scented = [...ctx.owned, ...hidden.filter(f => f.accords)];
  return { ...ctx, [allowKey]: { ...allowed, owned, originals }, family: familyIndex(ctx.byId, scented), vecs: ownedVectors(scented, ctx.byId) };
}

// Shares from the payload: `shares` as they are, else "How you wear" settings.
const sharesOf = p => p.shares ?? (p.uses ? sharesFrom(p.uses) : null);
const preferOf = (p, owned, pool) => (typeof p.preferValue === 'boolean' ? p.preferValue : preferValueDefault(owned, pool.byId));

async function timed(ms, key, fn) {
  const t = performance.now();
  try {
    return await fn();
  } finally {
    ms[key] = (ms[key] ?? 0) + performance.now() - t;
  }
}

async function gapsFor(cache, p, ms) {
  const pool = await timed(ms, 'pool', () => poolOf(cache));
  const owned = await ownedFor(cache, p, pool);
  const summary = p.summary ?? DEFAULT_CLIMATE, shares = sharesOf(p), preferValue = preferOf(p, owned.list, pool);
  const mists = Boolean(p.mists);
  const key = JSON.stringify([owned.key, summary, shares, preferValue, mists]);
  return timed(ms, 'context', () => kept(cache.gaps, key, () => excluding(
    gapContext({ owned: owned.list, records: pool.records, byId: pool.byId, summary, shares, preferValue, mists }), 'allow', owned.hidden)));
}

async function discoverFor(cache, p, ms) {
  const pool = await timed(ms, 'pool', () => poolOf(cache));
  const owned = await ownedFor(cache, p, pool);
  // Given the records, discoverContext doesn't read the parsed pool, which poolOf lets go.
  const ctx = await timed(ms, 'context', () => kept(cache.discover, owned.key, () => excluding(
    discoverContext(null, owned.list, { styles: pool.styles, records: pool.records }), 'allowed', owned.hidden)));
  return { ctx, pool, preferValue: preferOf(p, owned.list, pool) };
}

// Discover's filters with "Prefer great value" as a value floor (a higher one of their own stays).
const valueFilters = (filters, preferValue) => ({
  ...filters,
  minValue: preferValue ? Math.max(filters?.minValue ?? 0, PREFER_VALUE) : filters?.minValue ?? null,
});

// A bottle from { id } or { record }: an owned one, its pool row, the record
// as sent (when it has accords), else its r/ record. Null when none has it.
async function recordFor(cache, { id, record }, pool, owned) {
  const sent = record && typeof record === 'object' ? record : null;
  const key = String(id ?? sent?.id ?? '');
  if (!key) throw new Error('Say which bottle: send its id or record.');
  return owned.find(f => f.id === key) ?? pool.byId.get(key) ?? (sent?.accords ? { ...sent, id: key } : null)
    ?? (await cache.library.records([key])).get(key) ?? null;
}
const target = x => (x && typeof x === 'object' ? { record: x } : { id: x });

// Picks with the smells-like votes for what each copies, and their why line.
async function finish(cache, picks) {
  await Promise.all(picks.filter(pick => pick.clonesOf).map(async pick => addCloneVotes(pick, await aboutOf(cache, pick.id))));
  return picks.map(pick => ({ ...pick, why: whyLine(pick) }));
}

const recordOf = (ctx, id) => ctx.owned.find(f => f.id === String(id)) ?? ctx.byId.get(String(id)) ?? null;
// A record without the about data attached here for its signals.
const bare = r => (r && 'about' in r ? (({ about, ...rest }) => rest)(r) : r);

const TASKS = {
  async report(p, cache, ms) {
    const ctx = await gapsFor(cache, p, ms);
    const report = await timed(ms, 'task', () => gapReport(ctx, { k: p.k ?? 5 }));
    for (const pick of report.picks) {
      if (pick.twin) pick.twin.record = ctx.byId.get(pick.twin.id) ?? null;
      if (pick.nearest) pick.nearest.record = bare(recordOf(ctx, pick.nearest.id));
    }
    return report;
  },

  async check(p, cache, ms) {
    const ctx = await gapsFor(cache, p, ms);
    // The bottle's styles as Discover shows them (stored for pool rows).
    const { ctx: shown, pool } = await discoverFor(cache, p, ms);
    const liked = (p.liked ?? []).filter(id => STYLE_IDS.has(id));
    const one = async x => {
      const found = await recordFor(cache, x, pool, ctx.owned);
      if (!found) return { id: String(x.id ?? x.record?.id), missing: true };
      const record = await withAbout(cache, found, pool);
      // The liked styles judge it too (buyCheck's `liked`: a skin scent for
      // someone who loves them is more than "covered").
      const check = buyCheck(record, ctx, { liked: liked.length ? liked : null }), out = checkJSON(record, check);
      if (out.overlap) out.overlap.record = bare(check.overlap.bottle);
      if (out.twin) out.twin.record = check.twin.record;
      const scores = scoresOf(found, shown);
      return {
        ...out,
        record: bare(found),
        styles: topOf(scores),
        close: closeOf(scores),
        likedShown: liked.filter(id => (id === 'intimate' ? closeOf(scores) : scores[id] >= STYLE_MIN)),
      };
    };
    const many = p.ids ?? p.records;
    if (Array.isArray(many)) {
      const checks = await timed(ms, 'task', () => Promise.all(many.map(x => one(target(x)))));
      return { checks, preferValue: ctx.preferValue };
    }
    const check = await timed(ms, 'task', () => one(p));
    if (check.missing) throw new Error('That bottle isn’t in the fragrance library.');
    return { ...check, preferValue: ctx.preferValue };
  },

  async liked(p) {
    const owned = ownedOf(p), mix = styleMix(owned);
    const withIds = list => list.map(s => ({ ...s, ids: s.id === 'intimate' ? mix.intimateIds : mix.ids[s.id] ?? [] }));
    // The styles someone says they love, while the wardrobe holds them; else what it leans toward.
    const stated = p.stated?.length ? likedStyles(owned, { stated: p.stated }) : [];
    if (stated.length) return { styles: withIds(stated), from: 'stated' };
    return { styles: withIds(likedStyles(owned)), from: 'wardrobe' };
  },

  async styles(p, cache, ms) {
    const { ctx, preferValue } = await discoverFor(cache, p, ms);
    const styles = (p.styles ?? []).filter(id => STYLE_IDS.has(id)), mode = p.mode ?? 'any';
    const filters = valueFilters(p.filters, preferValue);
    const picks = await timed(ms, 'task', () => finish(cache, moreOfStyles(styles, ctx, { mode, k: p.k ?? 10, filters })));
    return { styles, mode, picks, preferValue };
  },

  async moreLike(p, cache, ms) {
    const { ctx, pool, preferValue } = await discoverFor(cache, p, ms);
    let seeds, from = 'given';
    if (p.seeds?.length) {
      seeds = (await Promise.all(p.seeds.map(x => recordFor(cache, target(x), pool, ctx.owned)))).filter(Boolean);
      if (!seeds.length) throw new Error('None of those bottles are in the fragrance library.');
    } else {
      ({ seeds, from } = defaultSeeds(ctx.owned, { history: p.history ?? [], todayISO: p.todayISO ?? null }));
    }
    // "Fans also like" reads the seeds' about data.
    const withLikes = await Promise.all(seeds.map(async s => (s.about ? s : { ...s, about: await aboutOf(cache, s.id) })));
    const filters = valueFilters(p.filters, preferValue);
    const picks = await timed(ms, 'task', () => finish(cache, moreLike(withLikes, ctx, { k: p.k ?? 10, filters })));
    return { seeds: seeds.map(bare), from, picks, preferValue };
  },

  async notes(p, cache, ms) {
    const { ctx, preferValue } = await discoverFor(cache, p, ms);
    const query = String(p.query ?? '');
    const { results, ...found } = await timed(ms, 'task', () => searchNotes(query, ctx, valueFilters(p.filters, preferValue), { k: p.k ?? 10 }));
    const picks = await timed(ms, 'task', () => finish(cache, results));
    return { query, ...found, picks, preferValue };
  },

  async dupes(p, cache, ms) {
    const { ctx, pool } = await discoverFor(cache, p, ms);
    const found = await recordFor(cache, p, pool, ctx.owned);
    if (!found) throw new Error('That bottle isn’t in the fragrance library.');
    // Its own smells-like votes, and the bottles they name outside the pool.
    const record = found.about ? found : { ...found, about: await aboutOf(cache, found.id) };
    const more = await cache.library.records(dupeIds(record, ctx));
    await Promise.all([...more.values()].map(async r => { r.about = await aboutOf(cache, r.id); }));
    const family = await timed(ms, 'task', () => dupesOf(record, ctx, { more }));
    const out = e => e && { ...e, record: bare(e.record) };
    return { record: bare(found), original: out(family.original), cheaper: family.cheaper.map(out), siblings: family.siblings.map(out) };
  },

  async records(p, cache) {
    const ids = [...new Set((p.ids ?? []).map(String))];
    // The pool's rows carry their signals, once it's in (this never waits for
    // it); the rest load from r/.
    const pool = cache.ready;
    const out = new Map(ids.flatMap(id => (pool?.byId.has(id) ? [[id, pool.byId.get(id)]] : [])));
    const rest = ids.filter(id => !out.has(id));
    if (rest.length) for (const [id, r] of await cache.library.records(rest)) out.set(id, r);
    return { records: ids.filter(id => out.has(id)).map(id => out.get(id)), missing: ids.filter(id => !out.has(id)) };
  },

  async warm(p, cache, ms) {
    const pool = await timed(ms, 'pool', () => poolOf(cache));
    return { count: pool.records.length };
  },
};

export const POOL_TASKS = Object.keys(TASKS);

/** One message in, its answer out (never throws). */
export async function handlePool(msg, cache) {
  const { id = null, type, payload = {} } = msg ?? {};
  const ms = {}, t0 = performance.now();
  try {
    if (!Object.hasOwn(TASKS, type)) throw new Error(`Unknown question "${type}".`);
    const result = await TASKS[type](payload ?? {}, cache, ms);
    ms.total = performance.now() - t0;
    return { id, type, result, ms };
  } catch (err) {
    const bug = isBug(err), detail = err?.detail ?? (bug ? err.message : null);
    return { id, type, error: bug ? SORRY : err?.message || SORRY, ...(detail && { detail }) };
  }
}

// Questions answered as they come, beside the queue: `liked` needs no pool
// and `records` never waits for it, so neither sits behind the pool's
// download or another question's work.
export const QUICK = new Set(['liked', 'records']);

// A macrotask between questions, so a cancel posted meanwhile lands first.
const breathe = () => new Promise(resolve => setTimeout(resolve, 0));

/**
 * The pool's side of the conversation, for a module Worker
 * (src/pool-worker.js) or its stand-in on the main thread: a cache of its
 * own, and a function taking each message in. It answers through `post`:
 * { type: 'status', status, error } as the pool loads, { type: 'start', id }
 * as each question starts (the asker times it from there), then its answer.
 * QUICK questions start at once; the rest one at a time, in the order asked.
 * { type: 'cancel', id } drops a question that hasn't started. An answer
 * that can't be posted (a DataCloneError) goes back as an apology instead.
 */
export function poolServer(post, { load } = {}) {
  const send = data => {
    try {
      post(data);
    } catch (err) {
      if (data?.id == null) return;
      try { post({ id: data.id, type: data.type, error: SORRY, detail: err?.message ?? String(err) }); } catch {}
    }
  };
  const cache = newPoolCache({ ...(load && { load }), onStatus: (status, error = null) => send({ type: 'status', status, error }) });
  let queue = [], busy = false;

  async function run(msg) {
    send({ type: 'start', id: msg?.id ?? null });
    send(await handlePool(msg, cache));
  }

  async function pump() {
    if (busy) return;
    busy = true;
    try {
      while (queue.length) {
        await run(queue.shift());
        await breathe();
      }
    } finally {
      busy = false;
    }
  }

  return data => {
    if (data?.type === 'cancel') queue = queue.filter(m => m.id !== data.id);
    else if (QUICK.has(data?.type)) run(data);
    else {
      queue.push(data);
      pump();
    }
  };
}
