// Recommendation engine. Pure functions only: fragrances + conditions in,
// ranked tiers with reasons out.
import { ACCORDS, heaviness } from './accords.js';
import { isWet } from './wmo.js';
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
// fades to even, from the full split at TRANSITION_COLD[1] to none at [0]:
// spring votes go to florals and greens, and a cold April night calls for
// them no more than a cold October one.
const TRANSITION_SPLIT = 0.35;
const TRANSITION_COLD = [40, 65];
const FALL_PEAK_DAY = 288; // Oct 15
// Midwinter and midsummer days still lean a little toward their calendar
// season, by up to CALENDAR_BOOST in mid-January and mid-July, easing off
// smoothly toward the equinoxes (as much in all as three full months).
const CALENDAR_BOOST = 1.35;
// The tropics have no spring or fall to speak of: the calendar's say fades
// out between these latitudes, toward the equator.
const TROPICS = [15, 25];

// How much each part counts toward a score (scoreOf).
export const DAILY_WEIGHTS = Object.freeze({ season: 0.5, time: 0.25, weather: 0.2, quality: 0.05 });
export const OCCASION_WEIGHTS = Object.freeze({ occasion: 0.4, season: 0.3, time: 0.1, weather: 0.15, quality: 0.05 });

// Rank cutoffs: first 3 are S, next 5 A, next 6 B, rest C.
const TIER_SIZES = [['S', 3], ['A', 5], ['B', 6]];

// Worn today, yesterday, 2 days ago … 9 days ago. Top scores sit within a few
// hundredths of each other, so a 3-day memory cycled the same 3 bottles
// through a month of steady weather; a 10-day tail rotates 9–17.
const ROTATION_PENALTY = [0.2, 0.12, 0.08, 0.06, 0.045, 0.035, 0.025, 0.02, 0.015, 0.01];

const RAIN_ACCORDS = ['green', 'earthy', 'woody', 'aromatic', 'mossy', 'aquatic'];

// Reasons name accords as nouns ("Warm spice for the cold", "Woods & aromatics
// suit everyday wear"), never as raw labels ("Warm warm spicy"). An accord not
// listed reads as its own name (vanilla, leather, iris).
const ACCORD_NOUN = {
  woody: 'woods', 'warm spicy': 'warm spice', 'fresh spicy': 'crisp spice', 'soft spicy': 'soft spice',
  aromatic: 'aromatics', sweet: 'sweetness', fresh: 'fresh notes', green: 'green notes', aquatic: 'aquatic notes',
  marine: 'marine notes', ozonic: 'airy notes', earthy: 'earthy notes', musky: 'musk', powdery: 'powder',
  fruity: 'fruit', floral: 'florals', 'white floral': 'white florals', 'yellow floral': 'yellow florals',
  balsamic: 'resins', animalic: 'animalic notes', smoky: 'smoke', lactonic: 'milky notes', herbal: 'herbs',
  mossy: 'moss', tropical: 'tropical fruit', salty: 'sea salt', metallic: 'metallic notes', soapy: 'soap',
  mineral: 'mineral notes', terpenic: 'terpenes', savory: 'savory notes', nutty: 'nuts', gourmand: 'gourmand notes',
  'coca-cola': 'cola', aldehydic: 'aldehydes', conifer: 'pine', bitter: 'bitter notes', sour: 'sour notes',
  alcohol: 'boozy notes', anis: 'anise', camphor: 'camphor notes',
};
const nounOf = accord => ACCORD_NOUN[accord] ?? accord.toLowerCase();
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

// A split from few votes is noisy, so voted shares lean toward a prediction
// (src/custom.js): what the accords predict, averaged with the votes of the
// bottles voters say it smells like (`like`) when it has them. The prediction
// counts as PRIOR_VOTES votes, about how far well-voted bottles stray from it
// out of sample (scripts/fit-profiles.mjs).
// A dupe's original (`original`, from data/dupes.json) predicts its split
// better: across the wardrobe's 18 dupes it strays about as far as 120 votes
// would, for seasons and day/night alike. Both count toward the prior.
// Fragella and hand-entered bottles are estimates already and pass through.
const ORIGINAL_PRIOR_VOTES = 120;
const steadied = new WeakMap();

