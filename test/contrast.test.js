import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contrast, tiesFor, planTies, rankedTies, tieLine, tieName, gapParts, pickGapLine, TIES_MAX } from '../src/contrast.js';
import { heaviness } from '../src/accords.js';
import { performanceLevel, rank } from '../src/engine.js';
import { OCCASIONS, occasionById } from '../src/occasions.js';
import { styleScores, shownOf } from '../src/scent-styles.js';
import { summarize } from '../src/weather.js';
import { matchPct } from '../src/ui.js';
import { syntheticForecast } from './fixtures.js';

const { fragrances } = JSON.parse(readFileSync(new URL('../data/collection.json', import.meta.url)));
for (const f of fragrances) f.id = String(f.id);
const named = name => {
  const f = fragrances.find(r => r.name.startsWith(name));
  assert.ok(f, name);
  return f;
};

test('contrast names how a bottle differs from the pick: fresher, a style the pick lacks, louder', () => {
  assert.deepEqual(contrast(named('Cream Velvet'), named('Essence de Blanc')), ['fresher', 'fresh citrus']);
  assert.deepEqual(contrast(named('Essence de Blanc'), named('Cream Velvet')), ['richer', 'vanilla']);
  // A quiet bottle beside a loud one: how far it carries is the bigger difference.
  assert.deepEqual(contrast(named('Shiyaaka Sky'), named('Terra')), ['louder', 'amber']);
  assert.deepEqual(contrast(named('Terra'), named('Shiyaaka Sky')), ['quieter', 'fresh citrus']);
  // Two vanillas: no style tells them apart, so only how they wear does.
  assert.ok(!contrast(named('Liquid Brun'), named('Rifaaqat')).includes('vanilla'));
  // A nudge of his own counts: Jake sits closer than Aristo by the votes, not
  // once he says it projects more on him.
  const jake = named('Jake'), aristo = named('Aristo');
  assert.deepEqual(contrast(aristo, jake), ['quieter', 'woody']);
  assert.deepEqual(contrast(aristo, { ...jake, personal: { rating: null, longevity: 0, sillage: 1 } }), ['woody']);
});

test('over every wardrobe pair the tags are honest: two at most, one way round, styles as the cards show them', () => {
  const comparisons = { fresher: 'richer', richer: 'fresher', quieter: 'louder', louder: 'quieter' };
  for (const a of fragrances) {
    const aShown = new Set(shownOf(styleScores(a)).map(s => s.label.toLowerCase()));
    for (const b of fragrances) {
      if (a === b) continue;
      const tags = contrast(a, b);
      const what = `${a.name} → ${b.name}: ${tags.join(', ')}`;
      assert.ok(tags.length <= 2, what);
      assert.ok(!tags.some(t => /darker|sweeter/.test(t)), what);
      assert.equal(new Set(tags).size, tags.length, what);
      const dh = heaviness(b.accords) - heaviness(a.accords);
      if (tags.includes('fresher')) assert.ok(dh <= -0.2, what);
      if (tags.includes('richer')) assert.ok(dh >= 0.2, what);
      assert.ok(!(tags.includes('fresher') && tags.includes('richer')) && !(tags.includes('quieter') && tags.includes('louder')), what);
      const ds = performanceLevel(b, 'sillage') - performanceLevel(a, 'sillage');
      if (tags.includes('louder')) assert.ok(ds >= 0.3, what);
      if (tags.includes('quieter')) assert.ok(ds <= -0.3, what);
      for (const t of tags.filter(x => !(x in comparisons))) {
        assert.ok(shownOf(styleScores(b)).some(s => s.label.toLowerCase() === t), `${what}: ${t} is on its card`);
        assert.ok(!aShown.has(t), `${what}: ${t} isn't on the pick's`);
      }
      // The same comparison leads both ways round, reversed.
      const back = contrast(b, a);
      if (tags[0] in comparisons) assert.equal(back[0], comparisons[tags[0]], `${what} / back: ${back.join(', ')}`);
    }
  }
});

// A ranked entry as rank() makes one, at a given score.
const entry = (name, score, { rotation = 0, stars = null, nudged = false } = {}) => {
  const f = named(name);
  return { fragrance: stars ? { ...f, personal: { rating: stars, longevity: 0, sillage: 0 } } : f, score, tier: 'S', parts: { rotation }, ...(nudged && { nudged: true }) };
};

