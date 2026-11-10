// Runs the suite as of other moments and zones, to catch tests (and code)
// that only pass on the day, hour or zone they were written in.
//   npm run test:dates                 a compact matrix, about a minute
//   node test/dates.mjs --full         every moment below in every zone
//   node test/dates.mjs --at 2027-03-14T02:30 --tz America/Chicago [--all] [file…]
//                                      one moment, its failures in full
// Each cell is `node --test` under test/at.mjs (the clock moved, for every
// process the tests spawn too) with TZ set. A moment without a zone is local
// to the cell's TZ; "+1mo" and the like count from now. The first cell runs
// every file and notes which read the clock; the rest run only those (--all
// runs every file every time), and the compact matrix leaves out HEAVY's too.
// It prints a line a cell and each failing test under it; a cell that failed
// runs once more on its own, since tests that time themselves fail under the
// matrix's load, and only one that fails again counts. Exits 1 when any did.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ZONES = ['America/Chicago', 'UTC', 'Asia/Tokyo', 'Pacific/Auckland', 'America/St_Johns'];
const FROM_NOW = ['now', '+1d', '+7d', '+1mo', '+6mo', '+1y', '+2y'];
const HOURS = ['01:30', '02:30', '12:00', '23:30'];
// The clocks change: the US's in 2027, Europe's (London's zone added for
// those, as none of ZONES keeps them) and New Zealand's.
const US_CHANGES = ['2027-03-14', '2027-11-07'], EU_CHANGES = ['2027-03-28', '2027-10-31'], NZ_CHANGES = ['2027-04-04', '2027-09-26'];
const LOCAL = ['2026-12-31T23:30', '2027-01-01T00:30', '2028-02-29T12:00', ...[...US_CHANGES, ...EU_CHANGES].flatMap(d => HOURS.map(h => `${d}T${h}`))];

const FULL = [
  ...[...FROM_NOW, ...LOCAL].flatMap(at => ZONES.map(tz => ({ at, tz }))),
  ...EU_CHANGES.flatMap(d => HOURS.map(h => ({ at: `${d}T${h}`, tz: 'Europe/London' }))),
  ...NZ_CHANGES.flatMap(d => ['02:30', '03:30'].map(h => ({ at: `${d}T${h}`, tz: 'Pacific/Auckland' }))),
];
// Files that read the clock but whose tests take none of their answers from
// it (a stopwatch, a module that reads the date as it loads), most taking
// 5–19 s: the compact matrix runs them in its first cell only, --full in
// every cell. With them in, the compact matrix's 16 moments failed only their
// stopwatches, under its own load (November 2026).
const HEAVY = ['discover', 'discover-screens', 'gaps', 'pool', 'pool-tasks', 'reasons', 'scent-styles', 'shell', 'skin', 'wardrobe-screens'].map(n => `test/${n}.test.js`);
// One of each kind, the zones taking turns: the days ahead, the year's turn
// late and early (this machine's date a day off the place's, in midwinter),
// a leap day, and the hours the clocks change.
const COMPACT = [
  { at: 'now', tz: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone },
  { at: '+1d', tz: 'UTC' },
  { at: '+7d', tz: 'Pacific/Auckland' },
  { at: '+1mo', tz: 'Asia/Tokyo' },
  { at: '+6mo', tz: 'America/St_Johns' },
  { at: '+1y', tz: 'America/Chicago' },
  { at: '+2y', tz: 'UTC' },
  { at: '2026-12-31T23:30', tz: 'America/Chicago' },
  { at: '2027-01-01T00:30', tz: 'Asia/Tokyo' },
  { at: '2028-02-29T12:00', tz: 'Pacific/Auckland' },
  { at: '2027-03-14T02:30', tz: 'America/Chicago' },
  { at: '2027-11-07T01:30', tz: 'America/Chicago' },
  { at: '2027-03-28T01:30', tz: 'Europe/London' },
  { at: '2027-10-31T23:30', tz: 'America/St_Johns' },
];

