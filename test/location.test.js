import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadLocation, loadRecent, saveLocation, searchCities } from '../src/location.js';

let store;
beforeEach(() => {
  store = new Map();
  globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
});
afterEach(() => { delete globalThis.localStorage; });

test('stored places without coordinates read as none, and a new place still saves', () => {
  store.set('scentcast.location', JSON.stringify({ a: 1 }));
  assert.equal(loadLocation(), null);
  store.set('scentcast.recentLocations', JSON.stringify({ a: 1 }));
  assert.deepEqual(loadRecent(), []);
  store.set('scentcast.recentLocations', JSON.stringify([{ name: 'X' }, null, { name: 'Oslo', lat: 59.9, lon: 10.75 }]));
  assert.deepEqual(loadRecent().map(r => r.name), ['Oslo']);
  const york = { name: 'New York', lat: 40.71, lon: -74.01 };
  saveLocation(york);
  assert.deepEqual(loadLocation(), york);
  assert.deepEqual(loadRecent().map(r => r.name), ['New York', 'Oslo']);
});

test('a city found keeps its time zone, so a trip there knows its date before the forecast says', async t => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ results: [
    { name: 'Apia', admin1: 'Tuamasaga', country_code: 'WS', latitude: -13.83, longitude: -171.76, timezone: 'Pacific/Apia' },
    { name: 'Nowhere', latitude: 1, longitude: 2 },
  ] }) }));
  const [apia, bare] = await searchCities('apia');
  assert.deepEqual(apia, { name: 'Apia', region: 'Tuamasaga, WS', lat: -13.83, lon: -171.76, timezone: 'Pacific/Apia' });
  assert.equal('timezone' in bare, false);
});
