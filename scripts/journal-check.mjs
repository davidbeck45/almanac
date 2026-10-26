#!/usr/bin/env node
// How the engine's picks line up with what was actually worn.
//   node scripts/journal-check.mjs scentcast-journal-2026-10-03.json [--fit] [--json]
//
// Takes the file from the wear journal's Export button. For each logged wear
// it looks up that window's weather where it was worn (Open-Meteo's archive,
// or its forecast API for the last few days the archive lacks), ranks the
// wardrobe the app was choosing from (the demo minus the device's hidden
// bottles, with the export's own ratings and skin nudges) for the occasion
// it was logged for, with the earlier wears as rotation, and reports where
// the worn bottle landed. Wears of bottles outside the demo are skipped, and
// so are wears whose weather couldn't load (counted). --fit adds the
// thermostat: the feels-like offset that best explains what was worn, by
// day and night and over the wears that weren't the top pick, to tell
// whether he runs warm or cold (only a report: nothing applies it yet).
// Weather data by Open-Meteo.com (CC BY 4.0).
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { rank } from '../src/engine.js';
import { windowOn, forecastError, requestError } from '../src/weather.js';
import { parseJournal } from '../src/history.js';
import { occasionById } from '../src/occasions.js';
import { applySkin } from '../src/skin.js';

const HOURLY = 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code';
const DAY_MS = 86_400_000;
const isoDaysAgo = n => new Date(Date.now() - n * DAY_MS).toISOString().slice(0, 10);

async function getJSON(url, service) {
  let res;
  try {
    res = await fetch(url);
  } catch {
    throw Object.assign(new Error('fetch failed'), { service });
  }
  if (!res.ok) throw await requestError(res, service);
  return res.json();
}

// Hourly weather at one place over [from, to], archive first, recent days
// from the forecast API. A request that fails leaves its days out (their
// wears count as without weather), its error in `errors`.
async function hourlyAt(lat, lon, from, to) {
  const base = { latitude: lat, longitude: lon, hourly: HOURLY, temperature_unit: 'fahrenheit', timezone: 'auto' };
  const parts = [], errors = [];
  const get = (url, service) => getJSON(url, service).then(p => parts.push(p), err => errors.push(err));
  const archiveEnd = to < isoDaysAgo(5) ? to : isoDaysAgo(5);
  if (from <= archiveEnd) {
    await get(`https://archive-api.open-meteo.com/v1/archive?${new URLSearchParams({ ...base, start_date: from, end_date: archiveEnd })}`, 'archive');
  }
  if (to > isoDaysAgo(8)) {
    await get(`https://api.open-meteo.com/v1/forecast?${new URLSearchParams({ ...base, past_days: 10, forecast_days: 1 })}`, 'forecast');
  }
  // Merge by hour, keeping the first source with a value.
  const rows = new Map();
  for (const p of parts) {
    p.hourly.time.forEach((t, i) => {
      if (rows.has(t) || p.hourly.apparent_temperature[i] === null) return;
      rows.set(t, Object.fromEntries(HOURLY.split(',').map(k => [k, p.hourly[k][i]])));
    });
  }
  const time = [...rows.keys()].sort();
  return {
    latitude: parts[0]?.latitude ?? lat,
    hourly: { time, ...Object.fromEntries(HOURLY.split(',').map(k => [k, time.map(t => rows.get(t)[k])])) },
    errors,
  };
}

// Logged wears in time order, plans left out.
export const journalWears = journal => [...journal.history].filter(h => !h.planned)
  .sort((a, b) => (a.date + a.slot).localeCompare(b.date + b.slot));

const placeOf = (journal, h) => (h.lat !== undefined ? { lat: h.lat, lon: h.lon } : journal.location);

