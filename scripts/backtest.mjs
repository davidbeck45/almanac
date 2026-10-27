#!/usr/bin/env node
// Replays three years of real weather through the engine, picking as the app
// would, so a change to the engine, the accords, an occasion or the data
// comes with a before and after over thousands of windows rather than a few
// pinned cases.
//   node scripts/backtest.mjs [--cities "Chicago,New York,London,Houston"] [--from 2023-01-01] [--to 2025-12-31] [--json]
//   node scripts/backtest.mjs --save /tmp/before.json      (the report, and every window's picks saved)
//   node scripts/backtest.mjs --against /tmp/before.json   (the report, and what moved since --save)
//   node scripts/backtest.mjs --gaps --save … | --against …   (the gap finder's statuses and picks too)
//   node scripts/backtest.mjs --cities Toronto --fetch     (download a city's weather first, one archive call)
//
// Windows come from windowOn, as the app makes them, out of Open-Meteo's
// archive for 2023–2025 (hourly temperature, feels-like, humidity, weather
// code and precipitation), cached in .cache/climate/<City>-full-….json. A
// window the archive codes as falling on under 1 mm reads as overcast, as
// typicalWindow does. A city with only fit-gaps.mjs's feels-like and dew
// point (<City>-dew-….json) replays with every window clear.
//
// Daily picks run two ways side by side. Now plans each day's day and night
// together like the app's Now (planWindows, the rotation nudge on) and
// assumes every pick is worn, so it shows rotation at its fullest. Raw ranks
// each window alone with no history: the engine's own taste, as the CLI
// without a journal or a first visit sees it. Every occasion is ranked raw on
// both slots, and its figures weigh each window by how often gaps.js's USES
// say that use comes up in that slot and band.
//
// The headline figures need no judgment: how concentrated and how jumpy the
// picks are, what decides them, and blatant misfits. The collector-consensus
// check at the end is one person's ranges, a hint and never a threshold.
// Weather data by Open-Meteo.com (CC BY 4.0).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { rank, planWindows, scoreOf, steadyShares, comfortRange, performanceLevel, occasionWeights, DAILY_WEIGHTS, ROTATION_PENALTY } from '../src/engine.js';
import { windowOn } from '../src/weather.js';
import { describe } from '../src/wmo.js';
import { OCCASIONS, occasionById } from '../src/occasions.js';
import { USES, BANDS, bandOf } from '../src/gaps.js';
import { weakLongevity } from '../src/candidates.js';

const CACHE = new URL('../.cache/climate/', import.meta.url);
const YEARS = ['2023-01-01', '2025-12-31'];
const HOURLY = 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,precipitation';
const DEFAULT_CITIES = 'Chicago,New York,London,Houston';
// Where --fetch asks for: fit-seasons.mjs's ten temperate cities and fit-gaps.mjs's others.
const CITIES = {
  'New York': [40.71, -74.01], Chicago: [41.88, -87.63], Toronto: [43.65, -79.38], London: [51.51, -0.13],
  Paris: [48.86, 2.35], Berlin: [52.52, 13.40], Warsaw: [52.23, 21.01], Madrid: [40.42, -3.70],
  Rome: [41.90, 12.50], Istanbul: [41.01, 28.98], Houston: [29.76, -95.37], Atlanta: [33.75, -84.39],
  Phoenix: [33.45, -112.07], Seattle: [47.61, -122.33], Minneapolis: [44.98, -93.27],
};
// Month tables keep to four-season places; Houston's January is its own climate.
const FOUR_SEASONS_LAT = 35;

// A Now pick that scores this much under the window's best gave up a real
// fit for rotation. PLAN_MARGIN's value in October 2026, fixed here so that
// retuning the planner doesn't move the yardstick.
const LOSS = 0.06;
// Blatant misfits: a warm bottle from this feels-like up, a fresh one from this down.
const BLATANT_WARM_F = 78;
const BLATANT_FRESH_F = 45;
// Steady weather from one day to the next: feels-like and dew point within
// these, and the same sky.
const STEADY_FEELS = 3;
const STEADY_DEW = 4;
const STRETCH_DAYS = 28;
const DISTINCT_DAYS = 14;

const shiftDays = (iso, days) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const cityStem = name => name.replace(/\W/g, '');
const cityFile = (name, kind) => new URL(`${cityStem(name)}-${kind}-${YEARS.join('_')}.json`, CACHE);

// ---------------------------------------------------------------------------
// Weather

// Inverse Magnus: the humidity that gives dew point dewF at tempF (dewPointF's constants).
function humidityFor(tempF, dewF) {
  const c = ((tempF - 32) * 5) / 9, d = ((dewF - 32) * 5) / 9;
  return Math.min(100, Math.max(1, 100 * Math.exp((17.62 * d) / (243.12 + d) - (17.62 * c) / (243.12 + c))));
}

/**
 * A fit-gaps.mjs file (feels-like and dew point only), shaped like a
 * forecast: the temperature reads as feels-like, the humidity is the one that
 * gives the dew point exactly, and every hour is clear.
 */
export function dewForecast(raw) {
  const h = raw.hourly;
  return {
    latitude: raw.latitude,
    hourly: {
      time: h.time,
      temperature_2m: h.apparent_temperature,
      apparent_temperature: h.apparent_temperature,
      relative_humidity_2m: h.apparent_temperature.map((t, i) => (t == null || h.dew_point_2m[i] == null ? null : humidityFor(t, h.dew_point_2m[i]))),
      weather_code: h.time.map(() => 0),
    },
  };
}

// A past window counts as wet from WET_MM of rain or snow, as in typicalWindow:
// the archive codes any hour with a trace as drizzle, which a forecast
// wouldn't call wet.
const WET_MM = 1;
const FALLING = new Set(['drizzle', 'rain', 'storm', 'snow']);

/** A window coded as falling on under WET_MM of rain or snow, read as overcast. */
export function dryTrace(win) {
  if (!win || !FALLING.has(win.category) || win.rainMM == null || win.rainMM >= WET_MM) return win;
  const sky = describe(3);
  return { ...win, code: sky.code, condition: sky.label, category: sky.category };
}

/**
 * Every date from fromISO to toISO with both windows, as the app makes them:
 * [{ dateISO, day, night }]. windowOn reads one date's hours at a time (it
 * scans all it's given), which makes the same windows a hundred times faster.
 */
