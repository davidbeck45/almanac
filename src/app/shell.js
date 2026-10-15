// The app shell: the layout (nav, page, bottle page), routing, the render
// cycle, event delegation into the views' action maps, the forecast, and
// boot (src/main.js calls it). Browser-only. A view is a module in
// src/views/ that exports its page or panes, templates, and maps of
// actions, forms, fields, changes and sheets; CLAUDE.md ("Checking the UI")
// says how to add one.
import { summarize, getForecast, cachedForecast, forecastError } from '../weather.js';
import { saveLocation } from '../location.js';
import { parseShare } from '../collections.js';
import { fetchFragrances } from '../api.js';
import { isFragellaId } from '../fragella.js';
import { isCustomId, fromShareToken } from '../custom.js';
import { loadAbout } from '../fragrantica.js';
import { sceneTint, skyAccent } from '../scene.js';
import { setTheme, theme, paint } from '../theme.js';
import { esc, deg, plural, toastName } from '../ui.js';
import { icon, segLinksHTML, messageHTML, FALLBACK_THUMB } from '../ui/components.js';
import { parseRoute, routeHash, sameRoute, legacyHash, go, HOME } from './router.js';
import { locationFromURL } from './early.js';
import { askPool } from './pool.js';
import { loadWants, hasWant, setWant } from '../wishlist.js';
import {
  state, computeToday, sourceRecords, knownBottles, library, setActive as chooseList,
  addToMine as addRecord, markBottlesLoaded, keepBottles, loadFullRecord, retryClimate,
} from './state.js';
import {
  registerSheets, renderSheet, openSheet, updateSheet, closeSheet, sheetPopped, sheetEntry, replacePageURL, refocus, refocusNear, inSight,
  keepingFocus, showToast, hideToast, settleToast, watchToast, morph, canMorph, visible, reducedMotion, SHEET_OUT_MS,
  watchTabBar, showTabBar,
} from './sheets.js';
import * as wearView from '../views/wear.js';
import * as wardrobeView from '../views/wardrobe.js';
import * as discoverView from '../views/discover.js';
import * as bottleView from '../views/bottle.js';
import * as settingsView from '../views/settings.js';
import * as compareView from '../views/compare.js';
import '../views/sections.js';

const REFRESH_AFTER = 20 * 60 * 1000;
const $ = sel => document.querySelector(sel);

// ---------- The views ----------

const VIEWS = [wearView, wardrobeView, discoverView, bottleView, settingsView, compareView];
// The nav's destinations, in order, and every page a route can name.
const DESTINATIONS = [wearView.wear, wardrobeView.wardrobe, discoverView.discover];
const PAGES = Object.fromEntries([...DESTINATIONS, settingsView.settings, compareView.compare].map(p => [p.id, p]));
const PANES = Object.fromEntries(DESTINATIONS.map(d => [d.id, (d.panes ?? []).map(p => p.id)]));

// One map per kind of handler, from every view and from bottle-page sections
// that bring their own (addSection({ …, actions })); a name used twice throws.
// src/views/sections.js has run by now, so SECTIONS is complete.
function merged(kind) {
  const out = {};
  for (const view of [...VIEWS, ...bottleView.SECTIONS]) {
    for (const [name, fn] of Object.entries(view[kind] ?? {})) {
      if (out[name]) throw new Error(`Two ${kind} called "${name}"`);
      out[name] = fn;
    }
  }
  return out;
}
const ACTIONS = {
  'close-sheet': () => closeSheet(),
  // The skip link: past the nav to the page's heading.
  skip: () => $('#page-title')?.focus(),
  'list-back': () => listBack(),
  ...merged('actions'),
};
const FORMS = merged('forms');
const FIELDS = merged('fields');
const CHANGES = merged('changes');
registerSheets(merged('sheets'));

// What every action, form and field handler gets as `app`.
const app = {
  render, renderPage, renderBottle, retryBottle,
  navigate, openBottle, closeBottle,
  openSheet, updateSheet, closeSheet, renderSheet,
  showToast, hideToast, keepingFocus, refocus, inSight,
  refreshWeather, setLocation, setActive, addToMine, own, closeShared,
};

// From 1100px the bottle page docks beside the page as an inspector; under
// it, it's a dialog (a sheet on phones, a drawer on tablets).
const WIDE = matchMedia('(min-width: 1100px)');
const docked = () => WIDE.matches;

// ---------- Collections that touch the URL ----------

// This page's URL without some query parameters, the rest left as typed
// (URLSearchParams would re-encode the commas in ?loc=).
function withoutParams(...names) {
  const url = new URL(location.href);
  url.search = url.search.slice(1).split('&').filter(p => p && !names.includes(decodeURIComponent(p.split('=')[0]))).join('&');
  return url;
}

function closeShared() {
  state.shared = null;
  replacePageURL(withoutParams('c', 'n').href);
}

function setActive(active) {
  chooseList(active);
  if (state.shared) closeShared();
}

function addToMine(record) {
  addRecord(record);
  if (state.shared) closeShared();
}

