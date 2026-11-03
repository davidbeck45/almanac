// The toast is a live region (role=status): it stays on the page and only
// empties, so a screen reader hears each message as it goes in. Hidden until
// it held its text, as it was, the first toast after a pause often went
// unread; for a planned event it's the only place that names the bottle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { showToast, hideToast } from '../src/app/sheets.js';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// Just enough of #toast for showToast and hideToast: what it held, and
// whether it was hidden each time it was filled.
function toastStub() {
  const classes = new Set();
  const el = {
    hidden: false, dataset: {}, html: '', filledWhileHidden: [],
    classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c), toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) },
    set innerHTML(v) { this.html = v; this.filledWhileHidden.push(this.hidden); },
    get innerHTML() { return this.html; },
    replaceChildren() { this.html = ''; },
    querySelector: () => null,
    querySelectorAll: () => [],
    contains: () => false,
  };
  return el;
}

test('the toast’s live region stays on the page: filled where it stands, emptied as it goes', async () => {
  assert.match(read('index.html'), /<div id="toast" class="toast" role="status" aria-live="polite"><\/div>/, 'never hidden, so it is in the accessibility tree before its first message');
  const el = toastStub();
  const frames = [];
  globalThis.document = { querySelector: sel => (sel === '#toast' ? el : null), activeElement: null };
  globalThis.requestAnimationFrame = fn => frames.push(fn);
  try {
    showToast('<span>Planned: formal wear tonight, with Meant To Be Seen.</span>');
    assert.match(el.html, /Planned: formal wear tonight, with Meant To Be Seen\./);
    frames.splice(0).forEach(fn => fn());
    assert.ok(el.classList.contains('show'));
    hideToast();
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(el.html, '', 'emptied once it has faded, so nothing stale is read again');
    showToast('<span>Sauvage hidden from picks</span><button class="btn primary compact">Undo</button>');
    assert.match(el.html, /hidden from picks/);
    assert.deepEqual(el.filledWhileHidden, [false, false], 'never filled while hidden');
    assert.equal(el.hidden, false);
    // One that comes while the last fades keeps its words, though its frame
    // (and with it `show`) hasn't come yet, as in a background tab.
    hideToast();
    showToast('<span>Copied for Claude</span>');
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.match(el.html, /Copied for Claude/);
    frames.splice(0).forEach(fn => fn());
    hideToast();
  } finally {
    await new Promise(resolve => setTimeout(resolve, 250));
    delete globalThis.document;
    delete globalThis.requestAnimationFrame;
  }
  // Away it's see-through, and must not catch the taps meant for what's under it.
  assert.match(read('src/css/components.css'), /\.toast:not\(\.show\) \{ pointer-events: none; \}/);
});
