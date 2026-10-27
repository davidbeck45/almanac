#!/usr/bin/env node
// Everything the Omarchy bar widget shows, as one JSON object on stdout.
//   node omarchy/widget.mjs [--location "Grapevine, TX" | --location 32.93,-97.08[,Name]] [--hidden "Name,Name"]
//                           [--journal TOKEN|FILE]
// Without --location it follows Omarchy's weather location, then the IP address.
// Without --hidden, DEFAULT_HIDDEN stays off, as on a device that never opened Manage.
// --journal takes the app's Copy for Claude (Wardrobe › Worn) or a file holding
// it or a journal export, read again on every refresh: the plan then rotates
// out recent wears, nudges in neglected bottles and applies the stars and
// switched-off bottles it carries, as the app's Now does. Without one it
// plans without wears, and the payload says so (`journal: null`).
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { planWindows } from '../src/engine.js';
import { planTies, tieLine } from '../src/contrast.js';
import { accordColor } from '../src/accords.js';
import { DEFAULT_HIDDEN } from '../src/hidden.js';
import { readJournal, isJournalToken, journalFreshness } from '../src/history.js';
import { withStoredEvents } from '../src/events.js';
import { occasionById } from '../src/occasions.js';
import { applySkin } from '../src/skin.js';
import { searchCities } from '../src/location.js';
import { fetchForecast, week } from '../src/weather.js';
import { displayReasons, matchPct } from '../src/ui.js';

export const OMARCHY_LOCATION = join(homedir(), '.local/state/omarchy/settings/weather.json');
const COORDS = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*(?:,\s*(.+?))?\s*$/;
const TIMEOUT = 8000;

// "Grapevine, Texas, US": the first part is the city, the rest picks between
// cities that share its name.
async function findCity(text) {
  const [city, ...hints] = text.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const hits = await searchCities(city);
  const matches = h => hints.filter(x => h.region.toLowerCase().includes(x)).length;
  const hit = [...hits].sort((a, b) => matches(b) - matches(a))[0];
  if (!hit) throw new Error(`No city found for "${text}"`);
  return { name: `${hit.name}, ${hit.region}`, lat: hit.lat, lon: hit.lon, country: hit.region.split(', ').at(-1) };
}

function readOmarchyLocation(file) {
  try {
    const { name, latitude, longitude } = JSON.parse(readFileSync(file, 'utf8'));
    return { name: typeof name === 'string' ? name : '', lat: latitude, lon: longitude };
  } catch {
    return null;
  }
}

async function ipCity() {
  const res = await fetch('https://wttr.in/?format=%l', { signal: AbortSignal.timeout(TIMEOUT) });
  const text = res.ok ? (await res.text()).trim() : '';
  if (!text) throw new Error('Couldn’t find your location. Set one in the widget settings.');
  return findCity(text);
}

// A place to forecast: the widget's own setting, else Omarchy's weather
// location (coordinates or a name), else wherever the IP address is.
// Coordinates out of range ("999,999") say so, as the CLI's --loc does.
export async function resolvePlace(setting = '', { stateFile = OMARCHY_LOCATION } = {}) {
  const coords = setting.match(COORDS);
  if (coords) {
    const [lat, lon] = [+coords[1], +coords[2]];
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error('Set a latitude between -90 and 90 and a longitude between -180 and 180.');
    return { name: coords[3] ?? `${coords[1]},${coords[2]}`, lat, lon };
  }
  if (setting.trim()) return findCity(setting);
  const omarchy = readOmarchyLocation(stateFile);
  if (omarchy && Number.isFinite(omarchy.lat) && Number.isFinite(omarchy.lon)) return omarchy;
  if (omarchy?.name) return findCity(omarchy.name);
  return ipCity();
}

// Bottles switched off by id or name. `undefined` means no choice was made.
export function activeBottles(fragrances, hidden = DEFAULT_HIDDEN) {
  const off = new Set(hidden.map(s => String(s).trim().toLowerCase()));
  return fragrances.filter(f => !off.has(String(f.id)) && !off.has(f.name.toLowerCase()));
}

/**
 * The journal setting: a Copy for Claude token, or a path (~ for home) to a
 * file holding one or a journal export. -> parseJournal's shape; throws
 * with a sentence when it can't be read.
 */
export function loadJournal(setting) {
  const text = String(setting).trim();
  if (isJournalToken(text)) return readJournal(text);
  const path = text.replace(/^~(?=\/|$)/, homedir());
  let raw;
  try { raw = readFileSync(path, 'utf8'); } catch { throw new Error(`Can't read the journal file ${text}`); }
  const journal = readJournal(raw);
  if (!journal) throw new Error(`${text} isn't a Scentcast journal export or Copy for Claude`);
  return journal;
}

/**
 * The bottles to plan from: the journal's stars and skin nudges applied,
 * and its switched-off bottles left out with the `hidden` setting's (which
 * alone, unset, means DEFAULT_HIDDEN; with a journal its own list stands in).
 */
export function widgetBottles(fragrances, hidden, journal = null) {
  if (!journal) return activeBottles(fragrances, hidden);
  return activeBottles(applySkin(fragrances, journal.skin), [...(hidden ?? []), ...journal.hidden]);
}

const cap = t => t.charAt(0).toUpperCase() + t.slice(1);

