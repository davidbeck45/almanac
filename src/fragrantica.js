// Every Fragrantica perfume, from Le Decanteur's dataset (CC BY-NC-SA 4.0),
// built into data/fragrantica/ by scripts/decant.py. The app searches it
// after the demo and catalog, and loads a bottle's record when it's added or
// opens from a share link. Ids are Fragrantica's, like the demo's.
import { barWidth } from './accords.js';
import { normalize, nameMatches } from './collections.js';
import { predictedShares } from './custom.js';

const SHARDS = 512;
// As scripts/decant.py: words too common to split the index by.
const STOP = new Set('de la le les des du di el en et by of the and for pour eau parfum parfums perfume perfumes edp edt'.split(' '));
// Note weights are 100 × (votes / the top note's votes) ^ 1.61; layering reads relative votes.
const NOTE_WEIGHT_POWER = 1.61;
const GENDER = { f: 'women', m: 'men', u: 'women and men' };
const NOTE_TIERS = { t: 'top', m: 'mid', b: 'base', f: 'all' };
const SEASONS = ['winter', 'spring', 'summer', 'fall'];

const round3 = x => Math.round(x * 1000) / 1000;
const thumbOf = id => `https://fimgs.net/mdimg/perfume-thumbs/dark-m.${id}.2x.webp`;

/** One row of data/fragrantica/r/*.json -> engine record (same shape as data/collection.json). */
export function fromFragrantica(id, row) {
  const accords = Object.fromEntries(Object.entries(row.a).map(([a, s]) => [a, barWidth(s)]));
  const like = row.k ? { season: Object.fromEntries(SEASONS.map((s, i) => [s, row.k[i]])), night: row.k[4] } : null;
  const notes = {}, weights = {};
  for (const [tier, list] of Object.entries(row.no ?? {})) {
    notes[NOTE_TIERS[tier]] = Object.keys(list);
    Object.assign(weights, list);
  }
  const record = {
    id: String(id),
    source: 'fragrantica',
    name: row.n,
    brand: row.b,
    year: row.y ?? null,
    gender: GENDER[row.g] ?? null,
    url: `https://www.fragrantica.com/perfume/${row.s}-${id}.html`,
    thumb: thumbOf(id),
    rating: row.r?.[0] ?? 0,
    ratingVotes: row.r?.[1] ?? 0,
    accords,
    notes,
  };
  // Bottles nobody has voted on yet carry the estimate, like hand-entered ones.
  const [winter, spring, summer, fall, day, night] = row.v ?? [0, 0, 0, 0, 0, 0];
  const seasonVotes = { winter, spring, summer, fall }, n = winter + spring + summer + fall;
  const est = predictedShares(accords, like);
  if (n) {
    record.seasonVotes = seasonVotes;
    record.timeVotes = { day, night };
  }
  record.season = n ? Object.fromEntries(SEASONS.map(s => [s, round3(seasonVotes[s] / n)])) : est.season;
  const nightShare = day + night ? night / (day + night) : est.night;
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

/**
 * Search and records over data/fragrantica/. `load(path)` resolves a file's
 * text, or null when there's none (tests read the files from disk).
 */
export function fragranticaLibrary(load = defaultLoad) {
  const files = new Map();
  const get = path => {
    if (!files.has(path)) files.set(path, load(path).catch(err => { files.delete(path); throw err; }));
    return files.get(path);
  };

  // Matches as light records for the result list ({ id, name, brand, year,
  // thumb, stub }): bottles whose whole name was typed first, then the most
  // voted. Without a bottle matching every word, ones missing a single word
  // ("MFK Baccarat Rouge 540", a typo). `records` loads the full ones.
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
      const [id, name, brand, year] = line.split('\t');
      const hay = normalize(`${name} ${brand}`);
      const missed = words.filter(w => !hay.includes(w)).length;
      if (!missed || (missed === 1 && words.length > 1)) {
        (missed ? near : full).push({ id, name, brand, year: Number(year) || null, thumb: thumbOf(id), stub: true });
      }
    }
    const hits = full.length ? full : near;
    const whole = hits.filter(h => nameMatches(query, h));
    return [...whole, ...hits.filter(h => !whole.includes(h))].slice(0, limit);
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

async function defaultLoad(path) {
  let res;
  try {
    res = await fetch(`data/fragrantica/${path}`);
  } catch {
    throw new Error('Can’t reach fragrance search. Check your connection.');
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Search failed (${res.status}).`);
  return res.text();
}