// The list "I own it" moved away from, for the toast's way back.
let listBefore = null;

// "I own it": the bottle goes into Mine, and picks come from Mine; it comes
// off the wishlist, whichever screen said so. When that switches lists (from
// David's wardrobe or a shared link), the toast says so and offers the way
// back.
function own(record) {
  const switching = Boolean(state.shared) || state.active !== 'mine';
  const label = state.shared ? (state.shared.name ? `${state.shared.name}’s` : 'the shared list') : 'David’s';
  const before = { active: state.active, shared: state.shared, search: location.search };
  addToMine(record);
  if (hasWant(loadWants(), record.id)) setWant(record.id, false);
  render();
  if (!switching) return showToast(`<span>${esc(toastName(record.name))} added to Mine</span>`);
  listBefore = before;
  showToast(`<span class="note">${esc(record.name)} added to Mine. Picks now come from your ${plural(state.mine.records.length, 'bottle')}.</span>
    <button class="btn secondary compact" data-action="list-back">Back to ${esc(label)}</button>`);
}

function listBack() {
  if (!listBefore) return;
  const { active, shared, search } = listBefore;
  listBefore = null;
  chooseList(active);
  if (shared) {
    state.shared = shared;
    const url = new URL(location.href);
    url.search = search;
    replacePageURL(url.href);
  }
  render();
  hideToast();
}

// ---------- Rendering ----------

// Everything on screen, again (data, weather, units or theme changed). The
// focused control, replaced, hands focus to its successor, else to the
// nearest one like it left in its list (a bottle hidden from a shelf); with
// none (a button that became a tag, a banner that went), focus goes to the
// top of the region it was in, never to the page's body.
function render() {
  const focused = document.activeElement;
  const seen = inSight(focused);
  const region = focused?.closest?.('#sheet, #bottle, #app');
  const scope = region ? `#${region.id}` : '#app';
  computeToday();
  renderTint();
  renderNav();
  renderPage();
  renderBottle();
  if (state.sheet) renderSheet({ keepScroll: true });
  if (focused && focused !== document.body && !focused.isConnected && !refocusNear(focused, scope, { reveal: seen })) {
    const fallback = { '#sheet': '#sheet .sheet-close', '#bottle': '#bottle .bp-close' }[scope] ?? '#page-title';
    $(fallback)?.focus({ preventScroll: true });
  }
}

// The tab's title follows the route: the bottle's name on its page (or
// "Loading", "Bottle not found"), else the pane's title.
function syncTitle() {
  const r = state.route;
  let title = null;
  if (r?.dest === 'bottle') title = $('#bottle-title')?.textContent;
  else if (state.base) {
    const { page, pane } = currentPage();
    title = pane.title?.(state.base) ?? page.label;
  }
  if (title) document.title = `${title} · Scentcast`;
}

// The page takes its tint from the sky: --tint-* behind the hero and in the
// surfaces, --ambient for accents (gold stays for today, selection and focus).
function renderTint() {
  const sky = wearView.sceneNow(state.wx, { error: Boolean(state.error) });
  const [top, mid, low] = sceneTint(sky.phase, sky.category, theme());
  const root = document.documentElement.style;
  root.setProperty('--tint-top', top);
  root.setProperty('--tint-mid', mid);
  root.setProperty('--tint-low', low);
  root.setProperty('--ambient', paint(skyAccent(sky.phase, sky.category, theme())));
  $('meta[name="theme-color"]')?.setAttribute('content', top);
}

// Where each destination was last, so its tab goes back there.
const lastRoute = {};

function renderNav() {
  const here = state.base?.dest;
  const now = state.wx?.now;
  const items = DESTINATIONS.map(d => {
    const href = routeHash(lastRoute[d.id] ?? parseRoute(`#/${d.id}`, PANES));
    return `<li><a class="nav-item" href="${esc(href)}" data-dest="${d.id}"${here === d.id ? ' aria-current="page"' : ''}>${icon[d.icon]}<span>${esc(d.label)}</span></a></li>`;
  }).join('');
  $('#nav').innerHTML = `
    <a class="wordmark" href="#/wear/now" aria-label="Scentcast, what to wear now">Scentcast</a>
    <ul class="nav-items">${items}</ul>
    <div class="nav-foot">
      <button class="nav-loc" data-action="location" aria-label="Change location: ${esc(state.loc?.name ?? 'not set')}">${icon.pin}<span><b>${esc(state.loc?.name ?? 'Set location')}</b>${now ? `<small>${deg(now.tempF)} · ${esc(now.label)}</small>` : ''}</span></button>
      <a class="nav-item nav-settings" href="#/settings" data-dest="settings"${here === 'settings' ? ' aria-current="page"' : ''}>${icon.gear}<span>Settings</span></a>
    </div>`;
}

function currentPage() {
  const r = state.base;
  const page = PAGES[r.dest];
  return { r, page, pane: page.panes?.find(p => p.id === r.pane) ?? page };
}

