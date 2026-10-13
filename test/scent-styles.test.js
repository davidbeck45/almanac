import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { ACCORDS } from '../src/accords.js';
import { customRecord } from '../src/custom.js';
import { fragranticaLibrary } from '../src/fragrantica.js';
import { STYLES, STYLE_MIN, WEARS_CLOSE, styleScores, topStyles, wearsClose, styleMix } from '../src/scent-styles.js';

const dir = new URL('../data/fragrantica/', import.meta.url);
const library = fragranticaLibrary(async path => {
  const file = new URL(path, dir);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
});
const wardrobe = JSON.parse(readFileSync(new URL('../data/collection.json', import.meta.url))).fragrances;
const SCENT = STYLES.filter(s => s.kind === 'scent').map(s => s.id);

// Canonical bottles per style (Fragrantica ids). The scores were tuned while
// looking at these, so they are in-sample.
const EXEMPLARS = {
  skin: [845, 46885, 10131, 10296, 72665, 48681],      // Molecule 01, Glossier You, Another 13, Not A Perfume, Missing Person, Fleur de Peau
  clean: [3024, 35233, 20542, 6686, 60105, 4854],       // Clean Warm Cotton, Warm Cotton Reserve, Lazy Sunday Morning, Blanche, Bubble Bath, Pure Grace
  intimate: [18, 144, 2797, 20, 83, 1795],              // Un Jardin sur le Nil, Thé Vert, L'Eau d'Hiver, Hiris, EA Green Tea, Infusion d'Iris
  citrus: [9420, 6065, 12192, 3256, 5585, 6327],        // Orange Sanguine, Eau d'Orange Verte, Neroli Portofino, 4711, Lime Basil & Mandarin, Bergamote 22
  aquatic: [410, 507, 721, 913, 153, 25529],            // Acqua di Gio, Cool Water, L'Eau d'Issey PH, Nautica Voyage, Aqva PH, Wood Sage & Sea Salt
  green: [12345, 3820, 1003, 11502, 3865, 4608],        // No 19 EDP, Vent Vert, Eau de Campagne, Jardin sur le Toit, Philosykos, Grey Flannel
  aromatic: [829, 2069, 10891, 38206, 59064, 258],      // Azzaro PH, Drakkar Noir, Fougère Royale, Brut, Beau de Jour, Eternity for Men
  gourmand: [704, 14982, 12426, 4322, 50384, 64757],    // Angel, La Vie Est Belle, Prada Candy, Love Don't Be Shy, Cloud, Bianco Latte
  vanilla: [3345, 4346, 56836, 4064, 52616, 48029],     // Spiritueuse Double Vanille, Tihota, Bare Vanilla, Vanille Absolu, Vanilla 28, Vanille Fatale
  amber: [2760, 40816, 1821, 6968, 42055, 93],          // Ambre Sultan, Grand Soir, Amber Absolute, Ambra Aurea, Noir Ambré, Opium
  oud: [1826, 30352, 1142, 53641, 15231, 8070],         // Oud Wood, Oud Satin Mood, Black Aoud, Oud for Greatness, Oud Ispahan, Rose Oud
  leather: [1849, 50239, 7144, 7913, 15, 228],          // Tuscan Leather, Ombré Leather, Cuir de Russie, Knize Ten, Bandit, Fahrenheit
  tobacco: [1825, 16939, 6457, 32091, 46663, 20541],    // Tobacco Vanille, Herod, Back to Black, Tabac Tabou, Red Tobacco, Jazz Club
  incense: [1230, 7844, 15294, 4572, 1231, 6472],       // Avignon, Cardinal, Interlude Man, Passage d'Enfer, Zagorsk, Black Afgano
  whiteFloral: [2299, 44894, 707, 1024, 5200, 210],     // Fracas, Gucci Bloom, Alien, Carnal Flower, Tubéreuse Criminelle, J'adore
  rose: [10464, 3678, 14214, 1715, 58781, 43871],       // Portrait of a Lady, Rose 31, Eau Rose, Lady Vengeance, Rose Prick, Delina
  floral: [18767, 2793, 536, 1733, 5226, 23280],        // Peony & Blush Suede, En Passant, Pleasures, Chloé EDP, Flora by Gucci, Miss Dior Blooming Bouquet
  powdery: [13016, 4771, 7131, 13, 1281, 5079],         // Dior Homme Intense, Iris Poudre, 28 La Pausa, Après l'Ondée, Iris Silver Mist, Teint de Neige
  woody: [12201, 1834, 69, 3956, 2558, 8991],           // Santal 33, Encre Noire, Guerlain Vetiver, Tam Dao, Hinoki, Wonderwood
  spicy: [13857, 613, 2764, 2671, 307, 93],             // Spicebomb, Égoïste, Five O'Clock au Gingembre, Poivre Samarcande, Déclaration, Opium
  fruity: [147, 9828, 10314, 498, 10190, 8069],         // Nina, Aventus, English Pear & Freesia, Be Delicious, Bombshell, Chance Eau Tendre
  chypre: [207, 371, 113, 7150, 28, 1009],              // Mitsouko, Aromatics Elixir, Aramis, 31 Rue Cambon, Femme Rochas, Paloma Picasso
  boozy: [62615, 71272, 4323, 20541, 74243, 69978],     // Angels' Share, Gentleman Réserve Privée, Straight to Heaven, Jazz Club, Van Py Rhum, Plum in Cognac
};

