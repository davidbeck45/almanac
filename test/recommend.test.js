import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findOccasion, matchBottles, parseEvents, weatherFailure } from '../scripts/recommend.mjs';

const script = fileURLToPath(new URL('../scripts/recommend.mjs', import.meta.url));
const mock = fileURLToPath(new URL('./mock-fetch.mjs', import.meta.url));
const { fragrances } = JSON.parse(readFileSync(new URL('../data/collection.json', import.meta.url)));
// The CLI against the synthetic forecast, no network.
const cli = (...args) => spawnSync(process.execPath, ['--import', mock, script, ...args], { encoding: 'utf8' });
const offline = (...args) => spawnSync(process.execPath, ['--import', mock, script, ...args], { encoding: 'utf8', env: { ...process.env, MOCK_OFFLINE: '1' } });
// The same, as a promise, for runs side by side.
const run = (...args) => new Promise(resolve => {
  execFile(process.execPath, ['--import', mock, script, ...args], { encoding: 'utf8' }, (err, stdout, stderr) => resolve({ status: err ? err.code ?? 1 : 0, stdout, stderr }));
});

test('occasions resolve by id or label, any case or spacing', () => {
  assert.equal(findOccasion('date').id, 'date');
  assert.equal(findOccasion('Date Night').id, 'date');
  assert.equal(findOccasion('night out').id, 'nightout');
  assert.equal(findOccasion('CASUAL').id, 'casual');
  assert.equal(findOccasion('Everyday').id, 'casual', 'its old name');
  assert.equal(findOccasion('evening'), null);
});

test('bottle names match exactly first, else by part', () => {
  assert.deepEqual(matchBottles(fragrances, 'sauvage').map(f => f.name), ['Sauvage']);
  assert.deepEqual(matchBottles(fragrances, 'détour').map(f => f.name), ['Détour Noir']);
  assert.deepEqual(matchBottles(fragrances, 'detour').map(f => f.name), ['Détour Noir'], 'accents don’t matter');
  assert.ok(matchBottles(fragrances, 'blanc').length >= 3);
  assert.deepEqual(matchBottles(fragrances, 'zzz'), []);
  const named = [{ name: 'Opium (1977)', brand: 'Yves Saint Laurent' }, { name: '212 VIP', brand: 'Carolina Herrera' }, { name: '2121', brand: 'X' }];
  assert.deepEqual(matchBottles(named, 'opium').map(f => f.name), ['Opium (1977)'], 'a year after the name isn’t part of it');
  assert.deepEqual(matchBottles(named, '212').map(f => f.name), ['212 VIP'], 'a number matches whole');
  assert.deepEqual(matchBottles(named, '1977'), []);
});

test('names match as the app searches them: any apostrophe, whole words for a short part', () => {
  const guerlain = [{ name: 'L’Homme Idéal Extrême', brand: 'Guerlain' }, { name: 'L’Homme Idéal', brand: 'Guerlain' }, { name: 'L’Homme Idéal Eau de Parfum', brand: 'Guerlain' }];
  assert.deepEqual(matchBottles(guerlain, "L'Homme Ideal").map(f => f.name), ['L’Homme Idéal'], 'a straight apostrophe finds a curly one');
  assert.equal(matchBottles(guerlain, 'lhomme ideal').length, 0);
  assert.equal(matchBottles(guerlain, "l'homme ideal extreme").length, 1);
  assert.equal(matchBottles(guerlain, 'ideal eau').length, 1);
  // Under three letters a part matches whole words only.
  assert.deepEqual(matchBottles(fragrances, 'a'), []);
  assert.deepEqual(matchBottles(fragrances, 'e'), []);
  assert.deepEqual(matchBottles(fragrances, 'ch').map(f => f.name), ['CH Men Prive']);
  assert.deepEqual(matchBottles(fragrances, 'oud').map(f => f.name), ['Glorious Oud Royal Blanc']);
});

