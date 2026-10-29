import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rankWears, wearChoices, thermostat, fitOffset, FIT_MIN_WEARS } from '../scripts/journal-check.mjs';
import { parseJournal, shiftISO } from '../src/history.js';
import { rank } from '../src/engine.js';
import { occasionById } from '../src/occasions.js';

const { fragrances } = JSON.parse(readFileSync(new URL('../data/collection.json', import.meta.url)));
const night = { feelsF: 58, humidity: 60, dewF: 46, category: 'clear', date: new Date('2026-09-28T12:00:00'), lat: 40, condition: 'Clear' };
const script = fileURLToPath(new URL('../scripts/journal-check.mjs', import.meta.url));
const mock = fileURLToPath(new URL('./mock-fetch.mjs', import.meta.url));
// The script against the synthetic weather, no network.
const run = (args, env = {}) => spawnSync(process.execPath, ['--import', mock, script, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
const dayISO = days => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

test('journal-check ranks with earlier wears as rotation, whatever the id types', () => {
  const top = rank(fragrances, night, 'night', { todayISO: '2026-09-27' })[0].fragrance;
  assert.equal(typeof top.id, 'number', 'the data keeps numeric ids');
  // The export writes the app's string ids.
  const journal = parseJournal({
    app: 'scentcast-journal',
    location: { lat: 40.71, lon: -74.01 },
    hidden: [],
    history: [
      { id: String(top.id), date: '2026-09-28', slot: 'night' },
      { id: String(top.id), date: '2026-09-27', slot: 'night' },
    ],
  });
  const { rows, skipped } = rankWears(journal, fragrances, () => night);
  assert.deepEqual(skipped, { notInDemo: 0, noPlace: 0, noWeather: 0 });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].rank, 1);
  assert.ok(rows[1].reasons.includes('- Worn yesterday'), rows[1].reasons.join(' | '));
  assert.ok(rows[1].rank > 1, 'yesterday’s bottle drops');
});

test('a file that isn’t a journal export reads as null', () => {
  assert.equal(parseJournal({ app: 'something-else', history: [] }), null);
  assert.equal(parseJournal(null), null);
  assert.deepEqual(parseJournal({ app: 'scentcast-journal', history: [{ id: 7, date: '2026-01-01', slot: 'day' }, { id: 8 }] }).history,
    [{ id: '7', date: '2026-01-01', slot: 'day' }]);
  // Wears in another shape are left out, and a `hidden` that isn't a list reads as none.
  const odd = parseJournal({ app: 'scentcast-journal', hidden: 'Jake', location: 'home', history: [
    { id: 1, date: '2026-01-01', slot: 'evening' }, { id: 2, date: 20260101, slot: 'day' }, { id: 3, date: '2026-13-45', slot: 'day' },
    { date: '2026-01-02', slot: 'day' }, null, { id: 4, date: '2026-01-02', slot: 'night' },
  ] });
  assert.deepEqual(odd.history, [{ id: '4', date: '2026-01-02', slot: 'night' }]);
  assert.deepEqual([odd.hidden, odd.location], [[], null]);
});

test('journal-check ranks with the export’s ratings, and for the occasion a wear was logged for', () => {
  const top = rank(fragrances, night, 'night', { todayISO: '2026-09-27' })[0].fragrance;
  const date = rank(fragrances, night, 'night', { occasion: occasionById('date'), todayISO: '2026-09-27' })[0].fragrance;
  const journal = parseJournal({
    app: 'scentcast-journal',
    location: { lat: 40.71, lon: -74.01 },
    skin: { [top.id]: { rating: 1 } },
    history: [
      { id: String(date.id), date: '2026-09-20', slot: 'night', occasion: 'date' },
      { id: String(top.id), date: '2026-09-21', slot: 'night', occasion: 'daily' },
    ],
  });
  const { rows } = rankWears(journal, fragrances, () => night);
  // Rated 1★, the would-be top pick is benched as the app benches it.
  assert.notEqual(rows[1].top, top.name);
  assert.ok(rows[1].rank > 5 && rows[1].reasons.some(r => /You rate it 1★/.test(r)), rows[1].reasons.join(' | '));
  assert.equal(rows[1].occasion, null, 'Today and the Week log daily picks');
  // A date-night wear is ranked for the date.
  assert.deepEqual([rows[0].occasion, rows[0].rank, rows[0].top], ['date', 1, date.name]);
});

