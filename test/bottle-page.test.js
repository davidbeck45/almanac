// The bottle page's sections in their own modules (src/views/bottle-*.js)
// and the compare page (src/views/compare.js): every template renders clean
// with a hostile bottle name, empty data renders nothing (or a skeleton while
// it loads), owned and not-owned bottles get the sections that fit them, and
// the compare route parses and round-trips.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SECTIONS, bottlePageHTML, pooled } from '../src/views/bottle.js';
import { state } from '../src/app/state.js';
import '../src/views/sections.js';
import { buyCheckHTML, checkable } from '../src/views/bottle-check.js';
import { sprayHTML, figureSVG } from '../src/views/bottle-spray.js';
import { skinHTML, moveText, listLabel, ordinal } from '../src/views/bottle-skin.js';
import { stylesHTML } from '../src/views/bottle-styles.js';
import { dupesHTML } from '../src/views/bottle-dupes.js';
import { crowdHTML } from '../src/views/bottle-crowd.js';
import { reviewsHTML } from '../src/views/bottle-reviews.js';
import { compareHTML, relation, pickerLists, pickerHTML, MAX_COMPARE } from '../src/views/compare.js';
import { parseRoute, routeHash, compareIds } from '../src/app/router.js';
import { rank, comfortRange } from '../src/engine.js';
import { occasionById } from '../src/occasions.js';
import { summarize } from '../src/weather.js';
import { esc } from '../src/ui.js';
import { syntheticForecast } from './fixtures.js';

const { fragrances } = JSON.parse(readFileSync(new URL('../data/collection.json', import.meta.url)));
for (const f of fragrances) f.id = String(f.id);
const byName = name => fragrances.find(f => f.name === name);

const EVIL = '<img src=x onerror="alert(1)">Rose & Oud\'s';
const evil = { ...byName("Supremacy Collector's Edition Pour Homme"), name: EVIL, brand: EVIL };
evil.about = { ...evil.about, perfumers: [EVIL], line: EVIL, pros: [{ text: EVIL, up: 12, down: 1 }], cons: [{ text: EVIL, up: 3, down: 0 }] };

const wx = summarize(syntheticForecast(7), Date.parse('2026-09-28T16:00:00Z'));
const ranked = rank([evil, ...fragrances.slice(1)], wx.night, 'night', { history: [], todayISO: wx.night.dateISO });

function clean(html, what) {
  assert.ok(!/\bundefined\b|\bNaN\b|\[object Object\]/.test(html), `${what} renders undefined, NaN or an object`);
  assert.ok(!html.includes(EVIL) && !html.includes('onerror="alert'), `${what} lets a name through unescaped`);
  return html;
}

// A bottle page's model, as src/views/bottle.js bottleModel builds it.
const modelOf = (f, extra = {}) => ({
  f,
  entry: ranked.find(r => r.fragrance.id === f.id) ?? null,
  solo: false,
  win: wx.night,
  ctx: 'night',
  ctxLabel: 'Tonight',
  occasion: null,
  owned: true,
  active: true,
  inMine: false,
  worn: null,
  canWear: true,
  wears: { count: 1, last: '2026-09-27' },
  todayISO: '2026-09-28',
  alts: [],
  partners: null,
  comfort: comfortRange(f),
  about: undefined,
  wanted: false,
  skin: null,
  ...extra,
});

// A pool record for a bottle nobody owns.
const stranger = {
  ...byName('Liquid Brun'), id: '9828', name: EVIL, brand: EVIL, about: undefined, original: null, source: 'fragrantica',
};

// ---------- The registry ----------

test('the sections take their slots in the page', () => {
  const order = Object.fromEntries(SECTIONS.map(s => [s.id, s.order]));
  assert.deepEqual(
    { check: order.check, spray: order.spray, skin: order.skin, styles: order.styles, dupes: order.dupes, crowd: order.crowd, reviews: order.reviews },
    { check: 170, spray: 250, skin: 260, styles: 350, dupes: 450, crowd: 470, reviews: 550 },
  );
  const orders = SECTIONS.map(s => s.order);
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b));
});

