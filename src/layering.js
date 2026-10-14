// Layering: which bottles in a collection pair well with a given one. Pure.
//
// Each bottle becomes a profile over accord families, from its accords
// (strength-weighted votes) and its notes (mapped to families by name, heart
// and base weighted over top since they last on skin, and each by how
// strongly voters smell it when the page has note votes). A pair scores on
// - complement: families that are known to work together (vanilla + woody,
//   rose + oud, citrus + amber), or clash (aquatic + caramel);
// - bridge: some overlap ties them together, but near-duplicates add little;
// - contrast: one heavier bottle to anchor, one lighter to lift.
// Reasons name the actual notes behind the best complement and bridge.
// Pairs Parfumo voters layer (`layeredWith`, from data/parfumo.jsonl, a dupe
// standing in for its original) score higher by the voters' consensus, less
// so the less the pair suits the weather (voters vouch for the pair, not for
// wearing it in a heat wave). That boost sits on top of the model, so it can
// break ties among pairs the model already rates perfect, and it doesn't
// count toward a partner's average.
// A partner that pairs with everything (a light citrus-woody) would top every
// list, so picks are scored against each partner's average pairing, like the
// engine's season "specialty".
// Given the weather, a blend that doesn't suit it is marked down: both
// bottles' season votes, and their average heaviness against what the weather
// calls for, so one heavy and one light bottle meet in the middle. A pair off
// for the weather lists after every pair that isn't.
// A note most of the collection shares (bergamot) doesn't count as a tie.
import { heaviness } from './accords.js';
import { targetSeasonWeights, seasonFit, targetHeaviness, isSticky } from './engine.js';

// First match wins, so specific names come before the words they contain
// ("orange blossom" before "orange", "bourbon vanilla" before "bourbon").
// A note that sits between families lists more than one, main family first;
// the rest count half as much (labdanum is a resin and the base of amber).
const NOTE_FAMILIES = [
  [/maltol/, 'sweet', 'caramel'],
  [/tonka/, 'vanilla', 'almond'],
  [/benzoin/, 'vanilla', 'balsamic'],
  [/vanill/, 'vanilla'],
  [/civet|castoreum|animalic|indol/, 'animalic'],
  [/oud|agarwood|kyara/, 'oud', 'woody'],
  [/praline/, 'caramel', 'nutty'],
  [/caramel|toffee|butterscotch|dulce/, 'caramel'],
  [/sugar cane/, 'sweet', 'green'],
  [/meringue|sugar|syrup|waffle|marshmallow|candy|cotton|biscuit|cookie|cake|pastry/, 'sweet'],
  [/honey|beeswax/, 'honey'],
  [/cacao|cocoa|chocolate|coffee|espresso/, 'cacao'],
  [/almond milk/, 'almond', 'lactonic'],
  [/almond|marzipan|cherry pit/, 'almond'],
  [/coconut milk|coconut cream/, 'coconut', 'lactonic'],
  [/coconut(?! water)/, 'coconut'],
  [/hazelnut|pistachio|peanut|sesame|chestnut|walnut|\bnuts?\b/, 'nutty'],
  [/milk|cream|rice|butter|lacton|yogurt|cheese/, 'lactonic'],
  [/tobacco/, 'tobacco'],
  [/whisk|bourbon|\brum\b|cognac|brandy|liquor|wine|champagne|beer/, 'whiskey'],
  [/leather|suede|birch/, 'leather'],
  [/labdanum|cistus/, 'balsamic', 'amber'],
  [/elemi/, 'balsamic', 'fresh spicy'],
  [/incense|olibanum|frankincense|myrrh|styrax|opoponax|palo santo|resin|copal|balsam|tolu|peru/, 'balsamic'],
  [/ambrox|ambergris|cetalox/, 'amber', 'woody', 'musky'],
  [/amberwood|moxalone/, 'amber', 'woody'],
  [/amber/, 'amber'],
  [/saffron/, 'warm spicy', 'leather'],
  [/immortelle/, 'warm spicy', 'honey'],
  [/oriental/, 'warm spicy', 'amber'],
  [/cinnamon|clove|nutmeg|cumin|anise|allspice|spicy notes|curry/, 'warm spicy'],
  [/mint/, 'herbal', 'fresh'],
  [/pink pepper/, 'fresh spicy', 'fruity'],
  [/cardamom/, 'fresh spicy', 'aromatic'],
  [/ginger(?! flower)/, 'fresh spicy', 'citrus'],
  [/pepper|coriander|timur|juniper/, 'fresh spicy'],
  [/lavender|lavandin/, 'lavender', 'aromatic'],
  [/iris|orris/, 'iris', 'powdery'],
  [/violet/, 'violet', 'powdery'],
  [/neroli/, 'white floral', 'citrus'],
  [/jasmin|tuberose|orange blossom|ylang|gardenia|frangipani|hedione|white flower|ginger flower|magnolia|lily/, 'white floral'],
  [/geranium/, 'rose', 'herbal'],
  [/\brose(?!mary|wood)/, 'rose'],
  [/heliotrope/, 'floral', 'powdery', 'almond'],
  [/peony|lilac|cyclamen|lotus|freesia|osmanthus|mimosa|flower|floral|blossom|petal/, 'floral'],
  [/white musk/, 'musky', 'powdery'],
  [/cashmeran/, 'musky', 'woody'],
  [/musk|ambrett|galaxolide|habanolide/, 'musky'],
  [/powder|aldehyde/, 'powdery'],
  [/mango|pineapple|passion|papaya|guava|lychee|litchi|banana|coconut water/, 'tropical'],
  [/grapefruit|bergamot|lemon|lime|orange|mandarin|tangerine|clementine|yuzu|pomelo|petitgrain|citrus|verbena|citron/, 'citrus'],
  [/fig lea|fig tree/, 'green'],
  [/\bfig/, 'fruity', 'lactonic'],
  [/pear|apple|peach|plum|berry|berries|currant|cherry|apricot|grape|melon|quince|pomegranate|rhubarb/, 'fruity'],
  [/mung bean|\begg|salted|savory|soy|umami/, 'savory'],
  [/sea|marine|aquatic|salt|water|calone|seaweed|algae/, 'aquatic'],
  [/ozon|steam|air|metallic|mineral/, 'ozonic'],
  [/green tea|matcha/, 'tea', 'green'],
  [/\btea\b|oolong|rooibos|\bchai\b|\bmate\b/, 'tea'],
  [/sage|clary/, 'herbal', 'aromatic'],
  [/basil|thyme|rosemary|artemisia|wormwood|herb|tarragon|bay leaf/, 'herbal'],
  [/moss/, 'mossy'],
  [/patchouli|vetiver/, 'earthy', 'woody'],
  [/mushroom|earth|dust|soil|truffle|beet/, 'earthy'],
  [/akigalawood/, 'woody', 'fresh spicy'],
  [/cashmere wood/, 'woody', 'musky'],
  [/sandal/, 'woody', 'lactonic'],
  [/guaiac/, 'woody', 'balsamic'],
  [/cedar|wood|oak|hinoki|sequoia|cypress|pine|cashmere|teak|ebony/, 'woody'],
  [/green|grass|leaf|leaves|galbanum|stem|tomato|ivy/, 'green'],
  [/paper|ink|pencil/, 'paper'],
];
const SECONDARY_SHARE = 0.5;
// Accords that layer like a family the rules already cover.
const FAMILY_ALIAS = {
  chocolate: 'cacao', coffee: 'cacao', cinnamon: 'warm spicy', patchouli: 'earthy', smoky: 'balsamic', rum: 'whiskey',
  cherry: 'fruity', tuberose: 'white floral', 'yellow floral': 'white floral', marine: 'aquatic', salty: 'aquatic',
  metallic: 'ozonic', aldehydic: 'powdery', soapy: 'musky',
  // Accords only bottles outside data/ carry (searched from the Fragrantica dataset).
  alcohol: 'whiskey', wine: 'whiskey', vodka: 'whiskey', Champagne: 'whiskey', beeswax: 'honey', gourmand: 'sweet',
  'coca-cola': 'sweet', conifer: 'woody', mineral: 'ozonic', sand: 'aquatic', anis: 'herbal', cannabis: 'green',
  bitter: 'green', camphor: 'herbal', sour: 'citrus',
};

