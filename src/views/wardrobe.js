// Wardrobe: the bottles you own (rotation switches, which list is ranked,
// adding and sharing), the ones you want (src/views/wardrobe/wishlist.js),
// what you wore (the journal), and Insights: what the wardrobe still needs
// (src/views/wardrobe/insights.js). Also the add, paste and add-it-yourself
// sheets. Styles: src/css/wardrobe.css.
import { ACCORDS } from '../accords.js';
import { SEASONS } from '../engine.js';
import { setHidden } from '../hidden.js';
import { saveMine, shareURL, localMatches, nameMatches, importLines, MAX_IMPORT_LINES } from '../collections.js';
import { customRecord, MAX_CUSTOM_ACCORDS } from '../custom.js';
import { clearHistory, journalExport } from '../history.js';
import { esc, plural, shortDate, relativeDay } from '../ui.js';
import {
  icon, img, messageHTML, rowHTML, switchHTML, segHTML, sheetFrame, sharedBannerHTML, accordColor, sectionHead,
} from '../ui/components.js';
import {
  state, activeFragrances, hiddenIn, viewingDemo, knownBottles, findRecord, journalData, library, findBottles,
  fullRecords, collectionLabel,
} from '../app/state.js';
import { warmPool } from '../app/pool.js';
import * as insights from './wardrobe/insights.js';
import * as wishlist from './wardrobe/wishlist.js';

// ---------- Owned ----------

function ownedRow(f, { hidden, removable }) {
  const on = !hidden.has(f.id);
  const trailing = `${removable ? `<button class="icon-btn ghosted" data-action="remove" data-id="${esc(f.id)}" aria-label="Remove ${esc(f.name)}">${icon.remove}</button>` : ''}
    ${switchHTML({ on, label: `Include ${f.name} in picks`, action: 'rotation', id: f.id })}`;
  return rowHTML(f, { meta: esc(f.brand), open: { ctx: '' }, trailing, cls: on ? '' : 'off', attrs: ` data-name="${esc(`${f.name} ${f.brand}`.toLowerCase())}"` });
}

/**
 * The owned list. tab: 'demo' | 'mine' | null (a shared link is open, and
 * its list shows). hidden: the ids switched off in that list. confirm: Save
 * as mine is waiting for its second tap.
 */
export function ownedHTML({ tab, demo, mine, shared, hidden, filter = '', confirm = false }) {
  const list = shared ? shared.records : tab === 'mine' ? mine.records : demo;
  const on = list.filter(f => !hidden.has(f.id)).length;
  const switcher = segHTML([
    { value: 'demo', label: 'David’s wardrobe', on: tab === 'demo' },
    { value: 'mine', label: `Mine · ${mine.records.length}`, on: tab === 'mine' },
  ], { action: 'collection', label: 'Collection', cls: 'wide' });
  const actions = shared ? ''
    : tab === 'mine'
    ? `<div class="action-row">
        <button class="btn primary" data-action="add">${icon.plus}<span>Add bottles</span></button>
        <button class="btn secondary" data-action="import">${icon.paste}Paste a list</button>
        <button class="btn tertiary" data-action="custom">${icon.pen}Add it yourself</button>
      </div>`
    : '<p class="muted small">David’s own shelf. Switch to Mine to add yours.</p>';
  const share = list.length && !shared
    ? `<button class="btn tertiary compact" data-action="share" aria-label="Share ${tab === 'mine' ? 'my collection' : 'this wardrobe'}">${icon.share}Share</button>`
    : '';
  const name = tab === 'mine' && !shared
    ? `<label class="name-field">Name on share links
        <input type="text" data-field="mine-name" value="${esc(mine.name)}" placeholder="e.g. Alex" maxlength="40" autocomplete="off">
      </label>`
    : '';
  // The filter sticks under the sub-navigation while the list scrolls.
  const search = list.length > 8
    ? `<div class="owned-filter"><label class="filter">${icon.search}<input type="search" data-field="collection-filter" placeholder="Filter ${list.length} bottles" value="${esc(filter)}" autocomplete="off" aria-label="Filter bottles"></label></div>`
    : '';
  const body = list.length
    ? `<p class="muted list-note">${on} of ${list.length} in rotation. Switch a bottle off to leave it out of picks on this device.</p>${search}
       <ul class="rows owned-list">${list.map(f => ownedRow(f, { hidden, removable: tab === 'mine' && !shared })).join('')}</ul>
       <p class="muted small filter-empty" hidden>No bottles match.</p>`
    : messageHTML({ glyph: icon.bottle, title: 'No bottles yet', body: 'Search for what you own, or paste a list.' });
  return `${shared ? sharedBannerHTML(shared, mine.records.length, { confirm }) : ''}
    <section class="card owned" aria-labelledby="owned-title">
      ${sectionHead(shared ? 'In this link' : 'Ranking from', share, { id: 'owned-title' })}
      ${shared ? '<p class="notice">Picking a list below closes the shared one you’re viewing.</p>' : ''}
      ${switcher}
      ${actions}
      ${name}
      ${body}
    </section>`;
}

