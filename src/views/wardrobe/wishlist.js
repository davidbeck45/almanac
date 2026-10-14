// Wardrobe › Wishlist: the bottles you want (src/wishlist.js), each with its
// buy check against the wardrobe (the pool client's 'check', judged like
// Insights, with the styles you like), what it would fill, and how it would
// do today; best verdicts first, then most gain. "I bought it" moves a
// bottle into Mine. Also the Want button every screen shares (wish-toggle,
// drawn by parts.js wantButton). Styles: src/css/wardrobe.css.
import { rank } from '../../engine.js';
import { esc, plural, shortDate } from '../../ui.js';
import { icon, img, messageHTML, sectionHead, matchBadge } from '../../ui/components.js';
import { askPool, warmPool } from '../../app/pool.js';
import { state, findRecord, nowSlot, poolInputs } from '../../app/state.js';
import { loadWants, saveWants, setWant, hasWant } from '../../wishlist.js';
import { libNow, loadLib, likedFor, inputsKey, ownable, repaint, listLoading, verdictBadge, verdictRank, fillsHTML } from './parts.js';

const wish = {
  key: null, // the inputs and wants the checks answer
  checks: new Map(), // id -> a buy check ({ missing: true } when the library has no such bottle)
  busy: false,
  error: '',
  loading: new Set(), // ids whose records are on their way
  undo: null, // the list before the last removal
};

// ---------- Templates (pure) ----------

/**
 * The wants in order: those checked by verdict (best first) and gain, the
 * rest as added. items: [{ want, record, check, today }].
 */
export function sortWants(items) {
  const checked = items.filter(i => i.check && !i.check.missing);
  const rest = items.filter(i => !checked.includes(i));
  checked.sort((a, b) => verdictRank(a.check.verdict) - verdictRank(b.check.verdict) || b.check.gain - a.check.gain);
  return [...checked, ...rest];
}

/** One want: photo, name, its verdict and reasons, what it would fill, today's match, I bought it and Remove. */
export function wantCardHTML({ want, record, check, today }) {
  const f = record ?? { id: want.id, name: check?.name ?? 'Loading…' };
  const named = Boolean(record || check?.name);
  const verdict = !check ? '<span class="sk sk-pill" aria-hidden="true"></span><span class="visually-hidden">Checking</span>'
    : check.missing ? '' : verdictBadge(check.verdict);
  const meta = [record?.brand ?? check?.brand, `added ${shortDate(want.added)}`].filter(Boolean).join(' · ');
  const fills = check?.fills?.filter(x => x.matters) ?? [];
  const body = !check ? ''
    : check.missing ? '<p class="muted small">This bottle isn’t in the fragrance library, so there’s nothing to check it against.</p>'
      : `<ul class="wish-reasons">${check.reasons.slice(0, 2).map(r => `<li>${esc(r)}</li>`).join('')}</ul>
        ${fills.length ? `<p class="wish-label">Would fill</p>${fillsHTML(fills, 2)}` : ''}`;
  const id = esc(want.id);
  // The photo is a second way in for a pointer: out of the tab order, and
  // without data-ctx, so a redraw never hands it the name's focus.
  return `<li class="wish" data-kind="${check && !check.missing ? esc(check.verdict) : ''}">
    <button class="wish-photo" data-action="open" data-id="${id}" tabindex="-1" aria-hidden="true">${img(f)}</button>
    <div class="wish-body">
      <div class="wish-head">
        <h3 class="wish-name">${named ? `<button class="pick-name-btn" data-action="open" data-ctx="" data-id="${id}">${esc(f.name)}</button>` : '<span class="sk sk-line w70"></span>'}</h3>
        ${verdict}
      </div>
      <p class="wish-meta">${esc(meta)}</p>
      ${want.note ? `<p class="wish-note">${esc(want.note)}</p>` : ''}
      ${body}
      ${today ? `<p class="wish-today">${matchBadge(today.entry)}<span>${today.slot === 'day' ? 'today' : 'tonight'}</span></p>` : ''}
      <div class="action-row">
        <button class="btn secondary compact" data-action="wish-bought" data-id="${id}"${named ? '' : ' disabled'}>${icon.check}<span>I bought it<span class="visually-hidden">: ${esc(f.name)}</span></span></button>
        <button class="btn tertiary compact" data-action="wish-remove" data-id="${id}">${icon.remove}<span>Remove<span class="visually-hidden"> ${esc(f.name)}</span></span></button>
      </div>
    </div>
  </li>`;
}

