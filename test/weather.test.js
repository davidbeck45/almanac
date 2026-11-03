import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  blendModels, week, windowOn, summarize, wxAt, cachedForecast, getForecast, forecastError, requestError, fetchForecast, fetchTypical,
  clock, placeClock, windowOpen, REQUEST_TIMEOUT, TRIP_TIMEOUT,
} from '../src/weather.js';
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
    // The morning check finds yesterday's: it still covers today and tomorrow, so it shows at once.
    save(now - 30 * 3600e3);
    assert.equal(cachedForecast(loc, now).fresh, false);
    save(now - 71 * 3600e3);
    assert.equal(cachedForecast(loc, now).fresh, false);
    save(now - 80 * 3600e3);
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
  // Open-Meteo's own reason tells a minute's burst from the day's requests used up, and which service said so.
  const daily = 'Daily API request limit exceeded. Please try again tomorrow.';
  assert.equal(forecastError({ status: 429, reason: daily }), 'The forecast service’s daily limit is used up. Try again tomorrow.');
  assert.equal(forecastError({ status: 429, reason: daily, service: 'archive' }), 'The weather archive’s daily limit is used up. Try again tomorrow.');
  assert.equal(forecastError({ status: 429, reason: 'Minutely API request limit exceeded.' }), 'The forecast service is busy. Try again in a minute.');
});

test('a refused request carries its status, Open-Meteo’s reason and the service', async () => {
  const res = { status: 429, json: async () => ({ error: true, reason: 'Daily API request limit exceeded.' }) };
  const err = await requestError(res, 'archive');
  assert.deepEqual([err.status, err.reason, err.service], [429, 'Daily API request limit exceeded.', 'archive']);
  const bare = await requestError({ status: 502, json: async () => { throw new SyntaxError('not json'); } });
  assert.deepEqual([bare.status, bare.reason, bare.service], [502, '', 'forecast']);
});

test('a saved forecast hours old reads now from its hourly row, not the reading at fetch time', () => {
  const f = blendModels(multiModel());
  // Fetched at 14:00 local on the 8th, when the default model said 75° and clear.
  const fetchedAt = Date.parse('2026-10-08T19:00:00Z');
  f.current = { temperature_2m: 75, apparent_temperature: 76, relative_humidity_2m: 40, weather_code: 0, cloud_cover: 0 };
  f.fetchedAt = fetchedAt;

  // The temperature is the blend's at 14:10; the sky is still the reading at fetch time.
  const soon = summarize(f, fetchedAt + 10 * 60e3);
  assert.equal(soon.now.tempF, 80);
  assert.equal(soon.now.label, 'Clear');

  // Opened at 01:00 local on the 9th: the 01:00 row (70°, mostly clear by the default model).
  const late = summarize(f, Date.parse('2026-10-09T06:00:00Z'));
  assert.equal(late.now.phase, 'night');
  assert.equal(late.now.tempF, 70);
  assert.equal(late.now.feelsF, 72);
  assert.equal(late.now.humidity, 50);
  assert.equal(late.now.label, 'Mostly clear');
});

test('now reads the blend between this hour and the next, so it sits inside the day’s high and low', () => {
  const f = blendModels(multiModel());
  // The default model alone ran cold, as Chicago's did: 57° under a blended low of 70°.
  f.current = { temperature_2m: 57, apparent_temperature: 53, relative_humidity_2m: 81, weather_code: 3, cloud_cover: 100 };
  f.fetchedAt = Date.parse('2026-10-08T21:00:00Z');
  // 16:30 local: halfway from 16:00 (80°, feels 82°) to 17:00 (70°, feels 72°).
  const wx = summarize(f, Date.parse('2026-10-08T21:30:00Z'));
  assert.equal(wx.now.tempF, 75);
  assert.equal(wx.now.feelsF, 77);
  assert.equal(wx.now.humidity, 50);
  assert.ok(wx.now.loF <= wx.now.tempF && wx.now.tempF <= wx.now.hiF, `${wx.now.tempF} in ${wx.now.loF}..${wx.now.hiF}`);
  assert.equal(wx.day.feelsF, wx.now.feelsF, 'the window under way reads the same hours');
  assert.equal(wx.now.label, 'Overcast', 'the sky is still `current`’s');
  assert.equal(wx.now.cloudCover, 100);
  assert.equal(week(f, Date.parse('2026-10-08T21:30:00Z'))[0].loF, wx.now.loF);

  // Late in the evening it doesn't lean into tomorrow's hours, which could fall outside today's range.
  f.hourly.temperature_2m[24] = 40;
  const late = summarize(f, Date.parse('2026-10-09T04:30:00Z'));
  assert.equal(late.now.tempF, 70);
  assert.ok(late.now.tempF >= late.now.loF);

  // With no row for now (a forecast that doesn't reach it), `current` stands in.
  const gone = summarize({ ...f, fetchedAt: Date.parse('2026-10-10T12:00:00Z') }, Date.parse('2026-10-10T12:10:00Z'));
  assert.equal(gone.now.tempF, 57);
});

