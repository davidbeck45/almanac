import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { journalExport, journalToken, parseJournal, readJournal, loadHistory, toggleWear } from '../src/history.js';
import { loadSkin, setSkin, loadAsked, markAsked } from '../src/skin.js';
import { loadEvents, setEvent } from '../src/events.js';
import { loadHidden, setHidden, hiddenFor } from '../src/hidden.js';
import { loadWants, setWant } from '../src/wishlist.js';
import { loadMine, saveMine } from '../src/collections.js';
import {
  BACKUP_VERSION, backupExport, deviceStores, readBackup, backupSummary, backupEmpty, mergeBackup, restoreBackup, restoreText,
} from '../src/backup.js';

// One device's localStorage; `fresh()` is another device, empty. Every date
// is given, so nothing here reads the clock but `added` stamps, which are
// passed in.
let store;
const fresh = () => {
  store = new Map();
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  };
};
beforeEach(fresh);

const FROM = '2026-11-08'; // the device's yesterday: plans from here on are kept
const bottle = (id, name) => ({
  id, name, brand: 'X', accords: { woody: 100 }, season: { winter: 1, spring: 1, summer: 1, fall: 1 }, dayNight: { day: 1, night: 1 },
});
// Every store, read as data (a pref's place in its object says nothing).
const read = v => { try { return JSON.parse(v); } catch { return v; } };
const snapshot = () => Object.fromEntries([...store].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, read(v)]));
// The file Export writes, as text, from the device as it stands.
const exported = () => JSON.stringify(backupExport(
  journalExport(loadHistory(), { name: 'New York', lat: 40.71, lon: -74.01 }, hiddenFor(loadHidden(), true),
    { nowISO: '2026-11-09T18:00:00Z', skin: loadSkin(), events: loadEvents(FROM) }),
  deviceStores()), null, 2);

// A device with something in every store.
function fill() {
  toggleWear('100', '2026-01-03', 'day', { lat: 40.71, lon: -74.01 }, 'daily', { wx: { f: 31.2, d: 20, h: 60, p: 0, c: 3 }, pick: '200' });
  toggleWear('200', '2026-11-08', 'night', null, 'date');
  toggleWear('300', '2026-11-09', 'day');
  setSkin('100', { rating: 5 }, '2026-11-01');
  setSkin('200', { rating: 2, longevity: -1 }, '2026-11-02');
  markAsked('100', 'stars', '2026-11-01');
  setEvent('2026-11-14', 'night', 'formal', FROM);
  setEvent('2026-11-11', 'night', 'date', FROM);
  const hiding = loadHidden();
  setHidden(hiding, '300', true, true);
  setHidden(hiding, '4310', false, true); // Jake, a default, switched back on
  setWant('900', true, { added: '2026-10-20', note: 'try at the counter' });
  setWant(bottle('my:abc', 'Hand Entered'), true, { added: '2026-11-05' });
  saveMine({ name: 'Brooke', records: [bottle('1', 'One'), bottle('2', 'Two')] });
  localStorage.setItem('scentcast.active', 'mine');
  localStorage.setItem('scentcast.uses', JSON.stringify({ office: 'often', formal: 'never' }));
  localStorage.setItem('scentcast.prefs', JSON.stringify({ units: 'C', theme: 'gruvbox', likedStyles: ['skin', 'clean'], preferValue: false, stillSky: true, occasion: 'formal' }));
  localStorage.setItem('scentcast.trip', JSON.stringify({
    place: { name: 'Lisbon', region: 'PT', lat: 38.72, lon: -9.14, timezone: 'Europe/Lisbon' }, fromISO: '2026-12-01', toISO: '2026-12-04',
    events: [{ dateISO: '2026-12-02', slot: 'night', occasion: 'formal' }], max: 3, windows: [{ slot: 'day', dateISO: '2026-12-01', feelsF: 60 }], fetchedAt: 1,
  }));
}

