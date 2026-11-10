// Wardrobe › Owned, Worn and the add, paste and add-it-yourself sheets: what
// their templates say to screen readers and keyboards, and what they count.
// Insights and the Wishlist are test/wardrobe-screens.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as wardrobe from '../src/views/wardrobe.js';
import * as settings from '../src/views/settings.js';
import { localMatches } from '../src/collections.js';
import { ACCORDS } from '../src/accords.js';
import { insightsSkeletonHTML } from '../src/views/wardrobe/insights.js';
import { wishlistHTML } from '../src/views/wardrobe/wishlist.js';
import { liveHTML } from '../src/views/wardrobe/parts.js';
import { state } from '../src/app/state.js';

const bottle = (id, name, brand) => ({ id, name, brand, accords: { woody: 80 } });
const aventus = bottle('9828', 'Aventus', 'Creed');
const nish = bottle('91000', 'Aventus', 'Nish Parfum');
const mango = bottle('128201', 'Mango Sticky Rice', 'd’Annam');
const many = Array.from({ length: 10 }, (_, i) => bottle(String(i + 1), `Bottle ${i + 1}`, 'House'));

test('two results with one name are told apart by their brands, added or not', () => {
  const html = wardrobe.addSheetHTML({ query: 'aventus', results: [aventus, nish] }, new Set([nish.id]));
  assert.match(html, /aria-label="Add Aventus by Creed"/);
  assert.match(html, /disabled aria-label="Added Aventus by Nish Parfum"/);
  assert.match(html, /id="add-q"/, 'the search field has an id focus can find it by after a redraw');
});

test('the add sheet’s status line says searching, how many matched, and what went wrong', () => {
  assert.equal(wardrobe.addSheetStatus({ busy: true, query: 'aventus' }), 'Searching…');
  assert.equal(wardrobe.addSheetStatus({ query: 'aventus', results: [aventus, nish] }), '2 matches for “aventus”.');
  assert.equal(wardrobe.addSheetStatus({ query: 'av', results: null, error: 'Type at least 3 letters.' }), 'Type at least 3 letters.');
  assert.equal(wardrobe.addSheetStatus({ query: 'zzz', results: [] }), 'No matches for “zzz”.');
  assert.equal(wardrobe.addSheetStatus({}), '');
  // Drawn empty, with what to say in data-say (speak fills it a moment later).
  const html = wardrobe.addSheetHTML({ query: 'aventus', results: [aventus] }, new Set());
  assert.match(html, /<p class="visually-hidden" role="status" id="add-live" data-say="1 match for “aventus”\."><\/p>/);
  assert.equal(liveHTML('x', '<b>'), '<p class="visually-hidden" role="status" id="x" data-say="&lt;b&gt;"></p>');
});

test('a pasted line already in Mine is marked, not ticked, and the count leaves it and repeats out', () => {
  const rows = [
    { line: 'Aventus', status: 'done', match: aventus, checked: true },
    { line: 'Creed Aventus', status: 'done', match: aventus, checked: true },
    { line: 'Mango Sticky Rice', status: 'done', match: mango, checked: false, owned: true },
    { line: 'Aventus Nish', status: 'done', match: nish, checked: false, weak: true },
    { line: 'Some Made Up Perfume', status: 'done', match: null, note: '' },
  ];
  assert.deepEqual(wardrobe.importPicks(rows).map(r => r.id), [aventus.id]);
  // Even ticked by hand, a bottle in Mine adds nothing.
  assert.deepEqual(wardrobe.importPicks([{ ...rows[2], checked: true }]), []);
  const html = wardrobe.importSheetHTML({ rows }, 15);
  assert.match(html, /Add 1 bottle</);
  assert.equal((html.match(/role="checkbox"/g) ?? []).length, 3, 'no tick for the one in Mine');
  assert.match(html, /<span class="owned-tag">[^]*?In Mine<\/span>/);
  // Each row's controls say which line they're for.
  assert.match(html, /aria-label="Add Aventus by Creed, for “Creed Aventus”"/);
  assert.match(html, /Add it yourself<span class="visually-hidden">: Some Made Up Perfume<\/span>/);
  assert.match(html, /Add it yourself<span class="visually-hidden">: Aventus Nish<\/span>/);
  assert.equal(wardrobe.importSheetStatus({ rows }), 'Found 4 of 5 lines. 1 already in Mine.');
  assert.equal(wardrobe.importSheetStatus({ rows, busy: true }), 'Looking up 5 lines…');
  assert.match(html, /id="import-title" class="sheet-title" tabindex="-1"/, 'the title can take focus when the text box goes');
});

