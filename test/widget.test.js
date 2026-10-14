import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { activeBottles, resolvePlace, widgetPayload } from '../omarchy/widget.mjs';
import { syntheticForecast } from './fixtures.js';

const { fragrances } = JSON.parse(readFileSync(new URL('../data/collection.json', import.meta.url)));
const place = { name: 'Test', lat: 40, lon: -74 };

test('the widget leads with the next window and plans the rest of the week', () => {
  // 20:00 local on the 28th: tonight comes first, then tomorrow's daytime
  const out = widgetPayload(fragrances, syntheticForecast(7), place, Date.parse('2026-09-29T00:00:00Z'));
  assert.equal(out.now.label, 'Tonight');
  assert.equal(out.next.label, 'Tomorrow');
  assert.equal(out.days.length, 7);
  assert.equal(out.days[0].day, null);
  assert.equal(out.days[0].night.id, out.now.id, 'the week agrees with the pick for now');
  assert.equal(out.days[1].day.id, out.next.id);
  assert.notEqual(out.now.runnerUp.name, out.now.name);
  assert.ok(out.now.reasons.length > 0 && out.now.reasons.length <= 4);
  assert.ok(out.now.accords.every(a => /^#[0-9a-f]{6}$/.test(a.color)));
  assert.ok(out.now.match >= 1 && out.now.match <= 99);
});

test('the widget hides the site defaults unless told otherwise', () => {
  const jake = fragrances.find(f => String(f.id) === '4310');
  assert.ok(!activeBottles(fragrances).includes(jake));
  assert.equal(activeBottles(fragrances, []).length, fragrances.length);
  const rest = activeBottles(fragrances, [jake.name.toUpperCase(), ' Sauvage ']);
  assert.ok(!rest.includes(jake));
  assert.ok(!rest.some(f => f.name === 'Sauvage'));
});

test('a coordinate setting or Omarchy\'s weather location resolves without a lookup', async () => {
  assert.deepEqual(await resolvePlace('32.93,-97.08,Grapevine, TX'), { name: 'Grapevine, TX', lat: 32.93, lon: -97.08 });
  assert.deepEqual(await resolvePlace(' 51.5 , -0.12 '), { name: '51.5,-0.12', lat: 51.5, lon: -0.12 });
  for (const bad of ['999,999', '91,0', '0,-181']) {
    await assert.rejects(resolvePlace(bad), /^Error: Set a latitude between -90 and 90 and a longitude between -180 and 180\.$/, bad);
  }

  const stateFile = join(mkdtempSync(join(tmpdir(), 'scentcast-')), 'weather.json');
  writeFileSync(stateFile, JSON.stringify({ name: 'Malibu', latitude: 34.03, longitude: -118.78 }));
  assert.deepEqual(await resolvePlace('', { stateFile }), { name: 'Malibu', lat: 34.03, lon: -118.78 });
});
