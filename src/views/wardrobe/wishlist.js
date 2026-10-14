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
import { state, findRecord, nowSlot, poolInputs, ownedIn } from '../../app/state.js';
import { loadWants, saveWants, setWant, hasWant } from '../../wishlist.js';
import {
  libNow, loadLib, libFailed, likedFor, inputsKey, ownable, repaint, listLoading, verdictBadge, verdictOf, verdictRank, fillsHTML, OWNED_WORD,
  liveHTML, speak,
} from './parts.js';

const wish = {
  key: null, // the inputs and wants the checks answer
  checks: new Map(), // id -> a buy check ({ missing: true } when the library has no such bottle)
  busy: false,
  error: '',
  asked: new Set(), // ids whose records were asked for (asked again only by Try again)
  recordsError: '', // a sentence, when those records couldn't load
  undo: null, // { list: the wants before the last removal, id: the one removed }
};

// ---------- Templates (pure) ----------

/**
 * The wants in order: those checked by verdict (best first) and gain, then
 * the rest as added, then the ones you own already. items: [{ want, record,
 * check, owned (OWNED_WORD's words, or null), today }].
 */
export function sortWants(items) {
  const owned = items.filter(i => i.owned);
  const checked = items.filter(i => !i.owned && i.check && !i.check.missing);
  const rest = items.filter(i => !i.owned && !checked.includes(i));
  checked.sort((a, b) => verdictRank(verdictOf(a.check)) - verdictRank(verdictOf(b.check)) || b.check.gain - a.check.gain);
  return [...checked, ...rest, ...owned];
}

// A want's name while it has none: loading, or in plain words when it can't
// load (offline, or a bottle the library lacks).
const STAND_IN = 'A bottle on your wishlist';

/**
 * One want: photo, name, its verdict and reasons, what it would fill,
 * today's match, I bought it and Remove. One you own already says where,
 * and offers only Remove. `failed`: its checks or record couldn't load, so
 * nothing on it is still on its way.
 */
export function wantCardHTML({ want, record, check, today, owned = null }, { failed = false } = {}) {
  const name = record?.name ?? check?.name ?? null;
  const stand = name ? null : check?.missing ? 'A bottle the library doesn’t have' : failed ? STAND_IN : null;
  const f = record ?? { id: want.id, name: name ?? stand ?? STAND_IN };
  const verdict = owned ? `<span class="owned-tag">${icon.check}${esc(owned)}</span>`
    : check ? (check.missing ? '' : verdictBadge(verdictOf(check)))
      : failed ? '' : '<span class="sk sk-pill" aria-hidden="true"></span><span class="visually-hidden">Checking</span>';
  const meta = [record?.brand ?? check?.brand, `added ${shortDate(want.added)}`].filter(Boolean).join(' · ');
  const fills = check?.fills?.filter(x => x.matters) ?? [];
  const body = owned ? '<p class="muted small">You own it, so there’s nothing to check.</p>'
    : !check ? ''
      : check.missing ? '<p class="muted small">This bottle isn’t in the fragrance library, so there’s nothing to check it against.</p>'
        : `<ul class="wish-reasons">${check.reasons.slice(0, 2).map(r => `<li>${esc(r)}</li>`).join('')}</ul>
        ${fills.length ? `<p class="wish-label">Would fill</p>${fillsHTML(fills, 2)}` : ''}`;
  const id = esc(want.id);
  const title = name ? `<button class="pick-name-btn" data-action="open" data-ctx="" data-id="${id}">${esc(name)}</button>`
    : stand ? `<span class="wish-stand">${esc(stand)}</span>` : '<span class="sk sk-line w70"></span>';
  // Nothing to buy without its record: dimmed while it loads, gone when it can't.
  const bought = owned || (!record && failed) ? ''
    : `<button class="btn secondary compact" data-action="wish-bought" data-id="${id}"${record ? '' : ' disabled'}>${icon.plus}<span>I bought it<span class="visually-hidden">: ${esc(f.name)}</span></span></button>`;
  // The photo is a second way in for a pointer: out of the tab order, and
  // without data-ctx, so a redraw never hands it the name's focus.
  return `<li class="wish${owned ? ' owned' : ''}" data-kind="${!owned && check && !check.missing ? esc(verdictOf(check)) : ''}">
    <button class="wish-photo" data-action="open" data-id="${id}" tabindex="-1" aria-hidden="true">${img(f)}</button>
    <div class="wish-body">
      <div class="wish-head">
        <h3 class="wish-name">${title}</h3>
        ${verdict}
      </div>
      <p class="wish-meta">${esc(meta)}</p>
      ${want.note ? `<p class="wish-note">${esc(want.note)}</p>` : ''}
      ${body}
      ${today && !owned ? `<p class="wish-today">${matchBadge(today.entry)}<span>${today.slot === 'day' ? 'today' : 'tonight'}</span></p>` : ''}
      <div class="action-row">
        ${bought}
        <button class="btn tertiary compact" data-action="wish-remove" data-id="${id}">${icon.remove}<span>Remove<span class="visually-hidden"> ${esc(f.name)}</span></span></button>
      </div>
    </div>
  </li>`;
}