test('ties are the bottles within a point of the pick’s own match, best first', () => {
  const ranked = [entry('Legacy', 0.885), entry('Aristo', 0.881), entry('Jake', 0.874), entry('Cedrus Blanc', 0.866), entry('Sauvage', 0.80)];
  // 89% against 88% and 87%: Aristo (88) ties, Jake (87) doesn't.
  assert.deepEqual(tiesFor(ranked[0], ranked).map(t => t.entry.fragrance.name), ['Aristo']);
  // A plan's pick needn't lead the list: ties are counted from its score, either way.
  assert.deepEqual(tiesFor(ranked[2], ranked).map(t => t.entry.fragrance.name), ['Aristo', 'Cedrus Blanc']);
  for (const t of tiesFor(ranked[2], ranked)) assert.deepEqual(t.tags, contrast(ranked[2].fragrance, t.entry.fragrance), 'tagged against the pick');
  // At most TIES_MAX.
  const many = [entry('Legacy', 0.88), entry('Aristo', 0.88), entry('Jake', 0.88), entry('Cedrus Blanc', 0.879), entry('Terra', 0.877)];
  assert.equal(tiesFor(many[0], many).length, TIES_MAX);
});

test('ties leave out what was worn or planned lately, what he rates 2★ or lower, and the plan’s other picks; a nudged pick has none', () => {
  const ranked = [entry('Legacy', 0.885), entry('Aristo', 0.88, { rotation: 0.01 }), entry('Jake', 0.88, { stars: 2 }), entry('Cedrus Blanc', 0.879), entry('Glorious Oud', 0.878, { stars: 3 })];
  assert.deepEqual(tiesFor(ranked[0], ranked).map(t => t.entry.fragrance.name), ['Cedrus Blanc', 'Glorious Oud Royal Blanc'], 'a wear nine days back counts; 3★ does not');
  assert.deepEqual(tiesFor(ranked[0], ranked, { skip: [named('Cedrus Blanc').id] }).map(t => t.entry.fragrance.name), ['Glorious Oud Royal Blanc']);
  const nudged = [entry('Sauvage', 0.86, { nudged: true }), entry('Legacy', 0.87), entry('Aristo', 0.865)];
  assert.deepEqual(tiesFor(nudged[0], nudged), [], 'the nudge chose it on purpose');
  assert.deepEqual(tiesFor(null, ranked), []);
  // One the plan saves for an event later on isn't offered before it.
  const saving = [entry('Legacy', 0.885), entry('Aristo', 0.881), entry('Cedrus Blanc', 0.879)];
  saving[1].parts.saved = { dateISO: '2026-10-31', slot: 'night', occasion: { id: 'formal' } };
  assert.deepEqual(tiesFor(saving[0], saving).map(t => t.entry.fragrance.name), ['Cedrus Blanc']);
});

test('a plan’s ties leave out the picks either side, and none for a window already worn', () => {
  const day = { win: { dateISO: '2026-10-26', slot: 'day', label: 'Today' }, ranked: [entry('Legacy', 0.885), entry('Aristo', 0.881), entry('Cedrus Blanc', 0.879)] };
  day.pick = day.ranked[0];
  const night = { win: { dateISO: '2026-10-26', slot: 'night', label: 'Tonight' }, ranked: [entry('Aristo', 0.86), entry('Terra', 0.858)] };
  night.pick = night.ranked[0];
  const [dayTies, nightTies] = planTies([day, night]);
  assert.deepEqual(dayTies.map(t => t.entry.fragrance.name), ['Cedrus Blanc'], 'tonight’s Aristo isn’t offered for today');
  assert.deepEqual(nightTies.map(t => t.entry.fragrance.name), ['Terra']);
  const worn = planTies([day, night], { history: [{ id: day.pick.fragrance.id, date: '2026-10-26', slot: 'day' }] });
  assert.deepEqual(worn[0], [], 'he’s chosen');
  assert.equal(worn[1].length, 1);
  assert.equal(planTies([day, night], { history: [{ id: 'x', date: '2026-10-26', slot: 'day', planned: true }] })[0].length, 1, 'a plan’s own pick is no wear');
});

test('an event’s ties leave out the other events’ picks and what was worn or planned in the days before it', () => {
  const win = (dateISO, occasion) => ({ dateISO, slot: 'night', label: dateISO, ...(occasion && { occasion: { id: occasion } }) });
  const window = (w, ...names) => {
    const ranked = names.map((name, i) => entry(name, 0.88 - i * 0.001));
    return { win: w, ranked, pick: ranked[0] };
  };
  // Ranked as rankEvent ranks them: no rotation, nothing saved.
  const wed = window(win('2026-10-28'), 'Cedrus Blanc', 'Legacy');
  const thu = window(win('2026-10-29'), 'Liam', 'Legacy');
  const fri = window(win('2026-10-30', 'nightout'), 'Terra', 'Amber Empire', 'Liquid Brun', 'Cedrus Blanc', 'Aristo');
  const sat = window(win('2026-10-31', 'date'), 'Amber Empire', 'Terra', 'Rifaaqat');
  const history = [{ id: named('Liquid Brun').id, date: '2026-10-27', slot: 'night' }];
  const [, , friTies, satTies] = planTies([wed, thu, fri, sat], { history });
  // Not Saturday's Amber Empire, Tuesday's Liquid Brun, Wednesday's Cedrus Blanc or Thursday's Liam.
  assert.deepEqual(friTies.map(t => t.entry.fragrance.name), ['Aristo']);
  assert.deepEqual(satTies.map(t => t.entry.fragrance.name), ['Rifaaqat'], 'not Friday’s Terra');
});

