// The app shell: the layout (nav, page, bottle page), routing, the render
// cycle, event delegation into the views' action maps, the forecast, and
// boot (src/main.js calls it). Browser-only. A view is a module in
// src/views/ that exports its page or panes, templates, and maps of
// actions, forms, fields and sheets; .sweep/notes/shell-map.md and CLAUDE.md
// say how to add one.
import { summarize, getForecast, cachedForecast, forecastError } from '../weather.js';
import { saveLocation } from '../location.js';
import { parseShare } from '../collections.js';
import { apiReady, fetchFragrances } from '../api.js';
import { isFragellaId } from '../fragella.js';
import { isCustomId, fromShareToken } from '../custom.js';
import { loadAbout } from '../fragrantica.js';
import { sceneTint, skyAccent } from '../scene.js';
import { setTheme, theme, paint } from '../theme.js';
import { esc, deg } from '../ui.js';
import { icon, segLinksHTML, messageHTML } from '../ui/components.js';
import { parseRoute, routeHash, sameRoute, legacyHash, go, HOME } from './router.js';
import {
  state, computeToday, sourceRecords, knownBottles, library, setActive as chooseList,
  addToMine as addRecord,
} from './state.js';
import {
  registerSheets, renderSheet, openSheet, updateSheet, closeSheet, sheetPopped, sheetEntry, replacePageURL, refocus,
  keepingFocus, showToast, hideToast, watchToast, morph, canMorph, visible, reducedMotion, SHEET_OUT_MS,
} from './sheets.js';
import * as wearView from '../views/wear.js';
import * as wardrobeView from '../views/wardrobe.js';
import * as discoverView from '../views/discover.js';
import * as bottleView from '../views/bottle.js';
import * as settingsView from '../views/settings.js';
import '../views/sections.js';

const REFRESH_AFTER = 20 * 60 * 1000;
const $ = sel => document.querySelector(sel);

// ---------- The views ----------

const VIEWS = [wearView, wardrobeView, discoverView, bottleView, settingsView];
// The nav's destinations, in order, and every page a route can name.
const DESTINATIONS = [wearView.wear, wardrobeView.wardrobe, discoverView.discover];
const PAGES = Object.fromEntries([...DESTINATIONS, settingsView.settings].map(p => [p.id, p]));
const PANES = Object.fromEntries(DESTINATIONS.map(d => [d.id, (d.panes ?? []).map(p => p.id)]));

