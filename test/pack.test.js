import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { packTrip, withEvents, picksFor, tripPlan } from '../src/pack.js';
import { rank, daysBetween, PLAN_MARGIN, ROTATION_PENALTY } from '../src/engine.js';
import { applySkin } from '../src/skin.js';
import { occasionById } from '../src/occasions.js';
import { syntheticForecast } from './fixtures.js';

const fragrances = JSON.parse(readFileSync(new URL('../data/collection.json', import.meta.url))).fragrances
  .map(f => ({ ...f, id: String(f.id) }));
const shift = (iso, days) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const win = (dateISO, slot, feelsF, dewF, extra = {}) => ({
  slot, dateISO, date: new Date(`${dateISO}T12:00:00`), lat: 30, feelsF, humidity: 60, dewF, category: 'clear', label: dateISO, ...extra,
});
// Days and nights over `days` from START, by a weather for each slot.
const START = '2026-10-19';
const trip = (days, day, night) => Array.from({ length: days }, (_, i) => shift(START, i))
  .flatMap(d => [win(d, 'day', ...day), win(d, 'night', ...night)]);
const HOT = trip(5, [88, 72], [82, 70]);
const MIXED = trip(4, [86, 68], [40, 30]);

test('a hot trip packs few bottles, each window near the wardrobe’s top', () => {
  const out = packTrip(fragrances, HOT);
  assert.ok(out.bottles.length >= 2 && out.bottles.length <= 3, out.text);
  assert.deepEqual(out.uncovered, []);
  assert.equal(out.plan.length, HOT.length);
  const packed = new Set(out.bottles.map(b => b.record.id));
  for (const p of out.plan) {
    assert.ok(packed.has(p.pick.id));
    assert.ok(p.covered && p.score >= p.top.score - PLAN_MARGIN - 1e-9, `${p.window.dateISO} ${p.window.slot}`);
  }
  assert.ok(new Set(out.plan.map(p => p.pick.id)).size >= 2, 'trades off between what’s packed');
  assert.match(out.text, /^Pack .+ and .+\./);
  for (const b of out.bottles) assert.ok(b.covers.length && b.why, b.record.name);
  assert.doesNotMatch(out.text + out.bottles.map(b => b.why).join(' '), /°|\d+F\b/);
});

test('hot days and cold nights want different bottles; too few to pack says what’s missing', () => {
  const out = packTrip(fragrances, MIXED, { max: 4 });
  assert.deepEqual(out.uncovered, []);
  const day = out.plan.filter(p => p.window.slot === 'day').map(p => p.pick.id);
  const night = out.plan.filter(p => p.window.slot === 'night').map(p => p.pick.id);
  assert.ok(!day.some(id => night.includes(id)), 'a summer bottle for the days, a winter one for the nights');

  const one = packTrip(fragrances, MIXED, { max: 1 });
  assert.equal(one.bottles.length, 1);
  assert.ok(one.uncovered.length >= 4, `${one.uncovered.length} uncovered`);
  const missing = one.uncovered[0].best.name;
  assert.match(one.text, new RegExp(`Nothing packed is quite right for .+; ${missing} would be, if there’s room\\.`));
  // The text counts every wear, as each bottle's line does: the shortfall has its own sentence.
  const [only] = one.bottles;
  assert.match(only.why, /^Every day and night/);
  assert.match(one.text, new RegExp(`^Pack ${only.record.name} \\(every day and night\\)\\.`));
});

test('a bottle worn by day and night on one date says so once', () => {
  const out = packTrip(fragrances, [win(START, 'day', 66, 50), win(START, 'night', 60, 48)], { max: 1 });
  assert.equal(out.bottles.length, 1);
  assert.match(out.text, /^Pack .+ \(the day and night of Oct 19\)\./);
  assert.match(out.bottles[0].why, /^The day and night of Oct 19/);
});

