#!/usr/bin/env python3
"""Fetch data/parfumo.jsonl from parfumo.com.

One line per bottle, by Fragrantica id: its Parfumo page (`path`) and id
(`pid`), [average of 10, votes] for scent, longevity and sillage, `layer`,
the page's "Good to layer" list: [Parfumo id, community consensus %] for up to
30 bottles voters layer it with, best first, and `occasion`, what voters wear
it for ({Daily, Leisure, Business, Night Out, Evening, Sport: %}) with its vote
count as `occasionVotes`. Parfumo serves all of it without a browser: the
ratings are in the page's HTML, and the list and the occasion chart come from
the endpoints the page's Layer tab and classification chart call.

  python3 scripts/parfumo.py                  refresh every line
  python3 scripts/parfumo.py 94713 39314      refresh these Fragrantica ids
  python3 scripts/parfumo.py --add 39314 /Perfumes/Parfums_de_Marly/Layton
  python3 scripts/parfumo.py --search "Layton Parfums de Marly"

Then `npm run build:data`.
"""
import http.cookiejar
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILE = ROOT / "data/parfumo.jsonl"
SITE = "https://www.parfumo.com"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"
RATINGS = {"scent": "scent", "durability": "longevity", "sillage": "sillage"}
PAUSE = 2  # seconds between requests; a faster burst drew a Cloudflare challenge

def number(text: str) -> float | int:
    x = float(text.replace(",", ""))
    return int(x) if x.is_integer() else x


opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def get(path: str, form: dict | None = None) -> str:
    time.sleep(PAUSE)
    data = urllib.parse.urlencode(form).encode() if form else None
    req = urllib.request.Request(SITE + path, data=data, headers={"User-Agent": UA, "X-Requested-With": "XMLHttpRequest"})
    return opener.open(req, timeout=30).read().decode("utf-8", "replace")


def fetch(fid: int, path: str) -> dict:
    html = get(path)
    # The Layer tab posts the perfume's id and a page hash.
    pid, h = re.search(r"p_id:'(\d+)'", html), re.search(r"\bh:'([0-9a-f]{32})'", html)
    if not (pid and h):
        raise SystemExit(f"{path}: no perfume id on the page (wrong path?)")
    row = {"id": fid, "path": path, "pid": int(pid.group(1))}
    for item in re.finditer(r'class="rating-item[^"]*" data-type="(\w+)"(.*?)Ratings?</span>', html, re.S):
        key = RATINGS.get(item.group(1))
        score = re.search(r'rating-score[^>]*>([\d.]+)<', item.group(2))
        count = re.search(r'rating-count[^>]*>([\d,]+)', item.group(2))
        if key and score and count:
            row[key] = [number(score.group(1)), number(count.group(1))]
    listing = get("/action/perfume/get_similar.php", {"p_id": pid.group(1), "similar_type": "layer", "type": "all", "h": h.group(1)})
    row["layer"] = [[int(s), number(p)] for s, p in re.findall(r'data-s_id="(\d+)".*?data-percentage="([\d.]+)"', listing, re.S)]
    if chart := re.search(r"get_classification_chart\.php\",\{type:type,p:(\d+),h:'([0-9a-f]+)',csrf_key:'(\w+)'", html):
        p, hc, csrf = chart.groups()
        charts = get("/action/perfume/get_classification_chart.php", {"type": "pie", "p": p, "h": hc, "csrf_key": csrf})
        for title, label, votes in re.findall(r'pchart-title[^>]*>([^<]+)<.*?aria-label="([^"]*)".*?pchart-box-votes">([\d,]+)', charts, re.S):
            if title.strip() == "Occasion":
                row["occasion"] = {k.strip(): int(v) for k, v in re.findall(r"([^,]+?) (\d+)%", label)}
                row["occasionVotes"] = number(votes)
    title = re.search(r"<title>(.*?) »", html)
    print(f"{fid}: {title.group(1) if title else path}, {len(row['layer'])} to layer with", file=sys.stderr)
    return row


def search(query: str) -> None:
    html = get("/s_perfumes_x.php?in=1&filter=" + urllib.parse.quote(query))
    paths = sorted(set(re.findall(r'href="https://www\.parfumo\.com(/Perfumes/(?!Tops/)[^/"]+/[^"/]+)"', html)))
    print("\n".join(paths) or "No perfumes found.")


def main(args: list[str]) -> None:
    if args[:1] == ["--search"]:
        return search(" ".join(args[1:]))
    rows = [json.loads(line) for line in FILE.read_text().splitlines() if line.strip()]
    by_id = {r["id"]: r for r in rows}
    if args[:1] == ["--add"]:
        fid, path = int(args[1]), args[2]
        if fid not in by_id:
            rows.append({"id": fid})
        targets = {fid: path}
    else:
        wanted = {int(a) for a in args}
        unknown = wanted - set(by_id)
        if unknown:
            raise SystemExit(f"Not in data/parfumo.jsonl: {', '.join(map(str, sorted(unknown)))} (use --add ID PATH)")
        targets = {r["id"]: r["path"] for r in rows if not wanted or r["id"] in wanted}
    # Saved after each bottle: Parfumo's Cloudflare can start challenging (HTTP
    # 403) partway through, and a rerun of the ids not yet done picks up there.
    done = 0
    for i, r in enumerate(rows):
        if r["id"] not in targets:
            continue
        try:
            rows[i] = fetch(r["id"], targets[r["id"]])
        except urllib.error.HTTPError as err:
            if err.code != 403:
                raise
            left = [str(fid) for fid in targets][done:]
            raise SystemExit(f"Parfumo answered 403 (a Cloudflare challenge) after {done} of {len(targets)}; "
                             f"try later: python3 scripts/parfumo.py {' '.join(left)}")
        FILE.write_text("".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n" for r in rows))
        done += 1
    print(f"{done} fetched -> data/parfumo.jsonl", file=sys.stderr)


if __name__ == "__main__":
    main(sys.argv[1:])
