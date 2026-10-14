// Discover: bottles to buy that give more of what someone loves, by scent
// style ("more skin scents"), by example ("more like these bottles") and by
// notes ("iris leather"), any bottle by name, and the gap finder's top picks.
// The lists come from the suggestion pool through src/app/pool.js (its
// worker does the work); the name search from the dataset's index
// (findBottles). Every choice lives in the URL (src/views/discover/query.js),
// so Back, a reload and a shared link come back to it; the templates are
// src/views/discover/templates.js, the styles src/css/discover.css.
import { esc, plural } from '../ui.js';
import { icon, messageHTML, segHTML, sheetFrame, img, bottleCardSkeletonHTML } from '../ui/components.js';
import { routeHash, go } from '../app/router.js';
import { askPool, warmPool, poolStatus } from '../app/pool.js';
import {
  state, findBottles, fullRecords, ownedIn, findRecord, activeFragrances, viewingDemo, poolInputs, setPreferValue, todayISO,
  loadFullRecord, keepBottles,
} from '../app/state.js';
import { loadWants, saveWants, hasWant, setWant } from '../wishlist.js';
import { occasionCounts } from '../history.js';
import { normalize } from '../collections.js';
import * as scentStyles from '../scent-styles.js';
import { readQuery, writeQuery, poolFilters, filterCount, searchMode, namedToCheck, NO_FILTERS, SEED_MAX } from './discover/query.js';
import * as T from './discover/templates.js';

const MIN_QUERY = 3;
// How long Smells like waits for the bottle page's section (its record and the pool's answer).
const DUPES_WAIT_MS = 15000;
const TYPING_MS = 320;
// The styles last picked here, kept on this device: they start Discover next time.
const STYLES_KEY = 'scentcast.styles';
// How long a press makes a style chip say what it is.
const HOLD_MS = 450;

// ---------- Modules loaded on demand ----------
// src/discover.js (DEMO_LIKED, likedStyles, FILTERS) and "How you wear"
// (src/uses.js) stay out of the boot graph, as Wardrobe's panes keep them:
// the page shows skeletons until they're in. (The scent styles are in it
// already: the bottle page and the spray guide import them.) The pool's
// worker loads its own copies. A failed import stays failed for the page's
// life, so after one the page says so with Reload, and never imports again.

let lib = null, libLoading = null, libFailed = false;
function loadLib(app) {
  if (libFailed) return;
  libLoading ??= Promise.all([import('../discover.js'), import('../uses.js')]).then(([discover, uses]) => {
    lib = { ...discover, ...scentStyles, loadUses: uses.loadUses };
    repaint(app);
  }, () => {
    libFailed = true;
    repaint(app);
  });
}
// The logic knows body mists once src/discover.js FILTERS has the key.
const hasMists = () => Boolean(lib && 'mists' in lib.FILTERS);

function loadSavedStyles() {
  try {
    const ids = JSON.parse(localStorage.getItem(STYLES_KEY));
    return Array.isArray(ids) ? ids : null;
  } catch {
    return null;
  }
}

function saveStyles(ids) {
  try {
    if (ids.length) localStorage.setItem(STYLES_KEY, JSON.stringify(ids));
    else localStorage.removeItem(STYLES_KEY);
  } catch {}
}

// ---------- What the page asks, and has ----------

// Each list on screen is a slot: the question it answers (`key`), the
// wardrobe it was asked for (`owner`), and its answer. A change of question
// keeps the old answer on screen, dimmed, until the new one lands; another
// wardrobe clears it.
const slot = () => ({ key: null, owner: null, status: 'idle', result: null, error: '', ticket: null });
const slots = { styles: slot(), like: slot(), notes: slot(), report: slot() };
const ks = { styles: T.PAGE, like: T.PAGE, notes: T.PAGE };
// "I own it" from a card keeps the lists as they are (the card says In Mine)
// rather than asking again, while the same list is ranked. When owning it
// switched lists (David's to Mine), the lists are asked again for the new
// one, the old cards staying on screen, dimmed, until the answers land.
let adopting = false;
// After Show more, focus goes to the first new card.
let focusAfter = null;
// A want just taken away from a card or a row: { list: the want list before, id }, for Undo.
let wantUndo = null;
// Every style chip on show (a wide column shows the first ten and the chosen).
let allStyles = false;

// The wardrobe the lists are for: the ranked list and what's switched on in it.
const listOf = () => (state.shared ? `shared:${state.shared.name ?? ''}` : state.active);
const ownedKey = () => `${listOf()}|${activeFragrances().map(f => f.id).join()}`;
// Nothing owned (an empty Mine, every bottle switched off): no gaps to fill.
const ownsAny = () => activeFragrances().length > 0;

function load(app, name, key, ask) {
  const s = slots[name], owner = ownedKey();
  if (s.key === key && (s.owner === owner || (adopting && s.owner?.startsWith(`${listOf()}|`)))) {
    s.owner = owner;
    return;
  }
  if (s.owner !== owner && !adopting) s.result = null;
  const ticket = {};
  Object.assign(s, { key, owner, status: 'loading', error: '', ticket });
  ask().then(r => {
    if (r?.stale || s.ticket !== ticket) return;
    Object.assign(s, { status: 'done', result: r });
    repaint(app);
  }, err => {
    if (s.ticket !== ticket) return;
    Object.assign(s, { status: 'error', error: err?.message || 'Something went wrong. Try again.' });
    repaint(app);
  });
}

// "Prefer great value" in Discover: on only when someone turned it on (here,
// on Insights or the Wishlist: it's one setting). Left unset, the
// wardrobe's default (on for David) is the gap finder's, which shops to fill
// gaps. Discover explores, and a floor at great value hid most designer and
// niche bottles there (Dior Homme Parfum, Philosykos, Molecule 01) behind
// drugstore mists and oils. The gap teaser keeps the gap finder's default.
const valueOn = () => state.preferValue === true;

// Discover's state, read from the page's route.
const discoverRoute = () => (state.base?.dest === 'discover' ? state.base : null);
const current = () => readQuery(discoverRoute()?.query ?? {});
const searching = d => d.q.length >= MIN_QUERY;
const filtersFor = d => poolFilters(d.filters, { mists: hasMists() });

