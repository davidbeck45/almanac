// The building blocks every view draws with: icons, bottle photos, buttons,
// list rows, chips, bars, the magnitude shelf, messages and sheet frames.
// Pure string templates (they import cleanly in Node); interpolate data and
// user text only through esc(). Styles: src/css/components.css.
import { accordColor as baseAccordColor } from '../accords.js';
import { paint, paintAccord } from '../theme.js';
import { esc, cap, matchPct, plural } from '../ui.js';

// Accord colors in the current theme (src/theme.js).
export const accordColor = name => paintAccord(name, baseAccordColor(name));

// ---------- Photos ----------

const FALLBACK_THUMB = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150 170"><rect x="62" y="20" width="26" height="22" rx="4" fill="#3a3f4e"/><rect x="40" y="46" width="70" height="104" rx="18" fill="#2a2e3a" stroke="#4a5063" stroke-width="3"/></svg>')}`;
export const thumbSrc = f => (f.thumb ? esc(f.thumb) : FALLBACK_THUMB);
// Decorative (alt=""): the bottle's name is always text nearby.
export const img = (f, { lazy = true, cls = '' } = {}) =>
  `<img${cls ? ` class="${cls}"` : ''} src="${thumbSrc(f)}" alt="" width="150" height="170"${lazy ? ' loading="lazy"' : ''} decoding="async">`;

// ---------- Icons ----------
// 24px stroke icons, always aria-hidden: a control names itself in text or
// aria-label.

const svg = (body, extra = '') => `<svg viewBox="0 0 24 24" aria-hidden="true"${extra}>${body}</svg>`;
const stroke = d => svg(`<path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`);

