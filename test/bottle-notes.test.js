// The bottle page's Notes (src/views/bottle-notes.js): each note a button,
// and what an open one says, from the glossary (src/notes.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as lib from '../src/notes.js';
import { SECTIONS } from '../src/views/bottle.js';
import '../src/views/sections.js';
import { notesHTML, noteAboutHTML, noteStanding, alsoIn } from '../src/views/bottle-notes.js';

const { fragrances } = JSON.parse(readFileSync(new URL('../data/collection.json', import.meta.url), 'utf8'));
const byName = name => fragrances.find(f => f.name === name);
const f = {
  id: '7', name: 'Test', notes: { top: ['Calabrian bergamot', 'Pink Pepper'], mid: ['Mahogany'], base: ['Vanilla', 'Tennis Ball', 'Musk'] },
  noteVotes: { 'Calabrian bergamot': 100, 'Pink Pepper': 70, Mahogany: 40, Vanilla: 20, Musk: 30 },
};

test('the section is registered once, where the pyramid always was', () => {
  const s = SECTIONS.filter(x => x.id === 'notes');
  assert.equal(s.length, 1);
  assert.deepEqual([s[0].order, s[0].shopOrder], [700, 370]);
  assert.ok(s[0].actions['note-about']);
});

test('every note is a button that says whether it’s open, and a closed section invites a tap', () => {
  const html = notesHTML({ f });
  assert.equal((html.match(/<button type="button" class="note-chip"/g) ?? []).length, 6);
  assert.equal((html.match(/aria-expanded="false"/g) ?? []).length, 6);
  assert.match(html, /data-action="note-about" data-id="7" data-note="Pink Pepper"/);
  assert.match(html, /Tap a note to see what it is/);
  assert.ok(!html.includes('bp-note-about'));
  assert.equal(notesHTML({ f: { id: '1', notes: {} } }), '');
});

test('an open note marks its chip and shows what it is, how it smells and where it sits', () => {
  const html = notesHTML({ f }, { open: 'Calabrian bergamot', lib });
  assert.match(html, /class="note-chip on"[^>]*data-note="Calabrian bergamot"[^>]*aria-expanded="true" aria-controls="bp-note-about"/);
  assert.equal((html.match(/aria-expanded="true"/g) ?? []).length, 1);
  assert.ok(!html.includes('Tap a note'));
  assert.match(html, /<h4 id="bp-note-name">Bergamot<\/h4><span class="note-kind">Citrus fruit<\/span>/);
  assert.match(html, /Listed here as Calabrian bergamot\./);
  assert.match(html, /<dt>What it is<\/dt><dd>[^<]*Calabria/);
  assert.match(html, /<dt>How it smells<\/dt><dd>Bright/);
  assert.match(html, /A top note here: what you smell in the first minutes\. Voters smell it most of all in this bottle\./);
  assert.match(html, /href="#\/discover\?q=calabrian(%20|\+)bergamot"/);
  // A note that isn't this bottle's opens nothing.
  assert.ok(!notesHTML({ f }, { open: 'Leather', lib }).includes('bp-note-about'));
});

test('where a note sits and how voters rate it there', () => {
  assert.deepEqual(noteStanding(f, 'pink pepper'), { tier: 'top', share: 0.7, voted: 5 });
  assert.match(noteAboutHTML(f, 'Pink Pepper', { lib }), /One of the notes voters smell most here\./);
  assert.match(noteAboutHTML(f, 'Vanilla', { lib }), /A base note here: what stays on skin for hours\. Few voters pick it out here\./);
  assert.ok(!/voters/i.test(noteAboutHTML(f, 'Musk', { lib })), 'in the middle: nothing to say');
  assert.ok(!/voters/i.test(noteAboutHTML({ ...f, noteVotes: undefined }, 'Vanilla', { lib })));
  assert.ok(!noteAboutHTML({ id: '1', notes: { all: ['Vanilla'] } }, 'Vanilla', { lib }).includes('In this bottle'), 'a flat list has no layer');
});

test('a note outside the glossary reads as its family, one nothing places says so, and both keep the way into Discover', () => {
  const general = noteAboutHTML(f, 'Mahogany', { lib });
  assert.match(general, /<h4 id="bp-note-name">Mahogany<\/h4>/);
  assert.match(general, /It’s a woody note\. Dry, warm and solid\./);
  assert.ok(!general.includes('What it is'));
  const none = noteAboutHTML(f, 'Tennis Ball', { lib });
  assert.match(none, /There’s no description of this one yet\./);
  assert.match(none, /A base note here/);
  for (const html of [general, none]) assert.match(html, /class="link-btn note-find" href="#\/discover\?q=[^"]+">Find bottles with /);
});

test('while the glossary loads the panel says so, and when it didn’t arrive it says that', () => {
  assert.match(noteAboutHTML(f, 'Vanilla', {}), /aria-busy="true"[^]*Looking it up/);
  assert.match(noteAboutHTML(f, 'Vanilla', { lib: null }), /didn’t load/);
  assert.ok(!noteAboutHTML(f, 'Vanilla', { lib: null }).includes('aria-busy'));
});

test('the other bottles of yours with the note are named, by the glossary’s reading, three at most', () => {
  const liam = byName('Liam') ?? fragrances[0];
  const note = Object.values(liam.notes).flat().find(n => /vanilla/i.test(n)) ?? Object.values(liam.notes).flat()[0];
  const also = alsoIn(liam, note, fragrances, lib.sameNote);
  assert.ok(also.length && !also.includes(liam));
  for (const o of also) assert.ok(Object.values(o.notes).flat().some(n => lib.sameNote(n, note)), o.name);
  const html = noteAboutHTML(liam, note, { lib, owned: fragrances });
  const links = html.match(/class="link-btn" data-action="open" data-id="/g) ?? [];
  assert.equal(links.length, Math.min(3, also.length));
  assert.match(html, /<p class="note-also">Also in your /);
  if (also.length > 3) assert.match(html, new RegExp(` and ${also.length - 3} more\\.</p>`));
  assert.ok(!noteAboutHTML(f, 'Tennis Ball', { lib, owned: fragrances }).includes('note-also'));
});

test('names and notes are escaped', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const html = notesHTML({ f: { id: evil, notes: { all: [evil] } } }, { open: evil, lib, owned: [{ id: '2', name: evil, notes: { all: [evil] } }] });
  assert.ok(!html.includes('<img'));
});

test('every note of every wardrobe bottle opens with something to say', () => {
  for (const b of fragrances) {
    for (const note of Object.values(b.notes ?? {}).flat()) {
      const html = notesHTML({ f: b }, { open: note, lib, owned: fragrances });
      assert.match(html, /How it smells/, `${b.name}: ${note}`);
    }
  }
});
