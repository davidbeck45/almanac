// Per-accord metadata.
// prior: how warm/heavy (+1) vs. fresh/light (-1) an accord wears, judged by hand.
// weight: the prior nudged toward how Fragrantica voters wear the bottles in
//   data/ (`npm run fit` refits it). Drives the weather modifier: heat and
//   humidity punish heavy scents, cold rewards them. A new accord starts with
//   weight equal to its prior. Accords only bottles outside data/ carry
//   (alcohol, conifer, sour…) take their prior from their season profile in
//   src/profiles.js: weight ≈ 0.14 + 0.79 × (winter + fall − spring − summer),
//   the line the fitted accords follow (r 0.91).
// color: chip color, roughly following Fragrantica's accord palette.
export const ACCORDS = {
  vanilla:        { prior:  1.0, weight:  1.00, color: '#f3e2b3' },
  caramel:        { prior:  1.0, weight:  0.90, color: '#c98a3d' },
  chocolate:      { prior:  1.0, weight:  1.00, color: '#6b3f26' },
  cacao:          { prior:  0.9, weight:  0.85, color: '#7a4a2e' },
  coffee:         { prior:  0.9, weight:  0.90, color: '#5b3a29' },
  honey:          { prior:  0.9, weight:  1.00, color: '#e3a62b' },
  beeswax:        { prior:  0.10, weight:  0.10, color: '#e8c45a' },
  oud:            { prior:  1.0, weight:  0.75, color: '#5a3a2a' },
  tobacco:        { prior:  1.0, weight:  1.00, color: '#8a5a33' },
  whiskey:        { prior:  0.9, weight:  0.90, color: '#b36b1f' },
  rum:            { prior:  0.9, weight:  0.90, color: '#8f4a1f' },
  alcohol:        { prior:  0.45, weight:  0.45, color: '#d6e4ea' },
  wine:           { prior:  0.30, weight:  0.30, color: '#7b1f3a' },
  vodka:          { prior:  0.05, weight:  0.05, color: '#e6eef2' },
  Champagne:      { prior: -0.15, weight: -0.15, color: '#f1e2a8' },
  leather:        { prior:  0.9, weight:  0.90, color: '#6e4b3a' },
  smoky:          { prior:  0.7, weight:  0.65, color: '#6f6a66' },
  amber:          { prior:  0.9, weight:  0.65, color: '#d9822b' },
  balsamic:       { prior:  0.9, weight:  0.90, color: '#a0663a' },
  cinnamon:       { prior:  0.9, weight:  1.00, color: '#b5542c' },
  'warm spicy':   { prior:  0.8, weight:  1.00, color: '#c4452f' },
  animalic:       { prior:  0.8, weight:  0.95, color: '#8b6f5a' },
  sweet:          { prior:  0.7, weight:  0.20, color: '#e27a9c' },
  gourmand:       { prior:  0.15, weight:  0.15, color: '#b5774a' },
  'coca-cola':    { prior:  0.00, weight:  0.00, color: '#5a2a1a' },
  almond:         { prior:  0.6, weight:  0.55, color: '#e2c79c' },
  cherry:         { prior:  0.4, weight:  0.30, color: '#b0213a' },
  nutty:          { prior:  0.6, weight:  0.65, color: '#9c6b3f' },
  lactonic:       { prior:  0.5, weight:  0.10, color: '#f1ead8' },
  'soft spicy':   { prior:  0.4, weight:  0.60, color: '#d77a5b' },
  woody:          { prior:  0.3, weight:  0.50, color: '#8a6446' },
  conifer:        { prior:  0.15, weight:  0.15, color: '#2f6b45' },
  earthy:         { prior:  0.3, weight:  0.40, color: '#7b6a4f' },
  mineral:        { prior: -0.10, weight: -0.10, color: '#9aa7ad' },
  sand:           { prior: -0.10, weight: -0.10, color: '#d9c39a' },
  patchouli:      { prior:  0.5, weight:  0.55, color: '#6b5a3a' },
  rose:           { prior:  0.2, weight:  0.10, color: '#e0607e' },
  powdery:        { prior:  0.2, weight:  0.00, color: '#e8d6e3' },
  coconut:        { prior:  0.2, weight: -0.60, color: '#f4efe4' },
  musky:          { prior:  0.1, weight: -0.30, color: '#cbbfd6' },
  iris:           { prior:  0.1, weight:  0.05, color: '#a99bd6' },
  'white floral': { prior:  0.1, weight:  0.00, color: '#f2f0e6' },
  tuberose:       { prior:  0.3, weight:  0.10, color: '#f4e6ef' },
  'yellow floral': { prior:  0.1, weight: -0.30, color: '#f2d24b' },
  floral:         { prior:  0.0, weight:  0.25, color: '#f09bb8' },
  violet:         { prior:  0.0, weight: -0.25, color: '#8f6bc4' },
  savory:         { prior:  0.0, weight: -0.10, color: '#b9a37e' },
  paper:          { prior:  0.0, weight:  0.05, color: '#d9d3c3' },
  aldehydic:      { prior:  0.0, weight:  0.20, color: '#dfe7f2' },
  mossy:          { prior: -0.1, weight: -0.05, color: '#5f7a45' },
  fruity:         { prior: -0.2, weight: -0.35, color: '#f06a5a' },
  metallic:       { prior: -0.3, weight: -0.30, color: '#a7adb5' },
  tropical:       { prior: -0.3, weight: -0.60, color: '#f5a623' },
  terpenic:       { prior: -0.3, weight: -0.40, color: '#7a9a3c' },
  lavender:       { prior: -0.3, weight:  0.05, color: '#9b8fd9' },
  soapy:          { prior: -0.2, weight: -0.20, color: '#e3eef4' },
  aromatic:       { prior: -0.4, weight:  0.15, color: '#4f9a82' },
  herbal:         { prior: -0.5, weight: -0.35, color: '#6c9a4a' },
  anis:           { prior:  0.30, weight:  0.30, color: '#b9a46a' },
  cannabis:       { prior:  0.15, weight:  0.15, color: '#5c8a3a' },
  bitter:         { prior: -0.10, weight: -0.10, color: '#8a9a3a' },
  camphor:        { prior: -0.15, weight: -0.15, color: '#bfe3dc' },
  'fresh spicy':  { prior: -0.5, weight: -0.15, color: '#7cc36a' },
  salty:          { prior: -0.5, weight: -0.55, color: '#c9d6dc' },
  green:          { prior: -0.8, weight: -1.00, color: '#3fae5a' },
  fresh:          { prior: -0.9, weight: -0.75, color: '#8fd6e8' },
  citrus:         { prior: -1.0, weight: -1.00, color: '#e5e84a' },
  sour:           { prior: -0.10, weight: -0.10, color: '#c8d84a' },
  aquatic:        { prior: -1.0, weight: -1.00, color: '#3fa7d6' },
  marine:         { prior: -1.0, weight: -1.00, color: '#2f7fb8' },
  ozonic:         { prior: -1.0, weight: -1.00, color: '#9fd3ee' },
};