export const icon = {
  pin: svg('<path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="10" r="2.5" fill="currentColor"/>'),
  sun: svg('<circle cx="12" cy="12" r="4.5" fill="currentColor"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></g>'),
  moon: svg('<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" fill="currentColor"/>'),
  refresh: stroke('M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7'),
  external: stroke('M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'),
  spray: stroke('M9.5 9.5h5v2.2a3 3 0 0 1 1.5 2.6V19a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-4.7a3 3 0 0 1 1.5-2.6Zm1-4h3v4h-3zM16.5 5.5h.01M18.5 4h.01M18.5 7h.01'),
  hide: stroke('M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.4 5.2A9.7 9.7 0 0 1 12 5c5 0 8.5 4.3 9.5 7-.4 1-1.2 2.4-2.4 3.7M6.1 6.2C4.2 7.5 3 9.4 2.5 12c1 2.7 4.5 7 9.5 7 1.6 0 3-.4 4.3-1.1'),
  plus: svg('<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'),
  paste: stroke('M9 4h6v3H9zM7 5.5H6a1 1 0 0 0-1 1V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6.5a1 1 0 0 0-1-1h-1M9 12h6M9 16h4'),
  pen: stroke('M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4ZM13.5 6.5l4 4'),
  share: stroke('M12 15V3M8 7l4-4 4 4M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7'),
  download: stroke('M12 3v12M8 11l4 4 4-4M5 15v4a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4'),
  bottle: svg('<path d="M10 2h4v3h-4zM9 5h6v2.5a4 4 0 0 1 3 3.9V20a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-8.6a4 4 0 0 1 3-3.9Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>'),
  remove: stroke('M5 7h14M10 11v6M14 11v6M9 7V4h6v3M7 7l1 13h8l1-13'),
  close: svg('<path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'),
  chevron: stroke('M9 6l6 6-6 6'),
  back: stroke('M15 6l-6 6 6 6'),
  search: stroke('M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4'),
  thermo: stroke('M10 13.5V5a2 2 0 1 1 4 0v8.5a4 4 0 1 1-4 0ZM12 9v7'),
  clock: stroke('M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2'),
  journal: stroke('M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5v-15ZM5 19.5A1.5 1.5 0 0 0 6.5 21H19M9 7h6'),
  calendar: stroke('M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7ZM4 10h16M8 3v4M16 3v4'),
  sparkle: svg('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" fill="currentColor"/>'),
  cloud: stroke('M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.2 9.1 4.5 4.5 0 0 0 7 18Z'),
  // Destinations and their panes.
  wear: stroke('M9.5 9.5h5v2.2a3 3 0 0 1 1.5 2.6V19a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-4.7a3 3 0 0 1 1.5-2.6Zm1-4h3v4h-3zM17 4.5l1.2-1.2M17.5 7.5h1.7'),
  wardrobe: stroke('M3 20.5h18M3 11.5h18M5.5 11.5V7.8a1.3 1.3 0 0 1 1.3-1.3h.9A1.3 1.3 0 0 1 9 7.8v3.7M6.5 6.5V4.5h1.5v2M12.5 11.5V8.5h3v3M15.5 20.5v-5a1.5 1.5 0 0 1 1.5-1.5h.5a1.5 1.5 0 0 1 1.5 1.5v5M16.5 14v-1.5h1.5V14M6 20.5v-3.5h4v3.5'),
  discover: stroke('M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM15.6 8.4l-2.1 5.1-5.1 2.1 2.1-5.1 5.1-2.1Z'),
  gear: svg('<path d="M10.44 4.77L10.72 2.49L13.28 2.49L13.56 4.77L16.01 5.78L17.82 4.37L19.63 6.18L18.22 7.99L19.23 10.44L21.51 10.72L21.51 13.28L19.23 13.56L18.22 16.01L19.63 17.82L17.82 19.63L16.01 18.22L13.56 19.23L13.28 21.51L10.72 21.51L10.44 19.23L7.99 18.22L6.18 19.63L4.37 17.82L5.78 16.01L4.77 13.56L2.49 13.28L2.49 10.72L4.77 10.44L5.78 7.99L4.37 6.18L6.18 4.37L7.99 5.78Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/>'),
  heart: stroke('M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20Z'),
  chart: stroke('M4 20h16M7 16.5V11M12 16.5V6M17 16.5v-3.5'),
  suitcase: stroke('M5 8h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1ZM9 8V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V8M8 8v12M16 8v12'),
  // The bottle page: Want (a heart, filled once wanted), Compare, your stars.
  heartFill: svg('<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20Z" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>'),
  compare: stroke('M12 4v16M8 20h8M5 7h14M5 7l-3 7a3 3 0 0 0 6 0L5 7ZM19 7l-3 7a3 3 0 0 0 6 0l-3-7Z'),
  star: stroke('M12 3.6l2.5 5.2 5.7.8-4.1 4 1 5.6L12 16.5l-5.1 2.7 1-5.6-4.1-4 5.7-.8L12 3.6Z'),
  // Filters (sliders), and two bottles' worth of overlap (smells like, twins).
  filter: stroke('M4 7h10M18 7h2M4 17h4M12 17h8M16 4.5v5M10 14.5v5'),
  similar: stroke('M9.5 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM14.5 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z'),
  // Occasions (OCCASIONS[].icon names these).
  cup: stroke('M5 10h11v4a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5v-4ZM16 11h1.5a2.5 2.5 0 0 1 0 5H16M8.5 3.5c-.8 1 .8 2 0 3M12 3.5c-.8 1 .8 2 0 3'),
  briefcase: stroke('M4.5 8h15A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-8A1.5 1.5 0 0 1 4.5 8ZM9 8V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 13h18M11 13v2h2v-2'),
  candle: stroke('M12 3c1.6 1.7 2.2 2.9 2.2 4a2.2 2.2 0 0 1-4.4 0c0-1.1.6-2.3 2.2-4ZM12 11v1M9 12h6v9H9zM6 21h12'),
  cocktail: stroke('M4.5 4h15L12 12.5 4.5 4ZM12 12.5V20M8 20h8M7.5 7.5h9M15 3l2.5-1.5'),
  bowtie: stroke('M10 10.5 4 7.5a1 1 0 0 0-1.5.9v7.2a1 1 0 0 0 1.5.9l6-3M14 10.5l6-3a1 1 0 0 1 1.5.9v7.2a1 1 0 0 1-1.5.9l-6-3M10 10h4v4h-4z'),
  leaf: stroke('M5 19c0-8.5 5.5-14 15-15-.5 9.5-6 15-15 15ZM5 19l7.5-7.5'),
  sofa: stroke('M5 11V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3M3 13a2 2 0 0 1 4 0v2h10v-2a2 2 0 0 1 4 0v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-4ZM6 18v2M18 18v2'),
};

