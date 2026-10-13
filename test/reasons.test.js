import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rank } from '../src/engine.js';
import { OCCASIONS } from '../src/occasions.js';
import { ACCORDS } from '../src/accords.js';
import { fromFragrantica } from '../src/fragrantica.js';

const load = f => JSON.parse(readFileSync(new URL(`../data/${f}.json`, import.meta.url))).fragrances;
const shard = n => Object.entries(JSON.parse(readFileSync(new URL(`../data/fragrantica/r/${n}.json`, import.meta.url))))
  .map(([id, row]) => fromFragrantica(id, row));
// The wardrobe, the catalog and two dataset shards (about 540 bottles of every kind).
const bottles = [...load('collection'), ...load('catalog'), ...shard(0), ...shard(1)];

const CONDITIONS = [
  { feelsF: 94, dewF: 72, category: 'clear', date: new Date('2026-07-15T12:00:00'), lat: 40 },
  { feelsF: 100, dewF: 40, category: 'clear', date: new Date('2026-07-15T12:00:00'), lat: 33 },
  { feelsF: 24, dewF: 14, category: 'snow', date: new Date('2027-01-15T12:00:00'), lat: 40 },
  { feelsF: 50, dewF: 46, category: 'rain', date: new Date('2026-10-15T12:00:00'), lat: 47 },
  { feelsF: 84, dewF: 74, category: 'storm', date: new Date('2026-12-15T12:00:00'), lat: 1.3 },
];
const MULTI_WORD = Object.keys(ACCORDS).filter(a => /[\s-]/.test(a));

function* reasons() {
  // Ranked 25 at a time, like a real collection.
  for (let i = 0; i < bottles.length; i += 25) {
    const chunk = bottles.slice(i, i + 25);
    for (const c of CONDITIONS) {
      for (const slot of ['day', 'night']) {
        for (const occasion of [null, ...OCCASIONS]) {
          for (const r of rank(chunk, { ...c, humidity: 60 }, slot, { occasion })) {
            for (const x of r.reasons) yield [x.text, r.fragrance];
          }
        }
      }
    }
  }
}

test('reasons read as plain sentences over the wardrobe and the dataset', () => {
  assert.ok(bottles.length > 300);
  const bad = new Map();
  const flag = (why, text) => bad.has(why) || bad.set(why, text);
  let rain = 0;
  for (const [text, frag] of reasons()) {
    if (/\b(\w+)\s+\1\b/i.test(text)) flag('doubled word', text);
    if (/°|\d\s*F\b/.test(text)) flag('temperature number', text);
    const raw = MULTI_WORD.find(a => text.toLowerCase().includes(a));
    if (raw) flag(`raw accord name "${raw}"`, text);
    if (/^Fresh (musky|coconut|fruity|tropical|sweet)|musk\w* cuts? the heat/i.test(text)) flag('not a heat cutter', text);
    if (text !== text.charAt(0).toUpperCase() + text.slice(1)) flag('lowercase start', text);
    // A rain reason names an accord the bottle has.
    const wet = text.match(/^(.+) suits? the rain$/);
    if (wet) {
      rain++;
      const named = { Woods: 'woody', 'Green notes': 'green', 'Earthy notes': 'earthy', Aromatics: 'aromatic', Moss: 'mossy', 'Aquatic notes': 'aquatic' }[wet[1]];
      if (!named || !frag.accords[named]) flag('rain reason names an accord the bottle lacks', `${frag.name}: ${text}`);
    }
  }
  assert.ok(rain > 0, 'rain reasons were checked');
  assert.deepEqual([...bad].map(([why, text]) => `${why}: ${text}`), []);
});

test('weather reasons name the accord doing the work', () => {
  const wardrobe = load('collection');
  const hot = rank(wardrobe, CONDITIONS[0], 'day');
  const cold = rank(wardrobe, CONDITIONS[2], 'night');
  const text = (list, name) => list.find(r => r.fragrance.name === name).reasons.map(r => r.text);
  assert.ok(text(hot, 'Essence de Blanc').includes('Bright citrus cuts the heat'), text(hot, 'Essence de Blanc').join(' | '));
  assert.ok(text(cold, 'Liquid Brun').some(t => /^(Warm spice|Warm vanilla|Warm cinnamon|Rich leather) for the cold$/.test(t)), text(cold, 'Liquid Brun').join(' | '));
  // Bottle-specific reasons lead the generic season and time votes.
  const top = hot[0].reasons.filter(r => r.tone === 'good').map(r => r.text);
  assert.match(top[0], /the heat$/, top.join(' | '));
});
