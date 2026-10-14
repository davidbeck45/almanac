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
//   node scripts/recommend.mjs --gaps [--city X] [--uses "office=often,formal=never"] [--value | --no-value] [--top N]
//                                                         (what the wardrobe is missing, and bottles that fill it)
//   node scripts/recommend.mjs --check "Shalimar Millesime Tonka"   (whether a bottle is worth buying; name or id)
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
import { fragranticaLibrary } from '../src/fragrantica.js';
import { loadPool, fromPool, loadAbout } from '../src/fragrantica.js';
import { gapContext, gapReport, buyCheck, checkJSON, cellLabel, DEFAULT_CLIMATE, USES, useLabel } from '../src/gaps.js';
import { fetchClimate } from '../src/climate.js';
import { parseUses, sharesFrom } from '../src/uses.js';

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

// data/fragrantica/ from disk, for the dataset's loaders.
const DATASET = new URL('../data/fragrantica/', import.meta.url);
const datasetFile = async path => {
  const file = new URL(path, DATASET);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
};

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
        top: { type: 'string' },
        mix: { type: 'boolean', default: false },
        styles: { type: 'string' },
        gaps: { type: 'boolean', default: false },
        check: { type: 'string' },
        uses: { type: 'string' },
        value: { type: 'boolean', default: false },
        'no-value': { type: 'boolean', default: false },
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
  const top = Number(args.top ?? 1);
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

  // What the wardrobe is missing and what would fill it (src/gaps.js), or
  // whether one bottle is worth buying. The climate is the place's (--city or
  // --loc: one archive call) or, without one, the ten temperate cities'.
  if (args.gaps || args.check) {
    if (args.value && args['no-value']) fail('Pass --value or --no-value, not both');
    let shares = null;
    if (args.uses) {
      try {
        shares = sharesFrom(parseUses(args.uses));
      } catch (err) {
        fail(`--uses: ${err.message}`);
      }
    }
    let summary = DEFAULT_CLIMATE, where = 'the ten temperate cities (default)';
    if (args.city || args.loc) {
      const place = await resolvePlace();
      const climate = await fetchClimate(place.lat, place.lon);
      if (climate.local) [summary, where] = [climate.summary, place.name];
      else console.error(`Couldn't get the climate for ${place.name} (${climate.error}); using the default climate.`);
    }
    const parsed = await loadPool(datasetFile);
    const records = Array.from({ length: parsed.count }, (_, i) => fromPool(parsed, i));
    const byId = new Map(records.map(r => [r.id, r]));
    const preferValue = args.value ? true : args['no-value'] ? false : null;
    const ctx = gapContext({ owned: fragrances, records, byId, summary, shares, preferValue });
    const pct = x => `${Math.round(x * 100)}%`;
    const stars = r => `${r.rating.toFixed(1)}★ from ${r.ratingVotes.toLocaleString('en-US')} votes`;
    const byLine = r => `${r.name} by ${r.brand}${r.year ? ` (${r.year})` : ''}`;
    const fillLine = f => (!f.beats ? `${f.title}: ${pct(f.to)}`
      : f.first ? `${f.title}: ${pct(f.to)}, over your ${f.beats.name} at ${pct(f.from)}`
        : `${f.title}: ${pct(f.to)} as a second pick, behind your ${f.beats.name} at ${pct(f.from)}`);
    const valueText = `prefer great value: ${ctx.preferValue ? 'on (only bottles voters value 3.8+)' : 'off'}`;

    if (args.check) {
      const q = args.check.trim();
      let record = null;
      if (/^\d+$/.test(q)) record = byId.get(q) ?? (await fragranticaLibrary(datasetFile).records([q])).get(q) ?? null;
      else {
        const hits = matchBottles(records, q).sort((a, b) => b.ratingVotes - a.ratingVotes);
        if (hits.length > 1) {
          console.error(`"${q}" matches ${hits.length} bottles (${hits.slice(0, 4).map(byLine).join('; ')}${hits.length > 4 ? '…' : ''}); checking the most voted. Give more of the name, or its id, for another.`);
        }
        record = hits[0] ?? null;
        if (!record) {
          const library = fragranticaLibrary(datasetFile);
          const [hit] = await library.search(q, 1);
          record = hit ? (await library.records([hit.id])).get(hit.id) : matchBottles(fragrances, q)[0] ?? null;
        }
      }
      if (!record) fail(`No bottle matches "${q}"`);
      // Outside the pool, a bottle's signals come from its about data.
      if (!record.extras && /^\d+$/.test(record.id) && !byId.has(record.id)) {
        const about = await loadAbout(record.id, datasetFile);
        if (about) record = { ...record, about };
      }
      const check = buyCheck(record, ctx);
      if (args.json) {
        console.log(JSON.stringify({ climate: where, preferValue: ctx.preferValue, ...checkJSON(record, check) }, null, 2));
        return;
      }
      console.log(`${byLine(record)} · ${stars(record)}`);
      console.log(`${check.verdict}`);
      for (const r of check.reasons) console.log(`  ${r}`);
      if (check.fills.length) console.log(`Fills:\n${check.fills.slice(0, 5).map(f => `  ${fillLine({ ...f, title: cellLabel(f.cell) })}`).join('\n')}`);
      if (check.overlap) {
        const o = check.overlap;
        console.log(`Closest: ${o.bottle === o.via ? `your ${o.via.name}` : `${o.bottle.name}, the original of your ${o.via.name}`} (${o.sim.toFixed(2)} alike)${o.link ? `. ${o.link}.` : ''}`);
      }
      console.log(`Risk: ${check.risk.level}${check.risk.reasons.length ? ` (${check.risk.reasons.join(' ')})` : ''}`);
      if (check.twin) console.log(`Twin: ${check.twin.text}`);
      console.log(`\nClimate: ${where} · ${valueText}`);
      return;
    }

    const k = args.top === undefined ? 5 : top;
    const report = gapReport(ctx, { k });
    if (args.json) {
      const picks = report.picks.map(({ record, ...p }) => ({ ...p, fills: p.fills.filter(f => f.matters) }));
      console.log(JSON.stringify({ climate: where, bottles: fragrances.length, ...report, picks }, null, 2));
      return;
    }
    const STATUS = { gap: 'gap', thin: 'thin', covered: 'room to grow' };
    const shareText = USES.map(u => `${useLabel(u)} ${pct(shares?.[u.id] ?? u.share)}`).join(', ');
    console.log(`${fragrances.length} bottles · climate: ${where} · ${valueText}`);
    console.log(`How you wear: ${shareText}`);
    console.log('\nStrengths');
    for (const s of report.strengths) console.log(`  ${s.text}`);
    if (!report.strengths.length) console.log('  Nothing is deep yet.');
    console.log('\nGaps, most costly first');
    for (const g of report.gaps) console.log(`  ${g.title} (${STATUS[g.status]})\n    ${g.text}`);
    if (!report.gaps.length) console.log('  None worth naming.');
    console.log('\nTo fill them (each counts as owned before the next)');
    report.picks.forEach((p, i) => {
      const facts = [stars(p), p.quality.value != null && `value ${p.quality.value.toFixed(1)}`, `${p.risk.level} risk`].filter(Boolean);
      console.log(`  ${i + 1}. ${byLine(p)} · ${facts.join(' · ')}`);
      for (const f of p.fills.filter(f => f.matters).slice(0, 4)) console.log(`     ${fillLine(f)}`);
      const near = p.nearest;
      if (p.dupe) console.log(`     ${p.dupe}.`);
      else if (near) console.log(`     Closest: ${near.via ? `${near.name}, the original of your ${near.via.name}` : `your ${near.name}`} (${near.sim.toFixed(2)} alike)${p.shared.length ? `, sharing ${p.shared.join(', ')}` : ''}`);
      if (p.twin) console.log(`     Twin: ${p.twin.text}`);
      if (p.risk.reasons.length) console.log(`     Risk: ${p.risk.reasons.join(' ')}`);
    });
    if (!report.picks.length) console.log('  Nothing in the pool would add enough.');
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

const USAGE = `usage: node scripts/recommend.mjs (--city NAME | --loc LAT,LON[,NAME]) [--occasion ${OCCASIONS.map(o => o.id).join('|')}] [--slot day|night] [--week] [--journal FILE] [--exclude NAME,NAME] [--demo] [--top N] [--json]
       node scripts/recommend.mjs --layer NAME|all [--city NAME | --loc LAT,LON[,NAME]] [--slot day|night] [--exclude NAME,NAME] [--json]
       node scripts/recommend.mjs --ideal NAME [--exclude NAME,NAME] [--json]
       node scripts/recommend.mjs --mix [--exclude NAME,NAME] [--demo] [--json]
       node scripts/recommend.mjs --styles NAME [--json]
       node scripts/recommend.mjs --gaps [--city NAME | --loc LAT,LON[,NAME]] [--uses USE=never|sometimes|often,…] [--value | --no-value] [--top N] [--exclude NAME,NAME] [--demo] [--json]
       node scripts/recommend.mjs --check NAME|ID [--city NAME | --loc LAT,LON[,NAME]] [--uses …] [--value | --no-value] [--json]`;

if (import.meta.main) await main();
