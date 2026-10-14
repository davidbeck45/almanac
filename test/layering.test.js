import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { noteFamily, noteFamilies, layerPair, layerPicks, layerProfile, complementOf, commonNotes, pairingMeans, pairingKept, warmPairing } from '../src/layering.js';
import { applySkin } from '../src/skin.js';
import { heaviness } from '../src/accords.js';
import { DEFAULT_HIDDEN } from '../src/hidden.js';

const load = f => JSON.parse(readFileSync(new URL(`../data/${f}.json`, import.meta.url))).fragrances;
const demo = load('collection').filter(f => !DEFAULT_HIDDEN.includes(String(f.id)));
const catalog = load('catalog');

function bottle(id, accords, notes) {
  return { id, name: id, brand: 'Test', accords, notes, season: {}, dayNight: {} };
}
const GOURMAND = bottle('gourmand', { vanilla: 100, caramel: 80, sweet: 70 }, { top: ['Caramel'], base: ['Vanilla', 'Tonka Bean'] });
const GOURMAND_TWIN = bottle('twin', { vanilla: 100, sweet: 85, caramel: 75 }, { top: ['Caramel'], base: ['Vanilla', 'Tonka'] });
const WOODY = bottle('woody', { woody: 100, 'fresh spicy': 60, earthy: 45 }, { top: ['Black Pepper'], base: ['Cedar', 'Vetiver'] });
const MARINE = bottle('marine', { aquatic: 100, fresh: 80, ozonic: 60 }, { top: ['Sea Notes'], base: ['Musk'] });

const hotHumidDay = { feelsF: 92, humidity: 75, category: 'clear', date: new Date('2026-08-05T12:00:00'), lat: 40 };
const coldNight = { feelsF: 28, humidity: 60, category: 'clear', date: new Date('2027-01-15T12:00:00'), lat: 40 };
const named = name => demo.find(f => f.name === name);

test('notes map to accord families, specific names first', () => {
  assert.equal(noteFamily('Tonka Bean'), 'vanilla');
  assert.equal(noteFamily('Bourbon Vanilla'), 'vanilla');
  assert.equal(noteFamily('Orange Blossom'), 'white floral');
  assert.equal(noteFamily('Grapefruit'), 'citrus');
  assert.equal(noteFamily('Kyara Incense'), 'oud');
  assert.equal(noteFamily('Ginger Flower'), 'white floral');
  assert.equal(noteFamily('Guaiac Wood'), 'woody');
  assert.equal(noteFamily('Coconut Milk'), 'coconut');
  assert.equal(noteFamily('Hazelnut'), 'nutty');
  assert.equal(noteFamily('Black Tea'), 'tea');
  assert.equal(noteFamily('Tea Rose'), 'rose');
  assert.equal(noteFamily('Fig Leaf'), 'green');
  assert.equal(noteFamily('Fig'), 'fruity');
  assert.equal(noteFamily('Rosemary'), 'herbal');
  assert.equal(noteFamily('Rosewood'), 'woody');
  assert.equal(noteFamily('Peppermint'), 'herbal');
  assert.equal(noteFamily('Salted Egg Yolk'), 'savory');
  assert.equal(noteFamily('Sea Salt'), 'aquatic');
  const unmapped = [...demo, ...catalog].flatMap(f => Object.values(f.notes).flat()).filter(n => !noteFamily(n));
  assert.deepEqual(unmapped, [], 'every note in the data has a family');
});

test('notes between families count toward each, the main one most', () => {
  assert.deepEqual(noteFamilies('Labdanum').map(([f]) => f), ['balsamic', 'amber']);
  assert.deepEqual(noteFamilies('Ambroxan').map(([f]) => f), ['amber', 'woody', 'musky']);
  const [[, main], [, other]] = noteFamilies('Tonka Bean');
  assert.ok(main > other && Math.abs(main + other - 1) < 1e-9);
  assert.deepEqual(noteFamilies('Bergamot'), [['citrus', 1]]);
  assert.deepEqual(noteFamilies('Unobtainium'), []);
  // The labdanum in a resin bottle bridges to an amber one.
  const resin = bottle('resin', { balsamic: 100 }, { base: ['Labdanum'] });
  assert.ok(layerProfile(resin).profile.amber > 0);
});

