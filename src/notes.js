// The note glossary: what a note in a bottle's pyramid is and what it smells
// like, in our own words, for the bottle page's Notes (src/views/bottle-notes.js).
// Pure, and loaded only when a note is first opened: it's all text.
//
// GLOSSARY rows are [pattern, name, kind, what it is, what it smells like].
// First match wins, as in layering's NOTE_FAMILIES, so a specific name goes
// before the word it contains ("orange blossom" before "orange", "pink
// pepper" before "pepper", "oakmoss" before "oak"). A note no row names
// falls back on its family's line (noteFamily, FAMILIES): "A woody note.",
// so every note that layering can place says something. test/notes.test.js
// holds the coverage and the traps.
import { noteFamily } from './layering.js';

const GLOSSARY = [
  // ---------- Musks and ambers ----------
  [/white musk|clean musk|cotton musk|ambrettolide|galaxolide|muscone|habanolide/, 'White musk', 'Aroma molecules', 'A family of lab-made musks, built to replace the animal musk perfumery gave up long ago. They hold a scent on skin for hours.', 'Clean and soft, like warm laundry or just-washed skin. Some people can’t smell certain musks at all, so it reads faint to them.'],
  [/ambrette|musk mallow/, 'Ambrette', 'Seed', 'The seed of a hibiscus relative, the one plant that makes a true musk. Costly, so used in small doses.', 'Soft, skin-like musk with a hint of pear and a faint boozy, nutty edge.'],
  [/musk/, 'Musk', 'Aroma molecules', 'Once taken from the musk deer, now always made in a lab. It’s the soft base under most perfumes and what lingers on a shirt the next day.', 'Warm, smooth and skin-like: clean in some bottles, a little animal in others. More a texture than a smell of its own.'],
  [/ambrox|ambrofix|cetalox|ambermax/, 'Ambroxan', 'Aroma molecule', 'A molecule first found in ambergris and now made from clary sage. It’s the backbone of many modern fresh scents and carries a long way.', 'Dry, mineral and musky-woody, like warm skin after the sea. Clean and a little salty, never sweet.'],
  [/ambergris|ambre gris|grey amber/, 'Ambergris', 'Animal note', 'A waxy lump from sperm whales that cures for years at sea. Nearly every bottle uses a lab-made stand-in such as Ambroxan.', 'Salty, warm and skin-like, with a sweet marine depth. It makes the notes around it glow and last.'],
  [/amber ?wood|moxalone|amber xtreme|woody amber/, 'Amberwood', 'Aroma molecules', 'Powerful lab-made woody ambers. They give modern scents their reach and staying power.', 'Dry, radiant wood with a warm amber hum. Smooth in small doses, sharp and scratchy when pushed.'],
  [/amber/, 'Amber', 'Accord', 'Not one material but a blend, usually labdanum, benzoin and vanilla. It’s named for the golden resin it calls to mind, which has no smell.', 'Warm, sweet and resinous, like vanilla with a balsamic, slightly powdery glow. Cozy and rich.'],

  // ---------- Vanilla, sweets and gourmands ----------
  [/tonka|coumarin/, 'Tonka bean', 'Seed', 'The seed of a South American tree, rich in coumarin, the molecule that also gives cut hay its smell.', 'Sweet and warm, between vanilla and almond, with a touch of hay and tobacco. Rounder and less sugary than vanilla.'],
  [/benzoin/, 'Benzoin', 'Resin', 'A resin tapped from styrax trees in Southeast Asia. It fixes a scent to skin and rounds its base.', 'Sweet and balsamic, like vanilla with a hint of cinnamon and warm wood. Soft and comforting.'],
  [/vanil/, 'Vanilla', 'Spice', 'The cured pod of an orchid, grown mostly in Madagascar. Much of what’s in a bottle is vanillin, its main molecule, made in a lab.', 'Sweet, creamy and warm. It can read like dessert, or dark, boozy and a little smoky when the whole pod is used.'],
  [/praline/, 'Praline', 'Gourmand accord', 'An accord built to smell like nuts cooked in caramelized sugar.', 'Toasted nuts and caramel: sweet, warm and a little burnt at the edges.'],
  [/caramel|toffee|butterscotch|dulce de leche|maltol/, 'Caramel', 'Gourmand accord', 'An accord of lab-made sweet notes such as ethyl maltol, the smell of sugar as it browns.', 'Burnt sugar and butter: sweet, sticky and warm, sometimes a little salty.'],
  [/marshmallow|cotton candy|candy floss|meringue|spun sugar/, 'Spun sugar', 'Gourmand accord', 'Sweet accords built on ethyl maltol and vanillin, the smell of a fairground.', 'Airy, fluffy sweetness: sugar with a puff of vanilla and powder.'],
  [/brown sugar|sugar|syrup/, 'Sugar', 'Gourmand accord', 'A lab-built sweetness, plain or browned.', 'Sweet and clean, from white and crystalline to dark and treacly.'],
  [/honey(?!suckle)/, 'Honey', 'Sweet note', 'Usually an accord, sometimes beeswax absolute. A little goes a long way.', 'Thick, golden sweetness with a floral and slightly animal edge. In high doses it can turn sharp.'],
  [/beeswax/, 'Beeswax', 'Animal note', 'An absolute taken from the honeycomb.', 'Warm wax and honey with a touch of hay and pollen.'],
  [/dark chocolate|chocolate|cacao|cocoa/, 'Chocolate', 'Gourmand note', 'From cacao extract or an accord built with patchouli and vanilla.', 'Dark, dusty and bittersweet, more cocoa powder than a candy bar.'],
  [/coffee|espresso|cappuccino|mocha/, 'Coffee', 'Gourmand note', 'From roasted bean extracts or a lab-built accord.', 'Roasted, bitter and warm. It gives sweet scents a dark, grown-up edge.'],
  [/pistachio/, 'Pistachio', 'Gourmand accord', 'A lab-built nut note, popular in recent sweet scents.', 'Nutty, green and creamy, with a touch of almond and something like ice cream.'],
  [/hazelnut|chestnut|walnut|peanut|\bnuts?\b/, 'Nuts', 'Gourmand accord', 'Lab-built nut notes that give a sweet scent some toast.', 'Roasted, buttery and a little woody.'],
  [/bitter almond|almond|marzipan/, 'Almond', 'Gourmand note', 'Mostly benzaldehyde, the molecule that makes almond extract and cherry pits smell as they do.', 'Sweet marzipan with a bitter, cherry-like edge. Powdery and soft.'],
  [/coconut/, 'Coconut', 'Fruit', 'Built from lactones, since the fruit itself gives up little scent.', 'Creamy, milky and sweet, the smell of sun lotion and beach days.'],
  [/whipped cream|cream|milk|butter|lacton/, 'Milk and cream', 'Gourmand accord', 'Built from lactones, the molecules that make dairy, peach and coconut smell creamy.', 'Soft, smooth and faintly sweet, like warm milk. It rounds off everything sharp.'],
  [/\brice/, 'Rice', 'Gourmand accord', 'A lab-built note of steamed rice or rice powder.', 'Soft, starchy and milky, with a clean powdery warmth.'],
  [/dates?\b/, 'Dates', 'Fruit', 'A dried-fruit accord, common in Middle Eastern perfumery.', 'Dark, sticky sweetness, like honeyed dried fruit with a touch of caramel.'],

  // ---------- Booze, tobacco and leather ----------
  [/\brum\b/, 'Rum', 'Boozy note', 'From rum extracts or an accord of sweet, fermented notes.', 'Dark sugar, molasses and warm spirit. It gives vanilla and tobacco a boozy glow.'],
  [/whisk|bourbon(?! geranium| vetiver)|cognac|brandy|liquor|liqueur|\bspirits?\b/, 'Spirits', 'Boozy note', 'From cognac oil or accords built to smell like aged spirits.', 'Warm, oaky and a little sweet, with dried fruit and vanilla from the barrel.'],
  [/champagne|wine/, 'Wine', 'Boozy note', 'An accord, fizzy for champagne or deep and fruity for red wine.', 'Sparkling and tart, or dark and grape-like.'],
  [/tobacco/, 'Tobacco', 'Leaf', 'From the cured leaf, as an absolute or an accord. Nothing like cigarette smoke.', 'Sweet, dry and leafy, like an unlit cigar or a pipe tin: honey, hay and a little dried fruit.'],
  [/suede/, 'Suede', 'Leather accord', 'A softer take on leather, built from lab-made notes.', 'Velvety, powdery leather: a new glove, not a saddle.'],
  [/leather/, 'Leather', 'Accord', 'Always an accord: hide has no extract. Built from birch tar, labdanum, saffron notes and lab molecules.', 'Smoky, dry and animal, like a new jacket or car seats. It ranges from soft and buttery to tarry.'],
  [/birch/, 'Birch', 'Wood', 'Birch tar, made by charring the wood. It’s the classic route to a leather note.', 'Smoky and tarry, like campfire and worn leather.'],

  // ---------- Resins, incense and smoke ----------
  [/labdanum|cistus/, 'Labdanum', 'Resin', 'A sticky resin from the rockrose shrub of the Mediterranean, the heart of most amber accords.', 'Deep, warm and leathery-sweet, with a balsamic, slightly animal richness.'],
  [/olibanum|frankincense/, 'Frankincense', 'Resin', 'The dried sap of Boswellia trees from Oman, Somalia and Yemen, burned as incense for thousands of years.', 'Cool, lemony and peppery when fresh; smoky and churchlike as it settles.'],
  [/incense/, 'Incense', 'Accord', 'Usually frankincense, sometimes a blend of resins built to smell like the incense of a church or temple.', 'Smoky, dry and resinous, cool at first and warmer as it burns down.'],
  [/myrr?h/, 'Myrrh', 'Resin', 'A resin from thorny trees in the Horn of Africa and Arabia.', 'Warm, bitter and medicinal, with a mushroomy sweetness. Darker and earthier than frankincense.'],
  [/opoponax/, 'Opoponax', 'Resin', 'Also called sweet myrrh, a resin from East Africa.', 'Sweet, balsamic and powdery, softer and warmer than myrrh.'],
  [/elemi/, 'Elemi', 'Resin', 'A resin from a Philippine tree, related to frankincense.', 'Bright, lemony and peppery, with a piney freshness. It lifts heavy resins.'],
  [/styrax/, 'Styrax', 'Resin', 'A balsam from liquidambar trees.', 'Sweet, leathery and a little smoky, with a hint of cinnamon.'],
  [/peru balsam|tolu|balsam(?! fir)/, 'Balsam', 'Resin', 'Thick, sweet tree balsams, from Central and South America for Peru and Tolu.', 'Vanilla-like and cinnamon-warm, soft and resinous.'],
  [/palo santo/, 'Palo santo', 'Wood', 'A South American “holy wood”, burned as incense.', 'Sweet, minty and woody, with a soft citrus-and-smoke edge.'],
  [/resin/, 'Resins', 'Resin', 'Tree saps that harden in air, used in incense and in a perfume’s base.', 'Warm, sweet and balsamic, with some smoke.'],
  [/smok|burnt|\bash\b/, 'Smoke', 'Accord', 'Built from birch tar, cade oil or guaiac wood.', 'Woodsmoke and char, from a blown-out candle to a campfire.'],

  // ---------- Animal notes ----------
  [/civet/, 'Civet', 'Animal note', 'Once from the civet cat, now always lab-made (civetone).', 'Dirty and warm on its own; in traces it makes florals feel alive and skin-like.'],
  [/castoreum/, 'Castoreum', 'Animal note', 'Once from beavers, now recreated in the lab.', 'Leathery, smoky and a little sweet, like warm fur and birch tar.'],

  // ---------- Oud and woods ----------
  [/\boud|agarwood|kyara/, 'Oud', 'Wood', 'The resin-soaked heartwood of the aquilaria tree, formed when the tree fights off a mold. Real oud is among the costliest materials there is, so most bottles use an accord.', 'Dark, woody and animal, with leather, smoke and a medicinal edge. Western ouds are smoother and cleaner than the real thing.'],
  [/sandal/, 'Sandalwood', 'Wood', 'The heartwood of the sandalwood tree. Indian Mysore wood is rare now, so most is Australian or lab-made.', 'Creamy, milky and soft, the smoothest of the woods. Warm and a little sweet, never sharp.'],
  [/cashmer/, 'Cashmere wood', 'Aroma molecule', 'Cashmeran, a lab molecule named for the feel it gives a scent.', 'Soft, musky wood with a warm, slightly spicy and damp-concrete side. Cozy, like a sweater.'],
  [/iso e super|georgywood/, 'Iso E Super', 'Aroma molecule', 'A lab molecule found in a huge share of modern perfumes; Molecule 01 is nothing else. Georgywood is a stronger cousin.', 'A sheer, velvety cedar hum that comes and goes. Many people smell it only in waves, and others smell it on them more than they do.'],
  [/akigala/, 'Akigalawood', 'Aroma molecule', 'A material made from patchouli oil by a biotech process.', 'Peppery, woody patchouli without the earth: dry and spicy, with a hint of oud.'],
  [/guaiac/, 'Guaiac wood', 'Wood', 'Oil from a dense South American wood.', 'Smoky, sweet and tarry, a little like smoked tea or a rosy leather.'],
  [/rosewood/, 'Rosewood', 'Wood', 'A Brazilian wood, protected now, so mostly rebuilt from linalool.', 'Soft, rosy and lightly spiced wood.'],
  [/cedar/, 'Cedar', 'Wood', 'From Virginia cedar (a juniper, the pencil wood) or Atlas cedar from Morocco.', 'Dry and clean, like pencil shavings or a cedar chest. Atlas cedar is warmer and a little sweet.'],
  [/vet[iy]ver/, 'Vetiver', 'Root', 'The roots of a tropical grass, grown mostly in Haiti and Java.', 'Earthy, dry and green, like roots and damp soil with a smoky, grapefruit-peel edge. Haitian is cleaner, Javanese smokier.'],
  [/patchouli/, 'Patchouli', 'Leaf', 'The dried, aged leaves of a mint-family shrub from Indonesia.', 'Earthy, dark and woody-sweet, like damp soil and cocoa. Modern cleaned-up versions are smoother and less musty.'],
  [/oak ?moss|\bmoss|evernyl/, 'Oakmoss', 'Lichen', 'A lichen that grows on oak trees, the base of the classic chypre and fougère. Now restricted, so often rebuilt in the lab.', 'Damp, green and earthy, like a forest floor, with a salty, inky bitterness.'],
  [/\boak\b/, 'Oak', 'Wood', 'An accord of oak wood, often with a barrel character.', 'Dry, tannic wood with a little vanilla and whisky cask.'],
  [/cypriol|nagarmotha/, 'Cypriol', 'Root', 'The root of an Indian sedge, also called nagarmotha, much used in oud accords.', 'Smoky, earthy and leathery-woody.'],
  [/papyrus/, 'Papyrus', 'Root', 'A sedge related to cypriol.', 'Dry, woody and a little spicy, like parched reeds.'],
  [/cypress/, 'Cypress', 'Wood', 'Oil from the needles and twigs of the Mediterranean cypress.', 'Fresh, resinous and green, drier and smokier than pine.'],
  [/balsam fir|\bfir\b|pine(?!apple)/, 'Pine and fir', 'Conifer', 'Oils from conifer needles and resin.', 'Fresh, green and resinous, like a forest walk or a Christmas tree.'],
  [/juniper/, 'Juniper', 'Berry', 'The berries that flavor gin.', 'Crisp, piney and peppery, with a cold gin-and-tonic freshness.'],
  [/bamboo/, 'Bamboo', 'Green accord', 'An accord: bamboo gives no oil.', 'Watery, green and lightly woody.'],
  [/woody|woodsy|\bwoods?\b|driftwood/, 'Woods', 'Accord', 'A general woody impression, usually a blend of lab-made wood notes.', 'Dry, warm and solid, the frame that holds a scent’s base together.'],

  // ---------- Spices ----------
  [/saffron/, 'Saffron', 'Spice', 'The stigmas of a crocus, or more often safranal, its key molecule.', 'Leathery, bittersweet and a little metallic, with a honeyed hay warmth. It pairs with rose and oud.'],
  [/cardamom|cardamon/, 'Cardamom', 'Spice', 'The seed pods of a ginger-family plant from India and Guatemala.', 'Cool, aromatic and lemony-spicy, with a hint of eucalyptus. Fresh at the top, warm underneath.'],
  [/cinnamon|cassia\b/, 'Cinnamon', 'Spice', 'The bark of the cinnamon tree.', 'Sweet, hot and woody, the smell of baking and mulled wine.'],
  [/cloves?\b/, 'Clove', 'Spice', 'Dried flower buds, rich in eugenol.', 'Hot, sweet and a little medicinal, like a dentist’s office or a spiced orange.'],
  [/nutmeg|mace/, 'Nutmeg', 'Spice', 'The seed of a tropical tree; mace is its lacy coat.', 'Warm, sweet-spicy and slightly woody, softer than clove.'],
  [/ginger/, 'Ginger', 'Spice', 'The root, distilled fresh or dried.', 'Zesty, hot and lemony, with a soapy sparkle up top.'],
  [/peppermint|spearmint|mint/, 'Mint', 'Herb', 'The leaves of peppermint or spearmint.', 'Cool, green and sweet, a rush of freshness that fades fast.'],
  [/pink pepper|rose pepper|baie rose/, 'Pink pepper', 'Spice', 'The berries of a South American tree, no relation to black pepper.', 'Bright, rosy and fizzy with a light peppery bite. It adds sparkle to an opening.'],
  [/sichuan|szechuan|timur/, 'Sichuan pepper', 'Spice', 'The husks of a prickly ash, the tingling spice of Sichuan cooking.', 'Citrusy and bright, like grapefruit peel with a fizzing bite.'],
  [/pepper|pimento/, 'Pepper', 'Spice', 'Black pepper oil, steam-distilled from the dried berries.', 'Dry, sharp and woody. It gives a quick spark of heat without the sneeze.'],
  [/star anise|anise|licorice|liquorice|fennel/, 'Anise and licorice', 'Spice', 'Seeds and roots rich in anethole.', 'Sweet, cool and herbal, the taste of licorice or pastis.'],
  [/cumin/, 'Cumin', 'Spice', 'The seed used in cooking.', 'Warm, earthy and sweaty: in traces it gives a scent a human, skin-like warmth.'],
  [/coriander/, 'Coriander', 'Spice', 'The seed of the cilantro plant.', 'Fresh, peppery and lemony-floral, with none of the leaf’s soapiness.'],
  [/spic/, 'Spices', 'Accord', 'A general spicy impression, from a blend of kitchen spices.', 'Warm and lively: cinnamon, clove and pepper in some mix.'],

  // ---------- Herbs and aromatics ----------
  [/lavender|lavandin/, 'Lavender', 'Herb', 'The flowering tops of the plant, grown in Provence and Bulgaria. The backbone of barbershop scents.', 'Clean, herbal and floral, a little sweet and a little camphor-sharp. Calm and soapy.'],
  [/rosemary/, 'Rosemary', 'Herb', 'The kitchen herb, distilled.', 'Sharp, green and camphor-fresh, like crushed needles.'],
  [/sage/, 'Sage', 'Herb', 'Usually clary sage, a tall herb grown for perfumery.', 'Herbal, a little sweet and tea-like, with a musky, amber warmth as it dries.'],
  [/basil/, 'Basil', 'Herb', 'The leaf, distilled.', 'Green, peppery and sweet, with a touch of anise.'],
  [/thyme|oregano|marjoram/, 'Thyme', 'Herb', 'Mediterranean kitchen herbs.', 'Dry, warm and medicinal-green.'],
  [/artemisia|wormwood|absinth|davana/, 'Artemisia', 'Herb', 'Bitter silver-leaved herbs: wormwood, mugwort and davana, their fruity Indian cousin.', 'Bitter, green and aromatic, like absinthe. Davana leans boozy and apricot-like.'],
  [/geranium/, 'Geranium', 'Leaf', 'The leaves of the rose geranium, grown in Egypt and Réunion.', 'Rosy, green and minty, a cooler, more herbal take on rose.'],
  [/eucalyptus|camphor/, 'Eucalyptus', 'Leaf', 'The leaves of the Australian tree.', 'Cold, sharp and medicinal, like a chest rub.'],
  [/chamomile/, 'Chamomile', 'Herb', 'The small daisy-like flowers used for tea.', 'Herbal, apple-sweet and a little hay-like.'],
  [/angelica/, 'Angelica', 'Root', 'The root and seeds of a tall northern herb, one of gin’s botanicals.', 'Earthy, peppery and musky-green.'],
  [/galbanum/, 'Galbanum', 'Resin', 'A gum from an Iranian plant, the greenest material in perfumery.', 'Fiercely green and bitter, like snapped stems and crushed pea pods.'],
  [/immortelle|helichrysum/, 'Immortelle', 'Flower', 'The “everlasting” flower of Corsica and the Balkans.', 'Maple syrup, curry and dry hay: warm, sweet and odd.'],
  [/\bhay\b/, 'Hay', 'Grass', 'An absolute from dried grass, full of coumarin.', 'Sweet, dry and sun-warmed, like a barn in summer.'],

  // ---------- Citrus ----------
  [/bergamot/, 'Bergamot', 'Citrus fruit', 'A small bitter citrus grown almost only in Calabria, in southern Italy. Its peel oil opens more perfumes than any other note, and flavors Earl Grey tea.', 'Bright and sparkling, softer than lemon, with a floral, slightly bitter and tea-like edge.'],
  [/grapefruit|pomelo/, 'Grapefruit', 'Citrus fruit', 'Oil pressed from the peel, often boosted by lab notes.', 'Tart, bitter and juicy, with a faint sulfur tang that reads as fresh sweat to some noses.'],
  [/yuzu/, 'Yuzu', 'Citrus fruit', 'A knobbly Japanese citrus.', 'Sharp and aromatic, between grapefruit and mandarin, with a green floral edge.'],
  [/petitgrain/, 'Petitgrain', 'Leaf', 'Oil from the leaves and twigs of the bitter orange tree.', 'Green, woody and bitter-fresh, like citrus leaves rubbed between your fingers.'],
  [/neroli/, 'Neroli', 'Flower', 'The steam-distilled oil of bitter orange blossom. The same flower, extracted another way, gives orange blossom absolute.', 'Fresh, green and soapy-clean, with a honeyed bitterness. The smell of classic cologne.'],
  [/orange blossom|orange flower|fleur d.oranger/, 'Orange blossom', 'Flower', 'The flowers of the bitter orange tree, as an absolute. Distilled, the same flower gives neroli.', 'Sweet, honeyed and heady, with a clean soapy side and a warm, slightly animal depth.'],
  [/bitter orange|bigarade|seville/, 'Bitter orange', 'Citrus fruit', 'The peel of the Seville orange, the tree that also gives neroli and petitgrain.', 'Dry, zesty and marmalade-bitter.'],
  [/mandarin|tangerine|clementine/, 'Mandarin', 'Citrus fruit', 'Peel oil from mandarins and their kin.', 'The sweetest and softest citrus: juicy, a little floral, never sharp.'],
  [/blood orange|orange/, 'Orange', 'Citrus fruit', 'Oil pressed from sweet orange peel.', 'Juicy, sweet and sunny, like peeling the fruit.'],
  [/lemon ?grass|verbena|litsea/, 'Lemon verbena', 'Herb', 'Leafy plants rich in citral, the lemon molecule.', 'Lemony and green, more herb than fruit.'],
  [/lemon|citron/, 'Lemon', 'Citrus fruit', 'Oil pressed from the peel, from Sicily and Amalfi at its best.', 'Sharp, zesty and clean. It gives a scent its first bright flash and is gone in minutes.'],
  [/\blime\b/, 'Lime', 'Citrus fruit', 'Peel oil, pressed or distilled.', 'Tart, green and sparkling, sharper than lemon, with a cola-like sweetness.'],
  [/citrus/, 'Citrus', 'Accord', 'A blend of citrus peel oils.', 'Bright, zesty and fresh. Citrus notes open a scent and fade first.'],

  // ---------- Flowers ----------
  [/lily.of.the.valley|muguet/, 'Lily of the valley', 'Flower', 'The spring bell flower gives no oil, so it’s always rebuilt in the lab.', 'Fresh, green and watery-sweet, clean like soap and spring air.'],
  [/water ?lily|lotus/, 'Water lily and lotus', 'Flower', 'Pond flowers, mostly recreated in the lab.', 'Watery, soft and faintly sweet, a clean, airy floral.'],
  [/\blily|lilium/, 'Lily', 'Flower', 'The big white lily, rebuilt in the lab.', 'Heady, waxy and spicy-sweet, with a green freshness.'],
  [/tuberose/, 'Tuberose', 'Flower', 'A night-blooming flower from Mexico, grown in India for perfume. The loudest of the white flowers.', 'Creamy, heady and sweet, with hints of coconut and rubber, and something almost fleshy.'],
  [/jasmin/, 'Jasmine', 'Flower', 'Picked at dawn in Grasse, Egypt and India. Sambac, the kind used in jasmine tea, is greener and fruitier.', 'Rich, sweet and heady, with a warm, slightly animal depth. It’s at the heart of most floral perfumes.'],
  [/hedione/, 'Hedione', 'Aroma molecule', 'A lab molecule found in jasmine, used for the air and lift it gives.', 'A sheer, lemony jasmine breeze: more a feeling of freshness than a flower.'],
  [/ylang/, 'Ylang-ylang', 'Flower', 'The yellow flowers of a tropical tree, from the Comoros and Madagascar.', 'Sweet, creamy and banana-like, with a spicy, slightly rubbery warmth.'],
  [/gardenia/, 'Gardenia', 'Flower', 'The flower gives almost no extract, so it’s built as an accord.', 'Creamy, lush and green, with a mushroomy, buttery richness.'],
  [/frangipani|plumeria|tiare|monoi/, 'Tiare and frangipani', 'Flower', 'Tropical island flowers; tiare is the Tahitian gardenia steeped in coconut oil for monoi.', 'Creamy, sunny and sweet, the smell of a beach holiday.'],
  [/magnolia|champaca/, 'Magnolia', 'Flower', 'The blossoms of magnolia trees, distilled in China.', 'Lemony, creamy and fresh, lighter than the other white flowers.'],
  [/honeysuckle/, 'Honeysuckle', 'Flower', 'A climbing flower, mostly rebuilt in the lab.', 'Sweet, nectar-like and fresh, with a honeyed green lightness.'],
  [/white flowers|white floral/, 'White flowers', 'Accord', 'A blend in the style of jasmine, tuberose and orange blossom.', 'Creamy, heady and sweet, with a clean soapy brightness.'],
  [/rose/, 'Rose', 'Flower', 'Mostly Damask rose from Bulgaria and Turkey, or May rose from Grasse. A kilo of oil takes about four tons of petals.', 'Fresh, sweet and petal-soft, from dewy and lemony to dark and jammy. With oud it turns deep and spiced.'],
  [/peony/, 'Peony', 'Flower', 'The flower gives no oil, so it’s an accord.', 'Fresh, rosy and watery-light, a clean pink floral.'],
  [/freesia/, 'Freesia', 'Flower', 'Another flower that has to be rebuilt in the lab.', 'Crisp, peppery and airy-sweet, like a just-cut bouquet.'],
  [/violet lea/, 'Violet leaf', 'Leaf', 'An absolute from the leaves of the violet, not its flower.', 'Green, watery and metallic, like cut cucumber and wet stems.'],
  [/violet/, 'Violet', 'Flower', 'The flower’s smell comes from ionones, made in the lab since the 1890s.', 'Powdery, sweet and a little candied, with a soft woody, berry-like side.'],
  [/orris|iris/, 'Iris', 'Root', 'Not the flower but its root, orris, dried and aged for years before it gives up any scent. One of the costliest materials there is.', 'Cool, powdery and buttery, like lipstick and suede, with an earthy, carroty edge.'],
  [/heliotrope/, 'Heliotrope', 'Flower', 'A flower whose smell is rebuilt with heliotropin.', 'Powdery and almond-sweet, like marzipan, vanilla and baby powder.'],
  [/mimosa|cassie/, 'Mimosa', 'Flower', 'The fluffy yellow blossoms of an acacia, from the south of France.', 'Soft, powdery and honeyed, with a green, cucumber-fresh side.'],
  [/osmanthus/, 'Osmanthus', 'Flower', 'Tiny flowers from China, used to scent tea.', 'Apricot and soft leather: fruity, suede-like and tea-sweet.'],
  [/carnation/, 'Carnation', 'Flower', 'Usually an accord built on clove’s eugenol.', 'Spicy, peppery and floral, like a rose dusted with clove.'],
  [/narciss|daffodil|jonquil/, 'Narcissus', 'Flower', 'An absolute from wild daffodils in the French uplands.', 'Green, heady and hay-like, with a dark, animal depth.'],
  [/hyacinth|hiacynth/, 'Hyacinth', 'Flower', 'The spring bulb, recreated in the lab.', 'Green, cool and intensely floral, like damp earth and stems.'],
  [/lilac/, 'Lilac', 'Flower', 'A spring shrub whose flowers give no oil.', 'Soft, sweet and a little powdery, with a green freshness.'],
  [/cyclamen/, 'Cyclamen', 'Flower', 'A lab-built watery floral.', 'Fresh, watery and lightly green.'],
  [/cherry blossom|sakura/, 'Cherry blossom', 'Flower', 'An accord: the blossom is nearly scentless.', 'Light, airy and faintly almond-sweet.'],
  [/orchid/, 'Orchid', 'Flower', 'A fantasy accord, usually leaning on vanilla, which is an orchid itself.', 'Creamy, powdery and sweet.'],
  [/marigold|tagetes/, 'Marigold', 'Flower', 'Tagetes oil, from the garden flower.', 'Bitter-green and fruity, like apple skin and crushed leaves.'],
  [/hibiscus/, 'Hibiscus', 'Flower', 'An accord, often meaning its tart tea.', 'Tart, fruity and lightly floral.'],
  [/flor|flower|bouquet/, 'Florals', 'Accord', 'A general floral impression rather than one bloom.', 'Soft, sweet and petal-like.'],

  // ---------- Fruits ----------
  [/black ?currant|cassis/, 'Blackcurrant', 'Fruit', 'From the buds of the blackcurrant bush, or a lab-built berry note.', 'Tart, dark and juicy, with a sharp green tang that can lean catty.'],
  [/pineapple/, 'Pineapple', 'Fruit', 'A lab-built fruit note, famous as the opening of Aventus.', 'Juicy, sweet and tangy, sometimes a little smoky.'],
  [/green apple|red apple|\bapple/, 'Apple', 'Fruit', 'Fresh fruit gives up no perfume oil, so apple is built in the lab. It opens many fresh and fruity men’s scents.', 'Crisp, juicy and bright: green and tart, or red and sweet.'],
  [/pear/, 'Pear', 'Fruit', 'Like most fruits, rebuilt in the lab, since pressing a pear gives no scent to bottle.', 'Juicy, sweet and a little grainy, softer than apple.'],
  [/peach|nectarine/, 'Peach', 'Fruit', 'Built from lactones, the molecules that give peach skin its velvet.', 'Soft, fuzzy and creamy-sweet.'],
  [/apricot/, 'Apricot', 'Fruit', 'A lab-built stone-fruit note.', 'Velvety, jammy and a little tart.'],
  [/plum|prune/, 'Plum', 'Fruit', 'A dark fruit accord, used in rich, spiced scents.', 'Deep, jammy and wine-like.'],
  [/raspberr/, 'Raspberry', 'Fruit', 'A lab note (raspberry ketone) with a candy brightness.', 'Sweet, tart and jammy, a little powdery.'],
  [/strawberr/, 'Strawberry', 'Fruit', 'A lab-built berry note.', 'Sweet and candy-like, with a soft creaminess.'],
  [/cherry/, 'Cherry', 'Fruit', 'An accord, often with almond’s benzaldehyde.', 'Sweet and tart, from fresh fruit to boozy cherry liqueur.'],
  [/blackberr|mulberr|blueberr|red berries|berries|berry|currant/, 'Berries', 'Fruit', 'Lab-built dark and red berry notes.', 'Juicy, tart and sweet, a little jammy.'],
  [/litchi|lychee/, 'Lychee', 'Fruit', 'A lab-built note with a rosy side.', 'Watery, sweet and floral, like rosewater and grape.'],
  [/mango/, 'Mango', 'Fruit', 'A tropical accord.', 'Ripe, juicy and resinous-sweet, with a green edge.'],
  [/passion ?fruit|guava|papaya|tropical/, 'Tropical fruit', 'Fruit', 'Lab-built tropical notes, some with a sulfur tang like the real fruit.', 'Tangy, juicy and exotic, sweet with a sharp edge.'],
  [/watermelon|melon/, 'Melon', 'Fruit', 'Built from Calone-type molecules.', 'Watery, sweet and cool, very 1990s fresh.'],
  [/banana(?! leaf)/, 'Banana', 'Fruit', 'A lab-built fruit note (isoamyl acetate, the smell of banana candy).', 'Sweet, creamy and ripe.'],
  [/fig/, 'Fig', 'Fruit', 'An accord of the whole tree: fruit, leaf and milky sap.', 'Green, milky and softly sweet, with a coconut-like creaminess.'],
  [/pomegranate/, 'Pomegranate', 'Fruit', 'A lab-built note.', 'Tart, juicy and a little wine-like.'],
  [/rhubarb|rhuburb/, 'Rhubarb', 'Vegetable', 'A lab-built tart green note.', 'Sour, crisp and green-fruity.'],
  [/dried fruit|raisin/, 'Dried fruits', 'Fruit', 'An accord of raisin, date and prune.', 'Dark, sticky and wine-sweet.'],
  [/fruit/, 'Fruits', 'Accord', 'A general fruity sweetness.', 'Juicy and sweet.'],

  // ---------- Green, tea and watery ----------
  [/\bmat[eé]\b/, 'Maté', 'Leaf', 'The South American tea leaf.', 'Dry, smoky and green, like tobacco crossed with tea.'],
  [/\btea\b/, 'Tea', 'Leaf', 'From tea extracts or an accord. Green tea reads fresh, black tea smoky.', 'Dry, leafy and slightly bitter. Calm and clean.'],
  [/grass|green leaves|green notes|\bleaves\b|\bleaf\b/, 'Green notes', 'Accord', 'The smell of crushed leaves and cut grass, from lab-made “leaf alcohols”.', 'Fresh, sharp and sappy.'],
  [/sea ?salt|\bsalt/, 'Salt', 'Accord', 'An impression built from mineral and marine notes.', 'Dry and mineral, like skin after a swim.'],
  [/sea ?water|sea notes|marine|ocean|aquatic|water|calone|ozon/, 'Marine notes', 'Aroma molecules', 'Built from Calone and its kin, the molecules behind the “fresh aquatic” scents of the 1990s.', 'Cool, watery and airy, like sea spray, melon rind and rain.'],
  [/mineral|flint|stone|petrichor|concrete/, 'Mineral notes', 'Accord', 'A lab-built impression of wet stone or flint.', 'Cold, dry and clean, like rain on pavement.'],
  [/solar/, 'Solar notes', 'Accord', 'Built from salicylates, the smell of classic sun lotion.', 'Warm, radiant and a little floral-salty, like skin in the sun.'],
  [/aldehyd/, 'Aldehydes', 'Aroma molecules', 'Lab molecules made famous by Chanel No. 5.', 'Fizzy, waxy and clean, like champagne bubbles, snuffed candles and starched linen.'],
  [/powder/, 'Powdery notes', 'Accord', 'An effect from iris, violet, musk and heliotrope.', 'Soft, dry and cosmetic, like face powder or talc.'],
  [/sweet notes/, 'Sweet notes', 'Accord', 'A general sweetness, usually ethyl maltol and vanillin.', 'Sugary and warm.'],
];