// What the wardrobe likes, worked out once per wardrobe: the chips it starts
// on (the styles hearted on Insights, state.likedStyles; else the ones last
// picked here; else David's stated loves on the demo, DEMO_LIKED; else what
// most of its bottles lean toward), their order (those first, then the
// wardrobe's own leanings, then the rest), and which owned bottles are each
// style. Needs the lib.
let taste = null;
function tasteOf() {
  const known = new Set(lib.STYLES.map(s => s.id));
  const hearted = state.likedStyles?.filter(id => known.has(id));
  const saved = loadSavedStyles()?.filter(id => known.has(id));
  const chosen = hearted?.length ? hearted : saved?.length ? saved : null;
  // (Not keyed on the chips picked here: the order holds still while they change.)
  const key = `${ownedKey()}|${viewingDemo()}|${hearted?.join() ?? ''}`;
  if (taste?.key === key) return taste;
  const owned = activeFragrances();
  const memo = new Map();
  const scores = f => memo.get(f) ?? memo.set(f, lib.styleScores(f)).get(f);
  const leaning = lib.likedStyles(owned, { scores, k: 6 }).map(s => s.id);
  const start = chosen ?? (viewingDemo() ? lib.likedStyles(owned, { stated: lib.DEMO_LIKED, scores }).map(s => s.id) : leaning.slice(0, 3));
  const order = [...new Set([...start, ...leaning, ...lib.STYLES.map(s => s.id)])];
  const mix = lib.styleMix(owned, scores);
  const names = new Map(owned.map(f => [f.id, f.name]));
  const own = Object.fromEntries(lib.STYLES.map(s => [s.id, (s.id === 'intimate' ? mix.intimateIds : mix.ids[s.id] ?? []).map(id => names.get(id))]));
  taste = { key, start, order, owned: own, known };
  return taste;
}
// The chosen styles: the URL's (the ones STYLES has), else where the wardrobe starts.
const selectedStyles = d => (d.styles ? d.styles.filter(id => tasteOf().known.has(id)) : tasteOf().start);

// The bottles "more like" starts from: chosen ones, else the answer's defaults.
function seedIds(d) {
  if (d.seeds) return d.seeds;
  return slots.like.result?.from !== 'given' ? (slots.like.result?.seeds ?? []).map(r => r.id) : [];
}

// The wardrobe the lists are for is in: David's (boot loads it), Mine, or a shared link's.
const wardrobeIn = () => (state.shared ? !state.shared.loading : state.active === 'mine' || Boolean(state.demo));

// Each list's question. The report's also covers the place (its climate),
// "How you wear" and the journal's occasions, as Insights' does.
const notesKey = (d, filters) => JSON.stringify(['notes', d.q, filters, ks.notes, valueOn()]);
const likeKey = (d, filters) => JSON.stringify(['like', d.seeds, d.seeds ? 0 : state.history.length, filters, ks.like, valueOn()]);
const stylesKey = (d, styles, filters) => JSON.stringify(['styles', styles, d.mode, filters, ks.styles, valueOn()]);
const reportKey = () => JSON.stringify(['report', state.preferValue, state.loc?.lat ?? null, state.loc?.lon ?? null, lib.loadUses(), occasionCounts(state.history)]);
// What every list asks with: the wardrobe, and Discover's value setting.
const inputs = async () => ({ ...(await poolInputs()), preferValue: valueOn() });

// Asks for whatever the page shows that it doesn't have yet.
function ensure(app, d) {
  if (!lib) loadLib(app);
  if (!wardrobeIn() || !lib) return;
  const filters = filtersFor(d);
  if (searching(d)) {
    const k = ks.notes;
    load(app, 'notes', notesKey(d, filters), async () =>
      askPool('notes', { ...(await inputs()), query: d.q, filters, k }, { channel: 'disc-notes' }));
    checkNamed(app, d);
    return;
  }
  if (d.tab === 'like') {
    const k = ks.like;
    const seeds = d.seeds ? { seeds: d.seeds } : { history: state.history, todayISO: todayISO() };
    if (!d.seeds || d.seeds.length) {
      load(app, 'like', likeKey(d, filters), async () =>
        askPool('moreLike', { ...(await inputs()), ...seeds, filters, k }, { channel: 'disc-like' }));
    }
  } else {
    const styles = selectedStyles(d), k = ks.styles;
    if (styles.length) {
      load(app, 'styles', stylesKey(d, styles, filters), async () =>
        askPool('styles', { ...(await inputs()), styles, mode: d.mode, k, filters }, { channel: 'disc-styles' }));
    }
  }
  if (ownsAny()) {
    load(app, 'report', reportKey(), async () =>
      askPool('report', { ...(await poolInputs()), k: 3 }, { channel: 'disc-report' }));
  }
}

// ---------- Is it a name, or notes? ----------
// A search whose words are all notes reads as notes, unless a bottle named
// exactly that is one people mean by them (searchMode): a name hit carries
// no votes, so the pool's `records` says how many rated it (from its rows,
// which the notes question loaded, or r/). id -> rating votes.
const namedVotes = new Map();
const namedAsked = new Set();
const votesOf = id => namedVotes.get(id);
// The notes reading is in and needs no pick: the exactly named hits still to hear about.
function namedPending(d) {
  const notes = slots.notes.result;
  if (d.by || !notes?.terms?.length || notes.unknown?.length) return [];
  return namedToCheck(d.q, state.discover.results, votesOf);
}
function checkNamed(app, d) {
  const ask = namedPending(d).filter(r => !namedAsked.has(r.id));
  if (!ask.length) return;
  for (const r of ask) namedAsked.add(r.id);
  const ids = ask.map(r => r.id);
  askPool('records', { ids }).then(({ records, missing }) => {
    for (const r of records) namedVotes.set(String(r.id), r.ratingVotes ?? 0);
    for (const id of missing) namedVotes.set(String(id), 0);
  }, () => {
    // Offline: the words read as notes (the toggle still offers names).
    for (const id of ids) namedVotes.set(id, 0);
  }).then(() => repaint(app));
}

// ---------- Name search ----------

let seq = 0;
let typed = false; // the query changed from the field, which keeps what was typed
async function runSearch(app, query) {
  const id = ++seq;
  const d = state.discover;
  d.error = '';
  d.offline = '';
  if (query.length < MIN_QUERY) {
    Object.assign(d, { results: null, busy: false });
  } else {
    d.busy = true;
    repaint(app);
    const { results, error } = await findBottles(query);
    if (id !== seq) return;
    // Offline, the bottles on this device still answer; with none, the error does.
    Object.assign(d, { results: error && !results.length ? null : results, error: results.length ? '' : error, offline: error, busy: false });
  }
  repaint(app);
}

// A query from the URL that isn't the one searched last runs (a deep link, Back).
function syncSearch(app, d) {
  const fromField = typed;
  typed = false;
  if (d.q === state.discover.query) return;
  if (!fromField) state.discover.draft = null;
  state.discover.query = d.q;
  queueMicrotask(() => runSearch(app, d.q));
}

// Results already in a list say which: the one being ranked, or Mine.
function ownedLabel(id) {
  const where = { demo: 'In David’s', mine: 'In Mine', shared: state.shared?.name ? `In ${state.shared.name}’s` : 'In this link' };
  return where[ownedIn(id)] ?? null;
}
const nameOwners = () => new Map((state.discover.results ?? []).map(r => [r.id, ownedLabel(r.id)]).filter(([, label]) => label));

// ---------- The page ----------

function wantedOf() {
  const wants = loadWants();
  return id => hasWant(wants, id);
}

// The filters on, "Prefer great value" among them (the Filters button's count).
const filtersOn = d => filterCount(d.filters, { mists: hasMists(), value: valueOn() });

