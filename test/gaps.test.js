import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { rank } from '../src/engine.js';
import { loadPool, fromPool } from '../src/fragrantica.js';
import { allow } from '../src/candidates.js';
import {
  BANDS, USES, DEFAULT_CLIMATE, PER_CELL, climateSummary, cellsFor, fitTable, sameFooting, gapContext, gapSummary,
  strengths, suggest, buyCheck, gapReport, checkJSON, cellTitle, explainCell, SAME_SIM,
} from '../src/gaps.js';
import { sharesFrom, parseUses, LEVELS } from '../src/uses.js';
import { archiveWindows, fetchClimate, climateYears } from '../src/climate.js';
import { fragranticaLibrary } from '../src/fragrantica.js';

const dir = new URL('../data/fragrantica/', import.meta.url);
const load = async path => {
  const file = new URL(path, dir);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
};
const pool = await loadPool(load);
const records = Array.from({ length: pool.count }, (_, i) => fromPool(pool, i));
const byId = new Map(records.map(r => [r.id, r]));
const wardrobe = JSON.parse(readFileSync(new URL('../data/collection.json', import.meta.url))).fragrances.map(f => ({ ...f, id: String(f.id) }));
const owned = name => wardrobe.find(f => f.name === name);
const ctx = gapContext({ owned: wardrobe, records, byId });
const report = gapReport(ctx, { k: 5 });
const FRESH = ['Atlantis Extrait', 'Shiyaaka Sky', 'Essence de Blanc', 'Jake', 'Legacy', 'Cedrus Blanc', 'Aristo', 'Sauvage'];

test('a bottle’s fit in a cell is exactly rank()’s score in that weather', () => {
  // One window per slot × band, so the cell's mean is that window.
  const windows = [
    ['2025-01-15', 'night', 28, 18], ['2025-01-16', 'day', 34, 20], ['2025-04-20', 'day', 50, 35], ['2025-11-10', 'night', 50, 40],
    ['2025-10-01', 'day', 66, 52], ['2025-09-20', 'night', 62, 55], ['2025-06-10', 'day', 78, 55], ['2025-07-20', 'night', 79, 68],
    ['2025-07-21', 'day', 95, 72], ['2025-08-02', 'night', 86, 70],
  ].map(([dateISO, slot, feelsF, dewF]) => ({ dateISO, slot, feelsF, dewF, lat: 40.7 }));
  const cc = cellsFor(climateSummary(windows, { perCell: 1 }));
  assert.equal(cc.cells.length, 55);
  const bottles = [...wardrobe.map(sameFooting), ...records.filter((_, i) => i % 97 === 0)];
  const table = fitTable(bottles, cc);
  let worst = 0, checked = 0;
  cc.cells.forEach((cell, j) => {
    const { cond } = cc.slotBands[cell.sb].wins[0];
    for (const r of rank(bottles, cond, cell.slot, { occasion: cell.occasion })) {
      worst = Math.max(worst, Math.abs(r.score - table[bottles.indexOf(r.fragrance) * cc.cells.length + j]));
      checked++;
    }
  });
  assert.ok(checked > 6000);
  assert.ok(worst < 1e-6, `largest difference ${worst}`);
});

test('owned bottles leave out only Parfumo’s occasion votes', () => {
  const lb = owned('Liquid Brun'), same = sameFooting(lb);
  assert.ok(lb.parfumo.occasion && !same.parfumo.occasion && !('occasionVotes' in same.parfumo));
  assert.equal(same.parfumo.longevity, lb.parfumo.longevity);
  assert.equal(same.accords, lb.accords, 'shares the accords, so heaviness stays cached');
  const plain = { ...lb, parfumo: undefined };
  assert.equal(sameFooting(plain), plain);
});

