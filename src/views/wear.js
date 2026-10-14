// Wear: what to wear now (the hero and the next window), the week ahead, for
// an occasion (now, or on another date or in another place), or on a trip.
// Templates are pure (test/ui.test.js and test/wear.test.js render them);
// the panes read src/app/state.js. The Trip pane lives in wear/trip.js, the
// Occasion pane's "When and where?" in wear/when.js, and the place and date
// pickers both use in wear/pickers.js. Styles: src/css/wear.css.
import { renderScene, stagePoint, skyLight } from '../scene.js';
import { calendarSeason } from '../engine.js';
import { OCCASIONS, occasionById } from '../occasions.js';
import { sprayGuide } from '../spray.js';
import { theme } from '../theme.js';
import { toggleWear, wornIn, journalStats, shiftISO } from '../history.js';
import { routeHash } from '../app/router.js';
import { esc, temp, deg, plural, shortDate, weekdayShort, windowRange, feelWords, displayReasons } from '../ui.js';
import {
  icon, img, slotIcon, wxIcon, messageHTML, skeletonHTML, reasonsList, chips, matchBadge, shelfHTML,
  wearButton, segHTML, sharedBannerHTML, accordColor, sectionHead,
} from '../ui/components.js';
import {
  state, savePrefs, activeFragrances, sourceRecords, nowSlot, todaySlots, computeWeek, rankContext, canWear, wornId,
  nowHour, findRecord,
} from '../app/state.js';
import * as trip from './wear/trip.js';
import * as when from './wear/when.js';
import * as pickers from './wear/pickers.js';

// ---------- The sky ----------

// The sky before the forecast arrives (or when it can't): the phase from the
// device clock, so a loading screen at night isn't a sunny day.
export function sceneNow(wx, { error = false, date = new Date() } = {}) {
  const now = wx?.now;
  if (now) return { phase: now.phase, category: now.category, sunProgress: now.sunProgress };
  const h = date.getHours() + date.getMinutes() / 60;
  const phase = h < 5.5 || h >= 20.5 ? 'night' : h < 7.5 ? 'dawn' : h < 18.5 ? 'day' : 'dusk';
  return { phase, category: error ? 'cloudy' : 'partly', sunProgress: Math.min(1, Math.max(0, (h - 6.5) / 13)) };
}

// Where the hero's bottle stands: right of the temperature, on the middle
// hill (src/scene.js stagePoint), a little nearer the middle on wide heroes.
const stageX = aspect => (aspect < 1.6 ? 0.73 : 0.64);

/**
 * The hero: the weather scene with the place, the temperature and, on Now,
 * the pick standing on the hill, rim-lit by the sun or moon (tap it for its
 * page). `compact` is the shorter band the other Wear panes get.
 * pick: { entry, win, worn } | null; slots: Now's windows for the Day/Night toggle.
 */