// The pool's answer when none of a link's seed bottles are in the library
// (src/pool-tasks.js moreLike): not a failure Try again would fix.
export const NONE_FOUND = /^None of those bottles/;

function emptyHTML(d, what) {
  // All at once is the likelier reason a list of several styles came up empty.
  const all = what === 'all';
  const anyOf = '<button class="btn secondary" data-action="disc-mode" data-value="any">Try any of them</button>';
  if (filtersOn(d)) {
    return messageHTML({
      glyph: icon.filter,
      title: all ? 'Nothing is all of these, with these filters' : 'Nothing fits every filter',
      body: all ? 'Few bottles are every style at once. Try any of them, or loosen a filter.' : 'Loosen a filter or two to see more.',
      action: `<div class="action-row">${all ? anyOf : ''}<button class="btn primary" data-action="disc-filters-reset">Reset filters</button></div>`,
    });
  }
  const bodies = {
    all: ['No bottle is all of these', 'Few bottles are every style at once. Try any of them, or fewer styles.'],
    styles: ['Nothing new in these styles', 'Every bottle that fits is one you own or a twin of one. Try another style.'],
    like: ['Nothing close enough', 'Try other bottles to start from.'],
    notes: ['Nothing has all of these', 'No bottle in the library carries every one of these notes strongly. Try fewer.'],
  };
  const [title, body] = bodies[what];
  return messageHTML({ glyph: icon.discover, title, body, action: all ? anyOf : '' });
}

// "Fill a gap": none for a wardrobe with nothing in it (Insights has nothing to look at either).
const teaserHTML = () => (ownsAny() ? T.teaserHTML(slots.report, { wantedOf: wantedOf() }) : '');

function listHTML(d, name, empty, { teaser = false } = {}) {
  return T.picksHTML(slots[name], {
    insert: teaser ? teaserHTML() : '',
    name,
    k: ks[name],
    ownedOf: ownedLabel,
    wantedOf: wantedOf(),
    selected: name === 'styles' ? selectedStyles(d) : [],
    empty,
    poolLoading: poolStatus() === 'loading',
  });
}

// The filters beside the list, from a 940px column (first, so Tab reaches
// them before the cards, as they sit on screen); narrower, the aside isn't
// drawn at all (discover.css) and the Filters button opens the sheet.
function sideHTML(d) {
  return `<aside class="disc-side" aria-label="Filters">
      <section class="disc-panel" aria-labelledby="disc-filters-head">
        <header class="disc-panel-head"><h2 id="disc-filters-head" tabindex="-1" data-focus="disc-filters-head">Filters</h2>${filtersOn(d) ? '<button class="btn tertiary compact" data-action="disc-filters-reset">Reset</button>' : ''}</header>
        ${T.filtersHTML(d.filters, { preferValue: valueOn(), mists: hasMists(), prefix: 'dfs' })}
      </section>
    </aside>`;
}

// A list's title, and the line that says only great value shows.
const listHeadHTML = title => `<div class="disc-list-head">${T.listTitleHTML(title)}${valueOn() ? T.valueFloorHTML() : ''}</div>`;

/**
 * The bottles "more like" starts from, for the page and the picker: records,
 * null while one loads, a stub from the picker's search until its record is
 * in, `{ id, missing }` once the library has said it can't find one.
 * `loading`: the defaults (most worn, best rated) are on their way.
 */
function seedModel(d) {
  const s = slots.like;
  const loading = !d.seeds && !s.result && s.status !== 'error';
  // Asked about these very seeds and answered: one not in the answer isn't in the library.
  const answered = Boolean(d.seeds) && s.key === likeKey(d, filtersFor(d))
    && (s.status === 'done' || (s.status === 'error' && NONE_FOUND.test(s.error)));
  const answer = new Map((s.status === 'done' ? s.result?.seeds ?? [] : []).map(r => [r.id, r]));
  const stubs = new Map((state.sheet?.kind === 'disc-seeds' ? state.sheet.results ?? [] : []).map(r => [r.id, r]));
  const seeds = loading ? [null, null, null]
    : seedIds(d).map(id => findRecord(id) ?? answer.get(id) ?? stubs.get(id) ?? (answered ? { id, missing: true, name: 'Not found' } : null));
  return { seeds, from: d.seeds ? 'given' : s.result?.from, chosen: Boolean(d.seeds), loading };
}

// The lib didn't load (offline before the service worker had it): only a reload asks again.
const libFailedHTML = () => messageHTML({
  glyph: icon.cloud,
  title: 'Discover didn’t load',
  body: 'It needs a connection the first time it opens. Reconnect, then reload.',
  action: '<button class="btn primary" data-action="disc-reload">Reload</button>',
});

function browseHTML(d) {
  if (libFailed) return `<div class="disc-layout solo"><div class="disc-main">${libFailedHTML()}</div></div>`;
  // Until the wardrobe and the lib are in, the shapes of what's coming (not "Pick a style").
  if (!wardrobeIn() || !lib) {
    return `<div class="disc-layout"><div class="disc-main" aria-busy="true">
        <div class="disc-sk-chips">${'<span class="sk"></span>'.repeat(4)}</div>
        <div class="disc-grid">${bottleCardSkeletonHTML(4)}</div>
      </div></div>`;
  }
  const t = tasteOf();
  const selected = selectedStyles(d);
  const tabs = segHTML([
    { value: 'styles', label: 'By style', on: d.tab === 'styles' },
    { value: 'like', label: 'By bottle', on: d.tab === 'like' },
  ], { action: 'disc-tab', label: 'Find bottles', cls: 'disc-tabs' });
  let head, list;
  if (d.tab === 'like') {
    const m = seedModel(d), s = slots.like;
    const none = d.seeds ? !d.seeds.length : s.result?.seeds?.length === 0;
    const lost = d.seeds?.length && s.status === 'error' && NONE_FOUND.test(s.error) && s.key === likeKey(d, filtersFor(d));
    const lede = T.likeHead({ from: m.from, chosen: m.chosen, loading: m.loading, none });
    // (With nothing to start from, the message below says what to do.)
    head = `${T.seedsHTML({ seeds: m.seeds, max: SEED_MAX, line: lede.line, addable: !none })}${none ? '' : listHeadHTML(lede.title)}`;
    if (none) {
      list = messageHTML({ glyph: icon.bottle, title: 'Pick bottles you love', body: 'Get more like them: one bottle, or a few to blend.', action: `<button class="btn primary" data-action="disc-seeds-open">${icon.plus}<span>Pick bottles</span></button>` });
    } else if (lost) {
      list = messageHTML({ glyph: icon.bottle, title: 'These bottles aren’t in the library', body: 'Start from your favorites, or pick other bottles.', action: '<button class="btn primary" data-action="disc-seeds-reset">Back to your favorites</button>' });
    } else {
      list = listHTML(d, 'like', emptyHTML(d, 'like'), { teaser: true });
    }
  } else {
    const labels = selected.map(id => lib.STYLES.find(x => x.id === id)?.label ?? id);
    head = `${T.stylePickerHTML({ styles: lib.STYLES, order: chipOrder(d), selected, mode: d.mode, owned: t.owned, all: allStyles })}${selected.length ? listHeadHTML(T.stylesTitle(labels, d.mode)) : ''}`;
    list = selected.length ? listHTML(d, 'styles', emptyHTML(d, d.mode === 'all' && selected.length > 1 ? 'all' : 'styles'), { teaser: true }) : teaserHTML();
  }
  return `<div class="disc-layout">
      ${sideHTML(d)}
      <div class="disc-main">
        <div class="disc-bar">${tabs}${T.filterButtonHTML(d.filters, { mists: hasMists(), value: valueOn() })}</div>
        ${head}
        <div class="disc-list">${list}</div>
      </div>
    </div>`;
}

