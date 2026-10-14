// Doubles: bottles in one wardrobe that smell alike enough that owning both
// adds little (Wardrobe › Insights, recommend.mjs --doubles). A pair counts
// when the two are DOUBLE_SIM alike by accords and notes (src/similar.js),
// or voters tie them: one is the original the other copies, both copy one
// original, or Fragrantica's smells-like votes link one to the other or to
// its original (src/candidates.js signalsOf: `family` and `like`). Pure.
import { similarity, sharedTraits } from './similar.js';
import { signalsOf } from './candidates.js';

// Sauvage EDT and EDP are 0.80 alike, Liquid Brun and Althaïr 0.92: from
// 0.85 two bottles wear as one.
export const DOUBLE_SIM = 0.85;
// What ties a pair, strongest first.
const WHY = ['dupe', 'original', 'voters', 'alike'];

const idOf = r => (r ? String(r.id) : null);

// The ids voters tie a bottle to: its family and smells-like links.
function linksOf(record, byId) {
  const s = signalsOf(record, byId);
  return new Set([...s.family, ...s.like]);
}

/**
 * The wardrobe's doubles: { pairs: [{ a, b, sim, why, original, traits }],
 * closest: { a, b, sim, traits } | null }. `why`: 'dupe' (b is the original
 * a copies, or the other way round), 'original' (both copy `original`, its
 * name and id), 'voters' (a smells-like link either way, or to the other's
 * original), 'alike' (minSim or more by notes and accords). Pairs come in
 * that order, then most alike first; `closest` is the most alike pair of
 * all, for when none is a double. `traits`: what the two share (sharedTraits). byId: the pool, for
 * bottles that carry no signals of their own.
 */
export function doubles(owned, { byId = null, minSim = DOUBLE_SIM } = {}) {
  const links = owned.map(f => linksOf(f, byId));
  const pairs = [];
  let closest = null;
  for (let i = 0; i < owned.length; i++) {
    for (let j = i + 1; j < owned.length; j++) {
      const a = owned[i], b = owned[j], sim = similarity(a, b);
      const [ia, ib, oa, ob] = [idOf(a), idOf(b), idOf(a.original), idOf(b.original)];
      const why = oa === ib || ob === ia ? 'dupe'
        : oa && oa === ob ? 'original'
          : links[i].has(ib) || links[j].has(ia) || (ob && links[i].has(ob)) || (oa && links[j].has(oa)) ? 'voters'
            : sim >= minSim ? 'alike' : null;
      if (!closest || sim > closest.sim) closest = { a, b, sim };
      if (why) pairs.push({ a, b, sim, why, original: why === 'original' ? { id: oa, name: a.original.name } : null });
    }
  }
  const withTraits = p => p && { ...p, traits: sharedTraits(p.a, p.b, 3) };
  pairs.sort((p, q) => WHY.indexOf(p.why) - WHY.indexOf(q.why) || q.sim - p.sim);
  return { pairs: pairs.map(withTraits), closest: withTraits(closest) };
}