test('the default climate is small and has real windows in every slot and band', () => {
  assert.ok(JSON.stringify(DEFAULT_CLIMATE).length < 6000);
  for (const slot of ['day', 'night']) {
    let total = 0;
    for (const band of BANDS) {
      const c = DEFAULT_CLIMATE[`${slot}:${band.id}`];
      assert.equal(c.wins.length, PER_CELL, `${slot} ${band.id}`);
      for (const w of c.wins) {
        assert.equal(BANDS.find(b => w.feelsF >= b.lo && w.feelsF < b.hi).id, band.id);
        assert.match(w.dateISO, /^\d{4}-\d\d-\d\d$/);
      }
      total += c.share;
    }
    assert.ok(Math.abs(total - 1) < 0.01, `${slot} shares sum to 1`);
  }
  // A place without hot nights has no windows there, and no cells.
  const mild = Array.from({ length: 20 }, (_, i) => ({ dateISO: `2025-05-${String(1 + i).padStart(2, '0')}`, slot: i % 2 ? 'night' : 'day', feelsF: 50 + i, dewF: 45, lat: 50 }));
  const summary = climateSummary(mild);
  assert.equal(summary['night:hot'].wins.length, 0);
  assert.equal(summary['day:cool'].wins.length, 4, 'fewer than PER_CELL when the place has fewer');
  assert.ok(!cellsFor(summary).cells.some(c => c.sb === 'night:hot'));
});

test('cell weights follow the use shares and sum to 1', () => {
  const sum = cells => cells.reduce((s, c) => s + c.weight, 0);
  assert.ok(Math.abs(sum(ctx.cc.cells) - 1) < 1e-9);
  for (const use of USES) {
    const share = sum(ctx.cc.cells.filter(c => c.use === use.id));
    assert.ok(Math.abs(share - use.share) < 1e-9, use.id);
  }
  const { cells } = cellsFor(DEFAULT_CLIMATE, { shares: sharesFrom({ office: 'never' }) });
  assert.equal(sum(cells.filter(c => c.use === 'office')), 0, 'Never keeps the cells, at weight 0');
  assert.ok(Math.abs(sum(cells) - 1) < 1e-9);
});

test('David’s gaps name real situations, worst first, and his strengths', () => {
  const { gaps } = report;
  assert.ok(gaps.length >= 3);
  for (let i = 1; i < gaps.length; i++) assert.ok(gaps[i - 1].severity >= gaps[i].severity);
  for (const g of gaps) {
    assert.match(g.title, /^[A-Z][\w ]+ on (any (day|night)|(cold|cool|mild|warm|hot)( (and|to) (cool|mild|warm|hot))? (days|nights))$/, g.title);
    assert.doesNotMatch(g.text, /°|\d+ ?F\b/, 'no temperatures');
  }
  assert.ok(gaps.some(g => g.use === 'office' && g.bands.includes('cold')), 'office in the cold has room to grow');
  assert.ok(gaps.some(g => g.use === 'daily' && g.slot === 'day' && g.bands.includes('cold') && g.status === 'thin'), 'only Cream Velvet for cold days');
  const date = report.strengths.find(s => s.use === 'date');
  assert.ok(date?.bands.includes('cold'), 'date nights in the cold are a strength');
  assert.match(date.text, /^Date Night on cold and cool nights: \d+ or more strong bottles, led by /);
  assert.equal(cellTitle('formal', 'night', ['cold', 'cool']), 'Formal on cold and cool nights');
  assert.equal(cellTitle('date', 'night', BANDS.map(b => b.id)), 'Date Night on any night');
  assert.match(explainCell(ctx.cov.find(c => c.cell.id === 'daily:day:cold')), /^Only Cream Velvet is a strong pick/);
});

