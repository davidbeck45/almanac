// Recommendation engine. Pure functions only: fragrances + conditions in,
// ranked tiers with reasons out.
import { ACCORDS, heaviness, accordNoun } from './accords.js';
import { isWet, dewPointF } from './wmo.js';
import { predictedShares } from './custom.js';
import { PRIOR_VOTES } from './profiles.js';
import { OCCASION_SCALE } from './occasions.js';

export const SEASONS = ['winter', 'spring', 'summer', 'fall'];

// Feels-like temperature (°F) of each season's day and night windows, mean and
// spread, over 2023–2025 in ten temperate cities (scripts/fit-seasons.mjs,
// from Open-Meteo's archive): the weather voters mean by "a summer scent".
const SEASON_CLIMATE = { winter: [34, 12], spring: [51, 13], summer: [76, 10.5], fall: [56, 14.5] };
// Spring and fall share a temperature range, so the calendar splits it: up to
// 0.5 + TRANSITION_SPLIT to fall in mid-October, to spring in mid-April, and
// evenly at midsummer and midwinter. Toward winter temperatures the split
// fades to even, from the full split at TRANSITION_COLD[1] (just above
// fall's mean) to none at [0] (just above winter's): spring votes go to
// florals and greens, and a cold April night calls for them no more than a
// cold October one.
const TRANSITION_SPLIT = 0.35;
const TRANSITION_COLD = [38, 58];
const FALL_PEAK_DAY = 288; // Oct 15
// Midwinter and midsummer days still lean a little toward their calendar
// season, by up to CALENDAR_BOOST in mid-January and mid-July, easing off
// smoothly toward the equinoxes (as much in all as three full months).
const CALENDAR_BOOST = 1.35;
// The tropics have no spring or fall to speak of: the calendar's say fades
// out between these latitudes, toward the equator.
const TROPICS = [15, 25];

// How much each part counts toward a score (scoreOf). An occasion's own
// weights are occasionWeights(): these, unless its fit is mild (MILD_SPAN).
export const DAILY_WEIGHTS = Object.freeze({ season: 0.5, time: 0.25, weather: 0.2, quality: 0.05 });
export const OCCASION_WEIGHTS = Object.freeze({ occasion: 0.4, season: 0.3, time: 0.1, weather: 0.15, quality: 0.05 });
// What a rich bottle loses for an occasion in weather that calls for fresh
// (parts.heat, richInHeat). With the occasion's fit at 0.4 and the weather
// at 0.15, a date's love of vanilla and amber kept four winter bottles in a
// 90°F night's top 6, all A; daily picks weigh season and weather at 0.7 and
// need no such help. An occasion spent indoors (`indoors`) doesn't pay it.
const HEAT_WEIGHT = 0.3;

// Rank cutoffs: first 3 are S, next 5 A, next 6 B, rest C. A tier also needs
// its floor score, so in a small collection on a sweltering day the third
// best (still "too rich for sticky heat") isn't S; it drops to the first
// tier whose floor it meets.
const TIER_SIZES = [['S', 3], ['A', 5], ['B', 6]];
const TIER_FLOORS = { S: 0.75, A: 0.6, B: 0, C: -Infinity };
const TIERS = ['S', 'A', 'B', 'C'];

// Worn today, yesterday, 2 days ago … 9 days ago. In mild weather top scores
// sit within a few hundredths of each other, so a 3-day memory cycled the
// same 3 bottles through a month of steady weather; a 10-day tail rotates
// 9–17. A cold day's top leads by more (a median 0.035), so a winter month
// wears 8 bottles or more, none more than 12 times in 56 windows.
export const ROTATION_PENALTY = Object.freeze([0.2, 0.12, 0.08, 0.06, 0.045, 0.035, 0.025, 0.02, 0.015, 0.01]);

const RAIN_ACCORDS = ['green', 'earthy', 'woody', 'aromatic', 'mossy', 'aquatic'];

// Reasons name accords as nouns (accordNoun: "Warm spice for the cold", never
// "Warm warm spicy").
const nounOf = accordNoun;
// Accords a reason names one of, not both ("Aquatic notes & marine notes").
const NEAR_SAME = [
  ['aquatic', 'marine', 'salty', 'ozonic'], ['warm spicy', 'soft spicy', 'fresh spicy', 'cinnamon'], ['fruity', 'tropical'],
  ['nutty', 'almond'], ['floral', 'white floral', 'yellow floral', 'tuberose'],
];
const kinOf = accord => NEAR_SAME.find(group => group.includes(accord)) ?? [accord];
const isPlural = noun => /s$/.test(noun) && !/(ss|us|is)$/.test(noun);
const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
// What cuts the heat. A light bottle without one of these (fruity, musky,
// coconut) is only "light enough for the heat".
const COOLING = {
  citrus: 'Bright citrus cuts', green: 'Green notes cut', aquatic: 'Aquatic notes cut', marine: 'Marine notes cut',
  ozonic: 'Airy notes cut', fresh: 'Fresh notes cut', herbal: 'Herbs cut', salty: 'Sea salt cuts', 'fresh spicy': 'Crisp spice cuts',
};
const WARMING = {
  'warm spicy': 'Warm spice', vanilla: 'Warm vanilla', leather: 'Rich leather', oud: 'Deep oud', tobacco: 'Rich tobacco',
  balsamic: 'Warm resins', animalic: 'A warm animalic base', honey: 'Warm honey', caramel: 'Warm caramel',
  cacao: 'Warm cacao', chocolate: 'Rich chocolate', coffee: 'Dark coffee', rum: 'Warm rum', whiskey: 'Warm whiskey',
  cinnamon: 'Warm cinnamon', amber: 'Warm amber', smoky: 'Smoke', sweet: 'Warm sweetness',
};
const warmPhrase = accord => WARMING[accord] ?? (nounOf(accord).startsWith('warm ') ? cap(nounOf(accord)) : `Warm ${nounOf(accord)}`);

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const argmax = obj => Object.entries(obj).reduce((best, e) => (e[1] > best[1] ? e : best))[0];

export function calendarSeason(date, lat = 1) {
  const m = date.getMonth(); // 0 = Jan
  const north = m <= 1 || m === 11 ? 'winter' : m <= 4 ? 'spring' : m <= 7 ? 'summer' : 'fall';
  if (lat >= 0) return north;
  return { winter: 'summer', spring: 'fall', summer: 'winter', fall: 'spring' }[north];
}

const localISO = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const dayOfYear = date => (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(date.getFullYear(), 0, 0)) / 86_400_000;

