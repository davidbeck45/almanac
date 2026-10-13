import { rank, planWindows, comfortRange } from './engine.js';
import { occasionById } from './occasions.js';
import { getForecast, summarize, week } from './weather.js';
import { loadLocation, saveLocation, loadRecent, deviceLocation, searchCities } from './location.js';
import { loadHistory, toggleWear, wornIn, clearHistory, journalStats, journalCalendar, journalExport, shiftISO } from './history.js';
import { loadHidden, setHidden, hiddenFor } from './hidden.js';
import { loadMine, saveMine, loadActive, saveActive, shareURL, parseShare, localMatches, nameMatches, importLines, MAX_IMPORT_LINES } from './collections.js';
import { apiReady, fetchFragrances } from './api.js';
import { isFragellaId } from './fragella.js';
import { fragranticaLibrary } from './fragrantica.js';
import { customRecord, isCustomId, fromShareToken, MAX_CUSTOM_ACCORDS } from './custom.js';
import { layerPicks } from './layering.js';
import { sceneTint } from './scene.js';
import * as ui from './ui.js';
import { setTheme, theme } from './theme.js';

const PREFS_KEY = 'scentcast.prefs';
const REFRESH_AFTER = 20 * 60 * 1000;
const VIEWS = ['today', 'week', 'occasion'];
const DUSTY_AFTER_DAYS = 30;
// Countries that read temperatures in °F.
const FAHRENHEIT_REGIONS = ['US', 'LR', 'MM', 'BS', 'BZ', 'KY', 'PW', 'FM', 'MH'];

const $ = sel => document.querySelector(sel);
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY)) ?? {}; } catch { return {}; }
}
function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ view: state.view, occasion: state.occasion, units: state.units, theme: theme() })); } catch {}
}

function defaultUnits() {
  const [lang, region] = (navigator.language || 'en-US').split('-');
  if (!region) return lang === 'en' ? 'F' : 'C';
  return FAHRENHEIT_REGIONS.includes(region.toUpperCase()) ? 'F' : 'C';
}

const prefs = loadPrefs();
const state = {
  demo: null, // { fetched, fragrances } from data/collection.json
  catalog: [], // data/catalog.json: other people's bottles, scraped with Parfumo's ratings
  mine: loadMine(), // { name, records }
  active: loadActive(), // 'demo' | 'mine'
  shared: null, // { name, ids, records, missing, loading, confirmReplace } from a ?c= link
  loc: loadLocation(),
  forecast: null,
  wx: null,
  loading: false,
  error: null,
  view: VIEWS.includes(prefs.view) ? prefs.view : 'today',
  renderedView: null,
  units: prefs.units === 'C' || prefs.units === 'F' ? prefs.units : defaultUnits(),
  occasion: prefs.occasion ?? 'casual',
  occasionSlot: null,
  history: loadHistory(),
  hiding: loadHidden(), // { hidden, shown }: this device's hides and the defaults it switched on (src/hidden.js)
  contexts: {}, // ctx key -> { win, occasion, ranked, entries: Map(id -> ranked entry) }
  today: null, // { day: plan, night: plan } where plan = { win, ranked, pick }
  expanded: new Set(), // ctx keys showing B and C tiers
  sheet: null, // { kind: 'detail' | 'location' | 'collection' | 'add' | 'import' | 'custom' | 'journal', ...sheet state }
  lastRemoved: null, // { record, index } for undo
};
ui.setUnits(state.units);
setTheme(prefs.theme);

// ---------- Collections ----------

function sourceRecords() {
  if (state.shared) return state.shared.records;
  if (state.active === 'mine') return state.mine.records;
  return state.demo?.fragrances ?? [];
}

// The hidden set as it applies to the demo, or to someone's own or shared
// list, where DEFAULT_HIDDEN doesn't reach (src/hidden.js).
const hiddenIn = isDemo => hiddenFor(state.hiding, isDemo);
const viewingDemo = () => !state.shared && state.active === 'demo';
// Manage lists the demo unless "Mine" is open.
const manageShowsDemo = () => Boolean(state.shared) || state.active !== 'mine';

function activeFragrances() {
  const hidden = hiddenIn(viewingDemo());
  return sourceRecords().filter(f => !hidden.has(f.id));
}

function collectionLabel() {
  if (state.shared) return state.shared.name ? `${state.shared.name}’s collection` : 'Shared collection';
  return state.active === 'mine' ? 'My collection' : 'Demo collection';
}

// Bottles we scraped ourselves, searched before the rest of Fragrantica.
function knownBottles() {
  return [...(state.demo?.fragrances ?? []), ...state.catalog];
}

function findRecord(id) {
  return [...sourceRecords(), ...state.mine.records, ...knownBottles()].find(f => f.id === id);
}

function setActive(active) {
  state.active = active;
  saveActive(active);
  if (state.shared) closeShared();
}

function addToMine(record) {
  if (!state.mine.records.some(r => r.id === record.id)) {
    state.mine.records = [...state.mine.records, record];
    saveMine(state.mine);
  }
  if (state.hiding.hidden.has(record.id)) setHidden(state.hiding, record.id, false, false);
  if (state.active !== 'mine' || state.shared) setActive('mine');
}