// One map per kind of handler, from every view; a name used twice throws.
function merged(kind) {
  const out = {};
  for (const view of VIEWS) {
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
  ...merged('actions'),
};
const FORMS = merged('forms');
const FIELDS = merged('fields');
const CHANGES = merged('changes');
registerSheets(merged('sheets'));

// What every action, form and field handler gets as `app`.
const app = {
  render, renderPage, renderBottle,
  navigate, openBottle, closeBottle,
  openSheet, updateSheet, closeSheet, renderSheet,
  showToast, hideToast, keepingFocus, refocus,
  refreshWeather, setLocation, setActive, addToMine, closeShared,
};

// From 1100px the bottle page docks beside the page as an inspector; under
// it, it's a dialog (a sheet on phones, a drawer on tablets).
const WIDE = matchMedia('(min-width: 1100px)');
const docked = () => WIDE.matches;

// ---------- Collections that touch the URL ----------

function closeShared() {
  state.shared = null;
  const url = new URL(location.href);
  url.searchParams.delete('c');
  url.searchParams.delete('n');
  replacePageURL(url.href);
}

function setActive(active) {
  chooseList(active);
  if (state.shared) closeShared();
}

function addToMine(record) {
  addRecord(record);
  if (state.shared) closeShared();
}

// ---------- Rendering ----------

// Everything on screen, again (data, weather, units or theme changed). The
// focused control, replaced, hands focus to its successor.
function render() {
  const focused = document.activeElement;
  computeToday();
  renderTint();
  renderNav();
  renderPage();
  renderBottle();
  if (state.sheet) renderSheet({ keepScroll: true });
  if (focused && focused !== document.body && !focused.isConnected) refocus(focused);
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
    return `<li><a class="nav-item" href="${esc(href)}"${here === d.id ? ' aria-current="page"' : ''}>${icon[d.icon]}<span>${esc(d.label)}</span></a></li>`;
  }).join('');
  $('#nav').innerHTML = `
    <a class="wordmark" href="#/wear/now" aria-label="Scentcast, what to wear now">Scentcast</a>
    <ul class="nav-items">${items}</ul>
    <div class="nav-foot">
      <button class="nav-loc" data-action="location" aria-label="Change location: ${esc(state.loc?.name ?? 'not set')}">${icon.pin}<span><b>${esc(state.loc?.name ?? 'Set location')}</b>${now ? `<small>${deg(now.tempF)} · ${esc(now.label)}</small>` : ''}</span></button>
      <a class="nav-item nav-settings" href="#/settings"${here === 'settings' ? ' aria-current="page"' : ''}>${icon.gear}<span>Settings</span></a>
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

// Sideways strips marked data-keep-scroll keep their place through a re-render.
function keptScrolls() {
  return new Map([...document.querySelectorAll('#main [data-keep-scroll]')].map(el => [el.dataset.keepScroll, el.scrollLeft]));
}

function renderPage() {
  if (!state.base) return;
  const { r, page, pane } = currentPage();
  renderHero(r, page);
  const main = $('#main');
  const kept = keptScrolls();
  main.innerHTML = `${headHTML(page, pane, r)}<div class="pane" data-pane="${esc(r.dest)}${r.pane ? `/${esc(r.pane)}` : ''}">${pane.render(app, r)}</div>`;
  for (const el of main.querySelectorAll('[data-keep-scroll]')) el.scrollLeft = kept.get(el.dataset.keepScroll) ?? 0;
  main.classList.toggle('updating', state.updating);
  main.setAttribute('aria-busy', String(state.updating));
  pane.after?.(app, r);
  document.body.dataset.route = r.dest;
  const title = pane.title?.(r) ?? page.label;
  document.title = state.route?.dest === 'bottle' ? document.title : `${title} · Scentcast`;
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

const missing = new Set(); // ids no source has
const loadingBottles = new Set();
const askedAbout = new Set();

// The page's data, loading the record (dataset bottles opened from a link or
// a search) and its about data (for wave 4's sections) when they're not here.
// undefined while loading, null when there's no such bottle.
function bottleModelFor(r) {
  const id = r.arg;
  const model = bottleView.bottleModel(r);
  if (model) {
    if (/^\d+$/.test(id) && !askedAbout.has(id)) {
      askedAbout.add(id);
      loadAbout(id).catch(() => null).then(about => {
        state.about.set(id, about);
        if (state.route?.dest === 'bottle' && state.route.arg === id) renderBottle();
      });
    }
    return model;
  }
  if (missing.has(id)) return null;
  if (!/^\d+$/.test(id) && !isCustomId(id)) return null;
  if (isCustomId(id)) {
    const f = fromShareToken(id);
    if (!f) return null;
    state.bottles.set(id, f);
    return bottleView.bottleModel(r);
  }
  if (!loadingBottles.has(id)) {
    loadingBottles.add(id);
    library.records([id]).then(found => {
      if (found.get(id)) state.bottles.set(id, found.get(id));
      else missing.add(id);
    }).catch(() => missing.add(id)).finally(() => {
      loadingBottles.delete(id);
      if (state.route?.dest === 'bottle' && state.route.arg === id) renderBottle();
    });
  }
  return undefined;
}

function setModal(on) {
  $('#page').inert = on;
  $('#nav').inert = on;
  document.body.classList.toggle('sheet-open', on || Boolean(state.sheet));
}

// `fresh`: a newly opened bottle (its bars grow in); `instant`: no slide, a
// view transition animates it.
function renderBottle({ fresh = false, instant = false } = {}) {
  const el = $('#bottle');
  const r = state.route;
  const modal = !docked();
  if (r?.dest !== 'bottle') {
    if (el.hidden) return;
    el.classList.remove('open');
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
  const focused = sameBottle && el.contains(document.activeElement) ? document.activeElement : null;
  const model = bottleModelFor(r);
  el.innerHTML = bottleView.bottlePageHTML(model, { modal });
  if (focused) refocus(focused, '#bottle');
  el.dataset.id = r.arg;
  const next = el.querySelector('.bp-panel');
  if (fresh && !sameBottle) next.classList.add('fresh');
  next.scrollTop = scroll;
  el.classList.toggle('modal', modal);
  $('#app').classList.toggle('has-bottle', !modal);
  setModal(modal);
  if (model) document.title = `${model.f.name} · Scentcast`;
  if (el.hidden) {
    el.hidden = false;
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

const scrolls = new Map(); // dest/pane -> scrollY
const scrollKey = r => `${r.dest}/${r.pane ?? ''}`;
let pushedBottle = false; // the bottle page's entry was pushed by the app

function navigate(hash, { replace = false, quiet = false, instant = false } = {}) {
  const next = parseRoute(hash, PANES);
  if (sameRoute(next, state.route)) {
    // The current tab again goes back to its top.
    if (!quiet) scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
    return;
  }
  go(routeHash(next), { replace });
  if (next.dest === 'bottle' && state.route?.dest !== 'bottle') pushedBottle = !replace;
  transition(next, { quiet, instant });
}

// Moves to a route: the page under a bottle page changes only when the route
// isn't one. Closing a bottle page by Back flies the bottle home.
// A route a view transition is on its way to (Back fires popstate and then
// hashchange; the second must not start the flight again).
let arriving = null;

function transition(next, { quiet = false, instant = false } = {}) {
  const prev = state.route;
  if (sameRoute(arriving ?? prev, next)) return;
  if (prev?.dest === 'bottle' && next.dest !== 'bottle' && sameRoute(state.base, next) && canMorph()) {
    const from = $('#bottle .bp-bottle img');
    const id = prev.arg;
    const home = () => [...document.querySelectorAll(`#page [data-action="open"][data-id="${CSS.escape(id)}"] img`)].find(visible);
    if (visible(from) && home()) {
      arriving = next;
      return morph(from, () => { arriving = null; applyRoute(next, { quiet, instant: true }); }, home);
    }
  }
  applyRoute(next, { quiet, instant });
}

