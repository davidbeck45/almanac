// Discover's screens: the state it keeps in the URL (src/views/discover/
// query.js, through the router), and its templates (src/views/discover/
// templates.js and the kit's bottle card), on made-up picks and on real
// answers from the suggestion pool.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { parseRoute, routeHash } from '../src/app/router.js';
import {
  KEYS, readQuery, writeQuery, poolFilters, filterCount, searchMode, NO_FILTERS, SAFE_MIN, SEED_MAX,
} from '../src/views/discover/query.js';
import * as T from '../src/views/discover/templates.js';
import { bottleCardHTML } from '../src/ui/components.js';
import { FILTERS } from '../src/discover.js';
import { STYLES } from '../src/scent-styles.js';
import { handlePool, newPoolCache } from '../src/pool-tasks.js';
import { seedSheetHTML, sheets } from '../src/views/discover.js';

const PANES = { wear: ['now'], wardrobe: ['owned'], discover: [] };
const viaURL = d => readQuery(parseRoute(routeHash({ dest: 'discover', query: writeQuery(d) }), PANES).query);

const EVIL = '<img src=x onerror="alert(1)">Rose & Oud\'s';
function clean(html, what) {
  assert.ok(!/\bundefined\b|\bNaN\b|\[object Object\]/.test(html), `${what} renders undefined, NaN or an object`);
  assert.ok(!html.includes(EVIL) && !html.includes('onerror="alert'), `${what} lets a name through unescaped`);
  return html;
}

// ---------- URL state ----------

test('Discover starts on its defaults when the URL says nothing', () => {
  assert.deepEqual(readQuery({}), {
    q: '', by: null, tab: 'styles', styles: null, mode: 'any', seeds: null, filters: { ...NO_FILTERS },
  });
  assert.deepEqual(writeQuery(readQuery({})), {}, 'defaults stay out of the URL');
});

test('every choice survives the URL, through the router', () => {
  const d = {
    q: 'iris leather',
    by: 'notes',
    tab: 'like',
    styles: ['skin', 'clean', 'intimate'],
    mode: 'all',
    seeds: ['94713', 'my:k3j~eyJuIjoiUm9zZSJ9', '110808'],
    filters: { seasons: ['winter', 'fall'], time: 'night', lean: 'masculine', longevity: 8, projection: 7.4, safe: true, discontinued: true, mists: true },
  };
  assert.deepEqual(viaURL(d), d);
  // Nothing chosen is a choice too: none, not "start on the liked ones".
  assert.deepEqual(viaURL({ ...readQuery({}), styles: [], seeds: [] }).styles, []);
  assert.deepEqual(viaURL({ ...readQuery({}), styles: [], seeds: [] }).seeds, []);
  // The router keeps every key the view writes.
  const all = Object.fromEntries(KEYS.map(k => [k, 'x']));
  assert.deepEqual(Object.keys(parseRoute(routeHash({ dest: 'discover', query: all }), PANES).query).sort(), [...KEYS].sort());
});

test('the URL reads as typed: commas in lists, the Insights link, junk left out', () => {
  const hash = routeHash({ dest: 'discover', query: writeQuery({ ...readQuery({}), styles: ['skin', 'clean', 'intimate'] }) });
  assert.equal(hash, '#/discover?styles=skin,clean,intimate');
  // Insights links here with exactly this.
  assert.deepEqual(readQuery(parseRoute('#/discover?styles=skin,clean,intimate', PANES).query).styles, ['skin', 'clean', 'intimate']);
  assert.deepEqual(readQuery(parseRoute('#/discover?styles=skin%2Cclean', PANES).query).styles, ['skin', 'clean'], 'escaped commas too');
  const junk = readQuery({ styles: 'skin,nope,skin', mode: 'most', tab: 'x', season: 'monsoon,winter', time: 'dusk', lean: 'both', longevity: '11', projection: 'loud', safe: 'yes', by: 'x' });
  assert.deepEqual(junk.styles, ['skin']);
  assert.equal(junk.mode, 'any');
  assert.equal(junk.tab, 'styles');
  assert.equal(junk.by, null);
  assert.deepEqual(junk.filters, { ...NO_FILTERS, seasons: ['winter'] });
  assert.equal(readQuery({ seeds: '1,2,3,4,5,6,7' }).seeds.length, SEED_MAX);
  assert.equal(writeQuery({ ...readQuery({}), q: '', by: 'notes' }).by, undefined, 'a search mode without a search stays out');
});

