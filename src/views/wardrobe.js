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
import { loadSkin } from '../skin.js';
import { esc, plural, shortDate, relativeDay, accordLabel, toastName } from '../ui.js';
import {
  icon, img, messageHTML, rowHTML, switchHTML, segHTML, sheetFrame, sharedBannerHTML, accordColor, sectionHead,
} from '../ui/components.js';
import {
  state, activeFragrances, hiddenIn, viewingDemo, knownBottles, findRecord, journalData, library, findBottles,
  fullRecords, collectionLabel, deviceToday, sourceRecords,
} from '../app/state.js';
import { warmPool } from '../app/pool.js';
import { liveHTML, say, speak } from './wardrobe/parts.js';
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
    ? `<button class="btn tertiary compact" data-action="share" aria-label="Share ${tab === 'mine' ? 'Mine' : 'David’s wardrobe'}">${icon.share}Share</button>`
    : '';
  // Named once there's something to share.
  const name = tab === 'mine' && !shared && mine.records.length
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
       <p class="muted small filter-empty" hidden>No bottles match.</p>${search ? '<p class="visually-hidden" role="status" id="owned-live"></p>' : ''}`
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

// Filters the owned rows in place, so typing keeps focus. Typing (`spoken`)
// also tells screen readers how many are left, once it pauses.
let filterSaid = null;
function applyFilter({ spoken = false } = {}) {
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
  if (!spoken) return;
  clearTimeout(filterSaid);
  filterSaid = setTimeout(() => say('owned-live', shown ? plural(shown, 'bottle') : 'No bottles match'), 400);
}

// The sticky filter draws a band up behind the sub-navigation once it's
// stuck there (.stuck), so the rows scrolling by don't show around it.
let filterWatch = null; // { io, el }
function watchFilter() {
  const el = document.querySelector('#main .owned-filter');
  if (!el || filterWatch?.el === el || !('IntersectionObserver' in window)) return;
  filterWatch?.io.disconnect();
  const top = parseFloat(getComputedStyle(el).top) || 0;
  const stuck = (rect = el.getBoundingClientRect()) => el.classList.toggle('stuck', rect.top <= top + 1);
  stuck();
  const io = new IntersectionObserver(([e]) => stuck(e.boundingClientRect), { rootMargin: `${-Math.ceil(top + 2)}px 0px 0px 0px`, threshold: [0, 1] });
  io.observe(el);
  filterWatch = { io, el };
}

// ---------- Worn (the journal) ----------

/**
 * The journal. It keeps every wear on this device, whichever list was ranked;
 * Gathering dust reads the ranked list's rotation. `list`: that list's name,
 * given when the month's wears include bottles outside it, so both say so.
 */
export function wornHTML({ stats, calendar, dusty, todayISO }, resolve, { confirmClear = false, list = null } = {}) {
  if (!stats.wears && !stats.lastWorn.size) {
    return messageHTML({ glyph: icon.journal, title: 'Nothing logged yet', body: 'Choose Wear this on a pick and it shows up here, on a calendar with your most-worn bottles.',
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
    // The 1st names its month ("Oct 1"; "Oct" alone in a phone's narrowest cells).
    const date = day === 1 ? `<span class="cal-mon">${esc(shortDate(c.dateISO).split(' ')[0])}</span><span class="cal-day"> 1</span>` : day;
    return `<span class="cal-cell${c.future ? ' future' : ''}${c.dateISO === todayISO ? ' today' : ''}${worn.length ? ' has' : ''}${day === 1 ? ' first' : ''}" title="${esc(label)}">
      <small aria-hidden="true">${date}</small><span class="visually-hidden">${esc(label)}</span>
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
    ${list ? '<p class="muted small journal-scope">Every wear logged on this device, from any list.</p>' : ''}
    ${tiles}
    <section><h3>Calendar</h3><div class="calendar">${weekdays}${cells}</div></section>
    <section><h3>Most worn</h3>${mostList}</section>
    <section><h3>Gathering dust</h3>${list ? `<p class="muted small journal-scope">From ${esc(list)}: in rotation, not worn in 30 days.</p>` : ''}${dustList}</section>
    <div class="action-row end">
      <button class="btn secondary" data-action="journal-export">${icon.download}Export</button>
      <button class="btn ${confirmClear ? 'secondary danger' : 'tertiary'}" data-action="journal-clear">${icon.remove}${confirmClear ? 'Press again to clear' : 'Clear history'}</button>
    </div>
    <p class="muted small">Logged with “Wear this”. History stays on this device; Export saves it as a file.</p>
  </section>`;
}

// The list being ranked, named when the month's wears reach past it.
function wornPane() {
  const data = journalData();
  const ranked = new Set(sourceRecords().map(f => f.id));
  const mixed = data.stats.top.some(([id]) => !ranked.has(id));
  const list = !mixed ? null : state.shared ? collectionLabel() : state.active === 'mine' ? 'Mine' : 'David’s wardrobe';
  return wornHTML(data, findRecord, { confirmClear: state.armed === 'journal-clear', list });
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
      // The list goes by the switch's name: David's wardrobe, Mine, or the shared one's.
      id: 'owned', label: 'Owned', title: () => 'Owned', heading: () => (!state.shared && state.active === 'mine' ? 'Mine' : collectionLabel()), render: ownedPane,
      after() { applyFilter(); watchFilter(); warmPool(); },
    },
    wishlist.wishlistPaneDef,
    {
      id: 'worn', label: 'Worn', title: () => 'Worn', heading: () => 'Wear journal',
      render: wornPane, after: () => warmPool(),
    },
    insights.insightsPaneDef,
  ],
};

// ---------- Sheets ----------

// "Aventus by Creed": two results can share a name.
const byBrand = r => (r.brand ? `${r.name} by ${r.brand}` : r.name);

function resultRow(r, i, added) {
  const meta = [r.brand, r.year].filter(Boolean).map(esc).join(' · ');
  const trailing = `<button class="btn secondary compact${added ? ' on' : ''}" data-action="add-result" data-value="${i}" ${added ? 'disabled' : ''} aria-label="${added ? 'Added' : 'Add'} ${esc(byBrand(r))}">${added ? `${icon.check}Added` : `${icon.plus}Add`}</button>`;
  return rowHTML(r, { meta, trailing });
}

const handAdd = label => `<button class="link-btn" data-action="custom">${label}</button>`;

/** What the Add sheet's status line says: searching, how many matched, or what went wrong. */
export function addSheetStatus({ query = '', results = null, busy = false, error = '' }) {
  if (busy) return 'Searching…';
  const found = results === null ? '' : results.length ? `${plural(results.length, 'match', 'matches')} for “${query}”.` : `No matches for “${query}”.`;
  return [found, error].filter(Boolean).join(' ');
}

/**
 * Add bottles. `query`: what was searched; `draft`: the field as typed since
 * (kept on every keystroke, so a render, like coming back to the tab, keeps it).
 */
export function addSheetHTML({ query = '', draft = null, results = null, busy = false, error = '' }, ownedIds) {
  const list = results === null ? ''
    : results.length === 0 ? `<p class="muted small">No matches for “${esc(query)}”. Check the spelling, or ${handAdd('add it yourself')}.</p>`
    : `<ul class="rows results">${results.map((r, i) => resultRow(r, i, ownedIds.has(r.id))).join('')}</ul>`;
  return sheetFrame('add-title', `
      <h2 id="add-title" class="sheet-title">Add bottles</h2>
      <p class="muted lede">Search every fragrance on Fragrantica. Brand plus name works best.</p>
      <form class="search-form" data-form="search">
        <label class="filter big">${icon.search}<input type="search" id="add-q" name="q" data-field="add-q" placeholder="e.g. Dior Sauvage" autocomplete="off" value="${esc(draft ?? query)}" aria-label="Fragrance" enterkeyhint="search"></label>
        <button type="submit" class="btn primary" ${busy ? 'disabled' : ''}>${busy ? '<span class="spinner small" aria-hidden="true"></span>Searching' : 'Search'}</button>
      </form>
      ${liveHTML('add-live', addSheetStatus({ query, results, busy, error }))}
      ${error ? `<p class="error">${esc(error)}</p>` : ''}
      ${list}
      <div class="sheet-bar${results?.length ? ' spread' : ''}">
        ${results?.length && !busy ? `<span class="muted">Not listed? ${handAdd('Add it yourself')}</span>` : ''}
        <button class="btn secondary" data-action="close-sheet">Done</button>
      </div>`);
}

/** The pasted lines' bottles to add: ticked, not in Mine already, each once. */
export const importPicks = rows => [...new Map(rows.filter(r => r.match && r.checked && !r.owned).map(r => [r.match.id, r.match])).values()];

/**
 * What Paste a list's status line says: looking, what it found, or what went
 * wrong, and how many lines past the first ones wait for another round (`more`).
 */
export function importSheetStatus({ rows = null, busy = false, error = '', more = 0 }) {
  if (!rows) return error;
  const left = more ? `${plural(more, 'more line')} left for the next round.` : '';
  if (busy) return [`Looking up ${plural(rows.length, 'line')}…`, left].filter(Boolean).join(' ');
  const found = rows.filter(r => r.match).length, owned = rows.filter(r => r.match && r.owned).length;
  return [`Found ${found} of ${plural(rows.length, 'line')}.`, owned ? `${owned} already in Mine.` : '', left, error].filter(Boolean).join(' ');
}

/**
 * Paste a list: the text box, then a row per line with its match. More lines
 * than `maxLines`: the first ones are looked up and the rest (`more` of them)
 * come back in the box once those are added; `carried` says the box holds them.
 */
export function importSheetHTML({ text = '', rows = null, busy = false, error = '', more = 0, carried = 0 }, maxLines) {
  let body;
  if (!rows) {
    body = `${carried ? `<p class="notice">The last ${plural(carried, 'line')} of your list, ready for another round.</p>` : ''}
      <form class="import-form" data-form="import">
        <textarea id="import-text" name="text" data-field="import-text" rows="8" placeholder="Dior Sauvage&#10;Liquid Brun&#10;Khadlaj Cream Velvet" aria-label="Fragrance list">${esc(text)}</textarea>
        <button class="btn primary block" type="submit">Find matches</button>
      </form>`;
  } else {
    const picked = importPicks(rows).length;
    // Each row's controls name its line: "Add it yourself" alone, said
    // twelve times, wouldn't say which.
    const yourself = (i, line, cls) => `<button class="${cls}" data-action="custom-row" data-value="${i}">${cls === 'link-btn' ? '' : icon.plus}Add it yourself<span class="visually-hidden">: ${esc(line)}</span></button>`;
    body = `${more ? `<p class="notice">Only the first ${maxLines} lines. Add these, and ${more === 1 ? 'the last line comes' : `the other ${more} come`} back here for another round.</p>` : ''}
    <ul class="rows import-rows">${rows.map((r, i) => {
      if (r.status === 'pending') return `<li class="row pending"><span class="row-main"><span class="spinner" aria-hidden="true"></span><span class="row-text"><b>${esc(r.line)}</b><small>Looking…</small></span></span></li>`;
      if (!r.match) return `<li class="row"><span class="row-main"><span class="miss">?</span><span class="row-text"><b>${esc(r.line)}</b><small>${esc(r.note || 'Not found')}</small></span></span>
        ${yourself(i, r.line, 'btn secondary compact')}</li>`;
      const meta = r.weak
        ? `${esc(r.match.brand)} · Closest match for “${esc(r.line)}”. Not it? ${yourself(i, r.line, 'link-btn')}`
        : [r.match.brand, `for “${r.line}”`].filter(Boolean).map(esc).join(' · ');
      // One you have already is marked, not ticked: adding it again adds nothing.
      const trailing = r.owned ? `<span class="owned-tag">${icon.check}In Mine</span>`
        : `<button class="check${r.checked ? ' on' : ''}" role="checkbox" aria-checked="${r.checked}" data-action="import-toggle" data-value="${i}" aria-label="Add ${esc(byBrand(r.match))}, for “${esc(r.line)}”">${icon.check}</button>`;
      return rowHTML(r.match, { meta, trailing, cls: r.weak ? 'wrap' : '' });
    }).join('')}</ul>
    <div class="sheet-bar">
      <button class="btn tertiary" data-action="import" ${busy ? 'disabled' : ''}>Start over</button>
      <button class="btn primary" data-action="import-confirm" ${busy || !picked ? 'disabled' : ''}>${icon.plus}<span>Add ${plural(picked, 'bottle')}</span></button>
    </div>`;
  }
  return sheetFrame('import-title', `
      <h2 id="import-title" class="sheet-title" tabindex="-1">Paste a list</h2>
      <p class="muted lede">One fragrance per line, up to ${maxLines} at a time. Copy it from your notes or your Fragrantica wardrobe page.</p>
      ${liveHTML('import-live', importSheetStatus({ rows, busy, error, more }))}
      ${error ? `<p class="error">${esc(error)}</p>` : ''}
      ${body}`);
}

const TIMES = [['day', 'Day'], ['night', 'Night'], ['both', 'Day & night']];

const ORDINAL = ['strongest', '2nd', '3rd', '4th', '5th', '6th'];

/**
 * A bottle no database has. Chips run from rich to fresh, as in ACCORDS, and
 * are one Tab stop: arrow keys move between them (chipKeys), and `chip` is
 * the one Tab lands on (the last one moved to, else the strongest chosen,
 * else the first). `invalid`: the field the error is about ('name' or
 * 'accords').
 */
export function customSheetHTML({ name = '', brand = '', accords = [], seasons = [], time = null, error = '', invalid = null, chip = null, back = null }, maxAccords) {
  const all = Object.keys(ACCORDS);
  const full = a => !accords.includes(a) && accords.length >= maxAccords;
  const stop = [chip, accords[0], all[0]].find(a => a && all.includes(a) && !full(a));
  const accordChip = a => {
    const rank = accords.indexOf(a);
    // The badge's number, said as a word after the name: "cacao, strongest".
    const badge = rank >= 0 ? `<b aria-hidden="true">${rank + 1}</b>` : '';
    return `<button type="button" class="pick-chip${rank >= 0 ? ' on' : ''}" style="--c:${accordColor(a)}" data-action="accord" data-value="${esc(a)}" aria-pressed="${rank >= 0}" tabindex="${a === stop ? 0 : -1}"${full(a) ? ' disabled' : ''}>${badge}${esc(accordLabel(a))}${rank >= 0 ? `<span class="visually-hidden">, ${ORDINAL[rank] ?? rank + 1}</span>` : ''}</button>`;
  };
  const cap = s => s[0].toUpperCase() + s.slice(1);
  const described = what => (error && invalid === what ? ' aria-invalid="true" aria-describedby="custom-error"' : '');
  // The error sits by the field it's about, else above the buttons.
  const errorAt = where => (error && (invalid ?? 'end') === where ? `<p class="error" id="custom-error">${esc(error)}</p>` : '');
  return sheetFrame('custom-title', `
      <h2 id="custom-title" class="sheet-title">Add it yourself</h2>
      <p class="muted lede">For bottles no database has. Picks work from the accords you choose. Fragrantica or the brand’s site usually lists them.</p>
      <form class="custom-form" data-form="custom" novalidate>
        <label class="name-field">Name
          <input type="text" id="custom-name" name="name" data-field="custom-name" value="${esc(name)}" maxlength="80" autocomplete="off" enterkeyhint="next"${described('name')}>
        </label>
        ${errorAt('name')}
        <label class="name-field">Brand
          <input type="text" name="brand" data-field="custom-brand" value="${esc(brand)}" maxlength="80" autocomplete="off" placeholder="Optional">
        </label>
        <fieldset${error && invalid === 'accords' ? ' aria-describedby="custom-error"' : ''}>
          <legend>Main accords, strongest first <span>${accords.length} of ${maxAccords}</span><span class="visually-hidden">. Arrow keys move between them.</span></legend>
          ${errorAt('accords')}
          <div class="pick-chips">${all.map(accordChip).join('')}</div>
        </fieldset>
        <fieldset>
          <legend>When do you wear it? <span>Optional</span></legend>
          <div class="when">
            ${segHTML(SEASONS.map(s => ({ value: s, label: cap(s), on: seasons.includes(s) })), { action: 'season', label: 'Seasons' })}
            ${segHTML(TIMES.map(([t, label]) => ({ value: t, label, on: time === t })), { action: 'time', label: 'Time of day' })}
          </div>
        </fieldset>
        ${errorAt('end')}
        ${liveHTML('custom-live', error && invalid !== 'name' ? error : '')}
        <div class="sheet-bar">
          ${back ? '<button class="btn secondary" type="button" data-action="custom-back">Back</button>' : ''}
          <button class="btn primary" type="submit">${icon.plus}<span>${back?.kind === 'import' ? 'Use for this line' : 'Add to Mine'}</span></button>
        </div>
      </form>`);
}

/**
 * A share link to copy by hand, where neither the share sheet nor the
 * clipboard took it: the whole link in a field, selected, and Copy.
 */
export function shareSheetHTML({ url, name = '', copied = false }) {
  return sheetFrame('share-title', `
      <h2 id="share-title" class="sheet-title">Share link</h2>
      <p class="muted lede">Send it to anyone: it opens ${name ? `${esc(name)}’s` : 'these'} bottles in Almanac, ranked for their weather.</p>
      <label class="name-field">Link
        <input type="text" id="share-url" data-action="share-select" value="${esc(url)}" readonly autocomplete="off" spellcheck="false">
      </label>
      ${liveHTML('share-live', copied === true ? 'Link copied' : copied || '')}
      ${typeof copied === 'string' ? `<p class="muted small">${esc(copied)}</p>` : ''}
      <div class="sheet-bar">
        <button class="btn secondary" data-action="close-sheet">Done</button>
        <button class="btn primary${copied === true ? ' on' : ''}" data-action="share-copy">${copied === true ? `${icon.check}<span>Copied</span>` : `${icon.paste}<span>Copy link</span>`}</button>
      </div>`);
}

export const sheets = {
  add: s => addSheetHTML(s, new Set(state.mine.records.map(r => r.id))),
  'share-link': shareSheetHTML,
  import: s => importSheetHTML(s, MAX_IMPORT_LINES),
  custom: s => customSheetHTML(s, MAX_CUSTOM_ACCORDS),
  ...insights.sheets,
};

// ---------- Search, paste, enter by hand ----------

// Sheets redraw whole on every change. This keeps focus on the control that
// had it (its successor by id or data attributes), else on `fallback` in the
// sheet, never on <body>, where the next Tab would start the page over; then
// the sheet's status line says what changed (speak, parts.js).
function redrawSheet(app, patch, fallback = '.sheet-close') {
  const el = document.activeElement;
  const id = el?.id;
  const caret = typeof el?.selectionStart === 'number' ? [el.selectionStart, el.selectionEnd] : null;
  app.keepingFocus(el, '#sheet', () => app.updateSheet(patch));
  // A control that went with nothing in its place leaves focus on Close
  // (renderSheet's last resort): the fallback is nearer where it was, and
  // Enter pressed again shouldn't close the sheet.
  const lost = el && !el.isConnected && !el.matches('.sheet-close') && document.activeElement?.matches('#sheet .sheet-close');
  const now = focusInSheet({ force: lost }, id && `#${CSS.escape(id)}`, fallback);
  // A text field drawn again keeps its caret where it was.
  if (caret && now && now.id === id) {
    try { now.setSelectionRange(...caret); } catch {} // not every input type has a caret
  }
  speak(document.getElementById('sheet'));
}

