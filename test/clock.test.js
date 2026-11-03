// The forecast and the clock (src/app/state.js): every pane shows the
// forecast in hand read for the hour it is; a saved one shows at once while
// it covers today and tomorrow and stands in while it covers today; an
// answer for a place picked over since is dropped; Now's Day/Night choice
// ends with its window; and Wear this never logs on a window that's over.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { wxAt } from '../src/weather.js';
import * as app from '../src/app/state.js';
import * as wear from '../src/views/wear.js';
import * as settings from '../src/views/settings.js';
import { syntheticForecast } from './fixtures.js';

const { state } = app;
const { fragrances } = JSON.parse(readFileSync(new URL('../data/collection.json', import.meta.url)));
for (const f of fragrances) f.id = String(f.id);

// The fixture's place runs on UTC-4: a wall-clock time there, in ms.
const at = (dateISO, hhmm) => Date.parse(`${dateISO}T${hhmm}:00Z`) + 4 * 3600e3;
// A week from Nov 2 2026, fetched at `fetchedAt`.
const fetched = fetchedAt => ({ ...syntheticForecast(7, { start: '2026-11-02' }), fetchedAt });
const home = { name: 'Here', lat: 40.7, lon: -74 };
const chicago = { name: 'Chicago', lat: 41.88, lon: -87.63 };
const page = { keepingFocus(el, scope, draw) { draw(); }, renderPage() {}, render() {} };

let store;
beforeEach(() => {
  store = new Map();
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  };
  Object.assign(state, {
    demo: { fetched: '2026-11-02', fragrances }, shared: null, active: 'demo', loc: home, forecast: null, wx: null,
    history: [], events: [], slot: null, occasionSlot: null, loading: false, updating: false, slow: false, error: null,
  });
});

test('Now follows the clock: the morning after reads today, and Day picked this morning ends with its window', t => {
  t.mock.timers.enable({ apis: ['Date'], now: at('2026-11-02', '09:00') });
  state.forecast = fetched(at('2026-11-02', '08:00'));
  state.wx = wxAt(state.forecast);
  app.computeToday();
  // He looks at tonight, then goes back to the day.
  wear.actions.slot({ dataset: { value: 'night' } }, page);
  assert.equal(app.nowSlot().win.label, 'Tonight');
  wear.actions.slot({ dataset: { value: 'day' } }, page);
  assert.deepEqual(state.slot, { slot: 'day', dateISO: '2026-11-02' }, 'the choice is of a window, not of a word');
  // Noon: the hour has turned, the same windows, the choice holds.
  t.mock.timers.setTime(at('2026-11-02', '12:00'));
  assert.equal(app.readClock(), true);
  app.computeToday();
  assert.equal(app.nowSlot().win.label, 'Today');
  // Within the hour nothing is read again.
  t.mock.timers.setTime(at('2026-11-02', '12:40'));
  assert.equal(app.hourTurned(), false);
  assert.equal(app.readClock(), false);
  // 6 pm: the day is over, so Now opens on tonight, not tomorrow's daytime.
  t.mock.timers.setTime(at('2026-11-02', '18:00'));
  app.readClock();
  app.computeToday();
  assert.deepEqual([app.nowSlot().win.label, app.nowSlot().win.dateISO], ['Tonight', '2026-11-02']);
  // Left open overnight: the morning reads today, its daytime first, and can be worn.
  t.mock.timers.setTime(at('2026-11-03', '08:10'));
  app.readClock();
  app.computeToday();
  assert.equal(state.wx.todayISO, '2026-11-03');
  assert.deepEqual([app.nowSlot().win.label, app.nowSlot().win.dateISO], ['Today', '2026-11-03']);
  assert.equal(app.canWear(app.nowSlot().win), true);
  assert.equal(app.nowHour(), 8);
});

test('Now and the Week agree about today when the hour turns before the page is read again', t => {
  t.mock.timers.enable({ apis: ['Date'], now: at('2026-11-02', '16:30') });
  state.forecast = fetched(at('2026-11-02', '08:00'));
  state.wx = wxAt(state.forecast);
  app.computeToday();
  // 5:10 pm by the clock; the page still holds 4:30's reading.
  t.mock.timers.setTime(at('2026-11-02', '17:10'));
  const days = app.computeWeek();
  const key = p => `${p.win.dateISO} ${p.win.slot} ${p.pick.fragrance.id}`;
  const today = app.todaySlots();
  assert.deepEqual(days.flatMap(d => [d.day, d.night]).filter(Boolean).slice(0, today.length).map(key), today.map(key));
});