export function heroHTML({ loc, wx, loading, error, updating }, { aspect, compact = false, pick = null, slots = [], slotOn = null }) {
  const now = wx?.now;
  const sky = sceneNow(wx, { error: Boolean(error) });
  const stage = pick && !compact ? stagePoint(aspect, stageX(aspect)) : null;
  const scene = renderScene({
    ...sky,
    season: calendarSeason(new Date(), loc?.lat ?? 1),
    cold: now ? now.feelsF < 50 : false,
    aspect,
    label: now ? `${now.label}, ${deg(now.tempF)}` : 'Weather scene',
    theme: theme(),
    stage: stage?.scene ?? null,
  });
  const locBtn = `<button class="loc-btn glass" data-action="location" aria-label="Change location: ${esc(loc?.name ?? 'not set')}">${icon.pin}<span>${esc(loc?.name ?? 'Set location')}</span></button>`;
  const toggle = !compact && slots.length > 1
    ? segHTML(slots.map(p => ({ value: p.win.slot, label: p.win.slot === 'day' ? 'Day' : 'Night', icon: slotIcon(p.win.slot), on: p.win.slot === slotOn })), { action: 'slot', label: 'Time of day', cls: 'glass' })
    : '';
  let body;
  if (now) {
    const status = updating ? '<span class="hero-status updating">Updating…</span>' : wx.stale ? '<span class="hero-status">Offline</span>' : '';
    body = `<div class="hero-wx">
      <div class="hero-temp">${temp(now.tempF)}<span class="deg">°</span></div>
      <div class="hero-meta">
        <div class="hero-cond">${esc(now.label)}</div>
        <div class="hero-sub">Feels ${deg(now.feelsF)} · H ${deg(now.hiF)} L ${deg(now.loF)}</div>
        ${status}
      </div>
    </div>`;
  } else if (error) {
    body = `<div class="hero-wx"><div class="hero-meta"><div class="hero-cond">Weather unavailable</div><div class="hero-sub">${esc(loc?.name ?? '')}</div></div></div>`;
  } else {
    body = `<div class="hero-wx"><div class="hero-meta"><div class="hero-cond">${loading ? 'Checking the sky…' : 'Where are you?'}</div><div class="hero-sub">${loading ? '&nbsp;' : 'Set a location to get picks.'}</div></div></div>`;
  }
  let bottle = '';
  if (stage) {
    const f = pick.entry.fragrance;
    const light = skyLight({ ...sky, aspect, theme: theme(), stage: stage.scene });
    // The rim catches the light on the side it comes from.
    const side = light.x >= stage.x ? 1 : -1;
    bottle = `<button class="hero-pick" data-action="open" data-ctx="${esc(pick.win.slot)}" data-id="${esc(f.id)}"
      style="--x:${(stage.x * 100).toFixed(2)}%;--y:${(stage.y * 100).toFixed(2)}%;--rim:${light.color};--rim-side:${side};--rim-k:${light.strength}">
      <span class="hero-bottle">${img(f, { lazy: false })}</span>
      <span class="hero-label"><small>${pick.worn ? `${icon.check}Wearing` : `${slotIcon(pick.win.slot)}${esc(pick.win.label)}`}</small><b>${esc(f.name)}</b><span>${esc(f.brand)}</span></span>
    </button>`;
  }
  return `
    <div class="hero-scene">${scene}</div>
    <div class="hero-shade"></div>
    <div class="hero-top">${locBtn}${toggle}</div>
    ${bottle}
    <div class="hero-foot">${body}</div>`;
}

// ---------- Cards ----------

// A window's head: its name (or `title`), then the hours set apart from the
// weather; typical weather (a date past the forecast) says so.
export function slotHeadHTML(win, hour, { id, thumb = false, title = null } = {}) {
  const scene = thumb ? `<div class="slot-thumb">${renderScene({
    phase: win.slot === 'day' ? 'day' : 'night',
    category: win.category,
    sunProgress: 0.42,
    season: calendarSeason(win.date, win.lat),
    cold: win.feelsF < 50,
    aspect: 78 / 54,
    label: `${win.label}: ${win.condition}`,
    theme: theme(),
  })}</div>` : '';
  const weather = [win.condition, `feels ${deg(win.feelsF)}`, ...feelWords(win)].join(', ');
  return `<header class="slot-head">
    ${scene}
    <div class="slot-title">
      <h2${id ? ` id="${id}"` : ''}>${slotIcon(win.slot)}<span>${esc(title ?? win.label)}</span></h2>
      <p class="slot-line"><span class="slot-time">${esc(windowRange(win, hour))}</span><span class="slot-wx">${wxIcon(win.category)}<span>${esc(weather)}</span></span>${win.typical ? '<span class="slot-typical">Typical weather</span>' : ''}</p>
    </div>
  </header>`;
}

// A bottle the rotation nudge put first (src/engine.js NUDGE_AFTER) says so
// in its own line, not among the reasons it fits: "Not worn in 34 days".
export function nudgeOf(entry) {
  if (!entry?.nudged) return null;
  return entry.parts.unworn ? 'Not worn yet' : `Not worn in ${entry.parts.idle} days`;
}
const nudgeHTML = text => (text ? `<p class="nudge">${icon.clock}<span>${esc(text)}</span></p>` : '');
// The reasons a card shows, less the nudge's (it has its own line).
function reasonsOf(entry, n) {
  const nudge = nudgeOf(entry);
  return displayReasons(nudge ? { ...entry, reasons: entry.reasons.filter(r => r.text !== nudge) } : entry, n);
}