/** "+1mo" from `from` as an ISO moment (calendar steps in UTC); anything else as given. */
export function momentOf(at, from = new Date()) {
  const m = /^\+(\d+)(d|mo|y)$/.exec(at);
  if (at !== 'now' && !m) return at;
  const d = new Date(from);
  if (m?.[2] === 'd') d.setUTCDate(d.getUTCDate() + +m[1]);
  if (m?.[2] === 'mo') d.setUTCMonth(d.getUTCMonth() + +m[1]);
  if (m?.[2] === 'y') d.setUTCFullYear(d.getUTCFullYear() + +m[1]);
  return d.toISOString();
}

// As node --test's reporter (the cells run with this file as theirs): a JSON
// line for each failing test and one with the counts.
export default async function* reporter(source) {
  let pass = 0, fail = 0;
  for await (const { type, data } of source) {
    if (data?.details?.type === 'suite' || data?.details?.error?.failureType === 'subtestsFailed') continue;
    if (type === 'test:pass') pass++;
    if (type !== 'test:fail') continue;
    fail++;
    const error = data.details?.error, cause = error?.cause ?? error;
    yield `${JSON.stringify({ fail: { file: data.file, name: data.name, message: String(cause?.message ?? cause ?? '').split('\n').slice(0, 6).join('\n') } })}\n`;
  }
  yield `${JSON.stringify({ pass, fail })}\n`;
}

const root = fileURLToPath(new URL('..', import.meta.url));
const AT = pathToFileURL(join(root, 'test/at.mjs')).href, SELF = pathToFileURL(fileURLToPath(import.meta.url)).href;