// Denver, Oct 16–21 2026 as forecast on Oct 13: a greedy cover packed two
// bottles and left the office day bare, though two others cover all twelve.
const DENVER = [
  ['2026-10-16', 'day', 47.8, 36, 26.1, 'clear'], ['2026-10-16', 'night', 40.4, 53, 29.1, 'clear'],
  ['2026-10-17', 'day', 61.3, 27, 30.1, 'clear'], ['2026-10-17', 'night', 50.3, 49, 35.8, 'cloudy'],
  ['2026-10-18', 'day', 57.4, 31, 31.8, 'clear'], ['2026-10-18', 'night', 50.0, 47, 34.8, 'clear'],
  ['2026-10-19', 'day', 59.5, 35, 34.8, 'clear'], ['2026-10-19', 'night', 52.5, 49, 37.4, 'clear'],
  ['2026-10-20', 'day', 63.6, 30, 35.2, 'clear'], ['2026-10-20', 'night', 56.2, 41, 36.8, 'cloudy'],
  ['2026-10-21', 'day', 62.6, 29, 34.9, 'cloudy'], ['2026-10-21', 'night', 53.8, 44, 37.3, 'cloudy'],
].map(([d, slot, feelsF, humidity, dewF, category]) => win(d, slot, feelsF, dewF, { humidity, category, lat: 39.7 }));

// Every k-set of the wardrobe, as packTrip weighs them: windows within reach
// of the top, then the plan's picks less their rotation penalties.
function bestSets(windows, k) {
  const rows = windows.map(w => rank(fragrances, w, w.slot, { occasion: w.occasion ?? null, todayISO: w.dateISO }));
  const floor = rows.map(r => r[0].score - PLAN_MARGIN);
  const day = windows.map(w => daysBetween(windows[0].dateISO, w.dateISO));
  const score = new Map(fragrances.map(f => [f.id, rows.map(r => r.find(x => x.fragrance.id === f.id).score)]));
  const judge = set => {
    const last = new Map(), picks = [];
    let reached = 0, total = 0;
    for (let w = 0; w < floor.length; w++) {
      const reach = set.some(f => score.get(f.id)[w] >= floor[w]);
      if (reach) reached++;
      let pick = null, value = -Infinity;
      for (const f of set) {
        if (reach && score.get(f.id)[w] < floor[w]) continue;
        const v = score.get(f.id)[w] - (last.has(f) ? ROTATION_PENALTY[day[w] - last.get(f)] ?? 0 : 0);
        if (v > value) [pick, value] = [f, v];
      }
      last.set(pick, day[w]);
      picks.push(pick);
      total += value;
    }
    const dates = [...new Set(windows.map(w => w.dateISO))];
    const everyDay = set.filter(f => dates.every(d => windows.some((w, i) => w.dateISO === d && picks[i] === f))).length;
    return { reached, total, everyDay, most: Math.max(...set.map(f => picks.filter(p => p === f).length)) };
  };
  const out = [];
  const walk = (from, set) => {
    if (set.length === k) return void out.push({ set, ...judge(set) });
    for (let i = from; i < fragrances.length; i++) walk(i + 1, [...set, fragrances[i]]);
  };
  walk(0, []);
  return out.sort((a, b) => b.reached - a.reached || b.total - a.total);
}

test('the fewest bottles that cover every window, found where a greedy cover missed them', () => {
  const windows = withEvents(DENVER, [
    { dateISO: '2026-10-18', slot: 'night', occasion: occasionById('formal') },
    { dateISO: '2026-10-20', slot: 'day', occasion: occasionById('office') },
  ]);
  const out = packTrip(fragrances, windows, { max: 2 });
  assert.deepEqual(out.uncovered, [], out.text);
  assert.doesNotMatch(out.text, /Nothing packed/);
  const [best] = bestSets(windows, 2);
  assert.equal(best.reached, windows.length);
  assert.deepEqual(out.bottles.map(b => b.record.id).sort(), best.set.map(f => f.id).sort(), 'the best-planned of the full covers');
});

test('extra bottles go where they improve the plan most, not to copies of the first', () => {
  for (const [what, windows, max] of [['hot', HOT, 3], ['mixed', MIXED, 3], ['long cold', trip(8, [45, 35], [38, 30]), 3]]) {
    const out = packTrip(fragrances, windows, { max });
    const k = out.bottles.length;
    const sets = bestSets(windows, k);
    assert.equal(windows.length - out.uncovered.length, sets[0].reached, what);
    const mine = sets.find(x => x.set.length === k && x.set.every(f => out.bottles.some(b => b.record.id === f.id)));
    assert.ok(Math.abs(mine.total - sets[0].total) < 1e-9, `${what}: ${out.text}`);
    // Each bottle's line leads with the windows it's worn, like the text.
    for (const b of out.bottles) {
      if (b.wears < b.covers.length) assert.match(b.why, /also suits/, `${what}: ${b.why}`);
      assert.equal(b.wears, out.plan.filter(p => p.pick === b.record).length);
    }
  }
});

