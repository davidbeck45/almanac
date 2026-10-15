// Overlay sheets (location, add bottles, paste a list, add it yourself), the
// toast, focus repair after re-renders, and the bottle's flight between a list
// and its page. Browser-only: the shell imports it; views reach it through
// the `app` object their actions get.
import { state } from './state.js';
import { icon } from '../ui/components.js';

const $ = sel => document.querySelector(sel);
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// One renderer per sheet kind, registered by the views (their `sheets`
// export). A renderer returns the sheet's HTML, or null when there's nothing
// to show any more (the sheet then closes).
const SHEETS = {};
export function registerSheets(map) {
  for (const kind of Object.keys(map)) if (SHEETS[kind]) throw new Error(`Two sheets called "${kind}"`);
  Object.assign(SHEETS, map);
}

// `fresh` marks a sheet's first render, the one that animates its bars.
// Focus inside the sheet stays on the replaced control's successor, else on
// its form's first field (a Search button that went busy), else on Close:
// never on the body, where the next Tab would start the sheet over.
export function renderSheet({ keepScroll = false, fresh = false } = {}) {
  const el = $('#sheet');
  const s = state.sheet;
  const render = SHEETS[s.kind];
  if (!render) throw new Error(`No sheet called "${s.kind}"`);
  const scroll = keepScroll ? el.querySelector('.sheet-panel')?.scrollTop : 0;
  const html = render(s);
  if (html === null) return closeSheet();
  const focused = el.contains(document.activeElement) ? document.activeElement : null;
  const seen = inSight(focused);
  const form = focused?.closest('form[data-form]')?.dataset.form;
  el.innerHTML = html;
  const panel = el.querySelector('.sheet-panel');
  if (fresh) panel.classList.add('fresh');
  if (keepScroll) panel.scrollTop = scroll;
  if (focused && !refocus(focused, '#sheet', { reveal: seen })) {
    const field = form && el.querySelector(`form[data-form="${CSS.escape(form)}"] :is(input:not([type="hidden"]), textarea)`);
    (field || el.querySelector('.sheet-close'))?.focus({ preventScroll: true });
  }
}

// Whether an element is on screen to take focus: rendered, and not behind a
// dialog (inert).
const focusable = e => !e.closest('[inert]') && (e.checkVisibility?.() ?? e.getClientRects().length > 0);

// The element in `scope` that took over from `el` after a re-render: the
// same tag with the same data attributes, else the same id, else (a form
// field) the same name, else (a submit button) its form's. Of several, one
// on screen with the same classes first: the rail's location button comes
// before the page's own and is hidden on phones.
function successor(el, scope) {
  const tag = el.tagName.toLowerCase();
  const data = Object.entries(el.dataset ?? {})
    .map(([k, v]) => `[data-${k.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}="${CSS.escape(v)}"]`).join('');
  const form = el.closest('form[data-form]')?.dataset.form;
  const sel = data ? `${tag}${data}`
    : el.id ? `#${CSS.escape(el.id)}`
    : el.name ? `${tag}[name="${CSS.escape(el.name)}"]`
    : el.type === 'submit' && form ? `form[data-form="${CSS.escape(form)}"] [type="submit"]`
    : null;
  if (!sel) return null;
  const shown = [...document.querySelectorAll(`${scope} ${sel}`)].filter(focusable);
  return shown.find(e => e.className === el.className) ?? shown[0] ?? null;
}

// Put focus back on an element a re-render replaced: itself if it survived,
// else its successor (above). A text field's successor gets the caret where
// it was. True only when focus landed: false when there's no successor (a
// hidden bottle's card, say) or it can't take focus (hidden, disabled), so
// callers fall back to the top of the region. `reveal` scrolls it back into
// view if the redraw left it out of sight: a redraw nobody asked for (data
// landing, coming back to the tab) passes whether the control was in sight
// before it (`inSight`), so a control the reader scrolled away from stays
// where they left it.
export function refocus(el, scope = '#app', { reveal: show = true } = {}) {
  if (!el || el === document.body) return false;
  const target = el.isConnected ? el : successor(el, scope);
  if (!target) return false;
  target.focus({ preventScroll: true });
  if (document.activeElement !== target) return false;
  if (target !== el && 'selectionStart' in el) {
    try { target.setSelectionRange(el.selectionStart, el.selectionEnd); } catch {} // not every input type has a caret
  }
  if (show) reveal(target);
  return true;
}