test('an export restored on an empty device gives the same stores', () => {
  fill();
  const before = snapshot(), file = exported();
  for (const mode of ['add', 'replace']) {
    fresh();
    const { counts } = restoreBackup(readBackup(file), mode, { fromISO: FROM });
    // The trip's weather isn't carried, so the trip isn't restored (yet).
    const { 'scentcast.trip': trip, ...rest } = before;
    assert.deepEqual(snapshot(), rest, mode);
    assert.equal(counts.wears, 3);
    assert.equal(counts.kept, 0);
    assert.deepEqual([counts.ratings, counts.hidden, counts.plans, counts.wants, counts.mine], [2, 1, 2, 2, 2], mode);
    assert.equal(exported(), file.replace(/"trip": \{[^]*?\n  \}/, '"trip": null'), `${mode}: and exports the same file again, less the trip`);
  }
});

test('the backup is still a journal for everything that reads one', () => {
  fill();
  const file = exported(), data = JSON.parse(file);
  assert.equal(data.app, 'scentcast-journal');
  assert.equal(data.version, BACKUP_VERSION);
  const journal = readJournal(file);
  assert.deepEqual(journal, parseJournal(journalExport(loadHistory(), { name: 'New York', lat: 40.71, lon: -74.01 }, hiddenFor(loadHidden(), true),
    { skin: loadSkin(), events: loadEvents(FROM) })), 'the new keys change nothing a journal reader sees');
  assert.deepEqual(journal.hidden, ['300'], 'hidden as the demo reads it: Jake was switched back on');
  assert.deepEqual(data.hiding, { hidden: ['300'], shown: ['4310'] });
  assert.equal(journal.history[0].wx, undefined);
  assert.deepEqual(journal.history.at(-1).wx, { f: 31.2, d: 20, h: 60, p: 0, c: 3 }, 'stamps ride along');
  assert.deepEqual(data.trip, { place: { name: 'Lisbon', region: 'PT', lat: 38.72, lon: -9.14, timezone: 'Europe/Lisbon' }, fromISO: '2026-12-01', toISO: '2026-12-04', events: [{ dateISO: '2026-12-02', slot: 'night', occasion: 'formal' }], max: 3 }, 'a trip’s inputs, without its weather');
  assert.ok(!('fetchedAt' in data.trip) && !('windows' in data.trip));
});

test('what a file holds is said before anything changes', () => {
  fill();
  const backup = readBackup(exported());
  assert.equal(backupSummary(backup, { fromISO: FROM }), '3 wears from Jan 3 to Nov 9, 2 ratings, 1 bottle switched off, 2 plans, 2 wants, Mine: 2 bottles.');
  assert.equal(backupSummary(backup, { fromISO: '2026-11-12' }), '3 wears from Jan 3 to Nov 9, 2 ratings, 1 bottle switched off, 1 plan, 2 wants, Mine: 2 bottles.', 'a plan gone by isn’t one');
  assert.equal(backupEmpty(backup, { fromISO: FROM }), false);
  fresh();
  const none = readBackup(exported());
  assert.equal(backupSummary(none, { fromISO: FROM }), 'No wears.');
  assert.equal(backupEmpty(none, { fromISO: FROM }), true);
  toggleWear('1', '2025-12-30', 'day');
  toggleWear('1', '2026-01-02', 'day');
  assert.equal(backupSummary(readBackup(exported()), { fromISO: FROM }), '2 wears from Dec 30, 2025 to Jan 2, 2026.', 'years when the wears span two');
  toggleWear('1', '2025-12-30', 'day');
  assert.equal(backupSummary(readBackup(exported()), { fromISO: FROM }), '1 wear on Jan 2.');
});