// The search whose names list is on screen: it stays up, not back to a
// skeleton, while the notes reading catches up (the pool came in meanwhile).
let namesShownFor = null;

function searchHTML(d) {
  const names = state.discover, notesSlot = slots.notes;
  const notes = notesSlot.result;
  const notesOk = Boolean(notes?.terms?.length) && !notes.unknown?.length;
  // Before guessing which list the words meant: the notes answer (once the
  // pool is in), the names, and how well known a bottle named exactly that is.
  const settling = notesOk && !d.by && (names.busy || namedPending(d).length > 0);
  const shown = namesShownFor === d.q;
  const waiting = !shown && ((!notes && notesSlot.status === 'loading' && poolStatus() !== 'loading') || settling);
  const mode = settling && shown ? 'names' : searchMode(d, names.results, notes, votesOf);
  const notesShown = mode === 'notes';
  const toggle = T.modeToggleHTML(mode, {
    names: names.results?.length ? d.q : null,
    notes: notesOk && (notes.picks?.length || notesShown) ? notes.terms : null,
  });
  // The title says which list this is, once there's one to show.
  let results, title = '';
  if ((names.busy && !names.results) || waiting) {
    results = `<p class="disc-count muted">Searching…</p><div class="disc-sk-rows" aria-busy="true">${'<span class="sk"></span>'.repeat(4)}</div>`;
  } else if (notesShown) {
    results = `${T.notesNoteHTML(notes, d.q)}${listHTML(d, 'notes', emptyHTML(d, 'notes'))}`;
    title = `<div class="disc-list-head">${T.searchTitleHTML(mode, { query: d.q, terms: notes?.terms })}${valueOn() ? T.valueFloorHTML() : ''}</div>`;
  } else if (names.results?.length) {
    namesShownFor = d.q;
    // The title says what's listed; the line stays for an offline search.
    results = `${names.offline ? `<p class="disc-count muted">${T.statusHTML(names)}</p>` : ''}${T.namesHTML(names, nameOwners(), { wantedOf: wantedOf() })}`;
    title = T.searchTitleHTML(mode, { query: d.q });
  } else if (names.error && notesSlot.status !== 'loading') {
    // Offline with nothing on this device: one message, and the way to try again.
    results = T.searchErrorHTML(names.error);
  } else if (names.results && (notesSlot.status === 'done' || notesSlot.status === 'error' || libFailed)) {
    results = T.noMatchHTML(d.q);
  } else {
    results = `<p class="disc-count muted">Searching…</p>`;
  }
  return `<div class="disc-layout${notesShown ? '' : ' solo'}">
      ${notesShown ? sideHTML(d) : ''}
      <div class="disc-main">
        ${toggle || notesShown ? `<div class="disc-bar">${toggle}${notesShown ? T.filterButtonHTML(d.filters, { mists: hasMists(), value: valueOn() }) : ''}</div>` : ''}
        ${title || '<h2 class="disc-title visually-hidden" tabindex="-1" data-focus="disc-title">Search results</h2>'}
        <div class="disc-list">${results}</div>
      </div>
    </div>`;
}

const bodyHTML = d => (searching(d) ? searchHTML(d) : browseHTML(d));

// One line for screen readers when what's listed changes.
function spoken(d) {
  if (searching(d)) {
    const notes = slots.notes.result, mode = searchMode(d, state.discover.results, notes, votesOf);
    if (mode === 'notes') return slots.notes.status === 'loading' ? 'Searching…' : `${plural(notes?.picks?.length ?? 0, 'bottle')} with ${notes?.terms?.join(' and ') ?? 'these notes'}${valueOn() ? ', great value only' : ''}`;
    return T.statusHTML(state.discover).replace(/<[^>]+>/g, '');
  }
  if (!lib || !wardrobeIn()) return '';
  const like = d.tab === 'like', s = slots[like ? 'like' : 'styles'];
  // Nothing to start from (no bottles, no styles): no list was asked for, so no count.
  if (like ? (d.seeds ? !d.seeds.length : s.result?.seeds?.length === 0) : !selectedStyles(d).length) return '';
  if (s.status === 'loading') return 'Finding bottles…';
  if (s.status === 'error') return s.error;
  return s.result ? `${plural(s.result.picks.length, 'bottle')}${valueOn() ? ', great value only' : ''}` : '';
}

function discoverPage(app, route) {
  carryOver(route);
  const d = readQuery(route.query);
  syncSearch(app, d);
  ensure(app, d);
  return `${T.searchFormHTML(state.discover.draft ?? d.q)}
    <p class="visually-hidden" role="status" id="disc-status"></p>
    <div id="disc-body" class="disc-body">${bodyHTML(d)}</div>`;
}

// Re-renders the lists under the search field (which keeps its focus and caret).
function repaint(app) {
  const body = document.getElementById('disc-body');
  if (!discoverRoute() || !body) return;
  const d = current();
  syncSearch(app, d);
  ensure(app, d);
  const strip = body.querySelector('.style-chips');
  const left = strip?.scrollLeft ?? 0;
  const focused = document.activeElement, inside = body.contains(focused);
  app.keepingFocus(focused, '#disc-body', () => { body.innerHTML = bodyHTML(d); });
  // The control went with the old list (a card the new answer left out): the list's title.
  if (inside && !body.contains(document.activeElement)) focusTitle();
  const next = body.querySelector('.style-chips');
  if (next) next.scrollLeft = left;
  after(app);
  // The sheets show what the page has: how many bottles fit, the seeds
  // (a default landing, a picked bottle's record); their focus stays put.
  patchSheet(app);
}

