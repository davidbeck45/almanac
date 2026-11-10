#!/usr/bin/env node
// Times every question the app asks of the suggestion pool (src/pool-tasks.js),
// as the pool worker answers them, and checks that a change left every answer
// as it was:
//   node scripts/bench-pool.mjs                  (the table)
//   node scripts/bench-pool.mjs --json FILE      (the figures, to compare later)
//   node scripts/bench-pool.mjs --answers FILE   (every answer, before a change)
//   node scripts/bench-pool.mjs --against FILE   (after it: each must be deep-equal)
//   node scripts/bench-pool.mjs --stages         (where a first answer's time goes)
//   node scripts/bench-pool.mjs --quick          (David's wardrobe only)
//   node scripts/bench-pool.mjs --no-cold        (skip the cold runs: warm figures and answers only)
// Three wardrobes (David's, data/collection.json; 9 and 60 bottles drawn from
// the pool's most voted) in two climates (the default, and New York's from
// dev/offline/ny-climate.json, for the questions that read one).
//   cold: the question asked first of a fresh process, as a fresh worker has
//         it: the pool parsed, its records made, the wardrobe's context, the
//         answer. COLD_RUNS processes each, the quickest (other work on
//         the machine only ever adds).
//   warm: the same cache asked again, each of the question's variations: the
//         median and the slowest of WARM_PASSES passes.
// Times are the main thread's CPU time (process.threadCpuUsage), which is
// the wall time on an idle machine and holds steady on a busy one; a cold
// answer's pool, context and task parts are its own wall-clock shares of it.
// Desktop Chromium's worker takes about as long (dev/pool.html times that),
// and a phone about four times as long.
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { handlePool, newPoolCache } from '../src/pool-tasks.js';
import { loadPool, fromPool, loadPoolStyles } from '../src/fragrantica.js';
import { climateSummary, gapContext, gapReport, warmPoolTable, DEFAULT_CLIMATE } from '../src/gaps.js';
import { discoverContext, moreOfStyles } from '../src/discover.js';
import { novelty, ownedVectors } from '../src/candidates.js';

const COLD_RUNS = 3;
const WARM_PASSES = 3;
const AT_ONCE = 2; // cold processes run side by side
const LIKED = ['skin', 'clean', 'intimate'];
// Bottles checked: twins of what David owns, strong fits, risky ones, body
// mists, classics he's covered for, and ids the pool doesn't have.
const CHECK_IDS = ['76063', '84109', '12807', '9828', '31861', '410', '704', '1018', '485', '25324', '48681', '13016', '210', '77', '4262', '31691', '14982', '62615',
  '51496', '5521', '1825', '34696', '611', '9099', '999999901'];

const root = new URL('../', import.meta.url);
const text = new Map();
const read = path => {
  if (!text.has(path)) text.set(path, existsSync(new URL(path, root)) ? readFileSync(new URL(path, root), 'utf8') : null);
  return text.get(path);
};
// A loader of its own per cache, so each parses the pool afresh (src/fragrantica.js keeps parsed files per loader).
const loader = () => async path => read(`data/fragrantica/${path}`);
const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
// This thread's CPU time so far, ms.
const cpu = () => {
  const used = process.threadCpuUsage();
  return (used.user + used.system) / 1000;
};
const round = x => Math.round(x * 10) / 10;

/** New York's climate summary, from the saved windows the offline stub answers with. */
function newYork() {
  const saved = JSON.parse(read('dev/offline/ny-climate.json')), start = Date.parse(`${saved.from}T12:00:00Z`);
  const windows = ['day', 'night'].flatMap(slot => saved[slot].map(([feelsF, dewF], i) => (
    { dateISO: new Date(start + i * 864e5).toISOString().slice(0, 10), slot, feelsF, dewF, lat: 40.71 })));
  return climateSummary(windows);
}