function closeShared() {
  state.shared = null;
  const url = new URL(location.href);
  url.searchParams.delete('c');
  url.searchParams.delete('n');
  history.replaceState(null, '', url);
}

// ---------- Rendering ----------

const SLOT_ORDER = { day: 0, night: 1 };
const byTime = (a, b) => a.dateISO.localeCompare(b.dateISO) || SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot];

function heroAspect() {
  const el = $('#hero');
  return el.clientHeight ? el.clientWidth / el.clientHeight : 400 / 220;
}

// Today's two windows in time order (tonight comes before tomorrow's daytime).
function todaySlots() {
  return state.today ? Object.values(state.today).sort((a, b) => byTime(a.win, b.win)) : [];
}

function heroPicks() {
  if (!state.today) return null;
  return todaySlots().map(({ win, pick }) => ({
    slot: win.slot,
    label: win.label,
    entry: pick,
    worn: wornIn(state.history, win.dateISO, win.slot)?.id === pick.fragrance.id,
  }));
}

function renderHero() {
  state.heroAspect = heroAspect();
  $('#hero').innerHTML = ui.heroHTML(state, state.heroAspect, heroPicks(), collectionLabel());
  const now = state.wx?.now;
  const [top, mid] = sceneTint(now?.phase ?? 'night', now?.category ?? 'clear', theme());
  document.documentElement.style.setProperty('--tint-top', top);
  document.documentElement.style.setProperty('--tint-mid', mid);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', top);
}

function storeContext(key, win, occasion, ranked) {
  state.contexts[key] = { win, occasion, ranked, entries: new Map(ranked.map(r => [r.fragrance.id, r])) };
}

function rankContext(key, win, occasion) {
  const ranked = rank(activeFragrances(), win, win.slot, {
    occasion,
    history: state.history,
    todayISO: win.dateISO,
  });
  storeContext(key, win, occasion, ranked);
  return ranked;
}

// Today's day and night are planned together, so the evening pick doesn't
// repeat the daytime one and a logged wear becomes that window's pick.
function computeToday() {
  if (!state.wx || !activeFragrances().length) {
    state.today = null;
    return;
  }
  const plan = planWindows(activeFragrances(), [state.wx.day, state.wx.night].sort(byTime), { history: state.history });
  state.today = {};
  for (const p of plan) {
    storeContext(p.win.slot, p.win, null, p.ranked);
    state.today[p.win.slot] = p;
  }
}

function computeWeek() {
  const days = week(state.forecast);
  const windows = days.flatMap(d => [d.day, d.night].filter(Boolean));
  const plan = planWindows(activeFragrances(), windows, { history: state.history });
  const byWindow = new Map(plan.map(p => [`${p.win.dateISO}:${p.win.slot}`, p]));
  const slotPlan = win => {
    if (!win) return null;
    const p = byWindow.get(`${win.dateISO}:${win.slot}`);
    const ctx = `w:${win.dateISO}:${win.slot}`;
    storeContext(ctx, win, null, p.ranked);
    return { ...p, ctx, worn: wornIn(state.history, win.dateISO, win.slot)?.id === p.pick.fragrance.id };
  };
  return days.map(d => ({ ...d, day: slotPlan(d.day), night: slotPlan(d.night) }));
}

// Wear logging is for the windows on the Today tab, not days further out.
function canWear(win) {
  return Boolean(state.wx) && [state.wx.day, state.wx.night].some(w => w.dateISO === win.dateISO && w.slot === win.slot);
}

function slotSection(key, { win, ranked, pick }, kicker) {
  const worn = wornIn(state.history, win.dateISO, win.slot)?.id ?? null;
  return `
    <section class="slot" id="slot-${key}" data-slot="${win.slot}">
      ${ui.slotHeaderHTML(win, nowHour())}
      ${ui.pickHTML(pick, key, worn, kicker, { canWear: canWear(win) })}
      ${ui.tierListHTML(ranked, key, worn, state.expanded.has(key))}
    </section>`;
}

function nowHour() {
  const offset = state.forecast?.utc_offset_seconds ?? 0;
  return new Date(Date.now() + offset * 1000).getUTCHours();
}

function emptyState() {
  if (state.shared) {
    return state.shared.loading
      ? ui.skeletonHTML(2)
      : ui.messageHTML({ glyph: ui.icon.share, title: 'Nothing to show', body: 'None of the bottles in this link could be loaded.',
        action: `<button class="primary-btn" data-action="shared-close"><span>Back to my picks</span></button>` });
  }
  if (!sourceRecords().length) {
    return ui.messageHTML({ glyph: ui.icon.bottle, title: 'Your collection is empty', body: 'Add the bottles you own and picks start right away.',
      action: `<div class="message-actions">
        <button class="primary-btn" data-action="add">${ui.icon.plus}<span>Add bottles</span></button>
        <button class="ghost-btn" data-action="import">${ui.icon.paste}Paste a list</button>
        <button class="link-btn" data-collection-tab="demo">Use the demo collection</button>
      </div>` });
  }
  return ui.messageHTML({ glyph: ui.icon.hide, title: 'Every bottle is hidden', body: 'Turn some back on to get picks.',
    action: `<button class="primary-btn" data-action="collection"><span>Manage collection</span></button>` });
}

