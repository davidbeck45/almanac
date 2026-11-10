// A want's note: the helper that sets or clears one (src/wishlist.js), its
// save beside another tab, and the Wishlist card with a note, without one
// and while one is being written (src/views/wardrobe/wishlist.js).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadWants, saveWants, noteWant, setNote, setWant, MAX_NOTE } from '../src/wishlist.js';
import { wantCardHTML, wishlistHTML, noteFormHTML } from '../src/views/wardrobe/wishlist.js';

const custom = { id: 'my:abc', name: 'Mine', brand: 'Me', source: 'custom', accords: [{ name: 'vanilla', width: 100 }] };
const list = () => [
  { id: '124649', added: '2026-10-03' },
  { id: '9828', added: '2026-10-02', note: 'Try it at Nordstrom' },
  { id: 'my:abc', added: '2026-10-01', record: custom },
];

function useStore() {
  const store = new Map();
  globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  return store;
}
afterEach(() => { delete globalThis.localStorage; });

test('a want’s note is set, changed and cleared in its place, with its date and record kept', () => {
  const wants = list();
  const set = noteWant(wants, '124649', 'Wait for the 100 ml under $40');
  assert.deepEqual(set[0], { id: '124649', added: '2026-10-03', note: 'Wait for the 100 ml under $40' });
  assert.deepEqual(set.slice(1), wants.slice(1), 'the others as they were, in their order');
  assert.deepEqual(wants, list(), 'the list given isn’t changed');

  const changed = noteWant(set, 9828, 'Sam’s recommendation'); // an id as a number, as elsewhere
  assert.equal(changed[1].note, 'Sam’s recommendation');
  assert.deepEqual(changed.map(w => [w.id, w.added]), wants.map(w => [w.id, w.added]), 'same places, same dates');

  const kept = noteWant(wants, 'my:abc', 'A sample first');
  assert.deepEqual(kept[2], { id: 'my:abc', added: '2026-10-01', note: 'A sample first', record: custom }, 'a kept record stays');

  for (const empty of ['', '   ', '\n\t', null, undefined, 42]) {
    const cleared = noteWant(wants, '9828', empty);
    assert.deepEqual(cleared[1], { id: '9828', added: '2026-10-02' }, `${JSON.stringify(empty)} takes the note off`);
    assert.ok(!('note' in cleared[1]));
  }
});

test('a note is trimmed to what a stored one keeps, so it reads back the same', () => {
  const store = useStore();
  const long = `  ${'word '.repeat(40)}  `; // 200 characters of words, padded
  const [want] = noteWant([{ id: '1', added: '2026-10-01' }], '1', long);
  assert.ok(want.note.length <= MAX_NOTE);
  assert.equal(want.note, want.note.trim(), 'no space left where the cut fell');
  assert.ok(long.trim().startsWith(want.note));
  saveWants([want]);
  assert.equal(loadWants()[0].note, want.note, 'and the stored list reads it back unchanged');
  assert.equal(noteWant([want], '1', 'x'.repeat(MAX_NOTE + 30))[0].note.length, MAX_NOTE);
  assert.ok(store.has('scentcast.want'));
});

test('a bottle that isn’t on the list leaves it as it was', () => {
  const wants = list();
  assert.deepEqual(noteWant(wants, 'nope', 'A note for nothing'), wants);
  assert.deepEqual(noteWant([], '9828', 'A note'), []);
});

test('saving a note starts from the stored list, so two tabs keep each other’s wants', () => {
  const store = useStore();
  saveWants(list());
  // Another tab adds a want and removes one after this tab drew its list.
  setWant('31861', true, { added: '2026-10-04' });
  setWant('my:abc', false);
  const next = setNote('9828', '  Wait for a sale  ');
  assert.deepEqual(next.map(w => w.id), ['31861', '124649', '9828'], 'the other tab’s want is kept, its removal too');
  assert.equal(next[2].note, 'Wait for a sale');
  assert.deepEqual(loadWants(), next, 'and that’s what’s stored');

  // A note for a want another tab removed saves nothing, and brings nothing back.
  const before = store.get('scentcast.want');
  let writes = 0;
  const { setItem } = globalThis.localStorage;
  globalThis.localStorage.setItem = (k, v) => { writes++; setItem(k, v); };
  assert.deepEqual(setNote('my:abc', 'Too late').map(w => w.id), ['31861', '124649', '9828']);
  assert.equal(writes, 0);
  assert.equal(store.get('scentcast.want'), before);

  assert.ok(!('note' in setNote('9828', ' ').find(w => w.id === '9828')), 'an emptied note is removed');
  assert.ok(!('note' in loadWants().find(w => w.id === '9828')));
});

// ---------- The card ----------

const EVIL = '<img src=x onerror="alert(1)">Rose & Oud\'s "note"';
const check = {
  id: '124649', name: 'Zenith', brand: 'Riiffs', verdict: 'Strong fit', gain: 0.2,
  reasons: ['It would be your best for Date Night on mild nights.', 'Closest to your Cream Velvet.'],
  fills: [{ title: 'Date Night on mild nights', to: 0.87, from: 0.81, first: true, matters: true, beats: { name: 'Amber Empire' } }],
};
const record = { id: '124649', name: 'Zenith', brand: 'Riiffs' };
const item = (note, more = {}) => ({ want: { id: '124649', added: '2026-10-03', ...(note ? { note } : null) }, record, check, today: null, ...more });
const count = (html, text) => html.split(text).length - 1;