// Families that work together (+) or fight (−), symmetric.
const PAIRS = [
  ['vanilla', 'woody', 0.9], ['vanilla', 'tobacco', 1], ['vanilla', 'lavender', 0.9],
  ['vanilla', 'fresh spicy', 0.7], ['vanilla', 'citrus', 0.6], ['vanilla', 'fruity', 0.7],
  ['vanilla', 'warm spicy', 0.7], ['vanilla', 'rose', 0.5], ['vanilla', 'oud', 0.7], ['vanilla', 'leather', 0.5],
  ['vanilla', 'musky', 0.5], ['vanilla', 'coconut', 0.6], ['vanilla', 'tropical', 0.5], ['vanilla', 'cacao', 0.7],
  ['vanilla', 'almond', 0.6], ['vanilla', 'nutty', 0.5], ['vanilla', 'whiskey', 0.7], ['vanilla', 'iris', 0.5],
  ['vanilla', 'powdery', 0.4], ['vanilla', 'amber', 0.5], ['vanilla', 'earthy', 0.5], ['vanilla', 'balsamic', 0.5],
  ['vanilla', 'lactonic', 0.6], ['vanilla', 'aromatic', 0.7], ['vanilla', 'white floral', 0.7],
  ['vanilla', 'floral', 0.5], ['vanilla', 'herbal', 0.5], ['vanilla', 'honey', 0.5], ['vanilla', 'fresh', 0.4],
  ['vanilla', 'green', 0.3], ['vanilla', 'mossy', 0.3], ['vanilla', 'sweet', 0], ['vanilla', 'savory', 0.6],
  ['vanilla', 'animalic', 0.5], ['vanilla', 'caramel', 0],
  ['sweet', 'woody', 0.6], ['sweet', 'citrus', 0.6], ['sweet', 'fresh spicy', 0.5], ['sweet', 'savory', 0.7],
  ['sweet', 'musky', 0.4], ['sweet', 'earthy', 0.5], ['sweet', 'herbal', 0.4], ['sweet', 'fruity', 0.3],
  ['sweet', 'warm spicy', 0.6], ['sweet', 'aromatic', 0.4], ['sweet', 'white floral', 0.4],
  ['sweet', 'balsamic', 0.4], ['sweet', 'lavender', 0.5], ['sweet', 'rose', 0.4], ['sweet', 'coconut', 0.4],
  ['sweet', 'lactonic', 0.3], ['sweet', 'iris', 0.3], ['sweet', 'oud', 0.4], ['sweet', 'tropical', 0.3],
  ['sweet', 'mossy', 0.2], ['sweet', 'honey', 0], ['sweet', 'powdery', 0.3], ['sweet', 'floral', 0.3],
  ['sweet', 'fresh', 0.3], ['sweet', 'amber', 0.2], ['sweet', 'green', 0.2],
  ['caramel', 'woody', 0.7], ['caramel', 'savory', 0.9], ['caramel', 'tobacco', 0.8], ['caramel', 'citrus', 0.4],
  ['caramel', 'whiskey', 0.8], ['caramel', 'nutty', 0.7], ['caramel', 'fruity', 0.4], ['caramel', 'lactonic', 0.5],
  ['honey', 'tobacco', 0.9], ['honey', 'white floral', 0.6], ['honey', 'woody', 0.6], ['honey', 'floral', 0.5],
  ['honey', 'leather', 0.5], ['honey', 'powdery', 0.3],
  ['cacao', 'fruity', 0.7], ['cacao', 'rose', 0.5], ['cacao', 'woody', 0.6], ['cacao', 'warm spicy', 0.6],
  ['cacao', 'earthy', 0.7], ['cacao', 'citrus', 0.5],
  ['almond', 'fruity', 0.6], ['almond', 'woody', 0.5], ['almond', 'lactonic', 0.5], ['almond', 'floral', 0.4],
  ['nutty', 'woody', 0.5], ['nutty', 'lactonic', 0.4],
  ['lactonic', 'fruity', 0.7], ['lactonic', 'tropical', 0.7], ['lactonic', 'woody', 0.5],
  ['lactonic', 'white floral', 0.5], ['lactonic', 'amber', 0.4], ['lactonic', 'musky', 0.5],
  ['lactonic', 'powdery', 0.5], ['lactonic', 'warm spicy', 0.4],
  ['coconut', 'tropical', 0.9], ['coconut', 'white floral', 0.8], ['coconut', 'aquatic', 0.5],
  ['coconut', 'lactonic', 0.5], ['coconut', 'woody', 0.5], ['coconut', 'amber', 0.4], ['coconut', 'musky', 0.5],
  ['coconut', 'powdery', 0.3], ['coconut', 'fresh spicy', 0.2], ['coconut', 'warm spicy', 0.3],
  ['tropical', 'woody', 0.4], ['tropical', 'amber', 0.3], ['tropical', 'white floral', 0.7],
  ['tropical', 'musky', 0.5], ['tropical', 'citrus', 0.5],
  ['fruity', 'musky', 0.7], ['fruity', 'woody', 0.6], ['fruity', 'floral', 0.6], ['fruity', 'rose', 0.7],
  ['fruity', 'powdery', 0.4], ['fruity', 'earthy', 0.5], ['fruity', 'amber', 0.4], ['fruity', 'citrus', 0.5],
  ['fruity', 'warm spicy', 0.5], ['fruity', 'white floral', 0.5], ['fruity', 'fresh spicy', 0.4],
  ['fruity', 'green', 0.5], ['fruity', 'fresh', 0.4], ['fruity', 'herbal', 0.3], ['fruity', 'lavender', 0.2],
  ['fruity', 'coconut', 0.5], ['fruity', 'aromatic', 0.4], ['fruity', 'balsamic', 0.4],
  ['rose', 'oud', 1], ['rose', 'amber', 0.7], ['rose', 'woody', 0.6], ['rose', 'citrus', 0.5],
  ['rose', 'musky', 0.6], ['rose', 'powdery', 0.5], ['rose', 'leather', 0.6], ['rose', 'earthy', 0.7],
  ['rose', 'warm spicy', 0.6],
  ['oud', 'amber', 0.7], ['oud', 'leather', 0.6], ['oud', 'balsamic', 0.6], ['oud', 'warm spicy', 0.5],
  ['oud', 'woody', 0.6],
  ['citrus', 'woody', 0.8], ['citrus', 'aromatic', 0.7], ['citrus', 'fresh spicy', 0.7], ['citrus', 'musky', 0.6],
  ['citrus', 'amber', 0.6], ['citrus', 'white floral', 0.6], ['citrus', 'green', 0.5], ['citrus', 'herbal', 0.5],
  ['citrus', 'earthy', 0.4], ['citrus', 'mossy', 0.6], ['citrus', 'warm spicy', 0.6], ['citrus', 'balsamic', 0.6],
  ['citrus', 'lavender', 0.6], ['citrus', 'floral', 0.5], ['citrus', 'iris', 0.5], ['citrus', 'honey', 0.4],
  ['citrus', 'oud', 0.4], ['citrus', 'almond', 0.4], ['citrus', 'savory', 0.3], ['citrus', 'leather', 0.3],
  ['citrus', 'powdery', 0.4], ['citrus', 'fresh', 0.4], ['citrus', 'coconut', 0.4], ['citrus', 'lactonic', 0.3],
  ['aquatic', 'woody', 0.7], ['aquatic', 'citrus', 0.5], ['aquatic', 'aromatic', 0.6], ['aquatic', 'musky', 0.6],
  ['aquatic', 'amber', 0.5],
  ['ozonic', 'woody', 0.5], ['ozonic', 'citrus', 0.5],
  ['green', 'woody', 0.6], ['green', 'floral', 0.6], ['green', 'earthy', 0.6], ['green', 'white floral', 0.5],
  ['green', 'amber', 0.3], ['green', 'musky', 0.4], ['green', 'powdery', 0.3], ['green', 'warm spicy', 0.2],
  ['lavender', 'tobacco', 0.8], ['lavender', 'amber', 0.7], ['lavender', 'woody', 0.6], ['lavender', 'musky', 0.5],
  ['lavender', 'leather', 0.5], ['lavender', 'powdery', 0.4],
  ['aromatic', 'woody', 0.7], ['aromatic', 'amber', 0.6], ['aromatic', 'leather', 0.6],
  ['aromatic', 'fresh spicy', 0.5], ['aromatic', 'earthy', 0.6], ['aromatic', 'musky', 0.5],
  ['aromatic', 'warm spicy', 0.5], ['aromatic', 'balsamic', 0.5], ['aromatic', 'fresh', 0.5],
  ['aromatic', 'green', 0.5], ['aromatic', 'rose', 0.4], ['aromatic', 'lactonic', 0.2], ['aromatic', 'lavender', 0],
  ['aromatic', 'herbal', 0], ['aromatic', 'powdery', 0.4], ['aromatic', 'floral', 0.4],
  ['aromatic', 'white floral', 0.3],
  ['herbal', 'woody', 0.6], ['herbal', 'amber', 0.4], ['herbal', 'musky', 0.4], ['herbal', 'warm spicy', 0.3],
  ['herbal', 'powdery', 0.3], ['herbal', 'white floral', 0.3],
  ['fresh spicy', 'woody', 0.7], ['fresh spicy', 'amber', 0.7], ['fresh spicy', 'leather', 0.5],
  ['fresh spicy', 'earthy', 0.6], ['fresh spicy', 'balsamic', 0.6], ['fresh spicy', 'musky', 0.5],
  ['fresh spicy', 'white floral', 0.4], ['fresh spicy', 'lavender', 0.6], ['fresh spicy', 'rose', 0.6],
  ['fresh spicy', 'green', 0.5], ['fresh spicy', 'herbal', 0.5], ['fresh spicy', 'oud', 0.5],
  ['fresh spicy', 'mossy', 0.5], ['fresh spicy', 'aquatic', 0.5], ['fresh spicy', 'iris', 0.4],
  ['fresh spicy', 'honey', 0.3], ['fresh spicy', 'tropical', 0.3], ['fresh spicy', 'lactonic', 0.2],
  ['fresh spicy', 'floral', 0.4], ['fresh spicy', 'fresh', 0.4], ['fresh spicy', 'warm spicy', 0.3],
  ['fresh spicy', 'powdery', 0.3],
  ['warm spicy', 'amber', 0.8], ['warm spicy', 'woody', 0.7], ['warm spicy', 'tobacco', 0.7],
  ['warm spicy', 'balsamic', 0.6], ['warm spicy', 'white floral', 0.5], ['warm spicy', 'floral', 0.5],
  ['warm spicy', 'earthy', 0.5], ['warm spicy', 'musky', 0.4], ['warm spicy', 'lavender', 0.5],
  ['warm spicy', 'fresh', 0.3], ['warm spicy', 'honey', 0.6], ['warm spicy', 'mossy', 0.4],
  ['warm spicy', 'powdery', 0.4],
  ['soft spicy', 'woody', 0.6], ['soft spicy', 'floral', 0.5], ['soft spicy', 'amber', 0.5],
  ['tobacco', 'leather', 0.7], ['tobacco', 'woody', 0.7], ['tobacco', 'whiskey', 0.8], ['tobacco', 'amber', 0.6],
  ['whiskey', 'woody', 0.7], ['whiskey', 'amber', 0.6],
  ['leather', 'iris', 0.7], ['leather', 'woody', 0.6], ['leather', 'amber', 0.6],
  ['iris', 'powdery', 0.5], ['iris', 'woody', 0.6], ['iris', 'musky', 0.6], ['iris', 'violet', 0.6],
  ['iris', 'oud', 0.7],
  ['tea', 'vanilla', 0.8], ['tea', 'citrus', 0.7], ['tea', 'honey', 0.6], ['tea', 'white floral', 0.6],
  ['tea', 'lactonic', 0.5], ['tea', 'woody', 0.5], ['tea', 'fruity', 0.4],
  ['violet', 'powdery', 0.5], ['violet', 'woody', 0.5],
  ['powdery', 'musky', 0.6], ['powdery', 'woody', 0.4], ['powdery', 'amber', 0.5], ['powdery', 'white floral', 0.5],
  ['powdery', 'floral', 0.5], ['powdery', 'balsamic', 0.5], ['powdery', 'earthy', 0.4],
  ['musky', 'woody', 0.6], ['musky', 'floral', 0.7], ['musky', 'white floral', 0.6], ['musky', 'amber', 0.6],
  ['musky', 'fresh', 0.6], ['musky', 'earthy', 0.5], ['musky', 'balsamic', 0.5], ['musky', 'honey', 0.4],
  ['musky', 'mossy', 0.4],
  ['white floral', 'woody', 0.6], ['white floral', 'amber', 0.5], ['white floral', 'earthy', 0.5],
  ['white floral', 'balsamic', 0.5], ['white floral', 'fresh', 0.4], ['white floral', 'floral', 0],
  ['floral', 'fresh', 0.4], ['floral', 'woody', 0.6], ['floral', 'amber', 0.4], ['floral', 'earthy', 0.5],
  ['floral', 'balsamic', 0.4],
  ['amber', 'woody', 0.7], ['amber', 'balsamic', 0.6], ['amber', 'earthy', 0.6], ['amber', 'fresh', 0.6],
  ['amber', 'mossy', 0.7], ['amber', 'honey', 0.6], ['amber', 'iris', 0.5], ['amber', 'cacao', 0.6],
  ['amber', 'almond', 0.4], ['amber', 'savory', 0.4],
  ['balsamic', 'woody', 0.6], ['balsamic', 'earthy', 0.6], ['balsamic', 'fresh', 0.3],
  ['fresh', 'woody', 0.7], ['fresh', 'powdery', 0.3], ['fresh', 'earthy', 0.4],
  ['mossy', 'powdery', 0.4], ['mossy', 'woody', 0.6], ['mossy', 'floral', 0.5],
  ['animalic', 'woody', 0.5], ['animalic', 'floral', 0.6], ['animalic', 'rose', 0.6], ['animalic', 'amber', 0.6],
  ['animalic', 'white floral', 0.7],
  ['earthy', 'woody', 0.6],
  ['savory', 'woody', 0.4],
  ['paper', 'woody', 0.5], ['paper', 'musky', 0.5],
  ['terpenic', 'woody', 0.6], ['terpenic', 'citrus', 0.5],
  ['sweet', 'aquatic', -0.2], ['aquatic', 'caramel', -0.8], ['aquatic', 'cacao', -0.8], ['aquatic', 'honey', -0.6],
  ['aquatic', 'vanilla', -0.3], ['aquatic', 'oud', -0.6], ['aquatic', 'tobacco', -0.6],
  ['aquatic', 'animalic', -0.7], ['ozonic', 'caramel', -0.8], ['ozonic', 'honey', -0.6], ['ozonic', 'oud', -0.6],
  ['ozonic', 'cacao', -0.6], ['aquatic', 'warm spicy', -0.4], ['green', 'caramel', -0.5],
  ['lavender', 'tropical', -0.5], ['citrus', 'animalic', -0.4], ['tropical', 'leather', -0.6],
  ['tropical', 'oud', -0.5], ['tropical', 'tobacco', -0.5], ['coconut', 'leather', -0.5], ['coconut', 'oud', -0.5],
];
const COMPLEMENT = new Map();
for (const [a, b, v] of PAIRS) {
  COMPLEMENT.set(`${a}|${b}`, v);
  COMPLEMENT.set(`${b}|${a}`, v);
}