function journalTeaser() {
  if (!state.history.length || !state.wx) return '';
  const todayISO = state.wx.todayISO;
  const strip = Array.from({ length: 7 }, (_, i) => {
    const dateISO = shiftISO(todayISO, i - 6);
    const isToday = dateISO === todayISO;
    return {
      dateISO,
      isToday,
      label: isToday ? 'Today' : ui.shortDate(dateISO).split(' ')[1],
      day: wornIn(state.history, dateISO, 'day'),
      night: wornIn(state.history, dateISO, 'night'),
    };
  });
  return ui.journalTeaserHTML({ strip, stats: journalStats(state.history, todayISO) }, findRecord);
}

function renderView() {
  const tabs = document.querySelectorAll('[data-view]');
  tabs.forEach(b => {
    const on = b.dataset.view === state.view;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  $('.tabs').style.setProperty('--i', VIEWS.indexOf(state.view));
  const view = $('#view');
  view.setAttribute('aria-labelledby', `tab-${state.view}`);
  const banner = state.shared ? ui.sharedBannerHTML(state.shared, state.mine.records.length) : '';

  if (state.renderedView !== state.view) {
    state.renderedView = state.view;
    if (!reducedMotion()) {
      view.classList.remove('enter');
      void view.offsetWidth; // restart the animation
      view.classList.add('enter');
    }
  }

  if (!state.loc) {
    view.innerHTML = ui.messageHTML({ glyph: ui.icon.pin, title: 'Set your location', body: 'Picks are based on your local forecast.',
      action: `<button class="primary-btn" data-action="location">${ui.icon.pin}<span>Choose location</span></button>` });
    return;
  }
  if (!state.wx) {
    view.innerHTML = state.error
      ? ui.messageHTML({ glyph: ui.icon.cloud, title: 'Couldn’t load the weather', body: state.error,
        action: `<button class="primary-btn" data-action="refresh">${ui.icon.refresh}<span>Try again</span></button>` })
      : ui.skeletonHTML(state.view === 'today' ? 2 : 1);
    return;
  }
  if (!activeFragrances().length) {
    view.innerHTML = banner + emptyState();
    return;
  }

  if (state.view === 'today') {
    view.innerHTML = `${banner}<div class="slots">
      ${todaySlots().map(p => slotSection(p.win.slot, p, `Top pick · ${p.win.label.toLowerCase()}`)).join('')}
    </div>${journalTeaser()}`;
  } else if (state.view === 'week') {
    view.innerHTML = banner + ui.weekHTML(computeWeek());
  } else {
    const occasion = occasionById(state.occasion) ?? occasionById('casual');
    const slot = state.occasionSlot ?? occasion.slot;
    const win = state.wx[slot];
    const ranked = rankContext('occ', win, occasion);
    view.innerHTML = `${banner}
      ${ui.occasionPickerHTML(occasion.id)}
      <div class="occ-bar">${ui.slotToggleHTML(slot, state.wx)}</div>
      <div class="slots single">${slotSection('occ', { win, ranked, pick: ranked[0] }, `Best for ${occasion.label.toLowerCase()}`)}</div>`;
  }
}

function renderFooter() {
  if (!state.demo) return;
  const all = sourceRecords();
  const usesFragella = all.some(f => isFragellaId(f.id));
  const usesScraped = all.some(f => !f.source);
  // Always: even the demo's own records carry values derived from the dataset.
  const sources = [
    usesScraped && `Fragrantica (synced ${ui.esc(state.demo.fetched)})`,
    `Fragrantica via <a href="https://www.kaggle.com/datasets/ledecanteur/fragrantica-perfumes" target="_blank" rel="noopener">Le Decanteur’s dataset</a> (<a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noopener">CC BY-NC-SA</a>)`,
    usesFragella && '<a href="https://api.fragella.com" target="_blank" rel="noopener">Fragella</a>',
  ].filter(Boolean).join(' · ');
  $('#foot').innerHTML = ui.footerHTML({
    on: activeFragrances().length,
    total: all.length,
    sources,
    updated: state.wx ? new Date(state.wx.fetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '',
    stale: state.wx?.stale,
    units: state.units,
    hasHistory: state.history.length > 0,
  });
}

function renderPicks() {
  computeToday();
  renderHero();
  renderView();
  renderFooter();
}

function render() {
  renderPicks();
  if (state.sheet) renderSheet({ keepScroll: true });
}

// ---------- Sheets ----------

function wearInfo(id) {
  if (!state.wx) return null;
  const stats = journalStats(state.history.filter(h => h.id === id), state.wx.todayISO);
  return { count: stats.wears, last: stats.lastWorn.get(id) ?? null };
}

function journalData() {
  const todayISO = state.wx?.todayISO ?? new Date().toISOString().slice(0, 10);
  const stats = journalStats(state.history, todayISO, DUSTY_AFTER_DAYS);
  const dusty = activeFragrances()
    .map(f => ({ f, last: stats.lastWorn.get(f.id) ?? null }))
    .filter(d => !d.last || d.last < stats.since)
    .sort((a, b) => (a.last ?? '').localeCompare(b.last ?? ''))
    .slice(0, 6);
  return { stats, dusty, todayISO, calendar: journalCalendar(state.history, todayISO, 5), confirmClear: !!state.sheet?.confirmClear };
}

function applyCollectionFilter() {
  const q = (state.sheet?.filter ?? '').trim().toLowerCase();
  const rows = document.querySelectorAll('#sheet .manage-list li[data-name]');
  let shown = 0;
  rows.forEach(li => {
    const hit = !q || li.dataset.name.includes(q);
    li.hidden = !hit;
    if (hit) shown++;
  });
  const empty = $('#sheet .filter-empty');
  if (empty) empty.hidden = shown > 0 || !rows.length;
}

function renderSheet({ keepScroll = false } = {}) {
  const el = $('#sheet');
  const s = state.sheet;
  const scroll = keepScroll ? el.querySelector('.sheet-panel')?.scrollTop : 0;
  if (s.kind === 'detail') {
    const ctx = state.contexts[s.ctx];
    const entry = ctx?.entries.get(s.id);
    if (!entry) return closeSheet();
    const label = ctx.occasion ? `${ctx.occasion.label} · ${ctx.win.label.toLowerCase()}` : ctx.win.label;
    const worn = wornIn(state.history, ctx.win.dateISO, ctx.win.slot)?.id ?? null;
    el.innerHTML = ui.sheetHTML(entry, label, s.ctx, worn, {
      canWear: canWear(ctx.win),
      wears: wearInfo(s.id),
      todayISO: state.wx?.todayISO,
      alts: ctx.ranked.filter(r => r.fragrance.id !== s.id).slice(0, 4),
      partners: activeFragrances().length > 1 ? layerPicks(entry.fragrance, activeFragrances(), 3, ctx.win) : null,
      comfort: comfortRange(entry.fragrance),
    });
  } else if (s.kind === 'collection') {
    el.innerHTML = ui.collectionSheetHTML({
      tab: state.shared ? null : state.active,
      demo: state.demo?.fragrances ?? [],
      mine: state.mine,
      hidden: hiddenIn(manageShowsDemo()),
      shared: state.shared,
      filter: s.filter,
    });
    applyCollectionFilter();
  } else if (s.kind === 'add') {
    el.innerHTML = ui.addSheetHTML(s, new Set(state.mine.records.map(r => r.id)));
  } else if (s.kind === 'import') {
    el.innerHTML = ui.importSheetHTML(s, MAX_IMPORT_LINES);
  } else if (s.kind === 'custom') {
    el.innerHTML = ui.customSheetHTML(s, MAX_CUSTOM_ACCORDS);
  } else if (s.kind === 'journal') {
    el.innerHTML = ui.journalSheetHTML(journalData(), findRecord);
  } else {
    el.innerHTML = ui.locationSheetHTML(s, loadRecent());
  }
  if (keepScroll) el.querySelector('.sheet-panel').scrollTop = scroll;
}

let sheetOpener = null;

// Put focus back where the sheet was opened from. Views re-render while a
// sheet is open, so fall back to the element with the same data attributes.
function refocus(el) {
  if (!el || el === document.body) return;
  if (el.isConnected) return el.focus({ preventScroll: true });
  const attrs = Object.entries(el.dataset ?? {})
    .map(([k, v]) => `[data-${k.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}="${CSS.escape(v)}"]`).join('');
  if (attrs) document.querySelector(`#app ${el.tagName.toLowerCase()}${attrs}`)?.focus({ preventScroll: true });
}

// `instant` skips the slide, for when a view transition animates the change.
function openSheet(sheet, { instant = false } = {}) {
  const wasOpen = !!state.sheet;
  const sameKind = state.sheet?.kind === sheet.kind;
  const sameBottle = sameKind && sheet.kind === 'detail' && state.sheet.id === sheet.id;
  if (!wasOpen) sheetOpener = document.activeElement;
  state.sheet = sheet;
  renderSheet({ keepScroll: sameKind && (sheet.kind !== 'detail' || sameBottle) });
  const el = $('#sheet');
  el.hidden = false;
  document.body.classList.add('sheet-open');
  $('#app').inert = true;
  if (!wasOpen) {
    if (instant) el.classList.add('open');
    else requestAnimationFrame(() => el.classList.add('open'));
  }
  if (!sameKind || (sheet.kind === 'detail' && !sameBottle)) {
    // Don't pop the keyboard on phones just for opening a sheet.
    const typing = ['add', 'import', 'custom', 'location'].includes(sheet.kind) && matchMedia('(hover: hover)').matches;
    el.querySelector(typing ? 'input, textarea' : '.sheet-close')?.focus({ preventScroll: true });
  }
}

function updateSheet(patch) {
  if (!state.sheet) return;
  state.sheet = { ...state.sheet, ...patch };
  renderSheet({ keepScroll: true });
}

function closeSheet({ instant = false } = {}) {
  const el = $('#sheet');
  state.sheet = null;
  el.classList.remove('open');
  document.body.classList.remove('sheet-open');
  $('#app').inert = false;
  refocus(sheetOpener);
  sheetOpener = null;
  const hide = () => { if (!state.sheet) { el.hidden = true; el.innerHTML = ''; } };
  if (instant) hide();
  else setTimeout(hide, 260);
}

// Opening a bottle flies its photo from the card into the sheet, and closing
// flies it back (View Transitions). Without the API, or with reduced motion,
// the sheet just slides.
const BOTTLE_VT = 'sc-bottle';
const canMorph = () => 'startViewTransition' in document && !reducedMotion();
const visible = img => {
  const r = img?.getBoundingClientRect();
  return r && r.width > 0 && r.bottom > 0 && r.top < innerHeight;
};

function morph(from, update, to) {
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
  vt.finished.finally(() => {
    for (const img of document.querySelectorAll('img')) if (img.style.viewTransitionName) img.style.viewTransitionName = '';
  });
}

function openDetail(sheet, trigger) {
  // A pick's name button flies the bottle from the same card.
  const from = trigger?.querySelector('img') ?? trigger?.closest('.pick')?.querySelector('.pick-bottle img');
  if (!canMorph() || !visible(from)) return openSheet(sheet);
  morph(from, () => openSheet(sheet, { instant: true }), () => $('#sheet .sheet-bottle img'));
}

// Closing by hand (the close button, the backdrop, Escape).
function dismissSheet() {
  const id = state.sheet?.kind === 'detail' ? state.sheet.id : null;
  const from = $('#sheet .sheet-bottle img');
  const back = id && [...document.querySelectorAll(`#app [data-open][data-id="${CSS.escape(id)}"] img`)].find(visible);
  if (!canMorph() || !back || !from) return closeSheet();
  morph(from, () => closeSheet({ instant: true }), () => back);
}

let toastTimer;
function showToast(html) {
  const el = $('#toast');
  el.innerHTML = `${ui.icon.check}${html}`;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 5000);
}
function hideToast() {
  const el = $('#toast');
  el.classList.remove('show');
  setTimeout(() => { if (!el.classList.contains('show')) el.hidden = true; }, 200);
}

// ---------- Finding bottles ----------

// Every Fragrantica perfume (data/fragrantica/), loaded a file at a time.
const library = fragranticaLibrary();
const MAX_RESULTS = 10;

// Matches from the demo and the catalog come first (scraped with Parfumo's
// ratings), then the rest of Fragrantica as light records ({ stub: true });
// `fullRecords` loads the ones that get added.
async function findBottles(query) {
  const local = localMatches(query, knownBottles());
  const ids = new Set(local.map(r => r.id));
  const rest = (await library.search(query, MAX_RESULTS)).filter(r => !ids.has(r.id));
  return [...local, ...rest].slice(0, MAX_RESULTS);
}

async function fullRecords(list) {
  const stubs = list.filter(r => r.stub).map(r => r.id);
  const loaded = stubs.length ? await library.records(stubs) : new Map();
  return list.map(r => (r.stub ? loaded.get(r.id) : r)).filter(Boolean);
}

async function runSearch(query) {
  updateSheet({ query, busy: true, error: '' });
  try {
    updateSheet({ results: await findBottles(query), busy: false });
  } catch (err) {
    const local = localMatches(query, knownBottles());
    updateSheet({ results: local.length ? local : null, busy: false, error: err.message });
  }
}

async function runImport(text) {
  const lines = importLines(text);
  if (!lines.length) return updateSheet({ text, error: 'Paste at least one fragrance name.' });
  const rows = lines.map(l => ({ ...l, status: 'pending', match: null, checked: false, weak: false }));
  updateSheet({ text, rows, busy: true, error: '' });
  let stopped = '';
  for (const row of rows) {
    const local = localMatches(row.line, knownBottles(), 1)[0];
    if (local) Object.assign(row, { match: local, checked: true, status: 'done' });
    else if (stopped) Object.assign(row, { status: 'done', note: stopped });
    else {
      try {
        // Search answers with near misses too ("Caramello" for "Caramellino"),
        // so a hit whose name wasn't typed is offered unticked.
        const hits = await library.search(row.line);
        const hit = hits.find(r => nameMatches(row.line, r));
        Object.assign(row, { match: hit ?? hits[0] ?? null, checked: Boolean(hit), weak: !hit && hits.length > 0, status: 'done' });
      } catch (err) {
        stopped = err.message;
        Object.assign(row, { status: 'done', note: err.message });
      }
    }
    if (state.sheet?.kind !== 'import') return;
    updateSheet({ rows: [...rows] });
  }
  updateSheet({ busy: false });
}

// A bottle entered by hand, opened from Add bottles or from an unmatched row
// of a pasted list (`row`); `back` is the sheet to return to.
function customSheet({ name = '', brand = '', row = null }) {
  return { kind: 'custom', name, brand, accords: [], seasons: [], time: null, error: '', back: state.sheet, row };
}

function saveCustom(name, brand) {
  const s = state.sheet;
  if (!name) return updateSheet({ name, brand, error: 'Give it a name.' });
  if (!s.accords.length) return updateSheet({ name, brand, error: 'Pick at least one accord.' });
  const record = customRecord({ name, brand, accords: s.accords, seasons: s.seasons, time: s.time });
  if (!record) return updateSheet({ name, brand, error: 'Pick at least one accord.' });
  if (s.back?.kind === 'import') {
    // Fills that row of the pasted list, ticked; the list's Add button saves it.
    const rows = s.back.rows.map((r, i) => (i === s.row ? { ...r, match: record, checked: true, weak: false, note: '' } : r));
    return openSheet({ ...s.back, rows });
  }
  addToMine(record);
  renderPicks();
  openSheet(s.back ?? { kind: 'collection' });
  showToast(`<span>${ui.esc(record.name)} added to your collection</span>`);
}

async function share() {
  const records = activeFragrances();
  if (!records.length) return;
  const name = state.shared?.name ?? (state.active === 'mine' ? state.mine.name : 'David');
  const url = shareURL(records, name);
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Scentcast', text: name ? `${name}’s fragrance picks` : 'Fragrance picks', url });
      return;
    }
    await navigator.clipboard.writeText(url);
    showToast('<span>Share link copied</span>');
  } catch (err) {
    if (err?.name !== 'AbortError') showToast(`<span>Copy this link: ${ui.esc(url)}</span>`);
  }
}

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
  renderPicks();
}