// "2 sprays · chest", from src/spray.js's guide, for the pick card.
const SPOT_WORDS = { 'collar or scarf': 'collar', 'back of the neck': 'nape' };
export function sprayLine({ sprays: [lo, hi], where }) {
  const count = lo === hi ? plural(lo, 'spray') : `${lo}–${hi} sprays`;
  return `${count} · ${where.map(w => SPOT_WORDS[w] ?? w).join(', ')}`;
}

// The top pick. On Now the hero shows the bottle, so the card leads with why
// and how much to spray (`spray`: sprayGuide's answer; it opens the bottle
// page's spray section); elsewhere (`full`) it shows the photo and name too.
export function pickHTML(entry, ctx, worn, { canWear = true, full = false, kicker = '', spray = null } = {}) {
  const f = entry.fragrance;
  const wash = `--accord:${accordColor(Object.keys(f.accords)[0])}`;
  const open = (cls, inner, label = '') => `<button class="${cls}" data-action="open" data-ctx="${esc(ctx)}" data-id="${esc(f.id)}"${label ? ` aria-label="${esc(label)}"` : ''}>${inner}</button>`;
  if (!full) {
    const hint = spray ? `<button class="spray-hint" data-action="spray-open" data-ctx="${esc(ctx)}" data-id="${esc(f.id)}" aria-label="${esc(`How to spray ${f.name}: ${sprayLine(spray)}`)}">${icon.spray}<span>${esc(sprayLine(spray))}</span>${icon.chevron}</button>` : '';
    return `<div class="pick" style="${wash}">
      <div class="pick-top">${matchBadge(entry)}${open('btn tertiary compact', `Details${icon.chevron}`, `Details for ${f.name}`)}</div>
      ${nudgeHTML(nudgeOf(entry))}
      ${reasonsList(reasonsOf(entry, 3), 'lead')}
      ${chips(f.accords)}
      ${canWear || hint ? `<div class="pick-actions">${canWear ? wearButton(entry, ctx, worn) : ''}${hint}</div>` : ''}
    </div>`;
  }
  return `<div class="pick full" style="${wash}">
    ${open('pick-bottle', img(f, { lazy: false }), `Details for ${f.name}`)}
    <div class="pick-info">
      ${kicker ? `<p class="kicker">${worn === f.id ? 'Wearing' : esc(kicker)}</p>` : ''}
      <h3 class="pick-name">${open('pick-name-btn', `<span class="clamp">${esc(f.name)}</span>`)}</h3>
      <p class="brand">${esc(f.brand)}</p>
      ${nudgeHTML(nudgeOf(entry))}
      ${reasonsList(reasonsOf(entry, 2), 'lead')}
      ${chips(f.accords)}
    </div>
    <div class="pick-actions">${canWear ? wearButton(entry, ctx, worn) : ''}${matchBadge(entry)}</div>
  </div>`;
}

// The other window of today, beside the first on a wide column (the hero's
// Day/Night toggle does this on phones): its pick with photo and name, and a
// button that brings its shelf up.
export function nextWindowHTML({ win, pick }, worn, hour) {
  const f = pick.fragrance;
  const open = (cls, inner, label = '') => `<button class="${cls}" data-action="open" data-ctx="${esc(win.slot)}" data-id="${esc(f.id)}"${label ? ` aria-label="${esc(label)}"` : ''}>${inner}</button>`;
  return `<aside class="next-window" aria-labelledby="next-title" style="--accord:${accordColor(Object.keys(f.accords)[0])}">
    <p class="kicker">${slotIcon(win.slot)}<span id="next-title">${esc(win.label)}</span><span class="next-time">${esc(windowRange(win, hour))}</span></p>
    <div class="next-pick">
      ${open('pick-bottle', img(f), `Details for ${f.name}`)}
      <div class="pick-info">
        <h3 class="pick-name">${open('pick-name-btn', `<span class="clamp">${esc(f.name)}</span>`)}</h3>
        <p class="brand">${worn === f.id ? 'Wearing · ' : ''}${esc(f.brand)}</p>
        ${matchBadge(pick)}
      </div>
    </div>
    ${nudgeHTML(nudgeOf(pick))}
    ${reasonsList(reasonsOf(pick, 2), 'compact')}
    <button class="btn tertiary compact next-more" data-action="slot" data-value="${esc(win.slot)}">${esc(`All picks for ${win.label.toLowerCase()}`)}${icon.chevron}</button>
  </aside>`;
}

