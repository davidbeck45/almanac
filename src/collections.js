// Which bottles the app ranks.
// - 'demo': David's Fragrantica wardrobe (data/collection.json).
// - 'mine': a list the viewer builds by searching or entering bottles by hand.
//   Full records are stored with it, so it works offline and never spends
//   another lookup.
// A share link (?c=id,id&n=Name) opens someone's list as a temporary view.
import { isCustomId, shareToken } from './custom.js';

const MINE_KEY = 'scentcast.mine';
const ACTIVE_KEY = 'scentcast.active';
const MAX_SHARED = 80;
const MAX_IMPORT_LINES = 15;

const isObject = x => Boolean(x) && typeof x === 'object' && !Array.isArray(x);

/**
 * Whether a stored record has what ranking reads: an id, a name, accords,
 * season and day/night shares. Mine and the want list keep only these, so
 * a record stored in another shape is left out rather than breaking a screen.
 */
export const usableRecord = r => isObject(r) && (typeof r.id === 'string' ? r.id !== '' : Number.isFinite(r.id))
  && typeof r.name === 'string' && isObject(r.accords) && Object.keys(r.accords).length > 0
  && isObject(r.season) && isObject(r.dayNight);

export function loadMine() {
  try {
    const mine = JSON.parse(localStorage.getItem(MINE_KEY));
    const records = Array.isArray(mine?.records) ? mine.records.filter(usableRecord) : [];
    return {
      name: typeof mine?.name === 'string' ? mine.name : '',
      records: records.map(r => (typeof r.id === 'string' ? r : { ...r, id: String(r.id) })),
    };
  } catch {
    return { name: '', records: [] };
  }
}

export function saveMine(mine) {
  try { localStorage.setItem(MINE_KEY, JSON.stringify(mine)); } catch {}
}

export function loadActive() {
  try { return localStorage.getItem(ACTIVE_KEY) === 'mine' ? 'mine' : 'demo'; } catch { return 'demo'; }
}

export function saveActive(active) {
  try { localStorage.setItem(ACTIVE_KEY, active); } catch {}
}

export function shareURL(records, name) {
  // Built by hand so ids read cleanly (commas and colons unescaped).
  const ids = records.map(r => encodeURIComponent(isCustomId(r.id) ? shareToken(r) : r.id).replace(/%3A/gi, ':')).join(',');
  const suffix = name ? `&n=${encodeURIComponent(name)}` : '';
  return `${location.origin}${location.pathname}?c=${ids}${suffix}`;
}

export function parseShare(params) {
  const raw = params.get('c');
  if (!raw) return null;
  const ids = [...new Set(raw.split(',').map(s => s.trim()).filter(Boolean))].slice(0, MAX_SHARED);
  return ids.length ? { ids, name: params.get('n')?.trim().slice(0, 40) || null } : null;
}

export const normalize = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Offline matches against a list of records, e.g. the demo catalog.
export function localMatches(query, records, limit = 5) {
  const words = normalize(query).split(' ').filter(w => w.length > 1);
  if (!words.length) return [];
  return records.filter(r => {
    const hay = normalize(`${r.name} ${r.brand}`);
    return words.every(w => hay.includes(w));
  }).slice(0, limit);
}

// Whether a search hit is plausibly the bottle someone typed: every word of its
// name was typed (a plural counts). Online search is fuzzy and returns its
// nearest guess even for bottles it doesn't have ("Caramello" for "Caramellino").
export function nameMatches(query, record) {
  const typed = normalize(query).split(' ');
  const words = normalize(record.name).split(' ').filter(w => w.length > 1);
  return words.length > 0 && words.every(w => typed.some(t => t === w || t === `${w}s`));
}

// Same bottle from two sources ("Sauvage · Dior" vs "Sauvage · Christian Dior").
export function sameBottle(a, b) {
  if (normalize(a.name) !== normalize(b.name)) return false;
  const [x, y] = [normalize(a.brand), normalize(b.brand)];
  return x.includes(y) || y.includes(x);
}

// "1. Pear Pavlova by French Cowboy 50ml"
//   -> { line: 'Pear Pavlova French Cowboy', name: 'Pear Pavlova', brand: 'French Cowboy' }
// `line` is the search query; name and brand prefill a bottle entered by hand.
export function importLines(text) {
  const tidy = s => s.replace(/\s+/g, ' ').trim();
  return text.split(/\r?\n/)
    .map(l => tidy(l.replace(/^\s*(?:[-*•·]|\d+[.)])\s*/, '').replace(/\b\d+(?:[.,]\d+)?\s?(?:ml|oz)\b/gi, '')))
    .filter(l => l.length >= 3)
    .slice(0, MAX_IMPORT_LINES)
    .map(l => {
      // Only "by" says which side is the brand ("Dior - Sauvage" could go either way).
      const [name, brand = ''] = l.split(/\s+by\s+/i);
      const line = tidy(l.replace(/\s+(?:-|–|—|by)\s+/gi, ' '));
      return { line, name: brand ? name : line, brand };
    });
}

export { MAX_IMPORT_LINES };
