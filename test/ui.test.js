import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as ui from '../src/ui.js';
import { OCCASIONS } from '../src/occasions.js';
import { rank } from '../src/engine.js';
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

test('every template renders clean: no undefined or NaN, names escaped', () => {
  const day = { win: wx.day, ranked, pick: ranked[0] };
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
  const renders = {
    hero: ui.heroHTML({ loc: { name: EVIL, lat: 40 }, wx, loading: false, error: null, updating: true }, 1.8,
      [{ slot: 'day', label: 'Today', entry, worn: false }], EVIL),
    heroLoading: ui.heroHTML({ loc: null, wx: null, loading: true, error: null }, 1.8, null, 'David’s wardrobe'),
    heroError: ui.heroHTML({ loc: { name: EVIL }, wx: null, loading: false, error: 'Can’t reach the forecast.' }, 1.8, null, ''),
    slotHeader: ui.slotHeaderHTML(wx.day, 12),
    pick: ui.pickHTML(entry, 'day', null, 'Top pick · today'),
    tiers: ui.tierListHTML(ranked, 'day', evil.id, true),
    week: ui.weekHTML(days),
    journalTeaser: ui.journalTeaserHTML({ strip, stats: { wears: 3, bottles: 1 } }, resolve),
    journal: ui.journalSheetHTML({
      stats: { wears: 1, bottles: 1, top: [[evil.id, 1]] },
      calendar: [strip.map(c => ({ ...c, future: false }))],
      dusty: [{ f: evil, last: null }],
      confirmClear: false,
      todayISO: '2026-09-28',
    }, resolve),
    occasions: ui.occasionPickerHTML('office'),
    slotToggle: ui.slotToggleHTML('night', wx),
    detail: ui.sheetHTML(entry, 'Today', 'day', evil.id, {
      wears: { count: 2, last: '2026-09-27' },
      todayISO: '2026-09-28',
      alts: ranked.slice(1, 5),
      partners: layerPicks(evil, bottles, 3, wx.day),
      comfort: { lowF: 50, highF: 80 },
    }),
    collection: ui.collectionSheetHTML({ tab: 'mine', demo: bottles, mine: { name: EVIL, records: bottles }, hidden: new Set([evil.id]), shared: null, filter: EVIL }),
    add: ui.addSheetHTML({ query: EVIL, results: [evil], busy: false, error: EVIL }, new Set()),
    addNone: ui.addSheetHTML({ query: EVIL, results: [] }, new Set()),
    import: ui.importSheetHTML({ text: EVIL, rows, busy: true, error: EVIL }, 15),
    importForm: ui.importSheetHTML({ text: EVIL }, 15),
    custom: ui.customSheetHTML({ name: EVIL, brand: EVIL, accords: ['vanilla'], seasons: ['fall'], time: 'night', error: EVIL, back: { kind: 'import' } }, 6),
    shared: ui.sharedBannerHTML({ name: EVIL, records: bottles, missing: ['1'], loading: false, confirmReplace: true }, 3),
    location: ui.locationSheetHTML({ query: EVIL, error: EVIL, results: [{ name: EVIL, region: EVIL }] }, [{ name: EVIL, region: EVIL }]),
    footer: ui.footerHTML({ on: 3, total: 4, sources: 'Fragrantica', updated: '9:00 AM', stale: true, units: 'F', hasHistory: true }),
    message: ui.messageHTML({ title: EVIL, body: EVIL }),
    skeleton: ui.skeletonHTML(2),
  };
  for (const [what, html] of Object.entries(renders)) clean(html, what);
  assert.ok(renders.pick.includes(ui.esc(EVIL)), 'the name shows, escaped');
  assert.ok(renders.detail.includes('class="visually-hidden">, '), 'accord bars say their strength to screen readers');
  assert.equal(renders.detail.match(/<h3>/g)?.length >= 4, true, 'sheet sections are h3 under the h2 title');
  assert.ok(!/<h4/.test(Object.values(renders).join('')), 'no h4 left');
});

test('occasions are a radio group with one tab stop and a stroke icon each', () => {
  const html = ui.occasionPickerHTML('date');
  assert.equal(html.match(/tabindex="0"/g).length, 1);
  assert.match(html, /aria-checked="true" tabindex="0" data-occasion="date"/);
  for (const o of OCCASIONS) assert.ok(ui.icon[o.icon], `${o.id} names an icon ui.js has (${o.icon})`);
  assert.ok(!/\p{Extended_Pictographic}/u.test(html), 'no emoji');
});

test('before the forecast arrives, the hero sky follows the clock', () => {
  const at = h => ui.sceneNow(null, { date: new Date(2026, 9, 12, h, 30) });
  assert.equal(at(23).phase, 'night');
  assert.equal(at(3).phase, 'night');
  assert.equal(at(12).phase, 'day');
  assert.equal(at(19).phase, 'dusk');
  assert.equal(ui.sceneNow(null, { error: true, date: new Date(2026, 9, 12, 12) }).category, 'cloudy', 'no sunshine over an error');
  assert.equal(ui.sceneNow(wx).phase, wx.now.phase, 'the forecast wins once it is here');
});

test('the owner’s wardrobe is never called a demo', () => {
  const html = ui.collectionSheetHTML({ tab: 'demo', demo: fragrances, mine: { name: '', records: [] }, hidden: new Set(), shared: null });
  assert.ok(html.includes('David’s wardrobe'));
  assert.ok(!/demo/i.test(html.replace(/data-collection-tab="demo"/g, '')));
});