// The rest of a window's ranking on the magnitude shelf.
function alsoHTML(ranked, pick, ctx, worn, label) {
  const rest = ranked.filter(r => r !== pick);
  if (!rest.length) return '';
  return `<div class="also">
    <h3 class="also-title">Also good ${esc(label)}</h3>
    ${shelfHTML(rest, ctx, { wornId: worn })}
  </div>`;
}

// ---------- Week ----------

// A window's pick: its time of day as a glyph, the bottle, and marks for a
// logged wear and for a bottle the rotation nudge brought back.
function weekPick(p, slot, dayName) {
  if (!p) return `<span class="wk-pick empty"><span class="wk-slot">${slotIcon(slot)}</span><span class="wk-none">Done for today</span></span>`;
  const f = p.pick.fragrance;
  const nudge = nudgeOf(p.pick);
  const spoken = [`${dayName} ${slot === 'day' ? 'daytime' : 'night'}: ${f.name}`, p.worn && 'wearing', nudge].filter(Boolean).join(', ');
  return `<button class="wk-pick${p.worn ? ' worn' : ''}" data-action="open" data-ctx="${esc(p.ctx)}" data-id="${esc(f.id)}" aria-label="${esc(spoken)}">
    <span class="wk-slot">${p.worn ? icon.check : slotIcon(slot)}</span>
    ${img(f)}
    <span class="wk-text"><b>${esc(f.name)}</b>${nudge ? `<small class="wk-nudge">${icon.clock}<span>${esc(nudge)}</span></small>` : ''}</span>
  </button>`;
}

export function weekHTML(days) {
  const rows = days.map(d => `
    <li class="wk-day${d.isToday ? ' today' : ''}">
      <div class="wk-date"><b>${esc(d.isToday ? 'Today' : weekdayShort(d.dateISO))}</b><small>${esc(shortDate(d.dateISO))}</small></div>
      <div class="wk-wx">${wxIcon(d.category, d.condition)}<span class="wk-temps"><b>${deg(d.hiF)}</b><small>${deg(d.loF)}</small></span><span class="wk-pop"${d.pop >= 30 ? ` aria-label="${d.pop}% chance of rain">${d.pop}%` : ' aria-hidden="true">&nbsp;'}</span></div>
      <div class="wk-picks">${weekPick(d.day, 'day', d.name)}${weekPick(d.night, 'night', d.name)}</div>
    </li>`).join('');
  return `<section class="card week" aria-labelledby="week-title">
    ${sectionHead(`${icon.calendar}The week ahead`, '<p>Planned against the forecast so nothing repeats back to back. Tap a bottle to see why.</p>', { id: 'week-title' })}
    <ol class="wk-list" style="--days:${days.length}">${rows}</ol>
  </section>`;
}

// ---------- Occasion controls ----------

// A radio group: one tab stop, arrow keys move the choice (the shell's
// roving keys). Compact tiles, a glyph over a name, so the picks below lead
// the page; each blurb is the tile's tooltip and what a screen reader hears.
export function occasionPickerHTML(activeId) {
  return `<div class="occasions" role="radiogroup" aria-label="Occasion" data-keep-scroll="occasions" style="--n:${OCCASIONS.length}">
    ${OCCASIONS.map(o => `<button class="occ${o.id === activeId ? ' on' : ''}" role="radio" aria-checked="${o.id === activeId}" tabindex="${o.id === activeId ? 0 : -1}" data-action="occasion" data-value="${o.id}" title="${esc(o.blurb)}">
      <span class="occ-icon">${icon[o.icon] ?? icon.sparkle}</span>
      <span class="occ-label">${esc(o.label)}</span>
      <span class="visually-hidden">: ${esc(o.blurb)}</span>
    </button>`).join('')}
  </div>`;
}

