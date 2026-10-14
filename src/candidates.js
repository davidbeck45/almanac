// What the gap finder and Discover need to know about a bottle someone might
// buy, beyond how it smells (src/similar.js): its signals in one shape, whether
// voters call it a copy of something owned, the filters every suggestion
// passes, what it's worth beyond its fit, a cheaper twin and how risky a blind
// buy it is. Pure (no DOM, no fetch), so a module Worker can use it.
//
// Signals ride on records as `extras` (pool records from fromPool, owned ones
// from data/extras.jsonl via the build; see CLAUDE.md). A bottle the dataset
// lacks (hand-entered, newer) has none: it reads as unknown, never as bad.
import { performanceRating } from './engine.js';
import { normalize } from './collections.js';
import { similarity } from './similar.js';

// Fragrantica's gender label as a crowd lean (-1 feminine .. +1 masculine):
// the pool's median lean per label, for bottles without crowd votes.
const LABEL_LEAN = { men: 0.68, women: -0.75, 'women and men': -0.07 };
// A suggestion's lean stays within the wardrobe's 10th to 90th percentile,
// widened by LEAN_MARGIN either side; under LEAN_MIN_BOTTLES known leans, any.
export const LEAN_MARGIN = 0.4;
const LEAN_MIN_BOTTLES = 3;
export const MIN_RATING = 3.8;

// How far voters' "smells like" links put a bottle from the wardrobe, as a
// multiplier on its novelty. A family link (voters call them one scent: dupes,
// clones, twins) to an owned bottle or an owned dupe's original makes a twin;
// two family links, or a plain smells-like link, the same family.
// A flanker (same brand and line) counts from FLANKER_SIM similarity: Supremacy
// Silver is a version of Supremacy Collector's Edition, Supremacy Noir (0.05)
// a new direction.
export const FAMILY_MULT = { owned: 0, original: 0.15, near: 0.15, flanker: 0.3, family: 0.6 };
const FLANKER_SIM = 0.3;

// Quality: the rating shrunk toward the pool's median by RATING_PRIOR_VOTES,
// how much more often owners keep it than pages that old (`keep`), and value
// for money, each a bounded multiplier.
const RATING_PRIOR_VOTES = 1000;
const RATING_RANGE = [0.75, 1.2];
const KEEP_RANGE = [0.8, 1.1];
const VALUE_RANGE = [0.85, 1.15];
// How much value counts, learned from the wardrobe: VALUE_SLOPE + 0.1 × how
// far its median value sits above the pool's, within VALUE_SLOPE_RANGE. A
// wardrobe at a median of PREFER_VALUE or more prefers great value by default.
const VALUE_SLOPE = 0.08;
const VALUE_SLOPE_RANGE = [0.05, 0.25];
export const PREFER_VALUE = 3.8;

// Risk: a safety percentile under SAFE_LOW (SAFE_VERY_LOW counts double),
// owners parting with it (keep under KEEP_LOW, the pool's bottom tenth),
// longevity under WEAK_LONGEVITY on Parfumo's scale (the pool's bottom tenth)
// from WEAK_VOTES votes. RISK_HIGH points or more is high, RISK_MEDIUM medium:
// one minor reason (reformulated, hard to find) is still low, and says so.
const SAFE_LOW = 20;
const SAFE_VERY_LOW = 8;
const KEEP_LOW = -0.085;
const WEAK_LONGEVITY = 6.2;
const WEAK_VOTES = 30;
const RISK_HIGH = 3;
const RISK_MEDIUM = 2;

const clamp = (x, [lo, hi]) => Math.min(hi, Math.max(lo, x));
const median = xs => {
  const s = xs.filter(x => x != null && !Number.isNaN(x)).sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};
const ids = list => (list ?? []).map(String);

const signals = new WeakMap();
/**
 * A record's signals, pool or owned alike: { known, value, safe, keep, lean,
 * now, like, family, alt, clones, flags }. Ids are strings; numbers are null
 * and lists empty when the dataset has nothing (known false).
 */