export function cityDays(forecast, fromISO, toISO) {
  const { time } = forecast.hourly;
  const keys = Object.keys(forecast.hourly);
  const span = new Map();
  time.forEach((t, i) => {
    const d = t.slice(0, 10);
    if (!span.has(d)) span.set(d, [i, i + 1]);
    else span.get(d)[1] = i + 1;
  });
  const out = [];
  for (let d = fromISO; d <= toISO; d = shiftDays(d, 1)) {
    const at = span.get(d);
    if (!at) continue;
    const one = { latitude: forecast.latitude, hourly: Object.fromEntries(keys.map(k => [k, forecast.hourly[k].slice(...at)])) };
    const day = dryTrace(windowOn(one, d, 'day')), night = dryTrace(windowOn(one, d, 'night'));
    if (day && night) out.push({ dateISO: d, day, night });
  }
  return out;
}

/** One archive call for a city's three years, saved where loadCity looks. */
export async function fetchCity(name, file = cityFile(name, 'full')) {
  const at = CITIES[name];
  if (!at) throw new Error(`No coordinates for ${name}: --fetch knows ${Object.keys(CITIES).join(', ')}.`);
  const params = new URLSearchParams({
    latitude: at[0], longitude: at[1], start_date: YEARS[0], end_date: YEARS[1],
    hourly: HOURLY, temperature_unit: 'fahrenheit', timezone: 'auto',
  });
  const res = await fetch(`https://archive-api.open-meteo.com/v1/archive?${params}`);
  if (!res.ok) throw new Error(`${name}: Open-Meteo's archive answered ${res.status}.`);
  mkdirSync(new URL('.', file), { recursive: true });
  writeFileSync(file, await res.text());
}