// ---------- Journal teaser ----------

export function journalTeaserHTML({ strip, stats }, resolve) {
  const cells = strip.map(c => {
    const worn = [c.day, c.night].map(h => h && resolve(h.id)).filter(Boolean);
    return `<span class="jt-cell${c.isToday ? ' today' : ''}"${c.isToday ? ' aria-current="date"' : ''}>
      <small>${esc(c.label)}</small>
      <span class="jt-bottles">${worn.length ? worn.map(f => img(f)).join('') : '<i></i>'}</span>
    </span>`;
  }).join('');
  return `<section class="card journal-teaser" aria-labelledby="jt-title">
    ${sectionHead(`${icon.journal}Wear journal`, `<a class="btn secondary compact" href="#/wardrobe/worn">Open ${icon.chevron}</a><p>${plural(stats.wears, 'wear')} of ${plural(stats.bottles, 'bottle')} in 30 days</p>`, { id: 'jt-title' })}
    <div class="jt-strip">${cells}</div>
  </section>`;
}

function journalTeaser() {
  if (!state.history.length || !state.wx) return '';
  const today = state.wx.todayISO;
  const strip = Array.from({ length: 7 }, (_, i) => {
    const dateISO = shiftISO(today, i - 6);
    const isToday = dateISO === today;
    return {
      dateISO,
      isToday,
      label: shortDate(dateISO).split(' ')[1],
      day: wornIn(state.history, dateISO, 'day'),
      night: wornIn(state.history, dateISO, 'night'),
    };
  });
  return journalTeaserHTML({ strip, stats: journalStats(state.history, today) }, findRecord);
}

// ---------- Panes ----------

const banner = () => (state.shared ? sharedBannerHTML(state.shared, state.mine.records.length, { slim: true, confirm: state.armed === 'shared-save' }) : '');

function emptyState() {
  if (state.shared) {
    return state.shared.loading
      ? skeletonHTML(1)
      : messageHTML({ glyph: icon.share, title: 'Nothing to show', body: 'None of the bottles in this link could be loaded.',
        action: '<button class="btn primary" data-action="shared-close"><span>Back to my picks</span></button>' });
  }
  if (!sourceRecords().length) {
    return messageHTML({ glyph: icon.bottle, title: 'Your collection is empty', body: 'Add the bottles you own and picks start right away.',
      action: `<div class="message-actions">
        <a class="btn primary" href="#/discover">${icon.search}<span>Find your bottles</span></a>
        <button class="btn secondary" data-action="import">${icon.paste}Paste a list</button>
        <button class="btn tertiary" data-action="collection" data-value="demo">Use David’s wardrobe</button>
      </div>` });
  }
  return messageHTML({ glyph: icon.hide, title: 'Every bottle is switched off', body: 'Turn some back on to get picks.',
    action: '<a class="btn primary" href="#/wardrobe/owned"><span>Open your wardrobe</span></a>' });
}

// What a pane shows before it can rank: no place, no forecast, no bottles.
function guard() {
  if (!state.loc) {
    return messageHTML({ glyph: icon.pin, title: 'Set your location', body: 'Picks are based on your local forecast.',
      action: `<button class="btn primary" data-action="location">${icon.pin}<span>Choose location</span></button>` });
  }
  if (!state.wx) {
    return state.error
      ? messageHTML({ glyph: icon.cloud, title: 'Couldn’t load the weather', body: state.error,
        action: `<button class="btn primary" data-action="refresh">${icon.refresh}<span>Try again</span></button>` })
      : skeletonHTML(1);
  }
  if (!activeFragrances().length) return banner() + emptyState();
  return null;
}

