import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { packTrip, withEvents } from '../src/pack.js';
import { rank, PLAN_MARGIN } from '../src/engine.js';
import { occasionById } from '../src/occasions.js';
import { sprayGuide } from '../src/spray.js';
import { setSkin } from '../src/skin.js';
import { summarize, week } from '../src/weather.js';
import { shiftISO } from '../src/history.js';
import * as wear from '../src/views/wear.js';
import * as trip from '../src/views/wear/trip.js';
import * as when from '../src/views/wear/when.js';
import { placeSheetHTML, datePillHTML } from '../src/views/wear/pickers.js';
import { wxIconFor } from '../src/ui/components.js';
import * as app from '../src/app/state.js';
import { syntheticForecast } from './fixtures.js';

// A stand-in for the browser's localStorage, fresh for each test.
let store;
beforeEach(() => {
  store = new Map();
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  };
});

const { fragrances } = JSON.parse(readFileSync(new URL('../data/collection.json', import.meta.url)));
for (const f of fragrances) f.id = String(f.id);
// A bottle whose name and brand try to break out of the markup.
const EVIL = '<img src=x onerror="alert(1)">Rose & Oud\'s';
const evil = { ...fragrances[0], id: 'my:1"><b>', name: EVIL, brand: EVIL };
const bottles = [evil, ...fragrances.slice(1)];

const forecast = syntheticForecast(7);
const nowMs = Date.parse('2026-09-28T16:00:00Z'); // noon, local
const wx = summarize(forecast, nowMs);
const today = wx.todayISO;

function clean(html, what) {
  assert.ok(!/\bundefined\b|\bNaN\b|\[object Object\]/.test(html), `${what} renders undefined, NaN or an object`);
  assert.ok(!html.includes(EVIL) && !html.includes('onerror="alert'), `${what} lets a bottle name through unescaped`);
  return html;
}

// Ten days in a place called EVIL, the last six past the forecast, with a
// formal night on the third.
const windows = week(forecast, nowMs).flatMap(d => [d.day, d.night].filter(Boolean));
const extra = Array.from({ length: 6 }, (_, i) => shiftISO(windows.at(-1).dateISO, i + 1))
  .flatMap(d => ['day', 'night'].map(slot => ({ ...windows.find(w => w.slot === slot), dateISO: d, date: new Date(`${d}T12:00:00`), label: d, typical: true, samples: 21 })));
const tripWindows = [...windows, ...extra];
const third = shiftISO(today, 2);
const saved = {
  place: { name: EVIL, region: EVIL, lat: 51.5, lon: -0.13 },
  fromISO: tripWindows[0].dateISO,
  toISO: tripWindows.at(-1).dateISO,
  events: [{ dateISO: third, slot: 'night', occasion: 'formal' }],
  max: 3,
  windows: tripWindows,
  fetchedAt: 0,
};
const packed = packTrip(bottles, withEvents(tripWindows, [{ dateISO: third, slot: 'night', occasion: occasionById('formal') }]), { max: 3 });

