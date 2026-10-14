import { test } from 'node:test';
import assert from 'node:assert/strict';
import { typicalWindow, fetchTypical, tripWindows, FORECAST_DAYS } from '../src/weather.js';
import { syntheticForecast } from './fixtures.js';

const shift = (iso, days) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const daysIn = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
const json = body => ({ ok: true, status: 200, json: async () => body });

// Archive-shaped hourly data from..to, every hour at `temp`, coded `code`.
function archive(from, to, temp, code = 1) {
  const f = syntheticForecast(daysIn(from, to), { start: from });
  return {
    latitude: 51.5,
    hourly: {
      time: f.hourly.time,
      temperature_2m: f.hourly.time.map(() => temp),
      apparent_temperature: f.hourly.time.map(() => temp - 3),
      relative_humidity_2m: f.hourly.time.map(() => 80),
      weather_code: f.hourly.time.map(() => code),
    },
  };
}

// Stubs fetch for one test: forecast and archive answers, and the URLs asked for.
async function withFetch(answer, run) {
  const real = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async url => {
    const u = new URL(String(url));
    asked.push(u);
    return json(answer(u));
  };
  try {
    return await run(asked);
  } finally {
    globalThis.fetch = real;
  }
}

test('typical weather averages the same dates, give or take three days, over three years', () => {
  const years = [[1, 40, 61], [2, 50, 61], [3, 60, 1]].map(([ago, temp, code]) => ({
    ago, data: archive(`${2026 - ago}-12-01`, `${2026 - ago}-12-31`, temp, code),
  }));
  const win = typicalWindow({ latitude: 51.5, years }, '2026-12-15', 'night');
  assert.equal(win.typical, true);
  assert.equal(win.samples, 21);
  assert.equal(win.dateISO, '2026-12-15');
  assert.equal(win.date.getFullYear(), 2026, 'the calendar reads the trip date, not the archive year');
  assert.equal(win.slot, 'night');
  assert.ok(Math.abs(win.feelsF - 47) < 1e-9, `${win.feelsF}`);
  assert.equal(win.pop, 67, 'two of three years rained');
  assert.equal(win.category, 'rain', 'wet in most years reads wet');
  const dry = typicalWindow({ latitude: 51.5, years: years.slice(1).concat(years[2]) }, '2026-12-15', 'day');
  assert.equal(dry.category, 'clear');
  assert.equal(typicalWindow({ latitude: 51.5, years }, '2026-06-01', 'day'), null, 'no data, no window');
});

test('the archive is asked for whole past years, a week behind, February 29 included', async () => {
  const nowMs = Date.parse('2026-10-13T12:00:00Z');
  await withFetch(u => archive(u.searchParams.get('start_date'), u.searchParams.get('end_date'), 50), async asked => {
    const climate = await fetchTypical({ lat: 51.5, lon: -0.1 }, '2026-12-10', '2026-12-12', { nowMs });
    assert.deepEqual(climate.years.map(y => y.ago), [1, 2, 3]);
    assert.deepEqual(asked.map(u => [u.searchParams.get('start_date'), u.searchParams.get('end_date')]),
      [['2025-12-07', '2025-12-15'], ['2024-12-07', '2024-12-15'], ['2023-12-07', '2023-12-15']]);
    assert.ok(asked.every(u => u.hostname === 'archive-api.open-meteo.com' && u.searchParams.get('temperature_unit') === 'fahrenheit'));

    asked.length = 0;
    await fetchTypical({ lat: 51.5, lon: -0.1 }, '2027-10-08', '2027-10-10', { nowMs });
    assert.equal(asked[0].searchParams.get('start_date'), '2025-10-05', 'last year’s dates aren’t archived yet');

    asked.length = 0;
    await fetchTypical({ lat: 51.5, lon: -0.1 }, '2028-02-29', '2028-02-29', { nowMs: Date.parse('2028-01-10T12:00:00Z') });
    assert.equal(asked[0].searchParams.get('start_date'), '2027-02-25');
    assert.equal(asked[0].searchParams.get('end_date'), '2027-03-03');
  });
});

test('a trip takes the forecast as far as it reaches, then typical weather', async () => {
  const today = '2026-10-13';
  const nowMs = Date.parse(`${today}T12:00:00Z`);
  await withFetch(u => (u.hostname === 'api.open-meteo.com'
    ? syntheticForecast(5, { start: today })
    : archive(u.searchParams.get('start_date'), u.searchParams.get('end_date'), 30)), async asked => {
    const wins = await tripWindows({ lat: 51.5, lon: -0.1 }, shift(today, 3), shift(today, 6), { nowMs });
    assert.equal(wins.length, 8);
    assert.deepEqual(wins.map(w => `${w.dateISO} ${w.slot}`), [3, 3, 4, 4, 5, 5, 6, 6].map((d, i) => `${shift(today, d)} ${i % 2 ? 'night' : 'day'}`));
    assert.deepEqual(wins.map(w => !!w.typical), [false, false, false, false, true, true, true, true]);
    assert.equal(wins[0].feelsF, 72);
    assert.equal(wins[7].feelsF, 27);
    const forecast = asked.find(u => u.hostname === 'api.open-meteo.com');
    assert.equal(forecast.searchParams.get('forecast_days'), String(FORECAST_DAYS));

    asked.length = 0;
    const far = await tripWindows({ lat: 51.5, lon: -0.1 }, '2026-12-10', '2026-12-11', { slots: ['night'], nowMs });
    assert.ok(far.every(w => w.typical && w.slot === 'night') && far.length === 2);
    assert.ok(!asked.some(u => u.hostname === 'api.open-meteo.com'), 'no forecast request past its reach');
  });
});
