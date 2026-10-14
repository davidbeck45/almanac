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
export function renderSheet({ keepScroll = false, fresh = false } = {}) {
  const el = $('#sheet');
  const s = state.sheet;
  const render = SHEETS[s.kind];
  if (!render) throw new Error(`No sheet called "${s.kind}"`);
  const scroll = keepScroll ? el.querySelector('.sheet-panel')?.scrollTop : 0;
  const html = render(s);
  if (html === null) return closeSheet();
  el.innerHTML = html;
  const panel = el.querySelector('.sheet-panel');
  if (fresh) panel.classList.add('fresh');
  if (keepScroll) panel.scrollTop = scroll;
}

// Put focus back on an element a re-render replaced: itself if it survived,
// else the element in `scope` with the same tag and data attributes. A text
// field's successor gets the caret where it was. False when neither is
// there (a hidden bottle's card, say).
export function refocus(el, scope = '#app') {
  if (!el || el === document.body) return false;
  const attrs = Object.entries(el.dataset ?? {})
    .map(([k, v]) => `[data-${k.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}="${CSS.escape(v)}"]`).join('');
  const target = el.isConnected ? el : attrs ? document.querySelector(`${scope} ${el.tagName.toLowerCase()}${attrs}`) : null;
  target?.focus({ preventScroll: true });
  if (target && target !== el && 'selectionStart' in el) {
    try { target.setSelectionRange(el.selectionStart, el.selectionEnd); } catch {} // not every input type has a caret
  }
  return Boolean(target);
}

// Views and sheets re-render whole, which replaces the control that asked for
// it; focus its successor in `scope` so keyboard and screen reader users keep
// their place.
export function keepingFocus(trigger, scope, rerender) {
  const focused = trigger && document.activeElement === trigger;
  rerender();
  if (focused) refocus(trigger, scope);
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
  if (!state.sheet) return false;
  // Back from "Add it yourself" returns to the sheet it came from.
  if (state.sheet.kind === 'custom' && state.sheet.back) openSheet(state.sheet.back);
  else closeSheet({ fromHistory: true });
  return true;
}

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
  if (!wasOpen) {
    if (instant) el.classList.add('open');
    else requestAnimationFrame(() => el.classList.add('open'));
  }
  if (!sameKind) {
    // Don't pop the keyboard on phones just for opening a sheet.
    const typing = matchMedia('(hover: hover)').matches;
    el.querySelector(typing ? 'input, textarea, .sheet-close' : '.sheet-close')?.focus({ preventScroll: true });
  }
}

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
  if (!document.querySelector('#bottle.modal')) document.body.classList.remove('sheet-open');
  $('#app').inert = false;
  // Its opener gone, focus lands on the page's heading so Tab carries on from there.
  if (!refocus(sheetOpener) && sheetOpener && sheetOpener !== document.body) $('#page-title')?.focus({ preventScroll: true });
  sheetOpener = null;
  const hide = () => { if (!state.sheet) { el.hidden = true; el.innerHTML = ''; } };
  if (instant) hide();
  else setTimeout(hide, SHEET_OUT_MS);
  if (left) then?.();
}

// ---------- Toast ----------
// It stays 5 s, held while it's hovered or focused (WCAG 2.2.1) and given a
// few more seconds after. Callers pass HTML: escape names, and an Undo
// button goes inside.

const TOAST_MS = 5000;
let toastTimer;
function armToast(ms = TOAST_MS) {
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, ms);
}
export function showToast(html) {
  const el = $('#toast');
  el.innerHTML = `${icon.check}${html}`;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('show'));
  armToast();
}
export function hideToast() {
  const el = $('#toast');
  clearTimeout(toastTimer);
  el.classList.remove('show');
  setTimeout(() => { if (!el.classList.contains('show')) el.hidden = true; }, 200);
}
export function watchToast() {
  const el = $('#toast');
  const hold = () => clearTimeout(toastTimer);
  const resume = () => { if (el.classList.contains('show') && !el.matches(':hover, :focus-within')) armToast(3000); };
  el.addEventListener('pointerenter', hold);
  el.addEventListener('focusin', hold);
  el.addEventListener('pointerleave', resume);
  el.addEventListener('focusout', e => { if (!el.contains(e.relatedTarget)) resume(); });
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