function runCell({ at, tz }, { files = [], clockLog, started }) {
  const env = { ...process.env, TZ: tz, ALMANAC_DATES: '1', ALMANAC_NOW: momentOf(at, started), NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import ${AT}`.trim() };
  delete env.ALMANAC_SHIFT;
  if (clockLog) env.ALMANAC_CLOCK_LOG = clockLog; else delete env.ALMANAC_CLOCK_LOG;
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['--test', `--test-reporter=${SELF}`, '--test-reporter-destination=stdout', ...files], { cwd: root, env });
    let out = '', err = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('close', code => {
      const fails = [];
      let counts = null;
      for (const line of out.split('\n')) {
        if (!line.startsWith('{')) continue;
        try {
          const row = JSON.parse(line);
          if (typeof row.fail === 'object') fails.push(row.fail); else counts = row;
        } catch { /* a test's own output */ }
      }
      resolve({ at, tz, moment: env.ALMANAC_NOW, code, fails, counts, err: counts ? '' : err.trim().split('\n').slice(-5).join('\n') });
    });
  });
}

const failed = r => r.code !== 0 || !r.counts || r.fails.length > 0;
function report(r, { verbose }) {
  const label = `${r.at.padEnd(17)} ${r.tz.padEnd(17)}`;
  if (!failed(r)) return console.log(`ok    ${label} ${r.counts.pass} tests`);
  console.log(`FAIL  ${label} ${r.counts ? `${r.fails.length} of ${r.counts.pass + r.counts.fail} tests` : 'the run broke'}${r.at === r.moment ? '' : `  (${r.moment})`}`);
  for (const f of r.fails) {
    console.log(`        ${f.file ? relative(root, f.file) : '?'} › ${f.name}`);
    if (verbose && f.message) console.log(f.message.replace(/^/gm, '            '));
  }
  if (r.err) console.log(r.err.replace(/^/gm, '        '));
}

async function main(argv) {
  const flag = name => argv.includes(name);
  const value = name => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : null);
  const named = argv.filter((a, i) => !a.startsWith('--') && !['--at', '--tz', '--jobs'].includes(argv[i - 1]));
  const one = value('--at') ? [{ at: value('--at'), tz: value('--tz') || process.env.TZ || 'UTC' }] : null;
  const cells = one ?? (flag('--full') ? FULL : COMPACT);
  const jobs = Number(value('--jobs')) || 8;
  const started = new Date(), t0 = performance.now();
  const dir = mkdtempSync(join(tmpdir(), 'almanac-dates-'));
  const results = [];
  try {
    // The first cell alone, every file: it says which files read the clock.
    const clockLog = join(dir, 'clock.log');
    const first = await runCell(cells[0], { files: named, clockLog, started });
    results.push(first);
    report(first, { verbose: !!one });
    let files = named;
    if (!named.length && !flag('--all') && cells.length > 1) {
      let read = [];
      try { read = [...new Set(readFileSync(clockLog, 'utf8').split('\n').map(l => l.split('\t')[0]).filter(Boolean))].sort(); } catch { /* none read it */ }
      // A file that failed outright never got to say; keep it in.
      files = [...new Set([...read, ...first.fails.map(f => f.file).filter(Boolean)])];
      const heavy = flag('--full') ? [] : files.filter(f => HEAVY.includes(relative(root, f)));
      files = files.filter(f => !heavy.includes(f));
      const short = list => list.map(f => relative(root, f).replace(/^test\/|\.test\.js$/g, '')).join(', ');
      console.log(`      ${read.length} files read the clock; the rest of the matrix runs ${files.length}: ${short(files)}${heavy.length ? `\n      (not ${short(heavy)}: --full runs those too)` : ''}`);
      if (!files.length) return 0;
    }
    const rest = cells.slice(1);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(jobs, rest.length) }, async () => {
      while (next < rest.length) {
        const r = await runCell(rest[next++], { files, started });
        results.push(r);
        report(r, { verbose: !!one });
      }
    }));
    // Once more, alone, for a cell that failed: a test that times itself
    // fails under the matrix's own load, whatever the date.
    for (const r of results.filter(r => failed(r) && r.fails.length)) {
      const again = await runCell(r, { files: [...new Set(r.fails.map(f => f.file).filter(Boolean))], started });
      const still = again.fails.filter(f => r.fails.some(g => g.file === f.file && g.name === f.name));
      if (failed(again) && !still.length && !again.counts) continue;
      console.log(`${still.length ? 'again' : 'alone'} ${r.at.padEnd(17)} ${r.tz.padEnd(17)} ${still.length ? `fails again: ${still.map(f => f.name).join('; ')}` : `passes on its own (${r.fails.map(f => f.name).join('; ')})`}`.slice(0, 260));
      r.flaky = r.fails.filter(f => !still.some(g => g.file === f.file && g.name === f.name));
      r.fails = still;
      if (!still.length) r.code = 0;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const bad = results.filter(failed), flaky = results.filter(r => r.flaky?.length).length;
  console.log(`\n${bad.length ? `${bad.length} of ${results.length} moments failed` : `All ${results.length} moments pass`}${flaky ? `, ${flaky} on a second run alone` : ''} (${Math.round((performance.now() - t0) / 1000)} s).`);
  if (bad.length) {
    const tests = new Map();
    for (const r of bad) for (const f of r.fails) tests.set(`${f.file ? relative(root, f.file) : '?'} › ${f.name}`, [...(tests.get(`${f.file ? relative(root, f.file) : '?'} › ${f.name}`) ?? []), `${r.at} ${r.tz}`]);
    for (const [name, at] of tests) console.log(`  ${name}\n      ${at.length} moment${at.length === 1 ? '' : 's'}: ${at.slice(0, 4).join('; ')}${at.length > 4 ? '; …' : ''}`);
    console.log('Rerun one with its failures in full: node test/dates.mjs --at <moment> --tz <zone> [test/file.test.js]');
  }
  return bad.length ? 1 : 0;
}

// node --test runs every file under test/ as a test file, this one too: only
// a plain `node test/dates.mjs` runs the matrix, never a cell of its own.
if (process.argv[1] === fileURLToPath(import.meta.url) && !process.env.NODE_TEST_CONTEXT && !process.env.ALMANAC_DATES) process.exitCode = await main(process.argv.slice(2));
