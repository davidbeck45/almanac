// Open-Meteo forecast (free, no key) summarized into "now", a daytime window
// and a night window. Open-Meteo returns wall-clock times for the location
// ("2026-09-28T13:00"); we parse them as UTC and shift "now" by the
// location's UTC offset so all comparisons happen in the location's time.
import { describe, SEVERITY } from './wmo.js';
import { dewPointF } from './engine.js';

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
export const WINDOWS = { day: [10, 17], night: [19, 23] };
// How far ahead trips and events take the forecast, today included; past it
// they get typical weather for the dates (typicalWindow). Open-Meteo runs to
// 16 days, but the blend thins out: ICON stops after about 7 days and GEM
// after 10, leaving GFS and ECMWF, then GFS alone. On score-forecasts.py's 14
// airports (Sep 1 – Oct 6 2026) typical weather missed window temperatures
// by 5.5°F; the blend by 2.5 four days out and 3.6 at seven, GFS and ECMWF
// alone by 4.0 at seven, growing about half a degree a day, GFS alone by 5.0.
// Open-Meteo keeps past runs only seven days out, so ten is that growth's
// reach. A forecast window also needs FORECAST_MODELS of the blend's models.
export const FORECAST_DAYS = 10;
const FORECAST_MODELS = 2;

const CACHE_KEY = 'scentcast.weather';
const CACHE_VERSION = 3; // bump when the request shape changes
const CACHE_MAX_AGE = 20 * 60 * 1000;
// An older forecast still opens the app (under "Updating…" while a fresh one
// loads) up to this age: it still covers today and tomorrow.
const SHOW_STALE_FOR = 12 * 60 * 60 * 1000;

const wallMs = iso => Date.parse(`${iso}Z`);
const avg = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// Temperature, feels-like and humidity are the mean of four global models.
// Open-Meteo's default ("best match", NOAA's GFS in the US) ran about a degree
// warm and two dry on its own. Against airport readings in 14 US cities over
// Sep 1 – Oct 6 2026, forecasts made 0–6 days ahead, the mean cut the error in
// window temperature from 3.1°F to 2.4°F, in dew point from 4.1 to 2.4, and in
// daily highs and lows from 2.9 to 2.1 and 2.0; it won or tied in 13 of the
// 14 cities. Current conditions, weather codes and rain chances stay the
// default model's.
const DEFAULT_MODEL = 'best_match';
const BLEND_MODELS = ['gfs_seamless', 'ecmwf_ifs', 'icon_seamless', 'gem_seamless'];
const BLENDED = ['temperature_2m', 'apparent_temperature', 'relative_humidity_2m'];

/**
 * A multi-model Open-Meteo response (variables suffixed with the model name)
 * -> the single-model shape the rest of this file reads. Blended hourly values
 * average the models that have one for that hour, and daily highs and lows
 * come from the blended hours, so they match the windows.
 */
export function blendModels(raw) {
  const h = raw.hourly, d = raw.daily;
  const own = (vars, key) => vars[`${key}_${DEFAULT_MODEL}`] ?? vars[key];
  const hourly = { time: h.time };
  for (const key of ['weather_code', 'precipitation_probability']) hourly[key] = own(h, key);
  for (const key of BLENDED) {
    const series = BLEND_MODELS.map(m => h[`${key}_${m}`]).filter(Boolean);
    hourly[key] = h.time.map((_, i) => {
      const vals = series.map(s => s[i]).filter(v => v != null);
      return vals.length ? avg(vals) : own(h, key)?.[i] ?? null;
    });
  }
  // How many models each hour's feels-like averages (a single-model response has no count).
  const feels = BLEND_MODELS.map(m => h[`apparent_temperature_${m}`]).filter(Boolean);
  if (feels.length) hourly.models = h.time.map((_, i) => feels.filter(s => s[i] != null).length);
  const temps = date => hourly.temperature_2m.filter((t, i) => t != null && h.time[i].startsWith(date));
  const daily = {
    time: d.time,
    sunrise: own(d, 'sunrise'),
    sunset: own(d, 'sunset'),
    temperature_2m_max: d.time.map((date, i) => (temps(date).length ? Math.max(...temps(date)) : own(d, 'temperature_2m_max')[i])),
    temperature_2m_min: d.time.map((date, i) => (temps(date).length ? Math.min(...temps(date)) : own(d, 'temperature_2m_min')[i])),
  };
  return { ...raw, hourly, daily };
}

