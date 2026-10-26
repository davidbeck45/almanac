// Settings (#/settings, behind the gear): location, units, theme, which list
// is ranked and sharing it, the journal export, and where the data comes
// from. Also the location sheet. Styles: src/css/shell.css (.set-*).
import { loadRecent, deviceLocation, searchCities } from '../location.js';
import { theme } from '../theme.js';
import { esc, plural, setUnits, shortDate } from '../ui.js';
import { icon, segHTML, sheetFrame, switchHTML } from '../ui/components.js';
import { state, savePrefs, activeFragrances, sourceRecords, setStillSky, chooseTheme } from '../app/state.js';
import { samePlace, placesStatus } from './wear/pickers.js';

// "Oct 14" as every date in the app reads, with the year when it isn't this one.
function syncedOn(fetched, now = new Date()) {
  const iso = String(fetched ?? '');
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso) || Number.isNaN(Date.parse(iso.slice(0, 10)))) return esc(iso);
  const year = iso.slice(0, 4);
  return `${shortDate(iso.slice(0, 10))}${year === String(now.getFullYear()) ? '' : `, ${year}`}`;
}

// The credits every page carries in its footer, and Settings in full.
// `scraped`: the list on screen has bottles synced from Fragrantica itself
// (on `fetched`), not only from the dataset. Parfumo's votes (how long a
// bottle lasts and projects, what voters wear it for and layer it with) are
// on screen everywhere, so they're always credited.
export function creditsHTML({ fetched = null, scraped = false, fragella = false }) {
  const dataset = '<a href="https://www.kaggle.com/datasets/ledecanteur/fragrantica-perfumes" target="_blank" rel="noopener">Le Decanteur’s dataset</a> (<a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noopener">CC BY-NC-SA 4.0</a>)';
  const sources = [
    scraped ? `Fragrantica, synced ${syncedOn(fetched)}, and ${dataset}` : `Fragrantica via ${dataset}`,
    fragella && '<a href="https://api.fragella.com" target="_blank" rel="noopener">Fragella</a>',
  ].filter(Boolean).join(' · ');
  return `<span>Fragrance data: ${sources}</span><span>Longevity and sillage from Parfumo’s ratings and Fragrantica’s votes; occasion and layering votes from <a href="https://www.parfumo.com" target="_blank" rel="noopener">Parfumo</a></span><span>Forecast by <a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo</a></span>`;
}

const group = (title, rows) => `<section class="set-group" aria-labelledby="set-${title.toLowerCase().replace(/\W+/g, '-')}">
    <h2 id="set-${title.toLowerCase().replace(/\W+/g, '-')}">${esc(title)}</h2>
    <div class="set-rows">${rows}</div>
  </section>`;
const row = (label, control, { glyph = '', note = '' } = {}) => `<div class="set-row">
    <span class="set-label">${glyph}<span class="set-text">${label}${note ? `<small>${note}</small>` : ''}</span></span>${control}
  </div>`;

export function settingsHTML({ loc, units, themeName, stillSky = false, active, mineCount, shared, on, total, wears, updated, stale, credits }) {
  return `
    ${group('Weather', `
      ${row(loc ? esc(loc.name) : 'Not set', '<button class="btn secondary compact" data-action="location">Change</button>', { glyph: icon.pin, note: loc?.region ? esc(loc.region) : '' })}
      ${row('Forecast', '<button class="btn tertiary compact" data-action="refresh">Refresh</button>', { glyph: icon.refresh, note: updated ? `${stale ? 'Offline · ' : ''}Updated ${esc(updated)}` : '' })}
    `)}
    ${group('Display', `
      ${row('Temperature', segHTML([{ value: 'F', label: '°F', on: units === 'F' }, { value: 'C', label: '°C', on: units === 'C' }], { action: 'units', label: 'Temperature units' }))}
      ${row('Theme', segHTML([{ value: 'default', label: 'Default', on: themeName === 'default' }, { value: 'gruvbox', label: 'Gruvbox', on: themeName === 'gruvbox' }], { action: 'theme', label: 'Theme' }))}
      ${row('Animate the sky', switchHTML({ on: !stillSky, label: 'Animate the sky', action: 'sky-motion', id: 'sky' }), { note: 'Stars, rain and smoke move' })}
    `)}
    ${group('Collection', `
      ${shared ? `<p class="notice">Viewing ${esc(shared.name ? `${shared.name}’s` : 'a shared')} collection from a link. Picking a list closes it.</p>` : ''}
      ${row('Ranking from', segHTML([{ value: 'demo', label: 'David’s wardrobe', on: !shared && active === 'demo' }, { value: 'mine', label: `Mine · ${mineCount}`, on: !shared && active === 'mine' }], { action: 'collection', label: 'Collection' }))}
      ${row(`<a class="set-link" href="#/wardrobe/owned">${on} of ${plural(total, 'bottle')} in rotation</a>`, `<button class="btn tertiary compact" data-action="share" ${on ? '' : 'disabled'}>${icon.share}Share</button>`)}
    `)}
    ${group('Wear journal', `
      ${row(`<a class="set-link" href="#/wardrobe/worn">${plural(wears, 'wear')} logged</a>`, `<button class="btn tertiary compact" data-action="journal-export" ${wears ? '' : 'disabled'}>${icon.download}Export</button>`, { note: 'Stays on this device' })}
    `)}
    ${group('About', `<p class="set-credits">${credits}</p><p class="set-credits">Scentcast picks from your own bottles with the weather, time of day and occasion. Everything you add stays on this device.</p>`)}`;
}

