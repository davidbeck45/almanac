import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { activeBottles, loadJournal, resolvePlace, widgetBottles, widgetPayload } from '../omarchy/widget.mjs';
import { journalToken } from '../src/history.js';
import { withStoredEvents } from '../src/events.js';
import { planWindows } from '../src/engine.js';
import { week } from '../src/weather.js';
import { syntheticForecast } from './fixtures.js';

const { fragrances } = JSON.parse(readFileSync(new URL('../data/collection.json', import.meta.url)));
const place = { name: 'Test', lat: 40, lon: -74 };

test('the widget leads with the next window and plans the rest of the week', () => {
  // 20:00 local on the 28th: tonight comes first, then tomorrow's daytime
  const out = widgetPayload(fragrances, syntheticForecast(7), place, Date.parse('2026-09-29T00:00:00Z'));
  assert.equal(out.now.label, 'Tonight');
  assert.equal(out.next.label, 'Tomorrow');
  assert.equal(out.days.length, 7);
  assert.equal(out.days[0].day, null);
  assert.equal(out.days[0].night.id, out.now.id, 'the week agrees with the pick for now');
  assert.equal(out.days[1].day.id, out.next.id);
  assert.notEqual(out.now.runnerUp.name, out.now.name);
  assert.ok(out.now.reasons.length > 0 && out.now.reasons.length <= 4);
  assert.ok(out.now.accords.every(a => /^#[0-9a-f]{6}$/.test(a.color)));
  assert.ok(out.now.match >= 1 && out.now.match <= 99);
});

test('the widget hides the site defaults unless told otherwise', () => {
  const jake = fragrances.find(f => String(f.id) === '4310');
  assert.ok(!activeBottles(fragrances).includes(jake));
  assert.equal(activeBottles(fragrances, []).length, fragrances.length);
  const rest = activeBottles(fragrances, [jake.name.toUpperCase(), ' Sauvage ']);
  assert.ok(!rest.includes(jake));
  assert.ok(!rest.some(f => f.name === 'Sauvage'));
});

test('a coordinate setting or Omarchy\'s weather location resolves without a lookup', async () => {
  assert.deepEqual(await resolvePlace('32.93,-97.08,Grapevine, TX'), { name: 'Grapevine, TX', lat: 32.93, lon: -97.08 });
  assert.deepEqual(await resolvePlace(' 51.5 , -0.12 '), { name: '51.5,-0.12', lat: 51.5, lon: -0.12 });
  for (const bad of ['999,999', '91,0', '0,-181']) {
    await assert.rejects(resolvePlace(bad), /^Error: Set a latitude between -90 and 90 and a longitude between -180 and 180\.$/, bad);
  }

  const stateFile = join(mkdtempSync(join(tmpdir(), 'scentcast-')), 'weather.json');
  writeFileSync(stateFile, JSON.stringify({ name: 'Malibu', latitude: 34.03, longitude: -118.78 }));
  assert.deepEqual(await resolvePlace('', { stateFile }), { name: 'Malibu', lat: 34.03, lon: -118.78 });
});

test('with the app’s Copy for Claude the widget skips yesterday’s bottle, and says how old its wears are', () => {
  const at = Date.parse('2026-09-29T00:00:00Z'); // 20:00 on the 28th, tonight first
  const bare = widgetPayload(fragrances, syntheticForecast(7), place, at);
  assert.deepEqual([bare.journal, bare.journalNote], [null, 'not counting recent wears']);
  // Last night's bottle was tonight's pick without the journal.
  const jake = fragrances.find(f => f.name === 'Jake');
  const token = journalToken([{ id: bare.now.id, date: '2026-09-27', slot: 'night', occasion: 'daily' }], [String(jake.id)], {}, { todayISO: '2026-09-28' });
  const journal = loadJournal(` ${token} `);
  const out = widgetPayload(widgetBottles(fragrances, undefined, journal), syntheticForecast(7), place, at, journal);
  assert.notEqual(out.now.id, bare.now.id);
  assert.deepEqual(out.journal, { newest: '2026-09-27', daysAgo: 1, recent: 1 });
  assert.equal(out.journalNote, null, 'a day old goes without saying');
  // The journal's switched-off bottles stand in for the site's defaults, and add to the setting's.
  assert.ok(!widgetBottles(fragrances, undefined, journal).includes(jake));
  assert.equal(widgetBottles(fragrances, undefined, { ...journal, hidden: [] }).length, fragrances.length);
  assert.ok(!widgetBottles(fragrances, ['Sauvage'], journal).some(f => f.name === 'Sauvage' || f.name === 'Jake'));
  // Three days on, the panel says so.
  const later = widgetPayload(fragrances, syntheticForecast(7, { start: '2026-09-30' }), place, Date.parse('2026-10-01T00:00:00Z'), journal);
  assert.equal(later.journalNote, 'newest wear 3 days ago');
  // At 23:30 tonight's window is over and the plan starts tomorrow, but last night is still a day ago.
  const late = widgetPayload(widgetBottles(fragrances, undefined, journal), syntheticForecast(7), place, Date.parse('2026-09-29T03:30:00Z'), journal);
  assert.equal(late.days[0].date, '2026-09-29');
  assert.deepEqual([late.journal.daysAgo, late.journalNote], [1, null]);
});

test('with the app’s plans in the journal the widget plans around them, as Now and the Week do', () => {
  const at = Date.parse('2026-09-28T13:00:00Z'); // 09:00 on the 28th
  const bare = widgetPayload(fragrances, syntheticForecast(7), place, at);
  const night = bare.days[3];
  const token = journalToken([{ id: bare.now.id, date: '2026-09-27', slot: 'night' }], [], {}, { todayISO: '2026-09-28', events: [{ dateISO: night.date, slot: 'night', occasion: 'formal' }] });
  const journal = loadJournal(token);
  const out = widgetPayload(fragrances, syntheticForecast(7), place, at, journal);
  const windows = withStoredEvents(week(syntheticForecast(7), at).flatMap(d => [d.day, d.night].filter(Boolean)), journal.events);
  const plan = planWindows(fragrances.map(f => ({ ...f, id: String(f.id) })), windows, { history: journal.history, nudge: true });
  const formal = plan.find(p => p.win.occasion);
  assert.equal(out.days[3].night.id, String(formal.pick.fragrance.id), 'the formal night gets the app’s pick');
  assert.equal(out.days[3].night.occasion, 'formal');
  assert.deepEqual(out.days.flatMap(d => [d.day?.id, d.night?.id]).filter(Boolean), plan.map(p => String(p.pick.fragrance.id)), 'every window as the app plans it');
  const plain = widgetPayload(fragrances, syntheticForecast(7), place, at, { ...journal, events: [] });
  assert.notEqual(plain.days[3].night.id, out.days[3].night.id, 'without it the night goes to the daily pick');
});

test('the journal setting reads a file of either kind, and says plainly when it can’t', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scentcast-'));
  const token = journalToken([{ id: '4310', date: '2026-09-27', slot: 'day' }], [], {}, { todayISO: '2026-09-28' });
  writeFileSync(join(dir, 'token.txt'), `${token}\n`);
  writeFileSync(join(dir, 'export.json'), JSON.stringify({ app: 'scentcast-journal', history: [{ id: 4310, date: '2026-09-27', slot: 'day' }] }));
  for (const file of ['token.txt', 'export.json']) assert.deepEqual(loadJournal(join(dir, file)).history.map(h => h.id), ['4310'], file);
  assert.throws(() => loadJournal(join(dir, 'nope.json')), /^Error: Can't read the journal file .*nope\.json$/);
  writeFileSync(join(dir, 'other.json'), '{}');
  assert.throws(() => loadJournal(join(dir, 'other.json')), /isn't a Scentcast journal export or Copy for Claude$/);
  assert.throws(() => loadJournal(token.slice(0, 20)), /cut short or garbled/);
});
