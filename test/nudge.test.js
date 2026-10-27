import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rank, planWindows, daysBetween, PLAN_MARGIN, NUDGE_AFTER } from '../src/engine.js';
import { shiftISO, journalToken, readJournal } from '../src/history.js';
import { occasionById } from '../src/occasions.js';

const fragrances = JSON.parse(readFileSync(new URL('../data/collection.json', import.meta.url))).fragrances
  .map(f => ({ ...f, id: String(f.id) }));
const idOf = name => fragrances.find(f => f.name === name).id;
const TODAY = '2026-10-12';
const mildDay = (dateISO = TODAY, slot = 'day') => ({
  slot, dateISO, date: new Date(`${dateISO}T12:00:00`), lat: 40, category: 'clear',
  ...(slot === 'day' ? { feelsF: 64, humidity: 60, dewF: 50 } : { feelsF: 54, humidity: 70, dewF: 46 }),
});
const reasons = entry => entry.reasons.map(r => r.text);

// A journal begun `start`, every bottle last worn `recent` (past the rotation
// tail, not yet neglected) except those in `last` ({ name: date | null }).
function journal({ start = '2026-08-01', recent = '2026-09-20', last = {} } = {}) {
  const out = [{ id: idOf('Liam'), date: start, slot: 'day' }];
  for (const f of fragrances) {
    const when = f.name in last ? last[f.name] : recent;
    if (when) out.push({ id: f.id, date: when, slot: 'night' });
  }
  return out;
}

test('a bottle unworn for a month takes a slot it nearly wins, and says so', () => {
  const plain = rank(fragrances, mildDay(), 'day');
  const history = journal({ last: { 'Meant To Be Seen': '2026-09-01' } });
  const still = rank(fragrances, mildDay(), 'day', { history });
  assert.deepEqual(still.map(r => r.fragrance.id), plain.map(r => r.fragrance.id), 'without the opt, nothing moves');

  const ranked = rank(fragrances, mildDay(), 'day', { history, nudge: true });
  const [pick] = ranked;
  assert.equal(pick.fragrance.name, 'Meant To Be Seen');
  assert.ok(pick.nudged);
  assert.equal(pick.parts.idle, 41);
  assert.equal(reasons(pick)[0], 'Not worn in 41 days');
  assert.ok(plain[0].score - pick.score <= PLAN_MARGIN);
  assert.equal(pick.tier, plain[0].tier, 'same tier as the pick it replaces');
  assert.deepEqual(ranked.map(r => r.tier), plain.map(r => r.tier), 'tiers stay in rank order');
  assert.equal(ranked.length, plain.length);
});

test('worn within the month, no nudge', () => {
  const history = journal({ last: { 'Meant To Be Seen': shiftISO(TODAY, -(NUDGE_AFTER - 1)) } });
  const ranked = rank(fragrances, mildDay(), 'day', { history, nudge: true });
  assert.ok(!ranked.some(r => r.nudged || r.parts.idle));
});

test('a never-worn bottle counts from the journal’s first wear, once that is a month back', () => {
  const young = journal({ start: '2026-09-22', recent: '2026-09-25', last: { 'Meant To Be Seen': null } });
  assert.ok(!rank(fragrances, mildDay(), 'day', { history: young, nudge: true }).some(r => r.nudged), '20-day journal');
  const old = journal({ start: '2026-09-07', recent: '2026-09-25', last: { 'Meant To Be Seen': null } });
  const [pick] = rank(fragrances, mildDay(), 'day', { history: old, nudge: true });
  assert.equal(pick.fragrance.name, 'Meant To Be Seen');
  assert.equal(pick.parts.idle, daysBetween('2026-09-07', TODAY));
  assert.ok(pick.parts.unworn);
  assert.equal(reasons(pick)[0], 'Not worn yet', 'not "in 35 days": it may have joined the shelf last week');
  assert.ok(!reasons(pick).some(t => /Not worn in/.test(t)));
  // A bottle that joined lately counts from the day it did.
  const added = fragrances.map(f => (f.name === 'Meant To Be Seen' ? { ...f, added: '2026-10-01' } : f));
  assert.ok(!rank(added, mildDay(), 'day', { history: old, nudge: true }).some(r => r.nudged), 'added 11 days ago');
  const addedLongAgo = fragrances.map(f => (f.name === 'Meant To Be Seen' ? { ...f, added: '2026-08-01T09:30:00Z' } : f));
  assert.equal(rank(addedLongAgo, mildDay(), 'day', { history: old, nudge: true })[0].parts.idle, 35, 'the journal’s start, when that is later');
  // Plans alone don't start a journal.
  const planned = fragrances.slice(0, 3).map(f => ({ id: f.id, date: '2026-08-01', slot: 'day', planned: true }));
  assert.ok(!rank(fragrances, mildDay(), 'day', { history: planned, nudge: true }).some(r => r.nudged || r.parts.idle));
});