function nowPane() {
  const blocked = guard();
  if (blocked) return blocked;
  // A forecast without hours for either window (a model gap): nothing to rank yet.
  if (!nowSlot()) return skeletonHTML(1);
  const { win, ranked, pick } = nowSlot();
  const worn = wornId(win);
  const other = todaySlots().find(p => p.win.slot !== win.slot);
  return `${banner()}
    <section class="card slot" aria-labelledby="slot-title">
      ${slotHeadHTML(win, nowHour(), { id: 'slot-title' })}
      <div class="now-picks">
        ${pickHTML(pick, win.slot, worn, { canWear: canWear(win), spray: sprayGuide(pick.fragrance, win) })}
        ${other ? nextWindowHTML(other, wornId(other.win), nowHour()) : ''}
      </div>
      ${alsoHTML(ranked, pick, win.slot, worn, win.slot === 'day' ? 'by day' : 'tonight')}
    </section>
    ${journalTeaser()}`;
}

const occasionOf = route => occasionById(route.arg ?? state.occasion) ?? occasionById('casual');

// "Formal · Sat night in Chicago" once the window is known.
function occasionHeading(route, ev = state.wx ? when.eventWindow(state.occasionSlot ?? occasionOf(route).slot) : null) {
  const occasion = occasionOf(route);
  if (ev?.status !== 'ready') return `Picks for ${occasion.label.toLowerCase()}${when.when.place ? ` in ${when.when.place.name}` : ''}`;
  return when.occasionTitle(occasion, ev.win, { today: state.wx.todayISO, place: when.when.place });
}

function occasionPane(app, route) {
  const blocked = guard();
  const occasion = occasionOf(route);
  if (blocked) return occasionPickerHTML(occasion.id) + blocked;
  const slot = state.occasionSlot ?? occasion.slot;
  const ev = when.eventWindow(slot, app);
  const bar = when.whenBarHTML({ ...when.when, home: state.loc, today: state.wx.todayISO, slot: ev.win?.slot ?? slot, wx: state.wx });
  const head = `${banner()}${occasionPickerHTML(occasion.id)}${bar}`;
  if (ev.status === 'loading') return head + skeletonHTML(1);
  if (ev.status === 'error') {
    return head + messageHTML({ glyph: icon.cloud, title: 'Couldn’t get the weather there', body: ev.error,
      action: `<button class="btn primary" data-action="occ-when-retry">${icon.refresh}<span>Try again</span></button>` });
  }
  const { win } = ev;
  const ranked = rankContext('occ', win, occasion);
  const worn = wornId(win);
  return `${head}
    <section class="card slot" aria-labelledby="occ-title">
      ${slotHeadHTML(win, ev.here ? nowHour() : -1, { id: 'occ-title', thumb: true, title: occasionHeading(route, ev) })}
      ${pickHTML(ranked[0], 'occ', worn, { canWear: canWear(win), full: true, kicker: `Best for ${occasion.label.toLowerCase()}` })}
      ${alsoHTML(ranked, ranked[0], 'occ', worn, `for ${occasion.label.toLowerCase()}`)}
    </section>`;
}

// Keeps the chosen occasion in view in the sideways strip on phones. A card
// cut off at either edge moves to the start, where the strip snaps anyway.
function showChosenOccasion() {
  const strip = document.querySelector('.occasions');
  const card = strip?.querySelector('[aria-checked="true"]');
  if (!card || strip.scrollWidth <= strip.clientWidth) return;
  const s = strip.getBoundingClientRect(), c = card.getBoundingClientRect(), pad = 16, fade = 28;
  if (c.left < s.left + pad || c.right > s.right - fade) strip.scrollLeft += c.left - s.left - pad;
}

function weekPane() {
  return guard() ?? banner() + weekHTML(computeWeek());
}

// Packing for a trip (wear/trip.js): no forecast of your own needed, only bottles.
function tripPane() {
  if (!state.demo && !state.shared && state.active === 'demo') return skeletonHTML(1);
  if (!activeFragrances().length) return banner() + emptyState();
  return banner() + trip.renderTrip();
}

const place = () => state.loc?.name ?? 'your area';

