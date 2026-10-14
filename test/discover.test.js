import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadPool, loadPoolStyles, loadAbout, poolKey } from '../src/fragrantica.js';
import { STYLES, topOf, closeOf } from '../src/scent-styles.js';
import { genderLean, signalsOf, ownedVectors } from '../src/candidates.js';
import { similarity } from '../src/similar.js';
import { performanceRating, steadyShares } from '../src/engine.js';
import {
  DEMO_LIKED, LEAN_WINDOWS, STORED_MIN, discoverContext, scoresOf, findStyles, likedStyles, moreOfStyles, defaultSeeds, moreLike,
  parseNotes, searchNotes, dupesOf, originalFromVotes, whyLine, addCloneVotes,
} from '../src/discover.js';
import { loadWants, saveWants, addWant, removeWant, hasWant, setWant, wantIdsToLoad } from '../src/wishlist.js';
import { customRecord } from '../src/custom.js';
import { applySkin } from '../src/skin.js';
import { fitPoolStyles } from '../scripts/fit-pool-styles.mjs';

const dir = new URL('../data/fragrantica/', import.meta.url);
const load = async path => {
  const file = new URL(path, dir);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
};
const pool = await loadPool(load);
const styles = await loadPoolStyles(load);
const built = stem => JSON.parse(readFileSync(new URL(`../data/${stem}.json`, import.meta.url))).fragrances;
const wardrobe = built('collection'), brooke = built('catalog');
const owned = name => wardrobe.find(f => f.name === name);
const ctx = discoverContext(pool, wardrobe, { styles });
const at = id => ctx.byId.get(String(id));
const vecs = ownedVectors(wardrobe, ctx.byId);
const names = picks => picks.map(p => p.record.name);
const kinOf = p => ctx.family.dupeOf(p.record);

test('the pool’s stored style scores are the live ones', async () => {
  assert.ok(styles, 'pool-styles.json loads for this pool (else run `node scripts/fit-pool-styles.mjs --write`)');
  assert.equal(styles.key, poolKey(pool));
  assert.ok(ctx.styles, 'and its check matches src/scent-styles.js (else run `node scripts/fit-pool-styles.mjs --write`)');
  // Every pool bottle, scored on its full r/ row as the script does.
  const { file } = await fitPoolStyles();
  assert.equal(styles.check, file.check, 'stale: run `node scripts/fit-pool-styles.mjs --write`');
  assert.deepEqual(styles.styles, file.styles, 'stale: run `node scripts/fit-pool-styles.mjs --write`');
  file.s.forEach((row, i) => assert.deepEqual(styles.s[i], row, `${pool.cols.n[i]}: stale, run \`node scripts/fit-pool-styles.mjs --write\``));
  // Scores left out are under STORED_MIN.
  const fleur = scoresOf(at(48681), ctx);
  assert.ok(STYLES.every(s => fleur[s.id] === 0 || fleur[s.id] >= STORED_MIN / 100));
  assert.ok(fleur.skin >= 0.9 && closeOf(fleur));
  // A file made by other style rules is set aside, and one that can't be fetched reads as none.
  assert.equal(discoverContext(pool, wardrobe, { styles: { ...styles, check: 'other' }, records: ctx.records }).styles, null);
  const flaky = async path => {
    if (path === 'pool-styles.json') throw new Error('offline');
    return load(path);
  };
  assert.equal(await loadPoolStyles(flaky), null);
});

test('without the stored file the pool is scored live, to the same chips', () => {
  const live = discoverContext(pool, wardrobe, { styles: { ...styles, styles: ['skin'] }, records: ctx.records });
  assert.equal(live.styles, null, 'a file listing other styles is set aside');
  const a = moreOfStyles(['clean'], ctx, { k: 10 }), b = moreOfStyles(['clean'], live, { k: 10 });
  assert.ok(a.filter(p => b.some(q => q.id === p.id)).length >= 7, `${names(a)} / ${names(b)}`);
});

test('styles read from typed text', () => {
  assert.deepEqual(findStyles('skin, Clean, INTIMATE').ids, ['skin', 'clean', 'intimate']);
  assert.deepEqual(findStyles('skin scents, clean scents, musky, soapy'), { ids: ['skin', 'clean'], unknown: [] });
  assert.deepEqual(findStyles('Skin scent').ids, ['skin']);
  assert.deepEqual(findStyles('smoky, fougère').ids, ['incense', 'aromatic']);
  assert.deepEqual(findStyles(', ,'), { ids: [], unknown: [] });
  assert.deepEqual(findStyles('skin scent,powdery & iris').ids, ['skin', 'powdery']);
  assert.deepEqual(findStyles('iris, barbershop').ids, ['powdery', 'aromatic']);
  assert.deepEqual(findStyles('wet dog').unknown, ['wet dog']);
});

