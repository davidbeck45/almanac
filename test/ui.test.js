import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as ui from '../src/ui.js';
import { icon, shelfHTML, sharedBannerHTML, messageHTML, skeletonHTML, rowHTML } from '../src/ui/components.js';
import * as wear from '../src/views/wear.js';
import * as wardrobe from '../src/views/wardrobe.js';
import * as discoverT from '../src/views/discover/templates.js';
import * as settings from '../src/views/settings.js';
import { SECTIONS, addSection, bottlePageHTML } from '../src/views/bottle.js';
import { OCCASIONS } from '../src/occasions.js';
import { rank, comfortRange } from '../src/engine.js';
import { layerPicks } from '../src/layering.js';
import { summarize, week } from '../src/weather.js';
import { syntheticForecast } from './fixtures.js';

const { fragrances } = JSON.parse(readFileSync(new URL('../data/collection.json', import.meta.url)));
for (const f of fragrances) f.id = String(f.id);
// A bottle whose name and brand try to break out of the markup.
const EVIL = '<img src=x onerror="alert(1)">Rose & Oud\'s';
const evil = { ...fragrances[0], id: 'my:1"><b>', name: EVIL, brand: EVIL, url: 'https://x.test/?a="b"' };
const bottles = [evil, ...fragrances.slice(1)];

const forecast = syntheticForecast(7);
const nowMs = Date.parse('2026-09-28T16:00:00Z'); // noon, local
const wx = summarize(forecast, nowMs);
const ranked = rank(bottles, wx.day, 'day', { history: [], todayISO: wx.day.dateISO });
const entry = ranked.find(r => r.fragrance === evil);

function clean(html, what) {
  assert.ok(!/\bundefined\b|\bNaN\b|\[object Object\]/.test(html), `${what} renders undefined, NaN or an object`);
  assert.ok(!html.includes(EVIL) && !html.includes('onerror="alert'), `${what} lets a bottle name through unescaped`);
  return html;
}

// What every section of the bottle page gets (src/views/bottle.js bottleModel).
const model = {
  f: evil,
  entry,
  solo: false,
  win: wx.day,
  ctx: 'day',
  ctxLabel: 'Today',
  owned: true,
  active: true,
  worn: null,
  canWear: true,
  wears: { count: 2, last: '2026-09-27' },
  todayISO: '2026-09-28',
  alts: ranked.slice(1, 5),
  partners: layerPicks(evil, bottles.slice(1), 3, wx.day),
  comfort: comfortRange(evil),
  about: null,
  occasion: null,
  wanted: false,
  skin: null,
};