test('a pasted line ticks a bottle only when its whole name was typed', () => {
  const demo = JSON.parse(readFileSync(new URL('../data/collection.json', import.meta.url))).fragrances;
  const elixir = demo.find(f => f.name === 'Hawas Elixir');
  const forHim = bottle('31862', 'Hawas for Him', 'Rasasi');
  // "Hawas" finds Hawas Elixir on the shelf, but doesn't name it: offered, unticked.
  assert.equal(localMatches('Hawas', demo, 1)[0], elixir);
  assert.deepEqual(wardrobe.lineMatch('Hawas', elixir, []), { match: elixir, checked: false, weak: true });
  // The library's best guess comes first when it has one, unticked too.
  assert.deepEqual(wardrobe.lineMatch('Hawas', elixir, [forHim, elixir]), { match: forHim, checked: false, weak: true });
  assert.deepEqual(wardrobe.lineMatch('Hawas Elixir', elixir, [forHim]), { match: elixir, checked: true, weak: false });
  assert.deepEqual(wardrobe.lineMatch('Hawas for Him Rasasi', null, [forHim]), { match: forHim, checked: true, weak: false });
  assert.deepEqual(wardrobe.lineMatch('Some Made Up Perfume', null, []), { match: null, checked: false, weak: false });
});

test('Paste a list says when lines wait for another round, and the box keeps them', () => {
  const rows = Array.from({ length: 15 }, (_, i) => ({ line: `Bottle ${i + 1}`, status: 'done', match: many[i % 10], checked: true }));
  assert.equal(wardrobe.importSheetStatus({ rows, more: 3 }), 'Found 15 of 15 lines. 3 more lines left for the next round.');
  assert.equal(wardrobe.importSheetStatus({ rows, busy: true, more: 1 }), 'Looking up 15 lines… 1 more line left for the next round.');
  const html = wardrobe.importSheetHTML({ rows, more: 3 }, 15);
  assert.match(html, /<p class="notice">Only the first 15 lines\. Add these, and the other 3 come back here for another round\.<\/p>/);
  assert.match(wardrobe.importSheetHTML({ rows, more: 1 }, 15), /the last line comes back here/);
  assert.ok(!wardrobe.importSheetHTML({ rows }, 15).includes('class="notice"'));
  const box = wardrobe.importSheetHTML({ text: 'A\nB\nC', carried: 3 }, 15);
  assert.match(box, /The last 3 lines of your list, ready for another round/);
  assert.match(box, /data-field="import-text"[^>]*>A\nB\nC<\/textarea>/, 'saved as typed, so a render keeps it');
});

test('Add bottles keeps the search field as typed through a redraw', () => {
  const html = wardrobe.addSheetHTML({ query: 'aventus', draft: 'dior sau', results: [aventus] }, new Set());
  assert.match(html, /id="add-q" name="q" data-field="add-q"[^>]*value="dior sau"/);
  assert.match(html, /1 match for “aventus”/, 'the results still say what was searched');
  assert.match(wardrobe.addSheetHTML({ query: 'aventus' }, new Set()), /value="aventus"/);
});

test('a share link that can’t go to the clipboard shows whole, to copy by hand', () => {
  const url = `https://example.com/almanac/?c=${Array.from({ length: 24 }, (_, i) => 90000 + i).join(',')}&n=David`;
  const html = wardrobe.shareSheetHTML({ url, name: 'David' });
  assert.ok(html.includes(`id="share-url" data-action="share-select" value="${url.replace(/&/g, '&amp;')}" readonly`), 'the whole link, in a field');
  assert.match(html, /data-action="share-copy"/);
  assert.match(html, /David’s bottles/);
  assert.match(wardrobe.shareSheetHTML({ url, copied: true }), /<span>Copied<\/span>/);
  assert.match(wardrobe.shareSheetHTML({ url, copied: 'Couldn’t copy' }), /<p class="muted small">Couldn’t copy<\/p>/);
  // The journal's Copy for Claude falls back on the same sheet, in its own words.
  const claude = wardrobe.shareSheetHTML({ url: 'scj1.eyJ0Ijoi', claude: true });
  assert.match(claude, /<h2 id="share-title" class="sheet-title">Copy for Claude<\/h2>/);
  assert.match(claude, /Paste it to Claude so its picks know what you’ve worn/);
  assert.match(claude, /value="scj1\.eyJ0Ijoi" readonly/);
  assert.match(claude, /<span>Copy<\/span>/);
  assert.doesNotMatch(claude, /link/i);
});