export function signalsOf(record) {
  let s = signals.get(record);
  if (s) return s;
  const x = record.extras;
  s = {
    known: Boolean(x),
    value: x?.value ?? record.about?.value?.avg ?? null,
    safe: x?.safe ?? null,
    keep: x?.keep ?? null,
    lean: x?.lean ?? record.about?.crowdGender?.lean ?? null,
    now: x?.now ?? null,
    like: ids(x?.like),
    family: ids(x?.family),
    alt: ids(x?.alt),
    clones: ids(x?.clones),
    flags: [...(x?.flags ?? [])],
  };
  signals.set(record, s);
  return s;
}

const flagged = (record, flag) => signalsOf(record).flags.includes(flag);

const knownLean = record => signalsOf(record).lean ?? LABEL_LEAN[record.gender] ?? null;

/** -1 feminine .. +1 masculine: the crowd's vote, else Fragrantica's label, else 0. */
export const genderLean = record => knownLean(record) ?? 0;

/** [lo, hi]: the leans a wardrobe spans (10th to 90th percentile), widened by `margin`. */
export function leanWindow(owned, margin = LEAN_MARGIN) {
  const leans = owned.map(knownLean).filter(x => x != null).sort((a, b) => a - b);
  if (leans.length < LEAN_MIN_BOTTLES) return [-1, 1];
  const at = p => leans[Math.min(leans.length - 1, Math.floor(p * leans.length))];
  return [Math.max(-1, at(0.1) - margin), Math.min(1, at(0.9) + margin)];
}

/**
 * What allow() checks against, from the wardrobe: { owned, originals (id
 * Sets), lean [lo, hi], minRating, minValue }. `minValue` (null: none) is for
 * a "great value only" filter.
 */
export function allowContext(owned, { margin = LEAN_MARGIN, minRating = MIN_RATING, minValue = null } = {}) {
  return {
    owned: new Set(owned.map(f => String(f.id))),
    originals: new Set(owned.filter(f => f.original).map(f => String(f.original.id))),
    lean: leanWindow(owned, margin),
    minRating,
    minValue,
  };
}

/** Whether a bottle may be suggested: not owned or an owned dupe's original, not brigaded, rated well, in the lean window. */
export function allow(record, ctx) {
  const id = String(record.id);
  if (ctx.owned.has(id) || ctx.originals.has(id) || flagged(record, 'brigaded')) return false;
  if (!(record.rating >= ctx.minRating)) return false;
  if (ctx.minValue != null && !(signalsOf(record).value >= ctx.minValue)) return false;
  const lean = genderLean(record);
  return lean >= ctx.lean[0] && lean <= ctx.lean[1];
}

/** The pool's medians, which quality is measured against: { rating, keep, value }. */
export function poolNorms(records) {
  return {
    rating: median(records.map(r => r.rating)),
    keep: median(records.map(r => signalsOf(r).keep)),
    value: median(records.map(r => signalsOf(r).value)),
  };
}

/**
 * What a candidate is worth beyond its fit: { mult, rating, keep, value },
 * mult about 0.5 to 1.5 (1 for a bottle at the pool's medians). `valueSlope`
 * as valueSlope().
 */
export function candidateQuality(record, norms, { valueSlope: slope = VALUE_SLOPE } = {}) {
  const s = signalsOf(record), votes = record.ratingVotes ?? 0;
  const rating = (votes * (record.rating ?? 0) + RATING_PRIOR_VOTES * norms.rating) / (votes + RATING_PRIOR_VOTES);
  const keep = s.keep ?? norms.keep, value = s.value ?? norms.value;
  const mult = clamp(1 + (rating - norms.rating), RATING_RANGE)
    * clamp(1 + (keep - norms.keep), KEEP_RANGE)
    * clamp(1 + slope * (value - norms.value), VALUE_RANGE);
  return { mult, rating, keep, value };
}

/** How much value for money counts in quality, from how the wardrobe buys (David's 4.2 against the pool's 3.0: 0.2). */
export function valueSlope(owned, norms) {
  const mine = median(owned.map(f => signalsOf(f).value));
  if (mine == null) return VALUE_SLOPE;
  return clamp(VALUE_SLOPE + 0.1 * (mine - norms.value), VALUE_SLOPE_RANGE);
}