// Focus stays in the sheet: where it is (unless `force`), else on the first
// of `targets` there that can take it. Returns the element it landed on.
function focusInSheet({ force = false }, ...targets) {
  const sheet = document.getElementById('sheet');
  if (!state.sheet || !sheet || (!force && sheet.contains(document.activeElement))) return null;
  for (const sel of targets.filter(Boolean)) {
    const el = sheet.querySelector(sel);
    if (el && !el.disabled) {
      el.focus();
      return el;
    }
  }
  return null;
}

// After the await, the answer goes only to the Add sheet that asked.
async function runSearch(app, query) {
  redrawSheet(app, { query, busy: true, error: '' }, '#add-q');
  const current = () => state.sheet?.kind === 'add' && state.sheet.query === query;
  try {
    // Offline, the bottles on this device still answer, with the error.
    const { results, error } = await findBottles(query);
    if (current()) redrawSheet(app, { results: results.length || !error ? results : null, busy: false, error }, '#add-q');
  } catch (err) {
    if (current()) redrawSheet(app, { busy: false, error: err.message }, '#add-q');
  }
}

/**
 * The bottle a pasted line gets, and whether it's ticked: one whose every
 * name word was typed (`nameMatches`), the wardrobe's and catalog's (`local`)
 * before the library's (`hits`); else the closest guess, unticked (`weak`).
 * "Hawas" doesn't tick Hawas Elixir, though every word typed is in it, and
 * search answers with near misses too ("Caramello" for "Caramellino").
 */
