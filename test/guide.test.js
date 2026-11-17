// The guide (#/guide): every screen it links to is a route the app opens,
// its contents row reaches every section, and the ways in lead there: the
// footer's button, and Now's welcome to a first visit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GUIDE, guideHTML, guideLinkHTML, actions } from '../src/views/guide.js';
import { parseRoute, routeHash } from '../src/app/router.js';
import { firstVisit, setWelcomed } from '../src/app/state.js';
import * as wear from '../src/views/wear.js';

const PANES = { wear: ['now', 'week', 'occasion', 'trip'], wardrobe: ['owned', 'wishlist', 'worn', 'insights'], discover: [] };

test('the guide opens at #/guide, and the footer links there', () => {
  assert.deepEqual(parseRoute('#/guide', PANES), { dest: 'guide', pane: null, arg: null, query: {} });
  assert.match(guideLinkHTML(), /href="#\/guide"/);
});

test('every link in the guide opens the screen it names', () => {
  for (const { items } of GUIDE) for (const { href } of items.filter(i => i.href)) {
    assert.equal(routeHash(parseRoute(href, PANES)), href, `${href} isn't a route`);
  }
  const html = guideHTML();
  assert.equal(html.match(/<h2 /g).length, GUIDE.length);
});

test('the contents row jumps to every section, whose heading can take focus', () => {
  const html = guideHTML();
  assert.equal(new Set(GUIDE.map(s => s.id)).size, GUIDE.length, 'ids are the headings’ anchors');
  for (const s of GUIDE) {
    assert.match(html, new RegExp(`data-action="guide-jump" data-value="${s.id}">${s.short ?? s.title}</button>`), s.id);
    assert.match(html, new RegExp(`<h2 id="guide-${s.id}" tabindex="-1">`), s.id);
    assert.ok(s.items.length && s.items.every(i => i.name && i.text), s.id);
  }
  assert.equal(typeof actions['guide-jump'], 'function');
  // The questions close the guide: each is a question, answered in a sentence or more, with no temperature.
  const faq = GUIDE.at(-1);
  assert.equal(faq.id, 'faq');
  for (const q of faq.items) {
    assert.match(q.name, /\?$/, q.name);
    assert.doesNotMatch(q.text, /°|\d ?F\b/, q.name);
  }
});

test('Now welcomes a first visit, and never someone with a wear, a list of their own or an answer', () => {
  const fresh = { welcomed: false, shared: null, active: 'demo', history: [], mine: { records: [] } };
  assert.ok(firstVisit(fresh));
  assert.ok(!firstVisit({ ...fresh, welcomed: true }), 'answered or waved off');
  assert.ok(!firstVisit({ ...fresh, history: [{ id: '1', date: '2026-11-16', slot: 'day' }] }), 'a wear logged');
  assert.ok(!firstVisit({ ...fresh, mine: { records: [{ id: '1' }] } }), 'a bottle in Mine');
  assert.ok(!firstVisit({ ...fresh, active: 'mine' }), 'ranking from Mine');
  assert.ok(!firstVisit({ ...fresh, shared: { records: [] } }), 'a shared link has its own banner');
  const html = wear.welcomeHTML();
  assert.match(html, /<b id="welcome-title">These picks are from David’s wardrobe<\/b>/);
  assert.match(html, /data-action="welcome-add">.*Add yours<\/button>/);
  assert.match(html, /<a class="btn tertiary compact" href="#\/guide">How Almanac works<\/a>/);
  assert.match(html, /data-action="welcome-close" aria-label="Dismiss the welcome">/);
  for (const name of ['welcome-add', 'welcome-close']) assert.equal(typeof wear.actions[name], 'function', name);
});

test('an answer to the welcome is kept with the device’s prefs', () => {
  const store = new Map();
  const before = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) } });
  try {
    setWelcomed();
    assert.equal(JSON.parse(store.get('scentcast.prefs')).welcomed, true);
    assert.ok(!firstVisit(), 'this device’s state too');
  } finally {
    if (before) Object.defineProperty(globalThis, 'localStorage', before);
    else delete globalThis.localStorage;
  }
});