test('the chips start on the styles David loves, which his wardrobe holds; others on what they own most', () => {
  const david = likedStyles(wardrobe, { stated: DEMO_LIKED });
  assert.deepEqual(david.map(s => s.id), ['skin', 'clean', 'intimate']);
  assert.deepEqual(david.find(s => s.id === 'clean').bottles, ['Cedrus Blanc']);
  const demo = wardrobe.filter(f => f.name !== 'Jake');
  assert.deepEqual(likedStyles(demo, { stated: DEMO_LIKED }).find(s => s.id === 'intimate').bottles, ['Shiyaaka Sky'], 'the demo, without Jake');
  // A stated style the wardrobe has no bottle of stays off.
  assert.deepEqual(likedStyles(wardrobe, { stated: ['oud', 'skin'] }).map(s => s.id), ['skin']);
  // By the mix alone David leans warm and sweet; Brooke gourmand.
  assert.equal(likedStyles(wardrobe)[0].id, 'vanilla');
  const hers = likedStyles(brooke).map(s => s.id);
  assert.ok(hers.includes('gourmand') || hers.includes('vanilla'), hers.join());
  assert.ok(likedStyles(brooke).every(s => s.count >= 2));
});

test('more skin scents are the genre’s canon, and none is owned, brigaded or a twin of an owned bottle', () => {
  const picks = moreOfStyles(['skin'], ctx, { k: 30 });
  const canon = [48681, 46885, 845, 846, 3606, 16603, 53441, 80011, 10131, 87591, 93117, 71280, 78658].map(String);
  const found = picks.filter(p => [p.record, ...(p.alike ?? [])].some(r => canon.includes(r.id)));
  assert.ok(found.length >= 7, `canon found: ${names(found)}`);
  for (const p of picks) {
    assert.ok(p.styles.some(s => s.id === 'skin'), `${p.record.name} shows Skin scent`);
    assert.ok(!ctx.allowed.owned.has(p.id) && !ctx.allowed.originals.has(p.id), p.record.name);
    assert.ok(!signalsOf(p.record).flags.includes('brigaded') && !signalsOf(p.record).flags.includes('discontinued'), p.record.name);
    assert.ok(p.record.rating >= 3.65, p.record.name);
  }
  // Each lean band's picks come best first.
  for (const band of [p => genderLean(p.record) < -0.25, p => Math.abs(genderLean(p.record)) <= 0.25, p => genderLean(p.record) > 0.25]) {
    const own = picks.filter(band);
    for (let i = 1; i < own.length; i++) assert.ok(own[i].score <= own[i - 1].score + 1e-9);
  }
});

test('style lists lean the way the wardrobe does', () => {
  // David's bottles lean masculine (17 of 25); skin and clean scents lean feminine.
  const masculine = picks => picks.filter(p => genderLean(p.record) > 0.1);
  const lists = [moreOfStyles(['skin'], ctx, { k: 12 }), moreOfStyles(['skin', 'clean', 'intimate'], ctx, { k: 12 })];
  assert.ok(masculine(lists[0]).length >= 3, names(lists[0]).join());
  // Beside Intimate only men's bottles that wear close come in: Bvlgari Pour Homme, not Invictus.
  assert.ok(masculine(lists[1]).length >= 2 && lists[1].every(p => p.close), names(lists[1]).join());
  assert.ok(['Dior Homme 2020', 'Narciso Rodriguez for Him Bleu Noir Eau de Parfum'].every(n => names(lists[0]).includes(n)), names(lists[0]).join());
  // Twins fold under the one nearer his lean: Narciso Rodriguez For Him Intense, not If You Musk.
  assert.ok(names(lists[0]).includes('Narciso Rodriguez For Him Eau de Parfum Intense'), names(lists[0]).join());
  // Brooke's gourmand wardrobe leans feminine, and so do her lists; a lean filter overrides either.
  const hers = discoverContext(pool, brooke, { styles, records: ctx.records });
  assert.ok(masculine(moreOfStyles(['skin'], hers, { k: 12 })).length <= 1);
  assert.ok(moreOfStyles(['skin'], ctx, { k: 12, filters: { lean: 'feminine' } }).every(p => genderLean(p.record) <= -0.25));
});

test('a style’s rating floor follows how voters rate the style', () => {
  // Voters rate skin scents lower than the pool, so Missing Person (3.78) comes in; ask for 3.8 and it stays out.
  const feminine = { lean: 'feminine' };
  const has = (picks, name) => picks.some(p => [p.record, ...(p.alike ?? [])].some(r => r.name === name));
  assert.ok(has(moreOfStyles(['skin'], ctx, { k: 40, filters: feminine }), 'Missing Person'));
  const strict = moreOfStyles(['skin'], ctx, { k: 40, filters: { ...feminine, minRating: 3.8 } });
  assert.ok(!has(strict, 'Missing Person') && strict.every(p => p.record.rating >= 3.8));
  // A style voters rate as well as the pool keeps the usual floor.
  assert.ok(moreOfStyles(['vanilla'], ctx, { k: 30 }).every(p => p.record.rating >= 3.8));
});