// The wears a check can rank, each with what the app was choosing from: the
// demo minus the device's hidden bottles (the worn one always in), with the
// export's ratings and skin nudges, for the occasion it was logged for, the
// earlier wears as rotation. Counts the ones it can't in `skipped`.
function* rankable(journal, demo, windowFor, skipped) {
  // The app keeps ids as strings (main.js, history.js); data/collection.json has numbers.
  const bottles = applySkin(demo.map(f => (typeof f.id === 'string' ? f : { ...f, id: String(f.id) })), journal.skin ?? {});
  const byId = new Map(bottles.map(f => [f.id, f]));
  const hidden = new Set(journal.hidden);
  const wears = journalWears(journal);
  for (const [i, h] of wears.entries()) {
    const worn = byId.get(h.id);
    if (!worn) { skipped.notInDemo++; continue; }
    const at = placeOf(journal, h);
    if (!at) { skipped.noPlace++; continue; }
    const win = windowFor(h, at);
    if (!win) { skipped.noWeather++; continue; }
    const pool = bottles.filter(f => !hidden.has(f.id) || f === worn);
    const occasion = h.occasion && h.occasion !== 'daily' ? occasionById(h.occasion) ?? null : null;
    yield { h, worn, win, pool, occasion, opts: { occasion, history: wears.slice(0, i), todayISO: h.date } };
  }
}

/**
 * Where each wear's bottle landed, ranked as the app would have: the demo
 * minus the device's hidden bottles, with the export's ratings and skin
 * nudges, for the occasion the wear was logged for (Occasion's list; Today
 * and the Week log 'daily'), the earlier wears as rotation.
 * journal: parseJournal's shape. windowFor(wear, place) -> weather window or null.
 * -> { rows, skipped }
 */
export function rankWears(journal, demo, windowFor) {
  const rows = [], skipped = { notInDemo: 0, noPlace: 0, noWeather: 0 };
  for (const { h, worn, win, pool, occasion, opts } of rankable(journal, demo, windowFor, skipped)) {
    const ranked = rank(pool, win, h.slot, opts);
    const at1 = ranked.findIndex(r => r.fragrance === worn) + 1;
    const entry = ranked[at1 - 1];
    rows.push({
      date: h.date, slot: h.slot, occasion: occasion?.id ?? null, feelsF: Math.round(win.feelsF), dewF: Math.round(win.dewF), condition: win.condition,
      worn: worn.name, rank: at1, of: ranked.length, tier: entry.tier, top: ranked[0].fragrance.name,
      reasons: entry.reasons.map(r => `${r.tone === 'good' ? '+' : '-'} ${r.text}`),
    });
  }
  return { rows, skipped };
}

// ---------- The thermostat (--fit) ----------
// Does he run warm or cold? Each wear's choice is re-ranked as if it felt Δ
// warmer (feels-like + Δ, nothing else moved), and a conditional logit asks
// which Δ best explains the bottles he wore: P(worn) = exp(β·score) over the
// sum for every bottle he could have worn, its sharpness β fitted for each Δ.
// Δ > 0: he reaches for what the engine picks on warmer days (runs warm, wants
// it fresher); Δ < 0, colder (runs cold, wants it richer).
export const FIT_OFFSETS = Object.freeze(Array.from({ length: 17 }, (_, i) => -16 + 2 * i));
// Half the 95% chi-square (1 df): Δs whose log-likelihood is within this of the best.
const LR_HALF_95 = 1.92;
// Fewer wears than this say nothing.
export const FIT_MIN_WEARS = 10;

/**
 * Each rankable wear's scores at every offset: { slot, top (the pick at
 * Δ = 0, as rankWears' rank 1), worn, scores: [offset][bottle] }, bottles
 * by their index in the wear's own pool.
 */
export function wearChoices(journal, demo, windowFor, offsets = FIT_OFFSETS) {
  const out = [], skipped = { notInDemo: 0, noPlace: 0, noWeather: 0 };
  for (const { h, worn, win, pool, opts } of rankable(journal, demo, windowFor, skipped)) {
    const index = new Map(pool.map((f, k) => [f, k]));
    const base = rank(pool, win, h.slot, opts);
    const scores = offsets.map(d => {
      const row = new Array(pool.length);
      for (const r of d ? rank(pool, { ...win, feelsF: win.feelsF + d }, h.slot, opts) : base) row[index.get(r.fragrance)] = r.score;
      return row;
    });
    const top = index.get(base[0].fragrance);
    out.push({ slot: h.slot, top, worn: index.get(worn), scores });
  }
  return { choices: out, skipped };
}

