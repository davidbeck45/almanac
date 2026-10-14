import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadLocation, loadRecent, saveLocation } from '../src/location.js';

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
