// What the gap finder and Discover need to know about a bottle someone might
// buy, beyond how it smells (src/similar.js): its signals in one shape, whether
// voters call it a copy of something owned, how new it would be, the filters
// every suggestion passes, what it's worth beyond its fit, a cheaper twin and
// how risky a blind buy it is. Pure (no DOM, no fetch), so a module Worker can
// use it.
//
// Signals ride on records as `extras` (pool records from fromPool, the demo's
// and catalog's from data/extras.jsonl via the build; see CLAUDE.md). A
// visitor's bottles and share-link ones load from r/ without them, so every
// function that reads them takes `byId` (the pool) and reads the bottle's pool
// row instead, else its `about` (loadAbout). A bottle with none of these
// (hand-entered, newer than the dataset) reads as unknown, never as bad.
import { performanceRating } from './engine.js';
import { normalize, sameBottle } from './collections.js';
import { scentVector, similarity } from './similar.js';

// Fragrantica's gender label as a crowd lean (-1 feminine .. +1 masculine):
// the pool's median lean per label, for bottles without crowd votes.
const LABEL_LEAN = { men: 0.68, women: -0.75, 'women and men': -0.07 };
// A suggestion's lean stays within the wardrobe's 10th to 90th percentile,
// widened by LEAN_MARGIN either side. Under MIN_BOTTLES known leans, any;
// under MIN_BOTTLES known values, the default value slope.
export const LEAN_MARGIN = 0.4;
const MIN_BOTTLES = 3;
export const MIN_RATING = 3.8;

// As scripts/decant.py, for signals read from a bottle's about data: value
// leans to VALUE_PRIOR by VALUE_PRIOR_VOTES votes; a smells-like vote counts
// from LIKE_MIN_NET net votes and 2:1 (the top LIKE_TOP are `like`), a family
// one from FAMILY_MIN_UP agreeing and FAMILY_RATIO × the disagreeing.
const VALUE_PRIOR = 3.1;
const VALUE_PRIOR_VOTES = 20;
const LIKE_MIN_NET = 5;
const LIKE_TOP = 3;
const FAMILY_MIN_UP = 30;
const FAMILY_RATIO = 2.5;

// How far voters' "smells like" links put a bottle from the wardrobe, as a
// multiplier on its novelty. A family link (voters call them one scent: dupes,
// clones, twins) to an owned bottle or an owned dupe's original makes a twin;
// two family links, or a plain smells-like link, the same family.
// A flanker (same brand and line) counts from FLANKER_SIM similarity: Supremacy
// Silver is a version of Supremacy Collector's Edition, Supremacy Noir (0.05)
// a new direction.
export const FAMILY_MULT = { owned: 0, original: 0.15, near: 0.15, flanker: 0.3, family: 0.6 };
const FLANKER_SIM = 0.3;
// Novelty: NOVELTY_FLOOR + NOVELTY_SLOPE × (1 - similarity to the nearest
// owned bottle or original), at most 1, times the family multiplier: a bottle
// under 0.6 alike is fully new.
const NOVELTY_FLOOR = 0.35;
const NOVELTY_SLOPE = 1.6;

// Quality: the rating shrunk toward the pool's median by RATING_PRIOR_VOTES,
// how much more often owners keep it than pages that old (`keep`), and value
// for money, each a bounded multiplier.
const RATING_PRIOR_VOTES = 1000;
const RATING_RANGE = [0.75, 1.2];
const KEEP_RANGE = [0.8, 1.1];
const VALUE_RANGE = [0.85, 1.15];
// Reach: how much a bottle's fans also like the pool's most-owned bottles
// (`reach`, scripts/decant.py; the pool's median 0.85). Under REACH_FULL its
// fans are a crowd of their own, most often a home market's (Granado, Phebo,
// Natura and O Boticário sit about 0.2), and the bottle is likelier hard to
// buy elsewhere: it counts for up to REACH_DAMP less, at no reach. Owners
// don't show it: Granado has as many per rating as Lattafa.
const REACH_FULL = 0.35;
const REACH_DAMP = 0.2;
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
const round2 = x => Math.round(x * 100) / 100;

const byName = new WeakMap(); // byId -> Map of normalized name -> pool records
/**
 * A record's pool row: by id, or for a bottle kept under another id (an old
 * fg: share link, one entered by hand with its brand) by name and brand, the
 * most voted when several match. Null outside the pool.
 */
export function poolRowOf(record, byId) {
  if (!byId) return null;
  const id = String(record.id);
  if (byId.has(id)) return byId.get(id);
  if (/^\d+$/.test(id) || !record.name || !normalize(record.brand ?? '')) return null;
  if (!byName.has(byId)) {
    const index = new Map();
    for (const r of byId.values()) {
      const key = normalize(r.name ?? '');
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(r);
    }
    byName.set(byId, index);
  }
  const same = (byName.get(byId).get(normalize(record.name)) ?? []).filter(r => sameBottle(record, r));
  return same.sort((a, b) => b.ratingVotes - a.ratingVotes)[0] ?? null;
}

