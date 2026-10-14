// Discover's screens: the state it keeps in the URL (src/views/discover/
// query.js, through the router), and its templates (src/views/discover/
// templates.js and the kit's bottle card), on made-up picks and on real
// answers from the suggestion pool.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { parseRoute, routeHash } from '../src/app/router.js';
import {
  KEYS, readQuery, writeQuery, poolFilters, filterCount, searchMode, namedToCheck, WELL_KNOWN, NO_FILTERS, SAFE_MIN, SEED_MAX,
} from '../src/views/discover/query.js';
import * as T from '../src/views/discover/templates.js';
import { bottleCardHTML } from '../src/ui/components.js';
import { FILTERS } from '../src/discover.js';
import { STYLES } from '../src/scent-styles.js';
import { handlePool, newPoolCache } from '../src/pool-tasks.js';
import { fragranticaLibrary } from '../src/fragrantica.js';
import { seedSheetHTML, sheets, NONE_FOUND, withPins } from '../src/views/discover.js';

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
  const junk = readQuery({ styles: 'skin,whiteFloral,skin,<b>,none', mode: 'most', tab: 'x', season: 'monsoon,winter', time: 'dusk', lean: 'both', longevity: '11', projection: 'loud', safe: 'yes', by: 'x' });
  assert.deepEqual(junk.styles, ['skin', 'whiteFloral'], 'ids by shape (the view keeps the ones STYLES has)');
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
  assert.equal(poolFilters({ ...f, mists: false }).mists, undefined, 'mists only when let in');
  for (const key of Object.keys(poolFilters(f))) assert.ok(key in FILTERS, `${key} is one of src/discover.js FILTERS`);
  assert.equal(filterCount(NO_FILTERS), 0);
  assert.equal(filterCount(f), 8);
  assert.equal(filterCount({ ...f, mists: false }), 7);
  assert.equal(filterCount(NO_FILTERS, { value: true }), 1, 'Prefer great value counts, though it lives in prefs');
});

test('a search reads as notes when every word is one, unless a well-known bottle is named exactly that', () => {
  const notes = { terms: ['tobacco', 'vanilla'], unknown: [] };
  const stub = (id, name, brand) => ({ id, name, brand, stub: true });
  const tv = stub('1825', 'Tobacco Vanille', 'Tom Ford');
  assert.equal(searchMode({ q: 'tobacco vanilla' }, [], notes), 'notes');
  assert.equal(searchMode({ q: 'tobacco vanille' }, [tv], notes, () => 31666), 'names');
  assert.equal(searchMode({ q: 'tobacco vanille' }, [tv], notes, () => 17), 'notes', 'a little-known bottle of that name doesn’t take the words');
  assert.equal(searchMode({ q: 'tobacco vanille' }, [tv], notes), 'notes', 'nor one whose votes aren’t known');
  assert.equal(searchMode({ q: 'tobacco vanille' }, [{ ...tv, stub: false }], notes), 'names', 'one on this device does');
  assert.equal(searchMode({ q: 'tobacco vanille tom ford' }, [tv], notes), 'names', 'so does one named with its brand');
  assert.equal(searchMode({ q: 'fig' }, [{ name: 'Fig', brand: 'Somebody' }], { terms: ['fig'], unknown: [] }), 'notes', 'one word stays a note');
  assert.equal(searchMode({ q: 'aventus' }, [{ name: 'Aventus', brand: 'Creed' }], { terms: [], unknown: ['aventus'] }), 'names');
  assert.equal(searchMode({ q: 'iris leather' }, [], null), 'names', 'names until the notes answer is in');
  assert.equal(searchMode({ q: 'tobacco vanille', by: 'notes' }, [tv], notes, () => 31666), 'notes', 'a pick wins');
  assert.deepEqual(namedToCheck('tobacco vanille', [tv, stub('2', 'Tobacco', 'X')], () => undefined), [tv], 'the votes it still needs');
  assert.deepEqual(namedToCheck('tobacco vanille', [tv], () => 31666), []);
});

