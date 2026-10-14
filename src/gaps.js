// The wardrobe gap finder and the buy check: which situations a wardrobe
// covers poorly, the bottles that would fill them, and whether one bottle is
// worth buying. Pure (no DOM, no fetch), so a module Worker can run it
// (src/gaps-worker.js); the climate comes in as a summary (src/climate.js),
// how often each use comes up as shares (src/uses.js).
//
// A cell is a use (Daily picks or an occasion) × day or night × a feels-like
// band, weighted by how often it comes up: the use's share × its slot's share
// × how often that band comes up at the place. A bottle's fit in a cell is
// rank()'s score for it in that weather (scoreOf on the engine's own parts,
// averaged over a few real windows from the band, so calendar season and dew
// point come from real days). Owned bottles are measured against the
// suggestion pool's scores in the same cell.
import { seasonFit, timeFit, weatherFit, quality, occasionRaw, occasionPart, scoreOf, targetSeasonWeights } from './engine.js';
import { occasionById } from './occasions.js';
import { similarity, sharedTraits } from './similar.js';
import {
  signalsOf, genderLean, allowContext, allow, poolNorms, candidateQuality, valueSlope, preferValueDefault,
  familyIndex, ownedVectors, novelty, cheaperTwin, riskOf, PREFER_VALUE, FAMILY_MULT,
} from './candidates.js';

// Feels-like bands (°F, lower bound inclusive). Sticky versus dry heat is no
// band of its own: it comes in through the real windows' dew points.
export const BANDS = [
  { id: 'cold', lo: -Infinity, hi: 40 },
  { id: 'cool', lo: 40, hi: 58 },
  { id: 'mild', lo: 58, hi: 72 },
  { id: 'warm', lo: 72, hi: 84 },
  { id: 'hot', lo: 84, hi: Infinity },
];
export const bandOf = feelsF => BANDS.find(b => feelsF >= b.lo && feelsF < b.hi).id;
const SLOTS = ['day', 'night'];

// What a wardrobe is asked to do, and how often by default (shares of wears,
// summing to 1; "How you wear" in src/uses.js scales them). `slots` splits a
// use between day and night, and `bands` how often it comes up in that
// weather (cozy evenings are for the cold), renormalized within the use.
// occasion null is the Today tab's weather-only picks.
export const USES = [
  { id: 'daily', occasion: null, label: 'Daily', title: 'Daily picks', share: 0.40, slots: { day: 0.6, night: 0.4 } },
  { id: 'casual', occasion: 'casual', share: 0.08, slots: { day: 0.7, night: 0.3 } },
  { id: 'office', occasion: 'office', share: 0.15, slots: { day: 1 } },
  { id: 'date', occasion: 'date', share: 0.09, slots: { night: 1 } },
  { id: 'nightout', occasion: 'nightout', share: 0.07, slots: { night: 1 } },
  { id: 'formal', occasion: 'formal', share: 0.05, slots: { day: 0.4, night: 0.6 } },
  { id: 'outdoors', occasion: 'outdoors', share: 0.08, slots: { day: 1 }, bands: { cold: 0.3, cool: 0.7 } },
  { id: 'cozy', occasion: 'cozy', share: 0.08, slots: { night: 1 }, bands: { mild: 0.6, warm: 0.2, hot: 0.05 } },
];
const useById = id => USES.find(u => u.id === id);
/** A use's name ("Daily", "Date Night"), as the occasion's label. */
export const useLabel = use => use.label ?? occasionById(use.occasion).label;
const useTitle = use => use.title ?? useLabel(use);

// Real windows kept per slot × band. 4 changed the best bottle in 6 of 55
// cells against 8; 6 or more hold steady.
export const PER_CELL = 6;

