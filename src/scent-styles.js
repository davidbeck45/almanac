// Scent styles: the words enthusiasts shop by ("skin scent", "clean",
// "barbershop", "gourmand"...), scored 0..1 per bottle. Pure: any engine
// record in (data/collection.json, fromFragrantica, a hand-entered my: record
// with accords only), scores out.
//
// A style reads three things:
// - accords, as Fragrantica's strength 0..1 (barStrength of the record's bar
//   width / 100; the top accord is 1). Evidence = noisy-OR of weight x
//   strength^1.3, so an accord has to lead to count fully.
// - notes, by how strongly voters smell each (noteVotes over the bottle's most
//   voted note; a listed note nobody voted for counts UNVOTED; a bottle with no
//   note votes uses its pyramid tier). Evidence = noisy-OR of weight x salience.
// - sillage (Intimate, and a nudge for Skin scent and Clean), on Parfumo's
//   0..10 scale via the engine's performanceRating (both crowds, by their
//   votes), shrunk toward the middle when few voted.
// base = ACC x accord evidence + NOTE x note evidence (+ style extras), damped
// by exp(-penalty), the weighted strength of accords that pull away from the
// style (vanilla and oud aren't "fresh citrus"), then eased toward 1 above 0.8.
// Intimate is a wear style (kind 'wear'): sillage first, ranked apart, so a
// quiet bottle still shows its character.
import { barStrength } from './accords.js';
import { performanceRating } from './engine.js';

// Show a style from STYLE_MIN (Skin scent's false positives across the
// dataset sit at 0.50-0.51), call it strong from STYLE_STRONG. A collection's
// mix counts what each bottle leans toward, its top 2 from STYLE_LEAN. Wears
// close from WEARS_CLOSE: the quietest 15% of bottles with 300+ voters.
export const STYLE_MIN = 0.55;
export const STYLE_STRONG = 0.75;
export const STYLE_LEAN = 0.4;
export const WEARS_CLOSE = 0.6;

const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));

// Note salience when the bottle has no note votes: base notes last, top notes fade.
const TIER_SALIENCE = { top: 0.45, mid: 0.6, base: 0.7, all: 0.65 };
const FEW_NOTES = 3; // a pyramid this short is the whole perfume
const FEW_NOTES_SALIENCE = 0.85;
const UNVOTED = 0.1;
// A defining molecule's salience floor (a third item in a style's notes).
const PRESENT = 0.6;

// Sillage on Parfumo's scale (Fragrantica 1..4 mapped by the engine). The
// middle is the dataset's median (Fragrantica 2.29). QUIET is 0 from 7.05
// (Fragrantica 2.21, the 40th percentile) and 1 by 6.25 (1.82, the 7th); LOUD
// is 0 to 7.6 (2.48, the 70th) and 1 by 8.5 (2.92, the 94th).
const SILLAGE_MID = 7.2;
const SILLAGE_PRIOR_VOTES = 15;
const QUIET_FROM = 7.05, QUIET_SPAN = 0.8;
const LOUD_FROM = 7.6, LOUD_SPAN = 0.9;

// Clean's soapy-iris facet: an iris accord with neroli (or musk) reads as
// fine soap (Prada L'Homme). The modern chypre: bergamot over patchouli or
// labdanum without the moss (31 Rue Cambon).
const SOAPY_IRIS = 0.5;
const MODERN_CHYPRE = 0.45;