test('nothing Discover suggests to David is a near dupe of what he owns', () => {
  const lists = [
    moreOfStyles(['skin', 'clean', 'intimate'], ctx, { k: 20 }),
    moreOfStyles(['skin', 'clean', 'intimate'], ctx, { mode: 'all', k: 20 }),
    moreOfStyles(['vanilla', 'amber'], ctx, { k: 20 }),
    moreLike([owned('Liquid Brun'), owned('Amber Empire')], ctx, { k: 20 }),
    moreLike([owned('Cream Velvet')], ctx, { k: 20 }),
    moreLike([at(9828)], ctx, { k: 20 }), // Aventus, which his Supremacy is family of
  ];
  for (const p of lists.flat()) {
    const dupe = kinOf(p);
    assert.ok(!dupe || dupe.kind === 'family', `${p.record.name}: ${dupe?.text}`);
    assert.ok(vecs.every(v => similarity(p.record, v.vector) <= 0.9), `${p.record.name} is a near twin`);
    assert.ok(!ctx.allowed.owned.has(p.id));
  }
  // Althaïr's clones stay out of "more like Liquid Brun".
  assert.ok(!names(lists[3]).some(n => /Althaïr|Island Vanilla Dunes|Liquid Brun/.test(n)), names(lists[3]).join());
  // "More like" any one of his bottles gives new bottles, not ones voters say smell like what he owns.
  const kin = wardrobe.flatMap(f => moreLike([f], ctx, { k: 10 }).map((p, i) => ({ p, i, seed: f.name }))).filter(({ p }) => kinOf(p));
  assert.ok(kin.length <= 3 && kin.every(({ i }) => i >= 3), kin.map(({ p, i, seed }) => `${seed}: #${i + 1} ${p.record.name}`).join('; '));
  assert.ok(!names(moreLike([owned('Sauvage')], ctx, { k: 10 })).some(n => /Salvo|Odyssey Tyrant|Al Qiam/.test(n)));
  // Notes search drops twins and versions of his bottles too, unless owned bottles are asked for.
  for (const query of ['lavender vanilla', 'vanilla', 'white musk', 'leather']) {
    for (const p of searchNotes(query, ctx, {}, { k: 30 }).results) {
      assert.ok(!kinOf(p) || kinOf(p).kind === 'family', `${query}: ${p.record.name}: ${kinOf(p)?.text}`);
      assert.ok(vecs.every(v => similarity(p.record, v.vector) <= 0.9), `${query}: ${p.record.name} is a near twin`);
    }
  }
  const all = searchNotes('lavender vanilla', ctx, { excludeOwned: false }, { k: 40 }).results;
  assert.ok(all.some(p => p.record.name === 'Dusk' && /twin of your Détour Noir/.test(p.family)), names(all).join());
});

test('any of several styles takes turns, Intimate shapes them, and all of them wants each', () => {
  const any = moreOfStyles(['skin', 'clean', 'intimate'], ctx, { k: 12 });
  const via = id => any.filter(p => p.via === id).length;
  assert.ok(via('skin') >= 4 && via('clean') >= 4, any.map(p => p.via).join());
  assert.ok(any.every(p => p.styles.some(s => s.id === p.via)), 'each shows the style it’s here for');
  assert.ok(any.filter(p => p.close).length >= 10, 'and most wear close');
  // Intimate alone is every quiet bottle.
  assert.ok(moreOfStyles(['intimate'], ctx, { k: 10 }).every(p => p.close && p.via === 'intimate'));
  const all = moreOfStyles(['skin', 'clean', 'intimate'], ctx, { mode: 'all', k: 12 });
  for (const p of all) {
    const s = scoresOf(p.record, ctx);
    assert.ok(s.skin >= 0.55 && s.clean >= 0.55 && s.intimate >= 0.6, p.record.name);
  }
  assert.ok(names(all).includes('Fleur de Peau Eau de Parfum'), names(all).join());
  // Every pick's card shows each chosen style (Intimate as its wears-close tag);
  // when too few bottles are all of them, the ones leaning toward a style follow, saying so.
  for (const chosen of [['skin', 'clean', 'intimate'], ['skin', 'clean'], ['oud', 'aquatic'], ['leather', 'oud', 'woody', 'amber']]) {
    const picks = moreOfStyles(chosen, ctx, { mode: 'all', k: 10 });
    assert.ok(picks.length, chosen.join());
    for (const p of picks) {
      for (const id of chosen) {
        if (id === 'intimate') assert.ok(p.close, `${p.record.name} wears close`);
        else assert.ok(p.styles.some(s => s.id === id), `${chosen.join()}: ${p.record.name} shows ${id}: ${p.styles.map(s => s.label)}`);
      }
      assert.deepEqual(p.styles.filter(s => s.leans).map(s => s.id), p.leans ?? []);
      for (const s of p.styles.filter(s => s.leans)) assert.match(s.label, /^Leans [a-z]/);
    }
    assert.ok(picks.findIndex(p => p.leans) === -1 || picks.slice(picks.findIndex(p => p.leans)).every(p => p.leans), 'leaning picks follow');
  }
  const oudAquatic = moreOfStyles(['oud', 'aquatic'], ctx, { mode: 'all', k: 10 });
  assert.ok(oudAquatic.some(p => !p.leans) && oudAquatic.some(p => p.leans), names(oudAquatic).join());
  assert.throws(() => moreOfStyles(['skin'], ctx, { mode: 'most' }), /any or all/);
});

