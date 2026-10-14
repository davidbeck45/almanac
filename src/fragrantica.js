// Every Fragrantica perfume, from Le Decanteur's dataset (CC BY-NC-SA 4.0),
// built into data/fragrantica/ by scripts/decant.py. The app searches it
// after the demo and catalog, and loads a bottle's record when it's added or
// opens from a share link. Ids are Fragrantica's, like the demo's. The
// suggestion pool (loadPool, fromPool) and a bottle's about data (loadAbout)
// load on demand.
import { barWidth, barStrength } from './accords.js';
import { normalize, nameMatches } from './collections.js';
import { predictedShares } from './custom.js';

const SHARDS = 512;
// As scripts/decant.py: words too common to split the index by.
const STOP = new Set('de la le les des du di el en et by of the and for pour eau parfum parfums perfume perfumes edp edt'.split(' '));
// Note weights are 100 × (votes / the top note's votes) ^ 1.61; layering reads relative votes.
const NOTE_WEIGHT_POWER = 1.61;
const GENDER = { f: 'women', m: 'men', u: 'women and men' };
const NOTE_TIERS = { t: 'top', m: 'mid', b: 'base', f: 'all' };
const NOTE_TIER_KEYS = ['t', 'm', 'b', 'f'];
const SEASONS = ['winter', 'spring', 'summer', 'fall'];
// Search: a bottle whose whole name was typed ranks as if it had WHOLE_LIFT
// times its votes plus WHOLE_FLOOR: a new bottle typed exactly still leads
// hits with a few dozen votes, a 0-vote clone none with more.
const WHOLE_LIFT = 50;
const WHOLE_FLOOR = 1;

const round3 = x => Math.round(x * 1000) / 1000;

/**
 * A brand written in capitals ("MAISON ASRAR", "ALREHAB PERFUMES") in title
 * case, as scripts/build_collection.py brand_case (Python's str.title); short
 * acronyms (BDK, YSL) stay. The dataset's files keep them as Fragrantica has
 * them.
 */
export function brandCase(brand) {
  if (typeof brand !== 'string' || brand !== brand.toUpperCase() || brand === brand.toLowerCase() || brand.replace(/ /g, '').length <= 4) return brand;
  return brand.toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (_, before, letter) => before + letter.toUpperCase());
}
const thumbOf = id => `https://fimgs.net/mdimg/perfume-thumbs/dark-m.${id}.2x.webp`;

// Words a note keeps in lowercase past its first ("Fleur de Sel").
const SMALL_WORDS = new Set('de of la le du des and the et di da'.split(' '));
/**
 * A note written all in lowercase ("oak moss", "elemi", "ylang-ylang") in
 * title case, as Fragrantica writes most ("Oak Moss"), as
 * scripts/build_collection.py note_case does; others stay as they are.
 */
