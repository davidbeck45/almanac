import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rankWears } from '../scripts/journal-check.mjs';
import { parseJournal } from '../src/history.js';
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
  const dir = mkdtempSync(join(tmpdir(), 'scentcast-'));
  const missing = run([join(dir, 'nope.json')]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /^Can't read .*nope\.json\n$/);
  const bad = join(dir, 'bad.json');
  writeFileSync(bad, 'not json');
  assert.match(run([bad]).stderr, /^.*bad\.json isn't a Scentcast journal export/);
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
});