test('adding keeps this device’s wear, rating, plan, want and bottle wherever both have one', () => {
  fill();
  const file = exported();
  fresh();
  // This device: another bottle for Nov 8's night, the same one for Nov 9's
  // day, and a wear the file lacks; its own stars, plan, want, Mine and prefs.
  toggleWear('555', '2026-11-08', 'night');
  toggleWear('300', '2026-11-09', 'day', { lat: 41.88, lon: -87.63 }, 'office');
  toggleWear('555', '2026-11-07', 'day');
  setSkin('200', { rating: 4 }, '2026-11-09');
  markAsked('100', 'skin', '2026-11-09');
  setEvent('2026-11-14', 'night', 'nightout', FROM);
  setWant('901', true, { added: '2026-10-25' });
  setWant('900', true, { added: '2026-11-08', note: 'mine' });
  saveMine({ name: '', records: [bottle('2', 'Two, as this device has it'), bottle('3', 'Three')] });
  localStorage.setItem('scentcast.prefs', JSON.stringify({ units: 'F', preferValue: null }));
  const { counts } = restoreBackup(readBackup(file), 'add', { fromISO: FROM });
  assert.deepEqual(counts, { wears: 1, kept: 1, ratings: 1, hidden: 1, plans: 1, wants: 1, mine: 1 });
  assert.equal(restoreText(counts), 'Added 1 wear, 1 rating, 1 plan, 1 want and 1 bottle to Mine. Switched off 1 bottle. 1 window kept this device’s wear.');
  assert.deepEqual(loadHistory().map(h => `${h.date} ${h.slot} ${h.id}`),
    ['2026-11-09 day 300', '2026-11-08 night 555', '2026-11-07 day 555', '2026-01-03 day 100'], 'newest first, the device’s wear for a window both have');
  assert.equal(loadHistory()[0].occasion, 'office', 'and its own copy of a wear both logged');
  assert.equal(loadHistory().at(-1).pick, '200', 'a wear brought in keeps its stamp');
  assert.deepEqual(loadSkin()['200'], { rating: 4, longevity: 0, sillage: 0, updated: '2026-11-09' });
  assert.equal(loadSkin()['100'].rating, 5);
  assert.deepEqual(loadAsked()['100'], { stars: '2026-11-01', skin: '2026-11-09' });
  assert.deepEqual(loadEvents(FROM), [{ dateISO: '2026-11-11', slot: 'night', occasion: 'date' }, { dateISO: '2026-11-14', slot: 'night', occasion: 'nightout' }]);
  assert.deepEqual(loadWants().map(w => `${w.id} ${w.added} ${w.note ?? ''}`.trim()), ['900 2026-11-08 mine', 'my:abc 2026-11-05', '901 2026-10-25'], 'by the date added');
  assert.ok(loadWants()[1].record, 'a hand-entered want comes with its record');
  assert.deepEqual(loadMine(), { name: 'Brooke', records: [bottle('2', 'Two, as this device has it'), bottle('3', 'Three'), bottle('1', 'One')] });
  assert.deepEqual([...loadHidden().hidden], ['300']);
  assert.deepEqual(JSON.parse(store.get('scentcast.prefs')), { theme: 'gruvbox', likedStyles: ['skin', 'clean'], preferValue: false, stillSky: true, occasion: 'formal', units: 'F' },
    'its own units stay; a pref never chosen takes the file’s');
  assert.equal(store.get('scentcast.active'), 'mine', 'a device that never chose a list takes the file’s');
  // Again: nothing left to add.
  const again = restoreBackup(readBackup(file), 'add', { fromISO: FROM }).counts;
  assert.equal(restoreText(again), 'Nothing to add: this device already has everything in that file. 1 window kept this device’s wear.');
});

test('replacing swaps this device’s for the file’s, store by store', () => {
  fill();
  const file = exported(), before = snapshot();
  fresh();
  toggleWear('555', '2026-11-08', 'night');
  setSkin('777', { rating: 1 }, '2026-11-09');
  setEvent('2026-11-20', 'day', 'office', FROM);
  setWant('901', true, { added: '2026-10-25' });
  saveMine({ name: 'Mine', records: [bottle('3', 'Three')] });
  setHidden(loadHidden(), '888', true, true);
  const { counts } = restoreBackup(readBackup(file), 'replace', { fromISO: FROM });
  const { 'scentcast.trip': trip, ...rest } = before;
  assert.deepEqual(snapshot(), rest);
  assert.equal(restoreText(counts, 'replace'), 'Replaced what was on this device with the file’s: 3 wears, 2 ratings, 1 bottle switched off, 2 plans, 2 wants, Mine: 2 bottles.');
});

