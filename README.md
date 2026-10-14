# Scentcast

A quick look at what to wear from my own collection, based on today's weather, time of day and occasion.

- **Wear** — live local weather (Open-Meteo, no key) drawn as a scene, with the top pick standing on its hill, for daytime or tonight, and the rest of your bottles on a shelf by how well they fit. Each pick shows a match score and the reasons behind it.
- **Week** — a day and night pick for each of the next 7 days, planned against the forecast so nothing repeats back to back.
- **Occasion** — Everyday, Office, Date Night, Night Out, Formal, Outdoors, Cozy, for daytime or tonight.
- **Bottle page** — every bottle has one (a sheet on phones, a panel beside the page on desktop): why it ranks where it does, what else fits, what to layer it with and which to spray first, its accords, seasons and notes.
- **Wardrobe** — switch bottles in and out of rotation, and the wear journal: "Wear this" logs what you wore so picks rotate, fading over the next ten days, with a calendar, your most-worn bottles and the ones gathering dust.
- **Discover** — search every fragrance on Fragrantica (from [Le Decanteur's dataset](https://www.kaggle.com/datasets/ledecanteur/fragrantica-perfumes), CC BY-NC-SA 4.0) and see how any of them would do today.
- **Your own collection** — add what you own from Discover, paste a list, or add a bottle no database has by picking its accords. Share it as a link. The demo shows my wardrobe.
- °F or °C (defaults from your locale), two themes, recent locations, links to every view, and home-screen shortcuts for Now, Week and Occasion.

Picks come from Fragrantica community votes (season, day/night, and those of the bottles voters say it smells like), each bottle's main accords, how heavy they wear versus the temperature and humidity, and the occasion's accord profile.

## Run

```sh
npm run dev      # http://127.0.0.1:5173
npm test
MOCK=1 node worker/dev.mjs   # the old Fragella API on :8787, from saved responses
node scripts/recommend.mjs --city "New York" --occasion date
node scripts/recommend.mjs --city "New York" --week
node scripts/recommend.mjs --layer "Liquid Brun"   # or --layer all
node scripts/recommend.mjs --city "New York" --journal scentcast-journal.json   # rotate out recent wears
node scripts/recommend.mjs --mix                   # the collection's scent styles
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
