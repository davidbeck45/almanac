// How much to spray, and where, for one bottle in one window and occasion.
// A heuristic from collectors' rules of thumb (extrait 1–2, EDP 2–3, EDT 3–4,
// cologne 4–5; the office 1–2 at most; spray less, not more), led by how the
// bottle actually performs: concentration doesn't decide sillage. Starts
// from BASE and moves by
// - sillage and longevity (the engine's performanceLevel: Parfumo's ratings
//   or the dataset's votes, with your own skin nudges),
// - the strength the name claims (Extrait, Elixir, EDT, Cologne…), half as
//   much when voters have rated its performance,
// - the weather: heat and sticky air carry scent (fewer, lower on the body),
//   and take more off a rich, heavy bottle, which turns cloying, than off a
//   fresh one, which burns off; cold mutes it (more, and on fabric, which
//   holds it),
// - the occasion: the office quiet, a date close, a night out louder.
// Text never names a temperature.
import { performanceLevel, performanceRating, isSticky } from './engine.js';
import { heaviness } from './accords.js';
import { wearsClose } from './scent-styles.js';

const BASE = 3;
const SPRAYS = [1, 6];
const SILLAGE_STEP = 1.5; // sprays per sillage level (-1..1)
const LONGEVITY_STEP = { fades: 0.6, lasts: 0.3 };
// Votes on performance that make the name's claim count half.
const RATED_VOTES = 50;
// Feels-like (°F) where heat starts taking sprays off and where it takes HEAT_STEP;
// where cold starts adding them and where it adds COLD_STEP.
const HEAT = [72, 90], HEAT_STEP = 1, STICKY_STEP = 0.5;
const COLD = [50, 20], COLD_STEP = 1;
// The heat steps times this, by the bottle's heaviness (-0.5 fresh .. 0.6
// rich): about a quarter for a fresh citrus, an even step for a middling
// bottle, nearly double for a gourmand. Heavier than RICH reads as rich.
const heatLoad = h => clamp(0.8 + 1.5 * h, 0.2, 1.8);
const RICH = 0.25;
const FRESH = -0.1;
// Levels past which a bottle reads as loud or quiet, lasting or fleeting,
// and as a little louder or quieter than most.
const LEVEL_REASON = 0.35;
const MILD_REASON = 0.15;
// A reason pushing against the count is worth a "though" from this many sprays.
const AGAINST_REASON = 0.5;

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
const listOf = items => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

// The strength a name claims, first match: [pattern, sprays, reason].
const CONCENTRATIONS = [
  [/\b(body mist|body spray|splash)\b/i, 1.5, 'A light body mist'],
  [/\b(eau de cologne|cologne|eau fra[iî]che)\b/i, 1, 'Cologne strength'],
  [/\b(eau de toilette|edt)\b/i, 0.5, 'An eau de toilette'],
  [/\b(extrait|pure parfum)\b/i, -0.75, 'Extrait strength'],
  [/(?<!eau de )\bparfum\b/i, -0.75, 'Parfum strength'],
  [/\b(elixir|intense|absolu|absolute)\b/i, -0.5, 'A stronger version'],
];

export function concentrationOf(name) {
  const hit = CONCENTRATIONS.find(([re]) => re.test(name ?? ''));
  return hit ? { sprays: hit[1], why: hit[2] } : null;
}

// A record's strength: its name's claim, else a body mist by the dataset's
// flag (most mists don't say so in their name: "At the Beach").
const isMist = r => [r.extras?.flags, r.about?.flags].some(flags => flags?.includes('mist'));
function strengthOf(record) {
  const named = concentrationOf(record.name);
  if (named || !isMist(record)) return named;
  const [, sprays, why] = CONCENTRATIONS[0];
  return { sprays, why };
}

// A perfume oil, as Discover's cards call one (src/views/discover/templates.js
// formatOf): dabbed on, not sprayed.
const OIL = /\b(?:perfume|fragrance|parfum|attar|concentrated|body) oil\b|\b(?:oil|attar)$/i;
export const isOil = record => OIL.test(String(record?.name ?? ''));

// By occasion id: sprays added, the most it should take, and why.
const OCCASIONS = {
  office: { shift: -1, max: 2, why: 'The office wants it quiet' },
  date: { shift: -0.5, max: 4, why: 'A date wants it close' },
  cozy: { shift: -0.5, max: 3, why: 'At home a little goes far' },
  formal: { shift: -0.25, why: 'Formal wear calls for restraint' },
  nightout: { shift: 1, why: 'A night out can take more' },
  outdoors: { shift: 0.5, why: 'Open air thins it out' },
};

