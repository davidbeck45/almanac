import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadSkin, setSkin, withSkin, applySkin } from '../src/skin.js';
import { rank, quality, performanceLevel } from '../src/engine.js';
import { occasionById, OCCASIONS } from '../src/occasions.js';

const fragrances = JSON.parse(readFileSync(new URL('../data/collection.json', import.meta.url))).fragrances
  .map(f => ({ ...f, id: String(f.id) }));
const byName = name => fragrances.find(f => f.name === name);
const texts = entry => entry.reasons.map(r => `${r.tone === 'good' ? '+' : '-'} ${r.text}`);

const mildDay = { feelsF: 64, humidity: 60, dewF: 50, category: 'clear', date: new Date('2026-10-12T12:00:00'), lat: 40, dateISO: '2026-10-12' };
const coolNight = { feelsF: 50, humidity: 60, dewF: 40, category: 'clear', date: new Date('2026-10-12T12:00:00'), lat: 40, dateISO: '2026-10-12' };

test('entries clean up: stars 1–5 or none, nudges -1, 0 or 1, blank ones drop', () => {
  let skin = withSkin({}, 31861, { rating: 5 }, '2026-10-01');
  assert.deepEqual(skin, { 31861: { rating: 5, longevity: 0, sillage: 0, updated: '2026-10-01' } });
  skin = withSkin(skin, '31861', { longevity: 1, sillage: 7, rating: 9 }, '2026-10-02');
  assert.deepEqual(skin['31861'], { rating: null, longevity: 1, sillage: 0, updated: '2026-10-02' });
  skin = withSkin(skin, '31861', { longevity: 0 });
  assert.deepEqual(skin, {}, 'back to as-voted with no stars drops the entry');
  // What a form hands over: strings, and blanks for none.
  assert.deepEqual(withSkin({}, 7, { rating: '4', longevity: '-1', sillage: '' }, '2026-10-04')['7'],
    { rating: 4, longevity: -1, sillage: 0, updated: '2026-10-04' });
  assert.deepEqual(withSkin({}, 7, { rating: '', longevity: '1' }, '2026-10-04')['7'].rating, null);
  assert.deepEqual(withSkin({}, 7, { rating: 4.5 }), {}, 'whole stars only, so nothing left');
  // Stamped with the device's date, not UTC's.
  const now = new Date();
  const local = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  assert.equal(withSkin({}, 7, { rating: 4 })['7'].updated, local);
  // No localStorage in Node: loading is empty and saving is a no-op.
  assert.deepEqual(loadSkin(), {});
  assert.deepEqual(setSkin('1', { rating: 3 }, '2026-10-03'), { 1: { rating: 3, longevity: 0, sillage: 0, updated: '2026-10-03' } });
});

test('applySkin attaches `personal` to rated bottles only', () => {
  const skin = { 31861: { rating: 4, longevity: -1, sillage: 1, updated: '2026-10-01' } };
  const out = applySkin(fragrances, skin);
  const sauvage = out.find(f => f.id === '31861');
  assert.deepEqual(sauvage.personal, { rating: 4, longevity: -1, sillage: 1 });
  assert.notEqual(sauvage, byName('Sauvage'), 'a new record, so nothing cached on the old one carries over');
  assert.equal(out.find(f => f.name === 'Terra'), byName('Terra'));
  assert.equal(applySkin(fragrances, {}), fragrances);
});

test('your stars outweigh the crowd’s', () => {
  const sauvage = byName('Sauvage');
  const crowd = quality(sauvage);
  const rated = stars => quality({ ...sauvage, personal: { rating: stars } });
  assert.ok(rated(5) > crowd && rated(5) >= 0.8, `${rated(5)}`);
  assert.ok(rated(1) < 0.25, '1★ sinks even a crowd favorite');
  assert.ok(rated(1) < quality({ rating: 0, ratingVotes: 0 }), 'below a bottle nobody rated');
  assert.ok(Math.abs(rated(3) - (0.8 * 0.5 + 0.2 * crowd)) < 1e-9);
  // A near tie goes to the bottle you love.
  const [first, second] = rank(fragrances, mildDay, 'day');
  assert.ok(first.score - second.score < 0.02, 'the test wants a close pair');
  const loved = applySkin(fragrances, { [second.fragrance.id]: { rating: 5 } });
  const after = rank(loved, mildDay, 'day');
  assert.equal(after[0].fragrance.id, second.fragrance.id);
  assert.ok(texts(after[0]).includes('+ You rate it 5★'), texts(after[0]).join(' | '));
});

// Every window's ranking: 8 temperatures, day and night, four months, daily and every occasion.
function grid(records, each) {
  for (const month of ['01', '04', '07', '10']) {
    for (const feelsF of [25, 35, 45, 55, 65, 75, 85, 95]) {
      for (const slot of ['day', 'night']) {
        const dateISO = `2026-${month}-15`;
        const c = { feelsF, humidity: 60, dewF: Math.min(feelsF - 8, 72), category: 'clear', date: new Date(`${dateISO}T12:00:00`), dateISO, lat: 40 };
        for (const occasion of [null, ...OCCASIONS]) each(c, slot, occasion, rank(records, c, slot, { occasion }));
      }
    }
  }
}

