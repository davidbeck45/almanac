// The bottle page (#/bottle/<id>[?ctx=<key>]): a sheet on phones, a drawer on
// tablets and an inspector beside the page from 1100px (src/css/shell.css
// places it, src/css/bottle.css draws it). It's built from SECTIONS, an
// ordered registry: a new section registers itself from its own module with
// addSection() and the shell imports that module (.sweep/notes/shell-map.md).
import { rank, comfortRange, SEASONS } from '../engine.js';
import { layerPicks } from '../layering.js';
import { setHidden } from '../hidden.js';
import { esc, deg, temp, matchPct, relativeDay } from '../ui.js';
import { icon, img, bar, reasonsList, accordColor, wearButton, magDot, messageHTML, shelfHTML } from '../ui/components.js';
import {
  state, findRecord, inSource, isActive, activeFragrances, viewingDemo, nowSlot, canWear, wornId,
  wearInfo, todayISO,
} from '../app/state.js';

// ---------- The registry ----------

/**
 * Sections in page order: { id, order, render(model) -> HTML or '' }, and
 * optionally the handlers its markup names, as a view module exports them:
 * actions, forms, fields, changes, sheets. The shell merges those with the
 * views' (names are global: prefix them, e.g. 'skin-rate').
 */
export const SECTIONS = [];

export function addSection(section) {
  if (SECTIONS.some(s => s.id === section.id)) throw new Error(`Two bottle-page sections called "${section.id}"`);
  SECTIONS.push(section);
  SECTIONS.sort((a, b) => a.order - b.order);
}

/**
 * What every section gets:
 * { f: the record, entry: its ranked entry for the window (null without a
 *   forecast), solo: ranked on its own (not in the list on screen), ctx and
 *   ctxLabel: the list it was opened from, owned: in the collection being
 *   ranked, active: and switched on, worn, canWear, wears, todayISO, win,
 *   alts, partners, comfort, about: loadAbout()'s data (undefined while it
 *   loads, null when the dataset has none) }.
 */
export function bottleModel(route) {
  const id = route.arg;
  const fallback = nowSlot()?.win.slot ?? null;
  const key = state.contexts[route.query.ctx] ? route.query.ctx : fallback;
  const ctx = state.contexts[key] ?? null;
  let entry = ctx?.entries.get(id) ?? null;
  const f = entry?.fragrance ?? findRecord(id);
  if (!f) return null;
  const solo = !entry;
  const win = ctx?.win ?? null;
  if (!entry && win) entry = rank([f], win, win.slot, { occasion: ctx.occasion, history: state.history, todayISO: win.dateISO })[0];
  const owned = inSource(id);
  const active = isActive(id);
  const others = activeFragrances().filter(o => o.id !== id);
  return {
    f,
    entry,
    solo,
    win,
    ctx: key,
    ctxLabel: win ? (ctx.occasion ? `${ctx.occasion.label} · ${win.label.toLowerCase()}` : win.label) : '',
    owned,
    inMine: state.mine.records.some(r => r.id === id),
    active,
    worn: win ? wornId(win) : null,
    canWear: Boolean(win) && active && canWear(win),
    wears: wearInfo(id),
    todayISO: todayISO(),
    alts: ctx && !solo ? ctx.ranked.filter(r => r.fragrance.id !== id).slice(0, 4) : [],
    partners: others.length ? layerPicks(f, others, 3, win ?? undefined) : null,
    comfort: comfortRange(f),
    about: state.about.get(id),
  };
}

