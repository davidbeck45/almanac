#!/usr/bin/env node
// Same engine as the app, from the terminal.
//   node scripts/recommend.mjs --city "New York" [--occasion date] [--slot day|night] [--json]
//   node scripts/recommend.mjs --loc "40.71,-74.01[,New York]" --exclude "Sauvage,Jake"
//   node scripts/recommend.mjs --city "New York" --week   (day + night plan for the next 7 days)
//   node scripts/recommend.mjs --layer "Liquid Brun"       (what layers with it; --layer all for the best pairs)
//   node scripts/recommend.mjs --layer "Liquid Brun" --city "New York" [--slot night]   (for that weather)
//   node scripts/recommend.mjs --ideal "Amber Empire"     (the temperatures it wears best in)
//   node scripts/recommend.mjs --mix                       (the collection's scent styles, bottle by bottle)
//   node scripts/recommend.mjs --styles "Prada L'Homme"   (one bottle's style scores; any Fragrantica bottle)
//   node scripts/recommend.mjs --style "skin,clean,intimate" [--all] [--lean masculine]   (bottles to buy that are those styles)
//   node scripts/recommend.mjs --more-like "Liquid Brun,Amber Empire"   (bottles to buy that smell like them)
//   node scripts/recommend.mjs --notes "iris leather" [--season winter] [--slot night] [--lean unisex] [--min-value 3.8] [--min-rating 3.6]
//   node scripts/recommend.mjs --dupes "Aventus"           (its original, cheaper alternatives and smell-alikes)
// --journal FILE takes the app's journal export (Export in the wear journal), so
// recent wears rotate out as they do in the app. --top N gives reasons for the
// first N picks. Every bottle in the wardrobe counts, Jake included (these
// answers are for David); --demo leaves out DEFAULT_HIDDEN like the site does
// for a first-time visitor. Bottles hidden in the app live in the phone's
// storage; pass them via --exclude (part of a name is enough).
import { readFileSync, existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { rank, planWindows, comfortRange } from '../src/engine.js';
import { layerPicks, byPick } from '../src/layering.js';
import { OCCASIONS } from '../src/occasions.js';
import { DEFAULT_HIDDEN } from '../src/hidden.js';
import { parseJournal } from '../src/history.js';
import { fetchForecast, summarize, week } from '../src/weather.js';
import { searchCities } from '../src/location.js';
import { STYLES, STYLE_STRONG, WEARS_CLOSE, styleById, styleScores, topOf, leanOf, closeOf, styleMix } from '../src/scent-styles.js';
import { fragranticaLibrary, loadPool, loadPoolStyles, loadAbout } from '../src/fragrantica.js';
import {
  DEMO_LIKED, LEAN_WINDOWS, discoverContext, findStyles, likedStyles, moreOfStyles, defaultSeeds, moreLike, searchNotes,
  dupeIds, dupesOf, whyLine, addCloneVotes,
} from '../src/discover.js';

const SLOTS = ['day', 'night'];
const squash = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');

/** An occasion by id or label, any case or spacing ("date", "Date Night", "night out"), or null. */
export function findOccasion(text) {
  const q = squash(text);
  return OCCASIONS.find(o => squash(o.id) === q || squash(o.label) === q) ?? null;
}

/**
 * Bottles a typed name picks out: an exact name first, else every name that
 * contains it (case and accents aside).
 */
export function matchBottles(fragrances, text) {
  const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const q = norm(text);
  if (!q) return [];
  const exact = fragrances.filter(f => norm(f.name) === q);
  return exact.length ? exact : fragrances.filter(f => norm(f.name).includes(q) || norm(`${f.name} ${f.brand}`).includes(q));
}

// "The week ahead" and "Today" both run in time order: tonight before tomorrow's daytime.
const byTime = (a, b) => a.dateISO.localeCompare(b.dateISO) || SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot);
const sign = r => `${r.tone === 'good' ? '+' : '-'} ${r.text}`;
// "Althaïr (Parfums de Marly)" for a dupe; undefined drops out of the JSON.
const inspiredBy = f => f.original ? `${f.original.name} (${f.original.brand})` : undefined;

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function main() {
  let args;
  try {
    ({ values: args } = parseArgs({
      options: {
        city: { type: 'string' },
        loc: { type: 'string' },
        occasion: { type: 'string' },
        slot: { type: 'string' },
        exclude: { type: 'string', default: '' },
        json: { type: 'boolean', default: false },
        week: { type: 'boolean', default: false },
        layer: { type: 'string' },
        ideal: { type: 'string' },
        journal: { type: 'string' },
        demo: { type: 'boolean', default: false },
        top: { type: 'string', default: '1' },
        mix: { type: 'boolean', default: false },
        styles: { type: 'string' },
        style: { type: 'string' },
        all: { type: 'boolean', default: false },
        'more-like': { type: 'string' },
        notes: { type: 'string' },
        dupes: { type: 'string' },
        season: { type: 'string' },
        lean: { type: 'string' },
        'min-value': { type: 'string' },
        'min-rating': { type: 'string' },
      },
    }));
  } catch (err) {
    fail(`${err.message}\n${USAGE}`);
  }

  const slot = args.slot?.toLowerCase();
  if (args.slot && !SLOTS.includes(slot)) fail(`--slot must be day or night, not "${args.slot}"`);
  const occasion = args.occasion ? findOccasion(args.occasion) : null;
  if (args.occasion && !occasion) {
    fail(`Unknown occasion "${args.occasion}". Pick one of: ${OCCASIONS.map(o => `${o.id} (${o.label})`).join(', ')}`);
  }
  const top = Number(args.top);
  if (!Number.isInteger(top) || top < 0) fail(`--top takes a whole number, not "${args.top}"`);

  let fragrances = JSON.parse(readFileSync(new URL('../data/collection.json', import.meta.url))).fragrances
    .map(f => ({ ...f, id: String(f.id) }));
  if (args.demo) fragrances = fragrances.filter(f => !DEFAULT_HIDDEN.includes(f.id));
  for (const term of args.exclude.split(',').map(s => s.trim()).filter(Boolean)) {
    const hits = matchBottles(fragrances, term);
    if (!hits.length) console.error(`--exclude "${term}" matches no bottle; nothing left out for it`);
    else if (hits.length > 1) console.error(`--exclude "${term}" leaves out ${hits.map(f => f.name).join(', ')}`);
    fragrances = fragrances.filter(f => !hits.includes(f));
  }

  let history = [];
  if (args.journal) {
    let journal = null;
    try { journal = parseJournal(JSON.parse(readFileSync(args.journal, 'utf8'))); } catch {}
    if (!journal) fail(`${args.journal} isn't a Scentcast journal export (the wear journal's Export button)`);
    history = journal.history.filter(h => !h.planned);
  }

  const findBottle = name => {
    const hits = matchBottles(fragrances, name);
    if (!hits.length) fail(`No bottle matches "${name}"`);
    if (hits.length > 1) console.error(`"${name}" matches ${hits.map(f => f.name).join(', ')}; using ${hits[0].name}. Give more of the name for another.`);
    return hits[0];
  };

  async function resolvePlace() {
    if (args.loc) {
      // LAT,LON[,Name], like the app's ?loc=.
      const [latS, lonS, ...name] = args.loc.split(',');
      const num = s => (s?.trim() ? Number(s) : NaN);
      const lat = num(latS), lon = num(lonS);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
        fail(`--loc takes LAT,LON in degrees and an optional name, like 40.71,-74.01,New York (got "${args.loc}")`);
      }
      return { name: name.join(',').trim() || `${lat},${lon}`, lat, lon };
    }
    let hit;
    try {
      [hit] = await searchCities(args.city);
    } catch (err) {
      fail(`Couldn't look up "${args.city}" (${err.message}). Check the connection, or pass --loc LAT,LON.`);
    }
    if (!hit) fail(`No city found for "${args.city}"`);
    return { name: `${hit.name}, ${hit.region}`, lat: hit.lat, lon: hit.lon };
  }

  async function forecastFor(place) {
    try {
      return await fetchForecast(place);
    } catch (err) {
      fail(`Couldn't get the forecast from Open-Meteo (${err.message}). Check the connection and try again.`);
    }
  }

  // Partners for one bottle, or the best pairs overall. The weather is optional:
  // with a place, pairs are scored for the next window (or --slot).
  if (args.layer) {
    let win = null;
    if (args.city || args.loc) {
      const wx = summarize(await forecastFor(await resolvePlace()));
      win = slot ? wx[slot] : [wx.day, wx.night].filter(Boolean).sort(byTime)[0];
    }
    const pairLine = (a, p) => `${a.name} + ${p.fragrance.name} (${Math.round(p.score * 100)}%): ${p.reasons.map(r => r.text).join('; ')}. Spray ${p.first.name} first.`;
    let rows;
    if (args.layer.toLowerCase() === 'all') {
      // Each direction discounts the partner's all-round pairing, so keeping the
      // lower of the two discounts both bottles.
      const pairs = new Map();
      for (const f of fragrances) {
        for (const p of layerPicks(f, fragrances, Infinity, win)) {
          const key = [f.id, p.fragrance.id].sort().join('+');
          if (!pairs.has(key) || pairs.get(key).pair.rank > p.rank) pairs.set(key, { base: f, pair: p });
        }
      }
      rows = [...pairs.values()].sort((x, y) => byPick(x.pair, y.pair)).slice(0, 10);
    } else {
      const base = findBottle(args.layer);
      rows = layerPicks(base, fragrances, 5, win).map(pair => ({ base, pair }));
    }
    if (args.json) {
      console.log(JSON.stringify(rows.map(({ base, pair }) => ({
        bottle: base.name,
        partner: pair.fragrance.name,
        brand: pair.fragrance.brand,
        inspiredBy: inspiredBy(pair.fragrance),
        score: +pair.score.toFixed(3),
        ...(pair.community && { parfumo: { consensus: pair.community.consensus, ...(pair.community.via && { votedOn: pair.community.via }) } }),
        ...(pair.offWeather && { offWeather: true }),
        sprayFirst: pair.first.name,
        reasons: pair.reasons.map(sign),
        ...(win && { window: { label: win.label, feelsF: Math.round(win.feelsF), humidity: Math.round(win.humidity), condition: win.condition } }),
      })), null, 2));
    } else {
      if (win) console.log(`${win.label}: ${win.condition}, feels ${Math.round(win.feelsF)}°F, ${Math.round(win.humidity)}% humidity\n`);
      console.log(rows.length ? rows.map(({ base, pair }) => pairLine(base, pair)).join('\n') : 'Nothing in the collection layers well with it.');
    }
    return;
  }

  // The feels-like range a bottle suits on its own, and where it makes the top 3
  // of this collection by day and by night (clear sky, comfortable dew point,
  // whatever the time of year, like the range itself).
  if (args.ideal) {
    const f = findBottle(args.ideal);
    const SCAN = [0, 105];
    const runs = temps => temps.reduce((out, t) => {
      const last = out.at(-1);
      if (last && last[1] === t - 1) last[1] = t;
      else out.push([t, t]);
      return out;
    }, []).map(([lo, hi]) => ({ lowF: lo === SCAN[0] ? null : lo, highF: hi === SCAN[1] ? null : hi }));
    const topPick = {};
    for (const s of SLOTS) {
      const temps = [];
      for (let feelsF = SCAN[0]; feelsF <= SCAN[1]; feelsF++) {
        const ranked = rank(fragrances, { feelsF, humidity: 50, dewF: 55, category: 'clear', date: null }, s, { todayISO: '2000-01-01' });
        if (ranked.slice(0, 3).some(r => r.fragrance.id === f.id)) temps.push(feelsF);
      }
      topPick[s] = runs(temps);
    }
    const range = comfortRange(f);
    if (args.json) {
      console.log(JSON.stringify({ name: f.name, brand: f.brand, inspiredBy: inspiredBy(f), range, topPick }, null, 2));
    } else {
      const span = ({ lowF, highF }) => lowF === null && highF === null ? 'any temperature'
        : lowF === null ? `${highF}°F and colder` : highF === null ? `${lowF}°F and warmer` : `${lowF}–${highF}°F`;
      console.log(`${f.name} (${f.brand}) wears best at ${span(range)} feels-like${range.bestF !== null ? `, peaking around ${range.bestF}°F` : ''}.`);
      for (const s of SLOTS) {
        console.log(`  Top 3 in this collection by ${s}: ${topPick[s].length ? topPick[s].map(span).join(', ') : 'never'}`);
      }
    }
    return;
  }

  // The collection's style mix: how many bottles lean each way (each bottle's
  // leanOf, listed per bottle), and which wear close.
  if (args.mix) {
    const scores = new Map(fragrances.map(f => [f.id, styleScores(f)]));
    const mix = styleMix(fragrances, f => scores.get(f.id));
    const nameOf = new Map(fragrances.map(f => [f.id, f.name]));
    const rows = STYLES.filter(s => s.kind === 'scent')
      .map(s => ({ id: s.id, label: s.label, count: mix.counts[s.id], bottles: mix.ids[s.id].map(id => nameOf.get(id)) }))
      .sort((a, b) => b.count - a.count);
    const bottles = fragrances.map(f => ({
      name: f.name,
      brand: f.brand,
      styles: leanOf(scores.get(f.id)),
      wearsClose: closeOf(scores.get(f.id)),
    }));
    if (args.json) {
      console.log(JSON.stringify({ total: mix.total, mix: rows, wearsClose: mix.intimateIds.map(id => nameOf.get(id)), bottles }, null, 2));
    } else {
      const width = Math.max(...rows.map(r => r.label.length));
      console.log(`Style mix of ${mix.total} bottles (each bottle's top two styles):`);
      for (const r of rows.filter(r => r.count)) console.log(`  ${r.label.padEnd(width)}  ${String(r.count).padStart(2)}  ${r.bottles.join(', ')}`);
      console.log(`  None: ${rows.filter(r => !r.count).map(r => r.label).join(', ') || '-'}`);
      console.log(`Wears close: ${mix.intimate ? mix.intimateIds.map(id => nameOf.get(id)).join(', ') : 'none'}\n`);
      for (const b of bottles) {
        const styles = b.styles.length ? b.styles.map(s => `${s.label} ${s.score.toFixed(2)}`).join(', ') : 'no clear style';
        console.log(`${b.name} (${b.brand}): ${styles}${b.wearsClose ? ' · wears close' : ''}`);
      }
    }
    return;
  }

  // One bottle's style scores: the collection first, then the Fragrantica dataset.
  if (args.styles) {
    let [f] = matchBottles(fragrances, args.styles);
    if (!f) {
      const dir = new URL('../data/fragrantica/', import.meta.url);
      const library = fragranticaLibrary(async path => {
        const file = new URL(path, dir);
        return existsSync(file) ? readFileSync(file, 'utf8') : null;
      });
      const [hit] = await library.search(args.styles, 1);
      if (hit) f = (await library.records([hit.id])).get(hit.id);
    }
    if (!f) fail(`No bottle matches "${args.styles}"`);
    const scores = styleScores(f);
    if (args.json) {
      console.log(JSON.stringify({
        name: f.name,
        brand: f.brand,
        source: f.source === 'fragrantica' ? 'dataset' : 'collection',
        styles: topOf(scores),
        wearsClose: closeOf(scores),
        scores,
      }, null, 2));
    } else {
      console.log(`${f.name} (${f.brand})${f.source === 'fragrantica' ? ', from the Fragrantica dataset' : ''}`);
      const width = Math.max(...STYLES.map(s => s.label.length));
      const shown = new Set(topOf(scores).map(s => s.id));
      for (const r of topOf(scores, Infinity, 0.15)) {
        const tags = [shown.has(r.id) && 'shown', r.score >= STYLE_STRONG && 'strong'].filter(Boolean).join(', ');
        console.log(`  ${r.label.padEnd(width)}  ${r.score.toFixed(2)}${tags ? `  ${tags}` : ''}`);
      }
      console.log(`  ${styleById('intimate').label.padEnd(width)}  ${scores.intimate.toFixed(2)}  ${closeOf(scores) ? 'wears close' : `wears close from ${WEARS_CLOSE.toFixed(2)}`}`);
    }
    return;
  }

  if (args.style || args['more-like'] || args.notes || args.dupes) {
    const count = process.argv.some(a => /^--top(=|$)/.test(a)) ? top : 10;
    if (count < 1) fail('--top takes 1 or more for --style, --more-like, --notes and --dupes');
    await discover(args, fragrances, { slot, count, history });
    return;
  }

  if (!args.city && !args.loc) fail(USAGE);

  const place = await resolvePlace();
  const forecast = await forecastFor(place);
  const pickJSON = (pick, ranked) => ({
    tier: pick.tier,
    name: pick.fragrance.name,
    brand: pick.fragrance.brand,
    inspiredBy: inspiredBy(pick.fragrance),
    score: +pick.score.toFixed(3),
    reasons: pick.reasons.map(sign),
    runnerUp: ranked.find(r => r !== pick)?.fragrance.name ?? null,
  });
  const why = pick => pick.reasons.filter(r => r.tone === 'good').map(r => r.text).join('; ') || pick.reasons.map(r => r.text).join('; ');

  // A plan for the week: day and night, or only the occasion's (or --slot's) windows.
  if (args.week) {
    const days = week(forecast);
    const wanted = slot ?? occasion?.slot ?? null;
    const windows = days.flatMap(d => [d.day, d.night].filter(w => w && (!wanted || w.slot === wanted)));
    const plan = planWindows(fragrances, windows, { occasion, history });
    const pickFor = win => plan.find(p => p.win === win);
    const rows = days.map(d => ({ day: d, slots: [d.day, d.night].filter(w => w && windows.includes(w)).map(pickFor) }))
      .filter(r => r.slots.length);
    if (args.json) {
      console.log(JSON.stringify({
        place,
        occasion: occasion?.id ?? null,
        days: rows.map(({ day, slots }) => ({
          date: day.dateISO,
          name: day.name,
          hiF: Math.round(day.hiF),
          loF: Math.round(day.loF),
          condition: day.condition,
          rainChance: day.pop,
          picks: slots.map(({ win, pick, ranked }) => ({ slot: win.slot, feelsF: Math.round(win.feelsF), ...pickJSON(pick, ranked) })),
        })),
      }, null, 2));
    } else {
      console.log(`${place.name} · the week ahead${occasion ? ` · occasion: ${occasion.label}` : ''}`);
      for (const { day, slots } of rows) {
        console.log(`\n${day.name} ${day.dateISO}: ${day.condition}, ${Math.round(day.hiF)}°/${Math.round(day.loF)}°F${day.pop >= 30 ? `, ${day.pop}% rain` : ''}`);
        for (const { win, pick } of slots) {
          console.log(`  ${win.slot === 'day' ? 'day  ' : 'night'} ${String(Math.round(win.feelsF)).padStart(3)}°F  ${pick.tier}  ${pick.fragrance.name} (${pick.fragrance.brand}): ${why(pick)}`);
        }
      }
    }
    return;
  }

  // Today's windows in time order. Without an occasion or --slot they're
  // planned together like the app's Today, so the night doesn't repeat the day.
  const wx = summarize(forecast);
  const result = slot || occasion
    ? [wx[slot ?? occasion.slot]].filter(Boolean).map(win => {
      const ranked = rank(fragrances, win, win.slot, { occasion, history });
      return { win, ranked, pick: ranked[0] };
    })
    : planWindows(fragrances, [wx.day, wx.night].filter(Boolean).sort(byTime), { history });

  if (args.json) {
    console.log(JSON.stringify({
      place,
      now: wx.now,
      occasion: occasion?.id ?? null,
      slots: result.map(({ win, ranked, pick }) => ({
        slot: win.slot,
        window: { label: win.label, date: win.dateISO, feelsF: Math.round(win.feelsF), humidity: Math.round(win.humidity), dewF: Math.round(win.dewF), condition: win.condition, rainChance: win.pop },
        pick: pickJSON(pick, ranked),
        ranked: ranked.map(r => ({ tier: r.tier, name: r.fragrance.name, brand: r.fragrance.brand, inspiredBy: inspiredBy(r.fragrance), score: +r.score.toFixed(3), reasons: r.reasons.map(sign) })),
      })),
    }, null, 2));
  } else {
    console.log(`${place.name} · now ${Math.round(wx.now.tempF)}°F ${wx.now.label}${occasion ? ` · occasion: ${occasion.label}` : ''}`);
    for (const { win, ranked, pick } of result) {
      console.log(`\n${win.label}: ${win.condition}, feels ${Math.round(win.feelsF)}°F, ${Math.round(win.humidity)}% humidity${win.pop >= 30 ? `, ${win.pop}% rain` : ''}`);
      for (const tier of ['S', 'A', 'B', 'C']) {
        const rows = ranked.filter(r => r.tier === tier);
        if (rows.length) console.log(`  ${tier}  ${rows.map(r => r.fragrance.name).join(', ')}`);
      }
      const shown = [pick, ...ranked.filter(r => r !== pick)].slice(0, Math.max(1, top));
      for (const [i, r] of shown.entries()) {
        console.log(`  ${i ? ' ' : '→'} ${r.fragrance.name} (${r.fragrance.brand}${r.fragrance.original ? `, inspired by ${inspiredBy(r.fragrance)}` : ''}): ${r.reasons.map(sign).join('; ')}`);
      }
    }
  }
}

