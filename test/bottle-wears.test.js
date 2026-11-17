// The bottle page's "Your wears" (src/views/bottle-wears.js): one bottle's
// wears read from the journal, and the section drawn from the reading.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setUnits } from '../src/ui.js';
import { SECTIONS } from '../src/views/bottle.js';
import '../src/views/sections.js';
import { bottleWears, wearLines, feltLine, yourWearsHTML, praiseHTML, ENOUGH_WEARS } from '../src/views/bottle-wears.js';
import { praiseSaid, wearPhrase } from '../src/ui.js';
import { MAX_PRAISE } from '../src/history.js';

const TODAY = '2026-11-09';
const wear = (id, date, slot, extra = {}) => ({ id, date, slot, ...extra });
// A wear logged from a live window: its weather and the pick its list showed (wearStamp).
const stamp = (f, pick) => ({ wx: { f, d: 40, h: 60, p: 10, c: 3 }, pick });
const JOURNAL = [
  wear('1', '2026-11-10', 'day', { occasion: 'daily' }), // tomorrow: not worn yet
  wear('1', '2026-11-08', 'day', { planned: true }), // a plan's, not a wear
  wear('1', '2026-11-07', 'night', { occasion: 'date', ...stamp(43.4, '1') }),
  wear('2', '2026-11-07', 'day', { occasion: 'daily', ...stamp(50, '2') }),
  wear('1', '2026-11-01', 'day', { occasion: 'daily', ...stamp(60.6, '2') }),
  wear('1', '2026-10-20', 'night', { occasion: 'date', ...stamp(51, '1') }),
  wear('1', '2026-10-03', 'night', { occasion: 'daily', ...stamp(55.2, '9') }),
  wear('1', '2026-09-14', 'night'), // from Worn's calendar: no use, no stamp
  wear('1', '2026-03-02', 'day', { occasion: 'office' }), // a use, no stamp
  wear('3', '2026-10-12', 'night', { occasion: 'date' }),
];
const mine = (extra = {}) => ({ f: { id: '1' }, owned: true, inMine: false, todayISO: TODAY, ...extra });

test('a bottle\'s wears are read from the journal up to today', () => {
  assert.equal(bottleWears(JOURNAL, '9', TODAY), null, 'never worn');
  assert.equal(bottleWears([], '1', TODAY), null);
  const w = bottleWears(JOURNAL, 1, TODAY);
  assert.equal(w.count, 6, 'tomorrow\'s, a plan\'s and other bottles\' left out');
  assert.deepEqual([w.first, w.latest, w.since], ['2026-03-02', '2026-11-07', '2026-03-02']);
  assert.deepEqual([w.day, w.night], [2, 4]);
  assert.equal(w.months.length, 12);
  assert.deepEqual([w.months[0].month, w.months.at(-1).month], ['2025-12', '2026-11']);
  assert.deepEqual(w.months.filter(m => m.wears).map(m => [m.month, m.wears]), [['2026-03', 1], ['2026-09', 1], ['2026-10', 2], ['2026-11', 2]]);
  assert.equal(w.months.reduce((n, m) => n + m.wears, 0), w.count, 'the strip adds up to the count');
  // Untagged wears are left out of the uses; ties go by label.
  assert.deepEqual(w.uses.map(u => [u.id, u.label, u.wears]), [['daily', 'Daily', 2], ['date', 'Date Night', 2], ['office', 'Office', 1]]);
  assert.deepEqual(w.felt, { lowF: 43.4, highF: 60.6, wears: 4 }, 'only stamped wears');
  assert.deepEqual(w.picked, { wears: 2, of: 4 }, 'over the wears that recorded a pick');
});

test('a wear older than the twelve months counts as its first, not in the strip', () => {
  const w = bottleWears([...JOURNAL, wear('1', '2025-10-20', 'night', { occasion: 'formal' })], '1', TODAY);
  assert.equal(w.count, 6);
  assert.deepEqual([w.first, w.since], ['2025-10-20', null]);
  assert.ok(!w.uses.some(u => u.id === 'formal'));
  assert.equal(wearLines(w, TODAY)[0], '2 by day and 4 at night.');
  // All of them older: the section says when it was last worn.
  const old = bottleWears([wear('1', '2025-10-20', 'night')], '1', TODAY);
  assert.equal(old.count, 0);
  assert.match(yourWearsHTML(mine(), old), /Not worn since Oct 20, 2025\./);
});

