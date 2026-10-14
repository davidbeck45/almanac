// Wear: what to wear now (the hero and the next window), the week ahead, for
// an occasion, or on a trip. Templates are pure (test/ui.test.js renders
// them); the panes read src/app/state.js. Styles: src/css/wear.css.
import { renderScene, stagePoint, skyLight } from '../scene.js';
import { calendarSeason } from '../engine.js';
import { OCCASIONS, occasionById } from '../occasions.js';
import { theme } from '../theme.js';
import { toggleWear, wornIn, journalStats, shiftISO } from '../history.js';
import { routeHash } from '../app/router.js';
import { esc, temp, deg, plural, shortDate, weekdayShort, windowRange, feelWords, displayReasons } from '../ui.js';
import {
  icon, img, slotIcon, wxIcon, messageHTML, skeletonHTML, reasonsList, chips, matchBadge, magDot, shelfHTML,
  wearButton, segHTML, sharedBannerHTML, accordColor, sectionHead,
} from '../ui/components.js';
import {
  state, savePrefs, activeFragrances, sourceRecords, nowSlot, todaySlots, computeWeek, rankContext, canWear, wornId,
  nowHour, findRecord,
} from '../app/state.js';

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
    const light = skyLight({ ...sky, aspect, theme: theme() });
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