// Redraws an open Discover sheet in parts: the pieces marked data-part are
// replaced, and the live line (data-live) only changes its text, so it stays
// the same node and screen readers hear the change (a status inserted
// already filled says nothing). The seed picker's search field isn't a part:
// it keeps focus, caret and a word being composed while its lists redraw.
function patchSheet(app) {
  if (state.sheet?.kind !== 'disc-filters' && state.sheet?.kind !== 'disc-seeds') return;
  const el = document.getElementById('sheet');
  const parts = [...(el?.querySelectorAll('[data-part]') ?? [])];
  const html = parts.length && sheets[state.sheet.kind](state.sheet);
  // (Not drawn yet, or nothing to show: the whole sheet, which closes itself then.)
  if (!html) return app.keepingFocus(document.activeElement, '#sheet', () => app.renderSheet({ keepScroll: true }));
  const fresh = document.createElement('template');
  fresh.innerHTML = html;
  app.keepingFocus(document.activeElement, '#sheet', () => {
    for (const part of parts) {
      const next = fresh.content.querySelector(`[data-part="${part.dataset.part}"]`);
      if (next) part.replaceWith(next);
    }
  });
  for (const live of el.querySelectorAll('[data-live]')) {
    const text = fresh.content.querySelector(`[data-live="${live.dataset.live}"]`)?.textContent ?? '';
    if (live.textContent !== text) live.textContent = text;
  }
}

// Focus for a control that went (a Try again, the value line's Show all):
// the list's title.
const focusTitle = () => document.querySelector('#disc-body .disc-title')?.focus();

function after(app) {
  warmPool();
  watchSheets();
  watchStuck();
  wireTips();
  const d = current();
  showChosen(d);
  const live = document.getElementById('disc-status');
  const line = spoken(d);
  if (live && live.textContent !== line) live.textContent = line;
  // After Show more: the first new card, else (no more came) the last one;
  // after a failure, the list's title (the line under it says what happened).
  const more = focusAfter && slots[focusAfter.list];
  if (more?.status === 'done') {
    const cards = document.querySelectorAll('#disc-body .disc-grid .bcard-open');
    (cards[focusAfter.index] ?? cards[cards.length - 1])?.focus();
    focusAfter = null;
  } else if (more?.status === 'error') {
    focusTitle();
    focusAfter = null;
  }
}

// The chips' order: the wardrobe's (tasteOf), held still while someone
// toggles them here; a selection arriving from outside (a link, Back) puts
// its chips first, where a phone shows them without scrolling.
let chips = null; // { taste, selection, order }
let toggling = false; // the next selection came from a chip here
function chipOrder(d) {
  const t = tasteOf(), selection = selectedStyles(d).join();
  if (chips?.taste === t.key && (chips.selection === selection || toggling)) {
    Object.assign(chips, { selection });
    toggling = false;
    return chips.order;
  }
  toggling = false;
  const chosen = selectedStyles(d);
  chips = { taste: t.key, selection, order: [...new Set([...chosen, ...t.order])] };
  return chips.order;
}

// The search field says when it's stuck to the top (it sits at -1px there,
// so a sliver is out of view), and draws a band behind it (discover.css).
let stuck = null; // { io, form }
function watchStuck() {
  const form = document.querySelector('#main .disc-search');
  if (!form || stuck?.form === form || !('IntersectionObserver' in window)) return;
  stuck?.io.disconnect();
  const io = new IntersectionObserver(([e]) => e.target.classList.toggle('stuck', e.intersectionRatio < 1 && e.boundingClientRect.top < 1), { threshold: 1 });
  io.observe(form);
  stuck = { io, form };
}

// A selection that arrived from the URL (a link, Back) may sit past the
// strip's edge on a phone: scroll its first chip into view, once per selection.
let chipsShown = null;
function showChosen(d) {
  if (!lib || !wardrobeIn()) return;
  // (The order changes when the wardrobe does: the demo loading, a list switched.)
  const key = `${selectedStyles(d).join()}|${chips?.order.join()}`;
  if (key === chipsShown) return;
  chipsShown = key;
  // Once the fonts are in: they change the chips' widths.
  (document.fonts?.ready ?? Promise.resolve()).then(() => requestAnimationFrame(() => {
    const strip = document.querySelector('#disc-body .style-chips');
    const chip = strip?.querySelector('.style-chip.on');
    if (!chip) return;
    const s = strip.getBoundingClientRect(), c = chip.getBoundingClientRect();
    if (c.right > s.right || c.left < s.left) strip.scrollLeft += c.left - s.left - s.width / 4;
  }));
}

// ---------- The URL ----------

// Writes Discover's state into its route and the URL (replacing the entry:
// changing a chip isn't a step Back should retrace), then repaints.
function update(app, patch, { paint = true } = {}) {
  const page = discoverRoute();
  if (!page) return;
  const before = routeHash(page);
  page.query = writeQuery({ ...readQuery(page.query), ...patch });
  // Under a bottle page (docked beside it on desktop), the entry below keeps
  // the old URL; carryOver brings the change back when the page closes.
  if (state.route !== page) carried = { from: carried?.from ?? before, query: page.query, bottle: state.route?.arg ?? null };
  syncURL();
  syncNav(page);
  if (paint) repaint(app);
}

// The Discover tab leads to the page as it is now, so tapping it here only
// scrolls to the top (the shell drew its link from the page as it opened).
function syncNav(page) {
  for (const a of document.querySelectorAll('#nav .nav-item[data-dest="discover"]')) a.setAttribute('href', routeHash(page));
}

let carried = null; // { from: the hash under a bottle page, query: what it became meanwhile, bottle: its id }
function carryOver(route) {
  // Still beside the bottle page: nothing to bring back yet.
  if (!carried || state.route?.dest === 'bottle') return;
  // Only as that bottle page closes onto this page (the shell draws the page
  // under it while the bottle page is still there): a later link to the old
  // URL (Insights' "See more") starts as it says.
  const closing = document.getElementById('bottle')?.dataset.id;
  const back = closing != null && route.dest === 'discover' && routeHash(route) === carried.from;
  const { query, bottle } = carried;
  carried = null;
  if (!back) return;
  route.query = query;
  syncURL();
  syncNav(route);
  // Focus goes back to what opened the bottle page, as it does with no change
  // (the shell put it on the page's heading: to the shell, a new page), or to
  // the list's title when the change took that bottle off it.
  queueMicrotask(() => {
    const opener = document.querySelector(`#disc-body [data-action="open"][data-id="${CSS.escape(bottle ?? '')}"]`);
    if (opener) opener.focus({ preventScroll: true });
    else document.querySelector('#disc-body .disc-title')?.focus({ preventScroll: true });
  });
}

// The URL follows the state, except while a sheet's history entry is on
// top: the filters and seed sheets change it there, and the page's entry
// gets it once the sheet has gone (the popstate below).
let urlLater = false;
function syncURL() {
  const page = discoverRoute();
  if (!page || state.route !== page) return;
  if (state.sheet) {
    urlLater = true;
    return;
  }
  if (location.hash.startsWith('#/discover')) go(routeHash(page), { replace: true });
}

let watching = false;
function watchSheets() {
  if (watching) return;
  watching = true;
  window.addEventListener('popstate', () => queueMicrotask(() => {
    if (urlLater && !state.sheet) {
      urlLater = false;
      syncURL();
    }
  }));
}

// ---------- Style chip tips ----------
// A long press (touch) or a short hover (mouse) on a style chip says what
// the style is and which owned bottles are it; keyboard focus too. Screen
// readers hear the same as the chip's description. As WCAG 1.4.13 asks,
// Escape puts it away (focus stays on the chip), and the pointer can move
// onto it: it goes a moment after the pointer leaves both.

