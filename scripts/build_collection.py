#!/usr/bin/env python3
"""Build the app's data files from raw Fragrantica scrapes.

- data/collection.jsonl -> data/collection.json: David's wardrobe (the demo).
- data/catalog.jsonl -> data/catalog.json: bottles outside the wardrobe that
  Fragella lacks (friends' niche and indie bottles), searchable in the app.
- data/calibration.jsonl -> data/calibration.json: well-voted bottles across
  every accord family, used only to fit the engine (scripts/fit-accords.mjs);
  the app never loads them.
- data/originals.jsonl -> data/originals.json: the bottles that dupes in the
  wardrobe or catalog are inspired by. data/dupes.json pairs them up (dupe
  slug, original slug), and each dupe carries a summary of its original's
  votes as `original`. The fit uses them too; the app doesn't load the file.
- data/parfumo.jsonl (from scripts/parfumo.py): Parfumo's longevity and
  sillage ratings (0-10 averages, with vote counts) by Fragrantica id, which
  Fragrantica's pages no longer show, and the shares of what voters wear it
  for (`occasion`: Daily, Leisure, Business, Night Out, Evening, Sport). Each
  matching bottle carries them as `parfumo`. Its "Good to layer" lists become `layeredWith` on wardrobe and
  catalog bottles: the other bottles there that Parfumo voters layer it with,
  [{id, consensus, via}], best first. A dupe stands in for its original on
  either side of a pair, with `via` naming the two Parfumo bottles voted on.
- data/fragrantica/ (from scripts/decant.py): each bottle's line there adds
  `like`, the season and night shares of the bottles voters say it smells
  like (the engine leans few votes toward them), and `performance`,
  Fragrantica's longevity (1-5) and sillage (1-4) vote averages, which the
  engine reads when Parfumo lacks the bottle.
- data/extras.jsonl (from `scripts/decant.py extras`): the dataset's about
  data for each bottle in the wardrobe, catalog and originals, as `about`
  (value for money, owners, crowd gender, popularity, perfumers, line,
  Fragrantica members' AI summary pros and cons, smells-like and also-liked
  bottles, flags), and its derived signals as `extras` (the suggestion pool's
  keys). Its rating histogram fills `sentiment` for lines built by
  `decant.py add`, which have none. A dupe's `original` gets the original's
  `extras`, `parfumo` and `performance`, and `siblings`: the original's other
  clones (`extras.clones`, well-priced bottles from other brands that voters
  say smell like it).

Each jsonl line is the output of scripts/fragrantica-extract.js for one
perfume page, or of `scripts/decant.py add` (built from the dataset, with its
name, brand, year and gender spelled out). Re-run this after adding or
removing lines.
"""
import json
import re
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEASONS = ("winter", "spring", "summer", "fall")
FILES = (
    ("collection", "fragrantica.com/@doeszen wardrobe (Have)"),
    ("catalog", "fragrantica.com, bottles added for other people's collections"),
    ("calibration", "fragrantica.com, well-voted bottles for fitting the engine"),
    ("originals", "fragrantica.com, the originals that dupes in data/ are inspired by"),
)
# What a dupe keeps of its original: enough to name it and lean on its votes
# (main() adds its signals, performance and siblings for the sheet).
ORIGINAL_KEYS = ("id", "name", "brand", "url", "thumb", "rating", "ratingVotes", "seasonVotes", "timeVotes", "season", "dayNight")
LIBRARY_SHARDS = 512  # as scripts/decant.py


def split_name_brand(h1: str, brand_slug: str) -> tuple[str, str]:
    name_brand = re.sub(r" for (women and men|men|women)$", "", h1)
    # The slug drops punctuation ("d-Annam" for "d'Annam"), so match word by word.
    words = [re.escape(w) for w in brand_slug.split("-") if w]
    m = re.search(r"\s(" + r"[\W_]*".join(words) + r")$", name_brand, re.I)
    if m:
        return name_brand[: m.start()].strip(), m.group(1)
    return name_brand, brand_slug.replace("-", " ")