function settingsPage() {
  const all = sourceRecords();
  return settingsHTML({
    loc: state.loc,
    units: state.units,
    themeName: theme(),
    stillSky: state.stillSky,
    active: state.active,
    mineCount: state.mine.records.length,
    shared: state.shared,
    on: activeFragrances().length,
    total: all.length,
    wears: state.history.length,
    updated: state.wx ? new Date(state.wx.fetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '',
    stale: state.wx?.stale,
    credits: creditsHTML({ fetched: state.demo?.fetched, scraped: all.some(f => !f.source) }),
  });
}

export const settings = {
  id: 'settings',
  label: 'Settings',
  icon: 'gear',
  title: () => 'Settings',
  heading: () => 'Settings',
  render: settingsPage,
};

// ---------- Location sheet ----------

// Recent places, without the one you're in (its forecast is on screen).
const recentPlaces = () => loadRecent().filter(r => !samePlace(r, state.loc));

export function cityResultsHTML({ results = null, query = '', busy = false }, recent) {
  if (busy && !results) return '<p class="muted small searching"><span class="spinner small" aria-hidden="true"></span>Searching…</p>';
  if (results === null) {
    if (!recent.length) return '';
    return `<h3 class="list-title">Recent</h3><ul class="city-results">${recent.map((r, i) => `<li><button data-action="recent" data-value="${i}">${icon.clock}<strong>${esc(r.name)}</strong><span>${esc(r.region ?? '')}</span></button></li>`).join('')}</ul>`;
  }
  if (!results.length) return `<p class="muted small">No places match “${esc(query)}”. Try a bigger nearby city.</p>`;
  return `<ul class="city-results">${results.map((r, i) => `<li><button data-action="city" data-value="${i}">${icon.pin}<strong>${esc(r.name)}</strong><span>${esc(r.region)}</span></button></li>`).join('')}</ul>`;
}

export function locationSheetHTML(s = {}, recent = []) {
  const { locating = false, error = '', query = '' } = s;
  return sheetFrame('loc-title', `
      <h2 id="loc-title" class="sheet-title">Where are you?</h2>
      <p class="muted lede">Used to get your forecast and climate from Open-Meteo. Wears you log note roughly where you were, on this device only.</p>
      <button class="btn primary block" data-action="geo"${locating ? ' aria-disabled="true"' : ''}>${locating ? '<span class="spinner small" aria-hidden="true"></span>' : icon.pin}<span>${locating ? 'Locating…' : 'Use my location'}</span></button>
      <div class="or"><span>or</span></div>
      <form class="search-form" data-form="city">
        <label class="filter big">${icon.search}<input type="search" name="q" data-field="city" placeholder="Search a city" autocomplete="off" value="${esc(query)}" aria-label="City" enterkeyhint="search"></label>
      </form>
      ${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}
      <p class="visually-hidden city-status" role="status">${esc(placesStatus({ ...s, error: '' }))}</p>
      <div class="city-slot">${cityResultsHTML(s, recent)}</div>`);
}

export const sheets = {
  location: s => locationSheetHTML(s, recentPlaces()),
};

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
      // The error takes the list's place, so the status doesn't count the last query's places.
      sheet.error = err.message;
      sheet.results = null;
    }
    sheet.busy = false;
  }
  const slot = document.querySelector('#sheet .city-slot');
  if (slot) slot.innerHTML = sheet.error ? `<p class="error" role="alert">${esc(sheet.error)}</p>` : cityResultsHTML(sheet, recentPlaces());
  // (An error speaks for itself, role=alert.)
  const status = document.querySelector('#sheet .city-status');
  if (status) status.textContent = placesStatus({ ...sheet, error: '' });
}

export const actions = {
  location(el, app) {
    app.openSheet({ kind: 'location' });
  },
  // While it looks, the button stays focusable (aria-disabled, "Locating…"),
  // so focus doesn't drop out of the sheet; a second press does nothing. The
  // answer can take ten seconds and a permission prompt: by then the sheet
  // may be gone, or another open. A place still applies (setLocation leaves
  // another sheet alone); an error only says so in this sheet.
  async geo(el, app) {
    if (state.sheet?.locating) return;
    app.updateSheet({ locating: true, error: '' });
    const sheet = state.sheet;
    let place;
    try {
      place = await deviceLocation();
    } catch (err) {
      if (state.sheet === sheet) app.updateSheet({ locating: false, error: err.message });
      return;
    }
    await app.setLocation(place);
  },
  async recent(el, app) {
    const r = recentPlaces()[+el.dataset.value];
    if (r) await app.setLocation(r);
  },
  async city(el, app) {
    const r = state.sheet?.results?.[+el.dataset.value];
    if (r) await app.setLocation({ name: r.name, region: r.region, lat: r.lat, lon: r.lon });
  },
  refresh: (el, app) => app.refreshWeather({ force: true }),
  units(el, app) {
    state.units = el.dataset.value === 'C' ? 'C' : 'F';
    setUnits(state.units);
    savePrefs();
    app.keepingFocus(el, '#app', app.render);
  },
  theme(el, app) {
    chooseTheme(el.dataset.value);
    app.keepingFocus(el, '#app', app.render);
  },
  // The scene's loops (stars, rain, smoke, lightning) can be held still
  // (WCAG 2.2.2); reduced motion holds them anyway.
  'sky-motion'(el, app) {
    setStillSky(!state.stillSky);
    app.keepingFocus(el, '#app', app.render);
  },
};

export const forms = {
  async city(data) {
    clearTimeout(cityTimer);
    const query = String(data.get('q') ?? '').trim();
    if (query) await runCitySearch(query);
    document.querySelector('#sheet [data-action="city"]')?.focus();
  },
};

export const fields = {
  city(el) {
    clearTimeout(cityTimer);
    const query = el.value.trim();
    cityTimer = setTimeout(() => runCitySearch(query), query.length < 2 ? 0 : 280);
  },
};
