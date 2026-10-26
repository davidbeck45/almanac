# Scentcast

What to wear from my own fragrance collection, for today's weather, the time of day and the occasion.

Live at **https://davidbeck45.github.io/scentcast/**. It opens on my wardrobe; add your own bottles and it ranks yours instead. Add it to your phone's home screen to use it like an app, with shortcuts to Now, Week and Occasion.

## What it does

**Wear**
- **Now**: the local weather drawn as a sky, with the best bottle for daytime or tonight standing on the hill and the rest of your bottles on a shelf by how well they fit. Each pick has a match score, the reasons behind it and how much to spray ("2 sprays · neck, chest"). A bottle you haven't worn in a month comes back when it's nearly as good a fit.
- **Week**: a day and night pick for each of the next 7 days, rotating so the same bottle rarely comes up twice in a row.
- **Occasion**: Casual, Office, Date Night, Night Out, Formal, Outdoors or Cozy, for today or any date up to a year out, here or in another city.
- **Trip**: the fewest bottles to pack (two to four) for a city and dates, which to wear each day and night, a dressier pick for a formal dinner or a date, and a packing list to copy or share. Past the forecast's ten days it plans on typical weather for the dates, and says so.

**Wardrobe**
- **Owned**: your bottles, each switched in or out of rotation. Add them by search, paste a list, or enter one no database has by its accords. Share the list as a link.
- **Wishlist**: bottles you want, each with a verdict on how it would fit your shelf (Strong fit, Good, Covered, Risky or Redundant) and what it would fill. "I bought it" moves it into your collection.
- **Worn**: the wear journal. "Wear this" logs today's pick so the next picks rotate; a calendar, your most-worn bottles and the ones gathering dust. Export saves it as a file; Copy for Claude copies a short version (the last ten days' wears, your stars and switched-off bottles, no places) to paste to Claude, so its picks skip what you just wore.
- **Insights**: what your wardrobe still needs. A map of every occasion against your climate's weather, by day and by night, filled as far as your bottles cover it; where it's thin, and the bottles that would fill it, with a cheaper twin and blind-buy risk. Then your style mix, more of the styles you like (skin scent, clean, intimate…), a safe first bottle for each style you don't own, and any bottles you own that smell alike. Tell it how often you dress for each occasion, and whether to stick to great value.

**Discover**: search 137,000 Fragrantica perfumes by name or by notes ("iris leather", "smoky vanilla"), get more of the styles you love or more like bottles you pick, and filter by season, time of day, lean, longevity, projection, value and blind-buy safety. Each pick says why: the bottle you own it's closest to, what voters say it smells like, a cheaper twin. Add it to your wishlist or your collection in a tap.

**Bottle page**: every bottle has one. Why it ranks where it does, how much to spray and where, what to layer it with and which to spray first, its style, what smells like it (its original, cheaper twins), what voters say (value for money, how many owners keep it, how safe a blind buy it is, how its ratings spread) and Fragrantica members' pros and cons, its accords, seasons and notes. Rate your own bottles and say whether they last or project more on your skin; the picks follow. For a bottle you don't own, a verdict on how it would fit your wardrobe. **Compare** puts two or three side by side and says which to wear tonight.

**Settings**: your place, °F or °C, two themes, a still sky, which list is ranked, and the journal export.

Picks come from Fragrantica's community votes (seasons, day or night, and those of the bottles voters say it smells like), each bottle's main accords against the temperature and how sticky the air is, the occasion's accord profile, and for some occasions how long it lasts and how far it projects, by Parfumo's votes.

## Privacy

There's no account and no tracking. What you add stays in your browser's storage on this device: your bottles, wishlist, wear journal, ratings, settings and recent places. The journal leaves only when you export it or copy it for Claude.

