import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { rank, steadyShares, votedShares } from '../src/engine.js';
import { loadPool, fromPool } from '../src/fragrantica.js';
import { allow } from '../src/candidates.js';
import {
  BANDS, USES, DEFAULT_CLIMATE, PER_CELL, MAX_ACCORDS, climateSummary, cellsFor, fitTable, sameFooting, flatVotes, gapContext,
  coverage, gapSummary, strengths, suggest, buyCheck, gapReport, checkJSON, cellTitle, explainCell, SAME_SIM,
} from '../src/gaps.js';
import { customRecord, predictedShares } from '../src/custom.js';
import { applySkin } from '../src/skin.js';
import { DEMO_LIKED } from '../src/discover.js';
import { sharesFrom, parseUses, LEVELS } from '../src/uses.js';
import { archiveWindows, fetchClimate, climateYears } from '../src/climate.js';

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
  // Your stars too: a 1★ and a 5★ bottle score as rank() has them.
  const rated = applySkin(wardrobe, { [owned('Cream Velvet').id]: { rating: 1 }, [owned('Terra').id]: { rating: 5 } });
  const bottles = [...rated.map(sameFooting), ...records.filter((_, i) => i % 97 === 0)];
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

test('owned bottles stand on the pool’s footing: no Parfumo occasion votes, 8 accords', () => {
  const lb = owned('Liquid Brun'), same = sameFooting(lb);
  assert.ok(lb.parfumo.occasion && !same.parfumo.occasion && !('occasionVotes' in same.parfumo));
  assert.equal(same.parfumo.longevity, lb.parfumo.longevity);
  assert.ok(Object.keys(lb.accords).length > MAX_ACCORDS);
  const strongest = Object.entries(lb.accords).sort((a, b) => b[1] - a[1]).slice(0, MAX_ACCORDS);
  assert.deepEqual(same.accords, Object.fromEntries(strongest));
  assert.equal(sameFooting(lb), same, 'the same record each time, so heaviness stays cached');
  assert.equal(same.seasonVotes, lb.seasonVotes, 'honest votes stay');
  const row = byId.get('31861');
  assert.equal(sameFooting(row), row, 'a pool row comes back as itself');
  assert.ok(wardrobe.every(f => sameFooting(f).seasonVotes === f.seasonVotes && sameFooting(f).timeVotes === f.timeVotes), 'votes stay');
});

test('flat season votes read as unvoted, so they don’t make an all-rounder', () => {
  assert.ok(flatVotes([501, 485, 475, 494], 540), 'nearly every rater ticked every season');
  assert.ok(flatVotes([765, 765, 765, 765], 1481) && flatVotes([633, 633, 477, 633], 1336), 'one count on 3 seasons');
  assert.ok(flatVotes([398, 398], 671), 'one count on day and night');
  assert.ok(!flatVotes([5500, 6600, 6400, 6200], 10377), 'Supremacy Collector’s Edition: a real all-rounder');
  assert.ok(!flatVotes([112, 118, 117, 111], 546), 'even, but from few of its raters');
  assert.ok(!flatVotes([3, 3, 3, 9], 20), 'a tie on few votes');
  assert.ok(!flatVotes([2700, 2700, 2700, 1000], 4750), 'a scraped page rounds counts from 1,000, so a tie there is no sign');
  // The engine reads them as none (steadyShares), so the gap finder, rank() and Discover agree.
  const elyon = byId.get('119376'), au = records.find(r => r.name === 'Au Hasard');
  for (const r of [elyon, au]) {
    assert.deepEqual(votedShares(r), { season: false, time: false }, r.name);
    assert.equal(sameFooting(r).seasonVotes, r.seasonVotes, 'the gap finder leaves them to the engine');
    const est = predictedShares(r.accords, r.like);
    assert.ok(Math.abs(steadyShares(r).season.winter - est.season.winter) < 1e-9, 'the prediction alone');
    assert.ok(Math.abs(steadyShares(r).dayNight.night - est.night) < 1e-9);
  }
  // No owned bottle's votes read as flat, and only a few dozen of the pool's; day and night only with the seasons.
  assert.ok(wardrobe.every(f => votedShares(f).season && votedShares(f).time), 'Liam’s and Vintage Radio’s 2.4k day and night stand');
  const flat = records.filter(r => !votedShares(r).season);
  assert.ok(flat.length >= 10 && flat.length <= 40, `${flat.length} flat`);
  assert.ok(records.every(r => !r.timeVotes || votedShares(r).time || !votedShares(r).season), 'Sauvage EDP’s even day and night stand');
  const picks = [ctx, gapContext({ owned: wardrobe, records, byId, preferValue: false })].flatMap(c => suggest(c, { k: 5 }));
  assert.ok(!picks.some(p => [elyon.id, au.id].includes(p.record.id)));
  for (const r of [elyon, au]) assert.notEqual(buyCheck(r, ctx).verdict, 'Strong fit', r.name);
});