/** Whether "Prefer great value" starts on: the wardrobe's median value is PREFER_VALUE or more. */
export const preferValueDefault = owned => (median(owned.map(f => signalsOf(f).value)) ?? 0) >= PREFER_VALUE;

// A brand's line, for flankers: a name's first word, or its first two when
// the first is short or a common scent word ("Amber Empire", "CH Men Prive").
const COMMON_WORDS = new Set(('amber oud musk musc vanilla vanille rose cream white black blue red pink green gold golden silver royal ' +
  'pure noir nuit night eau essence wood woods bois leather cuir tobacco tabac sandalwood santal cedar velvet sweet fresh ' +
  'intense extreme extrait elixir parfum spirit dark light the pour for my mon ma le la les l club').split(' '));
function lineOf(name) {
  const words = normalize(name).split(' ');
  return words[0].length >= 4 && !COMMON_WORDS.has(words[0]) ? words[0] : words.slice(0, 2).join(' ');
}

/**
 * The "smells like" family around a wardrobe. byId: Map of id -> record (the
 * pool, as fromPool makes them); owned: the wardrobe's records, a dupe's
 * `original` counting as owned. Family links run both ways; a bottle outside
 * byId is placed by its own links. Returns { dupeOf, near, family }:
 * dupeOf(record) -> { mult, kind, via, text } | null, `via` the owned record
 * it ties to; kind and mult as FAMILY_MULT: owned, original (of an owned
 * dupe), near (a family link away), flanker (same brand and line), family
 * (two family links, or a plain smells-like link). `near` and `family` count
 * the pool bottles of each.
 */
export function familyIndex(byId, owned) {
  const links = new Map();
  const link = (a, b) => {
    if (a === b) return;
    (links.get(a) ?? links.set(a, new Set()).get(a)).add(b);
    (links.get(b) ?? links.set(b, new Set()).get(b)).add(a);
  };
  const linkAll = r => { for (const id of signalsOf(r).family) link(String(r.id), id); };
  for (const r of byId.values()) linkAll(r);

  // The wardrobe and its originals: id -> { record, via (owned record), name, original }.
  const seeds = new Map();
  for (const f of owned) seeds.set(String(f.id), { record: f, via: f, name: f.name, original: false });
  for (const f of owned) {
    linkAll(f);
    if (!f.original) continue;
    linkAll(f.original);
    const id = String(f.original.id);
    if (!seeds.has(id)) seeds.set(id, { record: f.original, via: f, name: f.original.name, original: true });
  }
  const nameOf = id => byId.get(id)?.name ?? seeds.get(id)?.name ?? null;

  const near = new Map(), twoHops = new Map(), like = new Map();
  for (const [id, seed] of seeds) for (const n of links.get(id) ?? []) if (!seeds.has(n) && !near.has(n)) near.set(n, seed);
  for (const [id, seed] of near) {
    for (const n of links.get(id) ?? []) if (!seeds.has(n) && !near.has(n) && !twoHops.has(n)) twoHops.set(n, { seed, mid: id });
  }
  const likeLink = (id, seed) => { if (!seeds.has(id) && !near.has(id) && !like.has(id)) like.set(id, seed); };
  for (const seed of seeds.values()) for (const n of signalsOf(seed.record).like) likeLink(n, seed);
  for (const r of byId.values()) for (const n of signalsOf(r).like) if (seeds.has(n)) likeLink(String(r.id), seeds.get(n));

  const lines = new Map(); // brand -> [[line, owned record]]
  for (const f of owned) {
    const brand = normalize(f.brand ?? '');
    lines.set(brand, [...(lines.get(brand) ?? []), [lineOf(f.name), f]]);
  }
  const flankerOf = r => {
    const name = normalize(r.name ?? '');
    const same = ([line, f]) => (name === line || name.startsWith(`${line} `)) && similarity(r, f) >= FLANKER_SIM;
    return (lines.get(normalize(r.brand ?? '')) ?? []).find(same)?.[1] ?? null;
  };

  const yours = seed => (seed.original ? `${seed.name}, the original of your ${seed.via.name}` : `your ${seed.name}`);
  const result = (kind, via, text) => ({ mult: FAMILY_MULT[kind], kind, via, text });
  const memo = new WeakMap();
  const dupeOf = record => {
    if (!memo.has(record)) memo.set(record, place(record));
    return memo.get(record);
  };
  function place(record) {
    const id = String(record.id), seed = seeds.get(id);
    if (seed) return seed.original ? result('original', seed.via, `The original of your ${seed.via.name}`) : result('owned', seed.via, 'You own it');
    const own = signalsOf(record);
    const nearSeed = near.get(id) ?? seeds.get(own.family.find(n => seeds.has(n)));
    if (nearSeed) return result('near', nearSeed.via, `Voters call it a twin of ${yours(nearSeed)}`);
    const flank = flankerOf(record);
    if (flank) return result('flanker', flank, `A version of your ${flank.name}`);
    const mid = own.family.find(n => near.has(n));
    const two = twoHops.get(id) ?? (mid && { seed: near.get(mid), mid });
    if (two) {
      const through = nameOf(two.mid);
      return result('family', two.seed.via, `In the family of your ${two.seed.via.name}${through ? `, through ${through}` : ''}`);
    }
    const likeSeed = like.get(id) ?? seeds.get(own.like.find(n => seeds.has(n)));
    if (likeSeed) return result('family', likeSeed.via, `Voters say it smells like ${yours(likeSeed)}`);
    return null;
  }
  const inPool = keys => [...new Set(keys)].filter(id => byId.has(id)).length;
  return { dupeOf, near: inPool(near.keys()), family: inPool([...twoHops.keys(), ...like.keys()]) };
}