// The log-likelihood of the wears at one offset, β at its best (Newton's
// method: the likelihood is concave in β). `drop` leaves each wear's top
// pick out of what he chose from.
function logLik(choices, o, drop) {
  let beta = 60;
  const at = b => {
    let ll = 0, g = 0, hess = 0;
    for (const c of choices) {
      const s = c.scores[o];
      const keep = k => !(drop && k === c.top);
      let m = -Infinity;
      for (let k = 0; k < s.length; k++) if (keep(k)) m = Math.max(m, b * s[k]);
      let z = 0, mean = 0, sq = 0;
      for (let k = 0; k < s.length; k++) {
        if (!keep(k)) continue;
        const e = Math.exp(b * s[k] - m);
        z += e; mean += e * s[k]; sq += e * s[k] * s[k];
      }
      mean /= z;
      ll += b * s[c.worn] - m - Math.log(z);
      g += s[c.worn] - mean;
      hess -= sq / z - mean * mean;
    }
    return { ll, g, hess };
  };
  for (let i = 0; i < 50; i++) {
    const { g, hess } = at(beta);
    if (hess >= 0) break;
    const next = Math.max(0, beta - g / hess);
    if (Math.abs(next - beta) < 1e-6) { beta = next; break; }
    beta = next;
  }
  return at(beta).ll;
}

/**
 * The offset that best explains `choices` (wearChoices'), on FIT_OFFSETS:
 * { offset (to the degree, between grid points by a parabola through the
 * best three), low, high (where the likelihood falls 1.92 below its best:
 * about a 95% interval; null past the grid's end), n }, or { n } with too
 * few wears. `overrides` fits only the wears that weren't the top pick, each
 * against the bottles other than that pick.
 */
export function fitOffset(choices, { offsets = FIT_OFFSETS, overrides = false } = {}) {
  const used = overrides ? choices.filter(c => c.worn !== c.top) : choices;
  if (used.length < FIT_MIN_WEARS) return { n: used.length };
  const ll = offsets.map((_, o) => logLik(used, o, overrides));
  const b = ll.indexOf(Math.max(...ll));
  let offset = offsets[b];
  if (b > 0 && b < offsets.length - 1) {
    const [l0, l1, l2] = [ll[b - 1], ll[b], ll[b + 1]];
    const curve = l0 - 2 * l1 + l2;
    if (curve < 0) offset += ((l0 - l2) / (2 * curve)) * (offsets[b + 1] - offsets[b]);
  }
  const floor = ll[b] - LR_HALF_95;
  // Where the likelihood crosses the floor, walking out from the best.
  const cross = step => {
    for (let k = b; k + step >= 0 && k + step < offsets.length; k += step) {
      if (ll[k + step] < floor) return offsets[k] + ((ll[k] - floor) / (ll[k] - ll[k + step])) * (offsets[k + step] - offsets[k]);
    }
    return null;
  };
  return { offset: Math.round(offset), low: cross(-1) === null ? null : Math.round(cross(-1)), high: cross(1) === null ? null : Math.round(cross(1)), n: used.length };
}

/** The thermostat report: all wears, by day and by night, and the overrides. */
export function thermostat(choices) {
  return {
    all: fitOffset(choices),
    day: fitOffset(choices.filter(c => c.slot === 'day')),
    night: fitOffset(choices.filter(c => c.slot === 'night')),
    overrides: fitOffset(choices, { overrides: true }),
  };
}

const signed = d => (d > 0 ? `+${d}` : String(d));
// "+6°F (+2 to +10)", or why there's no answer.
function fitText(f) {
  if (f.offset === undefined) return `too few wears to say (${f.n})`;
  if (f.low === null && f.high === null) return `can't tell: any offset explains them about as well, ${f.n} wears`;
  const lo = f.low === null ? `${signed(FIT_OFFSETS[0])} or lower` : signed(f.low);
  const hi = f.high === null ? `${signed(FIT_OFFSETS.at(-1))} or higher` : signed(f.high);
  return `${signed(f.offset)}°F (about ${lo} to ${hi}), ${f.n} wears`;
}
// What the fit over every wear says, in a sentence.
function fitReading(f) {
  if (f.offset === undefined) return 'Too few wears to tell yet.';
  if (f.low === null && f.high === null) return 'These wears don’t follow the weather closely enough to show a lean.';
  const holdsZero = (f.low === null || f.low <= 0) && (f.high === null || f.high >= 0);
  if (holdsZero) return 'No clear lean: the engine’s feels-like reads you about right.';
  return f.offset > 0
    ? `You reach for what it picks on days about ${f.offset}°F warmer: you run warm, or like it fresher than the crowd.`
    : `You reach for what it picks on days about ${-f.offset}°F colder: you run cold, or like it richer than the crowd.`;
}