// The same, by family: COMPLEMENT_OF.get(a).get(b).
const COMPLEMENT_OF = new Map();
for (const [key, v] of COMPLEMENT) {
  const [a, b] = key.split('|');
  if (!COMPLEMENT_OF.has(a)) COMPLEMENT_OF.set(a, new Map());
  COMPLEMENT_OF.get(a).set(b, v);
}

/** The pairing rule for two families, or undefined when the table has none. */
export const complementOf = (a, b) => COMPLEMENT.get(`${a}|${b}`);

// What the partner's family does to this bottle, for reason text.
const EFFECT = {
  woody: 'grounds', earthy: 'grounds', mossy: 'grounds', oud: 'deepens', leather: 'deepens', tobacco: 'deepens',
  amber: 'warms', balsamic: 'warms', 'warm spicy': 'spices up', 'soft spicy': 'spices up', whiskey: 'warms',
  citrus: 'brightens', fresh: 'brightens', green: 'freshens', aquatic: 'freshens', ozonic: 'freshens',
  herbal: 'freshens', aromatic: 'freshens', 'fresh spicy': 'sharpens', lavender: 'freshens', terpenic: 'sharpens',
  vanilla: 'rounds out', sweet: 'sweetens', caramel: 'sweetens', honey: 'sweetens', cacao: 'rounds out',
  almond: 'rounds out', nutty: 'rounds out', musky: 'softens', powdery: 'softens', iris: 'softens',
  lactonic: 'softens', coconut: 'softens', fruity: 'adds juice to', tropical: 'adds juice to',
  floral: 'adds petals to', rose: 'adds petals to', 'white floral': 'adds petals to', violet: 'adds petals to',
  animalic: 'adds skin to', savory: 'adds salt to', paper: 'dries out', tea: 'adds a dry edge to',
};
const SWEET = ['vanilla', 'sweet', 'caramel', 'honey', 'cacao', 'almond', 'nutty'];
const MARINE = ['aquatic', 'ozonic'];
const LAYER_WEIGHT = { top: 0.6, mid: 1, base: 1.2, all: 1 };
// Fragrantica's note votes ("Main Notes According to Your Votes") scale each
// note by its votes over the bottle's average, within these bounds. A listed
// note nobody votes for (or votes down) sits at the floor.
const NOTE_VOTE_FLOOR = 0.25;
const NOTE_VOTE_CAP = 2;
const NOTES_SHARE = 0.4; // of a profile, the rest from accords
const COMPLEMENT_FLOOR = 0.33;
const COMPLEMENT_SPAN = 0.18;
const MIN_SCORE = 0.4;
const GENERALIST_DAMPING = 1;
const GENERIC_NOTE = /notes?$|accord$|^(citruses|white flowers|flowers|spices|woods)$/;
// Blend fit: the engine's daily weights for season and weather, and the fit
// below which a pair loses points. Mild days keep every pair near or above it.
const BLEND_SEASON = 0.5;
const BLEND_WEATHER = 0.2;
const BLEND_OK = 0.7;
const BLEND_DAMPING = 1;
// Below this fit a pair is off for the weather: it says so ("Too rich for
// this heat") and sorts after every pair that isn't.
const BLEND_OFF = 0.58;
// A pair with full Parfumo consensus gains this much when it suits the
// weather (a fit of BLEND_OK or more), nothing at BLEND_FLOOR or below:
// voters vouch for the pair, not for wearing it in any weather.
const COMMUNITY_WEIGHT = 0.4;
const BLEND_FLOOR = 0.5;
// A note listed in more than this share of a collection's bottles (and in at
// least COMMON_NOTE_MIN of them) ties everything together, so it doesn't
// count as a bridge: bergamot is in 14 of the demo's 25.
const COMMON_NOTE_SHARE = 1 / 3;
const COMMON_NOTE_MIN = 4;

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const family = name => FAMILY_ALIAS[name] ?? name;
const cleanNote = n => String(n).toLowerCase().replace(/\s+/g, ' ').trim();