test('filters become the pool’s, and the Filters button counts them', () => {
  assert.deepEqual(poolFilters(NO_FILTERS), {
    seasons: null, slot: null, lean: null, minLongevity: null, minSillage: null, minSafe: null, hideDiscontinued: true,
  });
  const f = { seasons: ['winter'], time: 'night', lean: 'unisex', longevity: 7.5, projection: 7.8, safe: true, discontinued: true, mists: true };
  assert.deepEqual(poolFilters(f), {
    seasons: ['winter'], slot: 'night', lean: 'unisex', minLongevity: 7.5, minSillage: 7.8, minSafe: SAFE_MIN, hideDiscontinued: false, mists: true,
  });
  assert.equal(poolFilters(f, { mists: false }).mists, undefined, 'no mist flag for logic that doesn’t know mists');
  for (const key of Object.keys(poolFilters(f, { mists: false }))) assert.ok(key in FILTERS, `${key} is one of src/discover.js FILTERS`);
  assert.equal(filterCount(NO_FILTERS), 0);
  assert.equal(filterCount(f), 8);
  assert.equal(filterCount(f, { mists: false }), 7);
});

test('a search reads as notes when every word is one, unless a bottle is named exactly that', () => {
  const notes = { terms: ['tobacco', 'vanilla'], unknown: [] };
  assert.equal(searchMode({ q: 'tobacco vanilla' }, [], notes), 'notes');
  assert.equal(searchMode({ q: 'tobacco vanille' }, [{ name: 'Tobacco Vanille', brand: 'Tom Ford' }], notes), 'names');
  assert.equal(searchMode({ q: 'fig' }, [{ name: 'Fig', brand: 'Somebody' }], { terms: ['fig'], unknown: [] }), 'notes', 'one word stays a note');
  assert.equal(searchMode({ q: 'aventus' }, [{ name: 'Aventus', brand: 'Creed' }], { terms: [], unknown: ['aventus'] }), 'names');
  assert.equal(searchMode({ q: 'iris leather' }, [], null), 'names', 'names until the notes answer is in');
  assert.equal(searchMode({ q: 'tobacco vanille', by: 'notes' }, [{ name: 'Tobacco Vanille', brand: 'Tom Ford' }], notes), 'notes', 'a pick wins');
});

// ---------- Templates ----------

const record = (id, name = EVIL, extra = {}) => ({ id, name, brand: EVIL, year: 2020, thumb: 'https://x.test/a.webp', rating: 4.18, ratingVotes: 1234, accords: { musky: 100 }, source: 'fragrantica', ...extra });
const owned = record('o1', 'Sandalwood & Musk', { source: undefined });
const pick = (id, extra = {}) => ({
  id,
  record: record(id),
  score: 1,
  styles: [{ id: 'skin', label: 'Skin scent', score: 0.9 }, { id: 'powdery', label: 'Powdery & iris', score: 0.7 }],
  close: true,
  nearest: { name: EVIL, record: owned, sim: 0.6, traits: ['musk', EVIL], through: EVIL },
  family: `in the family of your ${EVIL}`,
  clonesOf: { id: 'c1', record: record('c1'), name: EVIL, brand: EVIL, up: 314, down: 54 },
  value: 4.3,
  rating: 4.18,
  votes: 1234,
  risk: { level: 'high', reasons: [`${EVIL} divides people.`] },
  twin: { record: record('t1'), value: 4.5, text: EVIL },
  alike: [record('a1'), record('a2')],
  why: EVIL,
  ...extra,
});