export function steadyShares(frag) {
  if (!frag.seasonVotes || !frag.timeVotes) return frag;
  if (steadied.has(frag)) return steadied.get(frag);
  const orig = frag.original;
  const ko = orig ? ORIGINAL_PRIOR_VOTES : 0;
  const est = predictedShares(frag.accords, frag.like);
  const k = frag.like ? PRIOR_VOTES.withLike : PRIOR_VOTES.accords;
  const n = SEASONS.reduce((sum, s) => sum + frag.seasonVotes[s], 0);
  const season = Object.fromEntries(SEASONS.map(s => [s,
    (n * frag.season[s] + k.season * est.season[s] + ko * (orig?.season[s] ?? 0)) / (n + k.season + ko)]));
  const tn = frag.timeVotes.day + frag.timeVotes.night;
  const night = (tn * frag.dayNight.night + k.night * est.night + ko * (orig?.dayNight.night ?? 0))
    / (tn + k.night + ko);
  const shares = { season, dayNight: { day: 1 - night, night } };
  steadied.set(frag, shares);
  return shares;
}

// Half "is this within the fragrance's comfort zone" (relative to its own best
// season), half "is this its specialty" (lift over an even 25% split). Without
// the lift, all-rounders tie specialists in-season and win everywhere else.
export function seasonFit(frag, weights) {
  const { season } = steadyShares(frag);
  const peak = Math.max(...SEASONS.map(s => season[s])) || 1;
  const relative = SEASONS.reduce((sum, s) => sum + weights[s] * (season[s] / peak), 0);
  const lift = SEASONS.reduce((sum, s) => sum + weights[s] * season[s], 0) / 0.25;
  return 0.5 * relative + 0.5 * clamp(lift / 1.6, 0, 1);
}

export function timeFit(frag, slot) {
  const { dayNight } = steadyShares(frag);
  const peak = Math.max(dayNight.day, dayNight.night) || 1;
  const lift = dayNight[slot] / 0.5;
  return 0.5 * (dayNight[slot] / peak) + 0.5 * clamp(lift / 1.3, 0, 1);
}

// Dew point (°F) from temperature (°F) and relative humidity (%), Magnus formula.
export function dewPointF(tempF, humidity) {
  const c = ((tempF - 32) * 5) / 9;
  const g = Math.log(clamp(humidity, 1, 100) / 100) + (17.62 * c) / (243.12 + c);
  return ((243.12 * g) / (17.62 - g)) * 9 / 5 + 32;
}

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

// Feels-like range a bottle suits on its own: its season and weather fit,
// weighted as in daily picks, scanned in 1°F steps, whatever the time of year
// (the calendar would otherwise move a cold-weather bottle's range by 26°F
// between April and October). The range runs out from the peak to where the
// fit falls COMFORT_DROP below it; lowF / highF are null when it runs off the
// scan (nothing is too cold for a winter scent). bestF, the middle of the
// peak, is only given for a range closed on both ends.
const COMFORT_SCAN = [0, 105];
const COMFORT_DROP = 0.1;

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

// Community rating, trusted more as votes grow; unknowns sit at neutral 0.5.
export function quality(frag) {
  const confidence = Math.min(1, Math.log10(Math.max(frag.ratingVotes, 1)) / 3);
  return clamp((frag.rating - 3.5) / 1.0, 0, 1) * confidence + 0.5 * (1 - confidence);
}