test('a whole page renders clean, owned or not', () => {
  const owned = clean(bottlePageHTML(modelOf(evil, { skin: { rating: 4, longevity: 1, sillage: 0 } })), 'an owned bottle');
  assert.match(owned, /On my skin/);
  assert.match(owned, /How much to spray/);
  assert.match(owned, /What voters say/);
  assert.match(owned, /Pros and cons/);
  assert.ok(!owned.includes('For David'), 'no buy check for a bottle you own');
  assert.match(owned, /data-action="bp-compare"/, 'Compare is among the actions');
  assert.ok(!owned.includes('data-action="bp-want"'), 'no Want for a bottle you own');

  const other = clean(bottlePageHTML(modelOf(stranger, { owned: false, active: false, entry: null, solo: true, wanted: true })), 'a bottle you don’t own');
  assert.ok(!other.includes('On my skin'), 'no skin section for a bottle you don’t own');
  assert.match(other, /data-action="bp-want" data-id="9828" aria-pressed="true"/, 'Want shows as on');
  assert.match(other, /aria-busy="true"/, 'the pool-backed sections show a skeleton until they’re asked');
});

// ---------- Pool answers ----------

test('a section asks the pool once per bottle and wardrobe, and draws the page when the answer lands', async () => {
  // In Node the pool can't load its files, so the answer is an error: the path a phone offline takes.
  state.route = { dest: 'bottle', arg: '9828', query: {} };
  let renders = 0;
  const app = { renderBottle: () => renders++ };
  const answers = pooled('dupes', 'test-dupes', m => (m.f.id.startsWith('my:') ? null : { id: m.f.id }));
  assert.equal(answers.get('9828'), undefined, 'nothing until it’s asked');
  await answers.ask({ f: { id: '9828' } }, app);
  assert.notEqual(answers.get('9828').status, 'loading');
  assert.equal(renders, 1, 'the page draws again with the answer');
  await answers.ask({ f: { id: '9828' } }, app);
  assert.equal(renders, 1, 'the same inputs don’t ask again');
  answers.forget('9828');
  assert.equal(answers.get('9828'), undefined, 'Try again forgets it');
  await answers.ask({ f: { id: 'my:1' } }, app);
  assert.equal(answers.get('my:1'), undefined, 'nothing to ask, nothing kept');
  state.route = { dest: 'wear', pane: 'now', arg: null, query: {} };
  await answers.ask({ f: { id: '9828' } }, app);
  assert.equal(renders, 1, 'a page no longer on screen isn’t drawn');
  state.route = null;
});

// ---------- Buy check ----------

const check = {
  verdict: 'Strong fit',
  reasons: [`It would be your best for ${EVIL}.`, `Closest to your ${EVIL}.`, `${EVIL} by ${EVIL} smells like it, for far less.`],
  fills: ['a', 'b', 'c', 'd', 'e'].map((x, i) => ({ title: `${EVIL} ${x}`, first: i === 0 })),
  overlap: { id: '1', name: EVIL, sim: 0.62, link: null, via: null, record: { ...evil, id: '1' } },
  twin: { id: '34696', name: EVIL, value: 4.32, owned: false, text: `${EVIL} by ${EVIL} smells like it, for far less.`, record: { ...evil, id: '34696' } },
};