/** What the list adds up to, once checked: "1 strong fit, 2 good". */
export function wishSummary(items) {
  const counts = new Map();
  for (const { check } of items) if (check && !check.missing) counts.set(check.verdict, (counts.get(check.verdict) ?? 0) + 1);
  return [...counts].sort((a, b) => verdictRank(a[0]) - verdictRank(b[0]))
    .map(([v, n]) => (v === 'Strong fit' ? plural(n, 'strong fit') : `${n} ${v.toLowerCase()}`)).join(', ');
}

/** The pane: { items (sorted), busy, error }. */
export function wishlistHTML({ items, busy = false, error = '' }) {
  if (!items.length) {
    return messageHTML({
      glyph: icon.heart,
      title: 'Nothing on your wishlist yet',
      body: 'Tap Want on a suggestion, and it lands here with a verdict on how it would fit your shelf.',
      action: `<div class="message-actions">
        <a class="btn primary" href="#/wardrobe/insights">${icon.chart}<span>See what would fill your gaps</span></a>
        <a class="btn secondary" href="#/discover">${icon.discover}<span>Discover bottles</span></a>
      </div>`,
    });
  }
  const summary = wishSummary(items);
  const status = error ? `<span class="error">${esc(error)}</span> <button class="link-btn" data-action="wish-retry">Try again</button>`
    : busy ? `Checking ${plural(items.length, 'bottle')} against your wardrobe…`
      : summary ? `${plural(items.length, 'bottle')}: ${summary}.` : '';
  return `<section class="card wishlist" aria-labelledby="wish-title">
    ${sectionHead('Bottles you want', '<p>Best fit for your shelf first.</p>', { id: 'wish-title' })}
    <p class="muted small wish-status" role="status">${status}</p>
    <ul class="wishes${busy ? ' busy' : ''}">${items.map(wantCardHTML).join('')}</ul>
  </section>`;
}

// ---------- From state ----------

// How a bottle would do in Now's window, ranked on its own (the bottle page's "How it would do").
function todayFor(record) {
  const p = nowSlot();
  if (!record || !p) return null;
  const [entry] = rank([record], p.win, p.win.slot, { history: state.history, todayISO: p.win.dateISO });
  return entry ? { entry, slot: p.win.slot } : null;
}

function items() {
  return sortWants(loadWants().map(want => {
    const check = wish.checks.get(want.id);
    const record = want.record ?? findRecord(want.id) ?? check?.record ?? null;
    return { want, record, check, today: todayFor(record) };
  }));
}

const wishlistPane = () => wishlistHTML({ items: items(), busy: wish.busy, error: wish.error });

const onPane = () => state.base?.dest === 'wardrobe' && state.base.pane === 'wishlist';
function paint(app) {
  if (onPane()) repaint(app);
}