// How much each season "is" right now, normalized to sum to 1: how typical
// this temperature is of each season's weather, then the calendar's say.
// Without a date the calendar has none (comfortRange: what suits a bottle
// whatever the time of year).
export function targetSeasonWeights(feelsF, date, lat = 40) {
  const w = {};
  for (const s of SEASONS) {
    const [mean, spread] = SEASON_CLIMATE[s];
    const z = (feelsF - mean) / spread;
    w[s] = Math.exp(-0.5 * z * z) / spread;
  }
  const reach = date ? clamp((Math.abs(lat ?? 40) - TROPICS[0]) / (TROPICS[1] - TROPICS[0]), 0, 1) : 0;
  // 0 in mid-October (north), a quarter turn on in mid-January.
  const angle = date ? (2 * Math.PI * (dayOfYear(date) - FALL_PEAK_DAY - (lat < 0 ? 365.25 / 2 : 0))) / 365.25 : 0;
  const lean = Math.sin(angle);
  w.winter *= 1 + (CALENDAR_BOOST - 1) * reach * Math.max(0, lean) ** 2;
  w.summer *= 1 + (CALENDAR_BOOST - 1) * reach * Math.max(0, -lean) ** 2;
  const mild = clamp((feelsF - TRANSITION_COLD[0]) / (TRANSITION_COLD[1] - TRANSITION_COLD[0]), 0, 1);
  const fallShare = 0.5 + TRANSITION_SPLIT * reach * mild * Math.cos(angle);
  const transition = w.spring + w.fall;
  w.fall = transition * fallShare;
  w.spring = transition * (1 - fallShare);
  const total = SEASONS.reduce((sum, s) => sum + w[s], 0);
  for (const s of SEASONS) w[s] = total ? w[s] / total : 0.25;
  return w;
}

// Season or day/night votes that say nothing: the least-voted season (or
// slot) drew FLAT_TURNOUT of the raters or more and the shares sit within
// FLAT_SPREAD (most raters ticked everything: Elyon Dubai's 2025 releases),
// or 3 seasons, or both slots, carry one identical count of FLAT_SAME or
// more (some Louis Vuitton pages: 765 on every season and both slots), or
// FLAT_ACROSS of the six boxes, seasons and slots together, do (Shalimar
// Millésime Tonka: 432 on winter, fall, day and night). Read as votes, they
// make a perfect all-rounder of a rose-oud, so steadyShares reads them as
// none. A page shows counts from 1,000 rounded ("2.4k"), so scraped ties
// there are no sign.
const FLAT_SPREAD = 0.03;
const FLAT_TURNOUT = 0.5;
const FLAT_SAME = 50;
const FLAT_ACROSS = 4;
const exactCount = c => c < 1000 || c % 100 !== 0;
const sameCount = (counts, times) => counts.some(c => c >= FLAT_SAME && exactCount(c) && counts.filter(x => x === c).length >= times);

/** Whether vote counts ([winter, spring, summer, fall] or [day, night]) from `raters` raters say nothing. */
export function flatVotes(counts, raters) {
  const n = counts.reduce((a, b) => a + b, 0);
  if (!n) return false;
  const lo = Math.min(...counts), hi = Math.max(...counts);
  if ((hi - lo) / n < FLAT_SPREAD && lo >= FLAT_TURNOUT * raters) return true;
  return sameCount(counts, Math.min(3, counts.length));
}

/**
 * Whether a record's season and day/night votes say anything: { season,
 * time }, false without votes or with flat ones. Day and night are only two
 * choices, and half the raters ticking both is a bottle worn either way
 * (Sauvage EDP, Bleu de Chanel Parfum), so day/night votes count as flat
 * only on a page whose season votes are flat too.
 */
export function votedShares(frag) {
  const sv = frag.seasonVotes, tv = frag.timeVotes, raters = frag.ratingVotes ?? 0;
  if (sv && tv && sameCount([sv.winter, sv.spring, sv.summer, sv.fall, tv.day, tv.night], FLAT_ACROSS)) return { season: false, time: false };
  const season = Boolean(sv) && !flatVotes([sv.winter, sv.spring, sv.summer, sv.fall], raters);
  const time = Boolean(tv) && !(sv && !season && flatVotes([tv.day, tv.night], raters));
  return { season, time };
}

// A split from few votes is noisy, so voted shares lean toward a prediction
// (src/custom.js): what the accords predict, averaged with the votes of the
// bottles voters say it smells like (`like`) when it has them. The prediction
// counts as PRIOR_VOTES votes, about how far well-voted bottles stray from it
// out of sample (scripts/fit-profiles.mjs).
// A dupe's original (`original`, from data/dupes.json) predicts its split
// better: across the wardrobe's 19 dupes it strays about as far as 120 votes
// would, for seasons and day/night alike (133 and 137 when measured again
// in October 2026). Both count toward the prior.
// Flat votes (flatVotes) count as none, so the prediction (and an original)
// decides. Fragella and hand-entered bottles are estimates already and pass
// through.
const ORIGINAL_PRIOR_VOTES = 120;
const steadied = new WeakMap();

export function steadyShares(frag) {
  if (!frag.seasonVotes && !frag.timeVotes) return frag;
  const known = steadied.get(frag);
  if (known) return known;
  const orig = frag.original;
  const ko = orig ? ORIGINAL_PRIOR_VOTES : 0;
  const est = predictedShares(frag.accords, frag.like);
  const k = frag.like ? PRIOR_VOTES.withLike : PRIOR_VOTES.accords;
  const voted = votedShares(frag);
  // Season and day/night votes steady separately; a split nobody voted on is an estimate already.
  let season = frag.season, dayNight = frag.dayNight;
  if (frag.seasonVotes) {
    const n = voted.season ? SEASONS.reduce((sum, s) => sum + frag.seasonVotes[s], 0) : 0;
    season = Object.fromEntries(SEASONS.map(s => [s,
      (n * frag.season[s] + k.season * est.season[s] + ko * (orig?.season[s] ?? 0)) / (n + k.season + ko)]));
  }
  if (frag.timeVotes) {
    const tn = voted.time ? frag.timeVotes.day + frag.timeVotes.night : 0;
    const night = (tn * frag.dayNight.night + k.night * est.night + ko * (orig?.dayNight.night ?? 0)) / (tn + k.night + ko);
    dayNight = { day: 1 - night, night };
  }
  const shares = { season, dayNight };
  steadied.set(frag, shares);
  return shares;
}

// Half "is this within the fragrance's comfort zone" (relative to its own best
// season), half "is this its specialty" (lift over an even 25% split). Without
// the lift, all-rounders tie specialists in-season and win everywhere else.
// Written out season by season (the gap finder calls it 9,600 bottles × 10
// slot-bands × 6 windows at a time), in SEASONS order, as a loop would add.
export function seasonFit(frag, weights) {
  const { winter, spring, summer, fall } = steadyShares(frag).season;
  const peak = Math.max(winter, spring, summer, fall) || 1;
  const relative = weights.winter * (winter / peak) + weights.spring * (spring / peak)
    + weights.summer * (summer / peak) + weights.fall * (fall / peak);
  const lift = (weights.winter * winter + weights.spring * spring + weights.summer * summer + weights.fall * fall) / 0.25;
  return 0.5 * relative + 0.5 * clamp(lift / 1.6, 0, 1);
}