// Parfumo's longevity and sillage ratings (0–10 averages, `parfumo` from
// data/parfumo.jsonl) as -1 (fades fast, stays close) .. +1 (lasts, projects)
// around the middle of the bottles in data/. A bottle Parfumo lacks reads
// Fragrantica's votes instead (`performance`: longevity 1–5, sillage 1–4),
// put on Parfumo's scale by a line fitted on the 53 bottles both rate
// (r 0.91 and 0.88). A rating from few votes leans toward the middle, and a
// bottle without one sits there.
const PERFORMANCE_MID = { longevity: 7.8, sillage: 7.4 };
const PERFORMANCE_SPAN = 1.2;
const PERFORMANCE_PRIOR_VOTES = 10;
const FRAGRANTICA_TO_PARFUMO = { longevity: [1.17, 1.839], sillage: [2.53, 2.047] };
// How much an occasion's wish for longevity or sillage counts against its accords.
const PERFORMANCE_WEIGHT = 0.4;
// The share of an occasion's fit that earns a reason ("Stays close to the skin").
const PERFORMANCE_REASON = 0.1;

// { longevity, sillage, votes } on Parfumo's 0–10 scale, or null.
export function performanceRating(frag) {
  if (frag.parfumo) return frag.parfumo;
  const p = frag.performance;
  if (!p) return null;
  const scale = key => FRAGRANTICA_TO_PARFUMO[key][0] + FRAGRANTICA_TO_PARFUMO[key][1] * p[key];
  return { longevity: scale('longevity'), sillage: scale('sillage'), votes: p.votes };
}

export function performanceLevel(frag, key) {
  const p = performanceRating(frag);
  if (!p || p[key] == null) return 0;
  const steady = (p.votes * p[key] + PERFORMANCE_PRIOR_VOTES * PERFORMANCE_MID[key]) / (p.votes + PERFORMANCE_PRIOR_VOTES);
  return clamp((steady - PERFORMANCE_MID[key]) / PERFORMANCE_SPAN, -1, 1);
}

// What longevity and sillage add to a bottle's fit for the occasion: its
// wish for each (`performance`, -1 quiet or fleeting .. +1 loud or lasting)
// times the bottle's level.
export function performanceFit(frag, occasion) {
  const wish = occasion.performance ?? {};
  const part = key => PERFORMANCE_WEIGHT * (wish[key] ?? 0) * performanceLevel(frag, key);
  return { longevity: part('longevity'), sillage: part('sillage') };
}

// What Parfumo voters wear a bottle for (`parfumo.occasion`, shares of Daily,
// Leisure, Business, Night Out, Evening and Sport), where a category matches
// an occasion: [category, its mean share and spread over the 45 bottles in
// data/ with 50+ votes]. There they agree with the accord profiles (r 0.54 to
// 0.74) and add what the accords miss; Everyday, Formal and Cozy have no clean
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

export function occasionRaw(frag, occasion) {
  let sum = 0, total = 0;
  for (const [a, s] of Object.entries(frag.accords)) {
    total += s;
    sum += s * (occasion.profile[a] ?? 0);
  }
  const perf = performanceFit(frag, occasion);
  return (total ? sum / total : 0) + perf.longevity + perf.sillage + votedOccasionFit(frag, occasion);
}

// The occasion fit as a part, 0..1, on one scale for every collection: 0 at
// the dataset's 2nd percentile for that occasion, 1 at its 98th
// (OCCASION_SCALE, scripts/fit-occasions.mjs). Stretching each list's own
// min..max instead made any wardrobe's best bottle a perfect fit, blew up
// small and one-note lists, and let a narrow spread drown out the weather.
const FALLBACK_SCALE = [-0.3, 0.5];
export function occasionPart(raw, occasion) {
  const [lo, hi] = OCCASION_SCALE[occasion.id] ?? FALLBACK_SCALE;
  return clamp((raw - lo) / (hi - lo), 0, 1);
}

/**
 * A bottle's score from its parts (rank's `parts`): the weighted fits, less
 * the rotation penalty. Shared with anything that scores bottles the way
 * rank() does (the gap finder), so the two can't drift apart.
 */
