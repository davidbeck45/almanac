// Wardrobe › Insights and Wishlist: their templates on a real gap report and
// buy checks (asked of the pool as the app asks), and the pure helpers
// behind them (doubles, verdict order, fills).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { handlePool, newPoolCache } from '../src/pool-tasks.js';
import { loadPool, fromPool } from '../src/fragrantica.js';
import * as gaps from '../src/gaps.js';
import * as styles from '../src/scent-styles.js';
import * as discover from '../src/discover.js';
import { doubles, DOUBLE_SIM } from '../src/doubles.js';
import { state } from '../src/app/state.js';
import { esc } from '../src/ui.js';
import * as insights from '../src/views/wardrobe/insights.js';
import * as wishlist from '../src/views/wardrobe/wishlist.js';
import { placeOf, valueWord, verdictBadge, verdictRank, VERDICTS, fillHTML, ratingText, likedFor, wantButton } from '../src/views/wardrobe/parts.js';

const dir = new URL('../data/fragrantica/', import.meta.url);
const load = async path => {
  const file = new URL(path, dir);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
};
const raw = JSON.parse(readFileSync(new URL('../data/collection.json', import.meta.url))).fragrances;
const owned = raw.map(f => ({ ...f, id: String(f.id) })).filter(f => f.name !== 'Jake');
const named = name => owned.find(f => f.name === name);
const cache = newPoolCache({ load });
async function ask(type, payload) {
  const answer = await handlePool({ id: type, type, payload }, cache);
  assert.equal(answer.error, undefined, `${type}: ${answer.error}`);
  return answer.result;
}

const EVIL = '<img src=x onerror="alert(1)">Rose & Oud\'s';
function clean(html, what) {
  assert.ok(!/\bundefined\b|\bNaN\b|\[object Object\]/.test(html), `${what} renders undefined, NaN or an object`);
  assert.ok(!html.includes(EVIL) && !html.includes('onerror="alert'), `${what} lets a name through unescaped`);
  return html;
}

const uses = gaps.USES.map(u => ({ id: u.id, label: gaps.useLabel(u) }));
const bands = insights.bandColumns(gaps.BANDS);
const lib = { gaps, styles, discover, doubles: { doubles } };

// A report with a hostile name on a suggestion and on an owned bottle it covers with.
function hostile(report) {
  const r = structuredClone(report);
  r.picks[0].name = EVIL;
  r.picks[0].record.name = EVIL;
  r.picks[0].brand = EVIL;
  for (const c of r.coverage) for (const t of c.top) if (t.name === 'Amber Empire') t.name = EVIL;
  return r;
}

let report;
test('Insights renders the report clean: the map, thin spots, strengths and suggestions', async () => {
  report = await ask('report', { owned, k: 5 });
  const r = hostile(report);
  const mix = styles.styleMix(owned);
  const model = {
    report: r, error: '', busy: true, fresh: true, uses, bands, cell: null, slot: null,
    context: { place: EVIL, climate: 'local', tagged: 3, preferValue: true },
    wants: new Set([r.picks[0].id]),
    ownedLabel: id => (id === r.picks[1]?.id ? EVIL : null),
    styles: {
      rows: styles.STYLES.filter(s => mix.ids[s.id]?.length).map(s => ({ id: s.id, label: s.label, count: mix.ids[s.id].length, liked: s.id === 'skin', bottles: mix.ids[s.id].map(id => ({ ...owned.find(f => f.id === id), name: EVIL })) })),
      stated: true, open: 'skin', all: false,
      groups: [{ ids: ['skin', 'intimate'], title: EVIL, href: '#/discover?styles=skin,intimate', picks: undefined }],
      starters: [{ style: styles.styleById('oud'), pick: null }, { style: styles.styleById('chypre'), pick: undefined }],
      moreStarters: 2, error: '',
      doubles: doubles(owned),
    },
  };
  const html = clean(insights.insightsHTML(model), 'insights');
  const cells = html.match(/data-action="ins-cell" data-value="[\w:]+" aria-pressed/g) ?? [];
  assert.equal(cells.length, report.coverage.length, 'a button for every cell of the map');
  assert.equal((html.match(/class="cov-cell"[^>]*aria-pressed="true"/g) ?? []).length, 1, 'one cell open');
  assert.match(html, /<caption class="visually-hidden">/, 'the map says what it is');
  assert.ok(html.includes('class="cov fill-in"'), 'a first report fills in');
  assert.ok(html.includes('insights busy'), 'a newer report on its way dims the old');
  assert.ok(html.includes(`data-action="wish-toggle" data-id="${r.picks[0].id}" aria-pressed="true"`), 'wanted ones say so');
  for (const g of report.gaps) assert.ok(html.includes(insights.STATUS_WORD[g.status]), `the status of ${g.title} is a word`);
  assert.ok(!/<h4/.test(html), 'no h4');
  const failed = clean(insights.stylesHTML({ ...model.styles, error: EVIL }), 'styles, failed');
  assert.equal((failed.match(/data-action="ins-retry"/g) ?? []).length, 2, 'Try again in place of each list');
  assert.ok(!failed.includes('ins-more-head'));
});

