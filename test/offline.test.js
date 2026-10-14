// dev/offline: the saved New York weather moves to any day and reads as the
// app reads a fresh forecast and climate, without reaching the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offlineData, offlineFetch, shiftedForecast, shiftedHistory } from '../dev/offline/saved.mjs';
import { fetchForecast, summarize, week } from '../src/weather.js';
import { fetchClimate } from '../src/climate.js';

const NOW = new Date(2027, 2, 5, 15, 20);
const offline = () => offlineFetch(() => assert.fail('reached the network'), offlineData(NOW));

test('the saved forecast and wears move to the day asked', () => {
  const f = shiftedForecast(NOW);
  assert.equal(f.daily.time[0], '2027-03-05');
  assert.equal(f.hourly.time[0], '2027-03-05T00:00');
  assert.equal(f.current.time, '2027-03-05T15:00');
  const wears = shiftedHistory(NOW);
  assert.equal(wears[0].date, '2027-03-02');
  assert.ok(wears.every(w => w.lat === 40.71 && w.lon === -74.01 && /^\d+$/.test(w.id)));
});

test('the app reads the offline forecast and climate as fetched ones', async t => {
  t.mock.method(globalThis, 'fetch', offline());
  t.mock.method(console, 'warn', () => {});
  const forecast = await fetchForecast({ lat: 40.71, lon: -74.01 });
  const wx = summarize(forecast, NOW.getTime());
  assert.ok(wx.day && wx.night && Number.isFinite(wx.now.tempF));
  assert.equal(week(forecast, NOW.getTime()).length, 7);
  const climate = await fetchClimate(40.71, -74.01, { now: NOW, storage: null });
  assert.equal(climate.local, true);
  const share = slot => Object.entries(climate.summary).filter(([k]) => k.startsWith(slot)).reduce((a, [, c]) => a + c.share, 0);
  assert.ok(Math.abs(share('day:') - 1) < 0.01 && Math.abs(share('night:') - 1) < 0.01);
});

test('other places get New York weather, with a warning', async t => {
  t.mock.method(globalThis, 'fetch', offline());
  const warn = t.mock.method(console, 'warn', () => {});
  await fetchForecast({ lat: 29.76, lon: -95.37 });
  await fetchForecast({ lat: 29.76, lon: -95.37 });
  assert.equal(warn.mock.callCount(), 1);
  assert.match(warn.mock.calls[0].arguments[0], /29\.76,-95\.37 with New York's saved weather/);
});