export function summarizeRows(rows, skipped) {
  const mean = xs => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const share = pred => rows.length ? Math.round((100 * rows.filter(pred).length) / rows.length) : 0;
  return {
    wears: rows.length,
    skipped,
    meanRank: +mean(rows.map(r => r.rank)).toFixed(1),
    randomMeanRank: +mean(rows.map(r => (r.of + 1) / 2)).toFixed(1),
    topPickPct: share(r => r.rank === 1),
    tierSPct: share(r => r.tier === 'S'),
    tierSorAPct: share(r => r.tier === 'S' || r.tier === 'A'),
  };
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function main() {
  let args, file;
  try {
    ({ values: args, positionals: [file] } = parseArgs({ allowPositionals: true, options: { json: { type: 'boolean', default: false }, fit: { type: 'boolean', default: false } } }));
  } catch (err) {
    fail(`${err.message}\n${USAGE}`);
  }
  if (!file) fail(USAGE);
  let text, journal = null;
  try { text = readFileSync(file, 'utf8'); } catch { fail(`Can't read ${file}`); }
  try { journal = parseJournal(JSON.parse(text)); } catch {}
  if (!journal) fail(`${file} isn't a Scentcast journal export (the wear journal's Export button)`);
  const demo = JSON.parse(readFileSync(new URL('../data/collection.json', import.meta.url))).fragrances;

  // One weather fetch per place, covering its wears.
  const places = new Map();
  for (const h of journalWears(journal)) {
    const at = placeOf(journal, h);
    if (!at) continue;
    const key = `${at.lat},${at.lon}`;
    const p = places.get(key) ?? { ...at, from: h.date, to: h.date };
    if (h.date < p.from) p.from = h.date;
    if (h.date > p.to) p.to = h.date;
    places.set(key, p);
  }
  // A request that failed: say so once, and count its wears as without weather.
  const failed = new Set();
  for (const p of places.values()) {
    p.weather = await hourlyAt(p.lat, p.lon, p.from, p.to);
    for (const err of p.weather.errors) failed.add(forecastError(err));
  }
  for (const message of failed) console.error(`${message} Wears it would cover are skipped.`);

  const windowFor = (h, at) => windowOn(places.get(`${at.lat},${at.lon}`).weather, h.date, h.slot);
  const { rows, skipped } = rankWears(journal, demo, windowFor);
  const summary = summarizeRows(rows, skipped);
  const fit = args.fit ? thermostat(wearChoices(journal, demo, windowFor).choices) : null;
  if (args.json) {
    console.log(JSON.stringify({ summary, wears: rows, ...(fit && { fit }) }, null, 2));
    return;
  }
  for (const r of rows) {
    const occasion = r.occasion ? ` · ${occasionById(r.occasion).label}` : '';
    console.log(`${r.date} ${r.slot.padEnd(5)} ${String(r.feelsF).padStart(3)}°F dew ${String(r.dewF).padStart(2)}  ${r.worn.padEnd(24)} #${r.rank}/${r.of} ${r.tier}${r.rank > 1 ? `   (top: ${r.top})` : ''}${occasion}`);
  }
  const s = summary;
  if (!s.wears) {
    console.log(`No wears to check (${s.skipped.notInDemo} outside the demo, ${s.skipped.noPlace} without a place, ${s.skipped.noWeather} without weather).`);
    return;
  }
  console.log(`\n${s.wears} wears checked (skipped: ${s.skipped.notInDemo} outside the demo, ${s.skipped.noPlace} without a place, ${s.skipped.noWeather} without weather)`);
  console.log(`worn bottle's average rank ${s.meanRank} (random would be ${s.randomMeanRank}); the top pick ${s.topPickPct}% of the time, S tier ${s.tierSPct}%, S or A ${s.tierSorAPct}%`);
  if (!fit) return;
  console.log('\nThermostat: the feels-like offset that best explains what you wore');
  console.log(`  every wear          ${fitText(fit.all)}`);
  console.log(`  by day              ${fitText(fit.day)}`);
  console.log(`  by night            ${fitText(fit.night)}`);
  console.log(`  not the top pick    ${fitText(fit.overrides)}`);
  console.log(`  ${fitReading(fit.all)}`);
}

const USAGE = 'usage: node scripts/journal-check.mjs JOURNAL.json [--fit] [--json]';

if (import.meta.main) await main();