test('Wear this never logs on a window that’s over, though the page still shows it', t => {
  t.mock.timers.enable({ apis: ['Date'], now: at('2026-11-02', '16:50') });
  state.forecast = fetched(at('2026-11-02', '08:00'));
  state.wx = wxAt(state.forecast);
  app.computeToday();
  const { day, night } = state.today;
  assert.equal(day.win.dateISO, '2026-11-02');
  let drawn = 0;
  const ui = { ...page, render() { drawn++; } };
  // 5:05 pm: the card is today's daytime still, but the window has ended.
  t.mock.timers.setTime(at('2026-11-02', '17:05'));
  assert.equal(app.canWear(day.win), false);
  wear.actions.wear({ dataset: { ctx: 'day', id: day.pick.fragrance.id } }, ui);
  assert.deepEqual(state.history, [], 'nothing logged on the day that’s over');
  assert.equal(drawn, 1, 'drawn again for the hour it is');
  // Tonight's can.
  wear.actions.wear({ dataset: { ctx: 'night', id: night.pick.fragrance.id } }, ui);
  assert.deepEqual(state.history.map(h => [h.date, h.slot]), [['2026-11-02', 'night']]);
  // Past 11 pm tonight's is over too, and the morning after it's yesterday's.
  t.mock.timers.setTime(at('2026-11-02', '23:10'));
  assert.equal(app.canWear(night.win), false);
  t.mock.timers.setTime(at('2026-11-03', '09:00'));
  assert.equal(app.canWear(night.win), false);
});

test('a saved forecast shows at once while it covers today and tomorrow; an answer for a place picked over since is dropped', t => {
  const morning = at('2026-11-03', '08:00');
  t.mock.timers.enable({ apis: ['Date'], now: morning });
  // Yesterday's, saved on the device: read for this morning at once, and a new one asked for.
  store.set('scentcast.weather', JSON.stringify({ key: '3:40.7,-74', forecast: fetched(at('2026-11-02', '07:00')) }));
  assert.equal(app.showSaved(), false, 'not fresh: ask for a new one');
  assert.equal(state.wx.todayISO, '2026-11-03');
  assert.equal(state.wx.day.label, 'Today');
  // Three days on it's too old to show while a new one loads.
  state.forecast = null;
  t.mock.timers.setTime(at('2026-11-05', '08:00'));
  app.showSaved();
  assert.equal(state.wx, null);
  t.mock.timers.setTime(morning);

  // Here's request still loading when Chicago is picked: Chicago's owns the screen.
  state.loc = chicago;
  Object.assign(state, { forecast: null, wx: null, loading: true });
  assert.equal(app.takeForecast(home, { forecast: fetched(morning) }), false);
  assert.deepEqual([state.forecast, state.wx, state.loading], [null, null, true]);
  const theirs = fetched(morning);
  assert.equal(app.takeForecast(chicago, { forecast: theirs }), true);
  assert.equal(state.forecast, theirs);
  assert.deepEqual([state.loading, state.wx.todayISO, state.wx.stale], [false, '2026-11-03', false]);
  // The place is its spot: Chicago picked again (or read back from another tab) takes Chicago's.
  state.loc = { ...chicago };
  const again = fetched(morning + 60e3);
  assert.equal(app.takeForecast(chicago, { forecast: again }), true);
  assert.equal(state.forecast, again);

  // Failed later: the one in hand stands in while it still covers today…
  t.mock.timers.setTime(morning + 2 * 86_400e3);
  app.takeForecast(chicago, { error: new TypeError('Failed to fetch') });
  assert.deepEqual([state.wx.todayISO, state.wx.stale, state.wx.offline, state.error], ['2026-11-05', true, true, null]);
  // …read for the hour it is on the next look, as long as it can be.
  t.mock.timers.setTime(morning + 2 * 86_400e3 + 3 * 3600e3);
  assert.equal(app.readClock(), true);
  assert.equal(state.wx.stale, true);
  // Past that it says why (here the daily limit, not the connection), with nothing left to rank.
  t.mock.timers.setTime(morning + 6 * 86_400e3);
  app.takeForecast(chicago, { error: { status: 429, reason: 'Daily API request limit exceeded.' } });
  assert.equal(state.wx, null);
  assert.equal(state.error, 'The forecast service’s daily limit is used up. Try again tomorrow.');
});

