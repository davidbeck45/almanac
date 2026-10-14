# Scentcast

A quick look at what to wear from my own collection, based on today's weather, time of day and occasion.

- **Wear** — live local weather (Open-Meteo, no key) drawn as a scene, with the top pick standing on its hill, for daytime or tonight, and the rest of your bottles on a shelf by how well they fit. Each pick shows a match score, the reasons behind it and how much to spray. A bottle you haven't worn in a month comes back into rotation when it's nearly as good a fit ("Not worn in 34 days").
- **Week** — a day and night pick for each of the next 7 days, planned against the forecast so nothing repeats back to back.
- **Occasion** — Casual, Office, Date Night, Night Out, Formal, Outdoors, Cozy, for daytime or tonight, or for any date and city ("Formal · Sat night in Chicago").
- **Bottle page** — every bottle has one (a sheet on phones, a panel beside the page on desktop): why it ranks where it does, how much to spray and where, what else fits, what to layer it with and which to spray first, its style, what smells like it (its original, cheaper twins), what voters say (value for money, how many owners keep it, how safe a blind buy it is, how its ratings spread, how feminine or masculine it reads) and Fragrantica members' pros and cons, its accords, seasons and notes, and your own stars and how it wears on you. For a bottle you don't own, a verdict on how it would fit your wardrobe and the styles you like, and a Want button.
- **Compare** — two or three bottles side by side: which to wear tonight (one of yours when you own one of them), how each fits now and for your occasion, how they relate, and their accords, seasons, performance, value and risk.
- **Wardrobe** — switch bottles in and out of rotation, and the wear journal: "Wear this" logs what you wore so picks rotate, fading over the next ten days, with a calendar, your most-worn bottles and the ones gathering dust.
- **Insights** — what your wardrobe still needs. A map of every occasion against your climate's weather, by day and night, filled as far as your bottles cover it; where it's thin ("Formal on warm nights") and the bottles that would fill it, each against your best there, with a cheaper twin and blind-buy risk. Then your style mix (tap Like on the styles you love), more of the styles you like (skin scent, clean, intimate…), a safe first bottle for each style you don't own, and any bottles you own that smell alike, by their notes or what voters say. Set how often you dress for each occasion, and whether to stick to great value.
- **Wishlist** — bottles you want, each with a verdict on how it would fit your shelf (strong fit, good, covered, risky, redundant), what it would fill and how it would do today; "I bought it" moves it into your collection.
- **Discover** — search every fragrance on Fragrantica by name or by notes ("iris leather", "smoky vanilla"), get more of the styles you love (skin scent, clean, intimate…) or more like the bottles you pick, and filter by season, time of day, lean, longevity, projection, value and blind-buy safety. Each pick says why (the bottle you own it's closest to, what voters say it smells like, a cheaper twin), and goes on your wishlist or into your collection in a tap; the gap finder's top picks sit alongside. Data from [Le Decanteur's dataset](https://www.kaggle.com/datasets/ledecanteur/fragrantica-perfumes), CC BY-NC-SA 4.0.
- **Your own collection** — add what you own from Discover, paste a list, or add a bottle no database has by picking its accords. Share it as a link. The demo shows my wardrobe.
- **Trip** — the fewest bottles to pack for a city and dates (two to four), which to wear each day and night, with a dressier pick for a formal dinner or a date, and a packing list to copy or share. Past the forecast's first ten days it plans on typical weather for the dates and says so. The last trip stays on your device, and you can still add a dinner or stay longer once you're there. In the terminal too (`--pack`, `--date`).
- **How much to spray** — a count and where for each pick ("2 sprays · neck, chest" on the Now card, and the spots on a small figure on every bottle page), from how loud and lasting the bottle is, the weather and the occasion. In the terminal too (`--spray`, and on every pick).
- **Your own ratings** — your stars steer the picks (a bottle you rate 1★ sits out, a 5★ one wins near ties), and so does whether a bottle lasts longer or sits closer on your skin than the crowd says. Set them under "On your skin" on a bottle's page; Now, Week, Occasion, trips and Insights all use them.
- **Gaps and buy check** in the terminal too: where your wardrobe is thin and what fills it (`--gaps`), and a verdict on any bottle you're eyeing (`--check`).
- °F or °C (defaults from your locale), two themes, a still sky for those who want one, recent locations, links to every view, and home-screen shortcuts for Now, Week and Occasion.

Picks come from Fragrantica community votes (season, day/night, and those of the bottles voters say it smells like), each bottle's main accords, how heavy they wear versus the temperature and humidity, and the occasion's accord profile.

## Run

```sh
npm run dev      # http://127.0.0.1:5173
npm test
MOCK=1 node worker/dev.mjs   # the old Fragella API on :8787, from saved responses
node scripts/recommend.mjs --city "New York" --occasion date
node scripts/recommend.mjs --city "New York" --week
node scripts/recommend.mjs --layer "Liquid Brun"   # or --layer all
node scripts/recommend.mjs --city "New York" --journal scentcast-journal.json   # rotate out recent wears, nudge in neglected ones
node scripts/recommend.mjs --mix                   # the collection's scent styles
node scripts/recommend.mjs --doubles               # bottles you own that wear as one
node scripts/recommend.mjs --pack --city London --from 2026-12-10 --to 2026-12-19 --events "2026-12-15 night formal"
node scripts/recommend.mjs --city Miami --date 2026-10-24 --occasion date   # any date: forecast, else typical weather
node scripts/recommend.mjs --spray "Liquid Brun" --occasion date             # how many sprays, and where
node scripts/recommend.mjs --gaps --city Houston    # what the wardrobe is missing there, and what fills it
node scripts/recommend.mjs --check "Le Male Le Parfum"   # worth buying?
node scripts/recommend.mjs --style "skin,clean,intimate" --all   # bottles to buy that are all three
node scripts/recommend.mjs --more-like "Liquid Brun,Amber Empire"
node scripts/recommend.mjs --notes "iris leather" --season winter
node scripts/recommend.mjs --dupes "Aventus"       # its original, cheaper alternatives and smell-alikes
```

Live at **https://davidbeck45.github.io/scentcast/** (GitHub Pages from `main`; every push redeploys). Add it to your phone's home screen to use it like an app.

## Collection

`data/collection.jsonl` holds my Fragrantica wardrobe ("Have" shelf), scraped with `scripts/fragrantica-extract.js`. `npm run build:data` turns it into `data/collection.json`.

`data/catalog.jsonl` holds other people's Fragrantica bottles that need more than the dataset has (Parfumo's ratings and layering votes, or bottles newer than it). `npm run build:data` builds both.

`data/fragrantica/` is every Fragrantica perfume with accords, built from [Le Decanteur's Kaggle dataset](https://www.kaggle.com/datasets/ledecanteur/fragrantica-perfumes) by `scripts/decant.py`; it carries that dataset's license, [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/).

## Omarchy widget

The repo is also an [Omarchy](https://omarchy.org) shell plugin (`manifest.json`, `omarchy/`): a bar icon for the bottle to wear now, and a popup with why, a runner-up and the week's day and night plan. It runs the same engine in Node, so it needs Node.js on the PATH.

```sh
omarchy plugin add https://github.com/davidbeck45/scentcast.git --enable
omarchy plugin update doeszen.scentcast   # pull new engine code or collection data
```

Left click opens the popup, middle click refreshes, right click opens the site. Settings go on the widget's entry in `~/.config/omarchy/shell.json` (or `omarchy bar set doeszen.scentcast <key> <value>`):

- `location`: a city or `lat,lon`. Empty follows Omarchy's weather location, then the IP address.
- `hidden`: comma-separated bottles to leave out. Unset keeps the site's defaults; `""` shows every bottle.
- `units`: `auto`, `F` or `C`.
- `refreshMinutes`: default 30.
