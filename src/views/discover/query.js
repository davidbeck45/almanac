// Discover's state lives in its URL (#/discover?…), so Back, a reload and a
// shared link all come back to the same lists: the search (q, and `by` when
// someone picked names or notes over the guess), the list on show (`tab`:
// styles, or like for "more like these bottles"), the chosen styles and how
// they combine (`mode`), the seed bottles, and the filters. Pure: it reads
// and writes the query object src/app/router.js keeps (its DISCOVER_KEYS
// must list every key here), and turns the filters into src/discover.js
// FILTERS for the pool's questions.
import { STYLES } from '../../scent-styles.js';
import { normalize } from '../../collections.js';

export const KEYS = ['q', 'by', 'tab', 'styles', 'mode', 'seeds', 'season', 'time', 'lean', 'longevity', 'projection', 'safe', 'discontinued', 'mists'];
export const SEASONS = ['winter', 'spring', 'summer', 'fall'];
export const LEANS = ['feminine', 'unisex', 'masculine'];
// Minimums on Parfumo's 0–10 scale (performanceRating, as bottle pages
// show it). The pool's median longevity is 7.2 and sillage 7.2: Long and
// Noticeable keep about the top 40%, All day and Strong the top 15–20%.
export const LONGEVITY = [{ value: null, label: 'Any' }, { value: 7.5, label: 'Long' }, { value: 8, label: 'All day' }];
export const PROJECTION = [{ value: null, label: 'Any' }, { value: 7.4, label: 'Noticeable' }, { value: 7.8, label: 'Strong' }];
// "Safe blind buys only": bottles more voters love than the pool's median (the `safe` percentile).
export const SAFE_MIN = 50;
export const SEED_MAX = 5;

const STYLE_IDS = new Set(STYLES.map(s => s.id));
// None chosen, as the URL says it: an absent key means the defaults (the
// liked styles, the most worn bottles).
const NONE = 'none';

const listOf = (raw, keep) => [...new Set(String(raw ?? '').split(',').map(s => s.trim()).filter(Boolean).filter(keep))];
const numberIn = (raw, lo, hi) => {
  const n = raw == null || raw === '' ? NaN : Number(raw);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
};

export const NO_FILTERS = Object.freeze({
  seasons: [], time: null, lean: null, longevity: null, projection: null, safe: false, discontinued: false, mists: false,
});

/**
 * The route's query -> Discover's state: { q, by, tab, styles (ids, or null
 * to start on the liked ones), mode, seeds (ids, or null for the most worn),
 * filters }. Anything it doesn't know reads as the default.
 */
export function readQuery(query = {}) {
  return {
    q: String(query.q ?? '').trim(),
    by: query.by === 'names' || query.by === 'notes' ? query.by : null,
    tab: query.tab === 'like' ? 'like' : 'styles',
    styles: query.styles == null ? null : query.styles === NONE ? [] : listOf(query.styles, id => STYLE_IDS.has(id)),
    mode: query.mode === 'all' ? 'all' : 'any',
    seeds: query.seeds == null ? null : query.seeds === NONE ? [] : listOf(query.seeds, () => true).slice(0, SEED_MAX),
    filters: {
      seasons: SEASONS.filter(s => listOf(query.season, () => true).includes(s)),
      time: query.time === 'day' || query.time === 'night' ? query.time : null,
      lean: LEANS.includes(query.lean) ? query.lean : null,
      longevity: numberIn(query.longevity, 0, 10),
      projection: numberIn(query.projection, 0, 10),
      safe: query.safe === '1',
      discontinued: query.discontinued === '1',
      mists: query.mists === '1',
    },
  };
}

/** Discover's state -> the route's query, defaults left out (readQuery(writeQuery(d)) gives d back). */
export function writeQuery(d) {
  const f = { ...NO_FILTERS, ...d.filters };
  const out = {
    q: d.q || null,
    by: d.q && d.by ? d.by : null,
    tab: d.tab === 'like' ? 'like' : null,
    styles: d.styles == null ? null : d.styles.length ? d.styles.join(',') : NONE,
    mode: d.mode === 'all' ? 'all' : null,
    seeds: d.seeds == null ? null : d.seeds.length ? d.seeds.slice(0, SEED_MAX).join(',') : NONE,
    season: f.seasons.length ? SEASONS.filter(s => f.seasons.includes(s)).join(',') : null,
    time: f.time,
    lean: f.lean,
    longevity: f.longevity == null ? null : String(f.longevity),
    projection: f.projection == null ? null : String(f.projection),
    safe: f.safe ? '1' : null,
    discontinued: f.discontinued ? '1' : null,
    mists: f.mists ? '1' : null,
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v != null && v !== ''));
}

/** How many filters differ from the defaults (the Filters button's count). */
export const filterCount = (filters, { mists = true } = {}) => {
  const f = { ...NO_FILTERS, ...filters };
  return [f.seasons.length > 0, f.time, f.lean, f.longevity != null, f.projection != null, f.safe, f.discontinued, mists && f.mists]
    .filter(Boolean).length;
};

/**
 * The filters as src/discover.js FILTERS overrides. `mists` says whether
 * the logic knows the body-mist flag (FILTERS.mists); without it the switch
 * isn't offered and nothing is sent.
 */
export function poolFilters(filters, { mists = true } = {}) {
  const f = { ...NO_FILTERS, ...filters };
  return {
    seasons: f.seasons.length ? [...f.seasons] : null,
    slot: f.time,
    lean: f.lean,
    minLongevity: f.longevity,
    minSillage: f.projection,
    minSafe: f.safe ? SAFE_MIN : null,
    hideDiscontinued: !f.discontinued,
    ...(mists && f.mists && { mists: true }),
  };
}

/**
 * Which list a search shows: `by` when someone picked one; else the notes
 * list when every word named a note or accord, unless a bottle is named
 * exactly that ("Tobacco Vanille", "Oud Wood": two words or more, so "fig"
 * and "iris" stay notes). `notes` is the pool's answer (null while it's on
 * its way: names until then), `names` the name search's results.
 */
export function searchMode({ q, by }, names, notes) {
  const notesOk = Boolean(notes?.terms?.length) && !notes.unknown?.length;
  if (!notesOk) return 'names';
  if (by) return by;
  const typed = normalize(q);
  const exact = (names ?? []).some(r => {
    const name = normalize(r.name);
    return name.includes(' ') && (name === typed || normalize(`${r.name} ${r.brand}`) === typed);
  });
  return exact ? 'names' : 'notes';
}