test('journal-check says what went wrong in a sentence, and skips wears whose weather didn’t load', () => {
  const dir = mkdtempSync(join(tmpdir(), 'almanac-'));
  const missing = run([join(dir, 'nope.json')]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /^Can't read .*nope\.json\n$/);
  const bad = join(dir, 'bad.json');
  writeFileSync(bad, 'not json');
  assert.match(run([bad]).stderr, /^.*bad\.json isn't an Almanac journal export/);
  // The last week comes from the forecast API; with its quota spent those wears are skipped and counted.
  const file = join(dir, 'journal.json');
  const ids = fragrances.slice(0, 6).map(f => String(f.id));
  writeFileSync(file, JSON.stringify({
    app: 'scentcast-journal',
    location: { lat: 40.71, lon: -74.01 },
    history: [[-30, 0], [-20, 1], [-12, 2], [-3, 3], [-2, 4], [-1, 5]].map(([d, i]) => ({ id: ids[i], date: dayISO(d), slot: 'night' })),
  }));
  const busy = run([file, '--json'], { MOCK_FORECAST_STATUS: '429' });
  assert.equal(busy.status, 0, busy.stderr);
  assert.match(busy.stderr, /^The forecast service is busy\. Try again in a minute\. Wears it would cover are skipped\.\n$/);
  const { summary } = JSON.parse(busy.stdout);
  assert.equal(summary.wears, 3);
  assert.equal(summary.skipped.noWeather, 3);
  // The archive's day used up says so, by name; with nothing checked, no meaningless averages.
  const spent = run([file], { MOCK_ARCHIVE_STATUS: '429', MOCK_FORECAST_STATUS: '429', MOCK_REASON: 'Daily API request limit exceeded. Please try again tomorrow.' });
  assert.equal(spent.status, 0, spent.stderr);
  assert.match(spent.stderr, /The weather archive’s daily limit is used up\. Try again tomorrow\. Wears it would cover are skipped\./);
  assert.match(spent.stderr, /The forecast service’s daily limit is used up\. Try again tomorrow\./);
  assert.match(spent.stdout, /^No wears to check \(0 outside the demo, 0 without a place, 6 without weather\)\.\n$/);
  // A wear logged for a slot that isn't day or night is left out, not a stack trace.
  const evening = join(dir, 'evening.json');
  writeFileSync(evening, JSON.stringify({ app: 'scentcast-journal', location: { lat: 40.71, lon: -74.01 }, hidden: 'x', history: [{ id: ids[0], date: dayISO(-30), slot: 'evening' }] }));
  const odd = run([evening]);
  assert.equal(odd.status, 0, odd.stderr);
  assert.equal(odd.stderr, '');
  assert.match(odd.stdout, /^No wears to check/);
});

// A year of someone choosing as if it felt `delta` °F warmer than it does,
// with a little noise (Gumbel, at the scale of the top pick's usual lead),
// earlier wears as rotation, as the app's journal would log them.
function feltAs(delta, { days = 40, seed = 7 } = {}) {
  let x = seed;
  const rnd = () => ((x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const noise = () => -0.012 * Math.log(-Math.log(rnd() + 1e-12));
  const bottles = fragrances.map(f => ({ ...f, id: String(f.id) }));
  const windows = new Map(), history = [];
  for (let i = 0; i < days; i++) {
    const day = Math.round((i * 365) / days), date = shiftISO('2025-01-01', day);
    for (const slot of ['day', 'night']) {
      const feelsF = 58 - 24 * Math.cos((2 * Math.PI * (day - 15)) / 365) - (slot === 'night' ? 9 : 0) + (rnd() - 0.5) * 14;
      const win = { slot, dateISO: date, date: new Date(`${date}T12:00:00`), lat: 40, category: 'clear', condition: 'Clear', feelsF, humidity: 60, dewF: Math.min(feelsF - 4, 40 + (feelsF - 50) * 0.6) };
      windows.set(`${date} ${slot}`, win);
      const ranked = rank(bottles, { ...win, feelsF: feelsF + delta }, slot, { history, todayISO: date });
      const worn = ranked.map(r => [r.score + noise(), r.fragrance.id]).sort((a, b) => b[0] - a[0])[0][1];
      history.unshift({ id: worn, date, slot });
    }
  }
  const journal = parseJournal({ app: 'scentcast-journal', location: { lat: 40.71, lon: -74.01 }, history });
  return wearChoices(journal, fragrances, h => windows.get(`${h.date} ${h.slot}`)).choices;
}

test('--fit finds how much warmer or colder someone chooses than the weather says', () => {
  for (const delta of [6, -8, 0]) {
    const fit = thermostat(feltAs(delta));
    assert.equal(fit.all.n, 80);
    assert.ok(Math.abs(fit.all.offset - delta) <= 2, `${delta}°F read as ${fit.all.offset}`);
    assert.ok(fit.all.low <= delta + 1 && fit.all.high >= delta - 1, `${delta}°F outside ${fit.all.low}..${fit.all.high}`);
    for (const part of ['day', 'night', 'overrides']) assert.ok(Math.abs(fit[part].offset - delta) <= 4, `${part}: ${delta}°F read as ${fit[part].offset}`);
    assert.deepEqual([fit.day.n, fit.night.n], [40, 40]);
    assert.ok(fit.overrides.n < fit.all.n && fit.overrides.n >= FIT_MIN_WEARS, 'wears that weren’t the top pick, apart');
  }
  // A handful of wears says nothing.
  assert.deepEqual(fitOffset(feltAs(6, { days: 4 })), { n: 8 });
});

test('journal-check --fit reports the thermostat after the wears', () => {
  const dir = mkdtempSync(join(tmpdir(), 'almanac-'));
  const file = join(dir, 'journal.json');
  const ids = fragrances.map(f => String(f.id));
  writeFileSync(file, JSON.stringify({
    app: 'scentcast-journal',
    location: { lat: 40.71, lon: -74.01 },
    history: Array.from({ length: 24 }, (_, i) => ({ id: ids[(i * 7) % ids.length], date: dayISO(-60 + 2 * i), slot: i % 2 ? 'night' : 'day' })),
  }));
  const text = run([file, '--fit']);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /\nThermostat: the feels-like offset that best explains what you wore\n  every wear +(?:[+-]?\d+°F \(about [+-]?\d+(?: or lower)? to [+-]?\d+(?: or higher)?\)|can't tell: any offset explains them about as well), 24 wears\n  by day +.+\n  by night +.+\n  not the top pick +.+\n  .+\.\n$/);
  const out = JSON.parse(run([file, '--fit', '--json']).stdout);
  assert.deepEqual(Object.keys(out.fit), ['all', 'day', 'night', 'overrides']);
  assert.equal(out.fit.all.n, 24);
  assert.ok(!('fit' in JSON.parse(run([file, '--json']).stdout)), 'only when asked');
});