test('the journal says it covers every list when the ranked one isn’t all it holds', () => {
  const data = {
    stats: { wears: 2, bottles: 2, top: [[mango.id, 1], [aventus.id, 1]], lastWorn: new Map([[mango.id, '2026-10-01'], [aventus.id, '2026-10-01']]) },
    calendar: [], dusty: [{ f: nish, last: null }], todayISO: '2026-10-02',
  };
  const resolve = id => [mango, aventus, nish].find(f => f.id === id);
  const mixed = wardrobe.wornHTML(data, resolve, { list: 'Mine' });
  assert.match(mixed, /Every wear logged on this device, from any list\./);
  assert.match(mixed, /<h3>Gathering dust<\/h3><p class="muted small journal-scope">From Mine: in rotation, not worn in 30 days\.<\/p>/);
  assert.ok(!wardrobe.wornHTML(data, resolve).includes('journal-scope'), 'one list: nothing to say');
  assert.match(wardrobe.wornHTML(data, resolve, { confirmClear: true }), /Press again to clear/, 'no Tap on a desktop');
  // Copy for Claude heads the card, where a phone's first screen shows it (at
  // the foot it was a screen and a half down); Export and Clear stay there.
  const worn = wardrobe.wornHTML(data, resolve);
  assert.match(worn, /<header class="section-head"><h2 id="journal-title">Last 30 days<\/h2><button class="btn secondary compact" data-action="journal-claude">.*Copy for Claude<\/button>\s*<p>Copies your last ten days, stars and switched-off bottles for Claude’s picks \(no places\)\.<\/p><\/header>/s);
  assert.equal((worn.match(/data-action="journal-claude"/g) ?? []).length, 1);
  assert.ok(worn.indexOf('journal-claude') < worn.indexOf('class="stat-tiles"'));
  assert.match(worn, /data-action="journal-export">.*Export<\/button>\s*<button class="btn tertiary" data-action="journal-clear">/s);
});

test('Settings copies the journal for Claude too, beside its export, with or without wears', () => {
  const base = { loc: { name: 'Here' }, units: 'F', themeName: 'default', active: 'demo', mineCount: 0, shared: null, on: 1, total: 1, updated: '', stale: false, credits: '' };
  for (const wears of [0, 66]) {
    const html = settings.settingsHTML({ ...base, wears });
    const journal = html.slice(html.indexOf('id="set-wear-journal"'), html.indexOf('id="set-about"'));
    assert.match(journal, /data-action="journal-export"/);
    assert.match(journal, /For Claude’s picks<small>Recent wears and stars<\/small>[^]*<button class="btn tertiary compact" data-action="journal-claude">.*Copy for Claude<\/button>/);
    assert.ok(!/data-action="journal-claude"[^>]*disabled/.test(journal), 'its stars and hidden bottles count without a wear');
  }
  // The handler is Worn's: action names are global, so one does for both.
  assert.equal(typeof wardrobe.actions['journal-claude'], 'function');
});

test('the accord chips are one Tab stop, and a chosen chip says its rank in words', () => {
  const all = Object.keys(ACCORDS);
  const stops = html => [...html.matchAll(/data-value="([^"]+)" aria-pressed="(?:true|false)" tabindex="0"/g)].map(m => m[1]);
  const none = wardrobe.customSheetHTML({}, 6);
  assert.deepEqual(stops(none), [all[0]]);
  assert.equal((none.match(/tabindex="-1"/g) ?? []).length, all.length - 1);
  const two = wardrobe.customSheetHTML({ accords: ['cacao', 'amber'] }, 6);
  assert.deepEqual(stops(two), ['cacao'], 'the strongest chosen');
  assert.match(two, /<b aria-hidden="true">1<\/b>Cacao<span class="visually-hidden">, strongest<\/span>/);
  assert.match(two, /<b aria-hidden="true">2<\/b>Amber<span class="visually-hidden">, 2nd<\/span>/);
  assert.deepEqual(stops(wardrobe.customSheetHTML({ accords: ['cacao'], chip: 'amber' }, 6)), ['amber'], 'the one arrows moved to');
  // A full set disables the rest: the stop is never a disabled chip.
  const full = all.slice(0, 6);
  assert.deepEqual(stops(wardrobe.customSheetHTML({ accords: full, chip: all[10] }, 6)), [full[0]]);
});

test('an add-it-yourself error points at its field, and only the accords’ is said aloud', () => {
  const name = wardrobe.customSheetHTML({ error: 'Give it a name.', invalid: 'name' }, 6);
  assert.match(name, /id="custom-name"[^>]*aria-invalid="true" aria-describedby="custom-error"/);
  assert.match(name, /<\/label>\s*<p class="error" id="custom-error">Give it a name\.<\/p>/, 'under the field it’s about');
  assert.ok(!name.includes('role="alert"'), 'focus on the field reads it; no second announcement');
  assert.match(name, /id="custom-live" data-say=""/);
  const accords = wardrobe.customSheetHTML({ name: 'My Rose', error: 'Pick at least one accord.', invalid: 'accords' }, 6);
  assert.match(accords, /<fieldset aria-describedby="custom-error">[^]*?<\/legend>\s*<p class="error" id="custom-error">/);
  assert.ok(!/aria-invalid/.test(accords));
  assert.match(accords, /id="custom-live" data-say="Pick at least one accord\."/);
  assert.match(wardrobe.customSheetHTML({}, 6), />Add to Mine</);
});