// The whole page. `modal`: a dialog over the page (phones and tablets).
// model: undefined while its record loads, null for a bottle no source has,
// false when it couldn't load (offline).
export function bottlePageHTML(model, { modal = true } = {}) {
  const frame = inner => `
    ${modal ? '<div class="bp-backdrop" data-action="close-bottle"></div>' : ''}
    <article class="bp-panel"${modal ? ' role="dialog" aria-modal="true"' : ''} aria-labelledby="bottle-title">
      <div class="sheet-grip" aria-hidden="true"></div>
      <button class="icon-btn bp-close" data-action="close-bottle" aria-label="Close">${icon.close}</button>
      ${inner}
    </article>`;
  // The page's h2 is the tab's title too (the shell reads it).
  const notice = (title, message) => frame(`<h2 id="bottle-title" class="visually-hidden">${title}</h2><div class="bp-notice">${messageHTML(message)}</div>`);
  if (model === undefined) {
    return frame(`<h2 id="bottle-title" class="visually-hidden">Loading</h2><div class="bp-loading" aria-busy="true"><span class="sk bp-sk-photo"></span><span class="sk bp-sk-line"></span><span class="sk bp-sk-line short"></span></div>`);
  }
  if (model === null) {
    return notice('Bottle not found', { glyph: icon.bottle, title: 'Bottle not found', body: 'This link names a bottle the library doesn’t have.' });
  }
  if (model === false) {
    return notice('Couldn’t load', { glyph: icon.cloud, title: 'Couldn’t load this bottle', body: 'The fragrance library needs a connection. It tries again when you’re back online.',
      action: `<button class="btn primary" data-action="bottle-retry">${icon.refresh}<span>Try again</span></button>` });
  }
  return frame(SECTIONS.map(s => s.render(model)).join(''));
}

// ---------- Sections ----------

const SEASON_COLORS = { winter: '#8fc7f0', spring: '#9be39a', summer: '#f6a08f', fall: '#f2b264', day: '#f5c451', night: '#8ea3d9' };
const GENDER = { men: 'for men', women: 'for women', 'women and men': 'unisex' };
const FACTORS = [
  ['occasion', 'Occasion', '#e7b6ff'],
  ['season', 'Season', '#9be39a'],
  ['weather', 'Weather', '#8fc7f0'],
  ['time', 'Time of day', '#f5c451'],
  ['quality', 'Crowd rating', '#f2b264'],
];
// Names longer than this step down a size, so they don't run to four lines.
const LONG_NAME = 28;
// Accord bars are Fragrantica's widths (30–100), read out as words.
const strength = width => (width >= 85 ? 'dominant' : width >= 65 ? 'strong' : width >= 45 ? 'moderate' : 'light');

function headSection({ f, entry, ctxLabel, solo }) {
  const meta = [f.brand, f.year, GENDER[f.gender]].filter(Boolean).map(esc).join(' · ');
  const ratingLine = f.source === 'custom'
    ? '<span>Entered by hand</span>'
    : !f.rating ? 'Unrated'
    : `★ ${f.rating.toFixed(2)} <span>${esc(f.source === 'fragella' ? 'Fragella rating' : `${f.ratingVotes.toLocaleString()} votes`)}</span>`;
  // Parfumo's 0–10 ratings when we have them, else Fragrantica's votes, else Fragella's words.
  const pf = f.parfumo, fv = f.performance;
  const performance = pf
    ? `Longevity ${pf.longevity.toFixed(1)} · Sillage ${pf.sillage.toFixed(1)} <span>of 10 on <a href="${esc(pf.url)}" target="_blank" rel="noopener">Parfumo</a></span>`
    : fv
    ? `Longevity ${fv.longevity.toFixed(1)} of 5 · Sillage ${fv.sillage.toFixed(1)} of 4 <span>on Fragrantica</span>`
    : [f.longevity, f.sillage && `${f.sillage} sillage`].filter(Boolean).map(esc).join(' · ');
  const o = f.original;
  const inspired = o ? `<p class="inspired">Inspired by ${o.url ? `<a href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.name)}</a>` : esc(o.name)} · ${esc(o.brand)}</p>` : '';
  const kicker = entry && !solo ? `<p class="kicker">${magDot(entry.tier)}${esc(ctxLabel)}</p>` : '';
  return `<header class="bp-head" style="--accord:${accordColor(Object.keys(f.accords)[0])}">
    <div class="bp-bottle">${img(f, { lazy: false })}</div>
    <div class="bp-title">
      ${kicker}
      <h2 id="bottle-title"${f.name.length > LONG_NAME ? ' class="long"' : ''}>${esc(f.name)}</h2>
      <p class="brand">${meta}</p>
      ${inspired}
      <p class="rating">${ratingLine}</p>
      ${performance ? `<p class="performance">${performance}</p>` : ''}
    </div>
  </header>`;
}

