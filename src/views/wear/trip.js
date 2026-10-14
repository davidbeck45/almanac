// Trip (#/wear/trip): what to pack. A place, dates and any events (a formal
// dinner on the third night) go to src/pack.js's packTrip, which picks the
// fewest bottles, up to the number allowed, that keep every day's and
// night's pick near the top, and plans which to wear when. The weather is
// the forecast as far as it reaches and typical weather past it
// (src/weather.js tripWindows). The last trip stays on this device (KEY):
// its place, dates, events, bottle count and the weather fetched, so it opens
// at once, packs again without the network when only the events or the
// count change, and refreshes its weather when it's hours old. A trip under
// way keeps its start and the weather saved for the days gone by (the
// forecast has no past days); its events and its end can still change.
import { packTrip, withEvents } from '../../pack.js';
import { rank, daysBetween } from '../../engine.js';
import { tripWindows, forecastError } from '../../weather.js';
import { OCCASIONS, occasionById } from '../../occasions.js';
import { shiftISO } from '../../history.js';
import { esc, cap, deg, plural, shortDate, weekdayShort } from '../../ui.js';
import { icon, img, wxIconFor, slotIcon, segHTML, sectionHead, reasonsList } from '../../ui/components.js';
import { state, rankedFragrances, storeContext, todayISO, deviceToday, byTime } from '../../app/state.js';
import { datePillHTML, onPlace, samePlace, repaint } from './pickers.js';

const KEY = 'scentcast.trip';
// As the CLI (scripts/recommend.mjs --pack): up to 31 days, within a year.
export const MAX_TRIP_DAYS = 31;
const AHEAD_DAYS = 365;
const BOTTLE_CHOICES = [2, 3, 4];
const DEFAULT_MAX = 3;
// Saved weather older than this is fetched again when the trip opens.
const REFRESH_AFTER = 6 * 60 * 60 * 1000;
// Packing ranks every bottle for every window: a few milliseconds for a
// wardrobe of 25 over a week, a fifth of a second for 120 bottles over a
// month. Past this many bottle-windows it runs after the page has painted.
const INLINE_WORK = 1000;

const later = (a, b) => (a > b ? a : b);
const uncap = t => t.charAt(0).toLowerCase() + t.slice(1);
const listOf = items => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
const dayName = iso => `${weekdayShort(iso)}, ${shortDate(iso)}`;
// "Sat, Oct 17" or "Sat night, Oct 17".
export const windowName = (dateISO, slot) => (slot === 'night' ? `${weekdayShort(dateISO)} night, ${shortDate(dateISO)}` : dayName(dateISO));
// "Oct 16–19", "Oct 30 – Nov 2", "Oct 16".
export function datesText(fromISO, toISO) {
  if (fromISO === toISO) return shortDate(fromISO);
  if (fromISO.slice(0, 7) === toISO.slice(0, 7)) return `${shortDate(fromISO)}–${+toISO.slice(8)}`;
  return `${shortDate(fromISO)} – ${shortDate(toISO)}`;
}
const tripDays = t => daysBetween(t.fromISO, t.toISO) + 1;
const datesOf = t => Array.from({ length: Math.max(0, tripDays(t)) }, (_, i) => shiftISO(t.fromISO, i));

// ---------- The saved trip ----------

/**
 * The last trip: { place: { name, region, lat, lon }, fromISO, toISO,
 * events: [{ dateISO, slot, occasion: id }], max, windows, fetchedAt }, its
 * windows as tripWindows gave them (each `date` revived). Null when there's
 * none or it doesn't read: no window left that packTrip can rank, or no
 * time it was fetched.
 */
export function loadTrip() {
  try {
    const t = JSON.parse(localStorage.getItem(KEY));
    const iso = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);
    const slot = x => x === 'day' || x === 'night';
    if (!t || !Number.isFinite(t.place?.lat) || !Number.isFinite(t.place?.lon) || !iso(t.fromISO) || !iso(t.toISO) || !Array.isArray(t.windows)) return null;
    const windows = t.windows.filter(w => iso(w?.dateISO) && slot(w.slot) && Number.isFinite(w.feelsF));
    const fetchedAt = Number(t.fetchedAt);
    if (!windows.length || !(fetchedAt > 0)) return null;
    return {
      place: { name: String(t.place.name ?? 'Trip'), region: String(t.place.region ?? ''), lat: t.place.lat, lon: t.place.lon },
      fromISO: t.fromISO,
      toISO: t.toISO,
      events: (Array.isArray(t.events) ? t.events : []).filter(e => iso(e?.dateISO) && slot(e.slot) && occasionById(e.occasion)),
      max: BOTTLE_CHOICES.includes(t.max) ? t.max : DEFAULT_MAX,
      windows: windows.map(w => ({ ...w, date: new Date(`${w.dateISO}T12:00:00`) })),
      fetchedAt,
    };
  } catch {
    return null;
  }
}