test('notes count by how strongly voters smell them', () => {
  const notes = { top: ['Bergamot'], base: ['Vanilla', 'Cedar'] };
  const plain = bottle('plain', { vanilla: 100 }, notes);
  const voted = { ...plain, noteVotes: { Vanilla: 900, Cedar: 300, Bergamot: 30 } };
  assert.ok(layerProfile(voted).profile.citrus < layerProfile(plain).profile.citrus / 2, 'bergamot barely comes through');
  assert.ok(layerProfile(voted).profile.vanilla > layerProfile(plain).profile.vanilla);
  // A note nobody smells in one bottle doesn't tie it to another.
  const partner = bottle('partner', { citrus: 100 }, { top: ['Bergamot', 'Lemon'], base: ['Cedar'] });
  const shared = b => layerPair(b, partner).reasons.find(r => r.text.startsWith('Shared'))?.text;
  assert.equal(shared(plain), 'Shared cedar and bergamot tie them together');
  assert.equal(shared(voted), 'Shared cedar ties them together');
});

test('pairing rules cover most of how real bottles meet', () => {
  // A family pair with no rule counts as neither good nor bad, which quietly
  // favors bottles whose families the table happens to know.
  const profiles = [...demo, ...catalog].map(f => layerProfile(f).profile);
  let all = 0, ruled = 0;
  const missing = {};
  for (const p of profiles) {
    for (const q of profiles) {
      if (p === q) continue;
      for (const [fa, pa] of Object.entries(p)) {
        for (const [fb, pb] of Object.entries(q)) {
          if (fa === fb) continue;
          all += pa * pb;
          if (complementOf(fa, fb) !== undefined) ruled += pa * pb;
          else missing[`${fa} + ${fb}`] = (missing[`${fa} + ${fb}`] ?? 0) + pa * pb;
        }
      }
    }
  }
  const top = Object.entries(missing).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k);
  assert.ok(ruled / all >= 0.8, `rules cover ${(100 * ruled / all).toFixed(0)}%; most common gaps: ${top.join(', ')}`);
});

test('a contrasting partner beats a near-duplicate, and a clash scores lowest', () => {
  const woody = layerPair(GOURMAND, WOODY), twin = layerPair(GOURMAND, GOURMAND_TWIN), marine = layerPair(GOURMAND, MARINE);
  assert.ok(woody.score > twin.score + 0.2, `${woody.score} vs ${twin.score}`);
  assert.ok(twin.score > marine.score || marine.score < 0.2);
  assert.ok(twin.reasons.some(r => r.tone === 'bad'), 'the twin gets a warning');
  assert.ok(marine.reasons.some(r => /fight/.test(r.text)));
});

test('reasons name the notes behind the pairing, with the heavier bottle first', () => {
  const pair = layerPair(GOURMAND, WOODY);
  assert.match(pair.reasons[0].text, /^(Cedar|Vetiver|Black pepper) \w+/);
  assert.equal(pair.first, GOURMAND);
  const plural = layerPair(GOURMAND, bottle('citrus', { citrus: 100 }, { top: ['Citruses'] }));
  assert.match(plural.reasons[0].text, /^Citruses brighten /);
});

test('picks come from the rest of the collection, capped and above the bar', () => {
  const picks = layerPicks(catalog[0], catalog);
  assert.ok(picks.length > 0 && picks.length <= 3);
  assert.ok(picks.every(p => p.fragrance.id !== catalog[0].id && p.score >= 0.4));
  assert.ok(picks.every((p, i) => i === 0 || picks[i - 1].score >= p.score));
  assert.ok(picks.every(p => p.reasons.some(r => r.tone === 'good')));
});

test('pairs Parfumo voters layer rank higher, named by the bottles they voted on', () => {
  const backed = { ...WOODY, id: 'backed' }, plain = { ...WOODY, id: 'plain' };
  const base = { ...GOURMAND, layeredWith: [{ id: 'backed', consensus: 80, via: ['Original A', 'Original B'] }] };
  const [top, next] = layerPicks(base, [base, plain, backed]);
  assert.equal(top.fragrance, backed);
  assert.equal(top.reasons[0].text, 'Parfumo voters layer Original A with Original B');
  assert.ok(top.score > next.score && next.community === null);
  // Either record carries the pair; from the other side the names swap.
  assert.deepEqual(layerPair(backed, base).community.via, ['Original B', 'Original A']);
});

test('Parfumo votes on originals reach their dupes, less so in the wrong weather', () => {
  // Hawas Elixir and Détour Noir have few votes of their own; Le Mâle Elixir and Layton do.
  const pick = layerPicks(named('Hawas Elixir'), demo).find(p => p.fragrance === named('Détour Noir'));
  assert.ok(pick, 'Détour Noir is among Hawas Elixir\'s partners');
  assert.match(pick.reasons[0].text, /^Parfumo voters layer .+ with Layton$/);
  // Voters vouch for the pair, not the weather: two fresh bottles gain less on a cold night.
  const fresh = [named('Essence de Blanc'), named('Aristo')];
  assert.ok(layerPair(...fresh, coldNight).community.boost < layerPair(...fresh).community.boost);
});