// `days` of forecast, today first: 7 for the app, up to FORECAST_DAYS for a trip.
export async function fetchForecast({ lat, lon }, { days = 7 } = {}) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,cloud_cover,is_day',
    hourly: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,precipitation_probability',
    daily: 'sunrise,sunset,temperature_2m_max,temperature_2m_min',
    temperature_unit: 'fahrenheit',
    timezone: 'auto',
    forecast_days: days,
    models: [DEFAULT_MODEL, ...BLEND_MODELS].join(','),
  });
  const res = await fetch(`${FORECAST_URL}?${params}`);
  if (!res.ok) throw Object.assign(new Error(`Weather request failed (${res.status})`), { status: res.status });
  return { ...blendModels(await res.json()), fetchedAt: Date.now() };
}

const cacheKey = loc => `${CACHE_VERSION}:${loc.lat},${loc.lon}`;
// The saved { key, forecast }, or null when there's none or it isn't one.
function readCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY));
    return typeof cached?.key === 'string' && Number.isFinite(cached.forecast?.fetchedAt) ? cached : null;
  } catch {
    return null;
  }
}

/**
 * The saved forecast for this place: `fresh` (under 20 minutes old, no need
 * to fetch) or old enough to refresh but fine to show meanwhile. Null when
 * there is none, it's for another place, or it's too old to show.
 */
export function cachedForecast(loc, nowMs = Date.now()) {
  const cached = readCache();
  if (cached?.key !== cacheKey(loc)) return null;
  const age = nowMs - cached.forecast.fetchedAt;
  if (!(age < SHOW_STALE_FOR)) return null;
  return { forecast: cached.forecast, fresh: age < CACHE_MAX_AGE };
}

// Cached fetch: fresh cache wins (unless forced), network next, stale cache if offline.
export async function getForecast(loc, { force = false } = {}) {
  const key = cacheKey(loc);
  const cached = readCache();
  if (!force && cached?.key === key && Date.now() - cached.forecast.fetchedAt < CACHE_MAX_AGE) return cached.forecast;
  try {
    const forecast = await fetchForecast(loc);
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ key, forecast })); } catch {}
    return forecast;
  } catch (err) {
    if (cached?.key === key) return { ...cached.forecast, stale: true };
    throw err;
  }
}

/** What went wrong fetching the forecast, as a sentence for the page. */
export function forecastError(err) {
  const status = err?.status;
  if (status === 429) return 'The forecast service is busy. Try again in a minute.';
  if (status >= 500) return 'The forecast service is down for the moment. Try again soon.';
  if (status) return `The forecast service turned the request down (error ${status}). Try again later.`;
  return 'Can’t reach the forecast. Check your connection and try again.';
}

function headline(hours) {
  const counts = {};
  for (const h of hours) {
    const c = describe(h.code).category;
    counts[c] = (counts[c] ?? 0) + 1;
  }
  const needed = Math.min(2, hours.length);
  const severe = [...SEVERITY].reverse().find(c => (counts[c] ?? 0) >= needed && SEVERITY.indexOf(c) >= 3);
  const category = severe ?? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  const codeCounts = {};
  for (const h of hours) if (describe(h.code).category === category) codeCounts[h.code] = (codeCounts[h.code] ?? 0) + 1;
  const code = +Object.entries(codeCounts).sort((a, b) => b[1] - a[1])[0][0];
  return describe(code);
}

export function phaseAt(now, sunrise, sunset) {
  const m = 60_000;
  if (now < sunrise - 40 * m) return 'night';
  if (now < sunrise + 50 * m) return 'dawn';
  if (now < sunset - 50 * m) return 'day';
  if (now < sunset + 40 * m) return 'dusk';
  return 'night';
}

function hourlyRows(forecast) {
  const h = forecast.hourly;
  return h.time.map((t, i) => ({
    date: t.slice(0, 10),
    hour: +t.slice(11, 13),
    temp: h.temperature_2m[i],
    feels: h.apparent_temperature[i],
    humidity: h.relative_humidity_2m[i],
    dew: dewPointF(h.temperature_2m[i], h.relative_humidity_2m[i]),
    code: h.weather_code[i],
    pop: h.precipitation_probability?.[i] ?? 0,
    models: h.models?.[i],
    rain: h.precipitation?.[i],
  }));
}

const WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' });
const dayName = dateISO => WEEKDAY.format(new Date(`${dateISO}T12:00:00Z`));

function slotLabel(slot, dateISO, todayISO, tomorrowISO) {
  if (dateISO === todayISO) return slot === 'day' ? 'Today' : 'Tonight';
  const name = dateISO === tomorrowISO ? 'Tomorrow' : dayName(dateISO);
  return slot === 'day' ? name : `${name} night`;
}

// One day or night window, from `fromHour` (for a window already under way)
// to the window's end. Null when no forecast hours fall inside it.
function slotWindow(hours, slot, dateISO, fromHour, ctx) {
  const [start, end] = WINDOWS[slot];
  const from = Math.max(start, fromHour);
  // An hour a model hasn't filled in would read as 0°F.
  const span = hours.filter(x => x.date === dateISO && x.hour >= from && x.hour <= end
    && [x.temp, x.feels, x.humidity].every(Number.isFinite));
  if (!span.length) return null;
  const cond = headline(span);
  return {
    slot,
    label: slotLabel(slot, dateISO, ctx.todayISO, ctx.tomorrowISO),
    dateISO,
    date: new Date(`${dateISO}T12:00:00`),
    lat: ctx.lat,
    feelsF: avg(span.map(x => x.feels)),
    hiF: Math.max(...span.map(x => x.temp)),
    loF: Math.min(...span.map(x => x.temp)),
    humidity: avg(span.map(x => x.humidity)),
    dewF: avg(span.map(x => x.dew)),
    pop: Math.max(...span.map(x => x.pop)),
    code: cond.code,
    condition: cond.label,
    category: cond.category,
    // The fewest models behind an hour, and the rain that fell (mm, archived hours only).
    ...(span.some(x => x.models != null) && { models: Math.min(...span.map(x => x.models ?? 0)) }),
    ...(span.some(x => x.rain != null) && { rainMM: span.reduce((sum, x) => sum + (x.rain ?? 0), 0) }),
  };
}

// A day or night window on any date the hourly data covers, such as a past
// date from Open-Meteo's archive (scripts/journal-check.mjs).
export function windowOn(forecast, dateISO, slot) {
  return slotWindow(hourlyRows(forecast), slot, dateISO, 0, { todayISO: null, tomorrowISO: null, lat: forecast.latitude });
}

// Typical weather for dates past the forecast: the same dates, give or take
// TYPICAL_SPREAD days, in each of the last TYPICAL_YEARS years of Open-Meteo's
// archive (ERA5 reanalysis, about five days behind). One cold snap in one year
// moves 21 windows' average a little, not the whole answer.
const TYPICAL_YEARS = 3;
const TYPICAL_SPREAD = 3;
const ARCHIVE_LAG_DAYS = 7;
const TYPICAL_HOURLY = 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,precipitation';
// A past window counts as wet from this much rain or snow (mm): the archive
// codes any hour with a trace as drizzle, which made a Sydney summer read
// "Light drizzle" and Mumbai's monsoon wet every day.
const WET_MM = 1;
const FALLING = new Set(['drizzle', 'rain', 'storm', 'snow']);

