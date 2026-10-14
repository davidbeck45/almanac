// The want list: bottles someone means to try or buy, kept on this device
// next to "mine" (src/collections.js). Each entry is { id, added (date ISO),
// note?, record? }, newest first. A dataset bottle keeps only its id and
// loads from r/ (or the pool) like a share link's; any other (hand-entered,
// a catalog or demo bottle newer than the dataset) keeps its full record, as
// "mine" does, so it works offline and never needs another lookup.
const KEY = 'scentcast.want';
const MAX_WANTS = 200;
const MAX_NOTE = 140;

// Today on this device's calendar.
const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// One stored entry, tidied: string id, a date, a short note, a record when kept.
function entry(raw) {
  const id = raw?.id ?? raw?.record?.id;
  if (id == null || id === '') return null;
  const out = { id: String(id), added: typeof raw.added === 'string' ? raw.added : today() };
  const note = typeof raw.note === 'string' ? raw.note.trim().slice(0, MAX_NOTE) : '';
  if (note) out.note = note;
  if (raw.record && typeof raw.record === 'object') out.record = { ...raw.record, id: String(id) };
  return out;
}

/** The stored want list, newest first ([] when there's none or it can't be read). */
export function loadWants() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(list) ? list.map(entry).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function saveWants(wants) {
  try { localStorage.setItem(KEY, JSON.stringify(wants.slice(0, MAX_WANTS))); } catch {}
}

/** Whether a record keeps itself in the list: anything the dataset can't load again by id. */
export const keepsRecord = record => record?.source !== 'fragrantica';

/**
 * The list with a bottle added on top (a record or an id): an id already in
 * it moves up and keeps its date and note unless new ones are given.
 * { note, added } as options.
 */
export function addWant(wants, bottle, { note, added } = {}) {
  const record = typeof bottle === 'object' ? bottle : null;
  const id = String(record ? record.id : bottle);
  const old = wants.find(w => w.id === id);
  const next = entry({
    id,
    added: added ?? old?.added ?? today(),
    note: note ?? old?.note,
    record: record && keepsRecord(record) ? record : old?.record,
  });
  return [next, ...wants.filter(w => w.id !== id)].slice(0, MAX_WANTS);
}

/** The list without a bottle. */
export const removeWant = (wants, id) => wants.filter(w => w.id !== String(id));

/** Whether a bottle is on the list. */
export const hasWant = (wants, id) => wants.some(w => w.id === String(id));

/** The list's ids that need loading (no record kept), for fragranticaLibrary().records. */
export const wantIdsToLoad = wants => wants.filter(w => !w.record).map(w => w.id);

/**
 * Add, remove or toggle and save in one go, as the UI does: -> the new list.
 * `want` true adds, false removes, undefined toggles.
 */
export function setWant(bottle, want, options = {}) {
  const wants = loadWants();
  const id = String(typeof bottle === 'object' ? bottle.id : bottle);
  const on = want ?? !hasWant(wants, id);
  const next = on ? addWant(wants, bottle, options) : removeWant(wants, id);
  saveWants(next);
  return next;
}