let held = null; // { id, until }: a long press just showed a chip's tip, so its click doesn't toggle it
let quietUntil = 0; // a chip was just toggled: the pointer resting on it doesn't bring up its tip
// How long the tip waits for the pointer to cross from the chip onto it.
const TIP_LEAVE_MS = 300;
function wireTips() {
  const box = document.querySelector('#disc-body .disc-styles');
  if (!box || box.dataset.wired) return;
  box.dataset.wired = '1';
  const tip = box.querySelector('.disc-tip');
  let timer = null;
  const show = chip => {
    const text = document.getElementById(chip.getAttribute('aria-describedby'))?.textContent;
    if (!text) return;
    tip.textContent = text;
    tip.hidden = false;
    const b = box.getBoundingClientRect(), c = chip.getBoundingClientRect();
    const half = tip.offsetWidth / 2;
    const x = Math.max(half, Math.min(b.width - half, c.left - b.left + c.width / 2));
    tip.style.left = `${x}px`;
    tip.style.top = `${c.top - b.top}px`;
  };
  const hide = () => { clearTimeout(timer); tip.hidden = true; };
  const chipOf = e => e.target.closest?.('.style-chip');
  const onTip = node => Boolean(node && tip.contains(node));
  box.addEventListener('pointerdown', e => {
    const chip = chipOf(e);
    if (!chip || e.pointerType === 'mouse') return;
    clearTimeout(timer);
    timer = setTimeout(() => { show(chip); held = { id: chip.dataset.value, until: Date.now() + 1500 }; }, HOLD_MS);
  });
  for (const type of ['pointerup', 'pointercancel']) {
    box.addEventListener(type, e => {
      if (e.pointerType === 'mouse') return;
      clearTimeout(timer);
      if (!tip.hidden) timer = setTimeout(hide, 1800);
    });
  }
  box.addEventListener('pointerover', e => {
    if (e.pointerType !== 'mouse') return;
    // Onto the tip: it stays.
    if (onTip(e.target)) return clearTimeout(timer);
    const chip = chipOf(e);
    if (!chip || Date.now() < quietUntil) return;
    clearTimeout(timer);
    timer = setTimeout(() => show(chip), 350);
  });
  box.addEventListener('pointerout', e => {
    if (e.pointerType !== 'mouse' || (!chipOf(e) && !onTip(e.target)) || onTip(e.relatedTarget)) return;
    // (Moving within the tip, or within the chip, isn't leaving.)
    if (e.relatedTarget && (e.target.closest('.style-chip, .disc-tip')?.contains(e.relatedTarget))) return;
    clearTimeout(timer);
    timer = setTimeout(hide, tip.hidden ? 0 : TIP_LEAVE_MS);
  });
  box.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || tip.hidden) return;
    // The tip's, not the shell's (which would close a sheet or a bottle page).
    e.stopPropagation();
    hide();
  });
  box.addEventListener('focusin', e => { const chip = chipOf(e); if (chip?.matches(':focus-visible')) show(chip); });
  box.addEventListener('focusout', hide);
  box.addEventListener('contextmenu', e => { if (chipOf(e)) e.preventDefault(); });
  box.querySelector('.style-chips')?.addEventListener('scroll', hide, { passive: true });
}

// ---------- The page object ----------

export const discover = {
  id: 'discover',
  label: 'Discover',
  icon: 'discover',
  title: () => 'Discover',
  heading: () => 'Discover',
  render: discoverPage,
  after,
};

// ---------- Handlers ----------

let typing;
export const fields = {
  'disc-q'(el, app) {
    // Kept as typed, so a re-render (the forecast landing) doesn't wipe it.
    state.discover.draft = el.value;
    clearTimeout(typing);
    const query = el.value.trim();
    typing = setTimeout(() => {
      typed = true;
      ks.notes = T.PAGE;
      // Under three letters there's no search: the URL leaves it out.
      update(app, { q: query.length >= MIN_QUERY ? query : '', by: null });
    }, query.length < MIN_QUERY ? 0 : TYPING_MS);
  },
  'disc-seed-q'(el, app) {
    clearTimeout(typing);
    const query = el.value;
    // Kept in the sheet's state (a whole redraw writes it back); only the
    // lists under the field redraw, so it keeps focus, caret and the keyboard.
    if (state.sheet?.kind !== 'disc-seeds') return;
    state.sheet.query = query;
    patchSheet(app);
    typing = setTimeout(() => seedSearch(app, query.trim()), TYPING_MS);
  },
};

export const forms = {
  'disc-search'(data, app, form) {
    clearTimeout(typing);
    typed = true;
    const q = String(data.get('q') ?? '').trim();
    update(app, { q: q.length >= MIN_QUERY ? q : '', by: null });
    // On a phone, Search puts the keyboard away so the results show.
    if (matchMedia('(hover: none)').matches) form.querySelector('input')?.blur();
  },
  'disc-seed-search'() {},
};

// Filters: each change lands in the URL and asks the lists again.
function setFilter(app, el, patch) {
  const d = current();
  const filters = { ...d.filters, ...patch };
  const scope = el.closest('#sheet') ? '#sheet' : '#main';
  const group = el.closest('[role="radiogroup"], [role="group"], .filter-switches');
  const inside = group?.contains(document.activeElement);
  for (const k of Object.keys(ks)) ks[k] = T.PAGE;
  update(app, { filters });
  // An arrow key moved through a radio group: focus the new choice there,
  // not its twin in the other filters (the side panel or the sheet).
  if (inside) app.refocus(el, scope);
}

function toggleStyle(id, d) {
  const selected = selectedStyles(d);
  return selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id];
}