function ownedPane() {
  return ownedHTML({
    tab: state.shared ? null : state.active,
    demo: state.demo?.fragrances ?? [],
    mine: state.mine,
    shared: state.shared,
    hidden: hiddenIn(viewingDemo()),
    filter: state.ownedFilter ?? '',
    confirm: state.armed === 'shared-save',
  });
}

// Filters the owned rows in place, so typing keeps focus.
function applyFilter() {
  const q = (state.ownedFilter ?? '').trim().toLowerCase();
  const rows = document.querySelectorAll('.owned-list li[data-name]');
  let shown = 0;
  rows.forEach(li => {
    const hit = !q || li.dataset.name.includes(q);
    li.hidden = !hit;
    if (hit) shown++;
  });
  const empty = document.querySelector('.owned .filter-empty');
  if (empty) empty.hidden = shown > 0 || !rows.length;
}

// ---------- Worn (the journal) ----------

export function wornHTML({ stats, calendar, dusty, todayISO }, resolve, { confirmClear = false } = {}) {
  if (!stats.wears && !stats.lastWorn.size) {
    return messageHTML({ glyph: icon.journal, title: 'Nothing logged yet', body: 'Tap Wear this on a pick and it shows up here, on a calendar with your most-worn bottles.',
      action: '<a class="btn primary" href="#/wear/now"><span>See today’s picks</span></a>' });
  }
  const top = stats.top.map(([id, n]) => [resolve(id), n]).filter(([f]) => f).slice(0, 5);
  const most = top[0];
  const peak = most?.[1] ?? 1;
  const tiles = `<div class="stat-tiles">
    <div class="stat"><b>${stats.wears}</b><span>wears</span></div>
    <div class="stat"><b>${stats.bottles}</b><span>bottles</span></div>
    <div class="stat wide">${most ? `${img(most[0])}<span><b class="name">${esc(most[0].name)}</b><span>most worn · ${most[1]}×</span></span>` : '<span><b class="name">—</b><span>most worn</span></span>'}</div>
  </div>`;
  const weekdays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(d => `<span class="cal-dow" aria-hidden="true">${d}</span>`).join('');
  const cells = calendar.flat().map(c => {
    const worn = [c.day, c.night].map(h => h && resolve(h.id)).filter(Boolean);
    const day = +c.dateISO.slice(8, 10);
    // The day and what was worn, said in full for screen readers (the grid
    // shows a number and photos).
    const label = worn.length ? `${shortDate(c.dateISO)}: ${worn.map(f => f.name).join(', ')}` : shortDate(c.dateISO);
    return `<span class="cal-cell${c.future ? ' future' : ''}${c.dateISO === todayISO ? ' today' : ''}${worn.length ? ' has' : ''}" title="${esc(label)}">
      <small aria-hidden="true">${day === 1 ? esc(shortDate(c.dateISO)) : day}</small><span class="visually-hidden">${esc(label)}</span>
      <span class="cal-bottles">${worn.map(f => img(f)).join('')}</span>
    </span>`;
  }).join('');
  const mostList = top.length
    ? `<ul class="rank-list">${top.map(([f, n]) => `<li>${img(f)}<span class="row-text"><b>${esc(f.name)}</b><small>${esc(f.brand)}</small></span>
        <span class="rank-bar"><span style="width:${((n / peak) * 100).toFixed(0)}%"></span></span><span class="rank-n">${n}×</span></li>`).join('')}</ul>`
    : '<p class="muted small">Nothing logged in the last 30 days.</p>';
  const dustList = dusty.length
    ? `<ul class="dust-list">${dusty.map(({ f, last }) => `<li><button data-action="open" data-ctx="" data-id="${esc(f.id)}">${img(f)}<span><b>${esc(f.name)}</b><small>${last ? `Last worn ${esc(relativeDay(last, todayISO))}` : 'Not worn yet'}</small></span></button></li>`).join('')}</ul>`
    : '<p class="muted small">Every bottle in rotation got worn this month. Nice.</p>';
  return `<section class="card journal" aria-labelledby="journal-title">
    ${sectionHead('Last 30 days', '', { id: 'journal-title' })}
    ${tiles}
    <section><h3>Calendar</h3><div class="calendar">${weekdays}${cells}</div></section>
    <section><h3>Most worn</h3>${mostList}</section>
    <section><h3>Gathering dust</h3>${dustList}</section>
    <div class="action-row end">
      <button class="btn secondary" data-action="journal-export">${icon.download}Export</button>
      <button class="btn ${confirmClear ? 'secondary danger' : 'tertiary'}" data-action="journal-clear">${icon.remove}${confirmClear ? 'Tap again to clear' : 'Clear history'}</button>
    </div>
    <p class="muted small">Logged with “Wear this”. History stays on this device; Export saves it as a file.</p>
  </section>`;
}