export const slotIcon = slot => (slot === 'day' ? icon.sun : icon.moon);

// ---------- Weather glyphs ----------

const CLOUD_HI = 'M7.2 15h9.6a3.6 3.6 0 0 0 .3-7.2 5.4 5.4 0 0 0-10.4-.9A4.1 4.1 0 0 0 7.2 15Z';
const CLOUD_MID = 'M7.2 18h9.6a3.6 3.6 0 0 0 .3-7.2 5.4 5.4 0 0 0-10.4-.9A4.1 4.1 0 0 0 7.2 18Z';
const cloudPath = (d, cls = 'cl') => `<path class="${cls}" d="${d}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>`;
const WX_GLYPH = {
  clear: '<g class="sn"><circle cx="12" cy="12" r="4.2" fill="currentColor"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></g>',
  partly: `<g class="sn"><circle cx="9" cy="8.5" r="3.4" fill="currentColor"/><path d="M9 2v1.4M3.4 4.4l1 1M2.5 9.5h1.4M14.6 4.4l-1 1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></g><path class="cl-fill" d="${CLOUD_MID}"/>${cloudPath(CLOUD_MID)}`,
  cloudy: cloudPath('M6.8 19h10.4a3.9 3.9 0 0 0 .3-7.8 5.9 5.9 0 0 0-11.3-1A4.5 4.5 0 0 0 6.8 19Z'),
  fog: `${cloudPath(CLOUD_HI)}<path class="fg" d="M4 18.5h16M6.5 21.5h11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`,
  drizzle: `${cloudPath(CLOUD_HI)}<path class="dr" d="M8.5 18.5v.8M12 18.5v.8M15.5 18.5v.8M10.2 21.3v.5M13.8 21.3v.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`,
  rain: `${cloudPath(CLOUD_HI)}<path class="dr" d="M8.8 17.5l-1 3.2M12.5 17.5l-1 3.2M16.2 17.5l-1 3.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`,
  snow: `${cloudPath(CLOUD_HI)}<g class="sw" fill="currentColor"><circle cx="8.5" cy="18.6" r="1.1"/><circle cx="12" cy="20.6" r="1.1"/><circle cx="15.5" cy="18.6" r="1.1"/></g>`,
  storm: `${cloudPath(CLOUD_HI)}<path class="bt" d="M12.8 14.5l-2.6 4h3l-2 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`,
};
export const wxIcon = (category, label = '') =>
  `<span class="wx" data-cat="${esc(category)}"${label ? ` role="img" aria-label="${esc(label)}"` : ''}><svg viewBox="0 0 24 24" aria-hidden="true">${WX_GLYPH[category] ?? WX_GLYPH.cloudy}</svg></span>`;

// The moon where the sun would be: a clear or partly cloudy night.
const NIGHT_GLYPH = {
  clear: '<g class="mn"><path d="M19.5 14.6A8 8 0 0 1 9.4 4.5a8 8 0 1 0 10.1 10.1Z" fill="currentColor"/><path d="M17.5 3v3M16 4.5h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></g>',
  partly: `<g class="mn"><path d="M13 9.75A4.25 4.25 0 0 1 7.75 4.5 4.25 4.25 0 1 0 13 9.75Z" fill="currentColor"/></g><path class="cl-fill" d="${CLOUD_MID}"/>${cloudPath(CLOUD_MID)}`,
};
/** A window's weather glyph: wxIcon by day, the moon for a clear or partly cloudy night. */
export const wxIconFor = (win, label = '') => (win?.slot === 'night' && NIGHT_GLYPH[win.category]
  ? `<span class="wx" data-cat="${esc(win.category)}" data-night${label ? ` role="img" aria-label="${esc(label)}"` : ''}><svg viewBox="0 0 24 24" aria-hidden="true">${NIGHT_GLYPH[win.category]}</svg></span>`
  : wxIcon(win?.category, label));

