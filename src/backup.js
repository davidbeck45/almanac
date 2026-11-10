// The device as a file, and back. Everything someone adds lives in this
// browser's localStorage, so Export's file (the journal, src/history.js
// journalExport) carries the rest of it beside the journal's own keys, and
// Settings › Wear journal reads one back (src/views/settings.js).
//
// A backup is a journal file with `version: 2` and, beside what a journal
// has (wears, place, `hidden` as the demo reads it, ratings, plans):
//   hiding  { hidden, shown }: this device's own hides and the defaults it
//           switched back on (src/hidden.js), which `hidden` runs together
//   asked   what Now has asked about each bottle (src/skin.js)
//   wants   the want list (src/wishlist.js)
//   mine    { name, records } (src/collections.js) and `active`, the list ranked
//   uses    "How you wear" (src/uses.js), null when never set
//   prefs   units, theme, liked styles, prefer great value, the still sky
//           and the occasion last picked (src/app/state.js)
//   trip    the saved trip's place, dates, events and count, without its
//           weather (src/views/wear/trip.js); carried, not yet restored
// The CLI, journal-check and the widget read it as any journal (parseJournal
// skips these keys). Files from before (version 1) restore what they hold.
//
// Restoring is one of two things. Add brings in what this device lacks and
// keeps its own wherever both have one: a wear for a window it has nothing
// logged in, a rating for a bottle it hasn't rated, a plan for a window not
// planned, a want or a bottle of Mine it doesn't have. Replace swaps this
// device's for the file's, store by store, for the stores the file carries.
// mergeBackup is pure; restoreBackup reads each store as it's stored now,
// merges and saves, so another open tab's changes are never saved over.
import { parseJournal, isJournalToken, loadHistory, saveHistory, MAX_ENTRIES } from './history.js';
import { loadSkin, saveSkin, tidySkin, loadAsked, saveAsked, tidyAsked } from './skin.js';
import { loadEvents, saveEvents, tidyEvents } from './events.js';
import { loadHidden, saveHidden, DEFAULT_HIDDEN } from './hidden.js';
import { loadWants, saveWants, tidyWants } from './wishlist.js';
import { loadMine, saveMine, usableRecord } from './collections.js';
import { plural, shortDate } from './ui.js';