// A family's line, for a note no row names: [label, what it smells like].
const FAMILIES = {
  sweet: ['a sweet note', 'Sugary and warm.'],
  caramel: ['a caramel note', 'Burnt sugar and butter.'],
  vanilla: ['a vanilla-like note', 'Sweet, creamy and warm.'],
  almond: ['an almond-like note', 'Sweet and powdery, like marzipan.'],
  balsamic: ['a resin', 'Warm, sweet and balsamic, with some smoke.'],
  animalic: ['an animal note', 'Warm, dirty and skin-like; in traces it makes a scent feel alive.'],
  oud: ['an oud note', 'Dark, woody and a little animal.'],
  woody: ['a woody note', 'Dry, warm and solid.'],
  nutty: ['a nutty note', 'Roasted and buttery.'],
  green: ['a green note', 'Fresh and sappy, like crushed leaves.'],
  honey: ['a honeyed note', 'Thick, golden sweetness.'],
  cacao: ['a roasted note', 'Dark, bitter and warm, like cocoa or coffee.'],
  lactonic: ['a milky note', 'Soft, creamy and faintly sweet.'],
  coconut: ['a coconut note', 'Creamy and milky-sweet.'],
  tobacco: ['a tobacco note', 'Sweet, dry and leafy.'],
  whiskey: ['a boozy note', 'Warm and a little sweet, like aged spirits.'],
  leather: ['a leather note', 'Smoky, dry and animal.'],
  amber: ['an amber note', 'Warm, sweet and resinous.'],
  'fresh spicy': ['a fresh spice', 'Bright and peppery.'],
  musky: ['a musk', 'Soft, warm and skin-like.'],
  'warm spicy': ['a warm spice', 'Hot and sweet, like kitchen spices.'],
  herbal: ['a herb', 'Green, dry and aromatic.'],
  fresh: ['a fresh note', 'Clean and airy.'],
  fruity: ['a fruity note', 'Juicy and sweet.'],
  aromatic: ['an aromatic herb', 'Green, clean and herbal.'],
  citrus: ['a citrus note', 'Bright and zesty; it opens a scent and fades first.'],
  lavender: ['a lavender note', 'Clean, herbal and floral.'],
  iris: ['an iris note', 'Cool, powdery and buttery.'],
  powdery: ['a powdery note', 'Soft and dry, like face powder.'],
  violet: ['a violet note', 'Powdery and sweet.'],
  'white floral': ['a white flower', 'Creamy, heady and sweet.'],
  rose: ['a rose note', 'Fresh, sweet and petal-soft.'],
  floral: ['a flower', 'Soft, sweet and petal-like.'],
  tropical: ['a tropical fruit', 'Tangy, juicy and sweet.'],
  savory: ['a savory note', 'Salty or food-like, an odd, dry contrast to sweetness.'],
  aquatic: ['a watery note', 'Cool and airy, like sea spray.'],
  ozonic: ['an airy note', 'Cold, clean air, like the moment before rain.'],
  tea: ['a tea note', 'Dry, leafy and calm.'],
  mossy: ['a mossy note', 'Damp, green and earthy.'],
  earthy: ['an earthy note', 'Like roots and damp soil.'],
  paper: ['a dry, papery note', 'Like old books or cardboard.'],
};