/** A city's cached weather: { forecast, full } (full: with weather codes and rain), or null. */
export function loadCity(name) {
  for (const kind of ['full', 'dew']) {
    const file = cityFile(name, kind);
    if (!existsSync(file)) continue;
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    return kind === 'full'
      ? { full: true, forecast: { latitude: raw.latitude, hourly: raw.hourly } }
      : { full: false, forecast: dewForecast(raw) };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Replay

/** The wardrobe as recommend.mjs ranks it: every bottle, ids as strings like the app's. */
export function loadWardrobe() {
  return JSON.parse(readFileSync(new URL('../data/collection.json', import.meta.url), 'utf8')).fragrances
    .map(f => ({ ...f, id: String(f.id) }));
}

/**
 * A wear journal kept small: the wears within ROTATION_PENALTY's reach (all
 * the rotation penalty reads), each bottle's latest wear before them and the
 * journal's first (all the nudge reads). Plans the same as the whole journal,
 * and a three-year replay stays fast.
 */
export class Journal {
  constructor() {
    this.recent = [];
    this.last = new Map();
    this.first = null;
  }
  log(id, date, slot) {
    const wear = { id, date, slot };
    this.recent.unshift(wear);
    this.last.set(id, wear);
    this.first ??= wear;
  }
  history(todayISO) {
    const cut = shiftDays(todayISO, -ROTATION_PENALTY.length);
    this.recent = this.recent.filter(h => h.date >= cut);
    const older = [...this.last.values()].filter(h => h.date < cut);
    return [...this.recent, ...older, ...(this.first && this.first.date < cut ? [this.first] : [])];
  }
}

const weatherOf = (city, win) => ({ city, dateISO: win.dateISO, slot: win.slot, feelsF: win.feelsF, dewF: win.dewF, category: win.category });

// The parts a score weighs (scoreOf): the heat and cold penalties too, for
// an occasion spent outside.
const weighedParts = occasion => {
  const W = occasion ? occasionWeights(occasion) : DAILY_WEIGHTS;
  return Object.keys(W).filter(k => W[k] > 0);
};

// A ranking cut to what the figures read: its top 3, the lead over the
// second, and the top pick with each weighted part left out (scoreOf on
// rank's own parts), which says what decides it.
function summary(ranked, occasion) {
  const drop = {};
  for (const part of weighedParts(occasion)) {
    let best = null, bestScore = -Infinity;
    for (const r of ranked) {
      const s = scoreOf({ ...r.parts, [part]: 0 }, occasion);
      if (s > bestScore) [best, bestScore] = [r, s];
    }
    drop[part] = best.fragrance.id;
  }
  return { top: ranked.slice(0, 3).map(r => r.fragrance.id), margin: ranked[0].score - (ranked[1]?.score ?? 0), drop };
}

/**
 * Daily picks over a city's days, a row per window: the Raw ranking's
 * summary, and Now's pick (`now`), what it gives up against Raw's best
 * (`loss`) and whether the nudge brought it (`nudged`). Every Now pick is
 * logged as worn in `journal`.
 */
export function replayDaily(wardrobe, days, { city = '', journal = new Journal() } = {}) {
  const rows = [];
  for (const d of days) {
    const raw = { day: rank(wardrobe, d.day, 'day'), night: rank(wardrobe, d.night, 'night') };
    for (const { win, pick } of planWindows(wardrobe, [d.day, d.night], { history: journal.history(d.dateISO), nudge: true })) {
      journal.log(pick.fragrance.id, win.dateISO, win.slot);
      const ranked = raw[win.slot];
      const own = ranked.find(r => r.fragrance.id === pick.fragrance.id);
      rows.push({ ...weatherOf(city, win), ...summary(ranked, null), now: pick.fragrance.id, loss: ranked[0].score - own.score, nudged: !!pick.nudged });
    }
  }
  return rows;
}

/** An occasion ranked alone on every window, day and night: a row per window. */
export function replayOccasion(wardrobe, days, occasion, { city = '' } = {}) {
  return days.flatMap(d => [d.day, d.night].map(win =>
    ({ ...weatherOf(city, win), ...summary(rank(wardrobe, win, win.slot, { occasion }), occasion) })));
}

/** How much a window counts for a use: its slot's share × its band's leaning, as cellsFor weighs cells. */
export function useWeight(use, slot, band) {
  return (use.slots[slot] ?? 0) * (use.bands?.[band] ?? 1);
}

// The replay runs in worker threads, a city and a task (daily picks, or one
// occasion) at a time: occasions on both slots are most of the work.
function serve() {
  const wardrobe = loadWardrobe();
  const days = new Map();
  parentPort.on('message', ({ city, task, from, to }) => {
    try {
      if (!days.has(city)) days.set(city, cityDays(loadCity(city).forecast, from, to));
      const rows = task === 'daily' ? replayDaily(wardrobe, days.get(city), { city }) : replayOccasion(wardrobe, days.get(city), occasionById(task), { city });
      parentPort.postMessage({ city, task, rows });
    } catch (err) {
      parentPort.postMessage({ city, task, error: err.stack ?? String(err) });
    }
  });
}

async function replayAll(cities, from, to) {
  const jobs = cities.flatMap(city => ['daily', ...OCCASIONS.map(o => o.id)].map(task => ({ city, task, from, to })));
  const results = new Map();
  const threads = Math.max(1, Math.min(jobs.length, 8, availableParallelism() - 1));
  await new Promise((resolve, reject) => {
    let next = 0, done = 0;
    const workers = Array.from({ length: threads }, () => new Worker(new URL(import.meta.url), { workerData: { backtest: true } }));
    const stop = () => workers.forEach(w => w.terminate());
    const give = w => { if (next < jobs.length) w.postMessage(jobs[next++]); };
    for (const w of workers) {
      w.on('message', msg => {
        if (msg.error) { stop(); reject(new Error(`${msg.city} ${msg.task}: ${msg.error}`)); return; }
        results.set(`${msg.city} ${msg.task}`, msg.rows);
        if (++done === jobs.length) { stop(); resolve(); } else give(w);
      });
      w.on('error', err => { stop(); reject(err); });
      give(w);
    }
  });
  const gather = task => cities.flatMap(city => results.get(`${city} ${task}`));
  return { daily: gather('daily'), occasions: Object.fromEntries(OCCASIONS.map(o => [o.id, gather(o.id)])) };
}

// ---------------------------------------------------------------------------
// Figures

const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
function groupBy(rows, key) {
  const out = new Map();
  for (const r of rows) {
    const k = key(r);
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(r);
  }
  return out;
}
// The q-quantile of values, each counting its weight.
function quantile(rows, value, q, weight = () => 1) {
  const xs = rows.map(r => [value(r), weight(r)]).filter(([, w]) => w > 0).sort((a, b) => a[0] - b[0]);
  const total = xs.reduce((s, [, w]) => s + w, 0);
  let acc = 0;
  for (const [x, w] of xs) if ((acc += w) >= q * total) return x;
  return null;
}
/** The weighted share of rows passing test, null with none weighted. */
export function share(rows, test, weight = () => 1) {
  let hit = 0, all = 0;
  for (const r of rows) {
    const w = weight(r);
    all += w;
    if (w && test(r)) hit += w;
  }
  return all ? hit / all : null;
}

/**
 * Kinds for the blatant checks, from voters' season split as the engine
 * steadies it, not from the engine's tuning: warm when two thirds of it is
 * fall and winter, fresh when two thirds is spring and summer.
 */
export function kindOf(frag) {
  const { winter, spring, summer, fall } = steadyShares(frag).season;
  return winter + fall >= 2 / 3 ? 'warm' : spring + summer >= 2 / 3 ? 'fresh' : null;
}

/**
 * The most-worn bottle over any `days` consecutive days of one city's
 * windows: { id, count, of, city, from, distinct, feelsF }.
 */
export function worstStretch(rows, pickOf, days = STRETCH_DAYS) {
  let worst = null;
  for (const [city, list] of groupBy(rows, r => r.city)) {
    const dates = [...groupBy(list, r => r.dateISO).values()];
    for (let i = 0; i + days <= dates.length; i++) {
      const stretch = dates.slice(i, i + days).flat();
      const counts = new Map();
      for (const r of stretch) counts.set(pickOf(r), (counts.get(pickOf(r)) ?? 0) + 1);
      const [id, count] = [...counts].sort((a, b) => b[1] - a[1])[0];
      if (!worst || count > worst.count) {
        worst = { id, count, of: stretch.length, city, from: stretch[0].dateISO, distinct: counts.size, feelsF: mean(stretch.map(r => r.feelsF)) };
      }
    }
  }
  return worst;
}

/** Mean distinct bottles per `days` windows of one slot, by slot: { day, night }. */
export function distinctPer(rows, pickOf, days = DISTINCT_DAYS) {
  const out = {};
  for (const slot of ['day', 'night']) {
    const counts = [];
    for (const list of groupBy(rows.filter(r => r.slot === slot), r => r.city).values()) {
      for (let i = 0; i + days <= list.length; i += days) counts.push(new Set(list.slice(i, i + days).map(pickOf)).size);
    }
    out[slot] = mean(counts);
  }
  return out;
}

/**
 * How often the pick changes from one day to the next when the weather
 * barely did (STEADY_FEELS, STEADY_DEW, the same sky), by slot:
 * { day: { steady, flips }, night }, each pair counting the later window's weight.
 */
export function steadyFlips(rows, pickOf, weight = () => 1) {
  const out = {};
  for (const slot of ['day', 'night']) {
    let steady = 0, flips = 0;
    for (const list of groupBy(rows.filter(r => r.slot === slot), r => r.city).values()) {
      for (let i = 1; i < list.length; i++) {
        const [a, b] = [list[i - 1], list[i]];
        if (shiftDays(a.dateISO, 1) !== b.dateISO || Math.abs(a.feelsF - b.feelsF) >= STEADY_FEELS
          || Math.abs(a.dewF - b.dewF) >= STEADY_DEW || a.category !== b.category) continue;
        steady += weight(b);
        if (pickOf(a) !== pickOf(b)) flips += weight(b);
      }
    }
    out[slot] = { steady, flips };
  }
  return out;
}

/** Bottle id -> { all, band: { cold: … }, month: [12] }: the shares of the picks. */
function pickShares(rows, pickOf, ids) {
  const out = Object.fromEntries(ids.map(id => [id, { all: 0, band: Object.fromEntries(BANDS.map(b => [b.id, 0])), month: Array(12).fill(0) }]));
  const byBand = groupBy(rows, r => bandOf(r.feelsF)), byMonth = groupBy(rows, r => +r.dateISO.slice(5, 7) - 1);
  for (const r of rows) {
    const s = out[pickOf(r)];
    s.all += 1 / rows.length;
    s.band[bandOf(r.feelsF)] += 1 / byBand.get(bandOf(r.feelsF)).length;
    s.month[+r.dateISO.slice(5, 7) - 1] += 1 / byMonth.get(+r.dateISO.slice(5, 7) - 1).length;
  }
  return out;
}

/** The figures a run reports (and --json prints), from the replayed rows. */
export function figures({ daily, occasions }, wardrobe, { latOf = () => 45 } = {}) {
  const ids = wardrobe.map(f => f.id);
  const byId = new Map(wardrobe.map(f => [f.id, f]));
  const kind = new Map(wardrobe.map(f => [f.id, kindOf(f)]));
  // Windows (with any weight) where the pick is warm at BLATANT_WARM_F or
  // fresh at BLATANT_FRESH_F, and the weighted share they make.
  const blatant = (rows, pickOf, weight = () => 1) => {
    const misfit = r => (kind.get(pickOf(r)) === 'warm' && r.feelsF >= BLATANT_WARM_F) ? 'warm'
      : (kind.get(pickOf(r)) === 'fresh' && r.feelsF <= BLATANT_FRESH_F) ? 'fresh' : null;
    const hits = rows.filter(r => weight(r) > 0 && misfit(r));
    const show = r => `${r.city} ${r.dateISO} ${r.slot} ${Math.round(r.feelsF)}°F ${byId.get(pickOf(r)).name}`;
    return {
      warm: hits.filter(r => misfit(r) === 'warm').length, fresh: hits.filter(r => misfit(r) === 'fresh').length,
      share: share(rows, misfit, weight), examples: hits.slice(0, 3).map(show),
    };
  };
  const drops = (rows, occasion, weight = () => 1) => Object.fromEntries(weighedParts(occasion)
    .map(part => [part, share(rows, r => r.drop[part] !== r.top[0], weight)]));
  const fourSeasons = daily.filter(r => Math.abs(latOf(r.city)) >= FOUR_SEASONS_LAT);
  const useOf = o => USES.find(u => u.occasion === o.id);
  const weighs = o => r => useWeight(useOf(o), r.slot, bandOf(r.feelsF));
  const raw = r => r.top[0], now = r => r.now;
  const inTop3 = new Set(daily.flatMap(r => r.top));
  const slotBand = (rows, f) => Object.fromEntries(['day', 'night'].flatMap(slot => BANDS.map(b => {
    const cell = rows.filter(r => r.slot === slot && bandOf(r.feelsF) === b.id);
    return [`${slot}:${b.id}`, cell.length ? { windows: cell.length, ...f(cell) } : null];
  })));

  const out = {
    windows: daily.length,
    kinds: { warm: wardrobe.filter(f => kind.get(f.id) === 'warm').map(f => f.name), fresh: wardrobe.filter(f => kind.get(f.id) === 'fresh').map(f => f.name) },
    now: {
      worst: worstStretch(daily, now),
      distinct: distinctPer(daily, now),
      loss: { over: share(daily, r => r.loss > LOSS), median: quantile(daily, r => r.loss, 0.5), bySlotBand: slotBand(daily, cell => ({ over: share(cell, r => r.loss > LOSS) })) },
      nudged: daily.filter(r => r.nudged).length,
      blatant: blatant(daily, now),
      shares: pickShares(daily, now, ids),
      months: pickShares(fourSeasons.length ? fourSeasons : daily, now, ids),
      monthsOver: fourSeasons.length ? 'four-season cities' : 'every city',
    },
    raw: {
      worst: worstStretch(daily, raw),
      distinct: distinctPer(daily, raw),
      flips: steadyFlips(daily, raw),
      margins: slotBand(daily, cell => ({ median: quantile(cell, r => r.margin, 0.5), p90: quantile(cell, r => r.margin, 0.9), under: share(cell, r => r.margin < 0.01) })),
      drops: { day: drops(daily.filter(r => r.slot === 'day'), null), night: drops(daily.filter(r => r.slot === 'night'), null) },
      blatant: blatant(daily, raw),
      // Bottles daily picks never rank in the top 3, with the occasions that do.
      neverTop3: ids.filter(id => !inTop3.has(id)).map(id => [id, OCCASIONS.filter(o => occasions[o.id].some(r => weighs(o)(r) > 0 && r.top.includes(id))).map(o => o.id)]),
      shares: pickShares(daily, raw, ids),
    },
    occasions: {},
  };
  for (const o of OCCASIONS) {
    const use = useOf(o), weight = weighs(o);
    const rows = occasions[o.id];
    const picks = new Map();
    for (const r of rows) picks.set(raw(r), (picks.get(raw(r)) ?? 0) + weight(r));
    const total = [...picks.values()].reduce((a, b) => a + b, 0);
    const byBand = Object.fromEntries(BANDS.map(b => {
      const counts = new Map();
      for (const r of rows.filter(r => bandOf(r.feelsF) === b.id && weight(r) > 0)) counts.set(raw(r), (counts.get(raw(r)) ?? 0) + weight(r));
      const sum = [...counts.values()].reduce((a, c) => a + c, 0);
      const [id, w] = [...counts].sort((a, c) => c[1] - a[1])[0] ?? [];
      return [b.id, id ? { id, share: w / sum } : null];
    }));
    const flips = steadyFlips(rows, raw, weight);
    const hot = rows.filter(r => r.feelsF >= BLATANT_WARM_F);
    // Slots USES gives no share (Office at night) still count for the office guard and get their picks listed.
    const unweighted = Object.fromEntries(['day', 'night'].filter(slot => !use.slots[slot]).map(slot => {
      const counts = new Map();
      const inSlot = rows.filter(r => r.slot === slot);
      for (const r of inSlot) counts.set(raw(r), (counts.get(raw(r)) ?? 0) + 1);
      return [slot, [...counts].sort((a, b) => b[1] - a[1]).map(([id, n]) => [id, n / inSlot.length])];
    }));
    out.occasions[o.id] = {
      slots: use.slots,
      picks: [...picks].filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]).map(([id, w]) => [id, w / total]),
      byBand,
      margin: quantile(rows, r => r.margin, 0.5, weight),
      flips: (flips.day.flips + flips.night.flips) / ((flips.day.steady + flips.night.steady) || 1),
      drops: drops(rows, o, weight),
      blatant: blatant(rows, raw, weight),
      warmTop3Hot: share(hot, r => r.top.some(id => kind.get(id) === 'warm'), weight),
      unweighted,
    };
    if (o.id === 'office') {
      // test/engine.test.js pins nothing Sauvage-loud in the office's top 3,
      // day or night, nor a bottle that fades by lunch: here over real weather.
      const off = id => performanceLevel(byId.get(id), 'sillage') >= 0.2 || weakLongevity(byId.get(id));
      out.occasions.office.guard = Object.fromEntries(['day', 'night'].map(slot => {
        const inSlot = rows.filter(r => r.slot === slot);
        const hits = inSlot.filter(r => r.top.some(off));
        return [slot, { hits: hits.length, of: inSlot.length, examples: hits.slice(0, 3).map(r => `${r.city} ${r.dateISO} ${Math.round(r.feelsF)}°F ${r.top.map(id => byId.get(id).name).join(', ')}`) }];
      }));
    }
  }
  out.consensus = consensusCheck({ daily, occasions }, wardrobe);
  return out;
}