// Cancún, Jan 10–16 2027, and London, Dec 10–19 2026, in typical weather
// (Open-Meteo's archive, as tripWindows gave them on Oct 14 2026).
const typical = rows => rows.map(([d, slot, feelsF, humidity, dewF, category, lat]) => win(d, slot, feelsF, dewF, { humidity, category, lat, typical: true }));
const CANCUN = typical([
  ['2027-01-10', 'day', 83.5, 69, 68.7, 'cloudy', 21.2], ['2027-01-10', 'night', 79.7, 83, 69.4, 'clear', 21.2],
  ['2027-01-11', 'day', 84, 69, 68.9, 'cloudy', 21.2], ['2027-01-11', 'night', 79.8, 84, 69.5, 'clear', 21.2],
  ['2027-01-12', 'day', 84.2, 69, 68.9, 'cloudy', 21.2], ['2027-01-12', 'night', 79.7, 84, 69.3, 'clear', 21.2],
  ['2027-01-13', 'day', 84.6, 71, 69.2, 'cloudy', 21.2], ['2027-01-13', 'night', 79.8, 86, 69.5, 'clear', 21.2],
  ['2027-01-14', 'day', 84.6, 72, 69.6, 'drizzle', 21.2], ['2027-01-14', 'night', 79.8, 86, 69.7, 'clear', 21.2],
  ['2027-01-15', 'day', 84.4, 72, 69.6, 'drizzle', 21.2], ['2027-01-15', 'night', 79.5, 86, 69.6, 'clear', 21.2],
  ['2027-01-16', 'day', 84.2, 72, 69.2, 'drizzle', 21.2], ['2027-01-16', 'night', 78.7, 86, 68.9, 'cloudy', 21.2],
]);
const LONDON = typical([
  ['2026-12-10', 'day', 42.4, 85, 43.9], ['2026-12-10', 'night', 40.3, 85, 42.2], ['2026-12-11', 'day', 42.3, 84, 43.4],
  ['2026-12-11', 'night', 40.1, 86, 41.9], ['2026-12-12', 'day', 42.4, 85, 43.5], ['2026-12-12', 'night', 40.2, 86, 41.9],
  ['2026-12-13', 'day', 42.6, 86, 43.7], ['2026-12-13', 'night', 40.5, 88, 42.2], ['2026-12-14', 'day', 42.6, 87, 43.7],
  ['2026-12-14', 'night', 40.7, 88, 42.5], ['2026-12-15', 'day', 43.2, 87, 44.5], ['2026-12-15', 'night', 41.8, 88, 43.7],
  ['2026-12-16', 'day', 42.7, 86, 43.9], ['2026-12-16', 'night', 41.1, 87, 43], ['2026-12-17', 'day', 42.9, 85, 44.1],
  ['2026-12-17', 'night', 41.8, 87, 43.7], ['2026-12-18', 'day', 43.7, 85, 44.9], ['2026-12-18', 'night', 42.3, 86, 44],
  ['2026-12-19', 'day', 43.2, 83, 44.2], ['2026-12-19', 'night', 41.6, 84, 43.2],
].map(r => [...r, 'cloudy', 51.5]));
const wornEveryDay = out => out.bottles.filter(b => [...new Set(out.plan.map(p => p.window.dateISO))]
  .every(d => out.plan.some(p => p.window.dateISO === d && p.pick === b.record))).map(b => b.record.name);

// Ten hot July days, 88–92 by day and 76–80 at night.
const SUMMER = Array.from({ length: 10 }, (_, i) => shift('2026-07-10', i))
  .flatMap((d, i) => [win(d, 'day', 90 + ((i * 7) % 5) - 2, 70, { lat: 40 }), win(d, 'night', 78 + ((i * 7) % 5) - 2, 68, { lat: 40 })]);
const sameSet = (out, set) => set.length === out.bottles.length && set.every(f => out.bottles.some(b => b.record.id === f.id));