test('exports from before the backup restore what they hold and leave the rest', () => {
  setWant('901', true, { added: '2026-10-25' });
  saveMine({ name: 'Mine', records: [bottle('3', 'Three')] });
  setSkin('777', { rating: 1 }, '2026-11-09');
  setEvent('2026-11-20', 'day', 'office', FROM);
  // Version 1, from before ratings or plans were carried: wears and hidden bottles.
  const oldest = JSON.stringify({ app: 'scentcast-journal', version: 1, exported: '2026-09-01T12:00:00Z', location: null, hidden: ['4310', '300'], history: [{ id: 100, date: '2026-08-30', slot: 'night' }, { id: 5, date: 'soon', slot: 'day' }] });
  const backup = readBackup(oldest);
  assert.deepEqual(backup.carries, ['history', 'hiding']);
  assert.deepEqual(backup.hiding, { hidden: ['300'], shown: [] }, 'Jake in the list was the default, not this device’s own hide');
  assert.equal(backupSummary(backup, { fromISO: FROM }), '1 wear on Aug 30, 1 bottle switched off.');
  assert.equal(restoreText(restoreBackup(backup, 'replace', { fromISO: FROM }).counts, 'replace'), 'Replaced what was on this device with the file’s: 1 wear, 1 bottle switched off.');
  assert.deepEqual(loadHistory(), [{ id: '100', date: '2026-08-30', slot: 'night' }]);
  assert.deepEqual([...loadHidden().hidden], ['300']);
  assert.equal(loadSkin()['777'].rating, 1, 'ratings the file never carried stay');
  assert.equal(loadEvents(FROM).length, 1);
  assert.equal(loadWants().length, 1);
  assert.equal(loadMine().records.length, 1);
  // Version 1 with ratings and plans, and a default switched back on (Jake missing from `hidden`).
  const later = JSON.stringify({ app: 'scentcast-journal', version: 1, exported: '2026-10-28T12:00:00Z', location: null, hidden: [], history: [],
    skin: { 100: { rating: 4, longevity: 1, sillage: 0 } }, events: [{ dateISO: '2026-11-21', slot: 'night', occasion: 'formal' }, { dateISO: '2026-10-01', slot: 'night', occasion: 'date' }] });
  const second = readBackup(later);
  assert.deepEqual(second.carries, ['history', 'hiding', 'skin', 'events']);
  assert.deepEqual(second.hiding, { hidden: [], shown: ['4310'] });
  const added = restoreBackup(second, 'add', { fromISO: FROM }).counts;
  assert.equal(restoreText(added), 'Added 1 rating and 1 plan.');
  assert.ok(loadHidden().shown.has('4310'));
  assert.deepEqual(Object.keys(loadSkin()).sort(), ['100', '777']);
  restoreBackup(second, 'replace', { fromISO: FROM });
  assert.deepEqual(Object.keys(loadSkin()), ['100'], 'replaced: the file carries ratings');
  assert.deepEqual(loadEvents(FROM).map(e => e.dateISO), ['2026-11-21'], 'a plan gone by drops out');
  assert.deepEqual(loadHistory(), []);
  assert.equal(loadWants().length, 1, 'wants it never carried stay');
});

test('a file that isn’t an export says so in a sentence, and nothing changes', () => {
  fill();
  const file = exported(), before = snapshot();
  const token = journalToken(loadHistory(), [], loadSkin(), { todayISO: '2026-11-09' });
  const says = (text, pattern) => assert.throws(() => readBackup(text), err => err instanceof Error && pattern.test(err.message) && /Nothing on this device changed\.$/.test(err.message), String(pattern));
  says(token, /^That’s a Copy for Claude/);
  says(`"${token}"`, /^That’s a Copy for Claude/);
  says(file.slice(0, file.length / 2), /^That file is cut short or garbled/);
  says('{"app":"scentcast-journal","history":[', /cut short/);
  says('', /^That file isn’t an Almanac export/);
  says('wears,date\n1,2026-01-01', /isn’t an Almanac export/);
  says('{"name":"package","version":"1.0.0"}', /isn’t an Almanac export/);
  says('[]', /isn’t an Almanac export/);
  says('null', /isn’t an Almanac export/);
  says(JSON.stringify({ app: 'scentcast-journal', history: 'all of it' }), /isn’t an Almanac export/);
  assert.deepEqual(snapshot(), before);
  // Stores in another shape are left out, not restored as they are.
  const odd = readBackup(JSON.stringify({ app: 'scentcast-journal', version: 2, history: [], hidden: 'Jake', hiding: { hidden: [300, null, '300'], shown: 'all' },
    wants: [{ id: 9 }, 'x', { id: 9 }], mine: { name: 7, records: [{ id: 1 }, bottle(4, 'Four')] }, asked: [1], uses: { office: 'daily', date: 'often' }, prefs: { units: 'K', theme: 3, likedStyles: 'skin', preferValue: 'yes' }, active: 'theirs', trip: { place: 'Lisbon' }, skin: { 5: { rating: 9 } }, events: 'none' }));
  assert.deepEqual(odd.hiding, { hidden: ['300'], shown: [] });
  assert.deepEqual(odd.wants.map(w => w.id), ['9']);
  assert.deepEqual(odd.mine, { name: '', records: [bottle('4', 'Four')] });
  assert.deepEqual([odd.asked, odd.uses, odd.prefs, odd.active, odd.trip, odd.skin, odd.events], [{}, { date: 'often' }, {}, null, null, {}, []]);
});