export const actions = {
  'disc-tab'(el, app) {
    update(app, { tab: el.dataset.value });
  },
  'disc-style'(el, app) {
    if (held?.id === el.dataset.value && Date.now() < held.until) {
      held = null;
      return;
    }
    const styles = toggleStyle(el.dataset.value, current());
    quietUntil = Date.now() + 1500;
    toggling = true; // the chips hold still
    chipsShown = `${styles.join()}|${chips?.order.join()}`; // the chip just tapped is in view
    saveStyles(styles);
    ks.styles = T.PAGE;
    update(app, { styles });
  },
  'disc-styles-all'(el, app) {
    allStyles = !allStyles;
    repaint(app);
  },
  'disc-mode'(el, app) {
    update(app, { mode: el.dataset.value });
  },
  'disc-more'(el, app) {
    // (Focusable while the next page loads, so focus has somewhere to stay.)
    if (el.getAttribute('aria-disabled') === 'true') return;
    const list = el.dataset.value;
    focusAfter = { list, index: slots[list].result?.picks.length ?? 0 };
    ks[list] = Math.min(T.MAX_PICKS, ks[list] + T.PAGE);
    repaint(app);
  },
  // Asks again: this list, and any other that failed beside it (a search's names too).
  'disc-retry'(el, app) {
    for (const [name, s] of Object.entries(slots)) if (name === el.dataset.value || s.status === 'error') s.key = null;
    const d = current();
    if (searching(d) && state.discover.error) runSearch(app, d.q);
    else repaint(app);
    focusTitle();
  },
  // Want / Wanted, as the kit's wish-toggle does it, but knowing a name
  // search's hits (stubs) by name.
  'disc-want'(el, app) {
    const id = el.dataset.id;
    const hit = (state.discover.results ?? []).find(r => r.id === id);
    const record = findRecord(id) ?? hit;
    const before = loadWants();
    // A name-search hit is a stub: keep only its id (the list loads it).
    const wants = setWant(record && !record.stub ? record : id);
    // Everything redraws: a bottle page docked beside the card has its own Want.
    app.keepingFocus(el, '#app', app.render);
    const name = esc(record?.name ?? 'Bottle');
    if (hasWant(wants, id)) {
      wantUndo = null;
      return app.showToast(`<span class="note">${name} is on your wishlist.</span><a class="btn secondary compact" href="#/wardrobe/wishlist">See it</a>`);
    }
    wantUndo = { list: before, id };
    app.showToast(`<span class="note">${name} removed from your wishlist.</span><button class="btn primary compact" data-action="disc-want-undo">Undo</button>`);
  },
  // The want list as it was; focus back on the heart that took it away.
  'disc-want-undo'(el, app) {
    if (!wantUndo) return;
    const { list, id } = wantUndo;
    wantUndo = null;
    saveWants(list);
    app.render();
    app.hideToast();
    (document.querySelector(`#disc-body [data-action="disc-want"][data-id="${CSS.escape(id)}"]`) ?? document.getElementById('page-title'))?.focus();
  },
  // The modules didn't load, and a failed import stays failed: only a reload asks again.
  'disc-reload'() {
    location.reload();
  },
  async 'disc-own'(el, app) {
    const id = el.dataset.id;
    const record = findRecord(id);
    if (!record) return;
    // Every note, not just the pool's 8 strongest (offline, the pool's will do).
    const full = record.source === 'fragrantica' ? await loadFullRecord(id).catch(() => null) : null;
    // Owning it can switch the ranked list (to Mine), whose liked styles and
    // most worn bottles differ: pin the ones on screen, so the list stays.
    const d = current();
    update(app, { styles: d.styles ?? selectedStyles(d), seeds: d.seeds ?? (d.tab === 'like' ? seedIds(d) : null) }, { paint: false });
    adopting = true;
    try {
      app.own(full ?? record);
    } finally {
      adopting = false;
    }
    // The button became a tag; the card's name takes focus.
    document.querySelector(`#disc-body .bcard-open[data-id="${CSS.escape(id)}"]`)?.focus();
  },
  async 'own-result'(el, app) {
    const hit = state.discover.results?.[+el.dataset.value];
    if (!hit) return;
    let record;
    try {
      [record] = await fullRecords([hit]);
    } catch (err) {
      return app.showToast(`<span>${esc(err.message)}</span>`);
    }
    if (!record) return app.showToast(`<span>Couldn’t load ${esc(hit.name)}. Try again.</span>`);
    app.own(record);
    // The button became a tag; the row's name takes focus.
    document.querySelector(`.results [data-action="open"][data-id="${CSS.escape(record.id)}"]`)?.focus();
  },
  // The bottle page, at its smells-like section (what it copies, cheaper
  // twins, siblings): scrolled to once it draws (a dataset bottle loads its
  // record first), its heading focused once its answer is in, as Now's spray
  // line opens the spray section. Watches until then, or until the page goes.
  'disc-dupes'(el, app) {
    const id = el.dataset.id;
    app.openBottle(id, null, el.closest('.bcard, .row')?.querySelector('.bcard-open, .row-main') ?? el);
    const until = Date.now() + DUPES_WAIT_MS;
    const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    let shown = false;
    const find = () => {
      if (state.route?.dest !== 'bottle' || state.route.arg !== id) return;
      const mark = document.querySelector('#bottle #bp-dupes, #bottle [data-section="dupes"], #bottle #dupes-title');
      const section = mark?.closest('section') ?? mark;
      if (section) {
        const ready = section.getAttribute('aria-busy') !== 'true';
        if (!shown || ready) section.scrollIntoView({ block: 'start', behavior });
        shown = true;
        if (ready) {
          const head = mark.matches('h2, h3') ? mark : section.querySelector('h3');
          if (head && !head.hasAttribute('tabindex')) head.setAttribute('tabindex', '-1');
          head?.focus({ preventScroll: true });
          return;
        }
      }
      if (Date.now() < until) setTimeout(find, 120);
    };
    setTimeout(find, 120);
  },
  'disc-by'(el, app) {
    update(app, { by: el.dataset.value });
  },
  'disc-suggest'(el, app) {
    const q = el.dataset.value;
    state.discover.draft = q;
    const field = document.querySelector('[data-field="disc-q"]');
    if (field) field.value = q;
    typed = true;
    update(app, { q, by: null });
  },

  // By bottle: the seeds.
  'disc-seed-remove'(el, app) {
    const ids = seedIds(current()).filter(id => id !== el.dataset.id);
    update(app, { seeds: ids });
    // Its chip went: focus the next one, or Add, or the list's title.
    (document.querySelector('#disc-body .seed-x, #disc-body .seed-add') ?? document.querySelector('#disc-body .disc-title'))?.focus();
  },
  'disc-seeds-open'(el, app) {
    app.openSheet({ kind: 'disc-seeds', query: '', results: null, busy: false, error: '' });
  },
  'disc-seed-toggle'(el, app) {
    // (Not while the favorites it starts from are on their way.)
    if (el.getAttribute('aria-disabled') === 'true') return;
    const id = el.dataset.id;
    const ids = seedIds(current());
    const next = ids.includes(id) ? ids.filter(x => x !== id) : ids.length < SEED_MAX ? [...ids, id] : ids;
    if (next === ids) return app.showToast(`<span>Up to ${SEED_MAX} bottles at once</span>`);
    // A dataset hit from the search loads its record for the chip.
    const hit = state.sheet?.results?.find(r => r.id === id);
    if (hit?.stub && !findRecord(id)) fullRecords([hit]).then(([r]) => { if (r) { keepBottles([r]); repaint(app); } }, () => {});
    ks.like = T.PAGE;
    // (The repaint redraws the sheet too: the row moves between Picked and the rest, keeping focus.)
    update(app, { seeds: next, tab: 'like' });
  },
  'disc-seeds-reset'(el, app) {
    ks.like = T.PAGE;
    update(app, { seeds: null });
    // The link went with the picks: the list's title.
    if (!el.isConnected) focusTitle();
  },

  // Filters.
  'disc-filters-open'(el, app) {
    app.openSheet({ kind: 'disc-filters' });
  },
  'disc-season'(el, app) {
    const seasons = current().filters.seasons;
    const s = el.dataset.value;
    setFilter(app, el, { seasons: seasons.includes(s) ? seasons.filter(x => x !== s) : [...seasons, s] });
  },
  'disc-time'(el, app) { setFilter(app, el, { time: el.dataset.value || null }); },
  'disc-lean'(el, app) { setFilter(app, el, { lean: el.dataset.value || null }); },
  'disc-longevity'(el, app) { setFilter(app, el, { longevity: el.dataset.value ? Number(el.dataset.value) : null }); },
  'disc-projection'(el, app) { setFilter(app, el, { projection: el.dataset.value ? Number(el.dataset.value) : null }); },
  'disc-switch'(el, app) {
    const key = el.dataset.id;
    const f = current().filters;
    // The switch reads "Hide discontinued", the filter "show them".
    setFilter(app, el, { [key]: !f[key] });
  },
  // "Prefer great value": the switch, or the line over a list ("Show all").
  'disc-value'(el, app) {
    setPreferValue(el.dataset.value === 'off' ? false : !valueOn());
    for (const k of Object.keys(ks)) ks[k] = T.PAGE;
    const scope = el.closest('#sheet') ? '#sheet' : '#main';
    repaint(app);
    if (!app.refocus(el, scope)) focusTitle();
  },
  'disc-filters-reset'(el, app) {
    const inSheet = Boolean(el.closest('#sheet'));
    // Back to the defaults: Prefer great value too (Discover's is off).
    if (valueOn()) setPreferValue(null);
    setFilter(app, el, { ...NO_FILTERS });
    if (el.isConnected) return;
    // The Reset button went (nothing to reset): the sheet's close, the panel's heading, or the list's title.
    if (inSheet) return document.querySelector('#sheet .sheet-close')?.focus();
    const head = document.getElementById('disc-filters-head');
    if (head?.checkVisibility?.()) head.focus();
    else focusTitle();
  },
};