// The page's h1 (hidden under the hero, which says it), then a bar that
// sticks under the top edge: the sub-navigation, and the gear on phones.
function headHTML(page, pane, r) {
  const quiet = Boolean(page.hiddenHeading);
  const sub = page.panes
    ? segLinksHTML(page.panes.map(p => ({ href: routeHash({ dest: page.id, pane: p.id }), label: p.label, on: p.id === r.pane })), { label: `${page.label} views`, cls: 'subnav' })
    : '';
  const gear = r.dest === 'settings' ? '' : `<a class="icon-btn gear-link" href="#/settings" aria-label="Settings">${icon.gear}</a>`;
  return `<header class="page-head${quiet ? ' quiet' : ''}">
      <h1 id="page-title" tabindex="-1"${quiet ? ' class="visually-hidden"' : ''}>${esc(pane.heading?.(r) ?? page.label)}</h1>
      ${quiet ? '' : gear}
    </header>
    ${sub || quiet ? `<div class="head-bar">${sub}${quiet ? gear : ''}</div>` : ''}`;
}

// The head bar says when it's stuck under the top edge (.stuck), where
// shell.css draws a band of the page's color behind it. A redraw keeps the
// state it had, so the band doesn't blink.
let headWatch = null; // { io, top }
function watchHeadBar(stuck) {
  const bar = $('#main .head-bar');
  headWatch?.io.disconnect();
  if (!bar || !('IntersectionObserver' in window)) return;
  bar.classList.toggle('stuck', stuck);
  // It sticks `top` px down (the safe area and a gap): it's stuck once it
  // pokes above a root edge a pixel lower.
  const top = parseFloat(getComputedStyle(bar).top) || 0;
  if (headWatch?.top !== top) {
    const io = new IntersectionObserver(([e]) => e.target.classList.toggle('stuck', e.intersectionRatio < 1 && e.boundingClientRect.top < top + 1),
      { rootMargin: `${-(top + 1)}px 0px 0px 0px`, threshold: 1 });
    headWatch = { io, top };
  }
  headWatch.io.observe(bar);
}

function heroAspect() {
  const el = $('#hero');
  return el.clientHeight ? el.clientWidth / el.clientHeight : 400 / 220;
}

function renderHero(r, page) {
  const el = $('#hero');
  if (!page.hero) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  el.hidden = false;
  el.classList.toggle('compact', page.hero.compact(r));
  state.heroAspect = heroAspect();
  el.innerHTML = page.hero.render(r, state.heroAspect);
}

// Sideways strips marked data-keep-scroll (the shelves, the occasion strip)
// keep their place through a re-render of the page or the bottle page.
function keptScrolls(region) {
  return new Map([...region.querySelectorAll('[data-keep-scroll]')].map(el => [el.dataset.keepScroll, el.scrollLeft]));
}
function keepScrolls(region, kept) {
  for (const el of region.querySelectorAll('[data-keep-scroll]')) el.scrollLeft = kept.get(el.dataset.keepScroll) ?? 0;
}

function renderPage() {
  if (!state.base) return;
  const { r, page, pane } = currentPage();
  renderHero(r, page);
  const main = $('#main');
  const kept = keptScrolls(main);
  const stuck = Boolean(main.querySelector('.head-bar.stuck'));
  main.innerHTML = `${headHTML(page, pane, r)}<div class="pane" data-pane="${esc(r.dest)}${r.pane ? `/${esc(r.pane)}` : ''}">${pane.render(app, r)}</div>`;
  keepScrolls(main, kept);
  watchHeadBar(stuck);
  main.classList.toggle('updating', state.updating);
  main.setAttribute('aria-busy', String(state.updating));
  pane.after?.(app, r);
  document.body.dataset.route = r.dest;
  syncTitle();
  renderFoot();
}

function renderFoot() {
  const all = sourceRecords();
  $('#foot').innerHTML = settingsView.creditsHTML({
    fetched: state.demo?.fetched,
    scraped: all.some(f => !f.source),
    fragella: all.some(f => isFragellaId(f.id)),
  });
}

// ---------- The bottle page ----------

const missing = new Set(); // ids the library answered for without them
const failed = new Set(); // ids whose record didn't load (offline); retried on demand
const loadingBottles = new Set();
const askedAbout = new Set();
const askedFull = new Set(); // pool records whose every note was asked for