// Voters call rich bottles night scents (the night share tracks accord
// heaviness, r 0.74 over the pool), and the weather part reads that richness
// already, so on a cold day the votes marked down the very bottles the cold
// calls for: Cream Velvet, the one rich bottle voted half by day, topped
// every cold day and was worn 16 days of 28 in a Chicago winter. By day the
// time fit forgives up to TIME_FORGIVE of a bottle's shortfall, in step with
// how much richness the weather calls for (targetHeaviness, up to 1) and how
// rich the bottle is (fully from RICH_BY_DAY). Nights stay as voted:
// forgiving a fresh bottle's day lean on a hot night only handed hot nights
// to one fresh bottle.
const TIME_FORGIVE = 0.6;
const RICH_BY_DAY = 0.4;

// The share of a bottle's time-of-day shortfall the weather forgives, 0..TIME_FORGIVE.
export function timeForgiven(frag, slot, conditions) {
  if (slot !== 'day' || !conditions) return 0;
  const want = targetHeaviness(conditions);
  if (want <= 0) return 0;
  return TIME_FORGIVE * Math.min(want, 1) * clamp(heaviness(frag.accords) / RICH_BY_DAY, 0, 1);
}

// The votes' fit for the slot, its shortfall partly forgiven in `conditions` (timeForgiven).
export function timeFit(frag, slot, conditions = null) {
  const { dayNight } = steadyShares(frag);
  const peak = Math.max(dayNight.day, dayNight.night) || 1;
  const lift = dayNight[slot] / 0.5;
  const fit = 0.5 * (dayNight[slot] / peak) + 0.5 * clamp(lift / 1.3, 0, 1);
  return fit + (1 - fit) * timeForgiven(frag, slot, conditions);
}

// Dew point (°F): src/wmo.js has it, so the forecast needn't load the engine.
export { dewPointF };

// Mugginess follows the dew point, not relative humidity: about 55°F feels
// comfortable, 65°F sticky, 70°F and up oppressive, whatever the temperature.
// Forecast windows carry dewF; other conditions estimate it from feels-like.
const MUGGY_DEW_F = 60;
const dewOf = c => c.dewF ?? dewPointF(c.feelsF, c.humidity);
export const isSticky = c => c.feelsF > 75 && dewOf(c) >= 65;

// Heaviness the weather calls for: -1 (as fresh as possible) .. +1 (rich).
export function targetHeaviness(conditions) {
  const { feelsF } = conditions;
  let t = clamp((65 - feelsF) / 35, -1, 1);
  if (feelsF > 70) t -= clamp((dewOf(conditions) - MUGGY_DEW_F) / 40, 0, 0.4); // sticky heat
  return clamp(t, -1, 1);
}

function accordShare(accords, names) {
  let hit = 0, total = 0;
  for (const [a, s] of Object.entries(accords)) {
    total += s;
    if (names.includes(a)) hit += s;
  }
  return total ? hit / total : 0;
}

export function weatherFit(frag, conditions) {
  const fit = 1 - Math.abs(heaviness(frag.accords) - targetHeaviness(conditions)) / 2;
  const rain = isWet(conditions.category) ? 0.1 * accordShare(frag.accords, RAIN_ACCORDS) : 0;
  return clamp(fit + rain, 0, 1);
}

/**
 * How rich a bottle is for the heat (parts.heat), 0..1: how far the bottle
 * sits on the rich side of neutral, times the square of how far the weather
 * calls for fresh (targetHeaviness under 0), so a warm evening costs it a
 * little and a sweltering one a lot. Fresh and neutral bottles read 0 in any
 * weather, so it reorders only the rich ones, and only where it's warm.
 */
export function richInHeat(frag, conditions) {
  const fresh = clamp(-targetHeaviness(conditions), 0, 1);
  return fresh * fresh * clamp(heaviness(frag.accords), 0, 1);
}

// Feels-like range a bottle suits on its own: its season and weather fit,
// weighted as in daily picks, scanned in 1°F steps, whatever the time of year
// (the calendar would otherwise move a cold-weather bottle's range by 26°F
// between April and October). The range runs out from the peak to where the
// fit falls COMFORT_DROP below it; lowF / highF are null when it runs off the
// scan (nothing is too cold for a winter scent). bestF, the middle of the
// peak, is only given for a range closed on both ends. At a 0.1 drop rich
// bottles topped out in the low 40s, though collectors wear them into the
// 50s; 0.15 opened most two-sided ranges (Supremacy read as best in any heat).
const COMFORT_SCAN = [0, 105];
const COMFORT_DROP = 0.12;

export function comfortRange(frag, { dewF = 55 } = {}) {
  const W = DAILY_WEIGHTS;
  const fits = [];
  for (let feelsF = COMFORT_SCAN[0]; feelsF <= COMFORT_SCAN[1]; feelsF++) {
    const weights = targetSeasonWeights(feelsF, null);
    const conditions = { feelsF, dewF, category: 'clear' };
    fits.push((W.season * seasonFit(frag, weights) + W.weather * weatherFit(frag, conditions)) / (W.season + W.weather));
  }
  const peak = Math.max(...fits);
  const at = fits.indexOf(peak);
  const edge = (step, floor) => {
    let i = at;
    while (fits[i + step] !== undefined && fits[i + step] >= floor) i += step;
    return i;
  };
  const [peakLo, peakHi] = [edge(-1, peak - 0.01), edge(1, peak - 0.01)];
  const [lo, hi] = [edge(-1, peak - COMFORT_DROP), edge(1, peak - COMFORT_DROP)];
  const toF = i => COMFORT_SCAN[0] + i;
  const lowF = lo === 0 ? null : toF(lo);
  const highF = hi === fits.length - 1 ? null : toF(hi);
  const bestF = lowF !== null && highF !== null ? toF(Math.round((peakLo + peakHi) / 2)) : null;
  return { lowF, highF, bestF };
}

// Your own rating and "on my skin" nudges (`personal`, from src/skin.js:
// rating 1–5, longevity and sillage -1, 0 or 1). Your stars outweigh the
// crowd's, and each nudge moves a performance level by PERSONAL_SHIFT.
const PERSONAL_RATING_WEIGHT = 0.8;
const PERSONAL_SHIFT = 0.5;
// What your stars add to a score on top of quality(), which is only 5% of it
// (with quality's own change, about -0.14, -0.08, -0.02, 0 and +0.03): a
// bottle you rate 1★ or 2★ drops out of the top 3 unless it's clearly the
// only fit (it led the 4th by about 0.14 or 0.08; in David's wardrobe the
// lead is under 0.05 half the time and over 0.09 a tenth), and a 5★ one wins
// near ties (half the time it sits second to fourth) without taking every
// window. 1★ was -0.1 until the heat penalty (HEAT_WEIGHT) let a fresh bottle
// lead a small wardrobe's hot night out by 0.142 (a third of David's: Supremacy
// over Legacy), more than a 1★ took off; at -0.11 it never stays the pick
// there, and one leading the 4th by 0.15 still shows in the top 3.
// 4★ is what most bottles you keep would get, so it moves a bottle only
// through quality(). By stars, 1 to 5.
const PERSONAL_PICK = [-0.11, -0.06, -0.01, 0, 0.02];
// Ratings at or below this mean you'd rather not wear it: no nudges, no packing.
export const DISLIKED = 2;

