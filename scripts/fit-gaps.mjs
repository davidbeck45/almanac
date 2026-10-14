#!/usr/bin/env node
// Fit the gap finder's default climate (DEFAULT_CLIMATE in src/gaps.js): the
// day (10:00–17:00) and night (19:00–23:00) windows of three years in the ten
// temperate cities behind SEASON_CLIMATE (scripts/fit-seasons.mjs), as how
// often each feels-like band comes up and PER_CELL real windows per slot ×
// band (feels-like, dew point, date and latitude).
//   node scripts/fit-gaps.mjs           (report)
//   node scripts/fit-gaps.mjs --write   (update src/gaps.js)
//   node scripts/fit-gaps.mjs --city Houston   (one more place's bands, cached alongside; report only)
//
// A place's own climate comes from one archive call in the app (src/climate.js);
// this is the climate for a visitor who hasn't given one, and offline.
// Weather data by Open-Meteo.com (CC BY 4.0), cached in .cache/climate/ (with
// dew point: fit-seasons.mjs's files have feels-like only).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { BANDS, PER_CELL, climateSummary } from '../src/gaps.js';
import { archiveWindows } from '../src/climate.js';

const { values: args } = parseArgs({ options: { write: { type: 'boolean', default: false }, city: { type: 'string', multiple: true, default: [] } } });

const CITIES = [
  ['New York', 40.71, -74.01], ['Chicago', 41.88, -87.63], ['Toronto', 43.65, -79.38], ['London', 51.51, -0.13],
  ['Paris', 48.86, 2.35], ['Berlin', 52.52, 13.40], ['Warsaw', 52.23, 21.01], ['Madrid', 40.42, -3.70],
  ['Rome', 41.90, 12.50], ['Istanbul', 41.01, 28.98],
];
// Other climates to compare, by name with --city.
const MORE = {
  Houston: [29.76, -95.37], Atlanta: [33.75, -84.39], Phoenix: [33.45, -112.07], Seattle: [47.61, -122.33],
  Minneapolis: [44.98, -93.27],
};
const YEARS = ['2023-01-01', '2025-12-31'];
const CACHE = new URL('../.cache/climate/', import.meta.url);

async function hourly([name, lat, lon]) {
  const file = new URL(`${name.replace(/\W/g, '')}-dew-${YEARS.join('_')}.json`, CACHE);
  if (!existsSync(file)) {
    const params = new URLSearchParams({
      latitude: lat, longitude: lon, start_date: YEARS[0], end_date: YEARS[1],
      hourly: 'apparent_temperature,dew_point_2m', temperature_unit: 'fahrenheit', timezone: 'auto',
    });
    const res = await fetch(`https://archive-api.open-meteo.com/v1/archive?${params}`);
    if (!res.ok) throw new Error(`${name}: archive request failed (${res.status})`);
    mkdirSync(CACHE, { recursive: true });
    writeFileSync(file, await res.text());
  }
  return JSON.parse(readFileSync(file, 'utf8'));
}

const shares = summary => ['day', 'night'].map(slot => `${slot.padEnd(5)} ${BANDS.map(b => `${b.id} ${Math.round(summary[`${slot}:${b.id}`].share * 100)}%`.padEnd(10)).join(' ')}`);

const all = [];
for (const city of CITIES) all.push(...archiveWindows(await hourly(city), city[1]));
const summary = climateSummary(all, { perCell: PER_CELL });
const line = `export const DEFAULT_CLIMATE = ${JSON.stringify(summary)};`;
console.log(`${CITIES.length} cities, ${all.length} windows, ${PER_CELL} per slot × band, ${line.length} bytes`);
for (const row of shares(summary)) console.log(`  ${row}`);

for (const name of args.city) {
  const at = MORE[name];
  if (!at) throw new Error(`No coordinates for ${name}; one of ${Object.keys(MORE).join(', ')}`);
  console.log(`\n${name}`);
  for (const row of shares(climateSummary(archiveWindows(await hourly([name, ...at]), at[0])))) console.log(`  ${row}`);
}

if (args.write) {
  const path = new URL('../src/gaps.js', import.meta.url);
  writeFileSync(path, readFileSync(path, 'utf8').replace(/^export const DEFAULT_CLIMATE = .*$/m, line));
  console.log('\nwrote src/gaps.js');
}