// The page's data, loading the record (dataset bottles opened from a link or
// a search) and its about data (for the sections) when they're not here.
// undefined while loading, null when there's no such bottle, false when it
// couldn't load (the page offers to try again). About data that couldn't
// load stays undefined, marked in state.aboutFailed (the sections say so)
// until Try again or the connection comes back. A record
// a pool answer brought (its 8 strongest notes) swaps for its r/ record, all
// its notes, keeping its signals. What a page asks for at once loads
// together and the page draws once when all of it is in (the sections'
// skeletons stand meanwhile): each draw rebuilds every section while the
// sheet slides up.
function bottleModelFor(r) {
  const id = r.arg;
  const model = bottleView.bottleModel(r);
  const showing = () => state.route?.dest === 'bottle' && state.route.arg === id;
  if (model) {
    const loads = [];
    // The wardrobe's and catalog's records carry theirs (`f.about`, the build's).
    if (/^\d+$/.test(id) && !model.f.about) loads.push(aboutLoad(id));
    if (model.f.source === 'fragrantica' && model.f.extras && state.bottles.get(id) === model.f && !askedFull.has(id)) {
      askedFull.add(id);
      loads.push(loadFullRecord(id).then(() => true, () => { askedFull.delete(id); return false; }));
    }
    drawWhenIn(loads.filter(Boolean), showing);
    return model;
  }
  if (missing.has(id)) return null;
  if (failed.has(id)) return false;
  if (!/^\d+$/.test(id) && !isCustomId(id)) return null;
  if (isCustomId(id)) {
    const f = fromShareToken(id);
    if (!f) return null;
    // By its token (the route) and its own id (what its page's buttons name).
    state.bottles.set(id, f);
    if (!state.bottles.has(f.id)) state.bottles.set(f.id, f);
    return bottleView.bottleModel(r);
  }
  if (!loadingBottles.has(id)) {
    loadingBottles.add(id);
    // A bottle in no list has no build's about data: it loads beside the
    // record. (At boot, before the lists are in, it may be one of theirs.)
    const record = library.records([id]).then(found => {
      // keepBottles: a pool answer landing meanwhile keeps its signals.
      if (found.get(id)) {
        keepBottles([found.get(id)]);
        askedFull.add(id);
      } else missing.add(id);
    }, () => fromPool(id).catch(() => failed.add(id))).finally(() => loadingBottles.delete(id));
    drawWhenIn([record, state.demo && aboutLoad(id)].filter(Boolean), showing);
  }
  return undefined;
}

// Offline, a dataset bottle's r/ shard can't load, but the suggestion pool
// the service worker keeps (once Discover or Insights loaded it) may hold the
// bottle, with its 8 strongest notes. Its answer keeps the record
// (onPoolRecords); rejects when it isn't there either.
async function fromPool(id) {
  await askPool('warm');
  const { records } = await askPool('records', { ids: [id], poolOnly: true });
  if (!records?.some(r => String(r.id) === id)) throw new Error('Not in the pool');
}

// Loads a dataset bottle's about data into state.about, unless it's there
// (Compare may have loaded it), on its way or failed (state.aboutFailed).
// -> a promise that never rejects, or null when there's nothing to load.
function aboutLoad(id) {
  if (state.about.has(id) || askedAbout.has(id) || state.aboutFailed.has(id)) return null;
  askedAbout.add(id);
  return loadAbout(id).then(about => { state.about.set(id, about); }, () => {
    askedAbout.delete(id);
    state.aboutFailed.add(id);
  });
}

// Draws the bottle page again once every load has settled, if it's still on
// screen. A load that resolves false (a full record that failed, asked again
// on the next draw) draws nothing by itself, or offline it would ask forever.
function drawWhenIn(loads, showing) {
  if (loads.length) Promise.all(loads).then(done => { if (done.some(d => d !== false) && showing()) renderBottle(); });
}

function setModal(on) {
  $('#page').inert = on;
  $('#nav').inert = on;
  $('.skip-link').inert = on || Boolean(state.sheet);
  document.body.classList.toggle('sheet-open', on || Boolean(state.sheet));
}

function retryBottle() {
  failed.clear();
  state.aboutFailed.clear();
  renderBottle();
}

// `fresh`: a newly opened bottle (its bars grow in); `instant`: no slide, a
// view transition animates it.
function renderBottle({ fresh = false, instant = false } = {}) {
  const el = $('#bottle');
  const r = state.route;
  const modal = !docked();
  if (r?.dest !== 'bottle') {
    if (el.hidden) return;
    el.classList.remove('open', 'entering', 'modal');
    $('#app').classList.remove('has-bottle');
    setModal(false);
    delete el.dataset.id;
    const hide = () => { if (state.route?.dest !== 'bottle') { el.hidden = true; el.innerHTML = ''; } };
    if (modal && !instant && !reducedMotion()) setTimeout(hide, SHEET_OUT_MS);
    else hide();
    return;
  }
  const panel = el.querySelector('.bp-panel');
  const sameBottle = el.dataset.id === r.arg;
  const scroll = sameBottle ? panel?.scrollTop ?? 0 : 0;
  // The section the reader is at stays where it is, however much the ones
  // above it grow (an answer landing turns a skeleton into a card).
  const reading = sameBottle && panel ? bottleView.readingAt(panel) : null;
  const focused = sameBottle && el.contains(document.activeElement) ? document.activeElement : null;
  const seen = inSight(focused);
  const kept = sameBottle ? keptScrolls(el) : new Map();
  const model = bottleModelFor(r);
  const opening = el.hidden;
  el.innerHTML = bottleView.bottlePageHTML(model, { modal });
  keepScrolls(el, kept);
  // Focus on its successor, else on the element with its id, else the close button: never the body.
  if (focused && !refocus(focused, '#bottle', { reveal: seen })) {
    ((focused.id && document.getElementById(focused.id)) || $('#bottle .bp-close'))?.focus({ preventScroll: true });
  }
  if (model) bottleView.afterBottle(model, app);
  el.dataset.id = r.arg;
  const next = el.querySelector('.bp-panel');
  if (fresh && !sameBottle) next.classList.add('fresh');
  // Docked, it slides in once when it opens; a re-render doesn't move it,
  // and another bottle in its place fades in.
  if (!modal && !sameBottle && !opening) next.classList.add('swap');
  next.scrollTop = scroll;
  if (reading) bottleView.keepReading(next, reading);
  el.classList.toggle('modal', modal);
  $('#app').classList.toggle('has-bottle', !modal);
  setModal(modal);
  syncTitle();
  if (opening) {
    el.hidden = false;
    if (!modal) el.classList.add('entering');
    if (instant || !modal) el.classList.add('open');
    else requestAnimationFrame(() => el.classList.add('open'));
  }
}

