// The bottle page's sections in their own modules (src/views/bottle-*.js)
// and the compare page (src/views/compare.js): every template renders clean
// with a hostile bottle name, empty data renders nothing (or a skeleton while
// it loads), owned and not-owned bottles get the sections that fit them, and
// the compare route parses and round-trips.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SECTIONS, bottlePageHTML, pooled, sectionsFor, linkId, likedStyleIds, likedTaste } from '../src/views/bottle.js';
import { state, computeToday, nowSlot, keepBottles } from '../src/app/state.js';
import '../src/views/sections.js';
import { buyCheckHTML, checkable, fillGroups } from '../src/views/bottle-check.js';
import { sprayHTML, figureSVG, sprayCount } from '../src/views/bottle-spray.js';
import { skinHTML, moveText, listLabel, ordinal, sprayText } from '../src/views/bottle-skin.js';
import { stylesHTML } from '../src/views/bottle-styles.js';
import { dupesHTML } from '../src/views/bottle-dupes.js';
import { crowdHTML, riskLine, wholePercents } from '../src/views/bottle-crowd.js';
import { reviewsHTML } from '../src/views/bottle-reviews.js';
import {
  compareHTML, compareModel, relation, leader, verdictHTML, pickerLists, pickerHTML, pickerMatches, pickerStatus, andList, compare as comparePage, MAX_COMPARE,
} from '../src/views/compare.js';
import { parseRoute, routeHash, compareIds } from '../src/app/router.js';
import { shareToken, customRecord } from '../src/custom.js';
import { rank, comfortRange } from '../src/engine.js';
import { occasionById } from '../src/occasions.js';
import { summarize } from '../src/weather.js';
import { esc, matchPct } from '../src/ui.js';
import { icon } from '../src/ui/components.js';
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
  const bad = html.search(/\bundefined\b|\bNaN\b|\[object Object\]/);
  assert.ok(bad < 0, `${what} renders undefined, NaN or an object: …${html.slice(Math.max(0, bad - 120), bad + 40)}`);
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
  // Shopping for a bottle, what it smells like comes before how to wear it.
  const shop = sectionsFor({ owned: false, inMine: false }).map(s => s.id);
  const at = id => shop.indexOf(id);
  assert.ok(at('check') < at('accords') && at('accords') < at('notes') && at('notes') < at('dupes') && at('dupes') < at('crowd') && at('reviews') < at('spray') && at('spray') < at('layering'), shop.join(' '));
  assert.deepEqual(sectionsFor({ owned: true }).map(s => s.id), SECTIONS.map(s => s.id), 'a bottle you own keeps the slots');
});

test('a whole page renders clean, owned or not', () => {
  const owned = clean(bottlePageHTML(modelOf(evil, { skin: { rating: 4, longevity: 1, sillage: 0 } })), 'an owned bottle');
  assert.match(owned, /On your skin/);
  assert.match(owned, /How much to spray/);
  assert.match(owned, /What voters say/);
  assert.match(owned, /Pros and cons/);
  assert.ok(!owned.includes('For David'), 'no buy check for a bottle you own');
  assert.match(owned, /data-action="bp-compare"/, 'Compare is among the actions');
  assert.ok(!owned.includes('data-action="bp-want"'), 'no Want for a bottle you own');

  assert.match(owned, /<div class="bp-slot" data-section="check"><\/div>/, 'every section has its slot, empty or not');
  assert.match(owned, /<div class="bp-panel" role="dialog" aria-modal="true"/, 'a dialog is a div: an article can’t take role=dialog');
  assert.match(bottlePageHTML(modelOf(evil), { modal: false }), /<article class="bp-panel" aria-labelledby/, 'docked, it’s an article');
  assert.match(owned, /id="bp-spray"/, 'Now’s spray line finds the spray guide');

  const other = clean(bottlePageHTML(modelOf(stranger, { owned: false, active: false, entry: null, solo: true, wanted: true })), 'a bottle you don’t own');
  assert.ok(!other.includes('On your skin'), 'no skin section for a bottle you don’t own');
  assert.ok(other.indexOf('Main accords') < other.indexOf('How much to spray'), 'what it smells like before how to spray it');
  assert.match(other, /data-action="bp-want" data-id="9828" aria-pressed="true"/, 'Want shows as on');
  assert.match(other, /aria-busy="true"/, 'the pool-backed sections show a skeleton until they’re asked');
});