export const wear = {
  id: 'wear',
  label: 'Wear',
  icon: 'wear',
  panes: [
    { id: 'now', label: 'Now', title: () => 'Now', heading: () => `What to wear in ${place()}`, render: nowPane },
    { id: 'week', label: 'Week', title: () => 'Week', heading: () => `The week ahead in ${place()}`, render: weekPane },
    {
      id: 'occasion',
      label: 'Occasion',
      title: route => occasionOf(route).label,
      heading: route => occasionHeading(route),
      render: occasionPane,
      after: showChosenOccasion,
    },
    { id: 'trip', label: 'Trip', title: () => 'Trip', heading: trip.tripHeading, render: tripPane, after: app => trip.freshenTrip(app) },
  ],
  // The headings are for screen readers and the tab title: the hero says it.
  hiddenHeading: true,
  hero: {
    compact: route => route.pane !== 'now',
    render(route, aspect) {
      const now = route.pane === 'now' && state.wx ? nowSlot() : null;
      const pick = now?.pick ? { entry: now.pick, win: now.win, worn: wornId(now.win) === now.pick.fragrance.id } : null;
      return heroHTML(state, { aspect, compact: route.pane !== 'now', pick, slots: todaySlots(), slotOn: now?.win.slot });
    },
  },
};

// ---------- Actions ----------

// The bottle page's spray section, once the page is in (the bottle page's
// owner draws it at order 250; this looks for #bp-spray, else a section
// headed about spraying). Its heading takes focus, so a keyboard lands there.
function showSpraySection(tries = 0) {
  const panel = document.querySelector('#bottle .bp-panel');
  const section = panel?.querySelector('#bp-spray, [data-section="spray"]')
    ?? [...(panel?.querySelectorAll('.bp-section') ?? [])].find(s => /spray/i.test(s.querySelector('h3')?.textContent ?? ''));
  if (!section) {
    if (tries < 40) requestAnimationFrame(() => showSpraySection(tries + 1));
    return;
  }
  const top = panel.scrollTop + section.getBoundingClientRect().top - panel.getBoundingClientRect().top - 16;
  panel.scrollTo({ top, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  const head = section.querySelector('h3') ?? section;
  if (!head.hasAttribute('tabindex')) head.setAttribute('tabindex', '-1');
  head.focus({ preventScroll: true });
}

export const actions = {
  ...trip.actions,
  ...when.actions,
  ...pickers.actions,
  // Logs (or clears) a wear for the window of the list it's in, with the use
  // it was for (the Occasion pane's occasion, an event's on a trip, else
  // 'daily'), which the gap finder's "How you wear" counts.
  wear(el, app) {
    const ctx = state.contexts[el.dataset.ctx];
    if (!ctx) return;
    state.history = toggleWear(el.dataset.id, ctx.win.dateISO, ctx.win.slot, state.loc, ctx.occasion?.id ?? 'daily');
    if (wornIn(state.history, ctx.win.dateISO, ctx.win.slot)) navigator.vibrate?.(12);
    app.keepingFocus(el, '#app', app.render);
  },
  // The pick card's spray line: its bottle page, at the spray section. The
  // bottle flies from the hero when it's in view.
  'spray-open'(el, app) {
    app.openBottle(el.dataset.id, el.dataset.ctx, document.querySelector('.hero-pick'));
    setTimeout(() => showSpraySection(), 120);
  },
  // Now's Day/Night toggle in the hero.
  slot(el, app) {
    state.slot = el.dataset.value;
    app.keepingFocus(el, '#app', app.renderPage);
  },
  occasion(el, app) {
    const id = el.dataset.value;
    state.occasion = id;
    state.occasionSlot = null;
    savePrefs();
    app.keepingFocus(el, '#app', () => app.navigate(routeHash({ dest: 'wear', pane: 'occasion', arg: id }), { replace: true, quiet: true }));
  },
  'occ-slot'(el, app) {
    state.occasionSlot = el.dataset.value;
    app.keepingFocus(el, '#app', app.renderPage);
  },
};

export const forms = { ...trip.forms, ...pickers.forms };
export const fields = { ...pickers.fields };
export const changes = { ...trip.changes, ...when.changes };
export const sheets = { ...pickers.sheets };