test('the trip, event and pick templates render clean: no undefined or NaN, names escaped', () => {
  const ranked = rank(bottles, wx.day, 'day', { history: [], todayISO: today });
  const entry = { ...ranked.find(r => r.fragrance === evil), nudged: true };
  entry.parts = { ...entry.parts, idle: 34 };
  const plan = (p, slot) => p && { ...p, pick: { ...entry, tier: 'S' }, ctx: `w:${p.dateISO}:${slot}`, worn: slot === 'night' };
  const renders = {
    form: trip.tripFormHTML({ place: saved.place, fromISO: saved.fromISO, toISO: saved.toISO, events: saved.events, max: 3 }, { today, error: EVIL, adding: { dateISO: third, slot: 'night', occasion: 'date' }, editing: true, packed: true }),
    formEmpty: trip.tripFormHTML({ place: null, fromISO: '', toISO: '', events: [], max: 3 }, { today, busy: true }),
    summary: trip.tripSummaryHTML(saved, { today, note: EVIL, updating: true }),
    pack: trip.tripPackHTML(packed, saved, { canShare: true }),
    plan: trip.tripPlanHTML(packed, { today }),
    place: placeSheetHTML({ for: 'trip', query: EVIL, error: EVIL, results: [{ name: EVIL, region: EVIL }] }, [{ name: EVIL, region: EVIL }], { name: EVIL }),
    placeRecent: placeSheetHTML({ for: 'occ' }, [{ name: EVIL, region: EVIL }], null),
    date: datePillHTML({ field: 'x', value: today, min: today, max: today, text: EVIL, label: EVIL }),
    whenBar: when.whenBarHTML({ dateISO: third, place: saved.place, home: { name: EVIL }, today, slot: 'night', wx }),
    whenBarToday: when.whenBarHTML({ home: { name: EVIL }, today, slot: 'day', wx }),
    pick: wear.pickHTML(entry, 'day', null, { spray: sprayGuide(evil, wx.day) }),
    pickFull: wear.pickHTML(entry, 'occ', null, { full: true, kicker: 'Best for formal' }),
    nextWindow: wear.nextWindowHTML({ win: wx.night, pick: entry }, null, 12),
    week: wear.weekHTML(week(forecast, nowMs).map(d => ({ ...d, day: plan(d.day, 'day'), night: plan(d.night, 'night') }))),
    slotHead: wear.slotHeadHTML({ ...wx.night, typical: true }, -1, { id: 'x', thumb: true, title: when.occasionTitle(occasionById('formal'), wx.night, { today, place: saved.place }) }),
  };
  for (const [what, html] of Object.entries(renders)) clean(html, what);
  assert.match(renders.pick, /<p class="nudge">.*Not worn in 34 days/s, 'a nudged pick says why in its own line');
  assert.equal((renders.pick.match(/Not worn in 34 days/g) ?? []).length, 1, 'not again among the reasons');
  assert.match(renders.pick, /data-action="spray-open"[^>]*>.*\d spray/s, 'the spray line opens the spray section');
  assert.match(renders.week, /wk-nudge/, 'the week marks a nudged pick');
  assert.match(renders.week, /class="wk-short">34 days</, 'in a word or two on the board');
  assert.match(renders.week, /class="wk-legend"/, 'and the note says what the clock means');
  assert.ok(!wear.weekHTML(week(forecast, nowMs).map(d => ({ ...d, day: null, night: null }))).includes('wk-legend'), 'only when a pick has it');
  assert.match(renders.slotHead, /Typical weather/);
  assert.match(renders.plan, /≈/, 'typical weather is marked in the plan');
  assert.match(renders.pack, /data-action="trip-copy"/);
  assert.match(renders.pack, /data-action="trip-share"/);
  assert.ok(!trip.tripPackHTML(packed, saved).includes('data-action="trip-share"'), 'Share only where the browser can');
});

test('the empty trip explains itself in one sentence, and never promises a count packTrip doesn’t keep', () => {
  const html = trip.tripFormHTML({ place: null, fromISO: today, toISO: shiftISO(today, 3), events: [], max: 3 }, { today });
  assert.match(html, /<p>Pick a place and dates, and get the fewest bottles that cover every day and night there\.<\/p>/);
  assert.ok(!/two to four/.test(html));
  assert.match(html, /data-action="trip-max" data-value="3" aria-pressed="true"/, 'three by default, as packTrip');
  assert.match(html, /type="date"[^>]*data-field="trip-from"[^>]*min="2026-09-28"/, 'the trip starts today or later');
});

