import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sprayGuide, concentrationOf } from '../src/spray.js';
import { occasionById, OCCASIONS } from '../src/occasions.js';

const fragrances = JSON.parse(readFileSync(new URL('../data/collection.json', import.meta.url))).fragrances
  .map(f => ({ ...f, id: String(f.id) }));
const byName = name => fragrances.find(f => f.name === name);

// Bottles described the way people talk about them.
const bottle = (name, longevity, sillage, votes, accords) => ({ id: name, name, brand: 'Test', accords, parfumo: { longevity, sillage, votes } });
const BEAST = bottle('Monster Extrait de Parfum', 9.3, 9.1, 900, { oud: 100, 'warm spicy': 85, amber: 75, leather: 60 });
const BREEZE = bottle('Breeze Eau de Cologne', 5.2, 5, 300, { citrus: 100, aromatic: 70, fresh: 60 });
const MIDDLE = bottle('Middle Eau de Parfum', 7.8, 7.4, 500, { woody: 100, aromatic: 70, citrus: 50 });
const SKIN = bottle('Second Skin', 6.6, 6.0, 400, { musky: 100, woody: 60, powdery: 50 });
const LOUD = bottle('Room Filler', 8.9, 8.8, 700, { sweet: 100, vanilla: 80, amber: 70 });

const HOT_STICKY = { feelsF: 92, humidity: 70, dewF: 74 };
const HOT_DRY = { feelsF: 96, humidity: 20, dewF: 45 };
const MILD = { feelsF: 64, humidity: 55, dewF: 48 };
const COOL = { feelsF: 52, humidity: 60, dewF: 40 };
const COLD = { feelsF: 28, humidity: 60, dewF: 18 };

// [what, record, conditions, occasion, fewest, most]: the range must sit inside [fewest, most].
const CASES = [
  ['a beast-mode extrait on a hot office day', BEAST, HOT_STICKY, 'office', 1, 1],
  ['a light cologne on a cold night out', BREEZE, COLD, 'nightout', 4, 6],
  ['an average EDP on a mild day', MIDDLE, MILD, null, 2, 3],
  ['an average EDP on a cold night out', MIDDLE, COLD, 'nightout', 4, 5],
  ['an average EDP at the office', MIDDLE, MILD, 'office', 1, 2],
  ['an average EDP in dry heat', MIDDLE, HOT_DRY, null, 1, 2],
  ['a room filler on a date', LOUD, COOL, 'date', 1, 2],
  ['a room filler on a mild day', LOUD, MILD, null, 1, 2],
  ['a room filler on a cold night out', LOUD, COLD, 'nightout', 2, 4],
  ['a skin scent at the office', SKIN, MILD, 'office', 2, 2],
  ['a skin scent on a mild day', SKIN, MILD, null, 4, 5],
  ['a skin scent at home', SKIN, COOL, 'cozy', 2, 3],
  // Heat takes little off fresh notes, which burn off (spray as usual and top
  // up), and a lot off rich ones, which turn cloying.
  ['a light cologne on a hot sticky day', BREEZE, HOT_STICKY, null, 4, 6],
  ['a room filler on a hot sticky day', LOUD, HOT_STICKY, null, 1, 1],
  ['Essence de Blanc, a fresh citrus, on a hot sticky day', byName('Essence de Blanc'), HOT_STICKY, null, 2, 3],
  ['CH Men Prive, quiet whisky and leather, on a hot sticky day', byName('CH Men Prive'), HOT_STICKY, null, 1, 2],
  ['Cream Velvet, a vanilla gourmand, in dry heat', byName('Cream Velvet'), HOT_DRY, null, 1, 2],
  ['Terra, a beast, on a hot sticky day', byName('Terra'), HOT_STICKY, null, 1, 1],
  ['Terra on a date', byName('Terra'), COOL, 'date', 1, 1],
  ['Liquid Brun on a cold night out', byName('Liquid Brun'), COLD, 'nightout', 3, 4],
  ['Sauvage on a mild day', byName('Sauvage'), MILD, null, 2, 3],
  ['Jake, a faint cologne, on a mild day', byName('Jake'), MILD, null, 4, 6],
  ['Shiyaaka Sky, a skin scent, outdoors', byName('Shiyaaka Sky'), MILD, 'outdoors', 4, 6],
];

test('spray counts a fragrance enthusiast would agree with', () => {
  for (const [what, record, conditions, occasion, fewest, most] of CASES) {
    const g = sprayGuide(record, conditions, occasion && occasionById(occasion));
    const [lo, hi] = g.sprays;
    assert.ok(lo >= fewest && hi <= most && lo <= hi, `${what}: ${lo}–${hi}, wanted ${fewest}–${most}. ${g.text}`);
  }
});

test('heat and the office keep it low and under a shirt; a date by the neck; cold on fabric', () => {
  const hot = sprayGuide(MIDDLE, HOT_STICKY);
  assert.ok(!hot.where.includes('neck'), hot.where.join(', '));
  assert.match(hot.text, /under your shirt/);
  const breeze = sprayGuide(BREEZE, HOT_STICKY);
  assert.equal(breeze.where[0], 'neck', 'heat won’t make a quiet cologne loud');
  assert.doesNotMatch(breeze.text, /under your shirt/);
  const office = sprayGuide(SKIN, MILD, 'office');
  assert.deepEqual(office.where, ['chest', 'stomach']);
  assert.equal(sprayGuide(MIDDLE, COOL, 'date').where[0], 'neck');
  assert.ok(sprayGuide(MIDDLE, COLD).where.includes('collar or scarf'));
  for (const [, record, conditions, occasion] of CASES) {
    const g = sprayGuide(record, conditions, occasion);
    assert.ok(g.where.length >= 1 && g.where.length <= g.sprays[1], g.text);
  }
});