test('more like keeps to its seeds\' leans, not the whole wardrobe\'s', () => {
  const lean = p => genderLean(p.record, ctx.byId);
  const aventus = moreLike([at(9828)], ctx, { k: 20 });
  assert.equal(aventus.length, 20);
  assert.ok(aventus.every(p => lean(p) >= 0), aventus.filter(p => lean(p) < 0).map(p => `${p.record.name} ${lean(p)}`).join(', '));
  const belle = ctx.records.find(r => r.name === 'La Vie Est Belle' && r.brand === 'Lancôme');
  const picks = moreLike([belle], ctx, { k: 20 });
  assert.ok(picks.length === 20 && picks.every(p => lean(p) <= 0), picks.filter(p => lean(p) > 0).map(p => `${p.record.name} ${lean(p)}`).join(', '));
  // Seeds either side span both; a lean filter overrides them.
  const both = moreLike([at(9828), belle], ctx, { k: 30 });
  assert.ok(both.some(p => lean(p) < -0.25) && both.some(p => lean(p) > 0.25));
  assert.ok(moreLike([at(9828)], ctx, { k: 10, filters: { lean: 'feminine' } }).every(p => lean(p) <= -0.25));
});

test('more like Liquid Brun and Amber Empire is warm vanilla and amber', () => {
  const picks = moreLike([owned('Liquid Brun'), owned('Amber Empire')], ctx, { k: 10 });
  assert.equal(picks.length, 10);
  for (const p of picks) {
    const s = scoresOf(p.record, ctx), warm = Math.max(s.vanilla, s.amber, s.gourmand);
    assert.ok(warm >= 0.5, `${p.record.name}: ${JSON.stringify(topOf(s))}`);
    assert.ok(p.sim >= 0.5 && p.shares.length, p.record.name);
    assert.ok(p.shares.some(t => /vanilla|amber|warm spicy|sweet/.test(t)), `${p.record.name}: ${p.shares}`);
  }
  // "Fans also like" only lifts: without it the same bottles qualify.
  const plain = moreLike([owned('Liquid Brun'), owned('Amber Empire')], ctx, { k: 10, alsoLiked: 0 });
  assert.ok(picks.filter(p => p.alsoLiked).length >= 1);
  assert.ok(plain.every(p => p.score <= picks[0].score + 1e-9));
  // A seed without accords (a dupe's built original) stands in as its pool row; one with nothing to go on gives nothing.
  const althair = moreLike([owned('Liquid Brun').original], ctx, { k: 5 });
  assert.ok(althair.length === 5 && althair.every(p => p.sim >= 0.5), althair.map(p => `${p.record.name} ${p.sim}`).join());
  assert.deepEqual(moreLike([{ id: 'my:x', name: 'Nothing', brand: 'Me', accords: {} }], ctx), []);
});

test('a hand-entered seed counts as much as a dataset one beside it', () => {
  const garden = customRecord({ name: 'Night Garden', brand: 'Me', accords: ['rose', 'oud', 'amber'] });
  const picks = moreLike([ctx.byId.get('9828'), garden], ctx, { k: 8 }); // Aventus
  const hers = picks.filter(p => ['rose', 'oud', 'amber'].some(a => Object.keys(p.record.accords).slice(0, 2).includes(a)));
  assert.ok(hers.length >= 4, picks.map(p => p.record.name).join(', '));
  // Alone, each still gets its own kind.
  assert.ok(moreLike([garden], ctx, { k: 5 }).every(p => p.record.accords.oud || p.record.accords.rose));
});

test('default seeds: the most worn of the last 60 days, else the best rated', () => {
  const history = [
    { id: '94713', date: '2026-10-10', slot: 'night' }, { id: '94713', date: '2026-10-02', slot: 'night' },
    { id: String(owned('Cedrus Blanc').id), date: '2026-10-09', slot: 'day' }, { id: '31861', date: '2026-01-01', slot: 'day' },
  ];
  const worn = defaultSeeds(wardrobe, { history, todayISO: '2026-10-13' });
  assert.equal(worn.from, 'worn');
  assert.deepEqual(worn.seeds.map(f => f.name), ['Liquid Brun', 'Cedrus Blanc'], 'Sauvage was worn too long ago');
  const rated = defaultSeeds(wardrobe);
  assert.equal(rated.from, 'rated');
  assert.equal(rated.seeds.length, 3);
  assert.ok(rated.seeds.every(f => f.rating >= 4.3));
  // Your own stars come first, and a bottle you dislike is never a seed, by wears either.
  const skin = { [rated.seeds[0].id]: { rating: 1 }, [rated.seeds[1].id]: { rating: 2 }, [owned('Infini Rose').id]: { rating: 5 } };
  const mine = applySkin(wardrobe, skin);
  const yours = defaultSeeds(mine);
  assert.equal(yours.seeds[0].name, 'Infini Rose');
  assert.ok(yours.seeds.every(f => !(f.personal?.rating <= 2)), yours.seeds.map(f => f.name).join());
  const disliked = defaultSeeds(applySkin(wardrobe, { 94713: { rating: 1 } }), { history, todayISO: '2026-10-13' });
  assert.deepEqual(disliked.seeds.map(f => f.name), ['Cedrus Blanc']);
});