let bottleOpener = null;

// Opens a bottle's page from a list (`ctx`: the list's context key). Its
// photo flies from the list into the page.
function openBottle(id, ctx, trigger) {
  const hash = routeHash({ dest: 'bottle', arg: id, query: { ctx: ctx ?? '' } });
  const replace = state.route?.dest === 'bottle';
  const from = trigger?.querySelector('img') ?? trigger?.closest('.pick, .hero-pick')?.querySelector('img');
  if (!canMorph() || !visible(from)) return navigate(hash, { replace });
  morph(from, () => navigate(hash, { replace, instant: true }), () => $('#bottle .bp-bottle img'));
}

// Back to the page under it: the history entry it came from when there is
// one, so Back after it doesn't return here.
// (Back is a same-document navigation, which would cut a view transition
// short, so the page closes when the popstate arrives.)
function closeBottle() {
  if (state.route?.dest !== 'bottle') return;
  if (pushedBottle) return history.back();
  go(routeHash(state.base), { replace: true });
  transition(state.base);
}

// ---------- Routing ----------

// Where each page was left: by its route less a pane's argument (Occasion's
// pick), so each of Discover's lists, its own query, keeps its own.
const scrolls = new Map();
const scrollKey = r => routeHash({ ...r, arg: null });
const samePane = (a, b) => Boolean(a && b) && a.dest === b.dest && a.pane === b.pane;
let pushedBottle = false; // the bottle page's entry was pushed by the app

// `restore`: a return to a page (the nav, the sub-navigation), which opens
// where it was left, as Back and Forward do; any other link opens at the top.
function navigate(hash, { replace = false, quiet = false, instant = false, restore = false } = {}) {
  const next = parseRoute(hash, PANES);
  if (sameRoute(next, state.route)) {
    // The current tab again goes back to its top.
    if (!quiet) scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
    return;
  }
  go(routeHash(next), { replace });
  if (next.dest === 'bottle' && state.route?.dest !== 'bottle') pushedBottle = !replace;
  transition(next, { quiet, instant, restore });
}

// Moves to a route: the page under a bottle page changes only when the route
// isn't one. Closing a bottle page by Back flies the bottle home.
// A route a view transition is on its way to (Back fires popstate and then
// hashchange; the second must not start the flight again).
let arriving = null;

function transition(next, { quiet = false, instant = false, restore = false } = {}) {
  const prev = state.route;
  if (sameRoute(arriving ?? prev, next)) return;
  if (prev?.dest === 'bottle' && next.dest !== 'bottle' && sameRoute(state.base, next) && canMorph()) {
    const from = $('#bottle .bp-bottle img');
    const id = prev.arg;
    const home = () => [...document.querySelectorAll(`#page [data-action="open"][data-id="${CSS.escape(id)}"] img`)].find(visible);
    if (visible(from) && home()) {
      arriving = next;
      return morph(from, () => { arriving = null; applyRoute(next, { quiet, instant: true, restore }); }, home);
    }
  }
  applyRoute(next, { quiet, instant, restore });
}

// The page a bottle page opened straight from a link sits over: the list its
// context names (a Week window, Occasion, the saved trip's plan), so its
// ranking is there to read.
function baseFor({ query }) {
  const ctx = query.ctx ?? '';
  return ctx.startsWith('w:') ? '#/wear/week' : ctx.startsWith('trip:') ? '#/wear/trip' : ctx === 'occ' ? '#/wear/occasion' : HOME;
}

// The bottle page a link left (its Compare, "More like this") and the page
// it was over: Back onto it puts that page under it again, as it was, so it
// doesn't sit over the page the link went to.
let leftBottle = null; // { bottle, base, opener }

