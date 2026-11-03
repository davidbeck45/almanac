// The app's one state object and what's derived from it: which bottles are
// ranked, the ranked contexts bottle pages read, prefs, and finding bottles
// in the dataset. No DOM here, so views and tests import it in Node; the
// shell (src/app/shell.js) renders and handles events.
import { rank, rankEvent, planWindows } from '../engine.js';
import { planTies, TIE_POINTS } from '../contrast.js';
import { week, wxAt, standIn, cachedForecast, forecastError, clock, placeClock, windowOpen } from '../weather.js';
import { loadLocation } from '../location.js';
import { loadHistory, wornIn, journalStats, journalCalendar, occasionCounts } from '../history.js';
import { loadHidden, hiddenFor } from '../hidden.js';
import { applySkin, loadSkin, skinStamp } from '../skin.js';
import { loadEvents, setEvent as storeEvent, eventOn, withStoredEvents } from '../events.js';
import { loadMine, saveMine, loadActive, saveActive, localMatches } from '../collections.js';
import { fragranticaLibrary } from '../fragrantica.js';
import { onPoolRecords } from './pool.js';
import { setHidden } from '../hidden.js';
import { setUnits, matchPct } from '../ui.js';
import { setTheme } from '../theme.js';

const PREFS_KEY = 'scentcast.prefs';
const DUSTY_AFTER_DAYS = 30;
// Countries that read temperatures in °F.
const FAHRENHEIT_REGIONS = ['US', 'LR', 'MM', 'BS', 'BZ', 'KY', 'PW', 'FM', 'MH'];

export function loadPrefs() {
  try {
    const prefs = JSON.parse(localStorage.getItem(PREFS_KEY));
    return prefs && typeof prefs === 'object' && !Array.isArray(prefs) ? prefs : {};
  } catch {
    return {};
  }
}

// The prefs as this tab holds them, in the shape they're stored.
const prefsHeld = () => ({
  occasion: state.occasion, units: state.units, theme: savedTheme ?? undefined, preferValue: state.preferValue, likedStyles: state.likedStyles,
  stillSky: state.stillSky || undefined,
});
// The prefs this tab last read or saved. Another open tab saves its own, so
// a save writes only what changed here since over what's stored: a style
// liked there and a theme picked here both stay.
let prefsSeen = {};

export function savePrefs() {
  const held = prefsHeld();
  const next = loadPrefs();
  for (const [key, value] of Object.entries(held)) {
    if (JSON.stringify(value) !== JSON.stringify(prefsSeen[key])) next[key] = value;
  }
  prefsSeen = held;
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch {}
}

// What the state takes from stored prefs: at load, and again when another
// tab saves them (reloadStored).
function fromPrefs(prefs) {
  return {
    units: prefs.units === 'C' || prefs.units === 'F' ? prefs.units : defaultUnits(),
    occasion: prefs.occasion ?? 'casual',
    preferValue: typeof prefs.preferValue === 'boolean' ? prefs.preferValue : null,
    likedStyles: Array.isArray(prefs.likedStyles) ? prefs.likedStyles.filter(s => typeof s === 'string') : null,
    stillSky: prefs.stillSky === true,
  };
}

// The theme Settings saved, apart from the one showing: a link's ?theme=
// shows its theme for the visit without becoming the device's.
let savedTheme = null;
/** Settings › Theme: show it and save it. */
export function chooseTheme(name) {
  savedTheme = setTheme(name);
  savePrefs();
}

function defaultUnits() {
  const [lang, region] = (globalThis.navigator?.language || 'en-US').split('-');
  if (!region) return lang === 'en' ? 'F' : 'C';
  return FAHRENHEIT_REGIONS.includes(region.toUpperCase()) ? 'F' : 'C';
}