test('no single partner takes over every list', () => {
  for (const list of [demo, catalog]) {
    const counts = {};
    for (const f of list) for (const p of layerPicks(f, list)) counts[p.fragrance.id] = (counts[p.fragrance.id] ?? 0) + 1;
    assert.ok(Math.max(...Object.values(counts)) <= 0.6 * list.length, JSON.stringify(counts));
  }
});

test('tea dries out vanilla, iris takes oud, and two aquatics only double up', () => {
  const withNote = note => bottle(note, { green: 100, citrus: 60, woody: 40 }, { top: ['Bergamot'], mid: [note], base: ['Cedar'] });
  assert.ok(layerPair(GOURMAND, withNote('Black Tea')).score > layerPair(GOURMAND, withNote('Basil')).score);
  const iris = bottle('iris', { iris: 100, powdery: 70, musky: 50 }, { mid: ['Orris Root'], base: ['Musk'] });
  const oud = bottle('oud', { oud: 100, woody: 70, amber: 50 }, { base: ['Agarwood (Oud)', 'Amber'] });
  assert.match(layerPair(iris, oud).reasons[0].text, /oud\) deepens the orris root/);
  const marine2 = bottle('marine2', { aquatic: 90, citrus: 80, woody: 60 }, { top: ['Calone', 'Grapefruit'], base: ['Cedar'] });
  const twoMarine = layerPair(MARINE, marine2).reasons;
  assert.ok(twoMarine.some(r => r.tone === 'bad' && /aquatics/.test(r.text)));
  assert.ok(!twoMarine.some(r => r.text === 'Both lean aquatic'));
  assert.ok(!layerPair(WOODY, marine2).reasons.some(r => /aquatics/.test(r.text)));
});

test('without the weather, two heavy scents take a flat penalty that a cold night lifts', () => {
  const winter = { winter: 0.5, spring: 0.1, summer: 0.05, fall: 0.35 };
  const heavy = (id, accords) => ({ ...bottle(id, accords, { base: ['Vanilla'] }), season: winter, dayNight: { day: 0.3, night: 0.7 } });
  const a = heavy('a', { vanilla: 100, tobacco: 80, 'warm spicy': 70 }), b = heavy('b', { leather: 100, oud: 80, amber: 70 });
  const flat = layerPair(a, b);
  assert.ok(flat.reasons.some(r => /Two heavy scents/.test(r.text)), JSON.stringify(flat.reasons));
  assert.ok(layerPair(a, b, coldNight).score > flat.score);
});

test('the weather lifts rich pairs on cold nights and fresh ones on hot days', () => {
  // The two heaviest bottles in the demo, whichever they are after a refit.
  const [rich, richer] = [...demo].sort((x, y) => heaviness(y.accords) - heaviness(x.accords));
  const cold = layerPair(rich, richer, coldNight), hot = layerPair(rich, richer, hotHumidDay);
  assert.ok(cold.score > hot.score + 0.2, `${cold.score} vs ${hot.score}`);
  assert.ok(hot.reasons.some(r => r.tone === 'bad' && /heat/.test(r.text)));
  assert.ok(!cold.reasons.some(r => r.tone === 'bad'), JSON.stringify(cold.reasons));

  // A light bottle's partners lean richer in the cold than in the heat.
  const light = named('Essence de Blanc');
  const partnerHeaviness = c => {
    const picks = layerPicks(light, demo, 3, c);
    return picks.reduce((s, p) => s + heaviness(p.fragrance.accords), 0) / picks.length;
  };
  assert.ok(partnerHeaviness(coldNight) > partnerHeaviness(hotHumidDay) + 0.2);
  for (const p of layerPicks(light, demo, 3, hotHumidDay)) assert.ok(!p.reasons.some(r => r.tone === 'bad' && /heat/.test(r.text)));
});

test('a pair that suits the weather comes before any that doesn\'t, Parfumo votes or not', () => {
  for (const c of [hotHumidDay, coldNight]) {
    for (const f of demo) {
      const picks = layerPicks(f, demo, Infinity, c);
      const firstOff = picks.findIndex(p => p.offWeather);
      if (firstOff >= 0) assert.ok(picks.slice(firstOff).every(p => p.offWeather), `${f.name}: ${picks.map(p => `${p.fragrance.name}${p.offWeather ? ' (off)' : ''}`).join(', ')}`);
      for (const p of picks) assert.equal(p.offWeather, p.reasons.some(r => r.tone === 'bad' && /^Too (rich|light)/.test(r.text)), `${f.name} + ${p.fragrance.name}`);
    }
  }
  // Glorious Oud Royal Blanc's voted partner Liquid Brun is too rich for a muggy 95°F day.
  const gorb = layerPicks(named('Glorious Oud Royal Blanc'), demo, 3, { ...hotHumidDay, feelsF: 95 });
  assert.ok(!gorb.some(p => p.fragrance === named('Liquid Brun')), gorb.map(p => p.fragrance.name).join(', '));
  const brun = layerPair(named('Glorious Oud Royal Blanc'), named('Liquid Brun'), { ...hotHumidDay, feelsF: 95 });
  assert.ok(brun.community.boost < 0.1, `boost ${brun.community.boost}`);
});