test('what the name claims counts, and counts less once voters have rated it', () => {
  const plain = { id: 'x', accords: { woody: 100, citrus: 60 } };
  const mid = g => (g.sprays[0] + g.sprays[1]) / 2;
  const extrait = sprayGuide({ ...plain, name: 'Woods Extrait de Parfum' }, MILD);
  const edt = sprayGuide({ ...plain, name: 'Woods Eau de Toilette' }, MILD);
  const cologne = sprayGuide({ ...plain, name: 'Woods Cologne' }, MILD);
  assert.ok(mid(edt) - mid(extrait) >= 1, `${extrait.sprays} vs ${edt.sprays}`);
  assert.ok(mid(cologne) >= mid(edt));
  assert.equal(concentrationOf('Bleu de Chanel Parfum').why, 'Parfum strength');
  assert.equal(concentrationOf('Bleu de Chanel Eau de Parfum'), null, 'EDP is the baseline');
  assert.equal(concentrationOf('Hawas Elixir').why, 'A concentrated version');
  assert.equal(concentrationOf('Essence de Blanc'), null);
  assert.ok(extrait.why.includes('Extrait strength'));
});

test('your skin nudges move the count', () => {
  const mid = g => (g.sprays[0] + g.sprays[1]) / 2;
  const base = sprayGuide(MIDDLE, MILD);
  const louder = sprayGuide(MIDDLE, MILD, null, { sillage: 1 });
  const quieter = sprayGuide({ ...MIDDLE, personal: { sillage: -1 } }, MILD);
  assert.ok(mid(louder) < mid(base) && mid(quieter) > mid(base), `${louder.sprays} ${base.sprays} ${quieter.sprays}`);
  assert.ok(louder.why.includes('Projects more on you'));
  const fades = sprayGuide(MIDDLE, MILD, null, { longevity: -1 });
  assert.ok(fades.why.includes('Fades faster on you'));
  assert.match(fades.note, /top up/);
});

test('heat takes more off a rich bottle than a fresh one, and says why', () => {
  const drop = (f, c) => sprayGuide(f, MILD).sprays[0] - sprayGuide(f, c).sprays[0];
  assert.ok(drop(LOUD, HOT_DRY) >= 0 && drop(MIDDLE, HOT_STICKY) > drop(BREEZE, HOT_STICKY), 'a middling bottle loses more than a cologne');
  const rich = sprayGuide(byName('CH Men Prive'), HOT_STICKY);
  const fresh = sprayGuide(byName('Essence de Blanc'), HOT_STICKY);
  assert.ok(rich.sprays[1] <= fresh.sprays[0], `${rich.sprays} vs ${fresh.sprays}`);
  assert.ok(rich.why.includes('Sticky heat makes rich notes cloying'), rich.why.join(' | '));
  assert.equal(fresh.note, 'Fresh notes burn off fast in heat; take it along to top up.');
});

test('notes: top up what fades, by the crowd or on you; close-wearing only when it is', () => {
  // Jake fades early by the crowd's votes: top up beats "wears close", in any weather.
  for (const c of [HOT_STICKY, MILD, COLD]) {
    const jake = sprayGuide(byName('Jake'), c, 'nightout');
    assert.match(jake.note, /top up/, jake.text);
    assert.doesNotMatch(`${jake.text} ${jake.note}`, /fades early.*fades early/, 'says it once');
  }
  // A close-wearing bottle that projects more on you says neither "wears close" nor contradicts you.
  const sky = sprayGuide(byName('Shiyaaka Sky'), MILD, null, { sillage: 1, longevity: 1 });
  assert.ok(sky.why.includes('Projects more on you'));
  assert.doesNotMatch(sky.note ?? '', /wears close/);
  // When it does wear close and lasts, the note says the count won't crowd anyone.
  const close = sprayGuide({ ...SKIN, parfumo: { ...SKIN.parfumo, longevity: 8.6, sillage: 5.6 } }, MILD);
  assert.equal(close.note, 'It wears close, so this many won’t crowd anyone.', close.text);
});

test('plain sentences, never a temperature', () => {
  const situations = [HOT_STICKY, HOT_DRY, MILD, COOL, COLD];
  for (const f of [...fragrances, BEAST, BREEZE, MIDDLE, SKIN, LOUD]) {
    for (const conditions of situations) {
      for (const occasion of [null, ...OCCASIONS]) {
        const g = sprayGuide(f, conditions, occasion);
        const all = [g.text, g.note ?? '', ...g.why].join(' ');
        assert.doesNotMatch(all, /°|\d+\s*F\b|degrees/, all);
        // The only numbers are the spray counts.
        for (const n of all.match(/\d+/g) ?? []) assert.ok(g.sprays.includes(Number(n)), `${n} in "${g.text}"`);
        assert.ok(g.text.split(/(?<=\.)\s/).length <= 2, g.text);
        assert.match(g.text, /^\d/);
        assert.ok(g.sprays[0] >= 1 && g.sprays[1] <= 6 && g.sprays[0] <= g.sprays[1]);
      }
    }
  }
});