/**
 * Whether you rate the bottle DISLIKED or lower. Only stars count: a bottle
 * with just a skin nudge carries `personal.rating: null`, and `null <= 2` is
 * true in JS, so never compare the rating directly.
 */
export const isDisliked = frag => Number.isFinite(frag?.personal?.rating) && frag.personal.rating <= DISLIKED;

/** Your stars' term in a score (rank's `parts.personal`, see scoreOf); 0 unrated. */
export function personalPart(frag) {
  const stars = frag.personal?.rating;
  return Number.isFinite(stars) ? PERSONAL_PICK[clamp(Math.round(stars), 1, 5) - 1] : 0;
}

// Community rating, trusted more as votes grow; unknowns sit at neutral 0.5.
// A rating of your own leads: 1★ reads 0, 3★ neutral, 5★ 1.
export function quality(frag) {
  const votes = Number.isFinite(frag.ratingVotes) ? frag.ratingVotes : 0;
  const rating = Number.isFinite(frag.rating) ? frag.rating : 0;
  const confidence = Math.min(1, Math.log10(Math.max(votes, 1)) / 3);
  const crowd = clamp((rating - 3.5) / 1.0, 0, 1) * confidence + 0.5 * (1 - confidence);
  const mine = frag.personal?.rating;
  if (!Number.isFinite(mine)) return crowd;
  return PERSONAL_RATING_WEIGHT * clamp((mine - 1) / 4, 0, 1) + (1 - PERSONAL_RATING_WEIGHT) * crowd;
}

// Longevity and sillage as -1 (fades fast, stays close) .. +1 (lasts,
// projects) around the middle of the bottles in data/, read from both
// crowds (performanceRating): Parfumo's ratings (0–10 averages, `parfumo`
// from data/parfumo.jsonl) and Fragrantica's votes (`performance`: longevity
// 1–5, sillage 1–4), put on Parfumo's scale by a line fitted on the 53
// bottles both rate (r 0.91 and 0.88). A rating from few votes leans toward
// the middle, and a bottle without one sits there.
const PERFORMANCE_MID = { longevity: 7.8, sillage: 7.4 };
const PERFORMANCE_SPAN = 1.2;
const PERFORMANCE_PRIOR_VOTES = 10;
const FRAGRANTICA_TO_PARFUMO = { longevity: [1.17, 1.839], sillage: [2.53, 2.047] };
// What Fragrantica's reading is worth at most, in Parfumo votes: on bottles
// well voted on both, the line misses Parfumo's own by 0.18 (longevity) and
// 0.27 (sillage), as about 100 and 50 Parfumo votes would (an upper bound:
// the line was fitted on those bottles). Its votes count as
// 1 / (1/votes + 1/worth), so a few still count about one for one.
const FRAGRANTICA_WORTH = { longevity: 100, sillage: 50 };
// How much an occasion's wish for longevity or sillage counts against its accords.
const PERFORMANCE_WEIGHT = 0.4;
// What a nudge of your own reads as, up and down.
const PERSONAL_PERFORMANCE = {
  sillage: ['Projects more on you', 'Sits closer on you'],
  longevity: ['Lasts longer on you', 'Fades faster on you'],
};
// The share of an occasion's fit that earns a reason ("Stays close to the skin").
const PERFORMANCE_REASON = 0.1;

/**
 * What both crowds say of a bottle's longevity and sillage, on Parfumo's
 * 0–10 scale: { longevity, sillage, votes, parfumoShare }, or null when
 * neither rates it. Each is Parfumo's average and Fragrantica's scaled one
 * weighted by votes, so a few Parfumo votes don't outweigh hundreds on
 * Fragrantica (Sandalwood & Musk: 11 against 23, both under the middle).
 * `votes` is each one's count in Parfumo votes ({ longevity, sillage }), and
 * `parfumoShare` the part of it that's Parfumo's own (0 for Fragrantica's
 * alone, 1 for Parfumo's). A bottle only one site rates reads that site on
 * its own votes. Every reader takes it from here (levels, spray counts,
 * styles, filters, Compare), so they stand on the same evidence.
 */
export function performanceRating(frag) {
  const pf = frag.parfumo?.votes > 0 ? frag.parfumo : null, fv = frag.performance?.votes > 0 ? frag.performance : null;
  if (!pf && !fv) return null;
  const out = { votes: {}, parfumoShare: {} };
  for (const key of ['longevity', 'sillage']) {
    const [a, b] = FRAGRANTICA_TO_PARFUMO[key];
    const p = pf?.[key] != null, f = fv?.[key] != null;
    const vP = p ? pf.votes : 0;
    const vF = !f ? 0 : p ? 1 / (1 / fv.votes + 1 / FRAGRANTICA_WORTH[key]) : fv.votes;
    const votes = vP + vF;
    out[key] = votes ? ((p ? vP * pf[key] : 0) + (f ? vF * (a + b * fv[key]) : 0)) / votes : null;
    out.votes[key] = votes;
    out.parfumoShare[key] = votes ? vP / votes : 0;
  }
  return out;
}

// A nudge of your own ("lasts longer on me") shifts the level from there.
export function performanceLevel(frag, key) {
  const p = performanceRating(frag);
  let level = 0;
  if (p && p[key] != null) {
    const n = p.votes[key];
    const steady = (n * p[key] + PERFORMANCE_PRIOR_VOTES * PERFORMANCE_MID[key]) / (n + PERFORMANCE_PRIOR_VOTES);
    level = clamp((steady - PERFORMANCE_MID[key]) / PERFORMANCE_SPAN, -1, 1);
  }
  const mine = frag.personal?.[key];
  return mine ? clamp(level + PERSONAL_SHIFT * Math.sign(mine), -1, 1) : level;
}

// A wish for less (a quiet bottle for the office) wants one that keeps to
// itself, not one nobody can smell: the level counts down to LESS_ENOUGH,
// and past it back the other way at LESS_BACK the rate. Counted all the way
// down, a body mist that's gone by lunch was the best office pick.
const LESS_ENOUGH = -0.3;
const LESS_BACK = 0.5;
// A wish for more can have its enough too, where the occasion names it
// (`performance.enough`): lasting the working day is all the office asks,
// so its longevity counts only up to MORE_ENOUGH (about Parfumo's 8 of 10).
// Counted all the way up, a beast earned back for lasting what it lost for
// projecting (every one of David's bottles past it projects too), and the
// fit agreed less with members' "too loud for the office" than the accords
// alone. Formal and Date Night count theirs all the way: members call
// bottles that last formal and date-worthy more often, past it too.
const MORE_ENOUGH = 0.2;
const wished = (wish, level, enough) => {
  if (wish < 0 && level < LESS_ENOUGH) return LESS_ENOUGH + LESS_BACK * (LESS_ENOUGH - level);
  if (wish > 0 && enough && level > MORE_ENOUGH) return MORE_ENOUGH;
  return level;
};