// Fragrantica draws an accord's bar 30% + 0.7 × its strength wide. Records keep
// the bar's width (what scripts/fragrantica-extract.js reads, and what the
// weights above are tuned on); Le Decanteur's dataset has the strength itself.
const BAR_FLOOR = 30;
const BAR_SLOPE = 0.7;
export const barWidth = strength => Math.round(BAR_FLOOR + BAR_SLOPE * strength);
export const barStrength = width => Math.max(0, (width - BAR_FLOOR) / BAR_SLOPE);

export function accordColor(name) {
  return ACCORDS[name]?.color ?? '#9aa0ad';
}

// Strength-weighted heaviness of a fragrance, -1 (fresh) .. +1 (heavy).
// Remembered per accords object (records never change theirs): weather fit
// asks for it in every window, so a week plan or a pool scan asks thousands
// of times.
const heavinessOf = new WeakMap();
export function heaviness(accords) {
  let h = heavinessOf.get(accords);
  if (h !== undefined) return h;
  let sum = 0, total = 0;
  for (const [name, strength] of Object.entries(accords)) {
    const meta = ACCORDS[name];
    if (!meta) continue;
    sum += strength * meta.weight;
    total += strength;
  }
  h = total ? sum / total : 0;
  heavinessOf.set(accords, h);
  return h;
}

// Copy names accords as nouns: engine reasons ("Warm spice for the cold",
// "Woods & aromatics suit casual wear", never "Warm warm spicy") and shared
// traits ("sharing vanilla, warm spice and woods"). An accord not listed
// reads as its own name (vanilla, leather, iris).
const ACCORD_NOUN = {
  woody: 'woods', 'warm spicy': 'warm spice', 'fresh spicy': 'crisp spice', 'soft spicy': 'soft spice',
  aromatic: 'aromatics', sweet: 'sweetness', fresh: 'fresh notes', green: 'green notes', aquatic: 'aquatic notes',
  marine: 'marine notes', ozonic: 'airy notes', earthy: 'earthy notes', musky: 'musk', powdery: 'powder',
  fruity: 'fruit', floral: 'florals', 'white floral': 'white florals', 'yellow floral': 'yellow florals',
  balsamic: 'resins', animalic: 'animalic notes', smoky: 'smoke', lactonic: 'milky notes', herbal: 'herbs',
  mossy: 'moss', tropical: 'tropical fruit', salty: 'sea salt', metallic: 'metallic notes', soapy: 'soap',
  mineral: 'mineral notes', terpenic: 'terpenes', savory: 'savory notes', nutty: 'nuts', gourmand: 'gourmand notes',
  'coca-cola': 'cola', aldehydic: 'aldehydes', conifer: 'pine', bitter: 'bitter notes', sour: 'sour notes',
  alcohol: 'boozy notes', anis: 'anise', camphor: 'camphor notes',
};
/** An accord as a noun for copy: "woods", "warm spice", "aldehydes"; an accord not listed reads as its own name. */
export const accordNoun = accord => ACCORD_NOUN[accord] ?? String(accord).toLowerCase();
