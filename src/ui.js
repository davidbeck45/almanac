// HTML templates. Everything user-visible is built here; main.js owns state.
import { ACCORDS, accordColor as baseAccordColor } from './accords.js';
import { renderScene } from './scene.js';
import { calendarSeason, SEASONS } from './engine.js';
import { OCCASIONS } from './occasions.js';
import { paint, paintAccord, theme } from './theme.js';

// Accord colors in the current theme (src/theme.js).
const accordColor = name => paintAccord(name, baseAccordColor(name));

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const TIERS = ['S', 'A', 'B', 'C'];

// Temperatures stay in °F everywhere else; only display converts.
let units = 'F';
export const setUnits = u => { units = u === 'C' ? 'C' : 'F'; };
export const temp = f => Math.round(units === 'C' ? ((f - 32) * 5) / 9 : f);
export const deg = f => `${temp(f)}°`;

const FALLBACK_THUMB = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150 170"><rect x="62" y="20" width="26" height="22" rx="4" fill="#3a3f4e"/><rect x="40" y="46" width="70" height="104" rx="18" fill="#2a2e3a" stroke="#4a5063" stroke-width="3"/></svg>')}`;
export const thumbSrc = f => (f.thumb ? esc(f.thumb) : FALLBACK_THUMB);
const img = (f, { lazy = true, cls = '' } = {}) =>
  `<img${cls ? ` class="${cls}"` : ''} src="${thumbSrc(f)}" alt="" width="150" height="170"${lazy ? ' loading="lazy"' : ''} decoding="async">`;

const svg = (body, extra = '') => `<svg viewBox="0 0 24 24" aria-hidden="true"${extra}>${body}</svg>`;
const stroke = d => svg(`<path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`);

export const icon = {
  pin: svg('<path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="10" r="2.5" fill="currentColor"/>'),
  sun: svg('<circle cx="12" cy="12" r="4.5" fill="currentColor"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></g>'),
  moon: svg('<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" fill="currentColor"/>'),
  refresh: stroke('M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7'),
  external: stroke('M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'),
  spray: stroke('M8 9h6v11a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V9Zm1-4h4v4H9zM15 6h2M18 4l1-1M18 8l1 1'),
  hide: stroke('M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.4 5.2A9.7 9.7 0 0 1 12 5c5 0 8.5 4.3 9.5 7-.4 1-1.2 2.4-2.4 3.7M6.1 6.2C4.2 7.5 3 9.4 2.5 12c1 2.7 4.5 7 9.5 7 1.6 0 3-.4 4.3-1.1'),
  plus: svg('<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'),
  paste: stroke('M9 4h6v3H9zM7 5.5H6a1 1 0 0 0-1 1V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6.5a1 1 0 0 0-1-1h-1M9 12h6M9 16h4'),
  share: stroke('M12 15V3M8 7l4-4 4 4M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7'),
  bottle: svg('<path d="M10 2h4v3h-4zM9 5h6v2.5a4 4 0 0 1 3 3.9V20a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-8.6a4 4 0 0 1 3-3.9Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>'),
  remove: stroke('M5 7h14M10 11v6M14 11v6M9 7V4h6v3M7 7l1 13h8l1-13'),
  close: svg('<path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'),
  chevron: stroke('M9 6l6 6-6 6'),
  search: stroke('M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4'),
  thermo: stroke('M10 13.5V5a2 2 0 1 1 4 0v8.5a4 4 0 1 1-4 0ZM12 9v7'),
  clock: stroke('M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2'),
  journal: stroke('M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5v-15ZM5 19.5A1.5 1.5 0 0 0 6.5 21H19M9 7h6'),
  calendar: stroke('M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7ZM4 10h16M8 3v4M16 3v4'),
  sparkle: svg('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" fill="currentColor"/>'),
  cloud: stroke('M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.2 9.1 4.5 4.5 0 0 0 7 18Z'),
  // Occasions (OCCASIONS[].icon names these).
  cup: stroke('M5 10h11v4a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5v-4ZM16 11h1.5a2.5 2.5 0 0 1 0 5H16M8.5 3.5c-.8 1 .8 2 0 3M12 3.5c-.8 1 .8 2 0 3'),
  briefcase: stroke('M4.5 8h15A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-8A1.5 1.5 0 0 1 4.5 8ZM9 8V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 13h18M11 13v2h2v-2'),
  candle: stroke('M12 3c1.6 1.7 2.2 2.9 2.2 4a2.2 2.2 0 0 1-4.4 0c0-1.1.6-2.3 2.2-4ZM12 11v1M9 12h6v9H9zM6 21h12'),
  cocktail: stroke('M4.5 4h15L12 12.5 4.5 4ZM12 12.5V20M8 20h8M7.5 7.5h9M15 3l2.5-1.5'),
  bowtie: stroke('M10 10.5 4 7.5a1 1 0 0 0-1.5.9v7.2a1 1 0 0 0 1.5.9l6-3M14 10.5l6-3a1 1 0 0 1 1.5.9v7.2a1 1 0 0 1-1.5.9l-6-3M10 10h4v4h-4z'),
  leaf: stroke('M5 19c0-8.5 5.5-14 15-15-.5 9.5-6 15-15 15ZM5 19l7.5-7.5'),
  sofa: stroke('M5 11V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3M3 13a2 2 0 0 1 4 0v2h10v-2a2 2 0 0 1 4 0v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-4ZM6 18v2M18 18v2'),
};

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