// Each pane has its own heading, so a screen reader landing on it hears where
// it is. Every pane starts the suggestion pool loading (warmPool), so it's in
// by the time Insights or the Wishlist asks.
export const wardrobe = {
  id: 'wardrobe',
  label: 'Wardrobe',
  icon: 'wardrobe',
  panes: [
    {
      id: 'owned', label: 'Owned', title: () => 'Owned', heading: () => collectionLabel(), render: ownedPane,
      after() { applyFilter(); warmPool(); },
    },
    wishlist.wishlistPaneDef,
    {
      id: 'worn', label: 'Worn', title: () => 'Worn', heading: () => 'Wear journal',
      render: () => wornHTML(journalData(), findRecord, { confirmClear: state.armed === 'journal-clear' }), after: () => warmPool(),
    },
    insights.insightsPaneDef,
  ],
};

// ---------- Sheets ----------

function resultRow(r, i, added) {
  const meta = [r.brand, r.year].filter(Boolean).map(esc).join(' · ');
  const trailing = `<button class="btn secondary compact${added ? ' on' : ''}" data-action="add-result" data-value="${i}" ${added ? 'disabled' : ''} aria-label="${added ? 'Added' : 'Add'} ${esc(r.name)}">${added ? `${icon.check}Added` : `${icon.plus}Add`}</button>`;
  return rowHTML(r, { meta, trailing });
}

const handAdd = label => `<button class="link-btn" data-action="custom">${label}</button>`;

export function addSheetHTML({ query = '', results = null, busy = false, error = '' }, ownedIds) {
  const list = results === null ? ''
    : results.length === 0 ? `<p class="muted small">No matches for “${esc(query)}”. Check the spelling, or ${handAdd('add it yourself')}.</p>`
    : `<ul class="rows results">${results.map((r, i) => resultRow(r, i, ownedIds.has(r.id))).join('')}</ul>`;
  return sheetFrame('add-title', `
      <h2 id="add-title" class="sheet-title">Add bottles</h2>
      <p class="muted lede">Search every fragrance on Fragrantica. Brand plus name works best.</p>
      <form class="search-form" data-form="search">
        <label class="filter big">${icon.search}<input type="search" name="q" placeholder="e.g. Dior Sauvage" autocomplete="off" value="${esc(query)}" aria-label="Fragrance" enterkeyhint="search"></label>
        <button type="submit" class="btn primary" ${busy ? 'disabled' : ''}>${busy ? '<span class="spinner small" aria-hidden="true"></span>Searching' : 'Search'}</button>
      </form>
      ${error ? `<p class="error">${esc(error)}</p>` : ''}
      ${list}
      <div class="sheet-bar${results?.length ? ' spread' : ''}">
        ${results?.length && !busy ? `<span class="muted">Not listed? ${handAdd('Add it yourself')}</span>` : ''}
        <button class="btn secondary" data-action="close-sheet">Done</button>
      </div>`);
}