test('a merge is pure, and the log keeps its cap', () => {
  const device = { history: [{ id: 'a', date: '2026-11-09', slot: 'day' }], skin: {}, asked: {}, events: [], hiding: { hidden: [], shown: [] }, wants: [], mine: { name: '', records: [] }, active: null, uses: null, prefs: {} };
  const frozen = JSON.stringify(device);
  const days = Array.from({ length: 800 }, (_, i) => ({ id: 'b', date: new Date(Date.UTC(2026, 10, 8) - i * 86_400_000).toISOString().slice(0, 10), slot: 'night' }));
  const backup = readBackup(JSON.stringify({ app: 'scentcast-journal', version: 2, history: days }));
  const { stores, counts } = mergeBackup(device, backup, { mode: 'add', fromISO: FROM });
  assert.equal(JSON.stringify(device), frozen);
  assert.equal(stores.history.length, 730);
  assert.equal(counts.wears, 729, 'only the wears that fit are counted as added');
  assert.equal(stores.history[0].id, 'a');
  assert.equal(mergeBackup(device, backup, { mode: 'replace', fromISO: FROM }).counts.wears, 730);
});

test('a restore starts from what’s stored, so another tab’s wears stay, and a tab reads it all again', async () => {
  fill();
  const file = exported();
  fresh();
  const tab = await import('../src/app/state.js?backup=1');
  const backup = readBackup(file); // this tab reads the file, and waits for an answer…
  toggleWear('777', '2026-11-09', 'night'); // …while another logs two wears, one for a window the file has
  toggleWear('888', '2026-11-08', 'night');
  const { counts } = restoreBackup(backup, 'add', { fromISO: FROM });
  assert.deepEqual(loadHistory().map(h => h.id), ['777', '300', '888', '100']);
  assert.deepEqual([counts.wears, counts.kept], [2, 1]);
  assert.deepEqual(tab.state.history, [], 'the tab as it was opened');
  tab.reloadStored();
  assert.equal(tab.state.history.length, 4);
  assert.equal(tab.state.mine.name, 'Brooke');
  assert.equal(tab.state.units, 'C');
  assert.deepEqual(tab.state.likedStyles, ['skin', 'clean']);
  assert.equal(tab.state.preferValue, false);
  assert.ok(tab.hiddenIn(true).has('300') && !tab.hiddenIn(true).has('4310'));
  // And what it saves next starts from there.
  tab.setStillSky(false);
  assert.equal(tab.loadPrefs().theme, 'gruvbox');
});