const prefs = loadPrefs();
const stored = fromPrefs(prefs);
export const state = {
  demo: null, // { fetched, fragrances } from data/collection.json
  catalog: [], // data/catalog.json: other people's bottles, scraped with Parfumo's ratings
  mine: loadMine(), // { name, records }
  active: loadActive(), // 'demo' | 'mine'
  shared: null, // { name, ids, records, missing, loading } from a ?c= link
  loc: loadLocation(),
  forecast: null, // the forecast in hand for state.loc
  wx: null, // it read for the hour it is (src/weather.js wxAt): what every pane shows
  loading: false,
  updating: false, // a cached forecast is on screen while a fresh one loads
  slow: false, // nothing on screen yet, and the forecast is slow to answer
  error: null,
  route: null, // the parsed route on screen (src/app/router.js)
  base: null, // the page under a bottle page: the last route that wasn't one
  from: null, // the route before the page under it last changed (a bottle page: the compare page's Back goes there)
  units: stored.units,
  occasion: stored.occasion,
  occasionSlot: null,
  slot: null, // the window picked with Now's Day/Night toggle, { slot, dateISO }; null = the next one
  history: loadHistory(),
  events: loadEvents(), // what a day or night at home is for, set on the Occasion pane (src/events.js)
  hiding: loadHidden(), // { hidden, shown }: this device's hides and the defaults it switched on (src/hidden.js)
  // ctx key -> { win, occasion, ranked, entries: Map(id -> ranked entry) }.
  // No prototype: the key comes from the URL (?ctx=constructor finds nothing).
  contexts: Object.create(null),
  today: null, // { day: plan, night: plan } where plan = { win, ranked, pick }
  ahead: [], // the plans of the week's events after today's windows, which Now's plan holds bottles for
  after: null, // the plan of the window after today's (not an event), for today's ties
  bottles: new Map(), // dataset records loaded for bottle pages, and every one a pool answer names (keepBottles), by id
  about: new Map(), // id -> loadAbout() result (null: none), for bottle pages
  // Ids whose about data couldn't load (offline): the bottle page says so,
  // with Try again (the shell's retryBottle clears it, as coming back online does).
  aboutFailed: new Set(),
  // "Prefer great value" as set (true / false; setPreferValue), or null for the
  // wardrobe's default. Pool questions send it (poolInputs).
  preferValue: stored.preferValue,
  // The scent styles someone says they like (style ids, src/scent-styles.js),
  // picked on Insights' style mix; [] when they unpicked every one; null
  // until they pick, when David's wardrobe starts on DEMO_LIKED and anyone
  // else's on what most of its bottles lean toward (likedStyles in
  // src/discover.js). setLikedStyles.
  likedStyles: stored.likedStyles,
  // Settings › Animate the sky switched off: the weather scene holds still
  // (the shell sets .still-sky on <html>; base.css).
  stillSky: stored.stillSky,
  // Discover's search: `draft` is the field as typed, `query` what was last
  // searched; `offline` the library's error when only local matches came back.
  discover: { draft: null, query: '', results: null, busy: false, error: '', offline: '' },
  // A destructive button waiting for its second tap ('journal-clear',
  // 'shared-save'); the shell disarms it whenever the page changes.
  armed: null,
  sheet: null, // an open overlay sheet: { kind: a key of the shell's SHEETS, ...sheet state }
  lastRemoved: null, // { record, index } for undo
};
setUnits(state.units);
const shownTheme = setTheme(prefs.theme);
savedTheme = typeof prefs.theme === 'string' ? shownTheme : null;
prefsSeen = prefsHeld();

// ---------- Collections ----------

export function sourceRecords() {
  if (state.shared) return state.shared.records;
  if (state.active === 'mine') return state.mine.records;
  return state.demo?.fragrances ?? [];
}

// The hidden set as it applies to the demo, or to someone's own or shared
// list, where DEFAULT_HIDDEN doesn't reach (src/hidden.js).
export const hiddenIn = isDemo => hiddenFor(state.hiding, isDemo);
export const viewingDemo = () => !state.shared && state.active === 'demo';

