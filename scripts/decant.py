#!/usr/bin/env python3
"""Every Fragrantica perfume, from Le Decanteur's Kaggle dataset.

The dataset (https://www.kaggle.com/datasets/ledecanteur/fragrantica-perfumes,
CC BY-NC-SA 4.0) is a scrape of all of Fragrantica, about 140,000 perfumes:
accords, notes with how strongly voters smell each, season and day/night
votes, longevity and sillage votes, "smells like" suggestions with their
agree/disagree votes, and what else a page shows: rating, value for money and
gender votes, owners, popularity, perfumers, the AI summary of its reviews.
Its season and day/night shares match our own scrapes to a fraction of a point.

  python3 scripts/decant.py download          newest version into .cache/decant/v<N>/
  python3 scripts/decant.py build             data/fragrantica/ from it (search, records, pool, about)
  python3 scripts/decant.py pool              just pool.json and pool-notes.json
  python3 scripts/decant.py about             just x/
  python3 scripts/decant.py extras            data/extras.jsonl for the wardrobe, catalog and originals
  python3 scripts/decant.py similar 31861     what voters say it smells like (a dupe's original)
  python3 scripts/decant.py similar "liquid brun"
  python3 scripts/decant.py dupes             check data/dupes.json, suggest originals for the rest
  python3 scripts/decant.py add originals 9828 ...   lines for data/<stem>.jsonl, no browser
  python3 scripts/decant.py refresh           newer vote counts into data/*.jsonl, and extras

`download` needs a Kaggle API token in ~/.kaggle/access_token (kaggle.com,
Settings, API, Create New Token). The raw dump stays in .cache/ (ignored).

data/fragrantica/ holds every bottle that has accords, split so the app loads
only what it needs:
- r/<id % 512>.json: {id: row}, one compact row per bottle (src/fragrantica.js
  turns a row into an engine record). Row keys: s slug, n name, b brand,
  y year, g gender (f/m/u), r [rating, votes], a {accord: strength 0-100, as
  the dataset has it}, v [winter, spring, summer, fall, day, night] votes,
  l [longevity 1-5, votes], si [sillage 1-4, votes], no {t/m/b or f: {note:
  weight 0-100}}, k [winter, spring, summer, fall, night] shares of the
  bottles voters say it smells like.
- i/<xx>.tsv: the search index, split by the first two letters of each word of
  a bottle's name and brand: id, name, brand, year, season votes; most voted
  first.
- pool.json: the suggestion pool, bottles with 500+ rating votes plus rising
  ones (100-499, and 1000+ recent popularity), by brand then name; `cols`
  holds one array per key, row i of each being bottle i (fromPool in
  src/fragrantica.js makes engine records of them). Keys: id; n name; b index
  into `brands`; y year (0 unknown); g gender (f/m/u or ""); r rating x 100;
  rv rating votes; a indexes into `accords` and w their bar widths (30 + 0.7
  x strength, whole, as the engine sees them); v as r/'s; l and si longevity
  and sillage averages x 100 (0 without votes) and lv the fewer of their vote
  counts (rounded to 2 significant digits: they only weigh the average
  against the middle); k as r/'s, x 100. Signals: o owners (Fragrantica's
  "have") as 4 x log2(1 + owners), whole; rc reach, the share (x 100) of the
  bottles its fans also like that are among the pool's 5% most owned, at
  most its brand's median + 0.15 (-1 when none of them is in the pool and
  its brand has under 5 pool bottles); val value for money x 100 (1 overpriced
  .. 5 great value, few votes leaning to 3.1; 0 unvoted); safe blind-buy
  safety, the pool percentile of like+love share less 4 x hate share; keep
  keeper rate (have / (have + had)) over what pages that old keep, per mille;
  lean crowd gender x 100 (-100 feminine .. 100 masculine); now the pool
  percentile of recent popularity; like up to 3 bottles voters say it smells
  like (5+ net votes, 2:1), then any family ones further down its top 6, and
  fam a bit per like id that's family (30+ agreeing votes, 2.5 x the
  disagreeing: one scent, for telling a dupe from a new direction); fromPool
  splits them into extras.like and extras.family. alt up to 3 cheaper
  alternatives (smells like it, valued 1+ higher); f flag bits, as `flags`
  names them: discontinued, reformulated, notBlindBuy and hardToFind from AI
  summary cons more voters agree with than not (discontinued only when said
  of the bottle itself: not "weaker than the discontinued EDT", nor a guess
  like "may be discontinued"); brigaded (more than 1.5 ratings per owner with
  30%+ of them hate or 85%+ love, or more than 5 whatever the spread);
  polarizing (hate share in the pool's top tenth); mist (a body or hair mist,
  body spray or splash, by its name, description or the AI summary: "Book
  Loft Fine Fragrance Mist by", "impressive longevity for a body mist").
  `slugs` lists the page
  slugs slug_of() can't derive; `license`.
- pool-notes.json: `no`, row for row with the pool: each bottle's 8 strongest
  notes as [index into `notes` x 4 + tier (0 top, 1 heart, 2 base, 3 flat),
  votes in tenths of the top note's], in r/'s order.
- x/<id % 512>.json: {id: about}, for bottles with 30+ rating votes: h rating
  histogram [hate, dislike, ok, like, love], pv [value average, votes],
  o [have, had, want], cg [crowd lean, votes], p [all-time, recent
  popularity], pf perfumers, c line (collection), pr top 3 and co top 2 AI
  summary pros and cons [text, agree, disagree] (Fragrantica members'
  summary), sm top 5 smells-like [id, agree, disagree], al top 10 also-liked
  ids, f flag bits. src/fragrantica.js loadAbout() reads them with the
  readable keys data/extras.jsonl has.
- meta.json: dataset version and counts. README.md: source and license.

data/extras.jsonl has one line per bottle in data/collection, catalog and
originals: the about data with readable keys (sentiment, value, owners,
crowdGender, popularity, perfumers, line, pros, cons, smellsLike, alsoLiked,
flags) and `extras`, the pool's signals (value, safe, keep, lean, now, like,
family, alt, flags, owners, reach) plus `clones`, up to 6 well-priced bottles from other
brands that voters say smell like it (an original's are its dupe's siblings).
scripts/build_collection.py joins it.
"""
import bisect
import collections
import gzip
import json
import math
import re
import shutil
import statistics
import sys
import unicodedata
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache/decant"
OUT = ROOT / "data/fragrantica"
DATASET = "ledecanteur/fragrantica-perfumes"
API = "https://www.kaggle.com/api/v1"
TOKEN = Path.home() / ".kaggle/access_token"
SHARDS = 512
SEASONS = ("winter", "spring", "summer", "autumn")
GENDER = {"female": "f", "male": "m", "unisex": "u"}
# Words too common to split the index by; a bottle is still found by its other words.
STOP = set("de la le les des du di el en et by of the and for pour eau parfum parfums perfume perfumes edp edt".split())
# "Smells like" bottles count when voters agree and they have enough votes of their own.
LIKE_MIN_SEASON, LIKE_MIN_TIME = 100, 30
# Our extractor reads Fragrantica's accord bars, drawn 30% + 0.7 x strength wide;
# the dataset has the strength itself (fitted on 683 accords, median error 0.3).
BAR_FLOOR, BAR_SLOPE = 30, 0.7
# Note weights are 100 x (votes / the bottle's top note's votes) ^ 1.61 (fitted
# on 348 notes against our own vote counts); turned back into relative votes.
NOTE_WEIGHT_POWER = 1.61
LICENSE = ("CC BY-NC-SA 4.0 (https://creativecommons.org/licenses/by-nc-sa/4.0/): derived from Le Decanteur's "
           f"Fragrantica dataset (https://www.kaggle.com/datasets/{DATASET}), from Fragrantica members' votes")