const NONE = Object.freeze({
  known: false, value: null, safe: null, keep: null, lean: null, now: null, owners: null, reach: null,
  like: Object.freeze([]), family: Object.freeze([]), alt: Object.freeze([]), clones: Object.freeze([]), flags: Object.freeze([]),
});

const fromExtras = x => ({
  known: true,
  value: x.value ?? null,
  safe: x.safe ?? null,
  keep: x.keep ?? null,
  lean: x.lean ?? null,
  now: x.now ?? null,
  owners: x.owners ?? null,
  reach: x.reach ?? null,
  like: ids(x.like),
  family: ids(x.family),
  alt: ids(x.alt),
  clones: ids(x.clones),
  flags: [...(x.flags ?? [])],
});

// The pool's signals as a bottle's about data has them: no safety, keep,
// popularity, reach or cheaper alternatives, and family links from its top 5 only.
function fromAbout(a) {
  const v = a.value, agreed = (a.smellsLike ?? []).filter(s => s.up - s.down >= LIKE_MIN_NET && s.up >= 2 * s.down);
  return {
    ...NONE,
    known: true,
    value: v?.votes ? round2((v.avg * v.votes + VALUE_PRIOR * VALUE_PRIOR_VOTES) / (v.votes + VALUE_PRIOR_VOTES)) : null,
    lean: a.crowdGender?.lean ?? null,
    owners: a.owners?.have ?? null,
    like: ids(agreed.slice(0, LIKE_TOP).map(s => s.id)),
    family: ids(agreed.filter(s => s.up >= FAMILY_MIN_UP && s.up >= FAMILY_RATIO * s.down).map(s => s.id)),
    flags: [...(a.flags ?? [])],
  };
}

const signals = new WeakMap(); // record (by its extras) or about object -> signals
const remember = (key, make) => signals.get(key) ?? signals.set(key, make()).get(key);

/**
 * A record's signals, pool or owned alike: { known, value, safe, keep, lean,
 * now, owners, reach, like, family, alt, clones, flags }. Read from its `extras`, else its
 * pool row in `byId` (by id, or name and brand: poolRowOf), else its `about`;
 * ids are strings. Numbers are null and lists empty when nothing is known
 * (known false).
 */
export function signalsOf(record, byId = null) {
  if (record.extras) return remember(record, () => fromExtras(record.extras));
  const row = poolRowOf(record, byId);
  if (row?.extras) return signalsOf(row);
  if (record.about) return remember(record.about, () => fromAbout(record.about));
  return NONE;
}

const flagged = (record, flag, byId) => signalsOf(record, byId).flags.includes(flag);

const knownLean = (record, byId) => signalsOf(record, byId).lean ?? LABEL_LEAN[record.gender] ?? null;

/** -1 feminine .. +1 masculine: the crowd's vote, else Fragrantica's label, else 0. */
export const genderLean = (record, byId = null) => knownLean(record, byId) ?? 0;

/** [lo, hi]: the leans a wardrobe spans (10th to 90th percentile), widened by `margin`. */
export function leanWindow(owned, margin = LEAN_MARGIN, byId = null) {
  const leans = owned.map(f => knownLean(f, byId)).filter(x => x != null).sort((a, b) => a - b);
  if (leans.length < MIN_BOTTLES) return [-1, 1];
  const at = p => leans[Math.min(leans.length - 1, Math.floor(p * leans.length))];
  return [Math.max(-1, at(0.1) - margin), Math.min(1, at(0.9) + margin)];
}

/**
 * What allow() checks against, from the wardrobe: { owned, originals (id
 * Sets; an owned bottle under another id adds its pool row's), lean [lo, hi],
 * minRating, minValue, mists, byId }. `minValue` (null: none) is for a "great
 * value only" filter; `mists` lets in body and hair mists, body sprays and
 * splashes, which suggestions leave out unless asked (a mist is a body-care
 * product, not the bottle someone shopping for a perfume means).
 */
export function allowContext(owned, { byId = null, margin = LEAN_MARGIN, minRating = MIN_RATING, minValue = null, mists = false } = {}) {
  const mine = new Set();
  for (const f of owned) {
    mine.add(String(f.id));
    const row = poolRowOf(f, byId);
    if (row) mine.add(String(row.id));
  }
  return {
    owned: mine,
    originals: new Set(owned.filter(f => f.original).map(f => String(f.original.id))),
    lean: leanWindow(owned, margin, byId),
    minRating,
    minValue,
    mists,
    byId,
  };
}

