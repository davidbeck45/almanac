// The backtest's pure parts (scripts/backtest.mjs) on synthetic weather, so
// none of it needs the cached archive: its windows are windowOn's, a trace
// reads as overcast, the small journal plans like the whole one, occasions
// weigh windows as the gap finder weighs cells, and the figures and the
// --against diff count what they say.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  cityDays, dewForecast, dryTrace, fetchCity, Journal, loadWardrobe, replayDaily, replayOccasion, useWeight,
  worstStretch, distinctPer, steadyFlips, kindOf, diffWindows, snapshotWindows, figures, outside,
} from '../scripts/backtest.mjs';
import { windowOn } from '../src/weather.js';
import { cellsFor, USES } from '../src/gaps.js';
import { OCCASIONS, occasionById } from '../src/occasions.js';

const script = fileURLToPath(new URL('../scripts/backtest.mjs', import.meta.url));
const cli = (...args) => new Promise(resolve => {
  execFile(process.execPath, [script, ...args], { encoding: 'utf8' }, (err, stdout, stderr) => resolve({ status: err ? err.code ?? 1 : 0, stdout, stderr }));
});
const shift = (iso, days) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

// Archive-shaped hourly weather for `days` dates from `start`, each hour from
// at(dateIndex, hour) -> { feels, code, rain }.
function archive(days, at = () => ({}), start = '2024-03-01') {
  const hours = [];
  for (let d = 0; d < days; d++) for (let h = 0; h < 24; h++) hours.push({ time: `${shift(start, d)}T${String(h).padStart(2, '0')}:00`, feels: 50, code: 0, rain: 0, ...at(d, h) });
  return {
    latitude: 41.9,
    hourly: {
      time: hours.map(h => h.time),
      temperature_2m: hours.map(h => h.feels + 2),
      apparent_temperature: hours.map(h => h.feels),
      relative_humidity_2m: hours.map(() => 60),
      weather_code: hours.map(h => h.code),
      precipitation: hours.map(h => h.rain),
    },
  };
}

test('windows are windowOn’s, one date at a time, with a trace read as overcast', () => {
  // Day 0: drizzle all day on 0.8 mm, then a rainy night on 10 mm. Day 1: light snow on a trace. Day 2: clear.
  const forecast = archive(3, (d, h) => (
    d === 0 && h < 18 ? { code: 51, rain: 0.1 } : d === 0 ? { code: 61, rain: 2 } : d === 1 ? { code: 71, rain: 0.05 } : { feels: 40 + h }));
  const days = cityDays(forecast, '2024-03-01', '2024-03-03');
  assert.equal(days.length, 3);
  for (const d of days) {
    for (const slot of ['day', 'night']) {
      const whole = windowOn(forecast, d.dateISO, slot);
      for (const key of ['feelsF', 'dewF', 'humidity', 'hiF', 'loF', 'rainMM']) assert.equal(d[slot][key], whole[key], `${d.dateISO} ${slot} ${key}`);
    }
  }
  assert.deepEqual(days.map(d => [d.day.category, d.night.category]), [['cloudy', 'rain'], ['cloudy', 'cloudy'], ['clear', 'clear']]);
  assert.equal(days[0].day.condition, 'Overcast');
  assert.equal(dryTrace(null), null);
  // Outside the data's dates there's nothing to replay.
  assert.deepEqual(cityDays(forecast, '2024-04-01', '2024-04-03'), []);
});

test('a city with only feels-like and dew point replays clear, its dew point exact', () => {
  const time = Array.from({ length: 24 }, (_, h) => `2024-07-01T${String(h).padStart(2, '0')}:00`);
  const dew = { latitude: 29.8, hourly: { time, apparent_temperature: time.map((_, h) => 80 + h / 2), dew_point_2m: time.map(() => 70) } };
  const [{ day, night }] = cityDays(dewForecast(dew), '2024-07-01', '2024-07-01');
  for (const win of [day, night]) {
    assert.equal(win.category, 'clear');
    assert.ok(Math.abs(win.dewF - 70) < 1e-6, String(win.dewF));
  }
  assert.equal(day.feelsF, 80 + 13.5 / 2, 'feels-like 10:00 to 17:00');
});