test('every template renders clean: no undefined or NaN, names escaped', () => {
  const plan = (p, slot) => p && { ...p, pick: { ...ranked[0], tier: 'S' }, ctx: `w:${p.dateISO}:${slot}`, worn: false };
  const days = week(forecast, nowMs).map(d => ({ ...d, day: plan(d.day, 'day'), night: plan(d.night, 'night') }));
  const strip = Array.from({ length: 7 }, (_, i) => ({ dateISO: `2026-09-2${i + 2}`, isToday: i === 6, label: String(i), day: { id: evil.id }, night: null }));
  const resolve = id => bottles.find(f => f.id === id);
  const rows = [
    { line: EVIL, status: 'pending' },
    { line: EVIL, status: 'done', match: null, note: '' },
    { line: EVIL, status: 'done', match: evil, checked: true, weak: false },
    { line: EVIL, status: 'done', match: evil, checked: false, weak: true },
  ];
  const slots = [{ win: wx.day, pick: entry }, { win: wx.night, pick: entry }];
  const sky = { loc: { name: EVIL, lat: 40 }, wx, loading: false, error: null, updating: true };
  const journal = {
    stats: { wears: 1, bottles: 1, top: [[evil.id, 1]], lastWorn: new Map([[evil.id, '2026-09-27']]) },
    calendar: [strip.map(c => ({ ...c, future: false }))],
    dusty: [{ f: evil, last: null }],
    todayISO: '2026-09-28',
  };
  const renders = {
    hero: wear.heroHTML(sky, { aspect: 1.3, pick: { entry, win: wx.day, worn: true }, slots, slotOn: 'day' }),
    heroWide: wear.heroHTML(sky, { aspect: 2.4, pick: { entry, win: wx.day, worn: false }, slots, slotOn: 'night' }),
    heroBand: wear.heroHTML(sky, { aspect: 3, compact: true }),
    heroLoading: wear.heroHTML({ loc: null, wx: null, loading: true, error: null }, { aspect: 1.8 }),
    heroError: wear.heroHTML({ loc: { name: EVIL }, wx: null, loading: false, error: 'Can’t reach the forecast.' }, { aspect: 1.8 }),
    slotHead: wear.slotHeadHTML(wx.day, 12, { id: 'x', thumb: true }),
    pick: wear.pickHTML(entry, 'day', null),
    pickFull: wear.pickHTML(entry, 'occ', evil.id, { full: true, kicker: 'Best for formal' }),
    shelf: shelfHTML(ranked, 'day', { wornId: evil.id }),
    week: wear.weekHTML(days),
    journalTeaser: wear.journalTeaserHTML({ strip, stats: { wears: 3, bottles: 1 } }, resolve),
    occasions: wear.occasionPickerHTML('office'),
    bottle: bottlePageHTML(model),
    bottleDocked: bottlePageHTML({ ...model, owned: false, solo: true, alts: [] }, { modal: false }),
    bottleLoading: bottlePageHTML(undefined),
    bottleMissing: bottlePageHTML(null),
    bottleFailed: bottlePageHTML(false),
    owned: wardrobe.ownedHTML({ tab: 'mine', demo: bottles, mine: { name: EVIL, records: bottles }, shared: null, hidden: new Set([evil.id]), filter: EVIL }),
    ownedShared: wardrobe.ownedHTML({ tab: null, demo: bottles, mine: { name: '', records: [] }, shared: { name: EVIL, records: bottles, missing: ['1'], loading: false }, hidden: new Set() }),
    worn: wardrobe.wornHTML(journal, resolve, { confirmClear: true }),
    wornEmpty: wardrobe.wornHTML({ ...journal, stats: { wears: 0, bottles: 0, top: [], lastWorn: new Map() } }, resolve),
    add: wardrobe.addSheetHTML({ query: EVIL, results: [evil], busy: false, error: EVIL }, new Set()),
    addNone: wardrobe.addSheetHTML({ query: EVIL, results: [] }, new Set()),
    import: wardrobe.importSheetHTML({ text: EVIL, rows, busy: true, error: EVIL }, 15),
    importForm: wardrobe.importSheetHTML({ text: EVIL }, 15),
    custom: wardrobe.customSheetHTML({ name: EVIL, brand: EVIL, accords: ['vanilla'], seasons: ['fall'], time: 'night', error: EVIL, back: { kind: 'import' } }, 6),
    shared: sharedBannerHTML({ name: EVIL, records: bottles, missing: ['1'], loading: false }, 3, { confirm: true }),
    discover: discoverT.namesHTML({ query: EVIL, results: [evil, { ...evil, id: '2', year: null }] }, new Map([['2', `In ${EVIL}’s`]])),
    discoverStatus: discoverT.statusHTML({ query: EVIL, results: [], busy: false, error: '' }),
    discoverOffline: discoverT.statusHTML({ query: EVIL, results: [evil], busy: false, error: '', offline: EVIL }),
    discoverError: discoverT.statusHTML({ query: EVIL, results: null, busy: false, error: EVIL }),
    discoverField: discoverT.searchFormHTML(EVIL),
    nextWindow: wear.nextWindowHTML({ win: wx.night, pick: entry }, evil.id, 12),
    location: settings.locationSheetHTML({ query: EVIL, error: EVIL, results: [{ name: EVIL, region: EVIL }] }, [{ name: EVIL, region: EVIL }]),
    settings: settings.settingsHTML({ loc: { name: EVIL, region: EVIL }, units: 'C', themeName: 'gruvbox', active: 'mine', mineCount: 2, shared: { name: EVIL }, on: 3, total: 4, wears: 5, updated: '9:00 AM', stale: true, credits: settings.creditsHTML({ fetched: EVIL, scraped: true, fragella: true }) }),
    row: `<ul>${rowHTML(evil, { meta: ui.esc(EVIL), open: { ctx: EVIL } })}</ul>`,
    message: messageHTML({ title: EVIL, body: EVIL }),
    skeleton: skeletonHTML(2),
  };
  for (const [what, html] of Object.entries(renders)) clean(html, what);
  assert.ok(renders.pickFull.includes(ui.esc(EVIL)), 'the name shows, escaped');
  assert.ok(renders.bottle.includes('class="visually-hidden">, '), 'accord bars say their strength to screen readers');
  assert.ok((renders.bottle.match(/<h3>/g) ?? []).length >= 4, 'page sections are h3 under the h2 title');
  assert.ok(!/<h4/.test(Object.values(renders).join('')), 'no h4');
  assert.match(renders.bottle, /role="dialog" aria-modal="true"/, 'a dialog on phones and tablets');
  assert.ok(!renders.bottleDocked.includes('role="dialog"'), 'not a dialog when docked beside the page');
  assert.match(renders.bottleDocked, /data-action="own"/, 'a bottle you don’t own offers I own it');
});

