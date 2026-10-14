// Pickers the Wear panes share: a place for a trip or an event, from a sheet
// like the location sheet's city search that never moves your own location,
// and a date pill over a native date input (the system's own picker on
// phones, Chromium's calendar on desktops). Styles: src/css/wear.css.
import { loadRecent, searchCities } from '../../location.js';
import { esc } from '../../ui.js';
import { icon, sheetFrame } from '../../ui/components.js';
import { state } from '../../app/state.js';

// ---------- Places ----------

// Who takes the place picked: { trip: fn(place, app), occ: fn(place, app) },
// registered by the panes that open the sheet with `for`.
const takers = {};
export const onPlace = (who, fn) => { takers[who] = fn; };

export const samePlace = (a, b) => Boolean(a && b) && Math.abs(a.lat - b.lat) < 0.01 && Math.abs(a.lon - b.lon) < 0.01;

export function placeResultsHTML({ results = null, query = '', busy = false }, recent) {
  if (busy && !results) return '<p class="muted small searching"><span class="spinner small" aria-hidden="true"></span>Searching…</p>';
  if (results === null) {
    if (!recent.length) return '';
    return `<h3 class="list-title">Recent</h3><ul class="city-results">${recent.map((r, i) => `<li><button data-action="place-recent" data-value="${i}">${icon.clock}<strong>${esc(r.name)}</strong><span>${esc(r.region ?? '')}</span></button></li>`).join('')}</ul>`;
  }
  if (!results.length) return `<p class="muted small">No places match “${esc(query)}”. Try a bigger nearby city.</p>`;
  return `<ul class="city-results">${results.map((r, i) => `<li><button data-action="place-city" data-value="${i}">${icon.pin}<strong>${esc(r.name)}</strong><span>${esc(r.region)}</span></button></li>`).join('')}</ul>`;
}

/** The sheet: s = { for: 'trip' | 'occ', query, results, busy, error }; `home` is your own location. */
export function placeSheetHTML(s = {}, recent = [], home = null) {
  const { error = '', query = '' } = s;
  const trip = s.for === 'trip';
  return sheetFrame('place-title', `
      <h2 id="place-title" class="sheet-title">${trip ? 'Where to?' : 'Where is it?'}</h2>
      <p class="muted lede">${trip ? 'Picks follow the weather there.' : 'Picks follow the weather there. Your own location stays as it is.'}</p>
      ${home ? `<button class="btn secondary block place-home" data-action="place-home">${icon.pin}<span>${esc(trip ? `Here, in ${home.name}` : `Back to ${home.name}`)}</span></button><div class="or"><span>or</span></div>` : ''}
      <form class="search-form" data-form="place-search">
        <label class="filter big">${icon.search}<input type="search" name="q" data-field="place-search" placeholder="Search a city" autocomplete="off" value="${esc(query)}" aria-label="City" enterkeyhint="search"></label>
      </form>
      ${error ? `<p class="error">${esc(error)}</p>` : ''}
      <div class="city-slot" aria-live="polite">${placeResultsHTML(s, recent)}</div>`);
}

// Recent places, without your own (it has its own button).
const recentPlaces = () => loadRecent().filter(r => !samePlace(r, state.loc));

export const sheets = {
  'wear-place': s => placeSheetHTML(s, recentPlaces(), state.loc),
};

// As you type, like the location sheet: only the results re-render, so the
// field keeps focus; a newer query makes older answers stale.
let seq = 0;
let timer;
async function search(query) {
  const mine = ++seq;
  const sheet = state.sheet;
  if (sheet?.kind !== 'wear-place') return;
  Object.assign(sheet, { query, error: '' });
  if (query.length < 2) {
    Object.assign(sheet, { results: null, busy: false });
  } else {
    sheet.busy = true;
    try {
      const results = await searchCities(query);
      if (mine !== seq || state.sheet !== sheet) return;
      sheet.results = results;
    } catch (err) {
      if (mine !== seq || state.sheet !== sheet) return;
      sheet.error = err.message;
    }
    sheet.busy = false;
  }
  const slot = document.querySelector('#sheet .city-slot');
  if (slot) slot.innerHTML = sheet.error ? `<p class="error">${esc(sheet.error)}</p>` : placeResultsHTML(sheet, recentPlaces());
}

// Hands the place to the pane that asked, renders it, then closes the sheet
// (focus goes back to the control that opened it).
function take(place, app) {
  const who = state.sheet?.for;
  if (!place || !takers[who]) return;
  takers[who]({ name: place.name, region: place.region ?? '', lat: place.lat, lon: place.lon }, app);
  app.renderPage();
  app.closeSheet();
}

/**
 * Renders the pane again after an await (weather that arrived), keeping
 * keyboard focus on the control it was on, as render() does, or on the
 * element with its id (a heading that took focus).
 */
export function repaint(app) {
  const focused = document.activeElement;
  app.renderPage();
  if (!focused || focused === document.body || focused.isConnected) return;
  if (!app.refocus(focused, '#app') && focused.id) document.getElementById(focused.id)?.focus({ preventScroll: true });
}

// ---------- Dates ----------

/**
 * A pill that shows a date in words, with a native date input laid over it:
 * a tap or click opens the system's picker, and a keyboard reaches one
 * button (a date input would take three Tab stops, one per part) that opens
 * the same picker. { field: the input's data-field (fires on change),
 * value, min, max, text, label: what the button says it sets, name? }
 */
export function datePillHTML({ field, value, min = '', max = '', text, label, name = '' }) {
  return `<span class="date-pill">
    <button type="button" class="date-pill-btn" data-action="date-open" data-for="${esc(field)}" aria-label="${esc(`${label}: ${text}. Change`)}">${icon.calendar}<span>${esc(text)}</span></button>
    <input type="date"${name ? ` name="${esc(name)}"` : ''} data-field="${esc(field)}" data-action="date-open" value="${esc(value)}"${min ? ` min="${esc(min)}"` : ''}${max ? ` max="${esc(max)}"` : ''} tabindex="-1" aria-hidden="true" required>
  </span>`;
}

export const actions = {
  'place-home': (el, app) => take(state.loc, app),
  'place-recent': (el, app) => take(recentPlaces()[+el.dataset.value], app),
  'place-city': (el, app) => take(state.sheet?.results?.[+el.dataset.value], app),
  // A date pill's picker, from its button (keyboards) or its input (a click
  // anywhere on it: desktop Chromium otherwise opens it from its small icon
  // only). Without showPicker, the field itself takes focus.
  'date-open'(el) {
    const input = el.matches('input') ? el : el.parentElement.querySelector('input[type="date"]');
    try {
      input.showPicker();
    } catch {
      if (el !== input) input.focus(); // no showPicker, or it's open already
    }
  },
};

export const forms = {
  async 'place-search'(data) {
    clearTimeout(timer);
    const query = String(data.get('q') ?? '').trim();
    if (query) await search(query);
    document.querySelector('#sheet [data-action="place-city"]')?.focus();
  },
};

export const fields = {
  'place-search'(el) {
    clearTimeout(timer);
    const query = el.value.trim();
    timer = setTimeout(() => search(query), query.length < 2 ? 0 : 280);
  },
};