export function activeFragrances() {
  const hidden = hiddenIn(viewingDemo());
  return sourceRecords().filter(f => !hidden.has(f.id));
}

// What every ranking reads (Now, the Week, Occasion, trips and events): the
// bottles switched on, with your own stars and skin nudges (src/skin.js)
// attached as `personal`, so a 1★ bottle sits out and one that lasts longer
// on you counts so. Cached until the list, its switches or the saved
// ratings change: the bottle page's "On my skin" saves them and renders, and
// the next call sees it. The pool's questions get them too (poolInputs), so
// the gap finder scores owned bottles with your stars and a bottle you rate
// 2★ or lower covers nothing there.
let skinned = { key: null, stamp: null, all: [], hidden: null, out: [] };
export function rankedFragrances() {
  const records = sourceRecords(), stamp = skinStamp();
  // Ids, not the array: Mine's remove and undo splice it in place.
  const key = records.map(f => f.id).join('\n');
  if (skinned.key !== key || skinned.stamp !== stamp || skinned.records !== records) {
    skinned = { key, stamp, records, all: applySkin(records, loadSkin()), hidden: null, out: [] };
  }
  const hidden = hiddenIn(viewingDemo());
  const off = [...hidden].sort().join('\n');
  if (skinned.hidden !== off) Object.assign(skinned, { hidden: off, out: skinned.all.filter(f => !hidden.has(f.id)) });
  return skinned.out;
}

export const isActive = id => activeFragrances().some(f => f.id === id);
export const inSource = id => sourceRecords().some(f => f.id === id);

export function collectionLabel() {
  if (state.shared) return state.shared.name ? `${state.shared.name}’s collection` : 'Shared collection';
  return state.active === 'mine' ? 'My collection' : 'David’s wardrobe';
}

// Bottles we scraped ourselves, searched before the rest of Fragrantica.
export function knownBottles() {
  return [...(state.demo?.fragrances ?? []), ...state.catalog];
}

// Which list already has a bottle: the one being ranked ('demo', 'mine' or
// 'shared'), else 'mine' when it's in Mine, else null.
export function ownedIn(id) {
  if (inSource(id)) return state.shared ? 'shared' : state.active;
  return state.mine.records.some(f => f.id === id) ? 'mine' : null;
}

export function findRecord(id) {
  return [...sourceRecords(), ...state.mine.records, ...knownBottles()].find(f => f.id === id) ?? state.bottles.get(id) ?? null;
}

// Switching lists closes a shared one; the shell drops it from the URL.
export function setActive(active) {
  state.active = active;
  saveActive(active);
}

/**
 * Changes Mine as it's stored now, and saves it: another open tab may have
 * changed it since this one read it, and saving this tab's copy over it
 * would undo that. `change(mine)` edits it in place.
 */
export function updateMine(change) {
  state.mine = loadMine();
  change(state.mine);
  saveMine(state.mine);
}

// -> whether it's new to Mine.
export function addToMine(record) {
  let added = false;
  updateMine(mine => {
    added = !mine.records.some(r => r.id === record.id);
    if (added) mine.records = [...mine.records, record];
  });
  setHidden(state.hiding, record.id, false, false);
  if (state.active !== 'mine') setActive('mine');
  return added;
}

// ---------- Ranked contexts ----------
// Every list of bottles stores the ranking it shows under a context key, and
// a bottle page reads its entry from there (`#/bottle/<id>?ctx=<key>`). Keys:
// 'day' and 'night' (Now), 'occ' (Occasion), 'w:<dateISO>:<slot>' (Week).
// A window planned for an event carries its occasion, so a wear logged from
// it counts for that use, and `event` (ranked as rankEvent ranks one). Now's,
// the Week's and the Occasion pane's carry their `pick` (a plan's needn't be
// ranked[0]), which a bottle page measures itself against; a trip's packs
// from its own bottles and carries none. The Week's carry its `ties` too
// (planTies'), which lead the pick's page's shelf, since its board names them
// without a link. A list ranked for somewhere other than home (a trip, the
// Occasion pane's other city) carries its `place`, where a wear logged from
// it happened.

