#!/usr/bin/env node
// Everything the Omarchy bar widget shows, as one JSON object on stdout.
//   node omarchy/widget.mjs [--location "Grapevine, TX" | --location 32.93,-97.08[,Name]] [--hidden "Name,Name"]
// Without --location it follows Omarchy's weather location, then the IP address.
// Without --hidden, DEFAULT_HIDDEN stays off, as on a device that never opened Manage.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { planWindows } from '../src/engine.js';
import { accordColor } from '../src/accords.js';
import { DEFAULT_HIDDEN } from '../src/hidden.js';
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

const cap = t => t.charAt(0).toUpperCase() + t.slice(1);

function brief(p) {
  if (!p?.pick) return null;
  const f = p.pick.fragrance;
  return { slot: p.win.slot, label: p.win.label, id: String(f.id), name: f.name, brand: f.brand, tier: p.pick.tier };
}

function detail(p) {
  if (!p?.pick) return null;
  const { win, pick, ranked } = p;
  const f = pick.fragrance;
  const runnerUp = ranked.find(r => r !== pick);
  return {
    ...brief(p),
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

// The week ahead planned the way the app plans it, so the widget, Today and
// Week agree. The first window still ahead is the one to wear now.
export function widgetPayload(fragrances, forecast, place, nowMs = Date.now()) {
  const days = week(forecast, nowMs);
  const plan = planWindows(fragrances, days.flatMap(d => [d.day, d.night].filter(Boolean)));
  const byWindow = new Map(plan.map(p => [p.win, p]));
  return {
    place,
    updated: new Date(nowMs).toISOString(),
    now: detail(plan[0]),
    next: brief(plan[1]),
    days: days.map(d => ({
      date: d.dateISO,
      name: d.name,
      hiF: Math.round(d.hiF),
      loF: Math.round(d.loF),
      condition: d.condition,
      category: d.category,
      rainChance: d.pop,
      day: brief(byWindow.get(d.day)),
      night: brief(byWindow.get(d.night)),
    })),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values: args } = parseArgs({
    options: {
      location: { type: 'string', default: '' },
      hidden: { type: 'string' },
    },
  });
  setTimeout(() => { console.error('Timed out fetching the forecast'); process.exit(1); }, 30_000).unref();
  try {
    const { fragrances } = JSON.parse(readFileSync(new URL('../data/collection.json', import.meta.url)));
    const hidden = args.hidden === undefined ? undefined : args.hidden.split(',').filter(s => s.trim());
    const place = await resolvePlace(args.location);
    const forecast = await fetchForecast(place);
    console.log(JSON.stringify(widgetPayload(activeBottles(fragrances, hidden), forecast, place)));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