function applyRoute(next, { quiet = false, instant = false, restore = false } = {}) {
  const prev = state.route;
  state.route = next;
  if (next.dest === 'bottle') {
    const focused = document.activeElement;
    const back = restore && leftBottle && sameRoute(next, leftBottle.bottle);
    if (!state.base) setBase(parseRoute(baseFor(next), PANES), { quiet: true });
    else if (back && !sameRoute(state.base, leftBottle.base)) setBase(leftBottle.base, { quiet: true, restore: true });
    // Focus goes back to what opened it when it closes (Back onto it: what
    // opened it first). Docked beside the page, that's the latest control on
    // the page to open one (bottle after bottle); one opened from inside the
    // bottle page keeps the first.
    if (back) bottleOpener = leftBottle.opener;
    else if (prev?.dest !== 'bottle' || (docked() && focused !== document.body && !$('#bottle').contains(focused))) bottleOpener = focused;
    renderBottle({ fresh: true, instant });
    if (!quiet) $('#bottle .bp-close')?.focus({ preventScroll: true });
    showTabBar();
    return;
  }
  pushedBottle = false;
  // Closing a bottle page leaves the page under it as it was, focus back on
  // what opened it (hidden from picks, the next bottle in its list); a new
  // page (a link out of the bottle page, the rail with the inspector open)
  // is a navigation like any other. The bottle page goes first: as a dialog
  // it keeps the page under it inert, and focus can't land on the new
  // page's heading until it's gone. Docked, it gives focus back only when
  // focus was in it: a control on the page keeps it.
  const changed = !sameRoute(state.base, next);
  const focused = document.activeElement;
  const pageHadFocus = docked() && focused && focused !== document.body && !$('#bottle').contains(focused);
  renderBottle({ instant });
  if (changed) {
    if (prev?.dest === 'bottle') leftBottle = { bottle: prev, base: state.base, opener: bottleOpener };
    state.from = prev;
    // Back from a bottle page onto the page it was over, whose URL caught up
    // with it meanwhile (Discover's chips changed beside it): no new page.
    const closing = prev?.dest === 'bottle' && restore && samePane(state.base, next);
    setBase(next, { quiet, restore, keepScroll: closing });
  }
  if (prev?.dest === 'bottle' && !changed && !pageHadFocus && !refocusNear(bottleOpener)) $('#page-title')?.focus({ preventScroll: true });
  if (prev?.dest === 'bottle') bottleOpener = null;
  syncTitle();
  // Every route change brings the tab bar back, once the page's scroll is
  // where it lands.
  showTabBar();
}

// `restore`: open where it was left (Back, Forward, a tab, the
// sub-navigation), else at the top (a link: another of Discover's lists
// too). `keepScroll`: the scroll doesn't move.
function setBase(next, { quiet = false, restore = false, keepScroll = false } = {}) {
  const prev = state.base;
  const from = document.activeElement;
  if (prev) scrolls.set(scrollKey(prev), scrollY);
  state.base = next;
  state.armed = null; // a "Tap again to…" doesn't survive leaving its page
  lastRoute[next.dest] = next;
  const newPane = !prev || scrollKey(prev) !== scrollKey(next);
  if (newPane) settleToast();
  renderNav();
  renderPage();
  if (newPane && prev && !keepScroll) {
    scrollTo(0, (restore && scrolls.get(scrollKey(next))) || 0);
    if (!reducedMotion()) {
      const main = $('#main');
      main.classList.remove('enter');
      void main.offsetWidth; // restart the animation
      main.classList.add('enter');
    }
  }
  // A new page puts focus on its heading. Within a destination, picking a
  // pane from the sub-navigation keeps focus there, on the pane just picked.
  const stay = prev?.dest === next.dest && from?.closest?.('.subnav') && refocus(from, '#main');
  if (!quiet && prev && !stay) $('#page-title')?.focus({ preventScroll: true });
}

// Back, forward, or a typed URL.
function sync() {
  const next = parseRoute(location.hash, PANES);
  const canonical = routeHash(next);
  if (location.hash !== canonical) go(canonical, { replace: true });
  // Forward onto a bottle page, or a typed one: the page before is its own
  // entry, so closing can go Back to it.
  if (next.dest === 'bottle' && state.route?.dest !== 'bottle') pushedBottle = true;
  transition(next, { restore: true });
}

window.addEventListener('popstate', () => {
  if (sheetPopped()) return;
  sync();
});
window.addEventListener('hashchange', () => sync());

// ---------- Weather ----------

// The forecast boot asked for while the wardrobe loads: it doesn't need it.
let early = null; // { loc, forecast: promise }
const samePlace = (a, b) => a?.lat === b?.lat && a?.lon === b?.lon;
// Past this with nothing on screen, the hero says the forecast is slow
// (state.slow); the request gives up at REQUEST_TIMEOUT (weather.js).
const SLOW_AFTER = 7000;