// ---------------------------------------------------------------------------
// Soft check: collector consensus. These ranges are one collector's judgment
// of the feels-like (°F) each of David's bottles is usually said to wear best
// in, from what the community says of it or of the bottle it copies, not data.
// They largely restate heaviness, and the 'mid' ones (Liam, Vintage Radio,
// Infini Rose) are arguable, so read them as a hint: never a test threshold,
// and nothing in data/. A warm bottle is never too cold, a fresh one never
// too hot.
export const CONSENSUS = {
  "Supremacy Collector's Edition Pour Homme": { range: [45, 88], kind: 'versatile' }, // Absolu Aventus clone: fruity-smoky, spring to fall
  'Détour Noir': { range: [30, 65], kind: 'warm' }, // Layton clone: fall and winter evenings
  'Aristo': { range: [55, 90], kind: 'fresh' }, // Ingenious Ginger clone: ginger-citrus, spring and summer days
  'Sandalwood & Musk': { range: [35, 72], kind: 'versatile' }, // a soft powdery skin scent, cool to mild
  'CH Men Prive': { range: [20, 58], kind: 'warm' }, // whiskey-leather, fall and winter nights
  'Sauvage': { range: [40, 92], kind: 'versatile' }, // the all-rounder
  'Sticky Fingers': { range: [25, 60], kind: 'warm' }, // leather-patchouli, fall and winter
  'Amber Empire': { range: [15, 55], kind: 'warm' }, // Blonde Amber clone: amber-vanilla, winter
  'Atlantis Extrait': { range: [68, 100], kind: 'fresh' }, // Wavechild clone: aquatic-coconut, summer
  'Essence de Blanc': { range: [60, 100], kind: 'fresh' }, // Imagination clone: citrus-tea, spring and summer
  'Glorious Oud Royal Blanc': { range: [50, 88], kind: 'fresh' }, // Musk Therapy clone: citrus-musk
  'Liquid Brun': { range: [15, 55], kind: 'warm' }, // Althaïr clone: vanilla-cinnamon, fall and winter
  'Jake': { range: [65, 98], kind: 'fresh' }, // fresh woody-citrus, summer
  'Cream Velvet': { range: [20, 55], kind: 'warm' }, // Bianco Latte clone: milky caramel, cold weather
  'Shiyaaka Sky': { range: [60, 95], kind: 'fresh' }, // Herbes Troublantes clone: green citrus musk
  'Liam': { range: [35, 68], kind: 'mid' }, // Gris Charnel clone: fig-cardamom-tea, fall and spring
  'Vintage Radio': { range: [35, 68], kind: 'mid' }, // Paragon clone: lavender-woody, fall and spring
  'Infini Rose': { range: [35, 68], kind: 'mid' }, // Atomic Rose clone: spicy rose, fall and spring
  'Legacy': { range: [55, 90], kind: 'fresh' }, // Blue Talisman clone: pear-musk, spring and summer
  'Meant To Be Seen': { range: [42, 75], kind: 'mid' }, // powdery iris, spring and fall
  'Rifaaqat': { range: [20, 55], kind: 'warm' }, // Babycat clone: suede-vanilla, fall and winter
  'Zahri Amara': { range: [55, 85], kind: 'fresh' }, // Floraïku clone: fruity floral
  'Hawas Elixir': { range: [15, 52], kind: 'warm' }, // Le Male Elixir clone: honey-vanilla-tobacco, winter
  'Cedrus Blanc': { range: [45, 85], kind: 'fresh' }, // aldehydic cedar-citrus, spring to fall
  'Terra': { range: [25, 58], kind: 'warm' }, // amber-spice, fall and winter
};

