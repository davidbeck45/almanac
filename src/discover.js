// Discover: bottles to buy that give more of what someone loves. By scent
// style ("more skin scents"), by example ("more like Liquid Brun and Amber
// Empire"), by notes and accords ("iris leather"), and the smells-like family
// around one bottle (its original, cheaper twins, siblings). Picks come from
// the suggestion pool (loadPool, fromPool) through the shared candidate
// machinery: src/similar.js says how alike two bottles smell, and
// src/candidates.js what a bottle is worth, how new it would be and how risky.
// Pure (no DOM, no fetch), so a module Worker can run it.
import { ACCORDS, barStrength } from './accords.js';
import { performanceRating } from './engine.js';
import { fromPool } from './fragrantica.js';
import { journalStats } from './history.js';
import { STYLES, STYLE_MIN, STYLE_LEAN, WEARS_CLOSE, styleScores, topOf, leanOf, closeOf, styleMix } from './scent-styles.js';
import { centroid, sharedTraits, similarity } from './similar.js';
import {
  MIN_RATING, allow, allowContext, candidateQuality, cheaperTwin, familyIndex, novelty, ownedVectors,
  poolNorms, poolRowOf, riskOf, signalsOf, valueSlope,
} from './candidates.js';

// The styles David says he loves. The demo starts Discover on them (each only
// while the wardrobe holds a bottle of it); everyone else starts on what most
// of their bottles lean toward. Their own choice, once saved, wins.
export const DEMO_LIKED = ['skin', 'clean', 'intimate'];
// How many chips start on, and how many bottles a style needs to count as a
// taste (one in a wardrobe under SMALL_WARDROBE).
const LIKED_CHIPS = 3;
const LIKED_MIN = 2;
const SMALL_WARDROBE = 8;

// "Any" of several styles takes turns: each pick for a style already picked
// for counts SPREAD less per earlier pick, so one style can't fill the list.
const SPREAD = 0.9;
// Beside scent styles, Intimate shapes them: a bottle that doesn't wear close
// keeps WEAR_FLOOR of its match, one that does all of it.
const WEAR_FLOOR = 0.6;
// "All" blends the chosen styles' scores by a power mean this far below 0
// (a soft minimum: 0.9 and 0.6 make 0.68), and wants each at least STYLE_LEAN.
const SOFT_MIN_POWER = -4;
// A pick stays out when it's this alike to a bottle already owned, or voters
// tie it to one closer than family (twin, flanker, an owned dupe's original:
// dupeOf's multiplier under FAMILY_FLOOR).
const MAX_OWNED_SIM = 0.9;
const FAMILY_FLOOR = 0.5;
// "Fans also like" (alsoLiked on a seed's about data) lifts a "more like" pick
// by up to ALSO_LIKED, times the share of seeds that list it.
export const ALSO_LIKED = 0.15;
// Default seeds: the most worn of the last SEED_DAYS, else the best rated
// (shrunk toward 4 by SEED_PRIOR_VOTES votes).
const SEED_DAYS = 60;
const SEED_COUNT = 3;
const SEED_PRIOR_VOTES = 100;

// Gender lean windows on -1 (feminine) .. +1 (masculine): feminine and
// masculine take in 95% of the pool's bottles Fragrantica labels so, unisex the
// middle 70% of its unisex ones; they overlap.
export const LEAN_WINDOWS = { feminine: [-1, -0.25], unisex: [-0.45, 0.45], masculine: [0.25, 1] };
// A season fits from SEASON_NEAR of the bottle's best season's share; night
// from NIGHT_SPLIT of its day/night votes (the pool's median is 0.38: voters
// wear most bottles by day), day below it.
const SEASONS = ['winter', 'spring', 'summer', 'fall'];
const SEASON_NEAR = 0.8;
const NIGHT_SPLIT = 0.45;

// What every query leaves out unless told otherwise.
export const FILTERS = Object.freeze({
  seasons: null, // ['winter', …]: suits any of them
  slot: null, // 'day' | 'night'
  lean: null, // a LEAN_WINDOWS key; else the wardrobe's window (allowContext)
  minLongevity: null, // Parfumo's 0–10 (performanceRating), as the detail sheet shows
  minSillage: null,
  minValue: null, // 1–5
  minSafe: null, // blind-buy safety percentile, 0–100
  minRating: MIN_RATING,
  hideDiscontinued: true,
  excludeOwned: true,
});