def build(raw: dict) -> dict:
    brand_slug, rest = raw["slug"].split("/")
    pid = int(rest.rsplit("-", 1)[1])
    if raw.get("source") == "decant":
        name, brand, year, gender = raw["name"], raw["brand"], raw["year"], raw["gender"]
    else:
        m = re.search(r" - a (?:new )?fragrance for (women and men|men|women)(?: (\d{4}))?", raw["title"])
        gender = m.group(1) if m else None
        year = int(m.group(2)) if m and m.group(2) else None
        name, brand = split_name_brand(raw["h1"], brand_slug)

    wear = raw["wear"]
    season_total = sum(wear[s] for s in SEASONS) or 1
    time_total = (wear["day"] + wear["night"]) or 1
    return {
        "id": pid,
        "name": name,
        "brand": brand,
        "year": year,
        "gender": gender,
        "url": f"https://www.fragrantica.com/perfume/{raw['slug']}.html",
        "thumb": f"https://fimgs.net/mdimg/perfume-thumbs/dark-m.{pid}.2x.webp",
        "rating": raw["rating"],
        "ratingVotes": raw["votes"],
        "accords": raw["accords"],
        "seasonVotes": {s: wear[s] for s in SEASONS},
        "timeVotes": {"day": wear["day"], "night": wear["night"]},
        "season": {s: round(wear[s] / season_total, 3) for s in SEASONS},
        "dayNight": {"day": round(wear["day"] / time_total, 3), "night": round(wear["night"] / time_total, 3)},
        **({"sentiment": raw["likes"]} if "likes" in raw else {}),
        "notes": raw["notes"],
        **({"noteVotes": raw["noteVotes"]} if raw.get("noteVotes") else {}),
    }


def read(stem: str) -> list[dict]:
    src = ROOT / f"data/{stem}.jsonl"
    lines = src.read_text().splitlines() if src.exists() else []
    return [build(json.loads(line)) for line in lines if line.strip()]


def originals_by_dupe() -> dict[int, dict]:
    """Dupe id -> summary of its original, from data/dupes.json and data/originals.jsonl."""
    pairs = json.loads((ROOT / "data/dupes.json").read_text())
    by_id = {f["id"]: f for f in read("originals")}
    slug_id = lambda slug: int(slug.rsplit("-", 1)[1])
    out = {}
    for dupe, original in pairs:
        f = by_id.get(slug_id(original))
        if f is None:
            raise SystemExit(f"data/dupes.json: {original} is not in data/originals.jsonl")
        out[slug_id(dupe)] = {k: f[k] for k in ORIGINAL_KEYS}
    return out


def parfumo_rows() -> dict[int, dict]:
    """Fragrantica id -> its line in data/parfumo.jsonl."""
    lines = (ROOT / "data/parfumo.jsonl").read_text().splitlines()
    return {r["id"]: r for r in map(json.loads, filter(str.strip, lines))}


def parfumo_summary(r: dict) -> dict | None:
    """Parfumo longevity and sillage, and what voters wear it for, as a bottle carries them."""
    if "longevity" not in r or "sillage" not in r:
        return None
    summary = {
        "url": f"https://www.parfumo.com{r['path']}",
        "longevity": r["longevity"][0],
        "sillage": r["sillage"][0],
        "votes": min(r["longevity"][1], r["sillage"][1]),
    }
    if r.get("occasion") and r.get("occasionVotes"):
        total = sum(r["occasion"].values())
        summary["occasion"] = {k: round(v / total, 3) for k, v in r["occasion"].items()}
        summary["occasionVotes"] = r["occasionVotes"]
    return summary


def layered_with(bottles: list[dict], originals: dict[int, dict], parfumo: dict[int, dict]) -> dict[int, list]:
    """Bottle id -> the other bottles Parfumo voters layer it with, best first.

    A bottle stands for its own Parfumo page and, for a dupe, its original's,
    so Layton + Althaïr votes pair Détour Noir with Liquid Brun. A pair keeps
    its best consensus from either page's list, and is the same both ways.
    """
    row_by_pid = {r["pid"]: r for r in parfumo.values() if "pid" in r}
    stands = {}  # bottle id -> {Parfumo id: original's name, or None for its own page}
    for f in bottles:
        own = parfumo.get(f["id"], {}).get("pid")
        o = originals.get(f["id"])
        o_pid = parfumo.get(o["id"], {}).get("pid") if o else None
        stands[f["id"]] = {**({o_pid: o["name"]} if o_pid else {}), **({own: None} if own else {})}
    by_pid = {}
    for fid, pids in stands.items():
        for pid, via in pids.items():
            by_pid.setdefault(pid, []).append((fid, via))
    best = {}  # (a, b) -> (consensus, a's stand-in, b's stand-in)
    for a, pids in stands.items():
        for pid, via_a in pids.items():
            for partner, consensus in row_by_pid[pid].get("layer", []):
                for b, via_b in by_pid.get(partner, []):
                    if b != a and consensus > best.get((a, b), (0,))[0]:
                        best[(a, b)], best[(b, a)] = (consensus, via_a, via_b), (consensus, via_b, via_a)
    names = {f["id"]: f["name"] for f in bottles}
    out = {}
    for (a, b), (consensus, via_a, via_b) in best.items():
        entry = {"id": b, "consensus": consensus}
        if via_a or via_b:
            entry["via"] = [via_a or names[a], via_b or names[b]]
        out.setdefault(a, []).append(entry)
    for entries in out.values():
        entries.sort(key=lambda e: -e["consensus"])
    return out