test('--exclude refuses a term that takes out most of the wardrobe, and an empty one stops plainly', () => {
  const broad = cli('--loc', '40.7,-74', '--exclude', 'French Avenue', '--slot', 'night');
  assert.equal(broad.status, 1);
  assert.match(broad.stderr, /--exclude "French Avenue" matches 5 bottles \(Amber Empire, .+\); give more of the name/);
  const letter = cli('--loc', '40.7,-74', '--exclude', 'a', '--slot', 'night', '--json');
  assert.equal(letter.status, 0, letter.stderr);
  assert.match(letter.stderr, /"a" matches no bottle/);
  // A journal that switched every bottle off leaves nothing to rank, in every mode.
  const dir = mkdtempSync(join(tmpdir(), 'scentcast-'));
  const file = join(dir, 'journal.json');
  writeFileSync(file, JSON.stringify({ app: 'scentcast-journal', history: [], hidden: fragrances.map(f => String(f.id)) }));
  for (const extra of [['--slot', 'night'], ['--week'], ['--json'], ['--date', dayISO(1)], ['--layer', 'all'], ['--mix']]) {
    const run = cli('--loc', '40.7,-74', '--journal', file, ...extra);
    assert.equal(run.status, 1, extra.join(' '));
    assert.match(run.stderr, /^Nothing left to rank: the journal leaves out all 25 bottles/);
    assert.doesNotMatch(run.stderr, /at .*\.mjs:\d+/, 'no stack trace');
  }
});

test('switched-off bottles are left out of picks but still owned for suggestions and checks, as in the app', async () => {
  const runs = await Promise.all([
    run('--check', 'Liquid Brun', '--exclude', 'Liquid Brun', '--json'), run('--check', 'Althair', '--exclude', 'Liquid Brun', '--json'),
    run('--style', 'vanilla', '--exclude', 'Liquid Brun,Amber Empire,Cream Velvet', '--top', '12', '--json'),
    run('--gaps', '--exclude', 'Liquid Brun', '--json'), run('--gaps', '--top', '0'),
  ]);
  const [own, original, style, gaps] = runs.slice(0, 4).map(r => JSON.parse(r.stdout));
  assert.deepEqual([own.verdict, own.reasons[0]], ['Redundant', 'You own it.']);
  assert.equal(original.verdict, 'Redundant', 'the original of a bottle he owns');
  assert.ok(!style.results.some(r => ['Liquid Brun', 'Amber Empire', 'Cream Velvet'].includes(r.name)), style.results.map(r => r.name).join(', '));
  assert.equal(gaps.bottles, 24, 'covers nothing');
  assert.match(runs[4].stderr, /--top takes 1 or more for --gaps/);
});

test('--journal leaves out the bottles the app switched off and tunes the use shares by its wears', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scentcast-'));
  const file = join(dir, 'journal.json');
  const jake = fragrances.find(f => f.name === 'Jake');
  const formal = Array.from({ length: 30 }, (_, i) => ({ id: String(fragrances[i % 5].id), date: dayISO(-i - 1), slot: 'night', occasion: 'formal' }));
  writeFileSync(file, JSON.stringify({ app: 'scentcast-journal', history: formal, hidden: [String(jake.id)] }));
  const run = cli('--loc', '40.7,-74', '--json', '--journal', file, '--slot', 'day');
  assert.equal(run.status, 0, run.stderr);
  assert.ok(!JSON.parse(run.stdout).slots[0].ranked.some(r => r.name === 'Jake'));
  const shares = text => Number(text.match(/Formal (\d+)%/)[1]);
  assert.ok(shares(cli('--gaps', '--journal', file, '--top', '1').stdout) > 2 * shares(cli('--gaps', '--top', '1').stdout));
  const missing = cli('--loc', '40.7,-74', '--journal', join(dir, 'nope.json'));
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /^Can't read .*nope\.json/);
  writeFileSync(file, '{"app":');
  assert.match(cli('--loc', '40.7,-74', '--journal', file).stderr, /isn't a Scentcast journal export/);
});