// Notes and accords search: a term matches when its note salience or accord
// strength reaches TERM_MIN, and a bottle must match every term. A note counts
// NOTE_SHARE of its salience (votes over the bottle's most voted note, or
// UNVOTED), an accord its strength (the top accord is 1).
const TERM_MIN = 0.2;
const NOTE_SHARE = 0.85;
const UNVOTED = 0.1;
// Query words that join terms, not name them.
const JOINERS = new Set(['and', 'with', 'plus', 'or', 'a', 'an', 'the', 'of', 'in', 'notes', 'note', 'accord', 'accords', 'scent', 'scents', 'smell', 'smelling']);
// Words people type for a note or accord under another name, each with more
// names to look for (an accord's name finds the accord, any other name a
// note). Plurals and adjective endings meet on their own: smoke and smoky,
// musk and musky, aldehydes and aldehydic.
const ALIASES = {
  oud: ['agarwood', 'aoud', 'oudh'],
  agarwood: ['oud'],
  iris: ['orris'],
  orris: ['iris'],
  tonka: ['coumarin'],
  frankincense: ['olibanum', 'incense'],
  olibanum: ['frankincense', 'incense'],
  incense: ['olibanum', 'frankincense'],
  vetiver: ['vetyver'],
  ambroxan: ['ambrox', 'ambroxide', 'cetalox'],
  cashmeran: ['cashmere wood'],
  'lily of the valley': ['muguet'],
  muguet: ['lily of the valley'],
  patchouli: ['patchouly'],
  ylang: ['ylang ylang'],
  cedar: ['cedarwood'],
  cedarwood: ['cedar'],
  guaiac: ['guaiac wood', 'gaiac'],
  cocoa: ['cacao'],
  cacao: ['cocoa'],
  vanilla: ['vanille'],
  vanille: ['vanilla'],
  leather: ['suede'],
  suede: ['leather'],
  smoke: ['birch tar', 'cade'],
  sea: ['marine', 'sea notes', 'sea salt', 'sea water'],
  marine: ['sea notes', 'sea water', 'sea salt'],
  ocean: ['marine', 'sea notes'],
  water: ['aquatic', 'water notes'],
  milk: ['lactonic'],
  metal: ['metallic'],
  flower: ['floral', 'white floral'],
  floral: ['white floral', 'yellow floral'],
  spice: ['warm spicy', 'fresh spicy', 'soft spicy'],
  fruit: ['tropical'],
  whisky: ['whiskey'],
  booze: ['whiskey', 'rum', 'cognac', 'alcohol'],
  coffee: ['espresso'],
  clean: ['soapy', 'aldehydic', 'white musk', 'clean notes'],
  moss: ['oakmoss'],
  oakmoss: ['mossy', 'oak moss'],
  resin: ['balsamic'],
  // Broad words take any accord of the kind: "marine fresh" is a fresh
  // marine, not a marine that also has a "fresh" accord.
  fresh: ['citrus', 'aquatic', 'marine', 'ozonic', 'green', 'fresh spicy'],
  warm: ['warm spicy', 'amber', 'balsamic', 'vanilla'],
};

const clamp01 = x => Math.min(1, Math.max(0, x));
const noisyOr = xs => 1 - xs.reduce((p, x) => p * (1 - clamp01(x)), 1);
const SCENT = STYLES.filter(s => s.kind === 'scent');
const STYLE_IDS = STYLES.map(s => s.id);
const labelOf = id => STYLES.find(s => s.id === id)?.label ?? id;
const isWear = id => STYLES.find(s => s.id === id)?.kind === 'wear';
// A style "shows" on a bottle from STYLE_MIN, Intimate (a wear style) from WEARS_CLOSE.
const showsFrom = id => (isWear(id) ? WEARS_CLOSE : STYLE_MIN);

// --------------------------------------------------------------- context

/**
 * What Discover's queries share, worked out once per pool and wardrobe: the
 * pool's records (fromPool) and stored style scores, the wardrobe's filters,
 * quality norms, smells-like family and vectors. `styles` is
 * loadPoolStyles()'s file; without it (or when it lists other styles) scores
 * are worked out live once, about 150 ms.
 */
export function discoverContext(pool, owned, { styles = null, records = null } = {}) {
  records ??= Array.from({ length: pool.count }, (_, i) => fromPool(pool, i));
  const byId = new Map(records.map(r => [r.id, r]));
  const norms = poolNorms(records);
  const stored = styles && styles.styles.join() === STYLE_IDS.join() && styles.s.length === records.length ? styles : null;
  return {
    pool,
    records,
    byId,
    index: new Map(records.map((r, i) => [r, i])),
    owned,
    allowed: allowContext(owned, { byId }),
    norms,
    slope: valueSlope(owned, norms, byId),
    family: familyIndex(byId, owned),
    vecs: ownedVectors(owned, byId),
    styles: stored,
    memo: {},
  };
}