export function scoreOf(parts, occasion = null) {
  const W = occasion ? OCCASION_WEIGHTS : DAILY_WEIGHTS;
  let score = W.season * parts.season + W.time * parts.time + W.weather * parts.weather + W.quality * parts.quality;
  if (occasion) score += W.occasion * parts.occasion;
  return score - (parts.rotation ?? 0);
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
  const W = occasion ? OCCASION_WEIGHTS : DAILY_WEIGHTS;
  const out = [];
  const good = (text, strength, specific = false) => out.push({ text, tone: 'good', strength, specific });
  const bad = (text, strength, specific = false) => out.push({ text, tone: 'bad', strength, specific });

  const nowSeason = argmax(weights);
  const { season, dayNight } = steadyShares(frag);
  const fragSeason = argmax(season);
  const peakShare = season[fragSeason];
  const comfort = SEASONS.reduce((sum, s) => sum + weights[s] * (season[s] / peakShare), 0);
  // Only Fragrantica records carry votes; Fragella's and hand-entered seasons are estimates.
  const voted = Boolean(frag.seasonVotes);
  if (fragSeason === nowSeason && peakShare >= 0.3) good(voted ? `Voted a ${nowSeason} scent` : `A ${nowSeason} scent`, W.season * peakShare * 2);
  else if (comfort >= 0.85 && peakShare < 0.3) good('Versatile across seasons', W.season * 0.4);
  else if (comfort >= 0.85) good(`Fits ${nowSeason} weather`, W.season * 0.5);
  else if (comfort < 0.55) bad(voted ? `Voted for ${fragSeason}, not ${nowSeason}` : `Better in ${fragSeason} than ${nowSeason}`, W.season * (1 - comfort));

  const share = dayNight[slot];
  if (share >= 0.62) good(slot === 'night' ? 'Built for nighttime' : 'Daytime favorite', W.time * share);
  else if (share <= 0.38) bad(slot === 'night' ? 'Better in daylight' : 'More of a night scent', W.time * (1 - share));

  const h = heaviness(frag.accords);
  const sticky = isSticky(conditions);
  if (conditions.feelsF >= 78) {
    const cool = strongest(frag.accords, a => a in COOLING);
    if (h <= -0.1) good(cool ? `${COOLING[cool]} the heat` : 'Light enough for the heat', W.weather * 0.8, true);
    else if (h >= 0.25) bad(sticky ? 'Too rich for sticky heat' : 'Heavy for this heat', W.weather, true);
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
    const fits = contrib.filter(c => c[1] > 20).slice(0, 2).map(c => nounOf(c[0]));
    const clash = contrib.filter(c => c[1] < -20).at(-1)?.[0];
    const phrase = occasion.phrase ?? occasion.label.toLowerCase();
    const plural = fits.length > 1 || (fits.length && isPlural(fits[0]));
    if (fits.length) good(`${cap(fits.join(' & '))} suit${plural ? '' : 's'} ${phrase}`, W.occasion * (0.5 + parts.occasion), true);
    if (clash) bad(`${cap(nounOf(clash))} ${isPlural(nounOf(clash)) ? 'are' : 'is'} off for ${phrase}`, W.occasion * (1.5 - parts.occasion) * 0.5, true);

    // Longevity and sillage, where the occasion cares about them.
    const perf = performanceFit(frag, occasion);
    const wish = occasion.performance ?? {};
    const [loud, quiet] = wish.sillage > 0 ? ['Projects across a room', `Too quiet for ${phrase}`] : ['Stays close to the skin', `Projects a lot for ${phrase}`];
    if (perf.sillage >= PERFORMANCE_REASON) good(loud, W.occasion * perf.sillage * 2, true);
    else if (perf.sillage <= -PERFORMANCE_REASON) bad(quiet, W.occasion * -perf.sillage * 2, true);
    if (perf.longevity >= PERFORMANCE_REASON) good(`Lasts the whole ${slot === 'night' ? 'night' : 'day'}`, W.occasion * perf.longevity * 2, true);
    else if (perf.longevity <= -PERFORMANCE_REASON) bad('Fades early', W.occasion * -perf.longevity * 2, true);

    const voted = votedOccasionFit(frag, occasion);
    const what = VOTED_OCCASIONS[occasion.id]?.[3];
    if (voted >= PERFORMANCE_REASON) good(`Parfumo voters wear it for ${what}`, W.occasion * voted * 2, true);
    else if (voted <= -PERFORMANCE_REASON) bad(`Parfumo voters rarely wear it for ${what}`, W.occasion * -voted * 2, true);
  }

  if (frag.rating >= 4.35 && frag.ratingVotes >= 1000) good(`Crowd favorite · ${frag.rating.toFixed(1)}★`, 0.03);

  const d = parts.daysAgo;
  if (parts.planned) {
    if (d === 0) bad('Already picked for that day', parts.rotation, true);
    else if (d > 0) bad(`Picked ${d === 1 ? 'the day' : `${d} days`} before`, parts.rotation, true);
  } else if (d === 0) bad('Already wearing it today', parts.rotation, true);
  else if (d === 1) bad('Worn yesterday', parts.rotation, true);
  else if (d > 1) bad(`Worn ${d} days ago`, parts.rotation, true);

  return out.sort((a, b) => b.specific - a.specific || b.strength - a.strength);
}