test('a card without a note offers Add a note, after I bought it and Remove', () => {
  const html = wantCardHTML(item());
  assert.ok(!html.includes('class="wish-note"'), 'no note drawn');
  assert.match(html, /<button class="btn tertiary compact" data-action="wish-note" data-id="124649">.*?<span>Add a note<span class="visually-hidden"> to Zenith<\/span><\/span><\/button>/);
  assert.ok(html.indexOf('data-action="wish-bought"') < html.indexOf('data-action="wish-remove"'));
  assert.ok(html.indexOf('data-action="wish-remove"') < html.indexOf('data-action="wish-note"'));
  assert.ok(!html.includes('<form'), 'no field until it’s asked for');
});

test('a card with a note shows it under the card’s facts, escaped, with Edit note', () => {
  const html = wantCardHTML(item(EVIL, { today: null }));
  assert.ok(!html.includes(EVIL) && !html.includes('<img src=x'), 'markup in a note is text');
  assert.match(html, /<p class="wish-note"><svg[^]*?<\/svg><span><span class="visually-hidden">Your note: <\/span>&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;Rose &amp; Oud&#39;s &quot;note&quot;<\/span><\/p>/);
  assert.equal(count(html, 'class="wish-note"'), 1);
  const at = text => html.indexOf(text);
  // Verdict, reasons and what it fills first; then the note, then the actions.
  assert.ok(at('class="verdict"') < at('wish-reasons') && at('wish-reasons') < at('Would fill') && at('Would fill') < at('class="wish-note"'));
  assert.ok(at('class="wish-note"') < at('class="action-row"'));
  assert.match(html, /data-action="wish-note" data-id="124649">.*?<span>Edit note<span class="visually-hidden"> on Zenith<\/span><\/span>/);
  assert.ok(!html.includes('Add a note'));
});

test('a want you own keeps its note, with nothing to edit', () => {
  const owned = wantCardHTML(item('Brooke said to try it', { check: undefined, owned: 'In David’s' }));
  assert.match(owned, /<span class="visually-hidden">Your note: <\/span>Brooke said to try it<\/span><\/p>/);
  assert.ok(!owned.includes('data-action="wish-note"') && !owned.includes('<form'));
  assert.match(owned, /data-action="wish-remove"/);
  // Nor does a draft left open draw a field on it.
  assert.ok(!wantCardHTML(item('Brooke said to try it', { check: undefined, owned: 'In David’s' }), { noting: { draft: 'x' } }).includes('<form'));
});

test('writing a note draws a labelled field with the note’s limit in place of the card’s actions', () => {
  const html = wantCardHTML(item('Try it at Nordstrom'), { noting: { draft: EVIL } });
  assert.ok(!html.includes(EVIL) && !html.includes('<img src=x'), 'a draft is escaped in the field');
  assert.match(html, /<form class="wish-note-form" novalidate>/);
  assert.match(html, /<label class="name-field">\s*<span>Note<span class="visually-hidden"> on Zenith<\/span><\/span>\s*<input type="text" id="wish-note-field" name="note" data-id="124649" value="&lt;img[^"]*" maxlength="140"/);
  assert.equal(MAX_NOTE, 140);
  assert.match(html, /aria-describedby="wish-note-hint"/);
  assert.match(html, /<p class="wish-note-hint" id="wish-note-hint">[^<]*Up to 140 characters\.<\/p>/);
  // Enter clicks the form's own button, so Save is its submit; Cancel isn't.
  assert.match(html, /<button type="submit" class="btn primary compact" data-action="wish-note-save" data-id="124649">.*?Save<span class="visually-hidden"> the note on Zenith<\/span>/);
  assert.match(html, /<button type="button" class="btn tertiary compact" data-action="wish-note-cancel" data-id="124649">Cancel<\/button>/);
  // The field stands in for the note and the actions, under the same facts.
  assert.ok(!html.includes('class="wish-note"') && !html.includes('wish-bought') && !html.includes('wish-remove') && !html.includes('data-action="wish-note"'));
  assert.ok(html.indexOf('Would fill') < html.indexOf('<form'));
  assert.match(noteFormHTML('9', 'Aventus'), /value="" maxlength="140"/, 'a new note starts empty');
});

test('the pane opens one card’s field, and the list’s status line says what a save did', () => {
  const other = { want: { id: '9828', added: '2026-10-02', note: 'Try it at Nordstrom' }, record: { id: '9828', name: 'Aventus', brand: 'Creed' }, check: { ...check, id: '9828', name: 'Aventus', verdict: 'Good' }, today: null };
  const plain = wishlistHTML({ items: [item(), other] });
  assert.ok(!plain.includes('<form'));
  assert.match(plain, /role="status" id="wish-live" data-say="2 bottles: 1 strong fit, 1 good\."/);
  const editing = wishlistHTML({ items: [item(), other], noting: { id: '9828', draft: 'Try it at Nordstrom' } });
  assert.equal(count(editing, '<form class="wish-note-form"'), 1);
  assert.match(editing, /id="wish-note-field" name="note" data-id="9828" value="Try it at Nordstrom"/);
  assert.match(editing, /data-action="wish-note" data-id="124649"/, 'the other card keeps its actions');
  const saved = wishlistHTML({ items: [item('Wait for a sale'), other], said: `Note saved on Zenith: “${EVIL}”` });
  assert.ok(!saved.includes(EVIL), 'a note read back is escaped too');
  assert.match(saved, /role="status" id="wish-live" data-say="Note saved on Zenith: “&lt;img[^"]*”"/);
  assert.equal(count(saved, 'role="status"'), 1, 'one status line, the list’s');
  assert.match(saved, /<p class="muted small wish-status">2 bottles: 1 strong fit, 1 good\.<\/p>/, 'the line on screen is the list’s, as it was');
});