// Each style's scores over the pool, one Float32Array per style id.
function styleColumns(ctx) {
  if (ctx.memo.columns) return ctx.memo.columns;
  const n = ctx.records.length, cols = Object.fromEntries(STYLE_IDS.map(id => [id, new Float32Array(n)]));
  if (ctx.styles) {
    ctx.styles.s.forEach((row, i) => {
      for (let j = 0; j < row.length; j += 2) cols[STYLE_IDS[row[j]]][i] = row[j + 1] / 100;
    });
  } else {
    ctx.records.forEach((r, i) => {
      const scores = styleScores(r);
      for (const id of STYLE_IDS) cols[id][i] = scores[id];
    });
  }
  return (ctx.memo.columns = cols);
}

/** A pool bottle's style scores, stored or live; any other record's, live. */
export function scoresOf(record, ctx) {
  const i = ctx.index.get(record);
  if (i === undefined) return styleScores(record);
  const cols = styleColumns(ctx);
  return Object.fromEntries(STYLE_IDS.map(id => [id, Math.round(1000 * cols[id][i]) / 1000]));
}

// √ of candidateQuality's multiplier: the rating, keep and value lean count,
// but under how well a bottle matches.
function qualityOf(ctx, record) {
  ctx.memo.quality ??= new Map();
  let q = ctx.memo.quality.get(record);
  if (q === undefined) {
    q = Math.sqrt(candidateQuality(record, ctx.norms, { valueSlope: ctx.slope, byId: ctx.byId }).mult);
    ctx.memo.quality.set(record, q);
  }
  return q;
}

// --------------------------------------------------------------- filters

/** A filter test from FILTERS overrides; throws on a lean, season or slot it doesn't know. */
export function admitter(ctx, filters = {}) {
  const f = { ...FILTERS, ...filters };
  if (f.lean && !LEAN_WINDOWS[f.lean]) throw new Error(`Lean is feminine, unisex or masculine, not "${f.lean}".`);
  if (f.slot && f.slot !== 'day' && f.slot !== 'night') throw new Error(`Slot is day or night, not "${f.slot}".`);
  const seasons = f.seasons?.length ? f.seasons : null;
  for (const s of seasons ?? []) if (!SEASONS.includes(s)) throw new Error(`Season is ${SEASONS.join(', ')}, not "${s}".`);
  const none = new Set();
  const base = {
    ...ctx.allowed,
    owned: f.excludeOwned ? ctx.allowed.owned : none,
    originals: f.excludeOwned ? ctx.allowed.originals : none,
    lean: f.lean ? LEAN_WINDOWS[f.lean] : ctx.allowed.lean,
    minRating: f.minRating ?? 0,
    minValue: f.minValue,
  };
  return record => {
    if (!allow(record, base)) return false;
    const s = signalsOf(record, ctx.byId);
    if (f.hideDiscontinued && s.flags.includes('discontinued')) return false;
    if (f.minSafe != null && !(s.safe >= f.minSafe)) return false;
    if (seasons) {
      const best = Math.max(...SEASONS.map(x => record.season?.[x] ?? 0));
      if (!seasons.some(x => (record.season?.[x] ?? 0) >= SEASON_NEAR * best)) return false;
    }
    if (f.slot) {
      const night = record.dayNight?.night ?? 0.5;
      if (f.slot === 'night' ? night < NIGHT_SPLIT : night >= NIGHT_SPLIT) return false;
    }
    if (f.minLongevity != null || f.minSillage != null) {
      const p = performanceRating(record);
      if (f.minLongevity != null && !(p?.longevity >= f.minLongevity)) return false;
      if (f.minSillage != null && !(p?.sillage >= f.minSillage)) return false;
    }
    return true;
  };
}

// --------------------------------------------------------------- results

// The owned bottle a pick is closest to: { name, record, sim, traits (what
// they share), through (the name of the owned dupe's original it's closest
// to, when it is one) }.
function closest(record, nov) {
  if (!nov.nearest) return null;
  const { record: near, via } = nov.nearest;
  return {
    name: via.name,
    record: via,
    sim: nov.sim,
    traits: sharedTraits(record, nov.nearest.vector, 3),
    through: near !== via ? near.name : null,
  };
}

// One pick, described the same way by every query.
function describe(ctx, record, { score, nov, extra = {} }) {
  const scores = scoresOf(record, ctx), s = signalsOf(record, ctx.byId);
  const nearest = closest(record, nov);
  const twin = cheaperTwin(record, ctx.byId, ctx.allowed);
  return {
    id: record.id,
    record,
    score,
    styles: topOf(scores),
    close: closeOf(scores),
    nearest,
    family: nov.dupe && nov.dupe.kind !== 'owned' ? nov.dupe.text : null,
    value: s.value,
    rating: record.rating,
    votes: record.ratingVotes,
    risk: riskOf(record, ctx.byId),
    twin: twin && !twin.owned ? twin : null,
    ...extra,
  };
}