test('the lines say only what the wears can', () => {
  const w = bottleWears(JOURNAL, '1', TODAY);
  assert.deepEqual(wearLines(w, TODAY), [
    '2 by day and 4 at night since Mar 2.',
    '2 as a daily pick, 2 for a date, 1 for the office.',
    'You’ve worn it when it felt 43–61°.',
    'It was the pick on 2 of the 4 wears that recorded one.',
  ]);
  // His units, as the page's own range reads.
  setUnits('C');
  try {
    assert.equal(feltLine(w.felt), 'You’ve worn it when it felt 6–16°.');
  } finally {
    setUnits('F');
  }
  assert.equal(feltLine({ lowF: 51.6, highF: 52.3, wears: 3 }), 'You’ve worn it when it felt 52°.');
  assert.equal(feltLine({ lowF: 40, highF: 60, wears: ENOUGH_WEARS - 1 }), '', 'two stamped wears aren\'t a range');
  assert.equal(feltLine(null), '');
  // Unstamped, untagged wears: by day and by night alone.
  const plain = bottleWears([wear('1', '2026-11-02', 'day'), wear('1', '2026-10-30', 'day')], '1', TODAY);
  assert.deepEqual(wearLines(plain, TODAY), ['All 2 by day since Oct 30.']);
  const nights = bottleWears([1, 2, 3].map(d => wear('1', `2026-11-0${d}`, 'night', { occasion: 'date', ...stamp(40 + d, '1') })), '1', TODAY);
  assert.deepEqual(wearLines(nights, TODAY), [
    'All 3 at night since Nov 1.',
    'Always for a date.',
    'You’ve worn it when it felt 41–43°.',
    'It was the pick on each of the 3 wears that recorded one.',
  ]);
  const over = bottleWears([1, 2, 3].map(d => wear('1', `2026-11-0${d}`, 'day', { occasion: 'daily', pick: '7' })), '1', TODAY);
  assert.deepEqual(wearLines(over, TODAY), ['All 3 by day since Nov 1.', 'Always as a daily pick.', 'You chose it over the pick on each of the 3 wears that recorded one.']);
});