/** What the list adds up to, once checked: "1 strong fit, 2 good, 1 you own already". */
export function wishSummary(items) {
  const counts = new Map();
  for (const { check, owned } of items) if (!owned && check && !check.missing) counts.set(verdictOf(check), (counts.get(verdictOf(check)) ?? 0) + 1);
  const owned = items.filter(i => i.owned).length;
  return [...[...counts].sort((a, b) => verdictRank(a[0]) - verdictRank(b[0]))
    .map(([v, n]) => (v === 'Strong fit' ? plural(n, 'strong fit') : `${n} ${v.toLowerCase()}`)), owned ? `${owned} you own already` : null].filter(Boolean).join(', ');
}

/**
 * The pane: { items (sorted), busy, error (a sentence), reload (the checks
 * need modules that didn't load: only a reload helps), failed (a record
 * didn't load) }.
 */
export function wishlistHTML({ items, busy = false, error = '', reload = false, failed = false }) {
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
  const RELOAD = 'Checking needs a connection the first time. Reconnect, then reload.';
  const line = reload ? RELOAD : error || (busy ? `Checking ${plural(items.filter(i => !i.owned).length, 'bottle')} against your wardrobe…`
    : summary ? `${plural(items.length, 'bottle')}: ${summary}.` : '');
  const status = reload ? `<span class="error">${RELOAD}</span> <button class="link-btn" data-action="wish-reload">Reload</button>`
    : error ? `<span class="error">${esc(error)}</span> <button class="link-btn" data-action="wish-retry">Try again</button>`
      : esc(line);
  const down = Boolean(reload || error || failed);
  // The line redraws with the list, so screen readers hear it from a status
  // line of its own (liveHTML), once per change.
  return `<section class="card wishlist" aria-labelledby="wish-title">
    ${sectionHead('Bottles you want', '<p>Best fit for your shelf first.</p>', { id: 'wish-title' })}
    <p class="muted small wish-status">${status}</p>${liveHTML('wish-live', line)}
    <ul class="wishes${busy ? ' busy' : ''}">${items.map(i => wantCardHTML(i, { failed: down })).join('')}</ul>
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

// A want you own already (in the ranked list, switched off or not, or in Mine) isn't checked.
const ownedWord = id => OWNED_WORD[ownedIn(id)] ?? null;

function items() {
  return sortWants(loadWants().map(want => {
    const owned = ownedWord(want.id);
    const check = owned ? undefined : wish.checks.get(want.id);
    const record = want.record ?? findRecord(want.id) ?? check?.record ?? null;
    return { want, record, check, owned, today: owned ? null : todayFor(record) };
  }));
}

const wishlistPane = () => wishlistHTML({ items: items(), busy: wish.busy, error: wish.error || wish.recordsError, reload: libFailed(), failed: Boolean(wish.recordsError) });

const onPane = () => state.base?.dest === 'wardrobe' && state.base.pane === 'wishlist';
function paint(app) {
  if (onPane()) repaint(app);
}

// Names and photos first (records answer at once), then the checks. Each
// want's record is asked for once (a bottle the library lacks never turns
// up, and an offline answer would otherwise ask again on every redraw).
let asked = 0;
async function refresh(app) {
  const wants = loadWants();
  if (!wants.length) return;
  const need = wants.filter(w => !w.record && !findRecord(w.id) && !wish.asked.has(w.id)).map(w => w.id);
  if (need.length) {
    need.forEach(id => wish.asked.add(id));
    askPool('records', { ids: need }).then(() => paint(app), err => {
      wish.recordsError = err.message;
      paint(app);
    });
  }
  let lib = libNow();
  if (!lib) {
    // A failed load stays failed until a reload: say so once, and ask nothing.
    if (libFailed()) return;
    try {
      lib = await loadLib();
    } catch {
      return paint(app);
    }
  }
  // Checks judge against the ranked list, so they wait for it.
  if (listLoading()) return;
  // Styles only guessed from the bottles are ones you reach for (`stated`), as on a bottle page.
  const { ids: liked, stated } = likedFor(lib);
  const check = wants.filter(w => !ownedWord(w.id));
  const key = JSON.stringify([inputsKey(lib), check.map(w => w.id), liked, stated]);
  if (key === wish.key) return;
  const n = ++asked;
  Object.assign(wish, { key, busy: check.length > 0, error: '' });
  if (!check.length) return paint(app);
  paint(app);
  try {
    const inputs = await poolInputs();
    const r = await askPool('check', { ...inputs, records: check.map(w => w.record ?? w.id), liked, stated }, { channel: 'wish-checks' });
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
    speak(document.getElementById('main'));
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

// A want leaving the list (Remove, I bought it) hands focus to the next
// one's name, else the one before's, else the list's heading (the page's
// once the list is empty).
function nextWant(el) {
  const card = el.closest('.wish');
  return (card?.nextElementSibling ?? card?.previousElementSibling)?.querySelector('[data-action="wish-remove"]')?.dataset.id ?? null;
}
function focusWant(id) {
  const name = id && document.querySelector(`.wish .pick-name-btn[data-id="${CSS.escape(id)}"]`);
  const head = document.getElementById('wish-title');
  if (head) head.tabIndex = -1;
  (name || head || document.getElementById('page-title'))?.focus();
}

function removed(app, id, before) {
  wish.undo = { list: before, id };
  const name = findRecord(id)?.name ?? before.find(w => w.id === id)?.record?.name ?? 'Bottle';
  app.showToast(`<span class="note">${esc(name)} removed from your wishlist</span><button class="btn primary compact" data-action="wish-undo">Undo</button>`);
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
      : `<span class="note">${esc(name)} is on your wishlist</span><a class="btn secondary compact" href="#/wardrobe/wishlist">See it</a>`);
  },
  'wish-remove'(el, app) {
    const id = el.dataset.id;
    const before = loadWants();
    setWant(id, false);
    const next = nextWant(el);
    app.render();
    focusWant(next);
    removed(app, id, before);
  },
  // The Undo button goes with its toast: focus moves to the bottle that came
  // back (its name on the Wishlist, else its Want button), or the page's heading.
  'wish-undo'(el, app) {
    if (!wish.undo) return;
    const { list, id } = wish.undo;
    saveWants(list);
    wish.undo = null;
    app.render();
    app.hideToast();
    const sel = CSS.escape(id);
    const target = (onPane() && document.querySelector(`.wish .pick-name-btn[data-id="${sel}"]`))
      || document.querySelector(`[data-action="wish-toggle"][data-id="${sel}"]`) || document.getElementById('page-title');
    target?.focus();
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
    const next = nextWant(el);
    setWant(id, false);
    app.own(record);
    focusWant(next);
  },
  'wish-retry'(el, app) {
    Object.assign(wish, { key: null, error: '', recordsError: '' });
    wish.asked.clear();
    app.renderPage();
  },
  // The modules didn't load, and a failed import stays failed: only a reload asks again.
  'wish-reload'() {
    location.reload();
  },
};