test('without its fresh bottles, the wardrobe’s top gaps are warm and hot days', () => {
  const lean = gapContext({ owned: wardrobe.filter(f => !FRESH.includes(f.name)), records, byId });
  assert.ok(lean.severity > 1.5 * ctx.severity);
  const top = gapSummary(lean.cov).slice(0, 3);
  for (const g of top) assert.ok(g.slot === 'day' && (g.bands.includes('warm') || g.bands.includes('hot')), g.title);
  const [first] = suggest(lean, { k: 1 });
  assert.ok(first.fills.some(f => f.first && ['warm', 'hot'].includes(f.cell.band)));
  assert.ok(Object.keys(first.record.accords).slice(0, 2).some(a => ['citrus', 'fresh spicy', 'aromatic', 'fresh', 'aquatic'].includes(a)));
});

test('suggestions skip what’s owned, originals and twins of it, and complement each other', () => {
  const picks = suggest(ctx, { k: 8 });
  assert.equal(picks.length, 8);
  const mine = new Set(wardrobe.map(f => f.id)), originals = new Set(wardrobe.filter(f => f.original).map(f => String(f.original.id)));
  for (const p of picks) {
    assert.ok(!mine.has(p.record.id) && !originals.has(p.record.id), p.record.name);
    assert.ok(!['owned', 'original', 'near'].includes(ctx.family.dupeOf(p.record)?.kind), p.record.name);
    assert.ok(allow(p.record, ctx.allow) && p.risk.level !== 'high' && !p.record.extras.flags.includes('discontinued'));
    assert.ok(p.novelty.sim < SAME_SIM);
    assert.ok(p.fills.length && p.gain > 0);
  }
  for (let i = 1; i < picks.length; i++) assert.ok(picks[i].value <= picks[i - 1].value + 1e-12, 'values never rise');
  // Each one, checked on its own, is worth buying.
  for (const p of picks) assert.ok(['Strong fit', 'Good'].includes(buyCheck(p.record, ctx).verdict), p.record.name);
  // "Prefer great value" keeps to bottles voters value 3.8+; David's wardrobe starts it on.
  assert.equal(ctx.preferValue, true);
  assert.ok(picks.every(p => p.record.extras.value >= 3.8));
  const any = suggest(gapContext({ owned: wardrobe, records, byId, preferValue: false }), { k: 5 });
  assert.ok(any.some(p => p.record.extras.value < 3.8), 'off, pricier bottles come in');
});

test('brigaded bottles are neither suggested nor part of the reference', () => {
  const sponge = byId.get('28286');
  assert.ok(sponge.extras.flags.includes('brigaded'));
  assert.equal(allow(sponge, ctx.allow), false);
  const brigaded = new Set(records.flatMap((r, i) => (r.extras.flags.includes('brigaded') ? [i] : [])));
  assert.ok(brigaded.size >= 5);
  assert.ok(!ctx.rows.some(i => brigaded.has(i)));
  const wide = gapContext({ owned: wardrobe, records, byId, preferValue: false });
  assert.ok(!suggest(wide, { k: 20 }).some(p => brigaded.has(records.indexOf(p.record))));
});

test('the buy check calls twins redundant, gap fillers good and divisive bottles risky', () => {
  const verdict = id => buyCheck(byId.get(id), ctx);
  const althair = verdict('84109');
  assert.equal(althair.verdict, 'Redundant');
  assert.deepEqual(althair.reasons, ['The original of your Liquid Brun.', 'It would add nothing your Liquid Brun doesn’t already do.']);
  assert.equal(althair.overlap.bottle.name, 'Liquid Brun', 'an original overlaps the dupe you own, not itself');
  const sibling = verdict('98242'); // Lattafa Art Of Nature II, another Althaïr clone
  assert.equal(sibling.verdict, 'Redundant');
  assert.match(sibling.reasons[0], /twin of your Liquid Brun/);
  const sauvage = verdict('31861');
  assert.deepEqual([sauvage.verdict, sauvage.reasons, sauvage.fills], ['Redundant', ['You own it.'], []]);
  const tobacco = buyCheck(records.find(r => r.name === 'Tobacco Vanille'), ctx);
  assert.equal(tobacco.verdict, 'Redundant', 'one point better than Terra fills nothing');
  assert.match(tobacco.reasons[0], /^It adds little: it barely beats your /);

  const tonka = verdict('76063'); // Shalimar Millésime Tonka
  assert.equal(tonka.verdict, 'Strong fit');
  assert.match(tonka.reasons[0], /^It would be your best for Date Night on /);
  assert.ok(tonka.fills.every(f => f.matters) && tonka.fills.some(f => f.real));

  const red = buyCheck(records.find(r => r.name === 'Red Tobacco'), ctx);
  assert.equal(red.verdict, 'Risky');
  assert.equal(red.risk.level, 'high');
  assert.equal(red.reasons[0], red.risk.reasons[0]);

  for (const c of [althair, sibling, tonka, red]) {
    assert.ok(c.reasons.length >= 2 && c.reasons.length <= 3);
    for (const r of c.reasons) assert.doesNotMatch(r, /°|\d+ ?F\b|undefined|null/);
  }
  const json = checkJSON(byId.get('76063'), tonka);
  assert.equal(JSON.parse(JSON.stringify(json)).verdict, 'Strong fit');
});