test('a trip is kept on the device and read back whole', () => {
  assert.equal(trip.loadTrip(), null, 'none yet');
  trip.saveTrip(saved);
  const back = trip.loadTrip();
  assert.equal(back.place.name, EVIL);
  assert.equal(back.windows.length, tripWindows.length);
  assert.ok(back.windows.every(w => w.date instanceof Date && !Number.isNaN(+w.date)), 'each window’s date comes back a Date');
  assert.deepEqual(back.events, saved.events);
  assert.ok(back.windows.some(w => w.typical));
  // It packs again from what was saved, as the pane does after a reload.
  const again = packTrip(bottles, withEvents(back.windows, back.events.map(e => ({ ...e, occasion: occasionById(e.occasion) }))), { max: back.max });
  assert.deepEqual(again.bottles.map(b => b.record.id), packed.bottles.map(b => b.record.id));
  // Damaged or foreign data reads as no trip, and stray events drop out.
  localStorage.setItem('scentcast.trip', '{not json');
  assert.equal(trip.loadTrip(), null);
  localStorage.setItem('scentcast.trip', JSON.stringify({ ...saved, place: { name: 'x' } }));
  assert.equal(trip.loadTrip(), null);
  localStorage.setItem('scentcast.trip', JSON.stringify({ ...saved, max: 9, events: [...saved.events, { dateISO: third, slot: 'noon', occasion: 'formal' }, { dateISO: third, slot: 'day', occasion: 'gala' }] }));
  assert.equal(trip.loadTrip().max, 3);
  assert.equal(trip.loadTrip().events.length, 1);
});

test('a trip’s dates are checked in plain words', () => {
  const ok = { place: saved.place, fromISO: today, toISO: shiftISO(today, 4) };
  assert.equal(trip.checkTrip(ok, today), '');
  assert.match(trip.checkTrip({ ...ok, place: null }, today), /Choose where/);
  assert.match(trip.checkTrip({ ...ok, fromISO: shiftISO(today, -1) }, today), /passed/);
  assert.match(trip.checkTrip({ ...ok, toISO: shiftISO(today, -1), fromISO: today }, today), /ends before it starts/);
  assert.match(trip.checkTrip({ ...ok, toISO: shiftISO(today, trip.MAX_TRIP_DAYS) }, today), /up to 31 days/);
  assert.match(trip.checkTrip({ ...ok, fromISO: shiftISO(today, 360), toISO: shiftISO(today, 370) }, today), /within a year/);
});

test('the packing list says what to pack and what to wear each day', () => {
  const text = trip.packingText(packed, saved);
  const lines = text.split('\n');
  assert.equal(lines[0], `Packing for ${EVIL}, ${trip.datesText(saved.fromISO, saved.toISO)}`);
  for (const b of packed.bottles) assert.ok(text.includes(`${b.record.name} (${b.record.brand}): `), b.record.name);
  assert.equal(lines.filter(l => /^\w{3}, \w{3} \d+: /.test(l)).length, new Set(tripWindows.map(w => w.dateISO)).size, 'a line a day');
  const formal = packed.plan.find(p => p.occasion);
  assert.ok(lines.includes(`${trip.windowName(third, 'day').split(',')[0]}, ${trip.datesText(third, third)}: ${packed.plan.find(p => p.window.dateISO === third && p.window.slot === 'day').pick.name} by day; formal at night: ${formal.pick.name}`), 'the event names itself, then its bottle');
  assert.match(text, /formal wear on [A-Z][a-z]{2}\b/, 'weekdays keep their capitals');
  assert.ok(!/\(formal\)|\bon (mon|tue|wed|thu|fri|sat|sun)\b/.test(text), text);
  assert.match(text, /Typical weather from/, 'and where the forecast ends');
  // Roles read as words.
  const roles = packed.bottles.map(b => trip.roleOf(b.record, packed.plan));
  assert.ok(roles.every(r => /^(Every|\d|A spare|Formal)/.test(r) && !/undefined/.test(r)), roles.join(' / '));
  assert.ok(roles.some(r => /formal wear on \w{3}/.test(r)), roles.join(' / '));
  assert.equal(trip.datesText('2026-10-16', '2026-10-19'), 'Oct 16–19');
  assert.equal(trip.datesText('2026-10-30', '2026-11-02'), 'Oct 30 – Nov 2');
});

