import { test } from 'node:test';
import assert from 'node:assert/strict';
import { journalStats, journalCalendar, journalExport, toggleWear, parseJournal, occasionCounts, loadHistory } from '../src/history.js';
import { windowOn, week } from '../src/weather.js';
import { syntheticForecast } from './fixtures.js';

const history = [
  { id: 'a', date: '2026-09-28', slot: 'day' },
  { id: 'b', date: '2026-09-27', slot: 'night' },
  { id: 'a', date: '2026-09-20', slot: 'day' },
  { id: 'c', date: '2026-07-01', slot: 'day' },
];

test('journal counts wears in the look-back window and remembers older ones', () => {
  const s = journalStats(history, '2026-09-28');
  assert.equal(s.wears, 3);
  assert.equal(s.bottles, 2);
  assert.deepEqual(s.top, [['a', 2], ['b', 1]]);
  assert.equal(s.lastWorn.get('a'), '2026-09-28');
  assert.equal(s.lastWorn.get('c'), '2026-07-01');
});

test('journal calendar runs Sunday to Saturday and ends this week', () => {
  const weeks = journalCalendar(history, '2026-09-28', 5);
  assert.equal(weeks.length, 5);
  assert.equal(weeks[0][0].dateISO, '2026-08-30'); // a Sunday
  const today = weeks[4][1];
  assert.equal(today.dateISO, '2026-09-28');
  assert.equal(today.day.id, 'a');
  assert.equal(weeks[4][0].night.id, 'b');
  assert.ok(weeks[4][2].future);
});

test('a logged wear remembers roughly where it happened', () => {
  const [entry] = toggleWear('a', '2026-10-01', 'day', { lat: 40.71283, lon: -74.00597, name: 'New York' });
  assert.deepEqual(entry, { id: 'a', date: '2026-10-01', slot: 'day', lat: 40.71, lon: -74.01 });
  assert.deepEqual(toggleWear('a', '2026-10-01', 'day')[0], { id: 'a', date: '2026-10-01', slot: 'day' });
});

test('the journal export carries the wears, place and hidden bottles', () => {
  const data = journalExport(history, { name: 'New York', lat: 40.71283, lon: -74.00597 }, new Set(['4310']), { nowISO: '2026-10-03T12:00:00Z' });
  assert.equal(data.app, 'scentcast-journal');
  assert.deepEqual(data.location, { name: 'New York', lat: 40.71, lon: -74.01 });
  assert.deepEqual(data.hidden, ['4310']);
  assert.equal(data.history.length, history.length);
  assert.equal(journalExport([], null, new Set()).location, null);
});

test('a past window rebuilds from hourly data alone, as the archive returns it', () => {
  const forecast = syntheticForecast(3);
  delete forecast.hourly.precipitation_probability;
  const win = windowOn(forecast, '2026-09-29', 'night');
  assert.equal(win.feelsF, 55);
  assert.equal(win.slot, 'night');
  assert.equal(win.pop, 0);
  const fromWeek = week(syntheticForecast(3), Date.parse('2026-09-28T13:00:00Z')).find(d => d.dateISO === '2026-09-29').night;
  assert.equal(win.dewF, fromWeek.dewF);
});

test('a wear logged for an occasion keeps it, and wears count per use', () => {
  const [entry] = toggleWear('a', '2026-10-02', 'night', null, 'date');
  assert.deepEqual(entry, { id: 'a', date: '2026-10-02', slot: 'night', occasion: 'date' });
  const log = [
    { id: 'a', date: '2026-10-02', slot: 'night', occasion: 'date' },
    { id: 'b', date: '2026-10-01', slot: 'day', occasion: 'office' },
    { id: 'c', date: '2026-09-30', slot: 'day', occasion: 'office' },
    { id: 'c', date: '2026-09-29', slot: 'night' },
    { id: 'd', date: '2026-10-03', slot: 'day', planned: true },
    { id: 'e', date: '2026-08-01', slot: 'day' },
  ];
  assert.deepEqual(occasionCounts(log), { date: 1, office: 2, untagged: 2 }, 'untagged wears stay apart; plans don’t count');
  assert.deepEqual(occasionCounts([{ id: 'a', date: '2026-10-01', slot: 'day', occasion: 'daily' }]), { daily: 1 }, 'daily when Today says so');
  assert.deepEqual(occasionCounts(log, '2026-09-30'), { date: 1, office: 2 });
  assert.deepEqual(occasionCounts([]), {});
});

test('the export carries ratings when there are some, and older files still read', () => {
  const skin = { 31861: { rating: 5, longevity: 1, sillage: 0, updated: '2026-10-01' } };
  const data = journalExport(history, null, new Set(), { nowISO: '2026-10-03T12:00:00Z', skin });
  assert.deepEqual(data.skin, skin);
  assert.ok(!('skin' in journalExport(history, null, new Set(), { skin: {} })), 'no empty skin key');
  assert.ok(!('skin' in journalExport(history, null, new Set())));
  assert.deepEqual(parseJournal(JSON.parse(JSON.stringify(data))).skin, { 31861: skin[31861] });
  const old = parseJournal({ app: 'scentcast-journal', version: 1, history: [{ id: 4310, date: '2026-10-01', slot: 'day', occasion: 'office' }] });
  assert.deepEqual(old.skin, {});
  assert.equal(old.history[0].occasion, 'office');
  assert.equal(old.history[0].id, '4310');
});

test('the stored log keeps only wears it can read: a real date, day or night', () => {
  const real = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const store = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) } });
  try {
    store.set('scentcast.history', JSON.stringify([
      { id: 1, date: 20261013, slot: 'day' }, { id: 2, date: '2026-10-13', slot: 'evening' }, null, 'x',
      { id: 3, date: '2026-10-12', slot: 'night', occasion: 'date' },
    ]));
    assert.deepEqual(loadHistory(), [{ id: '3', date: '2026-10-12', slot: 'night', occasion: 'date' }]);
    store.set('scentcast.history', JSON.stringify({ not: 'a list' }));
    assert.deepEqual(loadHistory(), []);
  } finally {
    if (real) Object.defineProperty(globalThis, 'localStorage', real);
    else delete globalThis.localStorage;
  }
});