test('a note most of the collection shares doesn\'t tie a pair together', () => {
  const common = commonNotes(demo);
  assert.ok(common.has('bergamot'), [...common].join(', '));
  assert.ok(!common.has('cardamom'));
  let ties = 0;
  for (const f of demo) {
    for (const p of layerPicks(f, demo)) {
      if (p.reasons.some(r => /^Shared .*\bbergamot\b/.test(r.text))) ties++;
    }
  }
  assert.equal(ties, 0);
  // Without a collection to judge by, a shared bergamot still counts.
  const partner = bottle('partner', { citrus: 100 }, { top: ['Bergamot', 'Lemon'], base: ['Cedar'] });
  const plain = bottle('plain', { vanilla: 100 }, { top: ['Bergamot'], base: ['Vanilla', 'Cedar'] });
  assert.equal(layerPair(plain, partner).reasons.find(r => r.text.startsWith('Shared')).text, 'Shared cedar and bergamot tie them together');
  assert.equal(layerPair(plain, partner, null, { common: new Set(['bergamot']) }).reasons.find(r => r.text.startsWith('Shared')).text, 'Shared cedar ties them together');
});

test('the bottle page\'s partner averages match a fresh pass, whichever bottle opens', () => {
  // Each partner's average model score over the rest of the list it's given.
  const fresh = list => new Map(list.map(f => [f.id,
    list.filter(g => g !== f).reduce((s, g) => s + layerPair(f, g).model, 0) / Math.max(1, list.length - 1)]));
  const all = [...demo, ...catalog];
  const outside = load('originals')[0];
  // Owned bottles open with the rest of the list, one from outside with all of it,
  // then a smaller list (bottles switched off) and a fresh one.
  const opens = [
    [all[0], all.slice(1)], [all[5], all.filter(f => f !== all[5])], [outside, all],
    [all[3], all.filter(f => f !== all[3])], [all[2], all.slice(4)], [all[0], all.slice(0, 6)], [all[1], all.slice(0, 6)],
  ];
  for (const [frag, list] of opens) {
    const { means, overall, common } = pairingMeans(list, frag);
    const want = fresh(list);
    assert.equal(means.size, want.size);
    for (const [id, m] of want) assert.ok(Math.abs(means.get(id) - m) < 1e-12, `${frag.name}: ${id} ${means.get(id)} vs ${m}`);
    assert.ok(Math.abs(overall - [...want.values()].reduce((a, b) => a + b, 0) / want.size) < 1e-12);
    assert.deepEqual([...common].sort(), [...commonNotes(list)].sort());
  }
  // The page draws twice: the second draw gets the same picks.
  const others = demo.slice(1);
  assert.deepEqual(layerPicks(demo[0], [...others], 3, coldNight), layerPicks(demo[0], [...others], 3, coldNight));
});

test('partners rank the same with the bottle in the list or not, as the CLI and the bottle page ask', () => {
  for (const list of [demo, catalog]) {
    for (const f of list) {
      const names = picks => picks.map(p => `${p.fragrance.name} ${p.rank.toFixed(12)}`);
      const without = list.filter(g => g !== f);
      assert.deepEqual(names(layerPicks(f, list, 5)), names(layerPicks(f, without, 5)), f.name);
      assert.deepEqual(names(layerPicks(f, list, 5, coldNight)), names(layerPicks(f, without, 5, coldNight)), f.name);
    }
  }
});

test('the n² pass can run in slices before a page needs it, and your stars don’t undo it', async () => {
  const list = [...demo, ...catalog], frag = list[0], others = list.slice(1);
  pairingMeans(catalog.slice(0, 5));
  assert.equal(pairingKept(others), false);
  let pauses = 0;
  await warmPairing(others, frag, { pause: async () => { pauses++; }, slice: 0 });
  assert.ok(pauses >= others.length, 'a pause after every row');
  assert.equal(pairingKept(others), true);
  // A rating makes new records with the same scent: the kept pairs still answer.
  const rated = applySkin(others, { [others[3].id]: { rating: 5 } });
  assert.notEqual(rated[3], others[3]);
  assert.equal(pairingKept(rated), true);
  const want = new Map(others.map(f => [f.id, others.filter(g => g !== f).reduce((s, g) => s + layerPair(f, g).model, 0) / (others.length - 1)]));
  for (const [id, m] of pairingMeans(rated, frag).means) assert.ok(Math.abs(m - want.get(id)) < 1e-12, id);
});