The app is static files on GitHub Pages. Beyond them it talks to:
- **Open-Meteo**, for the weather: the coordinates of the places you ask about (your device's location rounded to about 100 m, or a city you picked) for their forecast, and with a date for a trip or an occasion past the forecast, for typical weather; your place to half a degree for Insights' climate; and the city names you search.
- **Fragrantica's image host** (fimgs.net), for bottle photos.
- **A small Cloudflare Worker** of mine, only to open share links made before the app moved to the Fragrantica dataset; it looks their bottles up in the Fragella API.

A share link carries its bottles' ids, and any bottle you entered by hand, in the URL.

## In the terminal

The same engine runs in Node.js, with no dependencies. Run `node scripts/recommend.mjs` with no arguments for every option.

```sh
node scripts/recommend.mjs --city "New York" --occasion date
node scripts/recommend.mjs --city "New York" --week
node scripts/recommend.mjs --city Miami --date 2026-10-24 --occasion date   # any date: forecast, else typical weather
node scripts/recommend.mjs --city "New York" --journal scentcast-journal-2026-10-14.json   # rotate out recent wears, nudge in neglected ones
node scripts/recommend.mjs --city "New York" --journal scj1.eyJ0Ijoi…   # the same from Worn's Copy for Claude
node scripts/recommend.mjs --pack --city London --from 2026-12-10 --to 2026-12-19 --events "2026-12-15 night formal"
node scripts/recommend.mjs --spray "Liquid Brun" --occasion date             # how many sprays, and where
node scripts/recommend.mjs --layer "Liquid Brun"   # or --layer all
node scripts/recommend.mjs --ideal "Amber Empire"  # the temperatures it wears best in
node scripts/recommend.mjs --mix                   # the collection's scent styles
node scripts/recommend.mjs --doubles               # bottles you own that wear as one
node scripts/recommend.mjs --gaps --city Houston   # what the wardrobe is missing there, and what fills it
node scripts/recommend.mjs --check "Le Male Le Parfum"   # worth buying?
node scripts/recommend.mjs --style "skin,clean,intimate" --all   # bottles to buy that are all three
node scripts/recommend.mjs --more-like "Liquid Brun,Amber Empire"
node scripts/recommend.mjs --notes "iris leather" --season winter
node scripts/recommend.mjs --dupes "Aventus"       # its original, cheaper alternatives and smell-alikes
```

## Run it locally

```sh
npm run dev      # http://127.0.0.1:5173 (Python's http.server; there's no build step)
npm test
MOCK=1 node worker/dev.mjs   # the old Fragella lookup on :8787, from saved responses
```

`?loc=40.71,-74.01,New%20York` pins a place and skips the location prompt. `dev/offline/` holds a saved week of New York weather for testing on a day Open-Meteo's free limit is used up.

Pushing to `main` publishes the site.

## Data and credits

- **Fragrance data**: [Fragrantica](https://www.fragrantica.com), through [Le Decanteur's Kaggle dataset](https://www.kaggle.com/datasets/ledecanteur/fragrantica-perfumes), licensed [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/). `data/fragrantica/`, `data/extras.jsonl` and the values derived from it carry the same license: credit Le Decanteur, no commercial use, share alike (see `data/fragrantica/README.md`). The pros and cons are Fragrantica's AI summary of its members' reviews.
- **Longevity, sillage, occasion and layering votes**: [Parfumo](https://www.parfumo.com).
- **Weather**: [Open-Meteo](https://open-meteo.com) (forecast, historical weather and city search), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- **Fonts**: Fraunces and Inter, self-hosted under the SIL Open Font License (`fonts/`).

My wardrobe is `data/collection.jsonl`, a line per bottle from the dataset (`python3 scripts/decant.py add collection <id>`) or, for a bottle newer than it, scraped from its page with `scripts/fragrantica-extract.js`; `npm run build:data` turns it into `data/collection.json`. `data/catalog.jsonl` holds friends' bottles that need more than the dataset has. CLAUDE.md has the details.

## Omarchy widget

The repo is also an [Omarchy](https://omarchy.org) shell plugin (`manifest.json`, `omarchy/`): a bar icon for the bottle to wear now, and a popup with why, a runner-up and the week's day and night plan. It runs the same engine in Node, so it needs Node.js on the PATH.

```sh
omarchy plugin add https://github.com/davidbeck45/scentcast.git --enable
omarchy plugin update doeszen.scentcast   # pull new engine code or collection data
```

Left click opens the popup, middle click refreshes, right click opens the site. Settings go on the widget's entry in `~/.config/omarchy/shell.json` (or `omarchy bar set doeszen.scentcast <key> <value>`):

- `location`: a city or `lat,lon`. Empty follows Omarchy's weather location, then the IP address (looked up with wttr.in).
- `hidden`: comma-separated bottles to leave out. Unset keeps the site's defaults; `""` shows every bottle.
- `units`: `auto`, `F` or `C`.
- `refreshMinutes`: default 30.