const clean = note => String(note ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’`]/g, "'").replace(/\s+/g, ' ').trim();

/** The glossary row a note's name falls under, or null: its index is the note's key (keyOf). */
const rowOf = note => {
  const n = clean(note);
  if (!n) return -1;
  return GLOSSARY.findIndex(([re]) => re.test(n));
};

/**
 * What a note is: { key, name, kind, what, smell } from the glossary
 * (`name` the glossary's own, as "Madagascar Vanilla" is Vanilla), or for a
 * note it doesn't name but layering places, { key, family, label, smell,
 * general: true } ("a woody note"). Null when nothing is known.
 */
export function noteInfo(note) {
  const i = rowOf(note);
  if (i >= 0) {
    const [, name, kind, what, smell] = GLOSSARY[i];
    return { key: `g${i}`, name, kind, what, smell };
  }
  const family = noteFamily(note);
  const line = family && FAMILIES[family];
  return line ? { key: `f:${family}:${clean(note)}`, family, label: line[0], smell: line[1], general: true } : null;
}

/** Whether two notes are one material by the glossary (Bourbon Vanilla and Vanilla), or one name. */
export function sameNote(a, b) {
  if (clean(a) === clean(b)) return true;
  const i = rowOf(a);
  return i >= 0 && i === rowOf(b);
}

/** Every glossary row as { pattern, name, kind, what, smell }, and the family lines, for the tests. */
export const glossaryRows = () => GLOSSARY.map(([pattern, name, kind, what, smell]) => ({ pattern, name, kind, what, smell }));
export const familyLines = () => FAMILIES;