// What longevity and sillage add to a bottle's fit for the occasion: its
// wish for each (`performance`, -1 quiet or fleeting .. +1 loud or lasting)
// times the bottle's level, a wish for less only down to LESS_ENOUGH, one
// for more the occasion calls enough only up to MORE_ENOUGH. `plain` reads
// the level as it is, for what reasons say ("Stays close to the skin" is
// still true of a whisper).
export function performanceFit(frag, occasion, { plain = false } = {}) {
  const wish = occasion.performance ?? {};
  const part = key => {
    const w = wish[key] ?? 0, level = performanceLevel(frag, key);
    return PERFORMANCE_WEIGHT * w * (plain ? level : wished(w, level, wish.enough?.includes(key)));
  };
  return { longevity: part('longevity'), sillage: part('sillage') };
}

// What Parfumo voters wear a bottle for (`parfumo.occasion`, shares of Daily,
// Leisure, Business, Night Out, Evening and Sport), where a category matches
// an occasion: [category, its mean share and spread over the 45 bottles in
// data/ with 50+ votes]. There they agree with the accord profiles (r 0.54 to
// 0.74) and add what the accords miss; Casual, Formal and Cozy have no clean
// match (r below 0.25). A share one spread above the mean adds half a spread
// of a typical occasion fit; few votes lean toward the mean.
const VOTED_OCCASIONS = {
  office: ['Business', 0.132, 0.053, 'work'],
  date: ['Evening', 0.202, 0.096, 'evenings'],
  nightout: ['Night Out', 0.192, 0.093, 'nights out'],
  outdoors: ['Sport', 0.049, 0.064, 'sport'],
};
const OCCASION_VOTE_WEIGHT = 0.2;
const OCCASION_PRIOR_VOTES = 30;

export function votedOccasionFit(frag, occasion) {
  const p = frag.parfumo, match = VOTED_OCCASIONS[occasion.id];
  if (!p?.occasion || !match) return 0;
  const [category, mean, spread] = match;
  const n = p.occasionVotes;
  const share = (n * (p.occasion[category] ?? 0) + OCCASION_PRIOR_VOTES * mean) / (n + OCCASION_PRIOR_VOTES);
  return OCCASION_VOTE_WEIGHT * clamp((share - mean) / (2 * spread), -1, 1);
}

/** How well a bottle's accords suit the occasion: their profile values, weighted by strength. */
export function accordFit(frag, occasion) {
  let sum = 0, total = 0;
  for (const [a, s] of Object.entries(frag.accords)) {
    total += s;
    sum += s * (occasion.profile[a] ?? 0);
  }
  return total ? sum / total : 0;
}

/** The occasion fit before it's put on the scale: the accords' fit, plus performance and Parfumo's votes. */
export function occasionRaw(frag, occasion) {
  const perf = performanceFit(frag, occasion);
  return accordFit(frag, occasion) + perf.longevity + perf.sillage + votedOccasionFit(frag, occasion);
}

// The occasion fit as a part, 0..1, on one scale for every collection: about
// 0 at the dataset's 2nd percentile for that occasion, about 1 at its 98th
// (OCCASION_SCALE, scripts/fit-occasions.mjs; never narrower than the
// accords' fit alone spans, see there). Stretching each list's own
// min..max instead made any wardrobe's best bottle a perfect fit, blew up
// small and one-note lists, and let a narrow spread drown out the weather.
// Within OCCASION_KNEE of either end the part bends toward 0 or 1 instead of
// stopping there, so bottles past the dataset's range keep their order: the
// Parfumo votes (votedOccasionFit, which the dataset's bottles lack) carry a
// few owned bottles past its 98th percentile, and a hard cap tied five of
// them as perfect date-night fits.
const FALLBACK_SCALE = [-0.3, 0.5];
const OCCASION_KNEE = 0.1;
// Profiles share one unit (-1..1 an accord), so how far an occasion's fit
// spreads over the dataset says how much it cares: Formal's, Date Night's and
// the rest span 0.6 to 0.85, Casual's, which only leans (woods and aromatics
// a little up, gourmands and leather a little down), 0.28. Stretched to 0..1
// like the others, that lean outweighed the weather: a near-fresh woody
// topped every Casual day of a Chicago January, and Cream Velvet, the daily
// pick at -15°F, ranked 21st. So a fit that spans less than MILD_SPAN reads
// on a scale MILD_SPAN wide around its middle, and its weights lean toward
// the daily picks' by the same share (occasionWeights): Casual reads as
// daily picks with a tilt toward easy-going bottles.
const MILD_SPAN = 0.6;
const scaleOf = occasion => OCCASION_SCALE[occasion.id] ?? FALLBACK_SCALE;
export function occasionPart(raw, occasion) {
  const [lo, hi] = scaleOf(occasion);
  const span = Math.max(hi - lo, MILD_SPAN);
  const x = (raw - (lo + hi - span) / 2) / span, k = OCCASION_KNEE;
  if (x > 1 - k) return 1 - k * Math.exp((1 - k - x) / k);
  if (x < k) return k * Math.exp((x - k) / k);
  return x;
}

/**
 * The weights an occasion's score uses: OCCASION_WEIGHTS and HEAT_WEIGHT
 * (none for an occasion spent indoors), blended toward DAILY_WEIGHTS for a
 * mild one by how far its fit falls short of MILD_SPAN.
 */
const weightsOf = new WeakMap();
export function occasionWeights(occasion) {
  let W = weightsOf.get(occasion);
  if (W) return W;
  const [lo, hi] = scaleOf(occasion);
  const t = Math.min(1, (hi - lo) / MILD_SPAN), O = OCCASION_WEIGHTS, D = DAILY_WEIGHTS;
  const blend = key => t * O[key] + (1 - t) * D[key];
  W = Object.freeze({
    occasion: t * O.occasion, season: blend('season'), time: blend('time'), weather: blend('weather'), quality: blend('quality'),
    heat: occasion.indoors ? 0 : t * HEAT_WEIGHT,
  });
  weightsOf.set(occasion, W);
  return W;
}

/**
 * A bottle's score from its parts (rank's `parts`): the weighted fits (for
 * an occasion, less what richness in heat costs it), plus your stars' term
 * (`personal`, when there is one), less the rotation penalty. Shared with
 * anything that scores bottles the way rank() does (the gap finder), so the
 * two can't drift apart.
 */
export function scoreOf(parts, occasion = null) {
  const W = occasion ? occasionWeights(occasion) : DAILY_WEIGHTS;
  let score = W.season * parts.season + W.time * parts.time + W.weather * parts.weather + W.quality * parts.quality;
  if (occasion) score += W.occasion * parts.occasion - W.heat * (parts.heat ?? 0);
  return score + (parts.personal ?? 0) - (parts.rotation ?? 0);
}

export function daysBetween(fromISO, toISO) {
  return Math.round((Date.parse(toISO) - Date.parse(fromISO)) / 86_400_000);
}