// Note patterns shared by several styles.
const N = {
  citrus: /bergamot|lemon|lime\b|limes|orange(?! blossom| flower)|mandarin|tangerine|clementine|grapefruit|yuzu|pomelo|citron|kumquat|citrus|petitgrain|verbena|lemongrass|bigarade|neroli/,
  aquatic: /\bsea\b|sea notes|sea water|seawater|sea salt|marine|aquatic|water notes|watery|calone|seaweed|algae|ocean|salt\b|salty|driftwood|ozon|sea spray|sea breeze|rain|dew drop/,
  skinMolecule: /iso e super|ambrox|cetalox|ambrofix|ambermax|norlimbanol|timbersilk|clearwood|javanol|akigalawood|cashmeran|cashmere wood|cashmere musk|helvetolide|habanolide|galaxolide|ambrettolide|exaltolide|romandolide|muscenone|serenolide|velvione/,
  musk: /musk|ambrett|\bskin\b/,
  cleanMusk: /white musk|clean musk|skin musk|cotton musk|laundry musk/,
  soapy: /soap|laundry|linen|cotton(?! candy)|clean notes?|detergent|fabric|shower|bubble|starch|ironed|sheets|towel|fresh air|mountain air|white tea|aldehyde/,
  resin: /labdanum|cistus|benzoin|myrrh|myrhh|opoponax|tolu|peru balsam|styrax|resins?\b|balsam(?! fir)|balsamic|copal|elemi|oriental notes|amber(?!gris|wood|ox|ette)/,
  ambroxLike: /ambrox|ambergris|cetalox|ambrofix|ambermax|grey amber|gray amber|white amber/,
  incense: /incense|olibanum|frankincense|smoke|smoky|cade|birch tar|gunpowder|burnt|charcoal|ash\b|fire|bonfire|campfire|church|kyara incense/,
  oud: /\boud|agarwood|aoud|kyara|oudh/,
  leather: /leather|suede|cuir|castoreum|isobutyl quinoline|birch tar/,
  tobacco: /tobacco|cigar|cigarette|pipe/,
  booze: /\brum\b|cognac|whisk|bourbon whisk|brandy|liquor|liqueur|wine|champagne|\bgin\b|absinth|vodka|\bsake\b|beer|tequila|amaretto|calvados|armagnac|limoncello|prosecco|martini|mojito|cocktail|kahlua|baileys|sherry|mead|port wine|plum wine|rhum|mezcal/,
  whiteFloral: /jasmin|tuberose|gardenia|orange blossom|orange flower|ylang|frangipani|plumeria|tiare|champaca|magnolia|lily(?! of the valley|-of-the-valley)|honeysuckle|neroli|hedione|white flowers?|osmanthus|stephanotis|narcissus|daffodil/,
  rose: /\brose(?!mary|wood)|rosa\b|rose water|centifolia|damask|geranium/,
  iris: /iris|orris|violet(?! leaf| leaves)|heliotrope|powder|rice|lipstick|make-?up|carrot|mimosa|aldehyde|cosmetic/,
  wood: /cedar|sandal|vetiver|vetyver|guaiac|gaiac|cypress|hinoki|\boak\b|oakwood|teak|ebony|mahogany|pine|fir\b|woody notes|woodsy notes|woods\b|wood\b|cypriol|nagarmotha|papyrus|palo santo|birch wood|driftwood|massoia|amyris|rosewood|agarwood/,
  spice: /pepper|cardamom|cardamon|cinnamon|clove|nutmeg|saffron|ginger(?! lily| flower)|cumin|allspice|pimento|star anise|anise|coriander|caraway|spices|spicy notes|chili|turmeric|cassia|mace\b|cayenne|curry|fenugreek/,
  fruit: /apple|pear\b|pears|peach|plum\b|plums|raspberr|strawberr|blackberr|blueberr|berry|berries|currant|cassis|pineapple|mango|lychee|litchi|melon|apricot|pomegranate|passion ?fruit|grape\b|grapes|quince|rhubarb|cherry|nectarine|guava|papaya|kiwi|banana|fruity notes|fruits|red fruits|tropical fruits|fig\b|figs|dates|persimmon|watermelon|cranberr|carambola|goji|yuzu fruit|feijoa/,
  moss: /oakmoss|oak moss|tree ?moss|\bmoss\b|chypre|lichen/,
  green: /galbanum|green notes|green leaves|green accord|grass|fig leaf|fig tree|violet leaf|violet leaves|tomato leaf|\bivy\b|mate\b|green tea|matcha|\btea\b|bamboo|cucumber|black ?currant leaf|cassis leaf|stems?\b|leaf\b|leaves\b|basil|green|lentisque|mastic|angelica|sap\b|hay\b|bitter orange leaf|petitgrain/,
  gourmand: /praline|caramel|toffee|butterscotch|dulce|chocolate|cacao|cocoa|coffee|espresso|marshmallow|cotton candy|sugar|candy|cake|cookie|biscuit|pastry|meringue|whipped cream|custard|ice cream|honey|almond|pistachio|hazelnut|chestnut|peanut|macaron|popcorn|bubble ?gum|licorice|liquorice|maple|milk|cream\b|dates|nougat|brioche|bread|waffle|crepe|pie\b|jam\b|syrup|sorbet|gelato|tiramisu|cupcake|donut|sweet notes|gourmand/,
  vanilla: /vanill|vanila|vanille/,
  lavender: /lavender|lavandin/,
  fougereBase: /coumarin|tonka|oakmoss|oak moss|geranium/,
  oakmoss: /oakmoss|oak moss|tree ?moss|\bmoss\b/,
  chypreBase: /patchouli|labdanum|cistus/,
  bergamot: /bergamot/,
  calone: /calone/,
  orris: /iris|orris/,
  neroli: /neroli|orange blossom|orange flower|petitgrain/,
};

