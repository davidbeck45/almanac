#!/usr/bin/env node
// Same engine as the app, from the terminal.
//   node scripts/recommend.mjs --city "New York" [--occasion date] [--slot day|night] [--json]
//   node scripts/recommend.mjs --loc 40.71,-74.01 --exclude "Sauvage,Jake"
//   node scripts/recommend.mjs --city "New York" --week   (day + night plan for the next 7 days)
//   node scripts/recommend.mjs --layer "Liquid Brun"       (what layers with it; --layer all for the best pairs)
//   node scripts/recommend.mjs --layer "Liquid Brun" --city "New York" [--slot night]   (for that weather)
//   node scripts/recommend.mjs --ideal "Amber Empire"     (the temperatures it wears best in)
// Bottles hidden in the app live in the phone's storage; pass them via --exclude.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { rank, planWindows, comfortRange } from '../src/engine.js';
import { layerPicks } from '../src/layering.js';
import { OCCASIONS, occasionById } from '../src/occasions.js';
import { fetchForecast, summarize, week } from '../src/weather.js';
import { searchCities } from '../src/location.js';

const { values: args } = parseArgs({
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
  },
});

const excluded = args.exclude.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const fragrances = JSON.parse(readFileSync(new URL('../data/collection.json', import.meta.url))).fragrances
  .filter(f => !excluded.includes(f.name.toLowerCase()));

async function resolvePlace() {
  if (args.loc) {
    const [lat, lon] = args.loc.split(',').map(Number);
    return { name: args.loc, lat, lon };
  }
  const [hit] = await searchCities(args.city);
  if (!hit) { console.error(`No city found for "${args.city}"`); process.exit(1); }
  return { name: `${hit.name}, ${hit.region}`, lat: hit.lat, lon: hit.lon };
}

// "Althaïr (Parfums de Marly)" for a dupe; undefined drops out of the JSON.
const inspiredBy = f => f.original ? `${f.original.name} (${f.original.brand})` : undefined;

const findBottle = name => {
  const q = name.toLowerCase();
  const hit = fragrances.find(f => f.name.toLowerCase() === q) ?? fragrances.find(f => f.name.toLowerCase().includes(q));
  if (!hit) { console.error(`No bottle matches "${name}"`); process.exit(1); }
  return hit;
};

// Partners for one bottle, or the best pairs overall. The weather is optional:
// with a place, pairs are scored for the current window (or --slot).
if (args.layer) {
  let win = null;
  if (args.city || args.loc) {
    const wx = summarize(await fetchForecast(await resolvePlace()));
    win = wx[args.slot ?? (wx.day?.dateISO === wx.todayISO ? 'day' : 'night')];
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
    rows = [...pairs.values()].sort((x, y) => y.pair.rank - x.pair.rank).slice(0, 10);
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
      sprayFirst: pair.first.name,
      reasons: pair.reasons.map(x => `${x.tone === 'good' ? '+' : '-'} ${x.text}`),
      ...(win && { window: { label: win.label, feelsF: Math.round(win.feelsF), humidity: Math.round(win.humidity), condition: win.condition } }),
    })), null, 2));
  } else {
    if (win) console.log(`${win.label}: ${win.condition}, feels ${Math.round(win.feelsF)}°F, ${Math.round(win.humidity)}% humidity\n`);
    console.log(rows.length ? rows.map(({ base, pair }) => pairLine(base, pair)).join('\n') : 'Nothing in the collection layers well with it.');
  }
  process.exit(0);
}

// The feels-like range a bottle suits on its own, and where it makes the top 3
// of this collection by day and by night (clear sky, comfortable dew point, today's date).
if (args.ideal) {
  const f = findBottle(args.ideal);
  const date = new Date();
  const lat = args.city || args.loc ? (await resolvePlace()).lat : 40;
  const SCAN = [0, 105];
  const runs = temps => temps.reduce((out, t) => {
    const last = out.at(-1);
    if (last && last[1] === t - 1) last[1] = t;
    else out.push([t, t]);
    return out;
  }, []).map(([lo, hi]) => ({ lowF: lo === SCAN[0] ? null : lo, highF: hi === SCAN[1] ? null : hi }));
  const topPick = {};
  for (const slot of ['day', 'night']) {
    const temps = [];
    for (let feelsF = SCAN[0]; feelsF <= SCAN[1]; feelsF++) {
      const ranked = rank(fragrances, { feelsF, humidity: 50, dewF: 55, category: 'clear', date, lat }, slot);
      if (ranked.slice(0, 3).some(r => r.fragrance.id === f.id)) temps.push(feelsF);
    }
    topPick[slot] = runs(temps);
  }
  const range = comfortRange(f, { date, lat });
  if (args.json) {
    console.log(JSON.stringify({ name: f.name, brand: f.brand, inspiredBy: inspiredBy(f), range, topPick }, null, 2));
  } else {
    const span = ({ lowF, highF }) => lowF === null && highF === null ? 'any temperature'
      : lowF === null ? `${highF}°F and colder` : highF === null ? `${lowF}°F and warmer` : `${lowF}–${highF}°F`;
    console.log(`${f.name} (${f.brand}) wears best at ${span(range)} feels-like${range.bestF !== null ? `, peaking around ${range.bestF}°F` : ''}.`);
    for (const slot of ['day', 'night']) {
      console.log(`  Top 3 in this collection by ${slot}: ${topPick[slot].length ? topPick[slot].map(span).join(', ') : 'never'}`);
    }
  }
  process.exit(0);
}