// Stubs fetch with one that never answers, for one test; `signals` collects what each request was given.
async function withHungFetch(run) {
  const real = globalThis.fetch, signals = [];
  globalThis.fetch = (url, opts) => { signals.push(opts?.signal); return new Promise(() => {}); };
  try {
    return await run(signals);
  } finally {
    globalThis.fetch = real;
  }
}

test('a request that never answers gives up, drops the request and reads as not answering', async () => {
  assert.ok(REQUEST_TIMEOUT >= 20_000 && REQUEST_TIMEOUT <= 25_000, 'past a slow day’s 24 s, not much past it');
  assert.ok(TRIP_TIMEOUT > 32_000, 'a slow day’s ten days took 32 s');
  await withHungFetch(async signals => {
    await assert.rejects(fetchForecast({ lat: 41.88, lon: -87.63 }, { timeoutMs: 20 }), err => err.timeout && err.service === 'forecast' && err.timeoutMs === 20);
    assert.equal(signals[0]?.aborted, true);
    await assert.rejects(fetchTypical({ lat: 41.88, lon: -87.63 }, '2026-12-10', '2026-12-10', { timeoutMs: 20, years: 1, nowMs: Date.parse('2026-10-14T12:00:00Z') }),
      err => err.timeout && err.service === 'archive');
  });
  assert.equal(forecastError({ timeout: true, service: 'forecast' }), 'The forecast service isn’t answering. Try again in a minute.');
  assert.equal(forecastError({ timeout: true, service: 'archive' }), 'The weather archive isn’t answering. Try again in a minute.');

  // An answer inside the limit comes through, and its clock stops.
  const real = globalThis.fetch;
  globalThis.fetch = () => new Promise(resolve => setTimeout(resolve, 10, new Response(JSON.stringify(multiModel()))));
  try {
    const f = await fetchForecast({ lat: 41.88, lon: -87.63 }, { timeoutMs: 1000 });
    assert.equal(f.hourly.temperature_2m[0], 70);
  } finally {
    globalThis.fetch = real;
  }
});

test('a hung forecast falls back on the saved one, else fails as not answering', async () => {
  const store = new Map();
  globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    await withHungFetch(async () => {
      const loc = { lat: 41.88, lon: -87.63 };
      store.set('scentcast.weather', JSON.stringify({ key: '3:41.88,-87.63', forecast: { ...multiModel(), fetchedAt: Date.now() - 13 * 3600e3 } }));
      const saved = getForecast(loc);
      mock.timers.tick(REQUEST_TIMEOUT);
      const stale = await saved;
      assert.equal(stale.stale, true);
      assert.equal(stale.offline, false, 'it reached the service, which didn’t answer: not offline');

      store.clear();
      const none = getForecast(loc);
      mock.timers.tick(REQUEST_TIMEOUT);
      await assert.rejects(none, err => forecastError(err) === 'The forecast service isn’t answering. Try again in a minute.');
    });
  } finally {
    mock.timers.reset();
    delete globalThis.localStorage;
  }
});

test('a saved forecast stands in for one that can’t be had while it still covers today, then the error says why', async () => {
  const store = new Map();
  globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const real = globalThis.fetch;
  try {
    const loc = { lat: 41.88, lon: -87.63 };
    const save = age => store.set('scentcast.weather', JSON.stringify({ key: '3:41.88,-87.63', forecast: { ...multiModel(), fetchedAt: Date.now() - age } }));
    // Offline: a day-old forecast stands in, marked so.
    globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
    save(26 * 3600e3);
    const offline = await getForecast(loc);
    assert.deepEqual([offline.stale, offline.offline], [true, true]);
    // Four days old it still does (a 7-day forecast still holds today and tomorrow)…
    save(4 * 86_400e3);
    assert.equal((await getForecast(loc)).stale, true);
    // …but a week-old one has no window left: the error, not a page that never fills.
    save(6 * 86_400e3);
    await assert.rejects(getForecast(loc), err => forecastError(err) === 'Can’t reach the forecast. Check your connection and try again.');
    // On a day the service refuses, the reason is the service’s, not the connection.
    const daily = 'Daily API request limit exceeded. Please try again tomorrow.';
    globalThis.fetch = async () => new Response(JSON.stringify({ error: true, reason: daily }), { status: 429 });
    save(2 * 86_400e3);
    const refused = await getForecast(loc);
    assert.deepEqual([refused.stale, refused.offline], [true, false]);
    save(6 * 86_400e3);
    await assert.rejects(getForecast(loc), err => forecastError(err) === 'The forecast service’s daily limit is used up. Try again tomorrow.');
  } finally {
    globalThis.fetch = real;
    delete globalThis.localStorage;
  }
});

