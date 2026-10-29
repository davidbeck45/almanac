// Wear log: one entry per (date, slot), newest first. Feeds rotation, and
// (exported) shows how the engine's picks match what was actually worn, so
// it keeps a year and where each wear happened, to about a kilometer.
const KEY = 'scentcast.history';
const MAX_ENTRIES = 730;

// A wear as the log keeps one: a bottle, a real date and day or night.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isWear = h => Boolean(h) && typeof h === 'object' && h.id != null && h.id !== ''
  && typeof h.date === 'string' && ISO_DATE.test(h.date) && !Number.isNaN(Date.parse(h.date)) && (h.slot === 'day' || h.slot === 'night');
const wearsOf = list => (Array.isArray(list) ? list.filter(isWear).map(h => ({ ...h, id: String(h.id) })) : []);
// A planned event as src/events.js keeps one ({ dateISO, slot, occasion id });
// whether the app has the occasion is for the reader to check.
const isEvent = e => Boolean(e) && typeof e === 'object' && typeof e.dateISO === 'string' && ISO_DATE.test(e.dateISO)
  && !Number.isNaN(Date.parse(e.dateISO)) && (e.slot === 'day' || e.slot === 'night') && typeof e.occasion === 'string' && e.occasion !== '';
const eventsOf = list => (Array.isArray(list) ? list.filter(isEvent).map(({ dateISO, slot, occasion }) => ({ dateISO, slot, occasion })) : []);

// Entries stored in another shape (a date as a number, an unknown slot) are left out.
export function loadHistory() {
  try {
    return wearsOf(JSON.parse(localStorage.getItem(KEY)));
  } catch {
    return [];
  }
}

function save(history) {
  try { localStorage.setItem(KEY, JSON.stringify(history.slice(0, MAX_ENTRIES))); } catch {}
}

export function wornIn(history, dateISO, slot) {
  return history.find(h => h.date === dateISO && h.slot === slot) ?? null;
}

const round2 = x => Math.round(x * 100) / 100;

// Toggle: logging the same bottle again for the same slot clears it. A wear
// keeps the use it was logged for, for occasionCounts: an occasion id from
// the Occasion tab, 'daily' from Today and the Week.
export function toggleWear(id, dateISO, slot, where = null, occasion = null) {
  const history = loadHistory();
  const current = wornIn(history, dateISO, slot);
  const rest = history.filter(h => !(h.date === dateISO && h.slot === slot));
  const entry = {
    id, date: dateISO, slot,
    ...(where && { lat: round2(where.lat), lon: round2(where.lon) }),
    ...(occasion && { occasion: String(occasion) }),
  };
  const next = current?.id === id ? rest : [entry, ...rest];
  save(next);
  return next;
}

// The journal as a file: the wears, plus the device's place and hidden bottles
// so a check can rebuild what the app was choosing from, your own ratings
// and skin nudges (`skin`, src/skin.js's loadSkin()) and the days and nights
// planned for an occasion (`events`, src/events.js's loadEvents()) when
// there are any.
export function journalExport(history, loc, hidden, { nowISO = new Date().toISOString(), skin = null, events = [] } = {}) {
  const planned = eventsOf(events);
  return {
    app: 'scentcast-journal', // the app's name until October 2026: old and new exports read alike
    version: 1,
    exported: nowISO,
    location: loc ? { name: loc.name ?? null, lat: round2(loc.lat), lon: round2(loc.lon) } : null,
    hidden: [...hidden].map(String),
    history,
    ...(skin && Object.keys(skin).length && { skin }),
    ...(planned.length && { events: planned }),
  };
}

// A journal file read back (scripts/journal-check.mjs, recommend.mjs --journal),
// ids as strings like the app keeps them. Null when it isn't one. Files from
// before ratings were exported read with an empty `skin`. Wears without an
// ISO date and day or night, and a `hidden` that isn't a list, are left out.
// `counts` is a Copy for Claude's wears per use (occasionCounts over the
// whole log, which its wears are only part of); null from a file, whose
// wears are all there to count. `events` are the plans made in the app
// ({ dateISO, slot, occasion id }, [] from files made before they were
// carried), for a plan to put on its windows (src/events.js withStoredEvents).
export function parseJournal(data) {
  if (data?.app !== 'scentcast-journal' || !Array.isArray(data.history)) return null;
  const skin = data.skin && typeof data.skin === 'object' && !Array.isArray(data.skin) ? data.skin : {};
  const loc = data.location;
  const counts = data.counts && typeof data.counts === 'object' && !Array.isArray(data.counts)
    && Object.values(data.counts).every(n => Number.isInteger(n) && n >= 0) ? { ...data.counts } : null;
  return {
    location: loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lon) ? loc : null,
    hidden: Array.isArray(data.hidden) ? data.hidden.map(String) : [],
    history: wearsOf(data.history),
    skin: Object.fromEntries(Object.entries(skin).map(([id, e]) => [String(id), e])),
    counts,
    events: eventsOf(data.events),
  };
}