test('the section draws a strip and lines, a sentence for one wear, nothing for none', () => {
  const html = yourWearsHTML(mine(), bottleWears(JOURNAL, '1', TODAY));
  assert.match(html, /<section class="bp-section" id="bp-wears" aria-labelledby="bp-wears-title">/);
  assert.match(html, /<h3 id="bp-wears-title" tabindex="-1">Your wears <span class="h3-aside">6 since Dec 2025<\/span><\/h3>/);
  assert.equal(html.match(/<li title=/g).length, 12, 'a bar a month');
  assert.ok(html.includes('title="Dec 2025: not worn"') && html.includes('title="Nov: 2 wears"') && html.includes('title="Mar: 1 wear"'), html);
  assert.ok(html.includes('style="height:100%"') && html.includes('style="height:50%"') && html.includes('style="height:0%"'));
  assert.equal(html.match(/class="bw-line"/g).length, 4);
  assert.ok(html.includes('You’ve worn it when it felt 43–61°.'));
  assert.ok(!/undefined|NaN|\[object/.test(html), html);
  // One wear is a sentence, not a chart.
  const once = yourWearsHTML(mine({ f: { id: '3' } }), bottleWears(JOURNAL, '3', TODAY));
  assert.ok(once.includes('Worn once, on Oct 12 at night, for a date.'), once);
  assert.ok(!once.includes('bw-months') && !once.includes('h3-aside'));
  assert.ok(yourWearsHTML(mine({ todayISO: '2026-11-08' }), bottleWears([wear('1', '2026-11-07', 'day')], '1', '2026-11-08')).includes('Worn once, yesterday.'));
  // Never worn, or not his: nothing.
  assert.equal(yourWearsHTML(mine(), bottleWears(JOURNAL, '9', TODAY)), '');
  assert.equal(yourWearsHTML(mine({ owned: false }), bottleWears(JOURNAL, '1', TODAY)), '', 'a bottle he doesn\'t own');
  assert.notEqual(yourWearsHTML(mine({ owned: false, inMine: true }), bottleWears(JOURNAL, '1', TODAY)), '', 'in Mine while another list is ranked');
});

test('it sits between On your skin and the shelf, for a bottle that is his', () => {
  const at = id => SECTIONS.find(s => s.id === id);
  assert.ok(at('wears').order > at('skin').order && at('wears').order < at('alts').order);
  assert.equal(at('wears').shopOrder, undefined);
  // With nothing in the journal (as here) the registered section draws nothing.
  assert.equal(at('wears').render(mine()), '');
});

test('one wear names its day in the day’s own words, and the strip’s months are never called twelve', () => {
  const mine = (over = {}) => ({ owned: true, inMine: false, todayISO: '2026-12-01', ...over });
  const once = (date, slot, today) => yourWearsHTML(mine({ todayISO: today }), bottleWears([{ id: '1', date, slot }], '1', today));
  assert.ok(once('2026-12-01', 'night', '2026-12-01').includes('Worn once, tonight.'));
  assert.ok(once('2026-11-30', 'night', '2026-12-01').includes('Worn once, last night.'));
  assert.ok(once('2026-12-01', 'day', '2026-12-01').includes('Worn once, today.'));
  assert.ok(once('2026-11-28', 'night', '2026-12-01').includes('Worn once, 3 days ago at night.'));
  // On the 1st the strip's twelve calendar months are eleven months and a day:
  // a wear 351 days old is before them, and nothing calls them "12 months".
  const old = once('2025-12-15', 'day', '2026-12-01');
  assert.ok(old.includes('Not worn since Dec 15, 2025.'), old);
  const two = yourWearsHTML(mine(), bottleWears([{ id: '1', date: '2025-12-15', slot: 'day' }, { id: '1', date: '2026-11-20', slot: 'day' }, { id: '1', date: '2026-11-25', slot: 'night' }], '1', '2026-12-01'));
  assert.match(two, /<span class="h3-aside">2 since Jan<\/span>/);
  assert.ok(!/12 months/.test(old + two));
});

test('compliments: the lines count them, and the section notes one on the bottle’s latest wear', () => {
  const log = [
    wear('1', '2026-11-10', 'day', { praise: 5 }), // tomorrow: not worn yet
    wear('1', '2026-11-08', 'night', { praise: 2 }),
    wear('1', '2026-11-08', 'day'),
    wear('1', '2026-11-02', 'day', { praise: 1 }),
    wear('1', '2026-10-20', 'night'),
    wear('2', '2026-11-09', 'day'),
  ];
  const w = bottleWears(log, 1, TODAY);
  assert.equal(w.id, '1');
  assert.deepEqual(w.praise, { count: 3, wears: 2 });
  assert.deepEqual(w.last, { date: '2026-11-08', slot: 'night', praise: 2 }, 'a day’s night is its later wear');
  assert.equal(wearLines(w, TODAY).at(-1), '3 compliments over 4 wears.');
  const html = yourWearsHTML(mine(), w);
  assert.match(html, /<li class="bw-line">3 compliments over 4 wears\.<\/li>/);
  // The buttons carry the wear they were drawn for: its bottle, date and slot.
  assert.match(html, /data-action="praise" data-id="1" data-date="2026-11-08" data-slot="night" data-by="1">.*?<span>Got a compliment<\/span>/);
  assert.match(html, /data-action="praise" data-id="1" data-date="2026-11-08" data-slot="night" data-by="-1">Take one off<\/button>/);
  assert.match(html, /<p class="bw-praise-when">2 compliments on your wear last night\.<\/p>/);
  // None yet: one button, saying which wear it counts for; nothing counted in the lines.
  const plain = bottleWears(JOURNAL, '1', TODAY);
  assert.deepEqual([plain.praise, plain.last], [null, { date: '2026-11-07', slot: 'night', praise: 0 }]);
  const none = yourWearsHTML(mine(), plain);
  assert.match(none, /<p class="bw-praise-when">Counts for your wear on Sat night, Nov 7\.<\/p>/);
  assert.ok(!none.includes('data-by="-1"') && !/compliments? over/.test(none));
  // One wear is a sentence, which says its compliments, with the button under it.
  const once = yourWearsHTML(mine({ f: { id: '2' } }), bottleWears([wear('2', TODAY, 'day', { praise: 1 })], '2', TODAY));
  assert.ok(once.includes('Worn once, today. It got a compliment.') && once.includes('1 compliment on your wear today.'), once);
  assert.ok(yourWearsHTML(mine(), bottleWears([wear('2', TODAY, 'night', { praise: 3 })], '2', TODAY)).includes('Worn once, tonight. It got 3 compliments.'));
  // A wear at the most it keeps takes no more; a wear older than the strip's months offers nothing.
  assert.match(praiseHTML('1', { date: TODAY, slot: 'day', praise: MAX_PRAISE }, TODAY), /data-by="1" disabled>/);
  assert.ok(!yourWearsHTML(mine(), bottleWears([wear('1', '2025-06-01', 'day', { praise: 1 })], '1', TODAY)).includes('data-action="praise"'));
  assert.ok(!/undefined|NaN|\[object/.test(html + none + once));
});

test('noting a compliment says what it did, by the wear it went to', () => {
  assert.deepEqual(['day', 'night'].map(k => wearPhrase(TODAY, k, TODAY)), ['today', 'tonight']);
  assert.deepEqual(['day', 'night'].map(k => wearPhrase('2026-11-08', k, TODAY)), ['yesterday', 'last night']);
  assert.deepEqual(['day', 'night'].map(k => wearPhrase('2026-11-07', k, TODAY)), ['on Sat, Nov 7', 'on Sat night, Nov 7']);
  const said = (done, by) => praiseSaid(done, by, 'last night', MAX_PRAISE);
  assert.equal(said({ praise: 1, changed: true }, 1), 'Compliment noted for your wear last night.');
  assert.equal(said({ praise: 3, changed: true }, 1), 'Compliment noted: 3 on your wear last night.');
  assert.equal(said({ praise: 2, changed: true }, -1), 'One taken off: 2 compliments on your wear last night.');
  assert.equal(said({ praise: 1, changed: true }, -1), 'One taken off: 1 compliment on your wear last night.');
  assert.equal(said({ praise: 0, changed: true }, -1), 'Compliment taken off your wear last night.');
  assert.equal(said({ praise: MAX_PRAISE, changed: false }, 1), 'That wear has 9 compliments, the most one keeps.');
  assert.equal(said({ praise: 0, changed: false }, -1), 'No compliments on your wear last night.');
  assert.equal(said(null, 1), 'That wear was changed since, so nothing was noted.', 'another tab logged another bottle there');
});