// The styles. kind: 'scent' (character) or 'wear' (how it projects). acc:
// accord weights; notes: [pattern, weight]; against: accord penalties;
// ACC/NOTE: how much accord and note evidence count. Every accord in
// src/accords.js sits in some style's acc or against (test/scent-styles.test.js).
export const STYLES = [
  {
    id: 'skin', label: 'Skin scent', kind: 'scent',
    blurb: 'Your skin but better: musks, ambrette, Iso E Super, ambroxan, soft woods, little else.',
    ACC: 0.5, NOTE: 0.4,
    acc: { musky: 0.9, amber: 0.3, woody: 0.25, powdery: 0.25, iris: 0.15, animalic: 0.25, salty: 0.15, lactonic: 0.1, 'soft spicy': 0.1 },
    notes: [[N.skinMolecule, 1], [N.cleanMusk, 0.8], [N.musk, 0.75], [/ambergris/, 0.4], [/sandal|white woods?|blond(e)? woods?/, 0.25]],
    against: {
      sweet: 0.35, fruity: 0.35, tropical: 0.45, citrus: 0.22, 'warm spicy': 0.3, cinnamon: 0.45, 'fresh spicy': 0.2, aromatic: 0.3,
      lavender: 0.3, herbal: 0.35, green: 0.3, 'white floral': 0.3, tuberose: 0.45, 'yellow floral': 0.3, rose: 0.3, floral: 0.15,
      vanilla: 0.3, caramel: 0.6, chocolate: 0.6, cacao: 0.6, coffee: 0.6, honey: 0.4, almond: 0.4, nutty: 0.4, coconut: 0.4,
      oud: 0.5, leather: 0.4, tobacco: 0.6, smoky: 0.45, whiskey: 0.6, rum: 0.6, balsamic: 0.25, patchouli: 0.35, earthy: 0.2,
      aquatic: 0.35, marine: 0.35, ozonic: 0.25, mossy: 0.3, cherry: 0.5, beeswax: 0.3, camphor: 0.3, metallic: 0.2,
    },
    // Purity: the share of the accord mass that is skin-like.
    extra: f => 0.25 * f.share(SKIN_LIKE) + 0.12 * (f.quiet ?? 0) - 0.3 * f.loud,
  },
  {
    id: 'clean', label: 'Clean', kind: 'scent',
    blurb: 'Soap, laundry, fresh musk and aldehydes: just-showered, crisp-sheets clean.',
    ACC: 0.65, NOTE: 0.4,
    acc: { soapy: 1, aldehydic: 0.8, musky: 0.35, fresh: 0.35, ozonic: 0.25, powdery: 0.15, iris: 0.25, lavender: 0.1 },
    // Iris and neroli read as fine soap (Prada L'Homme, Neroli Portofino).
    notes: [[N.soapy, 0.9], [N.cleanMusk, 0.6], [/lily[- ]of[- ]the[- ]valley|muguet|lily of the valley/, 0.35], [/\bmusk/, 0.25],
      [/cotton flower|linden|lime \(linden\)/, 0.4], [N.neroli, 0.2], [N.orris, 0.2]],
    against: {
      sweet: 0.35, vanilla: 0.4, caramel: 0.7, chocolate: 0.7, cacao: 0.7, coffee: 0.7, honey: 0.4, almond: 0.4, nutty: 0.5,
      oud: 0.6, leather: 0.5, tobacco: 0.6, smoky: 0.5, animalic: 0.4, 'warm spicy': 0.35, cinnamon: 0.5, balsamic: 0.35,
      patchouli: 0.35, earthy: 0.25, fruity: 0.25, tropical: 0.4, cherry: 0.5, amber: 0.2, whiskey: 0.6, rum: 0.6, mossy: 0.15,
      woody: 0.1, coconut: 0.2, savory: 0.4, camphor: 0.2,
    },
    // Fresh + musk reads as laundry: fresh, ozonic or aldehydic air over a musk.
    // Iris with neroli reads as fine soap (iris alone is just powdery) unless
    // amber, vanilla or resins warm it (After Midnight, L'Heure Bleue).
    extra: f => 0.35 * noisyOr([0.8 * f.acc('fresh'), 0.7 * f.acc('ozonic'), 0.45 * f.acc('aquatic'), 0.45 * f.acc('marine'),
      0.3 * f.acc('citrus'), 0.8 * f.acc('aldehydic'), f.acc('soapy'), 0.3 * f.acc('lavender'), 0.25 * f.acc('green')])
      * Math.max(f.acc('musky'), f.note(N.musk))
      + SOAPY_IRIS * f.acc('iris') * noisyOr([f.note(N.neroli), 0.3 * f.note(N.musk)])
        * (1 - Math.max(f.acc('amber'), f.acc('vanilla'), f.acc('sweet'), f.acc('balsamic')))
      + 0.06 * (f.quiet ?? 0) - 0.1 * f.loud,
  },
  {
    id: 'intimate', label: 'Intimate', kind: 'wear',
    blurb: 'Wears close: people notice it only when they lean in.',
    // Scored from sillage (intimate() below); no accords or notes of its own.
    custom: f => intimate(f),
  },
  {
    id: 'citrus', label: 'Fresh citrus', kind: 'scent',
    blurb: 'Bergamot, lemon, orange and neroli up front: colognes and zesty fresh scents.',
    ACC: 0.75, NOTE: 0.3,
    acc: { citrus: 1, sour: 0.5, fresh: 0.15 },
    notes: [[N.citrus, 0.55]],
    against: {
      vanilla: 0.5, sweet: 0.35, amber: 0.35, balsamic: 0.4, oud: 0.6, leather: 0.5, tobacco: 0.6, caramel: 0.6, chocolate: 0.6,
      cacao: 0.6, coffee: 0.6, honey: 0.35, 'warm spicy': 0.3, cinnamon: 0.45, smoky: 0.45, animalic: 0.45, patchouli: 0.35,
      powdery: 0.25, coconut: 0.35, tropical: 0.2, whiskey: 0.5, rum: 0.5, 'white floral': 0.2, tuberose: 0.4, rose: 0.25,
      musky: 0.1, mossy: 0.2, earthy: 0.2, aquatic: 0.25, marine: 0.25, fruity: 0.15, iris: 0.25, almond: 0.4, nutty: 0.4,
      savory: 0.2,
    },
  },
  {
    id: 'aquatic', label: 'Aquatic', kind: 'scent',
    blurb: 'Sea air, salt and calone: marine and ozonic freshness.',
    ACC: 0.8, NOTE: 0.6,
    acc: { marine: 1, aquatic: 1, ozonic: 0.75, salty: 0.7, mineral: 0.3, sand: 0.3 },
    // Calone is the sea in a bottle even where voters barely name it
    // (L'Eau d'Issey Pour Homme): its presence counts at least PRESENT.
    notes: [[N.aquatic, 0.9], [N.calone, 0.9, PRESENT], [/water lily|lotus|water ?melon|cucumber/, 0.2]],
    against: {
      vanilla: 0.3, sweet: 0.15, caramel: 0.5, chocolate: 0.5, cacao: 0.4, coffee: 0.5, oud: 0.5, leather: 0.4, tobacco: 0.5,
      'warm spicy': 0.25, cinnamon: 0.4, balsamic: 0.35, smoky: 0.35, animalic: 0.35, honey: 0.3, patchouli: 0.25, whiskey: 0.5,
      rum: 0.4, 'white floral': 0.15, rose: 0.2, powdery: 0.1,
    },
  },
  {
    id: 'green', label: 'Green', kind: 'scent',
    blurb: 'Cut grass, galbanum, leaves, fig and green tea.',
    ACC: 0.75, NOTE: 0.35,
    acc: { green: 1, herbal: 0.25, terpenic: 0.3, bitter: 0.35, cannabis: 0.3, conifer: 0.15 },
    notes: [[N.green, 0.55]],
    against: {
      vanilla: 0.4, sweet: 0.3, caramel: 0.6, chocolate: 0.6, cacao: 0.5, coffee: 0.5, amber: 0.3, oud: 0.5, leather: 0.35,
      tobacco: 0.45, 'warm spicy': 0.3, cinnamon: 0.45, balsamic: 0.35, smoky: 0.3, animalic: 0.3, honey: 0.35, whiskey: 0.5,
      rum: 0.5, coconut: 0.3, powdery: 0.15, musky: 0.1, tropical: 0.2,
    },
  },
  {
    id: 'aromatic', label: 'Barbershop', kind: 'scent',
    blurb: 'Lavender, herbs, geranium, tonka and moss: the classic fougère.',
    ACC: 0.65, NOTE: 0.35,
    acc: { lavender: 0.9, aromatic: 0.7, herbal: 0.45, 'fresh spicy': 0.12, mossy: 0.15, soapy: 0.2, camphor: 0.3 },
    notes: [[N.lavender, 0.9], [/geranium/, 0.4], [/coumarin|tonka/, 0.25], [/oakmoss|oak moss/, 0.25],
      [/sage|clary|rosemary|thyme|artemisia|wormwood|armoise|tarragon|basil|mint|bay leaf|laurel|juniper|fern|myrtle|eucalyptus|herbal notes|aromatic notes|hay\b/, 0.4]],
    against: {
      fruity: 0.3, tropical: 0.45, 'white floral': 0.3, tuberose: 0.5, rose: 0.3, floral: 0.15, caramel: 0.4, chocolate: 0.4,
      cacao: 0.3, coffee: 0.3, sweet: 0.15, coconut: 0.4, cherry: 0.5, oud: 0.3, aquatic: 0.15, marine: 0.15, citrus: 0.1,
      'yellow floral': 0.3, powdery: 0.05,
    },
    // Fougère structure: lavender with coumarin and moss.
    extra: f => 0.2 * Math.min(f.note(N.lavender) + 0.5 * f.acc('lavender'), 1) * Math.min(1, f.note(N.fougereBase) + 0.3 * f.acc('mossy')),
  },
  {
    id: 'gourmand', label: 'Gourmand', kind: 'scent',
    blurb: 'Edible and sweet: caramel, praline, chocolate, coffee, honey, almond.',
    ACC: 0.7, NOTE: 0.35,
    acc: { caramel: 1, chocolate: 1, cacao: 1, coffee: 1, gourmand: 1, 'coca-cola': 0.8, sweet: 0.6, honey: 0.7, almond: 0.7, nutty: 0.75, cherry: 0.4, lactonic: 0.35, coconut: 0.35, vanilla: 0.4, beeswax: 0.4 },
    notes: [[N.gourmand, 0.75], [N.vanilla, 0.3], [/tonka/, 0.25]],
    against: { aquatic: 0.4, marine: 0.4, ozonic: 0.3, green: 0.3, herbal: 0.3, citrus: 0.15, aromatic: 0.15, 'fresh spicy': 0.1, mossy: 0.3, earthy: 0.2, camphor: 0.3 },
  },
  {
    id: 'vanilla', label: 'Vanilla', kind: 'scent',
    blurb: 'Vanilla front and center, from boozy-dark to creamy-soft.',
    ACC: 0.8, NOTE: 0.4,
    acc: { vanilla: 1 },
    notes: [[N.vanilla, 1], [/tonka|benzoin/, 0.3], [/heliotrope|coumarin/, 0.15]],
    against: { aquatic: 0.35, marine: 0.35, ozonic: 0.3, green: 0.3, citrus: 0.15, 'fresh spicy': 0.1, herbal: 0.2 },
    // Vanilla has to lead: a note in the base of a fresh bottle isn't the style.
    gate: f => clamp(f.acc('vanilla') * 1.4 + 0.3 * f.note(N.vanilla)),
  },
  {
    id: 'amber', label: 'Amber', kind: 'scent',
    blurb: 'Warm, resinous and glowing: labdanum, benzoin, myrrh, the old “oriental”.',
    ACC: 0.7, NOTE: 0.35,
    // The amber accord counts only as far as the bottle is warm (warmAmber):
    // ambroxan reads "amber" too, in Sauvage and Not A Perfume.
    acc: { balsamic: 0.65, vanilla: 0.2, 'warm spicy': 0.15, honey: 0.15 },
    notes: [[N.resin, 0.7], [/vanill|tonka/, 0.15]],
    against: {
      citrus: 0.3, 'fresh spicy': 0.2, aquatic: 0.5, marine: 0.5, ozonic: 0.4, fresh: 0.3, green: 0.3, herbal: 0.2, fruity: 0.15,
      tropical: 0.3, caramel: 0.15, chocolate: 0.15, musky: 0.1, 'white floral': 0.15, rose: 0.1, soapy: 0.3, aldehydic: 0.2,
    },
    accExtra: f => f.acc('amber') * warmAmber(f),
  },
  {
    id: 'oud', label: 'Oud', kind: 'scent',
    blurb: 'Agarwood: dark, medicinal-woody, often with rose and saffron.',
    ACC: 0.85, NOTE: 0.5,
    acc: { oud: 1 },
    notes: [[N.oud, 1]],
    against: {},
  },
  {
    id: 'leather', label: 'Leather', kind: 'scent',
    blurb: 'Suede to biker jacket: birch tar, castoreum, saffron-leather.',
    ACC: 0.85, NOTE: 0.4,
    acc: { leather: 1, animalic: 0.15 },
    // Plain birch is the smoky-fruity Aventus kind as often as leather.
    notes: [[N.leather, 0.85], [/birch(?! leaf| tar)/, 0.35]],
    against: { aquatic: 0.2, marine: 0.2, fruity: 0.1, tropical: 0.2 },
  },
  {
    id: 'tobacco', label: 'Tobacco', kind: 'scent',
    blurb: 'Pipe tobacco, cured leaf and hay, sweet or dry.',
    ACC: 0.85, NOTE: 0.45,
    acc: { tobacco: 1 },
    notes: [[N.tobacco, 1], [/\bhay\b|immortelle/, 0.2]],
    against: { aquatic: 0.2, marine: 0.2 },
  },
  {
    id: 'incense', label: 'Incense & smoke', kind: 'scent',
    blurb: 'Frankincense, myrrh, church smoke, campfire and tar.',
    ACC: 0.7, NOTE: 0.55,
    acc: { smoky: 1, balsamic: 0.2 },
    notes: [[N.incense, 1], [/myrrh|myrhh|opoponax|elemi|palo santo|copal/, 0.45], [/birch(?! leaf| tar)/, 0.35], [/guaiac|gaiac|papyrus|cypriol|nagarmotha|vetiver/, 0.2]],
    against: { sweet: 0.15, fruity: 0.2, tropical: 0.3, caramel: 0.3, aquatic: 0.3, marine: 0.3, citrus: 0.1 },
  },
  {
    id: 'whiteFloral', label: 'White floral', kind: 'scent',
    blurb: 'Jasmine, tuberose, gardenia, orange blossom, ylang: creamy, heady flowers.',
    ACC: 0.75, NOTE: 0.35,
    acc: { 'white floral': 1, tuberose: 1, 'yellow floral': 0.7 },
    notes: [[N.whiteFloral, 0.6]],
    against: { oud: 0.2, leather: 0.15, tobacco: 0.2, aquatic: 0.1 },
  },
  {
    id: 'rose', label: 'Rose', kind: 'scent',
    blurb: 'Rose-led, from dewy petals to jammy rose-oud.',
    ACC: 0.85, NOTE: 0.4,
    acc: { rose: 1 },
    notes: [[N.rose, 0.8]],
    against: {},
  },
  {
    id: 'floral', label: 'Floral', kind: 'scent',
    blurb: 'Airy bouquets: peony, freesia, lily of the valley, lilac, magnolia, violet.',
    ACC: 0.7, NOTE: 0.35,
    acc: { floral: 0.9, violet: 0.25, 'yellow floral': 0.2 },
    notes: [[/peony|freesia|lilac|cyclamen|lily[- ]of[- ]the[- ]valley|lily of the valley|muguet|hyacinth|hiacynth|magnolia|water lily|lotus|orchid|wisteria|sweet pea|carnation|mimosa|lantana|hawthorn|camellia|floral notes|flowers\b|blossom|petals|violet(?! leaf| leaves)|geranium|lily\b|iris flower|cherry blossom|sakura|heliotrope|linden|honeysuckle|marigold|chamomile|daisy|poppy|tulip|gardenia|jasmin|rose\b/, 0.4]],
    against: {
      vanilla: 0.3, caramel: 0.5, chocolate: 0.5, coffee: 0.5, oud: 0.5, leather: 0.4, tobacco: 0.5, smoky: 0.4, amber: 0.25,
      'warm spicy': 0.25, cinnamon: 0.35, balsamic: 0.3, whiskey: 0.5, rum: 0.5, woody: 0.1, aromatic: 0.15, 'fresh spicy': 0.1,
      'white floral': 0.15, tuberose: 0.4, rose: 0.2, fruity: 0.1, sweet: 0.15,
    },
  },
  {
    id: 'powdery', label: 'Powdery & iris', kind: 'scent',
    blurb: 'Iris, violet, heliotrope and aldehydes: cosmetic, lipstick and rice powder.',
    ACC: 0.75, NOTE: 0.35,
    acc: { iris: 1, powdery: 0.75, violet: 0.75, aldehydic: 0.2 },
    notes: [[N.iris, 0.6]],
    against: { aquatic: 0.2, marine: 0.2, tropical: 0.2, citrus: 0.1, 'fresh spicy': 0.05 },
  },
  {
    id: 'woody', label: 'Woody', kind: 'scent',
    blurb: 'Cedar, sandalwood, vetiver, guaiac and hinoki at the core.',
    ACC: 0.7, NOTE: 0.3,
    acc: { woody: 0.85, earthy: 0.4, conifer: 0.45, patchouli: 0.5, paper: 0.25 },
    notes: [[N.wood, 0.4]],
    against: {
      sweet: 0.25, fruity: 0.25, tropical: 0.35, 'white floral': 0.2, tuberose: 0.35, rose: 0.15, floral: 0.1, caramel: 0.35,
      chocolate: 0.3, vanilla: 0.2, citrus: 0.05, aquatic: 0.15, marine: 0.15, musky: 0.05, powdery: 0.1,
    },
  },
  {
    id: 'spicy', label: 'Spicy', kind: 'scent',
    blurb: 'Cinnamon, clove, cardamom, pepper and saffron.',
    ACC: 0.7, NOTE: 0.3,
    acc: { 'warm spicy': 0.9, cinnamon: 0.95, 'fresh spicy': 0.6, 'soft spicy': 0.5, anis: 0.4 },
    notes: [[N.spice, 0.45]],
    against: { aquatic: 0.15, marine: 0.15, tropical: 0.1 },
  },
  {
    id: 'fruity', label: 'Fruity', kind: 'scent',
    blurb: 'Juicy fruit: berries, apple, pear, peach, pineapple, cherry.',
    ACC: 0.75, NOTE: 0.35,
    acc: { fruity: 0.95, tropical: 0.9, cherry: 0.9, sour: 0.2 },
    notes: [[N.fruit, 0.55]],
    against: { oud: 0.15, leather: 0.15, tobacco: 0.15, smoky: 0.15 },
  },
  {
    id: 'chypre', label: 'Chypre & mossy', kind: 'scent',
    blurb: 'Bergamot over oakmoss, patchouli and labdanum: dry, mossy, elegant.',
    ACC: 0.75, NOTE: 0.55,
    acc: { mossy: 1, earthy: 0.15, patchouli: 0.15 },
    notes: [[N.moss, 1], [/patchouli/, 0.2], [/labdanum|cistus/, 0.15]],
    against: { sweet: 0.15, vanilla: 0.2, caramel: 0.3, tropical: 0.2, aquatic: 0.2, marine: 0.2 },
    // Chypre structure: citrus top over moss and patchouli or labdanum.
    extra: f => 0.15 * Math.min(1, f.note(N.oakmoss) + f.acc('mossy'))
      * Math.min(1, f.note(N.citrus) + f.acc('citrus')) * Math.min(1, f.note(N.chypreBase) + f.acc('patchouli') + 0.5 * f.acc('earthy'))
      // Modern chypre: bergamot over patchouli or labdanum, no moss needed, dry
      // rather than sweet, fruity or vanillic (31 Rue Cambon, not Coco Mademoiselle).
      + MODERN_CHYPRE * Math.min(f.note(N.bergamot), Math.max(f.note(N.chypreBase), f.acc('patchouli')))
        * (1 - Math.max(f.acc('sweet'), f.acc('vanilla'), 0.7 * f.acc('fruity'))),
  },
  {
    id: 'boozy', label: 'Boozy', kind: 'scent',
    blurb: 'Rum, cognac, whiskey and liqueur.',
    ACC: 0.85, NOTE: 0.65,
    acc: { whiskey: 1, rum: 1, alcohol: 0.8, wine: 0.8, vodka: 0.7, Champagne: 0.7 },
    notes: [[N.booze, 1]],
    against: { aquatic: 0.2, marine: 0.2 },
  },
];

