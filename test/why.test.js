// --why: where one bottle stands in a window's picks and why, in the words of
// its page's Why (scripts/recommend.mjs whyWindow; src/contrast.js whyParts,
// whyNotes, pickGapLine). The pure half runs on a pinned forecast; the CLI
// half against the synthetic one, which starts from today whatever the day.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { whyWindow, misread, modeOf } from '../scripts/recommend.mjs';
import { pickGapLine, whyParts, whyNotes } from '../src/contrast.js';
import { planWindows, rank, occasionWeights, restReason } from '../src/engine.js';
import { occasionById } from '../src/occasions.js';
import { applySkin } from '../src/skin.js';
import { summarize, week } from '../src/weather.js';
import { matchPct } from '../src/ui.js';
import { shiftISO } from '../src/history.js';
import { syntheticForecast } from './fixtures.js';

const script = fileURLToPath(new URL('../scripts/recommend.mjs', import.meta.url));
const mock = fileURLToPath(new URL('./mock-fetch.mjs', import.meta.url));
const { fragrances } = JSON.parse(readFileSync(new URL('../data/collection.json', import.meta.url)));
for (const f of fragrances) f.id = String(f.id);
const run = (...args) => new Promise(resolve => {
  execFile(process.execPath, ['--import', mock, script, ...args], { encoding: 'utf8' }, (err, stdout, stderr) => resolve({ status: err ? err.code ?? 1 : 0, stdout, stderr }));
});
const offline = (...args) => new Promise(resolve => {
  execFile(process.execPath, ['--import', mock, script, ...args], { encoding: 'utf8', env: { ...process.env, MOCK_OFFLINE: '1' } }, (err, stdout, stderr) => resolve({ status: err ? err.code ?? 1 : 0, stdout, stderr }));
});

// A pinned day: 72°F by day, 55°F at night (test/fixtures.js), read at noon there.
const wx = summarize(syntheticForecast(7), Date.parse('2026-09-28T16:00:00Z'));
const today = wx.day.dateISO;
// Everything a window's answer says in words.
const wordsOf = w => [w.text, w.gap.line, ...w.reasons, ...w.notes, ...(w.ahead ?? []).map(a => a.line)];
const NO_TEMPERATURE = /\d\s*°|\bdegrees?\b|°[FC]/;

test('a window’s answer is the list’s own: its rank, its pick, pickGapLine’s line and scoreOf’s weights', () => {
  // Worn lately, one rated 2★ and one 5★, so the gap line takes every turn it has.
  const first = planWindows(fragrances, [wx.day, wx.night], {});
  const history = [{ id: first[1].pick.fragrance.id, date: shiftISO(today, -3), slot: 'night' }, { id: first[0].ranked[1].fragrance.id, date: shiftISO(today, -1), slot: 'day' }];
  const rated = applySkin(fragrances, { [first[0].pick.fragrance.id]: { rating: 2 }, [first[0].ranked[2].fragrance.id]: { rating: 5 } });
  const plan = planWindows(rated, [wx.day, wx.night], { history, nudge: true });
  let picks = 0, rests = 0, lines = new Set();
  for (const p of plan) {
    for (const [i, entry] of p.ranked.entries()) {
      const w = whyWindow(entry.fragrance, p, { history, todayISO: today });
      assert.deepEqual([w.rank, w.of, w.match, w.tier], [i + 1, p.ranked.length, matchPct(entry), entry.tier]);
      assert.deepEqual([w.pick.name, w.pick.match], [p.pick.fragrance.name, matchPct(p.pick)]);
      assert.deepEqual([w.window.date, w.window.slot, w.window.label], [p.win.dateISO, p.win.slot, p.win.label]);
      assert.equal(w.isPick, entry === p.pick);
      if (w.isPick) {
        picks++;
        assert.deepEqual(w.gap, { points: 0, line: `It's the pick for ${p.win.label.toLowerCase()}.` });
        assert.ok(w.text.startsWith(`${entry.fragrance.name} is ${i + 1}`), w.text);
      } else {
        assert.equal(w.gap.line, pickGapLine(entry, p.pick, p.win, { occasion: null, worn: null }), entry.fragrance.name);
        assert.equal(w.gap.points, matchPct(p.pick) - matchPct(entry));
        lines.add(w.gap.line.replace(/\d+ points?|Just/, 'N').replace(p.pick.fragrance.name, 'PICK'));
      }
      // The parts are Why's bars, weighed as the score weighs them.
      const parts = whyParts(entry);
      assert.deepEqual(w.parts.map(x => [x.part, x.fit]), parts.map(x => [x.key, x.pct]));
      const sum = parts.reduce((t, x) => t + x.weight * x.value, 0) + (entry.parts.personal ?? 0) - (entry.parts.rotation ?? 0);
      assert.ok(Math.abs(sum - entry.score) < 1e-9 || entry.fragrance.personal?.rating === 1, `${entry.fragrance.name}: ${sum} vs ${entry.score}`);
      assert.deepEqual(w.notes, whyNotes(entry, p.win, { todayISO: today }).map(n => n.text));
      if (entry.parts.rotation > 0) {
        rests++;
        assert.ok(w.notes.includes(`${restReason(entry.parts, p.win.slot)}: ${Math.round(entry.parts.rotation * 100)}% lower so others get a turn.`), w.notes.join(' | '));
      } else assert.deepEqual(w.notes, []);
      for (const s of wordsOf(w)) assert.doesNotMatch(s, NO_TEMPERATURE, s);
      assert.ok(w.reasons.every(r => /^[+-] /.test(r)));
    }
  }
  assert.equal(picks, 2);
  assert.ok(rests >= 3, 'the wears, and the day’s pick by night');
  assert.ok(lines.size >= 3, [...lines].join(' | '));
  assert.equal(whyWindow({ id: 'none' }, plan[0]), null, 'a bottle the list doesn’t hold');
});