test('the buy check: nothing for a bottle you own, a skeleton until it answers, its verdict once it does', () => {
  const m = modelOf(stranger, { owned: false });
  assert.equal(buyCheckHTML(modelOf(evil), { status: 'ready', result: check }), '', 'owned');
  assert.equal(buyCheckHTML({ ...m, inMine: true }, undefined), '', 'in Mine');
  assert.equal(buyCheckHTML(modelOf({ ...stranger, id: 'my:x', accords: {} }, { owned: false }), undefined), '', 'nothing to judge it by');
  assert.ok(checkable({ id: 'my:x', accords: { woody: 80 } }), 'a hand-entered bottle with accords can be checked');

  assert.match(clean(buyCheckHTML(m, undefined), 'loading'), /aria-busy="true"/);
  const error = clean(buyCheckHTML(m, { status: 'error', error: EVIL }), 'error');
  assert.match(error, /data-action="bp-check-retry" data-id="9828"/);
  assert.ok(error.includes(esc(EVIL)));

  const html = clean(buyCheckHTML(m, { status: 'ready', result: check }, { who: 'David’s wardrobe', wants: [{ id: '34696' }] }), 'ready');
  assert.match(html, /For David’s wardrobe/);
  assert.match(html, /class="verdict" data-tone="strong">Strong fit/);
  assert.equal((html.match(/smells like it, for far less/g) ?? []).length, 0, 'the twin’s line isn’t repeated as a reason');
  assert.equal((html.match(/class="fill-chip( first)?"/g) ?? []).length, 4, 'at most four fills');
  assert.match(html, /1 more/);
  assert.match(html, /Closest you own · 62% alike/);
  assert.match(html, /data-action="bp-want" data-id="34696" aria-pressed="true"/, 'the twin can be wanted, and shows that it is');
  assert.match(html, /data-action="open" data-ctx="night" data-id="34696"/, 'the twin opens its page');

  const covered = buyCheckHTML(m, { status: 'ready', result: { ...check, verdict: 'Covered', fills: [], overlap: null, twin: null } }, { who: 'My collection' });
  assert.match(covered, /data-tone="neutral">Covered/, 'a verdict it doesn’t know reads neutral');
  assert.match(covered, /For your collection/);
  const linked = buyCheckHTML(m, { status: 'ready', result: { ...check, overlap: { ...check.overlap, link: `Voters call it a twin of ${EVIL}` } } });
  assert.match(clean(linked, 'linked'), /Voters link them · 62% alike/, 'the row doesn’t repeat the reason');
  assert.ok(!covered.includes('bc-rows'));
  assert.match(buyCheckHTML(m, { status: 'loading', result: check }), /bc-card refreshing/, 'asked again, the old answer dims');
});

// ---------- Spray ----------

