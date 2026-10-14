import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importLines, localMatches, nameMatches, parseShare, shareURL, loadMine, usableRecord } from '../src/collections.js';
import { customRecord, fromShareToken } from '../src/custom.js';

const catalog = JSON.parse(readFileSync(new URL('../data/catalog.json', import.meta.url))).fragrances;
const demo = JSON.parse(readFileSync(new URL('../data/collection.json', import.meta.url))).fragrances;

// A list as it was actually pasted: indie brands, "by", a curly apostrophe.
const PASTED = `Bo by Liis

Pear Pavlova by French Cowboy

Mango Sticky Rice by D’annam

Mooncake by D’annam

Bois Impérial by Essential Parfums

Vanilla for Breakfast by French Cowboy

Daddy by Universal Flowering

Coney Island Baby by Scout Dixon West

Caramellino by Litoralle Aromatica

Warm Bulb by Clue`;

test('pasted lines split into a search query and a name and brand', () => {
  assert.deepEqual(importLines('1. Pear Pavlova by French Cowboy 50ml'),
    [{ line: 'Pear Pavlova French Cowboy', name: 'Pear Pavlova', brand: 'French Cowboy' }]);
  assert.deepEqual(importLines('- Dior - Sauvage 100 ml'), [{ line: 'Dior Sauvage', name: 'Dior Sauvage', brand: '' }]);
});

test('pasted lines past the first fifteen are counted, not dropped unseen', () => {
  const text = Array.from({ length: 18 }, (_, i) => `Bottle number ${i + 1}`).join('\n');
  assert.equal(importLines(text).length, 15);
  assert.equal(importLines(text, Infinity).length, 18, 'Paste a list says how many wait for the next round');
});

test('the catalog finds the pasted indie bottles offline', () => {
  const found = importLines(PASTED).map(l => localMatches(l.line, [...demo, ...catalog], 1)[0]);
  assert.deepEqual(found.map(f => f && `${f.name} · ${f.brand}`), [
    'Bo · Liis',
    'Pear Pavlova · French Cowboy',
    'Mango Sticky Rice · d\'Annam',
    'Mooncake · d\'Annam',
    'Bois Impérial · Essential Parfums',
    'Vanilla for Breakfast · French Cowboy',
    'Daddy · Universal Flowering',
    'Coney Island Baby · Scout Dixon West',
    undefined, // not on Fragrantica: added by hand
    'Warm Bulb · Clue Perfumery',
  ]);
});

test('catalog records split name from brand and have usable votes', () => {
  for (const f of catalog) {
    assert.ok(!f.name.toLowerCase().endsWith(f.brand.toLowerCase()), `${f.name} still ends with its brand`);
    assert.ok(f.seasonVotes && Object.values(f.seasonVotes).reduce((a, b) => a + b) >= 50, `${f.name} has too few season votes`);
  }
  assert.ok(!catalog.some(c => demo.some(d => d.id === c.id)), 'catalog repeats a demo bottle');
});

test('a fuzzy search hit counts only when its name was typed', () => {
  assert.ok(nameMatches('Dior Sauvage', { name: 'Sauvage' }));
  assert.ok(nameMatches('Supremacy Collectors Edition', { name: "Supremacy Collector's Edition" }));
  assert.ok(!nameMatches('Liquid Brun', { name: 'Liquid Illusion' }));
  assert.ok(!nameMatches('Caramellino Litoralle Aromatica', { name: 'Caramello' }));
});

test('share links carry hand-entered bottles alongside catalog ids', () => {
  globalThis.location = { origin: 'https://example.test', pathname: '/scentcast/' };
  const mine = customRecord({ name: 'Caramellino', brand: 'Litoralle Aromatica', accords: ['caramel', 'vanilla'] });
  const url = new URL(shareURL([catalog[0], mine], 'Sis'));
  const link = parseShare(url.searchParams);
  assert.equal(link.name, 'Sis');
  assert.equal(link.ids[0], catalog[0].id.toString());
  assert.equal(fromShareToken(link.ids[1]).name, 'Caramellino');
});

test('Mine keeps only records it can rank, whatever was stored', () => {
  const store = new Map();
  globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  try {
    const good = customRecord({ name: 'Lone', accords: ['woody'] });
    for (const stored of [{ records: 'x' }, { records: [null] }, { records: [{ id: 'my:abc', name: 'Lone' }] }, [1, 2], 'x', null]) {
      store.set('scentcast.mine', JSON.stringify(stored));
      assert.deepEqual(loadMine().records, [], JSON.stringify(stored));
    }
    store.set('scentcast.mine', JSON.stringify({ name: 'Me', records: [good, { ...demo[0] }, { id: 7, name: 7 }] }));
    const mine = loadMine();
    assert.deepEqual(mine.records.map(r => r.name), ['Lone', demo[0].name]);
    assert.equal(mine.records[1].id, String(demo[0].id), 'ids as strings, as the app keeps them');
    assert.equal(mine.name, 'Me');
    assert.ok(catalog.every(usableRecord) && demo.every(usableRecord));
  } finally {
    delete globalThis.localStorage;
  }
});