test('the hero stands the pick on the hill and lights it from the sky’s side', () => {
  const sky = { loc: { name: 'New York', lat: 40 }, wx, loading: false, error: null };
  const html = wear.heroHTML(sky, { aspect: 1.3, pick: { entry, win: wx.day, worn: false }, slots: [{ win: wx.day }, { win: wx.night }], slotOn: 'day' });
  const [, x, y] = html.match(/--x:([\d.]+)%;--y:([\d.]+)%/);
  assert.ok(+x > 55 && +x < 85 && +y > 55 && +y < 90, `the bottle stands right of the temperature, on the hill (${x}%, ${y}%)`);
  assert.match(html, /--rim-side:-?1/);
  assert.match(html, /data-action="slot" data-value="night" aria-pressed="false"/, 'a Day/Night toggle');
  assert.ok(!wear.heroHTML(sky, { aspect: 1.3, compact: true, pick: { entry, win: wx.day } }).includes('hero-pick'), 'the band has no bottle');
});

test('occasions are a radio group with one tab stop and a stroke icon each', () => {
  const html = wear.occasionPickerHTML('date');
  assert.equal(html.match(/tabindex="0"/g).length, 1);
  assert.match(html, /aria-checked="true" tabindex="0" data-action="occasion" data-value="date"/);
  for (const o of OCCASIONS) assert.ok(icon[o.icon], `${o.id} names an icon components.js has (${o.icon})`);
  assert.ok(!/\p{Extended_Pictographic}/u.test(html), 'no emoji');
});

test('before the forecast arrives, the hero sky follows the clock', () => {
  const at = h => wear.sceneNow(null, { date: new Date(2026, 9, 12, h, 30) });
  assert.equal(at(23).phase, 'night');
  assert.equal(at(3).phase, 'night');
  assert.equal(at(12).phase, 'day');
  assert.equal(at(19).phase, 'dusk');
  assert.equal(wear.sceneNow(null, { error: true, date: new Date(2026, 9, 12, 12) }).category, 'cloudy', 'no sunshine over an error');
  assert.equal(wear.sceneNow(wx).phase, wx.now.phase, 'the forecast wins once it is here');
});

test('the shelf stands every bottle on the line with its magnitude, B and C included', () => {
  const html = shelfHTML(ranked, 'day');
  assert.equal((html.match(/class="shelf-slot"/g) ?? []).length, ranked.length);
  for (const t of ['S', 'A', 'B', 'C']) {
    if (ranked.some(r => r.tier === t)) assert.ok(html.includes(`data-tier="${t}"`), `tier ${t} shows`);
  }
  assert.match(html, /aria-label="[^"]+, \d+% match, tier [SABC]"/, 'the name comes first in each label, then the match');
});