// The feels-like range a bottle suits (engine comfortRange), in the user's units.
function comfortHTML(range) {
  if (!range || (range.lowF === null && range.highF === null)) return '';
  const { lowF, highF } = range;
  const text = lowF === null ? `Best when it feels ${deg(highF)} or colder`
    : highF === null ? `Best when it feels ${deg(lowF)} or warmer`
    : `Best when it feels ${temp(lowF)}–${deg(highF)}`;
  return `<p class="fact">${icon.thermo}<span>${esc(text)}</span></p>`;
}

function wearsHTML(wears, today) {
  if (!wears) return '';
  const text = wears.count
    ? `Worn ${wears.count}× in the last 30 days · last ${relativeDay(wears.last, today)}`
    : wears.last ? `Last worn ${relativeDay(wears.last, today)}` : 'No wears logged yet';
  return `<p class="fact">${icon.clock}<span>${esc(text)}</span></p>`;
}

function summarySection({ entry, comfort, wears, todayISO: today, owned }) {
  return `<div class="bp-summary">
    ${entry ? reasonsList(entry.reasons, 'full') : ''}
    ${comfortHTML(comfort)}
    ${owned ? wearsHTML(wears, today) : ''}
  </div>`;
}

function actionsSection({ f, entry, ctx, worn, canWear: wearable, owned, inMine, active }) {
  // In Mine while another list is ranked: nothing to add.
  const own = inMine
    ? `<span class="owned-tag">${icon.check}In Mine</span>`
    : `<button class="btn primary" data-action="own" data-id="${esc(f.id)}">${icon.plus}<span>I own it</span></button>`;
  // Switched off in Wardrobe: it can come back from here.
  const rotation = active
    ? `<button class="btn tertiary" data-action="hide" data-id="${esc(f.id)}">${icon.hide}Hide from picks</button>`
    : `<button class="btn secondary" data-action="unhide" data-id="${esc(f.id)}">${icon.plus}<span>Back in rotation</span></button>`;
  return `<div class="bp-actions">
    ${owned ? (wearable && entry ? wearButton(entry, ctx, worn) : '') : own}
    ${f.url ? `<a class="btn secondary" href="${esc(f.url)}" target="_blank" rel="noopener">Fragrantica ${icon.external}</a>` : ''}
    ${owned ? rotation : ''}
  </div>`;
}

function whySection({ entry, solo, win }) {
  if (!entry) return '';
  const p = entry.parts;
  const bars = FACTORS.filter(([k]) => p[k] !== null && p[k] !== undefined)
    .map(([k, label, color]) => bar(label, p[k] * 100, color, `${Math.round(p[k] * 100)}`)).join('');
  const rotation = p.rotation > 0
    ? `<p class="why-note">−${Math.round(p.rotation * 100)} for rotation: ${esc(p.planned ? 'already in the plan nearby' : 'worn recently')}.</p>`
    : '';
  const title = solo ? `How it would do ${win.slot === 'day' ? 'by day' : 'tonight'}` : 'Why it ranks here';
  return `<section class="bp-section"><h3>${title} <span class="h3-aside">${matchPct(entry)}% match</span></h3><div class="bars why">${bars}</div>${rotation}</section>`;
}

// The next few from the same list, on the same shelf the list draws.
function altsSection({ alts, ctx, ctxLabel, worn }) {
  if (!alts.length) return '';
  return `<section class="bp-section"><h3>Also good for ${esc(ctxLabel.toLowerCase())}</h3>${shelfHTML(alts, ctx, { wornId: worn })}</section>`;
}

// Partners from the same collection (src/layering.js), heavier one sprayed first.
function layeringSection({ f, partners, ctx }) {
  if (!partners) return '';
  const rows = partners.map(p => {
    const o = p.fragrance;
    const order = p.first.id === f.id ? `Spray this first, then ${o.name} on top.` : `Spray ${o.name} first, then this on top.`;
    return `<li class="pairing">
        <button class="pairing-head" data-action="open" data-ctx="${esc(ctx ?? '')}" data-id="${esc(o.id)}">
          ${img(o)}<span><b>${esc(o.name)}</b><small>${esc(o.brand)}</small></span>${icon.chevron}
        </button>
        ${reasonsList(p.reasons, 'compact')}
        <p class="pairing-order">${icon.spray}${esc(order)}</p>
      </li>`;
  }).join('');
  return `<section class="bp-section"><h3>Layer it with</h3>${rows
    ? `<ul class="pairings">${rows}</ul>`
    : '<p class="muted small">Nothing else in this collection layers well with it.</p>'}</section>`;
}

