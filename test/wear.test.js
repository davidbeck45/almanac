import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { packTrip, withEvents } from '../src/pack.js';
import { rank, PLAN_MARGIN } from '../src/engine.js';
import { OCCASIONS, occasionById } from '../src/occasions.js';
import { sprayGuide } from '../src/spray.js';
import { setSkin, loadSkin, loadAsked, markAsked } from '../src/skin.js';
import { planTies } from '../src/contrast.js';
import { summarize, week } from '../src/weather.js';
import { renderScene } from '../src/scene.js';
import { shiftISO } from '../src/history.js';
import * as wear from '../src/views/wear.js';
import * as trip from '../src/views/wear/trip.js';
import * as when from '../src/views/wear/when.js';
import { placeSheetHTML, datePillHTML } from '../src/views/wear/pickers.js';
import { wxIconFor } from '../src/ui/components.js';
import { esc } from '../src/ui.js';
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
  fetchedAt: nowMs,
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
    pickFull: wear.pickHTML(entry, 'occ', null, { full: true, kicker: 'Best for formal wear' }),
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
  assert.match(renders.plan, /Open a bottle to see why\./, 'not Tap: a mouse opens it too');
  assert.ok(!/\bTap\b/.test(renders.plan + renders.week));
  assert.match(renders.pack, /data-action="trip-copy"/);
  assert.match(renders.pack, /data-action="trip-share"/);
  assert.ok(!trip.tripPackHTML(packed, saved).includes('data-action="trip-share"'), 'Share only where the browser can');
});

test('a bottle worn on every window of the trip is named by the slot packTrip says, as its text does', () => {
  const [a, b] = fragrances;
  const notice = slot => trip.tripPackHTML({ ...packed, variety: { add: b, everyDay: [a], slot } }, saved);
  assert.match(notice('night'), /is worn every night\. Pack <b>[^<]+<\/b> too and each gets a night off/);
  assert.match(notice('day'), /is worn every day\. Pack .* a day off/);
  assert.match(notice(null), /every day, by day or night\. .* a break/);
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
  // A window packTrip can't rank drops out, so the pane never crashes on it;
  // with none left, or no time it was fetched, there's no trip.
  const noon = { dateISO: third, feelsF: 60, slot: 'noon' };
  localStorage.setItem('scentcast.trip', JSON.stringify({ ...saved, windows: [...tripWindows, noon] }));
  const kept = trip.loadTrip();
  assert.equal(kept.windows.length, tripWindows.length);
  assert.doesNotThrow(() => packTrip(bottles, kept.windows, { max: kept.max }));
  for (const bad of [{ windows: [noon] }, { windows: [] }, { fetchedAt: 0 }, { fetchedAt: 'x' }]) {
    localStorage.setItem('scentcast.trip', JSON.stringify({ ...saved, ...bad }));
    assert.equal(trip.loadTrip(), null, JSON.stringify(bad));
  }
});