test('the owner’s wardrobe is never called a demo', () => {
  const html = wardrobe.ownedHTML({ tab: 'demo', demo: fragrances, mine: { name: '', records: [] }, shared: null, hidden: new Set() });
  assert.ok(html.includes('David’s wardrobe'));
  assert.ok(!/demo/i.test(html.replace(/data-value="demo"/g, '')));
});

test('bottle-page sections register in order, and a name is used once', () => {
  const orders = SECTIONS.map(s => s.order);
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b));
  assert.deepEqual(SECTIONS.map(s => s.id).slice(0, 4), ['head', 'summary', 'actions', 'why']);
  const probe = { id: 'probe', order: 250, render: m => `<section class="bp-section"><h3>Probe for ${ui.esc(m.f.name)}</h3></section>` };
  addSection(probe);
  try {
    const ids = SECTIONS.map(s => s.id);
    assert.equal(ids.indexOf('probe'), ids.indexOf('why') + 1, 'slots in between why (200) and alts (300)');
    const html = clean(bottlePageHTML(model), 'page with a new section');
    assert.ok(html.indexOf('Probe for') > html.indexOf('Why it ranks here') && html.indexOf('Probe for') < html.indexOf('Also good for'));
    assert.throws(() => addSection(probe), /Two bottle-page sections called "probe"/);
  } finally {
    SECTIONS.splice(SECTIONS.indexOf(probe), 1);
  }
});

test('the sun and moon keep clear of the hero’s bottle', async () => {
  const { stagePoint, skyLight } = await import('../src/scene.js');
  for (const aspect of [1.3, 2.4, 3.3]) {
    const stage = stagePoint(aspect, aspect < 1.6 ? 0.73 : 0.64);
    const W = 220 * aspect;
    for (let p = 0; p <= 1; p += 0.02) {
      const sun = skyLight({ phase: 'day', sunProgress: p, aspect, stage: stage.scene });
      // The bottle stands about 92 scene units tall on the ridge, 88 wide.
      const behind = Math.abs(sun.x - stage.scene) * W < 44 + 17 && sun.y * 220 + 17 > stage.y * 220 - 92;
      assert.ok(!behind, `at ${aspect} the sun at ${p.toFixed(2)} hangs behind the bottle`);
      assert.ok(sun.x > 0 && sun.x < 1, 'and stays in the sky');
    }
    const moon = skyLight({ phase: 'night', aspect, stage: stage.scene });
    assert.ok(Math.abs(moon.x - stage.scene) >= 0.25, `the moon sits across the sky from it (${moon.x})`);
  }
  assert.equal(skyLight({ phase: 'night', aspect: 1.3 }).x, 0.8, 'without a bottle the moon is where it always was');
});

test('Discover’s name search: a status line, and rows that say where a bottle already is', () => {
  const html = discoverT.namesHTML({ query: 'dior', results: fragrances.slice(0, 3) }, new Map([[fragrances[0].id, 'In David’s']]));
  assert.equal(discoverT.statusHTML({ query: 'dior', results: fragrances.slice(0, 3), busy: false, error: '' }), '3 matches');
  assert.match(html, /In David’s/, 'a bottle in the ranked list says so instead of offering I own it');
  assert.equal((html.match(/data-action="own-result"/g) ?? []).length, 2);
  assert.equal((html.match(/data-action="disc-want"/g) ?? []).length, 3, 'every row offers Want');
  assert.match(discoverT.statusHTML({ query: 'x', results: [fragrances[0]], offline: 'Can’t reach' }), /saved on this device/);
});

test('each Wardrobe pane has its own heading, and Wear this names its bottle', () => {
  const headings = wardrobe.wardrobe.panes.map(p => p.heading({}));
  assert.equal(new Set(headings).size, headings.length, headings.join(', '));
  assert.match(wear.pickHTML(entry, 'day', null), /Wear this<span class="visually-hidden">: [^<]+<\/span>/);
});