/** The three wardrobes, as a page sends them (plain data, string ids). */
async function wardrobes() {
  const david = JSON.parse(read('data/collection.json')).fragrances.map(f => ({ ...f, id: String(f.id) }));
  const pool = await loadPool(loader());
  const byVotes = pool.cols.rv.map((votes, i) => [votes, i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).map(([, i]) => i);
  const drawn = (n, first, step) => Array.from({ length: n }, (_, k) => structuredClone(fromPool(pool, byVotes[first + k * step])));
  return { david, nine: drawn(9, 11, 37), sixty: drawn(60, 3, 23) };
}

// Each question's variations, as the screens ask them (dev/pool.html's, and more for the answers).
const questions = (owned, summary) => ({
  report: [{ owned, summary, k: 5 }, { owned, summary, k: 5, preferValue: false }, { owned, summary, k: 8 }, { owned, summary, k: 5, mists: true },
    { owned, summary, k: 5, uses: { office: 'never', formal: 'often' } }, { owned, summary, k: 5, exclude: [owned[2].id, owned[5].id] }],
  check: [{ owned, summary, id: '76063', liked: LIKED }, { owned, summary, id: '84109' }, { owned, summary, ids: CHECK_IDS, liked: LIKED },
    { owned, summary, ids: CHECK_IDS, preferValue: false, mists: true }, { owned, summary, ids: CHECK_IDS.slice(0, 8), liked: ['vanilla', 'oud'], stated: false }],
  liked: [{ owned, stated: LIKED }, { owned }],
  styles: [{ owned, styles: LIKED }, { owned, styles: ['skin'] }, { owned, styles: ['vanilla', 'amber'], mode: 'all' },
    { owned, styles: ['oud', 'leather'], filters: { seasons: ['winter'], slot: 'night' } }, { owned, styles: LIKED, k: 20, filters: { mists: true, lean: 'masculine' } },
    { owned, styles: ['citrus', 'aquatic', 'green'], preferValue: true }],
  moreLike: [{ owned, seeds: [owned[0].id, owned[1].id] }, { owned, seeds: ['9828'] }, { owned }, { owned, seeds: [owned[3].id], k: 20, filters: { minValue: 3.8 } }],
  notes: [{ owned, query: 'iris leather' }, { owned, query: 'smoky vanilla' }, { owned, query: 'fig' }, { owned, query: 'tonka bean and oud', filters: { slot: 'night' } },
    { owned, query: 'vanila', k: 20 }, { owned, query: 'lavender', filters: { excludeOwned: false } }],
  dupes: [{ owned, id: '9828' }, { owned, id: owned[0].id }, { owned, id: '76063' }, { owned, id: '410' }],
  records: [{ ids: ['76063', '12807', '9828'] }, { ids: ['48681'] }],
  warm: [{ summary }],
});
// The questions that read the climate, asked in each; the rest once.
const BY_CLIMATE = new Set(['report', 'check', 'warm']);

// ---------------------------------------------------------------- one cold answer (a child process)

// { type, payload } on stdin -> { ms, parts } on stdout: the first question a fresh process is asked.
async function child() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const { type, payload } = JSON.parse(input);
  for (const file of ['pool.json', 'pool-notes.json', 'pool-styles.json']) read(`data/fragrantica/${file}`);
  const cache = newPoolCache({ load: loader() });
  const t = cpu(), wall = performance.now();
  const answer = await handlePool({ id: 1, type, payload }, cache);
  const ms = cpu() - t, share = ms / (performance.now() - wall);
  if (answer.error) throw new Error(`${type}: ${answer.error} ${answer.detail ?? ''}`);
  process.stdout.write(JSON.stringify({ ms, parts: Object.fromEntries(Object.entries(answer.ms ?? {}).map(([k, v]) => [k, v * share])) }));
}

function cold(type, payload) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [fileURLToPath(import.meta.url), '--child'], { stdio: ['pipe', 'pipe', 'inherit'] });
    let out = '';
    proc.stdout.on('data', d => { out += d; });
    proc.on('close', code => (code ? reject(new Error(`cold ${type} failed`)) : resolve(JSON.parse(out))));
    proc.stdin.end(JSON.stringify({ type, payload }));
  });
}

// Jobs run AT_ONCE at a time, results in order.
async function inTurn(jobs) {
  const results = new Array(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: AT_ONCE }, async () => {
    while (next < jobs.length) {
      const i = next++;
      results[i] = await jobs[i]();
    }
  }));
  return results;
}

// ---------------------------------------------------------------- stages (a child process, David's wardrobe)

// What a fresh worker does before its first answer, each step timed on its own.
async function stages() {
  const owned = JSON.parse(read('data/collection.json')).fragrances.map(f => ({ ...f, id: String(f.id) }));
  const out = {}, load = loader();
  const time = async (name, fn) => {
    const t = cpu(), value = await fn();
    out[name] = round(cpu() - t);
    return value;
  };
  const texts = ['pool.json', 'pool-notes.json', 'pool-styles.json'].map(f => read(`data/fragrantica/${f}`));
  await time('parse the three files', () => texts.map(t => JSON.parse(t)));
  const [pool, styles] = await Promise.all([loadPool(load), loadPoolStyles(load)]);
  const records = await time('fromPool, every row', () => Array.from({ length: pool.count }, (_, i) => fromPool(pool, i)));
  const byId = new Map(records.map(r => [r.id, r]));
  await time('the pool’s table (warmPoolTable)', () => warmPoolTable(records, DEFAULT_CLIMATE, { pause: async () => {} }));
  const ctx = await time('gapContext, table in hand', () => gapContext({ owned, records, byId }));
  await time('gapReport', () => gapReport(ctx, { k: 5 }));
  const shown = await time('discoverContext', () => discoverContext(null, owned, { styles, records }));
  await time('moreOfStyles, first', () => moreOfStyles(LIKED, shown, { k: 10 }));
  const vecs = ownedVectors(owned, byId);
  await time('novelty, every row', () => records.map(r => novelty(r, vecs)));
  process.stdout.write(JSON.stringify(out));
}

// ---------------------------------------------------------------- the run

const { values: args } = parseArgs({
  options: {
    json: { type: 'string' }, answers: { type: 'string' }, against: { type: 'string' },
    quick: { type: 'boolean', default: false }, stages: { type: 'boolean', default: false }, 'no-cold': { type: 'boolean', default: false },
    child: { type: 'boolean', default: false }, 'stages-child': { type: 'boolean', default: false },
  },
});