// ---------- Small helpers ----------

const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const MONTH_DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const WEEKDAY_SHORT = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' });
const utcDate = iso => new Date(`${iso}T12:00:00Z`);
export const shortDate = iso => MONTH_DAY.format(utcDate(iso));
const weekdayShort = iso => WEEKDAY_SHORT.format(utcDate(iso));

function relativeDay(iso, todayISO) {
  const days = Math.round((Date.parse(todayISO) - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return shortDate(iso);
}

export const matchPct = entry => Math.max(1, Math.min(99, Math.round(entry.score * 100)));

function matchBadge(entry) {
  const p = matchPct(entry);
  return `<span class="match" title="How well it fits right now" style="--p:${p}">
    <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8" pathLength="100"/><circle class="arc" cx="10" cy="10" r="8" pathLength="100"/></svg>${p}% match</span>`;
}

function feelWords(win) {
  const words = [];
  if (win.feelsF >= 65 && win.dewF >= 65) words.push('muggy');
  else if (win.feelsF >= 65 && win.dewF >= 60) words.push('humid');
  else if (win.humidity < 35) words.push('dry');
  if (win.pop >= 30) words.push(`${win.pop}% rain`);
  return words;
}

function windowRange(win, nowHour) {
  const fmt = h => (h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`);
  const [start, end] = win.slot === 'day' ? [10, 17] : [19, 23];
  const today = win.label === 'Today' || win.label === 'Tonight';
  return `${today && nowHour > start ? 'Now' : fmt(start)}–${fmt(end)}`;
}

function sheetFrame(titleId, inner, { narrow = false } = {}) {
  return `
    <div class="sheet-backdrop" data-close></div>
    <div class="sheet-panel${narrow ? ' narrow' : ''}" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
      <div class="sheet-grip" aria-hidden="true"></div>
      <button class="icon-btn sheet-close" data-close aria-label="Close">${icon.close}</button>
      ${inner}
    </div>`;
}

export function messageHTML({ glyph = icon.sparkle, title, body, action = '' }) {
  return `<div class="message">
    <span class="message-icon">${glyph}</span>
    <h2>${esc(title)}</h2><p>${esc(body)}</p>${action}
  </div>`;
}

export function skeletonHTML(count = 2) {
  const card = `<div class="slot sk-card">
      <div class="sk-head"><span class="sk sk-thumb"></span><span class="sk-lines"><span class="sk sk-line w40"></span><span class="sk sk-line w70"></span></span></div>
      <div class="sk sk-pick"></div>
      <div class="sk sk-row"></div><div class="sk sk-row"></div>
    </div>`;
  return `<div class="slots${count === 1 ? ' single' : ''}" aria-busy="true" aria-label="Loading picks">${card.repeat(count)}</div>`;
}

// ---------- Hero ----------

export function heroPicksHTML(picks) {
  if (!picks) return '';
  return `<div class="hero-picks">${picks.map(({ slot, label, entry, worn }) => `
    <button class="hero-pick" data-jump="${slot}">
      ${img(entry.fragrance, { lazy: false })}
      <span><small>${slot === 'day' ? icon.sun : icon.moon}${esc(worn ? 'Wearing' : label)}</small><b>${esc(entry.fragrance.name)}</b></span>
      ${icon.chevron}
    </button>`).join('')}</div>`;
}

// The sky before the forecast arrives (or when it can't): the phase from the
// device clock, so a loading screen at night isn't a sunny day.
export function sceneNow(wx, { error = false, date = new Date() } = {}) {
  const now = wx?.now;
  if (now) return { phase: now.phase, category: now.category, sunProgress: now.sunProgress };
  const h = date.getHours() + date.getMinutes() / 60;
  const phase = h < 5.5 || h >= 20.5 ? 'night' : h < 7.5 ? 'dawn' : h < 18.5 ? 'day' : 'dusk';
  return { phase, category: error ? 'cloudy' : 'partly', sunProgress: Math.min(1, Math.max(0, (h - 6.5) / 13)) };
}

export function heroHTML({ loc, wx, loading, error, updating }, aspect, picks, collectionLabel) {
  const now = wx?.now;
  const sky = sceneNow(wx, { error: Boolean(error) });
  const scene = renderScene({
    ...sky,
    season: calendarSeason(new Date(), loc?.lat ?? 1),
    cold: now ? now.feelsF < 50 : false,
    aspect,
    label: now ? `${now.label}, ${deg(now.tempF)}` : 'Weather scene',
    theme: theme(),
  });
  const locBtn = `<button class="loc-btn" data-action="location" aria-label="Change location: ${esc(loc?.name ?? 'not set')}">${icon.pin}<span>${esc(loc?.name ?? 'Set location')}</span></button>`;
  let body;
  if (now) {
    const status = updating ? '<div class="hero-sub updating">Updating…</div>'
      : `<div class="hero-sub">${Math.round(now.humidity)}% humidity${wx.stale ? ' · offline' : ''}</div>`;
    body = `
      <div class="hero-temp">${temp(now.tempF)}<span class="deg">°</span></div>
      <div class="hero-meta">
        <div class="hero-cond">${esc(now.label)}</div>
        <div class="hero-sub">Feels ${deg(now.feelsF)} · H ${deg(now.hiF)} L ${deg(now.loF)}</div>
        ${status}
      </div>`;
  } else if (error) {
    body = `<div class="hero-meta"><div class="hero-cond">Weather unavailable</div><div class="hero-sub">${esc(loc?.name ?? '')}</div></div>`;
  } else {
    body = `<div class="hero-meta"><div class="hero-cond">${loading ? 'Checking the sky…' : 'Where are you?'}</div><div class="hero-sub">${loading ? '&nbsp;' : 'Set a location to get picks.'}</div></div>`;
  }
  return `
    <div class="hero-scene">${scene}</div>
    <div class="hero-shade"></div>
    <div class="hero-top">
      ${locBtn}
      <span class="wordmark" aria-hidden="true">Scentcast</span>
      <button class="loc-btn" data-action="collection">${icon.bottle}<span>${esc(collectionLabel)}</span></button>
    </div>
    <div class="hero-foot">
      <div class="hero-bottom">${body}</div>
      ${heroPicksHTML(picks)}
    </div>`;
}

// ---------- Cards ----------

function chips(accords, n = 3) {
  return Object.keys(accords).slice(0, n)
    .map(a => `<span class="chip" style="--c:${accordColor(a)}">${esc(a)}</span>`).join('');
}

export function displayReasons(entry, n) {
  const good = entry.reasons.filter(r => r.tone === 'good');
  const bad = entry.reasons.filter(r => r.tone === 'bad');
  const ordered = entry.tier === 'S' || entry.tier === 'A' ? [...good, ...bad] : [...bad, ...good];
  return ordered.slice(0, n);
}

function reasonsList(reasons, cls = '') {
  if (!reasons.length) return '';
  const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
  return `<ul class="reasons ${cls}">${reasons.map(r => `<li class="${r.tone}">${esc(cap(r.text))}</li>`).join('')}</ul>`;
}

function wearButton(entry, ctx, wornId) {
  const on = wornId === entry.fragrance.id;
  return `<button class="btn primary wear-btn${on ? ' on' : ''}" data-wear data-ctx="${esc(ctx)}" data-id="${esc(entry.fragrance.id)}" aria-pressed="${on}">
    ${on ? icon.check : icon.spray}<span>${on ? 'Wearing' : 'Wear this'}</span></button>`;
}

export function slotHeaderHTML(win, nowHour) {
  const thumb = renderScene({
    phase: win.slot === 'day' ? 'day' : 'night',
    category: win.category,
    sunProgress: 0.42,
    season: calendarSeason(win.date, win.lat),
    cold: win.feelsF < 50,
    aspect: 78 / 54,
    label: `${win.label}: ${win.condition}`,
    theme: theme(),
  });
  const line = [windowRange(win, nowHour), win.condition, `feels ${deg(win.feelsF)}`, ...feelWords(win)].join(' · ');
  return `
    <header class="slot-head">
      <div class="slot-thumb">${thumb}</div>
      <div class="slot-title">
        <h2>${win.slot === 'day' ? icon.sun : icon.moon}${esc(win.label)}</h2>
        <p>${esc(line)}</p>
      </div>
    </header>`;
}

export function pickHTML(entry, ctx, wornId, kicker, { canWear = true } = {}) {
  const f = entry.fragrance;
  const top = Object.keys(f.accords)[0];
  const worn = wornId === f.id;
  return `
    <article class="pick" style="--accord:${accordColor(top)}">
      <button class="pick-bottle" data-open data-ctx="${esc(ctx)}" data-id="${esc(f.id)}" aria-label="Details for ${esc(f.name)}">
        ${img(f, { lazy: false })}
      </button>
      <div class="pick-info">
        <div class="kicker"><span class="tier-chip" data-tier="${entry.tier}">${entry.tier}</span>${esc(worn ? 'Wearing' : kicker)}</div>
        <h3><button class="pick-name" data-open data-ctx="${esc(ctx)}" data-id="${esc(f.id)}">${esc(f.name)}</button></h3>
        <div class="brand">${esc(f.brand)}</div>
        ${reasonsList(displayReasons(entry, 2))}
        <div class="chips">${chips(f.accords)}</div>
        <div class="pick-actions">${canWear ? wearButton(entry, ctx, wornId) : ''}${matchBadge(entry)}</div>
      </div>
    </article>`;
}

export function tierListHTML(ranked, ctx, wornId, expanded) {
  const rows = TIERS.map(t => {
    const items = ranked.filter(r => r.tier === t).map(r => {
      const f = r.fragrance;
      return `<button class="bottle${wornId === f.id ? ' worn' : ''}" data-open data-ctx="${esc(ctx)}" data-id="${esc(f.id)}" title="${esc(f.name)} · ${esc(f.brand)} · ${matchPct(r)}% match">
        ${img(f)}
        <span>${esc(f.name)}</span>
      </button>`;
    }).join('');
    return items ? `<div class="tier" data-tier="${t}"><div class="tier-label">${t}</div><div class="tier-items">${items}</div></div>` : '';
  });
  const hiddenCount = ranked.filter(r => r.tier === 'B' || r.tier === 'C').length;
  return `<div class="tierlist">
    ${rows.slice(0, 2).join('')}
    ${expanded ? rows.slice(2).join('') : ''}
    ${hiddenCount ? `<button class="more-btn" data-expand="${esc(ctx)}" aria-expanded="${expanded}">
      ${expanded ? 'Show less' : `Show B & C tiers · ${hiddenCount} more`}
    </button>` : ''}
  </div>`;
}

// ---------- Week ----------

function weekPick(p, slot, dayName) {
  if (!p) return `<span class="wk-pick empty"><span class="wk-slot">${slot === 'day' ? icon.sun : icon.moon}</span><span class="wk-none">Done for today</span></span>`;
  const f = p.pick.fragrance;
  return `<button class="wk-pick${p.worn ? ' worn' : ''}" data-open data-ctx="${esc(p.ctx)}" data-id="${esc(f.id)}" aria-label="${esc(`${dayName} ${slot === 'day' ? 'daytime' : 'night'}: ${f.name}`)}">
    ${img(f)}
    <span class="wk-text"><small>${slot === 'day' ? icon.sun : icon.moon}${slot === 'day' ? 'Day' : 'Night'}${p.worn ? ' · wearing' : ''}</small><b>${esc(f.name)}</b></span>
    <span class="tier-chip" data-tier="${p.pick.tier}">${p.pick.tier}</span>
  </button>`;
}

export function weekHTML(days) {
  const rows = days.map(d => `
    <li class="wk-day${d.isToday ? ' today' : ''}">
      <div class="wk-date"><b>${esc(d.isToday ? 'Today' : weekdayShort(d.dateISO))}</b><small>${esc(shortDate(d.dateISO))}</small></div>
      <div class="wk-wx">${wxIcon(d.category, d.condition)}<span class="wk-temps"><b>${deg(d.hiF)}</b><small>${deg(d.loF)}</small></span><span class="wk-pop"${d.pop >= 30 ? ` aria-label="${d.pop}% chance of rain">${d.pop}%` : ' aria-hidden="true">&nbsp;'}</span></div>
      <div class="wk-picks">${weekPick(d.day, 'day', d.name)}${weekPick(d.night, 'night', d.name)}</div>
    </li>`).join('');
  return `<section class="week" aria-labelledby="week-title">
    <header class="section-head">
      <h2 id="week-title">${icon.calendar}The week ahead</h2>
      <p>Planned against the forecast so nothing repeats back to back. Tap a bottle to see why.</p>
    </header>
    <ol class="wk-list" style="--days:${days.length}">${rows}</ol>
  </section>`;
}

// ---------- Journal ----------

export function journalTeaserHTML({ strip, stats }, resolve) {
  const cells = strip.map(c => {
    const worn = [c.day, c.night].map(h => h && resolve(h.id)).filter(Boolean);
    return `<span class="jt-cell${c.isToday ? ' today' : ''}">
      <small>${esc(c.label)}</small>
      <span class="jt-bottles">${worn.length ? worn.map(f => img(f)).join('') : '<i></i>'}</span>
    </span>`;
  }).join('');
  return `<section class="journal-teaser" aria-label="Wear journal">
    <header>
      <div><h2>${icon.journal}Wear journal</h2><p>${plural(stats.wears, 'wear')} · ${plural(stats.bottles, 'bottle')} in 30 days</p></div>
      <button class="btn secondary compact" data-action="journal">Open ${icon.chevron}</button>
    </header>
    <div class="jt-strip">${cells}</div>
  </section>`;
}

export function journalSheetHTML({ stats, calendar, dusty, confirmClear, todayISO }, resolve) {
  const top = stats.top.map(([id, n]) => [resolve(id), n]).filter(([f]) => f).slice(0, 5);
  const most = top[0];
  const peak = most?.[1] ?? 1;
  const tiles = `<div class="stat-tiles">
    <div class="stat"><b>${stats.wears}</b><span>wears</span></div>
    <div class="stat"><b>${stats.bottles}</b><span>bottles</span></div>
    <div class="stat wide">${most ? `${img(most[0])}<span><b class="name">${esc(most[0].name)}</b><span>most worn · ${most[1]}×</span></span>` : '<span><b class="name">—</b><span>most worn</span></span>'}</div>
  </div>`;
  const weekdays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(d => `<span class="cal-dow">${d}</span>`).join('');
  const cells = calendar.flat().map(c => {
    const worn = [c.day, c.night].map(h => h && resolve(h.id)).filter(Boolean);
    const day = +c.dateISO.slice(8, 10);
    const label = worn.length ? `${shortDate(c.dateISO)}: ${worn.map(f => f.name).join(', ')}` : shortDate(c.dateISO);
    return `<span class="cal-cell${c.future ? ' future' : ''}${c.dateISO === todayISO ? ' today' : ''}${worn.length ? ' has' : ''}" title="${esc(label)}">
      <small>${day === 1 ? esc(shortDate(c.dateISO)) : day}</small>
      <span class="cal-bottles">${worn.map(f => img(f)).join('')}</span>
    </span>`;
  }).join('');
  const mostList = top.length
    ? `<ul class="rank-list">${top.map(([f, n]) => `<li>${img(f)}<span class="manage-name"><b>${esc(f.name)}</b><small>${esc(f.brand)}</small></span>
        <span class="rank-bar"><span style="width:${((n / peak) * 100).toFixed(0)}%"></span></span><span class="rank-n">${n}×</span></li>`).join('')}</ul>`
    : '<p class="muted small">Nothing logged in the last 30 days.</p>';
  const dustList = dusty.length
    ? `<ul class="dust-list">${dusty.map(({ f, last }) => `<li><button data-open data-ctx="day" data-id="${esc(f.id)}">${img(f)}<span><b>${esc(f.name)}</b><small>${last ? `Last worn ${esc(relativeDay(last, todayISO))}` : 'Not worn yet'}</small></span></button></li>`).join('')}</ul>`
    : '<p class="muted small">Every bottle in rotation got worn this month. Nice.</p>';
  return sheetFrame('journal-title', `
    <h2 id="journal-title" class="sheet-title">Wear journal</h2>
    <p class="muted lede">What you logged with “Wear this” in the last 30 days. History stays on this device.</p>
    ${tiles}
    <section><h3>Calendar</h3><div class="calendar">${weekdays}${cells}</div></section>
    <section><h3>Most worn</h3>${mostList}</section>
    <section><h3>Gathering dust</h3>${dustList}</section>
    <div class="sheet-bar">
      <button class="btn tertiary" data-action="journal-export">${icon.share}Export</button>
      <button class="btn ${confirmClear ? 'secondary danger' : 'tertiary'}" data-action="journal-clear">${icon.remove}${confirmClear ? 'Tap again to clear' : 'Clear history'}</button>
    </div>`);
}

// ---------- Occasion controls ----------

// A radio group: one tab stop, arrow keys move the choice (src/main.js).
export function occasionPickerHTML(activeId) {
  return `<div class="occasions" role="radiogroup" aria-label="Occasion" style="--n:${OCCASIONS.length}">
    ${OCCASIONS.map(o => `<button class="occ${o.id === activeId ? ' on' : ''}" role="radio" aria-checked="${o.id === activeId}" tabindex="${o.id === activeId ? 0 : -1}" data-occasion="${o.id}">
      <span class="occ-icon">${icon[o.icon] ?? icon.sparkle}</span>
      <span class="occ-label">${esc(o.label)}</span>
      <span class="occ-blurb">${esc(o.blurb)}</span>
    </button>`).join('')}
  </div>`;
}

export function slotToggleHTML(slot, wx) {
  const btn = (s, text) => `<button data-occ-slot="${s}" aria-pressed="${slot === s}">${s === 'day' ? icon.sun : icon.moon}${esc(text)}</button>`;
  const first = wx.night.dateISO < wx.day.dateISO ? 'night' : 'day';
  const order = first === 'night' ? ['night', 'day'] : ['day', 'night'];
  return `<div class="seg">${order.map(s => btn(s, wx[s].label)).join('')}</div>`;
}

// ---------- Detail sheet ----------

// `value` shows at the end of the bar; `spoken` only to screen readers.
function bar(label, pct, color, value, spoken = '') {
  return `<div class="bar"><span class="bar-label">${esc(label)}</span>
    <span class="bar-track" aria-hidden="true"><span class="bar-fill" style="width:${Math.max(0, Math.min(100, pct)).toFixed(1)}%;--c:${paint(color)}"></span></span>
    ${spoken ? `<span class="visually-hidden">${esc(spoken)}</span>` : `<span class="bar-value">${esc(value)}</span>`}</div>`;
}

// Accord bars are Fragrantica's widths (30–100), read out as words.
const strength = width => (width >= 85 ? 'dominant' : width >= 65 ? 'strong' : width >= 45 ? 'moderate' : 'light');

const SEASON_COLORS = { winter: '#8fc7f0', spring: '#9be39a', summer: '#f6a08f', fall: '#f2b264', day: '#f5c451', night: '#8ea3d9' };
const GENDER = { men: 'for\u00a0men', women: 'for\u00a0women', 'women and men': 'unisex' };
const FACTORS = [
  ['occasion', 'Occasion', '#e7b6ff'],
  ['season', 'Season', '#9be39a'],
  ['weather', 'Weather', '#8fc7f0'],
  ['time', 'Time of day', '#f5c451'],
  ['quality', 'Crowd rating', '#f2b264'],
];

function whyHTML(entry) {
  const p = entry.parts;
  const bars = FACTORS.filter(([k]) => p[k] !== null && p[k] !== undefined)
    .map(([k, label, color]) => bar(label, p[k] * 100, color, `${Math.round(p[k] * 100)}`)).join('');
  const rotation = p.rotation > 0
    ? `<p class="why-note">−${Math.round(p.rotation * 100)} for rotation: ${esc(p.planned ? 'already in the plan nearby' : 'worn recently')}.</p>`
    : '';
  return `<section><h3>Why it ranks here <span class="h3-aside">${matchPct(entry)}% match</span></h3><div class="bars why">${bars}</div>${rotation}</section>`;
}

function wearsHTML(wears, todayISO) {
  if (!wears) return '';
  const text = wears.count
    ? `Worn ${wears.count}× in the last 30 days · last ${relativeDay(wears.last, todayISO)}`
    : wears.last ? `Last worn ${relativeDay(wears.last, todayISO)}` : 'No wears logged yet';
  return `<div class="wears">${icon.clock}<span>${esc(text)}</span></div>`;
}

// The feels-like range a bottle suits (engine comfortRange), in the user's units.
function comfortHTML(range) {
  if (!range || (range.lowF === null && range.highF === null)) return '';
  const { lowF, highF } = range;
  const text = lowF === null ? `Best when it feels ${deg(highF)} or colder`
    : highF === null ? `Best when it feels ${deg(lowF)} or warmer`
    : `Best when it feels ${temp(lowF)}–${deg(highF)}`;
  return `<div class="wears">${icon.thermo}<span>${esc(text)}</span></div>`;
}

// Partners from the same collection (src/layering.js), heavier one sprayed first.
function layersHTML(f, layers, ctx) {
  if (!layers) return '';
  const rows = layers.map(p => {
    const o = p.fragrance;
    const order = p.first.id === f.id ? `Spray this first, then ${o.name} on top.` : `Spray ${o.name} first, then this on top.`;
    return `<li class="pairing">
        <button class="pairing-head" data-open data-ctx="${esc(ctx)}" data-id="${esc(o.id)}">
          ${img(o)}<span><b>${esc(o.name)}</b><small>${esc(o.brand)}</small></span>${icon.chevron}
        </button>
        ${reasonsList(p.reasons, 'compact')}
        <p class="pairing-order">${icon.spray}${esc(order)}</p>
      </li>`;
  }).join('');
  return `<section><h3>Layer it with</h3>${rows
    ? `<ul class="pairings">${rows}</ul>`
    : '<p class="muted small">Nothing else in this collection layers well with it.</p>'}</section>`;
}

export function sheetHTML(entry, ctxLabel, ctx, wornId, { canWear = true, wears = null, todayISO = '', alts = [], partners = null, comfort = null } = {}) {
  const f = entry.fragrance;
  const peak = Math.max(...SEASONS.map(s => f.season[s]));
  const seasonBars = SEASONS.map(s => bar(s, (f.season[s] / peak) * 100, SEASON_COLORS[s], `${Math.round(f.season[s] * 100)}%`)).join('');
  const dnPeak = Math.max(f.dayNight.day, f.dayNight.night);
  const dnBars = ['day', 'night'].map(s => bar(s, (f.dayNight[s] / dnPeak) * 100, SEASON_COLORS[s], `${Math.round(f.dayNight[s] * 100)}%`)).join('');
  const accordBars = Object.entries(f.accords).map(([a, v]) => bar(a, v, accordColor(a), '', `, ${strength(v)}`)).join('');
  const layers = [['top', 'Top'], ['mid', 'Heart'], ['base', 'Base'], ['all', 'Notes']]
    .filter(([k]) => f.notes[k]?.length)
    .map(([k, label]) => `<div class="layer"><span class="layer-label">${label}</span><div class="notes">${f.notes[k].map(n => `<span class="note-chip">${esc(n)}</span>`).join('')}</div></div>`)
    .join('');
  const meta = [f.brand, f.year, GENDER[f.gender]].filter(Boolean).map(esc).join(' · ');
  // Fragella, hand-entered and never-voted bottles show what their accords predict.
  const estimated = !f.seasonVotes;
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
  const inspired = o ? `<div class="inspired">Inspired by ${o.url ? `<a href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.name)}</a>` : esc(o.name)} · ${esc(o.brand)}</div>` : '';
  const altRow = alts.length
    ? `<section><h3>Also good for ${esc(ctxLabel.toLowerCase())}</h3><div class="alts">${alts.map(a => `
        <button class="alt" data-open data-ctx="${esc(ctx)}" data-id="${esc(a.fragrance.id)}">
          ${img(a.fragrance)}<span><b>${esc(a.fragrance.name)}</b><small><span class="tier-chip mini" data-tier="${a.tier}">${a.tier}</span>${matchPct(a)}%</small></span>
        </button>`).join('')}</div></section>`
    : '';
  return sheetFrame('sheet-title', `
      <div class="sheet-head" style="--accord:${accordColor(Object.keys(f.accords)[0])}">
        <div class="sheet-bottle">${img(f, { lazy: false })}</div>
        <div>
          <div class="kicker"><span class="tier-chip" data-tier="${entry.tier}">${entry.tier}</span>${esc(ctxLabel)}</div>
          <h2 id="sheet-title">${esc(f.name)}</h2>
          <div class="brand">${meta}</div>
          ${inspired}
          <div class="rating">${ratingLine}</div>
          ${performance ? `<div class="performance">${performance}</div>` : ''}
        </div>
      </div>
      ${reasonsList(entry.reasons, 'full')}
      ${comfortHTML(comfort)}
      ${wearsHTML(wears, todayISO)}
      <div class="sheet-actions">
        ${canWear ? wearButton(entry, ctx, wornId) : ''}
        ${f.url ? `<a class="btn secondary" href="${esc(f.url)}" target="_blank" rel="noopener">Fragrantica ${icon.external}</a>` : ''}
        <button class="btn tertiary" data-toggle-hidden="${esc(f.id)}">${icon.hide}Hide from picks</button>
      </div>
      ${whyHTML(entry)}
      ${altRow}
      ${layersHTML(f, partners, ctx)}
      <section><h3>Main accords</h3><div class="bars accords">${accordBars}</div></section>
      <section class="two-col">
        <div><h3>${estimated ? 'Season fit' : 'Seasons voted'}</h3><div class="bars">${seasonBars}</div></div>
        <div><h3>${estimated ? 'Time of day (est.)' : 'Time of day'}</h3><div class="bars">${dnBars}</div></div>
      </section>
      ${layers ? `<section><h3>Notes</h3><div class="pyramid">${layers}</div></section>` : ''}`);
}

// ---------- Collection sheets ----------

function bottleRow(f, { hidden, removable }) {
  const active = !hidden.has(f.id);
  return `<li class="${active ? '' : 'off'}" data-name="${esc(`${f.name} ${f.brand}`.toLowerCase())}">
    ${img(f)}
    <span class="manage-name"><b>${esc(f.name)}</b><small>${esc(f.brand)}</small></span>
    ${removable ? `<button class="icon-btn small ghosted" data-remove="${esc(f.id)}" aria-label="Remove ${esc(f.name)}">${icon.remove}</button>` : ''}
    <button class="switch" role="switch" aria-checked="${active}" data-toggle-hidden="${esc(f.id)}" aria-label="Include ${esc(f.name)} in picks"><span></span></button>
  </li>`;
}

export function collectionSheetHTML({ tab, demo, mine, hidden, shared, filter = '' }) {
  const list = tab === 'mine' ? mine.records : demo;
  const on = list.filter(f => !hidden.has(f.id)).length;
  const tabBtn = (id, label) => `<button data-collection-tab="${id}" aria-pressed="${tab === id}">${esc(label)}</button>`;
  const actions = tab === 'mine'
    ? `<div class="sheet-actions">
        <button class="btn primary" data-action="add">${icon.plus}<span>Add bottles</span></button>
        <button class="btn secondary" data-action="import">${icon.paste}Paste a list</button>
        ${mine.records.length ? `<button class="btn tertiary" data-action="share">${icon.share}Share</button>` : ''}
      </div>
      <label class="name-field">Name on share links
        <input type="text" data-field="mine-name" value="${esc(mine.name)}" placeholder="e.g. Alex" maxlength="40" autocomplete="off">
      </label>`
    : `<div class="sheet-actions"><button class="btn secondary" data-action="share">${icon.share}Share this wardrobe</button></div>`;
  const search = list.length > 8
    ? `<label class="filter">${icon.search}<input type="search" data-field="collection-filter" placeholder="Filter ${list.length} bottles" value="${esc(filter)}" autocomplete="off" aria-label="Filter bottles"></label>`
    : '';
  const body = list.length
    ? `<div class="list-head"><p class="muted">${on} of ${list.length} in rotation. Switch a bottle off to leave it out of picks on this device.</p>${search}</div>
       <ul class="manage-list">${list.map(f => bottleRow(f, { hidden, removable: tab === 'mine' })).join('')}</ul>
       <p class="muted small filter-empty" hidden>No bottles match.</p>`
    : `<div class="empty-illustration">${icon.bottle}</div><p class="muted empty">No bottles yet. Search for what you own, or paste a list.</p>`;
  return sheetFrame('coll-title', `
      <h2 id="coll-title" class="sheet-title">Collections</h2>
      ${shared ? `<p class="notice">Picking a collection below closes the shared one you’re viewing.</p>` : ''}
      <div class="seg wide" role="group" aria-label="Collection">${tabBtn('demo', 'David’s wardrobe')}${tabBtn('mine', `Mine · ${mine.records.length}`)}</div>
      ${actions}
      ${body}`, { narrow: true });
}

function resultRow(r, i, added) {
  const meta = [r.brand, r.year].filter(Boolean).map(esc).join(' · ');
  return `<li>
    ${img(r)}
    <span class="manage-name"><b>${esc(r.name)}</b><small>${meta}</small></span>
    <button class="btn secondary compact${added ? ' on' : ''}" data-add="${i}" ${added ? 'disabled' : ''} aria-label="${added ? 'Added' : 'Add'} ${esc(r.name)}">${added ? `${icon.check}Added` : `${icon.plus}Add`}</button>
  </li>`;
}

const handAdd = label => `<button class="link-btn" data-action="custom">${label}</button>`;

export function addSheetHTML({ query = '', results = null, busy = false, error = '' }, ownedIds) {
  const list = results === null ? ''
    : results.length === 0 ? `<p class="muted small">No matches for “${esc(query)}”. Check the spelling, or ${handAdd('add it yourself')}.</p>`
    : `<ul class="manage-list results">${results.map((r, i) => resultRow(r, i, ownedIds.has(r.id))).join('')}</ul>`;
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
        <button class="btn secondary" data-action="collection">Done</button>
      </div>`, { narrow: true });
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
    body = `<ul class="manage-list import-rows">${rows.map((r, i) => {
      if (r.status === 'pending') return `<li class="pending"><span class="spinner" aria-hidden="true"></span><span class="manage-name"><b>${esc(r.line)}</b><small>Looking…</small></span></li>`;
      if (!r.match) return `<li><span class="miss">?</span><span class="manage-name"><b>${esc(r.line)}</b><small>${esc(r.note || 'Not found')}</small></span>
        <button class="btn secondary compact" data-custom-row="${i}">${icon.plus}Add it yourself</button></li>`;
      const meta = r.weak
        ? `Closest match for “${esc(r.line)}”. Not it? <button class="link-btn" data-custom-row="${i}">Add it yourself</button>`
        : [r.match.brand, `for “${r.line}”`].filter(Boolean).map(esc).join(' · ');
      return `<li>
        ${img(r.match)}
        <span class="manage-name"><b>${esc(r.match.name)}</b><small${r.weak ? ' class="wrap"' : ''}>${r.weak ? `${esc(r.match.brand)} · ` : ''}${meta}</small></span>
        <button class="check${r.checked ? ' on' : ''}" role="checkbox" aria-checked="${r.checked}" data-import-toggle="${i}" aria-label="Add ${esc(r.match.name)}">${icon.check}</button>
      </li>`;
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
      ${body}`, { narrow: true });
}

const TIMES = [['day', 'Day'], ['night', 'Night'], ['both', 'Day & night']];

// A bottle no database has. Chips run from rich to fresh, as in ACCORDS.
export function customSheetHTML({ name = '', brand = '', accords = [], seasons = [], time = null, error = '', back = null }, maxAccords) {
  const accordChip = a => {
    const rank = accords.indexOf(a);
    const full = rank < 0 && accords.length >= maxAccords;
    return `<button type="button" class="pick-chip${rank >= 0 ? ' on' : ''}" style="--c:${accordColor(a)}" data-accord="${esc(a)}" aria-pressed="${rank >= 0}"${full ? ' disabled' : ''}>${rank >= 0 ? `<b>${rank + 1}</b>` : ''}${esc(a)}</button>`;
  };
  const toggle = (attr, value, on, label) => `<button type="button" data-${attr}="${value}" aria-pressed="${on}">${esc(label)}</button>`;
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
            <div class="seg" role="group" aria-label="Seasons">${SEASONS.map(s => toggle('season', s, seasons.includes(s), s[0].toUpperCase() + s.slice(1))).join('')}</div>
            <div class="seg" role="group" aria-label="Time of day">${TIMES.map(([t, label]) => toggle('time', t, time === t, label)).join('')}</div>
          </div>
        </fieldset>
        ${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}
        <div class="sheet-bar">
          ${back ? '<button class="btn secondary" type="button" data-action="custom-back">Back</button>' : ''}
          <button class="btn primary" type="submit">${icon.plus}<span>${back?.kind === 'import' ? 'Use for this line' : 'Add to my collection'}</span></button>
        </div>
      </form>`, { narrow: true });
}

export function sharedBannerHTML(shared, mineCount) {
  const who = shared.name ? `${esc(shared.name)}’s` : 'A shared';
  const status = shared.loading ? 'Loading…' : `${plural(shared.records.length, 'bottle')}${shared.missing.length ? ` · ${shared.missing.length} couldn’t load` : ''}`;
  const save = shared.confirmReplace ? `Replace my ${mineCount}?` : 'Save as mine';
  return `<div class="banner" role="status">
    <span class="banner-icon">${icon.share}</span>
    <span><b>${who} collection</b><small>${status}</small></span>
    <button class="btn primary compact" data-action="shared-save" ${shared.loading || !shared.records.length ? 'disabled' : ''}>${save}</button>
    <button class="icon-btn small" data-action="shared-close" aria-label="Close shared collection">${icon.close}</button>
  </div>`;
}

// ---------- Location sheet ----------

export function cityResultsHTML({ results = null, query = '', busy = false }, recent) {
  if (busy && !results) return '<p class="muted small searching"><span class="spinner small" aria-hidden="true"></span>Searching…</p>';
  if (results === null) {
    if (!recent.length) return '';
    return `<h3 class="list-title">Recent</h3><ul class="city-results">${recent.map((r, i) => `<li><button data-recent="${i}">${icon.clock}<strong>${esc(r.name)}</strong><span>${esc(r.region ?? '')}</span></button></li>`).join('')}</ul>`;
  }
  if (!results.length) return `<p class="muted small">No places match “${esc(query)}”. Try a bigger nearby city.</p>`;
  return `<ul class="city-results">${results.map((r, i) => `<li><button data-city="${i}">${icon.pin}<strong>${esc(r.name)}</strong><span>${esc(r.region)}</span></button></li>`).join('')}</ul>`;
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
      <div class="city-slot" aria-live="polite">${cityResultsHTML(s, recent)}</div>`, { narrow: true });
}