const BY_ID = new Map(STYLES.map(s => [s.id, s]));
export const styleById = id => BY_ID.get(id) ?? null;
const SCENT = STYLES.filter(s => s.kind === 'scent');

// How warm the bottle's amber is, 0..1: labdanum and benzoin over ambroxan.
function warmAmber(f) {
  const warm = f.note(N.resin) + 0.6 * f.acc('balsamic') + 0.5 * f.acc('vanilla') + 0.3 * f.acc('warm spicy') + 0.3 * f.acc('sweet');
  const cool = f.note(N.ambroxLike) + 0.6 * f.acc('fresh spicy') + 0.5 * f.acc('citrus') + 0.6 * (f.acc('aquatic') + f.acc('marine') + f.acc('ozonic')) + 0.4 * f.acc('musky');
  return clamp(0.35 + 0.65 * (warm + 0.15) / (warm + cool + 0.3));
}

// Close-wearing, by voters' sillage; a soft, quiet character only nudges it.
// Without sillage votes (hand-entered bottles) it stays low.
function intimate(f) {
  if (f.quiet == null) return f.mass ? clamp(0.25 * f.soft) : 0;
  return clamp(0.85 * f.quiet + 0.25 * f.soft - 0.08 - 0.5 * f.loud);
}

// Soft accords vs loud ones, 0..1 (for Intimate).
const SOFT = { musky: 1, powdery: 0.8, iris: 0.8, violet: 0.6, soapy: 0.8, aldehydic: 0.5, green: 0.4, lactonic: 0.5, floral: 0.3, citrus: 0.3, fresh: 0.4, woody: 0.2 };
const LOUD = { sweet: 0.6, oud: 1, caramel: 0.8, vanilla: 0.5, amber: 0.6, 'warm spicy': 0.6, cinnamon: 0.8, tobacco: 0.8, leather: 0.6, animalic: 0.7, tuberose: 0.8, 'white floral': 0.4, fruity: 0.4, tropical: 0.6, smoky: 0.6, balsamic: 0.5, whiskey: 0.7, rum: 0.7, patchouli: 0.5, coffee: 0.6, chocolate: 0.6, honey: 0.6 };