test('a pick’s card: escaped, marked, and every action named', () => {
  const html = clean(T.pickCardHTML(pick('p1'), { selected: ['skin', 'intimate'], key: 'styles' }), 'card');
  assert.match(html, /data-action="open" data-ctx="" data-id="p1"/, 'photo and name open its page');
  for (const action of ['disc-want', 'disc-own', 'disc-dupes']) assert.ok(html.includes(`data-action="${action}" data-id="p1"`), action);
  assert.match(html, /★ 4\.18/);
  assert.match(html, /Great value/);
  assert.match(html, /Risky buy/);
  assert.match(html, /class="tag on"[^>]*>Skin scent</, 'the styles asked for light up');
  assert.match(html, /class="tag"[^>]*>Powdery &amp; iris</);
  assert.match(html, /class="tag on close"[^>]*>Wears close</, 'wears close, lit when Intimate was asked for');
  assert.match(html, /aria-labelledby="bc-styles-p1-n"/, 'the button’s name is the bottle’s');
  assert.match(html, /aria-pressed="false" aria-label="Want /);
  const lines = T.whyLines(pick('p1'), { max: 9 });
  assert.equal(lines.length, 5, 'nearest, what it copies, twin, twins and family');
  assert.match(lines[0], /^Nearest you own: <button class="link-btn" data-action="open" data-ctx="" data-id="o1">/);
  assert.match(lines[1], /Voters say it smells like .* \(314 to 54\)\.$/);
  assert.match(lines[2], /^Cheaper twin: /);
  assert.match(lines[3], /^Twins: .* and /);
  assert.equal(T.whyLines(pick('p1')).length, 4, 'four lines at most');
  // Owned and wanted.
  const mine = T.pickCardHTML(pick('p1'), { owned: 'In Mine', wanted: true });
  assert.ok(!mine.includes('disc-own'), 'an owned bottle says so instead of offering I own it');
  assert.match(mine, /In Mine/);
  assert.match(mine, /aria-pressed="true" aria-label="Want /);
});

test('a notes pick leads with what it matched; a more-like pick with what it shares', () => {
  const notes = T.pickCardHTML(pick('p2', { matched: [{ term: 'iris', name: 'orris root', via: 'note', strength: 0.8 }, { term: 'leather', name: 'leather', via: 'accord', strength: 0.9 }] }));
  assert.match(notes, /<li class="tag on match">Orris root<\/li><li class="tag on match">Leather<\/li>/);
  const like = T.whyLines(pick('p3', { shares: ['vanilla', 'amber', 'sweet'], alsoLiked: 2, family: null }), { max: 9 });
  assert.equal(like[0], 'Shares vanilla, amber and sweet with your picks.');
  assert.equal(like.at(-1), 'Fans of your picks like it too.');
  // Bare picks still render.
  clean(T.pickCardHTML({ id: 'b', record: record('b', 'Bare', { rating: 0, year: null }), styles: [], close: false, nearest: null, risk: { level: 'low', reasons: [] } }), 'bare card');
});

test('marks say value and risk in words', () => {
  assert.deepEqual(T.valueMark(4.2), { text: 'Great value', tone: 'good' });
  assert.equal(T.valueMark(3.6).text, 'Good value');
  assert.equal(T.valueMark(3.0), null, 'the middle says nothing');
  assert.equal(T.valueMark(2.1).text, 'Pricey');
  assert.equal(T.riskMark({ level: 'low', reasons: ['It doesn’t last long.'] }), null);
  assert.deepEqual(T.riskMark({ level: 'medium', reasons: ['Owners often let it go.'] }), { text: 'Some risk', tone: 'warn', spoken: 'Some risk: Owners often let it go.' });
});

test('a list: skeletons first, the old cards dimmed while a change loads, errors and empties, the teaser after four', () => {
  const opts = { name: 'styles', empty: '<p>EMPTY</p>' };
  const loading = T.picksHTML({ status: 'loading', result: null }, opts);
  assert.match(loading, /aria-busy="true"/);
  assert.equal((loading.match(/sk-bcard/g) ?? []).length, 4);
  assert.match(T.picksHTML({ status: 'loading', result: null }, { ...opts, poolLoading: true }), /Loading the fragrance library/);
  const failed = clean(T.picksHTML({ status: 'error', result: null, error: EVIL }, opts), 'error');
  assert.match(failed, /data-action="disc-retry" data-value="styles"/);
  assert.equal(T.picksHTML({ status: 'done', result: { picks: [] } }, { ...opts, insert: '<i>T</i>' }), '<p>EMPTY</p><i>T</i>');
  const picks = Array.from({ length: 12 }, (_, i) => pick(`p${i}`));
  const full = T.picksHTML({ status: 'done', result: { picks } }, { ...opts, k: 12, insert: '<section class="disc-teaser">T</section>' });
  const order = [...full.matchAll(/<article class="bcard|<section class="disc-teaser/g)].map(m => (m[0].includes('teaser') ? 'T' : 'c')).join('');
  assert.equal(order, 'ccccTcccccccc', 'the teaser after the first four cards');
  assert.match(full, /data-action="disc-more" data-value="styles"/, 'a full page offers more');
  assert.ok(!T.picksHTML({ status: 'done', result: { picks: picks.slice(0, 5) } }, { ...opts, k: 12 }).includes('disc-more'), 'a short one doesn’t');
  assert.ok(!T.picksHTML({ status: 'done', result: { picks } }, { ...opts, k: T.MAX_PICKS }).includes('disc-more'), 'nor one at the most');
  const updating = T.picksHTML({ status: 'loading', result: { picks } }, opts);
  assert.match(updating, /disc-grid updating" aria-busy="true"/);
  assert.match(updating, /disc-more"[^>]*disabled/);
});

test('style chips: the chosen pressed, the rest folded on wide columns, a tip for each', () => {
  const order = STYLES.map(s => s.id);
  const html = clean(T.stylePickerHTML({ order, selected: ['skin', 'boozy'], mode: 'all', owned: { skin: [EVIL, 'Meant To Be Seen'] } }), 'chips');
  assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 2 + 1, 'two chips and the All segment');
  assert.match(html, /data-value="boozy" aria-pressed="true"/);
  assert.ok(!/class="style-chip on extra"/.test(html), 'a chosen chip never folds away');
  const folded = (html.match(/style-chip extra/g) ?? []).length;
  assert.equal(folded, order.length - 10 - 1, 'past the first ten, the unchosen fold');
  assert.match(html, new RegExp(`${folded} more styles`));
  assert.match(html, /data-action="disc-mode" data-value="all" aria-pressed="true"/);
  assert.equal((html.match(/id="disc-tip-/g) ?? []).length, order.length);
  assert.match(html, /You own 2: &lt;img/);
  assert.match(T.styleTip('clean', ['Cedrus Blanc']), /You own Cedrus Blanc\.$/);
  assert.match(T.styleTip('oud', []), /You don’t own one yet\.$/);
  const one = T.stylePickerHTML({ order, selected: ['clean'], mode: 'any' });
  assert.ok(!one.includes('disc-mode'), 'one style needs no Any/All');
  assert.match(one, /Soap, laundry/, 'one style says what it is');
  assert.match(T.stylePickerHTML({ order, selected: [], mode: 'any' }), /Pick a style/);
});

test('seeds: chips to remove, Add until five, the way back to the defaults', () => {
  const r = record('s1');
  const html = clean(T.seedsHTML({ seeds: [r, null], from: 'given', chosen: true, max: 5 }), 'seeds');
  assert.match(html, /data-action="disc-seed-remove" data-id="s1"/);
  assert.match(html, /sk-seed/, 'a seed still loading');
  assert.match(html, /data-action="disc-seeds-reset"/);
  assert.match(html, /data-action="disc-seeds-open"/);
  assert.ok(!T.seedsHTML({ seeds: Array(5).fill(r), from: 'given', chosen: true, max: 5 }).includes('disc-seeds-open'), 'no Add at five');
  assert.match(T.seedsHTML({ seeds: [r], from: 'worn', chosen: false, max: 5 }), /most worn/);
  assert.match(T.seedsHTML({ seeds: [r], from: 'rated', chosen: false, max: 5 }), /best-rated/);
});

test('filters: radio groups with one stop each, the value toggle as answered, mists only when known', () => {
  const html = T.filtersHTML({ ...NO_FILTERS, time: 'night', longevity: 8, seasons: ['winter'] }, { preferValue: true, mists: true, prefix: 'x' });
  const groups = [...html.matchAll(/role="radiogroup"[^>]*>([\s\S]*?)<\/div>/g)].map(m => m[1]);
  assert.equal(groups.length, 4);
  for (const g of groups) {
    assert.equal((g.match(/tabindex="0"/g) ?? []).length, 1, 'one tab stop per group');
    assert.equal((g.match(/aria-checked="true"/g) ?? []).length, 1);
  }
  assert.match(html, /aria-checked="true" tabindex="0" data-action="disc-time" data-value="night"/);
  assert.match(html, /aria-checked="true" tabindex="0" data-action="disc-longevity" data-value="8"/);
  assert.match(html, /aria-pressed="true" data-action="disc-season" data-value="winter"/);
  assert.match(html, /role="switch" aria-checked="true" data-action="disc-value"/);
  assert.match(html, /aria-checked="true" data-action="disc-switch" data-id="discontinued"/, 'Hide discontinued is on by default');
  assert.match(html, /data-id="mists"/);
  assert.ok(!T.filtersHTML(NO_FILTERS, { mists: false }).includes('data-id="mists"'));
  assert.match(T.filterButtonHTML({ ...NO_FILTERS, safe: true, lean: 'unisex' }), /aria-label="Filters, 2 on"/);
  assert.ok(!/class="count"/.test(T.filterButtonHTML(NO_FILTERS)));
  clean(T.filterSheetHTML(NO_FILTERS, { preferValue: false, mists: true, status: EVIL }), 'filter sheet');
});

test('search: names with where they are, the two readings, typos and nothing found', () => {
  const names = clean(T.namesHTML({ results: [record('n1'), record('n2')] }, new Map([['n2', `In ${EVIL}’s`]])), 'names');
  assert.equal((names.match(/data-action="own-result"/g) ?? []).length, 1);
  assert.equal((names.match(/data-action="disc-dupes"/g) ?? []).length, 2);
  const toggle = T.modeToggleHTML('notes', { names: 'iris leather', notes: ['iris', 'leather'] });
  assert.match(toggle, /data-value="notes" aria-pressed="true"><span>By notes</);
  assert.match(toggle, /data-value="names" aria-pressed="false"><span>By name</);
  assert.equal(T.modeToggleHTML('notes', { names: null, notes: ['iris'] }), '', 'one reading needs no toggle');
  assert.equal(T.searchTitleHTML('notes', { query: 'x', terms: ['iris', 'leather', 'smoke'] }), '<h2 class="disc-title">With iris, leather and smoke</h2>');
  assert.match(clean(T.searchTitleHTML('names', { query: EVIL }), 'title'), /Names matching “&lt;img/);
  const note = T.notesNoteHTML({ corrected: [{ from: 'lavnder', to: 'lavender' }], suggested: [{ from: 'vanila', to: 'vanilla' }] }, 'vanila smoke');
  assert.match(note, /Showing lavender for “lavnder”\./);
  assert.match(note, /data-action="disc-suggest" data-value="vanilla smoke">vanilla</);
  clean(T.noMatchHTML(EVIL), 'no match');
  clean(T.searchFormHTML(EVIL), 'search field');
  assert.equal(T.statusHTML({ query: 'x', results: [], busy: false, error: '' }), 'No bottles named “x”.');
});

test('the teaser: the thinnest gap and what fills it, a skeleton, nothing when it failed', () => {
  const r = record('g1');
  const report = { gaps: [{ title: 'Date Night on mild and warm nights' }], picks: [{ id: 'g1', record: r, fills: [{ title: 'Date Night on mild nights' }, { title: 'Cozy on mild nights' }] }] };
  const html = clean(T.teaserHTML({ status: 'done', result: report }), 'teaser');
  assert.match(html, /Thinnest in your wardrobe: Date Night on mild and warm nights\./);
  assert.match(html, /For Date Night on mild nights and 1 more/);
  assert.match(html, /href="#\/wardrobe\/insights"/);
  assert.match(T.teaserHTML({ status: 'loading', result: null }), /teaser-sk/);
  assert.equal(T.teaserHTML({ status: 'error', result: null, error: 'x' }), '');
  assert.match(T.teaserHTML({ status: 'done', result: { gaps: [], picks: [], overview: { text: 'You have a strong pick for everything.' } } }), /strong pick for everything/);
});

test('the kit’s bottle card keeps ids apart per list and escapes what it’s given', () => {
  const f = record('my:1"><b>');
  const a = bottleCardHTML(f, { key: 'styles', marks: [{ text: EVIL, spoken: EVIL }], tags: [{ text: EVIL, color: '#fff' }] });
  const b = bottleCardHTML(f, { key: 'report' });
  clean(a, 'card');
  assert.notEqual(a.match(/id="([^"]+)-n"/)[1], b.match(/id="([^"]+)-n"/)[1]);
  for (const [, id] of a.matchAll(/\sid="([^"]*)"/g)) assert.match(id, /^[\w-]+$/, 'ids are safe');
});

test('the seed picker: picked first, then the library’s hits, then yours', () => {
  const mine = [record('m1', 'Liquid Brun'), record('m2', 'Hawas Elixir'), record('m3', EVIL)];
  const html = clean(seedSheetHTML({ query: 'brun', results: [record('m1', 'Liquid Brun'), record('l1', 'Brun Noir')] }, { owned: mine, chosen: ['m2'], picked: [mine[1]] }), 'seed sheet');
  const sections = [...html.matchAll(/<p class="list-title">([^<]+)<\/p>/g)].map(m => m[1]);
  assert.deepEqual(sections, ['Picked', 'From the library', 'Yours that match']);
  assert.match(html, /data-action="disc-seed-toggle" data-id="m2" aria-pressed="true"/);
  assert.match(html, /data-id="l1" aria-pressed="false"/);
  assert.equal((html.match(/data-id="m1"/g) ?? []).length, 1, 'an owned hit shows once, under yours');
  assert.match(html, /1 of 5 picked/);
  assert.match(seedSheetHTML({ query: '' }, { owned: [], chosen: [] }), /Your wardrobe is empty/);
  // Off Discover, its sheets close themselves.
  assert.equal(sheets['disc-filters'](), null);
});

// ---------- Real answers ----------

const dir = new URL('../data/fragrantica/', import.meta.url);
const load = async path => (existsSync(new URL(path, dir)) ? readFileSync(new URL(path, dir), 'utf8') : null);
const wardrobe = JSON.parse(readFileSync(new URL('../data/collection.json', import.meta.url))).fragrances.map(f => ({ ...f, id: String(f.id) }));

test('real answers render as cards, every one of them', async () => {
  const cache = newPoolCache({ load });
  const ask = async (type, payload) => {
    const a = await handlePool({ id: 1, type, payload: { owned: wardrobe, ...payload } }, cache);
    assert.equal(a.error, undefined, a.error);
    return a.result;
  };
  const lists = [
    await ask('styles', { styles: ['skin', 'clean', 'intimate'], k: 12, filters: poolFilters(NO_FILTERS) }),
    await ask('moreLike', { k: 12, filters: poolFilters({ ...NO_FILTERS, time: 'night' }) }),
    await ask('notes', { query: 'iris leather', k: 12, filters: poolFilters(NO_FILTERS) }),
  ];
  for (const r of lists) {
    assert.ok(r.picks.length >= 6);
    const html = T.picksHTML({ status: 'done', result: r }, { name: 'x', k: 12, empty: '' });
    clean(html, 'real list');
    assert.equal((html.match(/<article class="bcard/g) ?? []).length, r.picks.length);
  }
  const report = await ask('report', { k: 3 });
  const teaser = clean(T.teaserHTML({ status: 'done', result: report }), 'real teaser');
  assert.equal((teaser.match(/<li class="row/g) ?? []).length, report.picks.length);
});
