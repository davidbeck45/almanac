import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blendModels, week, windowOn } from '../src/weather.js';
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