test('Owned asks for a share name only once Mine has something to share, and says how a filter went', () => {
  const owned = mine => wardrobe.ownedHTML({ tab: 'mine', demo: many, mine, shared: null, hidden: new Set() });
  const empty = owned({ name: '', records: [] });
  assert.ok(!empty.includes('data-field="mine-name"'));
  assert.match(empty, /No bottles yet/);
  assert.match(owned({ name: 'Alex', records: [mango] }), /data-field="mine-name" value="Alex"/);
  // Over eight bottles there's a filter, and a status line it reports to.
  const long = owned({ name: '', records: many });
  assert.match(long, /data-field="collection-filter"/);
  assert.match(long, /role="status" id="owned-live"/);
  assert.match(long, /aria-label="Share Mine"/);
});

test('the calendar’s 1st names its month in parts a narrow cell can drop', () => {
  const day = (dateISO, extra = {}) => ({ dateISO, future: false, day: null, night: null, ...extra });
  const html = wardrobe.wornHTML({
    stats: { wears: 1, bottles: 1, top: [[mango.id, 1]], lastWorn: new Map([[mango.id, '2026-10-01']]) },
    calendar: [[day('2026-09-30'), day('2026-10-01', { day: { id: mango.id } }), day('2026-10-02')]],
    dusty: [],
    todayISO: '2026-10-02',
  }, id => (id === mango.id ? mango : null));
  assert.match(html, /class="cal-cell has first"[^>]*title="Yesterday, Oct 1: Mango Sticky Rice by day"/);
  assert.match(html, /<span class="cal-mon">Oct<\/span><span class="cal-day"> 1<\/span>/);
  assert.match(html, /<small aria-hidden="true">30<\/small>/);
});

test('the calendar’s days gone by and today open the log sheet; days ahead don’t', () => {
  const day = (dateISO, extra = {}) => ({ dateISO, future: false, day: null, night: null, ...extra });
  const html = wardrobe.wornHTML({
    stats: { wears: 1, bottles: 1, top: [[mango.id, 1]], lastWorn: new Map([[mango.id, '2026-10-31']]) },
    calendar: [[day('2026-10-31', { night: { id: mango.id } }), day('2026-11-01'), day('2026-11-02'), day('2026-11-03', { future: true })]],
    dusty: [],
    todayISO: '2026-11-02',
  }, id => (id === mango.id ? mango : null));
  assert.match(html, /<button type="button" class="cal-cell has" data-action="journal-log" data-date="2026-10-31" title="Sat, Oct 31: Mango Sticky Rice at night" tabindex="-1">/);
  assert.match(html, /<span class="visually-hidden">Sat, Oct 31: Mango Sticky Rice at night<\/span>/, 'named by its day and what was worn when');
  assert.match(html, /data-date="2026-11-01" title="Yesterday, Nov 1: nothing logged" tabindex="-1">/);
  // Today is the one stop in the tab order; arrow keys move from there.
  assert.match(html, /class="cal-cell today" data-action="journal-log" data-date="2026-11-02" title="Today, Nov 2: nothing logged" tabindex="0" aria-current="date">/);
  assert.match(html, /<span class="cal-cell future" title="Nov 3">/);
  assert.ok(!html.includes('data-date="2026-11-03"'), 'a day ahead can’t be worn yet');
  assert.match(html, /<h3>Calendar<\/h3><p class="muted small cal-hint">Choose a day to log a wear you didn’t at the time\.<\/p>/);
  // An empty journal offers one too, for today.
  const empty = wardrobe.wornHTML({ stats: { wears: 0, bottles: 0, top: [], lastWorn: new Map() }, calendar: [], dusty: [], todayISO: '2026-11-02' }, () => null);
  assert.match(empty, /data-action="journal-log" data-date="2026-11-02">.*Log a wear<\/button>/s);
});

test('a calendar day names what was worn by day and at night, a bottle no list has included', () => {
  const resolve = id => (id === mango.id ? mango : null);
  const c = { dateISO: '2026-10-28', future: false, day: { id: 'gone' }, night: { id: mango.id } };
  assert.equal(wardrobe.calendarLabel(c, resolve, '2026-11-02'), 'Wed, Oct 28: a bottle from another list by day, Mango Sticky Rice at night');
  assert.equal(wardrobe.calendarLabel({ ...c, dateISO: '2026-11-04', future: true }, resolve, '2026-11-02'), 'Nov 4');
});