test('a long trip wears no bottle every day when another set plans nearly as well and rests it', () => {
  const out = packTrip(fragrances, SUMMER, { max: 3 });
  assert.deepEqual(out.uncovered, []);
  assert.deepEqual(wornEveryDay(out), [], out.text);
  assert.equal(out.variety, null);
  // The best-planned three wear one every night; these give up under 0.015 a window, and two nights of it, for a rest.
  const sets = bestSets(SUMMER, 3);
  assert.ok(sets[0].everyDay > 0);
  const mine = sets.find(x => sameSet(out, x.set));
  assert.ok(mine.total < sets[0].total && mine.total >= sets[0].total - 0.015 * SUMMER.length, `${mine.total} vs ${sets[0].total}`);
  assert.ok(mine.most <= sets[0].most - 2, `${mine.most} vs ${sets[0].most}`);
  // Two bottles for a week wear both every day: the best plan, as before.
  const two = packTrip(fragrances, CANCUN, { max: 2 });
  const [best2] = bestSets(CANCUN, 2);
  assert.ok(sameSet(two, best2.set));
});

test('a set that only breaks a run of nights once isn’t variety: the plan stands, and the text says which night bottle to add', () => {
  // Cancún: the three that wear none every day only take one of Supremacy's seven nights, at a cost.
  const out = packTrip(fragrances, CANCUN, { max: 3 });
  const sets = bestSets(CANCUN, 3), [best] = sets;
  assert.ok(best.everyDay > 0 && sameSet(out, best.set), out.text);
  assert.ok(sets.filter(x => !x.everyDay && x.total >= best.total - 0.015 * CANCUN.length).every(x => x.most > best.most - 2));
  const [daily] = wornEveryDay(out);
  assert.equal(out.variety.slot, 'night');
  assert.match(out.text, new RegExp(`${daily} \\(every night\\)`));
  assert.match(out.text, new RegExp(`${daily} is worn every night of the trip; pack ${out.variety.add.name} too and each gets a night off\\.`));
  assert.doesNotMatch(out.text, /every day of the trip/);
});

test('when no three rest a bottle worn every day, the plan names the fourth that would, and packs it when there’s room', () => {
  // London in December: three bottles for twenty windows wear one every day, whichever three.
  assert.ok(bestSets(LONDON, 3).filter(x => x.reached === LONDON.length).every(x => x.everyDay > 0));
  const three = packTrip(fragrances, LONDON, { max: 3 });
  assert.equal(three.bottles.length, 3);
  const [daily] = wornEveryDay(three), add = three.variety?.add;
  assert.ok(daily && add && three.variety.everyDay.map(f => f.name).includes(daily), three.text);
  assert.equal(three.variety.slot, 'day');
  assert.match(three.text, new RegExp(`${daily} \\(every day\\).+ ${daily} is worn every day of the trip; pack ${add.name} too and each gets a day off\\.`));
  const four = packTrip(fragrances, LONDON, { max: 4 });
  assert.equal(four.bottles.length, 4, four.text);
  assert.ok(four.bottles.some(b => b.record.id === add.id) && !wornEveryDay(four).length && !four.variety, four.text);
  // A trip under a week packs as before.
  assert.equal(packTrip(fragrances, LONDON.slice(0, 10), { max: 4 }).variety, null);
});

test('a bottle you rate 2★ or lower stays home unless nothing else suits a window', () => {
  const plain = packTrip(fragrances, MIXED, { max: 4 });
  const night = plain.plan.find(p => p.window.slot === 'night').pick;
  const rated = packTrip(applySkin(fragrances, { [night.id]: { rating: 2 } }), MIXED, { max: 4 });
  assert.ok(!rated.bottles.some(b => b.record.id === night.id), rated.text);
  assert.deepEqual(rated.uncovered, []);
  // Two bottles, the winter one disliked: still the only one for cold nights.
  const summer = plain.plan.find(p => p.window.slot === 'day').pick;
  const pair = applySkin([summer, night], { [night.id]: { rating: 1 } });
  const forced = packTrip(pair, MIXED);
  assert.ok(forced.bottles.some(b => b.record.id === night.id), forced.text);
});

test('an occasion on several days reads once, with its dates', () => {
  const windows = withEvents(trip(4, [60, 45], [52, 42]), [0, 1, 2].map(i => ({ dateISO: shift(START, i), slot: 'day', occasion: occasionById('office') })));
  const out = packTrip(fragrances, windows);
  const all = [out.text, ...out.bottles.map(b => b.why)].join(' ');
  assert.match(all, /the office on Oct 19–21/, all);
  assert.doesNotMatch(all, /the office on Oct \d+ and the office/);
});