test('the small journal plans exactly as the whole one, nudges included', () => {
  const wardrobe = loadWardrobe();
  // Six weeks of mild weather, wobbling: past a month, neglected bottles get nudged in.
  const days = cityDays(archive(45, (d, h) => ({ feels: 60 + 4 * Math.sin(d / 3) + (h >= 19 ? -8 : 0) })), '2024-03-01', '2024-04-14');
  class Whole {
    wears = [];
    log(id, date, slot) { this.wears.unshift({ id, date, slot }); }
    history() { return this.wears; }
  }
  const small = replayDaily(wardrobe, days, { journal: new Journal() });
  const whole = replayDaily(wardrobe, days, { journal: new Whole() });
  assert.deepEqual(small.map(r => [r.now, r.nudged]), whole.map(r => [r.now, r.nudged]));
  assert.ok(small.some(r => r.nudged), 'the replay is long enough for the nudge to act');
  assert.ok(small.every(r => r.loss >= 0 && r.top.length === 3 && r.margin >= 0));
  // An occasion is ranked on both slots.
  const office = replayOccasion(wardrobe, days.slice(0, 2), occasionById('office'));
  assert.deepEqual(office.map(r => r.slot), ['day', 'night', 'day', 'night']);
  assert.ok(Object.keys(office[0].drop).includes('occasion'));
});

test('occasion windows weigh as the gap finder weighs its cells', () => {
  // With every slot × band as common as the others, a cell's weight within its use is useWeight's share.
  const summary = Object.fromEntries(['day', 'night'].flatMap(slot => ['cold', 'cool', 'mild', 'warm', 'hot'].map(band =>
    [`${slot}:${band}`, { share: 0.2, wins: [{ dateISO: '2024-03-01', feelsF: 50, dewF: 40, lat: 41 }] }])));
  const { cells } = cellsFor(summary);
  for (const use of USES) {
    const own = cells.filter(c => c.use === use.id);
    const total = own.reduce((s, c) => s + c.weight, 0);
    const weights = own.map(c => useWeight(use, c.slot, c.band));
    const sum = weights.reduce((a, b) => a + b, 0);
    own.forEach((c, i) => assert.ok(Math.abs(c.weight / total - weights[i] / sum) < 1e-9, `${c.id}`));
  }
  assert.equal(useWeight(USES.find(u => u.id === 'office'), 'night', 'mild'), 0, 'Office has no share at night');
  for (const o of OCCASIONS) assert.ok(USES.some(u => u.occasion === o.id), `${o.id} has a use`);
});

test('the figures count runs, rotation and flips', () => {
  // 30 days in one place: the same bottle every day, a new one every night, steady weather.
  const rows = Array.from({ length: 30 }, (_, i) => ['day', 'night'].map(slot => ({
    city: 'Here', dateISO: shift('2024-01-01', i), slot, feelsF: 30, dewF: 20, category: 'clear', pick: slot === 'day' ? 'a' : `n${i}`,
  }))).flat();
  const pick = r => r.pick;
  assert.deepEqual({ ...worstStretch(rows, pick), feelsF: 30 }, { id: 'a', count: 28, of: 56, city: 'Here', from: '2024-01-01', distinct: 29, feelsF: 30 });
  assert.deepEqual(distinctPer(rows, pick), { day: 1, night: 14 });
  assert.deepEqual(steadyFlips(rows, pick), { day: { steady: 29, flips: 0 }, night: { steady: 29, flips: 29 } });
  // A change of sky or a jump in temperature isn't steady weather.
  rows[2].category = 'rain';
  rows[6] = { ...rows[6], feelsF: 40 };
  assert.equal(steadyFlips(rows, pick).day.steady, 25);
});

test('the blatant checks read voters’ seasons, and the soft check its own ranges', () => {
  const byName = name => loadWardrobe().find(f => f.name === name);
  assert.equal(kindOf(byName('CH Men Prive')), 'warm');
  assert.equal(kindOf(byName('Essence de Blanc')), 'fresh');
  assert.equal(kindOf(byName('Sauvage')), null);
  assert.equal(outside('Essence de Blanc', 98), 0, 'nothing is too hot for a fresh bottle');
  assert.equal(outside('CH Men Prive', -5), 0, 'nor too cold for a warm one');
  assert.equal(outside('CH Men Prive', 70), 12);
  assert.equal(outside('A bottle nobody ranged', 70), null);
});