// [[family, share]] for a note, shares summing to 1; empty when no family fits.
export function noteFamilies(note) {
  const n = cleanNote(note);
  const [, ...families] = NOTE_FAMILIES.find(([re]) => re.test(n)) ?? [];
  const weights = families.map((_, i) => (i === 0 ? 1 : SECONDARY_SHARE));
  const total = weights.reduce((a, b) => a + b, 0);
  return families.map((f, i) => [f, weights[i] / total]);
}

export const noteFamily = note => noteFamilies(note)[0]?.[0] ?? null;

// { family: share } summing to 1, plus the notes behind each family.
// How strongly each listed note comes through, relative to the bottle's
// average note; 1 for every note when the record has no note votes.
function noteStrength(frag) {
  const votes = frag.noteVotes;
  const listed = [...new Set(Object.values(frag.notes ?? {}).flat())];
  if (!votes || !listed.length) return () => 1;
  const count = n => Math.max(0, votes[n] ?? 0);
  const mean = listed.reduce((sum, n) => sum + count(n), 0) / listed.length;
  return note => (mean ? clamp(count(note) / mean, NOTE_VOTE_FLOOR, NOTE_VOTE_CAP) : 1);
}

export function layerProfile(frag) {
  const acc = {}, fromNotes = {}, notesBy = {}, noteWeight = {}, faint = new Set();
  const strength = noteStrength(frag);
  let accTotal = 0, noteTotal = 0;
  for (const [a, s] of Object.entries(frag.accords)) {
    const f = family(a);
    acc[f] = (acc[f] ?? 0) + s;
    accTotal += s;
  }
  for (const [layer, list] of Object.entries(frag.notes ?? {})) {
    for (const note of list) {
      const w = (LAYER_WEIGHT[layer] ?? 1) * strength(note);
      const families = noteFamilies(note);
      if (families.length) noteWeight[cleanNote(note)] = Math.max(noteWeight[cleanNote(note)] ?? 0, w);
      if (strength(note) <= NOTE_VOTE_FLOOR) faint.add(cleanNote(note));
      families.forEach(([f, share], i) => {
        fromNotes[f] = (fromNotes[f] ?? 0) + w * share;
        noteTotal += w * share;
        // For naming a family, a note it's the main family of comes first.
        (notesBy[f] ??= []).push({ note: cleanNote(note), w: i === 0 ? w : w * share });
      });
    }
  }
  const noteShare = noteTotal ? NOTES_SHARE : 0;
  const profile = {};
  for (const [f, s] of Object.entries(acc)) profile[f] = (1 - noteShare) * s / accTotal;
  for (const [f, s] of Object.entries(fromNotes)) profile[f] = (profile[f] ?? 0) + noteShare * s / noteTotal;
  // Named notes before generic ones ("sandalwood" over "woody notes"), then heart and base.
  const rank = x => x.w - (GENERIC_NOTE.test(x.note) ? 1 : 0);
  for (const list of Object.values(notesBy)) list.sort((a, b) => rank(b) - rank(a));
  return { profile, notesBy, noteWeight, faint };
}