// Penalize recent wears so picks rotate. A wear logged for this same slot
// today is the user's current choice, not a reason to demote it.
// Entries marked `planned` are picks from a plan (see planWindows), not wears.
export function rotationPenalty(fragId, history, todayISO, slot) {
  let penalty = 0, daysAgo = null, planned = false;
  for (const h of history) {
    if (h.id !== fragId) continue;
    if (h.date === todayISO && h.slot === slot) continue;
    const d = daysBetween(h.date, todayISO);
    if (d >= 0 && d < ROTATION_PENALTY.length && ROTATION_PENALTY[d] > penalty) {
      penalty = ROTATION_PENALTY[d];
      daysAgo = d;
      planned = !!h.planned;
    }
  }
  return { penalty, daysAgo, planned };
}

// How far below the top score a bottle not yet in the plan can sit and still
// take the slot. Keeps one all-rounder from filling the whole week.
export const PLAN_MARGIN = 0.06;

// The rotation nudge (rank's and planWindows' `nudge`): a bottle left on the
// shelf NUDGE_AFTER days or more takes the slot when it scores within
// PLAN_MARGIN of the top and shares the top pick's tier, so a nudge never
// trades an S pick for an A. A bottle never worn counts from the journal's
// first wear (or from `added`, when a record carries the date it joined),
// so nothing is neglected before the journal is a month old. Bottles you
// rate DISLIKED or lower sit out on purpose and are never nudged. A plan
// nudges at most once every NUDGE_EVERY days.
export const NUDGE_AFTER = 30;
const NUDGE_EVERY = 3;

// Moves the best neglected bottle within reach to the front (`nudged`, with
// its idle days as `parts.idle`, and `parts.unworn` when the journal has no
// wear of it), unless the top pick is one already. Wears and plans before
// this window count; the journal starts at its first logged wear. A bottle
// saved for an event later in the plan (`saved`) is never the one nudged.
function nudgeIdle(scored, history, todayISO, slot, saved) {
  let start = null;
  const last = new Map();
  for (const h of history) {
    if (h.date > todayISO || (h.date === todayISO && h.slot === slot)) continue;
    if (!h.planned && (start === null || h.date < start)) start = h.date;
    if (!last.has(h.id) || h.date > last.get(h.id)) last.set(h.id, h.date);
  }
  if (start === null || !scored.length) return;
  const since = f => {
    const added = typeof f.added === 'string' ? f.added.slice(0, 10) : null;
    return last.get(f.id) ?? (added > start ? added : start);
  };
  const idle = s => daysBetween(since(s.fragrance), todayISO);
  const [top] = scored;
  if (idle(top) >= NUDGE_AFTER) return;
  // Tiers fall in rank order, so the first bottle out of the top's tier ends the search.
  for (let i = 1; i < scored.length && top.score - scored[i].score <= PLAN_MARGIN && scored[i].tier === top.tier; i++) {
    const days = idle(scored[i]);
    if (days < NUDGE_AFTER || isDisliked(scored[i].fragrance) || saved?.has(scored[i].fragrance.id)) continue;
    const [pick] = scored.splice(i, 1);
    pick.nudged = true;
    pick.parts.idle = days;
    pick.parts.unworn = !last.has(pick.fragrance.id);
    scored.unshift(pick);
    return;
  }
}

// The bottle's strongest accord that passes `keep`.
function strongest(accords, keep) {
  let best = null;
  for (const [a, s] of Object.entries(accords)) if (keep(a) && (!best || s > accords[best])) best = a;
  return best;
}