/** How far (°F) feelsF sits outside the bottle's consensus range: 0 inside, null without one. */
export function outside(name, feelsF) {
  const c = CONSENSUS[name];
  if (!c) return null;
  const lo = c.kind === 'warm' ? -Infinity : c.range[0];
  const hi = c.kind === 'fresh' ? Infinity : c.range[1];
  return feelsF < lo ? feelsF - lo : feelsF > hi ? feelsF - hi : 0;
}

// comfortRange's scan, where an open end is read (a range that opens up
// mustn't drop out of the error).
const SCAN = [0, 105];

function consensusCheck({ daily, occasions }, wardrobe) {
  const nameOf = new Map(wardrobe.map(f => [f.id, f.name]));
  const off = (rows, pickOf, by, weight) => share(rows, r => Math.abs(outside(nameOf.get(pickOf(r)), r.feelsF) ?? 0) >= by, weight);
  const ends = [];
  let closed = 0;
  for (const f of wardrobe) {
    const c = comfortRange(f), cons = CONSENSUS[f.name];
    if (!cons) continue;
    if (c.lowF != null && c.highF != null) closed++;
    if (cons.kind !== 'warm') ends.push({ name: f.name, end: 'low', open: c.lowF == null, engine: c.lowF ?? SCAN[0], consensus: cons.range[0] });
    if (cons.kind !== 'fresh') ends.push({ name: f.name, end: 'high', open: c.highF == null, engine: c.highF ?? SCAN[1], consensus: cons.range[1] });
  }
  const miss = e => Math.abs(e.engine - e.consensus);
  return {
    without: wardrobe.filter(f => !CONSENSUS[f.name]).map(f => f.name),
    now: { off5: off(daily, r => r.now, 5), off10: off(daily, r => r.now, 10) },
    raw: { off5: off(daily, r => r.top[0], 5), off10: off(daily, r => r.top[0], 10) },
    occasions: Object.fromEntries(OCCASIONS.map(o => {
      const use = USES.find(u => u.occasion === o.id);
      return [o.id, off(occasions[o.id], r => r.top[0], 10, r => useWeight(use, r.slot, bandOf(r.feelsF)))];
    })),
    comfort: {
      error: mean(ends.map(miss)), ends: ends.length, open: ends.filter(e => e.open).length,
      closedError: mean(ends.filter(e => !e.open).map(miss)), closedBoth: closed,
      worst: ends.toSorted((a, b) => miss(b) - miss(a)).slice(0, 6),
    },
  };
}

// ---------------------------------------------------------------------------
// --save and --against

/** What --save keeps of each window: Raw's top 3, Now's pick and each occasion's top 3. */
export function snapshotWindows({ daily, occasions }) {
  const out = {};
  const key = r => `${r.city} ${r.dateISO} ${r.slot}`;
  for (const r of daily) out[key(r)] = { daily: r.top, now: r.now };
  for (const [id, rows] of Object.entries(occasions)) for (const r of rows) (out[key(r)] ??= {})[id] = r.top;
  return out;
}

/**
 * Per list (daily, now, each occasion) and slot, how many windows changed
 * their top pick and their top 3 (as a set), and the commonest moves of the
 * top pick: { 'office day': { of, top1, top3, moves: [[from, to, n]] } }.
 */
export function diffWindows(before, after) {
  const out = {};
  for (const [key, now] of Object.entries(after)) {
    const was = before[key];
    if (!was) continue;
    const slot = key.split(' ').at(-1);
    for (const [list, picks] of Object.entries(now)) {
      if (!(list in was)) continue;
      const d = (out[`${list} ${slot}`] ??= { of: 0, top1: 0, top3: 0, moves: new Map() });
      const [a, b] = [[].concat(was[list]), [].concat(picks)];
      d.of++;
      if (a[0] !== b[0]) {
        d.top1++;
        const move = `${a[0]} ${b[0]}`;
        d.moves.set(move, (d.moves.get(move) ?? 0) + 1);
      }
      if (a.length > 1 && a.toSorted().join() !== b.toSorted().join()) d.top3++;
    }
  }
  for (const d of Object.values(out)) d.moves = [...d.moves].sort((x, y) => y[1] - x[1]).map(([m, n]) => [...m.split(' '), n]);
  return out;
}