export const BACKUP_VERSION = 2;
const KEYS = { prefs: 'scentcast.prefs', uses: 'scentcast.uses', trip: 'scentcast.trip', active: 'scentcast.active' };
const LEVELS = ['never', 'sometimes', 'often'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const isMap = x => Boolean(x) && typeof x === 'object' && !Array.isArray(x);
const ids = list => (Array.isArray(list) ? [...new Set(list.filter(x => typeof x === 'string' || Number.isFinite(x)).map(String))] : []);
const readJSON = key => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
const writeJSON = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
// The device's date, `days` from today (not UTC's, a day ahead by evening).
const deviceDay = (days = 0, d = new Date(Date.now() + days * 86_400_000)) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// ---------- Each store, tidied ----------

// The prefs worth carrying, each only in a shape the app reads.
function tidyPrefs(prefs) {
  if (!isMap(prefs)) return {};
  const out = {};
  if (prefs.units === 'F' || prefs.units === 'C') out.units = prefs.units;
  if (typeof prefs.theme === 'string' && prefs.theme) out.theme = prefs.theme;
  if (typeof prefs.occasion === 'string' && prefs.occasion) out.occasion = prefs.occasion;
  if (typeof prefs.preferValue === 'boolean') out.preferValue = prefs.preferValue;
  if (Array.isArray(prefs.likedStyles)) out.likedStyles = prefs.likedStyles.filter(s => typeof s === 'string');
  if (prefs.stillSky === true) out.stillSky = true;
  return out;
}

// "How you wear" as stored: a level for each use set; null when there's none.
function tidyUses(uses) {
  if (!isMap(uses)) return null;
  const kept = Object.fromEntries(Object.entries(uses).filter(([, level]) => LEVELS.includes(level)));
  return Object.keys(kept).length ? kept : null;
}

// A trip's inputs: where, when, what for and how many bottles. No weather.
function tidyTrip(trip) {
  if (!isMap(trip) || !Number.isFinite(trip.place?.lat) || !Number.isFinite(trip.place?.lon)) return null;
  if (![trip.fromISO, trip.toISO].every(d => typeof d === 'string' && ISO_DATE.test(d))) return null;
  const { name, region, lat, lon, timezone } = trip.place;
  return {
    place: { name: String(name ?? 'Trip'), region: String(region ?? ''), lat, lon, ...(typeof timezone === 'string' && { timezone }) },
    fromISO: trip.fromISO,
    toISO: trip.toISO,
    events: (Array.isArray(trip.events) ? trip.events : []).filter(e => isMap(e) && ISO_DATE.test(e.dateISO ?? '') && typeof e.occasion === 'string')
      .map(({ dateISO, slot, occasion }) => ({ dateISO, slot, occasion })),
    ...(Number.isInteger(trip.max) && { max: trip.max }),
  };
}

function tidyMine(mine) {
  const records = Array.isArray(mine?.records) ? mine.records.filter(usableRecord).map(r => (typeof r.id === 'string' ? r : { ...r, id: String(r.id) })) : [];
  const seen = new Set();
  return { name: typeof mine?.name === 'string' ? mine.name : '', records: records.filter(r => !seen.has(r.id) && seen.add(r.id)) };
}

const tidyActive = active => (active === 'mine' || active === 'demo' ? active : null);

// Newest first, as the log is kept: a date's night before its day.
const byNewest = (a, b) => b.date.localeCompare(a.date) || (a.slot === b.slot ? 0 : a.slot === 'night' ? -1 : 1);
const windowOf = h => `${h.date}:${h.slot}`;

// ---------- Export ----------

/** What this device holds beside the journal, as backupExport takes it. */
export function deviceStores() {
  const { hidden, shown } = loadHidden();
  let active = null;
  try { active = tidyActive(localStorage.getItem(KEYS.active)); } catch {}
  return {
    hiding: { hidden: [...hidden], shown: [...shown] },
    asked: loadAsked(),
    wants: loadWants(),
    mine: loadMine(),
    active,
    uses: tidyUses(readJSON(KEYS.uses)),
    prefs: tidyPrefs(readJSON(KEYS.prefs)),
    trip: tidyTrip(readJSON(KEYS.trip)),
  };
}

/**
 * A journal file (journalExport's) as a backup: the same keys, read the same
 * by everything that reads a journal, with the rest of the device beside
 * them (deviceStores()) for Restore.
 */
export function backupExport(journal, stores = {}) {
  return {
    ...journal,
    version: BACKUP_VERSION,
    hiding: { hidden: ids(stores.hiding?.hidden), shown: ids(stores.hiding?.shown) },
    asked: tidyAsked(stores.asked),
    wants: tidyWants(stores.wants),
    mine: tidyMine(stores.mine),
    active: tidyActive(stores.active),
    uses: tidyUses(stores.uses),
    prefs: tidyPrefs(stores.prefs),
    trip: tidyTrip(stores.trip),
  };
}

// ---------- Reading a file ----------

const NOTHING = 'Nothing on this device changed.';

/**
 * The text of a file chosen to restore, as a backup: every store tidied,
 * with `carries`, the stores the file holds (Replace swaps only those: a
 * file from before wants were carried leaves this device's alone). Throws an
 * Error whose message is a sentence for the user.
 */
export function readBackup(text) {
  const raw = String(text ?? '').trim();
  if (isJournalToken(raw)) {
    throw new Error(`That’s a Copy for Claude, which holds only the last ten days for Claude’s picks. Choose the file that Export saved. ${NOTHING}`);
  }
  let data = null;
  try {
    data = JSON.parse(raw);
  } catch {
    // An export that stops partway still starts as one.
    const cut = raw.startsWith('{') && raw.includes('scentcast-journal');
    throw new Error(cut ? `That file is cut short or garbled, so it can’t be read. Export it again and choose the new file. ${NOTHING}`
      : `That file isn’t an Almanac export. Choose the almanac-journal file that Export saved. ${NOTHING}`);
  }
  const journal = parseJournal(data);
  if (!journal) throw new Error(`That file isn’t an Almanac export. Choose the almanac-journal file that Export saved. ${NOTHING}`);
  const whole = Number(data.version) >= BACKUP_VERSION;
  // Before the split, `hidden` ran the defaults together with the device's
  // own: a default in it was still hidden, one missing had been switched on.
  const hiding = isMap(data.hiding) ? { hidden: ids(data.hiding.hidden), shown: ids(data.hiding.shown) }
    : { hidden: journal.hidden.filter(id => !DEFAULT_HIDDEN.includes(id)), shown: DEFAULT_HIDDEN.filter(id => !journal.hidden.includes(id)) };
  const has = key => whole || key in data;
  return {
    version: Number(data.version) || 1,
    exported: typeof data.exported === 'string' ? data.exported : null,
    history: [...journal.history].sort(byNewest),
    skin: tidySkin(journal.skin),
    events: journal.events,
    hiding,
    asked: tidyAsked(data.asked),
    wants: tidyWants(data.wants),
    mine: tidyMine(data.mine),
    active: tidyActive(data.active),
    uses: tidyUses(data.uses),
    prefs: tidyPrefs(data.prefs),
    trip: tidyTrip(data.trip),
    carries: ['history', 'hiding', ...['skin', 'events', 'asked', 'wants', 'mine', 'active', 'uses', 'prefs'].filter(has)],
  };
}

// "Jan 3", with its year when the two ends fall in different ones.
const dayText = (iso, withYear) => `${shortDate(iso)}${withYear ? `, ${iso.slice(0, 4)}` : ''}`;

// What a backup holds, as counts: plans still ahead of `fromISO`, the
// file's own hides (not the demo's defaults).
function holds(backup, fromISO) {
  return {
    wears: backup.history.length,
    ratings: Object.keys(backup.skin).length,
    hidden: backup.hiding.hidden.length,
    plans: tidyEvents(backup.events, fromISO).length,
    wants: backup.wants.length,
    mine: backup.mine.records.length,
  };
}

const partsOf = ({ ratings, hidden, plans, wants, mine }) => [
  ratings && plural(ratings, 'rating'),
  hidden && `${plural(hidden, 'bottle')} switched off`,
  plans && plural(plans, 'plan'),
  wants && plural(wants, 'want'),
  mine && `Mine: ${plural(mine, 'bottle')}`,
].filter(Boolean);

/** Whether a backup has nothing to restore. */
export const backupEmpty = (backup, { fromISO = deviceDay(-1) } = {}) => Object.values(holds(backup, fromISO)).every(n => !n);

/**
 * What's in a backup, before anything changes: "212 wears from Jan 3 to
 * Nov 9, 14 ratings, 3 bottles switched off, 2 plans, 5 wants, Mine: 12
 * bottles." Plans count from `fromISO` on (the device's yesterday), as the
 * app keeps them.
 */
export function backupSummary(backup, { fromISO = deviceDay(-1) } = {}) {
  const n = holds(backup, fromISO);
  const first = backup.history.at(-1)?.date, last = backup.history[0]?.date;
  const years = Boolean(first) && first.slice(0, 4) !== last.slice(0, 4);
  const wears = !n.wears ? 'No wears' : first === last ? `${plural(n.wears, 'wear')} on ${dayText(first, false)}`
    : `${plural(n.wears, 'wear')} from ${dayText(first, years)} to ${dayText(last, years)}`;
  return `${[wears, ...partsOf(n)].join(', ')}.`;
}

// ---------- Merging ----------

const listOf = items => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

// Two want lists, newest first, as one: by the date each was added, this
// device's ahead of the file's on a day both have.
function mergeWants(mine, theirs) {
  const have = new Set(mine.map(w => w.id));
  const extra = theirs.filter(w => !have.has(w.id));
  const out = [];
  let i = 0, j = 0;
  while (i < mine.length || j < extra.length) {
    const own = j >= extra.length || (i < mine.length && mine[i].added >= extra[j].added);
    out.push(own ? mine[i++] : extra[j++]);
  }
  return { wants: out, added: extra.length };
}

/**
 * A device's stores with a backup restored into them (pure): -> { stores,
 * counts }. `device`: { history, skin, asked, events, hiding: { hidden,
 * shown } as lists, wants, mine, active (null: never chosen), uses (null:
 * never set), prefs (as stored) }. `mode` 'add' keeps the device's wherever
 * both have one; 'replace' takes the file's for every store it carries.
 * `counts`: for 'add', what came in (wears, ratings, hidden, plans, wants,
 * mine) and `kept`, the windows where both logged a different bottle and the
 * device's stayed; for 'replace', what the device now holds. Plans before
 * `fromISO` drop out, as the app drops them.
 */
export function mergeBackup(device, backup, { mode = 'add', fromISO = deviceDay(-1) } = {}) {
  const carried = key => backup.carries.includes(key);
  if (mode === 'replace') {
    const stores = {
      history: backup.history.slice(0, MAX_ENTRIES),
      hiding: backup.hiding,
      skin: carried('skin') ? backup.skin : device.skin,
      events: carried('events') ? tidyEvents(backup.events, fromISO) : device.events,
      asked: carried('asked') ? backup.asked : device.asked,
      wants: carried('wants') ? backup.wants : device.wants,
      mine: carried('mine') ? backup.mine : device.mine,
      active: carried('active') && backup.active ? backup.active : device.active,
      uses: carried('uses') && backup.uses ? backup.uses : device.uses,
      prefs: { ...device.prefs, ...(carried('prefs') && backup.prefs) },
    };
    return { stores, counts: { ...holds({ ...backup, history: stores.history }, fromISO), kept: 0 } };
  }
  const logged = new Map(device.history.map(h => [windowOf(h), h]));
  const fresh = backup.history.filter(h => !logged.has(windowOf(h)));
  const history = [...device.history, ...fresh].sort(byNewest).slice(0, MAX_ENTRIES);
  const stays = new Set(history);
  const skin = { ...backup.skin, ...device.skin };
  const planned = new Set(device.events.map(e => `${e.dateISO}:${e.slot}`));
  const plans = tidyEvents(backup.events, fromISO).filter(e => !planned.has(`${e.dateISO}:${e.slot}`));
  const off = backup.hiding.hidden.filter(id => !device.hiding.hidden.includes(id));
  const { wants, added: wanted } = mergeWants(device.wants, backup.wants);
  const owned = new Set(device.mine.records.map(r => r.id));
  const bottles = backup.mine.records.filter(r => !owned.has(r.id));
  const asked = { ...backup.asked };
  for (const [id, e] of Object.entries(device.asked)) asked[id] = { ...asked[id], ...e };
  const stores = {
    history,
    skin,
    asked,
    events: tidyEvents([...device.events, ...plans], fromISO),
    hiding: { hidden: [...device.hiding.hidden, ...off], shown: [...new Set([...device.hiding.shown, ...backup.hiding.shown])] },
    wants,
    mine: { name: device.mine.name || backup.mine.name, records: [...device.mine.records, ...bottles] },
    active: device.active ?? backup.active,
    uses: device.uses ?? backup.uses,
    // A pref stored as null is one never chosen: the file's stands in.
    prefs: { ...backup.prefs, ...Object.fromEntries(Object.entries(device.prefs).filter(([, v]) => v != null)) },
  };
  return {
    stores,
    counts: {
      wears: fresh.filter(h => stays.has(h)).length,
      kept: backup.history.filter(h => logged.has(windowOf(h)) && logged.get(windowOf(h)).id !== h.id).length,
      ratings: Object.keys(backup.skin).filter(id => !(id in device.skin)).length,
      hidden: off.length,
      plans: plans.length,
      wants: wanted,
      mine: bottles.length,
    },
  };
}

/**
 * What a restore did, in a sentence or two: "Added 174 wears and 9 ratings.
 * 12 windows kept this device’s wear."
 */
export function restoreText(counts, mode = 'add') {
  if (mode === 'replace') {
    const wears = counts.wears ? plural(counts.wears, 'wear') : 'no wears';
    return `Replaced what was on this device with the file’s: ${[wears, ...partsOf(counts)].join(', ')}.`;
  }
  const added = [
    counts.wears && plural(counts.wears, 'wear'),
    counts.ratings && plural(counts.ratings, 'rating'),
    counts.plans && plural(counts.plans, 'plan'),
    counts.wants && plural(counts.wants, 'want'),
    counts.mine && `${plural(counts.mine, 'bottle')} to Mine`,
  ].filter(Boolean);
  const said = [
    added.length ? `Added ${listOf(added)}.` : !counts.hidden && 'Nothing to add: this device already has everything in that file.',
    counts.hidden && `Switched off ${plural(counts.hidden, 'bottle')}.`,
    counts.kept && `${plural(counts.kept, 'window')} kept this device’s wear.`,
  ];
  return said.filter(Boolean).join(' ');
}

// ---------- Restoring ----------

/**
 * Restores a backup (readBackup's) into this device: each store read as it's
 * stored now, merged (mergeBackup) and saved. -> { counts, stores }. The
 * caller reads the state again (reloadStored) and draws; other open tabs
 * hear the saves as storage events.
 */
export function restoreBackup(backup, mode = 'add', { fromISO = deviceDay(-1) } = {}) {
  const { hidden, shown } = loadHidden();
  let active = null;
  try { active = tidyActive(localStorage.getItem(KEYS.active)); } catch {}
  const prefs = readJSON(KEYS.prefs);
  const device = {
    history: loadHistory(),
    skin: loadSkin(),
    asked: loadAsked(),
    events: loadEvents(fromISO),
    hiding: { hidden: [...hidden], shown: [...shown] },
    wants: loadWants(),
    mine: loadMine(),
    active,
    uses: tidyUses(readJSON(KEYS.uses)),
    prefs: isMap(prefs) ? prefs : {},
  };
  const { stores, counts } = mergeBackup(device, backup, { mode, fromISO });
  saveHistory(stores.history);
  saveSkin(stores.skin);
  saveAsked(stores.asked);
  saveEvents(stores.events, fromISO);
  saveHidden({ hidden: new Set(stores.hiding.hidden), shown: new Set(stores.hiding.shown) });
  saveWants(stores.wants);
  saveMine(stores.mine);
  if (stores.active && stores.active !== device.active) { try { localStorage.setItem(KEYS.active, stores.active); } catch {} }
  if (stores.uses && stores.uses !== device.uses) writeJSON(KEYS.uses, stores.uses);
  if (JSON.stringify(stores.prefs) !== JSON.stringify(device.prefs)) writeJSON(KEYS.prefs, stores.prefs);
  return { counts, stores, activeBefore: device.active };
}