// ---------- Sheets ----------

// The seed picker's search: owned bottles by name, then the whole library.
// Its answers redraw the lists, not the field (patchSheet).
async function seedSearch(app, query) {
  const sheet = state.sheet;
  if (sheet?.kind !== 'disc-seeds') return;
  if (query.length < MIN_QUERY) {
    Object.assign(sheet, { results: null, busy: false, error: '' });
    return patchSheet(app);
  }
  sheet.busy = true;
  patchSheet(app);
  const { results, error } = await findBottles(query);
  if (state.sheet !== sheet || sheet.query.trim() !== query) return;
  Object.assign(sheet, { results, busy: false, error: results.length ? '' : error });
  patchSheet(app);
}

function seedRow(r, on, { disabled = false } = {}) {
  const meta = [r.brand, r.year].filter(Boolean).map(esc).join(' · ');
  return `<li class="row"><button class="row-main seed-pick" data-action="disc-seed-toggle" data-id="${esc(r.id)}" aria-pressed="${on}"${disabled ? ' aria-disabled="true"' : ''}>
      ${r.missing ? `<span class="seed-glyph">${icon.bottle}</span>` : img(r)}<span class="row-text"><b>${esc(r.name)}</b><small>${r.missing ? 'The library couldn’t find it' : meta}</small></span>
      <span class="check${on ? ' on' : ''}" aria-hidden="true">${icon.check}</span>
    </button></li>`;
}

/**
 * The seed picker: the bottles picked (first, always), any bottle from the
 * library by search, and owned ones by name. `picked`: seedModel's seeds
 * (records, stubs, `{ missing }`; null while one loads). `loading`: the
 * favorites it starts from are on their way (nothing to toggle yet).
 */
export function seedSheetHTML(sheet, { owned, chosen, picked = [], loading = false }) {
  const q = normalize(sheet.query ?? '');
  const taken = new Set(chosen);
  const mine = owned.filter(f => !taken.has(f.id) && (!q || normalize(`${f.name} ${f.brand}`).includes(q)));
  const ownedIds = new Set(owned.map(f => f.id));
  const more = (sheet.results ?? []).filter(r => !ownedIds.has(r.id) && !taken.has(r.id));
  const status = loading ? 'Loading your favorites…' : sheet.busy ? 'Searching…' : sheet.error ? sheet.error : '';
  const row = (r, on) => seedRow(r, on, { disabled: loading });
  return `<h2 class="sheet-title" id="disc-seeds-title">More like…</h2>
    <p class="lede muted">Pick up to ${SEED_MAX} bottles. The list finds bottles close to all of them.</p>
    <form class="search-form" data-form="disc-seed-search" role="search">
      <label class="filter">${icon.search}<input type="search" name="q" data-field="disc-seed-q" placeholder="Search any bottle" value="${esc(sheet.query ?? '')}" autocomplete="off" aria-label="Search bottles to start from"></label>
    </form>
    <div data-part="seed-lists">
      ${picked.some(Boolean) ? `<p class="list-title">Picked</p><ul class="rows seed-rows">${picked.filter(Boolean).map(r => row(r, true)).join('')}</ul>` : ''}
      ${more.length ? `<p class="list-title">From the library</p><ul class="rows seed-rows">${more.map(r => row(r, false)).join('')}</ul>` : ''}
      <p class="list-title">${q ? 'Yours that match' : 'Yours'}</p>
      ${mine.length ? `<ul class="rows seed-rows${loading ? ' loading' : ''}">${mine.map(r => row(r, false)).join('')}</ul>` : `<p class="muted small">${q ? 'None of yours match. Search finds any bottle.' : owned.length ? 'Every one of yours is picked.' : 'Your wardrobe is empty. Search for any bottle.'}</p>`}
    </div>
    <div class="sheet-bar spread">
      <span class="muted" role="status" data-live="seed-status">${esc(status || `${chosen.length} of ${SEED_MAX} picked`)}</span>
      <button class="btn primary" data-action="close-sheet">Done</button>
    </div>`;
}

// The filters sheet's live line: what the list on screen holds now.
function filterStatus() {
  const d = current();
  const name = searching(d) ? 'notes' : d.tab === 'like' ? 'like' : 'styles';
  const s = slots[name];
  if (s.status === 'loading') return 'Finding bottles…';
  const n = s.result?.picks?.length;
  if (n == null) return '';
  if (!n) return 'Nothing fits';
  // A full page is the best of more: say what's shown, not a count it isn't.
  return n < ks[name] ? `${plural(n, 'bottle')} fit` : `Showing the top ${n}`;
}

export const sheets = {
  'disc-filters'() {
    if (!discoverRoute()) return null;
    const d = current();
    return sheetFrame('disc-filters-title', T.filterSheetHTML(d.filters, { preferValue: valueOn(), mists: hasMists(), status: filterStatus() }));
  },
  'disc-seeds'(sheet) {
    if (!discoverRoute()) return null;
    const d = current(), chosen = seedIds(d), m = seedModel(d);
    return sheetFrame('disc-seeds-title', seedSheetHTML(sheet, { owned: activeFragrances(), chosen, picked: m.seeds, loading: m.loading }));
  },
};