test('the map opens on the worst gap, and a cell’s detail names who covers it and who would beat them', () => {
  const html = insights.coverageHTML(report, { uses, bands, cell: null, slot: null });
  const open = html.match(/class="cov-cell" data-action="ins-cell" data-value="([\w:]+)" aria-pressed="true"/)[1];
  const cov = report.coverage.find(c => c.cell === open);
  assert.equal(cov.status, 'gap', 'a gap, not the room to grow beside it');
  assert.ok(report.gaps[0].cells.includes(open));
  assert.match(html, new RegExp(`data-show="${cov.slot}"`), 'its slot shows on phones');
  const detail = insights.cellDetailHTML(cov, report, () => null);
  assert.ok(detail.includes(esc(cov.top[0].name)) && detail.includes(`${Math.round(cov.top[0].score * 100)}%`), 'its best, as a match');
  const beaten = report.picks.filter(p => p.fills.some(f => f.cell === open && f.to > cov.top[0].score));
  for (const p of beaten) assert.ok(detail.includes(esc(p.name)), `${p.name} would beat it`);
  assert.equal(insights.oftenText(0.001), 'Rarely comes up for you.');
  assert.equal(insights.oftenText(0.1), 'About 10% of what you wear.');
  assert.equal(insights.oftenText(0.02), 'About 1 in 50 of your wears.');
});

test('the headline reads plainly, and the thin spots name what fills them', () => {
  const { lead, tail } = insights.headline(report);
  assert.equal(lead, 'You’re covered for nearly everything you wear.');
  assert.equal(tail, 'Here’s where it’s thin.');
  assert.deepEqual(insights.headline({ ...report, overview: { strongShare: 0.81 }, gaps: [] }),
    { lead: 'You have a strong pick for 81% of what you wear.', tail: 'Nothing’s thin. Here’s where you’re strongest.' });
  const html = insights.thinHTML(report);
  assert.equal((html.match(/class="thin-row"/g) ?? []).length, report.gaps.length);
  const zenith = report.picks.find(p => p.name === 'Zenith');
  if (zenith) assert.ok(html.includes(`data-id="${zenith.id}">Zenith</button>`), 'Zenith fills a thin spot');
  assert.ok(!/match;\s*$|NaN%/.test(html));
  assert.match(insights.strongHTML(report), /Plenty for Date Night on cold/);
});

test('a suggestion card shows its fills against your best, its facts and its actions', () => {
  const p = report.picks[0];
  const html = clean(insights.pickCardHTML(p, { wanted: false }), 'pick card');
  for (const f of p.fills.filter(x => x.matters)) assert.ok(html.includes(placeOf(f.title)), f.title);
  assert.match(html, /\d\.\d★ · [\d,]+ votes/);
  assert.match(html, /Great value/, 'a value-filtered pick is great value');
  assert.match(html, /data-action="wish-toggle"[^>]*aria-pressed="false"/);
  assert.match(html, /data-action="ins-own"/);
  assert.match(insights.pickCardHTML(p, { owned: 'In Mine' }), /owned-tag/, 'one you own says where');
});

