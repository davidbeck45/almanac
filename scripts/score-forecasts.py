#!/usr/bin/env python3
"""Score Open-Meteo's weather models against what actually happened.

    python3 scripts/score-forecasts.py [START END]   (dates, default the last 5 weeks)

For airports in 14 US cities, takes each model's past forecasts at 0-6 days
ahead (Open-Meteo's Previous Runs API) and compares them with the hourly
airport readings (Iowa Environmental Mesonet's ASOS archive): temperature and
dew point in the app's day and night windows, and the daily high and low.
Prints the mean absolute error (°F) of each model and of the blends, overall
and by city. src/weather.js averages BLEND_MODELS; rerun this to recheck it.
Responses are cached in .cache/forecast-scores/.
"""
import csv
import io
import json
import sys
import time
import urllib.request
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache/forecast-scores"
STATIONS = {  # ASOS id: (city, time zone)
    "DAL": ("Dallas Love", "America/Chicago"), "DFW": ("Dallas/Fort Worth", "America/Chicago"),
    "IAH": ("Houston", "America/Chicago"), "AUS": ("Austin", "America/Chicago"),
    "NYC": ("New York", "America/New_York"), "ORD": ("Chicago", "America/Chicago"),
    "DEN": ("Denver", "America/Denver"), "PHX": ("Phoenix", "America/Phoenix"),
    "LAX": ("Los Angeles", "America/Los_Angeles"), "SEA": ("Seattle", "America/Los_Angeles"),
    "MIA": ("Miami", "America/New_York"), "ATL": ("Atlanta", "America/New_York"),
    "BOS": ("Boston", "America/New_York"), "MSP": ("Minneapolis", "America/Chicago"),
}
MODELS = ["gfs_seamless", "ecmwf_ifs", "icon_seamless", "gem_seamless"]
CANDIDATES = {
    "default (GFS in the US)": ["gfs_seamless"],
    "ECMWF": ["ecmwf_ifs"],
    "ICON": ["icon_seamless"],
    "GEM": ["gem_seamless"],
    "GFS+ECMWF": ["gfs_seamless", "ecmwf_ifs"],
    "GFS+ECMWF+ICON": ["gfs_seamless", "ecmwf_ifs", "icon_seamless"],
    "all four (the app)": MODELS,
}
LEADS = [""] + [f"_previous_day{n}" for n in range(1, 7)]
WINDOW_HOURS = set(range(10, 18)) | set(range(19, 24))  # src/weather.js WINDOWS


def get(url: str, path: Path) -> str:
    if path.exists():
        return path.read_text()
    for _ in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "almanac forecast scoring"})
            with urllib.request.urlopen(req, timeout=90) as r:
                text = r.read().decode()
            path.write_text(text)
            time.sleep(1)
            return text
        except OSError as e:
            print(f"retrying {url[:70]}: {e}", file=sys.stderr)
            time.sleep(5)
    raise SystemExit(f"could not fetch {url}")


def observations(station: str, start: str, end: str):
    """{utc hour: (temp °F, dew point °F or None)}, plus the station's lat/lon."""
    a, b = date.fromisoformat(start), date.fromisoformat(end) + timedelta(days=2)
    url = ("https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?"
           f"station={station}&data=tmpf&data=dwpf&year1={a.year}&month1={a.month}&day1={a.day}"
           f"&year2={b.year}&month2={b.month}&day2={b.day}&tz=Etc/UTC&format=onlycomma&latlon=yes&missing=M&report_type=3")
    out, lat, lon = {}, None, None
    for r in csv.DictReader(io.StringIO(get(url, CACHE / f"obs-{station}-{start}-{end}.csv"))):
        if r["tmpf"] == "M":
            continue
        t = datetime.strptime(r["valid"], "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
        # Routine reports come at :51-:56 and stand for the next hour.
        out[(t + timedelta(minutes=30)).replace(minute=0)] = (float(r["tmpf"]), None if r["dwpf"] == "M" else float(r["dwpf"]))
        lat, lon = r["lat"], r["lon"]
    return out, lat, lon


def forecasts(station: str, lat: str, lon: str, start: str, end: str):
    hourly = ",".join(f"{v}{lead}" for v in ("temperature_2m", "dew_point_2m") for lead in LEADS)
    url = ("https://previous-runs-api.open-meteo.com/v1/forecast?"
           f"latitude={lat}&longitude={lon}&hourly={hourly}&models={','.join(MODELS)}"
           f"&temperature_unit=fahrenheit&timezone=GMT&start_date={start}&end_date={end}")
    h = json.loads(get(url, CACHE / f"fc-{station}-{start}-{end}.json"))["hourly"]
    times = [datetime.fromisoformat(t).replace(tzinfo=timezone.utc) for t in h["time"]]
    return times, h


def mean(xs):
    return sum(xs) / len(xs) if xs else float("nan")


def main() -> None:
    today = date.today()
    start, end = sys.argv[1:3] if len(sys.argv) >= 3 else ((today - timedelta(days=37)).isoformat(), (today - timedelta(days=2)).isoformat())
    CACHE.mkdir(parents=True, exist_ok=True)
    err = defaultdict(list)  # (candidate, measure) -> abs errors
    by_city = defaultdict(list)  # (station, candidate) -> abs window temp errors
    for station, (city, tz) in STATIONS.items():
        obs, lat, lon = observations(station, start, end)
        times, h = forecasts(station, lat, lon, start, end)
        zone = ZoneInfo(tz)
        for lead in LEADS:
            for name, models in CANDIDATES.items():
                days = defaultdict(lambda: ([], []))
                for i, t in enumerate(times):
                    if t not in obs:
                        continue
                    temps = [h[f"temperature_2m{lead}_{m}"][i] for m in models]
                    dews = [h[f"dew_point_2m{lead}_{m}"][i] for m in models]
                    if None in temps:
                        continue
                    temp, (seen, seen_dew) = mean(temps), obs[t]
                    local = t.astimezone(zone)
                    if local.hour in WINDOW_HOURS:
                        err[(name, "window temp")].append(abs(temp - seen))
                        by_city[(station, name)].append(abs(temp - seen))
                        if seen_dew is not None and None not in dews:
                            err[(name, "dew point")].append(abs(mean(dews) - seen_dew))
                    days[local.date()][0].append(temp)
                    days[local.date()][1].append(seen)
                for fc, seen in days.values():
                    if len(seen) >= 20:
                        err[(name, "daily high")].append(abs(max(fc) - max(seen)))
                        err[(name, "daily low")].append(abs(min(fc) - min(seen)))
    measures = ("window temp", "dew point", "daily high", "daily low")
    print(f"{start} to {end}, {len(STATIONS)} US airports, forecasts 0-6 days ahead; mean abs error °F\n")
    print("".ljust(26) + "".join(m.rjust(13) for m in measures))
    for name in CANDIDATES:
        print(name.ljust(26) + "".join(f"{mean(err[(name, m)]):13.2f}" for m in measures))
    print("\nwindow temp by city")
    print("".ljust(20) + "".join(n.split(" (")[0][:12].rjust(13) for n in CANDIDATES))
    for station, (city, _) in STATIONS.items():
        print(city.ljust(20) + "".join(f"{mean(by_city[(station, n)]):13.2f}" for n in CANDIDATES))


if __name__ == "__main__":
    main()