// A window's pick, and the bottles that suit it as well (planTies': at most
// two, each with how it differs, src/contrast.js).
function brief(p, ties = []) {
  if (!p?.pick) return null;
  const f = p.pick.fragrance;
  return {
    slot: p.win.slot, label: p.win.label, id: String(f.id), name: f.name, brand: f.brand, tier: p.pick.tier, ...(p.win.occasion && { occasion: p.win.occasion.id }),
    ties: ties.map(({ entry, tags }) => ({ id: String(entry.fragrance.id), name: entry.fragrance.name, brand: entry.fragrance.brand, tags })),
  };
}

// The window to wear now, in full; `tieLine` is the panel's one line on its
// ties ("Legacy (fresher) suits tonight just as well."), '' with none.
function detail(p, ties = []) {
  if (!p?.pick) return null;
  const { win, pick, ranked } = p;
  const f = pick.fragrance;
  const runnerUp = ranked.find(r => r !== pick);
  return {
    ...brief(p, ties),
    tieLine: tieLine(ties, win),
    condition: win.condition,
    category: win.category,
    feelsF: Math.round(win.feelsF),
    humidity: Math.round(win.humidity),
    rainChance: win.pop,
    match: matchPct(pick),
    thumb: f.thumb ?? '',
    url: f.url ?? '',
    accords: Object.keys(f.accords).slice(0, 3).map(name => ({ name, color: accordColor(name) })),
    reasons: displayReasons(pick, 4).map(r => ({ tone: r.tone, text: cap(r.text) })),
    runnerUp: runnerUp ? { name: runnerUp.fragrance.name, brand: runnerUp.fragrance.brand, tier: runnerUp.tier } : null,
  };
}

// A line for the panel's status about the wears the plan counted: none
// without a journal, and how old the newest is when it's days old.
function journalNote(freshness) {
  if (!freshness) return 'not counting recent wears';
  if (freshness.newest === null) return 'no wears in the journal';
  return freshness.daysAgo >= 2 ? `newest wear ${freshness.daysAgo} days ago` : null;
}

// The week ahead planned the way the app plans it, so the widget, Today and
// Week agree. The first window still ahead is the one to wear now. With a
// journal (parseJournal's shape) its wears rotate and the nudge is on, as
// in the app, and the days and nights planned for an occasion in the app go
// on their windows as Now and the Week put them; `journal` says how current
// the wears are (journalFreshness), null without one, and `journalNote` puts
// that in a few words for the panel.
export function widgetPayload(fragrances, forecast, place, nowMs = Date.now(), journal = null) {
  const days = week(forecast, nowMs);
  // The app's and the journal's ids are strings; data/collection.json has numbers.
  const bottles = fragrances.map(f => (typeof f.id === 'string' ? f : { ...f, id: String(f.id) }));
  const history = journal ? journal.history.filter(h => !h.planned) : [];
  // The place's date, which week() has moved past once tonight's window is over.
  const todayISO = new Date(nowMs + (forecast.utc_offset_seconds ?? 0) * 1000).toISOString().slice(0, 10);
  const events = (journal?.events ?? []).filter(e => occasionById(e.occasion));
  const windows = withStoredEvents(days.flatMap(d => [d.day, d.night].filter(Boolean)), events);
  const plan = planWindows(bottles, windows, { history, nudge: history.length > 0, nowISO: todayISO });
  // By date and slot: an event's window is a copy with its occasion on.
  const key = win => win && `${win.dateISO}:${win.slot}`;
  const byWindow = new Map(plan.map(p => [key(p.win), p]));
  // Each window's toss-ups as the app's Now and Week find them.
  const ties = new Map(planTies(plan, { history }).map((t, i) => [plan[i], t]));
  const briefOf = win => { const p = byWindow.get(key(win)); return brief(p, ties.get(p)); };
  const freshness = journal && journalFreshness(history, todayISO);
  return {
    place,
    updated: new Date(nowMs).toISOString(),
    journal: freshness || null,
    journalNote: journalNote(freshness),
    now: detail(plan[0], ties.get(plan[0])),
    next: brief(plan[1], ties.get(plan[1])),
    days: days.map(d => ({
      date: d.dateISO,
      name: d.name,
      hiF: Math.round(d.hiF),
      loF: Math.round(d.loF),
      condition: d.condition,
      category: d.category,
      rainChance: d.pop,
      day: briefOf(d.day),
      night: briefOf(d.night),
    })),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values: args } = parseArgs({
    options: {
      location: { type: 'string', default: '' },
      hidden: { type: 'string' },
      journal: { type: 'string', default: '' },
    },
  });
  setTimeout(() => { console.error('Timed out fetching the forecast'); process.exit(1); }, 30_000).unref();
  try {
    const { fragrances } = JSON.parse(readFileSync(new URL('../data/collection.json', import.meta.url)));
    const hidden = args.hidden === undefined ? undefined : args.hidden.split(',').filter(s => s.trim());
    // A journal that can't be read leaves the plan without wears, and says why on stderr.
    let journal = null;
    if (args.journal.trim()) {
      try { journal = loadJournal(args.journal); } catch (err) { console.error(err.message); }
    }
    const place = await resolvePlace(args.location);
    const forecast = await fetchForecast(place);
    const payload = widgetPayload(widgetBottles(fragrances, hidden, journal), forecast, place, Date.now(), journal);
    if (args.journal.trim() && !journal) payload.journalNote = 'can’t read the journal setting';
    console.log(JSON.stringify(payload));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