// Opens on the saved forecast when there is one: fresh, it's all we need;
// older, it shows under "Updating…", photos faded, until the new one arrives,
// so the morning check doesn't wait on the network. Without one, a slow
// answer says so after SLOW_AFTER, and one that never comes ends in the
// forecast error with Try again.
async function refreshWeather({ force = false } = {}) {
  if (!state.loc) return;
  const asked = !force && early?.loc === state.loc ? early.forecast : null;
  early = null;
  state.error = null;
  if (!state.wx && !force) {
    const cached = cachedForecast(state.loc);
    if (cached) {
      state.forecast = cached.forecast;
      state.wx = summarize(cached.forecast);
      if (cached.fresh) return render();
    }
  }
  state.loading = true;
  state.updating = Boolean(state.wx);
  state.slow = false;
  render();
  const slow = setTimeout(() => {
    if (!state.loading || state.wx) return;
    state.slow = true;
    render();
  }, SLOW_AFTER);
  try {
    state.forecast = await (asked ?? getForecast(state.loc, { force }));
    state.wx = summarize(state.forecast);
  } catch (err) {
    if (state.wx) state.wx = { ...state.wx, stale: true };
    else state.error = forecastError(err);
  } finally {
    clearTimeout(slow);
    state.loading = false;
    state.updating = false;
    state.slow = false;
  }
  render();
}

// A place picked here replaces one pinned by ?loc=, which would bring the
// old place back on a reload. It closes the location sheet, not another one
// a late answer from "Use my location" finds open.
async function setLocation(loc) {
  state.loc = loc;
  state.wx = null;
  state.slot = null;
  saveLocation(loc);
  if (state.sheet?.kind === 'location') closeSheet();
  if (new URLSearchParams(location.search).has('loc')) replacePageURL(withoutParams('loc').href);
  await refreshWeather();
}

// ---------- Shared links ----------

async function openSharedLink(link) {
  state.shared = { ...link, records: [], missing: [], loading: true };
  // Bottles entered by hand travel whole inside the link.
  const known = new Map(knownBottles().map(f => [f.id, f]));
  const local = link.ids.map(id => known.get(id) ?? (isCustomId(id) ? fromShareToken(id) : null));
  const remote = new Map();
  const unknown = link.ids.filter((id, i) => !local[i]);
  const legacy = unknown.filter(isFragellaId); // Fragella bottles from older links, via the Worker
  await Promise.all([
    library.records(unknown).then(found => found.forEach((r, id) => remote.set(id, r))).catch(() => {}),
    legacy.length
      ? fetchFragrances(legacy).then(({ records }) => records.forEach(r => remote.set(r.id, r))).catch(() => {})
      : null,
  ]);
  if (!state.shared) return;
  state.shared.records = link.ids.map((id, i) => local[i] ?? remote.get(id)).filter(Boolean);
  state.shared.missing = link.ids.filter((id, i) => !local[i] && !remote.has(id));
  state.shared.loading = false;
  render();
}

// ---------- Events ----------

function listen() {
  document.addEventListener('click', async e => {
    if (e.defaultPrevented) return;
    // The toast's own controls (Undo, See it) put it away once followed; a
    // toast waiting on a keyboard user goes with whatever they do next.
    const inToast = e.target.closest('#toast');
    if (!inToast) settleToast();
    const link = e.target.closest('a[href^="#/"]');
    if (link) {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      navigate(link.getAttribute('href'), { restore: Boolean(link.closest('#nav, .subnav')) });
      if (inToast) hideToast();
      return;
    }
    const t = e.target.closest('[data-action]');
    if (!t || t.disabled) return;
    const fn = ACTIONS[t.dataset.action];
    if (!fn) throw new Error(`No action called "${t.dataset.action}"`);
    await fn(t, app, e);
    // (Unless the action put up a toast of its own in its place.)
    if (inToast && t.isConnected) hideToast();
  });

  document.addEventListener('input', e => FIELDS[e.target.dataset?.field]?.(e.target, app));
  document.addEventListener('change', e => CHANGES[e.target.dataset?.field]?.(e.target, app));

  document.addEventListener('submit', async e => {
    const fn = FORMS[e.target.dataset.form];
    if (!fn) return;
    e.preventDefault();
    await fn(new FormData(e.target), app, e.target);
  });

  // Arrow keys step through a radio group (roving tabindex), as in a native one.
  const STEPS = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (state.sheet) closeSheet();
      // In a field with text, Escape is the field's (it clears a search).
      else if (state.route?.dest === 'bottle' && !(e.target.matches?.('input, textarea') && e.target.value)) closeBottle();
      return;
    }
    const radio = e.target.closest?.('[role="radiogroup"] [role="radio"]');
    if (!radio || !(e.key in STEPS || e.key === 'Home' || e.key === 'End')) return;
    e.preventDefault();
    const group = [...radio.closest('[role="radiogroup"]').querySelectorAll('[role="radio"]')];
    const i = group.indexOf(radio);
    const next = e.key === 'Home' ? group[0] : e.key === 'End' ? group.at(-1) : group[(i + STEPS[e.key] + group.length) % group.length];
    const { action, value } = next.dataset;
    next.click();
    $(`[role="radiogroup"] [data-action="${action}"][data-value="${CSS.escape(value)}"]`)?.focus();
  });

  // Drag a sheet or the bottle sheet down to dismiss it (phones). Only starts
  // when it's scrolled to the top, so it never fights with scrolling.
  let drag = null;
  document.addEventListener('touchstart', e => {
    const panel = e.target.closest?.('.sheet-panel, #bottle.modal .bp-panel');
    if (!panel || innerWidth >= 720 || panel.scrollTop > 0 || e.target.closest('input, textarea, .calendar, .shelf')) return;
    drag = { panel, y0: e.touches[0].clientY, t0: e.timeStamp, dy: 0 };
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (!drag) return;
    drag.dy = e.touches[0].clientY - drag.y0;
    if (drag.dy <= 0 || drag.panel.scrollTop > 0) {
      drag.panel.style.transform = '';
      if (drag.dy < -4) drag = null;
      return;
    }
    drag.panel.classList.add('dragging');
    drag.panel.style.transform = `translateY(${drag.dy}px)`;
  }, { passive: true });
  document.addEventListener('touchend', e => {
    if (!drag) return;
    const { panel, dy, t0 } = drag;
    drag = null;
    panel.classList.remove('dragging');
    const flick = dy > 40 && dy / Math.max(1, e.timeStamp - t0) > 0.5;
    if (dy > 120 || flick) {
      if (panel.classList.contains('bp-panel')) closeBottle();
      else closeSheet();
    }
    panel.style.transform = '';
  });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!$('#hero').hidden && Math.abs(heroAspect() - state.heroAspect) / state.heroAspect > 0.05) renderPage();
    }, 150);
  });
  // Crossing 1100px turns the bottle page from a dialog into the inspector.
  WIDE.addEventListener('change', () => renderBottle());
  // Under 1100px the tab bar tucks away while the reader scrolls down.
  watchTabBar(WIDE);

  // The scene's loops (stars, rain, chimney smoke) pause while the hero is
  // scrolled out of sight.
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => $('#hero').classList.toggle('offscreen', !e.isIntersecting)).observe($('#hero'));
  }

  // Back online: a bottle page that couldn't load tries again, and so does
  // the place's climate.
  window.addEventListener('online', () => {
    retryClimate();
    if (state.route?.dest === 'bottle') retryBottle();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !state.loc) return;
    if (!state.wx || Date.now() - state.wx.fetchedAt > REFRESH_AFTER) refreshWeather();
    else { state.wx = summarize(state.forecast); render(); }
  });

  // A bottle photo that doesn't load (offline with nothing saved, gone,
  // blocked) shows the drawn bottle, not the browser's broken-image box.
  document.addEventListener('error', e => {
    const t = e.target;
    if (!(t instanceof HTMLImageElement) || t.dataset.fallback) return;
    t.dataset.fallback = '1';
    t.removeAttribute('srcset');
    t.src = FALLBACK_THUMB;
  }, true);

  watchToast();
}