// Each bottle's profile, with what every pairing reads off it.
const profiles = new WeakMap();
const profileOf = frag => {
  if (!profiles.has(frag)) {
    const p = layerProfile(frag);
    const share = list => list.reduce((s, f) => s + (p.profile[f] ?? 0), 0);
    profiles.set(frag, { ...p, entries: Object.entries(p.profile), sweet: share(SWEET), marine: share(MARINE) });
  }
  return profiles.get(frag);
};

const cosine = (p, q) => {
  let dot = 0, np = 0, nq = 0;
  for (const f in p) {
    dot += p[f] * (q[f] ?? 0);
    np += p[f] ** 2;
    nq += (q[f] ?? 0) ** 2;
  }
  for (const f in q) if (!(f in p)) nq += q[f] ** 2;
  return np && nq ? dot / Math.sqrt(np * nq) : 0;
};

// A note from the bottle for this family, else the family's own name.
const nameFor = (side, f) => side.notesBy[f]?.[0]?.note ?? f;
const isPlural = noun => /(notes|[^sui]s)$/.test(noun);
// "grounds" -> "ground", "dries out" -> "dry out", for plural subjects.
const pluralVerb = phrase => phrase.replace(/^(\w+?)(ies|s)\b/, (m, stem, end) => (end === 'ies' ? `${stem}y` : stem));