function applyRoute(next, { quiet = false, instant = false } = {}) {
  const prev = state.route;
  state.route = next;
  if (next.dest === 'bottle') {
    if (!state.base) setBase(parseRoute(HOME, PANES), { quiet: true });
    if (prev?.dest !== 'bottle') bottleOpener = document.activeElement;
    renderBottle({ fresh: true, instant });
    if (!quiet) $('#bottle .bp-close')?.focus({ preventScroll: true });
    return;
  }
  pushedBottle = false;
  const changed = !sameRoute(state.base, next);
  if (changed) setBase(next, { quiet: quiet || prev?.dest === 'bottle' });
  renderBottle({ instant });
  if (prev?.dest === 'bottle' && !changed && !refocus(bottleOpener)) $('#page-title')?.focus({ preventScroll: true });
  if (prev?.dest === 'bottle') bottleOpener = null;
}

function setBase(next, { quiet = false } = {}) {
  const prev = state.base;
  if (prev) scrolls.set(scrollKey(prev), scrollY);
  state.base = next;
  lastRoute[next.dest] = next;
  const newPane = !prev || scrollKey(prev) !== scrollKey(next);
  renderNav();
  renderPage();
  if (newPane && prev) {
    scrollTo(0, scrolls.get(scrollKey(next)) ?? 0);
    if (!reducedMotion()) {
      const main = $('#main');
      main.classList.remove('enter');
      void main.offsetWidth; // restart the animation
      main.classList.add('enter');
    }
  }
  if (!quiet && prev) $('#page-title')?.focus({ preventScroll: true });
}

// Back, forward, or a typed URL.
function sync() {
  const next = parseRoute(location.hash, PANES);
  const canonical = routeHash(next);
  if (location.hash !== canonical) go(canonical, { replace: true });
  if (next.dest === 'bottle' && state.route?.dest !== 'bottle') pushedBottle = false;
  transition(next);
}

window.addEventListener('popstate', () => {
  if (sheetPopped()) return;
  sync();
});
window.addEventListener('hashchange', () => sync());

