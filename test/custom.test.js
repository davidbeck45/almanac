import { test } from 'node:test';
import assert from 'node:assert/strict';
import { customRecord, shareToken, fromShareToken, isCustomId, MAX_CUSTOM_ACCORDS } from '../src/custom.js';
import { rank } from '../src/engine.js';

const sum = o => Object.values(o).reduce((a, b) => a + b, 0);
const GOURMAND = { name: 'Caramellino', brand: 'Litoralle Aromatica', accords: ['caramel', 'vanilla', 'sweet', 'amber'] };
const FRESH = { name: 'Sea Glass', accords: ['citrus', 'aquatic', 'green'] };

test('a hand-entered bottle has the engine shape, strongest accord first', () => {
  const r = customRecord(GOURMAND);
  assert.ok(isCustomId(r.id));
  assert.equal(r.source, 'custom');
  assert.deepEqual(r.accords, { caramel: 100, vanilla: 88, sweet: 76, amber: 64 });
  assert.ok(Math.abs(sum(r.season) - 1) < 0.01);
  assert.ok(Math.abs(r.dayNight.day + r.dayNight.night - 1) < 0.001);
  assert.equal(r.ratingVotes, 0, 'no rating, so quality stays neutral');
});

test('without picks, heavy accords lean cold and night, fresh ones warm and day', () => {
  const warm = customRecord(GOURMAND), cool = customRecord(FRESH);
  assert.ok(warm.season.winter + warm.season.fall > 0.65);
  assert.ok(cool.season.summer + cool.season.spring > 0.65);
  assert.ok(warm.dayNight.night > 0.55);
  assert.ok(cool.dayNight.night < 0.4);
  assert.ok(Object.values(cool.season).every(x => x > 0), 'no season drops to zero');
});

test('the owner’s season and time picks move the estimate', () => {
  const plain = customRecord(GOURMAND);
  const summerDay = customRecord({ ...GOURMAND, seasons: ['summer'], time: 'day' });
  assert.ok(summerDay.season.summer > plain.season.summer + 0.3);
  assert.ok(summerDay.dayNight.night < plain.dayNight.night - 0.2);
  const allDay = customRecord({ ...FRESH, time: 'both' });
  assert.ok(Math.abs(allDay.dayNight.night - 0.5) < Math.abs(customRecord(FRESH).dayNight.night - 0.5));
});

test('unknown accords are dropped and the list is capped', () => {
  const r = customRecord({ name: 'X', accords: ['smoke machine', 'woody', 'rose', 'musky', 'amber', 'iris', 'leather', 'oud'] });
  assert.equal(Object.keys(r.accords).length, MAX_CUSTOM_ACCORDS);
  assert.equal(Object.keys(r.accords)[0], 'woody');
  assert.equal(customRecord({ name: 'Mystery', accords: ['smoke machine'] }), null, 'nothing to go on');
  assert.equal(customRecord({ name: 'Mystery', accords: [] }), null);
});

test('share tokens carry the bottle whole, accents included', () => {
  const r = customRecord({ name: 'Bois Impérial Noir', brand: 'd’Annam', accords: ['woody', 'oud'], seasons: ['fall'], time: 'night' });
  const token = shareToken(r);
  assert.match(token, /^my:[a-z0-9]+~[A-Za-z0-9_-]+$/, 'URL-safe without escaping');
  const back = fromShareToken(token);
  assert.equal(back.id, r.id);
  assert.equal(back.name, r.name);
  assert.equal(back.brand, r.brand);
  assert.deepEqual(back.accords, r.accords);
  for (const s of ['winter', 'spring', 'summer', 'fall']) assert.ok(Math.abs(back.season[s] - r.season[s]) < 0.01);
  assert.ok(Math.abs(back.dayNight.night - r.dayNight.night) < 0.01);
});

test('malformed share tokens are rejected, not half-loaded', () => {
  const b64 = v => Buffer.from(JSON.stringify(v)).toString('base64url');
  for (const bad of [
    'my:abc',
    'my:abc~!!!',
    `my:abc~${b64([])}`,
    `my:abc~${b64(['', '', ['woody'], [25, 25, 25, 25], 50])}`,
    `my:abc~${b64(['Name', '', ['not an accord'], [25, 25, 25, 25], 50])}`,
    `my:abc~${b64(['Name', '', ['woody'], [0, 0, 0, 0], 50])}`,
    `my:ABC<x>~${b64(['Name', '', ['woody'], [25, 25, 25, 25], 50])}`,
    `fg:abc~${b64(['Name', '', ['woody'], [25, 25, 25, 25], 50])}`,
  ]) assert.equal(fromShareToken(bad), null, bad);
});

test('reasons for a hand-entered bottle don’t claim votes', () => {
  const warm = customRecord({ ...GOURMAND, seasons: ['winter'] });
  const [entry] = rank([warm], { feelsF: 88, humidity: 40, category: 'clear', date: new Date('2026-07-15T12:00:00'), lat: 40 }, 'day');
  const texts = entry.reasons.map(r => r.text);
  assert.ok(texts.some(t => /^Better in winter than summer$/.test(t)), texts.join(' | '));
  assert.ok(!texts.some(t => /voted/i.test(t)));
});
