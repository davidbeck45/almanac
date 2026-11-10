// Runs whatever loads it as of another moment, for checking the suite on
// other days, hours and zones (test/dates.mjs runs the matrix):
//   ALMANAC_NOW=2027-03-14T02:30 TZ=America/Chicago NODE_OPTIONS="--import $PWD/test/at.mjs" node --test
// ALMANAC_NOW is an ISO moment, read in TZ when it names no zone. The clock
// keeps running from there: Date.now() and a no-argument new Date() (and
// Date() called plain) move by the same shift in every process, as children
// inherit it (ALMANAC_SHIFT), so a test and the CLI it spawns agree about now.
// Dates made from arguments are untouched, and node:test's mock timers still
// work: they wrap whatever Date is in place and put it back after.
// A test whose answer turns with the date pins the CLIs it spawns instead:
// t.after(pinCLI('2026-11-09T22:00:00Z')).
// With ALMANAC_CLOCK_LOG set, a test file that reads the clock (itself or a
// process it spawns) is written to that file once per process, with the line
// that first read it, so the matrix can skip the files that never do.
import { appendFileSync } from 'node:fs';

const Real = Date;
const asked = process.env.ALMANAC_NOW;
if (asked && process.env.ALMANAC_SHIFT == null) {
  const at = Real.parse(asked);
  if (Number.isNaN(at)) throw new Error(`ALMANAC_NOW isn't a date: ${asked}`);
  process.env.ALMANAC_SHIFT = String(at - Real.now());
}
const shift = Number(process.env.ALMANAC_SHIFT ?? 0);

if (shift) {
  // The test file's own path, for the processes it spawns to name it by.
  const log = process.env.ALMANAC_CLOCK_LOG;
  if (log && !process.env.ALMANAC_CLOCK_FILE && /\.test\.[cm]?js$/.test(process.argv[1] ?? '')) process.env.ALMANAC_CLOCK_FILE = process.argv[1];
  let noted = !log || !process.env.ALMANAC_CLOCK_FILE;
  const now = () => {
    if (!noted) {
      noted = true;
      // With the first line outside this file that read it, for telling a date read from a stopwatch.
      const where = new Error().stack.split('\n').slice(1).find(l => !l.includes('/test/at.mjs') && !l.includes('node:'))?.trim().replace(/^at /, '') ?? '';
      try { appendFileSync(log, `${process.env.ALMANAC_CLOCK_FILE}\t${where}\n`); } catch { /* the log is a hint, never a failure */ }
    }
    return Real.now() + shift;
  };
  function ShiftedDate(...args) {
    if (!new.target) return new Real(now()).toString();
    return Reflect.construct(Real, args.length ? args : [now()], new.target);
  }
  for (const key of Object.getOwnPropertyNames(Real)) {
    if (key !== 'prototype' && key !== 'now') Object.defineProperty(ShiftedDate, key, Object.getOwnPropertyDescriptor(Real, key));
  }
  ShiftedDate.now = now;
  ShiftedDate.prototype = Real.prototype; // so instances are plain Dates
  globalThis.Date = ShiftedDate;
}

/**
 * Pins the clock of the processes this one spawns from here on to `iso` (they
 * inherit the environment) and returns what puts it back: for a test of the
 * CLI whose answer turns with the season or the hour, whenever the suite runs.
 */
export function pinCLI(iso) {
  const keep = Object.fromEntries(['ALMANAC_NOW', 'ALMANAC_SHIFT', 'NODE_OPTIONS'].map(k => [k, process.env[k]]));
  process.env.ALMANAC_NOW = iso;
  delete process.env.ALMANAC_SHIFT;
  if (!keep.NODE_OPTIONS?.includes(import.meta.url)) process.env.NODE_OPTIONS = `${keep.NODE_OPTIONS ?? ''} --import ${import.meta.url}`.trim();
  return () => {
    for (const [k, v] of Object.entries(keep)) {
      if (v == null) delete process.env[k]; else process.env[k] = v;
    }
  };
}
