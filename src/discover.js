// Discover: bottles to buy that give more of what someone loves. By scent
// style ("more skin scents"), by example ("more like Liquid Brun and Amber
// Empire"), by notes and accords ("iris leather"), and the smells-like family
// around one bottle (its original, cheaper twins, siblings). Picks come from
// the suggestion pool (loadPool, fromPool) through the shared candidate
// machinery: src/similar.js says how alike two bottles smell, and
// src/candidates.js what a bottle is worth, how new it would be and how risky.
// Pure (no DOM, no fetch), so a module Worker can run it.
import { ACCORDS, barStrength } from './accords.js';
import { performanceRating, steadyShares } from './engine.js';
import { fromPool } from './fragrantica.js';
import { journalStats } from './history.js';
import { STYLES, STYLE_MIN, STYLE_LEAN, WEARS_CLOSE, styleScores, topOf, leanOf, closeOf, styleMix } from './scent-styles.js';
import { centroid, sharedTraits, similarity } from './similar.js';
import {
  MIN_RATING, allow, allowContext, candidateQuality, cheaperTwin, familyIndex, genderLean, novelty, ownedVectors,
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
// (a soft minimum: 0.9 and 0.6 make 0.68), and wants each where a card shows
// it (STYLE_MIN; Intimate from WEARS_CLOSE). When too few bottles are all of
// them, bottles that lean toward a scent style (from STYLE_LEAN) fill the
// rest, after them, its tag saying "Leans oud".
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
// Style and notes lists lean the way the wardrobe does: the best of each
// crowd lean (feminine, unisex, masculine: under -LEAN_EDGE, between, over
// it) take turns, each band's next pick counting LEAN_SPREAD less for every
// pick it's ahead of its share of the wardrobe, and more for every one
// behind. Skin and clean scents lean feminine, so without it a wardrobe of
// mostly men's bottles gets a list of women's musks. Only picks scoring
// LEAN_FLOOR of their style's best take turns; weaker ones follow, so a thin
// band doesn't bring in bottles that barely match. A lean filter takes its
// place. "More like" follows its seeds instead: it keeps to their leans,
// widened by SEED_LEAN_MARGIN either side (More like Aventus stays masculine).
const LEAN_EDGE = 0.25;
const SEED_LEAN_MARGIN = 0.3;
const LEAN_SPREAD = 0.85;
const LEAN_FLOOR = 0.6;
// A style's bottles are judged against their own median rating: voters rate
// quiet styles lower (a quarter of skin, clean and intimate bottles sit under
// MIN_RATING, against a fifth of the pool), so the rating floor drops by as
// much as the style's median sits under the pool's, at most RATING_SLACK.
const RATING_SLACK = 0.15;

// Gender lean windows on -1 (feminine) .. +1 (masculine): feminine and
// masculine take in 95% of the pool's bottles Fragrantica labels so, unisex the
// middle 70% of its unisex ones; they overlap.
export const LEAN_WINDOWS = { feminine: [-1, -0.25], unisex: [-0.45, 0.45], masculine: [0.25, 1] };
// A season fits from SEASON_NEAR of the bottle's best season's share; night
// from NIGHT_SPLIT of its day/night votes (the pool's median is 0.38: voters
// wear most bottles by day), day below it. Both read the shares as rank()
// does (steadyShares: few votes lean toward the prediction, flat ones count
// as none), so a filter agrees with the picks.
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
  minRating: MIN_RATING, // style queries: the style's own floor (RATING_SLACK) unless one is given
  hideDiscontinued: true,
  mists: false, // let in body and hair mists, body sprays and splashes
  excludeOwned: true, // search only: style and example picks never include owned bottles or their twins
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
// Names for one note or accord, any of which finds them all (an accord's name
// finds the accord, any other name a note). Plurals and adjective endings
// meet on their own: smoke, smoky and smokey, musk and musky, aldehydes and
// aldehydic.
const SYNONYMS = [
  ['oud', 'agarwood', 'aoud', 'oudh'],
  ['iris', 'orris'],
  ['tonka', 'coumarin'],
  ['frankincense', 'olibanum', 'incense'],
  ['vetiver', 'vetyver'],
  ['ambroxan', 'ambrox', 'ambroxide', 'cetalox'],
  ['lily of the valley', 'muguet'],
  ['patchouli', 'patchouly'],
  ['cedar', 'cedarwood'],
  ['guaiac', 'guaiac wood', 'gaiac'],
  ['cocoa', 'cacao'],
  ['vanilla', 'vanille'],
  ['leather', 'suede', 'cuir'],
  ['tobacco', 'tabac'],
  ['sandalwood', 'sandal wood', 'santal'],
  ['whisky', 'whiskey'],
];
// Words that take in more names than their own, one way: "fresh" finds a
// citrus, not "citrus" a fresh accord.
const BROADER = {
  cashmeran: ['cashmere wood'],
  ylang: ['ylang ylang'],
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

const SCENT = STYLES.filter(s => s.kind === 'scent');
const STYLE_IDS = STYLES.map(s => s.id);
const labelOf = id => STYLES.find(s => s.id === id)?.label ?? id;
const isWear = id => STYLES.find(s => s.id === id)?.kind === 'wear';
// A style "shows" on a bottle from STYLE_MIN, Intimate (a wear style) from WEARS_CLOSE.
const showsFrom = id => (isWear(id) ? WEARS_CLOSE : STYLE_MIN);

// --------------------------------------------------------------- context

// Stored style scores, as pool-styles.json keeps them: [style index, score ×
// 100, …] for the styles from STORED_MIN (anything left out reads as 0). Under
// it a style says nothing about a bottle: the weakest rule that reads scores,
// a bottle's lean, starts at 0.4.
export const STORED_MIN = 30;
export function packStyles(scores) {
  const out = [];
  STYLE_IDS.forEach((id, i) => {
    const v = Math.round(100 * scores[id]);
    if (v >= STORED_MIN) out.push(i, v);
  });
  return out;
}

// How src/scent-styles.js scores, as one hash: every CHECK_EVERY-th pool
// bottle's packed scores, read from its pool row so the app can work it out
// too. pool-styles.json carries the hash it was made with; a file whose hash
// differs (a service worker can keep an old copy) is set aside.
const CHECK_EVERY = 50;
export function styleCheck(records) {
  let h = 0x811c9dc5;
  for (let i = 0; i < records.length; i += CHECK_EVERY) {
    for (const x of [...packStyles(styleScores(records[i])), 255]) h = Math.imul(h ^ x, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

// A bottle's crowd lean (genderLean), or null when neither the crowd nor a
// gender label says.
const leanKnown = (record, byId) => signalsOf(record, byId).lean ?? (record.gender ? genderLean(record, byId) : null);

const bandOf = lean => (lean < -LEAN_EDGE ? 0 : lean > LEAN_EDGE ? 2 : 1);
// Each lean band's share of a set of leans (half a bottle added to each, so
// a band no one owns still gets the odd pick), or null under 3 known.
function leanShares(leans) {
  const known = leans.filter(x => x != null);
  if (known.length < 3) return null;
  const counts = [0.5, 0.5, 0.5];
  for (const x of known) counts[bandOf(x)]++;
  return counts.map(c => c / (known.length + 1.5));
}

/**
 * What Discover's queries share, worked out once per pool and wardrobe: the
 * pool's records (fromPool) and stored style scores, the wardrobe's filters,
 * quality norms, smells-like family, vectors and lean. `styles` is
 * loadPoolStyles()'s file; without it (or when it lists other styles, or
 * styleCheck says src/scent-styles.js has changed since) scores are worked
 * out live once, about 150 ms.
 */
export function discoverContext(pool, owned, { styles = null, records = null } = {}) {
  records ??= Array.from({ length: pool.count }, (_, i) => fromPool(pool, i));
  const byId = new Map(records.map(r => [r.id, r]));
  const norms = poolNorms(records);
  const stored = styles && styles.styles.join() === STYLE_IDS.join() && styles.s.length === records.length
    && styles.check === styleCheck(records) ? styles : null;
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
    leanShares: leanShares(owned.map(f => leanKnown(f, byId))),
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
// but under how well a bottle matches. `norms` overrides the pool's (a
// style's own median rating).
function qualityOf(ctx, record, norms = ctx.norms) {
  ctx.memo.quality ??= new Map();
  const key = norms === ctx.norms ? 'pool' : norms.rating.toFixed(3);
  const memo = ctx.memo.quality.get(key) ?? ctx.memo.quality.set(key, new Map()).get(key);
  let q = memo.get(record);
  if (q === undefined) {
    q = Math.sqrt(candidateQuality(record, norms, { valueSlope: ctx.slope, byId: ctx.byId }).mult);
    memo.set(record, q);
  }
  return q;
}

const median = xs => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};

// Quality norms and a rating floor for a set of candidates (a style's
// bottles): their median rating, and MIN_RATING lowered by as much as that
// sits under the pool's, at most RATING_SLACK.
function normsFor(ctx, ratings) {
  const mid = median(ratings.filter(r => r > 0));
  if (mid == null || mid >= ctx.norms.rating) return { norms: ctx.norms, floor: MIN_RATING };
  const floor = MIN_RATING - Math.min(RATING_SLACK, ctx.norms.rating - mid);
  return { norms: { ...ctx.norms, rating: mid }, floor: Math.round(100 * floor) / 100 };
}

// --------------------------------------------------------------- filters

/**
 * A filter test from FILTERS overrides; throws on a lean, season or slot it
 * doesn't know. `lean` [lo, hi] stands in for the wardrobe's window when no
 * lean filter is set.
 */
export function admitter(ctx, filters = {}, { lean = null } = {}) {
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
    lean: f.lean ? LEAN_WINDOWS[f.lean] : lean ?? ctx.allowed.lean,
    minRating: f.minRating ?? 0,
    minValue: f.minValue,
    mists: Boolean(f.mists),
  };
  return record => {
    if (!allow(record, base)) return false;
    const s = signalsOf(record, ctx.byId);
    if (f.hideDiscontinued && s.flags.includes('discontinued')) return false;
    if (f.minSafe != null && !(s.safe >= f.minSafe)) return false;
    if (seasons || f.slot) {
      const { season, dayNight } = steadyShares(record);
      if (seasons) {
        const best = Math.max(...SEASONS.map(x => season?.[x] ?? 0));
        if (!seasons.some(x => (season?.[x] ?? 0) >= SEASON_NEAR * best)) return false;
      }
      const night = dayNight?.night ?? 0.5;
      if (f.slot && (f.slot === 'night' ? night < NIGHT_SPLIT : night >= NIGHT_SPLIT)) return false;
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
  const original = originalFromVotes(record, ctx, id => ctx.byId.get(id));
  return {
    id: record.id,
    record,
    score,
    styles: topOf(scores),
    close: closeOf(scores),
    nearest,
    family: nov.dupe && nov.dupe.kind !== 'owned' ? nov.dupe.text : null,
    clonesOf: original && { id: original.id, record: original, name: original.name, brand: original.brand, up: null, down: null },
    value: s.value,
    rating: record.rating,
    votes: record.ratingVotes,
    risk: riskOf(record, ctx.byId),
    twin: twin && !twin.owned ? twin : null,
    ...extra,
  };
}

/**
 * A pick's smells-like votes for what it copies, from its about data
 * (loadAbout): fills pick.clonesOf.up and .down when the data has them. ->
 * the pick.
 */
export function addCloneVotes(pick, about) {
  const v = pick.clonesOf && about?.smellsLike?.find(x => String(x.id) === pick.clonesOf.id);
  if (v) Object.assign(pick.clonesOf, { up: v.up, down: v.down });
  return pick;
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
  const copy = pick.clonesOf;
  if (copy) parts.push(`voters say it smells like ${copy.name}${copy.up != null ? ` (${copy.up} to ${copy.down})` : ''}`);
  const near = pick.nearest;
  if (near) {
    const traits = near.traits.length ? near.traits.join(', ') : '';
    parts.push(`closest you own: ${near.name}${near.through ? ` (through its original, ${near.through}${traits ? `: ${traits}` : ''})` : traits ? ` (${traits})` : ''}`);
  }
  if (pick.family) parts.push(pick.family);
  if (pick.alsoLiked) parts.push('fans of your picks like it too');
  if (pick.risk.level !== 'low') parts.push(`${pick.risk.level} risk: ${pick.risk.reasons[0]?.replace(/\.$/, '').toLowerCase() ?? ''}`);
  if (pick.twin) parts.push(`cheaper twin: ${pick.twin.record.name}`);
  const alike = (pick.alike ?? []).filter(r => r.id !== copy?.id);
  if (alike.length) parts.push(`twins: ${alike.map(r => r.name).join(', ')}`);
  return parts.map((p, i) => (i ? lower(p) : upper(p))).join('; ');
}

// Two picks voters call one scent (a family link either way), or over
// MAX_OWNED_SIM alike: the list shows one, with the other as its `alike`.
function twins(a, b) {
  return signalsOf(a).family.includes(b.id) || signalsOf(b).family.includes(a.id) || similarity(a, b) > MAX_OWNED_SIM;
}

const byVotes = records => records.sort((a, b) => (b.ratingVotes ?? 0) - (a.ratingVotes ?? 0));

// The k best of `scored` ([{ record, bound }], bound an upper bound of the
// final score), sorted by bound: each is placed by `final(record, bound)` ->
// { score, … } | null (left out), walking down only while a bound can still
// beat the k-th score. A twin of a pick joins its `alike`, most voted first
// (the better scored of the two leads).
function lazyTop(scored, k, final) {
  if (!(k >= 1)) return [];
  scored.sort((a, b) => b.bound - a.bound);
  const out = [];
  for (const item of scored) {
    if (out.length >= k && item.bound <= out[k - 1].score) break;
    const placed = final(item.record, item.bound);
    if (!placed) continue;
    const i = out.findIndex(p => twins(p.record, placed.record));
    if (i >= 0) {
      const [lead, other] = placed.score > out[i].score ? [placed, out[i]] : [out[i], placed];
      lead.alike = byVotes([...(lead.alike ?? []), other.record, ...(other.alike ?? [])]);
      out[i] = lead;
    } else out.push(placed);
    out.sort((a, b) => b.score - a.score);
    if (out.length > k) out.length = k;
  }
  return out;
}

// --------------------------------------------------------------- styles

// Words for a style beside its label's: "musky" is a skin scent, "soapy" clean.
const STYLE_WORDS = { musk: 'skin', soap: 'clean', fougere: 'aromatic' };
// Words that say what kind of thing, not which style ("clean scents").
const KIND_WORDS = ['scent', 'fragrance', 'perfume', 'one'];

/** Style ids from typed text: ids, labels or their words, any case or plural, comma separated ("skin scents, Clean, intimate", "iris"). */
export function findStyles(text) {
  const key = s => roots(s).join(' ');
  const found = [], unknown = [];
  for (const part of String(text).split(',').map(p => p.trim()).filter(p => roots(p).length)) {
    const kinds = KIND_WORDS.flatMap(roots), words = roots(part).filter(w => !kinds.includes(w)), q = words.join(' ');
    const word = Object.entries(STYLE_WORDS).find(([w]) => key(w) === q)?.[1];
    const style = !words.length ? null : STYLES.find(s => key(s.id) === q || key(s.label) === q || s.id === word)
      ?? STYLES.find(s => words.every(w => roots(s.label).includes(w)) || plain(s.id).replace(/ /g, '').startsWith(plain(part).replace(/ /g, '')));
    if (style) {
      if (!found.includes(style.id)) found.push(style.id);
    } else unknown.push(plain(part));
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
 * each where a card shows it, blended by a soft minimum; when fewer than k
 * are, bottles leaning toward the scent styles follow (`leans`: the chosen
 * styles they only lean toward). Score = style match × √quality (against the
 * style's own median rating, which also sets its rating floor) × novelty
 * (nothing owned, no twin of an owned bottle, nothing over MAX_OWNED_SIM
 * alike to one), the lean bands taking turns (mergeTurns). -> picks as
 * describe() makes them, plus `match` and `via` (the chosen style it's here
 * for); their `styles` lead with the chosen ones.
 */
export function moreOfStyles(styleIds, ctx, { mode = 'any', k = 10, filters = {} } = {}) {
  const ids = [...new Set(styleIds.filter(id => STYLE_IDS.includes(id)))];
  if (mode !== 'any' && mode !== 'all') throw new Error(`Mode is any or all, not "${mode}".`);
  if (!ids.length || !(k >= 1)) return [];
  const scents = ids.filter(id => !isWear(id)), wear = ids.filter(isWear);
  const shares = filters.lean ? null : ctx.leanShares;
  // "Any" of several scent styles: one group per style, taking turns.
  const groups = mode === 'any' && scents.length > 1 ? scents.map(id => [id, ...wear]) : [ids];
  // Intimate beside scent styles: a bottle that doesn't wear close never takes a turn ahead of one that does.
  const fits = scents.length && wear.length ? p => p.close : null;
  const listsFor = how => groups.flatMap((group, g) => styleLists(ctx, group, how, k, filters, shares).map(picks => ({ picks, group: g, fits })));
  const picks = mergeTurns(ctx, listsFor(mode), k, shares);
  if (mode !== 'all' || picks.length >= k || !scents.length) return picks;
  const taken = new Set(picks.flatMap(p => [p.id, ...(p.alike ?? []).map(r => r.id)]));
  const leaning = listsFor('lean').map(l => ({ ...l, picks: l.picks.filter(p => !taken.has(p.id) && !picks.some(q => twins(q.record, p.record))) }));
  return [...picks, ...mergeTurns(ctx, leaning, k - picks.length, shares)];
}

// A pick's styles for its card: the chosen ones it shows first ("Leans oud"
// for one it only leans toward), then its own top ones, three in all (more
// when more were chosen).
function stylesWith(scores, chosen) {
  const first = chosen.filter(id => !isWear(id) && scores[id] >= STYLE_LEAN).map(id => {
    const { label } = STYLES.find(s => s.id === id);
    return scores[id] >= STYLE_MIN ? { id, label, score: scores[id] } : { id, label: `Leans ${lower(label)}`, score: scores[id], leans: true };
  });
  const rest = topOf(scores).filter(s => !chosen.includes(s.id));
  return [...first, ...rest].slice(0, Math.max(3, first.length));
}

// One group of moreOfStyles' styles: its candidates' best (bandLists).
// `how`: 'any' (the group's first style shows), 'all' (each shows) or 'lean'
// (each scent style from STYLE_LEAN, not all showing; Intimate shows).
function styleLists(ctx, ids, how, k, filters, shares) {
  const cols = styleColumns(ctx);
  const scents = ids.filter(id => !isWear(id)), wear = ids.filter(isWear);
  const via = scents[0] ?? wear[0];
  const matches = ctx.records.map((record, i) => {
    if (how === 'any') {
      let match = cols[via][i] >= showsFrom(via) ? cols[via][i] : 0;
      if (match && scents.length && wear.length) match *= WEAR_FLOOR + (1 - WEAR_FLOOR) * Math.max(...wear.map(id => cols[id][i]));
      return match;
    }
    let sum = 0, shows = true;
    for (const id of ids) {
      const x = cols[id][i];
      if (x < showsFrom(id)) {
        if (how === 'all' || isWear(id) || x < STYLE_LEAN) return 0;
        shows = false;
      }
      sum += Math.max(x, 1e-3) ** SOFT_MIN_POWER;
    }
    return how === 'lean' && shows ? 0 : (sum / ids.length) ** (1 / SOFT_MIN_POWER);
  });
  const { norms, floor } = normsFor(ctx, ctx.records.filter((_, i) => matches[i] > 0).map(r => r.rating));
  const admits = admitter(ctx, { ...filters, minRating: 'minRating' in filters ? filters.minRating : floor });
  const scored = [];
  ctx.records.forEach((record, i) => {
    if (matches[i] > 0 && admits(record)) scored.push({ record, bound: matches[i] * qualityOf(ctx, record, norms), match: matches[i] });
  });
  const matchOf = new Map(scored.map(s => [s.record, s.match]));
  return bandLists(ctx, scored, k, (record, bound) => {
    const nov = novelty(record, ctx.vecs, ctx.family);
    if ((nov.dupe?.mult ?? 1) < FAMILY_FLOOR || nov.sim > MAX_OWNED_SIM) return null;
    const styles = stylesWith(scoresOf(record, ctx), ids);
    const leans = styles.filter(s => s.leans).map(s => s.id);
    return describe(ctx, record, { score: bound * nov.mult, nov, extra: { match: matchOf.get(record), via: how === 'any' ? via : null, styles, ...(leans.length && { leans }) } });
  }, shares);
}

// lazyTop's k best of `scored`, as one list per lean band when the lean
// bands take turns (`shares`), else one list.
function bandLists(ctx, scored, k, final, shares) {
  if (!shares) return [lazyTop(scored, k, final)];
  const bands = [[], [], []];
  for (const item of scored) bands[bandOf(genderLean(item.record, ctx.byId))].push(item);
  return bands.map(band => lazyTop(band, k, final));
}

// Ranked lists as one list of k: [{ picks (best first), group, fits }]. Picks
// that fit (`fits(pick)`, if given) and score LEAN_FLOOR of their group's best
// come first: each list's best counts SPREAD less for every pick its group
// has had (chosen styles take turns) and LEAN_SPREAD less for every pick its
// lean band is ahead of `shares` (more for every one behind). The rest follow,
// best first. No bottle twice: a twin of a pick joins its `alike`.
function mergeTurns(ctx, lists, k, shares) {
  const groups = Math.max(0, ...lists.map(l => l.group)) + 1, top = Array(groups).fill(0);
  for (const l of lists) top[l.group] = Math.max(top[l.group], l.picks[0]?.score ?? 0);
  const band = p => bandOf(genderLean(p.record, ctx.byId));
  const strong = (l, p) => p.score >= LEAN_FLOOR * top[l.group] && (!l.fits || l.fits(p));
  const out = [], taken = new Set(), turns = Array(groups).fill(0), inBand = [0, 0, 0];
  while (out.length < k) {
    let next = null, nextScore = -Infinity;
    for (const l of lists) {
      const free = l.picks.filter(p => !taken.has(p.id));
      const head = free.find(p => strong(l, p)) ?? free[0];
      if (!head) continue;
      const lean = shares ? LEAN_SPREAD ** (inBand[band(head)] - shares[band(head)] * out.length) : 1;
      const score = strong(l, head) ? 1 + head.score * SPREAD ** turns[l.group] * lean : head.score / (1 + head.score);
      if (score > nextScore) [next, nextScore] = [{ l, head }, score];
    }
    if (!next) break;
    const { l, head: pick } = next;
    const alike = (pick.alike ?? []).filter(r => !taken.has(r.id));
    const twin = out.find(p => twins(p.record, pick.record));
    if (twin) twin.alike = byVotes([...(twin.alike ?? []), pick.record, ...alike]);
    else {
      if (pick.alike) pick.alike = alike;
      out.push(pick);
      turns[l.group]++;
      inBand[band(pick)]++;
    }
    for (const r of [pick.record, ...alike]) taken.add(r.id);
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
 * lists them in alsoLiked. A seed without accords (a dupe's built `original`)
 * stands in as its pool row. The seeds themselves, owned bottles, their twins
 * and versions and anything over MAX_OWNED_SIM alike to an owned bottle stay
 * out, and a bottle voters link to one (family) counts its family multiplier:
 * more of the seeds' kind, not another copy of a bottle already owned.
 * Without a lean filter, picks keep to the seeds' leans (SEED_LEAN_MARGIN). ->
 * picks as describe() makes them, plus `sim` (to the seeds), `shares` and
 * `alsoLiked` (how many seeds list it).
 */
export function moreLike(seeds, ctx, { k = 10, filters = {}, alsoLiked = ALSO_LIKED } = {}) {
  const hasScent = r => Object.keys(r?.accords ?? {}).length > 0;
  seeds = seeds.map(seed => {
    if (hasScent(seed)) return seed;
    const row = ctx.byId.get(String(seed.id)) ?? poolRowOf(seed, ctx.byId);
    return row ? { ...row, about: seed.about ?? row.about } : seed;
  }).filter(hasScent);
  if (!seeds.length || !(k >= 1)) return [];
  const leans = seeds.map(seed => leanKnown(seed, ctx.byId)).filter(x => x != null);
  const lean = leans.length ? [Math.max(-1, Math.min(...leans) - SEED_LEAN_MARGIN), Math.min(1, Math.max(...leans) + SEED_LEAN_MARGIN)] : null;
  const target = centroid(seeds), admits = admitter(ctx, filters, { lean });
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
    if (sim > 0) scored.push({ record, bound: sim * qualityOf(ctx, record) * lift, sim });
  }
  const simOf = new Map(scored.map(s => [s.record, s.sim]));
  return lazyTop(scored, k, (record, bound) => {
    const nov = novelty(record, ctx.vecs, ctx.family);
    if ((nov.dupe?.mult ?? 1) < FAMILY_FLOOR || nov.sim > MAX_OWNED_SIM) return null;
    return describe(ctx, record, {
      score: bound * (nov.dupe?.mult ?? 1),
      nov,
      extra: { sim: simOf.get(record), shares: sharedTraits(record, target, 4), alsoLiked: liked.get(record.id) ?? 0 },
    });
  });
}

// --------------------------------------------------------------- notes and accords

// Words as search compares them: accents, case and plurals aside, and an
// adjective's ending ("smoky", "smokey" and "smoke", "musky" and "musk",
// "ozonic" and "ozone" meet).
const plain = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function root(word) {
  if (word.length <= 3) return word;
  let w = word;
  if (w === 'leaves') return 'leaf';
  if (/ies$/.test(w)) w = `${w.slice(0, -3)}y`;
  else if (/(ch|sh|x)es$/.test(w)) w = w.slice(0, -2);
  else if (/[^su]s$/.test(w) && !/is$/.test(w)) w = w.slice(0, -1);
  if (w.length > 4) w = w.replace(/(ey|ic|y|e)$/, '');
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
const ALIAS_BY_ROOTS = new Map();
const addAlias = (word, more) => {
  const key = roots(word).join(' ');
  ALIAS_BY_ROOTS.set(key, [...new Set([...(ALIAS_BY_ROOTS.get(key) ?? []), ...more])]);
};
for (const group of SYNONYMS) for (const word of group) addAlias(word, group.filter(w => w !== word));
for (const [word, more] of Object.entries(BROADER)) addAlias(word, more);

// A typo is read as the nearest name search knows: one edit away for a word
// of up to 6 letters, two for longer ones (a swap counts one), from
// TYPO_MIN_LETTERS. A word that names nothing is read so. One that names only
// notes on under RARE_TERM bottles stays as typed, with the near name as a
// suggestion when that's on TYPO_GAIN times as many: "vanila" is a misspelt
// note on 43 bottles, but clover isn't clove. A word of TYPO_SWAP_LETTERS
// (iris, musk, rose) is read so only through a swap of two neighbours
// ("irsi"), and only when it names nothing: any other edit turns too many
// short words into a note.
const TYPO_MIN_LETTERS = 5;
const TYPO_SWAP_LETTERS = 4;
const RARE_TERM = 100;
const TYPO_GAIN = 10;

// Edits between two words (insert, delete, change, swap two neighbours), or
// max + 1 once it's past max.
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2 = null, prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      let d = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, prev2[j - 2] + 1);
      row.push(d);
      best = Math.min(best, d);
    }
    if (best > max) return max + 1;
    [prev2, prev] = [prev, row];
  }
  return prev[b.length];
}

// Whether b is a with two neighbouring letters swapped.
function swapped(a, b) {
  if (a.length !== b.length) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return i < a.length - 1 && a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
}

// The note names search knows: the pool's and the wardrobe's, by their roots,
// each with how many pool bottles carry it (`count`), and how many carry each
// accord (`accordCount`).
function noteVocabulary(ctx) {
  if (ctx.memo.notes) return ctx.memo.notes;
  const counts = new Map(), accordCount = new Map();
  for (const r of ctx.owned) for (const list of Object.values(r.notes ?? {})) for (const n of list) if (!counts.has(n)) counts.set(n, 0);
  for (const r of ctx.records) {
    for (const n of new Set(Object.values(r.notes ?? {}).flat())) counts.set(n, (counts.get(n) ?? 0) + 1);
    for (const a in r.accords ?? {}) accordCount.set(a, (accordCount.get(a) ?? 0) + 1);
  }
  const list = [...counts].map(([name, count]) => ({ name, roots: roots(name), count }));
  list.known = new Set([...ACCORD_BY_ROOTS.keys(), ...list.map(v => v.roots.join(' ')), ...ALIAS_BY_ROOTS.keys()]);
  list.words = [...list.known].filter(w => !w.includes(' '));
  list.accordCount = accordCount;
  return (ctx.memo.notes = list);
}

// A run of query words as a term: { text, accords, notes, reach (about how
// many pool bottles carry it) }.
function termOf(text, vocab) {
  const runs = [text, ...(ALIAS_BY_ROOTS.get(roots(text).join(' ')) ?? [])].map(roots);
  const accords = new Set(runs.map(r => ACCORD_BY_ROOTS.get(r.join(' '))).filter(Boolean));
  const matched = vocab.filter(v => runs.some(r => containsRun(v.roots, r)));
  const reach = Math.max(0, ...[...accords].map(a => vocab.accordCount.get(a) ?? 0)) + matched.reduce((n, v) => n + v.count, 0);
  return { text, accords, notes: new Set(matched.map(v => v.name)), reach };
}

// The name a mistyped word most likely means (TYPO_MIN_LETTERS and up, or a
// swap in a TYPO_SWAP_LETTERS word that names nothing), as a term reaching
// more than `reach` × TYPO_GAIN bottles, or null.
function retype(word, reach, vocab) {
  if (/\d/.test(word)) return null;
  const short = word.length < TYPO_MIN_LETTERS;
  if (short && (word.length !== TYPO_SWAP_LETTERS || reach > 0)) return null;
  const max = word.length <= 6 ? 1 : 2, w = root(word);
  let best = null;
  for (const entry of vocab.words) {
    const d = short ? (swapped(w, entry) ? 1 : max + 1) : editDistance(w, entry, max);
    if (d > max || d === 0) continue;
    const term = termOf(entry, vocab);
    if (term.reach > Math.max(reach * TYPO_GAIN, 0) && (!best || d < best.d || (d === best.d && term.reach > best.term.reach))) best = { d, term };
  }
  if (!best) return null;
  // Show the name as the bottles have it ("lavender", not its root; the note
  // "musk" before the accord "musky").
  const named = vocab.find(v => v.roots.join(' ') === best.term.text)?.name ?? [...best.term.accords][0];
  return { ...best.term, text: named ? plain(named) : best.term.text };
}

/**
 * A notes and accords query as terms: the longest runs of words that name an
 * accord, a note or an alias ("tonka bean", "lily of the valley", "white
 * floral"), else single words; joiners ("and", "with") drop out. A word that
 * names nothing reads as the name it's nearest (retype), and a rare one gets
 * that name as a suggestion. -> { terms: [{ text, accords: Set, notes: Set }],
 * unknown: words that name nothing, corrected and suggested: [{ from, to }] }.
 */
export function parseNotes(query, ctx) {
  const vocab = noteVocabulary(ctx);
  const words = plain(query).split(' ').filter(Boolean);
  const { known } = vocab;
  const terms = [], unknown = [], corrected = [], suggested = [];
  for (let i = 0; i < words.length;) {
    let span = 0;
    for (let n = Math.min(5, words.length - i); n > 1 && !span; n--) {
      if (known.has(words.slice(i, i + n).map(root).join(' '))) span = n;
    }
    if (!span && JOINERS.has(words[i])) { i++; continue; }
    span ||= 1;
    const text = words.slice(i, i + span).join(' ');
    i += span;
    let term = termOf(text, vocab);
    if (span === 1 && !term.accords.size && term.reach < RARE_TERM) {
      const near = retype(text, term.reach, vocab);
      if (near && !term.notes.size) {
        corrected.push({ from: text, to: near.text });
        term = near;
      } else if (near) suggested.push({ from: text, to: near.text });
    }
    if (term.accords.size || term.notes.size) terms.push(term);
    else unknown.push(text);
  }
  return { terms, unknown, corrected, suggested };
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
 * mean of the terms' strengths × √quality, the lean bands taking turns
 * (mergeTurns). With excludeOwned (the default) owned bottles, twins and
 * versions of them and anything over MAX_OWNED_SIM alike to one stay out, and
 * a bottle in an owned one's family counts its family multiplier, as for
 * style and example picks; without, they all come back, labelled. -> { terms,
 * unknown, corrected, suggested (parseNotes), results }, each result a pick
 * as describe() makes it plus `matched`: [{ term, name, via, strength }]. A
 * query with a word that names nothing returns no results.
 */
export function searchNotes(query, ctx, filters = {}, { k = 10 } = {}) {
  const { terms, unknown, corrected, suggested } = parseNotes(query, ctx);
  const texts = terms.map(t => t.text);
  if (!terms.length || unknown.length || !(k >= 1)) return { terms: texts, unknown, corrected, suggested, results: [] };
  const admits = admitter(ctx, filters), gate = { ...FILTERS, ...filters }.excludeOwned;
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
  const shares = filters.lean ? null : ctx.leanShares;
  const lists = bandLists(ctx, scored, k, (record, bound) => {
    const { match, matched } = byRecord.get(record);
    const nov = novelty(record, ctx.vecs, ctx.family), kin = nov.dupe?.mult ?? 1;
    if (gate && (kin < FAMILY_FLOOR || nov.sim > MAX_OWNED_SIM)) return null;
    return describe(ctx, record, { score: bound * (gate ? kin : 1), nov, extra: { match, matched } });
  }, shares);
  const results = mergeTurns(ctx, lists.map(picks => ({ picks, group: 0 })), k, shares);
  return { terms: texts, unknown, corrected, suggested, results };
}

// --------------------------------------------------------------- dupes

// A dupe's original, as voters have it: a bottle it smells like (family
// links first, then plain smells-like ones) from another brand, released no
// later, valued at least ORIGINAL_VALUE_GAP lower (dupes are bought for
// value) and, through a plain link, at least CLONE_SIM alike; only for a
// bottle whose year is known. A bottle voters call one scent with an original
// counts as its clone when it's from another brand, released no earlier,
// valued CLONE_VALUE_GAP higher (decant.py's rule for cheaper alternatives)
// and at least CLONE_SIM alike, which leaves out the odd link between bottles
// that share nothing. Bottles NOTES_SIM alike and valued as much higher that
// no vote links are cheaper alternatives "by notes" (up to NOTES_ALIKE).
const ORIGINAL_VALUE_GAP = 0.5;
const CLONE_VALUE_GAP = 1;
const CLONE_SIM = 0.3;
const NOTES_SIM = 0.75;
const NOTES_ALIKE = 5;
// A smells-like vote in a bottle's about data counts from AGREED_NET net
// votes and 2:1, as decant.py and candidates.js read them.
const AGREED_NET = 5;
const agreed = v => v.up - v.down >= AGREED_NET && v.up >= 2 * v.down;

/** What a bottle copies, going by the votes (the rule above): a record from `get` (id -> record), or null. */
export function originalFromVotes(record, ctx, get = id => ctx.byId.get(id)) {
  const s = signalsOf(record, ctx.byId), own = s.value;
  if (record.year == null || own == null) return null;
  const family = new Set(s.family);
  for (const id of [...s.family, ...s.like.filter(id => !family.has(id))]) {
    const r = get(id), v = r && signalsOf(r, ctx.byId).value;
    if (!r || r.brand === record.brand || (r.year ?? 0) > record.year || v == null || v > own - ORIGINAL_VALUE_GAP) continue;
    if (family.has(id) || similarity(record, r) >= CLONE_SIM) return r;
  }
  return null;
}

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
 * cheaper, siblings }, each bottle in one list at most.
 * - original: what it's a dupe of (an owned dupe's own, `built`; else read
 *   from the votes, originalFromVotes), or null.
 * - cheaper: bottles that smell like it for far less, most agreed and alike
 *   first: voters' cheaper twins (extras.alt) and, for a bottle that isn't a
 *   dupe itself, its clones (extras.clones, and pool bottles whose links name
 *   it, by the clone rule), `why` 'votes'; and pool bottles alike by notes no
 *   vote links, `why` 'notes'. `notesDiffer` marks a voted one under
 *   CLONE_SIM alike.
 * - siblings: other bottles voters link it or its original with, most agreed
 *   first (its about data's links from AGREED_NET net votes and 2:1).
 * Each entry: { id, record, name, brand, value, rating, votes, risk, sim (to
 * this bottle), owned, up, down, why }, `up` and `down` its smells-like votes
 * when this bottle's about data has them. `more` (Map of id -> record, from
 * dupeIds) adds bottles outside the pool.
 */
export function dupesOf(record, ctx, { more = null } = {}) {
  const get = id => ctx.byId.get(String(id)) ?? more?.get(String(id)) ?? null;
  const self = String(record.id), row = poolRowOf(record, ctx.byId);
  const s = signalsOf(record, ctx.byId), own = s.value;
  const votes = new Map((record.about?.smellsLike ?? []).map(x => [String(x.id), x]));
  const familyOf = reverseLinks(ctx, 'family'), likeOf = reverseLinks(ctx, 'like');
  const seen = new Set([self, row?.id]);
  const scented = Object.keys(record.accords ?? {}).length > 0;
  const entry = (r, why) => {
    const id = String(r.id), v = votes.get(id), sig = signalsOf(r, ctx.byId);
    const sim = scented && r.accords ? Math.round(1000 * similarity(record, r)) / 1000 : null;
    return {
      id,
      record: r,
      name: r.name,
      brand: r.brand,
      value: sig.value,
      rating: r.rating ?? null,
      votes: r.ratingVotes ?? null,
      risk: riskOf(r, ctx.byId),
      sim,
      owned: ctx.allowed.owned.has(id),
      mist: sig.flags.includes('mist'),
      up: v?.up ?? null,
      down: v?.down ?? null,
      why,
      ...(why === 'votes' && sim != null && sim < CLONE_SIM && { notesDiffer: true }),
    };
  };
  // Bottles not listed yet, as entries, in order.
  const take = (ids, why, keep = () => true) => {
    const out = [];
    for (const id of ids.map(String)) {
      const r = get(id);
      if (!r || seen.has(r.id) || !keep(r)) continue;
      seen.add(r.id);
      out.push(entry(r, why));
    }
    return out;
  };

  let original = null;
  if (record.original) {
    // Its pool or r/ record, else the build's summary of it (no accords, so no similarity).
    const r = get(record.original.id) ?? record.original;
    seen.add(String(r.id));
    original = { ...entry(r, 'votes'), built: true };
  } else {
    const r = originalFromVotes(record, ctx, get);
    if (r) {
      seen.add(r.id);
      original = { ...entry(r, 'votes'), built: false };
    }
  }

  const valueOf = r => signalsOf(r, ctx.byId).value;
  const copies = r => r.brand !== record.brand && (r.year ?? Infinity) >= (record.year ?? 0)
    && valueOf(r) >= (own ?? Infinity) + CLONE_VALUE_GAP && similarity(record, r) >= CLONE_SIM;
  const linking = [...familyOf(self), ...likeOf(self), ...(row ? [...familyOf(row.id), ...likeOf(row.id)] : [])];
  const voted = [...take(s.alt, 'votes'), ...(original ? [] : [...take(s.clones, 'votes'), ...take(linking, 'votes', copies)])];
  // Alike by notes: the pool's closest from other brands, valued far higher, that no vote links.
  const byNotes = [], linked = new Set([...linking, ...s.like, ...s.family, ...votes.keys()]);
  if (scented && own != null) {
    for (const r of ctx.records) {
      if (seen.has(r.id) || linked.has(r.id) || r.brand === record.brand || !(valueOf(r) >= own + CLONE_VALUE_GAP) || !(r.rating >= MIN_RATING)) continue;
      const flags = signalsOf(r, ctx.byId).flags;
      if (flags.includes('brigaded') || flags.includes('discontinued')) continue;
      const sim = similarity(record, r);
      if (sim >= NOTES_SIM) byNotes.push([sim, r.id]);
    }
    byNotes.sort((a, b) => b[0] - a[0]);
  }
  const net = e => (e.up != null ? e.up - e.down : e.why === 'votes' ? AGREED_NET : 0);
  const rankOf = e => (e.sim ?? 0.5) * Math.log10(10 + Math.max(0, net(e)));
  const cheaper = [...voted, ...take(byNotes.slice(0, NOTES_ALIKE).map(([, id]) => id), 'notes')]
    .sort((a, b) => rankOf(b) - rankOf(a));

  const around = [...[...votes.values()].filter(agreed).map(v => String(v.id)), ...s.family, ...s.like, ...s.clones, ...likeOf(self), ...familyOf(self)];
  if (original) {
    const o = record.original, os = original.record ? signalsOf(original.record, ctx.byId) : null;
    around.push(...(o?.siblings ?? []), ...(o?.extras?.family ?? os?.family ?? []), ...familyOf(original.id), ...likeOf(original.id));
  }
  const siblings = take(around, 'votes', r => !votes.has(String(r.id)) || agreed(votes.get(String(r.id))))
    .sort((a, b) => net(b) - net(a) || (b.sim ?? 0) - (a.sim ?? 0));
  return { original, cheaper, siblings };
}