if (!args.city && !args.loc) {
  console.error(`usage: node scripts/recommend.mjs (--city NAME | --loc LAT,LON) [--occasion ${OCCASIONS.map(o => o.id).join('|')}] [--slot day|night] [--week] [--exclude NAME,NAME] [--json]
       node scripts/recommend.mjs --layer NAME|all [--city NAME | --loc LAT,LON] [--slot day|night] [--exclude NAME,NAME] [--json]
       node scripts/recommend.mjs --ideal NAME [--city NAME | --loc LAT,LON] [--exclude NAME,NAME] [--json]`);
  process.exit(1);
}

const place = await resolvePlace();

const occasion = args.occasion ? occasionById(args.occasion) : null;
if (args.occasion && !occasion) { console.error(`Unknown occasion "${args.occasion}"`); process.exit(1); }

const forecast = await fetchForecast(place);

if (args.week) {
  const days = week(forecast);
  const plan = planWindows(fragrances, days.flatMap(d => [d.day, d.night].filter(Boolean)), { occasion });
  const pickFor = win => win && plan.find(p => p.win === win);
  const rows = days.map(d => ({ day: d, slots: [d.day, d.night].map(pickFor).filter(Boolean) }));
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
        picks: slots.map(({ win, pick, ranked }) => ({
          slot: win.slot,
          feelsF: Math.round(win.feelsF),
          tier: pick.tier,
          name: pick.fragrance.name,
          brand: pick.fragrance.brand,
          inspiredBy: inspiredBy(pick.fragrance),
          reasons: pick.reasons.map(x => `${x.tone === 'good' ? '+' : '-'} ${x.text}`),
          runnerUp: ranked.find(r => r !== pick)?.fragrance.name ?? null,
        })),
      })),
    }, null, 2));
  } else {
    console.log(`${place.name} · the week ahead${occasion ? ` · occasion: ${occasion.label}` : ''}`);
    for (const { day, slots } of rows) {
      console.log(`\n${day.name} ${day.dateISO}: ${day.condition}, ${Math.round(day.hiF)}°/${Math.round(day.loF)}°F${day.pop >= 30 ? `, ${day.pop}% rain` : ''}`);
      for (const { win, pick } of slots) console.log(`  ${win.slot === 'day' ? 'day  ' : 'night'}  ${pick.tier}  ${pick.fragrance.name} (${pick.fragrance.brand})`);
    }
  }
  process.exit(0);
}

const wx = summarize(forecast);
const slots = args.slot ? [args.slot] : occasion ? [occasion.slot] : ['day', 'night'];

const result = slots.map(slot => {
  const win = wx[slot];
  const ranked = rank(fragrances, win, slot, { occasion });
  return { slot, win, ranked };
});

if (args.json) {
  console.log(JSON.stringify({
    place,
    now: wx.now,
    occasion: occasion?.id ?? null,
    slots: result.map(({ slot, win, ranked }) => ({
      slot,
      window: { label: win.label, feelsF: Math.round(win.feelsF), humidity: Math.round(win.humidity), condition: win.condition, rainChance: win.pop },
      ranked: ranked.map(r => ({ tier: r.tier, name: r.fragrance.name, brand: r.fragrance.brand, inspiredBy: inspiredBy(r.fragrance), score: +r.score.toFixed(3), reasons: r.reasons.map(x => `${x.tone === 'good' ? '+' : '-'} ${x.text}`) })),
    })),
  }, null, 2));
} else {
  console.log(`${place.name} · now ${Math.round(wx.now.tempF)}°F ${wx.now.label}${occasion ? ` · occasion: ${occasion.label}` : ''}`);
  for (const { win, ranked } of result) {
    console.log(`\n${win.label}: ${win.condition}, feels ${Math.round(win.feelsF)}°F, ${Math.round(win.humidity)}% humidity${win.pop >= 30 ? `, ${win.pop}% rain` : ''}`);
    for (const tier of ['S', 'A', 'B', 'C']) {
      const rows = ranked.filter(r => r.tier === tier);
      console.log(`  ${tier}  ${rows.map(r => r.fragrance.name).join(', ')}`);
    }
    const top = ranked[0];
    console.log(`  → ${top.fragrance.name} (${top.fragrance.brand}): ${top.reasons.filter(r => r.tone === 'good').map(r => r.text).join('; ')}`);
  }
}
