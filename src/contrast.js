// Toss-ups: the bottles that suit a window as well as its pick, and how each
// differs from it in a word or two, so a near tie reads as the free choice it
// is. On real weather the runner-up sits within a point of the pick's
// displayed match on half to three quarters of windows, and the weather's own
// error moves picks by more than that. Pure: Now's card, the Week board and
// the Occasion card (src/views/wear.js), the bottle page's Why
// (src/views/bottle.js), the CLI's answers (scripts/recommend.mjs) and the
// Omarchy widget (omarchy/widget.mjs) read it.
import { heaviness } from './accords.js';
import { performanceLevel, isDisliked, rotationPenalty, occasionWeights, DAILY_WEIGHTS, restReason, savedReason } from './engine.js';
import { styleScores, shownOf, STYLES } from './scent-styles.js';
import { matchPct } from './ui.js';

// A bottle ties the pick within this many points of its displayed match, and
// a line names at most TIES_MAX of them, best first.
export const TIE_POINTS = 1;
export const TIES_MAX = 2;
// How far apart in heaviness (src/accords.js: -1 fresh .. +1 heavy) reads as
// "fresher" or "richer", and in sillage (performanceLevel: -1 stays close ..
// +1 projects, your own nudge counted) as "quieter" or "louder".
const HEAVY_STEP = 0.2;
const SILLAGE_STEP = 0.3;
// A list ranked for an occasion names its ties only where they're news: for
// an occasion whose card would name one on under a third of its windows in
// every city measured (2023–2025 in Chicago, New York, London and Houston,
// the card's own slot, ranked as the app ranks it, with a journal that
// follows the daily picks, two wears a day or one). Formal 4–14%, Office
// 8–22%, Cozy 12–20%; Casual 13–40%, Outdoors 12–48%, Night Out 23–62%,
// Date Night 27–70%, where a line on most windows stopped telling him
// anything.
export const TIE_OCCASIONS = new Set(['formal', 'office', 'cozy']);
export const tiesNews = occasion => !occasion || TIE_OCCASIONS.has(occasion.id);
// What a pick's card shows of it: its first accords as chips (chips in
// src/ui/components.js), and the accords each style names: those it counts
// half or more (scent-styles' acc), and the one it's named for (Amber's
// "amber", which its own table leaves to the resins). A tag never names a
// style whose accord is on the pick's chips: "vanilla" beside a pick whose
// card says Vanilla reads as no difference at all.
const CHIPS_SHOWN = 3;
const STYLE_ACCORDS = new Map(STYLES.map(s => [s.id, new Set([s.id, ...Object.entries(s.acc ?? {}).filter(([, w]) => w >= 0.5).map(([a]) => a)])]));

/**
 * How `other` differs from `pick` (engine records), in at most two words: a
 * comparison, fresher or richer (heaviness) or quieter or louder (sillage),
 * whichever is further past its step, then a scent style its card shows and
 * the pick's doesn't, by its styles or its accord chips (shownOf, its label
 * in lower case: "white floral", "leans skin scent"; not "vanilla" beside
 * Amber Empire, whose chips say Vanilla); with no such style, both
 * comparisons. [] when nothing
 * sets it apart. Never "darker" or "sweeter": no style or measure says so.
 */
export function contrast(pick, other) {
  const heavier = heaviness(other.accords ?? {}) - heaviness(pick.accords ?? {});
  const louder = performanceLevel(other, 'sillage') - performanceLevel(pick, 'sillage');
  const compared = [
    [heavier / HEAVY_STEP, 'richer', 'fresher'],
    [louder / SILLAGE_STEP, 'louder', 'quieter'],
  ].filter(([steps]) => Math.abs(steps) >= 1).sort((a, b) => Math.abs(b[0]) - Math.abs(a[0])).map(([steps, more, less]) => (steps > 0 ? more : less));
  const shown = new Set(shownOf(styleScores(pick)).map(s => s.id));
  const chips = Object.keys(pick.accords ?? {}).slice(0, CHIPS_SHOWN);
  const style = shownOf(styleScores(other)).find(s => !shown.has(s.id) && !chips.some(a => STYLE_ACCORDS.get(s.id)?.has(a)));
  return style ? [...compared.slice(0, 1), style.label.toLowerCase()] : compared;
}

/**
 * The bottles in `ranked` (a window's rank() list) that suit it as well as
 * `pick`, its pick (a plan's fresh bottle or a logged wear may not be
 * ranked[0]): within TIE_POINTS of the pick's own displayed match, either
 * way. Left out: any worn or planned within the rotation window (it carries
 * a rotation penalty: he wore it lately, or the plan has it earlier), one the
 * plan saves for an event later on (`parts.saved`), a bottle he rates
 * DISLIKED or lower, and the ids in `skip` (the plan's picks
 * for its other windows, shown beside it). None when the pick was nudged:
 * the nudge chose it on purpose over closer fits. -> [{ entry, tags }], best
 * first, at most TIES_MAX.
 */