export function importSheetHTML({ text = '', rows = null, busy = false, error = '' }, maxLines) {
  let body;
  if (!rows) {
    body = `<form class="import-form" data-form="import">
        <textarea name="text" rows="8" placeholder="Dior Sauvage&#10;Liquid Brun&#10;Khadlaj Cream Velvet" aria-label="Fragrance list">${esc(text)}</textarea>
        <button class="btn primary block" type="submit">Find matches</button>
      </form>`;
  } else {
    const picked = rows.filter(r => r.match && r.checked).length;
    body = `<ul class="rows import-rows">${rows.map((r, i) => {
      if (r.status === 'pending') return `<li class="row pending"><span class="row-main"><span class="spinner" aria-hidden="true"></span><span class="row-text"><b>${esc(r.line)}</b><small>Looking…</small></span></span></li>`;
      if (!r.match) return `<li class="row"><span class="row-main"><span class="miss">?</span><span class="row-text"><b>${esc(r.line)}</b><small>${esc(r.note || 'Not found')}</small></span></span>
        <button class="btn secondary compact" data-action="custom-row" data-value="${i}">${icon.plus}Add it yourself</button></li>`;
      const meta = r.weak
        ? `${esc(r.match.brand)} · Closest match for “${esc(r.line)}”. Not it? <button class="link-btn" data-action="custom-row" data-value="${i}">Add it yourself</button>`
        : [r.match.brand, `for “${r.line}”`].filter(Boolean).map(esc).join(' · ');
      const check = `<button class="check${r.checked ? ' on' : ''}" role="checkbox" aria-checked="${r.checked}" data-action="import-toggle" data-value="${i}" aria-label="Add ${esc(r.match.name)}">${icon.check}</button>`;
      return rowHTML(r.match, { meta, trailing: check, cls: r.weak ? 'wrap' : '' });
    }).join('')}</ul>
    <div class="sheet-bar">
      <button class="btn tertiary" data-action="import" ${busy ? 'disabled' : ''}>Start over</button>
      <button class="btn primary" data-action="import-confirm" ${busy || !picked ? 'disabled' : ''}>${icon.plus}<span>Add ${plural(picked, 'bottle')}</span></button>
    </div>`;
  }
  return sheetFrame('import-title', `
      <h2 id="import-title" class="sheet-title">Paste a list</h2>
      <p class="muted lede">One fragrance per line, up to ${maxLines} at a time. Copy it from your notes or your Fragrantica wardrobe page.</p>
      ${error ? `<p class="error">${esc(error)}</p>` : ''}
      ${body}`);
}

const TIMES = [['day', 'Day'], ['night', 'Night'], ['both', 'Day & night']];