test('the spray guide counts sprays, lights the spots and says why', () => {
  const html = clean(sprayHTML(modelOf(evil)), 'spray');
  assert.match(html, /class="spray-count">\d(–\d)? sprays?</);
  assert.match(html, /class="spot"/);
  assert.match(html, /h3-aside">Tonight</);
  assert.ok(!/\d+°/.test(html), 'no temperatures');
  assert.equal(sprayHTML(modelOf({ ...evil, accords: {} })), '');
  const office = sprayHTML(modelOf(evil, { occasion: occasionById('office') }));
  assert.match(office, /Office · tonight/);
  const sky = byName('Shiyaaka Sky');
  const louder = sprayHTML(modelOf(sky, { skin: { rating: null, longevity: 0, sillage: 1 } }));
  assert.match(louder, /projects more on you/i, 'your skin nudges change the advice');
  assert.notEqual(louder, sprayHTML(modelOf(sky)));
  assert.equal((figureSVG(['wrists']).match(/class="spot"/g) ?? []).length, 2, 'both wrists');
  assert.match(figureSVG(['collar or scarf']), /spot hollow/);
});

// ---------- On my skin ----------

test('on my skin: stars, nudges and where the bottle moved', () => {
  assert.equal(skinHTML(modelOf(stranger, { owned: false })), '');
  const html = clean(skinHTML(modelOf(evil, { skin: { rating: 3, longevity: -1, sillage: 1 } }), `Now 2nd ${EVIL}`), 'skin');
  assert.equal((html.match(/role="radio"/g) ?? []).length, 5);
  assert.match(html, /aria-checked="true" tabindex="0" data-action="bp-skin-rate" data-value="3"/);
  assert.equal((html.match(/class="star lit"/g) ?? []).length, 3);
  assert.match(html, /data-action="bp-skin-clear"/);
  assert.match(html, /data-action="bp-skin-lasts" data-value="-1" aria-pressed="true"/);
  assert.match(html, /data-action="bp-skin-projects" data-value="1" aria-pressed="true"/);
  const unrated = skinHTML(modelOf(evil));
  assert.ok(!unrated.includes('bp-skin-clear'));
  assert.match(unrated, /tabindex="0" data-action="bp-skin-rate" data-value="1"/, 'one tab stop, on the first star');
  assert.match(unrated, /bp-skin-lasts" data-value="0" aria-pressed="true"/, 'as expected until told otherwise');

  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd']);
  assert.equal(moveText(1, 3, 'for tonight'), 'Now 3rd for tonight, was 1st.');
  assert.equal(moveText(2, 2, 'for tonight'), 'Still 2nd for tonight.');
  assert.equal(moveText(1, null, 'for tonight'), '');
  assert.equal(listLabel(wx.night, null), 'for tonight');
  assert.equal(listLabel(wx.night, occasionById('date')), 'for date night tonight');
  assert.equal(listLabel({ label: 'Friday night' }, null), 'for Friday night');
});

// ---------- Styles ----------

test('styles link to Discover, and a quiet bottle says it wears close', () => {
  const skin = stylesHTML(modelOf(byName('Sandalwood & Musk')));
  assert.match(skin, /href="#\/discover\?styles=skin"/);
  assert.match(skin, /Skin scent/);
  const close = stylesHTML(modelOf(byName('Shiyaaka Sky')));
  assert.match(close, /Wears close/);
  assert.match(close, /href="#\/discover\?styles=intimate"/);
  assert.equal(stylesHTML(modelOf({ ...evil, accords: {} })), '');
  assert.deepEqual(parseRoute('#/discover?styles=skin,clean', { discover: [] }).query, { styles: 'skin,clean' }, 'the router keeps the styles');
  clean(stylesHTML(modelOf(evil)), 'styles');
});

// ---------- Smells like ----------

const entry = (id, extra = {}) => ({
  id, record: { ...evil, id }, name: EVIL, brand: EVIL, value: 4.1, rating: 4.2, votes: 900, risk: { level: 'low', reasons: [] },
  sim: 0.8, owned: false, up: 1200, down: 30, why: 'votes', ...extra,
});

test('smells like: the original, cheaper twins and siblings, each opening its page or a comparison', () => {
  const m = modelOf(stranger, { owned: false });
  assert.match(clean(dupesHTML(m, undefined), 'loading'), /aria-busy="true"/);
  assert.match(clean(dupesHTML(m, { status: 'error', error: EVIL }), 'error'), /data-action="bp-dupes-retry"/);
  assert.equal(dupesHTML(m, { status: 'ready', result: { original: null, cheaper: [], siblings: [] } }), '', 'nobody smells like it');
  assert.equal(dupesHTML(modelOf({ ...evil, id: 'my:x', accords: {} }), undefined), '', 'nothing to compare by');

  const result = {
    // The build's summary of an owned dupe's original has no accords.
    original: { ...entry('84112'), record: { id: 84112, name: EVIL, brand: EVIL, thumb: null }, built: true },
    cheaper: [entry('1'), entry('2', { why: 'notes', up: null, down: null }), entry('3'), entry('4'), entry('5')],
    siblings: [entry('6', { owned: true, risk: { level: 'high', reasons: [] } })],
  };
  const html = clean(dupesHTML(m, { status: 'ready', result }), 'ready');
  assert.match(html, /Inspired by/);
  assert.match(html, /data-action="open" data-ctx="night" data-id="84112"/, 'an original opens by id');
  assert.match(html, /href="#\/compare\/9828,1"/);
  assert.match(html, /1,200 votes · value 4\.1 of 5/);
  assert.match(html, /Alike by its notes/);
  assert.match(html, /You own it/);
  assert.match(html, /risky blind buy/);
  assert.equal((html.match(/<li class="row/g) ?? []).length, 6, 'four cheaper at most, the original and a sibling');
  assert.match(html, /“smells like” votes/, 'credited');
});

// ---------- What voters say ----------

test('what voters say: value, keepers, blind buy, buzz, ratings and lean, credited', () => {
  const f = byName("Supremacy Collector's Edition Pour Homme");
  const html = clean(crowdHTML(modelOf(evil)), 'crowd');
  assert.match(html, /Value for money/);
  assert.match(html, /4\.3<small> of 5<\/small>/);
  assert.match(html, /Great value/);
  const keep = f.about.owners.have / (f.about.owners.have + f.about.owners.had);
  assert.ok(html.includes(`${Math.round(keep * 100)}%`), 'the share of owners who keep it');
  assert.match(html, /Safe bet/);
  assert.match(html, /Top 1%/);
  assert.equal((html.match(/class="hist-fill"/g) ?? []).length, 5);
  assert.match(html, /love or like it/);
  assert.match(html, /left:\d+(\.\d)?%/, 'the lean has a place on its scale');
  assert.match(html, /Mostly worn by men/);
  assert.match(html, /Le Decanteur’s dataset/);
  assert.ok(html.includes(`By ${esc(EVIL)}`));

  const loading = crowdHTML(modelOf({ ...stranger, extras: undefined, sentiment: undefined }, { about: undefined }));
  assert.match(loading, /aria-busy="true"/, 'a dataset bottle waits for its about data');
  assert.equal(crowdHTML(modelOf({ id: 'my:x', name: 'Mine', accords: { woody: 80 }, season: {}, dayNight: {} })), '', 'a hand-entered bottle has nothing to say');
  const quiet = crowdHTML(modelOf({ ...stranger, extras: undefined, sentiment: undefined }, { about: null }));
  assert.equal(quiet, '', 'a bottle the dataset knows nothing more about');
  const pricey = crowdHTML(modelOf({ ...stranger, extras: { value: 1.7, flags: ['polarizing'], safe: 5, now: 20 }, sentiment: undefined }, { about: null }));
  assert.match(pricey, /Pricey/);
  assert.match(pricey, /Divides people/);
  assert.match(pricey, /Quietly/);
});

// ---------- Pros and cons ----------

test('pros and cons are Fragrantica members’ summary, credited', () => {
  const html = clean(reviewsHTML(modelOf(evil)), 'reviews');
  assert.match(html, /Fragrantica members’ summary/);
  assert.match(html, /class="pro"/);
  assert.match(html, /class="con"/);
  assert.match(html, /12 agree/);
  assert.match(reviewsHTML(modelOf(stranger)), /aria-busy="true"/);
  assert.equal(reviewsHTML(modelOf(stranger, { about: null })), '');
  assert.equal(reviewsHTML(modelOf({ ...stranger, id: 'my:x' })), '');
});

// ---------- Compare ----------

test('the compare route keeps up to three distinct ids, commas and all', () => {
  const panes = { wear: ['now'] };
  assert.deepEqual(parseRoute('#/compare/1,2', panes), { dest: 'compare', pane: null, arg: '1,2', query: {} });
  assert.equal(parseRoute('#/compare/1,2,2,3,4', panes).arg, '1,2,3', 'distinct, at most three');
  assert.equal(parseRoute('#/compare', panes).arg, null);
  assert.equal(routeHash(parseRoute('#/compare/98689,9828', panes)), '#/compare/98689,9828');
  assert.equal(routeHash(parseRoute('#/compare/98689%2C9828', panes)), '#/compare/98689,9828', 'an escaped comma reads the same');
  const custom = 'my:k3j~eyJuIjoiUm9zZSJ9';
  assert.deepEqual(compareIds(parseRoute(routeHash({ dest: 'compare', arg: `${custom},9828` }), panes).arg), [custom, '9828']);
  assert.equal(MAX_COMPARE, 3);
});

test('two bottles relate by a dupe, by votes, or by how alike they are', () => {
  const brun = byName('Liquid Brun');
  const althair = { id: String(brun.original.id), name: 'Althaïr', brand: 'Parfums de Marly', accords: brun.accords };
  assert.match(relation(brun, althair).text, /Liquid Brun is inspired by Althaïr/);
  const a = { ...byName('Sauvage') }, b = { ...byName('Aristo') };
  const voted = relation(a, b, { smellsLike: [{ id: Number(b.id), up: 40, down: 3 }] });
  assert.match(voted.text, /40 voters say Sauvage smells like Aristo/);
  const plain = relation(a, b);
  assert.ok(plain.sim >= 0 && plain.sim <= 1);
  assert.match(plain.text, /^Sauvage and Aristo: .+ by their accords and notes\.$/);
});

test('the compare page renders clean: heads, rows, the verdict, missing and loading bottles', () => {
  const f1 = { ...evil, id: '1' }, f2 = { ...byName('Sauvage'), name: EVIL };
  const ids = ['1', f2.id, '404'];
  const both = rank([f1, f2], wx.night, 'night', { history: [], todayISO: wx.night.dateISO });
  const occ = occasionById('date');
  const m = {
    ids,
    bottles: [{ id: '1', f: f1, status: 'ready', owned: true }, { id: f2.id, f: f2, status: 'ready', owned: false }, { id: '404', f: null, status: 'missing', owned: false }],
    now: { win: wx.night, entries: new Map(both.map(e => [e.fragrance.id, e])) },
    occ: { win: wx.night, occasion: occ, entries: new Map(both.map(e => [e.fragrance.id, e])) },
    tonight: { win: wx.night, ranked: both },
    pairs: [{ a: f1, b: f2, text: `${EVIL} and ${EVIL}: close by their accords and notes.`, sim: 0.7 }],
    about: f => f.about ?? null,
  };
  const html = clean(compareHTML(m), 'compare');
  assert.match(html, /style="--n:3"/);
  assert.equal((html.match(/class="cmp-head"/g) ?? []).length, 3);
  assert.match(html, /Not in the library/);
  assert.match(html, /data-action="cmp-remove" data-id="404"/);
  assert.match(html, /Match tonight/);
  assert.match(html, /Date Night · tonight/);
  assert.match(html, /How they relate/);
  assert.match(html, /cmp-verdict/);
  assert.ok(/Wear <i>|suits it best|Close call/.test(html));
  assert.match(html, /You own it/);
  assert.ok(!html.includes('data-action="cmp-add"'), 'three is the most');
  for (const row of ['Rating', 'Main accords', 'Seasons', 'Lasts', 'Projects', 'Value for money', 'Style', 'Blind buy']) assert.ok(html.includes(`>${row}</h2>`), row);

  const empty = compareHTML({ ...m, ids: [], bottles: [], pairs: [] });
  assert.match(empty, /Compare up to three bottles/);
  assert.match(empty, /data-action="cmp-add"/);
  const loading = clean(compareHTML({ ...m, ids: ['1'], bottles: [{ id: '1', f: null, status: 'loading', owned: false }], now: null, occ: null, tonight: null, pairs: [] }), 'loading');
  assert.match(loading, /aria-busy="true"/);
  assert.match(loading, /Add a bottle to see them side by side/);
  assert.ok(!loading.includes('cmp-table'), 'no rows until a bottle is in');
});

test('compare with… lists its family, the list it came from and your bottles, each once, filtered as you type', () => {
  const [a, b, c] = fragrances;
  const family = { original: { id: 'o', record: { id: 'o', name: 'Original', brand: 'House' } }, cheaper: [{ id: b.id, record: b }], siblings: [] };
  const lists = pickerLists({ base: [a.id], query: '' }, { family, context: [a, b, c], owned: [c, b, a] });
  assert.deepEqual(lists.map(l => l.title), ['Smells like it', 'From the same list']);
  assert.deepEqual(lists[0].records.map(r => r.id), ['o', b.id]);
  assert.deepEqual(lists[1].records.map(r => r.id), [c.id], 'the base and bottles already listed are left out');
  const typed = pickerLists({ base: [], query: 'origin', results: [{ id: '77', name: 'Original Musk', brand: 'X', stub: true }] }, { family, owned: fragrances });
  assert.deepEqual(typed.map(l => l.title), ['Smells like it', 'From Fragrantica']);
  const html = clean(pickerHTML({ base: [a.id], query: EVIL }, []), 'picker');
  assert.match(html, /No bottles match/);
  assert.match(html, /data-field="cmp-query"/);
  assert.match(pickerHTML({ base: ['1', '2', '3'], query: '' }, lists), /Three is the most/);
  assert.match(pickerHTML({ base: [a.id], query: '' }, lists), /data-action="cmp-pick" data-id="o"/);
});