test('a trip under way keeps its start: events and the end can still change', () => {
  const started = { ...saved, fromISO: shiftISO(today, -2), toISO: shiftISO(today, 3) };
  const draft = { place: started.place, fromISO: started.fromISO, toISO: started.toISO, events: [], max: 3 };
  assert.equal(trip.checkTrip(draft, today, started), '', 'its own start has passed, and that’s fine');
  assert.equal(trip.checkTrip({ ...draft, toISO: shiftISO(today, 6) }, today, started), '', 'a longer stay');
  assert.match(trip.checkTrip({ ...draft, fromISO: shiftISO(today, -1) }, today, started), /starts on a date that has passed/, 'a new start can’t be in the past');
  assert.match(trip.checkTrip({ ...draft, toISO: shiftISO(today, -1) }, today, started), /ends on a date that has passed/);
  // The form: the start may stay where it was; events go on days to come.
  const html = trip.tripFormHTML(draft, { today, adding: { dateISO: today, slot: 'night', occasion: 'date' }, editing: true, packed: true, startedOn: started.fromISO });
  assert.match(html, new RegExp(`data-field="trip-from"[^>]*min="${started.fromISO}"`));
  assert.match(html, new RegExp(`data-field="trip-to"[^>]*min="${today}"`));
  const days = [...html.matchAll(/<option value="(\d{4}-\d{2}-\d{2})"/g)].map(m => m[1]);
  assert.deepEqual(days, Array.from({ length: 4 }, (_, i) => shiftISO(today, i)), 'the event’s day: today on');
  // Whose weather: the days gone by don't count, and typical weather starts
  // after the last forecast window.
  const w = (dateISO, typical = false) => ({ dateISO, slot: 'day', typical });
  const past = [w(shiftISO(today, -2), true), w(shiftISO(today, -1), true), w(today), w(shiftISO(today, 1)), w(shiftISO(today, 2), true)];
  assert.deepEqual(trip.weatherOf(past, today), { all: false, some: true, from: shiftISO(today, 2) });
  assert.deepEqual(trip.weatherOf(past.slice(0, 4), today), { all: false, some: false, from: null });
  assert.deepEqual(trip.weatherOf([w(today, true), w(shiftISO(today, 1)), w(shiftISO(today, 2))], today), { all: false, some: false, from: null }, 'today’s daytime gone from the forecast isn’t “typical from today”');
  assert.equal(trip.weatherOf([w(today, true), w(shiftISO(today, 1), true)], today).all, true);
  const summary = trip.tripSummaryHTML({ ...started, windows: past }, { today });
  assert.match(summary, new RegExp(`typical weather from ${trip.datesText(shiftISO(today, 2), shiftISO(today, 2))}\\.`));
});