// ---------- Copy for Claude ----------
// A short token (Wardrobe › Worn's Copy for Claude) that carries what the
// CLI's and the Omarchy widget's plans read to agree with the app's:
// "scj1." then base64url of { t: the device's date, i: the bottle ids the
// rest point into, w: wears as [bottle, days before t, 0 day | 1 night,
// use?], h: switched-off bottles, s: stars and skin nudges as [bottle,
// stars or 0, longevity, sillage], c: wears per use, e: the days and nights
// planned for an occasion as [days after t, 0 day | 1 night, occasion id]
// }. A wear's use is left out for 'daily' and 0 when it was logged without
// one; readers from before `e` skip it. The wears are the
// last RECENT_DAYS days' (rotation), each other bottle's latest and the
// journal's first (the nudge counts idle days from them), so a plan reads
// them as it reads the whole log. No places: Claude and the widget are
// told where. Under a kilobyte for David's wardrobe, about 1.1 KB with every
// bottle rated.
const TOKEN = /^scj(\d+)\.([\w-]*)$/;
const TOKEN_VERSION = 1;
// How far back rotation reaches (ROTATION_PENALTY's length in src/engine.js).
export const RECENT_DAYS = 10;

const toBase64Url = s => btoa(String.fromCharCode(...new TextEncoder().encode(s)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64Url = s => new TextDecoder('utf-8', { fatal: true }).decode(
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)));
// Numeric ids (Fragrantica's) go as numbers, two characters shorter each.
const packId = id => (/^[1-9]\d{0,14}$/.test(id) ? Number(id) : id);

/** The Copy for Claude token for a log, the device's hidden bottles, its ratings (loadSkin()) and its plans (loadEvents()). */
export function journalToken(history, hidden = [], skin = {}, { todayISO, events = [] }) {
  const logged = wearsOf(history).filter(h => !h.planned)
    .sort((a, b) => b.date.localeCompare(a.date) || (a.slot === b.slot ? 0 : a.slot === 'night' ? -1 : 1));
  const since = shiftISO(todayISO, -(RECENT_DAYS - 1));
  const kept = logged.filter(h => h.date >= since);
  const seen = new Set(kept.map(h => h.id));
  for (const h of logged) if (!seen.has(h.id)) { seen.add(h.id); kept.push(h); }
  const first = logged.at(-1);
  if (first && !kept.includes(first)) kept.push(first);
  const ids = [], at = new Map();
  const ref = id => {
    const key = String(id);
    if (!at.has(key)) { at.set(key, ids.length); ids.push(packId(key)); }
    return at.get(key);
  };
  const w = kept.map(h => {
    const use = !h.occasion ? 0 : h.occasion === 'daily' ? undefined : String(h.occasion);
    return [ref(h.id), daysBetweenISO(h.date, todayISO), h.slot === 'night' ? 1 : 0, ...(use === undefined ? [] : [use])];
  });
  const h = [...hidden].map(ref);
  const s = Object.entries(skin ?? {}).map(([id, e]) => {
    const row = [ref(id), e.rating ?? 0, e.longevity ?? 0, e.sillage ?? 0];
    while (row.length > 2 && !row.at(-1)) row.pop();
    return row;
  });
  const e = eventsOf(events).map(ev => [daysBetweenISO(todayISO, ev.dateISO), ev.slot === 'night' ? 1 : 0, ev.occasion]);
  const body = { t: todayISO, i: ids, w, ...(h.length && { h }), ...(s.length && { s }), c: occasionCounts(logged), ...(e.length && { e }) };
  return `scj${TOKEN_VERSION}.${toBase64Url(JSON.stringify(body))}`;
}