test('an event night packs a bottle for the occasion', () => {
  const formal = occasionById('formal');
  const windows = withEvents(trip(3, [60, 45], [52, 42]), [{ dateISO: shift(START, 1), slot: 'night', occasion: formal }]);
  assert.equal(windows[3].occasion, formal);
  assert.equal(windows.filter(w => w.occasion).length, 1);
  const out = packTrip(fragrances, windows);
  const night = out.plan[3];
  assert.equal(night.occasion, formal);
  const best = rank(fragrances, windows[3], 'night', { occasion: formal })[0];
  assert.ok(night.score >= best.score - PLAN_MARGIN, `${night.pick.name} for formal wear`);
  assert.match(out.text, /formal wear on Oct 20/);
});

test('one window packs one bottle; a long trip packs three', () => {
  const single = packTrip(fragrances, [win(START, 'night', 50, 40)]);
  assert.equal(single.bottles.length, 1);
  assert.equal(single.plan[0].pick.id, single.plan[0].top.record.id);
  const long = packTrip(fragrances, trip(10, [45, 35], [38, 30]));
  assert.equal(long.bottles.length, 3);
  assert.equal(packTrip(fragrances, trip(10, [45, 35], [38, 30]), { max: 2 }).bottles.length, 2, 'max wins');
  assert.equal(packTrip([], HOT).bottles.length, 0);
});

test('typical weather says so in the text', () => {
  const typical = HOT.map(w => ({ ...w, typical: true }));
  assert.match(packTrip(fragrances, typical).text, /past the forecast, so this plans on typical weather/);
  assert.match(packTrip(fragrances, [...HOT.slice(0, 4), ...typical.slice(4)]).text, /Dates past the forecast use typical weather\./);
  assert.doesNotMatch(packTrip(fragrances, HOT).text, /typical/);
});

test('picksFor ranks one date and slot, from the forecast or typical weather', async () => {
  const real = globalThis.fetch;
  const today = new Date().toISOString().slice(0, 10);
  globalThis.fetch = async url => {
    const u = new URL(String(url));
    const body = u.hostname === 'api.open-meteo.com'
      ? syntheticForecast(4, { start: today })
      : syntheticForecast(30, { start: u.searchParams.get('start_date') });
    return { ok: true, status: 200, json: async () => body };
  };
  try {
    const place = { lat: 40, lon: -74 };
    const near = await picksFor(fragrances, { place, dateISO: shift(today, 1), occasion: occasionById('date') });
    assert.equal(near.window.slot, 'night', 'the occasion’s slot');
    assert.ok(!near.window.typical);
    assert.equal(near.ranked.length, fragrances.length);
    assert.ok(near.ranked[0].reasons.some(r => /a date/.test(r.text)));
    const far = await picksFor(fragrances, { place, dateISO: shift(today, 40), slot: 'day' });
    assert.ok(far.window.typical);
    assert.equal(far.window.dateISO, shift(today, 40));
    const planned = await tripPlan(fragrances, { place, fromISO: shift(today, 1), toISO: shift(today, 5), events: [{ dateISO: shift(today, 2), slot: 'night', occasion: occasionById('nightout') }] });
    assert.equal(planned.windows.length, 10);
    assert.ok(planned.windows.slice(0, 6).every(w => !w.typical) && planned.windows.slice(6).every(w => w.typical), 'forecast, then typical');
    assert.equal(planned.plan[3].occasion.id, 'nightout');
    assert.match(planned.text, /Dates past the forecast use typical weather\./);
    // A work trip: the office on every day, the event still on its night, nights otherwise plain.
    const work = await tripPlan(fragrances, { place, fromISO: shift(today, 1), toISO: shift(today, 2), occasion: occasionById('office'), events: [{ dateISO: shift(today, 1), slot: 'night', occasion: occasionById('date') }] });
    assert.deepEqual(work.plan.map(p => p.occasion?.id ?? null), ['office', 'date', 'office', null]);
    const nights = await tripPlan(fragrances, { place, fromISO: shift(today, 1), toISO: shift(today, 2), slots: ['night'], occasion: occasionById('formal') });
    assert.deepEqual(nights.plan.map(p => [p.window.slot, p.occasion.id]), [['night', 'formal'], ['night', 'formal']]);
  } finally {
    globalThis.fetch = real;
  }
});