test('the style mix hearts liked styles and folds the long tail', () => {
  const rows = Array.from({ length: 14 }, (_, i) => ({ id: `s${i}`, label: `Style ${i}`, count: 14 - i, liked: i === 12, bottles: [] }));
  const html = insights.styleMixHTML(rows, { open: null, stated: true });
  assert.equal((html.match(/class="mix-row/g) ?? []).length, 9, 'the top 8 and the liked one');
  assert.match(html, /data-value="s12" aria-pressed="true"/);
  assert.match(html, /Show all 14 styles/);
  assert.equal((insights.styleMixHTML(rows, { all: true }).match(/class="mix-row/g) ?? []).length, 14);
  assert.match(insights.styleMixHTML([], {}), /None of your bottles/);
});

test('doubles: dupes of one original, a dupe and its original, or none and the closest pair', async () => {
  const pool = await loadPool(load);
  const byId = new Map(Array.from({ length: pool.count }, (_, i) => fromPool(pool, i)).map(r => [r.id, r]));
  const brun = named('Liquid Brun');
  const althair = byId.get(String(brun.original.id));
  const sibling = { ...byId.get('98242'), original: brun.original }; // Art Of Nature II, as if built a dupe of Althaïr too
  const d = doubles([brun, althair, sibling, named('Aristo')]);
  const why = (a, b) => d.pairs.find(p => [p.a, p.b].includes(a) && [p.a, p.b].includes(b))?.why;
  assert.equal(why(brun, althair), 'dupe');
  assert.equal(why(brun, sibling), 'original');
  assert.ok(!d.pairs.some(p => [p.a, p.b].includes(named('Aristo'))), 'Aristo doubles nothing');
  const html = clean(insights.doublesHTML(d), 'doubles');
  assert.match(html, /Both copy Althaïr/);
  assert.match(html, /Liquid Brun is a dupe of Althaïr/);

  const none = doubles(owned);
  assert.deepEqual(none.pairs, [], 'nothing in David’s wardrobe wears like another');
  assert.ok(none.closest.sim < DOUBLE_SIM);
  assert.match(insights.doublesHTML(none), /No doubles: every bottle smells its own way\. The closest pair, .+ and .+, is \d+% alike, sharing /);
});

test('How you wear: three levels for each occasion, Daily always counted', () => {
  const html = clean(insights.usesSheetHTML({ uses, settings: { office: 'often', formal: 'never' }, tagged: 4 }), 'uses sheet');
  assert.equal((html.match(/data-action="ins-use"/g) ?? []).length, 3 * (uses.length - 1));
  assert.match(html, /data-value="office:often" aria-pressed="true"/);
  assert.match(html, /data-value="formal:never" aria-pressed="true"/);
  assert.match(html, /Daily picks<\/span><span class="muted small">Always counted/);
  assert.match(html, /4 wears logged/);
});

test('the climate line says where it comes from, and the value switch waits for an answer', () => {
  assert.match(insights.contextHTML({ place: 'New York', climate: 'local' }), /Your climate: <b>New York<\/b>/);
  assert.match(insights.contextHTML({ place: null, climate: 'default' }), /typical temperate climate.*Set your location/);
  assert.match(insights.contextHTML({ place: 'New York', climate: 'failed' }), /Couldn’t load New York’s climate/);
  assert.match(insights.contextHTML({ climate: 'local', preferValue: null }), /sk-switch/);
  assert.match(insights.contextHTML({ climate: 'local', preferValue: false }), /role="switch" aria-checked="false"/);
  assert.match(insights.contextHTML({ climate: 'local', tagged: 2 }), /Tuned by the 2 wears you logged/);
});

test('David starts on the styles he says he loves; hearting some replaces them', () => {
  assert.deepEqual(likedFor(lib, owned), { ids: discover.DEMO_LIKED, stated: true });
  state.likedStyles = ['oud', 'nope'];
  try {
    assert.deepEqual(likedFor(lib, owned), { ids: ['oud'], stated: true });
  } finally {
    state.likedStyles = null;
  }
  state.active = 'mine';
  try {
    const from = likedFor(lib, owned);
    assert.equal(from.stated, false, 'anyone else starts on what their bottles lean toward');
    assert.ok(from.ids.includes('vanilla'));
  } finally {
    state.active = 'demo';
  }
});

test('the wishlist puts the best fits first and says what each would add', async () => {
  const { checks } = await ask('check', { owned, records: ['76063', '98242', '9828', 'nope'], liked: discover.DEMO_LIKED });
  const wants = checks.map((c, i) => ({ id: String(c.id), added: `2026-10-0${i + 1}` }));
  const items = wishlist.sortWants([
    { want: { id: 'loading', added: '2026-10-09' }, record: null, check: undefined },
    ...checks.map((check, i) => ({ want: wants[i], record: check.record ?? null, check })),
  ]);
  assert.equal(items[0].check.name, 'Shalimar Millésime Tonka', 'the strong fit leads');
  const ranks = items.filter(i => i.check && !i.check.missing).map(i => verdictRank(i.check.verdict));
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
  assert.deepEqual(items.slice(-2).map(i => i.want.id), ['loading', 'nope'], 'unchecked and unknown ones wait at the end, as added');
  assert.equal(wishlist.wishSummary(items), '1 strong fit, 2 redundant');
  const html = clean(wishlist.wishlistHTML({ items: items.map(i => (i.record ? { ...i, record: { ...i.record, name: EVIL, brand: EVIL } } : i)), busy: false }), 'wishlist');
  assert.match(html, /5 bottles: 1 strong fit, 2 redundant\./);
  assert.match(html, /isn’t in the fragrance library/, 'a bottle the library lacks says so');
  assert.match(html, /sk-pill/, 'a want still checking shows a placeholder');
  assert.match(html, /data-action="wish-bought" data-id="loading" disabled/, 'nothing to buy before its name is in');
  assert.match(html, /Would fill/);
  const empty = wishlist.wishlistHTML({ items: [] });
  assert.match(empty, /href="#\/wardrobe\/insights"/);
  assert.match(empty, /href="#\/discover"/);
});

test('verdicts, values and fills read in words', () => {
  for (const v of VERDICTS) assert.match(verdictBadge(v), new RegExp(`<svg[^]*</svg>${v}</span>`), `${v} has a glyph and its word`);
  assert.equal(new Set(VERDICTS.map(v => verdictBadge(v).match(/data-kind="(\w+)"/)[1])).size, VERDICTS.length);
  assert.ok(verdictRank('Strong fit') < verdictRank('Good') && verdictRank('Good') < verdictRank('Covered') && verdictRank('Risky') < verdictRank('Redundant'));
  assert.equal(valueWord(3.8), 'Great value', 'great where Prefer great value draws its line');
  assert.equal(valueWord(3.5), 'Good value');
  assert.equal(valueWord(null), null);
  assert.equal(placeOf('Daily picks on cold to mild nights'), 'Daily picks · cold to mild nights');
  assert.equal(ratingText(4.512, 1055), '4.5★ · 1,055 votes');
  assert.equal(ratingText(null, 10), null);
  const fill = { title: 'Formal on cool nights', from: 0.87, to: 0.91, first: true, beats: { name: EVIL }, beatsPick: true };
  const html = clean(fillHTML(fill), 'fill');
  assert.match(html, /91%<\/b>/);
  assert.match(html, /\(suggested above\) at 87%/);
  for (const [, x] of html.matchAll(/left:([\d.]+)%/g)) assert.ok(+x >= 0 && +x <= 100);
  assert.match(fillHTML({ ...fill, beats: null }), /where you have nothing yet/);
  assert.match(wantButton({ id: '1', name: EVIL }, true, { iconOnly: true }), /aria-pressed="true" aria-label="Want &lt;img/);
});