test('the tie line says who suits the window just as well, with their tags, or both tags once', () => {
  const t = (name, tags) => ({ entry: { fragrance: { name } }, tags });
  assert.equal(tieLine([], { label: 'Today' }), '');
  assert.equal(tieLine([t('Legacy', ['fresher'])], { label: 'Today' }), 'Legacy (fresher) suits today just as well.');
  assert.equal(tieLine([t('Legacy', ['fresher', 'white floral']), t('Aristo', [])], { label: 'Tonight' }), 'Legacy (fresher, white floral) and Aristo suit tonight just as well.');
  assert.equal(tieLine([t('Essence de Blanc', ['fresh citrus']), t('Shiyaaka Sky', ['fresh citrus'])], { label: 'Tomorrow' }), 'Essence de Blanc and Shiyaaka Sky (both fresh citrus) suit tomorrow just as well.');
  assert.equal(tieLine([t('Terra', [])], { label: 'Friday night' }), 'Terra suits Friday night just as well.');
  assert.equal(tieName(t('Legacy', ['fresher', 'white floral'])), 'Legacy (fresher, white floral)');
  // Markup: names drawn by the caller, the words around them escaped.
  const html = tieLine([t('A&B', ['x']), t('C', ['y'])], { label: 'Today' }, { name: x => `<b>${x.entry.fragrance.name.replace('&', '&amp;')}</b>`, text: s => s.replace(/&/g, '&amp;') });
  assert.equal(html, '<b>A&amp;B</b> (x) and <b>C</b> (y) suit today just as well.');
  // What they suit, in place of the window: the Occasion card's.
  assert.equal(tieLine([t('Terra', ['amber'])], { label: 'Tonight' }, { when: 'formal wear' }), 'Terra (amber) suits formal wear just as well.');
});

test('a list ranked on its own has ties until a wear is logged, and an event’s leave out what was worn before it', () => {
  const win = { dateISO: '2026-10-30', slot: 'night', label: 'Friday night' };
  const ranked = [entry('Terra', 0.885), entry('Amber Empire', 0.881), entry('Liquid Brun', 0.879)];
  assert.deepEqual(rankedTies(ranked, win).map(t => t.entry.fragrance.name), ['Amber Empire', 'Liquid Brun']);
  assert.deepEqual(rankedTies(ranked, win, { history: [{ id: named('Terra').id, date: win.dateISO, slot: 'night' }] }), [], 'he’s chosen');
  assert.equal(rankedTies(ranked, win, { history: [{ id: 'x', date: win.dateISO, slot: 'night', planned: true }] }).length, 2, 'a plan is no wear');
  // Ranked as an event (no rotation): Amber Empire worn two days before isn't offered.
  const before = [{ id: named('Amber Empire').id, date: '2026-10-28', slot: 'night' }];
  assert.deepEqual(rankedTies(ranked, win, { history: before, event: true }).map(t => t.entry.fragrance.name), ['Liquid Brun']);
  assert.equal(rankedTies(ranked, win, { history: before }).length, 2, 'ranked with rotation, its penalty would say so itself');
});

// ---------- Beside the pick ----------

const wx = summarize(syntheticForecast(7), Date.parse('2026-09-28T16:00:00Z'));
const history = [{ id: named('Sandalwood').id, date: '2026-09-27', slot: 'night' }, { id: named('Liam').id, date: '2026-09-26', slot: 'day' }];
const lists = [null, ...OCCASIONS].flatMap(occasion => [wx.day, wx.night, { ...wx.night, feelsF: 92, dewF: 72 }, { ...wx.day, feelsF: 25, dewF: 15 }]
  .map(win => ({ win, occasion, ranked: rank(fragrances.map(f => (f.name === 'Jake' ? { ...f, personal: { rating: 2, longevity: 0, sillage: 0 } } : f)), win, win.slot, { occasion, history, todayISO: win.dateISO }) })));

