import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contrast, tiesFor, planTies, tieLine, tieName, TIES_MAX } from '../src/contrast.js';
import { heaviness } from '../src/accords.js';
import { performanceLevel } from '../src/engine.js';
import { styleScores, shownOf } from '../src/scent-styles.js';

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
});