// ---------- Weather ----------

// Opens on the saved forecast when there is one: fresh, it's all we need;
// older, it shows under "Updating…", photos faded, until the new one arrives,
// so the morning check doesn't wait on the network.
async function refreshWeather({ force = false } = {}) {
  if (!state.loc) return;
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
  render();
  try {
    state.forecast = await getForecast(state.loc, { force });
    state.wx = summarize(state.forecast);
  } catch (err) {
    if (state.wx) state.wx = { ...state.wx, stale: true };
    else state.error = forecastError(err);
  } finally {
    state.loading = false;
    state.updating = false;
  }
  render();
}

async function setLocation(loc) {
  state.loc = loc;
  state.wx = null;
  state.slot = null;
  saveLocation(loc);
  closeSheet();
  await refreshWeather();
}

// ---------- Shared links ----------

async function openSharedLink(link) {
  state.shared = { ...link, records: [], missing: [], loading: true, confirmReplace: false };
  // Bottles entered by hand travel whole inside the link.
  const known = new Map(knownBottles().map(f => [f.id, f]));
  const local = link.ids.map(id => known.get(id) ?? (isCustomId(id) ? fromShareToken(id) : null));
  const remote = new Map();
  const unknown = link.ids.filter((id, i) => !local[i]);
  const legacy = unknown.filter(isFragellaId); // Fragella bottles from older links, via the Worker
  await Promise.all([
    library.records(unknown).then(found => found.forEach((r, id) => remote.set(id, r))).catch(() => {}),
    legacy.length && apiReady()
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
    const link = e.target.closest('a[href^="#/"]');
    if (link) {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      navigate(link.getAttribute('href'));
      return;
    }
    const t = e.target.closest('[data-action]');
    if (!t || t.disabled) return;
    const fn = ACTIONS[t.dataset.action];
    if (!fn) throw new Error(`No action called "${t.dataset.action}"`);
    await fn(t, app, e);
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
      else if (state.route?.dest === 'bottle') closeBottle();
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
    if (!panel || innerWidth >= 720 || panel.scrollTop > 0 || e.target.closest('input, textarea, .alts, .calendar, .shelf')) return;
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

  // The scene's loops (stars, rain, chimney smoke) pause while the hero is
  // scrolled out of sight.
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => $('#hero').classList.toggle('offscreen', !e.isIntersecting)).observe($('#hero'));
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !state.loc) return;
    if (!state.wx || Date.now() - state.wx.fetchedAt > REFRESH_AFTER) refreshWeather();
    else { state.wx = summarize(state.forecast); render(); }
  });

  watchToast();
}

// ---------- Boot ----------

// ?loc=lat,lon,Name pins a location, e.g. for a home-screen shortcut per city.
function locationFromURL(params) {
  const raw = params.get('loc');
  if (!raw) return null;
  const [lat, lon, ...name] = raw.split(',');
  if (!Number.isFinite(+lat) || !Number.isFinite(+lon)) return null;
  return { name: name.join(',').trim() || 'Pinned location', lat: +lat, lon: +lon };
}

export async function boot() {
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
    const url = new URL(location.href);
    url.searchParams.delete('view');
    if (!location.hash) url.hash = legacy;
    history.replaceState(null, '', url);
  }
  listen();
  const first = parseRoute(location.hash || HOME, PANES);
  go(routeHash(first), { replace: true });
  renderTint();
  applyRoute(first, { quiet: true });
  try {
    const [demo, catalog] = await Promise.all([
      fetch('data/collection.json').then(r => r.json()),
      fetch('data/catalog.json').then(r => r.json()).catch(() => ({ fragrances: [] })),
    ]);
    for (const f of [...demo.fragrances, ...catalog.fragrances]) f.id = String(f.id);
    state.demo = demo;
    state.catalog = catalog.fragrances;
  } catch {
    $('#main').innerHTML = messageHTML({ glyph: icon.bottle, title: 'Collection missing', body: 'Couldn’t load data/collection.json.' });
    return;
  }
  const link = parseShare(params);
  if (link) openSharedLink(link);
  if (state.loc) await refreshWeather();
  else { render(); openSheet({ kind: 'location' }); }

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}