const shiftDays = (iso, days) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
// The same month and day `years` earlier; February 29 falls back to the 28th.
function yearsBefore(iso, years) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${y - years}-${String(m).padStart(2, '0')}-${String(m === 2 && d === 29 ? 28 : d).padStart(2, '0')}`;
}

/**
 * Archived hourly weather around fromISO..toISO in each of the last `years`
 * years the archive has whole: { latitude, years: [{ ago, data }] }, `data`
 * shaped like a forecast's hourly block (windowOn reads it). Plain fetch, so
 * it runs in Node and the browser alike.
 */
export async function fetchTypical({ lat, lon }, fromISO, toISO, { years = TYPICAL_YEARS, nowMs = Date.now() } = {}) {
  const archived = shiftDays(new Date(nowMs).toISOString().slice(0, 10), -ARCHIVE_LAG_DAYS);
  let first = 1;
  while (shiftDays(yearsBefore(toISO, first), TYPICAL_SPREAD) > archived) first++;
  const get = async ago => {
    const params = new URLSearchParams({
      latitude: lat,
      longitude: lon,
      start_date: shiftDays(yearsBefore(fromISO, ago), -TYPICAL_SPREAD),
      end_date: shiftDays(yearsBefore(toISO, ago), TYPICAL_SPREAD),
      hourly: TYPICAL_HOURLY,
      temperature_unit: 'fahrenheit',
      timezone: 'auto',
    });
    const res = await fetch(`${ARCHIVE_URL}?${params}`);
    if (!res.ok) throw Object.assign(new Error(`Weather archive request failed (${res.status})`), { status: res.status });
    return { ago, data: await res.json() };
  };
  const out = await Promise.all(Array.from({ length: years }, (_, i) => get(first + i)));
  return { latitude: out[0]?.data.latitude ?? lat, years: out };
}

const mode = xs => {
  const counts = new Map();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
};

/**
 * The typical day or night window on dateISO, from fetchTypical's data:
 * feels-like, humidity and dew point averaged over every archived window
 * within TYPICAL_SPREAD days of the date, `pop` the share of them with
 * WET_MM of rain or snow, and the commonest condition among the wet ones
 * when most were wet, else among the dry ones. Shaped like a forecast
 * window, with `typical: true`; null without data.
 */
export function typicalWindow(climate, dateISO, slot) {
  const wins = [];
  for (const { ago, data } of climate.years) {
    const past = { ...data, latitude: climate.latitude };
    for (let k = -TYPICAL_SPREAD; k <= TYPICAL_SPREAD; k++) {
      const w = windowOn(past, shiftDays(yearsBefore(dateISO, ago), k), slot);
      if (w) wins.push(w);
    }
  }
  if (!wins.length) return null;
  const mean = key => avg(wins.map(w => w[key]));
  // Archives without a rain total read wet from the condition.
  const wet = wins.filter(w => (w.rainMM ?? (FALLING.has(w.category) ? WET_MM : 0)) >= WET_MM);
  const rainy = wet.length * 2 >= wins.length;
  // The rain or snow on the wet ones, or the skies on the dry ones, where a
  // trace of drizzle means overcast.
  const usual = rainy
    ? wet.filter(w => FALLING.has(w.category))
    : wins.filter(w => !wet.includes(w)).map(w => (FALLING.has(w.category) ? { ...w, category: 'cloudy', code: 3 } : w));
  const category = mode(usual.map(w => w.category));
  const cond = describe(category ? mode(usual.filter(w => w.category === category).map(w => w.code)) : 61);
  return {
    slot,
    label: slotLabel(slot, dateISO, null, null),
    dateISO,
    date: new Date(`${dateISO}T12:00:00`),
    lat: climate.latitude,
    feelsF: mean('feelsF'),
    hiF: mean('hiF'),
    loF: mean('loF'),
    humidity: mean('humidity'),
    dewF: mean('dewF'),
    pop: Math.round((100 * wet.length) / wins.length),
    code: cond.code,
    condition: cond.label,
    category: cond.category,
    typical: true,
    samples: wins.length,
  };
}

/**
 * The `slots` windows of every date from fromISO to toISO, in time order:
 * the forecast's as far as it reaches, typical weather past it (`typical`).
 * Fetches only what the dates need.
 */
export async function tripWindows(loc, fromISO, toISO, { slots = ['day', 'night'], nowMs = Date.now() } = {}) {
  const dates = [];
  for (let d = fromISO; d <= toISO; d = shiftDays(d, 1)) dates.push(d);
  const found = new Map();
  const key = (d, s) => `${d} ${s}`;
  // The location's date can be a day off UTC's; windowOn finds what's there.
  if (fromISO <= shiftDays(new Date(nowMs).toISOString().slice(0, 10), FORECAST_DAYS)) {
    const forecast = await fetchForecast(loc, { days: FORECAST_DAYS });
    for (const d of dates) {
      for (const s of slots) {
        const win = windowOn(forecast, d, s);
        if (win && !(win.models < FORECAST_MODELS)) found.set(key(d, s), win);
      }
    }
  }
  const missing = dates.filter(d => slots.some(s => !found.get(key(d, s))));
  if (missing.length) {
    const climate = await fetchTypical(loc, missing[0], missing.at(-1), { nowMs });
    for (const d of missing) for (const s of slots) if (!found.get(key(d, s))) found.set(key(d, s), typicalWindow(climate, d, s));
  }
  return dates.flatMap(d => slots.map(s => found.get(key(d, s))).filter(Boolean));
}

function clock(forecast, nowMs) {
  const wallNow = nowMs + forecast.utc_offset_seconds * 1000;
  const nowDate = new Date(wallNow);
  return {
    wallNow,
    hour: nowDate.getUTCHours(),
    todayISO: nowDate.toISOString().slice(0, 10),
    tomorrowISO: new Date(wallNow + 86_400_000).toISOString().slice(0, 10),
    lat: forecast.latitude,
  };
}

// `current` is the reading at fetch time. A saved forecast an hour or more
// old reads "now" from its row for this hour instead, so a 2 pm forecast
// opened at 1 am doesn't show the afternoon under a night sky.
const CURRENT_FOR = 60 * 60 * 1000;

function nowReading(forecast, hours, ctx, nowMs) {
  const c = forecast.current;
  const row = nowMs - forecast.fetchedAt >= CURRENT_FOR && hours.find(x => x.date === ctx.todayISO && x.hour === ctx.hour);
  return row
    ? { tempF: row.temp, feelsF: row.feels, humidity: row.humidity, cloudCover: null, code: row.code }
    : { tempF: c.temperature_2m, feelsF: c.apparent_temperature, humidity: c.relative_humidity_2m, cloudCover: c.cloud_cover, code: c.weather_code };
}

export function summarize(forecast, nowMs = Date.now()) {
  const ctx = clock(forecast, nowMs);
  const { wallNow, todayISO, tomorrowISO, hour } = ctx;
  const hours = hourlyRows(forecast);

  // A window that has ended today rolls over to tomorrow.
  const next = slot => (hour < WINDOWS[slot][1]
    ? slotWindow(hours, slot, todayISO, hour, ctx)
    : slotWindow(hours, slot, tomorrowISO, 0, ctx));

  const d = forecast.daily;
  const di = Math.max(0, d.time.indexOf(todayISO));
  const sunrise = wallMs(d.sunrise[di]);
  const sunset = wallMs(d.sunset[di]);
  const { code, ...reading } = nowReading(forecast, hours, ctx, nowMs);

  return {
    todayISO,
    stale: !!forecast.stale,
    fetchedAt: forecast.fetchedAt,
    now: {
      ...reading,
      hiF: d.temperature_2m_max[di],
      loF: d.temperature_2m_min[di],
      phase: phaseAt(wallNow, sunrise, sunset),
      sunProgress: clamp((wallNow - sunrise) / (sunset - sunrise), 0, 1),
      ...describe(code),
    },
    day: next('day'),
    night: next('night'),
  };
}

// The forecast as days, each with whatever day and night windows are still
// ahead. Today drops windows that have already ended.
export function week(forecast, nowMs = Date.now()) {
  const ctx = clock(forecast, nowMs);
  const hours = hourlyRows(forecast);
  const d = forecast.daily;
  return d.time
    .map((dateISO, i) => {
      if (dateISO < ctx.todayISO) return null;
      const from = dateISO === ctx.todayISO ? ctx.hour : 0;
      const windows = {
        day: from < WINDOWS.day[1] ? slotWindow(hours, 'day', dateISO, from, ctx) : null,
        night: from < WINDOWS.night[1] ? slotWindow(hours, 'night', dateISO, from, ctx) : null,
      };
      const waking = hours.filter(x => x.date === dateISO && x.hour >= 7 && x.hour <= 22);
      if (!waking.length || (!windows.day && !windows.night)) return null;
      const cond = headline(waking);
      return {
        dateISO,
        isToday: dateISO === ctx.todayISO,
        name: dateISO === ctx.todayISO ? 'Today' : dateISO === ctx.tomorrowISO ? 'Tomorrow' : dayName(dateISO),
        hiF: d.temperature_2m_max[i],
        loF: d.temperature_2m_min[i],
        pop: Math.max(...waking.map(x => x.pop)),
        code: cond.code,
        condition: cond.label,
        category: cond.category,
        ...windows,
      };
    })
    .filter(Boolean);
}
