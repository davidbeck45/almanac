import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadHidden, setHidden, hiddenFor } from '../src/hidden.js';
import { loadHistory, toggleWear, wearSettled } from '../src/history.js';
import { setEvent } from '../src/events.js';

// Two tabs open on one device: two copies of the app's state over the one
// localStorage, each read when its tab opened.
let store;
beforeEach(() => {
  store = new Map();
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  };
});
let opened = 0;
const openTab = () => import(`../src/app/state.js?tab=${++opened}`);
const bottle = (id, name) => ({
  id, name, brand: 'X', accords: { woody: 100 }, season: { winter: 1, spring: 1, summer: 1, fall: 1 }, dayNight: { day: 1, night: 1 },
});
const mineNames = () => JSON.parse(store.get('scentcast.mine')).records.map(r => r.name);

test('a bottle added to Mine in one tab stays when another tab adds or removes one', async () => {
  store.set('scentcast.mine', JSON.stringify({ name: 'Brooke', records: [bottle('1', 'One')] }));
  const a = await openTab(), b = await openTab();
  assert.equal(a.addToMine(bottle('2', 'Two')), true);
  assert.equal(b.addToMine(bottle('3', 'Three')), true, 'tab B, opened before, adds its own');
  assert.deepEqual(mineNames(), ['One', 'Two', 'Three']);
  assert.equal(b.addToMine(bottle('2', 'Two')), false, 'one tab A added already isn’t added twice');
  b.updateMine(mine => { mine.records = mine.records.filter(r => r.id !== '1'); });
  a.updateMine(mine => { mine.name = 'Brooke’s'; });
  assert.deepEqual(mineNames(), ['Two', 'Three']);
  assert.equal(JSON.parse(store.get('scentcast.mine')).name, 'Brooke’s');
  assert.deepEqual(a.state.mine.records.map(r => r.name), ['Two', 'Three'], 'the tab that saved holds what it saved');
});

test('bottles switched off in two tabs both stay off', () => {
  const a = loadHidden(), b = loadHidden();
  setHidden(a, '111', true, true);
  setHidden(b, '222', true, true);
  assert.deepEqual([...loadHidden().hidden].sort(), ['111', '222']);
  setHidden(a, '4310', false, true); // Jake, switched on in the demo
  setHidden(b, '333', true, false);
  const both = loadHidden();
  assert.ok(!hiddenFor(both, true).has('4310'), 'the default tab A switched on stays on');
  assert.deepEqual([...both.hidden].sort(), ['111', '222', '333']);
});

test('each tab saves only the prefs it changed, over what the other saved', async () => {
  const a = await openTab(), b = await openTab();
  a.setLikedStyles(['skin', 'clean']);
  b.setPreferValue(false);
  b.state.occasion = 'formal';
  b.savePrefs();
  a.setStillSky(true);
  const prefs = a.loadPrefs();
  assert.deepEqual(prefs.likedStyles, ['skin', 'clean'], 'tab B kept tab A’s styles');
  assert.equal(prefs.preferValue, false);
  assert.equal(prefs.occasion, 'formal', 'tab A kept tab B’s occasion');
  assert.equal(prefs.stillSky, true);
});

test('a tab reads again what another tab saved', async () => {
  const a = await openTab(), b = await openTab();
  a.addToMine(bottle('2', 'Two'));
  setHidden(a.state.hiding, '111', true, true);
  a.setLikedStyles(['vanilla']);
  a.setPreferValue(true);
  a.state.history = toggleWear('2', '2026-11-02', 'day');
  setEvent('2026-11-07', 'night', 'formal', '2026-11-02');
  assert.deepEqual(b.state.mine.records, []);
  b.reloadStored();
  assert.deepEqual(b.state.mine.records.map(r => r.id), ['2']);
  assert.ok(b.hiddenIn(true).has('111'));
  assert.deepEqual(b.state.likedStyles, ['vanilla']);
  assert.equal(b.state.preferValue, true);
  assert.equal(b.state.history[0].id, '2');
  assert.deepEqual(b.state.events.map(e => e.occasion), ['formal']);
  // And what it saves next starts from there.
  b.setLikedStyles(['vanilla', 'amber']);
  assert.equal(a.loadPrefs().preferValue, true);
});

test('a wear button drawn before another tab logged that wear finds it done', () => {
  const shown = loadHistory(); // the journal as the stale tab drew it: nothing worn
  toggleWear('7', '2026-11-02', 'night'); // the other tab logs it
  assert.equal(wearSettled(shown, '7', '2026-11-02', 'night'), true, 'Wear this: done already, so it mustn’t clear it');
  assert.equal(wearSettled(shown, '8', '2026-11-02', 'night'), false, 'another bottle for the window is a change of mind');
  assert.equal(wearSettled(loadHistory(), '7', '2026-11-02', 'night'), false, 'a button drawn from the journal as it is toggles');
  const wearing = loadHistory();
  toggleWear('7', '2026-11-02', 'night'); // the other tab clears it
  assert.equal(wearSettled(wearing, '7', '2026-11-02', 'night'), true, 'Wearing: cleared already, so it mustn’t log it again');
});