test('arrow keys step through the calendar’s days, a week up or down, never past today', () => {
  // Five weeks, today the Monday of the last (index 29).
  const today = 29;
  assert.equal(wardrobe.calendarStep('ArrowLeft', today, today), 28);
  assert.equal(wardrobe.calendarStep('ArrowRight', today, today), today, 'tomorrow can’t be worn yet');
  assert.equal(wardrobe.calendarStep('ArrowUp', today, today), 22);
  assert.equal(wardrobe.calendarStep('ArrowDown', 22, today), today);
  assert.equal(wardrobe.calendarStep('ArrowDown', 26, today), today, 'next Thursday is ahead: today');
  assert.equal(wardrobe.calendarStep('ArrowUp', 3, today), 0);
  assert.equal(wardrobe.calendarStep('ArrowLeft', 0, today), 0);
  assert.deepEqual(['Home', 'End'].map(k => wardrobe.calendarStep(k, 10, today)), [7, 13]);
  assert.equal(wardrobe.calendarStep('End', 28, today), today);
  assert.equal(wardrobe.calendarStep('Enter', 10, today), null);
});

test('the calendar keeps one tab stop, on the day focus came back to', () => {
  // As drawn: today the stop. Then focus lands on Sat, Oct 31, as it does
  // coming back from logging a wear there, which every draw gives -1.
  const days = ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'].map(date => ({ date, tabIndex: date === '2026-11-02' ? 0 : -1 }));
  const stops = () => days.filter(d => d.tabIndex === 0).map(d => d.date);
  wardrobe.calendarStop(days, days[1]);
  assert.deepEqual(stops(), ['2026-10-31']);
  wardrobe.calendarStop(days, days[0]);
  assert.deepEqual(stops(), ['2026-10-30']);
});

test('the log sheet’s filter says how many bottles are left, or that none match, past a Clear’s message', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const realDoc = globalThis.document;
  // The sheet as drawn: its status line empty, with nothing to say yet.
  const draw = (say = '') => ({ id: 'log-live', dataset: { say }, textContent: '' });
  let live = draw();
  const rows = ['cream velvet xerjoff', 'liam lattafa', 'aventus creed'].map(name => ({ dataset: { name }, hidden: false }));
  const sheet = { querySelectorAll: sel => (sel === '[data-say]' ? [live] : []) };
  globalThis.document = {
    activeElement: null,
    getElementById: id => (id === 'log-live' ? live : id === 'sheet' ? sheet : null),
    querySelector: sel => (sel === '#sheet .log-empty' ? { hidden: true } : null),
    querySelectorAll: sel => (sel === '#sheet .log-rows li[data-name]' ? rows : []),
  };
  const ui = { openSheet(s) { state.sheet = s; } };
  const type = value => {
    wardrobe.fields['journal-log-filter']({ value });
    t.mock.timers.tick(400);
    t.mock.timers.tick(150);
    return live.textContent;
  };
  try {
    wardrobe.actions['journal-log']({ dataset: { date: '2026-10-31', slot: 'day' } }, ui);
    assert.equal(type('cream'), '1 bottle');
    assert.equal(state.sheet.said, '1 bottle', 'a redraw keeps it, unsaid');
    assert.equal(type('zzzz'), 'No bottles match');
    // A Clear's message in the line: the count still takes its place.
    live = draw('Cleared Liam from Sat, Oct 31.');
    live.textContent = live.dataset.say;
    assert.equal(type(''), '3 bottles');
    // Opened again, the same filter is said again.
    state.sheet = null;
    live = draw();
    wardrobe.actions['journal-log']({ dataset: { date: '2026-10-31', slot: 'day' } }, ui);
    assert.equal(type('cream'), '1 bottle');
  } finally {
    globalThis.document = realDoc;
    state.sheet = null;
  }
});

