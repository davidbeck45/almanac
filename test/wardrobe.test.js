// Wardrobe › Owned, Worn and the add, paste and add-it-yourself sheets: what
// their templates say to screen readers and keyboards, and what they count.
// Insights and the Wishlist are test/wardrobe-screens.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as wardrobe from '../src/views/wardrobe.js';
import { ACCORDS } from '../src/accords.js';
import { insightsSkeletonHTML } from '../src/views/wardrobe/insights.js';
import { wishlistHTML } from '../src/views/wardrobe/wishlist.js';
import { liveHTML } from '../src/views/wardrobe/parts.js';

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
  assert.match(html, /class="cal-cell has first"[^>]*title="Oct 1: Mango Sticky Rice"/);
  assert.match(html, /<span class="cal-mon">Oct<\/span><span class="cal-day"> 1<\/span>/);
  assert.match(html, /<small aria-hidden="true">30<\/small>/);
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