test('the brief’s note pairs read as notes, and famous names as names, on the real library', async () => {
  const dir = new URL('../data/fragrantica/', import.meta.url);
  const library = fragranticaLibrary(async path => (existsSync(new URL(path, dir)) ? readFileSync(new URL(path, dir), 'utf8') : null));
  const reading = async (q, terms) => {
    const hits = await library.search(q, 10);
    const records = await library.records(namedToCheck(q, hits, () => undefined).map(r => r.id));
    return searchMode({ q }, hits, { terms, unknown: [] }, id => records.get(id)?.ratingVotes ?? 0);
  };
  // Bottles are named these (Smoky Vanilla by Qhue, 5 votes; Amber Vanilla by The 7 Virtues, 822).
  assert.equal(await reading('smoky vanilla', ['smoky', 'vanilla']), 'notes');
  assert.equal(await reading('amber vanilla', ['amber', 'vanilla']), 'notes');
  assert.equal(await reading('rose oud', ['rose', 'oud']), 'notes');
  assert.equal(await reading('Tobacco Vanille', ['tobacco', 'vanilla']), 'names');
  assert.equal(await reading('oud wood', ['oud', 'woody']), 'names');
  assert.ok(WELL_KNOWN > 2000 && WELL_KNOWN < 9000);
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
  assert.match(html, /<span>Smells like<\/span>/);
  assert.match(html, /★ 4\.18/);
  assert.match(html, /Great value/);
  assert.match(html, />Risky</);
  assert.match(html, /class="tag on"[^>]*>Skin scent</, 'the styles asked for light up');
  assert.match(html, /class="tag"[^>]*>Powdery &amp; iris</);
  assert.match(html, /class="tag on close"[^>]*>Intimate</, 'wears close, named as its chip and lit when Intimate was asked for');
  assert.match(html, /data-action="disc-dupes" data-id="p1" aria-label="What smells like &lt;img[^"]*"/, 'Smells like says whose');
  assert.match(html, /aria-labelledby="bc-styles-p1-n bc-styles-p1-b"/, 'the button’s name is the bottle’s, with its brand and year');
  assert.match(html, /aria-pressed="false" aria-label="Want /);
  const lines = T.whyLines(pick('p1'), { max: 9 });
  assert.equal(lines.length, 5, 'nearest, what it copies, twin, twins and family');
  assert.match(lines[0], /^Nearest you own: <button class="link-btn" data-action="open" data-ctx="" data-id="o1">.*<\/button> \(a &lt;img.* dupe\), sharing /);
  assert.match(lines[1], /^Most voters say it smells like .* by &lt;img[^.]*\.$/);
  assert.ok(!/\d+ to \d+/.test(lines[1]), 'no raw vote tallies');
  assert.match(T.whyLines(pick('p1', { nearest: { name: 'Liquid Brun', record: owned, traits: [], through: 'Althaïr' } }))[0], /\(an Althaïr dupe\)/);
  assert.match(lines[2], /^Cheaper twin: /);
  assert.match(lines[3], /^Twins: .* and /);
  const five = T.whyLines(pick('p1', { alike: ['a1', 'a2', 'a3', 'a4', 'a5'].map(id => record(id, `Twin ${id}`)) }), { max: 9 });
  assert.match(five[3], /^Twins: .*Twin a1.*, .*Twin a2.*, .*Twin a3<\/button> and 2 more\.$/, 'one “and”, then how many more');
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
  const leather = T.pickCardHTML(pick('p4', { matched: [{ term: 'leather', name: 'leather', via: 'accord', strength: 0.9 }], styles: [{ id: 'leather', label: 'Leather', score: 0.8 }] }));
  assert.equal((leather.match(/>Leather</g) ?? []).length, 1, 'a match and a style of the same name show once');
  const like = T.whyLines(pick('p3', { shares: ['vanilla', 'amber', 'sweet'], alsoLiked: 2, family: null }), { max: 9 });
  // The seeds are "these bottles": "picks" are what the app recommends.
  assert.equal(like[0], 'Shares vanilla, amber and sweet with these bottles.');
  assert.equal(like.at(-1), 'Fans of these bottles like it too.');
  // Bare picks still render.
  clean(T.pickCardHTML({ id: 'b', record: record('b', 'Bare', { rating: 0, year: null }), styles: [], close: false, nearest: null, risk: { level: 'low', reasons: [] } }), 'bare card');
});

test('a pick with nothing voters link it to leaves out Smells like; a mist or an oil says so', () => {
  const lone = pick('p5', { clonesOf: null, twin: null, alike: [] });
  assert.ok(!T.pickCardHTML(lone).includes('disc-dupes'), 'nothing to show there');
  assert.ok(T.hasDupes({ ...lone, record: { ...lone.record, extras: { like: ['9'] } } }), 'smells-like votes are something');
  assert.equal(T.formatOf({ name: 'Twilight Body Spray' }), 'Body spray');
  assert.equal(T.formatOf({ name: 'Amber Fragrance Oil' }), 'Perfume oil');
  assert.equal(T.formatOf({ name: 'Aventus Oil' }), 'Perfume oil');
  assert.equal(T.formatOf({ name: 'Bare Vanilla Fine Fragrance Mist' }), 'Body mist');
  assert.equal(T.formatOf({ name: 'If You Musk', extras: { flags: ['mist'] } }), 'Body mist', 'the pool’s mist flag');
  for (const name of ['Cashmere Mist', 'Iris Silver Mist', 'Oud Wood', 'Soil']) assert.equal(T.formatOf({ name }), null, name);
  assert.match(T.pickCardHTML(pick('p6', { record: record('p6', 'Amber Fragrance Oil') })), /class="bcard-meta"[^>]*>[^<]*· 2020 · Perfume oil</);
});

test('marks say value and risk in words', () => {
  assert.deepEqual(T.valueMark(4.2), { text: 'Great value', tone: 'good' });
  assert.equal(T.valueMark(3.6).text, 'Good value');
  assert.equal(T.valueMark(3.0), null, 'the middle says nothing');
  assert.equal(T.valueMark(2.1).text, 'Pricey');
  assert.equal(T.riskMark({ level: 'low', reasons: ['It doesn’t last long.'] }), null);
  assert.deepEqual(T.riskMark({ level: 'medium', reasons: ['Owners often let it go.'] }), { text: 'Some risk', tone: 'warn', spoken: 'Some risk. Owners often let it go.' });
  assert.equal(T.riskMark({ level: 'high', reasons: ['It divides people: many voters hate it.'] }).spoken, 'Risky. It divides people: many voters hate it.', 'one colon at most');
  assert.equal(T.riskMark({ level: 'high', reasons: [] }).spoken, 'Risky');
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
  assert.match(updating, /disc-more"[^>]*aria-disabled="true"/, 'Show more stays focusable while the next page loads');
  assert.ok(!/disc-more"[^>]*\sdisabled/.test(updating));
});

test('style chips: the chosen pressed, the rest folded on wide columns, a tip for each', () => {
  const order = STYLES.map(s => s.id);
  const html = clean(T.stylePickerHTML({ styles: STYLES, order, selected: ['skin', 'boozy'], mode: 'all', owned: { skin: [EVIL, 'Meant To Be Seen'] } }), 'chips');
  assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 2 + 1, 'two chips and the All segment');
  assert.match(html, /data-value="boozy" aria-pressed="true"/);
  assert.ok(!/class="style-chip on extra"/.test(html), 'a chosen chip never folds away');
  const folded = (html.match(/style-chip extra/g) ?? []).length;
  assert.equal(folded, order.length - 10 - 1, 'past the first ten, the unchosen fold');
  assert.match(html, new RegExp(`${folded} more styles`));
  assert.match(html, /data-action="disc-mode" data-value="all" aria-pressed="true"/);
  assert.equal((html.match(/id="disc-tip-/g) ?? []).length, order.length);
  assert.match(html, /You own 2: &lt;img/);
  const style = id => STYLES.find(s => s.id === id);
  assert.match(T.styleTip(style('clean'), ['Cedrus Blanc']), /^Soap, .* You own Cedrus Blanc\.$/);
  assert.match(T.styleTip(style('oud'), []), /You don’t own one yet\.$/);
  const one = T.stylePickerHTML({ styles: STYLES, order, selected: ['clean'], mode: 'any' });
  assert.ok(!one.includes('disc-mode'), 'one style needs no Any/All');
  assert.match(one, /Soap, laundry/, 'one style says what it is');
  // None chosen: the line says how to read a style, and a message where the cards go says how to start.
  const none = T.stylePickerHTML({ styles: STYLES, order, selected: [], mode: 'any' });
  assert.match(none, /<span class="hint-pointer">Point at a style<\/span> to see what it is\./);
  const empty = T.stylesEmptyHTML();
  assert.match(empty, /class="message"/);
  assert.match(empty, /Pick a style to start/);
});

test('seeds: chips to remove, Add until five, the way back to the defaults, ones the library lost', () => {
  const r = record('s1');
  const html = clean(T.seedsHTML({ seeds: [r, null, { id: 'gone', missing: true }], max: 5, line: T.likeHead({ from: 'given', chosen: true }).line }), 'seeds');
  assert.match(html, /data-action="disc-seed-remove" data-id="s1"/);
  assert.match(html, /sk-seed/, 'a seed still loading');
  assert.match(html, /Not found<\/span><\/span>\s*<button class="icon-btn seed-x" data-action="disc-seed-remove" data-id="gone"/, 'a seed the library lost, with its X');
  assert.match(html, /data-action="disc-seeds-reset"/);
  assert.match(html, /data-action="disc-seeds-open"/);
  assert.ok(!T.seedsHTML({ seeds: Array(5).fill(r), max: 5 }).includes('disc-seeds-open'), 'no Add at five');
  assert.ok(!T.seedsHTML({ seeds: [], max: 5, addable: false }).includes('disc-seeds-open'), 'none when the message below asks for bottles');
  assert.deepEqual(T.likeHead({ from: 'worn' }), { title: 'More like your most worn', line: 'Your most worn of the last 60 days.' });
  assert.equal(T.likeHead({ from: 'rated' }).title, 'More like your best rated');
  assert.equal(T.likeHead({ from: 'rated', none: true }).title, 'More like bottles you love', 'no “best-rated” over an empty row');
  assert.equal(T.likeHead({ from: 'rated', none: true }).line, '');
  assert.deepEqual(T.likeHead({ loading: true }), { title: 'More like your favorites', line: 'Loading your favorites…' });
  assert.equal(T.likeHead({ from: 'given', chosen: true }).title, 'More like the bottles you chose', 'not “your picks”');
  // The pool's words when it finds none of a link's seeds: no Try again.
  assert.match('None of those bottles are in the fragrance library.', NONE_FOUND);
});

test('a list says what it is, and when only great value shows', () => {
  assert.equal(T.stylesTitle(['Skin scent', 'Clean', 'Intimate']), 'More skin scent, clean or intimate bottles');
  assert.equal(T.stylesTitle(['Powdery & iris']), 'More powdery & iris bottles');
  assert.equal(T.stylesTitle(['Clean', 'Intimate'], 'all'), 'Clean and intimate, all at once');
  assert.match(clean(T.listTitleHTML(EVIL), 'title'), /^<h2 class="disc-title" tabindex="-1" data-focus="disc-title">&lt;img/);
  assert.match(T.valueFloorHTML(), /Great value only.*data-action="disc-value" data-value="off">Show all/);
  const offline = clean(T.searchErrorHTML(EVIL), 'search error');
  assert.match(offline, /Couldn’t search/);
  assert.match(offline, /data-action="disc-retry" data-value="notes"/);
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
  // Every option carries the check it shows once chosen (by its state, in discover.css), its label after it.
  const opts = [...html.matchAll(/<button type="button"[^>]*class="opt"[^>]*>([\s\S]*?)<\/button>/g)].map(m => m[1]);
  assert.equal(opts.length, 4 + 3 + 4 + 3 + 3);
  for (const o of opts) assert.match(o, /^<svg[^>]*aria-hidden="true"[\s\S]*<\/svg><span>[^<]+<\/span>$/);
  // Unset, with the gap finder's default on: the switch reads off, and its note says why.
  const byDefault = T.filtersHTML(NO_FILTERS, { preferValue: false, valueDefault: true });
  assert.match(byDefault, /role="switch" aria-checked="false" data-action="disc-value"/);
  assert.match(byDefault, /great value for money\. Insights and Fill a gap use it by default; here it’s off until you turn it on\./);
  assert.ok(!html.includes('use it by default'), 'not once it’s on');
  assert.ok(!T.filtersHTML(NO_FILTERS, { preferValue: false }).includes('use it by default'), 'nor when the default is off too');
  assert.match(T.filterButtonHTML({ ...NO_FILTERS, safe: true, lean: 'unisex' }), /aria-label="Filters, 2 on"/);
  assert.match(T.filterButtonHTML(NO_FILTERS, { value: true }), /aria-label="Filters, 1 on"/, 'Prefer great value shows on the button');
  assert.match(T.filterSheetHTML(NO_FILTERS, { preferValue: true, status: '' }), /data-action="disc-filters-reset">Reset/, 'and Reset can turn it off');
  assert.match(T.filterButtonHTML({ ...NO_FILTERS, mists: true }), /aria-label="Filters, 1 on"/, 'mists count like the rest');
  assert.ok(!/class="count"/.test(T.filterButtonHTML(NO_FILTERS)));
  clean(T.filterSheetHTML(NO_FILTERS, { preferValue: false, status: EVIL }), 'filter sheet');
  assert.match(T.filterSheetHTML(NO_FILTERS, { preferValue: false, valueDefault: true, status: '' }), /use it by default/);
  assert.equal(T.fitLine(1, 12), '1 bottle fits');
  assert.equal(T.fitLine(7, 12), '7 bottles fit');
  assert.equal(T.fitLine(12, 12), 'Showing the top 12');
  assert.equal(T.fitLine(0, 12), 'Nothing fits');
  assert.match(html, /Safe blind buys<\/b><small>Safer than most popular bottles\.<\/small>/, 'the safety percentile, not “most voters love it”');
  // A change redraws the parts; the status line keeps its node (only its text changes), so it's heard.
  const sheet = T.filterSheetHTML(NO_FILTERS, { preferValue: false, status: '12 bottles fit' });
  assert.match(sheet, /<div data-part="filters">/);
  assert.match(sheet, /role="status" data-live="filter-status">12 bottles fit</);
  assert.ok(sheet.indexOf('data-live=') > sheet.indexOf('class="sheet-bar'), 'the status sits outside what redraws');
});

test('search: names with where they are, the two readings, typos and nothing found', () => {
  const names = clean(T.namesHTML({ results: [record('n1'), record('n2')] }, new Map([['n2', `In ${EVIL}’s`]]), { wantedOf: id => id === 'n1' }), 'names');
  assert.equal((names.match(/data-action="own-result"/g) ?? []).length, 1);
  // Named by what it shows, then whose (two Aventus differ by brand): no aria-label to hide the words.
  const aventus = T.namesHTML({ results: [{ id: 'a1', name: 'Aventus', brand: 'Creed' }, { id: 'a2', name: 'Aventus', brand: 'Nish Parfum' }] }, new Map());
  const owns = [...aventus.matchAll(/<button[^>]*data-action="own-result"[^>]*>([\s\S]*?)<\/button>/g)];
  assert.equal(owns.length, 2);
  for (const [button] of owns) assert.ok(!button.includes('aria-label'), 'its label is its words');
  assert.match(owns[0][1], /<span>I own it<\/span><span class="visually-hidden">: Aventus by Creed<\/span>$/);
  assert.match(owns[1][1], /: Aventus by Nish Parfum<\/span>$/);
  assert.match(names, /data-action="disc-want" data-id="n1" aria-pressed="true"/, 'Want on every row');
  assert.match(names, /data-action="disc-want" data-id="n2" aria-pressed="false"/);
  assert.equal((names.match(/class="row wrap"/g) ?? []).length, 2, 'names get two lines');
  const toggle = T.modeToggleHTML('notes', { names: 'iris leather', notes: ['iris', 'leather'] });
  assert.match(toggle, /data-value="notes" aria-pressed="true"><span>By notes</);
  assert.match(toggle, /data-value="names" aria-pressed="false"><span>By name</);
  assert.equal(T.modeToggleHTML('notes', { names: null, notes: ['iris'] }), '', 'one reading needs no toggle');
  assert.equal(T.searchTitleHTML('notes', { query: 'x', terms: ['iris', 'leather', 'smoke'] }), '<h2 class="disc-title" tabindex="-1" data-focus="disc-title">With iris, leather and smoke</h2>');
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
  assert.match(html, /Bottles for what your wardrobe covers least\./);
  assert.match(html, /<small>&lt;img[^<]*Oud&#39;s · Fills Date Night on mild nights and 1 more<\/small>/, 'its brand, then what it fills');
  // Named as Insights names them: "everyday" is Casual's old name.
  assert.equal(T.fillsLine({ fills: [{ title: 'Daily picks on hot nights' }] }), 'Fills Daily picks on hot nights');
  assert.equal(T.fillsLine({ fills: [{ title: 'Daily picks on warm nights' }, { title: 'Casual on warm days' }, { title: 'Office on warm days' }] }), 'Fills Daily picks on warm nights and 2 more');
  assert.match(html, /href="#\/wardrobe\/insights"/);
  assert.match(T.teaserHTML({ status: 'loading', result: null }), /teaser-sk/);
  assert.equal(T.teaserHTML({ status: 'error', result: null, error: 'x' }), '');
  assert.match(T.teaserHTML({ status: 'done', result: { gaps: [], picks: [], overview: { text: 'You have a strong pick for everything.' } } }), /strong pick for everything/);
});

test('a card owned from a list keeps its place when the list is asked again without it', () => {
  const p = id => ({ id });
  const ids = list => list.map(q => q.id);
  const pins = [{ id: 'x', index: 2, pick: p('x') }];
  assert.deepEqual(ids(withPins([p('a'), p('b'), p('c'), p('d')], pins)), ['a', 'b', 'x', 'c', 'd']);
  assert.deepEqual(ids(withPins([p('a'), p('x'), p('b')], pins)), ['a', 'x', 'b'], 'one the answer has stays where the answer has it');
  assert.deepEqual(ids(withPins([p('a')], pins)), ['a', 'x'], 'past the end: last');
  // Owned in turn from [y, a, x, b, c]: each back where it was.
  assert.deepEqual(ids(withPins([p('a'), p('b'), p('c')], [pins[0], { id: 'y', index: 0, pick: p('y') }])), ['y', 'a', 'x', 'b', 'c']);
  const plain = [p('a')];
  assert.equal(withPins(plain, []), plain);
  // A pinned card renders as any other, saying where it is now.
  const card = T.picksHTML({ status: 'done', result: { picks: withPins([pick('p1')], [{ id: 'p0', index: 0, pick: pick('p0', { nearest: null, family: null }) }]) } }, { name: 'styles', ownedOf: id => (id === 'p0' ? 'In Mine' : null), empty: '' });
  assert.match(card, /data-id="p0"[\s\S]*In Mine[\s\S]*data-id="p1"/);
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
  assert.match(html, /role="status" data-live="seed-status">1 of 5 picked</, 'no count for words it didn’t search');
  // Once a search is in, the line says what it found (it's live: a screen reader hears it).
  const said = sheet => seedSheetHTML(sheet, { owned: mine, chosen: ['m2'], picked: [mine[1]] }).match(/data-live="seed-status">([^<]*)</)[1];
  const layton = [record('l1', 'Layton'), record('l2', 'Layton Exclusif')];
  assert.equal(said({ query: 'layton', searched: 'layton', results: layton }), '2 bottles from the library · 1 of 5 picked');
  assert.equal(said({ query: 'brun', searched: 'brun', results: [record('m1', 'Liquid Brun'), record('l1', 'Brun Noir')] }), '1 from the library, 1 of yours · 1 of 5 picked');
  assert.equal(said({ query: 'brun', searched: 'brun', results: [record('m1', 'Liquid Brun')] }), '1 bottle of yours · 1 of 5 picked');
  assert.equal(said({ query: 'zzqx', searched: 'zzqx', results: [] }), 'No bottles match “zzqx” · 1 of 5 picked');
  assert.equal(said({ query: 'laytonx', searched: 'layton', results: layton }), '1 of 5 picked', 'typing on: not the last search’s count');
  assert.equal(said({ query: 'layton', searched: 'layton', results: layton, busy: true }), 'Searching…');
  // Typing redraws the lists under the field, never the field (it keeps focus and the keyboard).
  assert.ok(html.indexOf('data-field="disc-seed-q"') < html.indexOf('data-part="seed-lists"'));
  assert.ok(html.indexOf('data-live=') > html.indexOf('class="sheet-bar'), 'nor the status line');
  assert.match(seedSheetHTML({ query: '' }, { owned: [], chosen: [] }), /Your wardrobe is empty/);
  // A library hit just picked shows under Picked while its record loads (the stub), and a lost one too.
  const stub = { id: 'l1', name: 'Brun Noir', brand: 'X', stub: true };
  const picking = seedSheetHTML({ query: 'brun', results: [stub] }, { owned: mine, chosen: ['l1', 'gone'], picked: [stub, { id: 'gone', missing: true, name: 'Not found' }] });
  assert.match(picking, /Picked<\/p><ul class="rows seed-rows"><li class="row"><button class="row-main seed-pick" data-action="disc-seed-toggle" data-id="l1" aria-pressed="true"/);
  assert.match(picking, /data-id="gone" aria-pressed="true"[\s\S]*The library couldn’t find it/);
  // Before the favorites it starts from are in: nothing to toggle yet.
  const early = seedSheetHTML({ query: '' }, { owned: mine, chosen: [], picked: [null, null, null], loading: true });
  assert.match(early, /Loading your favorites…/);
  assert.equal((early.match(/aria-disabled="true"/g) ?? []).length, mine.length);
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
