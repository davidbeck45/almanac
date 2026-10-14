// "How you wear": how often someone dresses for each occasion, which weights
// the gap finder's cells (src/gaps.js). Each occasion is Never, Sometimes or
// Often against USES' default share; Daily picks always count. Saved on the
// device; the journal's occasion counts can refine it once wears record one.
import { USES, useLabel } from './gaps.js';
import { occasionById } from './occasions.js';

const KEY = 'scentcast.uses';
// A setting's multiple of the use's default share, before renormalizing.
export const LEVELS = { never: 0, sometimes: 1, often: 2.5 };
export const DEFAULT_LEVEL = 'sometimes';
// Journal counts blend in as (prior share × PRIOR_WEARS + count) / (PRIOR_WEARS + all counts).
const PRIOR_WEARS = 20;

/** { [use id]: 'never' | 'sometimes' | 'often' }, Sometimes where unset. */
export function loadUses() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY)); } catch {}
  return cleanUses(saved);
}

export function saveUses(settings) {
  try { localStorage.setItem(KEY, JSON.stringify(cleanUses(settings))); } catch {}
}

// Known uses and levels only; Daily is always on.
function cleanUses(settings) {
  return Object.fromEntries(USES.map(u => {
    const level = settings?.[u.id];
    return [u.id, u.id !== 'daily' && Object.hasOwn(LEVELS, level) ? level : DEFAULT_LEVEL];
  }));
}

/**
 * Settings (and optional journal counts: { [use id]: wears }) -> each use's
 * share of wears, summing to 1. A use set to Never stays at 0 whatever the
 * journal says.
 */
export function sharesFrom(settings = {}, counts = null) {
  const clean = cleanUses(settings);
  const raw = Object.fromEntries(USES.map(u => [u.id, u.share * LEVELS[clean[u.id]]]));
  const total = Object.values(raw).reduce((a, b) => a + b, 0);
  const prior = Object.fromEntries(USES.map(u => [u.id, raw[u.id] / total]));
  const n = counts ? USES.reduce((sum, u) => sum + (prior[u.id] ? counts[u.id] ?? 0 : 0), 0) : 0;
  if (!n) return prior;
  return Object.fromEntries(USES.map(u => [u.id,
    prior[u.id] ? (prior[u.id] * PRIOR_WEARS + (counts[u.id] ?? 0)) / (PRIOR_WEARS + n) : 0]));
}

const squash = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

// A use by its id, its name, or a name its occasion had before ("everyday").
const useNamed = name => USES.find(u => [u.id, useLabel(u), ...(u.occasion ? occasionById(u.occasion).aliases ?? [] : [])]
  .some(n => squash(n) === squash(name)));

/**
 * "office=often,formal=never" (the CLI's --uses) -> settings; unknown names
 * or levels throw, and so does Daily, which always counts.
 */
export function parseUses(text) {
  const out = {};
  const occasions = USES.filter(u => u.id !== 'daily').map(u => u.id).join(', ');
  for (const part of text.split(',').map(s => s.trim()).filter(Boolean)) {
    const [name = '', level] = part.split('=').map(s => s.trim().toLowerCase());
    const use = useNamed(name);
    if (!use) throw new Error(`Unknown use "${name}". Pick from: ${occasions}`);
    if (use.id === 'daily') throw new Error(`Daily picks always count; set the occasions (${occasions})`);
    if (!Object.hasOwn(LEVELS, level)) throw new Error(`"${part}": the level is never, sometimes or often`);
    out[use.id] = level;
  }
  return out;
}