test('a trip whose weather couldn’t refresh says the day it was saved on this device, not in UTC', () => {
  const tz = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try {
    // 8:30 pm in New York, already the next day in UTC.
    assert.match(trip.staleNote(Date.parse('2026-10-14T20:30:00-04:00')), /uses what was saved Oct 14\.$/);
  } finally {
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  }
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
  const ui = { renderPage() {}, refocus() { return false; }, inSight() { return true; }, keepingFocus(el, scope, f) { f(); } };
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

test('the week board promises no repeats only when there are none, and says rain in words', () => {
  const days = week(forecast, nowMs);
  const one = bottles[1];
  const pickOf = (f, ctx) => ({ pick: { fragrance: f, parts: {}, reasons: [] }, ctx, worn: false });
  // Each window its own bottle, as the planner does with enough of them.
  let i = 1;
  const varied = days.map(d => ({ ...d, day: d.day && pickOf(bottles[i++], 'a'), night: d.night && pickOf(bottles[i++], 'b') }));
  assert.match(wear.weekHTML(varied), /so nothing repeats back to back\. Open a bottle to see why\./);
  // A list of one: the same bottle every window.
  const same = days.map(d => ({ ...d, day: d.day && pickOf(one, 'a'), night: d.night && pickOf(one, 'b') }));
  const html = wear.weekHTML(same);
  assert.ok(!/repeats/.test(html), 'a list of one can’t keep that promise');
  assert.match(html, /Planned against the forecast\. Open a bottle to see why\./);
  // Rain: the chance and the word, the whole phrase for screen readers.
  const wet = wear.weekHTML(varied.map((d, n) => ({ ...d, pop: n === 1 ? 87 : 10 })));
  assert.match(wet, /<span class="wk-pop">87%<span class="visually-hidden"> chance of<\/span> rain<\/span>/);
  assert.equal((wet.match(/% rain|chance of/g) ?? []).length, 1, 'only on the rainy day');
});

test('the compact band keeps trees and the cabin off the ground under its line of text', () => {
  // Where the scene stands its trees and cabin, as shares of its width.
  const props = svg => {
    const W = +svg.match(/viewBox="0 0 (\d+)/)[1];
    return [...svg.matchAll(/translate\(([\d.]+) ([\d.]+)\)/g)].filter(m => +m[2] > 130).map(m => +m[1] / W);
  };
  assert.ok(props(renderScene({ aspect: 2.6 })).some(x => x < 0.3), 'without it, trees stand on the left');
  for (const clear of [0.35, 0.6, 0.8]) {
    const xs = props(renderScene({ aspect: 2.6, clear }));
    assert.ok(xs.length && xs.every(x => x >= clear), `${clear}: ${xs.map(x => x.toFixed(2))}`);
  }
  // The line ends about two thirds of the way across a phone's band, a third
  // of the way across a desktop's (measured at 390 and 1440 wide).
  const sky = { loc: { name: 'New York', lat: 40 }, wx, loading: false, error: null };
  for (const [aspect, end] of [[390 / 148, 0.67], [760 / 156, 0.35]]) {
    const xs = props(wear.heroHTML(sky, { aspect, compact: true }));
    assert.ok(xs.length && xs.every(x => x > end + 0.02), `${aspect.toFixed(2)}: ${xs.map(x => x.toFixed(2))}`);
  }
  // Now's tall hero with no bottle (no place yet, loading, an error, nothing
  // to rank) keeps the ground under its temperature open, as it does with one.
  for (const state of [sky, { loc: null, wx: null, loading: true, error: null }, { loc: null, wx: null, loading: false, error: 'x' }]) {
    for (const aspect of [1.3, 2.4]) {
      const svg = wear.heroHTML(state, { aspect });
      const xs = props(svg);
      assert.ok(xs.length && xs.every(x => x >= 0.45), `${aspect}: ${xs.map(x => x.toFixed(2))}`);
      assert.match(svg, /<rect x="-13" y="-18" width="26"/, 'the cabin still stands');
    }
  }
});

test('a first visit waiting on the forecast says so, and says it’s slow once it is', () => {
  const loc = { name: 'Chicago', lat: 41.88 };
  const words = state => wear.heroHTML({ loc, wx: null, error: null, loading: false, ...state }, { aspect: 1.3 })
    .match(/<div class="hero-meta">([\s\S]*?)<\/div>\s*<\/div>/)[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  assert.equal(words({ loading: true }), 'Checking the sky…');
  assert.equal(words({ loading: true, slow: true }), 'Still checking the sky… The forecast is slow to answer.');
  assert.equal(words({ error: 'The forecast service isn’t answering. Try again in a minute.' }), 'Weather unavailable Chicago');
  assert.equal(words({ loc: null }), 'Where are you? Set a location to get picks.');
});

test('on phones the hero’s name stands under the bottle: trees keep off it, and a long name takes two lines; beside the bottle a longer one steps down a size', () => {
  const props = svg => {
    const W = +svg.match(/viewBox="0 0 (\d+)/)[1];
    return [...svg.matchAll(/translate\(([\d.]+) ([\d.]+)\)/g)].filter(m => +m[2] > 180).map(m => +m[1] / W);
  };
  const ranked = rank(fragrances, wx.day, 'day', { history: [], todayISO: today });
  const sky = { loc: { name: 'New York', lat: 40 }, wx, loading: false, error: null };
  const hero = (aspect, f) => wear.heroHTML(sky, { aspect, pick: { entry: { ...ranked[0], fragrance: f }, win: wx.day, worn: false } });
  const short = fragrances.find(f => f.name.length <= 16), long = fragrances.find(f => f.name.length > 18 && f.name.length <= 26);
  const longer = fragrances.find(f => f.name.length > 30);
  // The near hill's trees: none behind the name on a phone (from 320 to 430
  // wide), where they stand on a wide hero.
  for (const aspect of [320 / 288, 375 / 288, 430 / 320]) {
    const near = props(hero(aspect, short));
    assert.ok(near.every(x => x < 0.45), `${aspect.toFixed(2)}: ${near.map(x => x.toFixed(2))}`);
  }
  assert.ok(props(hero(2.4, short)).some(x => x > 0.87), 'a wide hero keeps them');
  assert.match(hero(1.3, long), /class="hero-pick long"/);
  assert.match(hero(1.3, short), /class="hero-pick"/);
  // Beside the bottle, past two lines of the title size, it steps down a size.
  assert.match(hero(2.4, longer), /class="hero-pick long longer"/);
});

test('on wide heroes the sun keeps clear of the name beside the bottle, waiting on the bottle’s left', async () => {
  const { stagePoint, skyLight } = await import('../src/scene.js');
  for (const aspect of [1.8, 2.3, 3.4]) {
    const stage = stagePoint(aspect, 0.64);
    const W = 220 * aspect;
    for (let p = 0; p <= 1; p += 0.01) {
      const sun = skyLight({ phase: 'day', sunProgress: p, aspect, stage: stage.scene });
      // The name stands right of the bottle, about a third of the width, no higher than its cap.
      const x = sun.x * W, sx = stage.scene * W;
      const behind = x > sx - 44 - 17 && x < sx + 44 + 0.32 * W + 17 && sun.y * 220 + 17 > stage.y * 220 - 92;
      assert.ok(!behind, `at ${aspect} the sun at ${p.toFixed(2)} hangs behind the bottle or its name`);
    }
    // Late in the day it waits on the bottle's left, so the rim light comes from there.
    assert.ok(skyLight({ phase: 'day', sunProgress: 0.9, aspect, stage: stage.scene }).x < stage.scene);
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

test('rankings take your ratings and the rotation nudge; the cache follows the saved ratings', async () => {
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
  assert.ok(!app.activeFragrances().find(f => f.id === top).personal, 'activeFragrances() stays as the crowd has it');
  // The pool's questions send the rated records, so the gap finder lets a 1★ bottle cover nothing.
  const loc = state.loc;
  state.loc = null; // no place: the default climate, no archive call
  try {
    assert.deepEqual((await app.poolInputs()).owned.find(f => f.id === top).personal, { rating: 1, longevity: 1, sillage: 0 });
  } finally {
    state.loc = loc;
  }
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
  assert.match(nowHtml, /Also good for casual wear/, 'the occasion as the reasons name it');
  // Five days on, the journal can't say what will be idle: the best leads.
  when.when.dateISO = shiftISO(today, 5);
  try {
    const laterHtml = pane.render({}, route);
    assert.equal(state.contexts.occ.win.dateISO, shiftISO(today, 5));
    assert.ok(!state.contexts.occ.ranked.some(r => r.nudged), 'never nudged on another date');
    assert.ok(!state.contexts.occ.ranked.some(r => r.reasons.some(x => /^Not worn/.test(x.text))));
    assert.match(laterHtml, /<p class="kicker">Best for casual wear<\/p>/);
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

test('Now’s cards read in the order they’re drawn, and only the window has a heading', () => {
  const ranked = rank(fragrances, wx.day, 'day', { history: [], todayISO: today });
  const pick = wear.pickHTML(ranked[0], 'day', null, { spray: sprayGuide(ranked[0].fragrance, wx.day) });
  assert.ok(pick.indexOf('data-action="spray-open"') < pick.indexOf('data-action="wear"'), 'the spray line, drawn above Wear this, comes first for Tab too');
  // Beside today's card, tonight's pick is a landmark named "Tonight", not a
  // heading that would file it (and the shelf after it) under "Today".
  const next = wear.nextWindowHTML({ win: wx.night, pick: ranked[1] }, null, 12);
  assert.match(next, /<aside class="next-window" aria-labelledby="next-title"/);
  assert.ok(!/<h\d/.test(next), 'no heading');
});

test('an occasion tile is named by its label and described by its blurb, once', () => {
  const html = wear.occasionPickerHTML('formal');
  assert.ok(!html.includes('visually-hidden'), 'the blurb isn’t in the name too');
  for (const o of OCCASIONS) assert.ok(html.includes(`title="${esc(o.blurb)}"`), `${o.id}: its blurb is the title`);
});

test('an event’s heading keeps the date and place asked for while the weather loads', () => {
  const { state } = app;
  const live = syntheticForecast(8, { start: new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10) });
  const wxNow = summarize(live);
  Object.assign(state, { forecast: live, wx: wxNow, loc: { name: 'Here', lat: 40, lon: -74 }, occasionSlot: null });
  const pane = wear.wear.panes.find(p => p.id === 'occasion');
  const route = { dest: 'wear', pane: 'occasion', arg: 'formal' };
  // A date past the forecast and a city: nothing fetched yet.
  const far = shiftISO(wxNow.todayISO, 40);
  Object.assign(when.when, { dateISO: far, place: null });
  try {
    assert.equal(pane.heading(route), when.occasionTitle(occasionById('formal'), { dateISO: far, slot: 'night' }, { today: wxNow.todayISO }));
    assert.match(pane.heading(route), /^Formal · \w{3} night, \w{3} \d+$/);
    when.when.place = { name: 'Chicago', lat: 41.9, lon: -87.6 };
    assert.match(pane.heading(route), /^Formal · \w{3} night, \w{3} \d+ in Chicago$/);
    when.when.dateISO = null;
    assert.equal(pane.heading(route), 'Formal · tonight in Chicago', 'a place alone means today there');
  } finally {
    Object.assign(when.when, { dateISO: null, place: null });
  }
});

test('a shared link that loads nothing offers the way back to the list under it, by name', () => {
  const { state } = app;
  const live = syntheticForecast(8, { start: new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10) });
  Object.assign(state, { forecast: live, wx: summarize(live), loc: { name: 'Here', lat: 40, lon: -74 }, demo: { fetched: today, fragrances } });
  state.shared = { name: 'Sam', ids: ['999999991'], records: [], missing: ['999999991'], loading: false };
  const now = wear.wear.panes.find(p => p.id === 'now');
  try {
    state.active = 'demo';
    assert.match(now.render({}, { dest: 'wear', pane: 'now' }), /data-action="shared-close"><span>Back to David’s wardrobe<\/span>/);
    state.active = 'mine';
    assert.match(now.render({}, { dest: 'wear', pane: 'now' }), /<span>Back to Mine<\/span>/);
    assert.ok(!now.render({}, { dest: 'wear', pane: 'now' }).includes('my picks'));
  } finally {
    Object.assign(state, { shared: null, active: 'demo' });
  }
});

test('copying the packing list: when the browser won’t, it offers Share only where there is one, and focus stays on Copy', async () => {
  trip.saveTrip(saved);
  const realDoc = globalThis.document, realNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const button = { focused: 0, focus() { this.focused++; } };
  const field = { select() { doc.activeElement = field; }, remove() { doc.activeElement = null; }, style: {} };
  const doc = { activeElement: button, body: { append() {} }, createElement: () => field, execCommand: () => false, querySelector: () => null };
  const toasts = [];
  const ui = { showToast: html => toasts.push(html) };
  try {
    globalThis.document = doc;
    for (const share of [undefined, async () => {}]) {
      Object.defineProperty(globalThis, 'navigator', { value: { share, clipboard: { writeText: async () => { throw new Error('denied'); } } }, configurable: true });
      doc.activeElement = button;
      await trip.actions['trip-copy'](button, ui);
      assert.ok(button.focused > 0, 'focus goes back to the button');
    }
    assert.match(toasts[0], /won’t let the page copy\. Select the plan and copy it yourself\./);
    assert.ok(!/Share/.test(toasts[0]), 'no Share button, so no mention of one');
    assert.match(toasts[1], /Try Share instead\./);
  } finally {
    globalThis.document = realDoc;
    if (realNav) Object.defineProperty(globalThis, 'navigator', realNav);
  }
});

test('in forced colors the chosen occasion tile keeps a ring of its own', () => {
  // Its gold border, tint and glow are colors forced colors replace.
  const css = readFileSync(new URL('../src/css/wear.css', import.meta.url), 'utf8');
  const forced = [...css.matchAll(/@media \(forced-colors: active\) \{([\s\S]*?)\n\}/g)].map(m => m[1]).join('');
  assert.match(forced, /\.occ\[aria-checked='true'\] \{ outline: 2px solid Highlight/);
});

test('a night planned for a date: Now and the Week plan around it, say what for, and log the wear for it', () => {
  const { state } = app;
  const live = syntheticForecast(8, { start: new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10) });
  const wx = summarize(live);
  const today = wx.todayISO;
  Object.assign(state, { demo: { fetched: today, fragrances }, forecast: live, wx, loc: { name: 'Here', lat: 40.7, lon: -74 }, shared: null, active: 'demo', history: [], occasionSlot: null, slot: null, route: { dest: 'wear', pane: 'now' } });
  const date = occasionById('date'), formal = occasionById('formal');
  // Tonight a date, and a formal night later in the week.
  const later = week(live).find(d => d.dateISO === shiftISO(today, 3)).night;
  app.setEvent(wx.night.dateISO, 'night', 'date');
  app.setEvent(later.dateISO, 'night', 'formal');
  assert.deepEqual(JSON.parse(store.get('scentcast.events')).map(e => e.occasion), ['date', 'formal'], 'kept on the device');
  try {
    app.computeToday();
    const night = state.today.night;
    assert.equal(night.win.occasion.id, 'date');
    assert.equal(night.pick.fragrance.id, rank(app.rankedFragrances(), wx.night, 'night', { occasion: date })[0].fragrance.id, 'the best for a date');
    assert.equal(state.contexts.night.occasion, date, 'its context carries the occasion');
    // The Week agrees about today, and keeps the formal night's best for it.
    const days = app.computeWeek();
    const first = days.flatMap(d => [d.day, d.night]).filter(Boolean).slice(0, app.todaySlots().length);
    assert.deepEqual(app.todaySlots().map(p => p.pick.fragrance.id), first.map(p => p.pick.fragrance.id));
    const sat = days.find(d => d.dateISO === later.dateISO).night;
    assert.equal(sat.pick.fragrance.id, rank(app.rankedFragrances(), later, 'night', { occasion: formal, todayISO: later.dateISO })[0].fragrance.id);
    assert.ok(days.slice(0, 3).every(d => [d.day, d.night].every(p => !p || p.pick.fragrance.id !== sat.pick.fragrance.id)), 'not worn the days before');
    // Now's card says what tonight is for, with a way to clear it; the Week marks the planned nights.
    state.slot = 'night';
    const now = wear.wear.panes.find(p => p.id === 'now').render({}, state.route);
    assert.match(now, /<span class="event-tag">.*<span>For a date<\/span><\/span><button class="link-btn" data-action="event-clear" data-date="[\d-]+" data-slot="night">Clear<span class="visually-hidden">: Tonight isn’t for a date<\/span><\/button>/s);
    const board = wear.weekHTML(days);
    assert.equal((board.match(/class="wk-mark wk-event"/g) ?? []).length, 2);
    assert.match(board, /aria-label="[^"]+ night: [^"]+, for formal wear"/);
    assert.match(board, /What you planned gets its best bottle/);
    // A wear logged from tonight's card counts for a date.
    const ui = { keepingFocus() {}, render() {} };
    wear.actions.wear({ dataset: { ctx: 'night', id: night.pick.fragrance.id } }, ui);
    assert.equal(state.history.find(h => h.date === wx.night.dateISO && h.slot === 'night').occasion, 'date');
    // Clear: tonight is everyday again.
    wear.actions['event-clear']({ dataset: { date: wx.night.dateISO, slot: 'night' } }, { render() { app.computeToday(); }, showToast() {} });
    assert.equal(app.eventAt(wx.night), null);
    assert.ok(!state.today.night.win.occasion);
  } finally {
    app.setEvent(wx.night.dateISO, 'night', null);
    app.setEvent(later.dateISO, 'night', null);
    state.history = [];
    state.slot = null;
  }
});

test('the Occasion pane plans the window shown, at home only, and ranks a planned one as the plan does', () => {
  const { state } = app;
  const live = syntheticForecast(8, { start: new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10) });
  const wx = summarize(live);
  const today = wx.todayISO;
  Object.assign(state, { demo: { fetched: today, fragrances }, forecast: live, wx, loc: { name: 'Here', lat: 40.7, lon: -74 }, shared: null, active: 'demo', occasionSlot: null });
  const formal = occasionById('formal');
  const pane = wear.wear.panes.find(p => p.id === 'occasion');
  const route = { dest: 'wear', pane: 'occasion', arg: 'formal' };
  when.when.dateISO = shiftISO(today, 3);
  const win = when.eventWindow('night').win;
  // Wore its best two days before: unplanned, that counts against it there.
  const best = rank(app.rankedFragrances(), win, 'night', { occasion: formal, todayISO: win.dateISO })[0].fragrance;
  state.history = [{ id: best.id, date: shiftISO(today, 1), slot: 'night' }];
  try {
    const before = pane.render({}, route);
    assert.match(before, /<button class="btn secondary compact" data-action="occ-plan" data-date="[\d-]+" data-slot="night" data-occasion="formal">.*Plan it for \w+ night<\/span><\/button>/s);
    assert.ok(state.contexts.occ.ranked.find(r => r.fragrance.id === best.id).parts.rotation > 0);
    // Planned: the best for it, as Now and the Week will have it.
    const ui = { keepingFocus(el, scope, render) { render(); }, render() {}, showToast() {} };
    when.actions['occ-plan']({ dataset: { date: win.dateISO, slot: 'night', occasion: 'formal' } }, ui);
    assert.equal(app.eventAt(win).occasion, 'formal');
    const after = pane.render({}, route);
    assert.match(after, /<p class="occ-plan on">.*Planned for \w+ night<\/span><button class="link-btn" data-action="occ-plan"[^>]*>Clear/s);
    assert.equal(state.contexts.occ.ranked[0].fragrance.id, best.id);
    assert.ok(state.contexts.occ.event);
    assert.equal(app.computeWeek().find(d => d.dateISO === win.dateISO).night.pick.fragrance.id, best.id, 'the Week agrees');
    // On the same night another occasion says it's taken; planning it takes its place.
    const date = pane.render({}, { ...route, arg: 'date' });
    assert.match(date, /is planned for formal wear<\/span>/);
    assert.match(date, /Plan it for \w+ night/);
    // Elsewhere there's no plan to make: Now and the Week are for home.
    when.when.place = { name: 'Chicago', lat: 41.9, lon: -87.6 };
    assert.ok(!when.whenBarHTML({ ...when.when, home: state.loc, today, slot: 'night', wx, plan: null }).includes('occ-plan'));
    when.when.place = null;
    when.actions['occ-plan']({ dataset: { date: win.dateISO, slot: 'night', occasion: 'formal' } }, ui);
    assert.equal(app.eventAt(win), null, 'the same control clears it');
  } finally {
    when.when.dateISO = null;
    when.when.place = null;
    state.history = [];
    for (const e of [...state.events]) app.setEvent(e.dateISO, e.slot, null);
  }
});

// Now on a forecast that starts today, David's wardrobe, nothing worn: the
// pane as the shell draws it (computeToday, then the pane).
function nowOnToday(history = []) {
  const { state } = app;
  const live = syntheticForecast(8, { start: new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10) });
  Object.assign(state, { demo: { fetched: today, fragrances }, forecast: live, wx: summarize(live), loc: { name: 'Here', lat: 40, lon: -74 }, shared: null, active: 'demo', slot: null, history });
  const pane = wear.wear.panes.find(p => p.id === 'now');
  const draw = () => {
    app.computeToday();
    return clean(pane.render({}, { dest: 'wear', pane: 'now' }), 'Now');
  };
  return { state, draw };
}

test('Now says which bottles suit the window just as well, and how each differs, until he’s wearing one', () => {
  const { state, draw } = nowOnToday();
  let html = draw();
  const slots = app.todaySlots(), now = app.nowSlot();
  const ties = planTies(slots)[slots.indexOf(now)];
  assert.ok(ties.length, 'the fixture’s window is a toss-up');
  assert.match(html, /<p class="ties">/);
  for (const t of ties) {
    assert.ok(html.includes(`data-action="open" data-ctx="${now.win.slot}" data-id="${t.entry.fragrance.id}">${esc(t.entry.fragrance.name)}</button>`), `${t.entry.fragrance.name} opens its page`);
  }
  assert.match(html, /suits? (today|tonight) just as well\./);
  assert.ok(html.indexOf('class="ties"') > html.indexOf('class="reasons lead"') && html.indexOf('class="ties"') < html.indexOf('class="chips"'), 'one line under the reasons');
  // The Also good shelf tags the bottles within reach of the pick in a word,
  // above it or below.
  const tagged = html => [...html.matchAll(/data-id="([^"]+)" aria-label="[^"]*">(?:(?!<\/button>)[\s\S])*<span class="shelf-tag">/g)].map(m => m[1]);
  const within = (ids, slot) => ids.every(id => Math.abs(slot.ranked.find(r => r.fragrance.id === id).score - slot.pick.score) <= PLAN_MARGIN);
  assert.ok(tagged(html).length && within(tagged(html), now), 'only bottles within reach of the pick');
  // Wearing the pick: the choice is made. Wearing one far down the list,
  // the bottles well above it go untagged too.
  state.history = [{ id: now.pick.fragrance.id, date: now.win.dateISO, slot: now.win.slot, occasion: 'daily' }];
  html = draw();
  assert.ok(!html.includes('class="ties"'));
  state.history = [{ id: now.ranked.at(-1).fragrance.id, date: now.win.dateISO, slot: now.win.slot, occasion: 'daily' }];
  html = draw();
  assert.ok(within(tagged(html), app.nowSlot()));
  assert.ok(!tagged(html).includes(now.ranked[0].fragrance.id));
  // Every bottle within a point worn lately: nothing to offer.
  state.history = ties.map((t, i) => ({ id: t.entry.fragrance.id, date: shiftISO(now.win.dateISO, -1 - i), slot: 'day' }));
  html = draw();
  const after = planTies(app.todaySlots())[app.todaySlots().indexOf(app.nowSlot())];
  assert.ok(!after.some(t => ties.some(u => u.entry.fragrance.id === t.entry.fragrance.id)), 'what he wore lately isn’t offered');
  assert.equal(html.includes('class="ties"'), after.length > 0);
});

test('Now asks what it needs once each: stars for the unrated bottle he’s wearing, then how yesterday’s wore', () => {
  wear.forgetAsked();
  const { state, draw } = nowOnToday();
  state.base = { dest: 'wear', pane: 'now' };
  let html = draw();
  const now = app.nowSlot(), pick = now.pick.fragrance.id;
  const day = shiftISO(app.state.wx.todayISO, -1);
  const worn = fragrances.find(f => f.id !== pick && f.id !== evil.id);
  assert.ok(!html.includes('class="ask'), 'nothing worn, nothing asked');

  // Worn yesterday: how it wore, under today's picks.
  const yesterday = { id: worn.id, date: day, slot: 'night', occasion: 'daily' };
  state.history = [yesterday];
  html = draw();
  assert.ok(html.includes(`How did <b>${esc(worn.name)}</b> wear yesterday?`));
  assert.ok(html.indexOf('ask-skin') > html.indexOf('class="now-picks"') && html.indexOf('ask-skin') < html.indexOf('class="also"'));
  assert.match(html, /data-action="ask-lasts" data-value="1" data-id="[^"]+" aria-pressed="false"><span>Lasted longer/);
  assert.ok(!/aria-pressed="true"/.test(html.slice(html.indexOf('ask-skin'))), 'no answer chosen for him');

  // Wearing today's pick, unrated: its stars, in the pick card, alone.
  state.history = [{ id: pick, date: now.win.dateISO, slot: now.win.slot, occasion: 'daily' }, yesterday];
  html = draw();
  assert.match(html, /<div class="ask ask-stars">/);
  assert.ok(html.indexOf('ask-stars') > html.indexOf('data-action="wear"') && html.indexOf('ask-stars') < html.indexOf('class="next-window"'), 'beside Wear this');
  assert.ok(!html.includes('ask-skin'), 'one question at a time');
  assert.equal((html.match(/data-action="ask-rate"/g) ?? []).length, 5);

  // Rating it saves the stars, and they stay this visit, saying where it moved.
  const ui = { keepingFocus(el, scope, fn) { fn(); }, render() { app.computeToday(); } };
  wear.actions['ask-rate']({ dataset: { id: pick, value: '5' }, getAttribute: () => 'false' }, ui, { detail: 1 });
  assert.equal(loadSkin()[pick].rating, 5);
  assert.ok(loadAsked()[pick].stars);
  html = draw();
  assert.match(html, /<p class="ask-said">Rated 5★\. (Still|Now) \d+(st|nd|rd|th) for (today|tonight)[.,]/);
  assert.match(html, /data-action="ask-rate" data-value="5" data-id="[^"]+" aria-label="5 stars"/);
  assert.match(html, /aria-checked="true" tabindex="0" data-action="ask-rate" data-value="5"/);
  assert.ok(!html.includes('ask-skin'), 'still one at a time');

  // The next visit: rated, so not asked again, even once the stars are cleared; yesterday's turn.
  state.base = { dest: 'wear', pane: 'now' };
  setSkin(pick, { rating: null });
  html = draw();
  assert.ok(!html.includes('data-action="ask-rate"'), 'asked once');
  assert.ok(html.includes('ask-skin'));

  // An answer saves at once and holds the question for the other, then Done.
  wear.actions['ask-lasts']({ dataset: { id: worn.id, value: '1' } }, ui);
  assert.equal(loadSkin()[worn.id].longevity, 1);
  assert.ok(loadAsked()[worn.id].skin, 'asked from the first answer');
  html = draw();
  assert.ok(html.includes('Saved: it lasts longer on you.'));
  assert.match(html, /data-action="ask-lasts" data-value="1" data-id="[^"]+" aria-pressed="true"/);
  assert.match(html, /data-action="ask-skip" data-kind="skin" data-id="[^"]+">Done</);
  wear.actions['ask-projects']({ dataset: { id: worn.id, value: '-1' } }, ui);
  assert.ok(draw().includes('Saved: it lasts longer and sits closer on you.'));
  wear.actions['ask-skip']({ dataset: { id: worn.id, kind: 'skin' }, isConnected: false }, ui);
  html = draw();
  assert.ok(!html.includes('class="ask'), 'Done puts it away');
  state.base = { dest: 'wear', pane: 'now' };
  assert.ok(!draw().includes('class="ask'), 'and it never comes back');
  wear.forgetAsked();
});

test('Not now waves a question off for good; a bottle with his own nudges isn’t asked how it wore', () => {
  wear.forgetAsked();
  const a = { ...fragrances[1] }, b = { ...fragrances[2] }, c = { ...fragrances[3], personal: { rating: 4, longevity: 1, sillage: 0 } };
  assert.deepEqual(wear.askFor({ worn: a, yesterday: [b], asked: {} }), { kind: 'stars', f: a });
  assert.deepEqual(wear.askFor({ worn: { ...a, personal: { rating: 4, longevity: 0, sillage: 0 } }, yesterday: [b], asked: {} }), { kind: 'skin', f: b }, 'rated already: how yesterday’s wore');
  assert.deepEqual(wear.askFor({ worn: null, yesterday: [c, b], asked: {} }), { kind: 'skin', f: b }, 'his own nudge says it already');
  assert.equal(wear.askFor({ worn: a, yesterday: [b], asked: { [a.id]: { stars: '2026-10-01' }, [b.id]: { skin: '2026-10-01' } } }), null);
  assert.deepEqual(wear.askFor({ worn: a, yesterday: [], asked: { [a.id]: { skin: '2026-10-01' } } }), { kind: 'stars', f: a }, 'asked how it wore isn’t asked for stars');

  const { state, draw } = nowOnToday();
  state.base = { dest: 'wear', pane: 'now' };
  app.computeToday();
  const now = app.nowSlot(), pick = now.pick.fragrance.id;
  state.history = [{ id: pick, date: now.win.dateISO, slot: now.win.slot, occasion: 'daily' }];
  assert.ok(draw().includes('data-action="ask-skip" data-kind="stars"'));
  wear.actions['ask-skip']({ dataset: { id: pick, kind: 'stars' }, isConnected: false }, { render() {} });
  assert.ok(!draw().includes('class="ask'));
  assert.ok(!loadSkin()[pick], 'nothing saved');
  // Stored asks read back whole; anything else in the key is dropped.
  markAsked('x', 'skin', '2026-10-02');
  localStorage.setItem('scentcast.asked', JSON.stringify({ ...JSON.parse(localStorage.getItem('scentcast.asked')), y: { stars: 3 }, z: 'no' }));
  assert.deepEqual(loadAsked().x, { skin: '2026-10-02' });
  assert.ok(!('y' in loadAsked()) && !('z' in loadAsked()));
});