export function saveTrip(trip) {
  // Each window's `date` is rebuilt from its dateISO on the way back in.
  const windows = trip.windows.map(({ date, occasion, ...w }) => w);
  try { localStorage.setItem(KEY, JSON.stringify({ ...trip, windows })); } catch {}
}

// ---------- Checking the form ----------

/**
 * What's wrong with a draft, as a sentence for the form, or ''. `saved` is
 * the trip it changes: one already under way keeps its start, though that
 * date has passed.
 */
export function checkTrip(draft, today, saved = null) {
  if (!draft.place) return 'Choose where you’re going.';
  if (!draft.fromISO || !draft.toISO) return 'Pick the dates of the trip.';
  if (draft.toISO < draft.fromISO) return 'The trip ends before it starts. Check the dates.';
  if (draft.toISO < today) return 'The trip ends on a date that has passed. Pick today or later.';
  if (draft.fromISO < today && draft.fromISO !== saved?.fromISO) return 'The trip starts on a date that has passed. Pick today or later.';
  if (tripDays(draft) > MAX_TRIP_DAYS) return `Plan up to ${MAX_TRIP_DAYS} days at a time.`;
  if (daysBetween(today, draft.toISO) > AHEAD_DAYS) return 'Pick dates within a year from today.';
  return '';
}

// ---------- Reading a packed trip ----------

// The windows a bottle is worn, as words: "Every day", "4 nights and formal
// wear on Sat", "1 day and 2 nights".
export function roleOf(record, plan) {
  const mine = plan.filter(p => p.pick === record);
  const parts = [];
  for (const slot of ['day', 'night']) {
    const n = mine.filter(p => !p.occasion && p.window.slot === slot).length;
    const all = plan.filter(p => !p.occasion && p.window.slot === slot).length;
    if (n) parts.push(n === all && all > 1 ? `every ${slot}` : plural(n, slot));
  }
  if (parts[0] === 'every day' && parts[1] === 'every night') parts.splice(0, 2, 'every day and night');
  for (const p of mine.filter(p => p.occasion)) parts.push(`${p.occasion.phrase ?? p.occasion.label.toLowerCase()} on ${weekdayShort(p.window.dateISO)}`);
  return parts.length ? cap(listOf(parts)) : 'A spare';
}

