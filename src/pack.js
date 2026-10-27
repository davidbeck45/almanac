// Trips and events: the fewest bottles to pack for a run of day and night
// windows (a trip's forecast, or typical weather past it), and the ranked
// picks for one date and slot anywhere. packTrip is pure; picksFor and
// tripPlan fetch the weather (src/weather.js).
import { rank, daysBetween, PLAN_MARGIN, isDisliked, ROTATION_PENALTY } from './engine.js';
import { tripWindows } from './weather.js';

const SHORT_DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const shortDate = iso => SHORT_DATE.format(new Date(`${iso}T12:00:00Z`));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const listOf = items => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
const uncap = t => t.charAt(0).toLowerCase() + t.slice(1);
const nextDay = iso => new Date(Date.parse(`${iso}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
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

// "Oct 20", "Oct 20 and 22", "Oct 20–23", "Oct 30 and Nov 2": a month named
// once, three days or more in a row as a run.
function datesPhrase(isos) {
  const dates = [...new Set(isos)].sort();
  const runs = [];
  for (const d of dates) {
    const run = runs.at(-1);
    if (run && nextDay(run.at(-1)) === d && d.slice(0, 7) === run[0].slice(0, 7)) run.push(d);
    else runs.push([d]);
  }
  const parts = [];
  let month = null;
  const day = iso => {
    const text = iso.slice(0, 7) === month ? String(+iso.slice(8)) : shortDate(iso);
    month = iso.slice(0, 7);
    return text;
  };
  for (const run of runs) {
    if (run.length >= 3) parts.push(`${day(run[0])}–${+run.at(-1).slice(8)}`);
    else parts.push(...run.map(day));
  }
  return listOf(parts);
}

// "every day and 3 nights", "formal wear on Dec 15", "the office on Oct
// 20–22", "the day and night of Oct 14": a set of windows against the whole
// trip. `the` reads "the days and nights" for all of them.
function windowsPhrase(wins, all, { the = false } = {}) {
  const plain = slot => all.filter(w => !w.occasion && w.slot === slot);
  const day = wins.filter(w => !w.occasion && w.slot === 'day'), night = wins.filter(w => !w.occasion && w.slot === 'night');
  const parts = [];
  for (const [slot, mine] of [['day', day], ['night', night]]) {
    const total = plain(slot).length;
    if (!mine.length) continue;
    if (mine.length === total && total > 1) parts.push(the ? `the ${slot}s` : `every ${slot}`);
    else if (mine.length === 1) parts.push(`${slot === 'day' ? '' : 'the night of '}${shortDate(mine[0].dateISO)}`);
    else parts.push(plural(mine.length, slot));
  }
  // One date's day and night together.
  if (day.length === 1 && night.length === 1 && day[0].dateISO === night[0].dateISO) {
    parts.splice(0, 2, `the day and night of ${shortDate(day[0].dateISO)}`);
  }
  if (parts[0] === 'every day' && parts[1] === 'every night') parts.splice(0, 2, 'every day and night');
  if (parts[0] === 'the days' && parts[1] === 'the nights') parts.splice(0, 2, 'the days and nights');
  const events = new Map();
  for (const w of wins.filter(w => w.occasion)) {
    const phrase = w.occasion.phrase ?? w.occasion.label.toLowerCase();
    events.set(phrase, [...(events.get(phrase) ?? []), w.dateISO]);
  }
  for (const [phrase, dates] of events) parts.push(`${phrase} on ${datesPhrase(dates)}`);
  return listOf(parts);
}

// A trip this many days or longer packs at least three bottles, and wears
// none of them every day when another set covers as much, plans within
// VARIETY_MARGIN a window of the best and gives the most-worn bottle at least
// VARIETY_RELIEF windows off (London in December: three bottles for twenty
// windows wear one every day whichever three they are, and the set that at
// least splits the days cost 0.037 a window). Without the relief, a set
// "wore none every day" by breaking a run of nights once (Cancún: Aristo on
// one night of Supremacy's seven), at a cost and no rest.
const LONG_TRIP_DAYS = 7;
const VARIETY_MARGIN = 0.015;
const VARIETY_RELIEF = 2;
// The most sets of one size packTrip weighs one by one; past it (a large
// collection of your own), it builds the set a bottle at a time.
const SEARCH_LIMIT = 100_000;

/**
 * The fewest bottles, up to `max`, whose best for each window scores within
 * PLAN_MARGIN of the whole wardrobe's top for it. A trip of more than one
 * window packs at least two, and one of LONG_TRIP_DAYS or more three, so
 * there's something to trade off; when `max` can't cover every window, the
 * set that covers the most. Among sets that cover as much, the one whose
 * plan scores best, each pick less its rotation penalty (ROTATION_PENALTY
 * by days between, in full across slots, where planWindows counts an
 * earlier day's other slot at OTHER_SLOT): an extra bottle goes where it
 * most improves the picks or spares a bottle worn day after day (a night's
 * top, not a copy of the first). Bottles you rate DISLIKED or lower only go in for a window nothing
 * else suits. On a trip of LONG_TRIP_DAYS or more, three or more bottles
 * that wear none every day (on every date, by day or night) win when they
 * plan nearly as well (VARIETY_MARGIN) and rest the most-worn bottle for real
 * (VARIETY_RELIEF), a fourth goes in (as `max` allows) when three can't rest
 * one, and when the set packed still wears one every day, `variety` names the
 * bottle that, packed too, would rest it (`slot`: 'day' or 'night' when every
 * wear of the bottle worn every day is one, else null). Windows can carry an
 * occasion (`occasionOf`, default win.occasion).
 * -> { bottles: [{ record, covers: [window], wears, why }],
 *      plan: [{ window, occasion, pick, score, tier, reasons, top: { record, score }, covered }],
 *      uncovered: [{ window, occasion, best, score }], variety: { add, everyDay: [record], slot } | null, text }
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

  // Bottles that suit a window, the ones you dislike only where nothing else does.
  const suits = frags.filter(f => coverOf.get(f.id).length);
  const liked = suits.filter(f => !isDisliked(f));
  const reached = new Set(liked.flatMap(f => coverOf.get(f.id)));
  const pool = [...liked, ...suits.filter(f => !liked.includes(f) && coverOf.get(f.id).some(i => !reached.has(i)))];

  const days = new Set(windows.map(w => w.dateISO)).size;
  const most = Math.max(1, max);
  const least = Math.min(rows.length < 2 ? 1 : days >= LONG_TRIP_DAYS ? 3 : 2, most, pool.length);
  const trip = {
    scores: pool.map(f => rows.map(row => row.byId.get(f.id).score)),
    floor: rows.map(row => row.top.score - PLAN_MARGIN),
    day: rows.map(row => daysBetween(rows[0].win.dateISO, row.win.dateISO)),
    // On a long trip, each date's windows, for telling a bottle worn every day.
    dates: days >= LONG_TRIP_DAYS ? [...new Set(windows.map(w => w.dateISO))].map(d => rows.flatMap((row, w) => (row.win.dateISO === d ? [w] : []))) : null,
  };
  const set = chooseSet(trip, least, most);
  const { picks } = wearPlan(set, trip);
  // Still one worn every day with no room to spare: the bottle that, packed too, would rest it.
  const everyDay = everyDayOf(set, picks, trip);
  let variety = null;
  if (everyDay.length && set.length >= Math.max(most, 3)) {
    const now = judgeSet(set, trip);
    const add = pool.map((_, i) => i).filter(i => !set.includes(i)).map(i => judgeSet([...set, i], trip))
      .filter(o => rests(o, now)).reduce((a, b) => (!a || betterSet(b, a) ? b : a), null);
    if (add) {
      const slots = new Set(everyDay.flatMap(i => picks.flatMap((p, w) => (p === i ? [rows[w].win.slot] : []))));
      variety = { add: pool[add.set.at(-1)], everyDay: everyDay.map(i => pool[i]), slot: slots.size === 1 ? [...slots][0] : null };
    }
  }
  // In the order they're first worn.
  const first = i => (picks.includes(i) ? picks.indexOf(i) : Infinity);
  const packed = [...set].sort((a, b) => first(a) - first(b)).map(i => pool[i]);

  const plan = picks.map((i, w) => {
    const row = rows[w];
    const pick = row.byId.get(pool[i].id);
    return {
      window: row.win,
      occasion: row.occasion,
      pick: pick.fragrance,
      score: pick.score,
      tier: pick.tier,
      reasons: pick.reasons,
      top: { record: row.top.fragrance, score: row.top.score },
      covered: packed.some(f => within(row, f.id)),
    };
  });

  const wins = rows.map(r => r.win);
  const bottles = packed.map(f => {
    const covers = coverOf.get(f.id).map(i => wins[i]);
    const picked = plan.filter(p => p.pick === f);
    const wears = picked.map(p => p.window);
    // When it's worn, its commonest leading reason there, and where else it would do.
    const lead = mostCommon(picked.map(p => p.reasons.find(r => r.tone === 'good')?.text).filter(Boolean));
    const spare = covers.filter(w => !wears.includes(w));
    const why = [wears.length ? cap(windowsPhrase(wears, wins)) : 'A spare', lead && uncap(lead), spare.length && `also suits ${windowsPhrase(spare, wins)}`];
    return { record: f, covers, wears: picked.length, why: why.filter(Boolean).join('; ') };
  });

  const uncovered = plan.filter(p => !p.covered).map(p => ({ window: p.window, occasion: p.occasion, best: p.top.record, score: p.top.score }));
  return { bottles, plan, uncovered, variety, text: packText(bottles, plan, uncovered, wins, packed.length >= max, variety) };
}

// The packed bottles (indexes) a plan wears on every date of a long trip.
const everyDayOf = (set, picks, { dates }) => (dates ? set.filter(i => dates.every(ws => ws.some(w => picks[w] === i))) : []);

/**
 * Which packed bottle (indexes into trip.scores) to wear in each window, in
 * time order: among those within reach of its top (all of them when none
 * are), the best score less its rotation penalty for the trip so far.
 * -> { picks: [index], total: the picks' scores less their penalties }
 */
function wearPlan(set, { scores, floor, day }) {
  const last = new Map();
  const picks = [];
  let total = 0;
  for (let w = 0; w < floor.length; w++) {
    const reach = set.some(i => scores[i][w] >= floor[w]);
    let pick = -1, value = -Infinity;
    for (const i of set) {
      if (reach && scores[i][w] < floor[w]) continue;
      const v = scores[i][w] - (last.has(i) ? ROTATION_PENALTY[day[w] - last.get(i)] ?? 0 : 0);
      if (v > value) [pick, value] = [i, v];
    }
    picks.push(pick);
    last.set(pick, day[w]);
    total += value;
  }
  return { picks, total };
}

const choose = (n, k) => {
  let c = 1;
  for (let i = 0; i < k; i++) c = (c * (n - i)) / (i + 1);
  return c;
};

// A set as chooseSet weighs it: windows reached, its wearPlan's total, each
// window's best packed score, how many it wears every day (long trips) and
// the most windows one bottle is worn.
function judgeSet(set, trip) {
  const { scores, floor } = trip;
  let reached = 0, best = 0;
  for (let w = 0; w < floor.length; w++) {
    let top = -Infinity;
    for (const i of set) top = Math.max(top, scores[i][w]);
    if (top >= floor[w]) reached++;
    best += top;
  }
  const { picks, total } = wearPlan(set, trip);
  const most = Math.max(...set.map(i => picks.filter(p => p === i).length));
  return { set, reached, total, best, daily: everyDayOf(set, picks, trip).length, most };
}
// More windows reached, then a better plan, then better-packed.
const betterSet = (a, b) => (a.reached !== b.reached ? a.reached > b.reached
  : Math.abs(a.total - b.total) > 1e-9 ? a.total > b.total : a.best > b.best);
// Whether set a rests what b wears every day: fewer worn every day, and its
// most-worn bottle at least VARIETY_RELIEF windows short of b's.
const rests = (a, b) => a.daily < b.daily && a.most <= b.most - VARIETY_RELIEF;
// The best of `options` by betterSet, unless (with `vary`) one that reaches
// as many windows and plans within VARIETY_MARGIN a window of it rests what
// it wears every day.
function bestSet(options, windows, vary) {
  const top = options.reduce((a, b) => (betterSet(b, a) ? b : a));
  if (!vary || !top.daily) return top;
  let varied = top;
  for (const o of options) {
    if (o.reached === top.reached && o.total >= top.total - VARIETY_MARGIN * windows && rests(o, top)
      && (varied === top || o.daily < varied.daily || (o.daily === varied.daily && betterSet(o, varied)))) varied = o;
  }
  return varied;
}

/**
 * Which bottles to pack, as indexes into trip.scores (per bottle, its score
 * in each window; trip.floor is each window's top less PLAN_MARGIN): the
 * fewest from `least` to `most` that reach every window (on a long trip,
 * one more when that rests a bottle worn every day), else `most` that
 * reach the most. Sets compare by windows reached, then by their wearPlan's
 * total, then by each window's best packed score (judgeSet, betterSet), and
 * three or more for a long trip wearing no bottle every day win within
 * VARIETY_MARGIN (bestSet: two for twenty windows wear both every day). Every set of a size is weighed while there are at most
 * SEARCH_LIMIT of them; past that, the set grows a bottle at a time by the
 * same order.
 */
function chooseSet(trip, least, most) {
  const { scores, floor } = trip;
  let found = null, full = null;
  for (let k = Math.max(1, least); k <= most && k <= scores.length; k++) {
    if (choose(scores.length, k) <= SEARCH_LIMIT) {
      const options = [];
      const walk = (from, set) => {
        if (set.length === k) return void options.push(judgeSet(set, trip));
        for (let i = from; i <= scores.length - (k - set.length); i++) walk(i + 1, [...set, i]);
      };
      walk(0, []);
      found = bestSet(options, floor.length, k >= 3);
    } else {
      let set = [];
      while (set.length < k) {
        const options = scores.map((_, i) => i).filter(i => !set.includes(i)).map(i => judgeSet([...set, i], trip));
        found = bestSet(options, floor.length, k >= 3);
        set = found.set;
      }
    }
    if (found.reached === floor.length) {
      // On a long trip, one more (as `most` allows) when that rests a bottle worn every day.
      if (full && !rests(found, full)) return full.set;
      full = found;
      if (!found.daily || !trip.dates) break;
    }
  }
  return (full ?? found).set;
}

// "Pack Essence de Blanc (every day) and Supremacy (every night). …"
function packText(bottles, plan, uncovered, wins, full, variety) {
  // Each bottle with the windows it's worn for, as its own line says (a
  // window nothing packed suits has the sentence after this too).
  const worn = bottles.map(b => {
    const mine = plan.filter(p => p.pick === b.record).map(p => p.window);
    return `${b.record.name}${mine.length ? ` (${windowsPhrase(mine, wins)})` : ''}`;
  });
  const out = [`Pack ${listOf(worn)}.`];
  // Missed windows, grouped by the bottle that would suit them.
  const missing = new Map();
  for (const u of uncovered) missing.set(u.best, [...(missing.get(u.best) ?? []), u.window]);
  for (const [best, missed] of missing) {
    out.push(`Nothing packed is quite right for ${windowsPhrase(missed, wins, { the: true })}; ${best.name} would be${full ? ', if there’s room' : ''}.`);
  }
  if (variety) {
    // By what it's worn for: "every night … a night off", or by day and night alike "a break".
    const [when, rest] = variety.slot === 'night' ? ['every night of the trip', 'a night off']
      : variety.slot === 'day' ? ['every day of the trip', 'a day off'] : ['every day of the trip, by day or night', 'a break'];
    out.push(`${listOf(variety.everyDay.map(f => f.name))} ${variety.everyDay.length > 1 ? 'are' : 'is'} worn ${when}; pack ${variety.add.name} too and each gets ${rest}.`);
  }
  if (wins.every(w => w.typical)) out.push('The dates are past the forecast, so this plans on typical weather for them.');
  else if (wins.some(w => w.typical)) out.push('Dates past the forecast use typical weather.');
  return out.join(' ');
}

/**
 * Ranked picks for one date and slot at any place: the forecast's window, or
 * typical weather past the forecast. The slot defaults to the occasion's,
 * else day. -> { window, ranked }, or null when no weather came back.
 * `refusePast` throws for a date gone by at the place, as tripWindows'.
 */
export async function picksFor(frags, { place, dateISO, slot = null, occasion = null, history = [], nudge = false, refusePast = false }) {
  const at = slot ?? occasion?.slot ?? 'day';
  const [win] = await tripWindows(place, dateISO, dateISO, { slots: [at], refusePast });
  if (!win) return null;
  return { window: win, ranked: rank(frags, win, at, { occasion, history, todayISO: dateISO, nudge }) };
}

/**
 * The trip-wide occasion a window takes (a work trip's Office), or its own
 * event's: the occasion goes on every window of `slot`, else of its own slot.
 */
export function tripOccasion(occasion, slot = null) {
  return win => win.occasion ?? (occasion && win.slot === (slot ?? occasion.slot) ? occasion : null);
}

/**
 * packTrip for a place and dates: fetches the windows (forecast, then typical
 * weather; only `slots`' when given), puts the events on them and packs, with
 * a trip-wide `occasion` on its slot's windows that have no event.
 */
export async function tripPlan(frags, { place, fromISO, toISO, events = [], max = 3, occasion = null, slots }) {
  const windows = withEvents(await tripWindows(place, fromISO, toISO, slots && { slots }), events);
  return { windows, ...packTrip(frags, windows, { max, occasionOf: tripOccasion(occasion, slots?.length === 1 ? slots[0] : null) }) };
}
