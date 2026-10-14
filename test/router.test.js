import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parseRoute, routeHash, sameRoute, legacyHash, HOME } from '../src/app/router.js';
import * as wear from '../src/views/wear.js';
import * as wardrobe from '../src/views/wardrobe.js';
import * as discover from '../src/views/discover.js';
import * as bottle from '../src/views/bottle.js';
import * as settings from '../src/views/settings.js';
import '../src/views/sections.js';

// As src/app/shell.js merges them: the views' handlers and the bottle-page
// sections' own.
const VIEWS = [wear, wardrobe, discover, bottle, settings, ...bottle.SECTIONS];
// As src/app/shell.js builds it from the destinations.
const PANES = Object.fromEntries([wear.wear, wardrobe.wardrobe, discover.discover].map(d => [d.id, (d.panes ?? []).map(p => p.id)]));
const parse = hash => parseRoute(hash, PANES);

// Every .js file under a folder, subfolders included (a view may split its
// panes into src/views/<view>/).
const jsFiles = dir => readdirSync(new URL(`../${dir}/`, import.meta.url), { withFileTypes: true })
  .flatMap(e => (e.isDirectory() ? jsFiles(`${dir}/${e.name}`) : e.name.endsWith('.js') ? [`${dir}/${e.name}`] : []));

test('routes parse into a destination, a pane and an argument', () => {
  assert.deepEqual(parse('#/wear/now'), { dest: 'wear', pane: 'now', arg: null, query: {} });
  assert.deepEqual(parse('#/wear/occasion/office'), { dest: 'wear', pane: 'occasion', arg: 'office', query: {} });
  assert.deepEqual(parse('#/wardrobe/worn'), { dest: 'wardrobe', pane: 'worn', arg: null, query: {} });
  assert.deepEqual(parse('#/discover?q=iris%20leather'), { dest: 'discover', pane: null, arg: null, query: { q: 'iris leather' } });
  assert.deepEqual(parse('#/bottle/98689?ctx=w:2026-10-14:night'), { dest: 'bottle', pane: null, arg: '98689', query: { ctx: 'w:2026-10-14:night' } });
  assert.deepEqual(parse('#/settings'), { dest: 'settings', pane: null, arg: null, query: {} });
});

test('anything else lands somewhere sensible', () => {
  assert.equal(routeHash(parse('')), HOME);
  assert.equal(routeHash(parse('#')), HOME);
  assert.equal(routeHash(parse('#/nowhere/at/all')), HOME);
  assert.equal(routeHash(parse('#/wear')), '#/wear/now', 'a destination opens on its first pane');
  assert.equal(routeHash(parse('#/wardrobe/attic')), '#/wardrobe/owned', 'an unknown pane too');
  assert.equal(routeHash(parse('#/bottle')), HOME, 'a bottle page needs an id');
  assert.equal(routeHash(parse('#/wear/now?q=x&ctx=y')), '#/wear/now', 'query keys only where they mean something');
  assert.equal(routeHash(parse('#/discover/%E0%A4%A')), '#/discover', 'a malformed escape doesn’t throw');
});

test('routes round-trip, ids and queries escaped', () => {
  for (const hash of ['#/wear/now', '#/wear/week', '#/wear/occasion/date', '#/wear/trip', '#/wardrobe/owned', '#/wardrobe/wishlist',
    '#/wardrobe/worn', '#/wardrobe/insights', '#/discover', '#/discover?q=dior+sauvage', '#/bottle/123?ctx=day', '#/settings']) {
    assert.equal(routeHash(parse(hash)), hash);
  }
  // A hand-entered bottle's id carries its whole record (src/custom.js).
  const id = 'my:k3j~eyJuIjoiUm9zZSAmIE91ZCJ9';
  const r = parse(routeHash({ dest: 'bottle', arg: id }));
  assert.equal(r.arg, id);
  assert.ok(sameRoute(r, { dest: 'bottle', pane: null, arg: id, query: {} }));
  assert.ok(!routeHash({ dest: 'bottle', arg: 'a/b?c' }).includes('?c'), 'an id can’t break out into the query');
});

test('the old ?view= shortcuts open the same panes', () => {
  const at = q => legacyHash(new URLSearchParams(q));
  assert.equal(at('view=today'), '#/wear/now');
  assert.equal(at('view=week'), '#/wear/week');
  assert.equal(at('view=occasion'), '#/wear/occasion');
  assert.equal(at('view=nope'), null);
  assert.equal(at('loc=1,2'), null);
});

test('every action a template names has one handler', () => {
  // Handled by the shell itself (src/app/shell.js).
  const handled = new Set(['close-sheet', 'skip', 'list-back']);
  for (const view of VIEWS) {
    for (const name of Object.keys(view.actions ?? {})) {
      assert.ok(!handled.has(name), `two handlers for "${name}"`);
      handled.add(name);
    }
  }
  const files = ['src/ui/components.js', ...jsFiles('src/views'), 'src/app/shell.js', 'index.html'];
  for (const file of files) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const [, name] of text.matchAll(/data-action="([\w-]+)"/g)) assert.ok(handled.has(name), `${file} names data-action="${name}", which nothing handles`);
  }
});

test('forms, fields and sheets have one handler each', () => {
  for (const kind of ['forms', 'fields', 'changes', 'sheets']) {
    const seen = new Set();
    for (const view of VIEWS) {
      for (const name of Object.keys(view[kind] ?? {})) {
        assert.ok(!seen.has(name), `two ${kind} called "${name}"`);
        seen.add(name);
      }
    }
  }
});
