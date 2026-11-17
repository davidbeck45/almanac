// The note glossary (src/notes.js): what a note is and how it smells, for
// the bottle page's Notes. Coverage over the data, and the names that trip a
// first-match table.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { noteInfo, sameNote, glossaryRows, familyLines } from '../src/notes.js';
import { noteFamily } from '../src/layering.js';

const read = path => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const listOf = path => { const d = read(path); return Array.isArray(d) ? d : Object.values(d).find(Array.isArray); };
const notesOf = list => [...new Set(list.flatMap(f => Object.values(f.notes ?? {}).flat()))];

test('every note in the wardrobe, catalog and originals says something', () => {
  for (const file of ['collection', 'catalog', 'originals']) {
    for (const note of notesOf(listOf(`data/${file}.json`))) assert.ok(noteInfo(note), `${file}: ${note}`);
  }
});

test('the glossary names nine in ten of the wardrobe’s notes, and of the pool’s strongest-8 slots', () => {
  const own = notesOf(listOf('data/collection.json'));
  const named = own.filter(n => !noteInfo(n).general);
  assert.ok(named.length / own.length >= 0.9, `${named.length} of ${own.length}: ${own.filter(n => noteInfo(n).general).join(', ')}`);
  const pool = read('data/fragrantica/pool-notes.json');
  let slots = 0, exact = 0, any = 0;
  for (const row of pool.no) {
    for (let i = 0; i < row.length; i += 2) {
      const info = noteInfo(pool.notes[row[i] >> 2]);
      slots++;
      if (info) any++;
      if (info && !info.general) exact++;
    }
  }
  assert.ok(exact / slots >= 0.95, `named ${(exact / slots * 100).toFixed(1)}%`);
  assert.ok(any / slots >= 0.995, `anything ${(any / slots * 100).toFixed(2)}%`);
});

test('a specific name wins over the word it contains', () => {
  const pairs = {
    'Orange Blossom': 'Orange blossom', 'African Orange Flower': 'Orange blossom', 'Blood Orange': 'Orange', 'Bitter Orange': 'Bitter orange',
    'Pink Pepper': 'Pink pepper', 'Black Pepper': 'Pepper', Peppermint: 'Mint', 'Sichuan Pepper': 'Sichuan pepper',
    Oakmoss: 'Oakmoss', 'oak moss': 'Oakmoss', Oak: 'Oak', Rosemary: 'Rosemary', 'Brazilian Rosewood': 'Rosewood', 'Bulgarian Rose': 'Rose', Tuberose: 'Tuberose',
    Pineapple: 'Pineapple', 'Pine Tree': 'Pine and fir', 'Balsam Fir': 'Pine and fir', 'Peru Balsam': 'Balsam', 'Green Apple': 'Apple',
    Honeysuckle: 'Honeysuckle', Honey: 'Honey', 'Lily-of-the-Valley': 'Lily of the valley', 'Water Lily': 'Water lily and lotus', Lily: 'Lily',
    'Violet Leaf': 'Violet leaf', Violet: 'Violet', 'Tobacco Leaf': 'Tobacco', 'Fig Leaf': 'Fig', 'Cherry Blossom': 'Cherry blossom', Cherry: 'Cherry',
    'White Musk': 'White musk', Musk: 'Musk', 'Ambrette (Musk Mallow)': 'Ambrette', Ambroxan: 'Ambroxan', Ambergris: 'Ambergris', Amberwood: 'Amberwood', Amber: 'Amber',
    'Bourbon Vanilla': 'Vanilla', 'Madagascar Vanilla': 'Vanilla', 'Bourbon Vetiver': 'Vetiver', Whiskey: 'Spirits', Rum: 'Rum',
    'Coconut Milk': 'Coconut', Milk: 'Milk and cream', Cashmeran: 'Cashmere wood', 'Cashmere Wood': 'Cashmere wood', 'Virginia Cedar': 'Cedar', Cedarwood: 'Cedar',
    'Agarwood (Oud)': 'Oud', 'Guaiac Wood': 'Guaiac wood', 'Woody Notes': 'Woods', 'Green Tea': 'Tea', 'Tea Rose': 'Rose', Mate: 'Maté',
    'Calabrian bergamot': 'Bergamot', Orris: 'Iris', 'Sea Salt': 'Salt', 'Sea Notes': 'Marine notes', Watermelon: 'Melon', Grapefruit: 'Grapefruit', Cassis: 'Blackcurrant', Cassia: 'Cinnamon',
    Olibanum: 'Frankincense', Incense: 'Incense', Tonka: 'Tonka bean', Cloves: 'Clove', Licorice: 'Anise and licorice', Rice: 'Rice',
  };
  for (const [note, name] of Object.entries(pairs)) assert.equal(noteInfo(note)?.name, name, note);
});

test('a note outside the glossary reads as its family, and one nothing places as null', () => {
  const info = noteInfo('Mahogany');
  assert.equal(info.general, true);
  assert.equal(info.family, noteFamily('Mahogany'));
  assert.match(info.label, /^an? /);
  assert.equal(noteInfo('Tennis Ball'), null);
  assert.equal(noteInfo(''), null);
  assert.equal(noteInfo(null), null);
});

test('two names of one material are the same note; two notes of one family aren’t', () => {
  assert.ok(sameNote('Bourbon Vanilla', 'Vanilla'));
  assert.ok(sameNote('Oak Moss', 'Oakmoss'));
  assert.ok(sameNote('Mahogany', 'mahogany'));
  assert.ok(!sameNote('Mahogany', 'Ebony'), 'both only “a woody note”');
  assert.ok(!sameNote('Orange', 'Orange Blossom'));
});

test('every row matches its own name, reads as sentences and holds no temperature', () => {
  const rows = glossaryRows();
  assert.equal(new Set(rows.map(r => r.name)).size, rows.length, 'names are unique');
  for (const r of rows) {
    assert.equal(noteInfo(r.name)?.name ?? noteInfo(r.name.split(' and ')[0])?.name, r.name, `${r.name} finds its own row`);
    for (const text of [r.what, r.smell]) {
      assert.match(text, /^[A-Z“].*\.$/, `${r.name}: ${text}`);
      assert.ok(!/\d\s?°|degrees/.test(text), r.name);
      assert.ok(text.length <= 220, `${r.name} is short enough for a phone: ${text.length}`);
    }
    assert.ok(r.kind && r.kind.length <= 20, r.name);
  }
});

test('every family layering can give a note has a line', () => {
  const src = readFileSync(new URL('../src/layering.js', import.meta.url), 'utf8');
  const table = src.slice(src.indexOf('const NOTE_FAMILIES'), src.indexOf('\n];', src.indexOf('const NOTE_FAMILIES')));
  const families = new Set([...table.matchAll(/\], '([a-z ]+)'|, '([a-z ]+)'/g)].map(m => m[1] ?? m[2]));
  assert.ok(families.size > 30);
  for (const f of families) assert.ok(familyLines()[f], f);
});