async function main() {
  const all = await wardrobes(), climates = { default: null, 'new york': newYork() };
  const names = args.quick ? ['david'] : Object.keys(all);
  const figures = { node: process.version, cold: {}, warm: {} }, answers = {};

  // Warm timings and the answers, one cache per wardrobe (as one worker serves a visit).
  for (const name of names) {
    const cache = newPoolCache({ load: loader() });
    for (const [climate, summary] of Object.entries(climates)) {
      for (const [type, payloads] of Object.entries(questions(all[name], summary))) {
        if (climate !== 'default' && !BY_CLIMATE.has(type)) continue;
        const key = `${name} · ${type}${BY_CLIMATE.has(type) ? ` · ${climate}` : ''}`, times = [];
        for (let pass = 0; pass <= WARM_PASSES; pass++) {
          for (const [i, payload] of payloads.entries()) {
            const t = cpu(), answer = await handlePool({ id: 1, type, payload }, cache), ms = cpu() - t;
            if (answer.error) throw new Error(`${key} #${i}: ${answer.error} ${answer.detail ?? ''}`);
            // The first pass makes the contexts (cold's business) and gives the answers.
            if (pass) times.push(ms);
            else answers[`${key} #${i}`] = JSON.parse(JSON.stringify(answer.result));
          }
        }
        figures.warm[key] = { median: round(median(times)), max: round(Math.max(...times)) };
      }
    }
  }

  if (args.answers) {
    writeFileSync(args.answers, JSON.stringify(answers));
    console.log(`${Object.keys(answers).length} answers saved to ${args.answers}`);
  }
  let moved = null;
  if (args.against) {
    const before = JSON.parse(readFileSync(args.against, 'utf8'));
    // The answers this run asked for (--quick asks fewer than the file may hold).
    moved = Object.keys(answers).filter(key => !isDeepStrictEqual(before[key], answers[key]));
    console.log(moved.length ? `ANSWERS MOVED (${moved.length} of ${Object.keys(answers).length}):\n  ${moved.join('\n  ')}`
      : `All ${Object.keys(answers).length} answers are deep-equal to ${args.against}`);
  }

  // Cold timings: a fresh process per question, its first variation.
  const jobs = [];
  for (const name of names) {
    for (const [climate, summary] of Object.entries(climates)) {
      for (const [type, [payload]] of Object.entries(questions(all[name], summary))) {
        if (climate !== 'default' && !BY_CLIMATE.has(type)) continue;
        const key = `${name} · ${type}${BY_CLIMATE.has(type) ? ` · ${climate}` : ''}`;
        jobs.push(async () => {
          const runs = [];
          for (let i = 0; i < COLD_RUNS; i++) runs.push(await cold(type, payload));
          const [mid] = runs.sort((a, b) => a.ms - b.ms);
          figures.cold[key] = { ms: round(mid.ms), ...Object.fromEntries(Object.entries(mid.parts ?? {}).filter(([k]) => k !== 'total').map(([k, v]) => [k, round(v)])) };
        });
      }
    }
  }
  if (!args['no-cold']) await inTurn(jobs);

  if (args.json) writeFileSync(args.json, JSON.stringify(figures, null, 1));
  const pad = (x, n) => String(x).padStart(n);
  console.log(`\nNode ${process.version}; CPU ms. cold: a fresh process's first answer (pool + context + task); warm: median / max of later ones`);
  console.log(`${'question'.padEnd(34)} ${pad('cold', 7)}  ${pad('pool', 6)} ${pad('context', 7)} ${pad('task', 6)}   warm`);
  for (const key of Object.keys(figures.warm)) {
    const c = figures.cold[key] ?? {}, w = figures.warm[key];
    console.log(`${key.padEnd(34)} ${pad(c.ms ?? '', 7)}  ${pad(c.pool ?? '', 6)} ${pad(c.context ?? '', 7)} ${pad(c.task ?? '', 6)}   ${w.median} / ${w.max}`);
  }
  if (moved?.length) process.exitCode = 1;
}

async function showStages() {
  const run = () => new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [fileURLToPath(import.meta.url), '--stages-child'], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    proc.stdout.on('data', d => { out += d; });
    proc.on('close', code => (code ? reject(new Error('stages failed')) : resolve(JSON.parse(out))));
  });
  const runs = [];
  for (let i = 0; i < COLD_RUNS; i++) runs.push(await run());
  const best = name => Math.min(...runs.map(r => r[name]));
  console.log(`A fresh process, David's wardrobe, the default climate (CPU ms, the quickest of ${COLD_RUNS}):`);
  for (const name of Object.keys(runs[0])) console.log(`  ${name.padEnd(36)} ${String(best(name)).padStart(7)}`);
  if (args.json) writeFileSync(args.json, JSON.stringify(Object.fromEntries(Object.keys(runs[0]).map(n => [n, best(n)])), null, 1));
}

await (args.child ? child() : args['stages-child'] ? stages() : args.stages ? showStages() : main());