// A bottle no database has. Chips run from rich to fresh, as in ACCORDS.
export function customSheetHTML({ name = '', brand = '', accords = [], seasons = [], time = null, error = '', back = null }, maxAccords) {
  const accordChip = a => {
    const rank = accords.indexOf(a);
    const full = rank < 0 && accords.length >= maxAccords;
    return `<button type="button" class="pick-chip${rank >= 0 ? ' on' : ''}" style="--c:${accordColor(a)}" data-action="accord" data-value="${esc(a)}" aria-pressed="${rank >= 0}"${full ? ' disabled' : ''}>${rank >= 0 ? `<b>${rank + 1}</b>` : ''}${esc(a)}</button>`;
  };
  const cap = s => s[0].toUpperCase() + s.slice(1);
  return sheetFrame('custom-title', `
      <h2 id="custom-title" class="sheet-title">Add it yourself</h2>
      <p class="muted lede">For bottles no database has. Picks work from the accords you choose. Fragrantica or the brand’s site usually lists them.</p>
      <form class="custom-form" data-form="custom" novalidate>
        <label class="name-field">Name
          <input type="text" name="name" data-field="custom-name" value="${esc(name)}" maxlength="80" autocomplete="off" enterkeyhint="next">
        </label>
        <label class="name-field">Brand
          <input type="text" name="brand" data-field="custom-brand" value="${esc(brand)}" maxlength="80" autocomplete="off" placeholder="Optional">
        </label>
        <fieldset>
          <legend>Main accords, strongest first <span>${accords.length} of ${maxAccords}</span></legend>
          <div class="pick-chips">${Object.keys(ACCORDS).map(accordChip).join('')}</div>
        </fieldset>
        <fieldset>
          <legend>When do you wear it? <span>Optional</span></legend>
          <div class="when">
            ${segHTML(SEASONS.map(s => ({ value: s, label: cap(s), on: seasons.includes(s) })), { action: 'season', label: 'Seasons' })}
            ${segHTML(TIMES.map(([t, label]) => ({ value: t, label, on: time === t })), { action: 'time', label: 'Time of day' })}
          </div>
        </fieldset>
        ${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}
        <div class="sheet-bar">
          ${back ? '<button class="btn secondary" type="button" data-action="custom-back">Back</button>' : ''}
          <button class="btn primary" type="submit">${icon.plus}<span>${back?.kind === 'import' ? 'Use for this line' : 'Add to my collection'}</span></button>
        </div>
      </form>`);
}

export const sheets = {
  add: s => addSheetHTML(s, new Set(state.mine.records.map(r => r.id))),
  import: s => importSheetHTML(s, MAX_IMPORT_LINES),
  custom: s => customSheetHTML(s, MAX_CUSTOM_ACCORDS),
  ...insights.sheets,
};

// ---------- Search, paste, enter by hand ----------

// After the await, the answer goes only to the Add sheet that asked.
async function runSearch(app, query) {
  app.updateSheet({ query, busy: true, error: '' });
  const current = () => state.sheet?.kind === 'add' && state.sheet.query === query;
  try {
    // Offline, the bottles on this device still answer, with the error.
    const { results, error } = await findBottles(query);
    if (current()) app.updateSheet({ results: results.length || !error ? results : null, busy: false, error });
  } catch (err) {
    if (current()) app.updateSheet({ busy: false, error: err.message });
  }
}

async function runImport(app, text) {
  const lines = importLines(text);
  if (!lines.length) return app.updateSheet({ text, error: 'Paste at least one fragrance name.' });
  const job = {};
  const rows = lines.map(l => ({ ...l, status: 'pending', match: null, checked: false, weak: false }));
  app.updateSheet({ text, job, rows, busy: true, error: '' });
  let stopped = '';
  for (const [i, { line }] of lines.entries()) {
    let found;
    const local = localMatches(line, knownBottles(), 1)[0];
    if (local) found = { match: local, checked: true };
    else if (stopped) found = { note: stopped };
    else {
      try {
        // Search answers with near misses too ("Caramello" for "Caramellino"),
        // so a hit whose name wasn't typed is offered unticked.
        const hits = await library.search(line);
        const hit = hits.find(r => nameMatches(line, r));
        found = { match: hit ?? hits[0] ?? null, checked: Boolean(hit), weak: !hit && hits.length > 0 };
      } catch (err) {
        stopped = err.message;
        found = { note: err.message };
      }
    }
    if (!patchImport(app, job, { row: i, patch: { ...found, status: 'done' } })) return;
  }
  patchImport(app, job, { busy: false });
}

// The list keeps filling in while "Add it yourself" is open over it: each
// result lands in whichever copy of this import sheet is current (the open
// one, or the one the custom sheet returns to), one row at a time, so ticks
// and hand-entered rows made meanwhile stay. False once the list is gone.
function patchImport(app, job, { row = -1, patch = {}, busy }) {
  const s = state.sheet;
  const target = s?.kind === 'import' && s.job === job ? s
    : s?.kind === 'custom' && s.back?.kind === 'import' && s.back.job === job ? s.back
    : null;
  if (!target) return false;
  const next = { rows: target.rows.map((r, i) => (i === row ? { ...r, ...patch } : r)) };
  if (busy !== undefined) next.busy = busy;
  if (target === s) app.updateSheet(next);
  else s.back = { ...target, ...next };
  return true;
}