// ---------- Messages and loading ----------

// An empty or error state: what happened and the one thing to do about it.
export function messageHTML({ glyph = icon.sparkle, title, body, action = '' }) {
  return `<div class="message">
    <span class="message-icon">${glyph}</span>
    <h2>${esc(title)}</h2><p>${esc(body)}</p>${action}
  </div>`;
}

export function skeletonHTML(count = 1) {
  const card = `<div class="card sk-card">
      <div class="sk-head"><span class="sk sk-thumb"></span><span class="sk-lines"><span class="sk sk-line w40"></span><span class="sk sk-line w70"></span></span></div>
      <div class="sk sk-pick"></div>
      <div class="sk sk-row"></div>
    </div>`;
  return `<div class="stack" aria-busy="true" aria-label="Loading picks">${card.repeat(count)}</div>`;
}

// A section's head: a title-3 heading and an optional trailing action.
export const sectionHead = (title, aside = '', { id = '', level = 2 } = {}) =>
  `<header class="section-head"><h${level}${id ? ` id="${id}"` : ''}>${title}</h${level}>${aside}</header>`;

// ---------- Overlay sheets ----------

// Backdrop, a dialog panel with grip and close button. `inner` must hold an
// element with id=titleId. `narrow`: a 440px dialog on wide screens.
export function sheetFrame(titleId, inner, { narrow = true } = {}) {
  return `
    <div class="sheet-backdrop" data-action="close-sheet"></div>
    <div class="sheet-panel${narrow ? ' narrow' : ''}" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
      <div class="sheet-grip" aria-hidden="true"></div>
      <button class="icon-btn sheet-close" data-action="close-sheet" aria-label="Close">${icon.close}</button>
      ${inner}
    </div>`;
}

// ---------- Data ----------

// A labelled bar. `value` shows at the end; `spoken` goes to screen readers instead.
export function bar(label, pct, color, value, spoken = '') {
  return `<div class="bar"><span class="bar-label">${esc(label)}</span>
    <span class="bar-track" aria-hidden="true"><span class="bar-fill" style="width:${Math.max(0, Math.min(100, pct)).toFixed(1)}%;--c:${paint(color)}"></span></span>
    ${spoken ? `<span class="visually-hidden">${esc(spoken)}</span>` : `<span class="bar-value">${esc(value)}</span>`}</div>`;
}

// Reasons with a check for what fits and a dash for what doesn't (tone never
// rests on color alone). `cls`: lead (pick cards), full (bottle page), compact.
export function reasonsList(reasons, cls = '') {
  if (!reasons.length) return '';
  return `<ul class="reasons ${cls}">${reasons.map(r => `<li class="${r.tone}">${esc(cap(r.text))}</li>`).join('')}</ul>`;
}

export function chips(accords, n = 3) {
  return `<div class="chips">${Object.keys(accords).slice(0, n)
    .map(a => `<span class="chip" style="--c:${accordColor(a)}">${esc(a)}</span>`).join('')}</div>`;
}

// The one rank signal: the match as a ring and a number.
export function matchBadge(entry) {
  const p = matchPct(entry);
  return `<span class="match" title="How well it fits right now" style="--p:${p}">
    <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8" pathLength="100"/><circle class="arc" cx="10" cy="10" r="8" pathLength="100"/></svg>${p}% match</span>`;
}

// A tier as star magnitude: one moonlight hue, S brightest.
export const magDot = tier => `<span class="mag" data-tier="${esc(tier)}" aria-hidden="true"></span>`;
const TIER_WORDS = { S: 'tier S', A: 'tier A', B: 'tier B', C: 'tier C' };

