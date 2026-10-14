// Every question the app asks of the suggestion pool, answered in one place:
// src/pool-worker.js runs them in a module Worker, src/app/pool.js asks them
// (or runs them here on the main thread when module Workers fail), and tests
// run them in Node. A cache (newPoolCache) loads the pool, its notes and its
// style scores once, and keeps each wardrobe's gap and Discover contexts for
// the last few wardrobes asked about, so only the first ask pays for them.
//
// handlePool({ id, type, payload }, cache) -> { id, type, result, ms } or,
// when it fails, { id, type, error } with a message fit to show (`detail`
// holds the raw one for a bug); `id` is the asker's, echoed. Payloads are
// plain JSON; `owned` is the wardrobe's engine records (activeFragrances()),
// and preferValue true or false turns "Prefer great value" on or off (only
// bottles voters value PREFER_VALUE or more, everywhere), null the
// wardrobe's default (preferValueDefault). Every bottle an answer brings in
// comes with its full engine record (`record`, ids as strings); owned ones
// may come as stubs (the asker has them). The questions that suggest bottles
// say which preferValue they used. By type, payload -> result:
//   report   { owned, summary?, shares? | uses?, preferValue?, k? }
//            -> gapReport; each pick's twin and nearest carry their records
//   check    { owned, id | record (or ids | records), liked?, summary?, shares? | uses?, preferValue? }
//            -> checkJSON plus the bottle's record, styles and the liked styles it shows
//               ({ checks } for several)
//   liked    { owned, stated? } -> { styles: likedStyles with ids, from: 'stated' | 'wardrobe' }
//   styles   { owned, styles, mode?, k?, filters?, preferValue? } -> { styles, mode, picks }
//   moreLike { owned, seeds? (ids or records; else the most worn: history, todayISO), k?, filters?, preferValue? }
//            -> { seeds, from: 'given' | 'worn' | 'rated', picks }
//   notes    { owned, query, filters?, k?, preferValue? } -> searchNotes' fields, its results as `picks`
//   dupes    { owned, id | record } -> { record, original, cheaper, siblings }
//   records  { ids } -> { records (pool rows first, else r/), missing }
//   warm     {} -> { count }: loads the pool
// Picks are src/discover.js's (record, styles, nearest, clonesOf, twin,
// alike, risk, …) with `why`, the line whyLine writes.
import { loadPool, fromPool, loadPoolStyles, loadAbout, fragranticaLibrary } from './fragrantica.js';
import { poolRowOf, preferValueDefault, PREFER_VALUE } from './candidates.js';
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

async function fetchLoad(path) {
  let res;
  try {
    res = await fetch(new URL(path, DATA));
  } catch {
    throw new Error('Can’t reach the fragrance library. Check your connection.');
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`The fragrance library didn’t load (${res.status}).`);
  return res.text();
}

/**
 * A cache for handlePool. `load(path)` resolves a file under
 * data/fragrantica/ as text, or null when there's none (default: fetch next
 * to src/); `onStatus(status, error)` hears 'loading', 'ready' and 'error' as
 * the pool loads.
 */
export function newPoolCache({ load = fetchLoad, onStatus = null } = {}) {
  return { load, onStatus, pool: null, owned: [], gaps: [], discover: [], library: fragranticaLibrary(load) };
}

// The pool's records, loaded once: { records, byId, styles }. Its files go
// through a loader of its own, so once the records are made nothing holds
// the parsed columns (src/fragrantica.js caches them per loader).
function poolOf(cache) {
  cache.pool ??= (async () => {
    cache.onStatus?.('loading');
    const own = path => cache.load(path);
    const [parsed, styles] = await Promise.all([loadPool(own), loadPoolStyles(own)]);
    const records = Array.from({ length: parsed.count }, (_, i) => fromPool(parsed, i));
    cache.onStatus?.('ready');
    return { records, byId: new Map(records.map(r => [r.id, r])), styles };
  })().catch(err => {
    cache.pool = null;
    cache.onStatus?.('error', err.message);
    throw err;
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

// The wardrobe as the contexts read it, and its key.
function ownedFor(cache, p, pool) {
  const owned = ownedOf(p), key = ownedKey(owned);
  return kept(cache.owned, key, () => Promise.all(owned.map(r => withAbout(cache, r, pool))).then(list => ({ key, list })));
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
  const key = JSON.stringify([owned.key, summary, shares, preferValue]);
  return timed(ms, 'context', () => kept(cache.gaps, key, () => gapContext({ owned: owned.list, records: pool.records, byId: pool.byId, summary, shares, preferValue })));
}

async function discoverFor(cache, p, ms) {
  const pool = await timed(ms, 'pool', () => poolOf(cache));
  const owned = await ownedFor(cache, p, pool);
  // Given the records, discoverContext doesn't read the parsed pool, which poolOf lets go.
  const ctx = await timed(ms, 'context', () => kept(cache.discover, owned.key, () => discoverContext(null, owned.list, { styles: pool.styles, records: pool.records })));
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
      const check = buyCheck(record, ctx), out = checkJSON(record, check);
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
    // The pool's rows carry their signals; the rest load from r/ (offline, r/ alone).
    const pool = await poolOf(cache).catch(() => null);
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

// Errors from the modules and the loader are written to be read; anything
// else is a bug, which the app shouldn't show as it is.
const BUGS = [TypeError, RangeError, ReferenceError, SyntaxError];
const SORRY = 'Something went wrong working that out. Try again.';

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
    const bug = BUGS.some(E => err instanceof E);
    return { id, type, error: bug ? SORRY : err?.message || SORRY, ...(bug && { detail: err.message }) };
  }
}