/**
 * How well the pair suits the conditions, 0..1, read the way the engine reads
 * one bottle. conditions: { feelsF, humidity, dewF?, date, lat }
 */
export function blendFit(frag, other, conditions) {
  const weights = targetSeasonWeights(conditions.feelsF, conditions.date, conditions.lat);
  const season = (seasonFit(frag, weights) + seasonFit(other, weights)) / 2;
  const h = (heaviness(frag.accords) + heaviness(other.accords)) / 2;
  const weather = 1 - Math.abs(h - targetHeaviness(conditions)) / 2;
  return (BLEND_SEASON * season + BLEND_WEATHER * weather) / (BLEND_SEASON + BLEND_WEATHER);
}

/**
 * Parfumo voters' backing for the pair, from either bottle's record, or null.
 * -> { consensus 0..100, via: [frag's side, other's side] when an original stood in }
 */
function communityPair(frag, other) {
  const find = (a, b) => a.layeredWith?.find(e => String(e.id) === String(b.id));
  const mine = find(frag, other);
  if (mine) return { consensus: mine.consensus, via: mine.via ?? null };
  const theirs = find(other, frag);
  return theirs ? { consensus: theirs.consensus, via: theirs.via ? [...theirs.via].reverse() : null } : null;
}

// The pair's score and what the reasons are drawn from, without the reasons.
function scorePair(frag, other, conditions) {
  const a = profileOf(frag), b = profileOf(other);

  // Complement: every family pair across the two, weighted by both shares.
  let complement = 0, clash = 0, best = null;
  for (const [fa, pa] of a.entries) {
    const rules = COMPLEMENT_OF.get(fa);
    if (!rules) continue;
    for (const [fb, pb] of b.entries) {
      if (fa === fb) continue;
      const c = pa * pb * (rules.get(fb) ?? 0);
      if (c < 0) clash -= c;
      else complement += c;
      if (c > 0 && (!best || c > best.c)) best = { c, fa, fb };
    }
  }

  // Bridge: overlap in families.
  let bridge = 0;
  for (const [f, pa] of a.entries) bridge += Math.min(pa, b.profile[f] ?? 0);

  const similarity = cosine(a.profile, b.profile);
  const [ha, hb] = [heaviness(frag.accords), heaviness(other.accords)];

  // Across the demo and catalog, complement runs about 0.33 (10th percentile) to 0.51 (90th).
  const complementScore = clamp((complement - COMPLEMENT_FLOOR) / COMPLEMENT_SPAN, 0, 1);
  const bridgeScore = bridge < 0.15 ? bridge / 0.15 : bridge <= 0.45 ? 1 : clamp(1 - (bridge - 0.45) / 0.4, 0, 1);
  const contrastScore = clamp(Math.abs(ha - hb) / 0.4, 0, 1);
  const tooAlike = similarity > 0.85;
  const bothSweet = a.sweet > 0.35 && b.sweet > 0.35;
  const bothMarine = !tooAlike && a.marine > 0.12 && b.marine > 0.12;
  // Without the weather, two heavy scents are marked down as a cold-nights-only pair.
  const bothHeavy = !conditions && ha > 0.55 && hb > 0.55;
  const fit = conditions ? blendFit(frag, other, conditions) : null;
  const offWeather = conditions ? BLEND_DAMPING * Math.max(0, BLEND_OK - fit) : 0;
  const model = clamp(
    0.5 * complementScore + 0.25 * bridgeScore + 0.25 * contrastScore
      - Math.min(0.3, clash * 4) - (tooAlike ? 0.25 : 0) - (bothSweet ? 0.12 : 0) - (bothMarine ? 0.12 : 0)
      - (bothHeavy ? 0.12 : 0) - offWeather,
    0, 1);
  return { a, b, model, best, bridge, clash, ha, hb, fit, contrastScore, tooAlike, bothSweet, bothMarine, bothHeavy };
}