test('Settings shows what a file holds with both ways to restore it, then what happened', async () => {
  const { restoreHTML, settingsHTML, actions, changes } = await import('../src/views/settings.js');
  const page = s => settingsHTML({ loc: null, units: 'F', themeName: 'default', active: 'demo', mineCount: 0, shared: null, on: 1, total: 1, wears: 0, updated: '', stale: false, credits: '', ...s });
  const journal = html => html.slice(html.indexOf('>Wear journal</h2>')).split('</section>')[0];
  const plain = journal(page());
  assert.match(plain, /data-action="restore-pick" aria-describedby="restore-note">Choose file<\/button><input type="file" id="restore-file" data-field="restore-file" accept="\.json,application\/json" hidden>/);
  assert.match(plain, /<small id="restore-note">One that Export saved<\/small>/);
  assert.ok(!plain.includes('set-restore"'), 'nothing under the row until a file is chosen');
  assert.ok(!/data-action="journal-export"[^>]*disabled/.test(plain), 'an export is the whole device: wants and Mine without a wear still export');
  const chosen = { name: 'almanac-journal-2026-11-09.json', summary: '212 wears from Jan 3 to Nov 9, 14 ratings.' };
  const preview = journal(page({ restore: chosen }));
  assert.match(preview, /role="group" aria-labelledby="restore-name"/);
  assert.match(preview, /<strong id="restore-name">almanac-journal-2026-11-09\.json<\/strong><span>212 wears from Jan 3 to Nov 9, 14 ratings\.<\/span>/);
  assert.deepEqual([...preview.matchAll(/data-action="(restore-(?:add|replace|cancel))">([^<]+)</g)].map(m => `${m[1]}: ${m[2]}`),
    ['restore-add: Add to this device', 'restore-replace: Replace this device’s', 'restore-cancel: Not now']);
  assert.match(restoreHTML({ ...chosen, armed: true }), /class="btn secondary compact danger" data-action="restore-replace">Press again to replace</);
  const done = restoreHTML({ done: 'Added 174 wears and 9 ratings. 12 windows kept this device’s wear.' });
  assert.match(done, /Added 174 wears and 9 ratings\. 12 windows kept this device’s wear\./);
  assert.ok(!done.includes('data-action'), 'the choice is made');
  assert.match(restoreHTML({ error: 'That file isn’t an Almanac export.' }), /<p class="error">That file isn’t an Almanac export\.<\/p>/);
  assert.match(restoreHTML({ name: '<img src=x>', summary: '<b>' }), /&lt;img src=x&gt;.*&lt;b&gt;/s);
  assert.equal(restoreHTML(), '');
  for (const name of ['restore-pick', 'restore-add', 'restore-replace', 'restore-cancel']) assert.equal(typeof actions[name], 'function', name);
  assert.equal(typeof changes['restore-file'], 'function');
});

test('a restore the browser didn’t keep says so, and a file’s two wears for one window read as one', () => {
  fill();
  const file = exported();
  fresh();
  assert.equal(restoreBackup(readBackup(file), 'add', { fromISO: FROM }).saved, true);
  fresh();
  const setItem = localStorage.setItem;
  localStorage.setItem = (k, v) => { if (k === 'scentcast.history') throw new Error('QuotaExceededError'); setItem(k, v); };
  const { saved, counts } = restoreBackup(readBackup(file), 'add', { fromISO: FROM });
  assert.equal(saved, false, 'the journal didn’t save');
  assert.equal(counts.wears, 3);
  assert.equal(loadMine().records.length, 2, 'what did save is in');
  localStorage.setItem = setItem;
  const again = restoreBackup(readBackup(file), 'add', { fromISO: FROM });
  assert.deepEqual([again.saved, again.counts.wears, again.counts.mine], [true, 3, 0], 'adding it again finishes the restore');
  const twice = readBackup(JSON.stringify({ app: 'scentcast-journal', version: 1, hidden: [], history: [
    { id: 1, date: '2026-11-01', slot: 'day' }, { id: 2, date: '2026-11-01', slot: 'day' }, { id: 3, date: '2026-11-01', slot: 'night' }] }));
  assert.deepEqual(twice.history.map(h => `${h.slot} ${h.id}`), ['night 3', 'day 1']);
});

test('a backup carries Worn’s span with the other prefs, and only a span Worn offers', () => {
  const journal = { app: 'scentcast-journal', version: 1, exported: '2026-11-09T12:00:00.000Z', location: null, hidden: [], history: [] };
  assert.equal(backupExport(journal, { prefs: { wornSpan: 365 } }).prefs.wornSpan, 365);
  assert.equal(backupExport(journal, { prefs: { wornSpan: 90, units: 'C' } }).prefs.wornSpan, 90);
  assert.ok(!('wornSpan' in backupExport(journal, { prefs: { wornSpan: 30 } }).prefs), '30 days is the default, stored as nothing');
  assert.ok(!('wornSpan' in backupExport(journal, { prefs: { wornSpan: 7 } }).prefs));
  // Owned's order too: an id, which the pane reads as brand order when it doesn't know it.
  assert.equal(backupExport(journal, { prefs: { ownedSort: 'stars' } }).prefs.ownedSort, 'stars');
  assert.ok(!('ownedSort' in backupExport(journal, { prefs: { ownedSort: 'brand' } }).prefs), 'brand order is the default, stored as nothing');
  assert.ok(!('ownedSort' in backupExport(journal, { prefs: { ownedSort: 7 } }).prefs));
});
