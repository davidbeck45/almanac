import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadPool, loadPoolStyles, fromFragrantica, poolKey } from '../src/fragrantica.js';
import { STYLES, styleScores, topOf, closeOf } from '../src/scent-styles.js';
import { genderLean, signalsOf, ownedVectors } from '../src/candidates.js';
import { similarity } from '../src/similar.js';
import { performanceRating } from '../src/engine.js';
import {
  DEMO_LIKED, LEAN_WINDOWS, discoverContext, scoresOf, findStyles, likedStyles, moreOfStyles, defaultSeeds, moreLike,
  parseNotes, searchNotes, dupesOf, whyLine,
} from '../src/discover.js';
import { loadWants, saveWants, addWant, removeWant, hasWant, setWant, wantIdsToLoad } from '../src/wishlist.js';
import { MIN, packScores } from '../scripts/fit-pool-styles.mjs';

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

test('the pool’s stored style scores are the live ones', () => {
  assert.ok(styles, 'pool-styles.json loads for this pool (else run `node scripts/fit-pool-styles.mjs --write`)');
  assert.equal(styles.key, poolKey(pool));
  assert.deepEqual(styles.styles, STYLES.map(s => s.id), 'run `node scripts/fit-pool-styles.mjs --write`');
  // Every pool bottle in an eighth of r/, scored on its full row as the script does.
  const rows = Object.assign({}, ...Array.from({ length: 64 }, (_, n) => JSON.parse(readFileSync(new URL(`r/${n * 8}.json`, dir), 'utf8'))));
  let checked = 0;
  pool.cols.id.forEach((id, i) => {
    if (!rows[id]) return;
    assert.deepEqual(styles.s[i], packScores(styleScores(fromFragrantica(String(id), rows[id]))),
      `${rows[id].n}: stale, run \`node scripts/fit-pool-styles.mjs --write\``);
    checked++;
  });
  assert.ok(checked > 1000, `${checked} checked`);
  // Scores left out are under MIN.
  const fleur = scoresOf(at(48681), ctx);
  assert.ok(STYLES.every(s => fleur[s.id] === 0 || fleur[s.id] >= MIN / 100));
  assert.ok(fleur.skin >= 0.9 && closeOf(fleur));
});

test('without the stored file the pool is scored live, to the same chips', () => {
  const live = discoverContext(pool, wardrobe, { styles: { ...styles, styles: ['skin'] }, records: ctx.records });
  assert.equal(live.styles, null, 'a file listing other styles is set aside');
  const a = moreOfStyles(['clean'], ctx, { k: 10 }), b = moreOfStyles(['clean'], live, { k: 10 });
  assert.ok(a.filter(p => b.some(q => q.id === p.id)).length >= 7, `${names(a)} / ${names(b)}`);
});

test('styles read from typed text', () => {
  assert.deepEqual(findStyles('skin, Clean, INTIMATE').ids, ['skin', 'clean', 'intimate']);
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
  const found = picks.filter(p => canon.includes(p.id));
  assert.ok(found.length >= 7, `canon found: ${names(found)}`);
  for (const p of picks) {
    assert.ok(p.styles.some(s => s.id === 'skin'), `${p.record.name} shows Skin scent`);
    assert.ok(!ctx.allowed.owned.has(p.id) && !ctx.allowed.originals.has(p.id), p.record.name);
    assert.ok(!signalsOf(p.record).flags.includes('brigaded') && !signalsOf(p.record).flags.includes('discontinued'), p.record.name);
    assert.ok(p.record.rating >= 3.8, p.record.name);
  }
  for (let i = 1; i < picks.length; i++) assert.ok(picks[i].score <= picks[i - 1].score);
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
    const dupe = ctx.family.dupeOf(p.record);
    assert.ok(!dupe || dupe.kind === 'family', `${p.record.name}: ${dupe?.text}`);
    assert.ok(vecs.every(v => similarity(p.record, v.vector) <= 0.9), `${p.record.name} is a near twin`);
    assert.ok(!ctx.allowed.owned.has(p.id));
  }
  // Althaïr's clones stay out of "more like Liquid Brun".
  assert.ok(!names(lists[3]).some(n => /Althaïr|Island Vanilla Dunes|Liquid Brun/.test(n)), names(lists[3]).join());
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
    assert.ok(s.skin >= 0.4 && s.clean >= 0.4 && s.intimate >= 0.4, p.record.name);
  }
  assert.ok(names(all).includes('Fleur de Peau Eau de Parfum'), names(all).join());
  assert.throws(() => moreOfStyles(['skin'], ctx, { mode: 'most' }), /any or all/);
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
  assert.ok(set('tonka')[0][2].includes('Tonka Bean'));
  assert.deepEqual(set('lily of the valley').map(t => t[0]), ['lily of the valley'], 'a note’s whole name is one term');
  assert.deepEqual(set('tonka bean and white musk').map(t => t[0]), ['tonka bean', 'white musk']);
  const fig = searchNotes('figs', ctx, {}, { k: 10 }).results;
  assert.ok(fig.length === 10 && fig.every(p => p.matched[0].name.includes('fig')), names(fig).join());
  const none = searchNotes('iris xyzzy', ctx);
  assert.deepEqual([none.unknown, none.results], [['xyzzy'], []]);
});