/**
 * Rank a collection for one time slot.
 * conditions: { feelsF, humidity, dewF?, category, date: Date, lat }
 * slot: 'day' | 'night'
 * opts: { occasion?, history?: [{id, date: 'YYYY-MM-DD'}], todayISO? }
 */
export function rank(fragrances, conditions, slot, opts = {}) {
  const { occasion = null, history = [], todayISO = new Date().toISOString().slice(0, 10) } = opts;
  const weights = targetSeasonWeights(conditions.feelsF, conditions.date, conditions.lat);

  const scored = fragrances.map(frag => {
    const { penalty, daysAgo, planned } = rotationPenalty(frag.id, history, todayISO, slot);
    const parts = {
      season: seasonFit(frag, weights),
      time: timeFit(frag, slot),
      weather: weatherFit(frag, conditions),
      quality: quality(frag),
      occasion: occasion ? occasionPart(occasionRaw(frag, occasion), occasion) : null,
      rotation: penalty,
      daysAgo,
      planned,
    };
    return { fragrance: frag, score: scoreOf(parts, occasion), parts };
  });

  scored.sort((a, b) => b.score - a.score);

  let i = 0;
  for (const [tier, size] of TIER_SIZES) {
    for (let n = 0; n < size && i < scored.length; n++, i++) scored[i].tier = tier;
  }
  for (; i < scored.length; i++) scored[i].tier = 'C';

  const ctx = { conditions, slot, weights, occasion };
  for (const s of scored) s.reasons = reasonsFor(s.fragrance, s.parts, ctx);
  return scored;
}

// How far below the top score a bottle not yet in the plan can sit and still
// take the slot. Keeps one all-rounder from filling the whole week.
const PLAN_MARGIN = 0.06;

/**
 * Plan a run of windows in time order (e.g. the week ahead, day then night).
 * Each planned pick counts as worn for the windows after it, and a bottle not
 * yet in the plan wins over a repeat when it scores within PLAN_MARGIN.
 * A wear already logged for a window is kept as that window's pick.
 * Returns [{ win, ranked, pick }].
 */
export function planWindows(fragrances, windows, opts = {}) {
  const { occasion = null, history = [] } = opts;
  let planned = [...history];
  const used = new Set();
  return windows.map(win => {
    const ranked = rank(fragrances, win, win.slot, { occasion, history: planned, todayISO: win.dateISO });
    const logged = history.find(h => h.date === win.dateISO && h.slot === win.slot);
    const fresh = ranked.find(r => !used.has(r.fragrance.id));
    let pick = logged && ranked.find(r => r.fragrance.id === logged.id);
    if (!pick) pick = fresh && ranked[0].score - fresh.score <= PLAN_MARGIN ? fresh : ranked[0];
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
