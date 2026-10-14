// Settings (#/settings, behind the gear): location, units, theme, which list
// is ranked and sharing it, the journal export, and where the data comes
// from. Also the location sheet. Styles: src/css/shell.css (.set-*).
import { loadRecent, deviceLocation, searchCities } from '../location.js';
import { setTheme, theme } from '../theme.js';
import { esc, plural, setUnits } from '../ui.js';
import { icon, segHTML, sheetFrame } from '../ui/components.js';
import { state, savePrefs, activeFragrances, sourceRecords } from '../app/state.js';

// The credits every page carries in its footer, and Settings in full.
export function creditsHTML({ fetched = null, scraped = false, fragella = false }) {
  const sources = [
    scraped && `Fragrantica (synced ${esc(fetched)})`,
    'Fragrantica via <a href="https://www.kaggle.com/datasets/ledecanteur/fragrantica-perfumes" target="_blank" rel="noopener">Le Decanteur’s dataset</a> (<a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noopener">CC BY-NC-SA</a>)',
    fragella && '<a href="https://api.fragella.com" target="_blank" rel="noopener">Fragella</a>',
  ].filter(Boolean).join(' · ');
  return `<span>Fragrance data: ${sources}</span><span>Forecast by <a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo</a></span>`;
}

const group = (title, rows) => `<section class="set-group" aria-labelledby="set-${title.toLowerCase().replace(/\W+/g, '-')}">
    <h2 id="set-${title.toLowerCase().replace(/\W+/g, '-')}">${esc(title)}</h2>
    <div class="set-rows">${rows}</div>
  </section>`;
const row = (label, control, { glyph = '', note = '' } = {}) => `<div class="set-row">
    <span class="set-label">${glyph}<span class="set-text">${label}${note ? `<small>${note}</small>` : ''}</span></span>${control}
  </div>`;

export function settingsHTML({ loc, units, themeName, active, mineCount, shared, on, total, wears, updated, stale, credits }) {
  return `
    ${group('Weather', `
      ${row(loc ? esc(loc.name) : 'Not set', '<button class="btn secondary compact" data-action="location">Change</button>', { glyph: icon.pin, note: loc?.region ? esc(loc.region) : '' })}
      ${row('Forecast', '<button class="btn tertiary compact" data-action="refresh">Refresh</button>', { glyph: icon.refresh, note: updated ? `${stale ? 'Offline · ' : ''}Updated ${esc(updated)}` : '' })}
    `)}
    ${group('Display', `
      ${row('Temperature', segHTML([{ value: 'F', label: '°F', on: units === 'F' }, { value: 'C', label: '°C', on: units === 'C' }], { action: 'units', label: 'Temperature units' }))}
      ${row('Theme', segHTML([{ value: 'default', label: 'Default', on: themeName === 'default' }, { value: 'gruvbox', label: 'Gruvbox', on: themeName === 'gruvbox' }], { action: 'theme', label: 'Theme' }))}
    `)}
    ${group('Collection', `
      ${shared ? `<p class="notice">Viewing ${esc(shared.name ? `${shared.name}’s` : 'a shared')} collection from a link. Picking a list closes it.</p>` : ''}
      ${row('Ranking from', segHTML([{ value: 'demo', label: 'David’s', on: !shared && active === 'demo' }, { value: 'mine', label: `Mine · ${mineCount}`, on: !shared && active === 'mine' }], { action: 'collection', label: 'Collection' }))}
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
      <p class="muted lede">Used only to fetch your local forecast from Open-Meteo.</p>
      <button class="btn primary block" data-action="geo" ${locating ? 'disabled' : ''}>${locating ? '<span class="spinner small" aria-hidden="true"></span>' : icon.pin}<span>${locating ? 'Locating…' : 'Use my location'}</span></button>
      <div class="or"><span>or</span></div>
      <form class="search-form" data-form="city">
        <label class="filter big">${icon.search}<input type="search" name="q" data-field="city" placeholder="Search a city" autocomplete="off" value="${esc(query)}" aria-label="City" enterkeyhint="search"></label>
      </form>
      ${error ? `<p class="error">${esc(error)}</p>` : ''}
      <div class="city-slot" aria-live="polite">${cityResultsHTML(s, recent)}</div>`);
}

export const sheets = {
  location: s => locationSheetHTML(s, loadRecent()),
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
      sheet.error = err.message;
    }
    sheet.busy = false;
  }
  const slot = document.querySelector('#sheet .city-slot');
  if (slot) slot.innerHTML = sheet.error ? `<p class="error">${esc(sheet.error)}</p>` : cityResultsHTML(sheet, loadRecent());
}

export const actions = {
  location(el, app) {
    app.openSheet({ kind: 'location' });
  },
  async geo(el, app) {
    app.updateSheet({ locating: true, error: '' });
    try {
      await app.setLocation(await deviceLocation());
    } catch (err) {
      app.updateSheet({ locating: false, error: err.message });
    }
  },
  async recent(el, app) {
    const r = loadRecent()[+el.dataset.value];
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
    setTheme(el.dataset.value);
    savePrefs();
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