// A bottle entered by hand, opened from Owned, Add bottles or an unmatched
// row of a pasted list (`row`); `back` is the sheet to return to.
function customSheet({ name = '', brand = '', row = null }) {
  return { kind: 'custom', name, brand, accords: [], seasons: [], time: null, error: '', back: state.sheet, row };
}

function saveCustom(app, name, brand) {
  const s = state.sheet;
  if (!name) return app.updateSheet({ name, brand, error: 'Give it a name.' });
  if (!s.accords.length) return app.updateSheet({ name, brand, error: 'Pick at least one accord.' });
  const record = customRecord({ name, brand, accords: s.accords, seasons: s.seasons, time: s.time });
  if (!record) return app.updateSheet({ name, brand, error: 'Pick at least one accord.' });
  if (s.back?.kind === 'import') {
    // Fills that row of the pasted list, ticked; the list's Add button saves it.
    const rows = s.back.rows.map((r, i) => (i === s.row ? { ...r, match: record, checked: true, weak: false, note: '' } : r));
    return app.openSheet({ ...s.back, rows });
  }
  app.addToMine(record);
  if (s.back) app.openSheet(s.back);
  else app.closeSheet();
  app.render();
  app.showToast(`<span>${esc(record.name)} added to your collection</span>`);
}

async function share(app) {
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
    app.showToast('<span>Share link copied</span>');
  } catch (err) {
    if (err?.name !== 'AbortError') app.showToast(`<span>Copy this link: ${esc(url)}</span>`);
  }
}

// ---------- Actions ----------