test('notes and accords search: every term, forgiving how it’s typed', () => {
  const { terms, results } = searchNotes('iris leather', ctx, {}, { k: 15 });
  assert.deepEqual(terms, ['iris', 'leather']);
  assert.equal(results.length, 15);
  for (const p of results) {
    const has = re => Object.keys(p.record.accords).some(a => re.test(a)) || Object.values(p.record.notes).flat().some(n => re.test(n));
    assert.ok(has(/iris|orris/i) && has(/leather|suede/i), p.record.name);
    assert.deepEqual(p.matched.map(m => m.term), ['iris', 'leather']);
  }
  assert.ok(names(results).includes('Dior Homme Parfum'), names(results).join());
  const set = q => parseNotes(q, ctx).terms.map(t => [t.text, [...t.accords].sort(), [...t.notes].sort()]);
  const same = (a, b) => assert.deepEqual(set(a).map(t => t.slice(1)), set(b).map(t => t.slice(1)), `${a} / ${b}`);
  same('Irises & LEATHER', 'iris leather');
  same('oud', 'agarwood');
  same('vanille', 'vanilla');
  same('smoke', 'smoky');
  same('smokey', 'smoky');
  same('oudh', 'agarwood');
  same('tabac', 'tobacco');
  same('cuir', 'leather');
  same('whiskey', 'whisky');
  assert.deepEqual(set('sandal wood').map(t => t[0]), ['sandal wood']);
  assert.ok(set('sandal wood')[0][2].includes('Sandalwood'));
  assert.ok(set('tonka')[0][2].includes('Tonka Bean'));
  // A typo that names nothing reads as the name it's nearest, and says so.
  for (const [typo, meant] of [['lavendar', 'lavender'], ['sandlewood', 'sandalwood'], ['tobaco', 'tobacco']]) {
    const read = parseNotes(`${typo} musk`, ctx);
    assert.deepEqual([read.unknown, read.corrected], [[], [{ from: typo, to: meant }]], typo);
    same(typo, meant);
  }
  // A four-letter word that names nothing reads through a swap of two neighbours.
  for (const [typo, meant] of [['irsi', 'iris'], ['msuk', 'musk'], ['rsoe', 'rose']]) {
    const read = parseNotes(`${typo} leather`, ctx);
    assert.deepEqual([read.unknown, read.corrected], [[], [{ from: typo, to: meant }]], typo);
    same(typo, meant);
  }
  assert.equal(searchNotes('irsi leather', ctx, {}, { k: 5 }).results.length, 5);
  // Only a swap, only in a word that names nothing: real four-letter names stay, and other slips don't guess.
  for (const word of ['rose', 'musk', 'lime', 'pear', 'wood']) assert.deepEqual(parseNotes(word, ctx).corrected, [], word);
  for (const word of ['irus', 'muks', 'qzxw']) assert.deepEqual([parseNotes(word, ctx).corrected, parseNotes(word, ctx).unknown], [[], [word]], word);
  // One that names a rare note stays as typed, with the common name as a suggestion: "vanila" is a misspelt note.
  assert.deepEqual(searchNotes('vanila', ctx).suggested, [{ from: 'vanila', to: 'vanilla' }]);
  assert.deepEqual(parseNotes('vanilla', ctx).suggested, []);
  assert.deepEqual(set('lily of the valley').map(t => t[0]), ['lily of the valley'], 'a note’s whole name is one term');
  assert.deepEqual(set('tonka bean and white musk').map(t => t[0]), ['tonka bean', 'white musk']);
  const fig = searchNotes('figs', ctx, {}, { k: 10 }).results;
  assert.ok(fig.length === 10 && fig.every(p => p.matched[0].name.includes('fig')), names(fig).join());
  const none = searchNotes('iris xyzzy', ctx);
  assert.deepEqual([none.unknown, none.results], [['xyzzy'], []]);
  assert.deepEqual(searchNotes('and the notes', ctx).terms, []);
});

test('asking for no picks gives none', () => {
  assert.deepEqual(moreOfStyles(['skin'], ctx, { k: 0 }), []);
  assert.deepEqual(moreOfStyles(['skin', 'clean'], ctx, { k: -1 }), []);
  assert.deepEqual(moreLike([owned('Liquid Brun')], ctx, { k: 0 }), []);
  assert.deepEqual(searchNotes('rose', ctx, {}, { k: 0 }).results, []);
});