# The suggestion pool: well-voted bottles, plus rising ones (fewer votes, but
# many people listing them lately: the new releases).
POOL_MIN_VOTES = 500
RISING_MIN_VOTES, RISING_MIN_RECENT = 100, 1000
POOL_NOTES = 8
# Per-bottle "about" files: bottles with this many rating votes.
ABOUT_MIN_VOTES = 30
# Value for money (1 overpriced .. 5 great value) leans toward 3.1 as if 20
# votes; it matches Fragrantica's AI summaries calling a bottle affordable or
# overpriced at AUC 0.98.
VALUE_PRIOR, VALUE_PRIOR_VOTES = 3.1, 20
# Blind-buy safety: the like + love share minus 4 x the hate share, both
# leaning toward the pool's medians as if 30 votes. The hate share is the best
# single predictor of an AI "not a safe blind buy" (AUC 0.73; the rating 0.56).
APPROVAL_PRIOR, HATE_PRIOR, SHARE_PRIOR_VOTES = 0.72, 0.015, 30
# Polarizing: a hate share in the pool's top tenth.
POLARIZING_QUANTILE = 0.9
# Keeper rate: have / (have + had) over what pages that old keep (newer pages
# haven't been passed on yet), leaning toward it as if 50 owners.
KEEP_BUCKET, KEEP_PRIOR_VOTES = 5000, 50
CROWD_PRIOR_VOTES = 10
# Cheaper alternatives: for a bottle valued at most 2.6, smells-like bottles
# (either way round) voted 10+ net and 2:1, with 100+ ratings, valued 1+ higher.
PRICEY, CHEAPER_BY, ALT_MIN_NET, ALT_MIN_VOTES = 2.6, 1.0, 10, 100
# Clones: smells-like bottles from other brands voted 20+ net and 2:1, valued 3.8+.
CLONE_MIN_NET, CLONE_MIN_VALUE = 20, 3.8
# Family: smells-like links strong enough to call two bottles one scent (30+
# agreeing votes, 2.5 x the disagreeing), among a bottle's 6 most agreed.
FAMILY_MIN_UP, FAMILY_RATIO, FAMILY_TOP = 30, 2.5, 6
FLAGS = ("discontinued", "reformulated", "notBlindBuy", "brigaded", "polarizing", "hardToFind", "mist")  # bit i is 1 << i
# Discontinued, said of the bottle itself in a con. Pros don't count: they
# praise "an alternative to the discontinued X". Nor do cons with a word before
# it that makes it another bottle ("weaker than the discontinued EDT", "the
# original version is discontinued") or a guess ("may be discontinued",
# "frequently discontinued", "hard to find or discontinued"), or that make it
# partly so ("in some regions", "discontinuation rumors").
DISCONTINUED = re.compile(r"discontinu", re.I)
NOT_ITSELF = re.compile(r"\b(?:alternative|replacement|successor|similar|reminiscent|clone|dupe|substitute|identical|revival|"
                        r"upgrade|downgrade|refinement|compared|than|unlike|as \w+ as|repackaged|flankers?|original|version|"
                        r"formula|formulation|packaging)\b", re.I)
HEDGED = re.compile(r"\b(?:may|might|could|possibl[ey]|probably|potentially|likely(?: to)?|often|frequent(?:ly)?|or|"
                    r"(?:risk|potential) (?:of|for)(?: \w+){0,2})(?: currently| now)?(?: be| become| being)?\s*$", re.I)
PARTLY = re.compile(r"discontinu\w*\W+(?:\w+\W+){0,2}?(?:scents|fragrances|favou?rites|classics|rumou?rs|concerns)\b"
                    r"|\bin (?:some|many|certain|several) (?:regions|markets|countries|areas)\b", re.I)
# Hard to find: a con about getting the bottle (not samples of it, or a dupe).
HARD_TO_FIND = re.compile(r"\b(?:hard(?:er)?|difficult|tough|tricky)[\s-]+to[\s-]+(?:find|source|locate|obtain|come by|get hold of)\b"
                          r"|\b(?:limited|scarce) availability\b", re.I)
NOT_THE_BOTTLE = re.compile(r"\b(?:samples?|testers?|decants?|dupes?|clones?|alternatives?)\b", re.I)


def says_discontinued(text: str) -> bool:
    m = DISCONTINUED.search(text)
    return bool(m) and not NOT_ITSELF.search(text[:m.start()]) and not HEDGED.search(text[:m.start()]) and not PARTLY.search(text)