// Plain-language reasons, each with a tone and a strength used for ordering.
// Tones come from what the votes and accords say, not from blended scores.
// Reasons about this bottle in particular (its accords against the weather or
// the occasion, its performance, recent wears) come before the season and
// time-of-day votes, which read the same on every well-placed bottle.
function reasonsFor(frag, parts, ctx) {
  const { conditions, slot, weights, occasion } = ctx;
  const W = occasion ? occasionWeights(occasion) : DAILY_WEIGHTS;
  const out = [];
  const good = (text, strength, specific = false) => out.push({ text, tone: 'good', strength, specific });
  const bad = (text, strength, specific = false) => out.push({ text, tone: 'bad', strength, specific });

  const nowSeason = argmax(weights);
  const { season, dayNight } = steadyShares(frag);
  const fragSeason = argmax(season);
  const peakShare = season[fragSeason];
  const comfort = SEASONS.reduce((sum, s) => sum + weights[s] * (season[s] / peakShare), 0);
  // Only Fragrantica records carry votes; Fragella's and hand-entered seasons are estimates, and so are flat votes.
  const voted = votedShares(frag).season;
  if (fragSeason === nowSeason && peakShare >= 0.3) good(voted ? `Voted a ${nowSeason} scent` : `A ${nowSeason} scent`, W.season * peakShare * 2);
  else if (comfort >= 0.85 && peakShare < 0.3) good('Versatile across seasons', W.season * 0.4);
  else if (comfort >= 0.85) good(`Fits ${nowSeason} weather`, W.season * 0.5);
  else if (comfort < 0.55) bad(voted ? `Voted for ${fragSeason}, not ${nowSeason}` : `Better in ${fragSeason} than ${nowSeason}`, W.season * (1 - comfort));

  // As for seasons: "a favorite" only when voters said so. A rich bottle's
  // night lean goes unsaid on a day cold enough that timeForgiven lets off
  // more than half of what it can: the score has stopped holding it against
  // the bottle.
  const share = dayNight[slot], timeVoted = votedShares(frag).time;
  if (share >= 0.62) {
    good(slot === 'night' ? (timeVoted ? 'Built for nighttime' : 'A night scent') : (timeVoted ? 'Daytime favorite' : 'A daytime scent'), W.time * share);
  }
  else if (share <= 0.38 && timeForgiven(frag, slot, conditions) <= TIME_FORGIVE / 2) {
    bad(slot === 'night' ? 'Better in daylight' : 'More of a night scent', W.time * (1 - share));
  }

  const h = heaviness(frag.accords);
  const sticky = isSticky(conditions);
  if (conditions.feelsF >= 78) {
    const cool = strongest(frag.accords, a => a in COOLING);
    if (h <= -0.1) good(cool ? `${COOLING[cool]} the heat` : 'Light enough for the heat', W.weather * 0.8, true);
    else if (h >= 0.25) bad(sticky ? 'Too rich for sticky heat' : 'Heavy for this heat', W.weather + (occasion ? W.heat * parts.heat : 0), true);
  } else if (conditions.feelsF <= 52) {
    const warm = strongest(frag.accords, a => ACCORDS[a]?.weight >= 0.7);
    if (h >= 0.25) good(warm ? `${warmPhrase(warm)} for the cold` : 'A warm base for the cold', W.weather * 0.8, true);
    else if (h <= -0.2) bad('Thin in the cold', W.weather * 0.8, true);
  }
  if (isWet(conditions.category) && accordShare(frag.accords, RAIN_ACCORDS) > 0.3) {
    const noun = nounOf(strongest(frag.accords, a => RAIN_ACCORDS.includes(a)));
    good(`${cap(noun)} suit${isPlural(noun) ? '' : 's'} the rain`, 0.02);
  }

  if (occasion) {
    const contrib = Object.entries(frag.accords)
      .map(([a, s]) => [a, s * (occasion.profile[a] ?? 0)])
      .sort((x, y) => y[1] - x[1]);
    const fits = contrib.filter(c => c[1] > 20).map(c => c[0])
      .filter((a, i, list) => !list.slice(0, i).some(b => kinOf(b).includes(a))).slice(0, 2).map(nounOf);
    const clash = contrib.filter(c => c[1] < -20).at(-1)?.[0];
    const phrase = occasion.phrase ?? occasion.label.toLowerCase();
    const plural = fits.length > 1 || (fits.length && isPlural(fits[0]));
    if (fits.length) good(`${cap(fits.join(' & '))} suit${plural ? '' : 's'} ${phrase}`, W.occasion * (0.5 + parts.occasion), true);
    if (clash) bad(`${cap(nounOf(clash))} ${isPlural(nounOf(clash)) ? 'are' : 'is'} off for ${phrase}`, W.occasion * (1.5 - parts.occasion) * 0.5, true);

    // Longevity and sillage, where the occasion cares about them. A nudge of
    // your own says so ("Lasts longer on you") in place of the crowd's word
    // when they agree.
    const perf = performanceFit(frag, occasion, { plain: true });
    const wish = occasion.performance ?? {};
    const said = {};
    for (const key of ['sillage', 'longevity']) {
      const mine = Math.sign(frag.personal?.[key] ?? 0);
      if (!mine || !wish[key]) continue;
      said[key] = mine * wish[key] > 0 ? 'good' : 'bad';
      const text = PERSONAL_PERFORMANCE[key][mine > 0 ? 0 : 1];
      (said[key] === 'good' ? good : bad)(text, W.occasion * PERFORMANCE_WEIGHT * PERSONAL_SHIFT * Math.abs(wish[key]) * 2, true);
    }
    const crowd = (key, tone, text, strength) => said[key] !== tone && (tone === 'good' ? good : bad)(text, strength, true);
    const [loud, quiet] = wish.sillage > 0 ? ['Projects across a room', `Too quiet for ${phrase}`] : ['Stays close to the skin', `Projects a lot for ${phrase}`];
    if (perf.sillage >= PERFORMANCE_REASON) crowd('sillage', 'good', loud, W.occasion * perf.sillage * 2);
    else if (perf.sillage <= -PERFORMANCE_REASON) crowd('sillage', 'bad', quiet, W.occasion * -perf.sillage * 2);
    if (perf.longevity >= PERFORMANCE_REASON) crowd('longevity', 'good', `Lasts the whole ${slot === 'night' ? 'night' : 'day'}`, W.occasion * perf.longevity * 2);
    else if (perf.longevity <= -PERFORMANCE_REASON) crowd('longevity', 'bad', 'Fades early', W.occasion * -perf.longevity * 2);

    const voted = votedOccasionFit(frag, occasion);
    const what = VOTED_OCCASIONS[occasion.id]?.[3];
    if (voted >= PERFORMANCE_REASON) good(`Parfumo voters wear it for ${what}`, W.occasion * voted * 2, true);
    else if (voted <= -PERFORMANCE_REASON) bad(`Parfumo voters rarely wear it for ${what}`, W.occasion * -voted * 2, true);
  }

  // Your own stars replace the crowd's where they push the bottle up or down.
  const stars = frag.personal?.rating;
  if (Number.isFinite(stars)) {
    if (stars >= 4) good(`You rate it ${stars}★`, W.quality * parts.quality + (parts.personal ?? 0), true);
    else if (stars <= 2) bad(`You rate it ${stars}★`, W.quality * (1 - parts.quality) - (parts.personal ?? 0), true);
  } else if (frag.rating >= 4.35 && frag.ratingVotes >= 1000) good(`Crowd favorite · ${frag.rating.toFixed(1)}★`, 0.03);

  if (parts.unworn) good('Not worn yet', 0.3, true);
  else if (parts.idle) good(`Not worn in ${parts.idle} days`, 0.3, true);

  const rest = restReason(parts, ctx.slot);
  if (rest) bad(rest, parts.rotation, true);
  if (parts.saved) bad(savedReason(parts.saved, ctx.todayISO), SAVED_STRENGTH, true);

  return out.sort((a, b) => b.specific - a.specific || b.strength - a.strength);
}

// A bottle saved for an event leads its catches: it's why another bottle
// takes the window.
const SAVED_STRENGTH = 0.1;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/**
 * An event ({ dateISO, slot, occasion }) as said on the date `fromISO`: "a
 * date tonight", "the office tomorrow", "formal wear on Saturday night".
 */
export function eventPhrase({ dateISO, slot, occasion }, fromISO) {
  const night = slot === 'night';
  const days = daysBetween(fromISO, dateISO);
  const at = new Date(`${dateISO}T12:00:00Z`);
  const when = days <= 0 ? (night ? 'tonight' : 'today')
    : days === 1 ? (night ? 'tomorrow night' : 'tomorrow')
      : days < 7 ? `on ${WEEKDAYS[at.getUTCDay()]}${night ? ' night' : ''}`
        : `on ${night ? 'the night of ' : ''}${MONTH_DAY.format(at)}`;
  return `${occasion.phrase ?? occasion.label.toLowerCase()} ${when}`;
}

/** Why a plan leaves a bottle be for an event later on (planWindows' `saved`): "Saved for a date tonight". */
export const savedReason = (event, fromISO) => `Saved for ${eventPhrase(event, fromISO)}`;

/**
 * Why a recent wear or a plan's pick sets a bottle back in a window of
 * `slot`, in its reason's words (rank's parts: daysAgo, planned), or null. A
 * pick for the window's own date is the other slot's (rotationPenalty skips
 * its own), named so, since "that day" means nothing on Now or Compare.
 */
export function restReason({ daysAgo: d, planned }, slot) {
  if (planned) return d === 0 ? `Already picked for ${slot === 'night' ? 'daytime' : 'nighttime'}` : d > 0 ? `Picked ${d === 1 ? 'the day' : `${d} days`} before` : null;
  return d === 0 ? 'Already wearing it today' : d === 1 ? 'Worn yesterday' : d > 1 ? `Worn ${d} days ago` : null;
}

/**
 * Rank a collection for one time slot.
 * conditions: { feelsF, humidity, dewF?, category, date: Date, lat }
 * slot: 'day' | 'night'
 * opts: { occasion?, history?: [{id, date: 'YYYY-MM-DD'}], todayISO? (default: the window's dateISO),
 *   nudge?: put a neglected bottle within reach first (see NUDGE_AFTER),
 *   saved?: Map(id -> event { dateISO, slot, occasion }) of bottles a plan
 *   keeps for an event later on: they keep their score, say so
 *   (`parts.saved`, savedReason) and are never nudged }
 */
