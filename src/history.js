// Wear log: one entry per (date, slot), newest first. Feeds rotation, and
// (exported) shows how the engine's picks match what was actually worn, so
// it keeps a year and where each wear happened, to about a kilometer.
const KEY = 'scentcast.history';
const MAX_ENTRIES = 730;

export function loadHistory() {
  try {
    return (JSON.parse(localStorage.getItem(KEY)) ?? []).map(h => ({ ...h, id: String(h.id) }));
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
// logged for an occasion (the Occasion tab) keeps its id, for occasionCounts.
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
// so a check can rebuild what the app was choosing from, and your own
// ratings and skin nudges (src/skin.js's map) when there are any.
export function journalExport(history, loc, hidden, nowISO = new Date().toISOString(), skin = null) {
  return {
    app: 'scentcast-journal',
    version: 1,
    exported: nowISO,
    location: loc ? { name: loc.name ?? null, lat: round2(loc.lat), lon: round2(loc.lon) } : null,
    hidden: [...hidden].map(String),
    history,
    ...(skin && Object.keys(skin).length && { skin }),
  };
}

// A journal file read back (scripts/journal-check.mjs, recommend.mjs --journal),
// ids as strings like the app keeps them. Null when it isn't one. Files from
// before ratings were exported read with an empty `skin`.
export function parseJournal(data) {
  if (data?.app !== 'scentcast-journal' || !Array.isArray(data.history)) return null;
  const skin = data.skin && typeof data.skin === 'object' ? data.skin : {};
  return {
    location: data.location ?? null,
    hidden: (data.hidden ?? []).map(String),
    history: data.history.filter(h => h?.date && h.slot).map(h => ({ ...h, id: String(h.id) })),
    skin: Object.fromEntries(Object.entries(skin).map(([id, e]) => [String(id), e])),
  };
}

/**
 * Logged wears per use, for the gap finder's use shares: { daily, casual,
 * office, … } (only uses worn). A wear logged without an occasion (Today,
 * the Week, or before occasions were recorded) counts as daily; plans don't
 * count. `since` (YYYY-MM-DD) leaves out older wears.
 */
export function occasionCounts(history, since = null) {
  const counts = {};
  for (const h of history) {
    if (h.planned || (since && h.date < since)) continue;
    const use = h.occasion ?? 'daily';
    counts[use] = (counts[use] ?? 0) + 1;
  }
  return counts;
}

export function clearHistory() {
  save([]);
  return [];
}

const shiftISO = (iso, days) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

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