// Names and photos first (records answer at once), then the checks.
let asked = 0;
async function refresh(app) {
  const wants = loadWants();
  if (!wants.length) return;
  const need = wants.filter(w => !w.record && !findRecord(w.id) && !wish.loading.has(w.id)).map(w => w.id);
  if (need.length) {
    need.forEach(id => wish.loading.add(id));
    askPool('records', { ids: need }).then(() => paint(app), () => {}).finally(() => need.forEach(id => wish.loading.delete(id)));
  }
  let lib = libNow();
  if (!lib) {
    try {
      lib = await loadLib();
    } catch (err) {
      wish.error = 'Checking needs a connection the first time.';
      return paint(app);
    }
  }
  // Checks judge against the ranked list, so they wait for it.
  if (listLoading()) return;
  const liked = likedFor(lib).ids;
  const key = JSON.stringify([inputsKey(lib), wants.map(w => w.id), liked]);
  if (key === wish.key) return;
  const n = ++asked;
  Object.assign(wish, { key, busy: true, error: '' });
  paint(app);
  try {
    const inputs = await poolInputs();
    const r = await askPool('check', { ...inputs, records: wants.map(w => w.record ?? w.id), liked }, { channel: 'wish-checks' });
    if (r.stale || n !== asked) return;
    wish.checks = new Map(r.checks.map(c => [String(c.id), c]));
  } catch (err) {
    if (n !== asked) return;
    wish.error = err.message;
  }
  wish.busy = false;
  paint(app);
}

export const wishlistPaneDef = {
  id: 'wishlist',
  label: 'Wishlist',
  title: () => 'Wishlist',
  heading: () => 'Wishlist',
  render: wishlistPane,
  after(app) {
    warmPool();
    refresh(app);
  },
};

// ---------- Actions ----------

// After a change from anywhere, what's on screen redraws: the page, and the
// bottle page when the button was on it.
function redraw(el, app) {
  const scope = el.closest('#bottle') ? '#bottle' : el.closest('#sheet') ? '#sheet' : '#app';
  app.keepingFocus(el, scope, app.render);
}

function removed(app, id, before) {
  wish.undo = before;
  const name = findRecord(id)?.name ?? before.find(w => w.id === id)?.record?.name ?? 'Bottle';
  app.showToast(`<span class="note">${esc(name)} removed from your wishlist.</span><button class="btn primary compact" data-action="wish-undo">Undo</button>`);
}

export const actions = {
  // Want / Wanted, on any screen (parts.js wantButton).
  'wish-toggle'(el, app) {
    const id = el.dataset.id;
    const before = loadWants();
    const next = setWant(findRecord(id) ?? id);
    redraw(el, app);
    if (!hasWant(next, id)) return removed(app, id, before);
    const name = findRecord(id)?.name ?? 'Bottle';
    app.showToast(onPane() ? `<span>${esc(name)} is on your wishlist</span>`
      : `<span class="note">${esc(name)} is on your wishlist.</span><a class="btn secondary compact" href="#/wardrobe/wishlist">See it</a>`);
  },
  'wish-remove'(el, app) {
    const id = el.dataset.id;
    const before = loadWants();
    setWant(id, false);
    // Focus moves on to the next bottle's name, or the page's heading.
    const card = el.closest('.wish');
    const next = (card?.nextElementSibling ?? card?.previousElementSibling)?.querySelector('[data-action="wish-remove"]')?.dataset.id;
    app.render();
    const target = next && document.querySelector(`.wish .pick-name-btn[data-id="${CSS.escape(next)}"]`);
    (target ?? document.getElementById('page-title'))?.focus();
    removed(app, id, before);
  },
  'wish-undo'(el, app) {
    if (!wish.undo) return;
    saveWants(wish.undo);
    wish.undo = null;
    app.render();
    app.hideToast();
  },
  async 'wish-bought'(el, app) {
    const id = el.dataset.id;
    const want = loadWants().find(w => w.id === id);
    let record;
    try {
      record = await ownable(id, want?.record ?? findRecord(id));
    } catch (err) {
      return app.showToast(`<span>${esc(err.message)}</span>`);
    }
    if (!record) return app.showToast('<span>That bottle didn’t load. Try again.</span>');
    setWant(id, false);
    app.own(record);
    document.getElementById('page-title')?.focus();
  },
  'wish-retry'(el, app) {
    Object.assign(wish, { key: null, error: '' });
    app.renderPage();
  },
};