/**
 * A cheaper bottle voters say smells like this one (its `alt`, most agreed
 * first), from byId and not brigaded or discontinued: { record, value, text }
 * or null.
 */
export function cheaperTwin(record, byId) {
  for (const id of signalsOf(record).alt) {
    const twin = byId.get(id);
    if (!twin || flagged(twin, 'brigaded') || flagged(twin, 'discontinued')) continue;
    return { record: twin, value: signalsOf(twin).value, text: `${twin.name} by ${twin.brand} smells like it, for far less.` };
  }
  return null;
}

/**
 * How risky a blind buy it is: { level: 'low' | 'medium' | 'high', reasons },
 * reasons short plain sentences, the weightiest first. A bottle without
 * signals is low with none.
 */
export function riskOf(record) {
  const s = signalsOf(record), found = [];
  const add = (points, text) => found.push({ points, text });
  if (s.flags.includes('brigaded')) add(2, 'Its rating looks inflated by a voting campaign.');
  if (s.flags.includes('notBlindBuy')) add(2, 'Reviewers say it isn’t a safe blind buy.');
  if (s.flags.includes('polarizing')) add(2, 'It divides people: many voters hate it.');
  else if (s.safe != null && s.safe < SAFE_LOW) add(s.safe < SAFE_VERY_LOW ? 2 : 1, 'Fewer voters love it than most.');
  if (s.keep != null && s.keep < KEEP_LOW) add(1, 'Owners often let it go.');
  if (s.flags.includes('discontinued')) add(1, 'Reviewers say it’s discontinued.');
  if (s.flags.includes('reformulated')) add(1, 'Reviewers say it was reformulated.');
  if (s.flags.includes('hardToFind')) add(1, 'It’s hard to find in stock.');
  const p = performanceRating(record);
  if (p?.longevity != null && p.votes >= WEAK_VOTES && p.longevity < WEAK_LONGEVITY) add(1, 'It doesn’t last long.');
  const points = found.reduce((sum, r) => sum + r.points, 0);
  return {
    level: points >= RISK_HIGH ? 'high' : points >= RISK_MEDIUM ? 'medium' : 'low',
    reasons: found.sort((a, b) => b.points - a.points).map(r => r.text),
  };
}