test('a trip under way updates from the form: the open event is added, the days gone keep their weather, and a date changed mid-fetch isn’t saved', async () => {
  // The pane's handlers with no page: the shell's calls do nothing, and the
  // weather comes from the synthetic forecast a moment later.
  const { state } = app;
  const live = syntheticForecast(10, { start: new Date(Date.now() - 4 * 3600e3 - 86_400_000).toISOString().slice(0, 10) });
  state.wx = summarize(live);
  const today = state.wx.todayISO;
  state.demo = { fetched: today, fragrances };
  Object.assign(state, { shared: null, active: 'demo', route: { dest: 'wear', pane: 'trip' } });
  const realFetch = globalThis.fetch, realDoc = globalThis.document;
  const asked = [];
  globalThis.fetch = async url => {
    const u = new URL(String(url));
    asked.push(u);
    await new Promise(r => setTimeout(r, 20));
    const body = u.hostname.startsWith('archive')
      ? syntheticForecast(Math.round((Date.parse(u.searchParams.get('end_date')) - Date.parse(u.searchParams.get('start_date'))) / 864e5) + 1, { start: u.searchParams.get('start_date') })
      : live;
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };
  globalThis.document = { querySelector: () => null, getElementById: () => null, activeElement: null };
  const ui = { renderPage() {}, refocus() { return false; }, keepingFocus(el, scope, f) { f(); } };
  try {
    // Started two days ago; those days' weather is marked to tell it apart.
    const past = [-2, -1].flatMap(d => ['day', 'night'].map(slot => ({ ...wx[slot], slot, dateISO: shiftISO(today, d), label: 'x', feelsF: 40 })));
    trip.saveTrip({ place: { name: 'Lisbon', region: '', lat: 38.7, lon: -9.1 }, fromISO: shiftISO(today, -2), toISO: shiftISO(today, 2), events: [], max: 3, windows: [...past, ...windows.filter(w => w.dateISO >= today).slice(0, 6)], fetchedAt: Date.now() });
    trip.actions['trip-edit'](null, ui);
    trip.actions['trip-ev-add'](null, ui); // filled in (formal, the first night to come) but never Added
    trip.changes['trip-to']({ value: shiftISO(today, 4) }, ui);
    const packing = trip.forms['trip-pack'](null, ui);
    trip.changes['trip-to']({ value: shiftISO(today, 9) }, ui); // while the weather loads
    await packing;
    const back = trip.loadTrip();
    assert.equal(back.fromISO, shiftISO(today, -2), 'the start stays');
    assert.equal(back.toISO, shiftISO(today, 4), 'the dates asked for, not the ones picked meanwhile');
    assert.equal(back.windows.at(-1).dateISO, shiftISO(today, 4), 'and weather for those dates');
    assert.deepEqual(back.events, [{ dateISO: today, slot: 'night', occasion: 'formal' }], 'the open event, on the first night still to come');
    assert.deepEqual(back.windows.filter(w => w.dateISO < today).map(w => w.feelsF), [40, 40, 40, 40], 'the days gone keep the weather saved for them');
    assert.ok(asked.every(u => !u.hostname.startsWith('archive') || u.searchParams.get('start_date') >= today), 'nothing fetched for them');
    // An event on the same trip: no fetch at all.
    asked.length = 0;
    trip.actions['trip-edit'](null, ui);
    trip.actions['trip-ev-add'](null, ui);
    trip.changes['trip-ev-date']({ value: shiftISO(today, 1) });
    trip.changes['trip-ev-occ']({ value: 'date' });
    await trip.forms['trip-pack'](null, ui);
    assert.equal(asked.length, 0);
    assert.deepEqual(trip.loadTrip().events.map(e => `${e.dateISO} ${e.slot} ${e.occasion}`), [`${today} night formal`, `${shiftISO(today, 1)} night date`]);
  } finally {
    globalThis.fetch = realFetch;
    globalThis.document = realDoc;
    state.route = null;
  }
});

test('night windows draw the moon, days the sun', () => {
  assert.match(wxIconFor({ slot: 'night', category: 'clear' }), /class="mn"/);
  assert.match(wxIconFor({ slot: 'night', category: 'partly' }), /class="mn"/);
  assert.match(wxIconFor({ slot: 'day', category: 'clear' }), /class="sn"/);
  assert.match(wxIconFor({ slot: 'night', category: 'rain' }), /data-cat="rain"/, 'clouds and rain look the same either way');
  const nightHead = wear.slotHeadHTML({ ...wx.night, category: 'clear' }, 20, { id: 'x' });
  assert.match(nightHead, /class="mn"/);
  assert.ok(!/class="sn"/.test(nightHead));
  assert.ok(!/class="sn"/.test(trip.tripPlanHTML({ ...packed, plan: packed.plan.filter(p => p.window.slot === 'night').map(p => ({ ...p, window: { ...p.window, category: 'clear' } })) }, { today })), 'nor the trip’s nights');
});

test('“When and where?” says Day and Night, and the date of the window shown', () => {
  const later = { ...wx, day: { ...wx.day, dateISO: shiftISO(today, 1) } };
  const bar = slot => when.whenBarHTML({ home: { name: 'Here' }, today, slot, wx: later });
  for (const slot of ['day', 'night']) assert.match(bar(slot), /aria-label="Time of day"[^]*>Day<[^]*>Night</);
  assert.ok(!/Tonight|Tomorrow night/.test(bar('night')));
  assert.match(bar('day'), /Date: Tomorrow\. Change/, 'today’s daytime over: Day is tomorrow’s, and the pill says so');
  assert.match(bar('night'), /Date: Today\. Change/);
});

