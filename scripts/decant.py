#!/usr/bin/env python3
"""Every Fragrantica perfume, from Le Decanteur's Kaggle dataset.

The dataset (https://www.kaggle.com/datasets/ledecanteur/fragrantica-perfumes,
CC BY-NC-SA 4.0) is a scrape of all of Fragrantica, about 140,000 perfumes:
accords, notes with how strongly voters smell each, season and day/night
votes, longevity and sillage votes, and "smells like" suggestions with their
agree/disagree votes. Its season and day/night shares match our own scrapes to
a fraction of a point.

  python3 scripts/decant.py download          newest version into .cache/decant/v<N>/
  python3 scripts/decant.py build             data/fragrantica/ from it (the app's search)
  python3 scripts/decant.py similar 31861     what voters say it smells like (a dupe's original)
  python3 scripts/decant.py similar "liquid brun"
  python3 scripts/decant.py dupes             check data/dupes.json, suggest originals for the rest
  python3 scripts/decant.py add originals 9828 ...   lines for data/<stem>.jsonl, no browser
  python3 scripts/decant.py refresh           newer vote counts into data/*.jsonl

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
- meta.json: dataset version and counts. README.md: source and license.
"""
import gzip
import json
import re
import shutil
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


def build() -> None:
    by_id = {r["id"]: r for r in records() if r["accords"]}
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
    size = sum(len(gzip.compress(p.read_bytes())) for p in OUT.rglob("*.*"))
    print(f"{len(by_id)} bottles -> data/fragrantica/ ({len(shards)} record files, {len(index)} index files, {size / 1e6:.1f} MB gzipped)")
    print("then: node scripts/fit-profiles.mjs --write && npm run build:data && npm test")


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
    print(f"then: python3 scripts/parfumo.py --search \"<name brand>\" for each, npm run build:data, npm run fit, npm test")


def refresh() -> None:
    """Vote counts from the dataset wherever it has more votes than a line (votes only grow).

    Season and day/night votes come from the dataset's page capture, exact where
    our extractor reads Fragrantica's rounded "22.6k". Its ratings can come from
    an older index, so they're taken only when they have more votes too.
    """
    stems = ("collection", "catalog", "originals", "calibration")
    files = {stem: [json.loads(l) for l in (ROOT / f"data/{stem}.jsonl").read_text().splitlines() if l.strip()] for stem in stems}
    wanted = {line_id(l) for lines in files.values() for l in lines}
    dump = {r["id"]: r for r in records() if r["id"] in wanted}
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
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