const SLOT_ORDER = { day: 0, night: 1 };
export const byTime = (a, b) => a.dateISO.localeCompare(b.dateISO) || SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot];

export function storeContext(key, win, occasion, ranked, { event = Boolean(win.occasion), pick = null, ties = [], place = null } = {}) {
  state.contexts[key] = { win, occasion, ranked, event, pick, ties, place, entries: new Map(ranked.map(r => [r.fragrance.id, r])) };
}

// Rankings put a bottle left on the shelf a month first when it's within
// reach of the top (the engine's rotation nudge: "Not worn in 34 days").
// Only for a window you're about to wear in: `nudge: false` for a later date
// or another place, where the journal can't say what's idle then. A window
// planned for this occasion (`event`) ranks as the plan ranks it (rankEvent:
// the best for it, recent wears or not), so the two agree. `place`: where
// the window is, when it isn't home.
export function rankContext(key, win, occasion, { nudge = true, event = false, place = null } = {}) {
  const ranked = event ? rankEvent(rankedFragrances(), win, occasion)
    : rank(rankedFragrances(), win, win.slot, { occasion, history: state.history, todayISO: win.dateISO, nudge });
  storeContext(key, win, occasion, ranked, { event, pick: ranked[0] ?? null, place });
  return ranked;
}

// ---------- Events ----------

/** The stored event on a window at home ({ dateISO, slot }), or null. */
export const eventAt = win => eventOn(state.events, win);

/** Sets what a window at home is for (an occasion id), or clears it (null). Now and the Week plan around it. */
export function setEvent(dateISO, slot, occasion) {
  state.events = storeEvent(dateISO, slot, occasion, todayISO());
}

// The week's windows with the stored events on them, read when state.wx was.
const weekWindows = () => withStoredEvents(week(state.forecast, state.wx?.at).flatMap(d => [d.day, d.night].filter(Boolean)), state.events);

// Today's day and night are planned together, so the evening pick doesn't
// repeat the daytime one and a logged wear becomes that window's pick. The
// week's events are planned with them (each event first, and its bottle left
// be before it), so Now and the Week agree about today. So is the window
// after today's (`state.after`, unless it's an event, which `ahead` has):
// it's never shown, but planTies leaves its pick out of the last window's
// ties, as the Week does, so the two name the same ones. A later window
// can't change an earlier one's pick (planWindows goes in time order).
export function computeToday() {
  if (!state.wx || !rankedFragrances().length) {
    state.today = null;
    state.ahead = [];
    state.after = null;
    return;
  }
  const today = withStoredEvents([state.wx.day, state.wx.night].filter(Boolean).sort(byTime), state.events);
  const last = today.at(-1);
  const later = last && state.forecast ? weekWindows().filter(w => byTime(w, last) > 0) : [];
  const ahead = state.events.length ? later.filter(w => w.occasion) : [];
  const after = later[0] && !later[0].occasion ? [later[0]] : [];
  const plan = planWindows(rankedFragrances(), [...today, ...after, ...ahead], { history: state.history, nudge: true, nowISO: todayISO() });
  state.after = after.length ? plan[today.length] : null;
  state.ahead = plan.slice(today.length + after.length);
  state.today = {};
  for (const p of plan.slice(0, today.length)) {
    storeContext(p.win.slot, p.win, p.win.occasion ?? null, p.ranked, { pick: p.pick });
    state.today[p.win.slot] = p;
  }
}

// Today's windows in time order (tonight comes before tomorrow's daytime).
export function todaySlots() {
  return state.today ? Object.values(state.today).sort((a, b) => byTime(a.win, b.win)) : [];
}

// Today's windows, the one after them and the week's events, in time order
// as Now planned them (for planTies: read only today's windows' ties).
export const todayPlan = () => (state.today ? [...todaySlots(), ...(state.after ? [state.after] : []), ...state.ahead] : []);

