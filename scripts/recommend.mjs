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
//   node scripts/recommend.mjs --city Miami --date 2026-10-24 [--occasion date]   (any date: forecast, else typical weather)
//   node scripts/recommend.mjs --pack --city London --from 2026-12-10 --to 2026-12-19 [--max 3] [--events "2026-12-15 night formal"]
//   node scripts/recommend.mjs --spray "Liquid Brun" [--city X] [--occasion date]   (how many sprays, and where)
// --journal FILE takes the app's journal export (Export in the wear journal), so
// recent wears rotate out as they do in the app. --top N gives reasons for the
// first N picks. Every bottle in the wardrobe counts, Jake included (these
// answers are for David); --demo leaves out DEFAULT_HIDDEN like the site does
// for a first-time visitor. Bottles hidden in the app live in the phone's
// storage; pass them via --exclude (part of a name is enough). A journal
// export also carries his own ratings and skin nudges, and turns on the
// rotation nudge (a bottle unworn for a month takes a slot it nearly wins).
import { readFileSync, existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { rank, planWindows, comfortRange } from '../src/engine.js';
import { layerPicks, byPick } from '../src/layering.js';
import { OCCASIONS } from '../src/occasions.js';
import { DEFAULT_HIDDEN } from '../src/hidden.js';
import { parseJournal } from '../src/history.js';
import { fetchForecast, summarize, week, tripWindows } from '../src/weather.js';
import { searchCities } from '../src/location.js';
import { STYLES, STYLE_STRONG, WEARS_CLOSE, styleById, styleScores, topOf, leanOf, closeOf, styleMix } from '../src/scent-styles.js';
import { fragranticaLibrary } from '../src/fragrantica.js';
import { applySkin } from '../src/skin.js';
import { packTrip, withEvents, picksFor } from '../src/pack.js';
import { sprayGuide } from '../src/spray.js';

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

const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s ?? '') && !Number.isNaN(Date.parse(`${s}T12:00:00Z`))
  && new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s;
const localToday = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const daysFrom = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
const SHORT = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const shortDate = iso => SHORT.format(new Date(`${iso}T12:00:00Z`));
// The longest trip --pack plans, and how far ahead (typical weather needs past years' dates).
const MAX_TRIP_DAYS = 31;
const MAX_AHEAD_DAYS = 365;

/**
 * --events "2026-10-20 night formal; 2026-10-21 date night" -> [{ dateISO,
 * slot, occasion }]. Each is a date, then an occasion (id or label), with an
 * optional day or night before it; without one the occasion's own slot.
 * Throws with a message for the user.
 */
export function parseEvents(text) {
  return String(text ?? '').split(';').map(s => s.trim()).filter(Boolean).map(part => {
    const [dateISO, ...rest] = part.split(/\s+/);
    if (!isDate(dateISO)) throw new Error(`--events: "${part}" doesn't start with a date (YYYY-MM-DD)`);
    // "night out" is an occasion; "night formal" is a slot and one.
    let occasion = findOccasion(rest.join(' '));
    let slot = occasion?.slot;
    if (!occasion && SLOTS.includes(rest[0]?.toLowerCase())) {
      slot = rest[0].toLowerCase();
      occasion = findOccasion(rest.slice(1).join(' '));
    }
    if (!occasion) throw new Error(`--events: no occasion in "${part}". Pick one of: ${OCCASIONS.map(o => o.id).join(', ')}`);
    return { dateISO, slot, occasion };
  });
}