// Scoring runs on slots, not names. Every accord a table names and every note
// pattern gets one; each note name's matches are found once and cached (about
// 2,600 distinct names in the dataset), and each style's tables are compiled
// to [slot, weight] lists. A record then costs a few lookups per accord and
// note instead of a regex test per pattern.
const ACCORD_NAMES = [...new Set([...STYLES.flatMap(s => [...Object.keys(s.acc ?? {}), ...Object.keys(s.against ?? {})]),
  ...Object.keys(SOFT), ...Object.keys(LOUD)])];
const ACCORD_SLOT = new Map(ACCORD_NAMES.map((a, i) => [a, i]));
const PATTERNS = [...new Set([...Object.values(N), ...STYLES.flatMap(s => (s.notes ?? []).map(([re]) => re))])];
const PATTERN_SLOT = new Map(PATTERNS.map((re, i) => [re, i]));
// Salience floors by pattern slot.
const FLOOR = new Float64Array(PATTERNS.length);
for (const s of STYLES) {
  for (const [re, , floor = 0] of s.notes ?? []) {
    const i = PATTERN_SLOT.get(re);
    FLOOR[i] = Math.max(FLOOR[i], floor);
  }
}
const MATCHES = new Map();
const matchesOf = name => {
  let hits = MATCHES.get(name);
  if (!hits) {
    hits = PATTERNS.flatMap((re, i) => (re.test(name) ? [i] : []));
    MATCHES.set(name, hits);
  }
  return hits;
};
// A table as parallel slot and weight arrays.
const terms = (pairs, slotOf) => ({ slot: Int32Array.from(pairs, ([k]) => slotOf.get(k)), w: Float64Array.from(pairs, ([, w]) => w) });
const accordTerms = table => terms(Object.entries(table ?? {}), ACCORD_SLOT);
const COMPILED = STYLES.map(s => ({
  style: s,
  acc: accordTerms(s.acc),
  against: accordTerms(s.against),
  notes: terms(s.notes ?? [], PATTERN_SLOT),
}));
const SOFT_TERMS = accordTerms(SOFT), LOUD_TERMS = accordTerms(LOUD);
const SKIN_LIKE = ['musky', 'woody', 'amber', 'powdery', 'iris', 'animalic', 'salty', 'lactonic', 'soft spicy'];