test('a forecast is read for the hour it is: a page left open overnight shows this morning, never last night', () => {
  // Fetched at 6 pm on the 28th (UTC-4), opened at 8 am on the 29th: today is the 29th, and its daytime is next.
  const forecast = { ...syntheticForecast(7), fetchedAt: Date.parse('2026-09-28T22:00:00Z') };
  const morning = Date.parse('2026-09-29T12:00:00Z');
  const wx = wxAt(forecast, morning);
  assert.equal(wx.todayISO, '2026-09-29');
  assert.deepEqual([wx.day.dateISO, wx.day.label, wx.night.label], ['2026-09-29', 'Today', 'Tonight']);
  assert.equal(wx.at, morning, 'it says when it was read');
  assert.deepEqual(wx, summarize(forecast, morning));
  // Past three days it isn't shown while a new one loads…
  assert.ok(wxAt(forecast, forecast.fetchedAt + 71 * 3600e3));
  assert.equal(wxAt(forecast, forecast.fetchedAt + 73 * 3600e3), null);
  // …but one standing in for a forecast that couldn't be had reads for five days,
  assert.equal(wxAt({ ...forecast, stale: true }, forecast.fetchedAt + 4.9 * 86_400e3).stale, true);
  assert.equal(wxAt({ ...forecast, stale: true }, forecast.fetchedAt + 5.1 * 86_400e3), null);
  // and never once it no longer holds the place's today (its first day's high would read as today's).
  const short = { ...syntheticForecast(2), fetchedAt: forecast.fetchedAt, stale: true };
  assert.equal(wxAt(short, Date.parse('2026-10-01T16:00:00Z')), null);
  assert.equal(wxAt(null), null);
});

test('a place’s clock without its forecast reads its time zone, else the sun at its longitude, and says which windows are still open', () => {
  // 9 pm on Nov 2 in New York is 11 am on Nov 3 in Tokyo.
  const now = Date.parse('2026-11-03T02:00:00Z');
  const read = ({ hour, todayISO, tomorrowISO }) => ({ hour, todayISO, tomorrowISO });
  const tokyo = { lat: 35.68, lon: 139.69, timezone: 'Asia/Tokyo' };
  assert.deepEqual(read(placeClock(tokyo, now)), { hour: 11, todayISO: '2026-11-03', tomorrowISO: '2026-11-04' });
  assert.deepEqual(read(placeClock({ lat: 40.71, lon: -74.01, timezone: 'America/New_York' }, now)), { hour: 21, todayISO: '2026-11-02', tomorrowISO: '2026-11-03' });
  assert.equal(placeClock({ lon: 85.32, timezone: 'Asia/Kathmandu' }, now).hour, 7, 'a zone three quarters off the hour');
  assert.equal(placeClock({ lon: -74, timezone: 'America/New_York' }, Date.parse('2026-07-03T02:00:00Z')).hour, 22, 'summer time');
  // As the place's forecast reads it, offset and all.
  const forecast = { utc_offset_seconds: 9 * 3600, latitude: 35.68 };
  assert.deepEqual(placeClock(tokyo, now), (({ lat, ...rest }) => rest)(clock(forecast, now)));
  // Without a zone, or one this runtime doesn't know: solar time, which runs
  // a little behind most zones' clocks (Tokyo's sun is 19 minutes ahead).
  for (const place of [{ lon: 139.69 }, { lon: 139.69, timezone: 'Nowhere/Atlantis' }]) {
    assert.deepEqual(read(placeClock(place, now)), { hour: 11, todayISO: '2026-11-03', tomorrowISO: '2026-11-04' }, JSON.stringify(place));
  }
  assert.deepEqual(read(placeClock({ lon: -0.13 }, now)), { hour: 1, todayISO: '2026-11-03', tomorrowISO: '2026-11-04' });
  // A window is open while it's dated today there and its hours haven't ended.
  const at = placeClock(tokyo, now);
  assert.equal(windowOpen({ dateISO: '2026-11-03', slot: 'day' }, at), true);
  assert.equal(windowOpen({ dateISO: '2026-11-03', slot: 'night' }, at), true);
  assert.equal(windowOpen({ dateISO: '2026-11-02', slot: 'night' }, at), false, 'home’s today, over there');
  assert.equal(windowOpen({ dateISO: '2026-11-04', slot: 'day' }, at), false, 'tomorrow’s');
  const evening = placeClock(tokyo, Date.parse('2026-11-03T10:30:00Z'));
  assert.equal(windowOpen({ dateISO: '2026-11-03', slot: 'day' }, evening), false, '7:30 pm: the day is over');
  assert.equal(windowOpen({ dateISO: '2026-11-03', slot: 'night' }, evening), true);
});