def extras_rows() -> dict[int, dict]:
    """Fragrantica id -> its line in data/extras.jsonl."""
    path = ROOT / "data/extras.jsonl"
    lines = path.read_text().splitlines() if path.exists() else []
    return {r["id"]: r for r in map(json.loads, filter(str.strip, lines))}


def library_rows(ids: set[int]) -> dict[int, dict]:
    """Fragrantica id -> its row in data/fragrantica/r/ (see scripts/decant.py)."""
    out = {}
    for shard in {i % LIBRARY_SHARDS for i in ids}:
        path = ROOT / f"data/fragrantica/r/{shard}.json"
        if path.exists():
            rows = json.loads(path.read_text())
            out.update({int(k): v for k, v in rows.items() if int(k) in ids})
    return out


def library_extras(row: dict) -> dict:
    """`like` and `performance` from a bottle's dataset row, as src/fragrantica.js reads them."""
    extras = {}
    if row.get("k"):
        k = row["k"]
        extras["like"] = {"season": dict(zip(SEASONS, k[:4])), "night": k[4]}
    if row.get("l") and row.get("si"):
        extras["performance"] = {"longevity": row["l"][0], "sillage": row["si"][0], "votes": min(row["l"][1], row["si"][1])}
    return extras


def write(stem: str, source: str, rows: list[dict], originals: dict[int, dict], parfumo: dict[int, dict], layered: dict[int, list], library: dict[int, dict], extras: dict[int, dict]) -> None:
    out = ROOT / f"data/{stem}.json"
    for f in rows:
        if f["id"] in originals:
            f["original"] = originals[f["id"]]
        if summary := parfumo_summary(parfumo.get(f["id"], {})):
            f["parfumo"] = summary
        if f["id"] in layered:
            f["layeredWith"] = layered[f["id"]]
        f.update(library_extras(library.get(f["id"], {})))
        if x := extras.get(f["id"]):
            f.setdefault("sentiment", x["sentiment"])
            f["about"] = {k: v for k, v in x.items() if k not in ("id", "sentiment", "extras")}
            f["extras"] = x["extras"]
    rows.sort(key=lambda f: (f["brand"].lower(), f["name"].lower()))
    # "fetched" is the last time the data changed, so a rebuild alone keeps it.
    old = json.loads(out.read_text()) if out.exists() else {}
    fetched = old.get("fetched") if old.get("fragrances") == rows else date.today().isoformat()
    body = {"source": source, "fetched": fetched, "fragrances": rows}
    out.write_text(json.dumps(body, indent=2, ensure_ascii=False) + "\n")
    print(f"{len(rows)} fragrances -> data/{stem}.json")


def main() -> None:
    originals, parfumo = originals_by_dupe(), parfumo_rows()
    rows = {stem: read(stem) for stem, _ in FILES}
    # Pairs reach across the wardrobe and the catalog: a visitor's list can mix them.
    layered = layered_with(rows["collection"] + rows["catalog"], originals, parfumo)
    library = library_rows({f["id"] for stem_rows in rows.values() for f in stem_rows})
    extras = extras_rows()
    # A dupe's sheet compares it with its original (the app never loads
    # originals.json): the original's signals and performance, and its other
    # clones.
    for dupe, o in originals.items():
        if x := extras.get(o["id"]):
            o["extras"] = {k: v for k, v in x["extras"].items() if k != "clones"}
            o["siblings"] = [i for i in x["extras"]["clones"] if i != dupe]
        if summary := parfumo_summary(parfumo.get(o["id"], {})):
            o["parfumo"] = summary
        if performance := library_extras(library.get(o["id"], {})).get("performance"):
            o["performance"] = performance
    for stem, source in FILES:
        write(stem, source, rows[stem], originals, parfumo, layered, library, extras)


if __name__ == "__main__":
    main()
