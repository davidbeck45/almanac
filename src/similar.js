// How alike two bottles smell, for gap fillers, "More like this" and the buy
// check. A bottle is two sparse unit vectors: its accords (Fragrantica's
// strength, barStrength of the bar width) and its notes (by how strongly
// voters smell each). Likeness is a cosine on each, mostly accords. Pure (no
// DOM, no fetch), so a module Worker can run it over the whole pool.
//
// Checks on the dataset: Liquid Brun and Althaïr (its original) 0.9,
// Club de Nuit Intense Man and Aventus 0.8, Atlantis Extrait and Liquid Brun
// 0.1. Similarity misses some voted dupes (Supremacy Collector's Edition and
// Absolu Aventus about 0.35), which the "smells like" links in
// src/candidates.js catch.
import { barStrength } from './accords.js';

// Accords carry a bottle's character; notes tell near neighbours apart.
export const ACCORD_SHARE = 0.6;
// A note counts 0.25 + 0.75 × its votes over the top note's (NOTE_UNVOTED
// when nobody voted on it), and a top note 0.6 of that: the drydown is most
// of the wear. Only the strongest MAX_NOTES count, as many as the pool keeps,
// so an owned bottle's full pyramid compares with a pool row's on one footing.
const NOTE_FLOOR = 0.25;
const NOTE_UNVOTED = 0.5;
const TOP_NOTE = 0.6;
const MAX_NOTES = 8;

const noteKey = name => name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const vectors = new WeakMap();
const isVector = x => x?.acc instanceof Map;

function unit(map) {
  let s = 0;
  for (const v of map.values()) s += v * v;
  s = Math.sqrt(s) || 1;
  for (const [k, v] of map) map.set(k, v / s);
  return map;
}

function dot(a, b) {
  if (a.size > b.size) [a, b] = [b, a];
  let s = 0;
  for (const [k, v] of a) {
    const w = b.get(k);
    if (w) s += v * w;
  }
  return s;
}

/**
 * An engine record's scent as { acc, notes, names }: unit Maps of accord ->
 * weight and note key -> weight, and note key -> the note's name. Cached per
 * record object; a vector passes through.
 */
export function scentVector(record) {
  if (isVector(record)) return record;
  let v = vectors.get(record);
  if (v) return v;
  const acc = new Map(), accords = record.accords ?? {};
  for (const a in accords) {
    const s = barStrength(accords[a]);
    if (s > 0) acc.set(a, s);
  }
  const votes = record.noteVotes ?? {};
  let top = 1;
  for (const n in votes) if (votes[n] > top) top = votes[n];
  const weights = new Map(), names = new Map();
  for (const [tier, list] of Object.entries(record.notes ?? {})) {
    for (const name of list) {
      const key = noteKey(name);
      if (!key) continue;
      const w = (tier === 'top' ? TOP_NOTE : 1) * (votes[name] != null ? NOTE_FLOOR + (1 - NOTE_FLOOR) * votes[name] / top : NOTE_UNVOTED);
      if (w > (weights.get(key) ?? 0)) weights.set(key, w);
      if (!names.has(key)) names.set(key, name);
    }
  }
  const notes = weights.size > MAX_NOTES ? new Map([...weights].sort((a, b) => b[1] - a[1]).slice(0, MAX_NOTES)) : weights;
  v = { acc: unit(acc), notes: unit(notes), names };
  vectors.set(record, v);
  return v;
}

/**
 * 0..1, symmetric: ACCORD_SHARE × cosine of accords + the rest × cosine of
 * notes, accords alone when either has no notes (hand-entered bottles).
 * Takes records or vectors.
 */
export function similarity(a, b) {
  const x = scentVector(a), y = scentVector(b);
  const acc = dot(x.acc, y.acc);
  const notes = x.notes.size && y.notes.size ? dot(x.notes, y.notes) : acc;
  return ACCORD_SHARE * acc + (1 - ACCORD_SHARE) * notes;
}

/** The (weighted) mean direction of several bottles: what they share, as one vector. */
export function centroid(items, weights = null) {
  const acc = new Map(), notes = new Map(), names = new Map();
  items.forEach((item, i) => {
    const v = scentVector(item), w = weights?.[i] ?? 1;
    for (const [k, x] of v.acc) acc.set(k, (acc.get(k) ?? 0) + w * x);
    for (const [k, x] of v.notes) notes.set(k, (notes.get(k) ?? 0) + w * x);
    for (const [k, name] of v.names) if (!names.has(k)) names.set(k, name);
  });
  return { acc: unit(acc), notes: unit(notes), names };
}

// One thing by its last word: "musky" and "Musk", "Bourbon Vanilla" and
// "vanilla", "woody" and "Woods".
const thing = name => name.split(' ').pop().replace(/[eys]+$/, '');

/**
 * The strongest accords and notes two bottles share, by name, lowercase, for
 * copy like "shares vanilla, praline and musk". A shared note names the
 * thing over the accord it echoes. Accords come as Fragrantica names
 * ("warm spicy").
 */
export function sharedTraits(a, b, n = 4) {
  const x = scentVector(a), y = scentVector(b);
  const things = new Map(); // thing -> { weight, accord, note: [name, weight] }
  const offer = (name, weight, isNote) => {
    const key = thing(name);
    const t = things.get(key) ?? things.set(key, { weight: 0, accord: null, note: null }).get(key);
    t.weight += weight;
    if (!isNote) t.accord ??= name;
    else if (!t.note || weight > t.note[1]) t.note = [name, weight];
  };
  for (const [k, w] of x.acc) if (y.acc.has(k)) offer(k.toLowerCase(), ACCORD_SHARE * w * y.acc.get(k), false);
  for (const [k, w] of x.notes) {
    if (y.notes.has(k)) offer((x.names.get(k) ?? y.names.get(k) ?? k).toLowerCase(), (1 - ACCORD_SHARE) * w * y.notes.get(k), true);
  }
  return [...things.values()].sort((p, q) => q.weight - p.weight).slice(0, n).map(t => t.note?.[0] ?? t.accord);
}

/** The closest of `vecs` (records or vectors) to `vec`: { index, sim }, index -1 when there are none. */
export function nearestOf(vec, vecs) {
  let index = -1, sim = -1;
  vecs.forEach((v, i) => {
    const s = similarity(vec, v);
    if (s > sim) [index, sim] = [i, s];
  });
  return { index, sim: Math.max(0, sim) };
}