test('Use my location gives way to a place picked while it looks', async () => {
  let answer;
  // (Node's own navigator is a getter that t.mock.property hangs on.)
  const realNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { geolocation: { getCurrentPosition: ok => { answer = ok; } } }, configurable: true });
  const set = [];
  const ui = { updateSheet: p => Object.assign(state.sheet, p), setLocation: async loc => { set.push(loc); state.loc = loc; } };
  try {
    state.sheet = { kind: 'location' };
    const looking = settings.actions.geo({}, ui);
    await ui.setLocation(chicago); // a recent place, tapped meanwhile
    answer({ coords: { latitude: 51.5, longitude: -0.12 } });
    await looking;
    assert.deepEqual(set, [chicago], 'the device’s late answer doesn’t replace it');
    state.sheet = { kind: 'location' };
    const again = settings.actions.geo({}, ui);
    answer({ coords: { latitude: 51.5, longitude: -0.12 } });
    await again;
    assert.equal(set.at(-1).name, 'My location', 'with nothing picked meanwhile, it applies');
    assert.equal(set.at(-1).timezone, Intl.DateTimeFormat().resolvedOptions().timeZone, 'and it’s in the device’s time zone');
  } finally {
    state.sheet = null;
    if (realNav) Object.defineProperty(globalThis, 'navigator', realNav);
    else delete globalThis.navigator;
  }
});

test('with no window left to rank, Now, the Week and the Occasion pane say so with Try again, and never throw', t => {
  t.mock.timers.enable({ apis: ['Date'], now: at('2026-11-02', '09:00') });
  state.forecast = fetched(at('2026-11-02', '08:00'));
  state.wx = { ...wxAt(state.forecast), day: null, night: null };
  app.computeToday();
  const pane = id => wear.wear.panes.find(p => p.id === id);
  const route = { dest: 'wear', pane: 'occasion', arg: 'formal' };
  for (const html of [pane('now').render({}, { dest: 'wear', pane: 'now' }), pane('occasion').render({}, route)]) {
    assert.match(html, /No forecast for the hours ahead/);
    assert.match(html, /data-action="refresh"/);
  }
  assert.equal(pane('occasion').heading(route), 'Picks for formal wear');
  // While a new one loads, the skeleton it'll fill.
  state.loading = true;
  assert.ok(!pane('now').render({}, { dest: 'wear', pane: 'now' }).includes('No forecast'));
  state.forecast = { ...state.forecast, daily: { ...state.forecast.daily, time: [] } };
  state.loading = false;
  assert.match(pane('week').render({}, { dest: 'wear', pane: 'week' }), /No forecast for the hours ahead/);
});

test('a saved forecast standing in says why it wasn’t updated, and from when', () => {
  const loc = { name: 'Here', lat: 40 };
  const wx = { ...wxAt(fetched(at('2026-11-02', '08:00')), at('2026-11-02', '09:00')) };
  const status = s => wear.heroHTML({ loc, wx: { ...wx, ...s }, loading: false, error: null, updating: false }, { aspect: 1.3 }).match(/class="hero-status[^"]*">([^<]*)/)?.[1] ?? '';
  assert.equal(status({}), '');
  assert.equal(status({ stale: true, offline: true }), 'Offline');
  assert.equal(status({ stale: true, offline: false }), 'Not updated', 'the daily limit isn’t the connection');
  // Settings says the day once it isn't today's.
  const now = new Date(2026, 10, 3, 12, 0);
  assert.equal(settings.updatedText(new Date(2026, 10, 3, 9, 5).getTime(), now), new Date(2026, 10, 3, 9, 5).toLocaleString([], { hour: 'numeric', minute: '2-digit' }));
  const before = settings.updatedText(new Date(2026, 10, 1, 9, 5).getTime(), now);
  assert.ok(before.includes(new Date(2026, 10, 1).toLocaleString([], { weekday: 'short' })), before);
  const note = s => settings.settingsHTML({ loc, units: 'F', themeName: 'default', active: 'demo', mineCount: 0, on: 1, total: 1, wears: 0, updated: 'Sun 9:05 AM', credits: '', ...s }).match(/Forecast<small>([^<]*)/)[1];
  assert.equal(note({}), 'Updated Sun 9:05 AM');
  assert.equal(note({ stale: true, offline: true }), 'Offline · Updated Sun 9:05 AM');
  assert.equal(note({ stale: true }), 'Not updated since Sun 9:05 AM');
});