/** Whether a bottle may be suggested: not owned or an owned dupe's original, not brigaded, not a mist (unless ctx.mists), rated well, in the lean window. */
export function allow(record, ctx) {
  const id = String(record.id);
  if (ctx.owned.has(id) || ctx.originals.has(id) || flagged(record, 'brigaded', ctx.byId)) return false;
  if (!ctx.mists && flagged(record, 'mist', ctx.byId)) return false;
  if (!(record.rating >= ctx.minRating)) return false;
  if (ctx.minValue != null && !(signalsOf(record, ctx.byId).value >= ctx.minValue)) return false;
  const lean = genderLean(record, ctx.byId);
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

/** reach's multiplier on a candidate's worth: 1 from REACH_FULL (and unknown), 1 - REACH_DAMP at none. */
export const reachMult = reach => (reach == null ? 1 : 1 - REACH_DAMP * clamp((REACH_FULL - reach) / REACH_FULL, [0, 1]));

/**
 * What a candidate is worth beyond its fit: { mult, rating, keep, value,
 * reach }, mult about 0.4 to 1.5 (1 for a bottle at the pool's medians).
 * `valueSlope` as valueSlope().
 */
export function candidateQuality(record, norms, { valueSlope: slope = VALUE_SLOPE, byId = null } = {}) {
  const s = signalsOf(record, byId), votes = record.ratingVotes ?? 0;
  const rating = (votes * (record.rating ?? 0) + RATING_PRIOR_VOTES * norms.rating) / (votes + RATING_PRIOR_VOTES);
  const keep = s.keep ?? norms.keep, value = s.value ?? norms.value;
  const mult = clamp(1 + (rating - norms.rating), RATING_RANGE)
    * clamp(1 + (keep - norms.keep), KEEP_RANGE)
    * clamp(1 + slope * (value - norms.value), VALUE_RANGE)
    * reachMult(s.reach);
  return { mult, rating, keep, value, reach: s.reach };
}

// The wardrobe's median value for money, or null under MIN_BOTTLES known.
function ownedValue(owned, byId) {
  const values = owned.map(f => signalsOf(f, byId).value).filter(v => v != null);
  return values.length >= MIN_BOTTLES ? median(values) : null;
}

/** How much value for money counts in quality, from how the wardrobe buys (David's 4.2 against the pool's 3.0: 0.2). */
export function valueSlope(owned, norms, byId = null) {
  const mine = ownedValue(owned, byId);
  if (mine == null) return VALUE_SLOPE;
  return clamp(VALUE_SLOPE + 0.1 * (mine - norms.value), VALUE_SLOPE_RANGE);
}

/** Whether "Prefer great value" starts on: the wardrobe's median value is PREFER_VALUE or more. */
export const preferValueDefault = (owned, byId = null) => (ownedValue(owned, byId) ?? 0) >= PREFER_VALUE;

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
 * the pool bottles dupeOf places so.
 */
export function familyIndex(byId, owned) {
  const links = new Map();
  const link = (a, b) => {
    if (a === b) return;
    (links.get(a) ?? links.set(a, new Set()).get(a)).add(b);
    (links.get(b) ?? links.set(b, new Set()).get(b)).add(a);
  };
  const linkAll = r => { for (const id of signalsOf(r, byId).family) link(String(r.id), id); };
  for (const r of byId.values()) linkAll(r);

  // The wardrobe and its originals: id -> { record, via (owned record), name, original }.
  // An owned bottle under another id (fg:, my:) also stands for its pool row.
  const seeds = new Map();
  for (const f of owned) {
    const seed = { record: f, via: f, name: f.name, original: false };
    seeds.set(String(f.id), seed);
    const row = poolRowOf(f, byId);
    if (row) seeds.set(String(row.id), seed);
  }
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
  for (const seed of seeds.values()) for (const n of signalsOf(seed.record, byId).like) likeLink(n, seed);
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
    const id = String(record.id), row = poolRowOf(record, byId);
    const seed = seeds.get(id) ?? (row && seeds.get(String(row.id)));
    if (seed) return seed.original ? result('original', seed.via, `The original of your ${seed.via.name}`) : result('owned', seed.via, 'You own it');
    const own = signalsOf(record, byId);
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
  // Placed, not just linked: a linked bottle can turn out a flanker.
  const count = { near: 0, family: 0 };
  for (const id of new Set([...near.keys(), ...twoHops.keys(), ...like.keys()])) {
    const kind = byId.has(id) && dupeOf(byId.get(id))?.kind;
    if (kind in count) count[kind]++;
  }
  return { dupeOf, ...count };
}

/**
 * What a suggestion's novelty is measured against: every owned record and
 * each owned dupe's original, as its pool row (the built `original` carries
 * no accords or notes, so it would compare as nothing). [{ vector, record,
 * via }], `via` the owned record.
 */
export function ownedVectors(owned, byId) {
  const out = owned.map(f => ({ vector: scentVector(f), record: f, via: f }));
  const mine = new Set(owned.map(f => String(f.id)));
  for (const f of owned) {
    const row = f.original && byId?.get(String(f.original.id));
    if (row && !mine.has(row.id)) out.push({ vector: scentVector(row), record: row, via: f });
  }
  return out;
}

/**
 * How new a bottle would be to the wardrobe: { mult, sim, nearest, dupe }.
 * mult 0..1 is NOVELTY_FLOOR + NOVELTY_SLOPE × (1 - sim), at most 1, times
 * the family multiplier; sim its similarity to the nearest of `vecs`
 * (ownedVectors), `nearest` that entry; `dupe` what family.dupeOf says
 * (null when it's no kin, or no index is given). It compares with every owned
 * bottle, so take it lazily, for candidates that could still win.
 */
export function novelty(record, vecs, family = null) {
  const dupe = family?.dupeOf(record) ?? null;
  let nearest = null, sim = 0;
  for (const entry of vecs) {
    const s = similarity(record, entry.vector);
    if (s > sim) [nearest, sim] = [entry, s];
  }
  return { mult: Math.min(1, NOVELTY_FLOOR + NOVELTY_SLOPE * (1 - sim)) * (dupe?.mult ?? 1), sim, nearest, dupe };
}

/**
 * A cheaper bottle voters say smells like this one (its `alt`, most agreed
 * first), from byId: { record, value, owned, text } or null. Given an
 * allowContext, a twin the wardrobe owns comes first ("You own its twin");
 * otherwise the twin rates at least the floor (ctx.minRating, else
 * MIN_RATING) and isn't brigaded, discontinued or a mist (unless ctx.mists).
 */
export function cheaperTwin(record, byId, ctx = null) {
  const minRating = ctx?.minRating ?? MIN_RATING;
  const alts = signalsOf(record, byId).alt.map(id => byId.get(id)).filter(Boolean);
  const mine = ctx && alts.find(twin => ctx.owned.has(twin.id));
  if (mine) return { record: mine, value: signalsOf(mine).value, owned: true, text: `You own its twin, ${mine.name}.` };
  const twin = alts.find(t => t.rating >= minRating && !flagged(t, 'brigaded') && !flagged(t, 'discontinued') && (ctx?.mists || !flagged(t, 'mist')));
  return twin ? { record: twin, value: signalsOf(twin).value, owned: false, text: `${twin.name} by ${twin.brand} smells like it, for far less.` } : null;
}

/** Whether voters say a bottle fades fast: longevity under WEAK_LONGEVITY from WEAK_VOTES votes. */
export function weakLongevity(record) {
  const p = performanceRating(record);
  return p?.longevity != null && p.votes >= WEAK_VOTES && p.longevity < WEAK_LONGEVITY;
}

/**
 * How risky a blind buy it is: { level: 'low' | 'medium' | 'high' |
 * 'unknown', reasons }, reasons short plain sentences, the weightiest first.
 * A bottle with no crowd data (signalsOf known false) is unknown, and says so.
 */
export function riskOf(record, byId = null) {
  const s = signalsOf(record, byId), found = [];
  const add = (points, text) => found.push({ points, text });
  if (s.flags.includes('brigaded')) add(2, 'Its rating looks inflated by a voting campaign.');
  if (s.flags.includes('notBlindBuy')) add(2, 'Reviewers say it isn’t a safe blind buy.');
  if (s.flags.includes('polarizing')) add(2, 'It divides people: many voters hate it.');
  else if (s.safe != null && s.safe < SAFE_LOW) add(s.safe < SAFE_VERY_LOW ? 2 : 1, 'Fewer voters love it than most.');
  if (s.keep != null && s.keep < KEEP_LOW) add(1, 'Owners often let it go.');
  if (s.flags.includes('discontinued')) add(1, 'Reviewers say it’s discontinued.');
  if (s.flags.includes('reformulated')) add(1, 'Reviewers say it was reformulated.');
  if (s.flags.includes('hardToFind')) add(1, 'It’s hard to find in stock.');
  if (weakLongevity(record)) add(1, 'It doesn’t last long.');
  const points = found.reduce((sum, r) => sum + r.points, 0);
  const reasons = found.sort((a, b) => b.points - a.points).map(r => r.text);
  if (!s.known) return { level: 'unknown', reasons: [...reasons, 'There’s no crowd data on it yet.'] };
  return { level: points >= RISK_HIGH ? 'high' : points >= RISK_MEDIUM ? 'medium' : 'low', reasons };
}