// Picked after tuning and never tuned on.
const HOLDOUT = {
  skin: [3606, 62377, 16603],          // Molecule 02, Musc Invisible, Clean Skin
  clean: [39029, 103743, 23032],       // Prada L'Homme, Blanche Absolu, Clean Cool Cotton
  intimate: [46885, 72040, 10296],     // Glossier You, Philosykos EDT, Not A Perfume
  citrus: [1681, 231, 72439],          // Acqua di Parma Colonia, Eau Sauvage, Terre d'Hermès Eau Givrée
  aquatic: [44035, 1742, 88818],       // Light Blue Eau Intense PH, Aqva Marine, Oud Minérale
  green: [12424, 18, 83],              // No 19 Poudre, Jardin sur le Nil, EA Green Tea
  aromatic: [10559, 2539, 526],        // Sartorial, YSL Jazz, Paco Rabanne Pour Homme
  gourmand: [25324, 975, 51411],       // Black Opium, Pink Sugar, Lost Cherry
  vanilla: [54878, 53, 15210],         // Vanilla Vibes, Shalimar EDP, Roses Vanille
  amber: [2669, 4493, 7145],           // Ambre Narguilé, Ambre 114, Coromandel
  oud: [55998, 3755, 1143],            // Acqua di Parma Oud, Aoud Lime, Aoud Cuir d'Arabie
  leather: [1019, 27417, 25],          // Cuir Béluga, Dior Homme Parfum, Bel Ami
  tobacco: [21402, 11444, 30499],      // Tobacco Oud, A*Men Pure Havane, Spicebomb Extreme
  incense: [10145, 1232, 406],         // Memoir Man, Kyoto, Bois d'Encens
  whiteFloral: [224, 936, 12765],      // Diorissimo, Gardénia, Jasmin Rouge
  rose: [83771, 21982, 18702],         // Café Rose, Une Rose de Kandahar, Roses de Chloé
  floral: [1361, 152, 536],            // Daisy, Omnia Crystalline, Pleasures
  powdery: [27417, 208, 11799],        // Dior Homme Parfum, L'Heure Bleue, Drôle de Rose
  woody: [4688, 17, 1006],             // Sycomore, Terre d'Hermès, Bois des Iles
  spicy: [66514, 25991, 16939],        // Spicebomb Infrared, Intoxicated, Herod
  fruity: [32172, 600, 51411],         // Kirkè, Fantasy, Lost Cherry
  chypre: [615, 15, 1002],             // Pour Monsieur, Bandit, Eau du Soir
  boozy: [75805, 74151, 4441],         // Khamrah, Wet Cherry Liquor, Fou d'Absinthe
};

// A scent style counts when it's among the bottle's two best scent styles;
// Intimate when the bottle wears close.
function hitRate(set, records) {
  let hits = 0, total = 0;
  const misses = [];
  for (const [style, ids] of Object.entries(set)) {
    for (const id of ids) {
      const record = records.get(String(id));
      assert.ok(record, `id ${id} is in the dataset`);
      const scores = styleScores(record);
      const hit = style === 'intimate' ? wearsClose(record)
        : SCENT.toSorted((a, b) => scores[b] - scores[a]).indexOf(style) < 2;
      total++;
      if (hit) hits++; else misses.push(`${record.name} (${style} ${scores[style]})`);
    }
  }
  return { rate: hits / total, misses };
}