/**
 * How well `other` layers with `frag`, for the weather when `conditions` are given.
 * `common`: notes too common in the collection to tie two bottles together.
 * -> { score 0..1, model: the score before Parfumo's votes,
 *      community: { consensus, via, boost } or null, offWeather: true when the
 *      pair doesn't suit the weather, reasons: [{ text, tone }], first: the one to spray first }
 */
export function layerPair(frag, other, conditions = null, { common = null } = {}) {
  const { a, b, model, best, bridge, clash, ha, hb, fit, contrastScore, tooAlike, bothSweet, bothMarine, bothHeavy } = scorePair(frag, other, conditions);
  // Shared notes, the ones both bottles carry most strongly first; a note
  // voters barely smell in either one doesn't tie them together.
  const shared = n => Math.min(a.noteWeight[n], b.noteWeight[n]);
  const sharedNotes = Object.keys(a.noteWeight)
    .filter(n => b.noteWeight[n] && !GENERIC_NOTE.test(n) && !a.faint.has(n) && !b.faint.has(n) && !common?.has(n))
    .sort((x, y) => shared(y) - shared(x));
  const isOff = conditions !== null && fit < BLEND_OFF;
  const voted = communityPair(frag, other);
  const weatherShare = conditions ? clamp((fit - BLEND_FLOOR) / (BLEND_OK - BLEND_FLOOR), 0, 1) : 1;
  const community = voted && { ...voted, boost: COMMUNITY_WEIGHT * voted.consensus / 100 * weatherShare };

  const reasons = [];
  if (best) {
    const subject = nameFor(b, best.fb), object = nameFor(a, best.fa);
    const effect = EFFECT[best.fb] ?? 'balances';
    reasons.push({ text: `${subject[0].toUpperCase()}${subject.slice(1)} ${isPlural(subject) ? pluralVerb(effect) : effect} the ${object}`, tone: 'good' });
  }
  if (sharedNotes.length) {
    const named = sharedNotes.slice(0, 2).join(' and ');
    reasons.push({ text: `Shared ${named} ${sharedNotes.length === 1 ? 'ties' : 'tie'} them together`, tone: 'good' });
  } else if (bridge >= 0.15 && !tooAlike) {
    const [f] = Object.keys(a.profile).filter(x => b.profile[x]).sort((x, y) => Math.min(a.profile[y], b.profile[y]) - Math.min(a.profile[x], b.profile[x]));
    if (f && !(bothMarine && MARINE.includes(f))) reasons.push({ text: `Both lean ${f}`, tone: 'good' });
  }
  if (!reasons.length && contrastScore > 0.5) reasons.push({ text: 'One richer, one lighter', tone: 'good' });
  if (community) {
    const text = community.via ? `Parfumo voters layer ${community.via[0]} with ${community.via[1]}` : 'Parfumo voters layer these two';
    reasons.unshift({ text, tone: 'good' });
  }
  if (conditions) {
    const hot = conditions.feelsF >= 78, cold = conditions.feelsF <= 52;
    if (fit >= 0.85 && hot) reasons.push({ text: 'Light enough for the heat', tone: 'good' });
    if (fit >= 0.85 && cold) reasons.push({ text: 'Rich enough for the cold', tone: 'good' });
    if (isOff) {
      const sticky = isSticky(conditions);
      const text = (ha + hb) / 2 > targetHeaviness(conditions)
        ? (hot ? `Too rich for ${sticky ? 'sticky' : 'this'} heat` : 'Too rich for this weather')
        : (cold ? 'Too light for the cold' : 'Too light for this weather');
      reasons.push({ text, tone: 'bad' });
    }
  }
  if (tooAlike) reasons.push({ text: 'So alike it adds little', tone: 'bad' });
  if (bothSweet) reasons.push({ text: 'Both run sweet, so go light on one', tone: 'bad' });
  if (bothMarine) reasons.push({ text: 'Two aquatics just double up', tone: 'bad' });
  if (bothHeavy) reasons.push({ text: 'Two heavy scents, better for cold nights', tone: 'bad' });
  if (clash > 0.02) reasons.push({ text: 'Some notes fight each other', tone: 'bad' });

  // Heavier and longer-lasting goes on first; the lighter one sits on top.
  const first = ha >= hb ? frag : other;
  const score = Math.min(1, model + (community?.boost ?? 0));
  return { fragrance: other, score, model, community, offWeather: isOff, reasons, first };
}