test('the log sheet names the day, its wears with Clear, and the bottles most recently worn first', () => {
  const bottles = [aventus, mango, ...many];
  const lastWorn = new Map([[mango.id, '2026-11-01'], [aventus.id, '2026-10-20'], ['3', '2026-10-31']]);
  const ordered = wardrobe.logOrder(bottles, lastWorn);
  assert.deepEqual(ordered.slice(0, 4).map(f => f.name), ['Mango Sticky Rice', 'Bottle 3', 'Aventus', 'Bottle 1'], 'then by name');
  const sheet = (s, worn = { day: null, night: null }) => wardrobe.logSheetHTML({ dateISO: '2026-10-31', slot: 'night', ...s }, { bottles: ordered, worn, lastWorn, todayISO: '2026-11-02' });
  const html = sheet({}, { day: { id: mango.id, f: mango }, night: { id: aventus.id, f: aventus } });
  assert.match(html, /<h2 id="log-title" class="sheet-title">Sat, Oct 31<\/h2>/);
  assert.match(html, /data-action="journal-log-slot" data-value="night" aria-pressed="true"/);
  // Each Clear carries the wear it was drawn for, so it never clears one another tab logged since.
  assert.match(html, /<b>Mango Sticky Rice<\/b><small>Day<\/small><\/span>\s*<button class="btn tertiary compact" data-action="journal-log-clear" data-slot="day" data-id="128201">Clear<span class="visually-hidden">: Mango Sticky Rice by day<\/span>/);
  assert.match(html, /data-action="journal-log-clear" data-slot="night" data-id="9828">Clear<span class="visually-hidden">: Aventus at night/);
  assert.match(html, /<p class="list-title" id="log-list-title">What you wore at night<\/p>/);
  // The night's bottle is marked, and logging it again does nothing.
  assert.match(html, /data-id="9828" aria-disabled="true">[^]*?<small>Logged at night<\/small>/);
  assert.match(html, /data-id="128201">[^]*?<small>d’Annam · worn yesterday<\/small>/);
  assert.match(html, /placeholder="Filter 12 bottles"/);
  // A filter hides the rest as drawn, so a redraw keeps it.
  const filtered = sheet({ filter: 'bottle 1' });
  assert.equal((filtered.match(/<li class="row"[^>]* hidden>/g) ?? []).length, 10, 'Bottle 1 and Bottle 10 stay');
  assert.match(sheet({ filter: 'zzz' }), /<p class="muted small log-empty">No bottles match\.<\/p>/);
  assert.match(sheet({ said: 'Cleared Aventus from Sat night, Oct 31.' }), /id="log-live" data-say="Cleared Aventus from Sat night, Oct 31\."/);
  assert.ok(!sheet({}).includes('class="log-worn"'), 'nothing logged: no list of wears');
  assert.match(wardrobe.logSheetHTML({ dateISO: '2026-11-02', slot: 'day' }, { bottles: [], worn: { day: null, night: null }, lastWorn, todayISO: '2026-11-02' }), /Today, Nov 2[^]*Every bottle is switched off/);
});

test('a wear logged after the fact is said by when it was', () => {
  const today = '2026-11-02';
  assert.deepEqual(['day', 'night'].map(k => wardrobe.loggedWhen(today, k, today)), ['today', 'tonight']);
  assert.deepEqual(['day', 'night'].map(k => wardrobe.loggedWhen('2026-11-01', k, today)), ['yesterday', 'last night']);
  assert.deepEqual(['day', 'night'].map(k => wardrobe.loggedWhen('2026-10-31', k, today)), ['Sat, Oct 31', 'Sat night, Oct 31']);
  assert.equal(wardrobe.logDayTitle('2026-11-01', today), 'Yesterday, Nov 1');
});

test('Gathering dust says when this week each bottle would suit, and opens it in that window’s list', () => {
  const win = (dateISO, slot) => ({ dateISO, slot });
  const data = {
    stats: { wears: 1, bottles: 1, top: [[mango.id, 1]], lastWorn: new Map([[mango.id, '2026-10-01']]) },
    calendar: [],
    dusty: [
      { f: aventus, last: null, when: { kind: 'planned', win: win('2026-11-03', 'night'), ctx: 'w:2026-11-03:night' } },
      { f: nish, last: '2026-09-20', when: { kind: 'suits', win: win('2026-11-07', 'night'), ctx: 'w:2026-11-07:night' } },
      { f: many[0], last: null, when: { kind: 'none' } },
      { f: many[1], last: null, when: null },
    ],
    todayISO: '2026-11-02',
  };
  const html = wardrobe.wornHTML(data, id => [mango, aventus, nish].find(f => f.id === id));
  assert.match(html, /data-ctx="w:2026-11-03:night" data-id="9828">[^]*?<small>Not worn yet<\/small><small class="dust-when on">Week’s pick for tomorrow night<\/small>/);
  assert.match(html, /data-ctx="w:2026-11-07:night" data-id="91000">[^]*?<small>Last worn Sep 20<\/small><small class="dust-when on">Would suit Sat night<\/small>/);
  assert.match(html, /data-ctx="" data-id="1">[^]*?<small class="dust-when">Not this week’s weather<\/small>/);
  assert.match(html, /data-ctx="" data-id="2">[^]*?<small>Not worn yet<\/small><\/span>/, 'before the forecast, nothing to say');
});

test('the Insights map’s skeleton has a vial for every cell of both slots', () => {
  assert.equal((insightsSkeletonHTML().match(/sk-vial/g) ?? []).length, 80);
});

test('the Wishlist’s summary is said from a status line of its own, not the one it redraws', () => {
  const want = { want: { id: '1', added: '2026-10-01' }, record: mango, check: { verdict: 'Good', reasons: [], fills: [], gain: 1 }, owned: null, today: null };
  const html = wishlistHTML({ items: [want] });
  assert.match(html, /<p class="muted small wish-status">1 bottle: 1 good\.<\/p>/);
  assert.match(html, /role="status" id="wish-live" data-say="1 bottle: 1 good\."/);
  assert.equal((html.match(/role="status"/g) ?? []).length, 1);
  assert.match(wishlistHTML({ items: [want], busy: true }), /data-say="Checking 1 bottle against your wardrobe…"/);
});

// ---------- Owned's sorts and row facts ----------

