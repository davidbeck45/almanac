// Occasion presets. `profile` maps accords to how well they suit the occasion
// (-1 wrong for it .. +1 made for it). `performance`, where the occasion cares,
// says how loud and lasting it wants a bottle (sillage, longevity: -1 quiet or
// fleeting .. +1 loud or lasting; Parfumo ratings, see src/engine.js).
// `slot` is the default time of day; `icon` names a stroke icon in src/ui.js.
export const OCCASIONS = [
  {
    id: 'casual',
    label: 'Everyday',
    icon: 'cup',
    blurb: 'Errands, weekends, hanging out',
    slot: 'day',
    profile: {
      'fresh spicy': 0.3, citrus: 0.3, woody: 0.3, aromatic: 0.3, fruity: 0.2, musky: 0.2,
      lavender: 0.2, sweet: 0.1,
      animalic: -0.4, oud: -0.3, caramel: -0.2, leather: -0.2, honey: -0.2,
    },
  },
  {
    id: 'office',
    label: 'Office',
    icon: 'briefcase',
    blurb: 'Close quarters, nothing loud',
    slot: 'day',
    performance: { sillage: -0.7, longevity: 0.3 },
    profile: {
      citrus: 0.6, fresh: 0.6, iris: 0.6, aromatic: 0.5, powdery: 0.5, musky: 0.5, green: 0.5,
      'fresh spicy': 0.4, lavender: 0.4, woody: 0.4, violet: 0.3, herbal: 0.3, 'white floral': 0.2,
      vanilla: -0.2, 'warm spicy': -0.3, balsamic: -0.3, leather: -0.4, tropical: -0.4, coconut: -0.4,
      sweet: -0.5, cinnamon: -0.5, whiskey: -0.5, cacao: -0.5, honey: -0.6, chocolate: -0.6,
      oud: -0.7, caramel: -0.8, animalic: -0.8,
    },
  },
  {
    id: 'date',
    label: 'Date Night',
    icon: 'candle',
    blurb: 'Warm, close, a little sweet',
    slot: 'night',
    performance: { longevity: 0.3 },
    profile: {
      vanilla: 0.7, amber: 0.6, 'warm spicy': 0.5, leather: 0.5, musky: 0.5, whiskey: 0.5,
      sweet: 0.4, rose: 0.4, powdery: 0.4, lactonic: 0.4, cinnamon: 0.4, 'soft spicy': 0.4, balsamic: 0.4,
      iris: 0.3, animalic: 0.3, chocolate: 0.3, cacao: 0.3, caramel: 0.2, honey: 0.2,
      citrus: -0.3, herbal: -0.3, green: -0.4, fresh: -0.4, aquatic: -0.6, ozonic: -0.6,
    },
  },
  {
    id: 'nightout',
    label: 'Night Out',
    icon: 'cocktail',
    blurb: 'Bars, parties, crowds, projection',
    slot: 'night',
    performance: { sillage: 0.5, longevity: 0.2 },
    profile: {
      sweet: 0.7, vanilla: 0.6, fruity: 0.5, 'warm spicy': 0.5, cinnamon: 0.5, amber: 0.5,
      whiskey: 0.4, caramel: 0.4, tropical: 0.3, 'fresh spicy': 0.2, aromatic: 0.1, lavender: 0.1,
      powdery: -0.2, violet: -0.2, iris: -0.3, green: -0.4, earthy: -0.4, mossy: -0.4,
    },
  },
  {
    id: 'formal',
    label: 'Formal',
    icon: 'bowtie',
    blurb: 'Weddings, suits, fancy dinners',
    slot: 'night',
    performance: { sillage: -0.3, longevity: 0.5 },
    profile: {
      iris: 0.7, powdery: 0.6, leather: 0.6, woody: 0.5, amber: 0.4, rose: 0.4, violet: 0.4,
      lavender: 0.4, aromatic: 0.4, oud: 0.3, musky: 0.3, 'warm spicy': 0.3, citrus: 0.1,
      lactonic: -0.2, fruity: -0.4, aquatic: -0.4, ozonic: -0.4, sweet: -0.5, chocolate: -0.5,
      cacao: -0.5, tropical: -0.6, coconut: -0.6, caramel: -0.7,
    },
  },
  {
    id: 'outdoors',
    label: 'Outdoors',
    icon: 'leaf',
    blurb: 'Sun, beach, sports, gym',
    slot: 'day',
    profile: {
      citrus: 0.8, aquatic: 0.8, ozonic: 0.8, fresh: 0.7, green: 0.6, 'fresh spicy': 0.4, herbal: 0.4,
      aromatic: 0.3, tropical: 0.3, fruity: 0.2, coconut: 0.2, musky: 0.1,
      powdery: -0.2, sweet: -0.4, amber: -0.5, 'warm spicy': -0.5, vanilla: -0.6, leather: -0.6,
      cinnamon: -0.6, balsamic: -0.6, animalic: -0.6, chocolate: -0.6, whiskey: -0.5, oud: -0.7,
      honey: -0.7, caramel: -0.8,
    },
  },
  {
    id: 'cozy',
    label: 'Cozy',
    icon: 'sofa',
    blurb: 'Home, movie night, sweater weather',
    slot: 'night',
    profile: {
      vanilla: 0.7, caramel: 0.6, honey: 0.5, powdery: 0.5, lactonic: 0.5, chocolate: 0.5, cacao: 0.5,
      sweet: 0.4, amber: 0.4, cinnamon: 0.4, musky: 0.4, 'soft spicy': 0.3,
      leather: -0.2, oud: -0.2, 'fresh spicy': -0.3, citrus: -0.4, green: -0.4, aquatic: -0.6, ozonic: -0.6,
    },
  },
];

export const occasionById = id => OCCASIONS.find(o => o.id === id);