// A window's head: its name, then the hours set apart from the weather.
export function slotHeadHTML(win, hour, { id, thumb = false } = {}) {
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
      <h2${id ? ` id="${id}"` : ''}>${slotIcon(win.slot)}${esc(win.label)}</h2>
      <p class="slot-line"><span class="slot-time">${esc(windowRange(win, hour))}</span><span class="slot-wx">${wxIcon(win.category)}<span>${esc(weather)}</span></span></p>
    </div>
  </header>`;
}

// The top pick. On Now the hero shows the bottle, so the card leads with why;
// elsewhere (`full`) it shows the photo and name too.
export function pickHTML(entry, ctx, worn, { canWear = true, full = false, kicker = '' } = {}) {
  const f = entry.fragrance;
  const wash = `--accord:${accordColor(Object.keys(f.accords)[0])}`;
  const open = (cls, inner, label = '') => `<button class="${cls}" data-action="open" data-ctx="${esc(ctx)}" data-id="${esc(f.id)}"${label ? ` aria-label="${esc(label)}"` : ''}>${inner}</button>`;
  if (!full) {
    return `<div class="pick" style="${wash}">
      <div class="pick-top">${matchBadge(entry)}${open('btn tertiary compact', `Details${icon.chevron}`, `Details for ${f.name}`)}</div>
      ${reasonsList(displayReasons(entry, 3), 'lead')}
      ${chips(f.accords)}
      ${canWear ? `<div class="pick-actions">${wearButton(entry, ctx, worn)}</div>` : ''}
    </div>`;
  }
  return `<div class="pick full" style="${wash}">
    ${open('pick-bottle', img(f, { lazy: false }), `Details for ${f.name}`)}
    <div class="pick-info">
      ${kicker ? `<p class="kicker">${worn === f.id ? 'Wearing' : esc(kicker)}</p>` : ''}
      <h3 class="pick-name">${open('pick-name-btn', esc(f.name))}</h3>
      <p class="brand">${esc(f.brand)}</p>
      ${reasonsList(displayReasons(entry, 2), 'lead')}
      ${chips(f.accords)}
    </div>
    <div class="pick-actions">${canWear ? wearButton(entry, ctx, worn) : ''}${matchBadge(entry)}</div>
  </div>`;
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

function weekPick(p, slot, dayName) {
  if (!p) return `<span class="wk-pick empty"><span class="wk-slot">${slotIcon(slot)}</span><span class="wk-none">Done for today</span></span>`;
  const f = p.pick.fragrance;
  return `<button class="wk-pick${p.worn ? ' worn' : ''}" data-action="open" data-ctx="${esc(p.ctx)}" data-id="${esc(f.id)}" aria-label="${esc(`${dayName} ${slot === 'day' ? 'daytime' : 'night'}: ${f.name}`)}">
    ${img(f)}
    <span class="wk-text"><small>${slotIcon(slot)}${slot === 'day' ? 'Day' : 'Night'}${p.worn ? ' · wearing' : ''}</small><b>${esc(f.name)}</b></span>
    ${magDot(p.pick.tier)}
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

// A radio group: one tab stop, arrow keys move the choice (the shell's roving keys).
export function occasionPickerHTML(activeId) {
  return `<div class="occasions" role="radiogroup" aria-label="Occasion" data-keep-scroll="occasions" style="--n:${OCCASIONS.length}">
    ${OCCASIONS.map(o => `<button class="occ${o.id === activeId ? ' on' : ''}" role="radio" aria-checked="${o.id === activeId}" tabindex="${o.id === activeId ? 0 : -1}" data-action="occasion" data-value="${o.id}">
      <span class="occ-icon">${icon[o.icon] ?? icon.sparkle}</span>
      <span class="occ-label">${esc(o.label)}</span>
      <span class="occ-blurb">${esc(o.blurb)}</span>
    </button>`).join('')}
  </div>`;
}

export function slotToggleHTML(slot, wx) {
  const order = [wx.day, wx.night].filter(Boolean).sort((a, b) => a.dateISO.localeCompare(b.dateISO) || (a.slot === 'day' ? -1 : 1));
  return segHTML(order.map(w => ({ value: w.slot, label: w.label, icon: slotIcon(w.slot), on: w.slot === slot })), { action: 'occ-slot', label: 'Time of day' });
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
    <header>
      <div><h2 id="jt-title">${icon.journal}Wear journal</h2><p>${plural(stats.wears, 'wear')} · ${plural(stats.bottles, 'bottle')} in 30 days</p></div>
      <a class="btn secondary compact" href="#/wardrobe/worn">Open ${icon.chevron}</a>
    </header>
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

const banner = () => (state.shared ? sharedBannerHTML(state.shared, state.mine.records.length, { slim: true }) : '');

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
  return `${banner()}
    <section class="card slot" aria-labelledby="slot-title">
      ${slotHeadHTML(win, nowHour(), { id: 'slot-title' })}
      ${pickHTML(pick, win.slot, worn, { canWear: canWear(win) })}
      ${alsoHTML(ranked, pick, win.slot, worn, win.slot === 'day' ? 'by day' : 'tonight')}
    </section>
    ${journalTeaser()}`;
}

const occasionOf = route => occasionById(route.arg ?? state.occasion) ?? occasionById('casual');

function occasionPane(app, route) {
  const blocked = guard();
  const occasion = occasionOf(route);
  if (blocked) return occasionPickerHTML(occasion.id) + blocked;
  const slot = state.occasionSlot ?? occasion.slot;
  const win = state.wx[slot] ?? state.wx.day ?? state.wx.night;
  const ranked = rankContext('occ', win, occasion);
  const worn = wornId(win);
  return `${banner()}
    ${occasionPickerHTML(occasion.id)}
    <div class="occ-bar">${slotToggleHTML(win.slot, state.wx)}</div>
    <section class="card slot" aria-labelledby="occ-title">
      ${slotHeadHTML(win, nowHour(), { id: 'occ-title', thumb: true })}
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

// Wave 4 builds trip packing here (PLAN.md decision 8).
function tripPane() {
  return messageHTML({ glyph: icon.suitcase, title: 'Pack for a trip', body: 'Pick a city and dates, and get the two to four bottles that cover every day and night there.' });
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
      heading: route => `Picks for ${occasionOf(route).label.toLowerCase()} in ${place()}`,
      render: occasionPane,
      after: showChosenOccasion,
    },
    { id: 'trip', label: 'Trip', title: () => 'Trip', heading: () => 'Pack for a trip', render: tripPane },
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

export const actions = {
  // Logs (or clears) a wear for the window of the list it's in.
  wear(el, app) {
    const ctx = state.contexts[el.dataset.ctx];
    if (!ctx) return;
    state.history = toggleWear(el.dataset.id, ctx.win.dateISO, ctx.win.slot, state.loc);
    if (wornIn(state.history, ctx.win.dateISO, ctx.win.slot)) navigator.vibrate?.(12);
    app.keepingFocus(el, '#app', app.render);
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