test('the report is plain data', () => {
  const copy = structuredClone(report);
  assert.deepEqual(JSON.parse(JSON.stringify(copy.picks.map(({ record, ...p }) => p))), copy.picks.map(({ record, ...p }) => p));
  assert.equal(report.coverage.length, ctx.cc.cells.length);
  for (const p of report.picks) {
    assert.equal(typeof p.id, 'string');
    assert.ok(p.fills.every(f => typeof f.cell === 'string' && f.beats?.name));
    assert.ok(p.record.accords, 'carries the record, for the app to rank it with the wardrobe');
  }
});

test('use shares: Never drops a use, Often counts 2.5 times, Daily stays on, the journal refines them', () => {
  const base = sharesFrom({});
  for (const u of USES) assert.ok(Math.abs(base[u.id] - u.share) < 1e-12);
  const set = sharesFrom({ office: 'never', formal: 'often', daily: 'never' });
  assert.equal(set.office, 0);
  assert.ok(set.daily > 0, 'Daily can’t be turned off');
  assert.ok(Math.abs(set.formal / set.casual - (LEVELS.often * 0.05) / 0.08) < 1e-9);
  assert.ok(Math.abs(Object.values(set).reduce((a, b) => a + b, 0) - 1) < 1e-9);
  const learned = sharesFrom({ office: 'never' }, { office: 50, date: 20 });
  assert.equal(learned.office, 0, 'Never wins over the journal');
  const prior = sharesFrom({ office: 'never' });
  assert.ok(Math.abs(learned.date - (prior.date * 20 + 20) / 40) < 1e-12);
  assert.ok(Math.abs(Object.values(learned).reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.deepEqual(parseUses('office=Often, Date Night=never'), { office: 'often', date: 'never' });
  assert.throws(() => parseUses('gym=often'), /Unknown use "gym"/);
  assert.throws(() => parseUses('office=lots'), /never, sometimes or often/);
});

test('a place’s climate comes from one archive call, is kept, and falls back offline', async () => {
  const hours = [];
  for (let d = 1; d <= 20; d++) for (let h = 0; h < 24; h++) hours.push(`2025-07-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:00`);
  const archive = { latitude: 29.75, hourly: { time: hours, apparent_temperature: hours.map((t, i) => 75 + (i % 24)), dew_point_2m: hours.map(() => 70) } };
  const windows = archiveWindows(archive, 29.76);
  assert.equal(windows.length, 40);
  assert.equal(windows.find(w => w.slot === 'day').feelsF, 75 + 13.5, 'mean of 10:00–17:00');
  assert.deepEqual(climateYears(new Date('2026-10-13T12:00:00')), ['2024-01-01', '2025-12-31']);

  const real = globalThis.fetch, store = new Map(), calls = [];
  const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  try {
    globalThis.fetch = async url => { calls.push(String(url)); return { ok: true, status: 200, json: async () => archive }; };
    const first = await fetchClimate(29.76, -95.37, { storage });
    assert.ok(first.local && first.summary['day:hot'].wins.length);
    assert.match(calls[0], /archive-api\.open-meteo\.com.*hourly=apparent_temperature%2Cdew_point_2m/);
    const again = await fetchClimate(29.9, -95.3, { storage });
    assert.equal(calls.length, 1, 'the same half-degree cell comes from storage');
    assert.deepEqual(again.summary, first.summary);
    globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
    const offline = await fetchClimate(40.7, -74, { storage });
    assert.equal(offline.local, false);
    assert.equal(offline.summary, DEFAULT_CLIMATE);
  } finally {
    globalThis.fetch = real;
  }
});

test('the worker answers reports and checks by message', async () => {
  // The worker fetches the pool next to src/; here fetch reads the files.
  const real = globalThis.fetch;
  globalThis.fetch = async url => {
    const file = fileURLToPath(url);
    return existsSync(file) ? { ok: true, status: 200, text: async () => readFileSync(file, 'utf8') } : { ok: false, status: 404 };
  };
  try {
    const { handle } = await import('../src/gaps-worker.js');
    assert.equal((await handle({ id: 0, type: 'check', record: { id: '84109' } })).type, 'error', 'a check needs a wardrobe first');
    const raw = JSON.parse(readFileSync(new URL('../data/collection.json', import.meta.url))).fragrances;
    const answer = await handle({ id: 1, type: 'report', owned: raw, k: 3 });
    assert.equal(answer.type, 'report', answer.message);
    assert.equal(answer.id, 1);
    assert.deepEqual(answer.report.picks.map(p => p.id), report.picks.slice(0, 3).map(p => p.id), 'numeric ids read like string ones');
    assert.deepEqual(structuredClone(answer).report.gaps, report.gaps);
    const check = await handle({ id: 2, type: 'check', record: { id: '84109' } });
    assert.equal(check.check.verdict, 'Redundant');
    // A visitor's bottle outside the pool reads its about data.
    const [olympic] = (await fragranticaLibrary(load).records(['12807'])).values();
    assert.ok(!byId.has('12807') && !olympic.extras);
    const outside = await handle({ id: 3, type: 'check', record: olympic });
    assert.equal(outside.type, 'check', outside.message);
    assert.notEqual(outside.check.risk.level, 'unknown');
    assert.equal((await handle({ id: 4, type: 'nope' })).message, 'Unknown message type "nope".');
  } finally {
    globalThis.fetch = real;
  }
});

const script = fileURLToPath(new URL('../scripts/recommend.mjs', import.meta.url));
const cli = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

test('--gaps and --check answer in the terminal', () => {
  const gaps = cli('--gaps', '--top', '3', '--json');
  assert.equal(gaps.status, 0, gaps.stderr);
  const out = JSON.parse(gaps.stdout);
  assert.equal(out.picks.length, 3);
  assert.ok(out.gaps.length && out.strengths.length && !('record' in out.picks[0]));
  const text = cli('--gaps', '--uses', 'office=never,formal=often', '--no-value');
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /How you wear: Daily \d+%.*Office 0%/);
  assert.doesNotMatch(text.stdout.split('To fill them')[0], /Office on/);
  assert.match(text.stdout, /prefer great value: off/);

  const check = cli('--check', 'Althair', '--json');
  assert.equal(check.status, 0, check.stderr);
  assert.equal(JSON.parse(check.stdout).verdict, 'Redundant');
  const byNumber = cli('--check', '76063');
  assert.match(byNumber.stdout, /^Shalimar Millésime Tonka by Guerlain \(2022\).*\nStrong fit\n/);

  assert.match(cli('--gaps', '--uses', 'gym=often').stderr, /--uses: Unknown use "gym"/);
  assert.match(cli('--gaps', '--value', '--no-value').stderr, /not both/);
  assert.match(cli('--check', 'xqzw').stderr, /No bottle matches "xqzw"/);
});
