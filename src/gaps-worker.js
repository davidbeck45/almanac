// The gap finder off the main thread (a module Worker: new Worker(new
// URL('./gaps-worker.js', import.meta.url), { type: 'module' })). It loads the
// suggestion pool once, keeps its records and drops the parsed file, and
// answers two messages, each echoing the request's `id`:
//   { type: 'report', owned, summary, shares | uses, preferValue, mists, k }
//     -> { type: 'report', report } (gapReport in src/gaps.js: overview, gaps,
//        strengths, the coverage grid, picks with fills, twins and risk), plus
//        `ms` timings
//   { type: 'check', record, liked?, owned?, summary?, shares? | uses?, preferValue?, mists? }
//     -> { type: 'check', check } (checkJSON: the buy check's verdict and
//        reasons; `liked`, the style ids someone likes, makes it taste-aware)
// A check without a wardrobe uses the last report's. Errors come back as
// { type: 'error', message }. owned are the wardrobe's engine records;
// summary a climate summary (src/climate.js; DEFAULT_CLIMATE when null or
// missing); shares from sharesFrom, or `uses`, the "How you wear" settings
// (loadUses), turned into shares here; preferValue null for the wardrobe's
// default.
// handle() answers one message, for running it elsewhere (dev/gaps.html
// times it on the main thread, where DevTools can throttle the CPU).
import { loadPool, fromPool, loadAbout } from './fragrantica.js';
import { poolRowOf } from './candidates.js';
import { gapContext, gapReport, buyCheck, checkJSON, DEFAULT_CLIMATE } from './gaps.js';
import { sharesFrom } from './uses.js';

const DATA = new URL('../data/fragrantica/', import.meta.url);

// A loader of our own: once the records are made, nothing holds it, so the
// pool's parsed columns (cached per loader in src/fragrantica.js) go with it.
const loader = () => async path => {
  let res;
  try {
    res = await fetch(new URL(path, DATA));
  } catch {
    throw new Error('Can’t reach the fragrance library. Check your connection.');
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`The fragrance library didn’t load (${res.status}).`);
  return res.text();
};
const aboutLoad = loader();

let pool = null;
function poolRecords() {
  pool ??= (async () => {
    const parsed = await loadPool(loader());
    const records = Array.from({ length: parsed.count }, (_, i) => fromPool(parsed, i));
    return { records, byId: new Map(records.map(r => [r.id, r])) };
  })().catch(err => {
    pool = null;
    throw err;
  });
  return pool;
}

// A visitor's bottles outside the pool read their signals from their about
// data (src/candidates.js); load it once per bottle.
const abouts = new Map();
async function withAbout(records, byId) {
  return Promise.all(records.map(async r => {
    if (r.extras || r.about || poolRowOf(r, byId) || !/^\d+$/.test(String(r.id))) return r;
    if (!abouts.has(String(r.id))) abouts.set(String(r.id), loadAbout(r.id, aboutLoad).catch(() => null));
    const about = await abouts.get(String(r.id));
    return about ? { ...r, about } : r;
  }));
}

// What a context is cached on: the wardrobe's records as they score (a record
// changed under the same id, by skin nudges or a re-import, makes a new one),
// leaving out what no score reads.
const UNSCORED = new Set(['layeredWith', 'sentiment', 'description', 'url', 'thumb']);
const ownedKey = owned => JSON.stringify(owned, (k, v) => (UNSCORED.has(k) ? undefined : v));

let last = null; // { key, ctx }
async function contextFor({ owned, summary, shares = null, uses = null, preferValue = null, mists = false }, timings) {
  summary ??= DEFAULT_CLIMATE;
  shares ??= uses ? sharesFrom(uses) : null;
  const key = JSON.stringify([ownedKey(owned), summary, shares, preferValue, Boolean(mists)]);
  if (last?.key === key) return last.ctx;
  const t0 = performance.now();
  const { records, byId } = await poolRecords();
  const t1 = performance.now();
  const ctx = gapContext({ owned: await withAbout(owned, byId), records, byId, summary, shares, preferValue, mists: Boolean(mists) });
  Object.assign(timings, { pool: t1 - t0, context: performance.now() - t1 });
  last = { key, ctx };
  return ctx;
}

/** One message in, its answer out (never throws). */
export async function handle(data) {
  const { id = null, type } = data;
  const ms = {};
  try {
    if (type === 'report') {
      const ctx = await contextFor(data, ms);
      const t = performance.now();
      const report = gapReport(ctx, { k: data.k ?? 5 });
      ms.report = performance.now() - t;
      return { id, type, report, ms };
    }
    if (type === 'check') {
      const ctx = data.owned ? await contextFor(data, ms) : last?.ctx;
      if (!ctx) throw new Error('Run a report first, or send the wardrobe with the check.');
      // A pool bottle checks as the suggestions see it, with its signals.
      const [record] = await withAbout([ctx.byId.get(String(data.record.id)) ?? data.record], ctx.byId);
      return { id, type, check: checkJSON(record, buyCheck(record, ctx, { liked: data.liked ?? null })), ms };
    }
    throw new Error(`Unknown message type "${type}".`);
  } catch (err) {
    return { id, type: 'error', message: err.message };
  }
}

if (typeof WorkerGlobalScope === 'function' && self instanceof WorkerGlobalScope) {
  self.onmessage = async ({ data }) => self.postMessage(await handle(data));
}
