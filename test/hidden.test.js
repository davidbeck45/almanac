import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_HIDDEN, loadHidden, setHidden, hiddenFor } from '../src/hidden.js';

// A stand-in for the browser's localStorage, fresh for each test.
let store;
beforeEach(() => {
  store = new Map();
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  };
});

test('the default hidden bottles tidy the demo only', () => {
  const h = loadHidden(); // a first visit
  assert.deepEqual([...hiddenFor(h, true)], DEFAULT_HIDDEN);
  assert.ok(hiddenFor(h, true).has('4310'), 'Jake stays out of the demo');
  assert.ok(!hiddenFor(h, false).has('4310'), 'but shows in someone’s own or shared list');
});

test('hiding a bottle in a shared list leaves the defaults out of it', () => {
  const h = loadHidden();
  setHidden(h, '99', true, false);
  assert.ok(hiddenFor(h, false).has('99'));
  assert.ok(!hiddenFor(h, false).has('4310'), 'Jake doesn’t follow an unrelated hide into the shared list');
  assert.ok(hiddenFor(h, true).has('4310') && hiddenFor(h, true).has('99'));
  // Undo, and a reload, keep it that way.
  setHidden(h, '99', false, false);
  const again = loadHidden();
  assert.deepEqual([...hiddenFor(again, false)], []);
  assert.deepEqual([...hiddenFor(again, true)], DEFAULT_HIDDEN);
});

test('switching a default on in the demo holds after a reload, and back off restores it', () => {
  const h = loadHidden();
  setHidden(h, '4310', false, true);
  assert.ok(!hiddenFor(loadHidden(), true).has('4310'));
  setHidden(h, '4310', true, true);
  assert.ok(hiddenFor(loadHidden(), true).has('4310'));
  assert.ok(!hiddenFor(loadHidden(), false).has('4310'));
});

test('a default hidden in a shared list stays hidden there, and the demo can still show it', () => {
  const h = loadHidden();
  setHidden(h, '4310', true, false);
  assert.ok(hiddenFor(h, false).has('4310'));
  setHidden(h, '4310', false, true);
  assert.ok(!hiddenFor(h, true).has('4310') && !hiddenFor(h, false).has('4310'));
});

test('a list saved before the split keeps the demo as it was', () => {
  // The old format: one list, defaults included while still hidden.
  store.set('scentcast.hidden', JSON.stringify(['4310', '99']));
  let h = loadHidden();
  assert.deepEqual([...hiddenFor(h, true)].sort(), ['4310', '99']);
  assert.deepEqual([...hiddenFor(h, false)], ['99']);
  // A default missing from it had been switched on.
  store.clear();
  store.set('scentcast.hidden', JSON.stringify([99]));
  h = loadHidden();
  assert.deepEqual([...hiddenFor(h, true)], ['99']);
});