// The magnitude shelf: bottles standing on a 1px shelf line with a caption
// and a magnitude dot, B and C dimmed. Scrolls sideways on phones and stacks
// into rows on wide screens. Each opens its bottle page in context `ctx`.
export function shelfHTML(ranked, ctx, { wornId = null } = {}) {
  if (!ranked.length) return '';
  return `<ul class="shelf">${ranked.map(r => {
    const f = r.fragrance;
    return `<li class="shelf-slot" data-tier="${r.tier}"><button class="shelf-item${wornId === f.id ? ' worn' : ''}" data-action="open" data-ctx="${esc(ctx)}" data-id="${esc(f.id)}" aria-label="${esc(`${f.name}, ${matchPct(r)}% match, ${TIER_WORDS[r.tier]}`)}">
      <span class="shelf-bottle">${img(f)}${magDot(r.tier)}</span>
      <span class="shelf-name">${esc(f.name)}</span>
    </button></li>`;
  }).join('')}</ul>`;
}

// ---------- Buttons and controls ----------

// Logs or clears a wear for the window in context `ctx`. Screen readers hear
// which bottle ("Wear this: Aristo"), since the card may not name it.
export function wearButton(entry, ctx, wornId) {
  const f = entry.fragrance;
  const on = wornId === f.id;
  return `<button class="btn primary wear-btn${on ? ' on' : ''}" data-action="wear" data-ctx="${esc(ctx)}" data-id="${esc(f.id)}" aria-pressed="${on}">
    ${on ? icon.check : icon.spray}<span>${on ? 'Wearing' : 'Wear this'}<span class="visually-hidden">: ${esc(f.name)}</span></span></button>`;
}

// A segmented control of toggle buttons. items: [{ value, label, icon?, on }];
// each button carries data-action and data-value. `glass` draws it over the scene.
export function segHTML(items, { action, label, cls = '' }) {
  return `<div class="seg ${cls}" role="group" aria-label="${esc(label)}">${items.map(i => `<button type="button" data-action="${esc(action)}" data-value="${esc(i.value)}" aria-pressed="${Boolean(i.on)}">${i.icon ?? ''}<span>${esc(i.label)}</span></button>`).join('')}</div>`;
}

// Sub-navigation: the same look as segHTML, but links (it changes the route).
export function segLinksHTML(items, { label, cls = '' }) {
  return `<nav class="seg seg-links ${cls}" aria-label="${esc(label)}">${items.map(i => `<a href="${esc(i.href)}" data-href="${esc(i.href)}"${i.on ? ' aria-current="page"' : ''}>${i.icon ?? ''}<span>${esc(i.label)}</span></a>`).join('')}</nav>`;
}

export function switchHTML({ on, label, action, id }) {
  return `<button class="switch" role="switch" aria-checked="${on}" data-action="${esc(action)}" data-id="${esc(id)}" aria-label="${esc(label)}"><span></span></button>`;
}

// ---------- Rows ----------

// A list row: a 34px photo, title and meta, then trailing controls. With
// `open` the photo and title open the bottle page (`open` = { ctx }).
export function rowHTML(f, { meta = '', trailing = '', open = null, cls = '', attrs = '' } = {}) {
  const body = `${img(f)}<span class="row-text"><b>${esc(f.name)}</b><small>${meta}</small></span>`;
  const main = open
    ? `<button class="row-main" data-action="open" data-ctx="${esc(open.ctx ?? '')}" data-id="${esc(f.id)}">${body}</button>`
    : `<span class="row-main">${body}</span>`;
  return `<li class="row ${cls}"${attrs}>${main}${trailing}</li>`;
}

// ---------- Bottle cards ----------