// ---------- Weather ----------

async function refreshWeather({ force = false } = {}) {
  if (!state.loc) return;
  state.loading = true;
  state.error = null;
  if (!state.wx) render();
  try {
    if (force) localStorage.removeItem('scentcast.weather');
    state.forecast = await getForecast(state.loc);
    state.wx = summarize(state.forecast);
  } catch (err) {
    state.error = err.message;
  } finally {
    state.loading = false;
  }
  render();
}

async function setLocation(loc) {
  state.loc = loc;
  state.wx = null;
  saveLocation(loc);
  closeSheet();
  await refreshWeather();
}

// ---------- Events ----------

document.addEventListener('click', async e => {
  const t = e.target.closest('button, [data-close], a');
  if (!t) return;
  const d = t.dataset;

  if (d.toggleHidden) {
    const id = d.toggleHidden;
    const isDemo = state.sheet?.kind === 'collection' ? manageShowsDemo() : viewingDemo();
    const hide = !hiddenIn(isDemo).has(id);
    setHidden(state.hiding, id, hide, isDemo);
    renderPicks();
    if (state.sheet?.kind === 'collection') {
      renderSheet({ keepScroll: true });
      $(`#sheet [data-toggle-hidden="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
    } else if (hide) {
      closeSheet();
      showToast(`<span>${ui.esc(findRecord(id)?.name ?? 'Bottle')} hidden from picks</span><button data-action="unhide" data-id="${ui.esc(id)}">Undo</button>`);
    }
  } else if (d.action === 'unhide') {
    setHidden(state.hiding, d.id, false, viewingDemo());
    renderPicks();
    hideToast();
  } else if (d.remove) {
    const index = state.mine.records.findIndex(r => r.id === d.remove);
    if (index < 0) return;
    const [removed] = state.mine.records.splice(index, 1);
    saveMine(state.mine);
    renderPicks();
    renderSheet({ keepScroll: true });
    state.lastRemoved = { record: removed, index };
    showToast(`<span>${ui.esc(removed.name)} removed</span><button data-action="undo-remove">Undo</button>`);
  } else if (d.action === 'undo-remove' && state.lastRemoved) {
    const { record, index } = state.lastRemoved;
    state.mine.records.splice(index, 0, record);
    state.lastRemoved = null;
    saveMine(state.mine);
    render();
    hideToast();
  } else if (d.collectionTab) {
    setActive(d.collectionTab);
    renderPicks();
    if (state.sheet?.kind === 'collection') renderSheet();
  } else if (d.action === 'collection') {
    openSheet({ kind: 'collection' });
  } else if (d.action === 'add') {
    openSheet({ kind: 'add' });
  } else if (d.add !== undefined) {
    const hit = state.sheet?.results?.[+d.add];
    if (!hit) return;
    let record;
    try {
      [record] = await fullRecords([hit]);
    } catch (err) {
      return updateSheet({ error: err.message });
    }
    if (!record) return updateSheet({ error: `Couldn’t load ${hit.name}. Try again.` });
    addToMine(record);
    renderPicks();
    renderSheet({ keepScroll: true });
    showToast(`<span>${ui.esc(record.name)} added to your collection</span>`);
  } else if (d.action === 'import') {
    openSheet({ kind: 'import', text: state.sheet?.kind === 'import' ? state.sheet.text : '' });
  } else if (d.action === 'custom') {
    openSheet(customSheet({ name: state.sheet?.query ?? '' }));
  } else if (d.customRow !== undefined) {
    const row = state.sheet.rows[+d.customRow];
    openSheet(customSheet({ name: row.name, brand: row.brand, row: +d.customRow }));
  } else if (d.accord) {
    const s = state.sheet;
    const accords = s.accords.includes(d.accord) ? s.accords.filter(a => a !== d.accord) : [...s.accords, d.accord].slice(0, MAX_CUSTOM_ACCORDS);
    updateSheet({ accords, error: '' });
    $(`#sheet [data-accord="${CSS.escape(d.accord)}"]`)?.focus({ preventScroll: true });
  } else if (d.season) {
    const s = state.sheet;
    updateSheet({ seasons: s.seasons.includes(d.season) ? s.seasons.filter(x => x !== d.season) : [...s.seasons, d.season] });
    $(`#sheet [data-season="${d.season}"]`)?.focus({ preventScroll: true });
  } else if (d.time) {
    updateSheet({ time: state.sheet.time === d.time ? null : d.time });
    $(`#sheet [data-time="${d.time}"]`)?.focus({ preventScroll: true });
  } else if (d.action === 'custom-back') {
    openSheet(state.sheet.back);
  } else if (d.importToggle !== undefined) {
    const rows = state.sheet.rows.map((r, i) => (i === +d.importToggle ? { ...r, checked: !r.checked } : r));
    updateSheet({ rows });
  } else if (d.action === 'import-confirm') {
    let picked;
    try {
      picked = await fullRecords(state.sheet.rows.filter(r => r.match && r.checked).map(r => r.match));
    } catch (err) {
      return updateSheet({ error: err.message });
    }
    picked.forEach(addToMine);
    renderPicks();
    openSheet({ kind: 'collection' });
    showToast(`<span>Added ${picked.length} bottle${picked.length === 1 ? '' : 's'}</span>`);
  } else if (d.action === 'share') {
    await share();
  } else if (d.action === 'shared-save') {
    const s = state.shared;
    if (!s || s.loading) return;
    if (state.mine.records.length && !s.confirmReplace) {
      s.confirmReplace = true;
      renderView();
      return;
    }
    state.mine = { name: state.mine.name, records: s.records };
    saveMine(state.mine);
    setActive('mine');
    renderPicks();
    showToast('<span>Saved as your collection</span>');
  } else if (d.action === 'shared-close') {
    closeShared();
    renderPicks();
  } else if (d.view) {
    if (state.view === d.view) return;
    state.view = d.view;
    savePrefs();
    renderView();
    if (window.scrollY > $('#hero').offsetHeight) $('.tabs').scrollIntoView({ block: 'start' });
  } else if (d.close !== undefined) {
    dismissSheet();
  } else if (d.wear !== undefined) {
    const ctx = state.contexts[d.ctx];
    state.history = toggleWear(d.id, ctx.win.dateISO, ctx.win.slot, state.loc);
    if (wornIn(state.history, ctx.win.dateISO, ctx.win.slot)) navigator.vibrate?.(12);
    computeToday();
    const picks = $('.hero-picks');
    if (picks) picks.outerHTML = ui.heroPicksHTML(heroPicks());
    renderView();
    renderFooter();
    if (state.sheet) renderSheet({ keepScroll: true });
  } else if (d.themeChoice) {
    setTheme(d.themeChoice);
    savePrefs();
    render();
  } else if (d.units) {
    state.units = d.units;
    ui.setUnits(state.units);
    savePrefs();
    render();
  } else if (d.action === 'journal') {
    openSheet({ kind: 'journal' });
  } else if (d.action === 'journal-export') {
    const data = journalExport(state.history, state.loc, hiddenIn(true));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = `scentcast-journal-${data.exported.slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } else if (d.action === 'journal-clear') {
    if (!state.sheet?.confirmClear) return updateSheet({ confirmClear: true });
    state.history = clearHistory();
    closeSheet();
    renderPicks();
    showToast('<span>Wear history cleared</span>');
  } else if (d.recent !== undefined) {
    const r = loadRecent()[+d.recent];
    if (r) await setLocation(r);
  } else if (d.expand) {
    if (state.expanded.has(d.expand)) state.expanded.delete(d.expand);
    else state.expanded.add(d.expand);
    renderView();
  } else if (d.jump) {
    if (state.view !== 'today') { state.view = 'today'; savePrefs(); renderView(); }
    document.getElementById(`slot-${d.jump}`)?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  } else if (d.open !== undefined) {
    openDetail({ kind: 'detail', ctx: d.ctx, id: d.id }, t);
  } else if (d.occasion) {
    state.occasion = d.occasion;
    state.occasionSlot = null;
    savePrefs();
    renderView();
  } else if (d.occSlot) {
    state.occasionSlot = d.occSlot;
    renderView();
  } else if (d.city !== undefined) {
    const r = state.sheet?.results?.[+d.city];
    if (r) await setLocation({ name: r.name, region: r.region, lat: r.lat, lon: r.lon });
  } else if (d.action === 'location') {
    openSheet({ kind: 'location' });
  } else if (d.action === 'refresh') {
    await refreshWeather({ force: true });
  } else if (d.action === 'geo') {
    updateSheet({ locating: true, error: '' });
    try {
      await setLocation(await deviceLocation());
    } catch (err) {
      updateSheet({ locating: false, error: err.message });
    }
  }
});

// City search runs as you type. Only the results list re-renders, so the
// input keeps focus; a newer query makes older responses stale.
let citySeq = 0;
let cityTimer;
async function runCitySearch(query) {
  const seq = ++citySeq;
  const sheet = state.sheet;
  if (sheet?.kind !== 'location') return;
  sheet.query = query;
  sheet.error = '';
  if (query.length < 2) {
    sheet.results = null;
    sheet.busy = false;
  } else {
    sheet.busy = true;
    try {
      const results = await searchCities(query);
      if (seq !== citySeq || state.sheet !== sheet) return;
      sheet.results = results;
    } catch (err) {
      if (seq !== citySeq || state.sheet !== sheet) return;
      sheet.error = err.message;
    }
    sheet.busy = false;
  }
  const slot = $('#sheet .city-slot');
  if (slot) slot.innerHTML = sheet.error ? `<p class="error">${ui.esc(sheet.error)}</p>` : ui.cityResultsHTML(sheet, loadRecent());
}

document.addEventListener('input', e => {
  const field = e.target.dataset.field;
  if (field === 'city') {
    clearTimeout(cityTimer);
    const query = e.target.value.trim();
    cityTimer = setTimeout(() => runCitySearch(query), query.length < 2 ? 0 : 280);
  } else if (field === 'collection-filter' && state.sheet?.kind === 'collection') {
    state.sheet.filter = e.target.value;
    applyCollectionFilter();
  } else if ((field === 'custom-name' || field === 'custom-brand') && state.sheet?.kind === 'custom') {
    // Kept in state so a re-render (tapping an accord) doesn't wipe the typing.
    state.sheet[field === 'custom-name' ? 'name' : 'brand'] = e.target.value;
  }
});

document.addEventListener('submit', async e => {
  const form = e.target.dataset.form;
  if (!form) return;
  e.preventDefault();
  const data = new FormData(e.target);
  if (form === 'city') {
    clearTimeout(cityTimer);
    const query = data.get('q').trim();
    if (query) await runCitySearch(query);
    $('#sheet [data-city="0"]')?.focus();
  } else if (form === 'search') {
    const query = data.get('q').trim();
    if (query.length < 3) return updateSheet({ query, error: 'Type at least 3 letters.' });
    await runSearch(query);
  } else if (form === 'import') {
    await runImport(String(data.get('text') ?? ''));
  } else if (form === 'custom') {
    saveCustom(String(data.get('name') ?? '').trim(), String(data.get('brand') ?? '').trim());
  }
});

document.addEventListener('change', e => {
  if (e.target.dataset.field === 'mine-name') {
    state.mine.name = e.target.value.trim().slice(0, 40);
    saveMine(state.mine);
  }
});

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (Math.abs(heroAspect() - state.heroAspect) / state.heroAspect > 0.05) renderHero();
  }, 150);
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && state.sheet) dismissSheet();
  // Arrow keys move between tabs (roving tabindex).
  if (e.target.getAttribute?.('role') === 'tab' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    const i = VIEWS.indexOf(e.target.dataset.view);
    const next = VIEWS[(i + (e.key === 'ArrowRight' ? 1 : VIEWS.length - 1)) % VIEWS.length];
    const btn = $(`.tabs [data-view="${next}"]`);
    btn.click();
    btn.focus();
  }
});

// Drag a sheet down to dismiss it (phones). Only starts when the sheet is
// scrolled to the top, so it never fights with scrolling the content.
let drag = null;
document.addEventListener('touchstart', e => {
  const panel = e.target.closest?.('.sheet-panel');
  if (!panel || innerWidth >= 720 || panel.scrollTop > 0 || e.target.closest('input, textarea, .alts, .calendar')) return;
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
  if (dy > 120 || flick) closeSheet();
  panel.style.transform = '';
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !state.loc) return;
  if (!state.wx || Date.now() - state.wx.fetchedAt > REFRESH_AFTER) refreshWeather();
  else { state.wx = summarize(state.forecast); render(); }
});

// ---------- Boot ----------

// ?loc=lat,lon,Name pins a location, e.g. for a home-screen shortcut per city.
function locationFromURL(params) {
  const raw = params.get('loc');
  if (!raw) return null;
  const [lat, lon, ...name] = raw.split(',');
  if (!Number.isFinite(+lat) || !Number.isFinite(+lon)) return null;
  return { name: name.join(',').trim() || 'Pinned location', lat: +lat, lon: +lon };
}

async function boot() {
  const params = new URLSearchParams(location.search);
  const pinned = locationFromURL(params);
  if (pinned) state.loc = pinned;
  // ?view=week etc., used by the home-screen shortcuts.
  if (VIEWS.includes(params.get('view'))) state.view = params.get('view');
  if (params.get('theme')) setTheme(params.get('theme'));
  render();
  try {
    const [demo, catalog] = await Promise.all([
      fetch('data/collection.json').then(r => r.json()),
      fetch('data/catalog.json').then(r => r.json()).catch(() => ({ fragrances: [] })),
    ]);
    for (const f of [...demo.fragrances, ...catalog.fragrances]) f.id = String(f.id);
    state.demo = demo;
    state.catalog = catalog.fragrances;
  } catch {
    $('#view').innerHTML = ui.messageHTML({ glyph: ui.icon.bottle, title: 'Collection missing', body: 'Couldn’t load data/collection.json.' });
    return;
  }
  const link = parseShare(params);
  if (link) openSharedLink(link);
  renderFooter();
  if (state.loc) await refreshWeather();
  else { render(); openSheet({ kind: 'location' }); }

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

boot();
