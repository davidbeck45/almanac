import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { packTrip, withEvents, picksFor } from '../src/pack.js';
import { rank, PLAN_MARGIN } from '../src/engine.js';
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
  assert.match(one.text, new RegExp(`Nothing packed is quite right for .+; ${missing} would be, if there's room\\.`));
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
  } finally {
    globalThis.fetch = real;
  }
});