// The window Now shows: the one picked with the Day/Night toggle while it's
// still one of today's (Day picked this morning doesn't open tomorrow's
// daytime at 6 pm), else the next.
export function nowSlot() {
  const slots = todaySlots();
  const picked = state.slot;
  return slots.find(p => p.win.slot === picked?.slot && p.win.dateISO === picked.dateISO) ?? slots[0] ?? null;
}

export function computeWeek() {
  const days = week(state.forecast, state.wx?.at);
  const windows = withStoredEvents(days.flatMap(d => [d.day, d.night].filter(Boolean)), state.events);
  const plan = planWindows(rankedFragrances(), windows, { history: state.history, nudge: true, nowISO: todayISO() });
  // Each window's toss-ups (src/contrast.js planTies), today's the same as
  // Now's: it plans the window after today's too (computeToday).
  const ties = planTies(plan, { history: state.history });
  const byWindow = new Map(plan.map((p, i) => [`${p.win.dateISO}:${p.win.slot}`, { ...p, ties: ties[i] }]));
  const slotPlan = win => {
    if (!win) return null;
    const p = byWindow.get(`${win.dateISO}:${win.slot}`);
    const ctx = `w:${win.dateISO}:${win.slot}`;
    storeContext(ctx, p.win, p.win.occasion ?? null, p.ranked, { pick: p.pick, ties: p.ties.map(t => t.entry) });
    return { ...p, ctx, worn: wornIn(state.history, win.dateISO, win.slot)?.id === p.pick.fragrance.id };
  };
  return days.map(d => ({ ...d, day: slotPlan(d.day), night: slotPlan(d.night) }));
}

// ---------- The forecast and the clock ----------
// Every pane shows the forecast in hand read for the hour it is (state.wx,
// src/weather.js wxAt), read again when a forecast lands, on the hour while
// the page is visible and on coming back to it (src/app/shell.js says when):
// a page left open overnight never shows last night's windows. The Week and
// the Occasion pane read it at the same moment (`state.wx.at`), so they
// agree with Now about which windows are left.

/** Whether two places are the same spot (a forecast is asked for by its coordinates). */
export const samePlace = (a, b) => a?.lat === b?.lat && a?.lon === b?.lon;

const placeHour = (forecast, ms) => Math.floor((ms + forecast.utc_offset_seconds * 1000) / 3_600_000);

/** Whether the hour at the place has turned since state.wx was read. */
export const hourTurned = (nowMs = Date.now()) =>
  Boolean(state.forecast && state.wx) && placeHour(state.forecast, state.wx.at) !== placeHour(state.forecast, nowMs);

/**
 * Reads the forecast in hand again once the hour has turned: -> whether it
 * did. One too old to show any more stays as it was until a new one lands
 * (the shell asks for it).
 */
export function readClock(nowMs = Date.now()) {
  if (!hourTurned(nowMs)) return false;
  const wx = wxAt(state.forecast, nowMs);
  if (wx) state.wx = wx;
  return Boolean(wx);
}

/**
 * Before a forecast is asked for: the one in hand or, newer, the one saved on
 * the device (another tab can have fetched it since), read for now, so it
 * shows at once while the new one loads; nothing past what it can show
 * (wxAt). -> true when it's fresh enough not to ask (cachedForecast).
 */
export function showSaved(nowMs = Date.now()) {
  const saved = state.loc ? cachedForecast(state.loc, nowMs) : null;
  if (saved && !(state.forecast?.fetchedAt > saved.forecast.fetchedAt)) state.forecast = saved.forecast;
  state.wx = wxAt(state.forecast, nowMs);
  return Boolean(state.wx && saved?.fresh && state.forecast === saved.forecast);
}

