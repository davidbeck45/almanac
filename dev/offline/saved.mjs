// New York's saved weather and a sample wear journal, moved to today, so the
// CLI and headless screenshots run any day without Open-Meteo (its forecast
// API has a daily limit, and a 429 leaves the app without weather).
// stub.mjs serves them to the CLI, init.mjs to a page under dev/shoot.mjs.
//   ny-forecast.json  7 days from Oct 14 2026 as fetchForecast returns them (the four models blended)
//   ny-climate.json   each day's day and night window over 2024–2025 (feels-like, dew point),
//                     from Open-Meteo's archive, for the gap finder's climate (fetchClimate)
//   history.json      66 wears of 10 wardrobe bottles, the newest 3 days before the forecast
// Every place gets New York's weather; typical weather (dates past the saved
// week) still comes from the archive.
import { readFileSync } from 'node:fs';
import { WINDOWS } from '../../src/weather.js';

export const NEW_YORK = { name: 'New York', lat: 40.71, lon: -74.01 };

const read = name => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));
const pad = n => String(n).padStart(2, '0');
const isoDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const noon = iso => new Date(`${iso}T12:00`);

// Moves every date string ("2026-10-14", "2026-10-14T06:58") in a value by `days`.
function moveDates(value, days) {
  if (Array.isArray(value)) return value.map(v => moveDates(v, days));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, moveDates(v, days)]));
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(value)) return value;
  const d = noon(value.slice(0, 10));
  d.setDate(d.getDate() + days);
  return isoDay(d) + value.slice(10);
}

// Days from the saved forecast's first day to today; the journal moves with it.
const FORECAST = read('ny-forecast.json');
const shift = now => Math.round((noon(isoDay(now)) - noon(FORECAST.daily.time[0])) / 864e5);

/** The saved forecast starting today, read at this hour. */
export function shiftedForecast(now = new Date()) {
  const out = moveDates(FORECAST, shift(now));
  out.current.time = `${isoDay(now)}T${pad(now.getHours())}:00`;
  delete out.fetchedAt;
  return out;
}

/** The sample wears, moved as far as the forecast. */
export const shiftedHistory = (now = new Date()) => moveDates(read('history.json'), shift(now));

/** What offlineFetch answers with. */
export const offlineData = (now = new Date()) => ({ forecast: shiftedForecast(now), climate: read('ny-climate.json'), windows: WINDOWS, home: NEW_YORK });

/**
 * A fetch that answers Open-Meteo's forecast requests with the saved forecast
 * and its archive's climate requests (fetchClimate's) with the saved climate,
 * rebuilt as hourly readings that average back to each window; anything else
 * goes to `realFetch`. Self-contained: init.mjs puts its source in the page.
 */
export function offlineFetch(realFetch, { forecast, climate, windows, home }) {
  const json = body => Promise.resolve(new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }));
  const warned = new Set();
  const forPlace = url => {
    const lat = +url.searchParams.get('latitude'), lon = +url.searchParams.get('longitude');
    if (Math.abs(lat - home.lat) < 0.5 && Math.abs(lon - home.lon) < 0.5) return;
    if (!warned.has(`${lat},${lon}`)) console.warn(`Offline: answering ${lat},${lon} with ${home.name}'s saved weather.`);
    warned.add(`${lat},${lon}`);
  };
  let archive = null;
  const hourly = () => {
    const time = [], feels = [], dew = [];
    const start = new Date(`${climate.from}T00:00Z`);
    climate.day.forEach((day, i) => {
      const date = new Date(start.getTime() + i * 864e5).toISOString().slice(0, 10);
      for (let h = 0; h < 24; h++) {
        const slot = Object.keys(windows).find(s => h >= windows[s][0] && h <= windows[s][1]);
        const [f, d] = slot === 'day' ? day : slot === 'night' ? climate.night[i] : [null, null];
        time.push(`${date}T${String(h).padStart(2, '0')}:00`);
        feels.push(f);
        dew.push(d);
      }
    });
    return { latitude: home.lat, longitude: home.lon, hourly: { time, apparent_temperature: feels, dew_point_2m: dew } };
  };
  return (input, opts) => {
    // The page asks for its own files by relative URLs.
    const url = new URL(input?.url ?? String(input), globalThis.location?.href);
    if (url.origin === 'https://api.open-meteo.com' && url.pathname === '/v1/forecast') {
      forPlace(url);
      return json(forecast);
    }
    if (url.origin === 'https://archive-api.open-meteo.com' && url.searchParams.get('hourly') === 'apparent_temperature,dew_point_2m') {
      forPlace(url);
      return json(archive ??= hourly());
    }
    return realFetch(input, opts);
  };
}