// Accord strength counts as s^DOMINANCE, so a style has to lead, not just appear.
const DOMINANCE = 1.3;
// Scores rise linearly to SOFT_CAP, then ease toward 1 (no ties at the top).
const SOFT_CAP = 0.8;
const softCap = x => (x <= SOFT_CAP ? Math.max(0, x) : SOFT_CAP + (1 - SOFT_CAP) * (1 - Math.exp(-(x - SOFT_CAP) / (1 - SOFT_CAP))));
const noisyOr = terms => 1 - terms.reduce((p, t) => p * (1 - clamp(t)), 1);
const weigh = ({ slot, w }, values) => {
  let sum = 0;
  for (let k = 0; k < slot.length; k++) sum += w[k] * values[slot[k]];
  return sum;
};
// 1 - the noisy-OR of weight x value over a table.
const missAll = ({ slot, w }, values, miss = 1) => {
  for (let k = 0; k < slot.length; k++) miss *= 1 - clamp(w[k] * values[slot[k]]);
  return miss;
};

/** Features of one record: accord strengths, note saliences, sillage. */
function features(frag) {
  const strength = new Float64Array(ACCORD_NAMES.length);
  const lead = new Float64Array(ACCORD_NAMES.length);
  let mass = 0;
  for (const [a, w] of Object.entries(frag.accords ?? {})) {
    const s = clamp(barStrength(w) / 100);
    mass += s;
    const i = ACCORD_SLOT.get(a);
    if (i === undefined) continue;
    strength[i] = s;
    lead[i] = s ** DOMINANCE;
  }
  // Per pattern, the noisy-OR of its notes' salience.
  const found = new Float64Array(PATTERNS.length);
  const tiers = Object.entries(frag.notes ?? {});
  const count = tiers.reduce((n, [, list]) => n + list.length, 0);
  const votes = frag.noteVotes ?? {};
  let top = 0;
  for (const [, list] of tiers) for (const name of list) top = Math.max(top, votes[name] ?? 0);
  for (const [tier, list] of tiers) {
    for (const name of list) {
      const sal = top > 0 ? Math.max(UNVOTED, (votes[name] ?? 0) / top)
        : count <= FEW_NOTES ? FEW_NOTES_SALIENCE : TIER_SALIENCE[tier] ?? 0.6;
      for (const i of matchesOf(String(name).toLowerCase())) found[i] += Math.max(sal, FLOOR[i]) * (1 - found[i]);
    }
  }
  const acc = a => strength[ACCORD_SLOT.get(a)] ?? 0;
  const note = re => found[PATTERN_SLOT.get(re)];
  const share = list => (mass ? list.reduce((s, a) => s + acc(a), 0) / mass : 0);

  let quiet = null, loud = 0;
  const p = performanceRating(frag);
  if (p?.sillage != null) {
    const n = p.votes.sillage;
    const sil = (n * p.sillage + SILLAGE_PRIOR_VOTES * SILLAGE_MID) / (n + SILLAGE_PRIOR_VOTES);
    quiet = clamp((QUIET_FROM - sil) / QUIET_SPAN);
    loud = clamp((sil - LOUD_FROM) / LOUD_SPAN);
  }
  const soft = clamp(0.5 + 0.5 * Math.tanh(weigh(SOFT_TERMS, strength) - weigh(LOUD_TERMS, strength)));
  return { mass, strength, lead, found, acc, note, share, quiet, loud, soft };
}