/**
 * A forecast request's answer for `loc`, { forecast } or { error }, onto the
 * state: the forecast read for now; failed, the one in hand standing in
 * while it still covers today (standIn), else the error to show. An answer
 * for a place picked over since, which asked for its own, changes nothing:
 * -> false.
 */
export function takeForecast(loc, { forecast = null, error = null }, nowMs = Date.now()) {
  if (!samePlace(state.loc, loc)) return false;
  Object.assign(state, { loading: false, updating: false, slow: false, error: null });
  state.forecast = forecast ?? standIn(state.forecast, error, nowMs);
  state.wx = wxAt(state.forecast, nowMs);
  if (!state.wx) state.error = error ? forecastError(error) : 'The forecast came back without today. Try again.';
  return true;
}

// Wear logging is for today's two windows, dated today, until each is over:
// once the day window has rolled over at night, Now's Day shows tomorrow's,
// which can only be worn tomorrow (and Worn would hide a wear dated ahead).
// It reads the clock, not the forecast as last read, so a window that ended
// since the page was drawn takes no wear. The clock is the window's own
// place's: home's forecast's, or for a list ranked somewhere else (a trip,
// the Occasion pane's other city: its context's `place`) that place's, whose
// day its windows are dated in (src/weather.js placeClock).
export function canWear(win, place = null, nowMs = Date.now()) {
  if (place) return windowOpen(win, placeClock(place, nowMs));
  return Boolean(state.forecast && state.wx) && windowOpen(win, clock(state.forecast, nowMs));
}

export const wornId = win => wornIn(state.history, win.dateISO, win.slot)?.id ?? null;

// The hour at the place when the forecast was read (windows say "Now–5p").
export function nowHour() {
  const offset = state.forecast?.utc_offset_seconds ?? 0;
  return new Date((state.wx?.at ?? Date.now()) + offset * 1000).getUTCHours();
}

// The place's date once its forecast is in, else the device's (not UTC's,
// a day ahead by evening in the Americas).
export const deviceToday = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const todayISO = () => state.wx?.todayISO ?? deviceToday();

// ---------- Wear journal ----------

export function wearInfo(id) {
  if (!state.wx) return null;
  const stats = journalStats(state.history.filter(h => h.id === id), state.wx.todayISO);
  return { count: stats.wears, last: stats.lastWorn.get(id) ?? null };
}

/**
 * When this week a bottle would suit, from the Week's own plan (computeWeek's
 * days): { kind: 'planned', win, ctx } for the first window it's the pick
 * of, else { kind: 'suits', … } for the first whose pick it comes within
 * TIE_POINTS of (its displayed match, as toss-ups count) and that has no
 * wear logged (the choice is made), else { kind: 'none' }: this week's
 * weather isn't its.
 */
export function dustWhen(id, days) {
  const windows = days.flatMap(d => [d.day, d.night]).filter(Boolean);
  const at = (kind, p) => ({ kind, win: p.win, ctx: p.ctx });
  const planned = windows.find(p => p.pick.fragrance.id === id);
  if (planned) return at('planned', planned);
  const suits = windows.find(p => {
    const entry = !wornIn(state.history, p.win.dateISO, p.win.slot) && p.ranked.find(r => r.fragrance.id === id);
    return entry && matchPct(p.pick) - matchPct(entry) <= TIE_POINTS;
  });
  return suits ? at('suits', suits) : { kind: 'none' };
}

// Gathering dust says when this week each idle bottle would suit
// (`when`, dustWhen), once the forecast is in; null before.
export function journalData() {
  const today = todayISO();
  const stats = journalStats(state.history, today, DUSTY_AFTER_DAYS);
  const dusty = activeFragrances()
    .map(f => ({ f, last: stats.lastWorn.get(f.id) ?? null }))
    .filter(d => !d.last || d.last < stats.since)
    .sort((a, b) => (a.last ?? '').localeCompare(b.last ?? ''))
    .slice(0, 6);
  const days = dusty.length && state.forecast && state.wx ? computeWeek() : null;
  return {
    stats,
    dusty: dusty.map(d => ({ ...d, when: days ? dustWhen(d.f.id, days) : null })),
    todayISO: today,
    calendar: journalCalendar(state.history, today, 5),
  };
}