// refocus(), else, when it went with no successor (a bottle hidden from the
// shelf it was opened from), its nearest old neighbour still there: the next
// control like it in its list, else the one before. A replaced element keeps
// its old subtree, so its list is still there to read.
export function refocusNear(el, scope = '#app', options) {
  if (refocus(el, scope, options)) return true;
  const action = el?.dataset?.action;
  if (!action || el.isConnected) return false;
  const like = `[data-action="${CSS.escape(action)}"]`;
  let list = el.parentElement;
  while (list && list.querySelectorAll(like).length < 2) list = list.parentElement;
  if (!list) return false;
  const peers = [...list.querySelectorAll(like)];
  const at = peers.indexOf(el);
  return [...peers.slice(at + 1), ...peers.slice(0, at).reverse()].some(p => refocus(p, scope, options));
}

// Focus moves without scrolling, so a redraw doesn't jump the page; but it
// mustn't leave focus out of sight (WCAG 2.4.11). Once the redraw has
// settled (the shelves' and the bottle page's scroll put back), an element
// that a sideways strip, a scrolling panel or the window cuts off scrolls
// just into view.
function reveal(el) {
  requestAnimationFrame(() => {
    if (document.activeElement === el && outOfSight(el)) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
}

// Whether a focused element shows whole now: measured before a redraw, it
// says whether refocus may scroll back to its successor.
export const inSight = el => Boolean(el) && el !== document.body && el.isConnected && !outOfSight(el);

function outOfSight(el) {
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return false;
  let top = -Infinity, bottom = Infinity, left = -Infinity, right = Infinity;
  const clip = b => { top = Math.max(top, b.top); bottom = Math.min(bottom, b.bottom); left = Math.max(left, b.left); right = Math.min(right, b.right); };
  let page = true; // whether it scrolls with the window
  for (let p = el; p && p !== document.body; p = p.parentElement) {
    const { overflowX, overflowY, position } = getComputedStyle(p);
    if (p !== el && /auto|scroll/.test(overflowX + overflowY)) clip(p.getBoundingClientRect());
    // A sheet, the bottle page, the head bar, the tab bar: they don't move
    // with the window, so only their own scrolling counts.
    if (position === 'fixed' || position === 'sticky' || p.matches('.bp-panel, .sheet-panel')) {
      page = false;
      break;
    }
  }
  // The window, less what sticks over its edges (the head bar, the tab bar:
  // the page's scroll padding).
  if (page) {
    const pad = getComputedStyle(document.documentElement);
    clip({ top: parseFloat(pad.scrollPaddingTop) || 0, bottom: innerHeight - (parseFloat(pad.scrollPaddingBottom) || 0), left: 0, right: innerWidth });
  }
  return r.left < left - 1 || r.right > right + 1 || r.top < top - 1 || r.bottom > bottom + 1;
}

// Views and sheets re-render whole, which replaces the control that asked for
// it; focus its successor in `scope` so keyboard and screen reader users keep
// their place (scrolled back into view only if it was in sight before).
export function keepingFocus(trigger, scope, rerender) {
  const focused = trigger && document.activeElement === trigger;
  const seen = focused && inSight(trigger);
  rerender();
  if (focused) refocus(trigger, scope, { reveal: seen });
}

let sheetOpener = null;

// ---------- History ----------
// An open sheet owns one history entry, so Back (the browser's, Android's or
// a home-screen app's back gesture) closes the sheet instead of leaving.

const SHEET_ENTRY = 'scentcastSheet';
export const sheetEntry = () => history.state?.[SHEET_ENTRY] === true;
let leavingEntry = false; // closeSheet went back itself; that popstate is ours
let afterSheetEntry = null; // a URL for the page's entry, once back on it
let afterLeaving = null; // closeSheet's `then`, once back on the page's entry

function pushSheetEntry() {
  if (!sheetEntry()) history.pushState({ [SHEET_ENTRY]: true }, '');
}

// False when there was no entry to leave.
function dropSheetEntry() {
  if (!sheetEntry()) return false;
  leavingEntry = true;
  history.back();
  return true;
}

// A URL change for the page's own entry made while a sheet's entry is on top.
export function replacePageURL(url) {
  if (sheetEntry()) afterSheetEntry = url;
  history.replaceState(history.state, '', url);
}

// The shell's popstate listener asks first: true when the event was a sheet's.
export function sheetPopped() {
  if (afterSheetEntry && !sheetEntry()) {
    history.replaceState(history.state, '', afterSheetEntry);
    afterSheetEntry = null;
  }
  if (leavingEntry) {
    leavingEntry = false;
    // A sheet opened again before the browser got back: it needs an entry.
    if (state.sheet) pushSheetEntry();
    const then = afterLeaving;
    afterLeaving = null;
    then?.();
    return true;
  }
  if (!state.sheet) {
    // A sheet's entry with no sheet open (Forward after the sheet closed, or
    // Back onto one a link left behind): step back past it. Arrived by
    // Forward, that undoes the step, as there's nothing ahead; by Back, it
    // lands on the page the sheet was over.
    if (!sheetEntry()) return false;
    history.back();
    return true;
  }
  // Back from "Add it yourself" returns to the sheet it came from.
  if (state.sheet.kind === 'custom' && state.sheet.back) openSheet(state.sheet.back);
  else closeSheet({ fromHistory: true });
  return true;
}

// The bottle page is open as a dialog (under 1100px; docked beside the page
// from there), which keeps the page under it inert and unscrolled.
export const bottleDialog = () => state.route?.dest === 'bottle' && !matchMedia('(min-width: 1100px)').matches;

// `instant` skips the slide.
export function openSheet(sheet, { instant = false } = {}) {
  const wasOpen = !!state.sheet;
  const sameKind = state.sheet?.kind === sheet.kind;
  if (!wasOpen) sheetOpener = document.activeElement;
  state.sheet = sheet;
  renderSheet({ keepScroll: sameKind, fresh: !sameKind });
  if (state.sheet !== sheet) return; // nothing to show, so it closed
  pushSheetEntry();
  const el = $('#sheet');
  el.hidden = false;
  document.body.classList.add('sheet-open');
  $('#app').inert = true;
  $('.skip-link').inert = true;
  if (!wasOpen) {
    if (instant) el.classList.add('open');
    else requestAnimationFrame(() => el.classList.add('open'));
  }
  if (!sameKind) {
    // A sheet with a text field opens on it, ready to type, where there's a
    // keyboard; on phones on Close, so the keyboard doesn't pop up unasked.
    const typing = matchMedia('(hover: hover)').matches && el.querySelector(TEXT_FIELD);
    (typing || el.querySelector('.sheet-close'))?.focus({ preventScroll: true });
  }
}
const TEXT_FIELD = 'input:is([type="search"], [type="text"], :not([type])), textarea';

export function updateSheet(patch) {
  if (!state.sheet) return;
  state.sheet = { ...state.sheet, ...patch };
  renderSheet({ keepScroll: true });
}

// The phone slide-out takes --dur-4 (src/tokens.css).
export const SHEET_OUT_MS = 480;

// `fromHistory`: Back already took the sheet's history entry away. `then`
// runs once the page's own entry is current again: going Back is async, so a
// navigation made right after closeSheet() would land on the sheet's entry
// and be lost (closeSheet({ then: () => app.navigate(…) })).
export function closeSheet({ instant = false, fromHistory = false, then = null } = {}) {
  const el = $('#sheet');
  state.sheet = null;
  const left = fromHistory || !dropSheetEntry();
  if (!left) afterLeaving = then;
  el.classList.remove('open');
  // A bottle page open as a dialog keeps the page under it still.
  const modal = bottleDialog();
  if (!modal) document.body.classList.remove('sheet-open');
  $('#app').inert = false;
  $('.skip-link').inert = modal;
  // Its opener gone, focus lands on the top of the page (or of the bottle
  // page under the sheet) so Tab carries on from there.
  if (!refocus(sheetOpener) && sheetOpener && sheetOpener !== document.body) focusTop();
  sheetOpener = null;
  const hide = () => { if (!state.sheet) { el.hidden = true; el.innerHTML = ''; } };
  if (instant) hide();
  else setTimeout(hide, SHEET_OUT_MS);
  if (left) then?.();
}

// ---------- Toast ----------
// It stays 5 s, held while it's hovered or focused and given a few more
// seconds after (WCAG 2.2.1). One with a control (Undo, See it) that a key
// press brought up waits instead until the next thing done or the next page:
// it's the last stop in the tab order, a long way off. Ctrl+Z (⌘Z) presses
// its Undo from anywhere outside a text field. Following one of its controls
// puts it away (the shell's clicks). Callers pass HTML: escape names, and an
// Undo button goes inside. `tone`: 'success' (the default) leads with a
// check, 'error' (it didn't work, or can't be done) with an alert mark, and
// 'info' (a fallback, a note) with nothing.

const TOAST_MS = 5000;
let toastTimer;
let toastWaits = false; // shown by a key press with a control in it: no timer
let byKey = false; // the last input was a key press, not a pointer
function armToast(ms = TOAST_MS) {
  clearTimeout(toastTimer);
  if (!toastWaits) toastTimer = setTimeout(hideToast, ms);
}
const undoButton = () => [...$('#toast').querySelectorAll('button')].find(b => b.textContent.trim() === 'Undo');
const TOAST_GLYPH = { success: icon.check, error: icon.alert, info: '' };
export function showToast(html, { tone = 'success' } = {}) {
  const el = $('#toast');
  const known = Object.hasOwn(TOAST_GLYPH, tone) ? tone : 'success';
  el.innerHTML = `${TOAST_GLYPH[known]}${html}`;
  el.dataset.tone = known;
  el.hidden = false;
  // A message on two lines takes the rounded box, not the pill.
  const text = el.querySelector(':scope > span');
  el.classList.toggle('wrapped', Boolean(text) && text.getBoundingClientRect().height > 1.5 * parseFloat(getComputedStyle(text).lineHeight));
  undoButton()?.setAttribute('aria-keyshortcuts', 'Control+Z Meta+Z');
  toastWaits = byKey && Boolean(el.querySelector('button, a'));
  requestAnimationFrame(() => el.classList.add('show'));
  armToast();
}
// Focus inside it goes to the top of what's on screen as it goes, unless
// the action that hid it moved focus itself.
export function hideToast() {
  const el = $('#toast');
  clearTimeout(toastTimer);
  toastWaits = false;
  el.classList.remove('show');
  queueMicrotask(() => { if (el.contains(document.activeElement)) focusTop(); });
  setTimeout(() => { if (!el.classList.contains('show')) el.hidden = true; }, 200);
}
// A toast waiting for the next thing done (above) goes once it's done.
export function settleToast() {
  if (toastWaits && $('#toast').classList.contains('show')) hideToast();
}
export function watchToast() {
  const el = $('#toast');
  const hold = () => clearTimeout(toastTimer);
  const resume = () => { if (el.classList.contains('show') && !el.matches(':hover, :focus-within')) armToast(3000); };
  el.addEventListener('pointerenter', hold);
  el.addEventListener('focusin', hold);
  el.addEventListener('pointerleave', resume);
  el.addEventListener('focusout', e => { if (!el.contains(e.relatedTarget)) resume(); });
  addEventListener('pointerdown', () => { byKey = false; }, true);
  // A click that came from no pointer (Enter, Space, a screen reader's
  // activation) counts as a key press.
  addEventListener('click', e => { byKey = e.detail === 0; }, true);
  addEventListener('keydown', e => {
    byKey = true;
    if (e.key.toLowerCase() !== 'z' || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
    if (!el.classList.contains('show') || e.target.closest?.('input, textarea, [contenteditable]')) return; // the field's own undo
    const undo = undoButton();
    if (!undo) return;
    e.preventDefault();
    undo.click();
  }, true);
}

// The top of what's on screen: an open sheet's Close, the bottle page's
// Close, else the page's heading.
export function focusTop() {
  const sel = state.sheet ? '#sheet .sheet-close' : state.route?.dest === 'bottle' ? '#bottle .bp-close' : '#page-title';
  $(sel)?.focus({ preventScroll: true });
}

// ---------- The bottle's flight ----------
// Opening a bottle flies its photo from the list into its page, and closing
// flies it back (View Transitions). Without the API, or with reduced motion,
// the page just slides.

const BOTTLE_VT = 'sc-bottle';
export const canMorph = () => 'startViewTransition' in document && !reducedMotion();
export const visible = img => {
  const r = img?.getBoundingClientRect();
  return r && r.width > 0 && r.bottom > 0 && r.top < innerHeight;
};

export function morph(from, update, to) {
  from.style.viewTransitionName = BOTTLE_VT;
  const vt = document.startViewTransition(async () => {
    from.style.viewTransitionName = '';
    update();
    const target = to();
    if (!target) return;
    target.style.viewTransitionName = BOTTLE_VT;
    // A freshly rendered <img> isn't decoded yet; without this the bottle
    // vanishes mid-flight. Cached, so it's quick, but never wait long.
    await Promise.race([target.decode().catch(() => {}), new Promise(r => setTimeout(r, 200))]);
  });
  // A transition cut short (another started, the page navigated) still ran
  // its update; nothing to report.
  vt.ready.catch(() => {});
  vt.finished.catch(() => {}).finally(() => {
    for (const img of document.querySelectorAll('img')) if (img.style.viewTransitionName) img.style.viewTransitionName = '';
  });
}
