import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_HIDDEN, loadHidden, saveHidden, hiddenFor } from '../src/hidden.js';

test('the default hidden bottles tidy the demo only, until the device chooses', () => {
  const hidden = loadHidden(); // no localStorage here: a first visit
  assert.deepEqual([...hidden], DEFAULT_HIDDEN);
  assert.ok(hiddenFor(hidden, true).has('4310'), 'Jake stays out of the demo');
  assert.ok(!hiddenFor(hidden, false).has('4310'), 'but shows in someone’s own or shared list');
  // Once the device makes its own choices, they hold everywhere.
  hidden.add('99');
  saveHidden(hidden);
  assert.ok(hiddenFor(hidden, false).has('4310') && hiddenFor(hidden, false).has('99'));
});
