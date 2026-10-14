// Bottles no database has, entered by their owner: the main accords (strongest
// first) and, optionally, the seasons and time of day they wear it. Season and
// day/night shares blend those picks with what the accords predict.
//
// The prediction (also the prior the engine leans a few votes toward) reads
// each accord's profile in src/profiles.js: the season and night shares it
// pulls a bottle toward, fitted on 12,000 well-voted Fragrantica bottles.
import { ACCORDS, barStrength } from './accords.js';
import { ACCORD_PROFILES, PROFILE_MEAN } from './profiles.js';

export const CUSTOM_PREFIX = 'my:';
export const MAX_CUSTOM_ACCORDS = 6;

const SEASONS = ['winter', 'spring', 'summer', 'fall'];
const SEASON_FLOOR = 0.03;
// How much the owner's own season and time picks count against the estimate.
const PICK_WEIGHT = 0.5;
const TIME_TARGET = { day: 0.15, night: 0.85, both: 0.5 };
// Listed order stands in for strength: 100, 88, 76...
const STRENGTH_STEP = 12;

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const round3 = x => Math.round(x * 1000) / 1000;

export const isCustomId = id => String(id).startsWith(CUSTOM_PREFIX);

// Each accord once (a link could repeat one), the engine's own only.
const accordStrengths = names => Object.fromEntries(
  [...new Set(names)].filter(a => typeof a === 'string' && Object.hasOwn(ACCORDS, a)).slice(0, MAX_CUSTOM_ACCORDS)
    .map((a, i) => [a, 100 - STRENGTH_STEP * i]),
);

// [winter, spring, summer, fall, night]: each accord's profile, weighted by
// its strength (profiles are fitted on strengths, records keep bar widths).
function accordShares(accords) {
  const out = [0, 0, 0, 0, 0];
  let total = 0;
  for (const [name, width] of Object.entries(accords)) {
    const s = barStrength(width);
    const p = ACCORD_PROFILES[name] ?? PROFILE_MEAN;
    for (let k = 0; k < 5; k++) out[k] += s * p[k];
    total += s;
  }
  return total ? out.map(x => x / total) : PROFILE_MEAN;
}

const seasonShares = raw => {
  const floored = raw.map(x => Math.max(SEASON_FLOOR, x));
  const t = floored.reduce((a, b) => a + b, 0);
  return Object.fromEntries(SEASONS.map((s, i) => [s, floored[i] / t]));
};

export function estimateSeason(accords, picked = []) {
  const est = seasonShares(accordShares(accords).slice(0, 4));
  const chosen = SEASONS.filter(s => picked.includes(s));
  const w = chosen.length ? PICK_WEIGHT : 0;
  return Object.fromEntries(SEASONS.map(s =>
    [s, round3((1 - w) * est[s] + (chosen.includes(s) ? w / chosen.length : 0))]));
}

export function estimateNight(accords, time = null) {
  const est = clamp(accordShares(accords)[4], 0.15, 0.85);
  return round3(time in TIME_TARGET ? (1 - PICK_WEIGHT) * est + PICK_WEIGHT * TIME_TARGET[time] : est);
}

// What a bottle's votes lean toward when they're few: its accords' estimate,
// averaged with the votes of the bottles voters say it smells like (`like`,
// from data/fragrantica/) when it has them.
export function predictedShares(accords, like = null) {
  const season = estimateSeason(accords), night = estimateNight(accords);
  if (!like) return { season, night };
  return {
    season: Object.fromEntries(SEASONS.map(s => [s, (season[s] + like.season[s]) / 2])),
    night: (night + like.night) / 2,
  };
}

const randomId = () => Math.random().toString(36).slice(2, 10);

/**
 * { name, brand?, accords: [accord names, strongest first], seasons?: [...], time?: 'day'|'night'|'both' }
 * -> engine record (same shape as data/collection.json entries), or null
 * when none of the accords is one the engine knows: with nothing to read,
 * every fit would be a guess.
 */
export function customRecord({ id = null, name, brand = '', accords, seasons = [], time = null }) {
  const strengths = accordStrengths(accords);
  if (!Object.keys(strengths).length) return null;
  const night = estimateNight(strengths, time);
  return fromParts({
    id: id ?? CUSTOM_PREFIX + randomId(),
    name,
    brand,
    accords: strengths,
    season: estimateSeason(strengths, seasons),
    night,
  });
}

function fromParts({ id, name, brand, accords, season, night }) {
  return {
    id,
    source: 'custom',
    name: String(name).trim(),
    brand: String(brand ?? '').trim(),
    year: null,
    gender: null,
    url: null,
    thumb: null,
    rating: 0,
    ratingVotes: 0,
    accords,
    season,
    dayNight: { day: round3(1 - night), night },
    notes: {},
  };
}

// No server knows these bottles, so share links carry them whole:
// my:<id>~<base64url of [name, brand, [accords], [season %], night %]>
const toBase64Url = s => btoa(String.fromCharCode(...new TextEncoder().encode(s)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64Url = s => new TextDecoder().decode(
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)));

export function shareToken(record) {
  const pct = x => Math.round(x * 100);
  const body = [record.name, record.brand, Object.keys(record.accords), SEASONS.map(s => pct(record.season[s])), pct(record.dayNight.night)];
  return `${record.id}~${toBase64Url(JSON.stringify(body))}`;
}

export function fromShareToken(token) {
  const [id, data] = String(token).split('~');
  if (!/^my:[a-z0-9]{1,16}$/.test(id) || !data) return null;
  try {
    const [name, brand, accordNames, seasonPct, nightPct] = JSON.parse(fromBase64Url(data));
    const accords = accordStrengths(Array.isArray(accordNames) ? accordNames : []);
    // Finite percentages, each at most 100: a crafted 1e999 made every share NaN.
    const raw = Array.isArray(seasonPct) ? seasonPct.map(Number) : [], night = Number(nightPct);
    if (typeof name !== 'string' || !name.trim() || !Object.keys(accords).length) return null;
    if (raw.length !== 4 || !raw.every(n => Number.isFinite(n) && n >= 0)) return null;
    const nums = raw.map(n => Math.min(100, n)), total = nums.reduce((a, b) => a + b, 0);
    if (!(total > 0) || !(Number.isFinite(night) && night >= 0 && night <= 100)) return null;
    return fromParts({
      id,
      name: name.slice(0, 80),
      brand: String(brand ?? '').slice(0, 80),
      accords,
      season: Object.fromEntries(SEASONS.map((s, i) => [s, round3(nums[i] / total)])),
      night: round3(night / 100),
    });
  } catch {
    return null;
  }
}
