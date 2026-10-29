import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  journalStats, journalCalendar, journalExport, toggleWear, parseJournal, occasionCounts, loadHistory,
  journalToken, journalFromToken, readJournal, isJournalToken, journalFreshness, RECENT_DAYS, shiftISO,
} from '../src/history.js';
import { ROTATION_PENALTY } from '../src/engine.js';
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

test('the export and Copy for Claude carry the days and nights planned in the app, and older ones read without', () => {
  const events = [{ dateISO: '2026-10-25', slot: 'night', occasion: 'date' }, { dateISO: '2026-10-31', slot: 'night', occasion: 'formal' }, { dateISO: '2026-11-02', slot: 'day', occasion: 'office' }];
  const data = journalExport(history, null, new Set(), { nowISO: '2026-10-26T12:00:00Z', events });
  assert.deepEqual(parseJournal(JSON.parse(JSON.stringify(data))).events, events);
  assert.ok(!('events' in journalExport(history, null, new Set())), 'no empty events key');
  const token = journalToken(history, [], {}, { todayISO: '2026-10-26', events });
  assert.deepEqual(readJournal(token).events, events, 'a day back too: a place can be behind the device');
  // Before events were carried, neither had any.
  assert.deepEqual(readJournal(journalToken(history, [], {}, { todayISO: '2026-10-26' })).events, []);
  assert.deepEqual(parseJournal({ app: 'scentcast-journal', history: [] }).events, []);
  // An event in another shape is left out of a file; a token's is garbled.
  assert.deepEqual(parseJournal({ app: 'scentcast-journal', history: [], events: [{ dateISO: '2026-10-31', slot: 'evening', occasion: 'date' }, null, events[1]] }).events, [events[1]]);
  assert.throws(() => journalFromToken(`scj1.${btoa('{"t":"2026-10-26","i":[],"w":[],"e":[[5,2,"date"]]}')}`), /garbled/);
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

// A year of wears: two bottles a day across eight, every use, planned entries mixed in.
function yearLog(todayISO) {
  const uses = ['daily', 'daily', 'office', undefined, 'date', 'daily'];
  const log = [];
  for (let d = 0; d < 365; d++) {
    for (const [k, slot] of [[0, 'night'], [1, 'day']]) {
      const occasion = uses[(d + k) % uses.length];
      log.push({ id: String(100 + ((d * 3 + k) % 8)), date: shiftISO(todayISO, -d), slot, ...(occasion && { occasion }), ...(d === 3 && k && { lat: 40.71, lon: -74.01 }) });
    }
  }
  log.push({ id: '999', date: shiftISO(todayISO, -400), slot: 'day' }, { id: '108', date: shiftISO(todayISO, 1), slot: 'day', planned: true });
  return log;
}

test('Copy for Claude carries what rotation and the nudge read, and reads back as a journal', () => {
  assert.equal(RECENT_DAYS, ROTATION_PENALTY.length, 'the token reaches as far back as rotation');
  const today = '2026-10-26';
  const log = yearLog(today);
  const skin = { 101: { rating: 5, longevity: 0, sillage: 0, updated: '2026-10-01' }, 'my:abc': { rating: null, longevity: -1, sillage: 1 } };
  const token = journalToken(log, new Set(['4310', 'my:abc']), skin, { todayISO: today });
  assert.match(token, /^scj1\.[\w-]+$/, 'base64url after a version');
  assert.ok(token.length < 600, `a few hundred bytes, not ${token.length}`);
  assert.ok(isJournalToken(token) && isJournalToken(` ${token}\n`) && !isJournalToken('almanac-journal-2026-10-26.json'));
  for (const pasted of [`"${token}"`, `\`${token}\`.`, `${token}.`]) assert.deepEqual(readJournal(pasted), readJournal(token), pasted);

  const back = readJournal(token);
  // Every wear of the last ten days, as logged (no places), with its use.
  const since = shiftISO(today, -(RECENT_DAYS - 1));
  const recent = log.filter(h => !h.planned && h.date >= since && h.date <= today).map(({ lat, lon, ...h }) => h);
  const sameWear = (a, b) => a.id === b.id && a.date === b.date && a.slot === b.slot && a.occasion === b.occasion;
  for (const h of recent) assert.ok(back.history.some(b => sameWear(b, h)), `${h.date} ${h.slot}`);
  assert.ok(back.history.every(h => !('lat' in h)), 'no coordinates');
  assert.ok(!back.history.some(h => h.planned || h.date > today), 'plans stay behind');
  // Each bottle's last wear and the journal's first, so idle days count as in the app.
  const last = (list, id) => list.filter(h => h.id === id && !h.planned).map(h => h.date).sort().at(-1);
  for (const id of new Set(log.map(h => h.id))) assert.equal(last(back.history, id), last(log, id), id);
  assert.equal(back.history.map(h => h.date).sort()[0], shiftISO(today, -400));
  assert.equal(new Set(back.history.map(h => `${h.date} ${h.slot}`)).size, back.history.length, 'each wear once');
  // Switched-off bottles, stars and nudges, and the whole log's wears per use.
  assert.deepEqual(back.hidden, ['4310', 'my:abc']);
  assert.deepEqual(back.skin, { 101: { rating: 5, longevity: 0, sillage: 0 }, 'my:abc': { rating: null, longevity: -1, sillage: 1 } });
  assert.deepEqual(back.counts, occasionCounts(log));
  assert.equal(back.location, null);
  assert.deepEqual(journalFreshness(back.history, today), { newest: today, daysAgo: 0, recent: recent.length });
  assert.deepEqual(journalFreshness(back.history, shiftISO(today, 3)).daysAgo, 3);
});

test('an empty journal makes a token too, and a bad one says so in a sentence', () => {
  const empty = readJournal(journalToken([], [], {}, { todayISO: '2026-10-26' }));
  // An export's wear with a use of null (hand-edited, or a future app's) travels as one without.
  assert.equal(readJournal(journalToken([{ id: 'a', date: '2026-10-25', slot: 'day', occasion: null }], [], {}, { todayISO: '2026-10-26' })).history[0].occasion, undefined);
  assert.deepEqual([empty.history, empty.hidden, empty.skin, empty.counts], [[], [], {}, {}]);
  assert.deepEqual(journalFreshness([], '2026-10-26'), { newest: null, daysAgo: null, recent: 0 });
  const token = journalToken(history, [], {}, { todayISO: '2026-09-28' });
  const garbled = /^Error: This Copy for Claude is cut short or garbled: copy it again from Wardrobe › Worn and paste it whole\.$/;
  for (const bad of [token.slice(0, -6), `${token.slice(0, 12)}!${token.slice(13)}`, 'scj1.', 'scj1.e30', 'scj0.e30', `scj1.${btoa('{"t":"2026-09-28","i":[1],"w":[[3,0,0]]}')}`]) {
    assert.throws(() => journalFromToken(bad), garbled, bad);
  }
  assert.throws(() => readJournal('scj2.abc'), /^Error: This Copy for Claude comes from a newer Almanac \(scj2\) than this checkout reads; update it\.$/);
  // Not a token: an export's text, or nothing it knows.
  assert.equal(readJournal(JSON.stringify(journalExport(history, null, []))).history.length, 4);
  assert.equal(readJournal('not json'), null);
  assert.equal(readJournal('{"app":"else"}'), null);
});
