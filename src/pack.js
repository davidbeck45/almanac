// Trips and events: the fewest bottles to pack for a run of day and night
// windows (a trip's forecast, or typical weather past it), and the ranked
// picks for one date and slot anywhere. packTrip is pure; picksFor and
// tripPlan fetch the weather (src/weather.js).
import { rank, rotationPenalty, PLAN_MARGIN } from './engine.js';
import { tripWindows } from './weather.js';

const SHORT_DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const shortDate = iso => SHORT_DATE.format(new Date(`${iso}T12:00:00Z`));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const listOf = items => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
// Whether key a beats key b, comparing in order.
const ahead = (a, b) => {
  const j = a.findIndex((x, i) => x !== b[i]);
  return j >= 0 && a[j] > b[j];
};
function mostCommon(xs) {
  const counts = new Map();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** Windows with the trip's events on them: events [{ dateISO, slot, occasion }]. */
export function withEvents(windows, events = []) {
  return windows.map(win => {
    const event = events.find(e => e.dateISO === win.dateISO && e.slot === win.slot);
    return event ? { ...win, occasion: event.occasion } : win;
  });
}

// "every day and 3 nights", "formal wear on Dec 15": a set of windows against
// the whole trip. `the` reads "the days and nights" for all of them.
function windowsPhrase(wins, all, { the = false } = {}) {
  const plain = slot => all.filter(w => !w.occasion && w.slot === slot);
  const parts = [];
  for (const slot of ['day', 'night']) {
    const mine = wins.filter(w => !w.occasion && w.slot === slot);
    const total = plain(slot).length;
    if (!mine.length) continue;
    if (mine.length === total && total > 1) parts.push(the ? `the ${slot}s` : `every ${slot}`);
    else if (mine.length === 1) parts.push(`${slot === 'day' ? '' : 'the night of '}${shortDate(mine[0].dateISO)}`);
    else parts.push(plural(mine.length, slot));
  }
  if (parts[0] === 'every day' && parts[1] === 'every night') parts.splice(0, 2, 'every day and night');
  if (parts[0] === 'the days' && parts[1] === 'the nights') parts.splice(0, 2, 'the days and nights');
  for (const w of wins.filter(w => w.occasion)) parts.push(`${w.occasion.phrase ?? w.occasion.label.toLowerCase()} on ${shortDate(w.dateISO)}`);
  return listOf(parts);
}

// A trip this many days or longer packs at least three bottles.
const LONG_TRIP_DAYS = 7;

/**
 * The fewest bottles, up to `max`, whose best for each window scores within
 * PLAN_MARGIN of the whole wardrobe's top for it: a greedy set cover, taking
 * the bottle that covers the most windows still open each round. A trip of
 * more than one window packs at least two, and one of LONG_TRIP_DAYS or more
 * three, the extras covering the most windows. Windows can carry an occasion
 * (`occasionOf`, default win.occasion). The plan wears what's packed, spread
 * by the rotation penalty.
 * -> { bottles: [{ record, covers: [window], wears, why }],
 *      plan: [{ window, occasion, pick, score, tier, reasons, top: { record, score }, covered }],
 *      uncovered: [{ window, occasion, best, score }], text }
 */
export function packTrip(frags, windows, { max = 3, occasionOf = win => win.occasion ?? null } = {}) {
  if (!frags.length || !windows.length) return { bottles: [], plan: [], uncovered: [], text: 'Nothing to pack for.' };
  const rows = windows.map(win => {
    const occasion = occasionOf(win);
    const ranked = rank(frags, win, win.slot, { occasion, todayISO: win.dateISO });
    return { win, occasion, ranked, top: ranked[0], byId: new Map(ranked.map(r => [r.fragrance.id, r])) };
  });
  const within = (row, id) => row.byId.get(id).score >= row.top.score - PLAN_MARGIN;
  const coverOf = new Map(frags.map(f => [f.id, rows.flatMap((row, i) => (within(row, f.id) ? [i] : []))]));
  // How far a bottle sits below the tops over the whole trip, to break ties.
  const shortfall = f => rows.reduce((sum, row) => sum + row.top.score - row.byId.get(f.id).score, 0);

  // Something to trade off on a trip, and a third bottle from a week up, so
  // nothing is worn every day.
  const days = new Set(windows.map(w => w.dateISO)).size;
  const packed = [];
  const open = new Set(rows.keys());
  const least = Math.min(rows.length < 2 ? 1 : days >= LONG_TRIP_DAYS ? 3 : 2, Math.max(1, max), frags.length);
  while (packed.length < Math.max(1, max) && (open.size || packed.length < least)) {
    let best = null;
    for (const f of frags) {
      if (packed.includes(f)) continue;
      const covers = coverOf.get(f.id);
      // Open windows covered, then all windows covered, then closeness to the tops.
      const key = [covers.filter(i => open.has(i)).length, covers.length, -shortfall(f)];
      if (!best || ahead(key, best.key)) best = { f, key };
    }
    if (!best) break;
    packed.push(best.f);
    for (const i of coverOf.get(best.f.id)) open.delete(i);
  }

  let worn = [];
  const plan = rows.map(row => {
    const mine = packed.map(f => row.byId.get(f.id));
    const covering = mine.filter(r => within(row, r.fragrance.id));
    // Among the packed bottles that suit it, the one worn least lately.
    const fresh = r => r.score - rotationPenalty(r.fragrance.id, worn, row.win.dateISO, row.win.slot).penalty;
    const pick = (covering.length ? covering : mine).reduce((a, b) => (fresh(b) > fresh(a) ? b : a));
    worn = [{ id: pick.fragrance.id, date: row.win.dateISO, slot: row.win.slot, planned: true }, ...worn];
    return {
      window: row.win,
      occasion: row.occasion,
      pick: pick.fragrance,
      score: pick.score,
      tier: pick.tier,
      reasons: pick.reasons,
      top: { record: row.top.fragrance, score: row.top.score },
      covered: covering.length > 0,
    };
  });

  const wins = rows.map(r => r.win);
  const bottles = packed.map(f => {
    const covers = coverOf.get(f.id).map(i => wins[i]);
    const picked = plan.filter(p => p.pick === f);
    // Its commonest leading reason where it's worn.
    const lead = mostCommon(picked.map(p => p.reasons.find(r => r.tone === 'good')?.text).filter(Boolean));
    const reach = covers.length ? windowsPhrase(covers, wins) : 'a backup';
    return { record: f, covers, wears: picked.length, why: lead ? `${cap(reach)}; ${lead.charAt(0).toLowerCase()}${lead.slice(1)}` : cap(reach) };
  });

  const uncovered = plan.filter(p => !p.covered).map(p => ({ window: p.window, occasion: p.occasion, best: p.top.record, score: p.top.score }));
  return { bottles, plan, uncovered, text: packText(bottles, plan, uncovered, wins, packed.length >= max) };
}

// "Pack Essence de Blanc (every day) and Supremacy (every night). …"
function packText(bottles, plan, uncovered, wins, full) {
  // Each bottle with the windows it suits and is worn for.
  const worn = bottles.map(b => {
    const mine = plan.filter(p => p.pick === b.record && p.covered).map(p => p.window);
    return `${b.record.name}${mine.length ? ` (${windowsPhrase(mine, wins)})` : ''}`;
  });
  const out = [`Pack ${listOf(worn)}.`];
  // Missed windows, grouped by the bottle that would suit them.
  const missing = new Map();
  for (const u of uncovered) missing.set(u.best, [...(missing.get(u.best) ?? []), u.window]);
  for (const [best, missed] of missing) {
    out.push(`Nothing packed is quite right for ${windowsPhrase(missed, wins, { the: true })}; ${best.name} would be${full ? ', if there\'s room' : ''}.`);
  }
  if (wins.every(w => w.typical)) out.push('The dates are past the forecast, so this plans on typical weather for them.');
  else if (wins.some(w => w.typical)) out.push('Dates past the forecast use typical weather.');
  return out.join(' ');
}

/**
 * Ranked picks for one date and slot at any place: the forecast's window, or
 * typical weather past the forecast. The slot defaults to the occasion's,
 * else day. -> { window, ranked }, or null when no weather came back.
 */
export async function picksFor(frags, { place, dateISO, slot = null, occasion = null, history = [], nudge = false }) {
  const at = slot ?? occasion?.slot ?? 'day';
  const [win] = await tripWindows(place, dateISO, dateISO, { slots: [at] });
  if (!win) return null;
  return { window: win, ranked: rank(frags, win, at, { occasion, history, todayISO: dateISO, nudge }) };
}

/**
 * packTrip for a place and dates: fetches the windows (forecast, then typical
 * weather), puts the events on them and packs.
 */
export async function tripPlan(frags, { place, fromISO, toISO, events = [], max = 3 }) {
  const windows = withEvents(await tripWindows(place, fromISO, toISO), events);
  return { windows, ...packTrip(frags, windows, { max }) };
}