// A token as pasted from a chat: quotes or a full stop around it aren't part of it.
const unwrap = text => String(text ?? '').trim().replace(/^[`'"“‘]+|[`'"”’.,;]+$/g, '');

/** Whether text reads as a Copy for Claude token (any version), not a file name. */
export const isJournalToken = text => /^scj\d+\./.test(unwrap(text));

/**
 * A Copy for Claude token as the journal file it stands for, for
 * parseJournal. Throws an Error whose message is a sentence for the user.
 */
export function journalFromToken(token) {
  const m = unwrap(token).match(TOKEN);
  if (m && Number(m[1]) > TOKEN_VERSION) throw new Error(`This Copy for Claude comes from a newer Almanac (scj${m[1]}) than this checkout reads; update it.`);
  const need = ok => {
    if (!ok) throw new Error('This Copy for Claude is cut short or garbled: copy it again from Wardrobe › Worn and paste it whole.');
  };
  need(m && Number(m[1]) === TOKEN_VERSION);
  let body = null;
  try { body = JSON.parse(fromBase64Url(m[2])); } catch {}
  const { t, i: ids, w = [], h = [], s = [], c = null, e = [] } = body ?? {};
  need(ISO_DATE.test(t ?? '') && !Number.isNaN(Date.parse(t)) && Array.isArray(ids) && ids.every(id => typeof id === 'string' || Number.isInteger(id)));
  need([w, h, s, e].every(Array.isArray));
  const bottle = k => {
    need(Number.isInteger(k) && k >= 0 && k < ids.length);
    return String(ids[k]);
  };
  const history = w.map(e => {
    need(Array.isArray(e) && Number.isInteger(e[1]) && [0, 1].includes(e[2]));
    const use = e.length < 4 ? 'daily' : e[3];
    need(use === 0 || typeof use === 'string');
    return { id: bottle(e[0]), date: shiftISO(t, -e[1]), slot: e[2] ? 'night' : 'day', ...(use && { occasion: use }) };
  });
  const skin = Object.fromEntries(s.map(e => {
    need(Array.isArray(e));
    const [k, rating = 0, longevity = 0, sillage = 0] = e;
    return [bottle(k), { rating: rating || null, longevity, sillage }];
  }));
  const events = e.map(ev => {
    need(Array.isArray(ev) && Number.isInteger(ev[0]) && [0, 1].includes(ev[1]) && typeof ev[2] === 'string');
    return { dateISO: shiftISO(t, ev[0]), slot: ev[1] ? 'night' : 'day', occasion: ev[2] };
  });
  return { app: 'scentcast-journal', version: 1, exported: t, location: null, hidden: h.map(bottle), history, skin, counts: c, events };
}

/**
 * A journal as given to the CLI or the widget: a Copy for Claude token, or
 * the text of a file holding an export or a token. parseJournal's shape, or
 * null when it's neither; a bad token throws with a sentence.
 */
export function readJournal(text) {
  if (isJournalToken(text)) return parseJournal(journalFromToken(text));
  try { return parseJournal(JSON.parse(text)); } catch { return null; }
}

/**
 * How current a journal's wears are on `todayISO`: the newest logged wear
 * on or before it, how many days ago that was, and how many wears fall in
 * the last RECENT_DAYS days (what rotation reads).
 */
export function journalFreshness(history, todayISO) {
  const logged = history.filter(h => !h.planned && h.date <= todayISO);
  const newest = logged.reduce((a, h) => (a === null || h.date > a ? h.date : a), null);
  const since = shiftISO(todayISO, -(RECENT_DAYS - 1));
  return { newest, daysAgo: newest && daysBetweenISO(newest, todayISO), recent: logged.filter(h => h.date >= since).length };
}

/**
 * Logged wears per use, for the gap finder's use shares: { daily, office,
 * date, …, untagged } (only keys worn). A wear logged without a use (before
 * wears recorded one) counts as `untagged`, not daily: a year of those would
 * swamp the shares. Plans don't count. `since` (YYYY-MM-DD) leaves out
 * older wears.
 */
export function occasionCounts(history, since = null) {
  const counts = {};
  for (const h of history) {
    if (h.planned || (since && h.date < since)) continue;
    const use = h.occasion ?? 'untagged';
    counts[use] = (counts[use] ?? 0) + 1;
  }
  return counts;
}

export function clearHistory() {
  save([]);
  return [];
}

const shiftISO = (iso, days) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const daysBetweenISO = (from, to) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

// Wear counts and last-worn dates for the journal. `days` is the look-back
// window for counts; last-worn dates cover the whole log.
export function journalStats(history, todayISO, days = 30) {
  const since = shiftISO(todayISO, -(days - 1));
  const counts = new Map();
  const lastWorn = new Map();
  let wears = 0;
  for (const h of history) {
    if (h.date > todayISO) continue;
    if (!lastWorn.has(h.id) || h.date > lastWorn.get(h.id)) lastWorn.set(h.id, h.date);
    if (h.date < since) continue;
    wears++;
    counts.set(h.id, (counts.get(h.id) ?? 0) + 1);
  }
  const top = [...counts].sort((a, b) => b[1] - a[1] || (lastWorn.get(b[0]) > lastWorn.get(a[0]) ? 1 : -1));
  return { wears, bottles: counts.size, top, lastWorn, since };
}

// The last `weeks` calendar weeks up to today, Sunday first:
// [[{ dateISO, day: entry|null, night: entry|null, future }...7], ...]
export function journalCalendar(history, todayISO, weeks = 5) {
  const weekday = new Date(`${todayISO}T12:00:00Z`).getUTCDay();
  const start = shiftISO(todayISO, -weekday - 7 * (weeks - 1));
  return Array.from({ length: weeks }, (_, w) => Array.from({ length: 7 }, (_, d) => {
    const dateISO = shiftISO(start, w * 7 + d);
    return {
      dateISO,
      future: dateISO > todayISO,
      day: wornIn(history, dateISO, 'day'),
      night: wornIn(history, dateISO, 'night'),
    };
  }));
}

export { shiftISO };