test('a bottle you rate 2★ or lower is left alone on purpose, never nudged', () => {
  const history = journal({ last: { 'Meant To Be Seen': '2026-09-01' } });
  for (const rating of [1, 2]) {
    const rated = fragrances.map(f => (f.name === 'Meant To Be Seen' ? { ...f, personal: { rating, longevity: 0, sillage: 0 } } : f));
    const ranked = rank(rated, mildDay(), 'day', { history, nudge: true });
    assert.ok(!ranked.some(r => r.nudged), `${rating}★`);
    assert.notEqual(ranked[0].fragrance.name, 'Meant To Be Seen');
  }
  const liked = fragrances.map(f => (f.name === 'Meant To Be Seen' ? { ...f, personal: { rating: 4, longevity: 0, sillage: 0 } } : f));
  assert.equal(rank(liked, mildDay(), 'day', { history, nudge: true })[0].fragrance.name, 'Meant To Be Seen', '4★ still is');
});

test('never past the margin, and never trading an S pick for an A', () => {
  const plain = rank(fragrances, mildDay(), 'day');
  const tierA = plain.find(r => r.tier === 'A' && plain[0].score - r.score <= PLAN_MARGIN);
  assert.ok(tierA, 'the test wants an A within the margin');
  const ranked = rank(fragrances, mildDay(), 'day', { history: journal({ last: { [tierA.fragrance.name]: '2026-08-15' } }), nudge: true });
  assert.equal(ranked[0].fragrance.id, plain[0].fragrance.id);
  assert.ok(!ranked.some(r => r.nudged));

  // Two bottles, both S: one just past the margin stays put, one inside it moves up.
  const pair = names => fragrances.filter(f => names.includes(f.name));
  const top = plain[0].fragrance.name;
  const far = plain.find(r => r.tier !== 'C' && plain[0].score - r.score > PLAN_MARGIN && r.score >= 0.75).fragrance.name;
  const near = plain.find(r => r.fragrance.name !== top && plain[0].score - r.score <= PLAN_MARGIN).fragrance.name;
  const farRanked = rank(pair([top, far]), mildDay(), 'day', { history: journal({ last: { [far]: '2026-08-15' } }), nudge: true });
  assert.equal(farRanked[1].tier, 'S');
  assert.equal(farRanked[0].fragrance.name, top);
  const nearRanked = rank(pair([top, near]), mildDay(), 'day', { history: journal({ last: { [near]: '2026-08-15' } }), nudge: true });
  assert.equal(nearRanked[0].fragrance.name, near);
});

test('a plan nudges at most once every three days, and keeps logged wears', () => {
  const dates = Array.from({ length: 7 }, (_, i) => shiftISO(TODAY, i));
  const windows = dates.flatMap(d => [mildDay(d, 'day'), mildDay(d, 'night')]);
  // The usual winners were worn lately; the rest have sat for weeks.
  const usual = new Set([...windows.flatMap(w => rank(fragrances, w, w.slot).slice(0, 2).map(r => r.fragrance.name))]);
  const last = Object.fromEntries(fragrances.filter(f => !usual.has(f.name)).map(f => [f.name, '2026-08-20']));
  const history = journal({ recent: '2026-09-25', last });

  const plan = planWindows(fragrances, windows, { history, nudge: true });
  const nudges = plan.filter(p => p.pick.nudged).map(p => p.win.dateISO);
  assert.ok(nudges.length >= 2, `nudged on ${nudges.join(', ')}`);
  for (let i = 1; i < nudges.length; i++) assert.ok(daysBetween(nudges[i - 1], nudges[i]) >= 3, nudges.join(', '));
  for (const p of plan.filter(x => x.pick.nudged)) assert.match(reasons(p.pick)[0], /^Not worn in \d+ days$/);
  const off = planWindows(fragrances, windows, { history });
  assert.ok(!off.some(p => p.pick.nudged), 'off unless asked');

  // A wear logged for a window stays its pick.
  const logged = [{ id: idOf('Terra'), date: TODAY, slot: 'day' }, ...history];
  assert.equal(planWindows(fragrances, windows, { history: logged, nudge: true })[0].pick.fragrance.name, 'Terra');
});