test('an event’s heading says what, when and where', () => {
  const formal = occasionById('formal');
  const sat = { slot: 'night', dateISO: '2026-10-17' };
  assert.equal(when.occasionTitle(formal, sat, { today: '2026-10-14', place: { name: 'Chicago' } }), 'Formal · Sat night in Chicago');
  assert.equal(when.occasionTitle(formal, { ...sat, dateISO: '2026-10-14' }, { today: '2026-10-14' }), 'Formal · tonight');
  assert.equal(when.whenPhrase({ slot: 'day', dateISO: '2026-10-15' }, '2026-10-14'), 'tomorrow');
  assert.equal(when.whenPhrase({ slot: 'day', dateISO: '2026-12-12' }, '2026-10-14'), 'Sat, Dec 12');
  assert.equal(when.whenPhrase({ slot: 'night', dateISO: '2026-12-12' }, '2026-10-14'), 'Sat night, Dec 12');
});

test('rankings take your ratings and the rotation nudge; the cache follows the saved ratings', () => {
  const { state } = app;
  // The Week reads the clock, so this forecast starts today (UTC-4, as the fixture).
  const live = syntheticForecast(8, { start: new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10) });
  const wx = summarize(live);
  const today = wx.todayISO;
  state.demo = { fetched: today, fragrances };
  state.forecast = live;
  state.wx = wx;
  // A journal begun 60 days ago in which every bottle was worn 10 to 17
  // days back (too long ago to count against it), but one that ranks within
  // reach of today's top and was never worn.
  // Now plans its next window first (tonight, once the day is over).
  const next = [wx.day, wx.night].filter(Boolean).sort(app.byTime)[0];
  const plain = rank(app.activeFragrances(), next, next.slot, { todayISO: next.dateISO });
  const idle = plain.find((r, i) => i > 0 && plain[0].score - r.score <= PLAN_MARGIN && r.tier === plain[0].tier).fragrance;
  state.history = [
    ...app.activeFragrances().filter(f => f.id !== idle.id).map((f, i) => ({ id: f.id, date: shiftISO(today, -10 - (i % 8)), slot: 'day' })),
    { id: plain[0].fragrance.id, date: shiftISO(today, -60), slot: 'night' },
  ];
  const records = app.rankedFragrances();
  assert.equal(app.rankedFragrances(), records, 'cached while nothing changes');
  assert.deepEqual(records.map(f => f.id), app.activeFragrances().map(f => f.id), 'the bottles switched on');

  app.computeToday();
  const day = state.today[next.slot];
  const direct = rank(records, day.win, next.slot, { history: state.history, todayISO: day.win.dateISO, nudge: true });
  assert.ok(direct.some(r => r.nudged), 'the fixture leaves a bottle neglected a month within reach');
  assert.deepEqual(day.ranked.map(r => r.fragrance.id), direct.map(r => r.fragrance.id), 'Now plans with the nudge');
  assert.equal(day.pick.fragrance.id, direct[0].fragrance.id);
  assert.ok(day.pick.reasons.some(r => /^Not worn (yet|in \d+ days)$/.test(r.text)));
  const occ = app.rankContext('occ', wx.night, occasionById('formal'));
  assert.deepEqual(occ.map(r => r.fragrance.id), rank(records, wx.night, 'night', { occasion: occasionById('formal'), history: state.history, todayISO: wx.night.dateISO, nudge: true }).map(r => r.fragrance.id), 'Occasion ranks with it too');
  assert.ok(app.computeWeek().some(d => [d.day, d.night].some(p => p?.pick.nudged)), 'and the Week');

  // Rate today's pick 1★: the bottle page saves it and renders, and the next ranking reads it.
  const top = day.pick.fragrance.id;
  setSkin(top, { rating: 1, longevity: 1 });
  const rated = app.rankedFragrances();
  assert.notEqual(rated, records, 'a saved rating refreshes the cache');
  assert.deepEqual(rated.find(f => f.id === top).personal, { rating: 1, longevity: 1, sillage: 0 });
  app.computeToday();
  assert.notEqual(state.today[next.slot].pick.fragrance.id, top, 'a 1★ bottle sits out');
  assert.ok(state.today[next.slot].ranked.find(r => r.fragrance.id === top).reasons.some(r => r.text === 'You rate it 1★'));
  assert.ok(!fragrances.find(f => f.id === top).personal, 'the records themselves stay as they were');
  assert.ok(!app.activeFragrances().find(f => f.id === top).personal, 'and the pool’s questions keep the crowd’s footing');
});