test('for an occasion the parts take its weights and the heat’s note; an event’s bottle says it’s saved, and its pick that it’s the pick', () => {
  const date = occasionById('date'), formal = occasionById('formal');
  const hot = { ...wx.night, feelsF: 90, humidity: 62, dewF: 75 };
  const ranked = rank(fragrances, hot, 'night', { occasion: date, todayISO: hot.dateISO });
  const list = { win: hot, ranked, pick: ranked[0] };
  const rich = ranked.find(r => occasionWeights(date).heat * r.parts.heat >= 0.05);
  const w = whyWindow(rich.fragrance, list, { occasion: date });
  assert.equal(w.occasion, 'date');
  assert.deepEqual(w.parts.map(p => p.part), ['occasion', 'season', 'weather', 'time', 'quality']);
  assert.deepEqual(w.parts.map(p => p.weight), ['occasion', 'season', 'weather', 'time', 'quality'].map(k => +occasionWeights(date)[k].toFixed(3)));
  assert.match(w.notes.join(' '), /^Rich for this heat: \d+% lower for a date\.$/);
  assert.equal(w.gap.line, pickGapLine(rich, ranked[0], hot, { occasion: date }));
  assert.match(w.text, / of \d+ for date night tonight: \d+% match, tier [SABC]\.$/);
  for (const s of wordsOf(w)) assert.doesNotMatch(s, NO_TEMPERATURE, s);
  // Tonight's formal event: its bottle sits the day out, and says why.
  const plan = planWindows(fragrances, [wx.day, { ...wx.night, occasion: formal }], { nowISO: today });
  const best = plan[1].pick.fragrance;
  const [day, night] = plan.map(p => whyWindow(best, p, { todayISO: today }));
  assert.ok(day.notes.includes('Saved for formal wear tonight, so the plan picks another bottle here.'), day.notes.join(' | '));
  assert.equal(day.isPick, false);
  assert.deepEqual([night.isPick, night.event, night.occasion, night.gap.line], [true, true, 'formal', 'It\'s the pick for formal tonight.']);
});

test('a pick that isn’t first in its list names the bottles above it, each with why it gave way', () => {
  // A week planned around a day at the office at its end (Oct 5), whose bottle the days before leave be.
  const at = Date.parse('2026-09-28T16:00:00Z'), office = occasionById('office');
  const windows = week(syntheticForecast(8), at).flatMap(d => [d.day, d.night].filter(Boolean)).map((w, i) => (i === 14 ? { ...w, occasion: office } : w));
  assert.deepEqual([windows[14].dateISO, windows[14].slot], ['2026-10-05', 'day']);
  const plan = planWindows(fragrances, windows, { nowISO: today });
  let turns = 0, saved = 0;
  for (const p of plan) {
    const i = p.ranked.indexOf(p.pick);
    const w = whyWindow(p.pick.fragrance, p, { todayISO: today });
    assert.equal(w.isPick, true);
    if (!i) {
      assert.equal(w.ahead, undefined, 'first in its list: nothing gave way');
      continue;
    }
    assert.deepEqual(w.ahead.map(a => a.name), p.ranked.slice(0, i).map(r => r.fragrance.name));
    for (const [k, a] of w.ahead.entries()) {
      const line = pickGapLine(p.ranked[k], p.pick, p.win);
      if (line) assert.equal(a.line, line);
      else assert.equal(a.line, 'Saved for the office on Oct 5, so the plan picks another bottle here.');
      turns += / but the plan gives /.test(a.line);
      saved += /^Saved for /.test(a.line);
      assert.doesNotMatch(a.line, NO_TEMPERATURE);
    }
  }
  assert.ok(turns > 0 && saved > 0, `${turns} gave the pick a turn, ${saved} saved`);
  // A wear logged for the window is its pick wherever it ranks: the first three above it say so, not all twenty.
  const low = plan[1].ranked.at(-4).fragrance;
  const history = [{ id: low.id, date: plan[1].win.dateISO, slot: plan[1].win.slot }];
  const worn = planWindows(fragrances, windows.slice(0, 2), { history, nowISO: today })[1];
  const w = whyWindow(low, worn, { history, todayISO: today });
  assert.deepEqual([w.isPick, w.rank > 4, w.ahead.length, w.gap.line], [true, true, 3, 'It\'s the pick for tonight.']);
  assert.deepEqual(w.ahead.map(a => a.name), worn.ranked.slice(0, 3).map(r => r.fragrance.name));
  for (const a of w.ahead) assert.match(a.line, new RegExp(`^\\d+ points? over ${low.name} tonight, but you’re wearing ${low.name}\\.$`), a.line);
});