test('a bottle saved for an event is never the one nudged before it', () => {
  const formal = occasionById('formal');
  const dates = Array.from({ length: 7 }, (_, i) => shiftISO(TODAY, i));
  const windows = dates.flatMap(d => [mildDay(d, 'day'), mildDay(d, 'night')]);
  const at = 11; // the sixth night
  const event = { ...windows[at], occasion: formal };
  const best = rank(fragrances, event, 'night', { occasion: formal })[0].fragrance;
  // Everything worn lately but the event's best, which has sat since August.
  const history = journal({ recent: '2026-09-25', last: { [best.name]: '2026-08-20' } });
  const plain = planWindows(fragrances, windows, { history, nudge: true });
  assert.ok(plain.slice(0, at).some(p => p.pick.nudged && p.pick.fragrance.id === best.id), 'without the event the plan brings it back early');
  const plan = planWindows(fragrances, windows.map((w, i) => (i === at ? event : w)), { history, nudge: true });
  assert.equal(plan[at].pick.fragrance.id, best.id);
  for (const p of plan.slice(0, at)) {
    assert.notEqual(p.pick.fragrance.id, best.id);
    assert.ok(!p.ranked.some(r => r.nudged && r.fragrance.id === best.id), `${p.win.dateISO} ${p.win.slot}`);
  }
});

test('a neglected bottle saved for an event doesn’t keep another neglected one from its nudge before it', () => {
  const warm = dateISO => ({ slot: 'night', dateISO, date: new Date(`${dateISO}T12:00:00`), lat: 40, category: 'clear', feelsF: 76, humidity: 60, dewF: 62 });
  const nightOut = { ...warm('2026-10-14'), occasion: occasionById('nightout') };
  const windows = [warm(TODAY), nightOut];
  const [held, free, idle] = rank(fragrances, windows[0], 'night');
  assert.equal(rank(fragrances, nightOut, 'night', { occasion: nightOut.occasion })[0].fragrance.id, held.fragrance.id, 'tonight’s top is the night out’s best');
  assert.ok(free.score - idle.score <= PLAN_MARGIN && idle.tier === free.tier);
  // Both sat since August; the held one isn't worn tonight, so the other comes back over the next free bottle.
  const history = journal({ last: { [held.fragrance.name]: '2026-08-20', [idle.fragrance.name]: '2026-08-20' } });
  const [tonight] = planWindows(fragrances, windows, { history, nudge: true });
  assert.equal(tonight.pick.fragrance.id, idle.fragrance.id, `${idle.fragrance.name} over ${free.fragrance.name}`);
  assert.ok(tonight.pick.nudged);
  assert.equal(reasons(tonight.pick)[0], 'Not worn in 53 days');
});

test('Copy for Claude plans as the whole journal does, nudges and all', () => {
  // Four months of following the plan through a swing of weather, then a week ahead from several days.
  const windowOf = (dateISO, slot) => {
    const swing = Math.sin(daysBetween('2026-06-01', dateISO) / 9) * 18;
    return { ...mildDay(dateISO, slot), feelsF: (slot === 'day' ? 70 : 60) + swing };
  };
  // Some bottles stay on the shelf throughout, and Meant To Be Seen past the first weeks.
  const shelved = new Set(['Infini Rose', 'Sticky Fingers', 'Terra', 'Liam'].map(idOf));
  let log = [];
  for (let d = '2026-06-01'; d < '2026-10-01'; d = shiftISO(d, 1)) {
    if (d === '2026-06-20') shelved.add(idOf('Meant To Be Seen'));
    for (const p of planWindows(fragrances, [windowOf(d, 'day'), windowOf(d, 'night')], { history: log })) {
      const worn = [p.pick, ...p.ranked].find(r => !shelved.has(r.fragrance.id)).fragrance.id;
      log = [{ id: worn, date: d, slot: p.win.slot, occasion: 'daily' }, ...log];
    }
  }
  // Few plans here nudge at all (one a start day at most), so the days are
  // ones that do: Oct 9's stopped when other-slot wears began counting less.
  let nudged = 0;
  for (const today of ['2026-10-01', '2026-10-04', '2026-10-08']) {
    const known = log.filter(h => h.date < today);
    const fromToken = readJournal(journalToken(known, [], {}, { todayISO: today })).history;
    assert.ok(fromToken.length < known.length / 5, 'a small part of the log');
    const windows = Array.from({ length: 7 }, (_, k) => shiftISO(today, k)).flatMap(d => [windowOf(d, 'day'), windowOf(d, 'night')]);
    const whole = planWindows(fragrances, windows, { history: known, nudge: true });
    const token = planWindows(fragrances, windows, { history: fromToken, nudge: true });
    assert.deepEqual(token.map(p => p.pick.fragrance.id), whole.map(p => p.pick.fragrance.id), today);
    assert.deepEqual(token.map(p => p.pick.reasons.map(r => r.text)), whole.map(p => p.pick.reasons.map(r => r.text)));
    nudged += whole.filter(p => p.pick.nudged).length;
  }
  assert.ok(nudged > 0, 'the nudge had something to do');
});