const loadAll = async set => library.records([...new Set(Object.values(set).flat().map(String))]);

test('canonical bottles show their style', async () => {
  const { rate, misses } = hitRate(EXEMPLARS, await loadAll(EXEMPLARS));
  assert.ok(rate >= 0.9, `top-2 rate ${rate.toFixed(3)}; misses: ${misses.join(', ')}`);
});

test('held-out bottles show their style', async () => {
  const { rate, misses } = hitRate(HOLDOUT, await loadAll(HOLDOUT));
  assert.ok(rate >= 0.8, `top-2 rate ${rate.toFixed(3)}; misses: ${misses.join(', ')}`);
});

test('the wardrobe reads as David knows it', () => {
  const byName = name => wardrobe.find(f => f.name === name);
  const top = name => topStyles(byName(name), 2, 0).map(s => s.id);
  assert.equal(top('Cedrus Blanc')[0], 'clean');
  assert.ok(top('Sandalwood & Musk').includes('skin'), top('Sandalwood & Musk').join(', '));
  assert.ok(wearsClose(byName('Jake')));
  assert.equal(top('Cream Velvet')[0], 'vanilla');
  assert.equal(top('Atlantis Extrait')[0], 'aquatic');
  assert.equal(top('Infini Rose')[0], 'rose');
  assert.ok(!wearsClose(byName('Liquid Brun')), 'a loud gourmand is not intimate');
});

test('every accord the engine knows sits in some style', () => {
  const named = new Set(STYLES.flatMap(s => [...Object.keys(s.acc ?? {}), ...Object.keys(s.against ?? {})]));
  assert.deepEqual(Object.keys(ACCORDS).filter(a => !named.has(a)), [],
    'add these to a style\'s acc (it is that style) or against (it pulls away from one) in src/scent-styles.js');
  assert.deepEqual([...named].filter(a => !ACCORDS[a]), [], 'style tables name accords src/accords.js lacks');
});

test('scores are 0..1 for every style, top styles are scent styles from the threshold', () => {
  for (const f of wardrobe) {
    const scores = styleScores(f);
    assert.deepEqual(Object.keys(scores), STYLES.map(s => s.id));
    for (const v of Object.values(scores)) assert.ok(v >= 0 && v <= 1, `${f.name}: ${v}`);
    const top = topStyles(f);
    assert.ok(top.length <= 3);
    for (const s of top) assert.ok(SCENT.includes(s.id) && s.score >= STYLE_MIN, `${f.name}: ${s.id}`);
  }
});

test('a hand-entered bottle gets styles from its accords alone and never wears close', () => {
  const mine = customRecord({ name: 'My musk', accords: ['musky', 'powdery', 'woody'] });
  assert.equal(topStyles(mine)[0].id, 'skin');
  assert.ok(styleScores(mine).intimate < WEARS_CLOSE);
  assert.ok(!wearsClose(mine));
  assert.deepEqual(topStyles({ name: 'Empty', accords: {}, notes: {} }), []);
});

test('the style mix counts each bottle\'s top two and the close wearers', () => {
  const mix = styleMix(wardrobe);
  assert.equal(mix.total, wardrobe.length);
  assert.ok(Object.values(mix.counts).reduce((a, b) => a + b, 0) <= 2 * wardrobe.length);
  assert.ok(mix.counts.vanilla >= mix.counts.skin, 'the wardrobe leans warm and sweet');
  assert.ok(mix.ids.clean.includes(wardrobe.find(f => f.name === 'Cedrus Blanc').id));
  assert.equal(mix.intimate, mix.intimateIds.length);
  assert.ok(mix.intimateIds.includes(wardrobe.find(f => f.name === 'Jake').id));
});

test('scoring is fast enough to run over the dataset', async () => {
  const shards = Array.from({ length: 8 }, (_, i) => JSON.parse(readFileSync(new URL(`r/${i * 64}.json`, dir), 'utf8')));
  const ids = shards.flatMap(rows => Object.keys(rows));
  const records = [...(await library.records(ids)).values()];
  assert.ok(records.length > 1000);
  styleScores(records[0]);
  const start = performance.now();
  for (const r of records) styleScores(r);
  const perRecord = (performance.now() - start) / records.length;
  // About 10 µs in Node on a laptop; a generous bound for slow machines.
  assert.ok(perRecord < 0.1, `${(perRecord * 1000).toFixed(1)} µs per record`);
});