function scoreStyle({ style, acc, against, notes }, f) {
  if (style.custom) return softCap(style.custom(f));
  const missA = missAll(acc, f.lead, style.accExtra ? 1 - clamp(style.accExtra(f)) : 1);
  const missN = missAll(notes, f.found);
  let base = style.ACC * (1 - missA) + style.NOTE * (1 - missN) + (style.extra ? style.extra(f) : 0);
  if (style.gate) base *= style.gate(f);
  return softCap(base * Math.exp(-weigh(against, f.strength)));
}

// Filling a copy of a ready-made object beats adding 23 keys one by one.
const ZERO = Object.fromEntries(STYLES.map(s => [s.id, 0]));

/** { styleId: 0..1 } for one engine record, every style including Intimate. */
export function styleScores(frag) {
  const f = features(frag);
  const out = { ...ZERO };
  for (const c of COMPILED) out[c.style.id] = Math.round(1000 * scoreStyle(c, f)) / 1000;
  return out;
}

// The rules below read a scores object, so scores computed elsewhere (ahead
// of time for a pool of bottles) show and count exactly like live ones.

/** The scent styles worth showing from `min`, best first: [{ id, label, score }]. Intimate is apart (closeOf). */
export function topOf(scores, n = 3, min = STYLE_MIN) {
  const out = [];
  for (const s of SCENT) if (scores[s.id] >= min) out.push({ id: s.id, label: s.label, score: scores[s.id] });
  return out.sort((a, b) => b.score - a.score).slice(0, n);
}