test('your stars move your own coverage, not the pool reference, and a bottle you dislike covers nothing', () => {
  const ids = ['Cream Velvet', 'Amber Empire'].map(n => owned(n).id);
  const rated = applySkin(wardrobe, { [ids[0]]: { rating: 1 }, [ids[1]]: { rating: 2 }, [owned('Terra').id]: { rating: 5 } });
  const again = gapContext({ owned: rated, records, byId });
  assert.deepEqual(again.ref.map(q => [...q]), ctx.ref.map(q => [...q]), 'the reference is the crowd’s');
  // Neither is anyone's best or runner-up any more: Cozy on cold nights names another bottle.
  const named = c => c.cov.flatMap(x => x.top.map(t => String(t.bottle.id)));
  assert.ok(ids.every(id => named(ctx).includes(id)));
  assert.ok(!ids.some(id => named(again).includes(id)));
  const cozy = c => c.cov.find(x => x.cell.id === 'cozy:night:cold');
  assert.ok(ids.includes(String(cozy(ctx).top[0].bottle.id)), cozy(ctx).top[0].bottle.name);
  assert.ok(!ids.includes(String(cozy(again).top[0].bottle.id)));
  assert.equal(again.worn.length, wardrobe.length - 2);
  // Still his: it checks as owned.
  assert.equal(buyCheck(byId.get(ids[1]), again).verdict, 'Redundant');
  // A bottle he loves covers a little more, by what rank() adds for it.
  const m = ctx.cc.cells.length, terra = i => wardrobe.findIndex(f => f.name === 'Terra') * m + i;
  const k = again.worn.findIndex(f => f.name === 'Terra') * m;
  assert.ok(ctx.cc.cells.every((_, j) => again.ownTable[k + j] > ctx.ownTable[terra(j)] + 0.019));
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

test('David’s gaps name real situations, gaps before room to grow, and his strengths', () => {
  const { gaps } = report;
  assert.ok(gaps.length >= 3);
  const order = ['gap', 'thin', 'room'];
  for (let i = 1; i < gaps.length; i++) {
    const [a, b] = [order.indexOf(gaps[i - 1].status), order.indexOf(gaps[i].status)];
    assert.ok(a < b || (a === b && gaps[i - 1].severity >= gaps[i].severity), `${gaps[i - 1].title} before ${gaps[i].title}`);
  }
  for (const g of gaps) {
    assert.match(g.title, /^[A-Z][\w ]+ on (any (day|night)|(cold|cool|mild|warm|hot)( (and|to) (cool|mild|warm|hot))? (days|nights))$/, g.title);
    assert.doesNotMatch(g.text, /°|\d+ ?F\b/, 'no temperatures');
    assert.ok(order.includes(g.status));
  }
  assert.equal(gaps[0].status, 'gap');
  assert.ok(gaps.some(g => g.use === 'date' && g.bands.includes('warm') && g.status === 'gap'), 'date nights in the warm are his gap');
  // Office wants a bottle that lasts the day, and his fresh clones do: it's a strength, not a gap.
  assert.ok(!gaps.some(g => g.use === 'office'), gaps.map(g => g.title).join('; '));
  assert.ok(report.strengths.some(s => s.use === 'office'), 'the office is a strength');
  assert.match(report.overview.text, /^You have a strong pick for nearly everything you wear/);
  // Cold days: Cream Velvet leads, Détour Noir and Liam close behind, so it isn't thin.
  const cold = ctx.cov.find(c => c.cell.id === 'daily:day:cold');
  assert.equal(cold.status, 'covered');
  assert.deepEqual(cold.top.map(t => t.bottle.name), ['Cream Velvet', 'Détour Noir', 'Liam']);
  // A runner-up just under the strong line is depth too: thin needs the next best under the 85th percentile.
  const q = ctx.ref[ctx.cc.cells.indexOf(cold.cell)];
  const statusWith = second => coverage([{ name: 'a' }, { name: 'b' }], Float32Array.of(q[99], second), [cold.cell], [q])[0].status;
  assert.notEqual(statusWith(q[88]), 'thin');
  assert.equal(statusWith(q[60]), 'thin');
  const date = report.strengths.find(s => s.use === 'date');
  assert.ok(date?.bands.includes('cold'), 'date nights in the cold are a strength');
  assert.match(date.text, /^Date Night on cold and cool nights: \d+ or more strong bottles, led by /);
  // A run whose leader changes names both ends.
  const nights = report.strengths.find(s => s.use === 'daily' && s.slot === 'night');
  assert.match(nights.text, /led by CH Men Prive on cold nights and .+ on warm ones\.$/);
  assert.equal(cellTitle('formal', 'night', ['cold', 'cool']), 'Formal on cold and cool nights');
  assert.equal(cellTitle('date', 'night', BANDS.map(b => b.id)), 'Date Night on any night');
  assert.match(explainCell(ctx.cov.find(c => c.cell.id === 'date:night:cold')), /^\d+ strong picks, led by /);
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
  const wide = gapContext({ owned: wardrobe, records, byId, preferValue: false });
  const formal = gapContext({ owned: wardrobe, records, byId, shares: sharesFrom({ office: 'never', formal: 'often' }) });
  const lean = gapContext({ owned: wardrobe.filter(f => !FRESH.includes(f.name)), records, byId });
  const mine = new Set(wardrobe.map(f => f.id)), originals = new Set(wardrobe.filter(f => f.original).map(f => String(f.original.id)));
  let behind = 0;
  for (const c of [ctx, wide, formal, lean]) {
    const picks = suggest(c, { k: 8 });
    assert.ok(picks.length >= 2);
    const named = new Set(gapSummary(c.cov).flatMap(g => g.cells));
    for (const p of picks) {
      assert.ok(!mine.has(p.record.id) && !originals.has(p.record.id), p.record.name);
      assert.ok(!['owned', 'original', 'near'].includes(c.family.dupeOf(p.record)?.kind), p.record.name);
      assert.ok(allow(p.record, c.allow) && p.risk.level !== 'high' && !p.record.extras.flags.includes('discontinued'));
      assert.ok(p.novelty.sim < SAME_SIM);
      assert.ok(p.gain > 0);
      // Every fill it's shown with fills a gap the report lists, never a strength.
      const shown = p.fills.filter(f => f.matters);
      assert.ok(shown.length && shown.every(f => f.real && named.has(f.cell.id)), p.record.name);
      assert.ok(shown.every(f => c.cov.find(x => x.cell.id === f.cell.id).status !== 'plenty'));
      // Each one, checked on its own, is worth buying.
      assert.ok(['Strong fit', 'Good'].includes(buyCheck(p.record, c).verdict), p.record.name);
    }
    for (let i = 1; i < picks.length; i++) assert.ok(picks[i].value <= picks[i - 1].value + 1e-12, 'values never rise');
    // A later pick doesn't claim a cell an earlier one filled: it names that pick as the one to beat.
    const claimed = new Map();
    for (const p of picks) {
      behind += p.fills.filter(f => f.matters && f.beatsPick).length;
      for (const f of p.fills.filter(x => x.matters && x.first)) {
        const prev = claimed.get(f.cell.id);
        if (prev) assert.ok(f.beatsPick && f.beats === prev.record && f.from >= prev.fills.find(x => x.cell === f.cell).to - 1e-6, `${p.record.name}, ${f.cell.id}`);
        claimed.set(f.cell.id, p);
      }
    }
  }
  assert.ok(behind > 0, 'some pick fills a cell an earlier one took');
  // "Prefer great value" keeps to bottles voters value 3.8+; David's wardrobe starts it on.
  assert.equal(ctx.preferValue, true);
  assert.ok(report.picks.every(p => p.record.extras.value >= 3.8));
  assert.ok(suggest(wide, { k: 5 }).some(p => p.record.extras.value < 3.8), 'off, pricier bottles come in');
});

test('fills where it doesn’t last, or behind its own kin, don’t count', () => {
  // Book Loft topped Office in the cold for being quiet; the engine now counts its fading against it.
  const loft = buyCheck(records.find(r => r.name === 'Book Loft'), ctx);
  assert.ok(!loft.fills.some(f => f.cell.use === 'office') && !['Strong fit', 'Good'].includes(loft.verdict), loft.reasons.join(' '));
  assert.ok(!suggest(ctx, { k: 8 }).some(p => p.record.name === 'Book Loft'));
  // A bottle that would still lead an occasion wanting longevity fills nothing there when it fades fast:
  // the office's favorite with a body mist's performance, for an empty wardrobe.
  const best = records.find(r => r.name === 'Gentleman Eau de Toilette Intense');
  const weak = { ...best, id: 'my:weak', name: 'Weak Copy', extras: undefined, performance: { longevity: 2, sillage: 1.6, votes: 400 } };
  const fades = buyCheck(weak, gapContext({ owned: [], records, byId }));
  const wants = f => f.cell.occasion?.performance?.longevity > 0;
  assert.ok(fades.fills.length && !fades.fills.some(wants), fades.fills.map(f => f.cell.id).join());
  assert.ok(buyCheck(best, gapContext({ owned: [], records, byId })).fills.some(wants), 'as it is, it fills them');
  // A Cream Velvet look-alike adds no depth to Cream Velvet.
  const eclair = buyCheck(records.find(r => r.name === 'Éclair Affair'), ctx);
  assert.equal(eclair.verdict, 'Redundant');
  assert.match(eclair.reasons[0], /Cream Velvet/);
});

test('an empty wardrobe or a single bottle still gets a report and checks', () => {
  for (const mine of [[], [owned('Liquid Brun')]]) {
    const c = gapContext({ owned: mine, records, byId });
    const r = gapReport(c, { k: 2 });
    assert.equal(r.picks.length, 2);
    assert.ok(r.gaps.length);
    for (const id of ['76063', '84109', '31861']) assert.ok(buyCheck(byId.get(id), c).reasons.length);
  }
  assert.equal(gapReport(gapContext({ owned: [], records, byId })).gaps[0].text.endsWith('nothing you own fits here.'), true);
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

test('body mists are neither suggested nor part of the reference, unless asked for', () => {
  const mists = new Set(records.flatMap((r, i) => (r.extras.flags.includes('mist') ? [i] : [])));
  assert.ok(mists.size >= 50);
  assert.ok(!ctx.rows.some(i => mists.has(i)));
  for (const c of [ctx, gapContext({ owned: [], records, byId })]) assert.ok(!suggest(c, { k: 8 }).some(p => p.record.extras.flags.includes('mist')));
  const open = gapContext({ owned: [], records, byId, mists: true });
  assert.ok(open.allow.mists && open.rows.some(i => mists.has(i)));
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
  assert.equal(tobacco.verdict, 'Covered', 'one point better than Terra fills nothing');
  assert.match(tobacco.reasons[0], /^It would barely beat your Terra for /);
  // A new direction he doesn't need isn't called a duplicate: he's covered there.
  const dhi = buyCheck(records.find(r => r.name === 'Encre Noire'), ctx);
  assert.equal(dhi.verdict, 'Covered');
  assert.match(dhi.reasons[0], /^It would barely beat your .+, where it does best\.$/);
  assert.equal(dhi.reasons[1], 'Nothing you own smells like it.');
  assert.ok(dhi.overlap.sim < 0.5 && !dhi.overlap.link);
  // Dior Homme Intense lasts the working day, so it edges his best for the office in the cold (by too little to
  // fill anything: he's covered there); its clone doesn't.
  const cold = ctx.cc.cells.findIndex(c => c.id === 'office:day:cold'), m = ctx.cc.cells.length;
  const best = Math.max(...wardrobe.map((_, i) => ctx.ownTable[i * m + cold]));
  const coldFit = name => fitTable([sameFooting(records.find(r => r.name === name))], ctx.cc)[cold];
  assert.ok(coldFit('Dior Homme Intense 2011') > best && best > coldFit('Dark Door Intense'));
  const dior = buyCheck(records.find(r => r.name === 'Dior Homme Intense 2011'), ctx);
  assert.equal(dior.verdict, 'Covered');
  assert.match(dior.reasons[0], /^It would barely beat your Sandalwood & Musk for Office on cold days/);
  assert.ok(!buyCheck(records.find(r => r.name === 'Dark Door Intense'), ctx).fills.some(f => f.cell.use === 'office'));
  // Risky shows through even when it fills nothing.
  const kouros = buyCheck(records.find(r => r.name === 'Kouros'), ctx);
  assert.equal(kouros.verdict, 'Risky');
  assert.ok(kouros.reasons.includes('It divides people: many voters hate it.'));

  const tonka = verdict('76063'); // Shalimar Millésime Tonka
  assert.equal(tonka.verdict, 'Strong fit');
  assert.match(tonka.reasons[0], /^It would be your best for Date Night on /);
  assert.ok(tonka.fills.every(f => f.matters) && tonka.fills.some(f => f.real));

  const red = buyCheck(records.find(r => r.name === 'Red Tobacco'), ctx);
  assert.equal(red.verdict, 'Risky');
  assert.equal(red.risk.level, 'high');
  assert.equal(red.reasons[0], red.risk.reasons[0]);

  for (const c of [althair, sibling, tonka, red, dhi, kouros]) {
    assert.ok(c.reasons.length >= 2 && c.reasons.length <= 3);
    for (const r of c.reasons) assert.doesNotMatch(r, /°|\d+ ?F\b|undefined|null|NaN/);
  }
  const json = checkJSON(byId.get('76063'), tonka);
  assert.equal(JSON.parse(JSON.stringify(json)).verdict, 'Strong fit');
});

test('the buy check knows what he likes: more of a style he’s thin on is good, overlap redundant, the rest covered', () => {
  const liked = DEMO_LIKED; // Skin scent, Clean, Intimate
  const check = (r, opts = { liked }) => buyCheck(typeof r === 'string' ? byId.get(r) : r, ctx, opts);
  const named = (name, brand) => records.find(r => r.name === name && r.brand === brand);
  // Glossier You: a skin scent, and he owns two; it fills no gap, and nothing he owns smells like it.
  const you = check(named('You', 'Glossier'));
  assert.equal(you.verdict, 'Good');
  assert.deepEqual(you.reasons.slice(0, 2), ['More of the skin scents you like: you own 2.', 'Nothing you own smells like it.']);
  assert.deepEqual([you.taste.style, you.taste.owned, you.taste.thin], ['skin', 2, true]);
  assert.equal(check(named('You', 'Glossier'), {}).verdict, 'Covered', 'without his styles it adds nothing');
  // Styles only guessed from the wardrobe's leanings are ones he reaches for, not ones he said he likes.
  assert.equal(check(named('You', 'Glossier'), { liked, stated: false }).reasons[0], 'More of the skin scents you reach for: you own 2.');
  assert.equal(check(named('Acqua di Gio', 'Giorgio Armani'), { liked, stated: false }).reasons[1], 'It’s fresh citrus and aquatic, none of the styles you reach for.');
  // A twin of his Supremacy Collector's Edition is redundant, whatever he likes.
  const precieux = check('93272'); // Armaf Club de Nuit Precieux I
  assert.equal(precieux.verdict, 'Redundant');
  assert.match(precieux.reasons[0], /twin of your Supremacy Collector's Edition Pour Homme/);
  // A fresh classic he's covered for, in no style he likes.
  const adg = check(named('Acqua di Gio', 'Giorgio Armani'));
  assert.equal(adg.verdict, 'Covered');
  assert.equal(adg.reasons[1], 'It’s fresh citrus and aquatic, none of the styles you like.');
  // Risky and strong fit stand whatever he likes.
  assert.equal(check(records.find(r => r.name === 'Kouros')).verdict, 'Risky');
  assert.equal(check('76063').verdict, 'Strong fit', 'Shalimar Millésime Tonka');
  // A low-rated skin scent is risky, at its real rating.
  const nap = check(named('Not A Perfume', 'Juliette Has A Gun'));
  assert.equal(nap.verdict, 'Risky');
  assert.equal(nap.reasons[0], 'Voters rate it only 3.75★.');
  // A style he owns plenty of adds nothing new.
  const tv = check(records.find(r => r.name === 'Tobacco Vanille'), { liked: ['vanilla'] });
  assert.deepEqual([tv.verdict, tv.reasons[1]], ['Covered', 'You own 8 vanilla scents already.']);
  // A body mist says so, and is never a strong fit.
  const mist = check('87258'); // Phlur Vanilla Skin Fragrance Mist
  assert.ok(mist.reasons.includes('It’s a body mist: lighter and shorter-lived than a perfume.'));
  // Nor does his taste alone vouch for one, as suggestions leave mists out: Book Loft wears close, and
  // he likes Intimate, but it's only Good once he lets mists in.
  const loft = records.find(r => r.name === 'Book Loft');
  assert.equal(check(loft, { liked: ['intimate'] }).verdict, 'Covered');
  const open = buyCheck(loft, gapContext({ owned: wardrobe, records, byId, mists: true }), { liked: ['intimate'] });
  assert.deepEqual([open.verdict, open.reasons[0]], ['Good', 'More of the close-wearing scents you like: you own 2.']);
  // A skin scent reviewers warn about is risky, not good, when only its style speaks for it.
  const mkk = check(named('Muscs Koublai Khan', 'Serge Lutens'));
  assert.equal(mkk.verdict, 'Risky');
  assert.deepEqual(mkk.reasons.slice(0, 2), ['Reviewers say it isn’t a safe blind buy.', 'More of the skin scents you like: you own 2.']);
  for (const c of [you, precieux, adg, nap, tv, mist, mkk]) {
    assert.ok(c.reasons.length >= 2 && c.reasons.length <= 3, c.reasons.join(' | '));
    for (const r of c.reasons) assert.doesNotMatch(r, /°|\d+ ?F\b|undefined|null|NaN|severity|deficit/);
  }
  // Over the pool, his styles turn some covered bottles good, and nothing else.
  const sample = records.filter((_, i) => i % 9 === 0), shift = {};
  for (const r of sample) {
    const [a, b] = [check(r, {}).verdict, check(r).verdict];
    if (a !== b) shift[`${a} → ${b}`] = (shift[`${a} → ${b}`] ?? 0) + 1;
  }
  assert.ok(Object.keys(shift).every(k => ['Covered → Good', 'Covered → Risky'].includes(k)) && shift['Covered → Good'] > 10, JSON.stringify(shift));
  assert.deepEqual(checkJSON(named('You', 'Glossier'), you).taste, { styles: ['powdery', 'skin'], style: 'skin', label: 'Skin scent', owned: 2, thin: true });
});

test('the buy check reads a bottle the same way whatever form it comes in', () => {
  // Brooke's catalog Bo carries Parfumo votes and 10 accords; it checks as its pool row.
  const catalog = JSON.parse(readFileSync(new URL('../data/catalog.json', import.meta.url))).fragrances;
  for (const r of catalog.filter(f => byId.has(String(f.id)))) {
    const a = buyCheck(r, ctx), b = buyCheck(byId.get(String(r.id)), ctx);
    assert.deepEqual([a.verdict, a.reasons], [b.verdict, b.reasons], r.name);
  }
  // A hand-entered bottle has no crowd data: never a strong fit, and it says so rather than "0 voters".
  for (const accords of [['iris', 'lavender', 'powdery'], ['citrus', 'aquatic', 'fresh spicy'], ['vanilla', 'sweet', 'amber', 'leather'], ['rose', 'oud', 'amber']]) {
    const mine = customRecord({ name: 'Mine', brand: 'Me', accords });
    for (const c of [ctx, gapContext({ owned: [], records, byId })]) {
      const check = buyCheck(mine, c);
      assert.equal(check.risk.level, 'unknown');
      assert.notEqual(check.verdict, 'Strong fit', accords.join(' '));
      assert.ok(!check.reasons.some(x => /0 voters|0\.0★/.test(x)), check.reasons.join(' '));
    }
  }
});

test('a strong fit stands out for the wardrobe it’s for', () => {
  // For a thin wardrobe most of the pool fills something; only the best few are strong fits.
  const brooke = JSON.parse(readFileSync(new URL('../data/catalog.json', import.meta.url))).fragrances
    .filter(f => ['69541', '122015', '128201', '115992', '64338', '137101', '77284', '97237', '88207'].includes(String(f.id)));
  for (const mine of [[], brooke]) {
    const c = gapContext({ owned: mine, records, byId });
    const sample = records.filter((_, i) => i % 7 === 0);
    const strong = sample.filter(r => buyCheck(r, c).verdict === 'Strong fit').length;
    assert.ok(strong / sample.length < 0.04, `${mine.length} bottles: ${strong} of ${sample.length}`);
  }
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
  assert.deepEqual(parseUses('everyday=often'), { casual: 'often' }, 'the casual occasion’s old name');
  assert.throws(() => parseUses('gym=often'), /Unknown use "gym"/);
  assert.throws(() => parseUses('office=lots'), /never, sometimes or often/);
  assert.throws(() => parseUses('office=constructor'), /never, sometimes or often/);
  assert.throws(() => parseUses('daily=never'), /Daily picks always count/);
  // A stale or tampered setting reads as Sometimes.
  assert.deepEqual(sharesFrom({ office: 'toString', date: '__proto__' }), base);
  assert.throws(() => cellsFor(DEFAULT_CLIMATE, { shares: {} }), /sharesFrom/);
  assert.throws(() => cellsFor(DEFAULT_CLIMATE, { shares: { office: 'often' } }), /sharesFrom/);
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
    // Where the browser blocks storage, reading it throws; the climate still comes back.
    globalThis.window = { get localStorage() { throw new Error('SecurityError'); } };
    const blocked = await fetchClimate(40.7, -74);
    assert.equal(blocked.summary, DEFAULT_CLIMATE);
  } finally {
    globalThis.fetch = real;
    delete globalThis.window;
  }
});

const script = fileURLToPath(new URL('../scripts/recommend.mjs', import.meta.url));
const cli = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

test('--gaps and --check answer in the terminal', () => {
  const gaps = cli('--gaps', '--top', '3', '--json');
  assert.equal(gaps.status, 0, gaps.stderr);
  const out = JSON.parse(gaps.stdout);
  assert.ok(out.picks.length >= 2 && out.picks.length <= 3);
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
  // His styles by default, others when named.
  const you = JSON.parse(cli('--check', 'Glossier You', '--json').stdout);
  assert.deepEqual([you.verdict, you.liked], ['Good', DEMO_LIKED]);
  assert.equal(JSON.parse(cli('--check', 'Glossier You', '--style', 'vanilla', '--json').stdout).verdict, 'Covered');
  assert.match(cli('--check', 'Glossier You', '--style', 'xqzw').stderr, /--style: name styles from/);

  assert.match(cli('--gaps', '--uses', 'gym=often').stderr, /--uses: Unknown use "gym"/);
  assert.match(cli('--gaps', '--uses', 'daily=never').stderr, /--uses: Daily picks always count/);
  assert.match(cli('--gaps', '--value', '--no-value').stderr, /not both/);
  assert.match(cli('--check', 'xqzw').stderr, /No bottle matches "xqzw"/);
});