test('filters hold', () => {
  const ask = filters => searchNotes('vanilla', ctx, filters, { k: 25 }).results;
  // Filters read the shares as rank() does (steadyShares).
  const season = p => steadyShares(p.record).season, night = p => steadyShares(p.record).dayNight.night;
  for (const p of ask({ seasons: ['winter'] })) {
    const s = season(p), best = Math.max(...Object.values(s));
    assert.ok(s.winter >= 0.8 * best, p.record.name);
  }
  for (const p of ask({ seasons: ['summer'] })) assert.ok(season(p).summer >= 0.8 * Math.max(...Object.values(season(p))), p.record.name);
  for (const p of ask({ slot: 'night' })) assert.ok(night(p) >= 0.45, p.record.name);
  for (const p of ask({ slot: 'day' })) assert.ok(night(p) < 0.45, p.record.name);
  for (const lean of Object.keys(LEAN_WINDOWS)) {
    const [lo, hi] = LEAN_WINDOWS[lean];
    for (const p of ask({ lean })) assert.ok(genderLean(p.record) >= lo && genderLean(p.record) <= hi, `${lean}: ${p.record.name}`);
  }
  for (const p of ask({ minValue: 4 })) assert.ok(p.value >= 4, p.record.name);
  for (const p of ask({ minSafe: 80 })) assert.ok(signalsOf(p.record).safe >= 80, p.record.name);
  for (const p of ask({ minLongevity: 8, minSillage: 7.5 })) {
    const perf = performanceRating(p.record);
    assert.ok(perf.longevity >= 8 && perf.sillage >= 7.5, p.record.name);
  }
  assert.ok(ask({ hideDiscontinued: false, minRating: 0 }).length === 25);
  // Owned bottles come back only when asked for.
  const mine = searchNotes('bourbon vanilla praline', ctx, { excludeOwned: false }, { k: 50 }).results;
  assert.ok(names(mine).includes('Liquid Brun'), names(mine).join());
  assert.ok(!names(searchNotes('bourbon vanilla praline', ctx, {}, { k: 50 }).results).includes('Liquid Brun'));
  assert.throws(() => searchNotes('vanilla', ctx, { lean: 'manly' }), /feminine, unisex or masculine/);
  assert.throws(() => searchNotes('vanilla', ctx, { seasons: ['monsoon'] }), /Season/);
  // Style and example queries take the same filters.
  for (const p of moreOfStyles(['skin'], ctx, { k: 10, filters: { lean: 'masculine' } })) assert.ok(genderLean(p.record) >= 0.25);
  for (const p of moreLike([owned('Liquid Brun')], ctx, { k: 10, filters: { slot: 'day' } })) assert.ok(night(p) < 0.45);
});

test('body mists come up only when asked for', () => {
  const isMist = p => p.record.extras.flags.includes('mist');
  const lists = filters => [
    moreOfStyles(['vanilla', 'gourmand'], ctx, { k: 40, filters }), moreLike([owned('Cream Velvet')], ctx, { k: 40, filters }),
    searchNotes('vanilla musk', ctx, filters, { k: 40 }).results, searchNotes('strawberry', ctx, filters, { k: 40 }).results,
  ].flat();
  assert.ok(!lists({}).some(isMist), lists({}).filter(isMist).map(p => p.record.name).join());
  assert.ok(lists({ mists: true }).some(isMist), 'they’re in the pool');
});

test('the dupe explorer: originals, cheaper alternatives and smell-alikes', async () => {
  const withAbout = async r => ({ ...r, about: await loadAbout(r.id, load) });
  const aventus = dupesOf(await withAbout(at(9828)), ctx);
  assert.equal(aventus.original, null);
  // Cheaper alternatives, most agreed and alike first: the famous clone leads.
  assert.equal(aventus.cheaper[0].name, 'Club de Nuit Intense Man');
  assert.ok(aventus.cheaper[0].value > 4 && aventus.cheaper[0].sim > 0.7 && aventus.cheaper[0].up > 5000 && aventus.cheaper[0].risk.level);
  assert.ok(aventus.cheaper.length >= 8 && aventus.cheaper.every(c => c.brand !== 'Creed' && c.value >= 2.7), aventus.cheaper.map(c => c.name).join());
  const ids = [aventus.cheaper, aventus.siblings].flat().map(e => e.id);
  assert.equal(new Set(ids).size, ids.length, 'each bottle in one list');
  // Voted links that share nothing by notes come last and say so; bottles alike by notes that no vote links join in.
  const br540 = dupesOf(await withAbout(at(33519)), ctx);
  assert.ok(br540.cheaper[0].sim > 0.9, br540.cheaper[0].name);
  assert.ok(br540.cheaper.at(-1).notesDiffer, br540.cheaper.at(-1).name);
  const angels = dupesOf(await withAbout(at(62615)), ctx);
  assert.ok(angels.cheaper.some(e => e.name === 'Khamrah' && e.why === 'notes' && e.sim >= 0.75), angels.cheaper.map(e => e.name).join());
  // Siblings need agreeing votes: none from a handful.
  const cedrus = dupesOf(owned('Cedrus Blanc'), ctx);
  assert.ok(cedrus.siblings.every(e => e.up == null || (e.up - e.down >= 5 && e.up >= 2 * e.down)), cedrus.siblings.map(e => `${e.name} ${e.up}/${e.down}`).join());
  // A dupe David owns: its original and the bottles voters link with them.
  const brun = dupesOf(owned('Liquid Brun'), ctx);
  assert.equal(brun.original.name, 'Althaïr');
  assert.ok(brun.original.built && brun.original.sim > 0.9);
  assert.ok(brun.siblings.length >= 3 && brun.siblings[0].up > 0, brun.siblings.map(s => s.name).join());
  // A clone from the pool: its original from the votes.
  const cdnim = dupesOf(at(34696), ctx);
  assert.equal(cdnim.original?.name, 'Aventus');
  assert.equal(cdnim.original.built, false);
  // An original David owns: its cheaper clones.
  const sauvage = dupesOf(owned('Sauvage'), ctx);
  assert.equal(sauvage.original, null);
  assert.ok(sauvage.cheaper.length >= 3 && sauvage.cheaper.every(c => c.brand !== 'Dior' && c.value >= 3.7), sauvage.cheaper.map(c => c.name).join());
  // Althaïr: David's own twin is its cheaper one.
  const althair = dupesOf(at(84109), ctx);
  assert.ok(althair.cheaper.some(e => e.name === 'Liquid Brun' && e.owned));
});