// ---------- Boot ----------

// `early`: the forecast main.js asked for before the app loaded
// (src/app/early.js), { loc, forecast }.
export async function boot({ early: asked = null } = {}) {
  history.scrollRestoration = 'manual';
  // A reload on a sheet's history entry: no sheet is open, so it's the page's.
  if (sheetEntry()) history.replaceState(null, '');
  const params = new URLSearchParams(location.search);
  const pinned = locationFromURL(params);
  if (pinned) state.loc = pinned;
  if (params.get('theme')) setTheme(params.get('theme'));
  // ?view=week from the old home-screen shortcuts: the same pane as a route.
  const legacy = legacyHash(params);
  if (legacy) {
    const url = withoutParams('view');
    if (!location.hash) url.hash = legacy;
    history.replaceState(null, '', url);
  }
  listen();
  const first = parseRoute(location.hash || HOME, PANES);
  go(routeHash(first), { replace: true });
  renderTint();
  applyRoute(first, { quiet: true });
  // A bottle page opened from a link, as a dialog: focus in it, not on the
  // page behind (inert) or the body.
  if (first.dest === 'bottle' && !docked()) $('#bottle .bp-close')?.focus({ preventScroll: true });
  // A forecast that isn't fresh is on its way already (main.js), or asked
  // for now, alongside the wardrobe.
  if (asked && state.loc && samePlace(asked.loc, state.loc)) early = { loc: state.loc, forecast: asked.forecast };
  else if (state.loc && !cachedForecast(state.loc)?.fresh) {
    early = { loc: state.loc, forecast: getForecast(state.loc) };
    early.forecast.catch(() => {}); // refreshWeather hears it
  }
  try {
    const [demo, catalog] = await Promise.all([
      fetch('data/collection.json').then(r => r.json()),
      fetch('data/catalog.json').then(r => r.json()).catch(() => ({ fragrances: [] })),
    ]);
    for (const f of [...demo.fragrances, ...catalog.fragrances]) f.id = String(f.id);
    state.demo = demo;
    state.catalog = catalog.fragrances;
  } catch {
    markBottlesLoaded();
    $('#main').innerHTML = messageHTML({ glyph: icon.bottle, title: 'Collection missing', body: 'Couldn’t load David’s wardrobe. Check your connection and reload.' });
    return;
  }
  markBottlesLoaded();
  const link = parseShare(params);
  if (link) openSharedLink(link);
  // The offline copy installs now, not once the forecast is in: a slow or
  // hung forecast mustn't keep the app from working offline.
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (state.loc) await refreshWeather();
  else { render(); openSheet({ kind: 'location' }); }
}
