#!/usr/bin/env node
// How the engine's picks line up with what was actually worn.
//   node scripts/journal-check.mjs scentcast-journal-2026-10-03.json [--json]
//
// Takes the file from the wear journal's Export button. For each logged wear
// it looks up that window's weather where it was worn (Open-Meteo's archive,
// or its forecast API for the last few days the archive lacks), ranks the
// wardrobe the app was choosing from (the demo minus the device's hidden
// bottles) with the earlier wears as rotation, and reports where the worn
// bottle landed. Wears of bottles outside the demo are skipped.
// Weather data by Open-Meteo.com (CC BY 4.0).
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { rank } from '../src/engine.js';
import { windowOn } from '../src/weather.js';
import { parseJournal } from '../src/history.js';

const HOURLY = 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code';
const DAY_MS = 86_400_000;
const isoDaysAgo = n => new Date(Date.now() - n * DAY_MS).toISOString().slice(0, 10);

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo request failed (${res.status}): ${url}`);
  return res.json();
}

// Hourly weather at one place over [from, to], archive first, recent days from the forecast API.
async function hourlyAt(lat, lon, from, to) {
  const base = { latitude: lat, longitude: lon, hourly: HOURLY, temperature_unit: 'fahrenheit', timezone: 'auto' };
  const parts = [];
  const archiveEnd = to < isoDaysAgo(5) ? to : isoDaysAgo(5);
  if (from <= archiveEnd) {
    parts.push(await getJSON(`https://archive-api.open-meteo.com/v1/archive?${new URLSearchParams({ ...base, start_date: from, end_date: archiveEnd })}`));
  }
  if (to > isoDaysAgo(8)) {
    parts.push(await getJSON(`https://api.open-meteo.com/v1/forecast?${new URLSearchParams({ ...base, past_days: 10, forecast_days: 1 })}`));
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
  };
}

// Logged wears in time order, plans left out.
export const journalWears = journal => [...journal.history].filter(h => !h.planned)
  .sort((a, b) => (a.date + a.slot).localeCompare(b.date + b.slot));

const placeOf = (journal, h) => (h.lat !== undefined ? { lat: h.lat, lon: h.lon } : journal.location);

/**
 * Where each wear's bottle landed, ranked as the app would have: the demo
 * minus the device's hidden bottles, the earlier wears as rotation.
 * journal: parseJournal's shape. windowFor(wear, place) -> weather window or null.
 * -> { rows, skipped }
 */
export function rankWears(journal, demo, windowFor) {
  // The app keeps ids as strings (main.js, history.js); data/collection.json has numbers.
  const bottles = demo.map(f => (typeof f.id === 'string' ? f : { ...f, id: String(f.id) }));
  const byId = new Map(bottles.map(f => [f.id, f]));
  const hidden = new Set(journal.hidden);
  const wears = journalWears(journal);
  const rows = [], skipped = { notInDemo: 0, noPlace: 0, noWeather: 0 };
  for (const [i, h] of wears.entries()) {
    const worn = byId.get(h.id);
    if (!worn) { skipped.notInDemo++; continue; }
    const at = placeOf(journal, h);
    if (!at) { skipped.noPlace++; continue; }
    const win = windowFor(h, at);
    if (!win) { skipped.noWeather++; continue; }
    const pool = bottles.filter(f => !hidden.has(f.id) || f === worn);
    const ranked = rank(pool, win, h.slot, { history: wears.slice(0, i), todayISO: h.date });
    const at1 = ranked.findIndex(r => r.fragrance === worn) + 1;
    const entry = ranked[at1 - 1];
    rows.push({
      date: h.date, slot: h.slot, feelsF: Math.round(win.feelsF), dewF: Math.round(win.dewF), condition: win.condition,
      worn: worn.name, rank: at1, of: ranked.length, tier: entry.tier, top: ranked[0].fragrance.name,
      reasons: entry.reasons.map(r => `${r.tone === 'good' ? '+' : '-'} ${r.text}`),
    });
  }
  return { rows, skipped };
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

async function main() {
  const { values: args, positionals: [file] } = parseArgs({ allowPositionals: true, options: { json: { type: 'boolean', default: false } } });
  if (!file) { console.error('usage: node scripts/journal-check.mjs JOURNAL.json [--json]'); process.exit(1); }
  const journal = parseJournal(JSON.parse(readFileSync(file, 'utf8')));
  if (!journal) { console.error(`${file} is not a Scentcast journal export`); process.exit(1); }
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
  for (const p of places.values()) p.weather = await hourlyAt(p.lat, p.lon, p.from, p.to);

  const { rows, skipped } = rankWears(journal, demo, (h, at) => windowOn(places.get(`${at.lat},${at.lon}`).weather, h.date, h.slot));
  const summary = summarizeRows(rows, skipped);
  if (args.json) {
    console.log(JSON.stringify({ summary, wears: rows }, null, 2));
    return;
  }
  for (const r of rows) {
    console.log(`${r.date} ${r.slot.padEnd(5)} ${String(r.feelsF).padStart(3)}°F dew ${String(r.dewF).padStart(2)}  ${r.worn.padEnd(24)} #${r.rank}/${r.of} ${r.tier}${r.rank > 1 ? `   (top: ${r.top})` : ''}`);
  }
  const s = summary;
  console.log(`\n${s.wears} wears checked (skipped: ${s.skipped.notInDemo} outside the demo, ${s.skipped.noPlace} without a place, ${s.skipped.noWeather} without weather)`);
  console.log(`worn bottle's average rank ${s.meanRank} (random would be ${s.randomMeanRank}); the top pick ${s.topPickPct}% of the time, S tier ${s.tierSPct}%, S or A ${s.tierSorAPct}%`);
}

if (import.meta.main) await main();