# Flags read from AI summary cons more voters agree with than not.
FLAG_TEXT = {
    "discontinued": says_discontinued,
    "reformulated": re.compile(r"reformulat", re.I).search,
    "notBlindBuy": re.compile(r"blind.?buy", re.I).search,
    "hardToFind": lambda text: bool(HARD_TO_FIND.search(text)) and not NOT_THE_BOTTLE.search(text),
}
# A mist (body or hair mist, body spray or splash), not a perfume: its name says
# so, or its description ("Fine Fragrance Mist by", "this body mist"), or an AI
# summary point calls it one ("impressive longevity for a body mist", "high
# projection for a body splash"; not "performs like a body mist", "high price
# for body mist performance"). A plain "mist" in a name is a perfume's (Cashmere
# Mist, Iris Silver Mist), and so is a plain "spray" (Eau de Parfum Spray, On
# The Go Spray, Bon Parfumeur's 801 sea spray) or "brume" (Guerlain's Brume
# d'Automne): a name counts when it says what kind ("All-Over Spray", "Very
# Cool Spray", "Brume Soyeuse pour le Corps", "Brume de Bain"). A plain
# "spray" in a description is its atomizer.
MIST_KIND = r"(?:(?:fine )?fragrance|body|hair|body and hair|skin|perfume|perfumed|scented)"
MIST_NAME = re.compile(rf"\b(?:{MIST_KIND} (?:mist|spray|splash)|hair perfume|(?:all[- ]over|very cool|aroma|body (?:&|and) soul|splash fresh) spray"
                       rf"|brume (?:\w+ )?(?:corps|cheveux|parfum[ée]e|de bain|soyeuse|d['’]oreiller|fra[iî]ch(?:e|eur)|paillet[ée]e))\b", re.I)
MIST_DESC = re.compile(rf"\b(?:fine )?fragrance mist by\b|\bbody (?:mist|spray|splash) by\b|\bthis [\w\s'-]{{0,25}}?\b{MIST_KIND} (?:mist|spray|splash)\b"
                       rf"|\bis an? [\w\s,-]{{0,60}}?\b(?:body|hair|body and hair) (?:mist|spray|splash)\b"
                       r"|\bavailable (?:only )?as (?:an? )?[\d\s,.]*(?:ml )?(?:perfumed )?(?:body|fragrance) (?:mist|spray)\.?\s*$", re.I)
MIST_AI = re.compile(r"\b(?:for|from) (?:a|an) (?:\w+ )?(?:(?:body|fragrance|hair|aromatherapy) (?:mist|spray|splash)|mist|splash)\b|\bin mist form\b"
                     r"|\bthan (?:typical|other|most|basic|usual|regular|standard) (?:\w+ )?(?:body )?mists\b", re.I)


def is_mist(r: dict) -> bool:
    ai = (r.get("ai_summary") or {})
    points = [x["text"] for x in ai.get("pros", []) + ai.get("cons", []) if x["up_votes"] >= x["down_votes"]]
    return bool(MIST_NAME.search(r["name"]) or MIST_DESC.search(r.get("description") or "") or any(MIST_AI.search(t) for t in points))


# Reach: how much a bottle's fans also like the pool's REACH_TOP most-owned
# bottles (its also-liked list, Fragrantica's "people who like this also
# like"). The pool's median is 0.85; Granado, Phebo, Natura and O Boticário's
# fans like each other's bottles, at 0.20, Louis Vuitton's and some indie
# houses' sit low too. Owners alone don't show it (Granado's have as many
# per rating as Lattafa's). A house's best known bottles reach further than
# the house does (Granado's Bossa 0.40, its median 0.06), so a bottle's reach
# is at most its brand's median plus BRAND_REACH_SLACK, for a brand with
# BRAND_REACH_MIN pool bottles or more; niche houses sit at 0.65-0.95.
REACH_TOP = 0.05
BRAND_REACH_MIN = 5
BRAND_REACH_SLACK = 0.15
# Brigaded: far more ratings than owners with a lopsided spread (review-bombed
# or meme pages: SpongeBob, Bolsonaro, the Pride editions), or many times more
# whatever the spread (a brand's rating drive). Louis Vuitton bottles people
# rate from a tester run 1.5 to 2 ratings per owner with an ordinary spread.
BRIGADE_RATIO, BRIGADE_HATE, BRIGADE_LOVE, BRIGADE_ANY = 1.5, 0.3, 0.85, 5


def kaggle(path: str):
    if not TOKEN.exists():
        raise SystemExit(f"No Kaggle token at {TOKEN}: kaggle.com, Settings, API, Create New Token")
    req = urllib.request.Request(API + path, headers={"Authorization": f"Bearer {TOKEN.read_text().strip()}"})
    return urllib.request.urlopen(req, timeout=120)


def latest_dump() -> Path:
    dumps = sorted(CACHE.glob("v*/perfumes.jsonl"), key=lambda p: int(p.parent.name[1:]))
    if not dumps:
        raise SystemExit("No dataset in .cache/decant/: run `python3 scripts/decant.py download`")
    return dumps[-1]


def download() -> None:
    meta = json.load(kaggle(f"/datasets/view/{DATASET}"))
    target = CACHE / f"v{meta['currentVersionNumber']}"
    if (target / "perfumes.jsonl").exists():
        print(f"{target.relative_to(ROOT)} is the newest version ({meta['lastUpdated'][:10]})")
        return
    target.mkdir(parents=True, exist_ok=True)
    archive = target / "archive.zip"
    with kaggle(f"/datasets/download/{DATASET}") as res, archive.open("wb") as out:
        shutil.copyfileobj(res, out)
    with zipfile.ZipFile(archive) as z:
        for name in ("perfumes.jsonl", "SCHEMA.md"):
            z.extract(name, target)
    archive.unlink()
    print(f"version {meta['currentVersionNumber']} ({meta['lastUpdated'][:10]}) -> {target.relative_to(ROOT)}")


def records():
    # Line by line: a few descriptions hold a raw U+2028, which splitlines() would break on.
    with latest_dump().open(encoding="utf-8") as f:
        for line in f:
            yield json.loads(line)


def total(hist: dict | None) -> int:
    return sum(b["count"] for b in hist["histogram"]) if hist else 0


def season_votes(r: dict) -> int:
    return sum((r.get("seasons") or {}).values())