test('an original read from the votes needs a year and, through a plain link, a likeness', () => {
  assert.equal(originalFromVotes(at(91430), ctx)?.name, 'Missing Person', 'Without A Trace');
  assert.equal(originalFromVotes(at(65414), ctx)?.name, 'Ultra Male', '9pm');
  assert.equal(originalFromVotes(at(21623), ctx), null, 'Kalemat has no year');
  let plainLinks = 0;
  for (const r of ctx.records) {
    const o = originalFromVotes(r, ctx);
    if (o && !signalsOf(r).family.includes(o.id)) {
      plainLinks++;
      assert.ok(similarity(r, o) >= 0.3, `${r.name} -> ${o.name}`);
    }
  }
  assert.ok(plainLinks > 50);
});

test('every pick says why', async () => {
  const [skin] = moreOfStyles(['skin'], ctx, { k: 1 });
  assert.match(whyLine(skin), /Skin scent.*closest you own: /);
  // Its risk in brackets, one colon at most.
  const risky = { ...skin, risk: { level: 'medium', reasons: ['It divides people: more voters hate it than most.'] } };
  assert.match(whyLine(risky), /; medium risk \(it divides people: more voters hate it than most\)/);
  // A clone says what it copies, with the votes once its about data is in.
  const clone = moreOfStyles(['skin'], ctx, { k: 40 }).find(p => p.clonesOf);
  assert.ok(clone);
  assert.ok(whyLine(clone).includes(`voters say it smells like ${clone.clonesOf.name}`), whyLine(clone));
  addCloneVotes(clone, await loadAbout(clone.id, load));
  const votes = whyLine(clone).match(/smells like (.+?) \((\d+) to (\d+)\)/);
  assert.ok(votes && votes[1] === clone.clonesOf.name && Number(votes[2]) > Number(votes[3]), whyLine(clone));
  // An owned dupe's original is named as his bottle's, not as one he owns.
  const through = moreOfStyles(['skin', 'clean'], ctx, { k: 30 }).find(p => p.nearest?.through);
  assert.match(whyLine(through), /closest you own: [^;]+ \(through its original, /);
  const [like] = moreLike([owned('Cream Velvet')], ctx, { k: 1 });
  assert.match(whyLine(like), /^Shares .*vanilla/);
  const [note] = searchNotes('fig', ctx, {}, { k: 1 }).results;
  assert.match(whyLine(note), /^Fig/);
  for (const p of [skin, like, note]) {
    assert.ok(['low', 'medium', 'high', 'unknown'].includes(p.risk.level));
    assert.ok(p.nearest.name && p.nearest.traits.length && p.nearest.sim > 0);
    assert.doesNotMatch(whyLine(p), /\d+°|undefined|null/);
  }
});

test('each query takes under 50 ms on the loaded pool', () => {
  const queries = {
    'style any': () => moreOfStyles(['skin', 'clean', 'intimate'], ctx, { k: 12 }),
    'style all': () => moreOfStyles(['skin', 'clean', 'intimate'], ctx, { mode: 'all', k: 12 }),
    'more like': () => moreLike([owned('Liquid Brun'), owned('Amber Empire')], ctx, { k: 12 }),
    notes: () => searchNotes('smoky vanilla', ctx, {}, { k: 12 }),
    dupes: () => dupesOf(at(9828), ctx),
  };
  for (const run of Object.values(queries)) run(); // vectors, saliences and reverse links, once
  for (const [label, run] of Object.entries(queries)) {
    const times = [0, 1, 2].map(() => { const t = performance.now(); run(); return performance.now() - t; }).sort((a, b) => a - b);
    assert.ok(times[1] < 50, `${label}: ${times[1].toFixed(1)} ms`);
  }
});

test('the want list keeps ids, and whole records for bottles the dataset can’t reload', () => {
  const store = new Map();
  globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  assert.deepEqual(loadWants(), []);
  let wants = addWant([], at(48681), { note: 'Try at Nordstrom', added: '2026-10-01' });
  wants = addWant(wants, customRecord({ id: 'my:abc', name: 'Mine', brand: 'Me', accords: ['vanilla'] }));
  wants = addWant(wants, '9828');
  assert.deepEqual(wants.map(w => w.id), ['9828', 'my:abc', '48681']);
  assert.equal(wants[2].record, undefined, 'a dataset bottle keeps only its id');
  assert.equal(wants[1].record.name, 'Mine');
  assert.deepEqual(wantIdsToLoad(wants), ['9828', '48681']);
  // Adding again moves it up and keeps its date and note.
  wants = addWant(wants, at(48681));
  assert.deepEqual([wants[0].id, wants[0].added, wants[0].note], ['48681', '2026-10-01', 'Try at Nordstrom']);
  saveWants(wants);
  assert.deepEqual(loadWants(), wants);
  assert.ok(hasWant(loadWants(), 9828));
  wants = removeWant(wants, '9828');
  assert.ok(!hasWant(wants, '9828'));
  saveWants(wants);
  // setWant toggles and saves.
  setWant('9828');
  assert.ok(hasWant(loadWants(), '9828'));
  setWant('9828');
  assert.ok(!hasWant(loadWants(), '9828'));
  setWant(at(46885), true, { note: '  sample first  ' });
  assert.equal(loadWants()[0].note, 'sample first');
  store.set('scentcast.want', '{broken');
  assert.deepEqual(loadWants(), []);
  // A kept record without what ranking reads is dropped, and the bottle loads again by its id.
  store.set('scentcast.want', JSON.stringify([{ id: '69541', record: { id: '69541' } }, 'x', null, { record: { id: 'my:q', name: 'Q' } }]));
  assert.deepEqual(loadWants().map(w => [w.id, 'record' in w]), [['69541', false], ['my:q', false]]);
  assert.deepEqual(wantIdsToLoad(loadWants()), ['69541', 'my:q']);
});

beforeEach(() => { delete globalThis.localStorage; });

test('the CLI answers Discover questions', () => {
  const script = fileURLToPath(new URL('../scripts/recommend.mjs', import.meta.url));
  const cli = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  const style = JSON.parse(cli('--style', 'skin scent,clean', '--all', '--top', '5', '--json').stdout);
  assert.deepEqual([style.styles, style.mode, style.results.length], [['skin', 'clean'], 'all', 5]);
  assert.ok(style.results.every(r => (r.styles.includes('Skin scent') || r.styles.includes('Clean')) && r.why));
  assert.ok(style.results.every(r => Array.isArray(r.twins) && 'smellsLike' in r));
  const notes = JSON.parse(cli('--notes', 'iris leather', '--season', 'winter', '--slot', 'night', '--lean', 'masculine', '--min-value', '3', '--json').stdout);
  assert.equal(notes.results.length, 10);
  assert.ok(notes.results.every(r => r.value >= 3 && r.matched.length === 2));
  assert.match(cli('--notes', 'vanila', '--top', '2').stderr, /did you mean "vanilla"/);
  assert.match(cli('--notes', 'lavendar', '--top', '2').stderr, /Reading "lavendar" as "lavender"/);
  assert.match(cli('--style', 'skin', '--top', '3', '--min-rating', '4.2', '--json').stdout, /"rating": 4\.[2-9]/);
  const like = cli('--more-like', 'Liquid Brun,Amber Empire', '--top', '3');
  assert.match(like.stdout, /^More like Liquid Brun \+ Amber Empire:\n 1\. .+ · .+ · \d{4} · \d\.\d\d★ · value \d\.\d · Shares /);
  const dupes = cli('--dupes', 'Aventus');
  assert.match(dupes.stdout, /Smells like it for far less:\n {2}Club de Nuit Intense Man · Armaf/);
  const bad = cli('--style', 'wet dog');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /No style called "wet dog"/);
  assert.match(cli('--notes', 'iris', '--lean', 'manly').stderr, /--lean takes feminine, unisex, masculine/);
  // Nothing to ask about fails plainly rather than printing an empty list.
  assert.match(cli('--style', 'skin', '--top', '0').stderr, /--top takes 1 or more/);
  assert.match(cli('--notes', 'and').stderr, /Name a note or accord/);
  assert.match(cli('--style', ',').stderr, /Name a style/);
  assert.match(cli('--more-like', ',').stderr, /Name a bottle/);
  // "liked" falls back to the wardrobe's own mix when none of the loved styles is left.
  const liked = cli('--style', 'liked', '--top', '2', '--exclude', 'Sandalwood & Musk,Meant To Be Seen,Cedrus Blanc,Jake,Shiyaaka Sky');
  assert.match(liked.stdout, /^More \S/);
});
