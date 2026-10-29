#!/usr/bin/env node
// Same engine as the app, from the terminal.
//   node scripts/recommend.mjs --city "New York" [--occasion date] [--slot day|night] [--json]
//   node scripts/recommend.mjs --loc "40.71,-74.01[,New York]" --exclude "Sauvage,Jake"
//   node scripts/recommend.mjs --city "New York" --week   (day + night plan for the next 7 days)
//   node scripts/recommend.mjs --city "New York" --week --events "2026-10-31 night formal"   (planned around it)
//   node scripts/recommend.mjs --layer "Liquid Brun"       (what layers with it; --layer all for the best pairs)
//   node scripts/recommend.mjs --layer "Liquid Brun" --city "New York" [--slot night]   (for that weather)
//   node scripts/recommend.mjs --ideal "Amber Empire"     (the temperatures it wears best in)
//   node scripts/recommend.mjs --mix                       (the collection's scent styles, bottle by bottle)
//   node scripts/recommend.mjs --doubles                   (bottles in the collection that wear as one)
//   node scripts/recommend.mjs --styles "Prada L'Homme"   (one bottle's style scores; any Fragrantica bottle)
//   node scripts/recommend.mjs --city Miami --date 2026-10-24 [--occasion date]   (any date: forecast, else typical weather)
//   node scripts/recommend.mjs --pack --city London --from 2026-12-10 --to 2026-12-19 [--max 3] [--events "2026-12-15 night formal"]
//   node scripts/recommend.mjs --spray "Liquid Brun" [--city X] [--occasion date]   (how many sprays, and where)
//   node scripts/recommend.mjs --gaps [--city X] [--uses "office=often,formal=never"] [--value | --no-value] [--top N]
//                                                         (what the wardrobe is missing, and bottles that fill it)
//   node scripts/recommend.mjs --check "Shalimar Millesime Tonka" [--style "skin,clean"]   (whether a bottle is worth buying; name or id)
//   node scripts/recommend.mjs --style "skin,clean,intimate" [--all] [--lean masculine]   (bottles to buy that are those styles)
//   node scripts/recommend.mjs --more-like "Liquid Brun,Amber Empire"   (bottles to buy that smell like them)
//   node scripts/recommend.mjs --notes "iris leather" [--season winter] [--slot night] [--lean unisex] [--min-value 3.8] [--min-rating 3.6]
//   node scripts/recommend.mjs --dupes "Aventus"           (its original, cheaper alternatives and smell-alikes)
// Suggestions (--gaps, --style, --more-like, --notes) leave out body mists and
// sprays; --mists lets them in.
// --journal takes the app's journal export (Export in the wear journal) or its
// Copy for Claude (a token beside Export: the last ten days' wears and what
// the nudge reads, stars and switched-off bottles), so recent wears rotate
// out as they do in the app; plans without one say so. --top N gives reasons for the
// first N picks. Every bottle in the wardrobe counts, Jake included (these
// answers are for David); --demo leaves out DEFAULT_HIDDEN like the site does
// for a first-time visitor. Bottles hidden in the app live in the phone's
// storage; pass them via --exclude (part of a name is enough), or with the
// journal, which carries them. Like the app, picks leave switched-off
// bottles out, and suggestions and checks count them as owned (never
// suggested back; "You own it."). A journal also carries his own
// ratings and skin nudges, and turns on the rotation nudge (a bottle unworn
// for a month takes a slot it nearly wins), and the gap finder reads its
// wears' occasions into the use shares.
import { readFileSync, existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { rank, planWindows, comfortRange, eventPhrase } from '../src/engine.js';
import { layerPicks, byPick } from '../src/layering.js';
import { OCCASIONS, occasionById } from '../src/occasions.js';
import { DEFAULT_HIDDEN } from '../src/hidden.js';
import { readJournal, isJournalToken, journalFreshness, occasionCounts } from '../src/history.js';
import { normalize } from '../src/collections.js';
import { excluding } from '../src/pool-tasks.js';
import { fetchForecast, summarize, week, tripWindows, forecastError } from '../src/weather.js';
import { searchCities } from '../src/location.js';
import { STYLES, STYLE_STRONG, WEARS_CLOSE, styleById, styleScores, topOf, shownOf, leanOf, closeOf, styleMix } from '../src/scent-styles.js';
import { fragranticaLibrary, loadPool, fromPool, loadPoolStyles, loadAbout } from '../src/fragrantica.js';
import { applySkin } from '../src/skin.js';
import { packTrip, withEvents, picksFor, tripOccasion } from '../src/pack.js';
import { sprayGuide } from '../src/spray.js';
import { tiesFor, planTies, tieName, tiesNews } from '../src/contrast.js';
import { doubles } from '../src/doubles.js';
import { gapContext, gapReport, buyCheck, checkJSON, cellLabel, ratingText, DEFAULT_CLIMATE, USES, useLabel } from '../src/gaps.js';
import { fetchClimate } from '../src/climate.js';
import { parseUses, sharesFrom } from '../src/uses.js';
import {
  DEMO_LIKED, LEAN_WINDOWS, discoverContext, findStyles, likedStyles, moreOfStyles, defaultSeeds, moreLike, searchNotes,
  dupeIds, dupesOf, whyLine, addCloneVotes,
} from '../src/discover.js';

const SLOTS = ['day', 'night'];
// The modes that answer without planning windows, so take no --events.
const PLANLESS = ['layer', 'ideal', 'mix', 'doubles', 'styles', 'spray', 'gaps', 'check', 'style', 'more-like', 'notes', 'dupes'];
const squash = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');

/** An occasion by id, label or a former label, any case or spacing ("date", "Date Night", "night out", "everyday"), or null. */
export function findOccasion(text) {
  const q = squash(text);
  return OCCASIONS.find(o => [o.id, o.label, ...(o.aliases ?? [])].some(n => squash(n) === q)) ?? null;
}

// Part of a name matches inside words from PART_MIN letters; shorter, only
// whole words ("a" isn't every bottle with an a in its name).
const PART_MIN = 3;
// An --exclude term matching more bottles than this is a slip, not a choice.
const EXCLUDE_MAX = 3;

/**
 * Bottles a typed name picks out: an exact name first, else every name (or
 * name and brand) that contains it. Case, accents and punctuation aside, as
 * the app's search: "L'Homme Ideal" is L’Homme Idéal.
 */
export function matchBottles(fragrances, text) {
  const q = normalize(text);
  if (!q) return [];
  // A year the dataset puts after a name ("Opium (1977)") isn't part of it.
  const nameOf = f => normalize(String(f.name).replace(/\s*\(\d{4}\)\s*$/, ''));
  const exact = fragrances.filter(f => nameOf(f) === q);
  if (exact.length) return exact;
  // A number matches whole, read off the name as written: "212" isn't
  // "2121", nor "21" "212", nor "0" the 0 in "9.0".
  if (/^\d+$/.test(q)) {
    const whole = new RegExp(`(?<!\\d)(?<!\\d\\.)${q}(?!\\d)(?!\\.\\d)`);
    return fragrances.filter(f => whole.test(`${String(f.name).replace(/\s*\(\d{4}\)\s*$/, '')} ${f.brand ?? ''}`));
  }
  const has = q.replace(/ /g, '').length >= PART_MIN ? hay => hay.includes(q) : hay => ` ${hay} `.includes(` ${q} `);
  return fragrances.filter(f => has(nameOf(f)) || has(`${nameOf(f)} ${normalize(f.brand)}`));
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

// Why the weather didn't come, as the line fail() prints: Open-Meteo gives
// up on a request after REQUEST_TIMEOUT (TRIP_TIMEOUT for --date and --pack),
// and a refusal says why in the app's words (forecastError: the day's
// requests used up, busy, down); only no answer at all is the connection's.
export function weatherFailure(err, what = 'the forecast') {
  if (err?.timeout) {
    const which = err.service === 'archive' ? 'its weather archive' : 'its forecast';
    return `Couldn't get ${what} from Open-Meteo: ${which} didn't answer within ${Math.round(err.timeoutMs / 1000)} seconds. It's slow or down; try again in a minute.`;
  }
  if (err?.status) return `Couldn't get ${what} from Open-Meteo: ${forecastError(err).replace(/^The/, 'the')}`;
  return `Couldn't get ${what} from Open-Meteo (${err.message}). Check the connection and try again.`;
}

const byLine = r => `${r.name} by ${r.brand}${r.year ? ` (${r.year})` : ''}`;
// Answers built on the dataset's ratings and votes say where they're from.
const CREDIT = 'From Le Decanteur\'s Fragrantica dataset (CC BY-NC-SA 4.0)';

/**
 * A dataset bottle by name, as --check, --styles, --more-like and --dupes
 * find one: the suggestion pool's (`records`, `byId`; an exact name first,
 * else every name holding it, the most voted used), else the dataset's
 * search, a pool bottle it finds as its pool row. -> record or null.
 */
export async function datasetBottle(name, records, byId) {
  const hits = matchBottles(records, name).sort((a, b) => b.ratingVotes - a.ratingVotes);
  if (hits.length > 1) {
    console.error(`"${name}" matches ${hits.length} bottles (${hits.slice(0, 4).map(byLine).join('; ')}${hits.length > 4 ? '…' : ''}); using the most voted. Give more of the name, or its id, for another.`);
  }
  if (hits.length) return hits[0];
  const library = fragranticaLibrary(datasetFile);
  const [hit] = await library.search(name, 1);
  return hit ? byId.get(hit.id) ?? (await library.records([hit.id])).get(hit.id) ?? null : null;
}

// The suggestion pool's records, made once.
let poolRecords = null;
async function poolBottles() {
  if (!poolRecords) {
    const parsed = await loadPool(datasetFile);
    const records = Array.from({ length: parsed.count }, (_, i) => fromPool(parsed, i));
    poolRecords = { records, byId: new Map(records.map(r => [r.id, r])) };
  }
  return poolRecords;
}

const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s ?? '') && !Number.isNaN(Date.parse(`${s}T12:00:00Z`))
  && new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s;
const localToday = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const daysFrom = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
const dayBefore = iso => new Date(Date.parse(`${iso}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
const SHORT = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const shortDate = iso => SHORT.format(new Date(`${iso}T12:00:00Z`));
// The longest trip --pack plans, and how far ahead (typical weather needs past years' dates).
const MAX_TRIP_DAYS = 31;
const MAX_AHEAD_DAYS = 365;

/**
 * --events "2026-10-20 night formal; 2026-10-21 date night" -> [{ dateISO,
 * slot, occasion }]. Each is a date, then an occasion (id or label), with an
 * optional day or night before or after it ("formal night"); without one the
 * occasion's own slot. One per window. Throws with a message for the user.
 */
export function parseEvents(text) {
  const events = String(text ?? '').split(';').map(s => s.trim()).filter(Boolean).map(part => {
    const [dateISO, ...rest] = part.split(/\s+/);
    if (!isDate(dateISO)) throw new Error(`--events: "${part}" doesn't start with a date (YYYY-MM-DD)`);
    // "night out" and "date night" are occasions; "night formal" and "formal night" a slot and one.
    let occasion = findOccasion(rest.join(' '));
    let slot = occasion?.slot;
    const isSlot = word => SLOTS.includes(word?.toLowerCase());
    if (!occasion && isSlot(rest[0])) [slot, occasion] = [rest[0].toLowerCase(), findOccasion(rest.slice(1).join(' '))];
    if (!occasion && isSlot(rest.at(-1))) [slot, occasion] = [rest.at(-1).toLowerCase(), findOccasion(rest.slice(0, -1).join(' '))];
    if (!occasion) {
      throw new Error(`--events: no occasion in "${part}". Write each as DATE [day|night] OCCASION, the occasion one of: ${OCCASIONS.map(o => o.id).join(', ')}`);
    }
    return { dateISO, slot, occasion };
  });
  const seen = new Set();
  for (const e of events) {
    const key = `${e.dateISO} ${e.slot}`;
    if (seen.has(key)) throw new Error(`--events: two events on the ${e.slot} of ${e.dateISO}; give each day or night one`);
    seen.add(key);
  }
  return events;
}