test('why it ranks here: the rating bar says whose rating it is, and a bottle nobody rated has none', () => {
  const night = rec => rank([rec], wx.night, 'night', { history: [], todayISO: wx.night.dateISO })[0];
  const why = rec => {
    const html = bottlePageHTML(modelOf(rec, { entry: night(rec) }));
    return html.slice(html.indexOf('data-section="why"'), html.indexOf('data-section="alts"'));
  };
  const f = byName('Liquid Brun');
  assert.match(why(f), /bar-label">Rating</, 'the crowd’s rating');
  assert.ok(!why(f).includes('Crowd rating'));
  const yours = why({ ...f, personal: { rating: 1, longevity: 0, sillage: 0 } });
  assert.match(yours, /bar-label">Your rating</, 'your stars lead it once you rate it');
  assert.ok(!/bar-label">Rating</.test(yours));
  const byHand = customRecord({ name: 'Rose', accords: ['rose', 'musky'] });
  assert.match(why(byHand), /bar-label">Season</);
  assert.ok(!/bar-label">(Your r|R)ating</.test(why(byHand)), 'no crowd, no rating bar');
  assert.match(why({ ...byHand, personal: { rating: 5, longevity: 0, sillage: 0 } }), /bar-label">Your rating</);
  // Every bar says what its number is.
  assert.ok([...why(f).matchAll(/bar-value">([^<]*)</g)].every(([, v]) => /^\d+%$/.test(v)), 'bars read as percents');
  // A recent wear: what it takes off, in the app's words (rotation is the on/off switch).
  const worn = rec => {
    const e = rank([rec], wx.night, 'night', { history: [{ id: rec.id, date: '2026-09-25', slot: 'night' }], todayISO: wx.night.dateISO })[0];
    const html = bottlePageHTML(modelOf(rec, { entry: e }));
    return [e, html.slice(html.indexOf('data-section="why"'), html.indexOf('data-section="alts"'))];
  };
  const [e, rest] = worn(f);
  assert.ok(e.parts.rotation > 0);
  assert.ok(rest.includes(`Worn 3 days ago: ${Math.round(e.parts.rotation * 100)}% lower so others get a turn.`), rest);
  assert.ok(!/rotation/i.test(rest));
  const planned = rank([f], wx.night, 'night', { history: [{ id: f.id, date: wx.night.dateISO, slot: 'day', planned: true }], todayISO: wx.night.dateISO })[0];
  assert.match(bottlePageHTML(modelOf(f, { entry: planned })), /Already picked for daytime: \d+% lower so others get a turn\./);
});

test('day and night read as whole percents that add up to 100, as Compare shows them', () => {
  const dn = f => [...bottlePageHTML(modelOf(f)).matchAll(/bar-label">(day|night)<[^]*?bar-value">(\d+)%</g)].map(m => [m[1], Number(m[2])]);
  // Détour Noir's .475 / .525 read 48 and 53 when each rounds alone.
  assert.deepEqual(dn(byName('Détour Noir')), [['day', 47], ['night', 53]]);
  for (const f of fragrances) assert.equal(dn(f).reduce((a, [, v]) => a + v, 0), 100, f.name);
});

test('notes listed flat show under their heading alone, and estimated seasons say so in words', () => {
  const section = (html, id) => html.slice(html.indexOf(`data-section="${id}"`), html.indexOf('</section>', html.indexOf(`data-section="${id}"`)));
  const flat = section(bottlePageHTML(modelOf({ ...byName('Liquid Brun'), notes: { all: ['Vanilla', 'Musk'] } })), 'notes');
  assert.match(flat, /<h3>Notes<\/h3><div class="notes">/);
  assert.ok(!flat.includes('layer-label'), 'no "Notes" under "Notes"');
  assert.match(section(bottlePageHTML(modelOf(byName('Liquid Brun'))), 'notes'), /layer-label">Top</);
  const byHand = customRecord({ name: 'Rose', accords: ['rose', 'musky'] });
  assert.match(bottlePageHTML(modelOf(byHand, { entry: null })), /Time of day, estimated/);
  assert.match(bottlePageHTML(modelOf(byHand, { entry: null })), /<h3>Seasons, estimated<\/h3>/, 'both halves say they’re estimated');
  assert.ok(!bottlePageHTML(modelOf(byHand, { entry: null })).includes('Season fit'));
});

test('also good: only today, tonight and tomorrow go lower case in its heading', () => {
  const alts = ranked.filter(r => r.fragrance.id !== evil.id).slice(0, 4);
  const head = label => bottlePageHTML(modelOf(evil, { alts, ctxLabel: label })).match(/Also good for ([^<]*)</)?.[1];
  assert.equal(head('Tonight'), 'tonight');
  assert.equal(head('Saturday night'), 'Saturday night');
  assert.equal(head('Formal · Saturday night'), 'Formal · Saturday night');
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

test('a pooled answer: replaced on its channel it’s asked again, a changed question keeps the old answer meanwhile, a record counts by id', async () => {
  state.route = { dest: 'bottle', arg: 'my:x~token', query: {} };
  let renders = 0, asked = [], reply = () => ({ n: asked.length });
  const app = { renderBottle: () => renders++ };
  const ask = async (type, payload) => { asked.push(payload); return reply(payload); };
  let liked = ['skin'];
  const answers = pooled('check', 'test-check', m => ({ record: m.f }), { ask, prepare: async () => ({ liked }) });
  const model = { f: { id: 'my:x', accords: { woody: 80 }, notes: { all: ['a'] } }, arg: 'my:x~token' };
  await answers.ask(model, app);
  assert.equal(answers.get('my:x').status, 'ready');
  assert.deepEqual(asked[0].liked, ['skin'], 'what prepare adds is sent');
  assert.equal(asked[0].record, model.f, 'the record itself is sent');
  assert.equal(renders, 1, 'drawn against the route’s argument (a hand-entered bottle’s token)');
  await answers.ask({ ...model, f: { ...model.f, notes: { all: ['a', 'b'] } } }, app);
  assert.equal(asked.length, 1, 'more notes on the same bottle don’t ask again');

  // The liked styles change: asked again, the old answer on screen until the new one lands.
  liked = ['clean'];
  let release;
  reply = () => new Promise(resolve => { release = () => resolve({ n: 2 }); });
  const pending = answers.ask(model, app);
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual([answers.get('my:x').status, answers.get('my:x').result.n], ['loading', 1], 'the old answer stays, dimmed');
  release();
  await pending;
  assert.deepEqual([answers.get('my:x').status, answers.get('my:x').result.n], ['ready', 2]);

  // A newer question on the channel (another bottle's) replaced it: nothing kept, asked again next time.
  liked = ['woody'];
  reply = () => ({ stale: true });
  await answers.ask(model, app);
  assert.equal(answers.get('my:x'), undefined, 'a stale answer is dropped');
  reply = () => ({ n: 4 });
  await answers.ask(model, app);
  assert.equal(answers.get('my:x').result.n, 4, 'and asked again on return');
  state.route = null;
});

test('an answer landing after the record swapped for its own r/ record draws its section alone; one that brings signals draws the page', async () => {
  // A pool record (8 notes, its signals) open on its page; loadFullRecord swaps in its r/ record, keeping them.
  const pooledRecord = { ...byName('Liquid Brun'), id: '9828', name: 'Aventus', source: 'fragrantica', about: undefined, original: null, extras: { value: 2.1 } };
  state.bottles.set('9828', pooledRecord);
  state.route = { dest: 'bottle', arg: '9828', query: {} };
  const drawn = [];
  const panel = { getBoundingClientRect: () => ({ top: 0 }) };
  const slot = { getBoundingClientRect: () => ({ top: 400 }), closest: () => panel, contains: () => false, nextElementSibling: null, set innerHTML(html) { drawn.push(html); } };
  globalThis.document = { querySelector: sel => (sel === '#bottle [data-section="notes"]' ? slot : null), activeElement: null };
  let whole = 0, release;
  const app = { renderBottle: () => whole++, refocus: () => true, inSight: () => true };
  const answers = pooled('check', 'test-swap', m => ({ id: m.f.id }), { section: 'notes', ask: () => new Promise(r => { release = () => r({ n: 1 }); }) });
  try {
    const asking = answers.ask({ f: pooledRecord, arg: '9828' }, app);
    await new Promise(r => setTimeout(r, 0));
    keepBottles([{ ...pooledRecord, extras: undefined, notes: { top: ['Bergamot'], mid: ['Birch'], base: ['Musk'] } }]);
    assert.notEqual(state.bottles.get('9828'), pooledRecord, 'swapped');
    release();
    await asking;
    assert.equal(whole, 0, 'the page isn’t drawn again: it was when the record landed');
    assert.equal(drawn.length, 1, 'only the section');
    assert.match(drawn[0], /Birch/, 'from the record as it is now');

    // An r/ record (no signals) whose answer brought them: the crowd block reads them, so the page.
    const bare = { ...pooledRecord, id: '9829', extras: undefined };
    state.bottles.set('9829', bare);
    state.route = { dest: 'bottle', arg: '9829', query: {} };
    const signals = answers.ask({ f: bare, arg: '9829' }, app);
    await new Promise(r => setTimeout(r, 0));
    keepBottles([{ ...bare, extras: { value: 2.1 } }]);
    release();
    await signals;
    assert.equal(whole, 1, 'the whole page');
  } finally {
    delete globalThis.document;
    state.bottles.clear();
    state.route = null;
  }
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

  const loading = clean(buyCheckHTML(m, undefined), 'loading');
  assert.match(loading, /aria-busy="true"/);
  assert.match(loading, /bc-sk-row/, 'the skeleton stands about as tall as an answer');
  const error = clean(buyCheckHTML(m, { status: 'error', error: EVIL }), 'error');
  assert.match(error, /data-action="bp-check-retry" data-id="9828"/);
  assert.ok(error.includes(esc(EVIL)));

  const html = clean(buyCheckHTML(m, { status: 'ready', result: check }, { who: 'David’s wardrobe', wants: [{ id: '34696' }] }), 'ready');
  assert.match(html, /Would it suit David’s wardrobe\?/);
  assert.match(html, /class="bc-verdict" data-tone="strong">Strong fit/);
  assert.equal((html.match(/smells like it, for far less/g) ?? []).length, 0, 'the twin’s line isn’t repeated as a reason');
  assert.ok(!html.includes('It would be your best for &lt;'), 'the fill line isn’t repeated by its chips');
  assert.ok(!html.includes('Closest to your'), 'nor the closest bottle by its row');
  assert.equal((html.match(/class="fill-chip( first)?"/g) ?? []).length, 4, 'at most four fills');
  assert.match(html, /\+1 more/);
  assert.match(html, /Closest you own · 62% alike/);
  assert.match(html, /data-action="bp-want" data-id="34696" aria-pressed="true"/, 'the twin can be wanted, and shows that it is');
  assert.match(html, /data-action="open" data-ctx="night" data-id="34696"/, 'the twin opens its page');
  assert.match(html, /Smells like it, for less · Great value/, 'value in words, as every section says it');

  // Seven groups of fills: "+3 more", never "3 mores".
  const many = buyCheckHTML(m, { status: 'ready', result: { ...check, fills: ['Formal', 'Office', 'Casual', 'Cozy', 'Date Night', 'Night Out', 'Outdoors'].map((u, i) => ({ title: `${u} on cold nights`, first: i < 2 })) } });
  assert.match(many, /\+3 more/);
  assert.ok(!/mores/.test(many));
  assert.match(many, /It would be your best for/);
  assert.match(many, /And a strong second for/);

  // Far from anything owned: no "closest" row, and its reason stays.
  const far = buyCheckHTML(m, { status: 'ready', result: { ...check, fills: [], overlap: { ...check.overlap, sim: 0.49 }, twin: null } });
  assert.ok(!far.includes('bc-rows'), 'nothing near enough to name');
  assert.match(far, /Closest to your/);
  assert.match(far, /It would be your best for/, 'without chips the fill line stays');

  const covered = buyCheckHTML(m, { status: 'ready', result: { ...check, verdict: 'Covered', fills: [], overlap: null, twin: null } }, { who: 'My collection' });
  assert.match(covered, /data-tone="neutral">Covered/, 'a verdict it doesn’t know reads neutral');
  assert.match(covered, /Would it suit your collection\?/);
  const linked = buyCheckHTML(m, { status: 'ready', result: { ...check, overlap: { ...check.overlap, sim: 0.4, link: `Voters call it a twin of ${EVIL}` } } });
  assert.match(clean(linked, 'linked'), /Voters link them · 40% alike/, 'voters’ link is named however alike');
  assert.ok(!covered.includes('bc-rows'));
  assert.match(buyCheckHTML(m, { status: 'loading', result: check }), /bc-card bp-refreshing/, 'asked again, the old answer dims');

  // The styles you like that it adds to, unless a reason says so already.
  const liked = buyCheckHTML(m, { status: 'ready', result: { ...check, likedShown: ['skin', 'intimate'] } });
  assert.match(liked, /Styles you like: Skin scent and Intimate/);
  const said = buyCheckHTML(m, { status: 'ready', result: { ...check, reasons: ['More of the skin scents you like: you own two.'], likedShown: ['skin'] } });
  assert.ok(!said.includes('A style you like'));
  // Styles only guessed from the bottles: ones you reach for, and never the Want heart.
  const leaning = buyCheckHTML(m, { status: 'ready', result: { ...check, likedShown: ['vanilla'] } }, { stated: false });
  assert.match(leaning, /class="bc-liked leaning"/);
  assert.match(leaning, /A style you reach for: Vanilla/);
  assert.ok(!leaning.includes('you like'));
  const reached = buyCheckHTML(m, { status: 'ready', result: { ...check, reasons: ['More of the vanilla scents you reach for: you own one.'], likedShown: ['vanilla'] } }, { stated: false });
  assert.ok(!reached.includes('bc-liked'), 'the reason says it already');
  for (const html of [liked, leaning]) assert.ok(!html.includes(icon.heartFill), 'the heart means Want');
});

test('fills group by use and time of day', () => {
  assert.deepEqual(fillGroups([
    { title: 'Formal on cold nights', first: false }, { title: 'Formal on cool nights', first: true },
    { title: 'Date Night on mild nights' }, { title: 'Date Night on hot nights' }, { title: 'Date Night on warm nights' },
    { title: 'Office on cold days' }, { title: 'Daily picks on any night' }, { title: 'Office on hot days' }, { title: 'Office on cool days' },
  ]), [
    { title: 'Formal · cold and cool nights', first: true },
    { title: 'Date Night · mild to hot nights', first: false },
    { title: 'Office · cold, cool and hot days', first: false },
    { title: 'Daily picks on any night', first: false },
  ]);
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
  const saturday = sprayHTML(modelOf(evil, { occasion: occasionById('date'), win: { ...wx.night, label: 'Saturday night' } }));
  assert.match(saturday, /Date Night · Saturday night/, 'only today, tonight and tomorrow go lower case');
  const sky = byName('Shiyaaka Sky');
  const louder = sprayHTML(modelOf(sky, { skin: { rating: null, longevity: 0, sillage: 1 } }));
  assert.match(louder, /projects more on you/i, 'your skin nudges change the advice');
  assert.notEqual(louder, sprayHTML(modelOf(sky)));
  assert.equal((figureSVG(['wrists']).match(/class="spot"/g) ?? []).length, 2, 'both wrists');
  assert.match(figureSVG(['collar or scarf']), /spot hollow/);
  assert.deepEqual([sprayCount({ sprays: [1, 1] }), sprayCount({ sprays: [2, 3] })], ['1 spray', '2–3 sprays']);
});

// ---------- On your skin ----------

test('on my skin: stars, nudges and where the bottle moved', () => {
  assert.equal(skinHTML(modelOf(stranger, { owned: false })), '');
  const html = clean(skinHTML(modelOf(evil, { skin: { rating: 3, longevity: -1, sillage: 1 } }), `Now 2nd ${EVIL}`), 'skin');
  assert.equal((html.match(/role="radio"/g) ?? []).length, 5);
  assert.match(html, /aria-checked="true" tabindex="0" data-action="bp-skin-rate" data-value="3"/);
  assert.equal((html.match(/class="skin-star lit"/g) ?? []).length, 3);
  assert.match(html, /data-action="bp-skin-clear"/);
  assert.match(html, /data-action="bp-skin-lasts" data-value="-1" aria-pressed="true"/);
  assert.match(html, /data-action="bp-skin-projects" data-value="1" aria-pressed="true"/);
  assert.ok(!html.includes('role="status"'), 'the line is drawn anew each time; #bp-status, which outlasts the page, says it');
  // One person throughout: what you see is what a screen reader hears.
  assert.match(html, /How long it lasts on you<\/span>[^]*aria-label="How long it lasts on you"/);
  assert.match(html, /How far it projects on you<\/span>[^]*aria-label="How far it projects on you"/);
  assert.ok(!/\bon me\b|On my skin/.test(html));
  const unrated = skinHTML(modelOf(evil));
  assert.ok(!unrated.includes('bp-skin-clear'));
  assert.match(unrated, /tabindex="0" data-action="bp-skin-rate" data-value="1"/, 'one tab stop, on the first star');
  assert.match(unrated, /bp-skin-lasts" data-value="0" aria-pressed="true"/, 'as expected until told otherwise');

  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd']);
  assert.equal(moveText(1, 3, 'for tonight'), 'Now 3rd for tonight, was 1st.');
  assert.equal(moveText(2, 2, 'for tonight'), 'Still 2nd for tonight.');
  assert.equal(moveText(1, null, 'for tonight'), '');
  // A nudge that leaves the count where it was says so, not "updated".
  assert.equal(sprayText('1–2 sprays', '1–2 sprays'), 'Spray guide unchanged: 1–2 sprays.');
  assert.equal(sprayText('1–2 sprays', '1 spray'), 'Now 1 spray, was 1–2.');
  assert.equal(sprayText('2 sprays', '3 sprays'), 'Now 3 sprays, was 2.');
  assert.equal(sprayText(null, null), '');
  assert.equal(listLabel(wx.night, null), 'for tonight');
  assert.equal(listLabel(wx.night, occasionById('date')), 'for date night tonight');
  assert.equal(listLabel({ label: 'Friday night' }, null), 'for Friday night');
});

// ---------- Styles ----------

test('styles link to Discover, and a quiet bottle is Intimate, which wears close', () => {
  const skin = stylesHTML(modelOf(byName('Sandalwood & Musk')));
  assert.match(skin, /href="#\/discover\?styles=skin"/);
  assert.match(skin, /Skin scent/);
  const close = stylesHTML(modelOf(byName('Shiyaaka Sky')));
  assert.match(close, /<b>Intimate<\/b>.*Wears close: people notice it/s);
  assert.match(close, /href="#\/discover\?styles=intimate"/);
  assert.equal(stylesHTML(modelOf({ ...evil, accords: {} })), '');
  assert.deepEqual(parseRoute('#/discover?styles=skin,clean', { discover: [] }).query, { styles: 'skin,clean' }, 'the router keeps the styles');
  clean(stylesHTML(modelOf(evil)), 'styles');
  // A style you said you like says so; one only guessed from your bottles is one you reach for. No heart: it means Want.
  const said = stylesHTML(modelOf(byName('Sandalwood & Musk')), ['skin'], { stated: true });
  assert.match(said, /style-row liked/);
  assert.match(said, /You like it/);
  const guessed = stylesHTML(modelOf(byName('Sandalwood & Musk')), ['skin'], { stated: false });
  assert.match(guessed, /You reach for it/);
  assert.ok(!guessed.includes('You like it') && !guessed.includes('style-row liked'));
  for (const html of [said, guessed]) assert.ok(!html.includes(icon.heartFill), 'the heart means Want');
});

// ---------- Smells like ----------

const entry = (id, extra = {}) => ({
  id, record: { ...evil, id }, name: EVIL, brand: EVIL, value: 4.1, rating: 4.2, votes: 900, risk: { level: 'low', reasons: [] },
  sim: 0.8, owned: false, up: 1200, down: 30, why: 'votes', ...extra,
});

test('smells like: the original, cheaper twins and siblings, each opening its page or a comparison', () => {
  const m = modelOf(stranger, { owned: false });
  assert.match(clean(dupesHTML(m, undefined), 'loading'), /aria-busy="true"/);
  // Not asked yet, its skeleton holds still (the reader may never scroll to
  // it); it shimmers only while the question is out.
  assert.match(dupesHTML(m, undefined), /class="bp-section bp-waiting"/);
  assert.ok(!dupesHTML(m, { status: 'loading', result: null }).includes('bp-waiting'));
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
  assert.match(html, /1,200 say it smells like it · Great value/, 'what the count counts');
  assert.match(html, /Alike by its notes/);
  assert.match(html, /You own it/);
  assert.match(html, /You own it · 1,200 say it smells like it · Great value · Risky/, 'risk in the word every screen uses');
  assert.ok(!html.includes('Risky blind buy'));
  assert.match(html, /<span>Compare<\/span>/, 'the compare link says what it does');
  assert.match(html, /id="bp-dupes"/, 'Discover’s Similar & cheaper scrolls here');
  assert.equal((html.match(/<li class="row/g) ?? []).length, 6, 'four cheaper at most, the original and a sibling');
  assert.match(html, /“smells like” votes, via Le Decanteur’s dataset/, 'credited, the dataset too');

  // A sibling the pool sent no votes for: the page's own top five, else "voters link them".
  const quiet = { ...result, original: null, cheaper: [], siblings: [entry('7', { up: null, down: null }), entry('8', { up: null, down: null })] };
  const counted = dupesHTML(modelOf(stranger, { owned: false, about: { smellsLike: [{ id: 7, up: 321, down: 4 }] } }), { status: 'ready', result: quiet });
  assert.match(counted, /321 say it smells like it · Great value/);
  assert.match(counted, /Voters link them · Great value/);
  // A bottle the library has nothing on (newer than the dataset): nothing to show, not an error.
  assert.equal(dupesHTML(m, { status: 'error', error: 'That bottle isn’t in the fragrance library.' }), '');
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
  assert.ok(!html.includes('Blind buy'), 'a bottle you own isn’t a blind buy');
  const owners = (f.about.owners.have + f.about.owners.had).toLocaleString('en-US');
  assert.ok(html.includes(`<b>92%</b><span>of ${owners} owners`), 'kept says it once');
  assert.ok(!/\d+(\.\d)?K\b/.test(html), 'counts in full, as the votes beside them are: one format in the card');
  assert.match(html, /Top 1%/);
  assert.equal((html.match(/class="crowd-hist-fill"/g) ?? []).length, 5);
  assert.match(html, /love or like it/);
  // The headline agrees with its bars: 52.6% + 26.6% rounds to 79 but the bars say 53 and 27.
  const hist = { love: 526, like: 266, ok: 110, dislike: 58, hate: 40 };
  const said = crowdHTML(modelOf({ ...stranger, extras: undefined, sentiment: hist }, { about: null }));
  const bars = [...said.matchAll(/crowd-hist-value">(\d+)%/g)].map(m => Number(m[1]));
  assert.equal(bars.reduce((a, b) => a + b, 0), 100, 'the bars add up');
  assert.match(said, new RegExp(`>${bars[0] + bars[1]}% love or like it`));
  assert.deepEqual(wholePercents([1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(wholePercents([0, 0]), [0, 0]);
  assert.match(html, /left:\d+(\.\d)?%/, 'the lean has a place on its scale');
  assert.match(html, /Voters call it masculine/);
  assert.match(crowdHTML(modelOf(evil, { owned: false })), /Blind buy/);
  assert.match(html, /Le Decanteur’s dataset/);
  assert.ok(html.includes(`By ${esc(EVIL)}`));

  const loading = crowdHTML(modelOf({ ...stranger, extras: undefined, sentiment: undefined }, { about: undefined }));
  assert.match(loading, /aria-busy="true"/, 'a dataset bottle waits for its about data');
  assert.equal(crowdHTML(modelOf({ id: 'my:x', name: 'Mine', accords: { woody: 80 }, season: {}, dayNight: {} })), '', 'a hand-entered bottle has nothing to say');
  const quiet = crowdHTML(modelOf({ ...stranger, extras: undefined, sentiment: undefined }, { about: null }));
  assert.equal(quiet, '', 'a bottle the dataset knows nothing more about');
  const pricey = crowdHTML(modelOf({ ...stranger, extras: { value: 1.7, flags: ['polarizing'], safe: 5, now: 20 }, sentiment: undefined }, { about: null, owned: false }));
  assert.match(pricey, /Pricey/);
  assert.match(pricey, /It divides people/);
  assert.match(pricey, /Not much/);
  const offline = crowdHTML(modelOf({ ...stranger, extras: undefined, sentiment: undefined }, { about: undefined, aboutFailed: true }));
  assert.match(offline, /Can’t reach the fragrance library/);
  assert.match(offline, /data-action="bottle-retry"/, 'a skeleton that never ends becomes Try again');
});

test('a blind buy’s words never contradict its reason', () => {
  const base = { ...stranger, about: null, extras: { value: 3.5, safe: 63, keep: 0, flags: [] } };
  const at = (extras, about = null) => riskLine({ ...base, extras: { ...base.extras, ...extras } }, about);
  assert.deepEqual(at({}), { level: 'low', word: 'Safe bet', line: 'Safer than 63% of popular bottles' });
  assert.deepEqual(at({ safe: 37 }), { level: 'low', word: 'Fair bet', line: 'Less safe than most popular bottles' }, 'under half the pool is no safe bet');
  assert.deepEqual(at({ safe: 80, flags: ['reformulated'] }), { level: 'low', word: 'Safe bet', line: 'Safer than 80% of popular bottles, though reviewers say it was reformulated' });
  const low = at({ safe: 15 });
  assert.equal(low.word, 'Fair bet', 'fewer voters love it than most: a fair bet at best');
  assert.match(low.line, /Less safe than most popular bottles, though fewer voters love it than most/);
  const divisive = at({ safe: 5, flags: ['polarizing', 'notBlindBuy'] });
  assert.equal(divisive.word, 'Risky');
  assert.equal(divisive.line, 'It divides people');
  assert.equal(riskLine({ ...stranger, extras: undefined, about: undefined }), null, 'nothing to go on');
});

// ---------- Pros and cons ----------

test('pros and cons are Fragrantica members’ summary, credited', () => {
  const html = clean(reviewsHTML(modelOf(evil)), 'reviews');
  assert.match(html, /Fragrantica members’ summary/);
  assert.equal((html.match(/Fragrantica members’/g) ?? []).length, 1, 'credited once');
  assert.match(reviewsHTML(modelOf(stranger, { about: undefined, aboutFailed: true })), /data-action="bottle-retry"/);
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
  assert.equal(relation(brun, althair).kind, 'dupe');
  const a = { ...byName('Sauvage') }, b = { ...byName('Aristo') };
  const voted = relation(a, b, { smellsLike: [{ id: Number(b.id), up: 40, down: 3 }] });
  assert.match(voted.text, /40 voters say Sauvage smells like Aristo/);
  assert.equal(voted.kind, 'voted');
  const plain = relation(a, b);
  assert.ok(plain.sim >= 0 && plain.sim <= 1);
  assert.match(plain.text, /^Sauvage and Aristo: .+ by their accords and notes\.$/);
  assert.equal(plain.kind, 'alike');
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
    pairs: [{ a: f1, b: f2, text: `${EVIL} and ${EVIL}: close by their accords and notes.`, sim: 0.7, kind: 'alike' }],
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
  assert.match(html, /70% alike/, 'a likeness says what its number is');
  assert.match(html, /cmp-verdict/);
  assert.ok(/Wear <i>|suits tonight best|Close call/.test(html));
  assert.match(html, /Pick for tonight/);
  assert.match(html, /class="cmp-strip"/, 'the strip of photos for when the cards scroll away');
  assert.match(html, /cmp-row stack/, 'accords and seasons stack on phones');
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

  // One bottle: an empty column asks for another, from its family.
  const family = { original: { id: '77', record: { ...evil, id: '77' } }, cheaper: [], siblings: [] };
  const alone = clean(compareHTML({ ...m, ids: ['1'], bottles: [m.bottles[0]], family }), 'alone');
  assert.match(alone, /style="--n:2"/);
  assert.match(alone, /cmp-head cmp-add/);
  assert.match(alone, /data-action="cmp-pick" data-id="77"/);
  assert.ok(!alone.includes('cmp-table'), 'no table for one bottle');

  // Waiting on the forecast: skeletons where the match and the verdict go.
  const waiting = clean(compareHTML({ ...m, now: null, occ: null, tonight: null, waiting: true }), 'waiting');
  assert.equal((waiting.match(/class="cmp-row" aria-busy="true"/g) ?? []).length, 2);
  assert.match(waiting, /cmp-verdict" aria-busy="true"/);

  // Back to the bottle page it came from, Undo for a removal, Try again for a bottle that didn't load.
  assert.match(compareHTML({ ...m, back: { dest: 'bottle', arg: '1', query: {} } }), /data-action="cmp-back"/);
  assert.match(compareHTML({ ...m, bottles: [m.bottles[0], m.bottles[1], { id: '5', f: null, status: 'failed', owned: false }] }), /data-action="cmp-retry" data-id="5"/);
});

test('compare marks one leader by the value it shows, and calls lasting and loud by name', () => {
  const b = (id, v) => ({ id, f: { id, v } });
  assert.equal(leader([b('a', 0.66), b('b', 0.66)], f => f.v), null, 'a tie as shown leads nobody');
  assert.equal(leader([b('a', 0.66), b('b', 0.6)], f => f.v), 'a');
  assert.equal(leader([b('a', 0.66)], f => f.v), null, 'one bottle leads nothing');
  const f1 = { ...evil, id: '1' }, f2 = { ...byName('Sauvage') };
  const ms = new Map([[f1.id, { score: 0.661, reasons: [] }], [f2.id, { score: 0.664, reasons: [] }]]);
  const html = compareHTML({
    ids: [f1.id, f2.id], bottles: [{ id: f1.id, f: f1, status: 'ready', owned: true }, { id: f2.id, f: f2, status: 'ready', owned: false }],
    now: { win: wx.night, entries: ms }, occ: null, tonight: null, pairs: [], about: () => null,
  });
  const row = id => html.slice(html.indexOf(`aria-labelledby="${id}"`), html.indexOf('</section>', html.indexOf(`aria-labelledby="${id}"`)));
  assert.match(row('cmp-now'), /66%[^]*66%/);
  assert.ok(!row('cmp-now').includes('cmp-lead-tag'), '66% and 66% lead nobody');
  assert.match(html, /cmp-lead-tag">(Longest|Loudest)</, 'performance leads are named, not "best"');

  // A bottle Parfumo lacks shows an estimate from Fragrantica's votes, marked, and never leads one Parfumo rates.
  const rated = byName('Liquid Brun'), guess = { ...byName('Terra'), id: 'x1', name: 'Zenith', parfumo: undefined };
  const page = (...fs) => compareHTML({
    ids: fs.map(f => f.id), bottles: fs.map(f => ({ id: f.id, f, status: 'ready', owned: false })),
    now: null, occ: null, tonight: null, pairs: [], about: () => null,
  });
  const mixed = page(rated, guess);
  const lasts = mixed.slice(mixed.indexOf('aria-labelledby="cmp-lasts"'), mixed.indexOf('aria-labelledby="cmp-projects"'));
  assert.match(lasts, /≈ 8\.6<small> of 10<\/small><span class="visually-hidden">, estimated from Fragrantica votes/);
  assert.match(lasts, />8\.4<small> of 10/, 'Parfumo’s own rating stands as it is');
  assert.ok(!lasts.includes('cmp-cell lead'), 'an estimate doesn’t outlast a real rating');
  assert.match(mixed, /estimated \(≈\) from Fragrantica votes where Parfumo lacks the bottle/);
  assert.ok(!page(rated, byName('Sauvage')).includes('≈'), 'all on Parfumo: no estimates, none credited');
  const guesses = page(guess, { ...byName('Jake'), parfumo: undefined });
  assert.match(guesses, /cmp-lead-tag">Longest</, 'estimates lead each other');
  // The bottle page says it with the same words.
  assert.match(bottlePageHTML(modelOf(rated)), /Lasts 8\.4 · Projects \d\.\d <span>of 10 on/);
  assert.match(bottlePageHTML(modelOf(guess)), /Lasts 4\.0 of 5 · Projects 2\.9 of 4 <span>on Fragrantica/);
});

test('tonight’s pick is a bottle you own when one is among them', () => {
  const layton = { ...byName('Liquid Brun'), id: '900', name: 'Layton', original: null };
  const dupe = { ...byName('Liquid Brun'), original: { id: 900, name: 'Layton', brand: 'Parfums de Marly' } };
  const entry = (f, score) => ({ fragrance: f, score, reasons: [{ tone: 'good', text: 'fits fall weather' }] });
  const tonight = { win: wx.night, ranked: [entry(layton, 0.88), entry(dupe, 0.87)] };
  const pairs = [{ a: dupe, b: layton, ...relation(dupe, layton) }];
  const mine = verdictHTML(tonight, new Set([dupe.id]), pairs);
  assert.match(mine, /Wear <i>Liquid Brun<\/i>/);
  // Tonight's numbers, both of them (the rows may show today's), and no "points".
  assert.match(mine, /The best of yours tonight, \d+% match\. Layton, which it’s inspired by, matches \d+%\./);
  assert.ok(!/points?\b/.test(mine));
  const zenith = { ...byName('Terra'), id: '901', name: 'Zenith', original: null };
  const plain = verdictHTML({ win: wx.night, ranked: [entry(zenith, 0.79), entry(dupe, 0.66)] }, new Set([dupe.id]), []);
  assert.match(plain, /The best of yours tonight, 66% match\. Zenith matches 79%\./);
  const none = verdictHTML(tonight, new Set(), pairs);
  assert.match(none, /Close call: <i>Layton<\/i> by a nose/);
  assert.match(verdictHTML({ ...tonight, ranked: [entry(layton, 0.9), entry(dupe, 0.7)] }, new Set(), pairs), /<i>Layton<\/i> suits tonight best/);
});

test('compare ranks with your stars, and reads Now’s entries for bottles in its list', () => {
  const store = new Map();
  globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  try {
    state.demo = { fragrances };
    state.active = 'demo';
    state.shared = null;
    state.wx = wx;
    computeToday();
    // Now's window (the day one at 4 pm), whichever it is.
    const slot = nowSlot().win.slot;
    const [a, b] = state.contexts[slot].ranked.map(e => e.fragrance);
    const stranger2 = { ...byName('Sauvage'), id: '424242', name: 'Not owned' };
    state.bottles.set(stranger2.id, stranger2);
    const route = { dest: 'compare', arg: [a.id, b.id, stranger2.id].join(','), query: {} };
    let m = compareModel(route);
    assert.equal(m.bottles.filter(x => x.owned).length, 2);
    assert.equal(m.now.win, nowSlot().win);
    assert.equal(m.now.entries.get(a.id), state.contexts[slot].entries.get(a.id), 'the % Now shows');
    // By day the verdict is about tonight, and tonight's matches have a row of their own.
    assert.equal(slot, 'day', 'the fixture’s Now is the day window');
    assert.equal(m.tonight.entries.get(a.id), state.contexts.night.entries.get(a.id), 'tonight’s % as Now’s night list has it');
    const page = compareHTML(m);
    assert.match(page, /id="cmp-tonight">Match tonight</);
    const tonightPct = `${matchPct(m.tonight.entries.get(a.id))}%`;
    assert.ok(page.split('id="cmp-tonight"')[1].split('</section>')[0].includes(tonightPct), 'the verdict’s numbers show in a row');
    const before = m.occ.entries.get(stranger2.id).score;
    store.set('scentcast.skin', JSON.stringify({ [stranger2.id]: { rating: 1 } }));
    m = compareModel(route);
    assert.ok(m.occ.entries.get(stranger2.id).score < before, 'a 1★ bottle scores lower here too');
  } finally {
    delete globalThis.localStorage;
    Object.assign(state, { demo: null, wx: null, today: null, contexts: {} });
    state.bottles.clear();
  }
});

test('a hand-entered bottle in no list is linked by its share token', () => {
  const mine = { id: 'my:abc123', name: 'Mine', brand: '', accords: { woody: 80, amber: 60 }, season: { winter: 0.3, spring: 0.2, summer: 0.2, fall: 0.3 }, dayNight: { day: 0.5, night: 0.5 } };
  assert.equal(linkId(mine), shareToken(mine));
  assert.equal(linkId(stranger), '9828');
  state.mine.records = [mine];
  try {
    assert.equal(linkId(mine), 'my:abc123', 'one in Mine opens by its id');
  } finally {
    state.mine.records = [];
  }
});

test('compare with… lists its family, the list it came from and your bottles, each once, filtered as you type', () => {
  const [a, b, c] = fragrances;
  const family = { original: { id: 'o', record: { id: 'o', name: 'Original', brand: 'House' } }, cheaper: [{ id: b.id, record: b }], siblings: [] };
  const lists = pickerLists({ base: [a.id], query: '' }, { family, context: [a, b, c], owned: [c, b, a] });
  assert.deepEqual(lists.map(l => l.title), ['Smells like it', 'From the same list']);
  assert.deepEqual(lists[0].records.map(r => r.id), ['o', b.id]);
  assert.deepEqual(lists[1].records.map(r => r.id), [c.id], 'the base and bottles already listed are left out');
  // The list it came from is the whole wardrobe: five from it, the rest under Your bottles.
  const all = pickerLists({ base: [a.id], query: '' }, { context: fragrances, owned: fragrances });
  assert.deepEqual(all.map(l => l.records.length), [5, fragrances.length - 6]);
  const typed = pickerLists({ base: [], query: 'origin', results: [{ id: '77', name: 'Original Musk', brand: 'X', stub: true }] }, { family, owned: fragrances });
  assert.deepEqual(typed.map(l => l.title), ['Smells like it', 'From Fragrantica']);
  // Brand first, or the words out of order, as the Add sheet teaches ("e.g. Dior Sauvage").
  const sauvage = byName('Sauvage');
  const dior = pickerLists({ base: [a.id], query: 'dior sauvage', results: [] }, { owned: fragrances });
  assert.deepEqual(dior.map(l => [l.title, l.records.map(r => r.id)]), [['Your bottles', [sauvage.id]]], 'brand then name finds your Sauvage');
  assert.deepEqual(pickerLists({ base: [], query: 'SAUVAGE  Dior' }, { owned: fragrances })[0].records.map(r => r.id), [sauvage.id]);
  // The library's matches stand as it found them: "baccarat 540" isn't a substring of "Baccarat Rouge 540".
  const br540 = [{ id: '33519', name: 'Baccarat Rouge 540', brand: 'Maison Francis Kurkdjian' }, { id: '45178', name: 'Baccarat Rouge 540 Extrait de Parfum', brand: 'Maison Francis Kurkdjian' }];
  const library = pickerLists({ base: [a.id], query: 'baccarat 540', results: br540 }, { owned: fragrances, context: [{ ...br540[0] }] });
  assert.deepEqual(library.map(l => [l.title, l.records.map(r => r.id)]), [['From the same list', ['33519']], ['From Fragrantica', ['45178']]], 'every word in any order, and each bottle once');
  assert.equal(pickerLists({ base: [], query: 'creed aventus', results: [] }, { owned: fragrances }).length, 0, 'a word that names nothing here: no local match');
  assert.ok(pickerMatches('chanel n 5', { name: 'N°5', brand: 'Chanel' }) && pickerMatches('n 5', { name: 'N°5', brand: 'Chanel' }), 'one-letter words count when nothing longer was typed');
  assert.ok(!pickerMatches('n 5', { name: 'Sauvage', brand: 'Dior' }));
  const html = clean(pickerHTML({ base: [a.id], query: EVIL }, []), 'picker');
  assert.match(html, /No bottles match/);
  assert.match(html, /data-field="cmp-query"/);
  assert.match(pickerHTML({ base: ['1', '2', '3'], query: '' }, lists), /Three is the most/);
  assert.match(pickerHTML({ base: [a.id], query: '' }, lists), /data-action="cmp-pick" data-id="o"/);

  // What a screen reader hears as you search: searching, how many, or none.
  const status = (sheet, ls = []) => pickerStatus({ base: [a.id], ...sheet }, ls);
  assert.equal(status({ query: '' }), '', 'nothing typed, nothing said');
  assert.equal(status({ query: 'aventus', results: null }), 'Searching…', 'until the library answers');
  assert.equal(status({ query: 'aventus', results: [], busy: true }), 'Searching…');
  assert.equal(status({ query: 'aventus', results: [] }, [{ records: [a, b] }, { records: [c] }]), '3 bottles found.');
  assert.equal(status({ query: 'zzz', results: [] }), 'No bottles match “zzz”.');
  assert.equal(status({ query: 'zzz', results: [], error: 'Can’t reach the fragrance library.' }), 'No bottles match “zzz”. Can’t reach the fragrance library.');
  assert.equal(status({ query: 'j', results: null }, [{ records: [a] }]), '1 bottle found.', 'one letter: only your own bottles, no library search');
  assert.equal(pickerStatus({ base: ['1', '2', '3'], query: 'x' }, []), '', 'full: nothing to search');
  const live = pickerHTML({ base: [a.id], query: EVIL, results: [] }, []);
  assert.match(live, /role="status" id="cmp-pick-live" data-say="No bottles match/, 'a status line in the sheet');
});

test('compare’s words: names listed with commas, and no tapping on a desktop', () => {
  assert.deepEqual([andList([]), andList(['A']), andList(['A', 'B']), andList(['A', 'B', 'C'])], ['', 'A', 'A and B', 'A, B and C']);
  const [a, b, c] = fragrances;
  for (const f of [a, b, c]) state.bottles.set(f.id, f);
  try {
    assert.equal(comparePage.title({ arg: [a.id, b.id, c.id].join(',') }), `${a.name}, ${b.name} and ${c.name}`);
    assert.equal(comparePage.title({ arg: '' }), 'Compare');
  } finally {
    state.bottles.clear();
  }
  const empty = compareHTML({ ids: [], bottles: [] });
  assert.match(empty, /Open any bottle and choose Compare/);
  assert.ok(!/\btap\b/i.test(empty));
});

test('the buy check reads the liked styles as Insights does: none liked is none, not the wardrobe’s leanings', async () => {
  const owned = fragrances.map(f => ({ ...f, id: String(f.id) }));
  const before = state.likedStyles, active = state.active;
  try {
    state.likedStyles = [];
    assert.deepEqual(await likedStyleIds(owned), []);
    assert.equal((await likedTaste(owned)).stated, true, 'none liked is a stated choice');
    state.likedStyles = ['oud', 'nope'];
    assert.deepEqual(await likedStyleIds(owned), ['oud']);
    assert.equal((await likedTaste(owned)).stated, true);
    state.likedStyles = null;
    assert.ok((await likedStyleIds(owned)).length > 0, 'unset: the stated loves or the leanings');
    // Unset on a list that isn't David's: the leanings, a guess.
    state.active = 'mine';
    const mine = await likedTaste(owned.slice(0, 1));
    assert.ok(mine.ids.length > 0);
    assert.equal(mine.stated, false, 'what the bottles lean toward isn’t something you said');
  } finally {
    state.likedStyles = before;
    state.active = active;
  }
});