export function tiesFor(pick, ranked, { skip = [] } = {}) {
  if (!pick || pick.nudged) return [];
  const leave = new Set(skip.map(String));
  const at = matchPct(pick);
  return ranked
    .filter(r => r !== pick && r.fragrance.id !== pick.fragrance.id && !leave.has(String(r.fragrance.id))
      && !(r.parts?.rotation > 0) && !r.parts?.saved && !isDisliked(r.fragrance) && Math.abs(matchPct(r) - at) <= TIE_POINTS)
    .slice(0, TIES_MAX)
    .map(entry => ({ entry, tags: contrast(pick.fragrance, entry.fragrance) }));
}

/**
 * tiesFor every window of a plan (planWindows' [{ win, ranked, pick }], in
 * time order, with any events later on), leaving out the picks of the
 * windows either side, which a swap would move (the one before already
 * carries a rotation penalty). An event's window is ranked with no rotation
 * and nothing saved (rankEvent), so its ties also leave out the other
 * events' picks and any bottle worn or planned within the rotation window
 * before it, and an event's for an occasion outside TIE_OCCASIONS has none.
 * A window with a wear logged in `history` has none: the choice is made.
 */
export function planTies(plan, { history = [] } = {}) {
  const worn = history.filter(h => !h.planned);
  return plan.map((p, i) => {
    if (worn.some(h => h.date === p.win.dateISO && h.slot === p.win.slot) || !tiesNews(p.win.occasion)) return [];
    const skip = [plan[i - 1], plan[i + 1]].map(q => q?.pick?.fragrance.id).filter(id => id != null);
    if (p.win.occasion) {
      for (const q of plan) if (q !== p && q.win.occasion && q.pick) skip.push(q.pick.fragrance.id);
      const lately = [...worn, ...plan.slice(0, i).filter(q => q.pick).map(q => ({ id: q.pick.fragrance.id, date: q.win.dateISO, slot: q.win.slot, planned: true }))];
      for (const r of p.ranked) if (rotationPenalty(r.fragrance.id, lately, p.win.dateISO, p.win.slot).penalty > 0) skip.push(r.fragrance.id);
    }
    return tiesFor(p.pick, p.ranked, { skip });
  });
}

/**
 * The runner-up to `pick` in `ranked` (a window's rank() list): the best
 * bottle after it and its `ties` (tiesFor's, equal choices, not seconds),
 * leaving out what a tie never is either: one the plan saves for an event
 * later on, and one he rates DISLIKED or lower (a 1★ held back sits right
 * under the pick on purpose). The CLI's runnerUp and the widget's read it.
 * -> an entry of `ranked`, or null.
 */
export function runnerUpOf(pick, ranked, ties = []) {
  if (!pick) return null;
  return ranked.find(r => r !== pick && r.fragrance.id !== pick.fragrance.id && !ties.some(t => t.entry === r)
    && !r.parts?.saved && !isDisliked(r.fragrance)) ?? null;
}

// "Legacy (fresher, white floral)": a tie's name with its tags.
export const tieName = ({ entry, tags }) => `${entry.fragrance.name}${tags.length ? ` (${tags.join(', ')})` : ''}`;

// "today", "tonight", "tomorrow night", "Friday": a window's name inside a sentence.
export const whenOf = win => (/^(Today|Tonight|Tomorrow)\b/.test(win?.label ?? '') ? win.label.toLowerCase() : win?.label || 'now');

/**
 * tiesFor a list ranked on its own (the Occasion card's): none once a wear
 * is logged for the window in `history`, and for a window ranked as an
 * event (`event`: rankEvent, no rotation), none worn or planned within the
 * rotation window before it either, as planTies has it. None for an
 * `occasion` outside TIE_OCCASIONS.
 */
export function rankedTies(ranked, win, { history = [], event = false, occasion = null } = {}) {
  const worn = history.filter(h => !h.planned);
  if (worn.some(h => h.date === win.dateISO && h.slot === win.slot) || !tiesNews(occasion)) return [];
  const skip = event ? ranked.filter(r => rotationPenalty(r.fragrance.id, history, win.dateISO, win.slot).penalty > 0).map(r => r.fragrance.id) : [];
  return tiesFor(ranked[0], ranked, { skip });
}

/**
 * The tie line for a window: "Legacy (fresher) and Aristo (louder) suit
 * today just as well.", or with the same tags on each, "Essence de Blanc and
 * Shiyaaka Sky (both fresh citrus) suit today just as well." '' with no
 * ties. For markup, `name` draws each tie's name and `text` escapes the
 * words around them; `when` says what they suit in place of the window
 * ("formal wear").
 */