// Its commonest leading reason where it's worn.
export function leadOf(record, plan) {
  const counts = new Map();
  for (const p of plan) {
    if (p.pick !== record) continue;
    const text = p.reasons.find(r => r.tone === 'good')?.text;
    if (text) counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

const ctxKey = win => `trip:${win.dateISO}:${win.slot}`;

// The plan by date: [{ dateISO, day: plan entry | null, night }].
export function planDays(plan) {
  const days = new Map();
  for (const p of plan) {
    const d = days.get(p.window.dateISO) ?? { dateISO: p.window.dateISO, day: null, night: null };
    d[p.window.slot] = p;
    days.set(p.window.dateISO, d);
  }
  return [...days.values()];
}

// Whose weather a plan runs on, from today on (the days gone by don't
// matter): { all: typical weather throughout, some: typical weather past
// the forecast, from: the first typical date after the last forecast one }.
export function weatherOf(windows, today = '') {
  const ahead = windows.filter(w => w.dateISO >= today);
  const wins = ahead.length ? ahead : windows;
  const last = wins.findLastIndex(w => !w.typical);
  const past = wins.slice(last + 1);
  return { all: wins.length > 0 && last < 0, some: past.length > 0, from: past[0]?.dateISO ?? null };
}

// An event in the packing list: "date night", "formal at night".
const eventWords = (occasion, slot) => {
  const name = occasion.label.toLowerCase();
  return /night/.test(name) ? name : `${name} ${slot === 'day' ? 'by day' : 'at night'}`;
};

/**
 * The packing list as plain text, for the clipboard or a share sheet: the
 * bottles and their roles, then a line a day ("Sun, Oct 25: Terra by day;
 * date night: Sticky Fingers").
 */
export function packingText(result, trip, { today = '' } = {}) {
  const lines = [`Packing for ${trip.place.name}, ${datesText(trip.fromISO, trip.toISO)}`, ''];
  for (const b of result.bottles) lines.push(`${b.record.name} (${b.record.brand}): ${uncap(roleOf(b.record, result.plan))}`);
  lines.push('');
  for (const d of planDays(result.plan)) {
    const say = (p, slot) => p && (p.occasion ? `${eventWords(p.occasion, slot)}: ${p.pick.name}` : `${p.pick.name} ${slot === 'day' ? 'by day' : 'at night'}`);
    const parts = [say(d.day, 'day'), say(d.night, 'night')].filter(Boolean);
    lines.push(`${dayName(d.dateISO)}: ${parts.join(d.day?.occasion || d.night?.occasion ? '; ' : ', ')}`);
  }
  const wx = weatherOf(result.plan.map(p => p.window), today);
  if (wx.all) lines.push('', 'Planned on typical weather for these dates.');
  else if (wx.some) lines.push('', `Typical weather from ${shortDate(wx.from)}, past the forecast.`);
  return lines.join('\n');
}

// ---------- Templates ----------

const maxSeg = max => segHTML(BOTTLE_CHOICES.map(n => ({ value: String(n), label: String(n), on: n === max })), { action: 'trip-max', label: 'Bottles at most' });

function eventRowHTML(e, i) {
  const occ = occasionById(e.occasion);
  const when = windowName(e.dateISO, e.slot);
  return `<li class="trip-event"><span class="trip-event-icon">${icon[occ.icon] ?? icon.sparkle}</span><span class="trip-event-text"><b>${esc(occ.label)}</b><small>${esc(when)}</small></span>
    <button type="button" class="icon-btn ghosted" data-action="trip-ev-remove" data-value="${i}" aria-label="${esc(`Remove ${occ.label}, ${when}`)}">${icon.close}</button></li>`;
}

function addEventHTML(adding, dates) {
  return `<div class="trip-add" role="group" aria-label="New event">
    <label class="trip-select"><span class="visually-hidden">Day</span><select data-field="trip-ev-date">${dates.map(d => `<option value="${d}"${d === adding.dateISO ? ' selected' : ''}>${esc(dayName(d))}</option>`).join('')}</select>${icon.chevron}</label>
    ${segHTML([{ value: 'day', label: 'Day', icon: icon.sun, on: adding.slot === 'day' }, { value: 'night', label: 'Night', icon: icon.moon, on: adding.slot === 'night' }], { action: 'trip-ev-slot', label: 'Time of day' })}
    <label class="trip-select"><span class="visually-hidden">Occasion</span><select data-field="trip-ev-occ">${OCCASIONS.map(o => `<option value="${o.id}"${o.id === adding.occasion ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>${icon.chevron}</label>
    <div class="trip-add-actions">
      <button type="button" class="btn secondary compact" data-action="trip-ev-save">${icon.plus}Add</button>
      <button type="button" class="btn tertiary compact" data-action="trip-ev-cancel">Cancel</button>
    </div>
  </div>`;
}

/**
 * The trip's form. draft = { place, fromISO, toISO, events, max };
 * opts = { today, busy, error, adding, editing, packed, startedOn }:
 * `packed` when a trip is already planned (the button updates it),
 * `startedOn` the saved trip's start (one under way keeps it). While `busy`
 * the fields are inert, so the dates can't change under the weather fetch.
 */
export function tripFormHTML(draft, { today, busy = false, error = '', adding = null, editing = false, packed = false, startedOn = null } = {}) {
  const max = shiftISO(today, AHEAD_DAYS);
  const place = draft.place;
  // Events go on the days still to come.
  const dates = draft.fromISO && draft.toISO && draft.toISO >= draft.fromISO ? datesOf(draft).slice(0, MAX_TRIP_DAYS).filter(d => d >= today) : [];
  const minFrom = startedOn && startedOn < today ? startedOn : today;
  return `<section class="card trip-form" aria-labelledby="trip-form-title">
    ${sectionHead(`${icon.suitcase}${packed ? 'Change the trip' : 'Plan a trip'}`, packed ? '' : '<p>Pick a place and dates, and get the fewest bottles that cover every day and night there.</p>', { id: 'trip-form-title' })}
    <form class="trip-fields" data-form="trip-pack" novalidate${busy ? ' inert' : ''}>
      <div class="trip-field where">
        <span class="trip-label" id="trip-where">Where</span>
        <button type="button" class="trip-place${place ? '' : ' empty'}" data-action="trip-place" aria-labelledby="trip-where trip-place-name">${icon.pin}<span class="trip-place-text"><b id="trip-place-name">${esc(place?.name ?? 'Choose a city')}</b>${place?.region ? `<small>${esc(place.region)}</small>` : ''}</span>${icon.chevron}</button>
      </div>
      <div class="trip-field"><span class="trip-label">From</span>${datePillHTML({ field: 'trip-from', name: 'from', value: draft.fromISO, min: minFrom, max, text: draft.fromISO ? dayName(draft.fromISO) : 'Pick a day', label: 'From' })}</div>
      <div class="trip-field"><span class="trip-label">To</span>${datePillHTML({ field: 'trip-to', name: 'to', value: draft.toISO, min: later(draft.fromISO || today, today), max, text: draft.toISO ? dayName(draft.toISO) : 'Pick a day', label: 'To' })}</div>
      <div class="trip-field bottles"><span class="trip-label">Bottles at most</span>${maxSeg(draft.max)}</div>
      <div class="trip-field events">
        <span class="trip-label">Events</span>
        ${draft.events.length ? `<ul class="trip-event-list">${draft.events.map(eventRowHTML).join('')}</ul>` : ''}
        ${adding ? addEventHTML(adding, dates)
          : `<div class="trip-add-line"><button type="button" class="btn secondary compact" data-action="trip-ev-add" ${dates.length ? '' : 'disabled'}>${icon.plus}Add an event</button>${draft.events.length ? '' : '<small>A wedding or a date night gets picks of its own.</small>'}</div>`}
      </div>
      ${error ? `<p class="error trip-error" role="alert">${esc(error)}</p>` : ''}
      <div class="trip-submit">
        <button class="btn primary" type="submit" ${busy ? 'disabled' : ''}>${busy ? '<span class="spinner small" aria-hidden="true"></span><span>Checking the weather…</span>' : `${icon.suitcase}<span>${packed ? 'Update the plan' : 'Plan what to pack'}</span>`}</button>
        ${editing ? '<button type="button" class="btn tertiary" data-action="trip-cancel">Cancel</button>' : ''}
      </div>
    </form>
  </section>`;
}

// The trip at a glance, over its plan: where, when, events, and whose weather.
export function tripSummaryHTML(trip, { today, note = '', updating = false } = {}) {
  const wx = weatherOf(trip.windows, today);
  const tags = trip.events.map(e => {
    const occ = occasionById(e.occasion);
    return `<li class="trip-tag">${icon[occ.icon] ?? ''}${esc(`${occ.label}, ${e.slot === 'night' ? `${weekdayShort(e.dateISO)} night` : weekdayShort(e.dateISO)}`)}</li>`;
  });
  const status = updating ? 'Updating the weather…'
    : trip.toISO < today ? 'This trip is over. Change the dates to plan the next one.'
      : wx.all ? 'Typical weather for these dates: they’re past the forecast.'
        : wx.some ? `Forecast weather, then typical weather from ${shortDate(wx.from)}.`
          : 'Forecast weather for every day.';
  return `<section class="card trip-head" aria-labelledby="trip-title">
    <div class="trip-head-row">
      <span class="trip-badge">${icon.suitcase}</span>
      <div class="trip-head-text">
        <h2 id="trip-title" tabindex="-1">${esc(trip.place.name)}</h2>
        <p>${esc(`${plural(tripDays(trip), 'day')}, ${datesText(trip.fromISO, trip.toISO)}`)}</p>
      </div>
      <button class="btn secondary compact" data-action="trip-edit">${icon.pen}Change</button>
      ${tags.length ? `<ul class="trip-tags" aria-label="Events">${tags.join('')}</ul>` : ''}
    </div>
    <p class="trip-wx${updating ? ' updating' : ''}">${icon.thermo}<span>${esc(status)}</span></p>
    ${note ? `<p class="trip-note">${esc(note)}</p>` : ''}
  </section>`;
}

// Notices under the packed bottles: windows nothing packed suits, and a
// bottle worn every day of a long trip. Each offers one more bottle while
// the count allows.
function noticesHTML(result, max) {
  const more = max < BOTTLE_CHOICES.at(-1)
    ? `<button class="btn secondary compact" data-action="trip-max" data-value="${max + 1}">Allow ${max + 1} bottles</button>` : '';
  const out = [];
  if (result.uncovered.length) {
    const byBest = new Map();
    for (const u of result.uncovered) byBest.set(u.best, [...(byBest.get(u.best) ?? []), u]);
    const when = u => `${windowName(u.window.dateISO, u.window.slot)}${u.occasion ? ` (${u.occasion.label.toLowerCase()})` : ''}`;
    const lines = [...byBest].map(([best, us]) => `${esc(listOf(us.map(when)))}: <b>${esc(best.name)}</b> would suit ${us.length > 1 ? 'them' : 'it'} better.`);
    out.push(`<div class="trip-notice"><p><b>Not quite covered.</b> ${lines.join(' ')}</p>${more}</div>`);
  }
  if (result.variety) {
    // Worded by the slot it's worn in, as packTrip's text is: nights only, days only, or both.
    const { everyDay, add, slot } = result.variety;
    const worn = everyDay.map(f => `<b>${esc(f.name)}</b>`);
    const [when, rest] = slot === 'night' ? ['every night', 'a night off'] : slot === 'day' ? ['every day', 'a day off'] : ['every day, by day or night', 'a break'];
    out.push(`<div class="trip-notice"><p>${listOf(worn)} ${worn.length > 1 ? 'are' : 'is'} worn ${when}. Pack <b>${esc(add.name)}</b> too and each gets ${rest}.</p>${more}</div>`);
  }
  return out.join('');
}

/** The packed bottles on their shelf, why each, and the list to copy. */
export function tripPackHTML(result, trip, { canShare = false } = {}) {
  const first = record => result.plan.find(p => p.pick === record)?.window;
  const bags = result.bottles.map(b => {
    const f = b.record;
    const win = first(f);
    const ctx = win ? ctxKey(win) : '';
    const lead = leadOf(f, result.plan);
    const open = (cls, inner, label = '') => `<button class="${cls}" data-action="open" data-ctx="${esc(ctx)}" data-id="${esc(f.id)}"${label ? ` aria-label="${esc(label)}"` : ''}>${inner}</button>`;
    return `<li class="trip-bag">
      ${open('trip-bag-photo', img(f, { lazy: false }), `Details for ${f.name}`)}
      <div class="trip-bag-text">
        <h3 class="trip-bag-name">${open('pick-name-btn', `<span class="clamp">${esc(f.name)}</span>`)}</h3>
        <p class="brand">${esc(f.brand)}</p>
        <p class="trip-role">${esc(roleOf(f, result.plan))}</p>
        ${lead ? reasonsList([{ text: lead, tone: 'good' }], 'compact') : ''}
      </div>
    </li>`;
  }).join('');
  return `<section class="card trip-pack" aria-labelledby="trip-pack-title">
    ${sectionHead(`${icon.suitcase}Pack ${plural(result.bottles.length, 'bottle')}`, '', { id: 'trip-pack-title' })}
    <ul class="trip-bags" style="--n:${result.bottles.length}">${bags}</ul>
    ${noticesHTML(result, trip.max)}
    <div class="trip-actions">
      <div class="trip-max"><span id="trip-max-label">Bottles at most</span>${maxSeg(trip.max)}</div>
      <div class="trip-share">
        <button class="btn secondary compact" data-action="trip-copy">${icon.paste}Copy packing list</button>
        ${canShare ? `<button class="btn tertiary compact" data-action="trip-share">${icon.share}Share</button>` : ''}
      </div>
    </div>
  </section>`;
}

// A window of the plan. One nothing packed suits well says "Not ideal" in
// words (the notice over the plan names what would suit it).
function cellHTML(p, slot) {
  if (!p) return `<span class="trip-cell none" data-slot="${slot}"><span class="trip-slot">${slotIcon(slot)}</span><span class="trip-none">Before the trip</span></span>`;
  const f = p.pick, w = p.window;
  const occ = p.occasion;
  const spoken = [windowName(w.dateISO, slot), f.name, `feels ${deg(w.feelsF)}${w.typical ? ', typical weather' : ''}`, occ && occ.label, !p.covered && 'not ideal'].filter(Boolean).join(', ');
  return `<button class="trip-cell${p.covered ? '' : ' off'}" data-slot="${slot}" data-action="open" data-ctx="${esc(ctxKey(w))}" data-id="${esc(f.id)}" aria-label="${esc(spoken)}">
    <span class="trip-slot">${slotIcon(slot)}</span>
    <span class="trip-wx-cell">${wxIconFor(w)}<span class="trip-temp">${w.typical ? '<i>≈</i>' : ''}${deg(w.feelsF)}</span></span>
    ${img(f)}
    <span class="trip-name"><span class="trip-name-text">${esc(f.name)}</span>${occ ? `<small>${icon[occ.icon] ?? ''}${esc(occ.label)}</small>` : ''}${p.covered ? '' : '<small class="trip-off">Not ideal</small>'}</span>
  </button>`;
}

/** Which packed bottle to wear when, a row a day. */
export function tripPlanHTML(result, { today } = {}) {
  const days = planDays(result.plan);
  const wx = weatherOf(result.plan.map(p => p.window), today);
  const note = wx.some ? '≈ marks typical weather, past the forecast. Open a bottle to see why.' : 'Open a bottle to see why.';
  return `<section class="card trip-plan" aria-labelledby="trip-plan-title">
    ${sectionHead(`${icon.calendar}Day by day`, `<p>${esc(note)}</p>`, { id: 'trip-plan-title' })}
    <div class="trip-cols" aria-hidden="true"><span></span><span>${icon.sun}Day</span><span>${icon.moon}Night</span></div>
    <ol class="trip-days">${days.map(d => `
      <li class="trip-day${d.dateISO === today ? ' today' : ''}">
        <div class="trip-date"><b>${esc(d.dateISO === today ? 'Today' : weekdayShort(d.dateISO))}</b><small>${esc(shortDate(d.dateISO))}</small></div>
        ${cellHTML(d.day, 'day')}${cellHTML(d.night, 'night')}
      </li>`).join('')}</ol>
  </section>`;
}

// While the weather loads (or a big list packs): the shelf and the rows, as
// shapes. It takes focus while the form is inert, and says what's going on.
const skeleton = (text = 'Checking the weather there…') => `<div class="stack trip-sk" id="trip-sk" tabindex="-1" role="status">
    <span class="visually-hidden">${esc(text)}</span>
    <div class="card"><span class="sk sk-line w40"></span><div class="trip-sk-bags">${'<span class="sk"></span>'.repeat(3)}</div></div>
    <div class="card"><span class="sk sk-line w40"></span>${'<span class="sk trip-sk-row"></span>'.repeat(4)}</div>
  </div>`;

// ---------- The pane ----------

const ui = {
  saved: undefined, // the packed trip (loadTrip), read on first use
  draft: null, // the form: { place, fromISO, toISO, events, max, auto }
  editing: false, // the form open over a packed trip
  adding: null, // an event being added: { dateISO, slot, occasion }
  busy: false, // fetching the weather for a new place or dates
  error: '',
  updating: false, // refreshing an old trip's weather in the background
  note: '', // that refresh failed
  refreshed: null, // the fetchedAt a refresh was last tried for
};

const savedTrip = () => {
  if (ui.saved === undefined) ui.saved = loadTrip();
  return ui.saved;
};

// `auto`: the default dates, from that day, until someone picks their own.
function draftFrom(trip, today) {
  if (trip) return { place: trip.place, fromISO: trip.fromISO, toISO: trip.toISO, events: trip.events.map(e => ({ ...e })), max: trip.max, auto: null };
  return { place: null, fromISO: shiftISO(today, 1), toISO: shiftISO(today, 4), events: [], max: DEFAULT_MAX, auto: today };
}
// The form's draft. Default dates follow today (the device's until the
// forecast says the place's), so a page left open overnight still offers
// tomorrow.
function draft() {
  const today = todayISO();
  const d = (ui.draft ??= draftFrom(savedTrip(), today));
  if (d.auto && d.auto !== today) {
    Object.assign(d, { fromISO: shiftISO(today, 1), toISO: shiftISO(today, 4), auto: today });
    d.events = d.events.filter(e => e.dateISO >= d.fromISO && e.dateISO <= d.toISO);
  }
  return d;
}

const sameDates = (a, b) => Boolean(a && b) && samePlace(a.place, b.place) && a.fromISO === b.fromISO && a.toISO === b.toISO;

// A packed trip's plan, packed again only when the trip or the bottles
// change, with a ranked context per window for the bottle pages it opens.
let memo = null; // { trip, frags, result, contexts }
let queued = null; // { trip, frags } to pack once the page has painted

function packNow(trip, frags = rankedFragrances()) {
  if (memo?.trip === trip && memo.frags === frags) return memo.result;
  const events = trip.events.map(e => ({ ...e, occasion: occasionById(e.occasion) }));
  const result = packTrip(frags, withEvents(trip.windows, events), { max: trip.max });
  const contexts = result.plan.map(p => [ctxKey(p.window), p.window, p.occasion, rank(frags, p.window, p.window.slot, { occasion: p.occasion, todayISO: p.window.dateISO })]);
  memo = { trip, frags, result, contexts };
  return result;
}

// The plan for the pane: at once when it's done or cheap; else null, and it
// packs after a frame (the page paints first, so a tap answers at once) and
// draws the pane again.
function packFor(trip, app) {
  const frags = rankedFragrances();
  if ((memo?.trip === trip && memo.frags === frags) || !app || frags.length * trip.windows.length <= INLINE_WORK) return packNow(trip, frags);
  if (queued?.trip !== trip || queued.frags !== frags) {
    const job = (queued = { trip, frags });
    requestAnimationFrame(() => setTimeout(() => {
      if (queued !== job) return;
      queued = null;
      packNow(trip, frags);
      if (onTrip() && ui.saved === trip) repaint(app);
    }));
  }
  return null;
}

export const tripHeading = () => (savedTrip() ? `Packing for ${savedTrip().place.name}` : 'Pack for a trip');

export function renderTrip(app = null) {
  const trip = savedTrip();
  const today = todayISO();
  const form = (packedAlready, editing) => tripFormHTML(draft(), { today, busy: ui.busy, error: ui.error, adding: ui.adding, editing, packed: packedAlready, startedOn: trip?.fromISO });
  if (!trip) return form(false, false) + (ui.busy ? skeleton() : '');
  const head = ui.editing ? form(true, true) : tripSummaryHTML(trip, { today, note: ui.note, updating: ui.updating });
  if (ui.busy) return head + skeleton();
  // Packing again (another bottle count, a new rating): the last plan for
  // the same place and dates stays, dimmed, until the new one is in.
  const result = packFor(trip, app);
  const shown = result ?? (sameDates(memo?.trip, trip) ? memo.result : null);
  if (!shown) return head + skeleton('Planning what to pack…');
  for (const [key, win, occasion, ranked] of memo.contexts) storeContext(key, win, occasion, ranked);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  return `${head}
    <div class="trip-out${result ? '' : ' refreshing'}"${result ? '' : ' aria-busy="true"'}>${tripPackHTML(shown, trip, { canShare })}${tripPlanHTML(shown, { today })}</div>`;
}

// An event filled in but not added yet counts: Plan adds it first. One
// event a window: a new one replaces what was there.
function commitAdding() {
  const e = ui.adding;
  if (!e) return;
  const d = draft();
  d.events = [...d.events.filter(x => !(x.dateISO === e.dateISO && x.slot === e.slot)), { ...e }]
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO) || (a.slot === 'day' ? -1 : 1));
  ui.adding = null;
}

// The weather for a trip's dates: fetched from today on, with the saved
// trip's own windows for the days gone by when it's the same place (the
// forecast has none for them; another place gets typical weather there).
async function windowsFor(ask, old, today) {
  const start = later(ask.fromISO, today);
  const kept = old && samePlace(old.place, ask.place) ? old.windows.filter(w => w.dateISO >= ask.fromISO && w.dateISO < start) : [];
  const fresh = await tripWindows(ask.place, start > ask.fromISO && !kept.length ? ask.fromISO : start, ask.toISO);
  return fresh.length ? [...kept, ...fresh].sort(byTime) : [];
}

// A smooth scroll, unless motion is reduced (an explicit 'smooth' overrides
// base.css's reduced-motion rule).
const scrolling = () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');

// The plan button, back in view (clear of the tab bar) with focus on it.
function focusSubmit() {
  const btn = document.querySelector('.trip-form [type="submit"]');
  btn?.focus({ preventScroll: true });
  btn?.scrollIntoView({ block: 'center', behavior: scrolling() });
}

// The weather for a new place or dates, then the plan. Only the events or
// the bottle count changed: packs again from the saved weather. The draft
// is read once, before the fetch, so what's saved is what was asked.
let packSeq = 0;
async function pack(app) {
  if (ui.busy) return;
  commitAdding();
  const d = draft();
  const today = todayISO();
  const old = savedTrip();
  ui.error = checkTrip(d, today, old);
  if (ui.error) {
    app.renderPage();
    return focusSubmit();
  }
  // Events outside the dates drop out.
  const events = d.events.filter(e => e.dateISO >= d.fromISO && e.dateISO <= d.toISO).map(e => ({ ...e }));
  const ask = { place: d.place, fromISO: d.fromISO, toISO: d.toISO, events, max: d.max };
  if (sameDates(old, ask)) return finish(app, { ...old, ...ask });
  const mine = ++packSeq;
  ui.busy = true;
  app.renderPage();
  const sk = document.querySelector('#trip-sk');
  sk?.focus({ preventScroll: true });
  sk?.scrollIntoView({ block: 'nearest', behavior: scrolling() });
  try {
    const windows = await windowsFor(ask, old, today);
    if (mine !== packSeq) return;
    if (!windows.length) throw Object.assign(new Error('no windows'), { status: 'empty' });
    finish(app, { ...ask, windows, fetchedAt: Date.now() });
  } catch (err) {
    if (mine !== packSeq) return;
    ui.busy = false;
    ui.error = err.status === 'empty' ? 'No weather came back for those dates. Try again.' : forecastError(err);
    if (!onTrip()) return;
    app.renderPage();
    focusSubmit();
  }
}

const onTrip = () => state.route?.dest === 'wear' && state.route.pane === 'trip';

function finish(app, trip) {
  saveTrip(trip);
  Object.assign(ui, { saved: trip, busy: false, editing: false, adding: null, error: '', note: '', draft: draftFrom(trip, todayISO()) });
  if (!onTrip()) return;
  app.renderPage();
  // The plan's head takes focus, so a screen reader hears where it went.
  const head = document.querySelector('#trip-title');
  head?.focus({ preventScroll: true });
  head?.closest('.trip-head').scrollIntoView({ block: 'nearest' });
}

// When that refresh fails: the plan stands on the weather saved, on the
// device's date it was saved (not UTC's, a day ahead by evening in the Americas).
export const staleNote = fetchedAt => `Couldn’t update the weather, so this plan uses what was saved ${shortDate(deviceToday(new Date(fetchedAt)))}.`;

// A saved trip's weather, hours old, fetched again while it shows (from
// today on: the days gone by keep theirs).
export async function freshenTrip(app) {
  const trip = savedTrip();
  const today = todayISO();
  if (!trip || ui.busy || ui.updating || trip.toISO < today || Date.now() - trip.fetchedAt < REFRESH_AFTER || ui.refreshed === trip.fetchedAt) return;
  ui.refreshed = trip.fetchedAt;
  ui.updating = true;
  repaint(app);
  try {
    const windows = await windowsFor(trip, trip, today);
    // A new bottle count meanwhile keeps the new weather; new dates don't.
    if (windows.length && sameDates(ui.saved, trip)) {
      ui.saved = { ...ui.saved, windows, fetchedAt: Date.now() };
      saveTrip(ui.saved);
      ui.note = '';
    }
  } catch {
    ui.note = staleNote(trip.fetchedAt);
  }
  ui.updating = false;
  if (onTrip()) repaint(app);
}

onPlace('trip', place => {
  draft().place = place;
  ui.error = '';
});

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers, or no permission: the hidden-field way.
    const field = Object.assign(document.createElement('textarea'), { value: text, readOnly: true });
    field.style.cssText = 'position:fixed;opacity:0';
    document.body.append(field);
    field.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch {}
    field.remove();
    return ok;
  }
}

// Moving the start keeps the trip's length; events outside the dates drop
// out, and one being added moves to a day still to come.
function setDates(fromISO, toISO) {
  const d = draft();
  Object.assign(d, { fromISO, toISO, auto: null });
  d.events = d.events.filter(e => e.dateISO >= fromISO && e.dateISO <= toISO);
  const first = later(fromISO, todayISO());
  if (ui.adding && first > toISO) ui.adding = null;
  else if (ui.adding && (ui.adding.dateISO < first || ui.adding.dateISO > toISO)) ui.adding.dateISO = first;
  ui.error = '';
}

export const actions = {
  'trip-place'(el, app) {
    app.openSheet({ kind: 'wear-place', for: 'trip' });
  },
  'trip-edit'(el, app) {
    ui.editing = true;
    ui.draft = draftFrom(savedTrip(), todayISO());
    app.renderPage();
    document.querySelector('.trip-form [data-action="trip-place"]')?.focus();
  },
  'trip-cancel'(el, app) {
    Object.assign(ui, { editing: false, adding: null, error: '', draft: draftFrom(savedTrip(), todayISO()) });
    app.renderPage();
    document.querySelector('[data-action="trip-edit"]')?.focus();
  },
  // The bottle count: in the form it waits for the plan button; on a packed
  // trip it packs again at once (no network: the weather is saved).
  'trip-max'(el, app) {
    const max = +el.dataset.value;
    if (!BOTTLE_CHOICES.includes(max)) return;
    draft().max = max;
    const trip = savedTrip();
    if (trip && !el.closest('.trip-form')) {
      ui.saved = { ...trip, max };
      saveTrip(ui.saved);
    }
    app.keepingFocus(el, '#app', app.renderPage);
  },
  // A new event starts on the first free night still to come.
  'trip-ev-add'(el, app) {
    const d = draft();
    const days = datesOf(d).filter(iso => iso >= todayISO());
    if (!days.length) return;
    const taken = new Set(d.events.map(e => `${e.dateISO}:${e.slot}`));
    const free = days.find(iso => !taken.has(`${iso}:night`)) ?? days[0];
    ui.adding = { dateISO: free, slot: 'night', occasion: 'formal' };
    app.renderPage();
    document.querySelector('[data-field="trip-ev-date"]')?.focus();
  },
  'trip-ev-slot'(el, app) {
    if (!ui.adding) return;
    ui.adding.slot = el.dataset.value === 'day' ? 'day' : 'night';
    app.keepingFocus(el, '#app', app.renderPage);
  },
  'trip-ev-save'(el, app) {
    if (!ui.adding) return;
    commitAdding();
    app.renderPage();
    document.querySelector('[data-action="trip-ev-add"]')?.focus();
  },
  'trip-ev-cancel'(el, app) {
    ui.adding = null;
    app.renderPage();
    document.querySelector('[data-action="trip-ev-add"]')?.focus();
  },
  'trip-ev-remove'(el, app) {
    const d = draft();
    d.events = d.events.filter((_, i) => i !== +el.dataset.value);
    app.renderPage();
    (document.querySelector(`[data-action="trip-ev-remove"][data-value="${Math.max(0, +el.dataset.value - 1)}"]`)
      ?? document.querySelector('[data-action="trip-ev-add"]'))?.focus();
  },
  async 'trip-copy'(el, app) {
    const trip = savedTrip();
    if (!trip) return;
    const ok = await copyText(packingText(packNow(trip), trip, { today: todayISO() }));
    app.showToast(ok ? '<span>Packing list copied</span>' : '<span class="note">This browser won’t let the page copy. Try Share instead.</span>');
  },
  async 'trip-share'(el, app) {
    const trip = savedTrip();
    if (!trip) return;
    try {
      await navigator.share({ title: `Packing for ${trip.place.name}`, text: packingText(packNow(trip), trip, { today: todayISO() }) });
    } catch (err) {
      if (err?.name !== 'AbortError') app.showToast('<span>Couldn’t open sharing. Copy the list instead.</span>');
    }
  },
};

export const forms = {
  'trip-pack': (data, app) => pack(app),
};

export const changes = {
  'trip-from'(el, app) {
    const d = draft();
    if (!el.value) return;
    const length = d.fromISO && d.toISO && d.toISO >= d.fromISO ? daysBetween(d.fromISO, d.toISO) : 3;
    setDates(el.value, shiftISO(el.value, length));
    repaint(app);
  },
  'trip-to'(el, app) {
    const d = draft();
    if (!el.value) return;
    setDates(d.fromISO && d.fromISO <= el.value ? d.fromISO : el.value, el.value);
    repaint(app);
  },
  'trip-ev-date'(el) {
    if (ui.adding) ui.adding.dateISO = el.value;
  },
  'trip-ev-occ'(el) {
    if (ui.adding && occasionById(el.value)) ui.adding.occasion = el.value;
  },
};
