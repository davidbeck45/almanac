// Your own take on a bottle, kept on this device: a star rating and how it
// wears on your skin against the crowd's votes (longevity and sillage: -1
// shorter or quieter, 0 as voted, 1 longer or louder). Reviews are other
// people's skin and climate; the engine leans on yours (quality and
// performanceLevel read `personal`, see applySkin). And a note in your own
// words (where it came from, how it smells to you), which only its page reads.
const KEY = 'scentcast.skin';
const NUDGES = ['longevity', 'sillage'];
/** A bottle's note at its longest, in characters. */
export const MAX_BOTTLE_NOTE = 280;

/** A note as one is kept: one paragraph, trimmed to MAX_BOTTLE_NOTE; '' for none. */
export const noteText = raw => (typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, MAX_BOTTLE_NOTE).trim() : '');

// The device's date, as the journal keeps it (not UTC's, a day ahead by evening).
const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// One entry, cleaned: stars 1–5 or null, nudges -1, 0 or 1, and its note
// when it has one. Numbers can come as the strings a form or select hands
// over ("5", "-1"); blanks mean none.
function clean(entry) {
  const num = x => (x === '' || x == null ? NaN : Number(x));
  const stars = num(entry?.rating);
  const rating = Number.isInteger(stars) && stars >= 1 && stars <= 5 ? stars : null;
  const out = { rating };
  for (const key of NUDGES) out[key] = [-1, 0, 1].includes(num(entry?.[key])) ? num(entry[key]) : 0;
  const note = noteText(entry?.note);
  if (note) out.note = note;
  if (entry?.updated) out.updated = String(entry.updated);
  return out;
}

/** Whether an entry says how the bottle rates or wears (stars, or a nudge): what picks read. A note alone doesn't. */
export const hasRating = e => Boolean(e) && (Number.isFinite(e.rating) || NUDGES.some(k => Boolean(e[k])));

const isBlank = e => !hasRating(e) && !e.note;

const isMap = x => Boolean(x) && typeof x === 'object' && !Array.isArray(x);

/** A map of entries as the device keeps one (a stored one, a backup's): string ids, each cleaned, blanks left out. */
export const tidySkin = stored => (isMap(stored)
  ? Object.fromEntries(Object.entries(stored).map(([id, e]) => [String(id), clean(e)]).filter(([, e]) => !isBlank(e))) : {});

/** { id: { rating, longevity, sillage, updated } } for every bottle with one. */
export function loadSkin() {
  try {
    return tidySkin(JSON.parse(localStorage.getItem(KEY)));
  } catch {
    return {};
  }
}

export function saveSkin(skin) {
  try { localStorage.setItem(KEY, JSON.stringify(skin)); } catch {}
}

// The saved entries as stored, for telling cheaply whether they changed
// (src/app/state.js caches the ranked records on it); '' without any.
export function skinStamp() {
  try { return localStorage.getItem(KEY) ?? ''; } catch { return ''; }
}

/**
 * A file's entries merged into a device's (pure), the device's own winning
 * where both have one: its rating (stars and nudges go together, since "as
 * voted" beside stars is an answer too) and its note, each on its own, so a
 * bottle only noted here still takes the file's stars.
 */
export function mergeSkin(file, device) {
  const out = { ...file };
  for (const [id, mine] of Object.entries(device)) {
    const theirs = file[id];
    if (!theirs) { out[id] = mine; continue; }
    const rated = hasRating(mine) ? mine : theirs;
    const note = mine.note || theirs.note;
    out[id] = clean({ rating: rated.rating, longevity: rated.longevity, sillage: rated.sillage, note, updated: mine.updated ?? theirs.updated });
  }
  return out;
}

/**
 * The map with one bottle's entry changed (pure): `patch` sets any of rating,
 * longevity, sillage, note. An entry back to "as voted" with no stars and no
 * note drops out.
 */
export function withSkin(skin, id, patch, nowISO = today()) {
  const key = String(id);
  const entry = clean({ ...skin[key], ...patch, updated: nowISO });
  const next = { ...skin };
  if (isBlank(entry)) delete next[key];
  else next[key] = entry;
  return next;
}

/** Changes one bottle's entry and saves; returns the new map. */
export function setSkin(id, patch, nowISO = today()) {
  const next = withSkin(loadSkin(), id, patch, nowISO);
  saveSkin(next);
  return next;
}

// What Now has asked about each bottle, once (src/views/wear.js): its stars
// once it's worn, and how it wore the day after. { id: { stars, skin } },
// each the date it was answered or waved off; asked never comes back.
const ASKED_KEY = 'scentcast.asked';
export const ASKS = ['stars', 'skin'];

/** A map of what was asked as the device keeps one (a stored one, a backup's). */
export function tidyAsked(stored) {
  if (!isMap(stored)) return {};
  const out = {};
  for (const [id, e] of Object.entries(stored)) {
    const kept = Object.fromEntries(ASKS.filter(k => typeof e?.[k] === 'string').map(k => [k, e[k]]));
    if (Object.keys(kept).length) out[String(id)] = kept;
  }
  return out;
}

export function loadAsked() {
  try {
    return tidyAsked(JSON.parse(localStorage.getItem(ASKED_KEY)));
  } catch {
    return {};
  }
}

export function saveAsked(asked) {
  try { localStorage.setItem(ASKED_KEY, JSON.stringify(asked)); } catch {}
}

/** Whether Now has asked `kind` ('stars' or 'skin') about a bottle. */
export const wasAsked = (asked, id, kind) => Boolean(asked[String(id)]?.[kind]);

/** Notes that Now asked `kind` about a bottle (answered or waved off) and saves; returns the new map. */
export function markAsked(id, kind, nowISO = today()) {
  const asked = loadAsked();
  const key = String(id);
  const next = { ...asked, [key]: { ...asked[key], [kind]: nowISO } };
  try { localStorage.setItem(ASKED_KEY, JSON.stringify(next)); } catch {}
  return next;
}

/**
 * Records with your entry attached as `personal` ({ rating, longevity,
 * sillage }); the rest come back as they were, a bottle with only a note
 * among them (picks don't read it). New objects for the ones that change, so
 * nothing cached on the old record carries over.
 */
export function applySkin(records, skin) {
  if (!skin || !Object.keys(skin).length) return records;
  return records.map(r => {
    const e = skin[String(r.id)];
    if (!e) return r;
    const { rating, longevity, sillage } = clean(e);
    if (!hasRating({ rating, longevity, sillage })) return r;
    return { ...r, personal: { rating, longevity, sillage } };
  });
}