def normalize(s: str) -> str:
    """As src/collections.js normalizes names: no accents, lowercase, letters and digits."""
    s = "".join(c for c in unicodedata.normalize("NFD", s) if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def index_keys(name: str, brand: str) -> set[str]:
    return {w[:2] for w in normalize(f"{name} {brand}").split() if len(w) >= 2 and w not in STOP}


def like_shares(r: dict, by_id: dict) -> list | None:
    """Season and night shares of the bottles voters say it smells like, by net agreement."""
    near = [(by_id[s["id"]], s["up_votes"] - s["down_votes"]) for s in r["similar"]["reminds_me_of"]
            if s["up_votes"] > s["down_votes"] and s["id"] in by_id]
    near = [(o, w) for o, w in near if season_votes(o) >= LIKE_MIN_SEASON and o["daypart"]["day"] + o["daypart"]["night"] >= LIKE_MIN_TIME]
    if not near:
        return None
    weight = sum(w for _, w in near)
    season = [sum(w * o["seasons"][s] / season_votes(o) for o, w in near) / weight for s in SEASONS]
    night = sum(w * o["daypart"]["night"] / (o["daypart"]["day"] + o["daypart"]["night"]) for o, w in near) / weight
    return [round(x, 3) for x in (*season, night)]


def row(r: dict, like: list | None) -> dict:
    out = {"s": r["slug"], "n": r["name"], "b": r["brand"]}
    if r["year"]:
        out["y"] = r["year"]
    if r["gender"] in GENDER:
        out["g"] = GENDER[r["gender"]]
    if r["rating"]["average"]:
        out["r"] = [r["rating"]["average"], total(r["rating"])]
    out["a"] = {a["name"]: a["strength"] for a in r["accords"]}
    if season_votes(r):
        out["v"] = [*(r["seasons"][s] for s in SEASONS), r["daypart"]["day"], r["daypart"]["night"]]
    for key, short in (("longevity", "l"), ("sillage", "si")):
        if total(r.get(key)):
            out[short] = [r[key]["average"], total(r[key])]
    tiered, flat = r["notes"]["tiered"], r["notes"]["flat"]
    notes = {k[0]: {n["name"]: n["weight"] for n in tiered[k]} for k in ("top", "middle", "base") if tiered.get(k)}
    if not notes and flat:
        notes = {"f": {n["name"]: n["weight"] for n in flat}}
    if notes:
        out["no"] = notes
    if like:
        out["k"] = like
    return out


def write_json(path: Path, body) -> None:
    path.write_text(json.dumps(body, ensure_ascii=False, separators=(",", ":")) + "\n")


def dataset() -> dict[int, dict]:
    """Every bottle with accords (the ones data/fragrantica/r/ has), by id."""
    return {r["id"]: r for r in records() if r["accords"]}


def build() -> None:
    by_id = dataset()
    shards, index = {}, {}
    for pid, r in by_id.items():
        shards.setdefault(pid % SHARDS, {})[pid] = row(r, like_shares(r, by_id))
        for key in index_keys(r["name"], r["brand"]):
            index.setdefault(key, []).append(r)
    if OUT.exists():
        for sub in ("r", "i"):
            shutil.rmtree(OUT / sub, ignore_errors=True)
    (OUT / "r").mkdir(parents=True, exist_ok=True)
    (OUT / "i").mkdir(exist_ok=True)
    for n, rows in shards.items():
        write_json(OUT / f"r/{n}.json", dict(sorted(rows.items())))
    clean = lambda s: re.sub(r"[\t\n\r  ]+", " ", s).strip()
    for key, rs in index.items():
        rs.sort(key=lambda r: (-season_votes(r), r["id"]))
        lines = (f"{r['id']}\t{clean(r['name'])}\t{clean(r['brand'])}\t{r['year'] or ''}\t{season_votes(r)}" for r in rs)
        (OUT / f"i/{key}.tsv").write_text("\n".join(lines) + "\n")
    dump = latest_dump()
    write_json(OUT / "meta.json", {
        "dataset": f"https://www.kaggle.com/datasets/{DATASET}",
        "version": int(dump.parent.name[1:]),
        "bottles": len(by_id),
        "shards": SHARDS,
    })
    size = sum(len(gzip.compress(p.read_bytes())) for sub in ("r", "i") for p in (OUT / sub).iterdir())
    print(f"{len(by_id)} bottles -> data/fragrantica/ ({len(shards)} record files, {len(index)} index files, {size / 1e6:.1f} MB gzipped)")
    signals = Signals(by_id)
    pool(signals)
    about(signals)
    print("then: python3 scripts/decant.py extras, node scripts/fit-profiles.mjs --write, node scripts/fit-occasions.mjs --write, node scripts/fit-pool-styles.mjs --write, npm run build:data, npm test")


# ---------- Derived signals: the pool, about files and extras ----------

SENTIMENT = ("hate", "dislike", "ok", "like", "love")
CROWD = (("female", -1), ("female_leaning", -0.5), ("unisex", 0), ("male_leaning", 0.5), ("male", 1))
TIERS = ("top", "middle", "base")


def histogram(h: dict | None, buckets: int) -> list[int]:
    counts = [0] * buckets
    for b in (h or {}).get("histogram", []):
        counts[b["bucket"] - 1] += b["count"]
    return counts


def votes(r: dict) -> int:
    """Rating votes, the rating histogram's total."""
    return total(r["rating"])


def popularity(r: dict) -> tuple[int, int]:
    """Fragrantica's engagement score, all-time and in roughly the last two years."""
    pop = r.get("popularity") or {}
    return pop.get("magnitude") or 0, pop.get("recent_magnitude") or 0


def in_pool(r: dict) -> bool:
    n = votes(r)
    return n >= POOL_MIN_VOTES or (n >= RISING_MIN_VOTES and popularity(r)[1] >= RISING_MIN_RECENT)


def value(r: dict) -> float | None:
    n = total(r.get("price_value"))
    return (r["price_value"]["average"] * n + VALUE_PRIOR * VALUE_PRIOR_VOTES) / (n + VALUE_PRIOR_VOTES) if n else None


def hate_share(h: list[int]) -> float:
    return (h[0] + SHARE_PRIOR_VOTES * HATE_PRIOR) / (sum(h) + SHARE_PRIOR_VOTES)


def safety(h: list[int]) -> float:
    approval = (h[3] + h[4] + SHARE_PRIOR_VOTES * APPROVAL_PRIOR) / (sum(h) + SHARE_PRIOR_VOTES)
    return approval - 4 * hate_share(h)


def crowd(r: dict) -> tuple[float, int] | None:
    """The crowd's gender vote, -1 feminine .. +1 masculine (few votes lean to 0), and its count."""
    cg = r.get("community_gender") or {}
    n = sum(cg.values())
    return (sum(cg.get(k, 0) * w for k, w in CROWD) / (n + CROWD_PRIOR_VOTES), n) if n else None


def agreed(s: dict, min_net: int) -> bool:
    """A smells-like vote with min_net more agreeing than not, and twice as many."""
    return s["up_votes"] - s["down_votes"] >= min_net and s["up_votes"] >= 2 * s["down_votes"]


def by_net(items: list[dict]) -> list[dict]:
    return sorted(items, key=lambda x: -(x["up_votes"] - x["down_votes"]))


def slug_of(name: str, brand: str) -> str:
    """Fragrantica's usual page slug; src/fragrantica.js derives it the same way."""
    part = lambda s: re.sub(r"[^A-Za-z0-9]+", "-", re.sub(r"[\u0300-\u036f]", "", unicodedata.normalize("NFD", s))).strip("-")
    return f"{part(brand)}/{part(name)}"


def top_notes(r: dict) -> list[tuple[int, str, int]]:
    """A bottle's strongest notes as (tier, name, weight), in r/'s order; a top
    note counts 0.7 of its weight in the choice. Tiers 0-2 top, heart, base; 3 flat."""
    tiered, flat = r["notes"]["tiered"], r["notes"]["flat"]
    notes = [(t, n["name"], n["weight"]) for t, k in enumerate(TIERS) for n in tiered.get(k, [])]
    if not notes:
        notes = [(3, n["name"], n["weight"]) for n in flat]
    keep = set(sorted(range(len(notes)), key=lambda i: -notes[i][2] * (0.7 if notes[i][0] == 0 else 1))[:POOL_NOTES])
    return [n for i, n in enumerate(notes) if i in keep]


class Signals:
    """What the pool, about files and extras derive from a bottle's votes,
    with percentiles measured against the pool."""

    def __init__(self, by_id: dict[int, dict]):
        self.by_id = by_id
        kept = {}  # what pages that old keep: the median over bottles with 100+ ratings and 50+ owners
        for r in by_id.values():
            rel = r.get("relation") or {}
            owners = rel.get("have", 0) + rel.get("had", 0)
            if votes(r) >= 100 and owners >= 50:
                kept.setdefault(r["id"] // KEEP_BUCKET, []).append(rel["have"] / owners)
        self.kept = {age: statistics.median(shares) for age, shares in kept.items()}
        self.kept_overall = statistics.median(self.kept.values())
        # Bottle id -> the bottles voters say smell like it, the other way round.
        self.reverse = {}
        for o in by_id.values():
            for s in o["similar"]["reminds_me_of"]:
                if agreed(s, ALT_MIN_NET):
                    self.reverse.setdefault(s["id"], []).append({**s, "id": o["id"]})
        self.pool = sorted(filter(in_pool, by_id.values()), key=lambda r: (-popularity(r)[0], r["id"]))
        owned = sorted(((r.get("relation") or {}).get("have", 0), r["id"]) for r in self.pool)
        self.pool_ids = {r["id"] for r in self.pool}
        self.most_owned = {i for _, i in owned[int((1 - REACH_TOP) * len(owned)):]}
        brands = {}
        for r in self.pool:
            if (own := self.own_reach(r)) is not None:
                brands.setdefault(r["brand"], []).append(own)
        self.brand_reach = {b: statistics.median(xs) for b, xs in brands.items() if len(xs) >= BRAND_REACH_MIN}
        self.safeties = sorted(safety(histogram(r["rating"], 5)) for r in self.pool)
        self.recents = sorted(math.log1p(popularity(r)[1]) for r in self.pool)
        hates = sorted(hate_share(histogram(r["rating"], 5)) for r in self.pool)
        self.polarizing = hates[int(POLARIZING_QUANTILE * len(hates))]

    @staticmethod
    def percentile(ordered: list[float], x: float) -> int:
        return round(100 * bisect.bisect_left(ordered, x) / len(ordered))

    def keep(self, r: dict) -> float | None:
        rel = r.get("relation") or {}
        owners = rel.get("have", 0) + rel.get("had", 0)
        if not owners:
            return None
        e = self.kept.get(r["id"] // KEEP_BUCKET, self.kept_overall)
        return (rel["have"] + KEEP_PRIOR_VOTES * e) / (owners + KEEP_PRIOR_VOTES) - e

    def agreed_like(self, r: dict) -> list[dict]:
        """Its smells-like votes voters agree with (5+ net, 2:1), most agreed first."""
        return [s for s in by_net(r["similar"]["reminds_me_of"]) if agreed(s, 5) and s["id"] in self.by_id]

    def like(self, r: dict, n: int = 3) -> list[int]:
        """The bottles voters most agree it smells like."""
        return [s["id"] for s in self.agreed_like(r)[:n]]

    def family(self, r: dict) -> list[int]:
        """The bottles voters say smell like it so strongly they're one scent (dupes, clones, twins)."""
        return [s["id"] for s in self.agreed_like(r)[:FAMILY_TOP]
                if s["up_votes"] >= FAMILY_MIN_UP and s["up_votes"] >= FAMILY_RATIO * s["down_votes"]]

    def alternatives(self, r: dict, n: int = 3) -> list[int]:
        """Cheaper bottles that smell like it: far better value, agreed either way round."""
        v = value(r)
        if v is None or v > PRICEY:
            return []
        near = {}
        for s in [*r["similar"]["reminds_me_of"], *self.reverse.get(r["id"], [])]:
            o = self.by_id.get(s["id"])
            if (o and s["id"] not in near and agreed(s, ALT_MIN_NET) and votes(o) >= ALT_MIN_VOTES
                    and (value(o) or 0) >= v + CHEAPER_BY):
                near[s["id"]] = s
        return [s["id"] for s in by_net(list(near.values()))][:n]

    def clones(self, r: dict, n: int = 6) -> list[int]:
        """Well-priced bottles from other brands, released no earlier, that voters say smell like it."""
        near = {}
        for s in [*self.reverse.get(r["id"], []), *r["similar"]["reminds_me_of"]]:
            o = self.by_id.get(s["id"])
            if (o and s["id"] not in near and agreed(s, CLONE_MIN_NET) and votes(o) >= ALT_MIN_VOTES
                    and o["brand"] != r["brand"] and (value(o) or 0) >= CLONE_MIN_VALUE
                    and (not o["year"] or not r["year"] or o["year"] >= r["year"])):
                near[s["id"]] = s
        return [s["id"] for s in by_net(list(near.values()))][:n]

    def own_reach(self, r: dict) -> float | None:
        """The share of the pool bottles its fans also like that are among the pool's most owned."""
        also = [s["id"] for s in r["similar"]["also_liked"] if s["id"] in self.pool_ids]
        return sum(i in self.most_owned for i in also) / len(also) if also else None

    def reach(self, r: dict) -> float | None:
        """Its own reach, at most its brand's median plus BRAND_REACH_SLACK (its brand's, without its own)."""
        own, brand = self.own_reach(r), self.brand_reach.get(r["brand"])
        cap = brand + BRAND_REACH_SLACK if brand is not None else None
        return own if cap is None else cap if own is None else min(own, cap)

    def flags(self, r: dict) -> int:
        cons = [x["text"] for x in (r.get("ai_summary") or {}).get("cons", []) if x["up_votes"] > x["down_votes"]]
        on = {name for name, says in FLAG_TEXT.items() if any(says(text) for text in cons)}
        if is_mist(r):
            on.add("mist")
        rel, h = r.get("relation") or {}, histogram(r["rating"], 5)
        n, owners = sum(h), rel.get("have", 0) + rel.get("had", 0)
        if n > BRIGADE_RATIO * owners and (n > BRIGADE_ANY * owners or h[0] >= BRIGADE_HATE * n or h[4] >= BRIGADE_LOVE * n):
            on.add("brigaded")
        if n and hate_share(h) >= self.polarizing:
            on.add("polarizing")
        return sum(1 << i for i, name in enumerate(FLAGS) if name in on)

    def extras(self, r: dict) -> dict:
        """A bottle's signals as records carry them (`extras`); the pool packs the same numbers."""
        v, keep, lean, flags = value(r), self.keep(r), crowd(r), self.flags(r)
        return {
            "value": round(v, 2) if v is not None else None,
            "safe": self.percentile(self.safeties, safety(histogram(r["rating"], 5))),
            "keep": round(keep, 3) if keep is not None else None,
            "lean": round(lean[0], 2) if lean else None,
            "now": self.percentile(self.recents, math.log1p(popularity(r)[1])),
            "like": self.like(r),
            "family": self.family(r),
            "alt": self.alternatives(r),
            "flags": [name for i, name in enumerate(FLAGS) if flags & (1 << i)],
            "owners": (r.get("relation") or {}).get("have"),
            "reach": round(reach, 2) if (reach := self.reach(r)) is not None else None,
        }

    def about(self, r: dict) -> dict:
        """A bottle's about row (data/fragrantica/x/), short keys."""
        out = {"h": histogram(r["rating"], 5)}
        if n := total(r.get("price_value")):
            out["pv"] = [round(r["price_value"]["average"], 2), n]
        if rel := r.get("relation"):
            out["o"] = [rel.get("have", 0), rel.get("had", 0), rel.get("want", 0)]
        if lean := crowd(r):
            out["cg"] = [round(lean[0], 2), lean[1]]
        if any(pop := popularity(r)):
            out["p"] = list(pop)
        if r.get("perfumers"):
            out["pf"] = [p["name"] for p in r["perfumers"]]
        if r.get("collection"):
            out["c"] = r["collection"]
        ai = r.get("ai_summary") or {}
        for key, short, n in (("pros", "pr", 3), ("cons", "co", 2)):
            items = [x for x in by_net(ai.get(key, [])) if x["up_votes"] > x["down_votes"]][:n]
            if items:
                out[short] = [[x["text"], x["up_votes"], x["down_votes"]] for x in items]
        sims = [s for s in by_net(r["similar"]["reminds_me_of"]) if s["up_votes"] > s["down_votes"] and s["id"] in self.by_id]
        if sims:
            out["sm"] = [[s["id"], s["up_votes"], s["down_votes"]] for s in sims[:5]]
        if also := [s["id"] for s in r["similar"]["also_liked"] if s["id"] in self.by_id][:10]:
            out["al"] = also
        if f := self.flags(r):
            out["f"] = f
        return out


def readable_about(x: dict) -> dict:
    """An about row with readable keys, as src/fragrantica.js loadAbout() returns it."""
    out = {"sentiment": dict(zip(SENTIMENT, x["h"]))}
    if "pv" in x:
        out["value"] = {"avg": x["pv"][0], "votes": x["pv"][1]}
    if "o" in x:
        out["owners"] = dict(zip(("have", "had", "want"), x["o"]))
    if "cg" in x:
        out["crowdGender"] = {"lean": x["cg"][0], "votes": x["cg"][1]}
    if "p" in x:
        out["popularity"] = {"all": x["p"][0], "recent": x["p"][1]}
    out["perfumers"] = x.get("pf", [])
    out["line"] = x.get("c")
    for short, key in (("pr", "pros"), ("co", "cons")):
        out[key] = [{"text": t, "up": up, "down": down} for t, up, down in x.get(short, [])]
    out["smellsLike"] = [{"id": i, "up": up, "down": down} for i, up, down in x.get("sm", [])]
    out["alsoLiked"] = x.get("al", [])
    out["flags"] = [name for i, name in enumerate(FLAGS) if x.get("f", 0) & (1 << i)]
    return out


def bar_width(strength: float) -> int:
    """As src/accords.js barWidth, which rounds halves up (Python's round() goes to even)."""
    return math.floor(BAR_FLOOR + BAR_SLOPE * strength + 0.5)


def two_digits(n: int) -> int:
    """A count to 2 significant digits (1,234 -> 1,200), which gzips far smaller."""
    if n < 100:
        return n
    step = 10 ** (len(str(n)) - 2)
    return (n + step // 2) // step * step


def gz_size(path: Path) -> int:
    return len(gzip.compress(path.read_bytes(), 9))


def pool(signals: Signals) -> None:
    """data/fragrantica/pool.json and pool-notes.json: the suggestion pool, one array per key."""
    by_id = signals.by_id
    # By brand, then name: flankers sit together, which compresses best.
    brands = sorted({r["brand"] for r in signals.pool}, key=str.casefold)
    bottles = sorted(signals.pool, key=lambda r: (r["brand"].casefold(), r["name"].casefold(), r["id"]))
    accords = [a for a, _ in collections.Counter(a["name"] for r in bottles for a in r["accords"]).most_common()]
    notes = [n for n, _ in collections.Counter(n for r in bottles for _, n, _ in top_notes(r)).most_common()]
    brand_ix, accord_ix, note_ix = ({x: i for i, x in enumerate(xs)} for xs in (brands, accords, notes))
    cols, slugs = {}, {}
    for r in bottles:
        if r["slug"] != slug_of(r["name"], r["brand"]):
            slugs[r["id"]] = r["slug"]
        x = signals.extras(r)
        lon, sil = total(r.get("longevity")), total(r.get("sillage"))
        like = like_shares(r, by_id)
        # Its smells-like bottles, then any family ones past the top 3; a bit per id marks family.
        near = x["like"] + [i for i in x["family"] if i not in x["like"]]
        for key, val in (
            ("id", r["id"]), ("n", r["name"]), ("b", brand_ix[r["brand"]]), ("y", r["year"] or 0),
            ("g", GENDER.get(r["gender"], "")), ("r", round(r["rating"]["average"] * 100)), ("rv", votes(r)),
            ("a", [accord_ix[a["name"]] for a in r["accords"]]),
            # The engine sees accords as whole bar widths, 30 + 0.7 x strength, so those are kept exactly.
            ("w", [bar_width(a["strength"]) for a in r["accords"]]),
            ("v", [*(r["seasons"][s] for s in SEASONS), r["daypart"]["day"], r["daypart"]["night"]] if season_votes(r) else []),
            ("l", round(r["longevity"]["average"] * 100) if lon and sil else 0),
            ("si", round(r["sillage"]["average"] * 100) if lon and sil else 0),
            ("lv", two_digits(min(lon, sil))),
            ("k", [round(s * 100) for s in like] if like else []),
            ("val", round(x["value"] * 100) if x["value"] is not None else 0),
            ("safe", x["safe"]),
            ("keep", round(x["keep"] * 1000) if x["keep"] is not None else None),
            ("lean", round(x["lean"] * 100) if x["lean"] is not None else None),
            ("now", x["now"]),
            ("like", near),
            ("fam", sum(1 << j for j, i in enumerate(near) if i in x["family"])),
            ("alt", x["alt"]),
            ("f", signals.flags(r)),
            ("o", round(4 * math.log2(1 + (x["owners"] or 0)))),
            ("rc", round(100 * x["reach"]) if x["reach"] is not None else -1),
        ):
            cols.setdefault(key, []).append(val)
    body = {"license": LICENSE, "version": int(latest_dump().parent.name[1:]), "count": len(bottles),
            "brands": brands, "accords": accords, "flags": FLAGS, "slugs": slugs, "cols": cols}
    write_json(OUT / "pool.json", body)
    # Each note as [note index x 4 + tier, votes in tenths of the top note's], in r/'s order.
    tenths = lambda w: max(round(10 * (w / 100) ** (1 / NOTE_WEIGHT_POWER)), 1) if w else 0
    write_json(OUT / "pool-notes.json", {"license": LICENSE, "count": len(bottles), "notes": notes,
                                         "no": [[v for t, n, w in top_notes(r) for v in (note_ix[n] * 4 + t, tenths(w))] for r in bottles]})
    for name in ("pool.json", "pool-notes.json"):
        path = OUT / name
        print(f"data/fragrantica/{name}: {len(bottles)} bottles, {path.stat().st_size / 1024:.0f} KB, {gz_size(path) / 1024:.0f} KB gzip -9")


def about(signals: Signals) -> None:
    """data/fragrantica/x/<id % 512>.json: what a bottle's page shows beyond its record."""
    shards = {}
    for pid, r in signals.by_id.items():
        if votes(r) >= ABOUT_MIN_VOTES:
            shards.setdefault(pid % SHARDS, {})[pid] = signals.about(r)
    shutil.rmtree(OUT / "x", ignore_errors=True)
    (OUT / "x").mkdir(parents=True)
    for n, rows in shards.items():
        write_json(OUT / f"x/{n}.json", dict(sorted(rows.items())))
    paths = list((OUT / "x").iterdir())
    print(f"data/fragrantica/x/: {sum(map(len, shards.values()))} bottles, {sum(p.stat().st_size for p in paths) / 1e6:.1f} MB, "
          f"{sum(map(gz_size, paths)) / 1e6:.1f} MB gzip -9")


def jsonl_ids(*stems: str) -> list[int]:
    return [line_id(json.loads(l)) for stem in stems for l in (ROOT / f"data/{stem}.jsonl").read_text().splitlines() if l.strip()]


def extras(signals: Signals) -> None:
    """data/extras.jsonl: the about data and signals of every bottle in the
    wardrobe, catalog and originals, which scripts/build_collection.py joins."""
    ids = sorted(set(jsonl_ids("collection", "catalog", "originals")))
    lines = []
    for pid in ids:
        if r := signals.by_id.get(pid):
            lines.append({"id": pid, **readable_about(signals.about(r)), "extras": {**signals.extras(r), "clones": signals.clones(r)}})
    (ROOT / "data/extras.jsonl").write_text("".join(json.dumps(l, ensure_ascii=False, separators=(",", ":")) + "\n" for l in lines))
    missing = len(ids) - len(lines)
    print(f"data/extras.jsonl: {len(lines)} bottles{f' ({missing} newer than the dataset)' if missing else ''}")


def describe(r: dict) -> str:
    return f"{r['name']} ({r['brand']}{', ' + str(r['year']) if r['year'] else ''}) [{r['id']}, {season_votes(r)} votes]"


def similar(query: str) -> None:
    by_id = {r["id"]: r for r in records()}
    if query.isdigit():
        hits = [by_id[int(query)]] if int(query) in by_id else []
    else:
        words = normalize(query).split()
        hits = sorted((r for r in by_id.values() if all(w in normalize(f"{r['name']} {r['brand']}") for w in words)), key=lambda r: -season_votes(r))[:5]
    if not hits:
        raise SystemExit(f"No perfume matches {query!r}")
    for r in hits:
        print(describe(r))
        sims = sorted(r["similar"]["reminds_me_of"], key=lambda s: -(s["up_votes"] - s["down_votes"]))
        for s in sims:
            o = by_id.get(s["id"])
            print(f"  {s['up_votes']:>6} up {s['down_votes']:>5} down  {describe(o) if o else s['slug']}")
        if not sims:
            print("  (no smells-like votes)")


def ranked_similar(r: dict, by_id: dict) -> list[tuple[dict, int, int]]:
    """Smells-like bottles the dataset has, most agreed first: (bottle, up, down)."""
    sims = [(by_id[s["id"]], s["up_votes"], s["down_votes"]) for s in r["similar"]["reminds_me_of"] if s["id"] in by_id]
    return sorted(sims, key=lambda x: -(x[1] - x[2]))


# A suggested original needs this many agreeing votes, twice the disagreeing ones.
ORIGINAL_MIN_UP = 20


def likely_original(r: dict, by_id: dict) -> tuple[dict, int, int] | None:
    """Among the three bottles voters most agree it smells like, one from
    another brand released no later: the usual shape of a dupe and its original
    (a popular dupe can outsell it, and the dataset lacks some years)."""
    for o, up, down in ranked_similar(r, by_id)[:3]:
        if (up >= ORIGINAL_MIN_UP and up > 2 * down and o["brand"] != r["brand"]
                and (not o["year"] or not r["year"] or o["year"] <= r["year"])):
            return o, up, down
    return None


def dupes() -> None:
    """Each curated pair in data/dupes.json against the votes, then a guess for every other bottle."""
    by_id = {r["id"]: r for r in records()}
    pairs = {int(d.rsplit("-", 1)[1]): int(o.rsplit("-", 1)[1]) for d, o in json.loads((ROOT / "data/dupes.json").read_text())}
    ids = [line_id(json.loads(l)) for stem in ("collection", "catalog") for l in (ROOT / f"data/{stem}.jsonl").read_text().splitlines() if l.strip()]
    print("Curated pairs (rank of the original among the bottle's smells-like votes):")
    for pid in ids:
        if pid not in pairs or pid not in by_id:
            continue
        r, orig = by_id[pid], by_id.get(pairs[pid])
        ranked = [o["id"] for o, _, _ in ranked_similar(r, by_id)]
        rank = ranked.index(pairs[pid]) + 1 if pairs[pid] in ranked else None
        guess = likely_original(r, by_id)
        agree = ("agrees" if rank == 1 or (guess and guess[0]["id"] == pairs[pid])
                 else f"votes point to {guess[0]['name']}" if guess else "no clear original in the votes")
        print(f"  {r['name']} -> {orig['name'] if orig else pairs[pid]}: rank {rank or '-'}, {agree}")
    print("\nUnpaired bottles whose votes point to an original (add real dupes to data/dupes.json):")
    guesses = [(pid, likely_original(by_id[pid], by_id)) for pid in ids if pid not in pairs and pid in by_id]
    for pid, (o, up, down) in [(pid, g) for pid, g in guesses if g]:
        print(f"  {describe(by_id[pid])}\n    maybe {describe(o)}: {up} up, {down} down")
    if not any(g for _, g in guesses):
        print("  none")


GENDER_WORDS = {"female": "women", "male": "men", "unisex": "women and men"}


def jsonl_line(r: dict) -> dict:
    """A data/*.jsonl line built from the dataset, in the shape scripts/build_collection.py reads."""
    weights = {}
    tiered = r["notes"]["tiered"]
    notes = {k: [n["name"] for n in tiered.get(src, [])] for k, src in (("top", "top"), ("mid", "middle"), ("base", "base")) if tiered.get(src)}
    if not notes and r["notes"]["flat"]:
        notes = {"all": [n["name"] for n in r["notes"]["flat"]]}
    for n in [*sum((tiered.get(k, []) for k in ("top", "middle", "base")), []), *r["notes"]["flat"]]:
        weights[n["name"]] = n["weight"]
    line = {
        "slug": f"{r['slug']}-{r['id']}",
        "source": "decant",
        "name": r["name"],
        "brand": r["brand"],
        "year": r["year"],
        "gender": GENDER_WORDS.get(r["gender"]),
        "rating": r["rating"]["average"],
        "votes": total(r["rating"]),
        "accords": {a["name"]: round(BAR_FLOOR + BAR_SLOPE * a["strength"]) for a in r["accords"]},
        "wear": {**{("fall" if s == "autumn" else s): r["seasons"][s] for s in SEASONS}, **r["daypart"]},
        "notes": notes,
    }
    if any(weights.values()):
        line["noteVotes"] = {n: round(1000 * (w / 100) ** (1 / NOTE_WEIGHT_POWER)) for n, w in weights.items() if w}
    return line


def line_id(line: dict) -> int:
    return int(line["slug"].rsplit("-", 1)[1])


def add(stem: str, ids: list[int]) -> None:
    path = ROOT / f"data/{stem}.jsonl"
    if not path.exists():
        raise SystemExit(f"No data/{stem}.jsonl")
    wanted = set(ids)
    found = {r["id"]: r for r in records() if r["id"] in wanted}
    missing = wanted - set(found)
    if missing:
        raise SystemExit(f"Not in the dataset: {', '.join(map(str, sorted(missing)))}")
    lines = [json.loads(l) for l in path.read_text().splitlines() if l.strip()]
    index = {line_id(l): n for n, l in enumerate(lines)}
    for pid in ids:
        line = jsonl_line(found[pid])
        if pid in index:
            lines[index[pid]] = line
        else:
            lines.append(line)
        print(f"{'replaced' if pid in index else 'added'} {describe(found[pid])}")
    path.write_text("".join(json.dumps(l, ensure_ascii=False, separators=(",", ":")) + "\n" for l in lines))
    print(f"then: python3 scripts/decant.py extras, python3 scripts/parfumo.py --search \"<name brand>\" for each, npm run build:data, npm run fit, npm test")


def refresh() -> None:
    """Vote counts from the dataset wherever it has more votes than a line (votes only grow).

    Season and day/night votes come from the dataset's page capture, exact where
    our extractor reads Fragrantica's rounded "22.6k". Its ratings can come from
    an older index, so they're taken only when they have more votes too.
    Then data/extras.jsonl is written afresh.
    """
    stems = ("collection", "catalog", "originals", "calibration")
    files = {stem: [json.loads(l) for l in (ROOT / f"data/{stem}.jsonl").read_text().splitlines() if l.strip()] for stem in stems}
    dump = dataset()
    for stem, lines in files.items():
        changed = 0
        for line in lines:
            r = dump.get(line_id(line))
            ours = sum(line["wear"][s] for s in ("winter", "spring", "summer", "fall"))
            if not r or season_votes(r) <= ours:
                continue
            line["wear"] = {**{("fall" if s == "autumn" else s): r["seasons"][s] for s in SEASONS}, **r["daypart"]}
            if total(r["rating"]) > line["votes"]:
                line["rating"], line["votes"] = r["rating"]["average"], total(r["rating"])
            changed += 1
        (ROOT / f"data/{stem}.jsonl").write_text("".join(json.dumps(l, ensure_ascii=False, separators=(",", ":")) + "\n" for l in lines))
        print(f"data/{stem}.jsonl: {changed} of {len(lines)} lines had newer votes")
    extras(Signals(dump))
    print("then: npm run build:data, npm run fit, npm test")


def main(args: list[str]) -> None:
    cmd, rest = (args[0], args[1:]) if args else ("", [])
    if cmd == "download":
        download()
    elif cmd == "build":
        build()
    elif cmd == "similar" and rest:
        similar(" ".join(rest))
    elif cmd == "dupes":
        dupes()
    elif cmd == "add" and len(rest) >= 2:
        add(rest[0], [int(x) for x in rest[1:]])
    elif cmd == "refresh":
        refresh()
    elif cmd in ("pool", "about", "extras"):
        {"pool": pool, "about": about, "extras": extras}[cmd](Signals(dataset()))
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