// Notes listed in so many of the collection's bottles that sharing one says
// little (COMMON_NOTE_SHARE).
export function commonNotes(collection) {
  const counts = new Map();
  for (const f of collection) {
    for (const n of new Set(Object.values(f.notes ?? {}).flat().map(cleanNote))) counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, c]) => c >= COMMON_NOTE_MIN && c > COMMON_NOTE_SHARE * collection.length).map(([n]) => n));
}

// The model's score (before Parfumo's votes; scores are symmetric) for every
// pair in the last collection asked about, and each bottle's sum over the
// rest. The bottle page passes the collection without the open bottle, so
// each open asks about a different list: any list within the kept one reads
// its averages off these in O(n) instead of redoing the n² pass.
let pairsFor = { records: [], at: new Map(), scores: new Float64Array(0), sums: new Float64Array(0) };
function pairScores(records) {
  const n = records.length, scores = new Float64Array(n * n), sums = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const { model } = scorePair(records[i], records[j], null);
      scores[i * n + j] = scores[j * n + i] = model;
      sums[i] += model;
      sums[j] += model;
    }
  }
  return { records, at: new Map(records.map((f, i) => [f.id, i])), scores, sums };
}

// Positions of `collection`'s records among the kept ones, or null when one isn't kept.
const keptAt = collection => {
  const at = collection.map(f => pairsFor.at.get(f.id));
  return at.every((i, k) => i !== undefined && pairsFor.records[i] === collection[k]) ? at : null;
};

/**
 * Each bottle's average pairing score across the rest of `collection`, before
 * Parfumo's votes, their overall average, and the collection's common notes.
 * `frag` is the bottle being paired: when it isn't in the list, it joins the
 * kept pairs, so opening each bottle of a collection in turn reuses them.
 */
export function pairingMeans(collection, frag = null) {
  let at = keptAt(collection);
  // Fewer than three in four of the kept bottles: worth a fresh pass.
  if (!at || collection.length < 0.75 * pairsFor.records.length) {
    const joins = frag && !collection.some(f => f.id === frag.id);
    pairsFor = pairScores(joins ? [...collection, frag] : collection);
    at = keptAt(collection);
  }
  const { records, scores, sums } = pairsFor, n = records.length;
  // A kept bottle outside the list doesn't count toward anyone's average.
  const inside = new Set(at);
  const left = records.flatMap((f, i) => (inside.has(i) ? [] : [i]));
  const per = Math.max(1, collection.length - 1);
  const means = new Map(collection.map((f, k) => {
    const i = at[k];
    return [f.id, left.reduce((sum, j) => sum - scores[i * n + j], sums[i]) / per];
  }));
  const overall = [...means.values()].reduce((a, b) => a + b, 0) / Math.max(1, means.size);
  return { means, overall, common: commonNotes(collection) };
}

// Best first: pairs that suit the weather before any that don't, then by rank.
export const byPick = (x, y) => x.offWeather - y.offWeather || y.rank - x.rank;

// The last answer: a page drawn twice asks twice.
let lastPicks = { frag: null, collection: [], limit: 0, conditions: null, picks: [] };

/**
 * The best partners for `frag` among `collection`, best first, for the weather
 * when `conditions` are given. Each pick's `rank` orders them and can pass 1
 * where Parfumo's votes lift a pair the model already rates perfect; a pair
 * off for the weather comes after every pair that isn't.
 */
export function layerPicks(frag, collection, limit = 3, conditions = null) {
  const last = lastPicks;
  if (last.frag === frag && last.limit === limit && last.conditions === conditions
    && last.collection.length === collection.length && last.collection.every((f, i) => f === collection[i])) return [...last.picks];
  const { means, overall, common } = pairingMeans(collection, frag);
  const picks = collection
    .filter(f => f.id !== frag.id)
    .map(f => {
      const pair = layerPair(frag, f, conditions, { common });
      const generalist = (means.get(f.id) ?? overall) - overall;
      const rank = clamp(pair.model - GENERALIST_DAMPING * generalist, 0, 1) + (pair.community?.boost ?? 0);
      return { ...pair, rank, score: Math.min(1, rank) };
    })
    .filter(p => p.rank >= MIN_SCORE)
    .sort(byPick)
    .slice(0, limit);
  lastPicks = { frag, collection: [...collection], limit, conditions, picks };
  return [...picks];
}