test('--why is a mode of its own: it reads a window’s flags and stops on the rest with a sentence', async () => {
  const all = { why: 'Liam', loc: '1,2', date: '2026-11-05', slot: 'night', occasion: 'date', events: 'x', journal: 'x', exclude: 'x', demo: true, json: true };
  assert.equal(misread(all), null);
  assert.equal(modeOf(all), 'why');
  for (const [args, message] of [
    [{ why: 'Liam', loc: '1,2', week: true }, /^--week doesn't apply to --why, which answers for today's windows; for another day, give --date$/],
    [{ why: 'Liam', loc: '1,2', top: '3' }, /^--top doesn't apply to --why, which answers for one bottle/],
    [{ why: 'Liam', loc: '1,2', max: '2' }, /^--max doesn't apply to --why; it's how many bottles --pack packs$/],
    [{ why: 'Liam', loc: '1,2', gaps: true }, /^--gaps doesn't apply to --why; ask one at a time$/],
    [{ why: 'Liam', ideal: 'Terra' }, /^--why doesn't apply to --ideal; ask one at a time$/],
  ]) assert.match(misread(args) ?? 'answered', message, JSON.stringify(args));
  // No place, and a bottle he doesn't own, stop before any request.
  const [bare, unowned] = await Promise.all([offline('--why', 'Liam'), offline('--why', 'Aventus', '--loc', '40.7,-74')]);
  assert.deepEqual([bare.status, bare.stderr], [1, '--why needs a place: --city NAME or --loc LAT,LON\n']);
  assert.deepEqual([unowned.status, unowned.stderr], [1, 'No bottle in the wardrobe matches "Aventus". For one you don\'t own, --check "Aventus" says whether it\'s worth buying.\n']);
});

test('--why agrees with today’s picks about each window’s pick and with their ranked list about the rank', async () => {
  const here = ['--loc', '40.7,-74'];
  const picks = JSON.parse((await run(...here, '--json')).stdout);
  const top = picks.slots[0].pick.name, low = picks.slots[0].ranked.at(-3).name;
  const [mine, other, text, dated, onDate, forDate, night] = await Promise.all([
    run(...here, '--why', top, '--json'), run(...here, '--why', low, '--json'), run(...here, '--why', low),
    run(...here, '--why', low, '--slot', 'night', '--occasion', 'Date Night', '--json'), run(...here, '--slot', 'night', '--occasion', 'date', '--json'),
    run(...here, '--why', low, '--date', picks.slots[0].window.date, '--slot', 'night', '--json'), run(...here, '--date', picks.slots[0].window.date, '--slot', 'night', '--json'),
  ]);
  for (const r of [mine, other, text, dated, onDate, forDate, night]) assert.equal(r.status, 0, r.stderr);
  const agrees = (why, list, name) => {
    assert.equal(why.windows.length, list.slots.length);
    for (const [i, w] of why.windows.entries()) {
      const s = list.slots[i];
      assert.deepEqual([w.window.date, w.window.slot, w.pick.name, w.of], [s.window.date, s.slot, s.pick.name, s.ranked.length]);
      assert.equal(w.rank, s.ranked.findIndex(r => r.name === name) + 1, `${name} ${s.slot}`);
      assert.equal(w.score, s.ranked[w.rank - 1].score);
      assert.deepEqual([...w.reasons].sort(), [...s.ranked[w.rank - 1].reasons].sort(), 'its reasons, as picks print them');
      assert.equal(w.isPick, s.pick.name === name);
      for (const line of wordsOf(w)) assert.doesNotMatch(line, NO_TEMPERATURE, line);
    }
  };
  const [a, b] = [JSON.parse(mine.stdout), JSON.parse(other.stdout)];
  agrees(a, picks, top);
  agrees(b, picks, low);
  assert.deepEqual([a.bottle.name, a.journal, a.occasion], [top, false, null]);
  // The pick's own answer says so; another bottle's says how it stands beside it.
  assert.match(a.windows[0].gap.line, /^It's the pick for (today|tonight|tomorrow( night)?)\.$/);
  assert.ok(b.windows[0].gap.points > 0);
  assert.match(b.windows[0].gap.line, new RegExp(`^\\d+ points? under ${top.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} (today|tonight|tomorrow( night)?), mostly `));
  // The text says the same, under each window's weather, and that no wears were counted.
  const w = b.windows[0];
  assert.ok(text.stdout.includes(`\n  ${w.text}\n  ${w.gap.line}\n  Pick: ${w.pick.name} (${w.pick.brand}), ${w.pick.match}% match\n`), text.stdout);
  assert.match(text.stdout, /\n {2}Parts: Season \d+% \(weighs 50%\) · Weather \d+% \(20%\) · Time of day \d+% \(25%\) · Rating \d+% \(5%\)\n/);
  assert.match(text.stdout, /\nNot counting what you've worn lately/);
  // With --slot and --occasion, or --date, it's the matching mode's window.
  agrees(JSON.parse(dated.stdout), JSON.parse(onDate.stdout), low);
  assert.equal(JSON.parse(dated.stdout).windows[0].parts[0].part, 'occasion');
  agrees(JSON.parse(forDate.stdout), JSON.parse(night.stdout), low);
  assert.equal(JSON.parse(forDate.stdout).date, picks.slots[0].window.date);
});

test('--why counts the journal and --events as the picks do, and answers for a switched-off or half-named bottle, saying so', async () => {
  const here = ['--loc', '40.7,-74'];
  const first = JSON.parse((await run(...here, '--slot', 'night', '--json')).stdout).slots[0];
  const worn = fragrances.find(f => f.name === first.pick.name);
  const file = join(mkdtempSync(join(tmpdir(), 'almanac-')), 'journal.json');
  writeFileSync(file, JSON.stringify({ app: 'scentcast-journal', history: [{ id: worn.id, date: shiftISO(first.window.date, -1), slot: 'night' }] }));
  const event = `${first.window.date} night formal`;
  const [rested, list, saved, plan, off, vague] = await Promise.all([
    run(...here, '--why', worn.name, '--slot', 'night', '--journal', file, '--json'), run(...here, '--slot', 'night', '--journal', file, '--json'),
    run(...here, '--why', worn.name, '--events', event, '--json'), run(...here, '--events', event, '--json'),
    run(...here, '--why', 'Sauvage', '--exclude', 'Sauvage', '--json'), run(...here, '--why', 'blanc', '--slot', 'night'),
  ]);
  for (const r of [rested, list, saved, plan, off, vague]) assert.equal(r.status, 0, r.stderr);
  // Worn last night: it rests tonight, and Why says what that took off.
  const [w] = JSON.parse(rested.stdout).windows, s = JSON.parse(list.stdout).slots[0];
  assert.deepEqual([w.pick.name, w.rank], [s.pick.name, s.ranked.findIndex(r => r.name === worn.name) + 1]);
  assert.notEqual(w.pick.name, worn.name);
  assert.match(w.notes.join(' '), /^Worn yesterday: \d+% lower so others get a turn\.$/);
  assert.ok(JSON.parse(rested.stdout).journal.newest);
  // An event on the window: the answer is for its occasion, as the plan ranks it.
  const planned = JSON.parse(plan.stdout).slots.find(x => x.pick.occasion === 'formal');
  const at = JSON.parse(saved.stdout).windows.find(x => x.event);
  assert.deepEqual([at.occasion, at.pick.name, at.rank], ['formal', planned.pick.name, planned.ranked.findIndex(r => r.name === worn.name) + 1]);
  // Switched off, it's ranked among the rest as if it were on.
  assert.equal(off.stderr, 'Sauvage is switched off; answering for it anyway.\n');
  const sauvage = JSON.parse(off.stdout);
  assert.deepEqual([sauvage.bottle.name, sauvage.bottle.switchedOff, sauvage.windows[0].of], ['Sauvage', true, fragrances.length]);
  assert.match(vague.stderr, /^"blanc" matches .+; using (.+)\. Give more of the name for another\.\n$/);
  assert.ok(vague.stdout.includes(`\n${vague.stderr.match(/using (.+)\. Give/)[1]} (`), vague.stdout);
});