// The ten temperate cities behind SEASON_CLIMATE, three years of day and
// night windows, PER_CELL per slot × band: the climate without a place.
// Written by `node scripts/fit-gaps.mjs --write`.
export const DEFAULT_CLIMATE = {"day:cold":{"share":0.229,"wins":[{"dateISO":"2025-12-16","feelsF":17.4,"dewF":16.6,"lat":41},{"dateISO":"2023-01-07","feelsF":25.5,"dewF":23.4,"lat":44},{"dateISO":"2025-12-02","feelsF":29.8,"dewF":33.8,"lat":53},{"dateISO":"2024-11-10","feelsF":33.3,"dewF":33.2,"lat":52},{"dateISO":"2025-11-23","feelsF":36.2,"dewF":35.5,"lat":44},{"dateISO":"2025-01-20","feelsF":38.8,"dewF":39.2,"lat":40}]},"day:cool":{"share":0.305,"wins":[{"dateISO":"2023-03-27","feelsF":41.7,"dewF":29.9,"lat":52},{"dateISO":"2025-10-15","feelsF":44.7,"dewF":37.3,"lat":52},{"dateISO":"2025-09-25","feelsF":47.6,"dewF":38.8,"lat":53},{"dateISO":"2024-10-11","feelsF":50.4,"dewF":43,"lat":49},{"dateISO":"2024-02-04","feelsF":53.3,"dewF":44.7,"lat":42},{"dateISO":"2023-03-25","feelsF":56.3,"dewF":39.1,"lat":40}]},"day:mild":{"share":0.223,"wins":[{"dateISO":"2025-05-20","feelsF":59.2,"dewF":41.3,"lat":41},{"dateISO":"2023-10-30","feelsF":61.8,"dewF":57.6,"lat":41},{"dateISO":"2023-04-15","feelsF":64.1,"dewF":50.7,"lat":44},{"dateISO":"2024-08-20","feelsF":66.3,"dewF":53.3,"lat":52},{"dateISO":"2024-10-30","feelsF":68.6,"dewF":58.1,"lat":42},{"dateISO":"2025-07-26","feelsF":70.9,"dewF":56.3,"lat":52}]},"day:warm":{"share":0.154,"wins":[{"dateISO":"2023-08-13","feelsF":72.9,"dewF":58.1,"lat":44},{"dateISO":"2023-08-17","feelsF":74.6,"dewF":63.3,"lat":44},{"dateISO":"2025-08-03","feelsF":76.5,"dewF":58.8,"lat":42},{"dateISO":"2023-09-29","feelsF":78.5,"dewF":49.6,"lat":40},{"dateISO":"2025-06-26","feelsF":80.7,"dewF":60.4,"lat":41},{"dateISO":"2025-09-05","feelsF":82.8,"dewF":65.2,"lat":52}]},"day:hot":{"share":0.088,"wins":[{"dateISO":"2025-06-29","feelsF":84.6,"dewF":61.2,"lat":49},{"dateISO":"2025-08-09","feelsF":86.2,"dewF":66,"lat":44},{"dateISO":"2025-07-02","feelsF":88.1,"dewF":70,"lat":41},{"dateISO":"2025-08-11","feelsF":90.2,"dewF":66.8,"lat":42},{"dateISO":"2024-06-17","feelsF":93.1,"dewF":66.6,"lat":42},{"dateISO":"2023-09-05","feelsF":97.1,"dewF":69.6,"lat":41}]},"night:cold":{"share":0.278,"wins":[{"dateISO":"2025-12-27","feelsF":16.7,"dewF":21.9,"lat":44},{"dateISO":"2023-01-24","feelsF":24.5,"dewF":28.2,"lat":42},{"dateISO":"2024-11-29","feelsF":28.8,"dewF":26,"lat":41},{"dateISO":"2024-01-11","feelsF":32.8,"dewF":29.4,"lat":41},{"dateISO":"2024-03-29","feelsF":36,"dewF":39,"lat":40},{"dateISO":"2023-11-02","feelsF":38.6,"dewF":42.8,"lat":52}]},"night:cool":{"share":0.325,"wins":[{"dateISO":"2024-03-17","feelsF":41.5,"dewF":30.3,"lat":41},{"dateISO":"2024-01-05","feelsF":44.3,"dewF":44.6,"lat":41},{"dateISO":"2024-11-07","feelsF":46.9,"dewF":47.2,"lat":52},{"dateISO":"2025-04-24","feelsF":49.8,"dewF":47.7,"lat":41},{"dateISO":"2023-03-23","feelsF":52.9,"dewF":50.1,"lat":42},{"dateISO":"2024-05-19","feelsF":56.3,"dewF":53.9,"lat":41}]},"night:mild":{"share":0.234,"wins":[{"dateISO":"2024-07-02","feelsF":59.2,"dewF":49,"lat":52},{"dateISO":"2024-05-31","feelsF":61.5,"dewF":45.6,"lat":41},{"dateISO":"2024-09-16","feelsF":63.7,"dewF":56.7,"lat":42},{"dateISO":"2024-09-12","feelsF":65.8,"dewF":61.7,"lat":42},{"dateISO":"2023-09-20","feelsF":68,"dewF":58.1,"lat":41},{"dateISO":"2025-08-13","feelsF":70.5,"dewF":61.9,"lat":52}]},"night:warm":{"share":0.124,"wins":[{"dateISO":"2025-09-19","feelsF":72.8,"dewF":57.5,"lat":41},{"dateISO":"2025-06-18","feelsF":74.2,"dewF":66.8,"lat":44},{"dateISO":"2025-08-26","feelsF":75.9,"dewF":56.6,"lat":49},{"dateISO":"2025-05-26","feelsF":77.6,"dewF":43.9,"lat":40},{"dateISO":"2024-06-30","feelsF":79.8,"dewF":66.5,"lat":42},{"dateISO":"2024-08-03","feelsF":82.2,"dewF":65.1,"lat":41}]},"night:hot":{"share":0.039,"wins":[{"dateISO":"2025-07-14","feelsF":84.5,"dewF":73.4,"lat":41},{"dateISO":"2025-08-13","feelsF":85.6,"dewF":72.8,"lat":41},{"dateISO":"2024-08-19","feelsF":86.7,"dewF":42.7,"lat":40},{"dateISO":"2025-07-24","feelsF":88,"dewF":66.9,"lat":41},{"dateISO":"2025-07-08","feelsF":89.6,"dewF":50.4,"lat":40},{"dateISO":"2025-06-22","feelsF":92.3,"dewF":74.9,"lat":44}]}};