// Discover (src/discover.js): bottles to buy from the suggestion pool, for
// the wardrobe as it stands (--exclude and --demo apply).
const fromDisk = async path => {
  const file = new URL(`../data/fragrantica/${path}`, import.meta.url);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
};
const SEASON_NAMES = ['winter', 'spring', 'summer', 'fall'];

async function discover(args, fragrances, { slot, count, history }) {
  const seasons = args.season ? args.season.toLowerCase().split(',').map(s => s.trim().replace(/^autumn$/, 'fall')).filter(Boolean) : null;
  for (const s of seasons ?? []) if (!SEASON_NAMES.includes(s)) fail(`--season takes ${SEASON_NAMES.join(', ')} (comma separated), not "${s}"`);
  const lean = args.lean?.toLowerCase();
  if (lean && !LEAN_WINDOWS[lean]) fail(`--lean takes ${Object.keys(LEAN_WINDOWS).join(', ')}, not "${args.lean}"`);
  const minValue = args['min-value'] == null ? null : Number(args['min-value']);
  if (minValue != null && !(minValue >= 1 && minValue <= 5)) fail(`--min-value takes a value-for-money score from 1 to 5, not "${args['min-value']}"`);
  const minRating = args['min-rating'] == null ? undefined : Number(args['min-rating']);
  if (minRating !== undefined && !(minRating >= 0 && minRating <= 5)) fail(`--min-rating takes a Fragrantica rating from 0 to 5, not "${args['min-rating']}"`);
  // A style query sets its own rating floor (the style's), unless one is given.
  const filters = { seasons, slot: slot ?? null, lean: lean ?? null, minValue, ...(minRating !== undefined && { minRating }) };

  const [pool, styles] = await Promise.all([loadPool(fromDisk), loadPoolStyles(fromDisk)]);
  const ctx = discoverContext(pool, fragrances, { styles });
  const library = fragranticaLibrary(fromDisk);
  // A typed name: the wardrobe first, then the pool, then the whole dataset (with its about data).
  const findAny = async name => {
    const mine = matchBottles(fragrances, name);
    if (mine.length > 1) console.error(`"${name}" matches ${mine.map(f => f.name).join(', ')}; using ${mine[0].name}. Give more of the name for another.`);
    if (mine.length) return mine[0];
    const [hit] = await library.search(name, 1);
    if (!hit) return null;
    const record = ctx.byId.get(hit.id) ?? (await library.records([hit.id])).get(hit.id);
    return record && { ...record, about: await loadAbout(hit.id, fromDisk) };
  };

  const line = (r, extra) => [r.name, r.brand, r.year, r.rating ? `${r.rating.toFixed(2)}★` : null,
    extra.value != null ? `value ${extra.value.toFixed(1)}` : null].filter(Boolean).join(' · ');
  const named = r => ({ id: r.id, name: r.name, brand: r.brand });
  const pickJSON = p => ({
    id: p.id,
    name: p.record.name,
    brand: p.record.brand,
    year: p.record.year,
    url: p.record.url,
    rating: p.rating,
    votes: p.votes,
    value: p.value,
    score: +p.score.toFixed(3),
    styles: p.styles.map(s => s.label),
    wearsClose: p.close,
    ...(p.via && { via: p.via }),
    ...(p.matched && { matched: p.matched }),
    ...(p.shares && { shares: p.shares }),
    ...(p.alsoLiked != null && { alsoLiked: p.alsoLiked }),
    smellsLike: p.clonesOf && { ...named(p.clonesOf), smellsLikeVotes: p.clonesOf.up == null ? null : [p.clonesOf.up, p.clonesOf.down] },
    closestOwned: p.nearest && { name: p.nearest.name, through: p.nearest.through, similarity: +p.nearest.sim.toFixed(2), shares: p.nearest.traits },
    family: p.family,
    risk: p.risk,
    cheaperTwin: p.twin ? `${p.twin.record.name} (${p.twin.record.brand})` : null,
    twins: (p.alike ?? []).map(named),
    why: whyLine(p),
  });
  const print = async (title, picks, json) => {
    // What each clone pick copies, with the votes saying so.
    for (const p of picks) if (p.clonesOf) addCloneVotes(p, await loadAbout(p.id, fromDisk));
    if (args.json) return console.log(JSON.stringify({ ...json, results: picks.map(pickJSON) }, null, 2));
    console.log(title);
    if (!picks.length) console.log('  Nothing in the pool passes. Try fewer filters.');
    picks.forEach((p, i) => console.log(`${String(i + 1).padStart(2)}. ${line(p.record, p)} · ${whyLine(p)}`));
    console.log('\nFrom Le Decanteur\'s Fragrantica dataset (CC BY-NC-SA 4.0), 9,600 well-voted bottles.');
  };

  if (args.style) {
    let ids;
    if (args.style.trim().toLowerCase() === 'liked') {
      // The styles David loves, else (none of them left in the wardrobe) what it leans toward.
      ids = likedStyles(fragrances, { stated: DEMO_LIKED }).map(s => s.id);
      if (!ids.length) ids = likedStyles(fragrances).map(s => s.id);
    } else {
      const found = findStyles(args.style);
      if (found.unknown.length) fail(`No style called ${found.unknown.map(u => `"${u}"`).join(', ')}. Styles: ${STYLES.map(s => s.label).join(', ')}, or "liked"`);
      ids = found.ids;
    }
    if (!ids.length) fail(`Name a style: ${STYLES.map(s => s.label).join(', ')}, or "liked"`);
    const mode = args.all ? 'all' : 'any';
    const picks = moreOfStyles(ids, ctx, { mode, k: count, filters });
    const labels = ids.map(id => styleById(id).label);
    await print(`More ${labels.join(args.all ? ' + ' : ', ')}${ids.length > 1 ? ` (${mode === 'all' ? 'all at once' : 'any of them'})` : ''}:`, picks, { styles: ids, mode, filters });
    return;
  }

  if (args['more-like']) {
    let seeds;
    if (args['more-like'].trim().toLowerCase() === 'favorites') {
      const today = new Date().toISOString().slice(0, 10);
      ({ seeds } = defaultSeeds(fragrances, { history, todayISO: today }));
    } else {
      seeds = [];
      for (const name of args['more-like'].split(',').map(s => s.trim()).filter(Boolean)) {
        const seed = await findAny(name);
        if (!seed) fail(`No bottle matches "${name}"`);
        seeds.push(seed);
      }
    }
    if (!seeds.length) fail('Name a bottle to find more like it, or "favorites"');
    const picks = moreLike(seeds, ctx, { k: count, filters });
    await print(`More like ${seeds.map(s => s.name).join(' + ')}:`, picks, { seeds: seeds.map(s => s.name), filters });
    return;
  }

  if (args.notes) {
    const { terms, unknown, corrected, suggested, results } = searchNotes(args.notes, ctx, filters, { k: count });
    if (unknown.length) fail(`No note or accord called ${unknown.map(u => `"${u}"`).join(', ')}`);
    if (!terms.length) fail('Name a note or accord, like "iris leather" or "fig"');
    for (const c of corrected) console.error(`Reading "${c.from}" as "${c.to}".`);
    for (const c of suggested) console.error(`Few bottles list "${c.from}"; did you mean "${c.to}"?`);
    await print(`Bottles with ${terms.join(' + ')}:`, results, { query: args.notes, terms, corrected, suggested, filters });
    return;
  }

  // The dupe explorer: --dupes NAME.
  const record = await findAny(args.dupes);
  if (!record) fail(`No bottle matches "${args.dupes}"`);
  const more = await library.records(dupeIds(record, ctx));
  for (const r of more.values()) r.about = await loadAbout(r.id, fromDisk);
  const family = dupesOf(record, ctx, { more });
  const entryJSON = e => e && ({ id: e.id, name: e.name, brand: e.brand, rating: e.rating, votes: e.votes, value: e.value, similarity: e.sim, risk: e.risk.level,
    owned: e.owned, smellsLikeVotes: e.up == null ? null : [e.up, e.down], why: e.why, ...(e.notesDiffer && { notesDiffer: true }), ...(e.built != null && { built: e.built }) });
  if (args.json) {
    console.log(JSON.stringify({ name: record.name, brand: record.brand, original: entryJSON(family.original),
      cheaper: family.cheaper.map(entryJSON), siblings: family.siblings.map(entryJSON) }, null, 2));
    return;
  }
  const says = n => (n === 1 ? 'says' : 'say');
  const entryLine = e => `${line(e, e)}${e.sim != null ? ` · ${Math.round(100 * e.sim)}% alike` : ''}`
    + `${e.up != null ? ` · ${e.up} ${says(e.up)} it smells like it, ${e.down} not` : ''}${e.why === 'notes' ? ' · alike by notes' : ''}`
    + `${e.notesDiffer ? ' · notes differ' : ''}${e.risk.level !== 'low' ? ` · ${e.risk.level} risk` : ''}${e.owned ? ' · you own it' : ''}`;
  const section = (title, list) => {
    if (!list.length) return;
    console.log(`\n${title}:`);
    for (const e of list.slice(0, count)) console.log(`  ${entryLine(e)}`);
  };
  console.log(`${record.name} (${record.brand})`);
  if (family.original) console.log(`Inspired by: ${entryLine(family.original)}${family.original.built ? '' : ' (going by the votes)'}`);
  section('Smells like it for far less', family.cheaper);
  section('Voters say these smell like it', family.siblings);
  if (!family.original && !family.cheaper.length && !family.siblings.length) console.log('No smells-like votes for it.');
  console.log('\nFrom Le Decanteur\'s Fragrantica dataset (CC BY-NC-SA 4.0).');
}

const USAGE = `usage: node scripts/recommend.mjs (--city NAME | --loc LAT,LON[,NAME]) [--occasion ${OCCASIONS.map(o => o.id).join('|')}] [--slot day|night] [--week] [--journal FILE] [--exclude NAME,NAME] [--demo] [--top N] [--json]
       node scripts/recommend.mjs --layer NAME|all [--city NAME | --loc LAT,LON[,NAME]] [--slot day|night] [--exclude NAME,NAME] [--json]
       node scripts/recommend.mjs --ideal NAME [--exclude NAME,NAME] [--json]
       node scripts/recommend.mjs --mix [--exclude NAME,NAME] [--demo] [--json]
       node scripts/recommend.mjs --styles NAME [--json]
       node scripts/recommend.mjs (--style STYLE,STYLE|liked [--all] | --more-like NAME,NAME|favorites | --notes "NOTE NOTE") [--season S,S] [--slot day|night] [--lean feminine|unisex|masculine] [--min-value V] [--min-rating R] [--top N] [--exclude NAME,NAME] [--json]
       node scripts/recommend.mjs --dupes NAME [--top N] [--json]`;

if (import.meta.main) await main();
