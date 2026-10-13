import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findOccasion, matchBottles } from '../scripts/recommend.mjs';

const script = fileURLToPath(new URL('../scripts/recommend.mjs', import.meta.url));
const mock = fileURLToPath(new URL('./mock-fetch.mjs', import.meta.url));
const { fragrances } = JSON.parse(readFileSync(new URL('../data/collection.json', import.meta.url)));
// The CLI against the synthetic forecast, no network.
const cli = (...args) => spawnSync(process.execPath, ['--import', mock, script, ...args], { encoding: 'utf8' });
const offline = (...args) => spawnSync(process.execPath, ['--import', mock, script, ...args], { encoding: 'utf8', env: { ...process.env, MOCK_OFFLINE: '1' } });

test('occasions resolve by id or label, any case or spacing', () => {
  assert.equal(findOccasion('date').id, 'date');
  assert.equal(findOccasion('Date Night').id, 'date');
  assert.equal(findOccasion('night out').id, 'nightout');
  assert.equal(findOccasion('EVERYDAY').id, 'casual');
  assert.equal(findOccasion('evening'), null);
});

test('bottle names match exactly first, else by part', () => {
  assert.deepEqual(matchBottles(fragrances, 'sauvage').map(f => f.name), ['Sauvage']);
  assert.deepEqual(matchBottles(fragrances, 'détour').map(f => f.name), ['Détour Noir']);
  assert.deepEqual(matchBottles(fragrances, 'detour').map(f => f.name), ['Détour Noir'], 'accents don’t matter');
  assert.ok(matchBottles(fragrances, 'blanc').length >= 3);
  assert.deepEqual(matchBottles(fragrances, 'zzz'), []);
});

test('bad arguments stop with a message before any request', () => {
  const slot = cli('--loc', '40.7,-74', '--slot', 'evening');
  assert.equal(slot.status, 1);
  assert.match(slot.stderr, /--slot must be day or night/);
  const occ = cli('--loc', '40.7,-74', '--occasion', 'Evening');
  assert.equal(occ.status, 1);
  assert.match(occ.stderr, /Pick one of: casual \(Everyday\), office/);
  const loc = cli('--loc', '40.7');
  assert.equal(loc.status, 1);
  assert.match(loc.stderr, /--loc takes LAT,LON/);
  assert.doesNotMatch(loc.stderr, /at .*\.mjs:\d+/, 'no stack trace');
});

test('no network reads as a plain message, not a stack trace', () => {
  for (const run of [offline('--loc', '40.7,-74'), offline('--city', 'Testville')]) {
    assert.equal(run.status, 1);
    assert.match(run.stderr, /^Couldn't (get the forecast|look up "Testville")/);
    assert.doesNotMatch(run.stderr, /at .*\.mjs:\d+/);
  }
});

test('today\'s picks run in time order, plan like the app and keep every bottle unless --demo', () => {
  const run = cli('--loc', '40.7,-74', '--json', '--exclude', 'sauv,nothing like it');
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stderr, /"nothing like it" matches no bottle/);
  const out = JSON.parse(run.stdout);
  const order = out.slots.map(s => `${s.window.date} ${s.slot}`);
  assert.deepEqual(order, [...order].sort((a, b) => a.localeCompare(b) || 0));
  const names = out.slots[0].ranked.map(r => r.name);
  assert.ok(!names.includes('Sauvage'), 'part of a name excludes');
  assert.ok(names.includes('Jake'), 'David’s own bottles all count');
  if (out.slots.length === 2) assert.notEqual(out.slots[0].pick.name, out.slots[1].pick.name, 'planned together');
  const demo = JSON.parse(cli('--loc', '40.7,-74', '--json', '--demo').stdout);
  assert.ok(!demo.slots[0].ranked.some(r => r.name === 'Jake'));
});

test('--journal rotates out what was just worn, and --week --occasion plans its own slot', () => {
  const first = JSON.parse(cli('--loc', '40.7,-74', '--json', '--slot', 'night').stdout).slots[0];
  const worn = fragrances.find(f => f.name === first.pick.name);
  const dir = mkdtempSync(join(tmpdir(), 'scentcast-'));
  const file = join(dir, 'journal.json');
  const yesterday = new Date(Date.parse(`${first.window.date}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  writeFileSync(file, JSON.stringify({ app: 'scentcast-journal', history: [{ id: String(worn.id), date: yesterday, slot: 'night' }] }));
  const after = JSON.parse(cli('--loc', '40.7,-74', '--json', '--slot', 'night', '--journal', file).stdout).slots[0];
  assert.ok(after.ranked.find(r => r.name === worn.name).reasons.includes('- Worn yesterday'));
  assert.notEqual(after.pick.name, worn.name);

  const week = JSON.parse(cli('--loc', '40.7,-74', '--json', '--week', '--occasion', 'date night').stdout);
  const slots = week.days.flatMap(d => d.picks.map(p => p.slot));
  assert.ok(slots.length >= 6 && slots.every(s => s === 'night'), slots.join(','));
});

test('an ambiguous name says which bottle it took', () => {
  const run = cli('--ideal', 'blanc', '--json');
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stderr, /"blanc" matches .+; using /);
  const out = JSON.parse(run.stdout);
  assert.ok(out.range && out.topPick.day && out.topPick.night);
});