// Where it goes, most important first: as many spots as sprays.
const SPOTS = {
  office: ['chest', 'stomach'],
  heat: ['chest', 'stomach'],
  date: ['neck', 'chest', 'wrists'],
  cold: ['neck', 'chest', 'collar or scarf', 'wrists'],
  nightout: ['neck', 'chest', 'back of the neck', 'wrists'],
  outdoors: ['neck', 'chest', 'clothes'],
  any: ['neck', 'chest', 'wrists'],
};
const SPOT_TEXT = { 'collar or scarf': 'your collar or scarf', clothes: 'your clothes' };
const spotText = spot => SPOT_TEXT[spot] ?? `the ${spot}`;

/**
 * Spray guidance for a record in a window (conditions: feelsF, dewF or
 * humidity) and an optional occasion (object or id). `skin` ({ longevity,
 * sillage }, -1..1) overrides the record's own `personal` nudges.
 * -> { sprays: [lo, hi], unit: 'spray', where: [spot], text, why: [reason],
 * note }. A perfume oil gets dabs (`unit: 'dab'`) instead.
 */
export function sprayGuide(record, conditions, occasion = null, skin = null) {
  if (isOil(record)) {
    const quiet = (typeof occasion === 'string' ? occasion : occasion?.id) === 'office';
    return {
      sprays: quiet ? [1, 1] : [1, 2],
      unit: 'dab',
      where: quiet ? ['wrists'] : ['wrists', 'neck'],
      text: `${quiet ? 'A dab, on the wrists' : 'A dab or two, on the wrists and the neck'}. A perfume oil goes on by touch, and a little goes far.`,
      why: ['A perfume oil'],
      note: null,
    };
  }
  const frag = skin ? { ...record, personal: { ...record.personal, ...skin } } : record;
  const key = typeof occasion === 'string' ? occasion : occasion?.id ?? null;
  const occ = OCCASIONS[key] ?? {};
  const mine = frag.personal ?? {};
  const terms = []; // { sprays, why, clause }: a why of null moves the count silently
  const add = (sprays, why, clause = why?.toLowerCase()) => terms.push({ sprays, why, clause });

  const sillage = performanceLevel(frag, 'sillage');
  if (mine.sillage > 0) add(-SILLAGE_STEP * sillage, 'Projects more on you', 'it projects more on you');
  else if (mine.sillage < 0) add(-SILLAGE_STEP * sillage, 'Sits closer on you', 'it sits closer on you');
  else if (sillage >= LEVEL_REASON) add(-SILLAGE_STEP * sillage, 'Projects a lot', 'it projects a lot');
  else if (sillage <= -LEVEL_REASON) add(-SILLAGE_STEP * sillage, 'Stays close to the skin', 'it stays close to the skin');
  else if (sillage >= MILD_REASON) add(-SILLAGE_STEP * sillage, 'Projects more than most', 'it projects more than most');
  else if (sillage <= -MILD_REASON) add(-SILLAGE_STEP * sillage, 'Projects less than most', 'it projects less than most');
  else add(-SILLAGE_STEP * sillage, null);

  const longevity = performanceLevel(frag, 'longevity');
  const lastsStep = longevity < 0 ? LONGEVITY_STEP.fades : LONGEVITY_STEP.lasts;
  if (mine.longevity < 0) add(-lastsStep * longevity, 'Fades faster on you', 'it fades faster on you');
  else if (mine.longevity > 0) add(-lastsStep * longevity, 'Lasts longer on you', 'it lasts longer on you');
  else if (longevity <= -LEVEL_REASON) add(-lastsStep * longevity, 'Fades early', 'it fades early');
  else if (longevity >= LEVEL_REASON) add(-lastsStep * longevity, 'Lasts for hours', 'it lasts for hours');

  const strength = strengthOf(frag);
  if (strength) {
    const rated = (performanceRating(frag)?.votes ?? 0) >= RATED_VOTES;
    add(strength.sprays * (rated ? 0.5 : 1), strength.why, `it’s ${strength.why.charAt(0).toLowerCase()}${strength.why.slice(1)}`);
  }

  const feels = conditions?.feelsF ?? 65;
  const heat = clamp((feels - HEAT[0]) / (HEAT[1] - HEAT[0]), 0, 1);
  const sticky = conditions ? isSticky(conditions) : false;
  const h = heaviness(frag.accords ?? {});
  const load = heatLoad(h);
  const rich = h >= RICH;
  if (sticky) add(-(HEAT_STEP * heat + STICKY_STEP) * load, rich ? 'Sticky heat makes rich notes cloying' : 'Sticky air carries it');
  else if (heat > 0) add(-HEAT_STEP * heat * load, rich ? 'Heat makes rich notes cloying' : 'Heat makes it bloom');
  const cold = clamp((feels - COLD[0]) / (COLD[1] - COLD[0]), 0, 1);
  if (cold > 0) add(COLD_STEP * cold, 'Cold air mutes it');

  if (occ.shift) add(occ.shift, occ.why);

  const amount = clamp(BASE + terms.reduce((sum, t) => sum + t.sprays, 0), SPRAYS[0], SPRAYS[1]);
  const near = Math.round(amount);
  let [lo, hi] = Math.abs(amount - near) < 0.25 ? [near, near] : [Math.floor(amount), Math.ceil(amount)];
  hi = Math.min(hi, occ.max ?? SPRAYS[1]);
  lo = Math.min(lo, hi);

  // The office and heat keep it low and under a shirt (not a quiet, fresh
  // bottle, which heat won't make loud); a date by the neck.
  const spots = key === 'office' ? SPOTS.office
    : (heat >= 0.5 || sticky) && !(h <= FRESH && sillage < MILD_REASON) ? SPOTS.heat
    : key === 'date' ? SPOTS.date
    : cold >= 0.5 ? SPOTS.cold
    : SPOTS[key] ?? SPOTS.any;
  const where = spots.slice(0, Math.max(1, Math.min(hi, spots.length)));
  const under = spots === SPOTS.office || spots === SPOTS.heat ? ', under your shirt' : '';

  // Why: what moved the count the way it went leads ("and" between two of
  // them); a big push the other way follows with "though". A count the
  // occasion caps is the occasion's doing.
  const ranked = terms.filter(t => t.why && Math.abs(t.sprays) >= 0.25).sort((a, b) => Math.abs(b.sprays) - Math.abs(a.sprays));
  const capped = occ.max != null && amount > occ.max;
  const way = Math.sign((lo + hi) / 2 - BASE) || Math.sign(amount - BASE) || Math.sign(ranked[0]?.sprays ?? 0);
  const along = ranked.filter(t => Math.sign(t.sprays) === way), against = ranked.filter(t => Math.sign(t.sprays) === -way);
  if (capped) along.sort((a, b) => (b.why === occ.why) - (a.why === occ.why));
  const count = lo === hi ? `${lo} spray${lo === 1 ? '' : 's'}` : `${lo}–${hi} sprays`;
  const text = [`${count}, on ${listOf(where.map(spotText))}${under}.`];
  const [lead, next] = along, other = against[0];
  if (lead) {
    const though = other && Math.abs(other.sprays) >= AGAINST_REASON && !(next && Math.abs(next.sprays) >= Math.abs(other.sprays));
    text.push(`${cap(lead.clause)}${though ? `, though ${other.clause}` : next ? ` and ${next.clause}` : ''}.`);
  } else if (other) text.push(`${cap(other.clause)}.`);

  // One note, most useful first: don't chase a loud bottle, top up one that
  // fades (by the crowd's votes or your skin) or burns off in heat, and a
  // close-wearing one won't crowd anyone (unless it projects more on you).
  const said = text.join(' ');
  let note = null;
  if (hi <= 2 && sillage >= LEVEL_REASON) note = 'You’ll stop smelling it long before others do; don’t add more.';
  else if (mine.longevity < 0 || (!mine.longevity && longevity <= -LEVEL_REASON)) {
    note = /fades/.test(said) ? 'Take it along to top up.' : `It fades early${mine.longevity < 0 ? ' on you' : ''}, so take it along to top up.`;
  } else if (heat >= 0.5 && h <= FRESH) note = 'Fresh notes burn off fast in heat; take it along to top up.';
  else if (wearsClose(record) && !(mine.sillage > 0)) note = 'It wears close, so this many won’t crowd anyone.';

  return { sprays: [lo, hi], unit: 'spray', where, text: text.join(' '), why: ranked.map(t => t.why), note };
}
