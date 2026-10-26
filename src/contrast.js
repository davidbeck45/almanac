// Toss-ups: the bottles that suit a window as well as its pick, and how each
// differs from it in a word or two, so a near tie reads as the free choice it
// is. On real weather the runner-up sits within a point of the pick's
// displayed match on half to three quarters of windows, and the weather's own
// error moves picks by more than that. Pure: Now's card (src/views/wear.js)
// and the CLI's answers (scripts/recommend.mjs) both read it.
import { heaviness } from './accords.js';
import { performanceLevel, isDisliked } from './engine.js';
import { styleScores, shownOf } from './scent-styles.js';
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

/**
 * How `other` differs from `pick` (engine records), in at most two words: a
 * comparison, fresher or richer (heaviness) or quieter or louder (sillage),
 * whichever is further past its step, then a scent style its card shows and
 * the pick's doesn't (shownOf, its label in lower case: "white floral",
 * "leans skin scent"); with no such style, both comparisons. [] when nothing
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
  const style = shownOf(styleScores(other)).find(s => !shown.has(s.id));
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
 * time order), leaving out the picks of the windows either side, which a
 * swap would move (the one before already carries a rotation penalty). A
 * window with a wear logged in `history` has none: the choice is made.
 */
export function planTies(plan, { history = [] } = {}) {
  return plan.map((p, i) => {
    if (history.some(h => !h.planned && h.date === p.win.dateISO && h.slot === p.win.slot)) return [];
    const skip = [plan[i - 1], plan[i + 1]].map(q => q?.pick?.fragrance.id).filter(id => id != null);
    return tiesFor(p.pick, p.ranked, { skip });
  });
}

// "Legacy (fresher, white floral)": a tie's name with its tags.
export const tieName = ({ entry, tags }) => `${entry.fragrance.name}${tags.length ? ` (${tags.join(', ')})` : ''}`;

// "today", "tonight", "tomorrow night", "Friday": a window's name inside a sentence.
export const whenOf = win => (/^(Today|Tonight|Tomorrow)\b/.test(win?.label ?? '') ? win.label.toLowerCase() : win?.label || 'now');

/**
 * The tie line for a window: "Legacy (fresher) and Aristo (louder) suit
 * today just as well.", or with the same tags on each, "Essence de Blanc and
 * Shiyaaka Sky (both fresh citrus) suit today just as well." '' with no
 * ties. For markup, `name` draws each tie's name and `text` escapes the
 * words around them.
 */
export function tieLine(ties, win, { name = t => t.entry.fragrance.name, text = s => s } = {}) {
  if (!ties.length) return '';
  const said = ties.map(t => t.tags.join(', '));
  const shared = ties.length > 1 && said[0] && said.every(s => s === said[0]);
  const names = ties.map((t, i) => `${name(t)}${!shared && said[i] ? text(` (${said[i]})`) : ''}`);
  const list = names.length > 1 ? `${names.slice(0, -1).join(text(', '))}${text(' and ')}${names.at(-1)}` : names[0];
  return `${list}${text(`${shared ? ` (${ties.length > 2 ? 'all' : 'both'} ${said[0]})` : ''} suit${names.length > 1 ? '' : 's'} ${whenOf(win)} just as well.`)}`;
}