// ---------- Finding bottles ----------

// Every Fragrantica perfume (data/fragrantica/), loaded a file at a time.
export const library = fragranticaLibrary();
const MAX_RESULTS = 10;

// Boot resolves this once the wardrobe and catalog are in (or failed), so a
// search that starts first (a #/discover?q= link) still finds them.
let bottlesIn;
const bottlesLoaded = new Promise(resolve => { bottlesIn = resolve; });
export const markBottlesLoaded = () => bottlesIn();

/**
 * David's wardrobe (data/collection.json) and the catalog, into the state.
 * Rejects when the wardrobe doesn't load: offline with nothing saved, or the
 * server failing, whose error page isn't the wardrobe. Without the catalog,
 * search only misses its bottles. index.html preloads both with the same
 * request, so these fetches take the preloaded answers.
 */
export async function loadBottles() {
  const json = res => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };
  const [demo, catalog] = await Promise.all([
    fetch('data/collection.json').then(json),
    fetch('data/catalog.json').then(json).catch(() => ({ fragrances: [] })),
  ]);
  for (const f of [...demo.fragrances, ...catalog.fragrances]) f.id = String(f.id);
  state.demo = demo;
  state.catalog = catalog.fragrances;
}

// Matches from the demo and the catalog come first (scraped with Parfumo's
// ratings), then the rest of Fragrantica as light records ({ stub: true });
// `fullRecords` loads the ones that get added. When the library can't be
// reached (offline), the local matches still come back, with its error:
// { results, error }.
export async function findBottles(query, limit = MAX_RESULTS) {
  await bottlesLoaded;
  const local = localMatches(query, knownBottles());
  const ids = new Set(local.map(r => r.id));
  let rest = [], error = '';
  try {
    rest = (await library.search(query, limit)).filter(r => !ids.has(r.id));
  } catch (err) {
    error = err.message;
  }
  return { results: [...local, ...rest].slice(0, limit), error };
}

export async function fullRecords(list) {
  const stubs = list.filter(r => r.stub).map(r => r.id);
  const loaded = stubs.length ? await library.records(stubs) : new Map();
  return list.map(r => (r.stub ? loaded.get(r.id) : r)).filter(Boolean);
}

// Dataset records the pool client's answers name (src/app/pool.js), kept so
// findRecord and the bottle page open them at once. A pool record carries
// its signals (`extras`) but only its 8 strongest notes, an r/ record every
// note: a bottle seen both ways keeps the r/ record with the pool's extras.
export function keepBottles(records) {
  for (const r of records) {
    const id = String(r.id), old = state.bottles.get(id);
    if (!old) state.bottles.set(id, r);
    else if (r.extras && !old.extras) state.bottles.set(id, { ...old, extras: r.extras });
    else if (!r.extras && old.extras) state.bottles.set(id, { ...r, extras: old.extras });
  }
}
onPoolRecords(keepBottles);

/**
 * A dataset bottle's r/ record (every note) kept, with its pool extras when
 * an answer brought those: for a bottle page open on a pool record. -> the
 * kept record, or null when the dataset has none. Rejects offline.
 */
export async function loadFullRecord(id) {
  const found = (await library.records([String(id)])).get(String(id));
  if (found) keepBottles([found]);
  return state.bottles.get(String(id)) ?? null;
}

// ---------- Asking the pool ----------

// "Prefer great value" on or off (null: the wardrobe's default, on when its
// median value is 3.8 or more), saved in prefs. Answers that suggest bottles
// say which they used (`preferValue`), so the toggle can show it.
export function setPreferValue(on) {
  state.preferValue = typeof on === 'boolean' ? on : null;
  savePrefs();
}