// The gap finder's answer as `recommend.mjs --gaps --json` gives it, cut to what a diff reads.
function gapsSnapshot() {
  const run = spawnSync(process.execPath, [fileURLToPath(new URL('./recommend.mjs', import.meta.url)), '--gaps', '--json'], { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`The gap finder failed: ${run.stderr.trim()}`);
  const r = JSON.parse(run.stdout);
  return {
    overview: r.overview.text,
    cells: Object.fromEntries(r.coverage.map(c => [c.cell, { status: c.status, top: c.top.map(t => t.name) }])),
    gaps: r.gaps.map(g => `${g.title} (${g.status})`),
    strengths: r.strengths.map(s => s.title),
    picks: r.picks.map(p => p.name),
  };
}

function gapsDiff(before, after) {
  const lines = [];
  if (before.overview !== after.overview) lines.push(`Overview: "${before.overview}" -> "${after.overview}"`);
  for (const [cell, now] of Object.entries(after.cells)) {
    const was = before.cells[cell];
    if (!was) continue;
    if (was.status !== now.status) lines.push(`${cell}: ${was.status} -> ${now.status}`);
    if (was.top[0] !== now.top[0]) lines.push(`${cell}: best ${was.top[0] ?? '-'} -> ${now.top[0] ?? '-'}`);
  }
  const listDiff = (label, a, b) => {
    const gone = a.filter(x => !b.includes(x)), added = b.filter(x => !a.includes(x));
    if (gone.length || added.length) lines.push(`${label}: ${[...gone.map(x => `-${x}`), ...added.map(x => `+${x}`)].join(', ')}`);
  };
  listDiff('Gaps', before.gaps, after.gaps);
  listDiff('Strengths', before.strengths, after.strengths);
  if (before.picks.join() !== after.picks.join()) lines.push(`Picks: ${before.picks.join(', ') || 'none'} -> ${after.picks.join(', ') || 'none'}`);
  return lines;
}

// ---------------------------------------------------------------------------
// The report

const pct = x => (x == null ? '-' : `${(100 * x).toFixed(1)}%`);
const whole = x => (x == null ? '-' : `${Math.round(100 * x)}`);
const list = words => (words.length <= 2 ? words.join(' and ') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`);
const short = name => (name.length > 22 ? `${name.slice(0, 21)}…` : name);
const title = id => occasionById(id)?.label ?? (id === 'daily' ? 'Daily (Raw)' : id === 'now' ? 'Daily (Now)' : id);

/** The figures as [label, text] lines, the ones --against compares. */
function headline(fig, nameOf) {
  const stretch = s => `${nameOf(s.id)} ${s.count}/${s.of} (${s.city} from ${s.from}, ${Math.round(s.feelsF)}°F, ${s.distinct} bottles)`;
  const pair = d => `${d.day.toFixed(1)} by day, ${d.night.toFixed(1)} by night`;
  const flips = f => `${pct(f.day.flips / f.day.steady)} by day, ${pct(f.night.flips / f.night.steady)} by night`;
  const blatant = b => `${b.warm} warm at ${BLATANT_WARM_F}°F+, ${b.fresh} fresh at ${BLATANT_FRESH_F}°F or below${b.share ? ` (${pct(b.share)})` : ''}`;
  const cold = fig.now.loss.bySlotBand;
  const lines = [
    ['Now: most-worn bottle in any 28 days', stretch(fig.now.worst)],
    ['Raw: most-picked bottle in any 28 days', stretch(fig.raw.worst)],
    ['Now: distinct bottles per 14 days', pair(fig.now.distinct)],
    ['Raw: distinct bottles per 14 days', pair(fig.raw.distinct)],
    [`Now: picks losing more than ${LOSS} to the window's best`, `${pct(fig.now.loss.over)} (cold days ${pct(cold['day:cold']?.over)}, cold nights ${pct(cold['night:cold']?.over)}); median loss ${fig.now.loss.median.toFixed(3)}`],
    ['Now: nudged picks', String(fig.now.nudged)],
    ['Raw: top pick changes in steady weather', flips(fig.raw.flips)],
    ['Raw: blatant misfits', blatant(fig.raw.blatant)],
    ['Now: blatant misfits', blatant(fig.now.blatant)],
    ['Raw: never in a top 3', fig.raw.neverTop3.map(([id, occ]) => `${nameOf(id)}${occ.length ? ` (but in ${list(occ.map(o => `${title(o)}'s`))})` : ''}`).join(', ') || 'none'],
    ...['day', 'night'].map(slot => [`Raw: top pick changes without each part, by ${slot}`, Object.entries(fig.raw.drops[slot]).map(([k, v]) => `${k} ${pct(v)}`).join(', ')]),
    ...['day', 'night'].map(slot => [`Raw: lead over the second, median by band, ${slot}`, BANDS.map(b => fig.raw.margins[`${slot}:${b.id}`]).map((m, i) => `${BANDS[i].id} ${m ? m.median.toFixed(3) : '-'}`).join(', ')]),
  ];
  for (const o of OCCASIONS) {
    const x = fig.occasions[o.id];
    const top = x.picks.slice(0, 3).map(([id, s]) => `${nameOf(id)} ${pct(s)}`).join(', ');
    lines.push([`${o.label}: top picks`, `${top} (${x.picks.length} bottles)`]);
    lines.push([`${o.label}: misfits`, `${blatant(x.blatant)}; a warm bottle in the top 3 at ${BLATANT_WARM_F}°F+ ${pct(x.warmTop3Hot)}`]);
    if (x.guard) lines.push([`${o.label}: loud or fast-fading in the top 3`, ['day', 'night'].map(s => `${x.guard[s].hits} of ${x.guard[s].of} ${s}s`).join(', ')]);
  }
  const c = fig.consensus;
  lines.push(['Soft: picks 10°F+ outside consensus', `Now ${pct(c.now.off10)}, Raw ${pct(c.raw.off10)}`]);
  lines.push(['Soft: comfortRange miss', `${c.comfort.error.toFixed(1)}°F over ${c.comfort.ends} ends (${c.comfort.open} open)`]);
  return lines;
}