export function noteCase(note) {
  if (typeof note !== 'string' || note !== note.toLowerCase()) return note;
  return note.split(/([ -])/).map((w, i) => (i && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join('');
}

/** One row of data/fragrantica/r/*.json -> engine record (same shape as data/collection.json). */
export function fromFragrantica(id, row) {
  const accords = Object.fromEntries(Object.entries(row.a).map(([a, s]) => [a, barWidth(s)]));
  const like = row.k ? { season: Object.fromEntries(SEASONS.map((s, i) => [s, row.k[i]])), night: row.k[4] } : null;
  const notes = {}, weights = {};
  for (const [tier, list] of Object.entries(row.no ?? {})) {
    notes[NOTE_TIERS[tier]] = Object.keys(list).map(noteCase);
    for (const [note, w] of Object.entries(list)) weights[noteCase(note)] = w;
  }
  const record = {
    id: String(id),
    source: 'fragrantica',
    name: row.n,
    brand: brandCase(row.b),
    year: row.y ?? null,
    gender: GENDER[row.g] ?? null,
    url: `https://www.fragrantica.com/perfume/${row.s}-${id}.html`,
    thumb: thumbOf(id),
    rating: row.r?.[0] ?? 0,
    ratingVotes: row.r?.[1] ?? 0,
    accords,
    notes,
  };
  // Bottles nobody has voted on yet carry the estimate, like hand-entered ones
  // (worked out only then: most rows have votes).
  const [winter, spring, summer, fall, day, night] = row.v ?? [0, 0, 0, 0, 0, 0];
  const seasonVotes = { winter, spring, summer, fall }, n = winter + spring + summer + fall;
  let est = null;
  const estimate = () => (est ??= predictedShares(accords, like));
  if (n) record.seasonVotes = seasonVotes;
  if (day + night) record.timeVotes = { day, night };
  record.season = n ? Object.fromEntries(SEASONS.map(s => [s, round3(seasonVotes[s] / n)])) : estimate().season;
  const nightShare = day + night ? night / (day + night) : estimate().night;
  record.dayNight = { day: round3(1 - nightShare), night: round3(nightShare) };
  if (Object.values(weights).some(w => w > 0)) {
    record.noteVotes = Object.fromEntries(Object.entries(weights).filter(([, w]) => w > 0)
      .map(([note, w]) => [note, Math.round(1000 * (w / 100) ** (1 / NOTE_WEIGHT_POWER))]));
  }
  if (row.l && row.si) {
    record.performance = { longevity: row.l[0], sillage: row.si[0], votes: Math.min(row.l[1], row.si[1]) };
  }
  if (like) record.like = like;
  return record;
}

// As scripts/decant.py FLAGS: bit i of a pool or about row's flags.
export const FLAGS = ['discontinued', 'reformulated', 'notBlindBuy', 'brigaded', 'polarizing', 'hardToFind', 'mist'];
const flagNames = bits => FLAGS.filter((_, i) => bits & (1 << i));
// Fragrantica's usual page slug, as scripts/decant.py slug_of; the pool lists the rest.
const slugPart = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
const pooled = new WeakMap();

/**
 * Bottle `i` of the suggestion pool (data/fragrantica/pool.json, from
 * loadPool) -> engine record. It goes through fromFragrantica, so it scores as
 * the bottle's r/ row would (rating, Fragrantica longevity/sillage and the
 * smells-like shares are rounded to 2 decimals, the longevity and sillage
 * vote counts to 2 significant digits). Its signals ride along as
 * `extras` (see scripts/decant.py); its strongest notes too, when
 * pool-notes.json loaded.
 */
export function fromPool(pool, i) {
  if (!pooled.has(pool)) pooled.set(pool, []);
  const memo = pooled.get(pool);
  if (memo[i]) return memo[i];
  const c = pool.cols, id = c.id[i], name = c.n[i], brand = pool.brands[c.b[i]];
  const row = {
    s: pool.slugs[id] ?? `${slugPart(brand)}/${slugPart(name)}`,
    n: name,
    b: brand,
    y: c.y[i] || undefined,
    g: c.g[i] || undefined,
    r: [c.r[i] / 100, c.rv[i]],
    a: Object.fromEntries(c.a[i].map((a, j) => [pool.accords[a], barStrength(c.w[i][j])])),
  };
  if (c.v[i].length) row.v = c.v[i];
  if (c.l[i] && c.si[i]) [row.l, row.si] = [[c.l[i] / 100, c.lv[i]], [c.si[i] / 100, c.lv[i]]];
  if (c.k[i].length) row.k = c.k[i].map(x => x / 100);
  const notes = pool.noteList?.no[i];
  if (notes?.length) {
    row.no = {};
    for (let j = 0; j < notes.length; j += 2) {
      const tier = NOTE_TIER_KEYS[notes[j] & 3];
      // Tenths of the top note's votes, back into the dataset's weight.
      (row.no[tier] ??= {})[pool.noteList.notes[notes[j] >> 2]] = 100 * (notes[j + 1] / 10) ** NOTE_WEIGHT_POWER;
    }
  }
  const record = fromFragrantica(id, row);
  record.extras = {
    value: c.val[i] ? c.val[i] / 100 : null,
    safe: c.safe[i],
    keep: c.keep[i] == null ? null : c.keep[i] / 1000,
    lean: c.lean[i] == null ? null : c.lean[i] / 100,
    now: c.now[i],
    // The pool lists family links past the top 3 after them; a bit marks each family one.
    like: c.like[i].slice(0, 3),
    family: c.like[i].filter((_, j) => c.fam[i] & (1 << j)),
    alt: c.alt[i],
    flags: flagNames(c.f[i]),
    // Owners as 4 × log2(1 + owners), whole: back to about 2 significant digits.
    owners: c.o ? Math.round(2 ** (c.o[i] / 4) - 1) : null,
    reach: c.rc && c.rc[i] >= 0 ? c.rc[i] / 100 : null,
  };
  return (memo[i] = record);
}

// Per loader: each file's parsed contents, fetched once.
const loaded = new WeakMap();
function cached(load) {
  if (!loaded.has(load)) loaded.set(load, new Map());
  const files = loaded.get(load);
  return (path, parse = text => text) => {
    if (!files.has(path)) files.set(path, load(path).then(text => (text == null ? null : parse(text))).catch(err => { files.delete(path); throw err; }));
    return files.get(path);
  };
}

/**
 * The suggestion pool with its notes, fetched once: { count, brands, accords,
 * slugs, cols, noteList, index: Map of id -> row }. fromPool(pool, i) makes
 * the records. `load` as fragranticaLibrary's.
 */
const pools = new WeakMap();
export function loadPool(load = defaultLoad) {
  if (!pools.has(load)) {
    const get = cached(load);
    const pool = Promise.all([get('pool.json', JSON.parse), get('pool-notes.json', JSON.parse)]).then(([pool, noteList]) => {
      if (!pool) throw new Error('No suggestion pool.');
      return { ...pool, noteList: noteList?.count === pool.count ? noteList : null, index: new Map(pool.cols.id.map((id, i) => [String(id), i])) };
    });
    pools.set(load, pool.catch(err => { pools.delete(load); throw err; }));
  }
  return pools.get(load);
}

/** A pool's ids as one short hash (FNV-1a), which pool-styles.json carries to say which pool it was made for. */
export function poolKey(pool) {
  let h = 0x811c9dc5;
  for (const ch of pool.cols.id.join(',')) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
  return (h >>> 0).toString(16);
}

/**
 * The pool's style scores (data/fragrantica/pool-styles.json, written by
 * scripts/fit-pool-styles.mjs), fetched once: { styles: [ids], min, check, s:
 * per pool row [style index, score × 100, …] }, or null when there's no file,
 * it can't be fetched or it was made for another pool (score the records live
 * then). Rejects only when the pool itself can't load.
 */
export async function loadPoolStyles(load = defaultLoad) {
  const [pool, styles] = await Promise.all([loadPool(load), cached(load)('pool-styles.json', JSON.parse).catch(() => null)]);
  return styles?.count === pool.count && styles.key === poolKey(pool) ? styles : null;
}

/**
 * What a dataset bottle's page shows beyond its record (data/fragrantica/x/),
 * readable keys as data/extras.jsonl has them, or null for bottles under 30
 * votes. AI pros and cons are Fragrantica members' summary: quote them so.
 */
export async function loadAbout(id, load = defaultLoad) {
  if (!/^\d+$/.test(String(id))) return null;
  const shard = await cached(load)(`x/${Number(id) % SHARDS}.json`, JSON.parse);
  const x = shard?.[id];
  if (!x) return null;
  const zip = (keys, values) => Object.fromEntries(keys.map((k, i) => [k, values[i]]));
  return {
    sentiment: zip(['hate', 'dislike', 'ok', 'like', 'love'], x.h),
    ...(x.pv && { value: { avg: x.pv[0], votes: x.pv[1] } }),
    ...(x.o && { owners: zip(['have', 'had', 'want'], x.o) }),
    ...(x.cg && { crowdGender: { lean: x.cg[0], votes: x.cg[1] } }),
    ...(x.p && { popularity: { all: x.p[0], recent: x.p[1] } }),
    perfumers: x.pf ?? [],
    line: x.c ?? null,
    pros: (x.pr ?? []).map(([text, up, down]) => ({ text, up, down })),
    cons: (x.co ?? []).map(([text, up, down]) => ({ text, up, down })),
    smellsLike: (x.sm ?? []).map(([id, up, down]) => ({ id, up, down })),
    alsoLiked: x.al ?? [],
    flags: flagNames(x.f ?? 0),
  };
}

/**
 * Search and records over data/fragrantica/. `load(path)` resolves a file's
 * text, or null when there's none (tests read the files from disk).
 */
export function fragranticaLibrary(load = defaultLoad) {
  const get = cached(load);

  // Matches as light records for the result list ({ id, name, brand, year,
  // thumb, stub }): bottles whose whole name was typed first, then the most
  // voted. A whole-name hit far less voted than another hit doesn't lead (it
  // counts WHOLE_LIFT times its votes): a 0-vote clone named "Baccarat Rouge"
  // follows MFK's Baccarat Rouge 540. Without a bottle matching every word,
  // ones missing a single word ("MFK Baccarat Rouge 540", a typo). `records`
  // loads the full ones.
  async function search(query, limit = 8) {
    const words = normalize(query).split(' ').filter(w => w.length > 1);
    if (!words.length) return [];
    const byLength = [...words].sort((a, b) => b.length - a.length);
    const key = (byLength.find(w => !STOP.has(w)) ?? byLength[0]).slice(0, 2);
    const text = await get(`i/${key}.tsv`);
    if (!text) return [];
    const full = [], near = [];
    for (const line of text.split('\n')) {
      if (!line) continue;
      const [id, name, brand, year, votes] = line.split('\t');
      const hay = normalize(`${name} ${brand}`);
      const missed = words.filter(w => !hay.includes(w)).length;
      if (!missed || (missed === 1 && words.length > 1)) {
        const hit = { id, name, brand: brandCase(brand), year: Number(year) || null, thumb: thumbOf(id), stub: true };
        (missed ? near : full).push({ hit, votes: Number(votes) || 0 });
      }
    }
    const rankOf = ({ hit, votes }) => (nameMatches(query, hit) ? (votes + WHOLE_FLOOR) * WHOLE_LIFT : votes);
    return (full.length ? full : near).map(h => ({ ...h, rank: rankOf(h) }))
      .sort((a, b) => b.rank - a.rank || b.votes - a.votes)
      .slice(0, limit).map(h => h.hit);
  }

  // Map of id -> record for the ids the dataset has.
  async function records(ids) {
    const byShard = new Map();
    for (const id of ids.filter(id => /^\d+$/.test(id))) {
      const shard = Number(id) % SHARDS;
      byShard.set(shard, [...(byShard.get(shard) ?? []), id]);
    }
    const out = new Map();
    await Promise.all([...byShard].map(async ([shard, wanted]) => {
      const text = await get(`r/${shard}.json`);
      const rows = text ? JSON.parse(text) : {};
      for (const id of wanted) if (rows[id]) out.set(id, fromFragrantica(id, rows[id]));
    }));
    return out;
  }

  return { search, records };
}

// Resolved against this module, not the page, so it works from a module Worker too.
async function defaultLoad(path) {
  let res;
  try {
    res = await fetch(new URL(`../data/fragrantica/${path}`, import.meta.url));
  } catch {
    throw new Error('Can’t reach the fragrance library. Check your connection.');
  }
  if (res.status === 404) return null;
  // The status is for debugging, not for the sentence people read.
  if (!res.ok) throw Object.assign(new Error('The fragrance library didn’t load. Try again.'), { detail: `HTTP ${res.status}` });
  return res.text();
}