// A bottle to consider (Discover's picks; any suggestion): its photo stands
// on a horizon line, and the photo, name and meta are one button that opens
// its page (context `ctx`); screen readers hear the name as its label and
// the marks as its description. `marks`: [{ text, tone: 'good' | 'warn' | '',
// spoken }] (rating, value, risk; `spoken` replaces the text for screen
// readers). `tags`: [{ text, color, on, kind }] (style chips; `on` lights the
// ones the list was asked for, kind 'close' draws the wears-close marker).
// `lines`: HTML sentences on why it's here. `corner` sits top right (a Want
// toggle), `actions` along the bottom. `key` keeps ids unique when a bottle
// shows in two lists. The caller escapes `meta`, `lines`, `corner` and `actions`.
export function bottleCardHTML(f, { ctx = '', key = 'c', meta = '', marks = [], tags = [], lines = [], corner = '', actions = '', cls = '' } = {}) {
  const id = `bc-${String(key).replace(/[^\w-]/g, '')}-${String(f.id).replace(/[^\w-]/g, '_')}`;
  const markHTML = marks.length
    ? `<span class="bcard-marks" id="${id}-m">${marks.map(m => `<span class="bcard-mark ${esc(m.tone ?? '')}">${m.spoken
      ? `<span aria-hidden="true">${esc(m.text)}</span><span class="visually-hidden">${esc(m.spoken)}</span>`
      : esc(m.text)}</span>`).join('<span class="visually-hidden">, </span>')}</span>`
    : '';
  const tagHTML = tags.length
    ? `<ul class="bcard-tags" aria-label="Styles">${tags.map(t => `<li class="tag${t.on ? ' on' : ''}${t.kind ? ` ${esc(t.kind)}` : ''}"${t.color ? ` style="--c:${t.color}"` : ''}>${esc(t.text)}</li>`).join('')}</ul>`
    : '';
  return `<article class="bcard ${cls}">
    <button class="bcard-open" data-action="open" data-ctx="${esc(ctx)}" data-id="${esc(f.id)}" aria-labelledby="${id}-n"${markHTML ? ` aria-describedby="${id}-m"` : ''}>
      <span class="bcard-photo">${img(f)}</span>
      <span class="bcard-title"><b class="bcard-name" id="${id}-n">${esc(f.name)}</b>${meta ? `<span class="bcard-meta">${meta}</span>` : ''}${markHTML}</span>
    </button>
    ${corner ? `<div class="bcard-corner">${corner}</div>` : ''}
    ${tagHTML}
    ${lines.length ? `<div class="bcard-why">${lines.map(l => `<p>${l}</p>`).join('')}</div>` : ''}
    ${actions ? `<div class="bcard-actions">${actions}</div>` : ''}
  </article>`;
}

// Bottle cards while their list loads, the same size as the real ones.
export function bottleCardSkeletonHTML(count = 1) {
  const card = `<div class="bcard sk-bcard" aria-hidden="true">
      <div class="bcard-open"><span class="sk bcard-photo"></span><span class="bcard-title"><span class="sk sk-line w70"></span><span class="sk sk-line w40"></span><span class="sk sk-line w30"></span></span></div>
      <div class="bcard-tags"><span class="sk sk-tag"></span><span class="sk sk-tag"></span></div>
      <div class="bcard-why"><span class="sk sk-line"></span><span class="sk sk-line w70"></span></div>
      <div class="bcard-actions"><span class="sk sk-btn"></span><span class="sk sk-btn"></span></div>
    </div>`;
  return card.repeat(count);
}

// ---------- Shared link ----------

// `confirm`: Save as mine was tapped once and would replace Mine.
export function sharedBannerHTML(shared, mineCount, { slim = false, confirm = false } = {}) {
  const who = shared.name ? `${esc(shared.name)}’s` : 'A shared';
  const status = shared.loading ? 'Loading…' : `${plural(shared.records.length, 'bottle')}${shared.missing.length ? ` · ${shared.missing.length} couldn’t load` : ''}`;
  const save = confirm ? `Replace my ${mineCount}?` : 'Save as mine';
  return `<div class="banner${slim ? ' slim' : ''}" role="status">
    <span class="banner-icon">${icon.share}</span>
    <span class="banner-text"><b>${who} collection</b><small>${status}</small></span>
    <button class="btn primary compact" data-action="shared-save" ${shared.loading || !shared.records.length ? 'disabled' : ''}>${save}</button>
    <button class="icon-btn" data-action="shared-close" aria-label="Close shared collection">${icon.close}</button>
  </div>`;
}