export function lineMatch(line, local = null, hits = []) {
  if (local && nameMatches(line, local)) return { match: local, checked: true, weak: false };
  const hit = hits.find(r => nameMatches(line, r));
  if (hit) return { match: hit, checked: true, weak: false };
  const guess = hits[0] ?? local ?? null;
  return { match: guess, checked: false, weak: Boolean(guess) };
}

async function runImport(app, text) {
  // Past the first MAX_IMPORT_LINES, the lines wait (`rest`) for another
  // round, tidied as importLines reads them ("Name by Brand" kept).
  const all = importLines(text, Infinity);
  const lines = all.slice(0, MAX_IMPORT_LINES);
  const rest = all.slice(MAX_IMPORT_LINES).map(l => (l.brand ? `${l.name} by ${l.brand}` : l.name)).join('\n');
  if (!lines.length) {
    redrawSheet(app, { text, error: 'Paste at least one fragrance name.' }, '#import-text');
    return document.getElementById('import-text')?.focus();
  }
  const job = {};
  const rows = lines.map(l => ({ ...l, status: 'pending', match: null, checked: false, weak: false }));
  // The text box makes way for the list: focus goes to the sheet's title,
  // just above it, while the status line says how the lookup goes.
  redrawSheet(app, { text, job, rows, busy: true, error: '', more: all.length - lines.length, rest, carried: 0 }, '#import-title');
  // Bottles in Mine already come marked, not ticked: adding one adds nothing.
  const mine = new Set(state.mine.records.map(r => r.id));
  const mark = (match, checked) => ({ match, owned: Boolean(match && mine.has(match.id)), checked: checked && !(match && mine.has(match.id)) });
  let stopped = '';
  for (const [i, { line }] of lines.entries()) {
    // The wardrobe and catalog first; the library unless one of them is it.
    const local = localMatches(line, knownBottles(), 1)[0];
    let hits = null;
    if (!(local && nameMatches(line, local)) && !stopped) {
      try {
        hits = await library.search(line);
      } catch (err) {
        stopped = err.message; // offline: the rest go unasked
      }
    }
    const { match, checked, weak } = lineMatch(line, local, hits ?? []);
    const found = match ? { ...mark(match, checked), weak } : { ...mark(null, false), note: hits ? '' : stopped };
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
  if (target === s) redrawSheet(app, next, '#import-title');
  else s.back = { ...target, ...next };
  return true;
}

// A bottle entered by hand, opened from Owned, Add bottles or an unmatched
// row of a pasted list (`row`); `back` is the sheet to return to.
function customSheet({ name = '', brand = '', row = null }) {
  watchChips();
  return { kind: 'custom', name, brand, accords: [], seasons: [], time: null, error: '', invalid: null, chip: null, back: state.sheet, row };
}

// A field that's wrong takes focus, marked invalid and described by the
// error (customSheetHTML); the accords' error is also said aloud, since
// landing on a chip doesn't read the group's description.
function markInvalid(app, patch, field) {
  const at = field === 'name' ? '#custom-name' : '.pick-chip[tabindex="0"]';
  redrawSheet(app, { ...patch, invalid: field }, at);
  document.querySelector(`#sheet ${at}`)?.focus();
}

function saveCustom(app, name, brand) {
  const s = state.sheet;
  if (!name) return markInvalid(app, { name, brand, error: 'Give it a name.' }, 'name');
  if (!s.accords.length) return markInvalid(app, { name, brand, error: 'Pick at least one accord.' }, 'accords');
  const record = customRecord({ name, brand, accords: s.accords, seasons: s.seasons, time: s.time });
  if (!record) return markInvalid(app, { name, brand, error: 'Pick at least one accord.' }, 'accords');
  if (s.back?.kind === 'import') {
    // Fills that row of the pasted list, ticked; the list's Add button saves
    // it. Focus goes to that row's tick.
    const rows = s.back.rows.map((r, i) => (i === s.row ? { ...r, match: record, checked: true, owned: false, weak: false, note: '' } : r));
    app.openSheet({ ...s.back, rows });
    return document.querySelector(`#sheet [data-action="import-toggle"][data-value="${s.row}"]`)?.focus();
  }
  app.addToMine(record);
  if (s.back) app.openSheet(s.back);
  else app.closeSheet();
  app.render();
  app.showToast(`<span>${esc(toastName(record.name))} added to Mine</span>`);
}

// The accord chips are one Tab stop (customSheetHTML): arrow keys move
// along them, Up and Down to the nearest chip in the row above or below
// (they wrap), Home and End to the ends. Listens once, from the first
// custom sheet.
const CHIP_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
let chipsWatched = false;
function watchChips() {
  if (chipsWatched || typeof document === 'undefined') return;
  chipsWatched = true;
  document.addEventListener('keydown', chipKeys);
}
function chipKeys(e) {
  const from = e.target.closest?.('.pick-chips .pick-chip');
  if (!from || !CHIP_KEYS.includes(e.key) || e.altKey || e.ctrlKey || e.metaKey) return;
  e.preventDefault();
  const chips = [...from.parentElement.querySelectorAll('.pick-chip:not(:disabled)')];
  const i = chips.indexOf(from);
  let next = { Home: chips[0], End: chips.at(-1), ArrowLeft: chips[i - 1], ArrowRight: chips[i + 1] }[e.key];
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    const at = from.getBoundingClientRect(), x = at.left + at.width / 2;
    const down = e.key === 'ArrowDown';
    const rows = chips.map(c => [c, c.getBoundingClientRect()]).filter(([, r]) => (down ? r.top > at.bottom - 2 : r.bottom < at.top + 2));
    const top = down ? Math.min(...rows.map(([, r]) => r.top)) : Math.max(...rows.map(([, r]) => r.top));
    const dist = r => Math.abs(r.left + r.width / 2 - x);
    next = rows.filter(([, r]) => r.top === top).sort((a, b) => dist(a[1]) - dist(b[1]))[0]?.[0];
  }
  if (!next) return;
  from.tabIndex = -1;
  next.tabIndex = 0;
  next.focus();
  if (state.sheet?.kind === 'custom') state.sheet.chip = next.dataset.value;
}