// Standard situations for --spray without a place.
const SPRAY_SITUATIONS = [
  { label: 'Hot, sticky day', slot: 'day', feelsF: 90, humidity: 65, dewF: 72, category: 'clear' },
  { label: 'Mild day', slot: 'day', feelsF: 66, humidity: 55, dewF: 50, category: 'clear' },
  { label: 'Cold night', slot: 'night', feelsF: 32, humidity: 65, dewF: 22, category: 'clear' },
];
const sprayJSON = g => ({ sprays: g.sprays, where: g.where, text: g.text, why: g.why, ...(g.note && { note: g.note }) });

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
        date: { type: 'string' },
        pack: { type: 'boolean', default: false },
        from: { type: 'string' },
        to: { type: 'string' },
        max: { type: 'string', default: '3' },
        events: { type: 'string' },
        spray: { type: 'string' },
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
  const today = localToday();
  for (const key of ['date', 'from', 'to']) {
    if (args[key] !== undefined && !isDate(args[key])) fail(`--${key} takes a date like ${today}, not "${args[key]}"`);
  }
  if (args.date && args.date < today) fail(`--date ${args.date} has passed; pick today or later`);
  if (args.date && daysFrom(today, args.date) > MAX_AHEAD_DAYS) fail(`--date ${args.date} is more than a year out`);
  if (args.date && args.week) fail('--date picks for one day; leave out --week');

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
    fragrances = applySkin(fragrances, journal.skin);
  }
  // With a journal, a bottle left unworn for a month takes a slot it nearly wins.
  const nudge = history.length > 0;

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

  // What to pack for a trip: the fewest bottles that keep every window's pick
  // near the top, then which to wear when. Forecast as far as it reaches,
  // typical weather for the dates past it.
  if (args.pack) {
    if (!args.city && !args.loc) fail('--pack needs a place: --city NAME or --loc LAT,LON');
    if (!args.from || !args.to) fail(`--pack needs --from and --to, like --from ${today} --to ${today}`);
    if (args.to < args.from) fail(`--to ${args.to} comes before --from ${args.from}`);
    if (args.from < today) fail(`--from ${args.from} has passed; pick today or later`);
    if (daysFrom(args.from, args.to) >= MAX_TRIP_DAYS) fail(`--pack plans up to ${MAX_TRIP_DAYS} days at a time`);
    if (daysFrom(today, args.to) > MAX_AHEAD_DAYS) fail(`--to ${args.to} is more than a year out`);
    const max = Number(args.max);
    if (!Number.isInteger(max) || max < 1 || max > 6) fail(`--max takes 1 to 6 bottles, not "${args.max}"`);
    let events;
    try { events = parseEvents(args.events); } catch (err) { fail(err.message); }
    for (const e of events) if (e.dateISO < args.from || e.dateISO > args.to) fail(`--events: ${e.dateISO} is outside the trip`);

    const place = await resolvePlace();
    let windows;
    try {
      windows = await tripWindows(place, args.from, args.to);
    } catch (err) {
      fail(`Couldn't get the weather from Open-Meteo (${err.message}). Check the connection and try again.`);
    }
    windows = withEvents(windows, events);
    const trip = packTrip(fragrances, windows, { max });
    const weather = w => ({ source: w.typical ? 'typical' : 'forecast', feelsF: Math.round(w.feelsF), humidity: Math.round(w.humidity), dewF: Math.round(w.dewF), condition: w.condition, rainChance: w.pop });
    if (args.json) {
      console.log(JSON.stringify({
        place,
        from: args.from,
        to: args.to,
        text: trip.text,
        bottles: trip.bottles.map(b => ({ name: b.record.name, brand: b.record.brand, inspiredBy: inspiredBy(b.record), covers: b.covers.length, wears: b.wears, why: b.why })),
        plan: trip.plan.map(p => ({
          date: p.window.dateISO,
          slot: p.window.slot,
          occasion: p.occasion?.id ?? null,
          weather: weather(p.window),
          pick: p.pick.name,
          tier: p.tier,
          score: +p.score.toFixed(3),
          top: p.top.record.name,
          topScore: +p.top.score.toFixed(3),
          covered: p.covered,
          reasons: p.reasons.map(sign),
          spray: sprayJSON(sprayGuide(p.pick, p.window, p.occasion)),
        })),
        uncovered: trip.uncovered.map(u => ({ date: u.window.dateISO, slot: u.window.slot, occasion: u.occasion?.id ?? null, best: u.best.name, score: +u.score.toFixed(3) })),
      }, null, 2));
    } else {
      console.log(`${place.name} · ${shortDate(args.from)} to ${shortDate(args.to)} · ${windows.length} windows${windows.some(w => w.typical) ? ' (typical weather past the forecast)' : ''}`);
      console.log(`\n${trip.text}\n`);
      for (const b of trip.bottles) console.log(`  ${b.record.name} (${b.record.brand}${b.record.original ? `, inspired by ${inspiredBy(b.record)}` : ''}): ${b.why}`);
      console.log('');
      for (const p of trip.plan) {
        const w = p.window;
        const top = p.top.record === p.pick ? '' : `  (top: ${p.top.record.name}${p.covered ? '' : ', not packed'})`;
        console.log(`  ${shortDate(w.dateISO).padEnd(11)} ${w.slot.padEnd(5)} ${String(Math.round(w.feelsF)).padStart(3)}°F ${(w.typical ? `typically ${w.condition.toLowerCase()}` : w.condition).padEnd(24)} ${p.pick.name}${p.occasion ? ` · ${p.occasion.label}` : ''}${top}`);
      }
    }
    return;
  }

  // How many sprays and where: for the next window (or --date, --slot) at a
  // place, else for a hot day, a mild day and a cold night.
  if (args.spray) {
    const f = findBottle(args.spray);
    let situations;
    if (args.city || args.loc) {
      const place = await resolvePlace();
      const wanted = slot ?? occasion?.slot;
      if (args.date) {
        try {
          situations = await tripWindows(place, args.date, args.date, { slots: wanted ? [wanted] : SLOTS });
        } catch (err) {
          fail(`Couldn't get the weather from Open-Meteo (${err.message}). Check the connection and try again.`);
        }
      } else {
        const wx = summarize(await forecastFor(place));
        situations = (wanted ? [wx[wanted]] : [wx.day, wx.night].sort(byTime)).filter(Boolean);
      }
    } else {
      situations = SPRAY_SITUATIONS;
    }
    const rows = situations.map(win => ({ win, guide: sprayGuide(f, win, occasion) }));
    const describeWin = win => (win.dateISO ? `${win.label} ${win.dateISO}: ${win.typical ? 'typically ' : ''}${win.condition.toLowerCase()}, feels ${Math.round(win.feelsF)}°F` : win.label);
    if (args.json) {
      console.log(JSON.stringify({
        name: f.name,
        brand: f.brand,
        occasion: occasion?.id ?? null,
        situations: rows.map(({ win, guide }) => ({ label: win.label, ...(win.dateISO && { date: win.dateISO, slot: win.slot, feelsF: Math.round(win.feelsF), typical: !!win.typical }), ...sprayJSON(guide) })),
      }, null, 2));
    } else {
      console.log(`${f.name} (${f.brand})${occasion ? ` · ${occasion.label}` : ''}`);
      for (const { win, guide } of rows) console.log(`  ${describeWin(win)}\n    ${guide.text}${guide.note ? ` ${guide.note}` : ''}`);
    }
    return;
  }

  if (!args.city && !args.loc) fail(USAGE);

  const place = await resolvePlace();
  const pickJSON = (pick, ranked, win, occ = null) => ({
    tier: pick.tier,
    name: pick.fragrance.name,
    brand: pick.fragrance.brand,
    inspiredBy: inspiredBy(pick.fragrance),
    score: +pick.score.toFixed(3),
    reasons: pick.reasons.map(sign),
    runnerUp: ranked.find(r => r !== pick)?.fragrance.name ?? null,
    spray: sprayJSON(sprayGuide(pick.fragrance, win, occ)),
  });
  const why = pick => pick.reasons.filter(r => r.tone === 'good').map(r => r.text).join('; ') || pick.reasons.map(r => r.text).join('; ');
  // One window's ranking, as JSON and as text under a heading.
  const slotJSON = ({ win, ranked, pick }) => ({
    slot: win.slot,
    window: { label: win.label, date: win.dateISO, feelsF: Math.round(win.feelsF), humidity: Math.round(win.humidity), dewF: Math.round(win.dewF), condition: win.condition, rainChance: win.pop, ...(win.typical && { typical: true }) },
    pick: pickJSON(pick, ranked, win, occasion),
    ranked: ranked.map(r => ({ tier: r.tier, name: r.fragrance.name, brand: r.fragrance.brand, inspiredBy: inspiredBy(r.fragrance), score: +r.score.toFixed(3), reasons: r.reasons.map(sign) })),
  });
  const printSlot = ({ win, ranked, pick }, heading) => {
    console.log(`\n${heading}`);
    for (const tier of ['S', 'A', 'B', 'C']) {
      const rows = ranked.filter(r => r.tier === tier);
      if (rows.length) console.log(`  ${tier}  ${rows.map(r => r.fragrance.name).join(', ')}`);
    }
    const shown = [pick, ...ranked.filter(r => r !== pick)].slice(0, Math.max(1, top));
    for (const [i, r] of shown.entries()) {
      console.log(`  ${i ? ' ' : '→'} ${r.fragrance.name} (${r.fragrance.brand}${r.fragrance.original ? `, inspired by ${inspiredBy(r.fragrance)}` : ''}): ${r.reasons.map(sign).join('; ')}`);
      if (!i) console.log(`    Spray: ${sprayGuide(r.fragrance, win, occasion).text}`);
    }
  };

  // One date anywhere: the forecast's windows, or typical weather past them.
  if (args.date) {
    const wanted = slot ?? occasion?.slot;
    let result;
    try {
      result = wanted
        ? [await picksFor(fragrances, { place, dateISO: args.date, slot: wanted, occasion, history, nudge })].filter(Boolean)
          .map(({ window: win, ranked }) => ({ win, ranked, pick: ranked[0] }))
        : planWindows(fragrances, await tripWindows(place, args.date, args.date), { history, nudge });
    } catch (err) {
      fail(`Couldn't get the weather from Open-Meteo (${err.message}). Check the connection and try again.`);
    }
    if (!result.length) fail(`No weather came back for ${args.date}`);
    const typical = result.some(r => r.win.typical);
    if (args.json) {
      console.log(JSON.stringify({
        place,
        date: args.date,
        weather: typical ? 'typical' : 'forecast',
        occasion: occasion?.id ?? null,
        slots: result.map(slotJSON),
      }, null, 2));
    } else {
      console.log(`${place.name} · ${shortDate(args.date)}${typical ? ' · typical weather for the date (past the forecast)' : ''}${occasion ? ` · occasion: ${occasion.label}` : ''}`);
      for (const r of result) {
        const win = r.win;
        printSlot(r, `${win.slot === 'day' ? 'Day' : 'Night'}: ${win.typical ? 'typically ' : ''}${win.condition.toLowerCase()}, feels ${Math.round(win.feelsF)}°F, ${Math.round(win.humidity)}% humidity${win.pop >= 30 ? `, ${win.pop}% ${win.typical ? 'of years wet' : 'rain'}` : ''}`);
      }
    }
    return;
  }

  const forecast = await forecastFor(place);

  // A plan for the week: day and night, or only the occasion's (or --slot's) windows.
  if (args.week) {
    const days = week(forecast);
    const wanted = slot ?? occasion?.slot ?? null;
    const windows = days.flatMap(d => [d.day, d.night].filter(w => w && (!wanted || w.slot === wanted)));
    const plan = planWindows(fragrances, windows, { occasion, history, nudge });
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
          picks: slots.map(({ win, pick, ranked }) => ({ slot: win.slot, feelsF: Math.round(win.feelsF), ...pickJSON(pick, ranked, win, occasion) })),
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
      const ranked = rank(fragrances, win, win.slot, { occasion, history, nudge });
      return { win, ranked, pick: ranked[0] };
    })
    : planWindows(fragrances, [wx.day, wx.night].filter(Boolean).sort(byTime), { history, nudge });

  if (args.json) {
    console.log(JSON.stringify({
      place,
      now: wx.now,
      occasion: occasion?.id ?? null,
      slots: result.map(slotJSON),
    }, null, 2));
  } else {
    console.log(`${place.name} · now ${Math.round(wx.now.tempF)}°F ${wx.now.label}${occasion ? ` · occasion: ${occasion.label}` : ''}`);
    for (const r of result) {
      const win = r.win;
      printSlot(r, `${win.label}: ${win.condition}, feels ${Math.round(win.feelsF)}°F, ${Math.round(win.humidity)}% humidity${win.pop >= 30 ? `, ${win.pop}% rain` : ''}`);
    }
  }
}