function report(fig, { wardrobe, cities, from, to }) {
  const byId = new Map(wardrobe.map(f => [f.id, f]));
  const nameOf = id => byId.get(id)?.name ?? id;
  const out = [];
  const log = (...xs) => out.push(xs.join(' '));
  const clear = cities.filter(c => !c.full).map(c => c.name);
  log(`# Backtest: ${cities.map(c => c.name).join(', ')}, ${from} to ${to}: ${fig.windows.toLocaleString('en-US')} day and night windows${clear.length ? ` (${clear.join(', ')} without weather codes: every window clear)` : ''}`);
  log('Now plans each day and night together like the app\'s Now, nudge on, and assumes every pick is worn; Raw ranks each window alone, no history.');
  log(`Warm bottles (two thirds fall and winter votes): ${fig.kinds.warm.join(', ')}`);
  log(`Fresh bottles (two thirds spring and summer votes): ${fig.kinds.fresh.join(', ')}`);

  log('\n## Headline');
  for (const [label, text] of headline(fig, nameOf).filter(([l]) => /^(Now|Raw)/.test(l))) log(`  ${label}: ${text}`);
  for (const b of [fig.now.blatant, fig.raw.blatant]) if (b.examples.length) log(`  e.g. ${b.examples.join('; ')}`);

  log('\n## Raw: lead of the top pick over the second, and Now: picks losing more than', String(LOSS));
  log(`  ${'slot band'.padEnd(12)} ${'windows'.padStart(7)} ${'median'.padStart(7)} ${'p90'.padStart(6)} ${'<0.01'.padStart(6)} ${'Now loss'.padStart(9)}`);
  for (const slot of ['day', 'night']) {
    for (const b of BANDS) {
      const m = fig.raw.margins[`${slot}:${b.id}`];
      if (!m) continue;
      log(`  ${`${slot} ${b.id}`.padEnd(12)} ${String(m.windows).padStart(7)} ${m.median.toFixed(3).padStart(7)} ${m.p90.toFixed(3).padStart(6)} ${pct(m.under).padStart(6)} ${pct(fig.now.loss.bySlotBand[`${slot}:${b.id}`].over).padStart(9)}`);
    }
  }

  log('\n## Share of picks by band (%), Now | Raw');
  log(`  ${'bottle'.padEnd(22)} ${'all'.padStart(9)}  ${BANDS.map(b => b.id.padStart(9)).join(' ')}`);
  const both = (n, r) => `${(n ? whole(n) : '.').padStart(4)}|${(r ? whole(r) : '.').padEnd(4)}`;
  for (const id of wardrobe.map(f => f.id).toSorted((a, b) => fig.now.shares[b].all - fig.now.shares[a].all)) {
    const n = fig.now.shares[id], r = fig.raw.shares[id];
    log(`  ${short(nameOf(id)).padEnd(22)} ${both(n.all, r.all)}  ${BANDS.map(b => both(n.band[b.id], r.band[b.id])).join(' ')}`);
  }

  log(`\n## Share of Now picks by month (%), ${fig.now.monthsOver}`);
  log(`  ${'bottle'.padEnd(22)} ${Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(4)).join('')}`);
  for (const id of wardrobe.map(f => f.id).toSorted((a, b) => fig.now.months[b].all - fig.now.months[a].all)) {
    log(`  ${short(nameOf(id)).padEnd(22)} ${fig.now.months[id].month.map(s => (s ? whole(s) : '.').padStart(4)).join('')}`);
  }

  log('\n## Occasions, each ranked alone on both slots, weighted by gaps.js USES');
  for (const o of OCCASIONS) {
    const x = fig.occasions[o.id];
    const slots = Object.entries(x.slots).map(([s, w]) => `${s} ${Math.round(w * 100)}%`).join(', ');
    log(`${o.label} (${slots})`);
    log(`  picks: ${x.picks.slice(0, 5).map(([id, s]) => `${nameOf(id)} ${pct(s)}`).join(', ')} (${x.picks.length} bottles)`);
    log(`  by band: ${BANDS.filter(b => x.byBand[b.id]).map(b => `${b.id} ${nameOf(x.byBand[b.id].id)} ${pct(x.byBand[b.id].share)}`).join(', ')}`);
    log(`  lead over the second ${x.margin.toFixed(3)} (median); changes in steady weather ${pct(x.flips)}; without each part: ${Object.entries(x.drops).map(([k, v]) => `${k} ${pct(v)}`).join(', ')}`);
    const weighed = x.blatant.share ? `, ${pct(x.blatant.share)} of its weight, e.g. ${x.blatant.examples.join('; ')}` : '';
    log(`  misfits: ${x.blatant.warm} warm at ${BLATANT_WARM_F}°F+, ${x.blatant.fresh} fresh at ${BLATANT_FRESH_F}°F or below${weighed}; a warm bottle in the top 3 at ${BLATANT_WARM_F}°F+ ${pct(x.warmTop3Hot)}`);
    for (const [slot, picks] of Object.entries(x.unweighted)) {
      log(`  by ${slot} (no share in USES, unweighted): ${picks.slice(0, 4).map(([id, s]) => `${nameOf(id)} ${pct(s)}`).join(', ')}`);
    }
    if (x.guard) {
      for (const slot of ['day', 'night']) {
        const g = x.guard[slot];
        log(`  loud (Sauvage and up) or fast-fading in the top 3 by ${slot}: ${g.hits} of ${g.of}${g.examples.length ? `, e.g. ${g.examples.join('; ')}` : ''}`);
      }
    }
  }

  const c = fig.consensus;
  log('\n## Soft check: collector consensus (one collector\'s judgment, kept in this script; a hint, never a threshold)');
  if (c.without.length) log(`  No range for: ${c.without.join(', ')}`);
  log(`  Daily picks 5°F+ / 10°F+ outside the range: Now ${pct(c.now.off5)} / ${pct(c.now.off10)}, Raw ${pct(c.raw.off5)} / ${pct(c.raw.off10)}`);
  log(`  Occasions 10°F+ outside (weighted): ${OCCASIONS.map(o => `${o.label} ${pct(c.occasions[o.id])}`).join(', ')}`);
  log(`  comfortRange: ${c.comfort.error.toFixed(1)}°F mean miss over ${c.comfort.ends} ends, ${c.comfort.open} open (read at the scan's edge, ${SCAN[0]} or ${SCAN[1]}°F); ${c.comfort.closedError.toFixed(1)}°F over the closed ones; ${c.comfort.closedBoth} ranges closed at both ends`);
  log(`  Widest misses: ${c.comfort.worst.map(e => `${e.name} ${e.end} ${e.open ? `open (${e.engine})` : e.engine} vs ${e.consensus}`).join(', ')}`);
  return out.join('\n');
}