const shelf = [
  { id: 1, name: 'Liam', brand: 'Lattafa Perfumes', image: '' },
  { id: 2, name: 'Sauvage', brand: 'Dior', image: '' },
  { id: 3, name: 'Aristo', brand: 'Arabiyat Prestige', image: '' },
  { id: 4, name: 'Jake', brand: 'Hollister', image: '' },
];
const entryOf = (f, score) => ({ fragrance: f, score, tier: 'A', reasons: [], parts: {} });
// Now's window as planned: Sauvage ranks first, but the plan's pick is Liam.
const tonight = { win: { label: 'Tonight', slot: 'night', dateISO: '2026-03-10' }, ranked: [entryOf(shelf[1], 0.874), entryOf(shelf[0], 0.861), entryOf(shelf[2], 0.502)], pick: null };
tonight.pick = tonight.ranked[1];
const wears = new Map([['2', '2026-03-07'], ['3', '2026-03-10'], ['4', '2026-02-01']]);
const stars = { 1: { rating: 4 }, 4: { rating: 5 }, 3: { rating: null, longevity: 1 } };
const namesIn = list => list.map(f => f.name).join(', ');

test('Owned offers only the sorts with something behind them, and says why Fits now can’t rank', () => {
  const ids = by => wardrobe.ownedSorts(shelf, by).map(s => `${s.id}${s.off ? `: ${s.off}` : ''}`).join(', ');
  assert.equal(ids({}), 'brand, fit: needs the forecast', 'no journal or stars: Brand, and Fits now waiting on the forecast');
  assert.equal(ids({ hidden: new Set([1, 2, 3, 4]) }), 'brand, fit: no bottles in picks');
  assert.equal(ids({ fit: tonight, lastWorn: wears, skin: stars }), 'brand, fit, worn, stars');
  assert.equal(ids({ fit: tonight, lastWorn: new Map([['99', '2026-03-01']]), skin: { 3: stars[3] } }), 'brand, fit', 'a wear of another list’s bottle and a skin nudge without stars sort nothing here');
  assert.equal(wardrobe.ownedSorts(shelf, { fit: tonight }).find(s => s.id === 'fit').said, 'Sorted by how they fit tonight');
  assert.deepEqual(wardrobe.OWNED_SORTS.map(s => s.said), ['Sorted by brand', 'Sorted by how they fit now', 'Sorted by most recently worn', 'Sorted by your stars']);
});

test('Owned sorts by brand, Now’s ranking, the newest wear or your stars, brand order breaking ties', () => {
  const by = { fit: tonight, lastWorn: wears, skin: stars };
  assert.equal(namesIn(wardrobe.sortOwned(shelf, 'brand', by)), 'Aristo, Sauvage, Jake, Liam');
  assert.equal(namesIn(wardrobe.sortOwned(shelf, 'fit', by)), 'Liam, Sauvage, Aristo, Jake', 'the pick, the ranking, then the bottle switched off');
  assert.equal(namesIn(wardrobe.sortOwned(shelf, 'worn', by)), 'Aristo, Sauvage, Jake, Liam', 'most recent first, never worn last');
  assert.equal(namesIn(wardrobe.sortOwned(shelf, 'stars', by)), 'Jake, Liam, Aristo, Sauvage', 'rated first, highest first, the rest by brand');
  assert.equal(namesIn(wardrobe.sortOwned(shelf, 'fit', { ...by, fit: null })), 'Aristo, Sauvage, Jake, Liam', 'no forecast: brand order');
  assert.equal(namesIn(shelf), 'Liam, Sauvage, Aristo, Jake', 'the list itself is left as it was');
});

test('an Owned row’s fact matches the sort: its match in Now’s words, its last wear, or your stars', () => {
  const by = { fit: tonight, lastWorn: wears, skin: stars, todayISO: '2026-03-10' };
  const fact = (f, sort) => wardrobe.ownedFact(f, sort, by)?.text ?? null;
  assert.deepEqual(shelf.map(f => fact(f, 'fit')), ['86% tonight · Now’s pick', '87% tonight', '50% tonight', 'Left out of picks']);
  assert.deepEqual(shelf.map(f => fact(f, 'worn')), ['Not worn yet', 'Worn 3 days ago', 'Worn today', 'Worn Feb 1']);
  assert.deepEqual(shelf.map(f => fact(f, 'stars')), ['4★', 'Not rated', 'Not rated', '5★']);
  assert.deepEqual(shelf.map(f => fact(f, 'brand')), ['4★', null, null, '5★'], 'in brand order only the stars you gave');
  assert.equal(wardrobe.ownedFact(shelf[0], 'stars', by).spoken, 'You rate it 4 stars');
  assert.equal(wardrobe.ownedFact(shelf[1], 'fit', { ...by, fit: { ...tonight, win: { ...tonight.win, label: 'Tomorrow night' } } }).text, '87% tomorrow night');
  for (const f of shelf) for (const sort of ['brand', 'fit', 'worn', 'stars']) assert.doesNotMatch(fact(f, sort) ?? '', /°|\d+\s?F\b/, 'no temperature in a row');
});