function accordsSection({ f }) {
  const bars = Object.entries(f.accords).map(([a, v]) => bar(a, v, accordColor(a), '', `, ${strength(v)}`)).join('');
  return `<section class="bp-section"><h3>Main accords</h3><div class="bars accords">${bars}</div></section>`;
}

function seasonsSection({ f }) {
  // Fragella, hand-entered and never-voted bottles show what their accords predict.
  const estimated = !f.seasonVotes;
  const peak = Math.max(...SEASONS.map(s => f.season[s]));
  const seasonBars = SEASONS.map(s => bar(s, (f.season[s] / peak) * 100, SEASON_COLORS[s], `${Math.round(f.season[s] * 100)}%`)).join('');
  const dnPeak = Math.max(f.dayNight.day, f.dayNight.night);
  const dnBars = ['day', 'night'].map(s => bar(s, (f.dayNight[s] / dnPeak) * 100, SEASON_COLORS[s], `${Math.round(f.dayNight[s] * 100)}%`)).join('');
  return `<section class="bp-section two-col">
    <div><h3>${estimated ? 'Season fit' : 'Seasons voted'}</h3><div class="bars">${seasonBars}</div></div>
    <div><h3>${estimated ? 'Time of day (est.)' : 'Time of day'}</h3><div class="bars">${dnBars}</div></div>
  </section>`;
}

function notesSection({ f }) {
  const layers = [['top', 'Top'], ['mid', 'Heart'], ['base', 'Base'], ['all', 'Notes']]
    .filter(([k]) => f.notes?.[k]?.length)
    .map(([k, label]) => `<div class="layer"><span class="layer-label">${label}</span><div class="notes">${f.notes[k].map(n => `<span class="note-chip">${esc(n)}</span>`).join('')}</div></div>`)
    .join('');
  return layers ? `<section class="bp-section"><h3>Notes</h3><div class="pyramid">${layers}</div></section>` : '';
}

// Orders leave room between them for wave 4's sections (shell-map.md lists them).
addSection({ id: 'head', order: 0, render: headSection });
addSection({ id: 'summary', order: 100, render: summarySection });
addSection({ id: 'actions', order: 150, render: actionsSection });
addSection({ id: 'why', order: 200, render: whySection });
addSection({ id: 'alts', order: 300, render: altsSection });
addSection({ id: 'layering', order: 400, render: layeringSection });
addSection({ id: 'accords', order: 500, render: accordsSection });
addSection({ id: 'seasons', order: 600, render: seasonsSection });
addSection({ id: 'notes', order: 700, render: notesSection });

// ---------- Actions ----------

export const actions = {
  // Any bottle, from any list: data-id, and data-ctx for the list it's in.
  open(el, app) {
    app.openBottle(el.dataset.id, el.dataset.ctx || null, el);
  },
  'close-bottle'(el, app) {
    app.closeBottle();
  },
  hide(el, app) {
    const id = el.dataset.id;
    setHidden(state.hiding, id, true, viewingDemo());
    app.closeBottle();
    app.render();
    app.showToast(`<span>${esc(findRecord(id)?.name ?? 'Bottle')} hidden from picks</span><button class="btn primary compact" data-action="unhide" data-id="${esc(id)}">Undo</button>`);
  },
  unhide(el, app) {
    setHidden(state.hiding, el.dataset.id, false, viewingDemo());
    app.render();
    app.hideToast();
  },
  own(el, app) {
    const f = findRecord(el.dataset.id);
    if (!f) return;
    app.own(f);
    // The button made way for Wear this (or the In Mine tag).
    document.querySelector('#bottle .bp-actions .btn')?.focus();
  },
  'bottle-retry'(el, app) {
    app.retryBottle();
  },
};
