// The Occasion pane's "When and where?": picks for an occasion on another
// date (a wedding on Saturday) or in another place (a dinner in Chicago).
// Today here reads the app's own forecast, a later date here the week's
// while it reaches; anything else fetches that date's day and night once
// (src/weather.js tripWindows: the forecast within FORECAST_DAYS, typical
// weather past it) and keeps them for the session. Kept for the session,
// not saved: the next visit starts from today, here. At home, the window
// shown can be planned for the occasion ("Plan it for Sat night", saved in
// src/events.js): Now and the Week then plan around it, and the pane ranks
// it as they do (rankEvent).
import { tripWindows, forecastError, week } from '../../weather.js';
import { daysBetween, eventPhrase } from '../../engine.js';
import { occasionById } from '../../occasions.js';
import { shiftISO } from '../../history.js';
import { esc, shortDate, weekdayShort } from '../../ui.js';
import { icon, segHTML, slotIcon } from '../../ui/components.js';
import { state, eventAt, setEvent } from '../../app/state.js';
import { datePillHTML, onPlace, samePlace, repaint } from './pickers.js';

const AHEAD_DAYS = 365;

// The date and place picked; null for today and here.
export const when = { dateISO: null, place: null };
// `${lat},${lon}|${dateISO}` -> { status: 'loading' | 'ready' | 'error', day, night, error }
const fetched = new Map();

export const isNowHere = () => !when.dateISO && !when.place;
const onOccasion = () => state.route?.dest === 'wear' && state.route.pane === 'occasion';

// "tonight", "tomorrow", "Sat night", "Sat, Dec 12": a window's date and
// time against today's.
export function whenPhrase(win, today) {
  const night = win.slot === 'night';
  const days = daysBetween(today, win.dateISO);
  if (days === 0) return night ? 'tonight' : 'today';
  if (days === 1) return night ? 'tomorrow night' : 'tomorrow';
  const name = weekdayShort(win.dateISO);
  if (days < 7) return night ? `${name} night` : name;
  return night ? `${name} night, ${shortDate(win.dateISO)}` : `${name}, ${shortDate(win.dateISO)}`;
}

/** "Formal · Sat night in Chicago": the occasion, when, and where when it isn't here. */
export const occasionTitle = (occasion, win, { today, place = null }) =>
  `${occasion.label} · ${whenPhrase(win, today)}${place ? ` in ${place.name}` : ''}`;

// Fetched windows say Today and Tomorrow like the app's own.
function relabel(win, today) {
  const days = daysBetween(today, win.dateISO);
  const night = win.slot === 'night';
  if (days === 0) return { ...win, label: night ? 'Tonight' : 'Today' };
  if (days === 1) return { ...win, label: night ? 'Tomorrow night' : 'Tomorrow' };
  return win;
}

function load(key, place, dateISO, today, app) {
  const entry = { status: 'loading' };
  fetched.set(key, entry);
  tripWindows(place, dateISO, dateISO)
    .then(wins => {
      if (!wins.length) throw Object.assign(new Error('no windows'), { status: 'empty' });
      Object.assign(entry, { status: 'ready' }, Object.fromEntries(wins.map(w => [w.slot, relabel(w, today)])));
    })
    .catch(err => Object.assign(entry, { status: 'error', error: err.status === 'empty' ? 'No weather came back for that date. Try again.' : forecastError(err) }))
    .finally(() => { if (fetched.get(key) === entry && onOccasion() && app) repaint(app); });
}

/**
 * The window the Occasion pane ranks for `slot`: { status: 'ready', win,
 * here } or { status: 'loading' } or { status: 'error', error }. `here`:
 * today in your own place (its hours count from now). With `app`, a window
 * not fetched yet starts loading and renders the pane when it's in.
 */
export function eventWindow(slot, app = null) {
  const wx = state.wx;
  if (isNowHere()) return { status: 'ready', win: wx[slot] ?? wx.day ?? wx.night, here: true };
  const place = when.place ?? state.loc;
  const dateISO = when.dateISO ?? wx.todayISO;
  if (!when.place) {
    const day = week(state.forecast).find(d => d.dateISO === dateISO);
    const win = day?.[slot] ?? day?.day ?? day?.night;
    if (win) return { status: 'ready', win };
  }
  const key = `${place.lat},${place.lon}|${dateISO}`;
  if (!fetched.has(key)) {
    if (!app) return { status: 'loading' };
    load(key, place, dateISO, wx.todayISO, app);
  }
  const entry = fetched.get(key);
  if (entry.status !== 'ready') return entry;
  return { status: 'ready', win: entry[slot] ?? entry.day ?? entry.night };
}

const phraseOf = occasion => occasion.phrase ?? occasion.label.toLowerCase();
const cap = t => t.charAt(0).toUpperCase() + t.slice(1);

/**
 * Planning the window shown for the occasion (`plan`: { occasion, win,
 * event: the window's stored event or null }): a button, or once planned
 * the plan and a way to clear it. A window planned for another occasion says
 * so, and planning this one takes its place. Both ways the control carries
 * the same data, so focus stays on it as it turns.
 */