test('a bottle you rate 1★ or 2★ drops out of the top 3 unless it’s clearly the only fit', () => {
  // The top pick of each window rated low: where it stays in the top 3, it led the 4th by far.
  const kept = { 1: 0, 2: 0 };
  let windows = 0;
  for (const records of [fragrances, fragrances.filter((_, i) => i % 3 === 0)]) {
    grid(records, (c, slot, occasion, plain) => {
      const top = plain[0].fragrance, lead = plain[0].score - plain[3].score;
      const where = `${top.name}, ${c.feelsF} ${slot} ${c.dateISO} ${occasion?.id ?? 'daily'}`;
      for (const stars of [1, 2]) {
        const rated = rank(applySkin(records, { [top.id]: { rating: stars } }), c, slot, { occasion });
        const at = rated.findIndex(r => r.fragrance.id === top.id);
        if (at < 3) {
          kept[stars]++;
          assert.ok(lead >= (stars === 1 ? 0.1 : 0.06), `${where}: ${stars}★ kept at ${at + 1}, leading the 4th by ${lead.toFixed(3)}`);
        }
        if (at === 0) assert.ok(stars === 2 && plain[0].score - plain[1].score >= 0.06, `${where}: ${stars}★ still the pick`);
        // Far ahead of the rest, it's still worth showing.
        if (lead >= (stars === 1 ? 0.15 : 0.1)) assert.ok(at < 3, `${where}: ${stars}★ dropped though it led the 4th by ${lead.toFixed(3)}`);
      }
      windows++;
    });
  }
  assert.equal(windows, 2 * 64 * (OCCASIONS.length + 1));
  assert.ok(kept[1] > 0 && kept[2] > kept[1], `kept ${JSON.stringify(kept)}`);
});

test('a bottle you rate 5★ wins near ties but doesn’t take every window', () => {
  // The bottle that tops most windows, rated 5★, tops more of them, not all.
  const tops = new Map();
  grid(fragrances, (c, slot, occasion, plain) => tops.set(plain[0].fragrance.id, (tops.get(plain[0].fragrance.id) ?? 0) + 1));
  const [id, before] = [...tops].sort((a, b) => b[1] - a[1])[0];
  let after = 0, windows = 0;
  const loved = applySkin(fragrances, { [id]: { rating: 5 } });
  grid(loved, (c, slot, occasion, ranked) => { windows++; if (ranked[0].fragrance.id === id) after++; });
  assert.ok(after > before && after < windows / 3, `${before} -> ${after} of ${windows}`);
});

test('a low rating says so, and your stars replace the crowd favorite line', () => {
  const supremacy = byName("Supremacy Collector's Edition Pour Homme");
  const plain = rank([supremacy], mildDay, 'day')[0];
  assert.ok(texts(plain).some(t => t.startsWith('+ Crowd favorite')));
  const low = rank(applySkin([supremacy], { [supremacy.id]: { rating: 2 } }), mildDay, 'day')[0];
  assert.ok(texts(low).includes('- You rate it 2★'));
  assert.ok(!texts(low).some(t => t.includes('Crowd favorite')));
  const middling = rank(applySkin([supremacy], { [supremacy.id]: { rating: 3 } }), mildDay, 'day')[0];
  assert.ok(!texts(middling).some(t => t.includes('rate it') || t.includes('Crowd favorite')), '3★ says nothing either way');
  assert.ok(low.score < plain.score);
});

test('skin nudges shift performance by half a level and speak for themselves', () => {
  const sauvage = byName('Sauvage');
  const base = performanceLevel(sauvage, 'sillage');
  assert.ok(Math.abs(performanceLevel({ ...sauvage, personal: { sillage: 1 } }, 'sillage') - (base + 0.5)) < 1e-9);
  assert.ok(Math.abs(performanceLevel({ ...sauvage, personal: { sillage: -1 } }, 'sillage') - (base - 0.5)) < 1e-9);
  assert.equal(performanceLevel({ ...byName('Terra'), personal: { sillage: 1 } }, 'sillage'), 1, 'clamped');
  assert.equal(performanceLevel({ id: 'x', accords: {}, personal: { longevity: -1 } }, 'longevity'), -0.5, 'unrated bottles move from the middle');

  // Office wants it quiet: quieter on you helps, and replaces the crowd's "Stays close".
  const office = occasionById('office');
  const quiet = rank(applySkin([sauvage], { [sauvage.id]: { sillage: -1 } }), mildDay, 'day', { occasion: office })[0];
  const plain = rank([sauvage], mildDay, 'day', { occasion: office })[0];
  assert.ok(texts(quiet).includes('+ Sits closer on you'), texts(quiet).join(' | '));
  assert.ok(!texts(quiet).includes('+ Stays close to the skin'));
  assert.ok(quiet.score > plain.score);

  // A date wants it lasting: fading faster on you counts against it.
  const date = occasionById('date');
  const brun = byName('Liquid Brun');
  const longer = rank(applySkin([brun], { [brun.id]: { longevity: 1 } }), coolNight, 'night', { occasion: date })[0];
  assert.ok(texts(longer).includes('+ Lasts longer on you'), texts(longer).join(' | '));
  assert.ok(!texts(longer).includes('+ Lasts the whole night'), 'one longevity reason, not two');
  const shorter = rank(applySkin([brun], { [brun.id]: { longevity: -1 } }), coolNight, 'night', { occasion: date })[0];
  assert.ok(texts(shorter).includes('- Fades faster on you'), texts(shorter).join(' | '));

  // Daily picks don't read performance, so nudges change nothing there.
  const daily = rank(applySkin(fragrances, { [sauvage.id]: { sillage: 1, longevity: 1 } }), mildDay, 'day');
  const before = rank(fragrances, mildDay, 'day');
  assert.deepEqual(daily.map(r => r.score), before.map(r => r.score));
  assert.ok(!daily.some(r => texts(r).some(t => t.includes('on you'))));
});
