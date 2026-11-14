// The guide (#/guide): every screen it links to is a route the app opens,
// and the footer's way in leads there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GUIDE, guideHTML, guideLinkHTML } from '../src/views/guide.js';
import { parseRoute, routeHash } from '../src/app/router.js';

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