// ---------- Footer ----------

export function footerHTML({ on, total, sources, updated, stale, units: u, hasHistory }) {
  const unitBtn = x => `<button data-units="${x}" aria-pressed="${u === x}">°${x}</button>`;
  const themeBtn = (x, label) => `<button data-theme-choice="${x}" aria-pressed="${theme() === x}">${label}</button>`;
  return `
    <div class="foot-row">
      <span>${on} of ${total} bottles in rotation</span>
      <button class="btn tertiary" data-action="collection">Manage</button>
      ${hasHistory ? '<button class="btn tertiary" data-action="journal">Journal</button>' : ''}
    </div>
    <div class="foot-row">
      <div class="seg tiny" role="group" aria-label="Temperature units">${unitBtn('F')}${unitBtn('C')}</div>
      <div class="seg tiny" role="group" aria-label="Theme">${themeBtn('default', 'Default')}${themeBtn('gruvbox', 'Gruvbox')}</div>
      ${updated ? `<span class="updated">${stale ? 'Offline · ' : ''}Updated ${esc(updated)}<button class="icon-btn small" data-action="refresh" aria-label="Refresh weather">${icon.refresh}</button></span>` : ''}
    </div>
    <div class="foot-row fine">
      ${sources ? `<span>Fragrance data: ${sources}</span>` : ''}
      <span>Forecast by <a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo</a></span>
    </div>`;
}
