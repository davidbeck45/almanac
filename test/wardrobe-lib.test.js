// Insights and the Wishlist when the modules they load on demand don't
// (offline before the service worker has them): the browser keeps a failed
// module import failed for the page's life, so each pane says so once, with
// Reload, and imports nothing more, instead of re-rendering itself for ever.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// A device's storage with one want on it, and just enough of a page.
const store = new Map([['scentcast.want', JSON.stringify([{ id: '1', added: '2026-10-01', record: { id: '1', name: 'Test Bottle', brand: 'Test', accords: { woody: 80 } } }])]]);
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
});

const { state } = await import('../src/app/state.js');
const { useLibLoader, libFailed, libNow, loadLib } = await import('../src/views/wardrobe/parts.js');
const { insightsPaneDef } = await import('../src/views/wardrobe/insights.js');
const { wishlistPaneDef } = await import('../src/views/wardrobe/wishlist.js');
globalThis.document = { activeElement: null, querySelector: () => null, getElementById: () => null };

// The shell's render cycle, cut down: renderPage draws the pane, then runs its after().
function fakeApp(pane) {
  const app = { paints: 0, html: '' };
  app.renderPage = () => {
    app.paints++;
    app.html = pane.render(app, state.route);
    pane.after(app, state.route);
  };
  app.keepingFocus = (el, scope, fn) => fn();
  return app;
}
const settle = () => new Promise(resolve => setTimeout(resolve, 30));

let imports = 0;
const failing = () => {
  imports++;
  return Promise.reject(new TypeError('Failed to fetch dynamically imported module'));
};

for (const [pane, says] of [[insightsPaneDef, /Insights didn’t load[^]*data-action="ins-reload">Reload/], [wishlistPaneDef, /data-action="wish-reload">Reload/]]) {
  test(`${pane.label}: modules that fail to load repaint it once, and nothing imports them again`, async () => {
    imports = 0;
    useLibLoader(failing);
    state.base = { dest: 'wardrobe', pane: pane.id };
    const app = fakeApp(pane);
    pane.after(app, state.route);
    await settle();
    assert.equal(app.paints, 1, 'one repaint, not a loop');
    assert.equal(imports, 1);
    assert.ok(libFailed());
    assert.match(app.html, says);
    // Later renders (an answer landing, the forecast) ask nothing more.
    app.renderPage();
    await settle();
    assert.equal(app.paints, 2);
    assert.equal(imports, 1);
    await assert.rejects(loadLib(), /Failed to fetch/, 'a failed load rejects at once');
    assert.equal(imports, 1);
  });
}

test('a load that works clears the failure', async () => {
  useLibLoader(failing);
  await assert.rejects(loadLib());
  useLibLoader(async () => ({ ok: true }));
  assert.equal(libFailed(), false);
  assert.deepEqual(await loadLib(), { ok: true });
  assert.deepEqual(libNow(), { ok: true });
});