export function rank(fragrances, conditions, slot, opts = {}) {
  const { occasion = null, history = [], todayISO = conditions.dateISO ?? localISO(new Date()), nudge = false, saved = null } = opts;
  const weights = targetSeasonWeights(conditions.feelsF, conditions.date, conditions.lat);

  const scored = fragrances.map(frag => {
    const { penalty, daysAgo, planned } = rotationPenalty(frag.id, history, todayISO, slot);
    const parts = {
      season: seasonFit(frag, weights),
      time: timeFit(frag, slot, conditions),
      weather: weatherFit(frag, conditions),
      quality: quality(frag),
      occasion: occasion ? occasionPart(occasionRaw(frag, occasion), occasion) : null,
      heat: occasion ? richInHeat(frag, conditions) : null,
      personal: personalPart(frag),
      rotation: penalty,
      daysAgo,
      planned,
      ...(saved?.has(frag.id) && { saved: saved.get(frag.id) }),
    };
    return { fragrance: frag, score: scoreOf(parts, occasion), parts };
  });

  scored.sort((a, b) => b.score - a.score);

  let i = 0;
  for (const [tier, size] of TIER_SIZES) {
    for (let n = 0; n < size && i < scored.length; n++, i++) scored[i].tier = tier;
  }
  for (; i < scored.length; i++) scored[i].tier = 'C';
  for (const s of scored) {
    while (s.score < TIER_FLOORS[s.tier]) s.tier = TIERS[TIERS.indexOf(s.tier) + 1];
  }
  if (nudge) nudgeIdle(scored, history, todayISO, slot, saved);

  const ctx = { conditions, slot, weights, occasion, todayISO };
  for (const s of scored) s.reasons = reasonsFor(s.fragrance, s.parts, ctx);
  return scored;
}

/**
 * An event's window (`win.occasion`: Saturday night's wedding) ranked as
 * planWindows plans it: for its occasion, with no rotation and no nudge. A
 * wedding wants the best bottle, so neither a wear in the days before nor
 * the plan around it sets one back there (the Occasion pane ranks a planned
 * window the same way).
 */
export function rankEvent(fragrances, win, occasion = win.occasion) {
  return rank(fragrances, win, win.slot, { occasion, todayISO: win.dateISO });
}

/**
 * Plan a run of windows in time order (e.g. the week ahead, day then night).
 * Each planned pick counts as worn for the windows after it, and a bottle not
 * yet in the plan wins over a repeat when it scores within PLAN_MARGIN.
 * A wear already logged for a window is kept as that window's pick. With
 * opts.nudge, a neglected bottle takes a slot at most once every
 * NUDGE_EVERY days. A bottle you rate DISLIKED or lower is planned only where
 * it ranks first with no new bottle within PLAN_MARGIN. opts.occasion goes
 * on every window.
 * A window with its own occasion is an event (`win.occasion`, a date on
 * Friday night), planned first: it takes its top as rankEvent ranks it (its
 * logged wear, when it has one), and the plan around it treats that bottle
 * as already in the plan for the windows before it ("Saved for a date on
 * Friday night", `parts.saved`), so a new bottle within PLAN_MARGIN takes
 * them (with nothing that close it can still be worn), and as planned from
 * the event's date on. Events never nudge, and without one nothing changes.
 * Two events can share their best bottle.
 * Returns [{ win, ranked, pick }].
 */
export function planWindows(fragrances, windows, opts = {}) {
  const { occasion = null, history = [], nudge = false } = opts;
  const loggedIn = win => history.find(h => h.date === win.dateISO && h.slot === win.slot);
  // Each event's pick, fixed before the windows around it are planned.
  const events = windows.flatMap((win, i) => {
    if (!win.occasion) return [];
    const ranked = rankEvent(fragrances, win);
    const logged = loggedIn(win);
    const pick = (logged && ranked.find(r => r.fragrance.id === logged.id)) ?? ranked[0] ?? null;
    return [{ i, win, ranked, pick, logged }];
  });
  let planned = [...history];
  for (const e of events) if (e.pick && !e.logged) planned.push({ id: e.pick.fragrance.id, date: e.win.dateISO, slot: e.win.slot, planned: true });
  const used = new Set();
  let nudgedOn = null;
  return windows.map((win, i) => {
    const event = events.find(e => e.i === i);
    if (event) {
      if (event.pick) used.add(event.pick.fragrance.id);
      return { win, ranked: event.ranked, pick: event.pick };
    }
    // Bottles kept for the events still to come, each for the nearest.
    const saved = new Map();
    for (const e of events) if (e.i > i && e.pick && !saved.has(e.pick.fragrance.id)) saved.set(e.pick.fragrance.id, { dateISO: e.win.dateISO, slot: e.win.slot, occasion: e.win.occasion });
    const logged = loggedIn(win);
    const canNudge = nudge && !logged && (nudgedOn === null || daysBetween(nudgedOn, win.dateISO) >= NUDGE_EVERY);
    const asked = { occasion, todayISO: win.dateISO, nudge: canNudge, ...(saved.size && { saved }) };
    let ranked = rank(fragrances, win, win.slot, { ...asked, history: planned });
    // A nudged bottle leads the list, and is new to the plan. A bottle you
    // rate DISLIKED or lower never counts as the fresh one, so it's planned
    // only where it ranks first and nothing new to the plan comes close.
    const fresh = ranked.find(r => !used.has(r.fragrance.id) && !saved.has(r.fragrance.id) && !isDisliked(r.fragrance));
    let pick = logged && ranked.find(r => r.fragrance.id === logged.id);
    if (!pick) pick = fresh && ranked[0].score - fresh.score <= PLAN_MARGIN ? fresh : ranked[0];
    // A repeat of the plan that tops the list anyway (the only bottle, or
    // nothing else close) keeps its match: the plan's repeat penalty changed
    // nothing, so it neither lowers it nor leads its reasons.
    if (pick && !logged && pick === ranked[0] && pick.parts.planned) {
      const id = pick.fragrance.id;
      ranked = rank(fragrances, win, win.slot, { ...asked, history: planned.filter(h => !(h.planned && h.id === id)) });
      pick = ranked.find(r => r.fragrance.id === id);
    }
    // Likewise a bottle saved for an event that's worn anyway doesn't say it's saved.
    if (pick?.parts.saved) {
      const text = savedReason(pick.parts.saved, win.dateISO);
      pick.reasons = pick.reasons.filter(r => r.text !== text);
      delete pick.parts.saved;
    }
    if (pick?.nudged) nudgedOn = win.dateISO;
    if (pick) {
      used.add(pick.fragrance.id);
      if (!logged) planned = [{ id: pick.fragrance.id, date: win.dateISO, slot: win.slot, planned: true }, ...planned];
    }
    return { win, ranked, pick: pick ?? null };
  });
}

export function groupTiers(ranked) {
  const tiers = { S: [], A: [], B: [], C: [] };
  for (const r of ranked) tiers[r.tier].push(r);
  return tiers;
}