const USAGE = `usage: node scripts/recommend.mjs (--city NAME | --loc LAT,LON[,NAME]) [--occasion ${OCCASIONS.map(o => o.id).join('|')}] [--slot day|night] [--week] [--journal FILE] [--exclude NAME,NAME] [--demo] [--top N] [--json]
       node scripts/recommend.mjs --layer NAME|all [--city NAME | --loc LAT,LON[,NAME]] [--slot day|night] [--exclude NAME,NAME] [--json]
       node scripts/recommend.mjs --ideal NAME [--exclude NAME,NAME] [--json]
       node scripts/recommend.mjs --mix [--exclude NAME,NAME] [--demo] [--json]
       node scripts/recommend.mjs --styles NAME [--json]
       node scripts/recommend.mjs (--city NAME | --loc LAT,LON[,NAME]) --date YYYY-MM-DD [--occasion ID] [--slot day|night] [--journal FILE] [--json]
       node scripts/recommend.mjs --pack (--city NAME | --loc LAT,LON[,NAME]) --from YYYY-MM-DD --to YYYY-MM-DD [--max N] [--events "DATE [day|night] OCCASION; …"] [--json]
       node scripts/recommend.mjs --spray NAME [--city NAME | --loc LAT,LON[,NAME]] [--date YYYY-MM-DD] [--occasion ID] [--slot day|night] [--json]`;

if (import.meta.main) await main();