test('filters hold', () => {
  const ask = filters => searchNotes('vanilla', ctx, filters, { k: 25 }).results;
  for (const p of ask({ seasons: ['winter'] })) {
    const s = p.record.season, best = Math.max(...Object.values(s));
    assert.ok(s.winter >= 0.8 * best, p.record.name);
  }
  for (const p of ask({ seasons: ['summer'] })) assert.ok(p.record.season.summer >= 0.8 * Math.max(...Object.values(p.record.season)), p.record.name);
  for (const p of ask({ slot: 'night' })) assert.ok(p.record.dayNight.night >= 0.45, p.record.name);
  for (const p of ask({ slot: 'day' })) assert.ok(p.record.dayNight.night < 0.45, p.record.name);
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
  for (const p of moreLike([owned('Liquid Brun')], ctx, { k: 10, filters: { slot: 'day' } })) assert.ok(p.record.dayNight.night < 0.45);
});

test('the dupe explorer: originals, cheaper twins, clones and smell-alikes', () => {
  const aventus = dupesOf(at(9828), ctx);
  assert.equal(aventus.original, null);
  assert.equal(aventus.cheaper[0].name, 'Club de Nuit Intense Man');
  assert.ok(aventus.cheaper[0].value > 4 && aventus.cheaper[0].sim > 0.7 && aventus.cheaper[0].risk.level);
  assert.ok(aventus.clones.length >= 5 && aventus.clones.every(c => c.brand !== 'Creed' && c.value >= 2.7), aventus.clones.map(c => c.name).join());
  const ids = [aventus.cheaper, aventus.clones, aventus.siblings].flat().map(e => e.id);
  assert.equal(new Set(ids).size, ids.length, 'each bottle in one list');
  // A dupe David owns: its original and the other clones of it.
  const brun = dupesOf(owned('Liquid Brun'), ctx);
  assert.equal(brun.original.name, 'Althaïr');
  assert.ok(brun.original.built && brun.original.sim > 0.9);
  assert.deepEqual(brun.clones, []);
  assert.ok(brun.siblings.length >= 3 && brun.siblings[0].up > 0, brun.siblings.map(s => s.name).join());
  // A clone from the pool: its original from the votes.
  const cdnim = dupesOf(at(34696), ctx);
  assert.equal(cdnim.original?.name, 'Aventus');
  assert.equal(cdnim.original.built, false);
  // An original David owns: its cheaper clones.
  const sauvage = dupesOf(owned('Sauvage'), ctx);
  assert.equal(sauvage.original, null);
  assert.ok(sauvage.clones.length >= 3 && sauvage.clones.every(c => c.brand !== 'Dior' && c.value >= 3.7), sauvage.clones.map(c => c.name).join());
  // Althaïr: David's own twin is its cheaper one.
  const althair = dupesOf(at(84109), ctx);
  assert.ok(althair.cheaper.some(e => e.name === 'Liquid Brun' && e.owned));
});

test('every pick says why', () => {
  const [skin] = moreOfStyles(['skin'], ctx, { k: 1 });
  assert.match(whyLine(skin), /Skin scent.*closest you own: /);
  const [like] = moreLike([owned('Cream Velvet')], ctx, { k: 1 });
  assert.match(whyLine(like), /^Shares .*vanilla/);
  const [note] = searchNotes('fig', ctx, {}, { k: 1 }).results;
  assert.match(whyLine(note), /fig/);
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
  wants = addWant(wants, { id: 'my:abc', name: 'Mine', brand: 'Me', source: 'custom', accords: { vanilla: 80 } });
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
});

beforeEach(() => { delete globalThis.localStorage; });

test('the CLI answers Discover questions', () => {
  const script = fileURLToPath(new URL('../scripts/recommend.mjs', import.meta.url));
  const cli = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  const style = JSON.parse(cli('--style', 'skin scent,clean', '--all', '--top', '5', '--json').stdout);
  assert.deepEqual([style.styles, style.mode, style.results.length], [['skin', 'clean'], 'all', 5]);
  assert.ok(style.results.every(r => r.styles.includes('Skin scent') && r.styles.includes('Clean') && r.why));
  const notes = JSON.parse(cli('--notes', 'iris leather', '--season', 'winter', '--slot', 'night', '--lean', 'masculine', '--min-value', '3', '--json').stdout);
  assert.equal(notes.results.length, 10);
  assert.ok(notes.results.every(r => r.value >= 3 && r.matched.length === 2));
  const like = cli('--more-like', 'Liquid Brun,Amber Empire', '--top', '3');
  assert.match(like.stdout, /^More like Liquid Brun \+ Amber Empire:\n 1\. .+ · .+ · \d{4} · \d\.\d\d★ · value \d\.\d · Shares /);
  const dupes = cli('--dupes', 'Aventus');
  assert.match(dupes.stdout, /Smells like it for far less:\n {2}Club de Nuit Intense Man · Armaf/);
  const bad = cli('--style', 'wet dog');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /No style called "wet dog"/);
  assert.match(cli('--notes', 'iris', '--lean', 'manly').stderr, /--lean takes feminine, unisex, masculine/);
});