function againstReport(before, now, nameOf) {
  const out = [];
  const log = (...xs) => out.push(xs.join(' '));
  log(`\n## Against ${before.file} (saved ${before.made})`);
  if (before.cities.join() !== now.cities.join() || before.from !== now.from || before.to !== now.to) {
    log(`  Saved for ${before.cities.join(', ')}, ${before.from} to ${before.to}; only the windows both runs have are compared.`);
  }
  const was = new Map(before.headline);
  const changed = now.headline.filter(([label, text]) => was.has(label) && was.get(label) !== text);
  log(changed.length ? '  Figures that moved:' : '  No headline figure moved.');
  for (const [label, text] of changed) log(`    ${label}: ${was.get(label)}\n      -> ${text}`);
  const diff = diffWindows(before.windows, now.windows);
  const lists = ['daily', 'now', ...OCCASIONS.map(o => o.id)];
  log('  Windows whose pick moved (top pick / top 3; Now\'s picks cascade, as each one changes the rotation after it):');
  const still = [];
  for (const list of lists) {
    const parts = ['day', 'night'].map(slot => [slot, diff[`${list} ${slot}`]]).filter(([, d]) => d);
    if (!parts.length) continue;
    if (parts.every(([, d]) => !d.top1 && !d.top3)) { still.push(title(list)); continue; }
    const counts = parts.map(([slot, d]) => `${slot} ${d.top1}${list === 'now' ? '' : ` / ${d.top3}`} of ${d.of}`).join(', ');
    log(`    ${title(list)}: ${counts}`);
    const moves = parts.flatMap(([slot, d]) => d.moves.slice(0, 3).map(([a, b, n]) => `${slot} ${nameOf(a)} -> ${nameOf(b)} ${n}`));
    if (moves.length) log(`      ${moves.join('; ')}`);
  }
  if (still.length) log(`    No window moved: ${still.join(', ')}`);
  if (now.gaps && before.gaps) {
    const lines = gapsDiff(before.gaps, now.gaps);
    log(lines.length ? '  The gap finder (recommend.mjs --gaps):' : '  The gap finder\'s answer is the same.');
    for (const l of lines) log(`    ${l}`);
  } else if (now.gaps) log(`  ${before.file} has no gap finder answer to compare (save it with --gaps).`);
  return out.join('\n');
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function main() {
  let args;
  try {
    ({ values: args } = parseArgs({
      options: {
        cities: { type: 'string', default: DEFAULT_CITIES },
        from: { type: 'string', default: YEARS[0] },
        to: { type: 'string', default: YEARS[1] },
        fetch: { type: 'boolean', default: false },
        save: { type: 'string' },
        against: { type: 'string' },
        gaps: { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
      },
    }));
  } catch (err) {
    fail(`${err.message}\nusage: node scripts/backtest.mjs [--cities "Chicago,New York"] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--save FILE | --against FILE] [--gaps] [--json] [--fetch]`);
  }
  const { from, to } = args;
  for (const d of [from, to]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d < YEARS[0] || d > YEARS[1]) fail(`${d} isn't a date from ${YEARS[0]} to ${YEARS[1]}, the years the weather is saved for.`);
  }
  if (from > to) fail(`--from ${from} comes after --to ${to}.`);
  if (shiftDays(from, STRETCH_DAYS - 1) > to) fail(`The replay needs ${STRETCH_DAYS} days or more (--from ${from} --to ${to}).`);

  const known = new Map(Object.keys(CITIES).map(n => [cityStem(n).toLowerCase(), n]));
  const cities = [];
  for (const typed of args.cities.split(',').map(s => s.trim()).filter(Boolean)) {
    const name = known.get(cityStem(typed).toLowerCase()) ?? typed;
    if (args.fetch && !existsSync(cityFile(name, 'full'))) {
      console.error(`Fetching ${name}'s weather from Open-Meteo's archive…`);
      try { await fetchCity(name); } catch (err) { console.error(err.message); }
    }
    const city = loadCity(name);
    if (!city) {
      fail(`No weather saved for ${name} in .cache/climate/ (${cityStem(name)}-full-${YEARS.join('_')}.json, or fit-gaps.mjs's -dew- file). `
        + (CITIES[name] ? 'Run with --fetch to download it (one Open-Meteo archive call).' : `--fetch knows ${Object.keys(CITIES).join(', ')}.`));
    }
    cities.push({ name, full: city.full, lat: city.forecast.latitude });
  }
  if (!cities.length) fail('Give one or more cities with --cities.');

  let before = null;
  if (args.against) {
    try { before = { ...JSON.parse(readFileSync(args.against, 'utf8')), file: args.against }; } catch { fail(`Can't read ${args.against} (made with --save).`); }
    if (!before.windows || !before.headline) fail(`${args.against} isn't a backtest --save file.`);
  }

  const wardrobe = loadWardrobe();
  const nameOf = id => wardrobe.find(f => f.id === id)?.name ?? before?.names?.[id] ?? id;
  const rows = await replayAll(cities.map(c => c.name), from, to);
  const latOf = name => cities.find(c => c.name === name).lat;
  const fig = figures(rows, wardrobe, { latOf });
  const now = {
    made: new Date().toISOString().slice(0, 10), cities: cities.map(c => c.name), from, to,
    names: Object.fromEntries(wardrobe.map(f => [f.id, f.name])),
    headline: headline(fig, nameOf), windows: snapshotWindows(rows),
    ...(args.gaps && { gaps: gapsSnapshot() }),
  };

  if (args.json) {
    const diff = before && { windows: diffWindows(before.windows, now.windows), ...(now.gaps && before.gaps && { gaps: gapsDiff(before.gaps, now.gaps) }) };
    console.log(JSON.stringify({ cities, from, to, names: now.names, figures: fig, ...(now.gaps && { gaps: now.gaps }), ...(diff && { against: diff }) }, null, 1));
  } else {
    console.log(report(fig, { wardrobe, cities, from, to }));
    if (now.gaps && !before) {
      const statuses = Object.values(now.gaps.cells).reduce((m, c) => ({ ...m, [c.status]: (m[c.status] ?? 0) + 1 }), {});
      console.log(`\n## The gap finder (recommend.mjs --gaps)\n  ${now.gaps.overview}\n  Cells by status, listed or too rare to list: ${Object.entries(statuses).map(([s, n]) => `${n} ${s}`).join(', ')}\n  Listed: ${now.gaps.gaps.join('; ') || 'none'}\n  Picks: ${now.gaps.picks.join(', ') || 'none'}`);
    }
    if (before) console.log(againstReport(before, now, nameOf));
  }
  if (args.save) {
    writeFileSync(args.save, JSON.stringify(now));
    console.error(`Saved ${Object.keys(now.windows).length.toLocaleString('en-US')} windows' picks${now.gaps ? ' and the gap finder\'s answer' : ''} to ${args.save}`);
  }
}

if (!isMainThread && workerData?.backtest) serve();
else if (import.meta.main) await main();
