// Discover: find any fragrance by name across David's wardrobe, the catalog
// and the whole dataset. A result opens its bottle page; "I own it" adds it to
// Mine. Wave 4 adds styles, more like this and notes search below the field.
// Styles: src/css/discover.css.
import { esc, plural } from '../ui.js';
import { icon, rowHTML, messageHTML } from '../ui/components.js';
import { routeHash, go } from '../app/router.js';
import { state, findBottles, fullRecords } from '../app/state.js';

const MIN_QUERY = 3;
const TYPING_MS = 320;

function resultRow(r, i, owned) {
  const meta = [r.brand, r.year].filter(Boolean).map(esc).join(' · ');
  const trailing = owned
    ? `<span class="owned-tag">${icon.check}In Mine</span>`
    : `<button class="btn secondary compact" data-action="own-result" data-value="${i}" aria-label="I own ${esc(r.name)}">${icon.plus}I own it</button>`;
  return rowHTML(r, { meta, trailing, open: { ctx: '' } });
}

export function resultsHTML({ query, results, busy, error }, ownedIds) {
  if (busy && !results) return '<p class="muted small searching"><span class="spinner small" aria-hidden="true"></span>Searching…</p>';
  if (error) return `<p class="error">${esc(error)}</p>`;
  if (results === null) {
    return `<p class="muted small discover-hint">Every fragrance on Fragrantica, more than 137,000. Brand plus name works best.</p>`;
  }
  if (!results.length) return `<p class="muted small">No matches for “${esc(query)}”. Check the spelling, or add it yourself from your wardrobe.</p>`;
  return `<p class="muted small result-count">${plural(results.length, 'match', 'matches')}</p>
    <ul class="rows results">${results.map((r, i) => resultRow(r, i, ownedIds.has(r.id))).join('')}</ul>`;
}

export function discoverHTML(search, ownedIds) {
  return `<form class="discover-search" data-form="discover" role="search">
      <label class="filter big">${icon.search}<input type="search" name="q" data-field="discover-q" placeholder="Search by name or brand" value="${esc(search.query)}" autocomplete="off" aria-label="Search fragrances" enterkeyhint="search"></label>
    </form>
    <section class="card discover-list" aria-label="Results">
      <div class="discover-results" aria-live="polite">${resultsHTML(search, ownedIds)}</div>
    </section>`;
}

const ownedIds = () => new Set(state.mine.records.map(r => r.id));

function discoverPage(app, route) {
  // A deep link (#/discover?q=…) runs its search.
  const q = route.query.q ?? '';
  if (q && q !== state.discover.query) queueMicrotask(() => runSearch(q));
  return discoverHTML(state.discover, ownedIds());
}

// Only the results re-render, so the field keeps focus while typing.
function renderResults() {
  const el = document.querySelector('.discover-results');
  if (el) el.innerHTML = resultsHTML(state.discover, ownedIds());
}

let seq = 0;
async function runSearch(query) {
  const id = ++seq;
  const d = state.discover;
  d.query = query;
  d.error = '';
  if (query.length < MIN_QUERY) {
    Object.assign(d, { results: null, busy: false });
  } else {
    d.busy = true;
    renderResults();
    try {
      const results = await findBottles(query);
      if (id !== seq) return;
      d.results = results;
    } catch (err) {
      if (id !== seq) return;
      d.error = err.message;
    }
    d.busy = false;
  }
  // The query lives in the URL, so Back and a shared link come back to it.
  if (state.route?.dest === 'discover') {
    state.route.query = query.length >= MIN_QUERY ? { q: query } : {};
    go(routeHash(state.route), { replace: true });
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
    app.addToMine(record);
    app.render();
    app.showToast(`<span>${esc(record.name)} added to your collection</span>`);
  },
};
