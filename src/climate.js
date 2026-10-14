// A place's climate for the gap finder: how often each feels-like band comes
// up there by day and by night, from one Open-Meteo archive call (hourly
// feels-like and dew point over the last two full years, about 350 KB),
// summarized to about 4 KB (climateSummary in src/gaps.js) and kept in
// localStorage per half-degree of latitude and longitude. Offline, or when
// the archive fails, it's DEFAULT_CLIMATE. Runs in the browser and in Node
// (the CLI), where nothing is stored.
// Weather data by Open-Meteo.com (CC BY 4.0).
import { WINDOWS, forecastError, requestError } from './weather.js';
import { climateSummary, DEFAULT_CLIMATE } from './gaps.js';

const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
const KEY = 'scentcast.climate';
const VERSION = 1; // bump when the summary's shape or the windows change
const GRID = 0.5; // degrees: a city's climate, not a street's
const KEEP = 4; // places remembered
const YEARS = 2;

const avg = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const snap = x => Math.round(x / GRID) * GRID;

/**
 * An archive response (hourly apparent_temperature and dew_point_2m, °F,
 * local time) -> one window per date and slot, as src/weather.js builds them:
 * mean feels-like and dew point over the WINDOWS hours. [{ dateISO, slot, feelsF, dewF, lat }]
 */
export function archiveWindows(data, lat = data.latitude) {
  const byWindow = new Map();
  const h = data.hourly;
  h.time.forEach((t, i) => {
    const f = h.apparent_temperature[i], d = h.dew_point_2m[i];
    if (!Number.isFinite(f) || !Number.isFinite(d)) return;
    const hour = +t.slice(11, 13);
    for (const [slot, [start, end]] of Object.entries(WINDOWS)) {
      if (hour < start || hour > end) continue;
      const key = `${t.slice(0, 10)} ${slot}`;
      if (!byWindow.has(key)) byWindow.set(key, { dateISO: t.slice(0, 10), slot, f: [], d: [] });
      byWindow.get(key).f.push(f);
      byWindow.get(key).d.push(d);
    }
  });
  return [...byWindow.values()].map(w => ({ dateISO: w.dateISO, slot: w.slot, feelsF: avg(w.f), dewF: avg(w.d), lat }));
}

// The last YEARS full calendar years before `now`.
export function climateYears(now = new Date()) {
  const end = now.getFullYear() - 1;
  return [`${end - YEARS + 1}-01-01`, `${end}-12-31`];
}

// Reading localStorage throws where the browser blocks it (cookies off, some private modes).
const browserStorage = () => {
  try {
    return (typeof window === 'object' && window.localStorage) || null;
  } catch {
    return null;
  }
};

// The saved places ([{ key, summary }]); anything stored in another shape
// reads as none, so the next fetch writes the cache afresh.
function readCache(storage) {
  try {
    const saved = JSON.parse(storage?.getItem(KEY));
    const places = saved?.v === VERSION && Array.isArray(saved.places) ? saved.places : [];
    return places.filter(p => p && typeof p.key === 'string' && p.summary && typeof p.summary === 'object');
  } catch {
    return [];
  }
}

/**
 * The climate summary at a place: { summary, local } (local false when it fell
 * back to DEFAULT_CLIMATE, with `error` saying why). Cached per GRID cell and
 * the years it covers, so it refetches once a year.
 */
export async function fetchClimate(lat, lon, { now = new Date(), storage = browserStorage() } = {}) {
  const [start, end] = climateYears(now);
  const key = `${snap(lat)},${snap(lon)},${end}`;
  const places = readCache(storage);
  const hit = places.find(p => p.key === key);
  if (hit) return { summary: hit.summary, local: true };
  try {
    const params = new URLSearchParams({
      latitude: snap(lat), longitude: snap(lon), start_date: start, end_date: end,
      hourly: 'apparent_temperature,dew_point_2m', temperature_unit: 'fahrenheit', timezone: 'auto',
    });
    const res = await fetch(`${ARCHIVE_URL}?${params}`);
    if (!res.ok) throw new Error(forecastError(await requestError(res, 'archive')));
    const summary = climateSummary(archiveWindows(await res.json(), lat));
    if (!Object.values(summary).some(c => c.wins.length)) throw new Error('The climate archive had no weather for this place.');
    try {
      storage?.setItem(KEY, JSON.stringify({ v: VERSION, places: [{ key, summary }, ...places.filter(p => p.key !== key)].slice(0, KEEP) }));
    } catch {}
    return { summary, local: true };
  } catch (err) {
    return { summary: DEFAULT_CLIMATE, local: false, error: err.message };
  }
}