test('the gap’s parts add up to the gap between the two scores, daily and for every occasion', () => {
  for (const { win, occasion, ranked } of lists) {
    for (const e of ranked) {
      const sum = Object.values(gapParts(e, ranked[0], occasion)).reduce((a, b) => a + b, 0);
      assert.ok(Math.abs(sum - (ranked[0].score - e.score)) < 1e-9, `${e.fragrance.name} ${win.slot} ${occasion?.id}: ${sum}`);
    }
  }
});

test('beside the pick: as well as it within a point, else how many points under it and the part that makes most of the gap', () => {
  const words = /^(\d+) points under (.+?) (for .+ )?(today|tonight), mostly (the season fit|the time-of-day fit|the weather fit|the occasion fit|the rating|your rating|the heat|the cold|a recent wear)( and (the season fit|the time-of-day fit|the weather fit|the occasion fit|the rating|your rating|the heat|the cold|a recent wear))?\.$/;
  for (const { win, occasion, ranked } of lists) {
    const pick = ranked[0];
    assert.equal(pickGapLine(pick, pick, win, { occasion }), '', 'the pick itself');
    for (const e of ranked.slice(1)) {
      const line = pickGapLine(e, pick, win, { occasion });
      const points = matchPct(pick) - matchPct(e);
      assert.ok(!/°|\d+ ?F\b/.test(line), line);
      if (Math.abs(points) <= 1) {
        assert.equal(line, `Suits ${occasion ? `${occasion.phrase ?? occasion.label.toLowerCase()} ` : ''}${win.label.toLowerCase()} as well as ${pick.fragrance.name}.`);
        continue;
      }
      const m = line.match(words);
      if (pick.nudged && points < 0) continue;
      assert.ok(m, line);
      assert.equal(Number(m[1]), points, 'points as the badges show them');
      assert.equal(m[2], pick.fragrance.name);
      assert.equal(Boolean(m[3]), Boolean(occasion));
      // The part named first is the one that makes most of the gap.
      const gaps = gapParts(e, pick, occasion);
      const top = Object.keys(gaps).reduce((a, b) => (gaps[b] > gaps[a] ? b : a));
      const first = { season: 'the season fit', time: 'the time-of-day fit', weather: 'the weather fit', occasion: 'the occasion fit', heat: 'the heat', cold: 'the cold', rotation: 'a recent wear' }[top] ?? /the rating|your rating/;
      if (typeof first === 'string') assert.equal(m[5], first, `${e.fragrance.name}: ${line}`);
      else assert.match(m[5], first);
    }
  }
  // Worn lately, the rest it's given is what keeps it under; his 2★ is his.
  const night = lists.find(l => l.win === wx.night && !l.occasion);
  const rested = night.ranked.find(r => r.fragrance.name.startsWith('Sandalwood'));
  assert.match(pickGapLine(rested, night.ranked[0], wx.night), /, mostly (a recent wear|the \w+ fit and a recent wear)\.$/);
  const day = lists.find(l => l.win === wx.day && !l.occasion);
  const jake = day.ranked.find(r => r.fragrance.name === 'Jake');
  assert.match(pickGapLine(jake, day.ranked[0], wx.day), /, mostly your rating\.$/);
});

test('above the pick, it says what chose the pick instead; a bottle saved for an event says so in its own note', () => {
  const win = { ...wx.day, label: 'Today' };
  const pick = entry('Legacy', 0.86), over = entry('Aristo', 0.9, { rotation: 0.02 });
  over.parts.planned = true;
  assert.equal(pickGapLine(over, pick, win), '4 points over Legacy today, but the plan gives Legacy a turn.');
  assert.equal(pickGapLine(over, { ...pick, nudged: true }, win), '4 points over Legacy today, but Legacy is due a wear.');
  assert.equal(pickGapLine(over, pick, win, { worn: pick.fragrance.id }), '4 points over Legacy today, but you’re wearing Legacy.');
  assert.equal(pickGapLine(entry('Aristo', 0.9, { stars: 2 }), pick, win), '4 points over Legacy today, but you rate it 2★.');
  const saved = entry('Aristo', 0.9);
  saved.parts.saved = { dateISO: '2026-10-31', slot: 'night', occasion: occasionById('formal') };
  assert.equal(pickGapLine(saved, pick, win), '');
  assert.equal(pickGapLine(saved, pick, win, { occasion: occasionById('formal') }), '');
  assert.equal(pickGapLine(entry('Aristo', 0.9), pick, { ...win, label: 'Friday night' }, { occasion: occasionById('date') }), '4 points over Legacy for a date Friday night, but the plan gives Legacy a turn.');
  assert.equal(pickGapLine(null, pick, win), '');
  assert.equal(pickGapLine(over, null, win), '');
});
