// Plans at home: a day or night set aside for an occasion (Saturday night's
// wedding), set from the Occasion pane's "When and where?" and kept on this
// device (`scentcast.events`: [{ dateISO, slot, occasion }], the occasion's
// id, in time order). Now and the Week plan around them through planWindows:
// the event takes the occasion's best (src/engine.js rankEvent) and the
// windows before it leave that bottle be. One event a window; dates gone by
// drop out as the list loads. Trips keep their own events with the trip
// (src/views/wear/trip.js), for the bottles packed.
//
// Plans also come as text: the CLI's --events and the Week's plan links
// (#/wear/week?plan=…, which Claude sends after reading the calendar) share
// one grammar, parseEventText.
import { OCCASIONS, occasionById, findOccasion } from './occasions.js';
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

/** Saves a whole list (a restored backup's, src/backup.js), tidied from `fromISO` on; returns it. */
export function saveEvents(events, fromISO = yesterday()) {
  const next = tidyEvents(events, fromISO);
  save(next);
  return next;
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

// ---------- Plans as text ----------

const SLOTS = ['day', 'night'];
// A real calendar date: Date.parse takes Feb 30 as Mar 2.
const isDate = s => ISO_DATE.test(s ?? '') && !Number.isNaN(Date.parse(`${s}T12:00:00Z`)) && new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s;

/**
 * "2026-10-20 night formal; 2026-10-21 date night" -> [{ dateISO, slot,
 * occasion }], the occasion itself. Each is a date, then an occasion (id or
 * label, src/occasions.js findOccasion), with an optional day or night
 * before or after it ("formal night"); without one the occasion's own slot.
 * One per window. Throws with a sentence for the user.
 */
export function parseEventText(text) {
  const events = String(text ?? '').split(';').map(s => s.trim()).filter(Boolean).map(part => {
    const [dateISO, ...rest] = part.split(/\s+/);
    if (!isDate(dateISO)) throw new Error(`"${part}" doesn't start with a date (YYYY-MM-DD)`);
    // "night out" and "date night" are occasions; "night formal" and "formal night" a slot and one.
    let occasion = findOccasion(rest.join(' '));
    let slot = occasion?.slot;
    const isSlot = word => SLOTS.includes(word?.toLowerCase());
    if (!occasion && isSlot(rest[0])) [slot, occasion] = [rest[0].toLowerCase(), findOccasion(rest.slice(1).join(' '))];
    if (!occasion && isSlot(rest.at(-1))) [slot, occasion] = [rest.at(-1).toLowerCase(), findOccasion(rest.slice(0, -1).join(' '))];
    if (!occasion) {
      throw new Error(`no occasion in "${part}". Write each as DATE [day|night] OCCASION, the occasion one of: ${OCCASIONS.map(o => o.id).join(', ')}`);
    }
    return { dateISO, slot, occasion };
  });
  const seen = new Set();
  for (const e of events) {
    const key = `${e.dateISO} ${e.slot}`;
    if (seen.has(key)) throw new Error(`two events on the ${e.slot} of ${e.dateISO}; give each day or night one`);
    seen.add(key);
  }
  return events;
}

/** Events (the occasion itself or its id) as parseEventText reads them, in its plainest words: "2026-10-20 night formal;2026-10-21 night date". */
export const planText = events => events.map(e => `${e.dateISO} ${e.slot} ${e.occasion?.id ?? e.occasion}`).join(';');
