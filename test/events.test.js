import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadEvents, setEvent, tidyEvents, eventOn, withStoredEvents } from '../src/events.js';

// A stand-in for the browser's localStorage, fresh for each test.
let store;
beforeEach(() => {
  store = new Map();
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  };
});

const TODAY = '2026-10-26';

test('events save one a window, in time order, and clear', () => {
  assert.deepEqual(loadEvents(TODAY), []);
  setEvent('2026-10-31', 'night', 'formal', TODAY);
  setEvent('2026-10-27', 'night', 'date', TODAY);
  const list = setEvent('2026-10-27', 'day', 'office', TODAY);
  assert.deepEqual(list.map(e => `${e.dateISO} ${e.slot} ${e.occasion}`), ['2026-10-27 day office', '2026-10-27 night date', '2026-10-31 night formal']);
  assert.deepEqual(loadEvents(TODAY), list, 'read back as saved');
  // Another occasion on a window takes its place; null clears it.
  setEvent('2026-10-27', 'night', 'nightout', TODAY);
  assert.equal(eventOn(loadEvents(TODAY), { dateISO: '2026-10-27', slot: 'night' }).occasion, 'nightout');
  assert.equal(loadEvents(TODAY).length, 3);
  setEvent('2026-10-27', 'night', null, TODAY);
  assert.equal(eventOn(loadEvents(TODAY), { dateISO: '2026-10-27', slot: 'night' }), null);
  assert.equal(loadEvents(TODAY).length, 2);
});

test('dates gone by drop out, and only events in the stored shape load', () => {
  store.set('scentcast.events', JSON.stringify([
    { dateISO: '2026-10-20', slot: 'night', occasion: 'formal' }, // gone by
    { dateISO: '2026-10-28', slot: 'evening', occasion: 'date' }, // no such slot
    { dateISO: '2026-10-28', slot: 'night', occasion: 'gala' }, // no such occasion
    { dateISO: '2026-13-01', slot: 'night', occasion: 'date' }, // no such date
    { dateISO: 20261029, slot: 'night', occasion: 'date' },
    null,
    'formal',
    { dateISO: '2026-10-29', slot: 'night', occasion: 'date', extra: 1 },
    { dateISO: '2026-10-29', slot: 'night', occasion: 'formal' }, // the window's second: the first stays
  ]));
  assert.deepEqual(loadEvents(TODAY), [{ dateISO: '2026-10-29', slot: 'night', occasion: 'date' }]);
  store.set('scentcast.events', '{not json');
  assert.deepEqual(loadEvents(TODAY), []);
  store.set('scentcast.events', JSON.stringify({ dateISO: '2026-10-29' }));
  assert.deepEqual(loadEvents(TODAY), []);
  // Saving prunes too.
  store.set('scentcast.events', JSON.stringify([{ dateISO: '2026-10-25', slot: 'night', occasion: 'date' }]));
  assert.deepEqual(setEvent('2026-10-30', 'day', 'outdoors', TODAY), [{ dateISO: '2026-10-30', slot: 'day', occasion: 'outdoors' }]);
  assert.deepEqual(tidyEvents(undefined, TODAY), []);
});

test('stored events go on a plan\'s windows as their occasions', () => {
  const windows = [{ dateISO: '2026-10-27', slot: 'day' }, { dateISO: '2026-10-27', slot: 'night' }];
  const on = withStoredEvents(windows, [{ dateISO: '2026-10-27', slot: 'night', occasion: 'date' }]);
  assert.equal(on[0], windows[0], 'a window without one stays as it was');
  assert.equal(on[1].occasion.id, 'date');
  assert.equal(on[1].occasion.label, 'Date Night');
});