const round = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;
const pct = x => `${Math.round(x * 100)}%`;
const list = words => (words.length <= 2 ? words.join(' and ') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`);

/**
 * Weather windows -> a small, serializable climate summary: per slot × band,
 * the share of that slot's windows in the band, and `perCell` real windows
 * spread over the band's range. About 4 KB as JSON.
 * windows: [{ dateISO, slot, feelsF, dewF, lat }] (a place's archive, src/climate.js).
 * -> { 'day:cold': { share, wins: [{ dateISO, feelsF, dewF, lat }] }, … }
 */
export function climateSummary(windows, { perCell = PER_CELL } = {}) {
  const out = {};
  for (const slot of SLOTS) {
    const inSlot = windows.filter(w => w.slot === slot && Number.isFinite(w.feelsF) && Number.isFinite(w.dewF));
    for (const band of BANDS) {
      const inBand = inSlot.filter(w => bandOf(w.feelsF) === band.id).sort((a, b) => a.feelsF - b.feelsF);
      const k = Math.min(perCell, inBand.length);
      const picked = Array.from({ length: k }, (_, i) => inBand[Math.floor(((i + 0.5) / k) * inBand.length)]);
      out[`${slot}:${band.id}`] = {
        share: inSlot.length ? round(inBand.length / inSlot.length, 3) : 0,
        wins: picked.map(w => ({ dateISO: w.dateISO, feelsF: round(w.feelsF), dewF: round(w.dewF), lat: Math.round(w.lat) })),
      };
    }
  }
  return out;
}

/**
 * A climate summary and use shares (src/uses.js sharesFrom; USES' defaults
 * without) -> the cells to score: { cells, slotBands }. A cell is { id
 * ('office:day:cold'), use, occasion (object or null), slot, band, weight, sb
 * (its slot:band) }; weights sum to 1, and a use with no share keeps its
 * cells at weight 0, so a pool table fits any shares. slotBands holds each
 * slot × band's share and windows as engine conditions.
 */
export function cellsFor(summary, { shares = null } = {}) {
  const slotBands = {};
  for (const [key, { share, wins }] of Object.entries(summary)) {
    const [slot, band] = key.split(':');
    slotBands[key] = {
      slot, band, share,
      wins: wins.map(w => {
        const date = new Date(`${w.dateISO}T12:00:00`);
        const cond = { dateISO: w.dateISO, date, lat: w.lat, feelsF: w.feelsF, dewF: w.dewF, category: 'clear' };
        return { cond, weights: targetSeasonWeights(w.feelsF, date, w.lat) };
      }),
    };
  }
  const shareOf = use => shares?.[use.id] ?? (shares ? 0 : use.share);
  const total = USES.reduce((sum, u) => sum + shareOf(u), 0) || 1;
  const cells = [];
  for (const use of USES) {
    const raw = [];
    for (const [slot, slotShare] of Object.entries(use.slots)) {
      for (const band of BANDS) {
        const sb = slotBands[`${slot}:${band.id}`];
        if (sb?.wins.length) raw.push({ slot, band: band.id, w: slotShare * sb.share * (use.bands?.[band.id] ?? 1) });
      }
    }
    const within = raw.reduce((sum, r) => sum + r.w, 0) || 1;
    for (const r of raw) {
      cells.push({
        id: `${use.id}:${r.slot}:${r.band}`,
        use: use.id,
        occasion: use.occasion ? occasionById(use.occasion) : null,
        slot: r.slot,
        band: r.band,
        weight: (shareOf(use) / total) * (r.w / within),
        sb: `${r.slot}:${r.band}`,
      });
    }
  }
  return { cells, slotBands };
}

const SLOT_WORD = { day: 'days', night: 'nights' };
const BAND_ORDER = Object.fromEntries(BANDS.map((b, i) => [b.id, i]));
// "cold", "cold and cool", "cold to mild"; "any" for all five.
const bandsText = bands => (bands.length === BANDS.length ? 'any' : bands.length > 2 ? `${bands[0]} to ${bands.at(-1)}` : list(bands));
const placeText = (slot, bands) => (bands.length === BANDS.length ? `any ${slot}` : `${bandsText(bands)} ${SLOT_WORD[slot]}`);

/** "Office on cold days", "Formal on cold and cool nights", "Date Night on any night". */
export function cellTitle(use, slot, bands) {
  const u = typeof use === 'string' ? useById(use) : use;
  return `${useTitle(u)} on ${placeText(slot, [].concat(bands))}`;
}
export const cellLabel = cell => cellTitle(cell.use, cell.slot, cell.band);

/**
 * A record as the gap finder scores owned bottles: without Parfumo's occasion
 * votes, which the pool's bottles lack, so owned and pool bottles stand on
 * the same evidence (a lucky vote doesn't read as coverage). Parfumo's
 * longevity and sillage stay: the pool has Fragrantica's, on the same scale.
 */
export function sameFooting(record) {
  if (!record.parfumo?.occasion) return record;
  const { occasion, occasionVotes, ...parfumo } = record.parfumo;
  return { ...record, parfumo };
}

/**
 * Every bottle's fit in every cell, row-major [bottle][cell]: rank()'s score
 * with no recent wears, averaged over the cell's windows. The score is linear
 * in the parts, so the season and weather fits are averaged per slot × band
 * and shared by every use, and occasionPart is worked out once per occasion.
 */
export function fitTable(bottles, { cells, slotBands }) {
  const m = cells.length, out = new Float32Array(bottles.length * m);
  const keys = [...new Set(cells.map(c => c.sb))];
  const occasions = [...new Set(cells.map(c => c.occasion).filter(Boolean))];
  const fit = new Map(), occ = new Map();
  bottles.forEach((b, i) => {
    const q = quality(b);
    const time = { day: timeFit(b, 'day'), night: timeFit(b, 'night') };
    for (const o of occasions) occ.set(o, occasionPart(occasionRaw(b, o), o));
    for (const k of keys) {
      const { wins } = slotBands[k];
      let season = 0, weather = 0;
      for (const w of wins) {
        season += seasonFit(b, w.weights);
        weather += weatherFit(b, w.cond);
      }
      fit.set(k, [season / wins.length, weather / wins.length]);
    }
    for (let j = 0; j < m; j++) {
      const c = cells[j], [season, weather] = fit.get(c.sb);
      const parts = { season, time: time[c.slot], weather, quality: q, occasion: c.occasion ? occ.get(c.occasion) : null };
      out[i * m + j] = scoreOf(parts, c.occasion);
    }
  });
  return out;
}

// The pool's table for a climate, kept for the last records and climate asked
// about (a wardrobe change, other shares or the value toggle reuse it).
let lastTable = null;
export function poolTable(records, summary, cc = cellsFor(summary)) {
  const key = JSON.stringify(summary);
  if (lastTable?.records !== records || lastTable.key !== key) lastTable = { records, key, table: fitTable(records, cc) };
  return lastTable.table;
}

const quantile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];

// What the best bottles reach in a cell: the mean of the reference's top
// TOP_N, about its 99.8th percentile (the single best was noise).
export const TOP_N = 20;
const TARGET = 101;

/**
 * Per cell, the reference bottles' scores at each percentile (0..100), with
 * the mean of their top TOP_N at index 101. `rows`: which of the table's
 * bottles make the reference (default all).
 */
export function poolReference(table, n, m, rows = null) {
  const pick = rows ?? Array.from({ length: n }, (_, i) => i);
  const col = new Float32Array(pick.length), ref = [];
  for (let j = 0; j < m; j++) {
    pick.forEach((i, r) => { col[r] = table[i * m + j]; });
    col.sort();
    const q = new Float32Array(102);
    for (let p = 0; p <= 100; p++) q[p] = quantile(col, p / 100);
    const top = Math.min(TOP_N, col.length);
    let sum = 0;
    for (let i = col.length - top; i < col.length; i++) sum += col[i];
    q[TARGET] = top ? sum / top : 0;
    ref.push(q);
  }
  return ref;
}
const percentileIn = (q, x) => {
  let p = 0;
  while (p < 100 && q[p + 1] <= x) p++;
  return p;
};

// A cell's shortfall: how far the wardrobe's best, and its second best for
// rotation (SECOND_WEIGHT), sit below what the best bottles reach.
export const SECOND_WEIGHT = 0.35;
const deficit = (target, s1, s2) => Math.max(0, target - s1) + SECOND_WEIGHT * Math.max(0, target - s2);
// A bottle is strong in a cell from the reference's 90th percentile. A cell
// is a gap when 5% or more of the reference beats the wardrobe's best there,
// or the best bottles beat it by GAP_HEADROOM; thin with under 2 strong
// bottles; plenty with 4 strong and a best within PLENTY_HEADROOM of the top.
export const STRONG_PCT = 90;
export const GAP_PCT = 95;
export const GAP_HEADROOM = 0.06;
export const PLENTY_HEADROOM = 0.03;
// The summary leaves out cells that come up rarely (under MIN_WEIGHT of all
// wears) or fall short by under MIN_DEFICIT, and a covered cell unless it
// falls short by ROOM_DEFICIT: room to grow where the wardrobe is otherwise fine.
export const MIN_WEIGHT = 0.004;
export const MIN_DEFICIT = 0.01;
export const ROOM_DEFICIT = 0.05;

/**
 * How well `bottles` (rows of `table`) cover each cell: [{ cell, top (the
 * best 3: { bottle, score, pct }), strong, target, headroom, deficit,
 * severity (weight × deficit), status: 'gap' | 'thin' | 'covered' | 'plenty' }].
 */
export function coverage(bottles, table, cells, ref) {
  const m = cells.length;
  return cells.map((cell, j) => {
    const q = ref[j], target = q[TARGET];
    const scored = bottles.map((bottle, i) => ({ bottle, score: table[i * m + j] })).sort((a, b) => b.score - a.score);
    const top = scored.slice(0, 3).map(s => ({ ...s, pct: percentileIn(q, s.score) }));
    const strong = scored.filter(s => s.score >= q[STRONG_PCT]).length;
    const [s1 = 0, s2 = 0] = top.map(t => t.score);
    const headroom = target - s1;
    const d = deficit(target, s1, s2);
    const status = !top.length || top[0].pct < GAP_PCT || headroom >= GAP_HEADROOM ? 'gap'
      : strong < 2 ? 'thin' : strong >= 4 && headroom < PLENTY_HEADROOM ? 'plenty' : 'covered';
    return { cell, top, strong, target, headroom, deficit: d, severity: cell.weight * d, status };
  });
}

/** One line on a cell, in the app's voice ("Only Cream Velvet is a strong pick (89% match); …"). */
export function explainCell(c) {
  const [best, next] = c.top;
  if (!best) return 'Nothing you own fits here.';
  if (c.status === 'plenty') return `${c.strong} strong picks, led by ${best.bottle.name} (${pct(best.score)} match).`;
  if (c.status === 'covered') return `Covered by ${list(c.top.slice(0, Math.max(1, c.strong)).map(t => t.bottle.name))}.`;
  return shortfall(c);
}

// How a cell falls short: who the wardrobe has there, and what's out there.
function shortfall(c) {
  const [best, next] = c.top;
  if (!best) return 'Nothing you own fits here.';
  if (c.status === 'thin') {
    return `Only ${best.bottle.name} is a strong pick (${pct(best.score)} match)${next ? `; next best is ${next.bottle.name} at ${pct(next.score)}` : ''}.`;
  }
  const beaten = 100 - best.pct;
  return `Your best is ${best.bottle.name} at ${pct(best.score)} match; ${beaten >= 2 ? `${beaten}% of well-voted bottles do better` : 'few bottles do better'}, and the best reach ${pct(c.target)}.`;
}

// Runs of adjacent bands within one use and slot, from cells passing `keep`.
function runsOf(cov, keep) {
  const runs = [];
  const sorted = cov.filter(keep).sort((a, b) => a.cell.use.localeCompare(b.cell.use) || a.cell.slot.localeCompare(b.cell.slot)
    || BAND_ORDER[a.cell.band] - BAND_ORDER[b.cell.band]);
  for (const c of sorted) {
    const last = runs.at(-1)?.at(-1);
    if (last && last.cell.use === c.cell.use && last.cell.slot === c.cell.slot && BAND_ORDER[last.cell.band] + 1 === BAND_ORDER[c.cell.band]) runs.at(-1).push(c);
    else runs.push([c]);
  }
  return runs;
}

const STATUS_ORDER = ['gap', 'thin', 'covered', 'plenty'];
// Whether the summary names a cell.
const named = (c, { minWeight = MIN_WEIGHT, minDeficit = MIN_DEFICIT } = {}) => c.cell.weight >= minWeight && c.deficit >= minDeficit
  && (c.status === 'gap' || c.status === 'thin' || (c.status === 'covered' && c.deficit >= ROOM_DEFICIT));

/**
 * The thinnest spots, worst first: gap and thin cells with a real shortfall,
 * and covered ones short by ROOM_DEFICIT, neighbouring bands of one use and
 * slot merged. -> [{ cells (ids), use, slot, bands, status (the most serious
 * among them), severity, weight, title ("Formal on cold and cool nights"),
 * text (about the one that costs most) }]
 */
export function gapSummary(cov, { limit = 6, minWeight = MIN_WEIGHT, minDeficit = MIN_DEFICIT } = {}) {
  return runsOf(cov, c => named(c, { minWeight, minDeficit })).map(run => {
    const worst = run.reduce((a, b) => (b.severity > a.severity ? b : a));
    const bands = run.map(c => c.cell.band);
    const line = shortfall(worst);
    return {
      cells: run.map(c => c.cell.id),
      use: worst.cell.use,
      slot: worst.cell.slot,
      bands,
      status: STATUS_ORDER[Math.min(...run.map(c => STATUS_ORDER.indexOf(c.status)))],
      severity: run.reduce((sum, c) => sum + c.severity, 0),
      weight: run.reduce((sum, c) => sum + c.cell.weight, 0),
      title: cellTitle(worst.cell.use, worst.cell.slot, bands),
      text: run.length > 1 ? `Worst when ${worst.cell.band}: ${line.charAt(0).toLowerCase()}${line.slice(1)}` : line,
    };
  }).sort((a, b) => b.severity - a.severity).slice(0, limit);
}

/**
 * Where a wardrobe is deep: per use, its deepest run of "plenty" cells, most
 * strong bottles first. -> [{ cells, use, slot, bands, strong, title, text
 * ("Date Night on cold nights: 6 strong bottles, led by Amber Empire.") }]
 */
export function strengths(cov, { limit = 4, minWeight = MIN_WEIGHT } = {}) {
  const best = new Map();
  for (const run of runsOf(cov, c => c.status === 'plenty' && c.cell.weight >= minWeight)) {
    const strong = Math.min(...run.map(c => c.strong));
    const depth = run.reduce((sum, c) => sum + c.strong * c.cell.weight, 0);
    const prev = best.get(run[0].cell.use);
    if (!prev || depth > prev.depth) best.set(run[0].cell.use, { run, strong, depth });
  }
  return [...best.values()].sort((a, b) => b.strong - a.strong || b.depth - a.depth).slice(0, limit).map(({ run, strong }) => {
    const lead = run.reduce((a, b) => (b.top[0].score > a.top[0].score ? b : a)).top[0].bottle;
    const title = cellTitle(run[0].cell.use, run[0].cell.slot, run.map(c => c.cell.band));
    return {
      cells: run.map(c => c.cell.id), use: run[0].cell.use, slot: run[0].cell.slot, bands: run.map(c => c.cell.band), strong, title,
      text: `${title}: ${strong}${run.length > 1 ? ' or more' : ''} strong bottles, led by ${lead.name}.`,
    };
  });
}

// ---------------------------------------------------------------- the whole picture

/**
 * Everything the report and the buy check share, for one wardrobe, climate
 * and set of shares. records: the pool (fromPool); byId: id -> record over
 * them; owned: the wardrobe's records (a visitor's outside the pool with
 * `about` attached); preferValue: only suggest bottles valued PREFER_VALUE or
 * more (default from the wardrobe, preferValueDefault).
 */
export function gapContext({ owned, records, byId, summary = DEFAULT_CLIMATE, shares = null, preferValue = null }) {
  const cc = cellsFor(summary, { shares });
  const m = cc.cells.length;
  const table = poolTable(records, summary, cc);
  const prefer = preferValue ?? preferValueDefault(owned, byId);
  const ctx = allowContext(owned, { byId, minValue: prefer ? PREFER_VALUE : null });
  // The reference: well-voted bottles in the wardrobe's lean range, not brigaded.
  const rows = [];
  records.forEach((r, i) => {
    const lean = genderLean(r, byId);
    if (lean >= ctx.lean[0] && lean <= ctx.lean[1] && !signalsOf(r).flags.includes('brigaded')) rows.push(i);
  });
  const ref = poolReference(table, records.length, m, rows);
  const ownTable = fitTable(owned.map(sameFooting), cc);
  const cov = coverage(owned, ownTable, cc.cells, ref);
  const norms = poolNorms(records);
  return {
    owned, records, byId, summary, cc, table, rows, ref, ownTable, cov, norms,
    allow: ctx,
    preferValue: prefer,
    valueSlope: valueSlope(owned, norms, byId),
    family: familyIndex(byId, owned),
    vecs: ownedVectors(owned, byId),
    severity: cov.reduce((sum, c) => sum + c.severity, 0),
  };
}

// The wardrobe's best and second best per cell, and who holds the best.
function bestOwned(ctx) {
  const m = ctx.cc.cells.length, s1 = new Float32Array(m), s2 = new Float32Array(m), who = new Array(m).fill(null);
  ctx.owned.forEach((b, i) => {
    for (let j = 0; j < m; j++) {
      const x = ctx.ownTable[i * m + j];
      if (x > s1[j]) [s2[j], s1[j], who[j]] = [s1[j], x, b];
      else if (x > s2[j]) s2[j] = x;
    }
  });
  return { s1, s2, who };
}

// How much less short every cell falls with a bottle scoring `row` added to
// best/second best s1, s2: per cell, weight × (deficit before - after).
function cellGains(row, rowAt, cells, ref, s1, s2) {
  const out = [];
  for (let j = 0; j < cells.length; j++) {
    const x = row[rowAt + j];
    if (x <= s2[j] || !cells[j].weight) continue;
    const target = ref[j][TARGET];
    const before = deficit(target, s1[j], s2[j]);
    const after = x > s1[j] ? deficit(target, x, s1[j]) : deficit(target, s1[j], x);
    if (before > after) out.push({ j, gain: cells[j].weight * (before - after) });
  }
  return out;
}

// A fill matters when it lifts the wardrobe's best by FILL_MARGIN or more, or
// adds a strong pick where it has fewer than 2, in a cell that comes up
// (MIN_WEIGHT). One point better than a bottle you love doesn't fill anything.
export const FILL_MARGIN = 0.02;

// What a bottle would add, as fills against the wardrobe: { cell, from (the
// wardrobe's best there), second (its second best), to, first (beats the
// best), pct, beats (the best bottle), matters, real (matters, in a cell the
// summary names), gain }, most gain first.
function fillsOf(gains, row, rowAt, ctx, own) {
  return gains.map(({ j, gain }) => {
    const c = ctx.cov[j], to = row[rowAt + j];
    const matters = c.cell.weight >= MIN_WEIGHT && (to - own.s1[j] >= FILL_MARGIN || (c.strong < 2 && to >= ctx.ref[j][STRONG_PCT]));
    return {
      cell: c.cell, from: own.s1[j], second: own.s2[j], to, first: to > own.s1[j], pct: percentileIn(ctx.ref[j], to), beats: own.who[j],
      matters, real: matters && named(c), gain,
    };
  }).sort((a, b) => b.gain - a.gain);
}

// A suggestion's risk, as a multiplier: a high-risk bottle is never
// suggested (its buy check would say Risky), a medium one counts for less,
// and each reason riskOf lists (doesn't last, hard to find) a little less.
const RISK_MULT = { low: 1, unknown: 1, medium: 0.85, high: 0 };
const RISK_REASON = 0.9;
const riskMult = risk => RISK_MULT[risk.level] * RISK_REASON ** risk.reasons.length;
// Kin of an earlier pick (a family link either way) counts as a near twin.
const PICK_KIN = 0.15;
// Within SAME_SIM of an owned bottle a bottle smells too much alike, whatever
// voters say: the buy check calls it redundant, and it's never suggested.
export const SAME_SIM = 0.9;

/**
 * Gap fillers, greedily: each round takes the candidate whose addition most
 * cuts the total shortfall (gain), times its quality and novelty, then counts
 * it as owned, so the next pick fills something else and its value never
 * exceeds the last one's. Candidates pass allow() (and the value filter),
 * aren't owned, an owned dupe's original or its twin, discontinued or high
 * risk, and have a fill that matters. Novelty against the wardrobe (the
 * costly part) is worked out lazily, in order of what a candidate could still
 * be worth. -> [{ record, gain, value, quality, novelty: { mult, sim,
 * nearest, dupe }, fills, twin, risk, shared }]
 */
export function suggest(ctx, { k = 5 } = {}) {
  const { cc: { cells }, table, ref, records, byId } = ctx, m = cells.length;
  const own = bestOwned(ctx);
  const s1 = Float32Array.from(own.s1), s2 = Float32Array.from(own.s2);
  const meta = records.map((r, i) => {
    if (!allow(r, ctx.allow) || signalsOf(r).flags.includes('discontinued')) return null;
    const dupe = ctx.family.dupeOf(r);
    if (dupe && dupe.mult <= FAMILY_MULT.near) return null;
    const risk = riskOf(r, byId);
    if (!riskMult(risk)) return null;
    const q = candidateQuality(r, ctx.norms, { valueSlope: ctx.valueSlope, byId });
    return { i, record: r, risk, q, bound: q.mult * riskMult(risk) * (dupe?.mult ?? 1), nov: null, fit: null };
  }).filter(Boolean);
  // Worked out for candidates that could still win: novelty, and whether anything it adds matters.
  const judge = mt => {
    mt.nov ??= novelty(mt.record, ctx.vecs, ctx.family);
    mt.fit ??= mt.nov.sim < SAME_SIM && fillsOf(cellGains(table, mt.i * m, cells, ref, own.s1, own.s2), table, mt.i * m, ctx, own).some(f => f.matters);
    return mt.fit ? mt.nov.mult : 0;
  };
  const picks = [];
  const pickNovelty = r => {
    let mult = 1;
    for (const p of picks) {
      const kin = signalsOf(r).family.includes(p.record.id) || signalsOf(p.record).family.includes(r.id);
      mult = Math.min(mult, kin ? PICK_KIN : Math.min(1, 0.35 + 1.6 * (1 - similarity(r, p.record))));
    }
    return mult;
  };
  for (let round = 0; round < k; round++) {
    const options = [];
    for (const mt of meta) {
      if (mt.picked || mt.fit === false) continue;
      const gain = cellGains(table, mt.i * m, cells, ref, s1, s2).reduce((sum, g) => sum + g.gain, 0);
      if (gain > 0) options.push({ mt, gain, bound: gain * mt.bound });
    }
    options.sort((a, b) => b.bound - a.bound);
    let best = null;
    for (const o of options) {
      if (best && o.bound <= best.value) break;
      const value = o.gain * o.mt.q.mult * riskMult(o.mt.risk) * judge(o.mt) * pickNovelty(o.mt.record);
      if (value > 0 && (!best || value > best.value)) best = { ...o, value };
    }
    if (!best) break;
    const { mt } = best, r = mt.record;
    const gains = cellGains(table, mt.i * m, cells, ref, s1, s2);
    for (const { j } of gains) {
      const x = table[mt.i * m + j];
      if (x > s1[j]) [s2[j], s1[j]] = [s1[j], x];
      else if (x > s2[j]) s2[j] = x;
    }
    mt.picked = true;
    const near = mt.nov.nearest;
    picks.push({
      record: r,
      gain: best.gain,
      value: best.value,
      quality: mt.q,
      novelty: mt.nov,
      fills: fillsOf(gains, table, mt.i * m, ctx, own),
      twin: cheaperTwin(r, byId, ctx.allow),
      risk: mt.risk,
      shared: near ? sharedTraits(r, near.record) : [],
    });
  }
  return picks;
}

// ---------------------------------------------------------------- the buy check

// A bottle whose fills that matter cut the named gaps by STRONG_GAIN or more,
// rated at least the pool's usual and safe to blind buy, is a strong fit.
export const STRONG_GAIN = 0.0015;

// Fills grouped by use and slot, most gain first, as titles: "Office on cold
// and cool days and Formal on cool nights" (the top two).
function fillsText(fills) {
  const groups = new Map();
  for (const f of fills) {
    const key = `${f.cell.use}:${f.cell.slot}`;
    if (!groups.has(key)) groups.set(key, { use: f.cell.use, slot: f.cell.slot, bands: [], gain: 0 });
    const g = groups.get(key);
    g.bands.push(f.cell.band);
    g.gain += f.gain;
  }
  const top = [...groups.values()].sort((a, b) => b.gain - a.gain).slice(0, 2);
  return list(top.map(g => cellTitle(g.use, g.slot, g.bands.sort((a, b) => BAND_ORDER[a] - BAND_ORDER[b]))));
}

const lower = t => t.charAt(0).toLowerCase() + t.slice(1);

/**
 * Whether a bottle is worth buying for this wardrobe: { verdict: 'Strong fit'
 * | 'Good' | 'Redundant' | 'Risky', reasons (2–3 short sentences), fills (the
 * ones that matter), gain, realGain, overlap: { bottle, via, sim, link },
 * risk, twin, quality }.
 * Redundant: owned, an owned dupe's original or a twin of one (dupeOf),
 * within SAME_SIM of an owned bottle, or nothing it adds matters. Risky:
 * riskOf says high. Strong fit: its fills cut the named gaps by STRONG_GAIN,
 * with quality at or above the pool's usual and low risk. Good otherwise.
 */
export function buyCheck(record, ctx) {
  const own = bestOwned(ctx), cells = ctx.cc.cells;
  const nov = novelty(record, ctx.vecs, ctx.family);
  const dupe = nov.dupe;
  const mine = dupe?.kind === 'owned';
  const row = fitTable([record], ctx.cc);
  const all = mine ? [] : fillsOf(cellGains(row, 0, cells, ctx.ref, own.s1, own.s2), row, 0, ctx, own);
  const fills = all.filter(f => f.matters);
  const gain = all.reduce((sum, f) => sum + f.gain, 0);
  const realGain = fills.filter(f => f.real).reduce((sum, f) => sum + f.gain, 0);
  const risk = riskOf(record, ctx.byId);
  const twin = cheaperTwin(record, ctx.byId, ctx.allow);
  const q = candidateQuality(record, ctx.norms, { valueSlope: ctx.valueSlope, byId: ctx.byId });
  // The nearest owned bottle; for an original, the dupe you own rather than itself.
  let near = nov.nearest, sim = nov.sim;
  if (near && String(near.record.id) === String(record.id)) [near, sim] = [{ record: near.via, via: near.via }, similarity(record, near.via)];
  const overlap = near && !mine ? { bottle: near.record, via: near.via, sim, link: dupe?.text ?? null } : null;

  const twinOwned = dupe && ['owned', 'original', 'near'].includes(dupe.kind);
  let verdict;
  if (twinOwned || nov.sim >= SAME_SIM || !fills.length) verdict = 'Redundant';
  else if (risk.level === 'high') verdict = 'Risky';
  else if (realGain >= STRONG_GAIN && q.mult >= 1 && (risk.level === 'low' || risk.level === 'unknown')) verdict = 'Strong fit';
  else verdict = 'Good';

  const nearWho = near && (near.record === near.via ? `your ${near.via.name}` : `${near.record.name}, the original of your ${near.via.name}`);
  const shared = near ? sharedTraits(record, near.record, 3) : [];
  const overlapLine = dupe ? `${dupe.text}.`
    : nearWho && `Closest to ${nearWho}${shared.length ? `: both ${shared.length > 1 ? `share ${list(shared)}` : `lean on ${shared[0]}`}` : ''}.`;
  const firsts = fills.filter(f => f.first), seconds = fills.filter(f => !f.first);
  const fillLine = firsts.length ? `It would be your best for ${fillsText(firsts)}${realGain ? '' : ', though you’re well stocked there'}.`
    : seconds.length ? `It would be a second strong pick for ${fillsText(seconds)}.` : null;
  const lean = genderLean(record, ctx.byId), [lo, hi] = ctx.allow.lean;
  const leanLine = lean < lo ? 'Voters call it more feminine than anything you own.'
    : lean > hi ? 'Voters call it more masculine than anything you own.' : null;
  // Why it adds little: where it comes closest to beating what's owned.
  const barely = all.find(f => f.first && f.beats && f.cell.weight >= MIN_WEIGHT);
  const littleLine = !all.length ? 'It wouldn’t beat anything you own, in any weather or occasion.'
    : barely ? `It adds little: it barely beats your ${barely.beats.name} for ${cellLabel(barely.cell)}.`
      : 'It adds little: it wouldn’t beat your best bottle anywhere.';

  const reasons = [];
  if (mine) reasons.push('You own it.');
  else if (twinOwned || nov.sim >= SAME_SIM) {
    const same = twinOwned ? dupe.via : near.via;
    reasons.push(twinOwned ? `${dupe.text}.` : `It smells nearly the same as ${nearWho}.`,
      fillLine ? `Still, ${lower(fillLine)}` : `It would add nothing your ${same.name} doesn’t already do.`);
  } else if (verdict === 'Redundant') {
    reasons.push(littleLine, overlapLine);
  } else if (verdict === 'Risky') {
    reasons.push(...risk.reasons.slice(0, 2), fillLine);
  } else {
    reasons.push(fillLine, overlapLine);
    reasons.push((risk.level === 'medium' && risk.reasons[0]) || leanLine || (twin && !twin.owned && twin.text)
      || `Rated ${record.rating.toFixed(1)}★ by ${record.ratingVotes.toLocaleString('en-US')} voters.`);
  }
  return { verdict, reasons: reasons.filter(Boolean).slice(0, 3), fills, gain, realGain, overlap, risk, twin, quality: q };
}

// ---------------------------------------------------------------- plain output

/** A record as a light stub for lists and postMessage. */
export const stub = r => r && {
  id: String(r.id), name: r.name, brand: r.brand, year: r.year ?? null, thumb: r.thumb ?? null, url: r.url ?? null,
  rating: r.rating ?? null, ratingVotes: r.ratingVotes ?? null,
};
const fillJSON = f => ({
  cell: f.cell.id, title: cellLabel(f.cell), from: round(f.from, 3), second: round(f.second, 3), to: round(f.to, 3), first: f.first, pct: f.pct,
  beats: f.beats ? stub(f.beats) : null, matters: f.matters, real: f.real, gain: round(f.gain, 5),
});
const twinJSON = t => t && { ...stub(t.record), value: t.value, owned: t.owned, text: t.text };

/**
 * The report as plain data (ids, names, numbers and text: JSON and
 * postMessage safe): the cells, each one's coverage, gaps, strengths and k
 * suggestions. A suggestion carries its full record, for the app to rank it
 * with the wardrobe for its own reasons.
 */
export function gapReport(ctx, { k = 5, gaps = 6 } = {}) {
  const picks = suggest(ctx, { k });
  let left = ctx.severity;
  return {
    preferValue: ctx.preferValue,
    lean: ctx.allow.lean,
    valueSlope: round(ctx.valueSlope, 3),
    severity: round(ctx.severity, 5),
    climate: Object.fromEntries(Object.entries(ctx.cc.slotBands).map(([key, sb]) => [key, sb.share])),
    coverage: ctx.cov.map(c => ({
      cell: c.cell.id, use: c.cell.use, slot: c.cell.slot, band: c.cell.band, title: cellLabel(c.cell),
      weight: round(c.cell.weight, 5), status: c.status, strong: c.strong,
      target: round(c.target, 3), headroom: round(c.headroom, 3), severity: round(c.severity, 5),
      top: c.top.map(t => ({ id: String(t.bottle.id), name: t.bottle.name, score: round(t.score, 3), pct: t.pct })),
      text: explainCell(c),
    })),
    gaps: gapSummary(ctx.cov, { limit: gaps }).map(g => ({ ...g, severity: round(g.severity, 5), weight: round(g.weight, 4) })),
    strengths: strengths(ctx.cov),
    picks: picks.map(p => {
      left -= p.gain;
      const near = p.novelty.nearest;
      return {
        ...stub(p.record),
        record: p.record,
        gain: round(p.gain, 5),
        severityAfter: round(Math.max(0, left), 5),
        merit: round(p.value, 5),
        quality: { mult: round(p.quality.mult, 3), rating: round(p.quality.rating, 2), keep: round(p.quality.keep, 3), value: round(p.quality.value, 2) },
        novelty: round(p.novelty.mult, 3),
        nearest: near ? { ...stub(near.record), via: near.record === near.via ? null : stub(near.via), sim: round(p.novelty.sim, 3) } : null,
        dupe: p.novelty.dupe?.text ?? null,
        shared: p.shared,
        fills: p.fills.map(fillJSON),
        twin: twinJSON(p.twin),
        risk: p.risk,
      };
    }),
  };
}

/** buyCheck as plain data, like gapReport. */
export function checkJSON(record, check) {
  const o = check.overlap;
  return {
    ...stub(record),
    verdict: check.verdict,
    reasons: check.reasons,
    gain: round(check.gain, 5),
    fills: check.fills.map(fillJSON),
    overlap: o && { ...stub(o.bottle), via: o.bottle === o.via ? null : stub(o.via), sim: round(o.sim, 3), link: o.link },
    risk: check.risk,
    twin: twinJSON(check.twin),
    quality: { mult: round(check.quality.mult, 3), rating: round(check.quality.rating, 2), keep: round(check.quality.keep, 3), value: round(check.quality.value, 2) },
  };
}