async function share(app) {
  const records = activeFragrances();
  if (!records.length) return;
  const name = state.shared?.name ?? (state.active === 'mine' ? state.mine.name.trim() : 'David');
  let url;
  try {
    url = shareURL(records, name);
    if (navigator.share) {
      await navigator.share({ title: 'Almanac', text: name ? `${name}’s fragrance picks` : 'Fragrance picks', url });
      return;
    }
    await navigator.clipboard.writeText(url);
    app.showToast('<span>Share link copied</span>');
  } catch (err) {
    if (!url) return app.showToast('<span>Couldn’t make a share link</span>', { tone: 'error' });
    // Too long for a toast: the link goes in a sheet, selected, to copy by hand.
    if (err?.name === 'AbortError') return;
    app.openSheet({ kind: 'share-link', url, name });
    document.getElementById('share-url')?.select();
  }
}

// Copy, from the share sheet: the clipboard, else the browser's copy of the
// selected field, else a line saying to copy it by hand. Focus stays on Copy
// (selecting the field takes it there) unless it's down to copying by hand,
// when the field, selected, has it.
async function copyShare(el, app) {
  const s = state.sheet;
  const field = document.getElementById('share-url');
  let copied;
  try {
    await navigator.clipboard.writeText(s.url);
    copied = true;
  } catch {
    const had = document.activeElement === el;
    field?.select();
    try { copied = document.execCommand('copy'); } catch { copied = false; }
    if (had && el.isConnected) el.focus({ preventScroll: true });
  }
  if (state.sheet !== s) return;
  app.keepingFocus(el, '#sheet', () => app.updateSheet({ copied: copied || 'Couldn’t copy from here. The link is selected: copy it yourself.' }));
  if (!copied) document.getElementById('share-url')?.select();
  speak(document.getElementById('sheet'));
}

