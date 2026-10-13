import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rankWears } from '../scripts/journal-check.mjs';
import { parseJournal } from '../src/history.js';
import { rank } from '../src/engine.js';

const { fragrances } = JSON.parse(readFileSync(new URL('../data/collection.json', import.meta.url)));

test('journal-check ranks with earlier wears as rotation, whatever the id types', () => {
  const night = { feelsF: 58, humidity: 60, dewF: 46, category: 'clear', date: new Date('2026-09-28T12:00:00'), lat: 40, condition: 'Clear' };
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
