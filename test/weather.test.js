import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blendModels, week, windowOn, summarize, cachedForecast, forecastError } from '../src/weather.js';
import { syntheticForecast } from './fixtures.js';

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

test('an hour a model left empty doesn\'t read as 0°F', () => {
  const forecast = syntheticForecast(2);
  const i = forecast.hourly.time.indexOf('2026-09-29T12:00');
  for (const key of ['temperature_2m', 'apparent_temperature', 'relative_humidity_2m']) forecast.hourly[key][i] = null;
  const win = windowOn(forecast, '2026-09-29', 'day');
  assert.equal(win.feelsF, 72);
  assert.equal(win.loF, 72);
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
    // A saved entry of another shape is no forecast, rather than an error at boot.
    for (const bad of [{ key: '3:40.71,-74.01' }, { key: '3:40.71,-74.01', forecast: { fetchedAt: 'soon' } }, [1, 2], 'x']) {
      store.set('scentcast.weather', JSON.stringify(bad));
      assert.equal(cachedForecast(loc, now), null, JSON.stringify(bad));
    }
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

test('a saved forecast hours old reads now from its hourly row, not the reading at fetch time', () => {
  const f = blendModels(multiModel());
  // Fetched at 14:00 local on the 8th, when it was 75° and clear.
  const fetchedAt = Date.parse('2026-10-08T19:00:00Z');
  f.current = { temperature_2m: 75, apparent_temperature: 76, relative_humidity_2m: 40, weather_code: 0, cloud_cover: 0 };
  f.fetchedAt = fetchedAt;

  const soon = summarize(f, fetchedAt + 10 * 60e3);
  assert.equal(soon.now.tempF, 75);
  assert.equal(soon.now.label, 'Clear');

  // Opened at 01:00 local on the 9th: the 01:00 row (70°, mostly clear by the default model).
  const late = summarize(f, Date.parse('2026-10-09T06:00:00Z'));
  assert.equal(late.now.phase, 'night');
  assert.equal(late.now.tempF, 70);
  assert.equal(late.now.feelsF, 72);
  assert.equal(late.now.humidity, 50);
  assert.equal(late.now.label, 'Mostly clear');
});