// A bottle no style clears STYLE_MIN for shows its best one from this far
// under it as a lean ("Leans skin scent"): Narciso Rodriguez For Her (skin
// scent 0.54), Guerlain Vetiver, Kouros.
export const LEAN_SHOWN = 0.1;

/**
 * The scent styles a card or page shows: topOf, or, when none clears
 * STYLE_MIN, its best within LEAN_SHOWN of it as [{ id, label: "Leans
 * skin scent", score, leans: true }]. Logic reads topOf.
 */
export function shownOf(scores, n = 3) {
  const top = topOf(scores, n);
  if (top.length) return top;
  const [best] = topOf(scores, 1, STYLE_MIN - LEAN_SHOWN);
  return best ? [{ ...best, label: `Leans ${best.label.charAt(0).toLowerCase()}${best.label.slice(1)}`, leans: true }] : [];
}

/** The scent styles a bottle leans toward, which a style mix counts: its top 2 from STYLE_LEAN. */
export const leanOf = scores => topOf(scores, 2, STYLE_LEAN);

/** Whether the scores say it sits close to the skin (the Intimate style). */
export const closeOf = scores => scores.intimate >= WEARS_CLOSE;

/** shownOf for one record (topOf from `min`, when one is given). */
export const topStyles = (frag, n = 3, min = null) => (min == null ? shownOf(styleScores(frag), n) : topOf(styleScores(frag), n, min));

/** closeOf for one record. */
export const wearsClose = frag => closeOf(styleScores(frag));

/**
 * A collection's style mix: how many bottles lean toward each scent style
 * (leanOf), and how many wear close. `scoresOf` can hand back stored scores.
 * -> { total, counts: { styleId: n }, ids: { styleId: [record ids] }, intimate, intimateIds }
 */
export function styleMix(records, scoresOf = styleScores) {
  const counts = Object.fromEntries(SCENT.map(s => [s.id, 0]));
  const ids = Object.fromEntries(SCENT.map(s => [s.id, []]));
  const intimateIds = [];
  for (const r of records) {
    const scores = scoresOf(r);
    for (const s of leanOf(scores)) {
      counts[s.id]++;
      ids[s.id].push(r.id);
    }
    if (closeOf(scores)) intimateIds.push(r.id);
  }
  return { total: records.length, counts, ids, intimate: intimateIds.length, intimateIds };
}