test('bad arguments stop with a message before any request', () => {
  const slot = cli('--loc', '40.7,-74', '--slot', 'evening');
  assert.equal(slot.status, 1);
  assert.match(slot.stderr, /--slot must be day or night/);
  const occ = cli('--loc', '40.7,-74', '--occasion', 'Evening');
  assert.equal(occ.status, 1);
  assert.match(occ.stderr, /Pick one of: casual \(Casual\), office/);
  const loc = cli('--loc', '40.7');
  assert.equal(loc.status, 1);
  assert.match(loc.stderr, /--loc takes LAT,LON/);
  assert.doesNotMatch(loc.stderr, /at .*\.mjs:\d+/, 'no stack trace');
  assert.equal(cli('--loc', ',-74').status, 1, 'an empty latitude isn’t 0');
});

test('--loc takes an optional name after the coordinates, like the app\'s ?loc=', () => {
  const named = cli('--loc', '40.71,-74.01,New York', '--slot', 'night', '--json');
  assert.equal(named.status, 0, named.stderr);
  assert.deepEqual(JSON.parse(named.stdout).place, { name: 'New York', lat: 40.71, lon: -74.01 });
  const bare = cli('--loc', '40.71, -74.01', '--slot', 'night', '--json');
  assert.equal(JSON.parse(bare.stdout).place.name, '40.71,-74.01');
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

test('--ideal gives a lone degree once and joins spans a degree or two apart', async () => {
  const names = ['Supremacy Collector’s Edition', 'Jake', 'Amber Empire'];
  const [json, ...texts] = await Promise.all([run('--ideal', 'Amber Empire', '--json'), ...names.map(name => run('--ideal', name))]);
  for (const { stdout } of texts) {
    assert.match(stdout, /Top 3 in this collection by night: /);
    assert.doesNotMatch(stdout, /\b(\d+)–\1°F/, stdout);
  }
  const amber = JSON.parse(json.stdout).topPick.night;
  for (let i = 1; i < amber.length; i++) assert.ok(amber[i].lowF - amber[i - 1].highF > 3, JSON.stringify(amber));
});

test('a switched-off bottle still answers for --layer, --ideal and --spray, saying so', async () => {
  const flags = ['--layer', '--ideal', '--spray'];
  const runs = await Promise.all(flags.map(flag => run('--exclude', 'Sauvage', flag, 'Sauvage')));
  runs.forEach((r, i) => {
    assert.equal(r.status, 0, `${flags[i]}: ${r.stderr}`);
    assert.match(r.stderr, /^Sauvage is switched off; answering for it anyway\.\n$/);
  });
  assert.doesNotMatch(runs[0].stdout, /\+ Sauvage /, 'nor is it anyone’s partner');
});

const dayISO = days => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000 + days * 86_400_000).toISOString().slice(0, 10);

test('--events reads a date, an optional slot and an occasion', () => {
  const [formal, date, out] = parseEvents('2026-10-20 night formal; 2026-10-21 Date Night;2026-10-22 night out');
  assert.deepEqual([formal.dateISO, formal.slot, formal.occasion.id], ['2026-10-20', 'night', 'formal']);
  assert.deepEqual([date.slot, date.occasion.id], ['night', 'date']);
  assert.deepEqual([out.slot, out.occasion.id], ['night', 'nightout'], '"night out" is the occasion, not a slot');
  assert.equal(parseEvents('2026-10-20 day date')[0].slot, 'day');
  assert.deepEqual(parseEvents(''), []);
  assert.throws(() => parseEvents('tuesday formal'), /doesn't start with a date/);
  assert.throws(() => parseEvents('2026-10-20 night gala'), /no occasion in "2026-10-20 night gala"\. Write each as DATE \[day\|night\] OCCASION/);
  const [late] = parseEvents('2026-10-15 formal night');
  assert.deepEqual([late.slot, late.occasion.id], ['night', 'formal'], 'the slot after the occasion too');
  assert.deepEqual([parseEvents('2026-10-15 date night')[0].slot, parseEvents('2026-10-15 office day')[0].occasion.id], ['night', 'office']);
  assert.throws(() => parseEvents('2026-10-17 night formal; 2026-10-17 date'), /two events on the night of 2026-10-17/);
  assert.equal(parseEvents('2026-10-17 night formal; 2026-10-17 office').length, 2, 'a day and a night');
});

test('--pack plans a trip: few bottles, every window, events on their night', () => {
  const [from, to] = [dayISO(1), dayISO(4)];
  const run = cli('--pack', '--loc', '40.7,-74,Testville', '--from', from, '--to', to, '--events', `${dayISO(2)} night formal`, '--json');
  assert.equal(run.status, 0, run.stderr);
  const out = JSON.parse(run.stdout);
  assert.ok(out.bottles.length >= 2 && out.bottles.length <= 3, out.text);
  assert.equal(out.plan.length, 8);
  assert.ok(out.plan.every(p => out.bottles.some(b => b.name === p.pick) && p.weather.source === 'forecast'));
  assert.equal(out.plan.find(p => p.date === dayISO(2) && p.slot === 'night').occasion, 'formal');
  assert.match(out.text, /^Pack /);
  assert.ok(out.plan.every(p => p.spray.sprays[0] >= 1 && p.spray.text));
  const text = cli('--pack', '--loc', '40.7,-74', '--from', from, '--to', to);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /Pack .+\./);
});

test('--pack takes a trip-wide occasion onto its slot, and --slot packs for days or nights only', () => {
  const [from, to] = [dayISO(1), dayISO(3)];
  const plain = JSON.parse(cli('--pack', '--loc', '40.7,-74', '--from', from, '--to', to, '--json').stdout);
  const work = cli('--pack', '--loc', '40.7,-74', '--from', from, '--to', to, '--occasion', 'office', '--events', `${dayISO(2)} night formal`, '--json');
  assert.equal(work.status, 0, work.stderr);
  const out = JSON.parse(work.stdout);
  assert.equal(out.occasion, 'office');
  for (const p of out.plan) {
    const want = p.slot === 'day' ? 'office' : p.date === dayISO(2) ? 'formal' : null;
    assert.equal(p.occasion, want, `${p.date} ${p.slot}`);
  }
  // The days are picked for the office and say so; the nights without an event aren't.
  assert.ok(out.plan.filter(p => p.slot === 'day').every(p => p.reasons.some(r => /the office/.test(r))));
  assert.ok(out.plan.filter(p => p.slot === 'night' && !p.occasion).every(p => !p.reasons.some(r => /office|formal wear/.test(r))));
  assert.ok(!plain.plan.some(p => p.occasion || p.reasons.some(r => /the office/.test(r))));
  const nights = JSON.parse(cli('--pack', '--loc', '40.7,-74', '--from', from, '--to', to, '--slot', 'night', '--json').stdout);
  assert.ok(nights.plan.length === 3 && nights.plan.every(p => p.slot === 'night'));
});

test('--pack and --date stop on bad dates before any request', () => {
  for (const [args, message] of [
    [['--pack', '--loc', '40.7,-74', '--from', dayISO(1)], /--pack needs --from and --to/],
    [['--pack', '--loc', '40.7,-74', '--from', dayISO(3), '--to', dayISO(1)], /comes before --from/],
    [['--pack', '--loc', '40.7,-74', '--from', dayISO(-3), '--to', dayISO(1)], /has passed/],
    [['--pack', '--loc', '40.7,-74', '--from', dayISO(1), '--to', dayISO(40)], /up to 31 days/],
    [['--pack', '--loc', '40.7,-74', '--from', dayISO(1), '--to', dayISO(2), '--max', '9'], /--max takes 1 to 6/],
    [['--pack', '--loc', '40.7,-74', '--from', dayISO(1), '--to', dayISO(2), '--events', `${dayISO(9)} night date`], /outside the trip/],
    [['--pack', '--loc', '40.7,-74', '--from', dayISO(1), '--to', dayISO(2), '--slot', 'day', '--events', `${dayISO(1)} formal`], /--slot day packs for days only/],
    [['--pack', '--from', dayISO(1), '--to', dayISO(2)], /--pack needs a place/],
    [['--loc', '40.7,-74', '--date', '2026-02-30'], /--date takes a date like/],
    [['--loc', '40.7,-74', '--date', dayISO(2), '--week'], /leave out --week/],
    [['--spray', 'Terra', '--date', dayISO(2)], /--date needs a place/],
  ]) {
    const run = offline(...args);
    assert.equal(run.status, 1, args.join(' '));
    assert.match(run.stderr, message);
  }
});

test('a forecast that doesn’t answer in time says so, not "check the connection"', () => {
  const line = weatherFailure(Object.assign(new Error('Weather request got no answer in 25 s'), { timeout: true, service: 'forecast', timeoutMs: 25_000 }));
  assert.equal(line, 'Couldn\'t get the forecast from Open-Meteo: its forecast didn\'t answer within 25 seconds. It\'s slow or down; try again in a minute.');
  assert.match(weatherFailure({ timeout: true, service: 'archive', timeoutMs: 45_000 }, 'the weather'), /^Couldn't get the weather from Open-Meteo: its weather archive didn't answer within 45 seconds/);
  assert.match(weatherFailure(new TypeError('fetch failed')), /^Couldn't get the forecast from Open-Meteo \(fetch failed\)\. Check the connection/);
});

test('--date answers for any day: the forecast when it reaches, typical weather past it', () => {
  const near = JSON.parse(cli('--loc', '40.7,-74', '--date', dayISO(2), '--json').stdout);
  assert.equal(near.weather, 'forecast');
  assert.deepEqual(near.slots.map(s => s.slot), ['day', 'night']);
  assert.notEqual(near.slots[0].pick.name, near.slots[1].pick.name, 'planned together');
  const far = cli('--loc', '40.7,-74', '--date', dayISO(30), '--occasion', 'date', '--json');
  assert.equal(far.status, 0, far.stderr);
  const out = JSON.parse(far.stdout);
  assert.equal(out.weather, 'typical');
  assert.equal(out.slots.length, 1);
  assert.equal(out.slots[0].slot, 'night');
  assert.ok(out.slots[0].window.typical);
  assert.ok(out.slots[0].pick.spray.text);
});

test('--spray gives counts for three situations, or the next window at a place', () => {
  const run = cli('--spray', 'Terra', '--json');
  assert.equal(run.status, 0, run.stderr);
  const out = JSON.parse(run.stdout);
  assert.equal(out.name, 'Terra');
  assert.deepEqual(out.situations.map(s => s.label), ['Hot, sticky day', 'Mild day', 'Cold night']);
  assert.ok(out.situations[0].sprays[1] <= out.situations[2].sprays[0], 'fewer in the heat than the cold');
  const office = JSON.parse(cli('--spray', 'Shiyaaka', '--occasion', 'office', '--json').stdout);
  assert.ok(office.situations.every(s => s.sprays[1] <= 2));
  const there = JSON.parse(cli('--spray', 'Sauvage', '--loc', '40.7,-74', '--slot', 'night', '--json').stdout);
  assert.equal(there.situations.length, 1);
  assert.equal(there.situations[0].slot, 'night');
  assert.doesNotMatch(cli('--spray', 'Sauvage').stdout, /°/, 'no temperatures without a place');
});

test('--journal applies the ratings and skin nudges it carries', () => {
  const first = JSON.parse(cli('--loc', '40.7,-74', '--json', '--slot', 'day').stdout).slots[0];
  const runnerUp = fragrances.find(f => f.name === first.pick.runnerUp);
  const dir = mkdtempSync(join(tmpdir(), 'scentcast-'));
  const file = join(dir, 'journal.json');
  writeFileSync(file, JSON.stringify({ app: 'scentcast-journal', history: [], skin: { [runnerUp.id]: { rating: 5, longevity: 0, sillage: 0 } } }));
  const after = JSON.parse(cli('--loc', '40.7,-74', '--json', '--slot', 'day', '--journal', file).stdout).slots[0];
  assert.ok(after.ranked.find(r => r.name === runnerUp.name).reasons.includes('+ You rate it 5★'));
});

test('--doubles names pairs that wear as one, or the closest pair', () => {
  const run = cli('--doubles', '--json');
  assert.equal(run.status, 0, run.stderr);
  const out = JSON.parse(run.stdout);
  assert.deepEqual(out.doubles, [], 'nothing in David’s wardrobe doubles another');
  assert.ok(out.closest.alike > 50 && out.closest.alike < 85, `closest ${out.closest.a} and ${out.closest.b}`);
  assert.match(cli('--doubles').stdout, /^No doubles in \d+ bottles: every one smells its own way\.\nClosest pair: .+ and .+, \d+% alike \(/);
});