export const actions = {
  // A rotation switch: in or out of picks, in the list on screen.
  rotation(el, app) {
    const id = el.dataset.id;
    const isDemo = viewingDemo();
    setHidden(state.hiding, id, !hiddenIn(isDemo).has(id), isDemo);
    app.keepingFocus(el, '#app', app.render);
  },
  remove(el, app) {
    const index = state.mine.records.findIndex(r => r.id === el.dataset.id);
    if (index < 0) return;
    const [removed] = state.mine.records.splice(index, 1);
    saveMine(state.mine);
    state.lastRemoved = { record: removed, index };
    app.render();
    app.showToast(`<span>${esc(removed.name)} removed</span><button class="btn primary compact" data-action="undo-remove">Undo</button>`);
  },
  'undo-remove'(el, app) {
    if (!state.lastRemoved) return;
    const { record, index } = state.lastRemoved;
    state.mine.records.splice(index, 0, record);
    state.lastRemoved = null;
    saveMine(state.mine);
    app.render();
    app.hideToast();
  },
  // Which list is ranked: David's wardrobe or Mine.
  collection(el, app) {
    app.setActive(el.dataset.value);
    app.keepingFocus(el, '#app', app.render);
  },
  add(el, app) {
    app.openSheet({ kind: 'add' });
  },
  async 'add-result'(el, app) {
    const hit = state.sheet?.results?.[+el.dataset.value];
    if (!hit) return;
    let record;
    try {
      [record] = await fullRecords([hit]);
    } catch (err) {
      return app.updateSheet({ error: err.message });
    }
    if (!record) return app.updateSheet({ error: `Couldn’t load ${hit.name}. Try again.` });
    app.addToMine(record);
    app.render();
    app.keepingFocus(el, '#sheet', () => app.renderSheet({ keepScroll: true }));
    app.showToast(`<span>${esc(record.name)} added to your collection</span>`);
  },
  import(el, app) {
    app.openSheet({ kind: 'import', text: state.sheet?.kind === 'import' ? state.sheet.text : '' });
  },
  'import-toggle'(el, app) {
    const rows = state.sheet.rows.map((r, i) => (i === +el.dataset.value ? { ...r, checked: !r.checked } : r));
    app.keepingFocus(el, '#sheet', () => app.updateSheet({ rows }));
  },
  async 'import-confirm'(el, app) {
    let picked;
    try {
      picked = await fullRecords(state.sheet.rows.filter(r => r.match && r.checked).map(r => r.match));
    } catch (err) {
      return app.updateSheet({ error: err.message });
    }
    picked.forEach(app.addToMine);
    // Navigating waits for the sheet's history entry to go (src/app/sheets.js).
    app.closeSheet({ then: () => app.navigate('#/wardrobe/owned') });
    app.render();
    app.showToast(`<span>Added ${plural(picked.length, 'bottle')}</span>`);
  },
  custom(el, app) {
    app.openSheet(customSheet({ name: state.sheet?.query ?? '' }));
  },
  'custom-row'(el, app) {
    const row = state.sheet.rows[+el.dataset.value];
    app.openSheet(customSheet({ name: row.name, brand: row.brand, row: +el.dataset.value }));
  },
  'custom-back'(el, app) {
    app.openSheet(state.sheet.back);
  },
  accord(el, app) {
    const s = state.sheet;
    const a = el.dataset.value;
    const accords = s.accords.includes(a) ? s.accords.filter(x => x !== a) : [...s.accords, a].slice(0, MAX_CUSTOM_ACCORDS);
    app.keepingFocus(el, '#sheet', () => app.updateSheet({ accords, error: '' }));
  },
  season(el, app) {
    const s = state.sheet;
    const v = el.dataset.value;
    app.keepingFocus(el, '#sheet', () => app.updateSheet({ seasons: s.seasons.includes(v) ? s.seasons.filter(x => x !== v) : [...s.seasons, v] }));
  },
  time(el, app) {
    app.keepingFocus(el, '#sheet', () => app.updateSheet({ time: state.sheet.time === el.dataset.value ? null : el.dataset.value }));
  },
  share: (el, app) => share(app),
  'shared-save'(el, app) {
    const s = state.shared;
    if (!s || s.loading) return;
    if (state.mine.records.length && state.armed !== 'shared-save') {
      state.armed = 'shared-save';
      app.keepingFocus(el, '#app', app.renderPage);
      return;
    }
    state.armed = null;
    state.mine = { name: state.mine.name, records: s.records };
    saveMine(state.mine);
    app.setActive('mine');
    app.render();
    app.showToast('<span>Saved as your collection</span>');
  },
  'shared-close'(el, app) {
    app.closeShared();
    app.render();
  },
  // With your own ratings and skin nudges (src/skin.js), for journal-check.
  async 'journal-export'() {
    const { loadSkin } = await import('../skin.js');
    const data = journalExport(state.history, state.loc, hiddenIn(true), { skin: loadSkin() });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = `scentcast-journal-${data.exported.slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  'journal-clear'(el, app) {
    if (state.armed !== 'journal-clear') {
      state.armed = 'journal-clear';
      return app.keepingFocus(el, '#app', app.renderPage);
    }
    state.armed = null;
    state.history = clearHistory();
    app.render();
    app.showToast('<span>Wear history cleared</span>');
  },
  ...insights.actions,
  ...wishlist.actions,
};

export const forms = {
  async search(data, app) {
    const query = String(data.get('q') ?? '').trim();
    if (query.length < 3) return app.updateSheet({ query, error: 'Type at least 3 letters.' });
    await runSearch(app, query);
  },
  import: (data, app) => runImport(app, String(data.get('text') ?? '')),
  custom: (data, app) => saveCustom(app, String(data.get('name') ?? '').trim(), String(data.get('brand') ?? '').trim()),
};

export const fields = {
  'collection-filter'(el) {
    state.ownedFilter = el.value;
    applyFilter();
  },
  // Kept in state so a re-render (tapping an accord) doesn't wipe the typing.
  'custom-name'(el) { if (state.sheet?.kind === 'custom') state.sheet.name = el.value; },
  'custom-brand'(el) { if (state.sheet?.kind === 'custom') state.sheet.brand = el.value; },
};

// Fields saved on change rather than as you type.
export const changes = {
  'mine-name'(el) {
    state.mine.name = el.value.trim().slice(0, 40);
    saveMine(state.mine);
  },
};
