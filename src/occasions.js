// Occasion presets. `profile` maps accords to how well they suit the occasion
// (-1 wrong for it .. +1 made for it). `performance`, where the occasion cares,
// says how loud and lasting it wants a bottle (sillage, longevity: -1 quiet or
// fleeting .. +1 loud or lasting, read from both crowds, see src/engine.js;
// `enough` names a wish for more that stops counting at the engine's
// MORE_ENOUGH). `night` weighs a bottle's night votes into the fit on a night
// slot, except in heat (nightLean in src/engine.js).
// `slot` is the default time of day, `phrase` names the occasion in reason
// text ("Woods & aromatics suit casual wear"), `icon` names a stroke icon in
// src/ui.js, and `aliases` are names it went by, which typed names still find.
// `outside` is the share of the time spent outside, 0..1: how much of the
// cold a thin bottle pays for in the engine (COLD_WEIGHT) and the spray guide
// adds sprays for (you spray for where you'll be, and a heated room takes the
// chill off). One spent wholly indoors (0) pays nothing for heat either
// (HEAT_WEIGHT): the weather outside doesn't decide what suits a night in.
export const OCCASIONS = [
  {
    id: 'casual',
    label: 'Casual',
    aliases: ['everyday'],
    icon: 'cup',
    blurb: 'Errands, weekends, hanging out',
    slot: 'day',
    phrase: 'casual wear',
    outside: 1,
    profile: {
      'fresh spicy': 0.3, citrus: 0.3, woody: 0.3, aromatic: 0.3, fresh: 0.3, fruity: 0.2, musky: 0.2, lavender: 0.2,
      green: 0.2, herbal: 0.2, aquatic: 0.2, ozonic: 0.2, marine: 0.2, sweet: 0.1, powdery: 0.1, 'white floral': 0.1,
      floral: 0.1, earthy: 0.1, iris: 0.1, 'soft spicy': 0.1, coconut: 0.1, rose: 0.1, aldehydic: 0.1,
      'yellow floral': 0.1, tropical: 0.1, violet: 0.1, salty: 0.1,
      vanilla: 0, 'warm spicy': 0, amber: 0, patchouli: 0, mossy: 0, almond: 0, nutty: 0, lactonic: 0, coffee: 0,
      cherry: 0,
      balsamic: -0.1, cinnamon: -0.1, cacao: -0.1, tuberose: -0.1, caramel: -0.2, leather: -0.2, honey: -0.2,
      tobacco: -0.2, smoky: -0.2, chocolate: -0.2, whiskey: -0.2, rum: -0.2, oud: -0.3, animalic: -0.4,
    },
  },
  {
    id: 'office',
    label: 'Office',
    icon: 'briefcase',
    blurb: 'Close quarters, nothing loud',
    slot: 'day',
    phrase: 'the office',
    outside: 0.15,
    // Moderate projection that lasts the working day: a quiet bottle counts
    // only down to the engine's LESS_ENOUGH, one that fades counts against,
    // and one that lasts past the day only up to MORE_ENOUGH (`enough`). The
    // wish for less is the most there is: at -0.7 a fresh bottle as loud as
    // Sauvage still made the top 3 on mild nights, and members' "too loud for
    // the office" agree with the fit more the stronger it is.
    performance: { sillage: -1, longevity: 0.5, enough: ['longevity'] },
    profile: {
      citrus: 0.6, fresh: 0.6, iris: 0.6, aromatic: 0.5, powdery: 0.5, musky: 0.5, green: 0.5, soapy: 0.5,
      'fresh spicy': 0.4, lavender: 0.4, woody: 0.4, aldehydic: 0.4, aquatic: 0.4, ozonic: 0.4, marine: 0.4,
      violet: 0.3, herbal: 0.3, 'white floral': 0.2, mossy: 0.2, floral: 0.1, earthy: 0.1, rose: 0.1, salty: 0.1,
      'soft spicy': 0, 'yellow floral': 0,
      fruity: -0.1, patchouli: -0.1, lactonic: -0.1, vanilla: -0.2, almond: -0.2, nutty: -0.2, coffee: -0.2,
      'warm spicy': -0.3, balsamic: -0.3, amber: -0.3, cherry: -0.3, leather: -0.4, tropical: -0.4, coconut: -0.4,
      smoky: -0.4, tuberose: -0.4, sweet: -0.5, cinnamon: -0.5, whiskey: -0.5, cacao: -0.5, tobacco: -0.5, rum: -0.5,
      honey: -0.6, chocolate: -0.6, oud: -0.7, caramel: -0.8, animalic: -0.8,
    },
  },
  {
    id: 'date',
    label: 'Date Night',
    icon: 'candle',
    blurb: 'Warm, close, a little sweet',
    slot: 'night',
    phrase: 'a date',
    outside: 0.3,
    performance: { longevity: 0.3 },
    night: 0.3,
    profile: {
      vanilla: 0.7, amber: 0.6, 'warm spicy': 0.5, leather: 0.5, musky: 0.5, whiskey: 0.5, sweet: 0.4, rose: 0.4,
      powdery: 0.4, lactonic: 0.4, cinnamon: 0.4, 'soft spicy': 0.4, balsamic: 0.4, tuberose: 0.4, tobacco: 0.4,
      rum: 0.4, iris: 0.3, animalic: 0.3, chocolate: 0.3, cacao: 0.3, 'white floral': 0.3, oud: 0.3, almond: 0.3,
      cherry: 0.3, coffee: 0.3, caramel: 0.2, honey: 0.2, woody: 0.2, floral: 0.2, patchouli: 0.2, nutty: 0.2,
      fruity: 0.1, coconut: 0.1, smoky: 0.1, 'yellow floral': 0.1, violet: 0.1,
      'fresh spicy': 0, aromatic: 0, earthy: 0, aldehydic: 0, lavender: 0, tropical: 0,
      mossy: -0.1, salty: -0.2, citrus: -0.3, herbal: -0.3, soapy: -0.3, green: -0.4, fresh: -0.4, aquatic: -0.6,
      ozonic: -0.6, marine: -0.6,
    },
  },
  {
    id: 'nightout',
    label: 'Night Out',
    icon: 'cocktail',
    blurb: 'Bars, parties, crowds, projection',
    slot: 'night',
    phrase: 'a night out',
    outside: 0.5,
    performance: { sillage: 0.5, longevity: 0.2 },
    night: 0.3,
    profile: {
      sweet: 0.7, vanilla: 0.6, fruity: 0.5, 'warm spicy': 0.5, cinnamon: 0.5, amber: 0.5, whiskey: 0.4, caramel: 0.4,
      cherry: 0.4, rum: 0.4, tropical: 0.3, leather: 0.3, tobacco: 0.3, honey: 0.3, almond: 0.3, oud: 0.3,
      coffee: 0.3, chocolate: 0.3, cacao: 0.3, 'fresh spicy': 0.2, balsamic: 0.2, 'soft spicy': 0.2, coconut: 0.2,
      nutty: 0.2, tuberose: 0.2, aromatic: 0.1, lavender: 0.1, woody: 0.1, musky: 0.1, 'white floral': 0.1,
      animalic: 0.1, patchouli: 0.1, smoky: 0.1, lactonic: 0.1,
      citrus: 0, fresh: 0, floral: 0, rose: 0, 'yellow floral': 0, salty: 0,
      powdery: -0.2, violet: -0.2, aquatic: -0.2, ozonic: -0.2, marine: -0.2, aldehydic: -0.2, iris: -0.3,
      herbal: -0.3, green: -0.4, earthy: -0.4, mossy: -0.4, soapy: -0.4,
    },
  },
  {
    id: 'formal',
    label: 'Formal',
    icon: 'bowtie',
    blurb: 'Weddings, suits, fancy dinners',
    slot: 'night',
    phrase: 'formal wear',
    outside: 0.3,
    performance: { sillage: -0.3, longevity: 0.5 },
    profile: {
      iris: 0.7, powdery: 0.6, leather: 0.6, woody: 0.5, aldehydic: 0.5, amber: 0.4, rose: 0.4, violet: 0.4,
      lavender: 0.4, aromatic: 0.4, mossy: 0.4, oud: 0.3, musky: 0.3, 'warm spicy': 0.3, 'white floral': 0.3,
      balsamic: 0.3, patchouli: 0.3, 'soft spicy': 0.3, tobacco: 0.3, 'fresh spicy': 0.2, floral: 0.2, earthy: 0.2,
      smoky: 0.2, tuberose: 0.2, soapy: 0.2, citrus: 0.1, animalic: 0.1,
      vanilla: 0, fresh: 0, green: 0, herbal: 0, cinnamon: 0, 'yellow floral': 0, whiskey: 0,
      lactonic: -0.2, almond: -0.2, nutty: -0.2, coffee: -0.2, rum: -0.2, salty: -0.2, honey: -0.3, fruity: -0.4,
      aquatic: -0.4, ozonic: -0.4, marine: -0.4, cherry: -0.4, sweet: -0.5, chocolate: -0.5, cacao: -0.5,
      tropical: -0.6, coconut: -0.6, caramel: -0.7,
    },
  },
  {
    id: 'outdoors',
    label: 'Outdoors',
    icon: 'leaf',
    blurb: 'Sun, beach, sports, gym',
    slot: 'day',
    phrase: 'the outdoors',
    outside: 1,
    profile: {
      citrus: 0.8, aquatic: 0.8, ozonic: 0.8, marine: 0.8, fresh: 0.7, green: 0.6, salty: 0.6, 'fresh spicy': 0.4,
      herbal: 0.4, aromatic: 0.3, tropical: 0.3, fruity: 0.2, coconut: 0.2, lavender: 0.2, soapy: 0.2, musky: 0.1,
      earthy: 0.1, mossy: 0.1, 'yellow floral': 0.1,
      woody: 0, 'white floral': 0, floral: 0, aldehydic: 0, violet: 0,
      rose: -0.1, powdery: -0.2, iris: -0.2, patchouli: -0.2, 'soft spicy': -0.2, cherry: -0.2, lactonic: -0.3,
      tuberose: -0.3, sweet: -0.4, almond: -0.4, smoky: -0.4, nutty: -0.4, coffee: -0.4, amber: -0.5,
      'warm spicy': -0.5, whiskey: -0.5, rum: -0.5, vanilla: -0.6, leather: -0.6, cinnamon: -0.6, balsamic: -0.6,
      animalic: -0.6, chocolate: -0.6, tobacco: -0.6, cacao: -0.6, oud: -0.7, honey: -0.7, caramel: -0.8,
    },
  },
  {
    id: 'cozy',
    label: 'Cozy',
    icon: 'sofa',
    blurb: 'Home, movie night, sweater weather',
    slot: 'night',
    phrase: 'a night in',
    // The gap finder weighs its warm and hot nights down instead (USES' bands).
    outside: 0,
    profile: {
      vanilla: 0.7, caramel: 0.6, honey: 0.5, powdery: 0.5, lactonic: 0.5, chocolate: 0.5, cacao: 0.5, sweet: 0.4,
      amber: 0.4, cinnamon: 0.4, musky: 0.4, 'warm spicy': 0.4, almond: 0.4, nutty: 0.4, coffee: 0.4,
      'soft spicy': 0.3, balsamic: 0.3, coconut: 0.3, tobacco: 0.3, rum: 0.3, woody: 0.2, lavender: 0.2, iris: 0.2,
      cherry: 0.2, whiskey: 0.2, fruity: 0.1, floral: 0.1, rose: 0.1, smoky: 0.1, soapy: 0.1,
      aromatic: 0, 'white floral': 0, earthy: 0, patchouli: 0, aldehydic: 0, 'yellow floral': 0,
      mossy: -0.1, tuberose: -0.1, leather: -0.2, oud: -0.2, animalic: -0.2, herbal: -0.2, 'fresh spicy': -0.3,
      fresh: -0.3, salty: -0.3, citrus: -0.4, green: -0.4, aquatic: -0.6, ozonic: -0.6, marine: -0.6,
    },
  },
];

export const occasionById = id => OCCASIONS.find(o => o.id === id);

// The raw occasion fit (occasionRaw in src/engine.js) that reads as 0 and as 1:
// its 2nd and 98th percentile over the dataset's 8,000 bottles with 500+
// rating votes, never narrower than the accords' fit alone spans (Office's
// top is the accords'). Fitted by `node scripts/fit-occasions.mjs --write`.
export const OCCASION_SCALE = { casual: [-0.026, 0.249], office: [-0.49, 0.446], date: [-0.236, 0.471], nightout: [-0.281, 0.552], formal: [-0.336, 0.402], outdoors: [-0.427, 0.423], cozy: [-0.189, 0.417] };