test('Occasion nudges only today here: an event on a later date gets the best for it', () => {
  const { state } = app;
  const live = syntheticForecast(8, { start: new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10) });
  const wx = summarize(live);
  const today = wx.todayISO;
  Object.assign(state, { demo: { fetched: today, fragrances }, forecast: live, wx, loc: { name: 'Here', lat: 40, lon: -74 }, shared: null, active: 'demo', occasionSlot: null });
  const casual = occasionById('casual');
  const pane = wear.wear.panes.find(p => p.id === 'occasion');
  const route = { dest: 'wear', pane: 'occasion', arg: 'casual' };
  const win = when.eventWindow(casual.slot).win;
  // A journal where the one bottle within reach of the top has sat a month
  // (the rest worn 12 to 19 days back, too long ago to count against them).
  const plain = rank(app.rankedFragrances(), win, win.slot, { occasion: casual, todayISO: win.dateISO });
  const idle = plain.find((r, i) => i > 0 && plain[0].score - r.score <= PLAN_MARGIN && r.tier === plain[0].tier).fragrance;
  state.history = app.activeFragrances().filter(f => f.id !== idle.id).map((f, i) => ({ id: f.id, date: shiftISO(today, -12 - (i % 8)), slot: 'day' }))
    .concat({ id: idle.id, date: shiftISO(today, -40), slot: 'night' });
  const nowHtml = pane.render({}, route);
  assert.equal(state.contexts.occ.ranked[0].fragrance.id, idle.id, 'today here, the idle bottle takes its turn');
  assert.ok(state.contexts.occ.ranked[0].nudged);
  assert.match(nowHtml, /<p class="kicker">Due a wear<\/p>/, 'and the card doesn’t call it the best');
  assert.ok(!nowHtml.includes('Best for casual'));
  // Five days on, the journal can't say what will be idle: the best leads.
  when.when.dateISO = shiftISO(today, 5);
  try {
    const laterHtml = pane.render({}, route);
    assert.equal(state.contexts.occ.win.dateISO, shiftISO(today, 5));
    assert.ok(!state.contexts.occ.ranked.some(r => r.nudged), 'never nudged on another date');
    assert.ok(!state.contexts.occ.ranked.some(r => r.reasons.some(x => /^Not worn/.test(x.text))));
    assert.match(laterHtml, /Best for casual/);
  } finally {
    when.when.dateISO = null;
  }
});

test('a wear from the Occasion pane keeps its occasion; from Now, daily', () => {
  const { state } = app;
  state.loc = { name: 'Here', lat: 40.7, lon: -74 };
  const formal = occasionById('formal');
  app.storeContext('occ', wx.night, formal, rank(fragrances, wx.night, 'night', { occasion: formal }));
  app.storeContext('day', wx.day, null, rank(fragrances, wx.day, 'day'));
  const ui = { keepingFocus() {}, render() {} };
  wear.actions.wear({ dataset: { ctx: 'occ', id: fragrances[2].id } }, ui);
  wear.actions.wear({ dataset: { ctx: 'day', id: fragrances[3].id } }, ui);
  const byslot = Object.fromEntries(state.history.filter(h => h.date === today).map(h => [h.slot, h]));
  assert.equal(byslot.night.occasion, 'formal');
  assert.equal(byslot.day.occasion, 'daily');
});
