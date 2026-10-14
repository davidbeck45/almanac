// How alike two bottles smell, for gap fillers, "More like this" and the buy
// check. A bottle is two sparse unit vectors: its accords (Fragrantica's
// strength, barStrength of the bar width) and its notes (by how strongly
// voters smell each). Likeness is a cosine on each, mostly accords. Pure (no
// DOM, no fetch), so a module Worker can run it over the whole pool.
//
// Checks on the pool: Liquid Brun and Althaïr (its original) 0.92,
// Club de Nuit Intense Man and Aventus 0.78, Atlantis Extrait and Liquid Brun
// 0.12. Similarity misses some voted dupes (Supremacy Collector's Edition and
// Absolu Aventus 0.31), which the "smells like" links in src/candidates.js
// catch.
import { barStrength, accordNoun } from './accords.js';

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
  const share = x.share ?? y.share ?? ACCORD_SHARE;
  return share * acc + (1 - share) * notes;
}

const norm = map => Math.sqrt([...map.values()].reduce((s, v) => s + v * v, 0));

/**
 * The (weighted) mean direction of several bottles: what they share, as one
 * vector. When some have notes and some don't (a hand-entered bottle beside
 * a dataset one), a bottle without notes counts its accords in their place,
 * as similarity() reads it, and the vector carries the accords' `share`, so
 * likeness to it ranks as the mean likeness to each: the notes of the one
 * with notes don't outweigh the other.
 */
export function centroid(items, weights = null) {
  const acc = new Map(), notes = new Map(), names = new Map();
  const vecs = items.map(scentVector);
  const mixed = vecs.some(v => v.notes.size) && vecs.some(v => !v.notes.size);
  vecs.forEach((v, i) => {
    const w = weights?.[i] ?? 1;
    // Mixed: accords count ACCORD_SHARE, and all of it for a bottle without notes.
    const wa = mixed ? w * (v.notes.size ? ACCORD_SHARE : 1) : w, wn = mixed ? w * (1 - ACCORD_SHARE) : w;
    for (const [k, x] of v.acc) acc.set(k, (acc.get(k) ?? 0) + wa * x);
    for (const [k, x] of v.notes) notes.set(k, (notes.get(k) ?? 0) + wn * x);
    for (const [k, name] of v.names) if (!names.has(k)) names.set(k, name);
  });
  if (!mixed) return { acc: unit(acc), notes: unit(notes), names };
  const [a, n] = [norm(acc), norm(notes)];
  return { acc: unit(acc), notes: unit(notes), names, share: a / ((a + n) || 1) };
}

// A note folds into the one-word accord its last word names ("Bourbon
// Vanilla" into vanilla, "White Musk" into musky, "Guaiac Wood" into woody),
// unless that word only names a kind ("Green Notes", "Violet Leaf").
const KINDS = new Set('notes note leaf leaves tree trees flower flowers blossom blossoms'.split(' '));
// An adjective's or a plural's ending off: "aldehydic" and "aldehydes", "musky" and "musk" meet.
const stem = word => word.replace(/(?:ic|es|[eys])+$/, '');
// What a name says, for leaving out one that adds nothing to a name already
// listed ("fresh" beside "fresh spicy", "woody notes" beside "woody").
const sayings = name => new Set(noteKey(name).split(' ').filter(w => w !== 'notes').map(stem));
const within = (a, b) => [...a].every(w => b.has(w));

/**
 * The strongest accords and notes two bottles share, by name, lowercase, for
 * copy like "shares vanilla, praline and musk". A shared note names the
 * accord it folds into; a name that only repeats one listed before it is left
 * out. Accords come as nouns, as the engine's reasons name them ("warm
 * spice", "woods": accordNoun).
 */
export function sharedTraits(a, b, n = 4) {
  const x = scentVector(a), y = scentVector(b);
  const items = [], accords = new Map(); // one-word accord stem -> its item
  for (const [k, w] of x.acc) {
    if (!y.acc.has(k)) continue;
    const item = { name: k.toLowerCase(), weight: ACCORD_SHARE * w * y.acc.get(k), note: 0, accord: true };
    items.push(item);
    if (!item.name.includes(' ')) accords.set(stem(noteKey(item.name)), item);
  }
  for (const [k, w] of x.notes) {
    if (!y.notes.has(k)) continue;
    const name = (x.names.get(k) ?? y.names.get(k) ?? k).toLowerCase(), weight = (1 - ACCORD_SHARE) * w * y.notes.get(k);
    const head = k.split(' ').pop(), accord = KINDS.has(head) ? null : accords.get(stem(head));
    if (!accord) items.push({ name, weight, note: weight });
    else {
      accord.weight += weight;
      if (weight > accord.note) [accord.name, accord.note, accord.accord] = [name, weight, false];
    }
  }
  const shown = [];
  for (const { name, accord } of items.sort((p, q) => q.weight - p.weight)) {
    const says = sayings(name);
    if (!says.size || shown.some(s => within(says, s.says) || within(s.says, says))) continue;
    shown.push({ name: accord ? accordNoun(name) : name, says });
    if (shown.length === n) break;
  }
  return shown.map(s => s.name);
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
