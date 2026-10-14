// Discover: find any fragrance by name across David's wardrobe, the catalog
// and the whole dataset. A result opens its bottle page; "I own it" adds it to
// Mine. Wave 4 adds styles, more like this and notes search below the field.
// Styles: src/css/discover.css.
import { esc, plural } from '../ui.js';
import { icon, rowHTML } from '../ui/components.js';
import { routeHash, go } from '../app/router.js';
import { state, findBottles, fullRecords, ownedIn } from '../app/state.js';

const MIN_QUERY = 3;
const TYPING_MS = 320;

function resultRow(r, i, owned) {
  const meta = [r.brand, r.year].filter(Boolean).map(esc).join(' · ');
  const trailing = owned
    ? `<span class="owned-tag">${icon.check}${esc(owned)}</span>`
    : `<button class="btn secondary compact" data-action="own-result" data-value="${i}" aria-label="I own ${esc(r.name)}">${icon.plus}I own it</button>`;
  return rowHTML(r, { meta, trailing, open: { ctx: '' } });
}

// The line screen readers hear (a live region): searching, the count, no
// matches, an error. The list itself stays out of it.
export function statusHTML({ query, results, busy, error, offline }) {
  if (busy && !results) return '<span class="spinner small" aria-hidden="true"></span>Searching…';
  if (error) return `<span class="error">${esc(error)}</span>`;
  if (results === null) return '';
  if (!results.length) return `No matches for “${esc(query)}”. Check the spelling, or add it yourself from your wardrobe.`;
  return offline
    ? `${plural(results.length, 'match', 'matches')} saved on this device. The full library needs a connection.`
    : plural(results.length, 'match', 'matches');
}

/** owned: id -> where it already is ("In Mine"), for the results that are. */
export function resultsHTML({ results }, owned) {
  if (results === null) {
    return `<p class="muted small discover-hint">Every fragrance on Fragrantica, more than 137,000. Brand plus name works best.</p>`;
  }
  if (!results?.length) return '';
  return `<ul class="rows results">${results.map((r, i) => resultRow(r, i, owned.get(r.id))).join('')}</ul>`;
}

export function discoverHTML(search, owned) {
  return `<form class="discover-search" data-form="discover" role="search">
      <label class="filter big">${icon.search}<input type="search" name="q" data-field="discover-q" placeholder="Search by name or brand" value="${esc(search.draft ?? search.query)}" autocomplete="off" aria-label="Search fragrances" enterkeyhint="search"></label>
    </form>
    <section class="card discover-list" aria-label="Results">
      <p class="muted small result-status" role="status">${statusHTML(search)}</p>
      <div class="discover-results">${resultsHTML(search, owned)}</div>
    </section>`;
}

// Results already in a list say which: the one being ranked, or Mine.
function ownedLabels() {
  const where = { demo: 'In David’s', mine: 'In Mine', shared: state.shared?.name ? `In ${state.shared.name}’s` : 'In this link' };
  return new Map((state.discover.results ?? []).map(r => [r.id, where[ownedIn(r.id)]]).filter(([, label]) => label));
}

function discoverPage(app, route) {
  // A deep link, or Back to an earlier search (#/discover?q=…), runs it.
  const q = route.query.q ?? '';
  if (q !== state.discover.query) {
    state.discover.draft = null;
    queueMicrotask(() => runSearch(q));
  }
  return discoverHTML(state.discover, ownedLabels());
}

// Only the results re-render, so the field keeps focus while typing.
function renderResults() {
  const status = document.querySelector('.result-status');
  const list = document.querySelector('.discover-results');
  if (status) status.innerHTML = statusHTML(state.discover);
  if (list) list.innerHTML = resultsHTML(state.discover, ownedLabels());
}

let seq = 0;
async function runSearch(query) {
  const id = ++seq;
  const d = state.discover;
  d.query = query;
  d.error = '';
  d.offline = '';
  if (query.length < MIN_QUERY) {
    Object.assign(d, { results: null, busy: false });
  } else {
    d.busy = true;
    renderResults();
    const { results, error } = await findBottles(query);
    if (id !== seq) return;
    // Offline, the bottles on this device still answer; with none, the error does.
    Object.assign(d, { results: error && !results.length ? null : results, error: results.length ? '' : error, offline: error, busy: false });
  }
  // The query lives in the URL, so Back and a shared link come back to it
  // (with a bottle page open over Discover, once it closes).
  const page = state.base?.dest === 'discover' ? state.base : null;
  if (page) {
    page.query = query.length >= MIN_QUERY ? { q: query } : {};
    if (state.route === page) go(routeHash(page), { replace: true });
  }
  renderResults();
}

export const discover = {
  id: 'discover',
  label: 'Discover',
  icon: 'discover',
  title: () => 'Discover',
  heading: () => 'Discover',
  render: discoverPage,
};

let typing;
export const fields = {
  'discover-q'(el) {
    // Kept as typed, so a re-render (the forecast landing) doesn't wipe it.
    state.discover.draft = el.value;
    clearTimeout(typing);
    const query = el.value.trim();
    typing = setTimeout(() => runSearch(query), query.length < MIN_QUERY ? 0 : TYPING_MS);
  },
};

export const forms = {
  discover(data) {
    clearTimeout(typing);
    return runSearch(String(data.get('q') ?? '').trim());
  },
};

export const actions = {
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
};
