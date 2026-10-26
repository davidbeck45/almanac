// The wardrobe gap finder and the buy check: which situations a wardrobe
// covers poorly, the bottles that would fill them, and whether one bottle is
// worth buying. Pure (no DOM, no fetch), so a module Worker can run it
// (src/pool-worker.js); the climate comes in as a summary (src/climate.js),
// how often each use comes up as shares (src/uses.js).
//
// A cell is a use (Daily picks or an occasion) × day or night × a feels-like
// band, weighted by how often it comes up: the use's share × its slot's share
// × how often that band comes up at the place. A bottle's fit in a cell is
// rank()'s score for it in that weather (scoreOf on the engine's own parts,
// averaged over a few real windows from the band, so calendar season and dew
// point come from real days). Owned bottles are measured against the
// suggestion pool's scores in the same cell, every bottle read on the
// pool's evidence (sameFooting).
import { seasonFit, timeFit, weatherFit, richInHeat, quality, personalPart, occasionRaw, occasionPart, scoreOf, targetSeasonWeights, isDisliked } from './engine.js';
import { occasionById } from './occasions.js';
import { similarity, sharedTraits } from './similar.js';
import { styleScores, styleMix, styleById, topOf, shownOf, closeOf } from './scent-styles.js';
import {
  signalsOf, genderLean, leanWindow, allowContext, allow, poolNorms, candidateQuality, valueSlope, preferValueDefault,
  familyIndex, ownedVectors, novelty, cheaperTwin, riskOf, weakLongevity, poolRowOf, PREFER_VALUE, FAMILY_MULT, MIN_RATING,
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
 * slot × band's share and windows as engine conditions. Shares that aren't
 * numbers adding up to more than 0 throw (settings go through sharesFrom).
 */
export function cellsFor(summary, { shares = null } = {}) {
  if (shares && !(USES.every(u => shares[u.id] == null || (Number.isFinite(shares[u.id]) && shares[u.id] >= 0))
    && USES.some(u => shares[u.id] > 0))) {
    throw new Error('Use shares must be numbers adding up to more than 0: pass settings through sharesFrom (src/uses.js).');
  }
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

// The dataset keeps a bottle's 8 strongest accords; a scraped page shows up
// to 10, and the extra two moved owned bottles' occasion cells by up to 8
// points, against a FILL_MARGIN of 2.
export const MAX_ACCORDS = 8;
// Flat season or day/night votes read as none in the engine itself
// (steadyShares), so rank(), the gap finder and Discover agree on them.
export { flatVotes } from './engine.js';

const footed = new WeakMap();
/**
 * A record as the gap finder scores it, on the pool's evidence: no Parfumo
 * occasion votes (the pool has none, and a lucky vote shouldn't read as
 * coverage) and its MAX_ACCORDS strongest accords. Parfumo's longevity and
 * sillage stay: the pool has Fragrantica's, on the same scale. The same
 * record comes back when nothing changes.
 */
export function sameFooting(record) {
  if (footed.has(record)) return footed.get(record);
  const patch = {};
  if (record.parfumo?.occasion) {
    const { occasion, occasionVotes, ...parfumo } = record.parfumo;
    patch.parfumo = parfumo;
  }
  const accords = Object.entries(record.accords ?? {});
  if (accords.length > MAX_ACCORDS) patch.accords = Object.fromEntries(accords.sort((a, b) => b[1] - a[1]).slice(0, MAX_ACCORDS));
  const out = Object.keys(patch).length ? { ...record, ...patch } : record;
  footed.set(record, out);
  return out;
}
const footedLists = new WeakMap();
const allFooted = records => footedLists.get(records) ?? footedLists.set(records, records.map(sameFooting)).get(records);

/**
 * Every bottle's fit in every cell, row-major [bottle][cell]: rank()'s score
 * with no recent wears, averaged over the cell's windows, your stars included
 * (`personal`: only owned records carry them, so the pool's table and
 * reference stay the crowd's). The score is linear in the parts, so the
 * season and weather fits (and richness in heat) are averaged per slot ×
 * band and shared by every use, and occasionPart is worked out once per
 * occasion.
 */
export function fitTable(bottles, { cells, slotBands }) {
  const m = cells.length, out = new Float32Array(bottles.length * m);
  const keys = [...new Set(cells.map(c => c.sb))];
  const occasions = [...new Set(cells.map(c => c.occasion).filter(Boolean))];
  const fit = new Map(), occ = new Map();
  bottles.forEach((b, i) => {
    const q = quality(b), personal = personalPart(b);
    const time = { day: timeFit(b, 'day'), night: timeFit(b, 'night') };
    for (const o of occasions) occ.set(o, occasionPart(occasionRaw(b, o), o));
    for (const k of keys) {
      const { wins } = slotBands[k];
      let season = 0, weather = 0, heat = 0;
      for (const w of wins) {
        season += seasonFit(b, w.weights);
        weather += weatherFit(b, w.cond);
        heat += richInHeat(b, w.cond);
      }
      fit.set(k, [season / wins.length, weather / wins.length, heat / wins.length]);
    }
    for (let j = 0; j < m; j++) {
      const c = cells[j], [season, weather, heat] = fit.get(c.sb);
      const parts = { season, time: time[c.slot], weather, quality: q, occasion: c.occasion ? occ.get(c.occasion) : null, heat, personal };
      out[i * m + j] = scoreOf(parts, c.occasion);
    }
  });
  return out;
}

// The pool's tables for the last TABLES_KEPT climates asked about, newest
// first (a wardrobe change, other shares or the value toggle reuse one), so
// the default climate's, warmed ahead, and a place's own don't push each
// other out. Each is about 2 MB.
const TABLES_KEPT = 2;
let tables = []; // { records, key, table }
const tableFor = (records, key) => tables.find(t => t.records === records && t.key === key) ?? null;
function keepTable(entry) {
  tables = [entry, ...tables.filter(t => t !== entry)].slice(0, TABLES_KEPT);
  return entry.table;
}

export function poolTable(records, summary, cc = cellsFor(summary)) {
  const key = JSON.stringify(summary);
  return keepTable(tableFor(records, key) ?? { records, key, table: fitTable(records, cc) });
}

const nextTurn = () => new Promise(resolve => setTimeout(resolve, 0));

/**
 * gapContext's pool table for `records` (the pool's) in a climate, worked
 * out ahead of time in slices of `chunk` bottles, pausing between them so a
 * Worker answers other questions meanwhile: the first report or buy check
 * then finds it done (about 230 ms of a 340 ms context in Node). Stops when
 * one already is, and never pushes out the table of the climate asked about
 * last. -> the table.
 */
export async function warmPoolTable(records, summary = DEFAULT_CLIMATE, { pause = nextTurn, chunk = 500 } = {}) {
  summary ??= DEFAULT_CLIMATE;
  const key = JSON.stringify(summary), footed = allFooted(records);
  const cc = cellsFor(summary), m = cc.cells.length, table = new Float32Array(footed.length * m);
  for (let i = 0; i < footed.length; i += chunk) {
    await pause();
    if (tableFor(footed, key)) return tableFor(footed, key).table;
    table.set(fitTable(footed.slice(i, i + chunk), cc), i * m);
  }
  if (tableFor(footed, key)) return tableFor(footed, key).table;
  // Kept behind the newest: what a question asked for meanwhile stays.
  tables = [...tables.slice(0, TABLES_KEPT - 1), { records: footed, key, table }];
  return table;
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
// bottles and the next best under THIN_PCT (a runner-up just under the strong
// line is depth, not a hole); plenty with 4 strong and a best within
// PLENTY_HEADROOM of the top.
export const STRONG_PCT = 90;
export const THIN_PCT = 85;
export const GAP_PCT = 95;
export const GAP_HEADROOM = 0.06;
export const PLENTY_HEADROOM = 0.03;
// The summary leaves out cells that come up rarely (under MIN_WEIGHT of all
// wears) or fall short by under MIN_DEFICIT. A covered cell short by
// ROOM_DEFICIT is "room": room to grow where the wardrobe is otherwise fine.
export const MIN_WEIGHT = 0.004;
export const MIN_DEFICIT = 0.01;
export const ROOM_DEFICIT = 0.05;

// Thin: under 2 strong bottles, and a second best under THIN_PCT.
const thinAt = (q, strong, s2) => strong < 2 && s2 < q[THIN_PCT];

// A cell's status from what's there: the best score s1 (null with nothing),
// the second best s2 and how many are strong.
function statusOf(cell, q, s1, s2, strong) {
  if (!cell.weight) return 'off';
  if (s1 == null || s1 < q[GAP_PCT] || q[TARGET] - s1 >= GAP_HEADROOM) return 'gap';
  if (thinAt(q, strong, s2)) return 'thin';
  if (strong >= 4 && q[TARGET] - s1 < PLENTY_HEADROOM) return 'plenty';
  return deficit(q[TARGET], s1, s2) >= ROOM_DEFICIT ? 'room' : 'covered';
}
// Whether the gap list names a cell: one that comes up, short by MIN_DEFICIT, a gap, thin or room to grow.
const namedAs = (weight, status, d, { minWeight = MIN_WEIGHT, minDeficit = MIN_DEFICIT } = {}) => weight >= minWeight && d >= minDeficit
  && (status === 'gap' || status === 'thin' || status === 'room');

/**
 * How well `bottles` (rows of `table`) cover each cell: [{ cell, top (the
 * best 3: { bottle, score, pct }), strong, target, headroom, deficit,
 * severity (weight × deficit), status: 'gap' | 'thin' | 'room' | 'covered' |
 * 'plenty', or 'off' for a use set to Never (weight 0) }].
 */
export function coverage(bottles, table, cells, ref) {
  const m = cells.length;
  return cells.map((cell, j) => {
    const q = ref[j], target = q[TARGET];
    const scored = bottles.map((bottle, i) => ({ bottle, score: table[i * m + j] })).sort((a, b) => b.score - a.score);
    const top = scored.slice(0, 3).map(s => ({ ...s, pct: percentileIn(q, s.score) }));
    const strong = scored.filter(s => s.score >= q[STRONG_PCT]).length;
    const [s1 = 0, s2 = 0] = top.map(t => t.score);
    const d = deficit(target, s1, s2);
    const status = statusOf(cell, q, top.length ? s1 : null, s2, strong);
    return { cell, top, strong, target, headroom: target - s1, deficit: d, severity: cell.weight * d, status };
  });
}

/** One line on a cell, in the app's voice ("Only Cream Velvet is a strong pick (89% match); …"). */
export function explainCell(c) {
  const [best] = c.top;
  if (c.status === 'off') return 'You never dress for this.';
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
  return `Your best is ${best.bottle.name} at ${pct(best.score)} match; ${beaten >= 2 ? `${beaten}% of well-voted bottles do better` : 'few bottles do better'}, and top bottles here average ${pct(c.target)}.`;
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

const STATUS_ORDER = ['gap', 'thin', 'room', 'covered', 'plenty', 'off'];
const named = (c, opts) => namedAs(c.cell.weight, c.status, c.deficit, opts);

/**
 * The thinnest spots: gap and thin cells with a real shortfall, then room to
 * grow, each worst first, neighbouring bands of one use and slot merged.
 * Every one by default: suggestions fill these cells and no others.
 * -> [{ cells (ids), use, slot, bands, status ('gap' | 'thin' | 'room', the
 * most serious among them), severity, weight, title ("Formal on cold and
 * cool nights"), text (about the cell in that state that costs most) }]
 */
export function gapSummary(cov, { limit = Infinity, minWeight = MIN_WEIGHT, minDeficit = MIN_DEFICIT } = {}) {
  return runsOf(cov, c => named(c, { minWeight, minDeficit })).map(run => {
    // The cell in the worst state (a gap before room to grow), the costliest
    // of those, as Insights opens on: the text describes the status it gives.
    const worst = run.reduce((a, b) => (STATUS_ORDER.indexOf(b.status) - STATUS_ORDER.indexOf(a.status) || a.severity - b.severity) < 0 ? b : a);
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
  }).sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || b.severity - a.severity).slice(0, limit);
}

/**
 * One line on the whole wardrobe, before its gaps: { strongShare (the share
 * of wears with a strong pick), short (gap and thin cells named), text }.
 * `owned`: how many bottles the wardrobe holds, liked or not.
 */
export function overview(cov, { owned = null } = {}) {
  const strongShare = cov.reduce((sum, c) => sum + (c.strong ? c.cell.weight : 0), 0);
  const listed = cov.filter(c => named(c));
  const short = listed.filter(c => c.status !== 'room').length;
  const none = !cov.some(c => c.top.length);
  const text = none && owned ? 'You rate everything you own 2★ or lower, so every situation is open.'
    : none ? 'You don’t own anything yet, so every situation is open.'
    : short ? `You have a strong pick for ${strongShare >= 0.95 ? 'nearly everything' : `${pct(strongShare)} of what`} you wear; here’s where it falls short.`
      : listed.length ? 'Your wardrobe covers every situation well; here’s where it could go further.'
        : 'Your wardrobe covers every situation well.';
  return { strongShare: round(strongShare, 3), short, text };
}

/**
 * Where a wardrobe is deep: per use, its deepest run of "plenty" cells, most
 * strong bottles first. -> [{ cells, use, slot, bands, strong, title, text
 * ("Date Night on cold nights: 6 strong bottles, led by Amber Empire.";
 * across bands with different leaders, "led by CH Men Prive on cold nights
 * and Jake on warm ones.") }]
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
    const [first, last] = [run[0], run.at(-1)], slot = first.cell.slot;
    const [a, b] = [first.top[0].bottle, last.top[0].bottle];
    const lead = a === b ? a.name : `${a.name} on ${first.cell.band} ${SLOT_WORD[slot]} and ${b.name} on ${last.cell.band} ones`;
    const title = cellTitle(first.cell.use, slot, run.map(c => c.cell.band));
    return {
      cells: run.map(c => c.cell.id), use: first.cell.use, slot, bands: run.map(c => c.cell.band), strong, title,
      text: `${title}: ${strong}${run.length > 1 ? ' or more' : ''} strong bottles, led by ${lead}.`,
    };
  });
}

// ---------------------------------------------------------------- the whole picture

/**
 * Everything the report and the buy check share, for one wardrobe, climate
 * and set of shares. records: the pool (fromPool); byId: id -> record over
 * them; owned: the wardrobe's records (a visitor's outside the pool with
 * `about` attached, and `personal` for your stars, src/skin.js); preferValue:
 * only suggest bottles valued PREFER_VALUE or more (default from the
 * wardrobe, preferValueDefault); mists: suggest body mists and sprays too
 * (allowContext). Every bottle is scored as sameFooting has it. Coverage
 * counts the bottles you'd wear (`worn`): one you rate DISLIKED or lower
 * covers nothing, as rank() all but benches it, though it still counts as
 * owned (its twins are Redundant) and toward your styles.
 */
export function gapContext({ owned, records, byId, summary = DEFAULT_CLIMATE, shares = null, preferValue = null, mists = false }) {
  summary ??= DEFAULT_CLIMATE;
  const cc = cellsFor(summary, { shares });
  const m = cc.cells.length;
  const table = poolTable(allFooted(records), summary, cc);
  const prefer = preferValue ?? preferValueDefault(owned, byId);
  const ctx = allowContext(owned, { byId, minValue: prefer ? PREFER_VALUE : null, mists });
  // The reference: well-voted bottles in the wardrobe's lean range, not
  // brigaded, and perfumes unless mists are let in (what it could suggest).
  const rows = [];
  records.forEach((r, i) => {
    const lean = genderLean(r, byId), { flags } = signalsOf(r);
    if (lean >= ctx.lean[0] && lean <= ctx.lean[1] && !flags.includes('brigaded') && (mists || !flags.includes('mist'))) rows.push(i);
  });
  const ref = poolReference(table, records.length, m, rows);
  const worn = owned.filter(f => !isDisliked(f));
  const ownTable = fitTable(worn.map(sameFooting), cc);
  const cov = coverage(worn, ownTable, cc.cells, ref);
  const norms = poolNorms(records);
  const leans = owned.map(f => genderLean(f, byId));
  return {
    owned, worn, records, byId, summary, cc, table, rows, ref, ownTable, cov, norms,
    allow: ctx,
    preferValue: prefer,
    valueSlope: valueSlope(owned, norms, byId),
    family: familyIndex(byId, owned),
    vecs: ownedVectors(owned, byId),
    // The leans the wardrobe spans: its own 10th to 90th percentile, and all of it.
    leanSpan: leanWindow(owned, 0, byId),
    leanRange: leans.length >= 3 ? [Math.min(...leans), Math.max(...leans)] : null,
    severity: cov.reduce((sum, c) => sum + c.severity, 0),
    gapSeverity: cov.reduce((sum, c) => sum + (named(c) ? c.severity : 0), 0),
  };
}

// What the wardrobe has per cell, which suggestions add to: its best and
// second best scores, who holds the best (of the bottles you'd wear), how
// many strong bottles, and whether the gap list names the cell (`short`:
// suggestions only count gains there, so the gaps a report lists are the
// ones its picks fill).
function ownedState(ctx) {
  const m = ctx.cc.cells.length, s1 = new Float32Array(m), s2 = new Float32Array(m), who = new Array(m).fill(null);
  ctx.worn.forEach((b, i) => {
    for (let j = 0; j < m; j++) {
      const x = ctx.ownTable[i * m + j];
      if (x > s1[j]) [s2[j], s1[j], who[j]] = [s1[j], x, b];
      else if (x > s2[j]) s2[j] = x;
    }
  });
  const strong = Uint16Array.from(ctx.cov, c => c.strong), short = Uint8Array.from(ctx.cov, c => (named(c) ? 1 : 0));
  return { s1, s2, who, strong, short, picks: new Set() };
}

// Counts a suggestion as owned: `record` scoring `row` from rowAt. A cell it
// lifts out of the gap list stops counting for the picks after it.
function addTo(state, row, rowAt, record, ctx) {
  const { cells } = ctx.cc;
  for (let j = 0; j < cells.length; j++) {
    const x = row[rowAt + j], q = ctx.ref[j];
    if (x > state.s1[j]) [state.s2[j], state.s1[j], state.who[j]] = [state.s1[j], x, record];
    else if (x > state.s2[j]) state.s2[j] = x;
    if (x >= q[STRONG_PCT]) state.strong[j]++;
    const status = statusOf(cells[j], q, state.s1[j], state.s2[j], state.strong[j]);
    if (!namedAs(cells[j].weight, status, deficit(q[TARGET], state.s1[j], state.s2[j]))) state.short[j] = 0;
  }
  state.picks.add(record);
}

// How much less short every cell falls with a bottle scoring `row` added to
// best/second best s1, s2: per cell, weight × (deficit before - after), only
// in `focus` cells when given.
function cellGains(row, rowAt, cells, ref, s1, s2, focus = null) {
  const out = [];
  for (let j = 0; j < cells.length; j++) {
    const x = row[rowAt + j];
    if (x <= s2[j] || !cells[j].weight || (focus && !focus[j])) continue;
    const target = ref[j][TARGET];
    const before = deficit(target, s1[j], s2[j]);
    const after = x > s1[j] ? deficit(target, x, s1[j]) : deficit(target, s1[j], x);
    if (before > after) out.push({ j, gain: cells[j].weight * (before - after) });
  }
  return out;
}

// A fill matters when it lifts the best by FILL_MARGIN or more, or adds a
// strong pick where the cell is thin, in a cell that comes up (MIN_WEIGHT).
// One point better than a bottle you love doesn't fill anything, and neither
// does a strong pick that is kin of the one it backs up (KIN_SIM alike, or
// voters link them): a Cream Velvet clone adds no depth to Cream Velvet. A
// bottle that fades fast fills nothing where the occasion wants it to last.
export const FILL_MARGIN = 0.02;
export const KIN_SIM = 0.75;

// Whether a and b smell like one family: KIN_SIM alike, a placed by voters'
// links next to b (or b's original), or a family link between them.
function kin(a, b, ctx) {
  if (!b) return false;
  if (ctx.family.dupeOf(a)?.via === b || similarity(a, b) >= KIN_SIM) return true;
  return signalsOf(a, ctx.byId).family.includes(String(b.id)) || signalsOf(b, ctx.byId).family.includes(String(a.id));
}

// What `record` (scoring `row` from rowAt) would add, as fills against
// `state`: { cell, from (the best there), second (the second best), to,
// first (beats the best), pct, beats (the best bottle), beatsPick (an earlier
// suggestion, not an owned bottle), matters, real (matters, in a cell the
// summary names), fades (would matter, but it doesn't last), gain }, those
// that matter first, then most gain.
function fillsOf(gains, row, rowAt, ctx, state, record) {
  const weak = weakLongevity(record);
  return gains.map(({ j, gain }) => {
    const c = ctx.cov[j], to = row[rowAt + j], beats = state.who[j];
    const lifts = to - state.s1[j] >= FILL_MARGIN;
    const deepens = !lifts && thinAt(ctx.ref[j], state.strong[j], state.s2[j]) && to >= ctx.ref[j][STRONG_PCT] && !kin(record, beats, ctx);
    const would = c.cell.weight >= MIN_WEIGHT && (lifts || deepens);
    const fades = would && weak && c.cell.occasion?.performance?.longevity > 0;
    const matters = would && !fades;
    return {
      cell: c.cell, from: state.s1[j], second: state.s2[j], to, first: to > state.s1[j], pct: percentileIn(ctx.ref[j], to),
      beats, beatsPick: state.picks.has(beats), matters, real: matters && Boolean(state.short[j]), fades, gain,
    };
  }).sort((a, b) => b.matters - a.matters || b.real - a.real || b.gain - a.gain);
}

// A suggestion's risk, as a multiplier: a high-risk bottle is never
// suggested (its buy check would say Risky), a medium one counts for less,
// and each reason riskOf lists (doesn't last, hard to find) a little less.
const RISK_MULT = { low: 1, unknown: 1, medium: 0.85, high: 0 };
const RISK_REASON = 0.9;
const riskMult = risk => RISK_MULT[risk.level] * RISK_REASON ** risk.reasons.length;
// A suggestion leaning past the wardrobe's own range (its 10th to 90th
// percentile) counts for less, LEAN_PAST times how far past: allow() lets in
// a wider window, and fresh men's bottles fill a gourmand wardrobe's office
// days so well that at 1 × Brooke's picks went more masculine than anything
// she owns (Ralph's Club New York, 0.23 past, kept 0.77 of its merit).
const LEAN_PAST = 2.5;
const leanMult = (record, ctx) => {
  const lean = genderLean(record, ctx.byId), [lo, hi] = ctx.leanSpan;
  return Math.max(0, 1 - LEAN_PAST * Math.max(0, lo - lean, lean - hi));
};
// Kin of an earlier pick (a family link either way) counts as a near twin.
const PICK_KIN = 0.15;
// Within SAME_SIM of an owned bottle a bottle smells too much alike, whatever
// voters say: the buy check calls it redundant, and it's never suggested.
// (Sauvage EDT and EDP are 0.80 alike, Club de Nuit Intense and Aventus 0.78.)
export const SAME_SIM = 0.8;

/**
 * Gap fillers, greedily: each round takes the candidate whose fills that
 * matter most cut the shortfall in the cells the gap list names (gain),
 * times its quality, risk, lean and novelty, then counts it as owned, so the
 * next pick fills something else, names it as the bottle to beat, and is
 * worth no more than the last. Candidates pass allow() (and the value
 * filter), aren't owned, an owned dupe's original or its twin, discontinued
 * or high risk, and have a named cell they fill. Novelty against the
 * wardrobe (the costly part) is worked out lazily, in order of what a
 * candidate could still be worth. -> [{ record, gain, value, quality,
 * novelty: { mult, sim, nearest, dupe }, fills, twin, risk, shared }]
 */
export function suggest(ctx, { k = 5 } = {}) {
  const { cc: { cells }, table, ref, records, byId } = ctx, m = cells.length;
  const state = ownedState(ctx);
  const meta = records.map((r, i) => {
    if (!allow(r, ctx.allow) || signalsOf(r).flags.includes('discontinued')) return null;
    const dupe = ctx.family.dupeOf(r);
    if (dupe && dupe.mult <= FAMILY_MULT.near) return null;
    const risk = riskOf(r, byId);
    if (!riskMult(risk)) return null;
    const q = candidateQuality(r, ctx.norms, { valueSlope: ctx.valueSlope, byId });
    const mult = q.mult * riskMult(risk) * leanMult(r, ctx);
    return mult ? { i, record: r, risk, q, mult, bound: mult * (dupe?.mult ?? 1), nov: null, out: false } : null;
  }).filter(Boolean);
  // Worked out for candidates that could still win: novelty, and the fills
  // that matter now. The wardrobe only grows, so one with none stays out.
  const judge = mt => {
    mt.nov ??= novelty(mt.record, ctx.vecs, ctx.family);
    if (mt.nov.sim >= SAME_SIM) mt.out = true;
    if (mt.out) return null;
    const fills = fillsOf(cellGains(table, mt.i * m, cells, ref, state.s1, state.s2, state.short), table, mt.i * m, ctx, state, mt.record);
    const gain = fills.reduce((sum, f) => sum + (f.real ? f.gain : 0), 0);
    if (!gain) mt.out = true;
    return gain ? { fills, gain } : null;
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
      if (mt.picked || mt.out) continue;
      const gain = cellGains(table, mt.i * m, cells, ref, state.s1, state.s2, state.short).reduce((sum, g) => sum + g.gain, 0);
      if (gain > 0) options.push({ mt, bound: gain * mt.bound });
    }
    options.sort((a, b) => b.bound - a.bound);
    let best = null;
    for (const o of options) {
      if (best && o.bound <= best.value) break;
      const now = judge(o.mt);
      if (!now) continue;
      const value = now.gain * o.mt.mult * o.mt.nov.mult * pickNovelty(o.mt.record);
      if (value > 0 && (!best || value > best.value)) best = { mt: o.mt, ...now, value };
    }
    if (!best) break;
    const { mt } = best, r = mt.record;
    mt.picked = true;
    addTo(state, table, mt.i * m, r, ctx);
    const near = mt.nov.nearest;
    picks.push({
      record: r,
      gain: best.gain,
      value: best.value,
      quality: mt.q,
      novelty: mt.nov,
      fills: best.fills,
      twin: cheaperTwin(r, byId, ctx.allow),
      risk: mt.risk,
      shared: near ? sharedTraits(r, near.record) : [],
    });
  }
  return picks;
}

// ---------------------------------------------------------------- the buy check

// A strong fit's fills that matter cut the named gaps by STRONG_GAIN or more,
// and by as much as the pool's top STRONG_TOP would (for a thin wardrobe a
// third of the pool fills a real gap).
export const STRONG_GAIN = 0.0015;
export const STRONG_TOP = 0.02;
// Rated under MIN_RATING (the pool's bottom fifth) by RATED_VOTES voters or
// more, a bottle that would fill something is risky, never good.
const RATED_VOTES = 50;
// Under LIKE_SIM alike to everything owned, with no voters' link, nothing owned smells like it.
const LIKE_SIM = 0.5;
// The lean past the wardrobe's own extremes that earns "more masculine than anything you own".
const LEAN_NOTE = 0.1;

/** A rating as the buy check writes it: one decimal, two where one would round it up to MIN_RATING ("only 3.75★", not "3.8★"). */
export const ratingText = rating => rating.toFixed(rating < MIN_RATING && rating.toFixed(1) >= MIN_RATING ? 2 : 1);

// What a strong fit's real gain must reach for a wardrobe: STRONG_GAIN, or
// the pool's top STRONG_TOP of gains, whichever is more. Once per context.
const bars = new WeakMap();
function strongBar(ctx) {
  if (!bars.has(ctx)) {
    const { cc: { cells }, table, ref } = ctx, m = cells.length, state = ownedState(ctx), gains = [];
    ctx.records.forEach((r, i) => {
      if (ctx.allow.owned.has(String(r.id))) return;
      const g = cellGains(table, i * m, cells, ref, state.s1, state.s2, state.short);
      gains.push(g.length ? fillsOf(g, table, i * m, ctx, state, r).reduce((sum, f) => sum + (f.real ? f.gain : 0), 0) : 0);
    });
    gains.sort((a, b) => a - b);
    bars.set(ctx, Math.max(STRONG_GAIN, quantile(gains, 1 - STRONG_TOP) ?? 0));
  }
  return bars.get(ctx);
}

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

// Taste: a bottle adds to a style someone likes when the wardrobe holds
// under STYLE_THIN bottles of it (styleMix: what each bottle leans toward).
// It's in a liked scent style when that's one of its two shown styles;
// Intimate (a wear style) counts on its own only when no scent style is
// liked: beside them it's how they wear, and a quiet aquatic isn't the skin
// scent someone means.
export const STYLE_THIN = 3;
const STYLE_NOUN = {
  skin: 'skin scents', clean: 'clean scents', intimate: 'close-wearing scents', citrus: 'fresh citrus scents', aromatic: 'barbershop scents',
  gourmand: 'gourmands', amber: 'ambers', oud: 'ouds', leather: 'leathers', incense: 'smoky incense scents', whiteFloral: 'white florals',
  floral: 'florals', powdery: 'powdery iris scents', chypre: 'chypres',
};
const styleNoun = id => STYLE_NOUN[id] ?? `${styleById(id).label.toLowerCase()} scents`;
const mixes = new WeakMap(); // ctx -> the wardrobe's style mix
const countWord = n => (n === 0 ? 'none yet' : n === 1 ? 'one' : String(n));

/**
 * What a bottle adds to the styles someone likes (style ids): { styles (its
 * shown scent styles, ids), style (the liked one it adds to, the one the
 * wardrobe holds fewest of; null), owned (how many the wardrobe holds),
 * thin (under STYLE_THIN) }, or null without liked styles.
 */
export function tasteOf(record, ctx, liked) {
  const ids = (liked ?? []).filter(id => styleById(id));
  if (!ids.length) return null;
  if (!mixes.has(ctx)) mixes.set(ctx, styleMix(ctx.owned));
  const mix = mixes.get(ctx), scores = styleScores(record);
  const shown = topOf(scores, 2).map(s => s.id);
  const scent = ids.filter(id => styleById(id).kind === 'scent');
  const hits = scent.length ? scent.filter(id => shown.includes(id)) : closeOf(scores) ? ids : [];
  const owned = id => (styleById(id).kind === 'wear' ? mix.intimate : mix.counts[id]);
  const [style = null] = hits.sort((a, b) => owned(a) - owned(b) || scores[b] - scores[a]);
  return { styles: shown, style, owned: style ? owned(style) : null, thin: style != null && owned(style) < STYLE_THIN };
}

/**
 * Whether a bottle is worth buying for this wardrobe: { verdict: 'Strong fit'
 * | 'Good' | 'Covered' | 'Redundant' | 'Risky', reasons (2–3 short
 * sentences), fills (the ones that matter), gain, realGain, overlap: {
 * bottle, via, sim, link }, risk, twin, quality, taste }. It's scored as its
 * pool row when it has one, else as sameFooting has it, so a catalog record
 * and its pool row check alike. opts.liked: the style ids the person likes
 * (Discover's chips; DEMO_LIKED for David), which tasteOf reads;
 * opts.stated false when they're only what the wardrobe leans toward (the
 * taste line then says "you reach for").
 * In order: Redundant when it duplicates something owned (owned, an owned
 * dupe's original or a twin of one, SAME_SIM alike to an owned bottle, or
 * KIN_SIM alike and placed in an owned bottle's family by voters). Risky
 * when riskOf says high. Covered when nothing it adds matters (the wardrobe
 * already does what it would) and it adds no liked style the wardrobe is
 * thin on (a body mist's style counts only with ctx.allow.mists). Risky when
 * voters rate it under MIN_RATING, or when only its style speaks for it and
 * riskOf has a major warning (not a safe blind buy, divisive). Strong fit
 * when its fills cut the named gaps by strongBar, with quality at or above
 * the pool's usual and low risk, and it isn't a body mist. Good otherwise:
 * it fills something, or brings more of a style you like.
 */
export function buyCheck(record, ctx, { liked = null, stated = true } = {}) {
  const scored = sameFooting(poolRowOf(record, ctx.byId) ?? record);
  const state = ownedState(ctx), cells = ctx.cc.cells;
  const nov = novelty(scored, ctx.vecs, ctx.family);
  const dupe = nov.dupe;
  const mine = dupe?.kind === 'owned';
  const row = fitTable([scored], ctx.cc);
  const all = mine ? [] : fillsOf(cellGains(row, 0, cells, ctx.ref, state.s1, state.s2), row, 0, ctx, state, scored);
  const fills = all.filter(f => f.matters);
  const gain = all.reduce((sum, f) => sum + f.gain, 0);
  const realGain = fills.filter(f => f.real).reduce((sum, f) => sum + f.gain, 0);
  const risk = riskOf(scored, ctx.byId);
  const twin = cheaperTwin(scored, ctx.byId, ctx.allow);
  const q = candidateQuality(scored, ctx.norms, { valueSlope: ctx.valueSlope, byId: ctx.byId });
  // The nearest owned bottle; for an original, the dupe you own rather than itself.
  let near = nov.nearest, sim = nov.sim;
  if (near && String(near.record.id) === String(scored.id)) [near, sim] = [{ record: near.via, via: near.via }, similarity(scored, near.via)];
  const overlap = near && !mine ? { bottle: near.record, via: near.via, sim, link: dupe?.text ?? null } : null;

  const twinOwned = dupe && ['owned', 'original', 'near'].includes(dupe.kind);
  const lookalike = !twinOwned && (nov.sim >= SAME_SIM || (dupe && nov.sim >= KIN_SIM));
  const lowRated = scored.ratingVotes >= RATED_VOTES && scored.rating < MIN_RATING;
  const taste = tasteOf(scored, ctx, liked);
  const mist = signalsOf(scored, ctx.byId).flags.includes('mist');
  // Taste alone (it fills nothing) vouches only for a perfume, as suggestions
  // leave mists out unless asked, and not past a warning that counts double.
  const byTaste = !fills.length && Boolean(taste?.thin) && !(mist && !ctx.allow.mists);
  let verdict;
  if (twinOwned || lookalike) verdict = 'Redundant';
  else if (risk.level === 'high') verdict = 'Risky';
  else if (!fills.length && !byTaste) verdict = 'Covered';
  else if (lowRated || (byTaste && risk.major)) verdict = 'Risky';
  else if (fills.length && realGain >= strongBar(ctx) && q.mult >= 1 && risk.level === 'low' && !mist) verdict = 'Strong fit';
  else verdict = 'Good';

  const nearWho = near && (near.record === near.via ? `your ${near.via.name}` : `${near.record.name}, the original of your ${near.via.name}`);
  const shared = near ? sharedTraits(scored, near.record, 3) : [];
  const overlapLine = dupe ? `${dupe.text}.`
    : nearWho && `Closest to ${nearWho}${shared.length ? `: both ${shared.length > 1 ? `share ${list(shared)}` : `lean on ${shared[0]}`}` : ''}.`;
  const firsts = fills.filter(f => f.first), seconds = fills.filter(f => !f.first);
  const fillLine = firsts.length ? `It would be your best for ${fillsText(firsts)}${realGain ? '' : ', though you’re well stocked there'}.`
    : seconds.length ? `It would be a second strong pick for ${fillsText(seconds)}.` : null;
  const lean = genderLean(scored, ctx.byId), [lo, hi] = ctx.leanRange ?? [-Infinity, Infinity];
  const leanLine = lean < lo - LEAN_NOTE ? 'Voters call it more feminine than anything you own.'
    : lean > hi + LEAN_NOTE ? 'Voters call it more masculine than anything you own.' : null;
  const ratedLine = lowRated ? `Voters rate it only ${ratingText(scored.rating)}★.`
    : scored.ratingVotes ? `Rated ${ratingText(scored.rating)}★ by ${scored.ratingVotes.toLocaleString('en-US')} voters.`
      : 'There’s no crowd data on it yet.';
  // What it adds to the styles you like ("More of the skin scents you like: you own 2."), or why not;
  // styles only guessed from the wardrobe are ones you reach for.
  const styleLabels = taste?.styles.map(id => styleById(id).label.toLowerCase());
  const like = stated ? 'you like' : 'you reach for';
  // Beside scent styles, a liked wear style (Intimate) doesn't count alone
  // (tasteOf), so the line says scent styles, and that it wears close.
  const kinds = new Set((liked ?? []).map(id => styleById(id)?.kind).filter(Boolean));
  const which = kinds.size > 1 ? `scent styles ${like}` : `styles ${like}`;
  const wears = kinds.size > 1 && closeOf(styleScores(scored)) ? 'It wears close, but it’s' : 'It’s';
  // No clear style, but one its page shows as a lean ("Leans skin scent"): say so.
  const [leaning] = taste && !styleLabels.length ? shownOf(styleScores(scored)) : [];
  const leansTo = leaning && `It only leans toward ${styleById(leaning.id).label.toLowerCase()}, ${liked.includes(leaning.id) ? 'one' : 'none'} of the ${which}.`;
  const tasteLine = !taste ? null
    : taste.thin ? `More of the ${styleNoun(taste.style)} ${like}: you own ${countWord(taste.owned)}.`
      : taste.style ? `You own ${taste.owned} ${styleNoun(taste.style)} already.`
        : styleLabels.length ? `${wears} ${list(styleLabels)}, none of the ${which}.` : leansTo || `It isn’t one of the ${which}.`;
  const mistLine = mist ? 'It’s a body mist: lighter and shorter-lived than a perfume.' : null;
  // Why it adds nothing: it fades where it would help, or where it comes
  // closest to the wardrobe's best (in a cell that comes up) it's matched.
  const fades = all.filter(f => f.fades);
  let close = null;
  cells.forEach((cell, j) => {
    const by = row[j] - state.s1[j];
    if (cell.weight >= MIN_WEIGHT && state.who[j] && (!close || by > close.by)) close = { cell, who: state.who[j], by };
  });
  const unlike = nov.sim < LIKE_SIM && !dupe;
  const likeLine = unlike ? 'Nothing you own smells like it.' : overlapLine;
  const coveredLine = fades.length ? `It would be your best for ${fillsText(fades)}, but it doesn’t last long enough for that.`
    : !close ? 'It wouldn’t beat anything you own, in any weather or occasion.'
      : close.by > 0 ? `It would barely beat your ${close.who.name} for ${cellLabel(close.cell)}, and nowhere by more.`
        : `Your ${close.who.name} outdoes it even for ${cellLabel(close.cell)}, where it comes closest.`;

  const reasons = [];
  if (mine) reasons.push('You own it.');
  else if (twinOwned || lookalike) {
    const same = dupe?.via ?? near.via;
    reasons.push(dupe ? `${dupe.text}.` : `It smells ${nov.sim >= 0.9 ? 'nearly the same as' : 'a lot like'} ${nearWho}.`,
      fillLine ? `Still, ${lower(fillLine)}` : `It would add nothing your ${same.name} doesn’t already do.`);
  } else if (verdict === 'Risky') {
    const why = [lowRated && ratedLine, ...risk.reasons].filter(Boolean);
    // Its warning, then what it would add: the style you like, or its fills.
    reasons.push(...(byTaste ? [why[0], tasteLine, likeLine] : [...why.slice(0, 2), fillLine ?? coveredLine]));
  } else if (verdict === 'Covered') {
    reasons.push(coveredLine, tasteLine ?? likeLine, lowRated ? ratedLine : mistLine ?? (tasteLine ? likeLine : (twin && !twin.owned && twin.text) || ratedLine));
  } else {
    reasons.push(fillLine ?? tasteLine, fillLine ? (taste?.thin && tasteLine) || overlapLine : likeLine);
    reasons.push(mistLine || (risk.level === 'medium' && risk.reasons[0]) || leanLine || (twin && !twin.owned && twin.text) || ratedLine);
  }
  return { verdict, reasons: reasons.filter(Boolean).slice(0, 3), fills, gain, realGain, overlap, risk, twin, quality: q, taste };
}

// ---------------------------------------------------------------- plain output

/** A record as a light stub for lists and postMessage. */
export const stub = r => r && {
  id: String(r.id), name: r.name, brand: r.brand, year: r.year ?? null, thumb: r.thumb ?? null, url: r.url ?? null,
  rating: r.rating ?? null, ratingVotes: r.ratingVotes ?? null,
};
const fillJSON = f => ({
  cell: f.cell.id, title: cellLabel(f.cell), from: round(f.from, 3), second: round(f.second, 3), to: round(f.to, 3), first: f.first, pct: f.pct,
  beats: f.beats ? stub(f.beats) : null, beatsPick: f.beatsPick, matters: f.matters, real: f.real, fades: f.fades, gain: round(f.gain, 5),
});
const twinJSON = t => t && { ...stub(t.record), value: t.value, owned: t.owned, text: t.text };

/**
 * The report as plain data (ids, names, numbers and text: JSON and
 * postMessage safe): the cells, each one's coverage (status 'off' for a use
 * set to Never), an overview line, gaps, strengths and k suggestions.
 * `severity` is the whole shortfall, `gapSeverity` the named cells' part,
 * which suggestions cut (`severityAfter`). A suggestion carries its full
 * record, for the app to rank it with the wardrobe for its own reasons.
 */
export function gapReport(ctx, { k = 5, gaps = Infinity } = {}) {
  const picks = suggest(ctx, { k });
  let left = ctx.gapSeverity;
  return {
    preferValue: ctx.preferValue,
    lean: ctx.allow.lean,
    valueSlope: round(ctx.valueSlope, 3),
    severity: round(ctx.severity, 5),
    gapSeverity: round(ctx.gapSeverity, 5),
    overview: overview(ctx.cov, { owned: ctx.owned.length }),
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
  const o = check.overlap, t = check.taste;
  return {
    ...stub(record),
    verdict: check.verdict,
    reasons: check.reasons,
    taste: t ? { styles: t.styles, style: t.style, label: t.style ? styleById(t.style).label : null, owned: t.owned, thin: t.thin } : null,
    gain: round(check.gain, 5),
    fills: check.fills.map(fillJSON),
    overlap: o && { ...stub(o.bottle), via: o.bottle === o.via ? null : stub(o.via), sim: round(o.sim, 3), link: o.link },
    risk: check.risk,
    twin: twinJSON(check.twin),
    quality: { mult: round(check.quality.mult, 3), rating: round(check.quality.rating, 2), keep: round(check.quality.keep, 3), value: round(check.quality.value, 2) },
  };
}