export function tieLine(ties, win, { name = t => t.entry.fragrance.name, text = s => s, when = whenOf(win) } = {}) {
  if (!ties.length) return '';
  const said = ties.map(t => t.tags.join(', '));
  const shared = ties.length > 1 && said[0] && said.every(s => s === said[0]);
  const names = ties.map((t, i) => `${name(t)}${!shared && said[i] ? text(` (${said[i]})`) : ''}`);
  const list = names.length > 1 ? `${names.slice(0, -1).join(text(', '))}${text(' and ')}${names.at(-1)}` : names[0];
  return `${list}${text(`${shared ? ` (${ties.length > 2 ? 'all' : 'both'} ${said[0]})` : ''} suit${names.length > 1 ? '' : 's'} ${when} just as well.`)}`;
}

// ---------- Beside the pick ----------
// Why a bottle isn't its window's pick, on its page: how far it sits from
// the pick, and the part of the score that makes most of the gap.

/**
 * What each part of the score puts between `pick` and `entry` (two entries
 * from one rank() list), weighted as scoreOf weighs it: the fits, the rating
 * (quality and his stars' term together), what the heat and the cold take
 * off for an occasion, and the rotation penalty. They add up to
 * pick.score - entry.score; positive where the pick does better.
 */
export function gapParts(entry, pick, occasion = null) {
  const W = occasion ? occasionWeights(occasion) : DAILY_WEIGHTS;
  const a = pick.parts, b = entry.parts;
  return {
    season: W.season * (a.season - b.season),
    time: W.time * (a.time - b.time),
    weather: W.weather * (a.weather - b.weather),
    rating: W.quality * (a.quality - b.quality) + (a.personal ?? 0) - (b.personal ?? 0),
    ...(occasion && {
      occasion: W.occasion * (a.occasion - b.occasion),
      heat: W.heat * ((b.heat ?? 0) - (a.heat ?? 0)),
      cold: W.cold * ((b.cold ?? 0) - (a.cold ?? 0)),
    }),
    rotation: (b.rotation ?? 0) - (a.rotation ?? 0),
  };
}

// A part in plain words, as the Why bars name them.
const PART_WORDS = {
  season: 'the season fit', time: 'the time-of-day fit', weather: 'the weather fit', occasion: 'the occasion fit', heat: 'the heat', cold: 'the cold',
};
// The biggest part names the gap alone when it makes this share of it (what the pick does better), else the two biggest.
const MOSTLY = 0.5;

function gapWords(entry, pick, occasion) {
  const yours = [entry, pick].some(e => Number.isFinite(e.fragrance.personal?.rating));
  const words = {
    ...PART_WORDS,
    rating: yours ? 'your rating' : 'the rating',
    rotation: entry.parts.planned ? 'its turn earlier in the plan' : 'a recent wear',
  };
  const gaps = Object.entries(gapParts(entry, pick, occasion)).filter(([, g]) => g > 0).sort((x, y) => y[1] - x[1]);
  const sum = gaps.reduce((t, [, g]) => t + g, 0);
  const named = gaps[0][1] >= MOSTLY * sum || gaps.length < 2 ? gaps.slice(0, 1) : gaps.slice(0, 2);
  return named.map(([k]) => words[k]).join(' and ');
}

/**
 * One line on the bottle page's Why for a bottle that isn't its window's
 * pick (`entry` and `pick` from the window's list; `occasion` the list's,
 * `worn` the id worn in the window): "Suits tonight as well as Cream
 * Velvet." within TIE_POINTS of its displayed match; "3 points under Cream
 * Velvet tonight, mostly the season fit." below it; above it (the plan
 * passed it over), what chose the pick: "2 points over Liam today, but the
 * plan gives Liam a turn." '' for the pick itself, and for a bottle saved
 * for an event later on, whose own note says why. A bottle he rates
 * DISLIKED or lower is never a toss-up (tiesFor), so within a point it says
 * how near it comes and why not: "Just under Atlantis Extrait tonight,
 * mostly your rating." (a 1★ held back can't always sit 2 points under the
 * pick, holdBackLoathed). Points as matchPct shows them; never a temperature.
 */
