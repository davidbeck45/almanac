// dev/offline: the saved New York weather moves to any day and reads as the
// app reads a fresh forecast and climate, without reaching the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { offlineData, offlineFetch, savedPlaceArgs, shiftedForecast, shiftedHistory } from '../dev/offline/saved.mjs';
import { fetchForecast, summarize, week } from '../src/weather.js';
import { fetchClimate } from '../src/climate.js';
import { journalExport, parseJournal } from '../src/history.js';

const NOW = new Date('2027-03-05T15:20:00-05:00'); // mid-afternoon in New York, whatever the machine's zone
const offline = () => offlineFetch(() => assert.fail('reached the network'), offlineData(NOW));

test('the saved forecast and wears move to the day asked', () => {
  const f = shiftedForecast(NOW);
  assert.equal(f.daily.time[0], '2027-03-05');
  assert.equal(f.hourly.time[0], '2027-03-05T00:00');
  const wears = shiftedHistory(NOW);
  assert.equal(wears[0].date, '2027-03-02');
  assert.ok(wears.every(w => w.lat === 40.71 && w.lon === -74.01 && /^\d+$/.test(w.id)));
  // Every sample wear is one the app and --journal keep (they drop malformed ones).
  assert.deepEqual(parseJournal(journalExport(wears, { name: 'New York', lat: 40.71, lon: -74.01 }, [])).history, wears);
});

test('its now is the reading for this hour, fresh or an hour old', () => {
  const f = shiftedForecast(NOW);
  assert.ok(f.hourly.time.includes(f.current.time));
  // Fresh, the app reads `current`; an hour old, the hour's row.
  const read = age => summarize({ ...f, fetchedAt: NOW.getTime() - age }, NOW.getTime()).now;
  const fresh = read(0), old = read(2 * 3600e3);
  for (const key of ['tempF', 'feelsF', 'humidity', 'label']) assert.equal(fresh[key], old[key], key);
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

test('the CLI on the saved weather names the place New York (saved), whatever it was asked', () => {
  const ny = '40.71,-74.01,New York (saved)';
  assert.deepEqual(savedPlaceArgs(['--city', 'Houston', '--gaps', '--loc=41.88,-87.63,Chicago', '--json']), ['--loc', ny, '--gaps', `--loc=${ny}`, '--json']);
  const path = name => fileURLToPath(new URL(name, import.meta.url));
  const run = spawnSync(process.execPath, ['--import', path('../dev/offline/stub.mjs'), path('../scripts/recommend.mjs'), '--loc', '41.88,-87.63,Chicago'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^New York \(saved\) · now/);
  assert.doesNotMatch(run.stdout, /Chicago/);
  // --gaps --json names the place in `climate`, as --check does, and gives each slot × band's share in `bands`.
  const gaps = spawnSync(process.execPath, ['--import', path('../dev/offline/stub.mjs'), path('../scripts/recommend.mjs'), '--gaps', '--city', 'Houston', '--top', '1', '--json'], { encoding: 'utf8' });
  assert.equal(gaps.status, 0, gaps.stderr);
  const { climate, bands } = JSON.parse(gaps.stdout);
  assert.equal(climate, 'New York (saved)');
  for (const slot of ['day', 'night']) {
    const share = Object.entries(bands).filter(([k]) => k.startsWith(`${slot}:`)).reduce((a, [, v]) => a + v, 0);
    assert.ok(Math.abs(share - 1) < 0.01, `${slot} bands add up to 1`);
  }
});