// Animate the sky (Settings), saved in prefs; the class holds the scene still.
export function setStillSky(on) {
  state.stillSky = Boolean(on);
  globalThis.document?.documentElement.classList.toggle('still-sky', state.stillSky);
  savePrefs();
}

// The styles someone likes, saved in prefs: an empty list means none, null
// goes back to the default (state.likedStyles).
export function setLikedStyles(ids) {
  state.likedStyles = Array.isArray(ids) ? [...new Set(ids.map(String))] : null;
  savePrefs();
}

// The place's climate summary for the gap finder (src/climate.js keeps it
// on the device per place), or null for the default climate: with no place
// set, or while the archive can't be reached. A failed ask is remembered for
// CLIMATE_RETRY_MS (or until the browser comes back online, retryClimate),
// so every pool question meanwhile doesn't ask a failing service again.
const CLIMATE_RETRY_MS = 10 * 60 * 1000;
let climate = null; // { key, summary: promise, failedAt }
export function localClimate(nowMs = Date.now()) {
  const { lat, lon } = state.loc ?? {};
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return Promise.resolve(null);
  const key = `${lat},${lon}`;
  if (climate?.key === key && climate.failedAt != null && nowMs - climate.failedAt >= CLIMATE_RETRY_MS) climate = null;
  if (climate?.key !== key) {
    const summary = import('../climate.js')
      .then(({ fetchClimate }) => fetchClimate(lat, lon))
      .then(c => (c.local ? c.summary : null), () => null);
    const asked = { key, summary, failedAt: null };
    climate = asked;
    summary.then(s => { if (!s) asked.failedAt = Date.now(); });
  }
  return climate.summary;
}

/** Forget a failed climate ask (back online), so the next question asks again. */
export function retryClimate() {
  if (climate?.failedAt != null) climate = null;
}

/**
 * What every question to the pool (src/app/pool.js) says about whoever is
 * asking; spread it into the payload, so Insights, buy checks and Discover
 * agree: `owned` (the ranked list, switched on, with your stars:
 * rankedFragrances), `exclude` (its bottles
 * switched off: they cover nothing, but are never suggested back),
 * `summary` (localClimate), `shares` ("How you wear" with the journal's
 * occasions, src/uses.js) and `preferValue`. The first time at a place it
 * waits for the place's climate (one archive call); after that, at once.
 */
export async function poolInputs() {
  const [{ loadUses, sharesFrom }, summary] = await Promise.all([import('../uses.js'), localClimate()]);
  const hidden = hiddenIn(viewingDemo());
  return {
    owned: rankedFragrances(),
    exclude: sourceRecords().filter(f => hidden.has(f.id)),
    summary,
    shares: sharesFrom(loadUses(), occasionCounts(state.history)),
    preferValue: state.preferValue,
  };
}

// ---------- Another tab ----------
// Every open tab shares localStorage. Each change starts from what's stored
// (updateMine, setHidden, savePrefs, and the journal, plans, ratings and
// wants as they save), so one tab never saves its old copy over another's
// change; and when another tab saves, the shell reads it all again here.

// Prefs saved by another tab, into this one: the theme only when the one
// saved changed, so a link's ?theme= keeps showing for its visit.
function applyPrefs(prefs) {
  Object.assign(state, fromPrefs(prefs));
  setUnits(state.units);
  if (typeof prefs.theme === 'string' && prefs.theme !== savedTheme) savedTheme = setTheme(prefs.theme);
  globalThis.document?.documentElement.classList.toggle('still-sky', state.stillSky);
  prefsSeen = prefsHeld();
}

/**
 * Reads again what another tab may have saved (the shell calls it on a
 * storage event): Mine, the switched-off bottles, the journal, plans and
 * prefs. Ratings, wants and "How you wear" are read as they're drawn.
 */
export function reloadStored() {
  state.mine = loadMine();
  state.hiding = loadHidden();
  state.history = loadHistory();
  state.events = loadEvents();
  applyPrefs(loadPrefs());
}