export function pickGapLine(entry, pick, win, { occasion = null, worn = null } = {}) {
  if (!entry || !pick || String(entry.fragrance.id) === String(pick.fragrance.id)) return '';
  const name = pick.fragrance.name;
  const what = `${occasion ? `${occasion.phrase ?? occasion.label.toLowerCase()} ` : ''}${whenOf(win)}`;
  const points = matchPct(pick) - matchPct(entry);
  if (Math.abs(points) <= TIE_POINTS && !isDisliked(entry.fragrance)) return `Suits ${what} as well as ${name}.`;
  const at = `${occasion ? `for ${what}` : what}`;
  const by = n => (n ? `${n} point${n === 1 ? '' : 's'}` : 'Just');
  if (entry.score < pick.score) return `${by(points)} under ${name} ${at}, mostly ${gapWords(entry, pick, occasion)}.`;
  if (entry.parts.saved) return '';
  const stars = entry.fragrance.personal?.rating;
  const but = String(worn) === String(pick.fragrance.id) ? `you’re wearing ${name}`
    : pick.nudged ? `${name} is due a wear`
      : isDisliked(entry.fragrance) ? `you rate it ${stars}★`
        : `the plan gives ${name} a turn`;
  return `${by(-points)} over ${name} ${at}, but ${but}.`;
}

// ---------- Why it ranks here ----------
// What the bottle page's Why says of one ranked entry, as data: the page
// draws it (src/views/bottle.js) and the CLI's --why prints it
// (scripts/recommend.mjs), so the two say it in the same words.

// The least the heat or cold has to take off for Why to say so, in percent.
const NOTE_MIN = 2;
// Why's bars, in the page's order.
const WHY_PARTS = [['occasion', 'Occasion'], ['season', 'Season'], ['weather', 'Weather'], ['time', 'Time of day'], ['quality', 'Rating']];
// Why a bottle is given a rest, in the words of its reason (src/engine.js).
const restText = (parts, slot) => restReason(parts, slot) ?? (parts.planned ? 'Picked for a day nearby' : 'Worn recently');

/**
 * Each part of an entry's score as Why's bars show it, for the list's
 * `occasion`: [{ key, label, value: the fit (0..1), pct: as the bar says it,
 * weight: its share of the score (occasionWeights, else DAILY_WEIGHTS) }].
 * The rating bar is mostly his stars once he's rated it (engine quality()),
 * and says so ("Your rating"); with neither stars nor crowd votes (a bottle
 * entered by hand) it would only read a neutral 50, so it stays out.
 */
export function whyParts(entry, occasion = null) {
  const p = entry.parts, f = entry.fragrance;
  const W = occasion ? occasionWeights(occasion) : DAILY_WEIGHTS;
  const yours = Number.isFinite(f.personal?.rating);
  const crowd = f.source !== 'custom' && f.rating > 0 && f.ratingVotes > 0;
  return WHY_PARTS.filter(([k]) => p[k] !== null && p[k] !== undefined && (k !== 'quality' || yours || crowd))
    .map(([key, label]) => ({ key, label: key === 'quality' && yours ? 'Your rating' : label, value: p[key], pct: Math.round(p[key] * 100), weight: W[key] }));
}

/**
 * What Why says took points off an entry's match, or holds it back, in the
 * page's order: [{ key, text, pct? }]. What the heat takes off a rich bottle
 * for an occasion (engine richInHeat) and the cold off a thin one
 * (thinInCold), from NOTE_MIN percent (a point is a mild evening's or the
 * office commute's, not this heat or cold): "Rich for this heat: 10% lower
 * for a date."; what a recent wear, or a pick for a day nearby, takes off:
 * "Worn 3 days ago: 6% lower so others get a turn."; and a bottle kept for
 * an event later in the plan (planWindows' `saved`: its match stands,
 * another bottle takes the window), said as on `todayISO`, as the plan says
 * it. Never a temperature.
 */
export function whyNotes(entry, win, { occasion = null, todayISO = null } = {}) {
  const p = entry.parts, notes = [];
  const phrase = occasion ? occasion.phrase ?? occasion.label.toLowerCase() : '';
  const heat = occasion && p.heat ? Math.round(occasionWeights(occasion).heat * p.heat * 100) : 0;
  const cold = occasion && p.cold ? Math.round(occasionWeights(occasion).cold * p.cold * 100) : 0;
  if (heat >= NOTE_MIN) notes.push({ key: 'heat', pct: heat, text: `Rich for this heat: ${heat}% lower for ${phrase}.` });
  if (cold >= NOTE_MIN) notes.push({ key: 'cold', pct: cold, text: `Thin for this cold: ${cold}% lower for ${phrase}.` });
  if (p.rotation > 0) {
    const pct = Math.round(p.rotation * 100);
    notes.push({ key: 'rotation', pct, text: `${restText(p, win?.slot)}: ${pct}% lower so others get a turn.` });
  }
  if (p.saved && win) notes.push({ key: 'saved', text: `${savedReason(p.saved, todayISO ?? win.dateISO)}, so the plan picks another bottle here.` });
  return notes;
}
