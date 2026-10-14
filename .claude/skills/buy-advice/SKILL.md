---
name: buy-advice
description: Fragrance buying advice for David's wardrobe, answered with scripts/recommend.mjs. Use whenever he's shopping: what to buy or what's missing ("I need a formal winter scent"), whether a bottle is worth it, more of a style he likes ("more skin scents"), more like a bottle, bottles with given notes ("iris and leather for winter nights"), and dupes ("cheaper alternative to X", "does X smell like Y").
---

# Buy advice

Every bottle, number and verdict in the reply comes from `node scripts/recommend.mjs` output. The CLI knows what David owns, which of his bottles are clones of what, his hidden bottles and the crowd's votes; memory of perfumes gets clone links, ratings and concentrations wrong, and it can't know his wardrobe. When the tool has nothing, say that.

Run from the repo root. The flags are documented in CLAUDE.md's "Gap finder and buy check" and "Discover" sections; this skill is the order to use them in.

## 1. Pick the command

| He asks | Run |
|---|---|
| "What should I buy", "what am I missing", "fill the gaps" | `--gaps` |
| "I have lots of X, I need a Y for Z" (a use and a weather) | `--gaps --uses "<use>=often" --json`, then step 3's "Need a Y" chain |
| "Is X a good buy", "should I get X", "is X worth it" | `--check "X" --json` |
| "I like skin / clean / intimate scents, more of those" | `--style "skin,clean,intimate"`; `--all` when every style must hold at once |
| "More like Liquid Brun" | `--more-like "Liquid Brun"` (several, comma separated; `favorites` with `--journal`) |
| "Something with iris and leather for winter nights" | `--notes "iris leather" --season winter --slot night` |
| "Dupes of X", "a cheaper X" | `--dupes "X"` |
| "Does X smell like Y" | `--dupes "X"`, then step 3's "Smells like" chain |

Names take part of a name in any case, with or without accents; add the brand when a name is common. `--check` also takes a Fragrantica id (the number ending its URL), which is exact. Uses are `casual, office, date, nightout, formal, outdoors, cozy` at `never`, `sometimes` or `often`.

## 2. Set who's asking

These change the answer, so settle them before running:

- **Wardrobe.** His is the default; `--demo` only when he asks what a first-time visitor would see.
- **Switched-off bottles.** Pass the ones he mentions with `--exclude "Name,Name"`.
- **Journal.** When he sends his export (`scentcast-journal-<date>.json`), add `--journal <file>` to every command.
- **How he wears.** When he names an occasion, or the answer hinges on one, pass `--uses` (to `--check` too): Formal and Date Night settle most of `--gaps`' list. Ask when you can't tell.
- **Climate.** Pass `--city "<city>"` when he gives a place. `climate` in the JSON (in `--gaps`' text, its first line) names the climate the answer is for; when it isn't his place (Open-Meteo's archive failed, and stderr says "using the default climate"), tell him.
- **Value.** Keep "Prefer great value" on: he buys clones. `--no-value` when he says money's no object or asks for designer or niche picks.
- **Taste.** `--check` judges against his liked styles; add `--style "<styles>"` when he names others.
- **Lean and mists.** `--lean masculine|unisex|feminine` when he asks for one; `--mists` when he asks for body mists.
- **Filters** for `--style`, `--more-like` and `--notes`: `--season` and `--slot` as he asks; `--min-value 3.8` for value picks only; `--min-rating 4.2` for crowd favorites, or lower to let in a classic. `--top N` sets how many (default 10; `--gaps` 5).

## 3. Chain commands

A list says what a bottle is like; `--check` says whether it earns a place in his wardrobe. Check the two or three you're about to recommend from any list (ids come from `--json`):

```bash
ids=$(node scripts/recommend.mjs --style "vanilla,powdery" --all --min-value 3.8 --top 4 --json | jq -r '.results[].id')
for id in $ids; do node scripts/recommend.mjs --check "$id" --json | jq -r '"\(.name): \(.verdict), value \(.quality.value // "unknown"). \(.reasons[0])"'; done
```

- **Widen a gap.** `--gaps` gives the best picks for its gaps and stops there ("Nothing else would fill these gaps by enough" is an answer). For more options for one gap: `--styles "<a pick>"` (plural: one bottle's style scores) shows the pick's styles, `--style "<those>"` (with `--season` or `--slot` matching the gap) lists more, and `--check` keeps the ones whose verdict is Strong fit or Good with that gap in `fills`.
- **Need a Y.** For "I need a formal cold-weather bottle", read that use's cells and the gaps:

  ```bash
  node scripts/recommend.mjs --gaps --uses "formal=often" --json | jq -c '.climate, (.coverage[] | select(.use == "formal") | {cell, status, text}), (.gaps[] | {title, status})'
  ```

  Cells are `<use>:<day|night>:<band>`; "cold weather" or winter means the cold and cool bands, "summer" or hot weather the warm and hot ones, by day and by night unless he names one. `plenty` or `covered` means he already has it, and its `text` names the bottle that leads. Say so, then name what is actually short (the `gaps` lines). If he still wants one, `--more-like "<the leader>"` with `--season`/`--slot`, then `--check` each: Covered means it adds nothing he lacks.
- **Smells like.** `--dupes "X"` lists X's original, cheaper look-alikes and the bottles voters link it with, each with "N say it smells like it, M not" and how alike they are. Find Y there; else run `--dupes "Y"` and look for X. If neither lists the other, voters don't link them: say that, and give the compare page (step 5; ids from `--check "<name>" --json`) for how alike they read.
- **A cheaper one.** For any pick, `--dupes "<pick>"` gives cheaper look-alikes; `--gaps` and `--check` already give a `twin` when voters name one. For a wider net than the votes, `--more-like "<pick>" --min-value 3.8`.

## 4. Read the output

Text output is enough for `--gaps` and the lists, and shows a list pick's medium or high risk; use `--json` for ids or risk reasons. Read `--check` as `--json` (about 5 KB): its text leaves out `quality.value`.

`--check` verdicts:

| Verdict | Means | Say |
|---|---|---|
| Redundant | He owns it, its original, a twin, or something 80%+ alike | Don't buy; name what he owns |
| Risky | High blind-buy risk, or voters rate it under 3.8 | Sample first; give the reason |
| Covered | Nothing it adds matters, and it isn't a liked style he's thin on | Not needed; name who covers it |
| Strong fit | Fills his listed gaps a lot, at the pool's usual quality or better, low risk | Recommend |
| Good | Fills something, or is more of a style he likes and owns under 3 of | A fair buy; say which reason |

Verdicts ignore "Prefer great value". When `quality.value` is under 3.8, say so beside the verdict and look for a cheaper one (step 3).

Fields worth reading:

- `--gaps`: `gaps[]` (`title`, `status`: gap, then thin, then room to grow; `text`), `strengths[].text`, `coverage[]` per use × day or night × weather band (`status`: plenty, covered, room, thin, gap, off), and `picks[]`: `rating`, `ratingVotes`, `quality.value`, `fills[]` (`title`, `from` → `to`, `beats.name`), `nearest` (closest owned; `via` when it's an owned dupe's original), `twin.text`, `risk`.
- `--check`: `verdict`, `reasons[]`, `fills[]`, `overlap` (closest owned, `via`, `link`), `risk`, `twin`, `quality.value`.
- `--style`, `--more-like`, `--notes`: `results[]` with `rating`, `votes`, `value`, `styles`, `wearsClose`, `smellsLike` (what a clone copies, with votes), `closestOwned` (`through` an owned dupe's original; `shares`), `risk`, `cheaperTwin`, `why`.
- `--dupes`: `original` (`built: true` is the original of a dupe he owns; otherwise "going by the votes"), `cheaper[]` (`why: "notes"`: alike by notes, no votes; `notesDiffer`: voted alike but the notes differ), `siblings[]`, `smellsLikeVotes` [yes, no], `owned`, `mist`.
- `risk.level`: low, medium (a reason to mention), high (sample first) or unknown (no crowd data yet).

Stderr matters: "matches N bottles; checking the most voted" (confirm the brand or pass the id), "Reading X as Y" (a typo it fixed), "Few bottles list X; did you mean Y?" (run again with Y), "--exclude ... matches no bottle".

## 5. Reply

- Lead with the answer in one line: the verdict, or the two or three gaps that matter ("your one real gap is Date Night on warm nights").
- Then two to four bottles in the tool's order, each with why (what it fills, or the style, from the output) and one caveat: value score, blind-buy risk and its reason, a body mist, "a clone of X" (from `smellsLike`), or few votes.
- For a `--check`, relay the verdict and its reasons, then add what the numbers can't know: price, and whether he likes the notes.
- Name the closest bottle he already owns for each, and when it's Covered or Redundant, say plainly that he has it covered.
- Lead with value picks and name a cheaper twin when the output has one: David buys clones.
- The data has no prices. "Value" is voters' value for money (1–5); say so if he asks about price.
- The suggestion pool doesn't say where a bottle is sold (CLAUDE.md, Discover); mention it when he wants something from a US store.
- Credit Le Decanteur's Fragrantica dataset (CC BY-NC-SA 4.0) once when a list came from it.
- Offer the app for a closer look: `https://davidbeck45.github.io/scentcast/#/bottle/<id>`, `#/compare/<id>,<id>`, `#/discover?styles=skin,clean,intimate` or `#/discover?q=iris%20leather`.

The shape, from a `--gaps` run (the bottles change as the data does):

> Your one real gap is Date Night on mild and warm nights.
> 1. **Zenith** (Riiffs, 4.5★ from 1,055 votes, value 4.1, low risk): your best date-night bottle on mild nights, 88% against Infini Rose's 81%, and on warm ones. Closest you own is Cream Velvet (62% alike, vanilla and powdery), so it's your lane, not a copy.
> 2. **Infinity For Men** (Armaf, 4.6★ from 613 votes, value 4.1, low risk): for hot nights, where Jake tops out at 79%. Nearest to it is Absolu Aventus 2023, the original of your Supremacy, at 61% alike.
>
> Nothing else would fill these gaps by enough. (Le Decanteur's Fragrantica dataset)
