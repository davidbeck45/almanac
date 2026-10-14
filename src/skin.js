// Your own take on a bottle, kept on this device: a star rating and how it
// wears on your skin against the crowd's votes (longevity and sillage: -1
// shorter or quieter, 0 as voted, 1 longer or louder). Reviews are other
// people's skin and climate; the engine leans on yours (quality and
// performanceLevel read `personal`, see applySkin).
const KEY = 'scentcast.skin';
const NUDGES = ['longevity', 'sillage'];

const today = () => new Date().toISOString().slice(0, 10);

// One entry, cleaned: stars 1–5 or null, nudges -1, 0 or 1.
function clean(entry) {
  const rating = Number.isInteger(entry?.rating) && entry.rating >= 1 && entry.rating <= 5 ? entry.rating : null;
  const out = { rating };
  for (const key of NUDGES) out[key] = [-1, 0, 1].includes(entry?.[key]) ? entry[key] : 0;
  if (entry?.updated) out.updated = String(entry.updated);
  return out;
}

const isBlank = e => e.rating === null && NUDGES.every(k => !e[k]);

/** { id: { rating, longevity, sillage, updated } } for every bottle with one. */
export function loadSkin() {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY)) ?? {};
    return Object.fromEntries(Object.entries(stored).map(([id, e]) => [String(id), clean(e)]).filter(([, e]) => !isBlank(e)));
  } catch {
    return {};
  }
}

export function saveSkin(skin) {
  try { localStorage.setItem(KEY, JSON.stringify(skin)); } catch {}
}

/**
 * The map with one bottle's entry changed (pure): `patch` sets any of rating,
 * longevity, sillage. An entry back to "as voted" with no stars drops out.
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

/**
 * Records with your entry attached as `personal` ({ rating, longevity,
 * sillage }); the rest come back as they were. New objects for the ones that
 * change, so nothing cached on the old record carries over.
 */
export function applySkin(records, skin) {
  if (!skin || !Object.keys(skin).length) return records;
  return records.map(r => {
    const e = skin[String(r.id)];
    if (!e) return r;
    const { rating, longevity, sillage } = clean(e);
    return { ...r, personal: { rating, longevity, sillage } };
  });
}