test('figures and --against read a replay', () => {
  const wardrobe = loadWardrobe();
  const days = cityDays(archive(28, (d, h) => ({ feels: 30 + d + (h >= 19 ? -5 : 0) })), '2024-03-01', '2024-03-28');
  const rows = {
    daily: replayDaily(wardrobe, days, { city: 'Here' }),
    occasions: Object.fromEntries(OCCASIONS.map(o => [o.id, replayOccasion(wardrobe, days, o, { city: 'Here' })])),
  };
  const fig = figures(rows, wardrobe);
  assert.equal(fig.windows, 56);
  assert.equal(fig.now.worst.of, 56);
  assert.ok(fig.now.worst.count < fig.raw.worst.count, 'rotation spreads the wears');
  assert.ok(fig.occasions.office.guard.night.of === 28 && fig.occasions.date.picks.length);
  assert.ok(Math.abs(fig.occasions.date.picks.reduce((s, [, x]) => s + x, 0) - 1) < 1e-9);
  // What decides a pick counts every part the score weighs: the heat
  // penalty for an occasion spent outside, which on hot nights decides
  // Date Night's, but never Cozy's or a daily pick's.
  assert.ok('heat' in fig.occasions.date.drops && !('heat' in fig.occasions.cozy.drops) && !('heat' in fig.raw.drops.night));
  const hot = cityDays(archive(7, () => ({ feels: 95 }), '2024-07-01'), '2024-07-01', '2024-07-07');
  const nights = replayOccasion(wardrobe, hot, occasionById('date'), { city: 'Here' }).filter(r => r.slot === 'night');
  assert.ok(nights.some(r => r.drop.heat !== r.top[0]), 'heat decides some hot nights');
  // The same replay moves nothing; one window's new top pick moves one.
  const before = snapshotWindows(rows);
  const after = structuredClone(before);
  const key = 'Here 2024-03-05 night';
  after[key].office = [after[key].office[1], after[key].office[0], after[key].office[2]];
  const diff = diffWindows(before, after);
  assert.deepEqual([diff['office night'].top1, diff['office night'].top3, diff['office night'].of], [1, 0, 28]);
  assert.deepEqual(diff['office night'].moves, [[before[key].office[0], before[key].office[1], 1]]);
  assert.equal(diff['now day'].top1, 0);
  assert.equal(diffWindows(before, before)['daily day'].top3, 0);
});

test('--fetch asks the archive for what the windows read', async () => {
  const asked = [];
  const real = globalThis.fetch;
  globalThis.fetch = async url => (asked.push(String(url)), { ok: true, status: 200, text: async () => '{"latitude":43.7}' });
  try {
    const file = pathToFileURL(join(mkdtempSync(join(tmpdir(), 'backtest-')), 'Toronto-full.json'));
    await fetchCity('Toronto', file);
    assert.equal(readFileSync(file, 'utf8'), '{"latitude":43.7}');
    const params = new URL(asked[0]).searchParams;
    assert.equal(new URL(asked[0]).host, 'archive-api.open-meteo.com');
    assert.deepEqual(params.get('hourly').split(','), ['temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'weather_code', 'precipitation']);
    assert.equal(params.get('temperature_unit'), 'fahrenheit');
    await assert.rejects(fetchCity('Atlantis', file), /No coordinates for Atlantis/);
  } finally {
    globalThis.fetch = real;
  }
});

test('a place with no weather saved fails with a sentence', async () => {
  const run = await cli('--cities', 'Atlantis');
  assert.equal(run.status, 1);
  assert.match(run.stderr, /^No weather saved for Atlantis in \.cache\/climate\/.*--fetch knows/);
  assert.match((await cli('--from', '2021-01-01')).stderr, /isn't a date from 2023-01-01 to 2025-12-31/);
});

const cached = existsSync(new URL('../.cache/climate/Chicago-full-2023-01-01_2025-12-31.json', import.meta.url));
test('a month of Chicago replays end to end', { skip: !cached && 'no archive cached in .cache/climate' }, async () => {
  const run = await cli('--cities', 'Chicago', '--from', '2024-01-01', '--to', '2024-02-15', '--json');
  assert.equal(run.status, 0, run.stderr);
  const { figures: fig, names } = JSON.parse(run.stdout);
  assert.equal(fig.windows, 92);
  assert.ok(names[fig.now.worst.id] && fig.now.worst.count <= fig.raw.worst.count);
  assert.equal(fig.raw.blatant.fresh, 0, 'no fresh bottle on a Chicago winter day');
});
