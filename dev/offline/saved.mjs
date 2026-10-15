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

// Days from the saved forecast's first day to New York's today (not this
// machine's, which east of New York can be a day ahead); the journal moves with it.
const FORECAST = read('ny-forecast.json');
const placeDay = now => new Date(now.getTime() + FORECAST.utc_offset_seconds * 1000).toISOString().slice(0, 10);
const shift = now => Math.round((noon(placeDay(now)) - noon(FORECAST.daily.time[0])) / 864e5);

/**
 * The saved forecast starting today, read at this hour: `current` is the
 * hourly row src/weather.js reads as now once a forecast is an hour old (the
 * hour on the forecast's clock), so a fresh fetch shows the same reading.
 */
export function shiftedForecast(now = new Date()) {
  const out = moveDates(FORECAST, shift(now));
  delete out.fetchedAt;
  const time = `${new Date(now.getTime() + out.utc_offset_seconds * 1000).toISOString().slice(0, 13)}:00`;
  const { hourly: h, daily: d } = out, i = h.time.indexOf(time), day = d.time.indexOf(time.slice(0, 10));
  if (i < 0 || day < 0) return out;
  out.current = {
    ...out.current,
    time,
    temperature_2m: h.temperature_2m[i],
    apparent_temperature: h.apparent_temperature[i],
    relative_humidity_2m: h.relative_humidity_2m[i],
    weather_code: h.weather_code[i],
    cloud_cover: null, // not in the hourly rows; the app reads none from them either
    is_day: d.sunrise[day] <= time && time < d.sunset[day] ? 1 : 0,
  };
  return out;
}

/** The sample wears, moved as far as the forecast. */
export const shiftedHistory = (now = new Date()) => moveDates(read('history.json'), shift(now));

/** What the CLI calls the place under stub.mjs. */
export const SAVED_NAME = `${NEW_YORK.name} (saved)`;

/**
 * CLI arguments with every --loc and --city (no lookup) turned into New York
 * as SAVED_NAME, so output on the saved weather never names the place asked.
 */
export function savedPlaceArgs(args) {
  const SAVED_PLACE = `${NEW_YORK.lat},${NEW_YORK.lon},${SAVED_NAME}`;
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (/^--(city|loc)=/.test(args[i])) out.push(`--loc=${SAVED_PLACE}`);
    else if ((args[i] === '--city' || args[i] === '--loc') && i + 1 < args.length) out.push('--loc', SAVED_PLACE), i++;
    else out.push(args[i]);
  }
  return out;
}

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
