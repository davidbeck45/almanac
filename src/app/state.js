// The app's one state object and what's derived from it: which bottles are
// ranked, the ranked contexts bottle pages read, prefs, and finding bottles
// in the dataset. No DOM here, so views and tests import it in Node; the
// shell (src/app/shell.js) renders and handles events.
import { rank, planWindows } from '../engine.js';
import { week } from '../weather.js';
import { loadLocation } from '../location.js';
import { loadHistory, wornIn, journalStats, journalCalendar } from '../history.js';
import { loadHidden, hiddenFor } from '../hidden.js';
import { loadMine, saveMine, loadActive, saveActive, localMatches } from '../collections.js';
import { fragranticaLibrary } from '../fragrantica.js';
import { onPoolRecords } from './pool.js';
import { setHidden } from '../hidden.js';
import { setUnits } from '../ui.js';
import { setTheme, theme } from '../theme.js';

const PREFS_KEY = 'scentcast.prefs';
const DUSTY_AFTER_DAYS = 30;
// Countries that read temperatures in °F.
const FAHRENHEIT_REGIONS = ['US', 'LR', 'MM', 'BS', 'BZ', 'KY', 'PW', 'FM', 'MH'];

export function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY)) ?? {}; } catch { return {}; }
}

export function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ occasion: state.occasion, units: state.units, theme: theme() })); } catch {}
}

function defaultUnits() {
  const [lang, region] = (globalThis.navigator?.language || 'en-US').split('-');
  if (!region) return lang === 'en' ? 'F' : 'C';
  return FAHRENHEIT_REGIONS.includes(region.toUpperCase()) ? 'F' : 'C';
}

const prefs = loadPrefs();
export const state = {
  demo: null, // { fetched, fragrances } from data/collection.json
  catalog: [], // data/catalog.json: other people's bottles, scraped with Parfumo's ratings
  mine: loadMine(), // { name, records }
  active: loadActive(), // 'demo' | 'mine'
  shared: null, // { name, ids, records, missing, loading } from a ?c= link
  loc: loadLocation(),
  forecast: null,
  wx: null,
  loading: false,
  updating: false, // a cached forecast is on screen while a fresh one loads
  error: null,
  route: null, // the parsed route on screen (src/app/router.js)
  base: null, // the page under a bottle page: the last route that wasn't one
  units: prefs.units === 'C' || prefs.units === 'F' ? prefs.units : defaultUnits(),
  occasion: prefs.occasion ?? 'casual',
  occasionSlot: null,
  slot: null, // the window Now shows ('day' | 'night'); null = the next one
  history: loadHistory(),
  hiding: loadHidden(), // { hidden, shown }: this device's hides and the defaults it switched on (src/hidden.js)
  contexts: {}, // ctx key -> { win, occasion, ranked, entries: Map(id -> ranked entry) }
  today: null, // { day: plan, night: plan } where plan = { win, ranked, pick }
  bottles: new Map(), // dataset records loaded for bottle pages, and every one a pool answer names (keepBottles), by id
  about: new Map(), // id -> loadAbout() result (null: none), for bottle pages
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
setTheme(prefs.theme);

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

export function addToMine(record) {
  if (!state.mine.records.some(r => r.id === record.id)) {
    state.mine.records = [...state.mine.records, record];
    saveMine(state.mine);
  }
  if (state.hiding.hidden.has(record.id)) setHidden(state.hiding, record.id, false, false);
  if (state.active !== 'mine') setActive('mine');
}

// ---------- Ranked contexts ----------
// Every list of bottles stores the ranking it shows under a context key, and
// a bottle page reads its entry from there (`#/bottle/<id>?ctx=<key>`). Keys:
// 'day' and 'night' (Now), 'occ' (Occasion), 'w:<dateISO>:<slot>' (Week).

const SLOT_ORDER = { day: 0, night: 1 };
export const byTime = (a, b) => a.dateISO.localeCompare(b.dateISO) || SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot];

export function storeContext(key, win, occasion, ranked) {
  state.contexts[key] = { win, occasion, ranked, entries: new Map(ranked.map(r => [r.fragrance.id, r])) };
}

export function rankContext(key, win, occasion) {
  const ranked = rank(activeFragrances(), win, win.slot, { occasion, history: state.history, todayISO: win.dateISO });
  storeContext(key, win, occasion, ranked);
  return ranked;
}

// Today's day and night are planned together, so the evening pick doesn't
// repeat the daytime one and a logged wear becomes that window's pick.
export function computeToday() {
  if (!state.wx || !activeFragrances().length) {
    state.today = null;
    return;
  }
  const plan = planWindows(activeFragrances(), [state.wx.day, state.wx.night].filter(Boolean).sort(byTime), { history: state.history });
  state.today = {};
  for (const p of plan) {
    storeContext(p.win.slot, p.win, null, p.ranked);
    state.today[p.win.slot] = p;
  }
}

// Today's windows in time order (tonight comes before tomorrow's daytime).
export function todaySlots() {
  return state.today ? Object.values(state.today).sort((a, b) => byTime(a.win, b.win)) : [];
}

// The window Now shows: the one picked with the Day/Night toggle, else the next.
export function nowSlot() {
  const slots = todaySlots();
  return slots.find(p => p.win.slot === state.slot) ?? slots[0] ?? null;
}

export function computeWeek() {
  const days = week(state.forecast);
  const windows = days.flatMap(d => [d.day, d.night].filter(Boolean));
  const plan = planWindows(activeFragrances(), windows, { history: state.history });
  const byWindow = new Map(plan.map(p => [`${p.win.dateISO}:${p.win.slot}`, p]));
  const slotPlan = win => {
    if (!win) return null;
    const p = byWindow.get(`${win.dateISO}:${win.slot}`);
    const ctx = `w:${win.dateISO}:${win.slot}`;
    storeContext(ctx, win, null, p.ranked);
    return { ...p, ctx, worn: wornIn(state.history, win.dateISO, win.slot)?.id === p.pick.fragrance.id };
  };
  return days.map(d => ({ ...d, day: slotPlan(d.day), night: slotPlan(d.night) }));
}

// Wear logging is for today's two windows, not days further out.
export function canWear(win) {
  return Boolean(state.wx) && [state.wx.day, state.wx.night].some(w => w && w.dateISO === win.dateISO && w.slot === win.slot);
}

export const wornId = win => wornIn(state.history, win.dateISO, win.slot)?.id ?? null;

export function nowHour() {
  const offset = state.forecast?.utc_offset_seconds ?? 0;
  return new Date(Date.now() + offset * 1000).getUTCHours();
}

export const todayISO = () => state.wx?.todayISO ?? new Date().toISOString().slice(0, 10);

// ---------- Wear journal ----------

export function wearInfo(id) {
  if (!state.wx) return null;
  const stats = journalStats(state.history.filter(h => h.id === id), state.wx.todayISO);
  return { count: stats.wears, last: stats.lastWorn.get(id) ?? null };
}

export function journalData() {
  const today = todayISO();
  const stats = journalStats(state.history, today, DUSTY_AFTER_DAYS);
  const dusty = activeFragrances()
    .map(f => ({ f, last: stats.lastWorn.get(f.id) ?? null }))
    .filter(d => !d.last || d.last < stats.since)
    .sort((a, b) => (a.last ?? '').localeCompare(b.last ?? ''))
    .slice(0, 6);
  return { stats, dusty, todayISO: today, calendar: journalCalendar(state.history, today, 5) };
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