test('Owned draws the sort beside the filter, each row’s fact on its brand’s line, and falls back to brand order', () => {
  const owned = more => wardrobe.ownedHTML({ tab: 'demo', demo: shelf, mine: { name: '', records: [] }, shared: null, hidden: new Set([4]), ...more });
  const rows = html => [...html.matchAll(/<li class="row[^"]*"[^>]*>.*?<\/li>/gs)].map(m => m[0]);
  const optionsOf = html => [...html.matchAll(/<option value="(\w+)"( selected)?( disabled)?>([^<]*)</g)].map(m => `${m[1]}${m[2] ? '*' : ''}${m[3] ? '!' : ''} ${m[4]}`);

  const plain = owned({});
  assert.deepEqual(optionsOf(plain), ['brand* Brand A–Z', 'fit! Fits now (needs the forecast)'], 'without a forecast the choice is there, off, and says why');
  assert.match(plain, /<label class="owned-sort"><span class="visually-hidden">Sort bottles<\/span><select data-field="owned-sort">/);
  assert.match(plain, /role="status" id="owned-live"/, 'the status line is there for the sort, filter or not');
  assert.ok(!plain.includes('own-fact'), 'no stars, no facts in brand order');
  assert.ok(!plain.includes('data-field="collection-filter"'), 'four bottles need no filter');

  const by = { fit: tonight, lastWorn: wears, skin: stars, todayISO: '2026-03-10' };
  const fit = owned({ ...by, sort: 'fit' });
  assert.deepEqual(optionsOf(fit), ['brand Brand A–Z', 'fit* Fits now', 'worn Worn lately', 'stars Your stars']);
  assert.deepEqual(rows(fit).map(r => r.match(/<b>([^<]*)</)[1]), ['Liam', 'Sauvage', 'Aristo', 'Jake']);
  assert.match(rows(fit)[0], /<small><span class="own-brand">Lattafa Perfumes<\/span><span class="own-fact lead">86% tonight · Now’s pick<\/span><\/small>/);
  assert.match(rows(fit)[3], /^<li class="row off has-fact"/, 'a switched-off bottle stays, marked as before');
  assert.match(rows(fit)[3], /Left out of picks/);
  assert.match(rows(fit)[3], /role="switch" aria-checked="false" data-action="rotation" data-id="4"/);
  assert.match(rows(fit)[0], /<button class="row-main" data-action="open" data-ctx="" data-id="1">/, 'the row still opens the bottle');
  for (const r of rows(fit)) assert.match(r, / data-name="[^"]+"/, 'every row can be filtered');

  const brand = owned({ ...by, sort: 'brand' });
  assert.match(rows(brand)[3], /<span class="own-fact stars"><span aria-hidden="true">4★<\/span><span class="visually-hidden">You rate it 4 stars<\/span><\/span>/);
  assert.match(rows(brand)[0], /<small>Arabiyat Prestige<\/small>/, 'an unrated bottle shows its brand alone');

  assert.deepEqual(optionsOf(owned({ ...by, fit: null, sort: 'fit' }))[0], 'brand* Brand A–Z', 'a saved Fits now waits in brand order until the forecast is in');
  assert.deepEqual(optionsOf(owned({ fit: tonight, sort: 'stars' })), ['brand* Brand A–Z', 'fit Fits now'], 'a saved sort this list can’t offer reads as brand');
  assert.deepEqual(optionsOf(owned({ fit: tonight, sort: 'constructor' }))[0], 'brand* Brand A–Z');

  const mine = wardrobe.ownedHTML({ tab: 'mine', demo: [], mine: { name: '', records: shelf }, shared: null, hidden: new Set(), ...by, sort: 'worn' });
  assert.deepEqual(rows(mine).map(r => r.match(/<b>([^<]*)</)[1]), ['Aristo', 'Sauvage', 'Jake', 'Liam']);
  assert.equal((mine.match(/data-action="remove"/g) ?? []).length, 4, 'Mine keeps Remove on every row');
  const one = wardrobe.ownedHTML({ tab: 'mine', demo: [], mine: { name: '', records: shelf.slice(0, 1) }, shared: null, hidden: new Set() });
  assert.ok(!one.includes('owned-sort'), 'one bottle has nothing to sort');
  const evil = { id: 9, name: 'x', brand: '<img src=x onerror=alert(1)>', image: '' };
  assert.ok(!wardrobe.ownedHTML({ tab: 'demo', demo: [evil, shelf[0]], mine: { name: '', records: [] }, shared: null, hidden: new Set(), ...by }).includes('<img src=x'), 'a brand is escaped beside its fact');
});
