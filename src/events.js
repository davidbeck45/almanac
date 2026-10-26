// Plans at home: a day or night set aside for an occasion (Saturday night's
// wedding), set from the Occasion pane's "When and where?" and kept on this
// device (`scentcast.events`: [{ dateISO, slot, occasion }], the occasion's
// id, in time order). Now and the Week plan around them through planWindows:
// the event takes the occasion's best (src/engine.js rankEvent) and the
// windows before it leave that bottle be. One event a window; dates gone by
// drop out as the list loads. Trips keep their own events with the trip
// (src/views/wear/trip.js), for the bottles packed.
import { occasionById } from './occasions.js';
import { withEvents } from './pack.js';

const KEY = 'scentcast.events';
// Far more than anyone plans, so a bad write can't grow the list for good.
const MAX_EVENTS = 100;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// The device's date a day back: a place can be a day behind the device, and
// an event there stays until its own day is over.
const yesterday = (d = new Date(Date.now() - 86_400_000)) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// One stored event as the list keeps it, or null: a real date, day or
// night, and an occasion the app has.
function eventOf(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const { dateISO, slot, occasion } = raw;
  if (typeof dateISO !== 'string' || !ISO_DATE.test(dateISO) || Number.isNaN(Date.parse(dateISO))) return null;
  if ((slot !== 'day' && slot !== 'night') || typeof occasion !== 'string' || !occasionById(occasion)) return null;
  return { dateISO, slot, occasion };
}

/** A list tidied: events in the stored shape from `fromISO` on, the first for each window, in time order. */
export function tidyEvents(list, fromISO) {
  const kept = new Map();
  for (const e of (Array.isArray(list) ? list : []).map(eventOf)) {
    const key = e && `${e.dateISO}:${e.slot}`;
    if (e && e.dateISO >= fromISO && !kept.has(key)) kept.set(key, e);
  }
  return [...kept.values()]
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO) || (a.slot === 'night') - (b.slot === 'night'))
    .slice(0, MAX_EVENTS);
}

/** The stored events from `fromISO` (default: the device's yesterday) on; [] when there are none or they can't be read. */
export function loadEvents(fromISO = yesterday()) {
  try {
    return tidyEvents(JSON.parse(localStorage.getItem(KEY)), fromISO);
  } catch {
    return [];
  }
}

function save(events) {
  try { localStorage.setItem(KEY, JSON.stringify(events)); } catch {}
}

/**
 * Sets what a window is for (an occasion id, replacing the one it had) or,
 * with null, clears it; dates before `fromISO` drop out. Saves and returns
 * the list.
 */
export function setEvent(dateISO, slot, occasion, fromISO = yesterday()) {
  const rest = loadEvents(fromISO).filter(e => !(e.dateISO === dateISO && e.slot === slot));
  const next = tidyEvents(occasion ? [{ dateISO, slot, occasion }, ...rest] : rest, fromISO);
  save(next);
  return next;
}

/** The event on a window ({ dateISO, slot }), or null. */
export const eventOn = (events, { dateISO, slot }) => events.find(e => e.dateISO === dateISO && e.slot === slot) ?? null;

/** Windows with the stored events on them, as planWindows reads them (`win.occasion`, the occasion itself). */
export const withStoredEvents = (windows, events) => withEvents(windows, events.map(e => ({ ...e, occasion: occasionById(e.occasion) })));