/**
 * --journal: the app's Copy for Claude (a token, told apart by its shape)
 * or a file holding an export or a token. -> parseJournal's shape; throws
 * with a sentence for the user.
 */
export function loadJournal(arg) {
  if (isJournalToken(arg)) return readJournal(arg);
  let text;
  try { text = readFileSync(arg, 'utf8'); } catch { throw new Error(`Can't read ${arg}`); }
  const journal = readJournal(text);
  if (!journal) throw new Error(`${arg} isn't an Almanac journal export (the wear journal's Export button) or its Copy for Claude`);
  return journal;
}

// Standard situations for --spray without a place.
const SPRAY_SITUATIONS = [
  { label: 'Hot, sticky day', slot: 'day', feelsF: 90, humidity: 65, dewF: 72, category: 'clear' },
  { label: 'Mild day', slot: 'day', feelsF: 66, humidity: 55, dewF: 50, category: 'clear' },
  { label: 'Cold night', slot: 'night', feelsF: 32, humidity: 65, dewF: 22, category: 'clear' },
];
const sprayJSON = g => ({ sprays: g.sprays, ...(g.unit !== 'spray' && { unit: g.unit }), where: g.where, text: g.text, why: g.why, ...(g.note && { note: g.note }) });

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
        doubles: { type: 'boolean', default: false },
        styles: { type: 'string' },
        date: { type: 'string' },
        pack: { type: 'boolean', default: false },
        from: { type: 'string' },
        to: { type: 'string' },
        max: { type: 'string', default: '3' },
        events: { type: 'string' },
        spray: { type: 'string' },
        gaps: { type: 'boolean', default: false },
        check: { type: 'string' },
        uses: { type: 'string' },
        value: { type: 'boolean', default: false },
        'no-value': { type: 'boolean', default: false },
        style: { type: 'string' },
        all: { type: 'boolean', default: false },
        'more-like': { type: 'string' },
        notes: { type: 'string' },
        dupes: { type: 'string' },
        season: { type: 'string' },
        lean: { type: 'string' },
        'min-value': { type: 'string' },
        'min-rating': { type: 'string' },
        mists: { type: 'boolean', default: false },
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
  const today = localToday();
  for (const key of ['date', 'from', 'to']) {
    if (args[key] !== undefined && !isDate(args[key])) fail(`--${key} takes a date like ${today}, not "${args[key]}"`);
  }
  // A place's date can be a day either side of this machine's. A date before
  // yesterday here has passed everywhere; the weather checks the rest against
  // the place's own date (windowsAt), before asking the archive for a day
  // that's over there.
  const earliest = dayBefore(today);
  if (args.date && args.date < earliest) fail(`--date ${args.date} has passed; pick today or later`);
  if (args.date && daysFrom(today, args.date) > MAX_AHEAD_DAYS) fail(`--date ${args.date} is more than a year out`);
  if (args.date && args.week) fail('--date picks for one day; leave out --week');

  // --events: what a plan is for, window by window (today's picks, --week,
  // --date and --pack plan around them). Here each event is checked against
  // the plan's slot (--slot's, else --occasion's; --pack checks its own),
  // and each mode checks the dates against its windows.
  let events = [];
  if (args.events !== undefined) {
    const mode = PLANLESS.find(k => args[k] !== undefined && args[k] !== false);
    if (mode) fail(`--events goes with a plan (today's picks, --week, --date or --pack), not --${mode}`);
    try { events = parseEvents(args.events); } catch (err) { fail(err.message); }
    const only = args.pack ? null : slot ?? occasion?.slot;
    for (const e of events) {
      if (e.dateISO < earliest) fail(`--events: ${e.dateISO} has passed`);
      if (only && e.slot !== only) fail(`--events: the ${e.occasion.label} on ${e.dateISO} is ${e.slot === 'day' ? 'by day' : 'at night'}, and ${slot ? `--slot ${slot}` : `--occasion ${occasion.id}`} plans ${only === 'day' ? 'days' : 'nights'} only`);
      if (args.date && e.dateISO !== args.date) fail(`--events: ${e.dateISO} isn't the --date, ${args.date}; --date plans that day only`);
    }
  }

  let wardrobe = JSON.parse(readFileSync(new URL('../data/collection.json', import.meta.url))).fragrances
    .map(f => ({ ...f, id: String(f.id) }));
  // Switched off: --demo's defaults, --exclude's bottles and the journal's.
  const off = new Set(args.demo ? DEFAULT_HIDDEN : []);
  for (const term of args.exclude.split(',').map(s => s.trim()).filter(Boolean)) {
    const hits = matchBottles(wardrobe, term);
    if (!hits.length) console.error(`--exclude "${term}" matches no bottle; nothing left out for it`);
    else if (hits.length > EXCLUDE_MAX) fail(`--exclude "${term}" matches ${hits.length} bottles (${hits.map(f => f.name).join(', ')}); give more of the name`);
    else if (hits.length > 1) console.error(`--exclude "${term}" leaves out ${hits.map(f => f.name).join(', ')}`);
    for (const f of hits) off.add(f.id);
  }

  let history = [], journal = null;
  if (args.journal) {
    try { journal = loadJournal(args.journal); } catch (err) { fail(err.message); }
    history = journal.history.filter(h => !h.planned);
    wardrobe = applySkin(wardrobe, journal.skin);
    for (const id of journal.hidden) off.add(id);
  }
  // The days and nights planned in the app (the journal's `events`) go on
  // today's picks, --week and --date as Now and the Week put them, after
  // --events, which wins on its window. One that doesn't fit what's asked
  // (gone by, the other slot, another date) is left out without a word,
  // since David didn't type it; trips keep their own.
  const planless = PLANLESS.some(k => args[k] !== undefined && args[k] !== false);
  if (journal?.events.length && !planless && !args.pack) {
    const only = slot ?? occasion?.slot;
    for (const e of journal.events) {
      const o = occasionById(e.occasion);
      if (!o || e.dateISO < earliest || (only && e.slot !== only) || (args.date && e.dateISO !== args.date)) continue;
      if (events.some(t => t.dateISO === e.dateISO && t.slot === e.slot)) continue;
      events.push({ dateISO: e.dateISO, slot: e.slot, occasion: o, stored: true });
    }
  }
  // With a journal, a bottle left unworn for a month takes a slot it nearly wins.
  const nudge = history.length > 0;
  // Plans say whether they counted recent wears (`journal` in the JSON: false,
  // or how current its wears are), and the text says so when they didn't, or
  // when the newest wear is days old.
  const freshness = journal && journalFreshness(history, today);
  const journalLine = () => {
    if (!journal) return 'Not counting what you\'ve worn lately: send the app\'s Copy for Claude (Wardrobe › Worn) to fix that.';
    if (freshness.daysAgo >= 2) return `Newest wear in the journal: ${shortDate(freshness.newest)}, ${freshness.daysAgo} days ago; anything worn since isn't counted.`;
    return null;
  };
  const sayJournal = () => {
    const line = journalLine();
    if (line) console.log(`\n${line}`);
  };
  // Picks rank the bottles switched on; suggestions and checks count the rest as owned (`hidden`).
  const fragrances = wardrobe.filter(f => !off.has(f.id)), hidden = wardrobe.filter(f => off.has(f.id));
  const suggesting = Boolean(args.gaps || args.check || args.style || args['more-like'] || args.notes || args.dupes);
  if (!fragrances.length && !suggesting && !args.styles) {
    const by = [args.exclude.trim() && '--exclude', journal?.hidden.length && 'the journal', args.demo && '--demo'].filter(Boolean).join(' and ');
    fail(`Nothing left to rank: ${by} ${by.includes(' and ') ? 'leave' : 'leaves'} out all ${wardrobe.length} bottles`);
  }

  // A bottle by name: switched-on ones first, then switched-off ones (said on stderr).
  const findBottle = name => {
    let hits = matchBottles(fragrances, name);
    if (!hits.length) {
      hits = matchBottles(hidden, name);
      if (hits.length) console.error(`${hits[0].name} is switched off; answering for it anyway.`);
    }
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
      fail(weatherFailure(err));
    }
  }

  // Stops when the weather for `flag`'s dates (--date, --from) didn't come:
  // the first date has gone by at the place (tripWindows' refusePast), or
  // Open-Meteo failed.
  function weatherFailed(err, place, flag, fromISO) {
    if (err.past) fail(`--${flag} ${fromISO} has passed in ${place.name}; pick ${err.today} or later`);
    fail(weatherFailure(err, 'the weather'));
  }
  async function windowsAt(place, fromISO, toISO, flag, opts = {}) {
    try {
      return await tripWindows(place, fromISO, toISO, { ...opts, refusePast: true });
    } catch (err) {
      weatherFailed(err, place, flag, fromISO);
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
    // A switched-off bottle is ranked among the rest as if switched on.
    const pool = fragrances.includes(f) ? fragrances : [...fragrances, f];
    const SCAN = [0, 105];
    // Runs of degrees; spans GAP_F or fewer degrees apart join (a one-degree hole says nothing).
    const GAP_F = 2;
    const runs = temps => temps.reduce((out, t) => {
      const last = out.at(-1);
      if (last && t - last[1] <= GAP_F + 1) last[1] = t;
      else out.push([t, t]);
      return out;
    }, []).map(([lo, hi]) => ({ lowF: lo === SCAN[0] ? null : lo, highF: hi === SCAN[1] ? null : hi }));
    const topPick = {};
    for (const s of SLOTS) {
      const temps = [];
      for (let feelsF = SCAN[0]; feelsF <= SCAN[1]; feelsF++) {
        const ranked = rank(pool, { feelsF, humidity: 50, dewF: 55, category: 'clear', date: null }, s, { todayISO: '2000-01-01' });
        if (ranked.slice(0, 3).some(r => r.fragrance.id === f.id)) temps.push(feelsF);
      }
      topPick[s] = runs(temps);
    }
    const range = comfortRange(f);
    if (args.json) {
      console.log(JSON.stringify({ name: f.name, brand: f.brand, inspiredBy: inspiredBy(f), range, topPick }, null, 2));
    } else {
      const span = ({ lowF, highF }) => lowF === null && highF === null ? 'any temperature'
        : lowF === null ? `${highF}°F and colder` : highF === null ? `${lowF}°F and warmer` : lowF === highF ? `${lowF}°F` : `${lowF}–${highF}°F`;
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

  // Doubles: pairs in the collection that smell alike, or voters tie (src/doubles.js).
  if (args.doubles) {
    const { pairs, closest } = doubles(fragrances);
    const pct = x => Math.round(x * 100);
    const pair = p => p && { a: p.a.name, b: p.b.name, ...(p.why && { why: p.why, reason: p.reason }), ...(p.original && { original: p.original.name }), alike: pct(p.sim), sharing: p.traits };
    if (args.json) {
      console.log(JSON.stringify({ total: fragrances.length, doubles: pairs.map(pair), closest: pair(closest) }, null, 2));
    } else if (!pairs.length) {
      console.log(`No doubles in ${fragrances.length} bottles: every one smells its own way.`);
      if (closest) console.log(`Closest pair: ${closest.a.name} and ${closest.b.name}, ${pct(closest.sim)}% alike (${closest.traits.join(', ')}).`);
    } else {
      console.log(`Doubles in ${fragrances.length} bottles:`);
      for (const p of pairs) console.log(`  ${p.a.name} and ${p.b.name}: ${p.reason} (${pct(p.sim)}% alike; ${p.traits.join(', ')})`);
    }
    return;
  }

  // One bottle's style scores: the collection first, then the Fragrantica dataset.
  if (args.styles) {
    let [f] = matchBottles(wardrobe, args.styles);
    if (!f) {
      const { records, byId } = await poolBottles();
      f = await datasetBottle(args.styles, records, byId);
    }
    if (!f) fail(`No bottle matches "${args.styles}"`);
    const scores = styleScores(f);
    if (args.json) {
      console.log(JSON.stringify({
        name: f.name,
        brand: f.brand,
        source: f.source === 'fragrantica' ? 'dataset' : 'collection',
        // What its card and page show: a lean ("Leans skin scent", leans: true) when no style clears the bar.
        styles: shownOf(scores),
        wearsClose: closeOf(scores),
        scores,
      }, null, 2));
    } else {
      console.log(`${f.name} (${f.brand})${f.source === 'fragrantica' ? ', from the Fragrantica dataset' : ''}`);
      const width = Math.max(...STYLES.map(s => s.label.length));
      const shown = new Map(shownOf(scores).map(s => [s.id, s.leans ? 'leans (shown)' : 'shown']));
      for (const r of topOf(scores, Infinity, 0.15)) {
        const tags = [shown.get(r.id), r.score >= STYLE_STRONG && 'strong'].filter(Boolean).join(', ');
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
    if (args.from < earliest) fail(`--from ${args.from} has passed; pick today or later`);
    if (daysFrom(args.from, args.to) >= MAX_TRIP_DAYS) fail(`--pack plans up to ${MAX_TRIP_DAYS} days at a time`);
    if (daysFrom(today, args.to) > MAX_AHEAD_DAYS) fail(`--to ${args.to} is more than a year out`);
    const max = Number(args.max);
    if (!Number.isInteger(max) || max < 1 || max > 6) fail(`--max takes 1 to 6 bottles, not "${args.max}"`);
    for (const e of events) {
      if (e.dateISO < args.from || e.dateISO > args.to) fail(`--events: ${e.dateISO} is outside the trip`);
      if (slot && e.slot !== slot) fail(`--events: the ${e.occasion.label} on ${e.dateISO} is at ${e.slot === 'day' ? 'day' : 'night'}, and --slot ${slot} packs for ${slot === 'day' ? 'days' : 'nights'} only`);
    }

    // --slot packs for only days or nights; --occasion goes on every window of
    // its slot (a work trip's days) that has no event of its own.
    const place = await resolvePlace();
    const windows = withEvents(await windowsAt(place, args.from, args.to, 'from', slot ? { slots: [slot] } : {}), events);
    const trip = packTrip(fragrances, windows, { max, occasionOf: tripOccasion(occasion, slot) });
    const weather = w => ({ source: w.typical ? 'typical' : 'forecast', feelsF: Math.round(w.feelsF), humidity: Math.round(w.humidity), dewF: Math.round(w.dewF), condition: w.condition, rainChance: w.pop });
    if (args.json) {
      console.log(JSON.stringify({
        place,
        from: args.from,
        to: args.to,
        occasion: occasion?.id ?? null,
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
        variety: trip.variety && { add: trip.variety.add.name, everyDay: trip.variety.everyDay.map(f => f.name), slot: trip.variety.slot },
      }, null, 2));
    } else {
      const onSlot = occasion && `${occasion.label} ${(slot ?? occasion.slot) === 'day' ? 'days' : 'nights'}`;
      console.log(`${place.name} · ${shortDate(args.from)} to ${shortDate(args.to)} · ${windows.length} windows${windows.some(w => w.typical) ? ' (typical weather past the forecast)' : ''}${onSlot ? ` · ${onSlot}` : ''}`);
      console.log(`\n${trip.text}\n`);
      for (const b of trip.bottles) console.log(`  ${b.record.name} (${b.record.brand}${b.record.original ? `, inspired by ${inspiredBy(b.record)}` : ''}): ${b.why}`);
      console.log('');
      for (const p of trip.plan) {
        const w = p.window;
        const top = p.top.record === p.pick ? '' : `  (top: ${p.top.record.name}${p.covered ? '' : ', not packed'})`;
        console.log(`  ${shortDate(w.dateISO).padEnd(11)} ${w.slot.padEnd(5)} ${String(Math.round(w.feelsF)).padStart(3)}°F ${(w.typical ? `typically ${w.condition.toLowerCase()}` : w.condition).padEnd(24)} ${p.pick.name}${p.occasion && p.occasion !== occasion ? ` · ${p.occasion.label}` : ''}${top}`);
      }
    }
    return;
  }

  // How many sprays and where: for the next window (or --date, --slot) at a
  // place, else for a hot day, a mild day and a cold night.
  if (args.spray) {
    if (args.date && !args.city && !args.loc) fail('--date needs a place: --city NAME or --loc LAT,LON');
    const f = findBottle(args.spray);
    let situations;
    if (args.city || args.loc) {
      const place = await resolvePlace();
      const wanted = slot ?? occasion?.slot;
      if (args.date) {
        situations = await windowsAt(place, args.date, args.date, 'date', { slots: wanted ? [wanted] : SLOTS });
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

  // What the wardrobe is missing and what would fill it (src/gaps.js), or
  // whether one bottle is worth buying. The climate is the place's (--city or
  // --loc: one archive call) or, without one, the ten temperate cities'.
  if (args.gaps || args.check) {
    if (args.value && args['no-value']) fail('Pass --value or --no-value, not both');
    // "How you wear", refined by the journal's wears as the app's Insights does.
    let shares = null;
    if (args.uses || history.length) {
      try {
        shares = sharesFrom(parseUses(args.uses ?? ''), history.length ? journal?.counts ?? occasionCounts(history) : null);
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
    const { records, byId } = await poolBottles();
    const preferValue = args.value ? true : args['no-value'] ? false : null;
    const ctx = excluding(gapContext({ owned: fragrances, records, byId, summary, shares, preferValue, mists: args.mists }), 'allow', hidden);
    const pct = x => `${Math.round(x * 100)}%`;
    const stars = r => (r.ratingVotes ? `${ratingText(r.rating)}★ from ${r.ratingVotes.toLocaleString('en-US')} votes` : 'no ratings yet');
    // The bottle a fill beats or backs up: owned, or an earlier suggestion.
    const whose = f => (f.beatsPick ? `${f.beats.name} (suggested above)` : `your ${f.beats.name}`);
    const fillLine = f => (!f.beats ? `${f.title}: ${pct(f.to)}`
      : f.first ? `${f.title}: ${pct(f.to)}, over ${whose(f)} at ${pct(f.from)}`
        : `${f.title}: ${pct(f.to)} as a second pick, behind ${whose(f)} at ${pct(f.from)}`);
    const valueText = `prefer great value: ${ctx.preferValue ? 'on (only bottles voters value 3.8+)' : 'off'}`;

    if (args.check) {
      const q = args.check.trim();
      const byNumber = async id => byId.get(id) ?? (await fragranticaLibrary(datasetFile).records([id])).get(id) ?? null;
      // "id:1881" is an id; a bare number is a name when a well-voted bottle
      // has it (1881, 4711, 212: the pool's), else an id.
      const asId = /^id:\s*(\d+)$/i.exec(q)?.[1];
      const number = !asId && /^\d+$/.test(q);
      let record = asId ? await byNumber(asId)
        : number ? (matchBottles(records, q).length ? await datasetBottle(q, records, byId) : null)
          : await datasetBottle(q, records, byId) ?? matchBottles(wardrobe, q)[0] ?? null;
      if (number) {
        const withId = await byNumber(q);
        if (record) console.error(`Reading "${q}" as a name (${byLine(record)})${withId ? `; give id:${q} for ${byLine(withId)}, the bottle with that id` : ''}.`);
        else record = withId;
      }
      if (!record) fail(`No bottle matches "${q}"`);
      // Outside the pool, a bottle's signals come from its about data.
      if (!record.extras && /^\d+$/.test(record.id) && !byId.has(record.id)) {
        const about = await loadAbout(record.id, datasetFile);
        if (about) record = { ...record, about };
      }
      // The styles David loves (Discover's chips; also `--style liked`), or the ones named with --style.
      let liked = DEMO_LIKED;
      if (args.style && args.style.trim().toLowerCase() !== 'liked') {
        const found = findStyles(args.style);
        if (found.unknown.length || !found.ids.length) fail(`--style: name styles from ${STYLES.map(s => s.label).join(', ')}, or "liked"`);
        liked = found.ids;
      }
      const check = buyCheck(record, ctx, { liked });
      if (args.json) {
        console.log(JSON.stringify({ climate: where, preferValue: ctx.preferValue, liked, ...checkJSON(record, check) }, null, 2));
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
      console.log(`\nClimate: ${where} · ${valueText} · styles you like: ${liked.map(id => styleById(id).label).join(', ')}`);
      console.log(`${CREDIT}.`);
      return;
    }

    const k = args.top === undefined ? 5 : top;
    if (k < 1) fail('--top takes 1 or more for --gaps');
    const report = gapReport(ctx, { k });
    if (args.json) {
      const picks = report.picks.map(({ record, ...p }) => ({ ...p, fills: p.fills.filter(f => f.matters) }));
      // `climate` names the place, as in --check; the report's own is each slot × band's share.
      const { climate: bands, ...rest } = report;
      console.log(JSON.stringify({ climate: where, bands, bottles: fragrances.length, ...rest, picks }, null, 2));
      return;
    }
    const STATUS = { gap: 'gap', thin: 'thin', room: 'room to grow' };
    const shareText = USES.map(u => `${useLabel(u)} ${pct(shares?.[u.id] ?? u.share)}`).join(', ');
    console.log(`${fragrances.length} bottles · climate: ${where} · ${valueText}`);
    console.log(`How you wear: ${shareText}`);
    console.log('\nStrengths');
    for (const s of report.strengths) console.log(`  ${s.text}`);
    if (!report.strengths.length) console.log('  Nothing is deep yet.');
    console.log(`\n${report.overview.text}`);
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
    else if (report.picks.length < k) console.log('  Nothing else would fill these gaps by enough.');
    console.log(`\n${CREDIT}.`);
    return;
  }

  if (args.style || args['more-like'] || args.notes || args.dupes) {
    const count = args.top === undefined ? 10 : top;
    if (count < 1) fail('--top takes 1 or more for --style, --more-like, --notes and --dupes');
    await discover(args, fragrances, { slot, count, history, hidden });
    return;
  }

  if (!args.city && !args.loc) fail(USAGE);

  const place = await resolvePlace();
  // A window's pick, with the bottles that suit it just as well (`ties`,
  // src/contrast.js: within a point of its match, not worn lately, each with
  // how it differs from the pick). A window an event is on (--events)
  // carries its occasion, and says so.
  const pickJSON = (pick, ranked, win, occ = null, ties = []) => ({
    ...(win.occasion && { occasion: win.occasion.id }),
    tier: pick.tier,
    name: pick.fragrance.name,
    brand: pick.fragrance.brand,
    inspiredBy: inspiredBy(pick.fragrance),
    score: +pick.score.toFixed(3),
    reasons: pick.reasons.map(sign),
    runnerUp: ranked.find(r => r !== pick)?.fragrance.name ?? null,
    ties: ties.map(({ entry, tags }) => ({ name: entry.fragrance.name, brand: entry.fragrance.brand, score: +entry.score.toFixed(3), tags })),
    spray: sprayJSON(sprayGuide(pick.fragrance, win, win.occasion ?? occ)),
  });
  const phrase = o => o.phrase ?? o.label.toLowerCase();
  const forEvent = win => (win.occasion ? `, for ${phrase(win.occasion)}` : '');
  // Puts --events on a plan's windows, or stops on one that isn't among
  // them: outside the dates planned (`what`), or a window already over. The
  // journal's events go only where they fit. Every event here is from this
  // machine's yesterday on, so one missing before the last window planned
  // is over at the place, even dated before the first (past 23:00 the plan
  // starts tomorrow).
  const onWindows = (windows, what) => {
    for (const e of events) {
      if (e.stored || windows.some(w => w.dateISO === e.dateISO && w.slot === e.slot)) continue;
      const [first, last] = [windows[0]?.dateISO, windows.at(-1)?.dateISO];
      if (first && e.dateISO <= last) fail(`--events: the ${e.slot === 'day' ? 'daytime' : 'night'} of ${e.dateISO} is over`);
      fail(`--events: ${e.dateISO} is outside ${what}${first ? ` (${shortDate(first)} to ${shortDate(last)})` : ''}`);
    }
    return withEvents(windows, events);
  };
  const why = pick => pick.reasons.filter(r => r.tone === 'good').map(r => r.text).join('; ') || pick.reasons.map(r => r.text).join('; ');
  // "Cream Velvet (Lattafa), or Legacy (fresher)": a pick's name and its ties.
  const orTies = ties => ties.map(t => `, or ${tieName(t)}`).join('');
  // One window's ranking, as JSON and as text under a heading.
  const slotJSON = ({ win, ranked, pick }, ties = []) => ({
    slot: win.slot,
    window: { label: win.label, date: win.dateISO, feelsF: Math.round(win.feelsF), humidity: Math.round(win.humidity), dewF: Math.round(win.dewF), condition: win.condition, rainChance: win.pop, ...(win.typical && { typical: true }) },
    pick: pickJSON(pick, ranked, win, occasion, ties),
    ranked: ranked.map(r => ({ tier: r.tier, name: r.fragrance.name, brand: r.fragrance.brand, inspiredBy: inspiredBy(r.fragrance), score: +r.score.toFixed(3), reasons: r.reasons.map(sign) })),
  });
  const printSlot = ({ win, ranked, pick }, heading, ties = []) => {
    console.log(`\n${heading}`);
    for (const tier of ['S', 'A', 'B', 'C']) {
      const rows = ranked.filter(r => r.tier === tier);
      if (rows.length) console.log(`  ${tier}  ${rows.map(r => r.fragrance.name).join(', ')}`);
    }
    const shown = [pick, ...ranked.filter(r => r !== pick)].slice(0, Math.max(1, top));
    for (const [i, r] of shown.entries()) {
      console.log(`  ${i ? ' ' : '→'} ${r.fragrance.name} (${r.fragrance.brand}${r.fragrance.original ? `, inspired by ${inspiredBy(r.fragrance)}` : ''})${i ? '' : orTies(ties)}: ${r.reasons.map(sign).join('; ')}`);
      if (!i) console.log(`    Spray: ${sprayGuide(r.fragrance, win, win.occasion ?? occasion).text}`);
    }
  };
  // Each window's ties: a plan's leave out its neighbours' picks; one
  // window ranked alone takes its top. None for a window whose occasion (its
  // event's, else --occasion) has ties that aren't news (TIE_OCCASIONS).
  const newsOnly = (result, ties) => ties.map((t, i) => (tiesNews(result[i].win?.occasion ?? occasion) ? t : []));
  const tiesOf = (result, planned) => newsOnly(result, planned ? planTies(result, { history }) : result.map(r => tiesFor(r.pick, r.ranked)));

  // One date anywhere: the forecast's windows, or typical weather past them.
  // With --events on it, the date's windows are planned around them.
  if (args.date) {
    const wanted = slot ?? occasion?.slot;
    let result, windows;
    try {
      if (events.length) windows = await tripWindows(place, args.date, args.date, { refusePast: true, ...(wanted && { slots: [wanted] }) });
      else {
        result = wanted
          ? [await picksFor(fragrances, { place, dateISO: args.date, slot: wanted, occasion, history, nudge, refusePast: true })].filter(Boolean)
            .map(({ window: win, ranked }) => ({ win, ranked, pick: ranked[0] }))
          : planWindows(fragrances, await tripWindows(place, args.date, args.date, { refusePast: true }), { history, nudge });
      }
    } catch (err) {
      weatherFailed(err, place, 'date', args.date);
    }
    if (windows?.length) result = planWindows(fragrances, onWindows(windows, `--date ${args.date}`), { occasion, history, nudge });
    if (!result?.length) fail(`No weather came back for ${args.date}`);
    const typical = result.some(r => r.win.typical);
    const ties = tiesOf(result, !wanted || events.length > 0);
    if (args.json) {
      console.log(JSON.stringify({
        place,
        date: args.date,
        weather: typical ? 'typical' : 'forecast',
        occasion: occasion?.id ?? null,
        journal: freshness || false,
        slots: result.map((r, i) => slotJSON(r, ties[i])),
      }, null, 2));
    } else {
      console.log(`${place.name} · ${shortDate(args.date)}${typical ? ' · typical weather for the date (past the forecast)' : ''}${occasion ? ` · occasion: ${occasion.label}` : ''}`);
      for (const [i, r] of result.entries()) {
        const win = r.win;
        printSlot(r, `${win.slot === 'day' ? 'Day' : 'Night'}${forEvent(win)}: ${win.typical ? 'typically ' : ''}${win.condition.toLowerCase()}, feels ${Math.round(win.feelsF)}°F, ${Math.round(win.humidity)}% humidity${win.pop >= 30 ? (win.typical ? `, wet on ${win.pop}% of these dates in past years` : `, ${win.pop}% rain`) : ''}`, ties[i]);
      }
      sayJournal();
    }
    return;
  }

  const forecast = await forecastFor(place);

  // A plan for the week: day and night, or only the occasion's (or --slot's) windows.
  if (args.week) {
    const days = week(forecast);
    const wanted = slot ?? occasion?.slot ?? null;
    const windows = onWindows(days.flatMap(d => [d.day, d.night].filter(w => w && (!wanted || w.slot === wanted))), 'the week ahead');
    const plan = planWindows(fragrances, windows, { occasion, history, nudge, nowISO: summarize(forecast).todayISO });
    const ties = new Map(newsOnly(plan, planTies(plan, { history })).map((t, i) => [plan[i], t]));
    const pickFor = win => plan.find(p => p.win === win);
    const rows = days.map(d => ({ day: d, slots: windows.filter(w => w.dateISO === d.dateISO).map(pickFor) }))
      .filter(r => r.slots.length);
    if (args.json) {
      console.log(JSON.stringify({
        place,
        occasion: occasion?.id ?? null,
        journal: freshness || false,
        days: rows.map(({ day, slots }) => ({
          date: day.dateISO,
          name: day.name,
          hiF: Math.round(day.hiF),
          loF: Math.round(day.loF),
          condition: day.condition,
          rainChance: day.pop,
          picks: slots.map(p => ({ slot: p.win.slot, feelsF: Math.round(p.win.feelsF), ...pickJSON(p.pick, p.ranked, p.win, occasion, ties.get(p)) })),
        })),
      }, null, 2));
    } else {
      console.log(`${place.name} · the week ahead${occasion ? ` · occasion: ${occasion.label}` : ''}`);
      for (const { day, slots } of rows) {
        console.log(`\n${day.name} ${day.dateISO}: ${day.condition}, ${Math.round(day.hiF)}°/${Math.round(day.loF)}°F${day.pop >= 30 ? `, ${day.pop}% rain` : ''}`);
        for (const p of slots) {
          const { win, pick } = p;
          console.log(`  ${win.slot === 'day' ? 'day  ' : 'night'} ${String(Math.round(win.feelsF)).padStart(3)}°F  ${pick.tier}  ${pick.fragrance.name} (${pick.fragrance.brand})${win.occasion ? ` for ${phrase(win.occasion)}` : ''}${orTies(ties.get(p))}: ${why(pick)}`);
        }
      }
      sayJournal();
    }
    return;
  }

  // Today's windows in time order. Without an occasion or --slot they're
  // planned together like the app's Today, so the night doesn't repeat the day.
  // --events can fall anywhere in the week ahead: those later on are planned
  // first and hold their bottles back today, as --week and the app's Now do.
  const wx = summarize(forecast);
  const wanted = slot ?? occasion?.slot ?? null;
  const shown = (wanted ? [wx[wanted]] : [wx.day, wx.night]).filter(Boolean).sort(byTime);
  // A plan of both windows plans the one after them too (unless it's an
  // event, which `later` has) without showing it: planTies leaves its pick
  // out of the last window's ties, as the app's Now and Week do.
  const nextOf = windows => {
    const first = !wanted && shown.length ? windows.find(w => byTime(w, shown.at(-1)) > 0) : null;
    return first && !first.occasion ? [first] : [];
  };
  let result, ahead = [], after = [];
  if (events.length) {
    const weekly = onWindows(week(forecast).flatMap(d => [d.day, d.night].filter(w => w && (!wanted || w.slot === wanted))), 'the week ahead');
    const later = weekly.filter(w => w.occasion && (!shown.length || byTime(w, shown.at(-1)) > 0));
    const next = nextOf(weekly);
    const plan = planWindows(fragrances, [...withEvents(shown, events), ...next, ...later], { occasion, history, nudge, nowISO: wx.todayISO });
    [result, after, ahead] = [plan.slice(0, shown.length), plan.slice(shown.length, shown.length + next.length), plan.slice(shown.length + next.length)];
  } else if (wanted) {
    result = shown.map(win => {
      const ranked = rank(fragrances, win, win.slot, { occasion, history, nudge });
      return { win, ranked, pick: ranked[0] };
    });
  } else {
    const next = nextOf(week(forecast).flatMap(d => [d.day, d.night].filter(Boolean)));
    const plan = planWindows(fragrances, [...shown, ...next], { history, nudge });
    [result, after] = [plan.slice(0, shown.length), plan.slice(shown.length)];
  }
  // A plan's ties are read over the window after it and the events after
  // today's windows too, which hold their bottles.
  const ties = events.length || !wanted ? newsOnly(result, planTies([...result, ...after, ...ahead], { history }).slice(0, result.length)) : tiesOf(result, false);

  if (args.json) {
    const eventJSON = ({ win, pick }) => ({ date: win.dateISO, slot: win.slot, occasion: win.occasion.id, pick: pick.fragrance.name });
    console.log(JSON.stringify({
      place,
      now: wx.now,
      occasion: occasion?.id ?? null,
      journal: freshness || false,
      slots: result.map((r, i) => slotJSON(r, ties[i])),
      ...(events.length && { events: [...result, ...ahead].filter(p => p.win.occasion).map(eventJSON) }),
    }, null, 2));
  } else {
    console.log(`${place.name} · now ${Math.round(wx.now.tempF)}°F ${wx.now.label}${occasion ? ` · occasion: ${occasion.label}` : ''}`);
    for (const [i, r] of result.entries()) {
      const win = r.win;
      printSlot(r, `${win.label}${forEvent(win)}: ${win.condition}, feels ${Math.round(win.feelsF)}°F, ${Math.round(win.humidity)}% humidity${win.pop >= 30 ? `, ${win.pop}% rain` : ''}`, ties[i]);
    }
    if (ahead.length) console.log('');
    for (const { win, pick } of ahead) {
      const what = eventPhrase({ dateISO: win.dateISO, slot: win.slot, occasion: win.occasion }, wx.todayISO);
      console.log(`For ${what}: ${pick.fragrance.name} (${pick.fragrance.brand})`);
    }
    sayJournal();
  }
}

// Discover (src/discover.js): bottles to buy from the suggestion pool, for
// the wardrobe as it stands (--exclude and --demo apply).
const SEASON_NAMES = ['winter', 'spring', 'summer', 'fall'];

async function discover(args, fragrances, { slot, count, history, hidden }) {
  const seasons = args.season ? args.season.toLowerCase().split(',').map(s => s.trim().replace(/^autumn$/, 'fall')).filter(Boolean) : null;
  for (const s of seasons ?? []) if (!SEASON_NAMES.includes(s)) fail(`--season takes ${SEASON_NAMES.join(', ')} (comma separated), not "${s}"`);
  const lean = args.lean?.toLowerCase();
  if (lean && !LEAN_WINDOWS[lean]) fail(`--lean takes ${Object.keys(LEAN_WINDOWS).join(', ')}, not "${args.lean}"`);
  const minValue = args['min-value'] == null ? null : Number(args['min-value']);
  if (minValue != null && !(minValue >= 1 && minValue <= 5)) fail(`--min-value takes a value-for-money score from 1 to 5, not "${args['min-value']}"`);
  const minRating = args['min-rating'] == null ? undefined : Number(args['min-rating']);
  if (minRating !== undefined && !(minRating >= 0 && minRating <= 5)) fail(`--min-rating takes a Fragrantica rating from 0 to 5, not "${args['min-rating']}"`);
  // A style query sets its own rating floor (the style's), unless one is given.
  const filters = { seasons, slot: slot ?? null, lean: lean ?? null, minValue, mists: args.mists, ...(minRating !== undefined && { minRating }) };

  const [pool, styles] = await Promise.all([loadPool(datasetFile), loadPoolStyles(datasetFile)]);
  const ctx = excluding(discoverContext(pool, fragrances, { styles }), 'allowed', hidden);
  const library = fragranticaLibrary(datasetFile);
  // A typed name: the wardrobe first (switched-off bottles too), then the
  // pool by votes, then the whole dataset (with its about data), as --check.
  const findAny = async name => {
    const mine = matchBottles([...fragrances, ...hidden], name);
    if (mine.length > 1) console.error(`"${name}" matches ${mine.map(f => f.name).join(', ')}; using ${mine[0].name}. Give more of the name for another.`);
    if (mine.length) return mine[0];
    const record = await datasetBottle(name, ctx.records, ctx.byId);
    return record && { ...record, about: await loadAbout(record.id, datasetFile) };
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
    ...(p.leans && { leansOnly: p.leans.map(id => styleById(id).label) }),
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
    for (const p of picks) if (p.clonesOf) addCloneVotes(p, await loadAbout(p.id, datasetFile));
    if (args.json) return console.log(JSON.stringify({ ...json, results: picks.map(pickJSON) }, null, 2));
    console.log(title);
    if (!picks.length) console.log('  Nothing in the pool passes. Try fewer filters.');
    picks.forEach((p, i) => console.log(`${String(i + 1).padStart(2)}. ${line(p.record, p)} · ${whyLine(p)}`));
    console.log(`\n${CREDIT}, 9,600 well-voted bottles.`);
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
    // Too few bottles are every style at once: the rest lean toward some, and say which.
    const whole = picks.filter(p => !p.leans).length;
    const leaning = whole < picks.length ? `\n${whole ? `Only ${whole} ${whole === 1 ? 'is' : 'are'}` : 'None is'} all of them at once; the rest lean toward some.` : '';
    await print(`More ${labels.join(args.all ? ' + ' : ', ')}${ids.length > 1 ? ` (${mode === 'all' ? 'all at once' : 'any of them'})` : ''}:${leaning}`, picks, { styles: ids, mode, filters });
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
  for (const r of more.values()) r.about = await loadAbout(r.id, datasetFile);
  const family = dupesOf(record, ctx, { more });
  const entryJSON = e => e && ({ id: e.id, name: e.name, brand: e.brand, rating: e.rating, votes: e.votes, value: e.value, similarity: e.sim, risk: e.risk.level,
    owned: e.owned, mist: e.mist, smellsLikeVotes: e.up == null ? null : [e.up, e.down], why: e.why, ...(e.notesDiffer && { notesDiffer: true }), ...(e.built != null && { built: e.built }) });
  if (args.json) {
    console.log(JSON.stringify({ name: record.name, brand: record.brand, original: entryJSON(family.original),
      cheaper: family.cheaper.map(entryJSON), siblings: family.siblings.map(entryJSON) }, null, 2));
    return;
  }
  const says = n => (n === 1 ? 'says' : 'say');
  const entryLine = e => `${line(e, e)}${e.sim != null ? ` · ${Math.round(100 * e.sim)}% alike` : ''}`
    + `${e.up != null ? ` · ${e.up} ${says(e.up)} it smells like it, ${e.down} not` : ''}${e.why === 'notes' ? ' · alike by notes' : ''}`
    + `${e.notesDiffer ? ' · notes differ' : ''}${e.mist ? ' · a body mist' : ''}${e.risk.level !== 'low' ? ` · ${e.risk.level} risk` : ''}${e.owned ? ' · you own it' : ''}`;
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
  console.log(`\n${CREDIT}.`);
}

const USAGE = `usage: node scripts/recommend.mjs (--city NAME | --loc LAT,LON[,NAME]) [--occasion ${OCCASIONS.map(o => o.id).join('|')}] [--slot day|night] [--week] [--events "DATE [day|night] OCCASION; …"] [--journal FILE|TOKEN] [--exclude NAME,NAME] [--demo] [--top N] [--json]
       node scripts/recommend.mjs --layer NAME|all [--city NAME | --loc LAT,LON[,NAME]] [--slot day|night] [--exclude NAME,NAME] [--json]
       node scripts/recommend.mjs --ideal NAME [--exclude NAME,NAME] [--json]
       node scripts/recommend.mjs --mix [--exclude NAME,NAME] [--demo] [--json]
       node scripts/recommend.mjs --doubles [--exclude NAME,NAME] [--demo] [--json]
       node scripts/recommend.mjs --styles NAME [--json]
       node scripts/recommend.mjs (--city NAME | --loc LAT,LON[,NAME]) --date YYYY-MM-DD [--occasion ID] [--slot day|night] [--events "DATE [day|night] OCCASION; …"] [--journal FILE|TOKEN] [--json]
       node scripts/recommend.mjs --pack (--city NAME | --loc LAT,LON[,NAME]) --from YYYY-MM-DD --to YYYY-MM-DD [--max N] [--events "DATE [day|night] OCCASION; …"] [--json]
       node scripts/recommend.mjs --spray NAME [--city NAME | --loc LAT,LON[,NAME]] [--date YYYY-MM-DD] [--occasion ID] [--slot day|night] [--json]
       node scripts/recommend.mjs --gaps [--city NAME | --loc LAT,LON[,NAME]] [--uses USE=never|sometimes|often,…] [--value | --no-value] [--mists] [--top N] [--exclude NAME,NAME] [--journal FILE|TOKEN] [--demo] [--json]
       node scripts/recommend.mjs --check NAME|ID|id:ID [--city NAME | --loc LAT,LON[,NAME]] [--uses …] [--value | --no-value] [--style STYLE,STYLE] [--exclude NAME,NAME] [--journal FILE|TOKEN] [--json]
       node scripts/recommend.mjs (--style STYLE,STYLE|liked [--all] | --more-like NAME,NAME|favorites | --notes "NOTE NOTE") [--season S,S] [--slot day|night] [--lean feminine|unisex|masculine] [--min-value V] [--min-rating R] [--mists] [--top N] [--exclude NAME,NAME] [--json]
       node scripts/recommend.mjs --dupes NAME [--top N] [--json]`;

if (import.meta.main) await main();