export function planHTML({ occasion, win, event }, today) {
  const when = whenPhrase(win, today);
  const data = `data-action="occ-plan" data-date="${esc(win.dateISO)}" data-slot="${esc(win.slot)}" data-occasion="${esc(occasion.id)}"`;
  if (event?.occasion === occasion.id) {
    return `<p class="occ-plan on">${icon.check}<span>${esc(`Planned for ${when}`)}</span><button class="link-btn" ${data}>Clear<span class="visually-hidden"> the plan for ${esc(when)}</span></button></p>`;
  }
  const other = event && occasionById(event.occasion);
  return `<p class="occ-plan"><button class="btn secondary compact" ${data}>${icon.calendar}<span>${esc(`Plan it for ${when}`)}</span></button>${other ? `<span class="occ-plan-note">${esc(`${cap(when)} is planned for ${phraseOf(other)}`)}</span>` : ''}</p>`;
}

// The control: the date, the place, and Day or Night. On today here the
// date is the shown window's: once today's daytime is over, Day is
// tomorrow's, and the pill says Tomorrow while it's chosen. At home, the
// window shown can be planned for the occasion (`plan`, planHTML).
export function whenBarHTML({ dateISO = null, place = null, home, today, slot, wx, plan = null }) {
  const nowHere = !dateISO && !place;
  const shown = nowHere ? (wx[slot] ?? wx.day ?? wx.night)?.dateISO ?? today : null;
  const text = dateISO ? `${weekdayShort(dateISO)}, ${shortDate(dateISO)}` : shown > today ? 'Tomorrow' : 'Today';
  const where = place ?? home;
  return `<div class="occ-when" role="group" aria-labelledby="occ-when-label">
    <span class="occ-when-label" id="occ-when-label">When and where?</span>
    <div class="occ-when-controls">
      ${datePillHTML({ field: 'occ-date', value: dateISO ?? shown ?? today, min: today, max: shiftISO(today, AHEAD_DAYS), text, label: 'Date' })}
      <button class="place-pill" data-action="occ-place" aria-label="${esc(`Place: ${where?.name ?? 'not set'}. Change it`)}">${icon.pin}<span>${esc(where?.name ?? 'Choose a place')}</span></button>
      ${nowHere ? '' : `<button class="icon-btn ghosted occ-when-reset" data-action="occ-when-reset" aria-label="${esc(`Back to today${home ? ` in ${home.name}` : ''}`)}">${icon.close}</button>`}
      ${segHTML(['day', 'night'].map(s => ({ value: s, label: s === 'day' ? 'Day' : 'Night', icon: slotIcon(s), on: s === slot })), { action: 'occ-slot', label: 'Time of day', cls: 'occ-slots' })}
    </div>
    ${plan ? planHTML(plan, today) : ''}
  </div>`;
}

onPlace('occ', place => {
  when.place = samePlace(place, state.loc) ? null : place;
});

export const actions = {
  'occ-place'(el, app) {
    app.openSheet({ kind: 'wear-place', for: 'occ' });
  },
  'occ-when-reset'(el, app) {
    when.dateISO = null;
    when.place = null;
    state.occasionSlot = null;
    app.renderPage();
    document.querySelector('.occ-when [data-for="occ-date"]')?.focus({ preventScroll: true });
  },
  // Plans the window shown for the occasion, or clears its plan; the
  // occasion's best for it goes on Now and the Week (src/events.js).
  'occ-plan'(el, app) {
    const { date: dateISO, slot, occasion: id } = el.dataset;
    const win = { dateISO, slot };
    const on = eventAt(win)?.occasion === id;
    setEvent(dateISO, slot, on ? null : id);
    app.keepingFocus(el, '#app', app.render);
    const today = state.wx?.todayISO ?? dateISO;
    const what = eventPhrase({ dateISO, slot, occasion: occasionById(id) }, today);
    const best = !on && state.contexts.occ?.ranked[0]?.fragrance;
    const inWeek = week(state.forecast).some(d => d.dateISO === dateISO);
    app.showToast(`<span>${esc(on ? `No plan for ${what} any more.` : best && inWeek ? `Planned: ${what}, with ${best.name}.` : `Planned: ${what}. The Week plans around it once the forecast gets there.`)}</span>`);
  },
  // Asks again for a date and place whose weather didn't come. The button
  // gives way to a skeleton, so focus goes to the place it's for.
  'occ-when-retry'(el, app) {
    for (const [key, entry] of fetched) if (entry.status === 'error') fetched.delete(key);
    app.renderPage();
    document.querySelector('.occ-when [data-action="occ-place"]')?.focus({ preventScroll: true });
  },
};

export const changes = {
  'occ-date'(el, app) {
    const today = state.wx?.todayISO;
    if (!el.value || !today) return;
    when.dateISO = el.value <= today ? null : el.value;
    repaint(app);
  },
};
