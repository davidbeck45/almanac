---
name: ui-check
description: Screenshot and inspect the Scentcast app headlessly with dev/shoot.mjs, on saved New York weather so it works any day and offline. Use after changing anything the app draws (src/views, src/ui, src/css, src/app, index.html), before saying a UI fix works, when asked to look at or screenshot a screen, and when Open-Meteo answers 429.
---

# UI check

Tests can't see layout, contrast, clipping or a skeleton that never resolves, so a UI change is done when you've looked at it. Shoot the screens it touches at all three widths, Read every PNG, and fix what you see before you report.

## 1. Serve and set up

```bash
npm run dev                                  # http://127.0.0.1:5173; run it in the background
APP=http://127.0.0.1:5173/
INIT="$(node dev/offline/init.mjs)"          # --journal adds the sample wears
```

When another checkout holds 5173, serve this one with `python3 -m http.server <port> --bind 127.0.0.1` from the repo root and point `APP` at that port.

Pass `--init "$INIT"` to every shot. It answers the page's Open-Meteo requests from `dev/offline/`: New York's saved week, moved to start today, and New York's climate for the gap finder. That spends no quota, gives the same weather every run, and keeps the app from showing "The forecast service is busy". Every place gets New York's weather (a console warning says so), trips and dates past the saved week still ask the archive for typical weather, and bottle photos come from fimgs.net, so with no internet those fail and shoot exits 1. Pin the place with `?loc=40.71,-74.01,New%20York`, which also skips the location prompt.

## 2. Shoot

```bash
node dev/shoot.mjs --init "$INIT" --url "${APP}?loc=40.71,-74.01,New%20York#/wear/now" \
  --size 390x844 --size 768x1024 --size 1440x900 --wait .pick --wait 600 --out shots/now.png
```

Then Read each `shots/now-<W>x<H>.png`. The sizes are the three layouts: a phone (floating tab bar, bottom-sheet bottle page), a tablet (drawer) and a desktop (left rail, inspector beside the page). `dev/shoot.mjs`'s header lists every option.

Wait on content, never on a container: skeletons share class names (Discover's skeleton cards are `.bcard` too), so a wait on the container shoots the skeleton.

| Screen | Route | Wait for |
|---|---|---|
| Now | `#/wear/now` | `.pick` |
| Week | `#/wear/week` | `.wk-list` |
| Occasion | `#/wear/occasion/formal` | `.pick` |
| Trip | `#/wear/trip` | `.trip-form` |
| Owned | `#/wardrobe/owned` | `.row` |
| Wishlist | `#/wardrobe/wishlist` | `.wishes, .message` |
| Worn | `#/wardrobe/worn` | `.calendar` |
| Insights | `#/wardrobe/insights` | `.ins-pick` |
| Discover | `#/discover?styles=skin,clean,intimate` or `?q=iris%20leather` | `.bcard-name` |
| An owned bottle | `#/bottle/70748` | `.bp-head` |
| A bottle to buy | `#/bottle/124649` | `.bc-verdict` |
| Compare | `#/compare/70748,85097` | `.cmp-table` |
| Settings | `#/settings` | `.set-group` |

Every screen at once, in both themes with the sample journal, takes about 90 seconds: `bash .claude/skills/ui-check/gallery.sh "$APP" shots/gallery [names]`. Names pick screens, in the table's order: `now week occasion trip owned wishlist worn insights discover bottle shop compare settings`.

Variants:

- **Theme**: add `&theme=gruvbox` to the query.
- **Still sky**: `--reduced-motion` stops stars, rain and smoke, so a before and after differ only by your change. Shoot the same recipe into `shots/before/` and `shots/after/`.
- **Whole page**: `--full-shot <file>` at that point, or `--full-page` for every shot. On a phone the fixed tab bar lands where the screen ended, over the content; hide it first with `--eval "document.querySelector('.nav').style.display = 'none'"`.
- **Interaction**: `--click .hero-pick --wait .bp-head` opens the top pick's page (a real tap on phones); `--click '.seg.glass [data-value=day]'` flips Now to Day; `--key Tab` moves focus; `--click '.disc-search input' --type fig` searches Discover; `--eval` does the rest.

Personas, as another `--init` or in the query:

- **David's demo**: the default.
- **A shared list** (Brooke's): `&c=69541,122015,128201,115992,64338,137101,77284,97237,88207&n=Brooke`, wait for `.banner`.
- **An empty Mine**: `--init "localStorage.setItem('scentcast.active', 'mine')"`, wait for `.message`.
- **A wear journal**: `INIT="$(node dev/offline/init.mjs --journal)"` logs 66 wears of 10 bottles over six weeks, the newest three days ago, for Worn's calendar and the rotation lines on picks and bottle pages.
- **A want list**: `--init "localStorage.setItem('scentcast.want', JSON.stringify([{ id: '124649', added: '2026-10-01' }, { id: '9828', added: '2026-10-02' }]))"`, wait for `.wish`.

## 3. Look

Start with shoot's own report: stderr lines and exit code 1 mean a console error, an uncaught exception, a failed request, a wait that timed out or a click that matched nothing. Each is a bug or a wrong selector; the check isn't clean until they're gone.

Then, in every shot:

- **The change**: there, and right, at all three widths and in both themes.
- **Leftover loading**: skeletons, "Updating…" or an empty slot. Wait longer on a content selector, or find the load that failed.
- **Error states**: "Collection missing", "Couldn't load these", "The forecast service is busy" (the shot ran without `--init`).
- **Fit**: text clipped or overlapping, a sideways scroll, buttons wrapping, content hidden under the phone's tab bar. Bottle names may end in an ellipsis; nothing else should.
- **The hero**: temperature and the pick's name legible over the sky, by day and by night.
- **Gruvbox**: every surface takes the theme; nothing keeps the default palette, and text stays readable.
- **Focus**: after `--key Tab`, a visible ring on the focused control.
- **Copy**: reasons never carry a temperature, and the wording matches the screens around it.

CLAUDE.md's "Checking the UI" holds the layout, token and contrast rules the shots should meet. Two checks the eye misses, printed per size:

```bash
--eval "({ sideways: document.documentElement.scrollWidth > innerWidth, skeletons: [...document.querySelectorAll('[aria-busy=true], [class*=sk-]')].filter(e => { const r = e.getBoundingClientRect(); return r.height && r.top < innerHeight && r.bottom > 0; }).length })"
```

Both should come back `false` and `0` once the screen has loaded.

## 4. Report

Say which screens, sizes, themes and personas you shot, where the files are, and what you saw, naming the shot that shows a fix working. Stop the server.

## The CLI on a 429 day

`node --import ./dev/offline/stub.mjs scripts/recommend.mjs --loc "40.71,-74.01,New York" …` answers the CLI's forecast and climate requests the same way. `--city` still looks the place up online; `--loc` doesn't.
