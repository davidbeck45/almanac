// The phone and tablet tab bar tucks away while the reader scrolls down and
// comes back on a scroll up (tabBarAfter in src/app/sheets.js; the shell
// feeds it scrollY a frame at a time).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tabBarAfter, TUCK_AFTER, SHOW_AFTER, TUCK_BELOW } from '../src/app/sheets.js';

const MAX = 3000;
// Scrolls through `ys` from `start`, a frame per position, and returns the
// bar's state after each.
function scroll(ys, start = { y: 0, travel: 0, tucked: false }, max = MAX) {
  const states = [];
  let bar = start;
  for (const y of ys) states.push(bar = tabBarAfter(bar, y, max));
  return states;
}
const tucked = states => states.map(s => s.tucked);
const steps = (from, by, n) => Array.from({ length: n }, (_, i) => from + by * (i + 1));
const shown = { y: 1000, travel: 0, tucked: false };
const away = { y: 1000, travel: 0, tucked: true };

test('a deliberate scroll down tucks the bar away, past the top', () => {
  assert.ok(scroll([400]).at(-1).tucked, 'one long swipe from the top');
  const slow = tucked(scroll(steps(1000, 3, 6), shown));
  assert.deepEqual(slow, [false, false, false, true, true, true], `it goes once ${TUCK_AFTER}px have added up`);
  assert.ok(!scroll(steps(1000, 1, TUCK_AFTER - 1), shown).at(-1).tucked, 'a nudge less than that leaves it');
});

test('near the top it stays, however the reader scrolls there', () => {
  assert.ok(scroll(steps(0, 4, TUCK_BELOW / 4)).every(s => !s.tucked), 'the first bar height down');
  assert.ok(!scroll([TUCK_BELOW - 1], away).at(-1).tucked, 'scrolled back up to the top, it shows');
});

test('a small scroll up brings it back', () => {
  assert.deepEqual(tucked(scroll(steps(1000, -3, 3), away)), [true, true, false], `once ${SHOW_AFTER}px up have added up`);
  assert.ok(!scroll([1000 - SHOW_AFTER], away).at(-1).tucked, 'or in one go');
  assert.ok(scroll([1000 - SHOW_AFTER + 1], away).at(-1).tucked, 'less stays tucked');
});

test('jitter never adds up, so it never flickers', () => {
  // Back and forth by a few px for a while: every turn starts the count over.
  const jitter = Array.from({ length: 200 }, (_, i) => 1000 + (i % 2 ? 5 : 0));
  assert.ok(scroll(jitter, shown).every(s => !s.tucked), 'shown stays shown');
  const wobble = Array.from({ length: 200 }, (_, i) => 1000 - (i % 2 ? 6 : 0));
  assert.ok(scroll(wobble, away).every(s => s.tucked), 'tucked stays tucked');
  // Down most of the way, a pixel back, down most of the way again.
  const turns = [1000 + TUCK_AFTER - 2, 1000 + TUCK_AFTER - 3, 1000 + 2 * TUCK_AFTER - 5];
  assert.ok(!scroll(turns, shown).at(-1).tucked);
  assert.ok(scroll([1000, 1000, 1000], away).every(s => s.tucked), 'no movement changes nothing');
});

test('at the end of the page it comes back, as Safari’s toolbar does', () => {
  assert.ok(!scroll([MAX], away).at(-1).tucked, 'the end');
  assert.ok(!scroll([MAX - 1], away).at(-1).tucked, 'a fractional pixel short of it');
  assert.ok(scroll(steps(MAX - 400, 20, 15), shown).at(-1).tucked, 'still tucked just before it');
  assert.ok(!scroll([...steps(MAX - 400, 20, 20)], { y: MAX - 400, travel: 0, tucked: false }).at(-1).tucked, 'scrolling down into the end');
});

test('iOS’s rubber band at either end reads as no scroll at all', () => {
  // Pulled past the top and let go: y goes negative and springs back.
  assert.ok(scroll([-60, -30, -5, 0, 0]).every(s => !s.tucked && s.y === 0));
  // Past the end and back: the bounce up to the end isn't a scroll down later.
  const bounce = scroll([MAX + 50, MAX + 20, MAX], away);
  assert.ok(bounce.every(s => !s.tucked && s.y === MAX));
  // Then up a little from the end and down again: shown, as ever, then tucked.
  const after = scroll([MAX - 30, MAX - 50, MAX - 30], bounce.at(-1));
  assert.deepEqual(tucked(after), [false, false, true]);
});

test('a page shorter than the window, or barely longer, never tucks it', () => {
  assert.ok(scroll(steps(0, 10, 10), undefined, 0).every(s => !s.tucked), 'no scroll at all (max 0, or less)');
  assert.ok(scroll(steps(0, 10, 10), undefined, -20).every(s => !s.tucked));
  assert.ok(scroll(steps(0, 5, 14), undefined, 70).every(s => !s.tucked), 'all of it within the top');
});

test('the tucked bar is only out of sight: in the tab order, and back with focus', () => {
  const css = readFileSync(new URL('../src/css/shell.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]*\.tucked[^{}]*)\{([^}]*)\}/g)];
  assert.ok(rules.length, 'shell.css styles .nav.tucked');
  for (const [, selector, body] of rules) {
    assert.match(selector, /:not\(:focus-within\)/, `${selector.trim()}: focus in the bar shows it`);
    assert.doesNotMatch(body, /display|visibility|pointer-events|content-visibility/, `${selector.trim()}: moves it, never takes it out of the page`);
  }
  assert.doesNotMatch(css, /@media \(min-width: 1100px\)[^@]*\.tucked/, 'the rail never tucks');
  const sheets = readFileSync(new URL('../src/app/sheets.js', import.meta.url), 'utf8');
  const tab = sheets.slice(sheets.indexOf('// ---------- The tab bar'));
  assert.doesNotMatch(tab, /\binert\b\s*=|aria-hidden|\.hidden\s*=/, 'the script never hides it from assistive tech');
  assert.match(tab, /addEventListener\('scroll', [\s\S]*?\{ passive: true \}\)/, 'one passive scroll listener');
});