// ---------- Actions ----------

// The Mine that Save as Mine replaced, until its toast's Undo.
let replaced = null; // { mine, active, shared, search }

// An owned bottle's row (its name, which opens it) when it's shown, else Add
// bottles, else the page's heading.
function focusOwned(id) {
  const row = id && document.querySelector(`.owned-list .row-main[data-id="${CSS.escape(id)}"]`);
  const target = (row && !row.closest('li').hidden && row) || document.querySelector('#main [data-action="add"]') || document.getElementById('page-title');
  target?.focus();
}

export const actions = {
  // A rotation switch: in or out of picks, in the list on screen.
  rotation(el, app) {
    const id = el.dataset.id;
    const isDemo = viewingDemo();
    setHidden(state.hiding, id, !hiddenIn(isDemo).has(id), isDemo);
    app.keepingFocus(el, '#app', app.render);
  },
  // Focus moves on to the next bottle in the list (else the one before,
  // else Add bottles), so Tab carries on from where it was.
  remove(el, app) {
    const index = state.mine.records.findIndex(r => r.id === el.dataset.id);
    if (index < 0) return;
    const rows = [...document.querySelectorAll('.owned-list li[data-name]')].filter(li => !li.hidden);
    const at = rows.indexOf(el.closest('li'));
    const next = (rows[at + 1] ?? rows[at - 1])?.querySelector('.row-main')?.dataset.id;
    const [removed] = state.mine.records.splice(index, 1);
    saveMine(state.mine);
    state.lastRemoved = { record: removed, index };
    app.render();
    focusOwned(next);
    app.showToast(`<span>${esc(toastName(removed.name))} removed</span><button class="btn primary compact" data-action="undo-remove">Undo</button>`);
  },
  // The Undo button goes with its toast: focus goes to the bottle that came back.
  'undo-remove'(el, app) {
    if (!state.lastRemoved) return;
    const { record, index } = state.lastRemoved;
    state.mine.records.splice(index, 0, record);
    state.lastRemoved = null;
    saveMine(state.mine);
    app.render();
    focusOwned(record.id);
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
    const i = +el.dataset.value;
    const hit = state.sheet?.results?.[i];
    if (!hit) return;
    let record;
    try {
      [record] = await fullRecords([hit]);
    } catch (err) {
      return redrawSheet(app, { error: err.message }, '#add-q');
    }
    if (!record) return redrawSheet(app, { error: `Couldn’t load ${hit.name}. Try again.` }, '#add-q');
    app.addToMine(record);
    app.render();
    // Its button is now a disabled "Added": focus goes on to the next
    // bottle still to add (else the last one before it), else the search.
    if (state.sheet?.kind === 'add') {
      const open = [...document.querySelectorAll('#sheet [data-action="add-result"]:not(:disabled)')];
      (open.find(b => +b.dataset.value > i) ?? open.at(-1) ?? document.getElementById('add-q'))?.focus();
    }
    app.showToast(`<span>${esc(toastName(record.name))} added to Mine</span>`);
  },
  import(el, app) {
    const again = state.sheet?.kind === 'import';
    app.openSheet({ kind: 'import', text: again ? state.sheet.text : '' });
    // Start over: back to the text, as it was.
    if (again) document.getElementById('import-text')?.focus();
  },
  'import-toggle'(el, app) {
    const rows = state.sheet.rows.map((r, i) => (i === +el.dataset.value ? { ...r, checked: !r.checked } : r));
    app.keepingFocus(el, '#sheet', () => app.updateSheet({ rows }));
  },
  async 'import-confirm'(el, app) {
    const { rest = '', more = 0 } = state.sheet;
    let picked;
    try {
      picked = await fullRecords(importPicks(state.sheet.rows));
    } catch (err) {
      return redrawSheet(app, { error: err.message }, '#import-title');
    }
    // Counts what went in, not what was ticked.
    const before = state.mine.records.length;
    picked.forEach(app.addToMine);
    const added = state.mine.records.length - before;
    const said = added ? `Added ${plural(added, 'bottle')}` : 'Nothing new to add';
    // Lines past the first round come back in the box for the next.
    if (rest) {
      app.openSheet({ kind: 'import', text: rest, carried: more });
      app.render();
      document.getElementById('import-text')?.focus();
      return app.showToast(`<span>${said}. The other ${plural(more, 'line')} wait in the box.</span>`, { tone: added ? 'success' : 'info' });
    }
    // Navigating waits for the sheet's history entry to go (src/app/sheets.js).
    app.closeSheet({ then: () => app.navigate('#/wardrobe/owned') });
    app.render();
    app.showToast(`<span>${said}</span>`, { tone: added ? 'success' : 'info' });
  },
  custom(el, app) {
    const s = state.sheet;
    app.openSheet(customSheet({ name: (s?.draft ?? s?.query ?? '').trim() }));
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
    redrawSheet(app, { accords, chip: a, error: '', invalid: null });
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
  'share-copy': copyShare,
  'share-select': el => el.select(),
  'shared-save'(el, app) {
    const s = state.shared;
    if (!s || s.loading) return;
    if (state.mine.records.length && state.armed !== 'shared-save') {
      state.armed = 'shared-save';
      app.keepingFocus(el, '#app', app.renderPage);
      return;
    }
    state.armed = null;
    // A Mine with bottles in it can come back (Undo): the bottles, the list
    // that was ranked and the link on screen, as they were.
    replaced = state.mine.records.length ? { mine: state.mine, active: state.active, shared: s, search: location.search } : null;
    // The link's name goes with its bottles (Brooke's, saved by Brooke), so
    // her own share links carry it; an unnamed link keeps Mine's.
    state.mine = { name: s.name || state.mine.name || '', records: s.records };
    saveMine(state.mine);
    app.setActive('mine');
    app.render();
    app.showToast(`<span>Saved as Mine</span>${replaced ? '<button class="btn primary compact" data-action="shared-save-undo">Undo</button>' : ''}`);
  },
  // Mine back as it was, ranked as it was, under the link it replaced.
  'shared-save-undo'(el, app) {
    if (!replaced) return;
    const { mine, active, shared, search } = replaced;
    replaced = null;
    state.mine = mine;
    saveMine(state.mine);
    app.setActive(active);
    state.shared = shared;
    const url = new URL(location.href);
    url.search = search;
    history.replaceState(history.state, '', url.href);
    app.render();
    (document.querySelector('#main [data-action="shared-save"]') ?? document.getElementById('page-title'))?.focus();
    app.hideToast();
  },
  'shared-close'(el, app) {
    app.closeShared();
    app.render();
  },
  // With your own ratings and skin nudges (src/skin.js), for journal-check.
  'journal-export'() {
    const data = journalExport(state.history, state.loc, hiddenIn(true), { skin: loadSkin() });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    // Named by the device's date: an evening export in the Americas is already tomorrow in UTC.
    a.download = `almanac-journal-${deviceToday()}.json`;
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
    if (query.length < 3) return redrawSheet(app, { query, results: null, error: 'Type at least 3 letters.' }, '#add-q');
    await runSearch(app, query);
  },
  import: (data, app) => runImport(app, String(data.get('text') ?? '')),
  custom: (data, app) => saveCustom(app, String(data.get('name') ?? '').trim(), String(data.get('brand') ?? '').trim()),
};

export const fields = {
  'collection-filter'(el) {
    state.ownedFilter = el.value;
    applyFilter({ spoken: true });
  },
  // Kept as typed, so a render mid-word (the forecast landing) keeps it.
  'mine-name'(el) {
    state.mine.name = el.value.slice(0, 40);
    saveMine(state.mine);
  },
  // Kept in state as typed, so a render (coming back to the tab, the forecast
  // landing, tapping an accord) redraws the sheet without wiping it.
  'add-q'(el) { if (state.sheet?.kind === 'add') state.sheet.draft = el.value; },
  'import-text'(el) { if (state.sheet?.kind === 'import') state.sheet.text = el.value; },
  'custom-name'(el) { if (state.sheet?.kind === 'custom') state.sheet.name = el.value; },
  'custom-brand'(el) { if (state.sheet?.kind === 'custom') state.sheet.brand = el.value; },
};

// Once it's typed: without the spaces at its ends.
export const changes = {
  'mine-name'(el) {
    state.mine.name = el.value.trim().slice(0, 40);
    saveMine(state.mine);
  },
};
