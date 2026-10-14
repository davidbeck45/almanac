// The Occasion pane's "When and where?": picks for an occasion on another
// date (a wedding on Saturday) or in another place (a dinner in Chicago).
// Today here reads the app's own forecast, a later date here the week's
// while it reaches; anything else fetches that date's day and night once
// (src/weather.js tripWindows: the forecast within FORECAST_DAYS, typical
// weather past it) and keeps them for the session. Kept for the session,
// not saved: the next visit starts from today, here.
import { tripWindows, forecastError, week } from '../../weather.js';
import { daysBetween } from '../../engine.js';
import { shiftISO } from '../../history.js';
import { esc, shortDate, weekdayShort } from '../../ui.js';
import { icon, segHTML, slotIcon } from '../../ui/components.js';
import { state } from '../../app/state.js';
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

// The control: the date, the place, and day or night. On today, the
// windows' own names (Today, Tonight); on another date, Day and Night.
export function whenBarHTML({ dateISO = null, place = null, home, today, slot, wx }) {
  const nowHere = !dateISO && !place;
  const order = !nowHere
    ? [{ slot: 'day', label: 'Day' }, { slot: 'night', label: 'Night' }]
    : [wx.day, wx.night].filter(Boolean).sort((a, b) => a.dateISO.localeCompare(b.dateISO) || (a.slot === 'day' ? -1 : 1));
  const where = place ?? home;
  return `<div class="occ-when" role="group" aria-labelledby="occ-when-label">
    <span class="occ-when-label" id="occ-when-label">When and where?</span>
    <div class="occ-when-controls">
      ${datePillHTML({ field: 'occ-date', value: dateISO ?? today, min: today, max: shiftISO(today, AHEAD_DAYS), text: dateISO ? `${weekdayShort(dateISO)}, ${shortDate(dateISO)}` : 'Today', label: 'Date' })}
      <button class="place-pill" data-action="occ-place" aria-label="${esc(`Place: ${where?.name ?? 'not set'}. Change it`)}">${icon.pin}<span>${esc(where?.name ?? 'Choose a place')}</span></button>
      ${nowHere ? '' : `<button class="icon-btn ghosted occ-when-reset" data-action="occ-when-reset" aria-label="${esc(`Back to today${home ? ` in ${home.name}` : ''}`)}">${icon.close}</button>`}
      ${segHTML(order.map(w => ({ value: w.slot, label: w.label, icon: slotIcon(w.slot), on: w.slot === slot })), { action: 'occ-slot', label: 'Time of day', cls: 'occ-slots' })}
    </div>
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
    document.querySelector('.occ-when [data-field="occ-date"]')?.focus({ preventScroll: true });
  },
  // Asks again for a date and place whose weather didn't come.
  'occ-when-retry'(el, app) {
    for (const [key, entry] of fetched) if (entry.status === 'error') fetched.delete(key);
    app.renderPage();
  },
};

export const changes = {
  'occ-date'(el, app) {
    const today = state.wx?.todayISO;
    if (!el.value || !today) return;
    when.dateISO = el.value <= today ? null : el.value;
    app.keepingFocus(el, '#app', app.renderPage);
  },
};