const chips = pick => [...pick.styles.map(s => s.label), ...(pick.close ? ['wears close'] : [])];
const lower = text => text.charAt(0).toLowerCase() + text.slice(1);
const upper = text => text.charAt(0).toUpperCase() + text.slice(1);
const listed = items => (items.length < 3 ? items.join(' and ') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

/** One line on why a pick is here, for the CLI and a card's subtitle. */
export function whyLine(pick) {
  const parts = [];
  if (pick.matched) parts.push(listed([...new Set(pick.matched.map(m => m.name))]));
  else if (pick.shares?.length) parts.push(`Shares ${listed(pick.shares)}`);
  else if (pick.styles.length || pick.close) parts.push(chips(pick).map(lower).join(', '));
  const near = pick.nearest;
  if (near) parts.push(`closest you own: ${near.through ? `${near.name}'s original, ${near.through}` : near.name}${near.traits.length ? ` (${near.traits.join(', ')})` : ''}`);
  if (pick.family) parts.push(pick.family);
  if (pick.alsoLiked) parts.push('fans of your picks like it too');
  if (pick.risk.level !== 'low') parts.push(`${pick.risk.level} risk: ${pick.risk.reasons[0]?.replace(/\.$/, '').toLowerCase() ?? ''}`);
  if (pick.twin) parts.push(`cheaper twin: ${pick.twin.record.name}`);
  if (pick.alike?.length) parts.push(`twins: ${pick.alike.map(r => r.name).join(', ')}`);
  return parts.map((p, i) => (i ? lower(p) : upper(p))).join('; ');
}

// Two picks voters call one scent (a family link either way), or over
// MAX_OWNED_SIM alike: the list shows one, with the other as its `alike`.
function twins(a, b) {
  return signalsOf(a).family.includes(b.id) || signalsOf(b).family.includes(a.id) || similarity(a, b) > MAX_OWNED_SIM;
}

// The k best of `scored` ([{ record, bound }], bound an upper bound of the
// final score), sorted by bound: each is placed by `final(record, bound)` ->
// { score, … } | null (left out), walking down only while a bound can still
// beat the k-th score. A twin of a pick joins its `alike` (the better scored
// of the two leads).
function lazyTop(scored, k, final) {
  scored.sort((a, b) => b.bound - a.bound);
  const out = [];
  for (const item of scored) {
    if (out.length >= k && item.bound <= out[k - 1].score) break;
    const placed = final(item.record, item.bound);
    if (!placed) continue;
    const i = out.findIndex(p => twins(p.record, placed.record));
    if (i >= 0) {
      const [lead, other] = placed.score > out[i].score ? [placed, out[i]] : [out[i], placed];
      lead.alike = [...(lead.alike ?? []), other.record, ...(other.alike ?? [])];
      out[i] = lead;
    } else out.push(placed);
    out.sort((a, b) => b.score - a.score);
    if (out.length > k) out.length = k;
  }
  return out;
}

// --------------------------------------------------------------- styles

/** Style ids from typed text: ids or labels, any case, comma separated ("skin scent, Clean, intimate", "iris"). */
export function findStyles(text) {
  const squash = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();
  const found = [], unknown = [];
  for (const part of String(text).split(',').map(squash).filter(Boolean)) {
    const words = part.split(' ');
    const style = STYLES.find(s => squash(s.id) === part || squash(s.label) === part)
      ?? STYLES.find(s => words.every(w => squash(s.label).split(' ').includes(w)) || squash(s.id).startsWith(part));
    if (style) {
      if (!found.includes(style.id)) found.push(style.id);
    } else unknown.push(part);
  }
  return { ids: found, unknown };
}

/**
 * The style chips Discover starts on, from a wardrobe's style mix
 * (styleMix): [{ id, label, count, bottles (names), stated }]. `stated` (the
 * styles someone says they love, as DEMO_LIKED) keeps those the wardrobe holds
 * a bottle of, in order; otherwise the styles the most bottles lean toward,
 * LIKED_MIN or more each (one in a small wardrobe), up to `k`, Intimate
 * counting the bottles that wear close.
 */
export function likedStyles(owned, { stated = null, scores = styleScores, k = LIKED_CHIPS } = {}) {
  const mix = styleMix(owned, scores);
  const nameOf = new Map(owned.map(f => [f.id, f.name]));
  const entry = id => {
    const ids = isWear(id) ? mix.intimateIds : mix.ids[id] ?? [];
    return { id, label: labelOf(id), count: ids.length, bottles: ids.map(x => nameOf.get(x)), stated: Boolean(stated?.includes(id)) };
  };
  if (stated?.length) return stated.filter(id => STYLE_IDS.includes(id)).map(entry).filter(e => e.count > 0);
  const min = owned.length < SMALL_WARDROBE ? 1 : LIKED_MIN;
  return [...SCENT.map(s => s.id), 'intimate'].map(entry)
    .filter(e => e.count >= min)
    .sort((a, b) => b.count - a.count)
    .slice(0, k);
}

/**
 * "If you want more of these, get these": pool bottles that are the chosen
 * styles, best first. mode 'any': a bottle shows at least one of them, the
 * styles taking turns; Intimate (a wear style) chosen beside scent styles
 * shapes them rather than competing, so skin scents that wear close lead and
 * a quiet cologne of another kind doesn't come in on quietness alone. 'all':
 * each at least STYLE_LEAN, blended by a soft minimum. Score = style match ×
 * √quality × novelty (nothing owned, no twin of an owned bottle, nothing over
 * MAX_OWNED_SIM alike to one). -> picks as describe() makes them, plus
 * `match` and `via` (the chosen style it's here for).
 */
export function moreOfStyles(styleIds, ctx, { mode = 'any', k = 10, filters = {} } = {}) {
  const ids = [...new Set(styleIds.filter(id => STYLE_IDS.includes(id)))];
  if (!ids.length) return [];
  if (mode !== 'any' && mode !== 'all') throw new Error(`Mode is any or all, not "${mode}".`);
  const scents = ids.filter(id => !isWear(id)), wear = ids.filter(isWear);
  if (mode === 'any' && scents.length > 1) return takeTurns(scents.map(id => moreOfStyles([id, ...wear], ctx, { k, filters })), k);
  const cols = styleColumns(ctx), admits = admitter(ctx, filters);
  const via = scents[0] ?? wear[0];
  const scored = [];
  ctx.records.forEach((record, i) => {
    let match;
    if (mode === 'any') {
      match = cols[via][i] >= showsFrom(via) ? cols[via][i] : 0;
      if (match && scents.length && wear.length) match *= WEAR_FLOOR + (1 - WEAR_FLOOR) * Math.max(...wear.map(id => cols[id][i]));
    } else {
      let sum = 0, min = 1;
      for (const id of ids) {
        const x = cols[id][i];
        min = Math.min(min, x);
        sum += Math.max(x, 1e-3) ** SOFT_MIN_POWER;
      }
      match = min >= STYLE_LEAN ? (sum / ids.length) ** (1 / SOFT_MIN_POWER) : 0;
    }
    if (match > 0 && admits(record)) scored.push({ record, bound: match * qualityOf(ctx, record), match });
  });
  const matchOf = new Map(scored.map(s => [s.record, s.match]));
  return lazyTop(scored, k, (record, bound) => {
    const nov = novelty(record, ctx.vecs, ctx.family);
    if ((nov.dupe?.mult ?? 1) < FAMILY_FLOOR || nov.sim > MAX_OWNED_SIM) return null;
    return describe(ctx, record, { score: bound * nov.mult, nov, extra: { match: matchOf.get(record), via: mode === 'any' ? via : null } });
  });
}

// Several ranked lists as one: the best head next, each list's picks
// counting SPREAD less for every pick it has had.
function takeTurns(lists, k) {
  const out = [], taken = new Set(), turns = lists.map(() => 0), at = lists.map(() => 0);
  while (out.length < k) {
    let best = -1, bestScore = -Infinity;
    lists.forEach((list, j) => {
      while (at[j] < list.length && taken.has(list[at[j]].id)) at[j]++;
      const head = list[at[j]];
      if (head && head.score * SPREAD ** turns[j] > bestScore) [best, bestScore] = [j, head.score * SPREAD ** turns[j]];
    });
    if (best < 0) break;
    const pick = lists[best][at[best]];
    out.push(pick);
    taken.add(pick.id);
    turns[best]++;
  }
  return out;
}

// --------------------------------------------------------------- by example

/**
 * Seeds for "more like what you love" when none are picked: the most worn
 * bottles of the last SEED_DAYS days (journalStats), else the best rated.
 * -> { seeds: records, from: 'worn' | 'rated' }
 */
export function defaultSeeds(owned, { history = [], todayISO = null, n = SEED_COUNT } = {}) {
  if (history.length && todayISO) {
    const byId = new Map(owned.map(f => [String(f.id), f]));
    const worn = journalStats(history, todayISO, SEED_DAYS).top.map(([id]) => byId.get(String(id))).filter(Boolean);
    if (worn.length) return { seeds: worn.slice(0, n), from: 'worn' };
  }
  const rated = f => ((f.ratingVotes ?? 0) * (f.rating ?? 0) + SEED_PRIOR_VOTES * 4) / ((f.ratingVotes ?? 0) + SEED_PRIOR_VOTES);
  return { seeds: [...owned].sort((a, b) => rated(b) - rated(a)).slice(0, n), from: 'rated' };
}

/**
 * Pool bottles that smell like the seeds (owned or any dataset records; give
 * them their `about` for "fans also like"): nearest to the seeds' centroid,
 * × √quality, lifted up to `alsoLiked` by the share of seeds whose about data
 * lists them in alsoLiked. The seeds themselves, owned bottles, their twins
 * and versions and anything over MAX_OWNED_SIM alike to an owned bottle stay
 * out. -> picks as describe() makes them, plus `sim` (to the seeds), `shares`
 * and `alsoLiked` (how many seeds list it).
 */
export function moreLike(seeds, ctx, { k = 10, filters = {}, alsoLiked = ALSO_LIKED } = {}) {
  if (!seeds.length) return [];
  const target = centroid(seeds), admits = admitter(ctx, filters);
  const skip = new Set();
  const liked = new Map();
  for (const seed of seeds) {
    skip.add(String(seed.id));
    const row = poolRowOf(seed, ctx.byId);
    if (row) skip.add(row.id);
    for (const id of seed.about?.alsoLiked ?? []) liked.set(String(id), (liked.get(String(id)) ?? 0) + 1);
  }
  const scored = [];
  for (const record of ctx.records) {
    if (skip.has(record.id) || !admits(record)) continue;
    const sim = similarity(record, target), lift = 1 + alsoLiked * (liked.get(record.id) ?? 0) / seeds.length;
    scored.push({ record, bound: sim * qualityOf(ctx, record) * lift, sim });
  }
  const simOf = new Map(scored.map(s => [s.record, s.sim]));
  return lazyTop(scored, k, (record, bound) => {
    const nov = novelty(record, ctx.vecs, ctx.family);
    if ((nov.dupe?.mult ?? 1) < FAMILY_FLOOR || nov.sim > MAX_OWNED_SIM) return null;
    return describe(ctx, record, {
      score: bound,
      nov,
      extra: { sim: simOf.get(record), shares: sharedTraits(record, target, 4), alsoLiked: liked.get(record.id) ?? 0 },
    });
  });
}

// --------------------------------------------------------------- notes and accords

// Words as search compares them: accents, case and plurals aside, and an
// adjective's ending ("smoky" and "smoke", "musky" and "musk", "ozonic" and
// "ozone" meet).
const plain = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function root(word) {
  if (word.length <= 3) return word;
  let w = word;
  if (w === 'leaves') return 'leaf';
  if (/ies$/.test(w)) w = `${w.slice(0, -3)}y`;
  else if (/(ch|sh|x)es$/.test(w)) w = w.slice(0, -2);
  else if (/[^su]s$/.test(w) && !/is$/.test(w)) w = w.slice(0, -1);
  if (w.length > 4) w = w.replace(/(ic|y|e)$/, '');
  return w;
}
const roots = text => plain(text).split(' ').filter(Boolean).map(root);
const containsRun = (hay, run) => {
  outer: for (let i = 0; i + run.length <= hay.length; i++) {
    for (let j = 0; j < run.length; j++) if (hay[i + j] !== run[j]) continue outer;
    return true;
  }
  return false;
};
const ACCORD_BY_ROOTS = new Map(Object.keys(ACCORDS).map(a => [roots(a).join(' '), a]));
const ALIAS_BY_ROOTS = new Map(Object.entries(ALIASES).map(([word, more]) => [roots(word).join(' '), more]));

// The note names search knows: the pool's and the wardrobe's, by their roots.
function noteVocabulary(ctx) {
  if (ctx.memo.notes) return ctx.memo.notes;
  const names = new Set();
  for (const r of [...ctx.owned, ...ctx.records]) for (const list of Object.values(r.notes ?? {})) for (const n of list) names.add(n);
  const list = [...names].map(name => ({ name, roots: roots(name) }));
  list.known = new Set([...ACCORD_BY_ROOTS.keys(), ...list.map(v => v.roots.join(' ')), ...ALIAS_BY_ROOTS.keys()]);
  return (ctx.memo.notes = list);
}

/**
 * A notes and accords query as terms: the longest runs of words that name an
 * accord, a note or an alias ("tonka bean", "lily of the valley", "white
 * floral"), else single words; joiners ("and", "with") drop out. -> { terms:
 * [{ text, accords: Set, notes: Set }], unknown: words that name nothing }.
 */
export function parseNotes(query, ctx) {
  const vocab = noteVocabulary(ctx);
  const words = plain(query).split(' ').filter(Boolean);
  const { known } = vocab;
  const terms = [], unknown = [];
  for (let i = 0; i < words.length;) {
    let span = 0;
    for (let n = Math.min(5, words.length - i); n > 1 && !span; n--) {
      if (known.has(words.slice(i, i + n).map(root).join(' '))) span = n;
    }
    if (!span && JOINERS.has(words[i])) { i++; continue; }
    span ||= 1;
    const text = words.slice(i, i + span).join(' ');
    i += span;
    const runs = [text, ...(ALIAS_BY_ROOTS.get(roots(text).join(' ')) ?? [])].map(roots);
    const accords = new Set(runs.map(r => ACCORD_BY_ROOTS.get(r.join(' '))).filter(Boolean));
    const notes = new Set(vocab.filter(v => runs.some(r => containsRun(v.roots, r))).map(v => v.name));
    if (accords.size || notes.size) terms.push({ text, accords, notes });
    else unknown.push(text);
  }
  return { terms, unknown };
}

// Each note's salience on a bottle: its votes over the most voted note's
// (UNVOTED when nobody voted on it), or 0.6 when the bottle has no note votes.
const saliences = new WeakMap();
function salienceOf(record) {
  let map = saliences.get(record);
  if (map) return map;
  const votes = record.noteVotes ?? {};
  let top = 0;
  for (const n in votes) top = Math.max(top, votes[n]);
  map = new Map();
  for (const list of Object.values(record.notes ?? {})) {
    for (const n of list) map.set(n, Math.max(map.get(n) ?? 0, top ? Math.max(UNVOTED, (votes[n] ?? 0) / top) : 0.6));
  }
  saliences.set(record, map);
  return map;
}

// How strongly a bottle carries a term: { strength 0..1, name, via } from its
// strongest matching accord and its matching notes' salience (noisy-OR).
function termStrength(record, term) {
  let acc = 0, accName = null;
  for (const a of term.accords) {
    const w = record.accords?.[a];
    if (w == null) continue;
    const s = barStrength(w) / 100;
    if (s > acc) [acc, accName] = [s, a];
  }
  let miss = 1 - Math.min(1, acc), best = 0, noteName = null;
  for (const [n, s] of salienceOf(record)) {
    if (!term.notes.has(n)) continue;
    miss *= 1 - NOTE_SHARE * s;
    if (s > best) [best, noteName] = [s, n];
  }
  const via = accName && acc >= NOTE_SHARE * best ? 'accord' : 'note';
  return { strength: 1 - miss, name: (via === 'accord' ? accName : noteName)?.toLowerCase(), via };
}

/**
 * Pool bottles carrying every term of a notes and accords query ("iris
 * leather", "fig", "smoky vanilla", "marine fresh"), best first: the geometric
 * mean of the terms' strengths × √quality. -> { terms, unknown, results }, each
 * result a pick as describe() makes it plus `matched`: [{ term, name, via,
 * strength }]. A query with a word that names nothing returns no results.
 */
export function searchNotes(query, ctx, filters = {}, { k = 10 } = {}) {
  const { terms, unknown } = parseNotes(query, ctx);
  if (!terms.length || unknown.length) return { terms, unknown, results: [] };
  const admits = admitter(ctx, filters);
  const scored = [];
  for (const record of ctx.records) {
    let product = 1;
    const matched = [];
    for (const term of terms) {
      const m = termStrength(record, term);
      if (m.strength < TERM_MIN) { product = 0; break; }
      product *= m.strength;
      matched.push({ term: term.text, name: m.name, via: m.via, strength: Math.round(1000 * m.strength) / 1000 });
    }
    if (!product || !admits(record)) continue;
    const match = product ** (1 / terms.length);
    scored.push({ record, bound: match * qualityOf(ctx, record), match, matched });
  }
  const byRecord = new Map(scored.map(s => [s.record, s]));
  const results = lazyTop(scored, k, (record, bound) => {
    const { match, matched } = byRecord.get(record);
    return describe(ctx, record, { score: bound, nov: novelty(record, ctx.vecs, ctx.family), extra: { match, matched } });
  });
  return { terms: terms.map(t => t.text), unknown, results };
}

// --------------------------------------------------------------- dupes

// A dupe's original, as voters have it: a bottle it smells like (strongest
// links first) from another brand, released no later, and valued at least
// ORIGINAL_VALUE_GAP lower: dupes are bought for value. A bottle voters call
// one scent with an original counts as its clone when it's from another
// brand, released no earlier, valued CLONE_VALUE_GAP higher (decant.py's rule
// for cheaper alternatives) and at least CLONE_SIM alike, which leaves out the
// odd link between bottles that share nothing.
const ORIGINAL_VALUE_GAP = 0.5;
const CLONE_VALUE_GAP = 1;
const CLONE_SIM = 0.3;

/**
 * Ids dupesOf may look at beyond the pool: load the missing ones (from r/)
 * into `more` and pass it, so bottles outside the pool show too.
 */
export function dupeIds(record, ctx) {
  const s = signalsOf(record, ctx.byId), original = record.original;
  const ids = new Set([...s.like, ...s.family, ...s.alt, ...s.clones, ...(record.about?.smellsLike ?? []).map(x => String(x.id))]);
  if (original) {
    ids.add(String(original.id));
    for (const id of [...(original.siblings ?? []), ...(original.extras?.family ?? []), ...(original.extras?.alt ?? [])]) ids.add(String(id));
  }
  ids.delete(String(record.id));
  return [...ids].filter(id => !ctx.byId.has(id));
}

// id -> pool ids whose `key` links (like or family) name it.
function reverseLinks(ctx, key) {
  ctx.memo[key] ??= new Map();
  const out = ctx.memo[key];
  if (!out.size) {
    for (const r of ctx.records) {
      for (const id of signalsOf(r)[key]) {
        if (!out.has(id)) out.set(id, []);
        out.get(id).push(r.id);
      }
    }
  }
  return id => out.get(String(id)) ?? [];
}

/**
 * The smells-like family around one bottle, for the dupe explorer: { original,
 * cheaper, clones, siblings }, each bottle in one list at most.
 * - original: what it's a dupe of (an owned dupe's own, else read from the
 *   votes), or null.
 * - cheaper: bottles voters say smell like it for far less (extras.alt).
 * - clones: for a bottle that isn't a dupe itself, the cheaper bottles from
 *   other brands voters call one scent with it (extras.clones, and pool
 *   bottles whose family links name it).
 * - siblings: other bottles voters link it or its original with, most agreed
 *   first.
 * Each entry: { id, record, name, brand, value, rating, votes, risk, sim (to
 * this bottle), owned, up, down }, `up` and `down` its smells-like votes when
 * this bottle's about data has them. `more` (Map of id -> record, from
 * dupeIds) adds bottles outside the pool.
 */
export function dupesOf(record, ctx, { more = null } = {}) {
  const get = id => ctx.byId.get(String(id)) ?? more?.get(String(id)) ?? null;
  const self = String(record.id), row = poolRowOf(record, ctx.byId);
  const s = signalsOf(record, ctx.byId), own = s.value;
  const votes = new Map((record.about?.smellsLike ?? []).map(x => [String(x.id), x]));
  const familyOf = reverseLinks(ctx, 'family'), likeOf = reverseLinks(ctx, 'like');
  const seen = new Set([self, row?.id]);
  const entry = r => {
    const v = votes.get(r.id), sig = signalsOf(r, ctx.byId);
    return {
      id: r.id,
      record: r,
      name: r.name,
      brand: r.brand,
      value: sig.value,
      rating: r.rating ?? null,
      votes: r.ratingVotes ?? null,
      risk: riskOf(r, ctx.byId),
      sim: r.accords ? Math.round(1000 * similarity(record, r)) / 1000 : null,
      owned: ctx.allowed.owned.has(r.id),
      up: v?.up ?? null,
      down: v?.down ?? null,
    };
  };
  // Bottles not listed yet, as entries, in order.
  const take = (ids, keep = () => true) => {
    const out = [];
    for (const id of ids.map(String)) {
      const r = get(id);
      if (!r || seen.has(r.id) || !keep(r)) continue;
      seen.add(r.id);
      out.push(entry(r));
    }
    return out;
  };

  let original = null;
  if (record.original) {
    const r = get(record.original.id);
    seen.add(String(record.original.id));
    original = { ...(r ? entry(r) : { ...record.original, id: String(record.original.id), record: null, sim: null, risk: riskOf(record.original) }), built: true };
  } else {
    const [r] = [...s.family, ...s.like].map(get).filter(r => r && r.brand !== record.brand
      && (r.year ?? 0) <= (record.year ?? Infinity) && own != null && signalsOf(r, ctx.byId).value <= own - ORIGINAL_VALUE_GAP);
    if (r) {
      seen.add(r.id);
      original = { ...entry(r), built: false };
    }
  }

  const cheaper = take(s.alt).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const copies = r => r.brand !== record.brand && (r.year ?? Infinity) >= (record.year ?? 0)
    && signalsOf(r, ctx.byId).value >= (own ?? Infinity) + CLONE_VALUE_GAP && similarity(record, r) >= CLONE_SIM;
  const clones = original ? [] : [...take(s.clones), ...take([...familyOf(self), ...(row ? familyOf(row.id) : [])], copies)]
    .sort((a, b) => b.sim - a.sim);
  const around = [...votes.keys(), ...s.family, ...s.like, ...s.clones, ...likeOf(self), ...familyOf(self)];
  if (original) {
    const o = record.original, os = original.record ? signalsOf(original.record, ctx.byId) : null;
    around.push(...(o?.siblings ?? []), ...(o?.extras?.family ?? os?.family ?? []), ...familyOf(original.id), ...likeOf(original.id));
  }
  const net = e => (e.up ?? 0) - (e.down ?? 0);
  const siblings = take(around).sort((a, b) => net(b) - net(a) || (b.sim ?? 0) - (a.sim ?? 0));
  return { original, cheaper, clones, siblings };
}
