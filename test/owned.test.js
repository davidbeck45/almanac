// Wardrobe › Owned's sorts and the fact each row shows: which orders a list
// offers, the order each gives, the row's words and the template. Pure, with
// dates given, so they pass on any day.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as wardrobe from '../src/views/wardrobe.js';

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
  assert.equal(namesIn(wardrobe.sortOwned(shelf, 'fit', by)), 'Liam, Sauvage, Aristo, Jake', 'the pick, the ranking, then a bottle switched off with no score of its own');
  const out = score => ({ ...by, fit: { ...tonight, out: [entryOf(shelf[3], score)] } });
  assert.equal(namesIn(wardrobe.sortOwned(shelf, 'fit', out(0.87))), 'Liam, Sauvage, Jake, Aristo', 'switched off, it stands where its score would put it');
  assert.equal(namesIn(wardrobe.sortOwned(shelf, 'fit', out(0.99))), 'Liam, Jake, Sauvage, Aristo', 'never over Now’s pick');
  assert.equal(namesIn(wardrobe.sortOwned(shelf, 'fit', out(0.1))), 'Liam, Sauvage, Aristo, Jake');
  assert.equal(wardrobe.ownedFact(shelf[3], 'fit', out(0.87)).text, '87% tonight · left out');
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
