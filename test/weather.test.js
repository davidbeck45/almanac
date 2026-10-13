import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blendModels, week, cachedForecast, forecastError } from '../src/weather.js';

// Two days of a multi-model response, variables suffixed by model as Open-Meteo returns them.
function multiModel() {
  const time = ['2026-10-08', '2026-10-09'].flatMap(d => Array.from({ length: 24 }, (_, h) => `${d}T${String(h).padStart(2, '0')}:00`));
  const series = (base, bump = 0) => time.map((_, i) => base + bump + (i % 24 >= 12 && i % 24 <= 16 ? 10 : 0));
  const hourly = { time };
  const models = { best_match: 0, gfs_seamless: 4, ecmwf_ifs: -2, icon_seamless: 0, gem_seamless: -2 };
  for (const [m, bump] of Object.entries(models)) {
    hourly[`temperature_2m_${m}`] = series(70, bump);
    hourly[`apparent_temperature_${m}`] = series(72, bump);
    hourly[`relative_humidity_2m_${m}`] = time.map(() => 50 + bump);
    hourly[`weather_code_${m}`] = time.map(() => (m === 'best_match' ? 1 : 3));
    hourly[`precipitation_probability_${m}`] = time.map(() => (m === 'best_match' ? 10 : 90));
  }
  hourly.temperature_2m_icon_seamless[13] = null; // a gap in one model
  const daily = { time: ['2026-10-08', '2026-10-09'] };
  for (const m of Object.keys(models)) {
    daily[`sunrise_${m}`] = ['2026-10-08T07:24', '2026-10-09T07:25'];
    daily[`sunset_${m}`] = ['2026-10-08T19:05', '2026-10-09T19:04'];
    daily[`temperature_2m_max_${m}`] = [99, 99];
    daily[`temperature_2m_min_${m}`] = [0, 0];
  }
  return { latitude: 32.8, utc_offset_seconds: -18000, current: { temperature_2m: 75 }, hourly, daily };
}

test('the forecast averages four models, keeping the default for codes and rain', () => {
  const f = blendModels(multiModel());
  assert.equal(f.hourly.temperature_2m[0], 70, 'mean of +4, -2, 0, -2 around 70');
  assert.equal(f.hourly.temperature_2m[13], (84 + 78 + 78) / 3, 'a model with no value for an hour sits it out');
  assert.equal(f.hourly.relative_humidity_2m[5], 50);
  assert.equal(f.hourly.weather_code[0], 1);
  assert.equal(f.hourly.precipitation_probability[0], 10);
  assert.equal(f.current.temperature_2m, 75);
  // Highs and lows come from the blended hours, not any one model's daily values.
  assert.deepEqual(f.daily.temperature_2m_max, [80, 80]);
  assert.deepEqual(f.daily.temperature_2m_min, [70, 70]);
  assert.equal(f.daily.sunrise[0], '2026-10-08T07:24');
  const [today] = week(f, Date.parse('2026-10-08T14:00:00Z'));
  assert.equal(today.hiF, 80);
});

test('the saved forecast opens the app: fresh as is, older dimmed while it refreshes, too old not at all', () => {
  const store = new Map();
  globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  try {
    const loc = { lat: 40.71, lon: -74.01 };
    const save = (fetchedAt, at = loc) => store.set('scentcast.weather', JSON.stringify({ key: `3:${at.lat},${at.lon}`, forecast: { fetchedAt } }));
    const now = Date.parse('2026-10-12T12:00:00Z');
    save(now - 5 * 60e3);
    assert.equal(cachedForecast(loc, now).fresh, true);
    save(now - 3 * 3600e3);
    assert.equal(cachedForecast(loc, now).fresh, false);
    save(now - 30 * 3600e3);
    assert.equal(cachedForecast(loc, now), null);
    save(now, { lat: 1, lon: 2 });
    assert.equal(cachedForecast(loc, now), null, 'another place');
  } finally {
    delete globalThis.localStorage;
  }
});

test('forecast failures read as sentences, never "Failed to fetch"', () => {
  assert.equal(forecastError(new TypeError('Failed to fetch')), 'Can’t reach the forecast. Check your connection and try again.');
  assert.match(forecastError({ status: 429 }), /busy/);
  assert.match(forecastError({ status: 503 }), /down/);
  for (const err of [new TypeError('Failed to fetch'), { status: 400 }, { status: 502 }]) assert.match(forecastError(err), /^[A-Z].*\.$/);
});
