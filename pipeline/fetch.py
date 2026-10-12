"""Download raw inputs for the Loop if they are missing.

data/loop.osm                        OpenStreetMap via the Overpass API
data/building-footprints.geojson     City of Chicago Building Footprints (syp8-uezg)
data/cta-l-stops.json                City of Chicago, CTA System Information: List of L Stops (8pix-ypme)

Usage: python -m pipeline.fetch [--force]
"""

from __future__ import annotations

import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

from pipeline.area import BBOX

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OSM_PATH = DATA / "loop.osm"
FOOTPRINTS_PATH = DATA / "building-footprints.geojson"

OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]
FOOTPRINTS_URL = "https://data.cityofchicago.org/resource/syp8-uezg.geojson"
STOPS_PATH = DATA / "cta-l-stops.json"
STOPS_URL = "https://data.cityofchicago.org/resource/8pix-ypme.json?$limit=1000"
USER_AGENT = "chicago-loop-model/0.1 (https://github.com/Gabrielasu/chicago-loop)"


def overpass_query() -> str:
    s, w, n, e = BBOX.south, BBOX.west, BBOX.north, BBOX.east
    return f"""
[out:xml][timeout:300][bbox:{s},{w},{n},{e}];
(
  way["building"];
  relation["building"];
  way["building:part"];
  relation["building:part"];
  way["railway"];
  node["railway"];
  node["public_transport"];
  way["public_transport"];
  relation["public_transport"];
  relation["route"="subway"];
  way["waterway"];
  way["natural"="water"];
  relation["natural"="water"];
  way["man_made"="bridge"];
  way["highway"];
  way["area:highway"];
  way["leisure"="park"];
);
(._;>;);
out body;
"""


def _get(url: str, data: bytes | None = None, timeout: int = 360) -> bytes:
    req = urllib.request.Request(url, data=data, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def fetch_osm(force: bool = False) -> None:
    if OSM_PATH.exists() and not force:
        print(f"{OSM_PATH.relative_to(ROOT)} exists, skipping")
        return
    body = urllib.parse.urlencode({"data": overpass_query()}).encode()
    last_error: Exception | None = None
    for url in OVERPASS_URLS:
        for attempt in range(3):
            try:
                print(f"Overpass: {url} (attempt {attempt + 1})")
                raw = _get(url, body)
                if b"<osm" not in raw[:500]:
                    raise RuntimeError(raw[:300].decode(errors="replace"))
                OSM_PATH.write_bytes(raw)
                print(f"wrote {OSM_PATH.relative_to(ROOT)} ({len(raw) / 1e6:.1f} MB)")
                return
            except Exception as exc:
                last_error = exc
                print(f"  failed: {exc}")
                time.sleep(5 * (attempt + 1))
    raise SystemExit(f"Could not download OSM data: {last_error}")


def fetch_footprints(force: bool = False) -> None:
    if FOOTPRINTS_PATH.exists() and not force:
        print(f"{FOOTPRINTS_PATH.relative_to(ROOT)} exists, skipping")
        return
    # within_box takes the north-west and south-east corners.
    where = f"within_box(the_geom, {BBOX.north}, {BBOX.west}, {BBOX.south}, {BBOX.east})"
    query = urllib.parse.urlencode({"$where": where, "$limit": 50000})
    raw = _get(f"{FOOTPRINTS_URL}?{query}")
    FOOTPRINTS_PATH.write_bytes(raw)
    print(f"wrote {FOOTPRINTS_PATH.relative_to(ROOT)} ({len(raw) / 1e6:.1f} MB)")


def fetch_stops(force: bool = False) -> None:
    if STOPS_PATH.exists() and not force:
        print(f"{STOPS_PATH.relative_to(ROOT)} exists, skipping")
        return
    raw = _get(STOPS_URL)
    STOPS_PATH.write_bytes(raw)
    print(f"wrote {STOPS_PATH.relative_to(ROOT)} ({len(raw) / 1e3:.0f} kB)")


def main(argv: list[str]) -> None:
    force = "--force" in argv
    DATA.mkdir(exist_ok=True)
    fetch_footprints(force)
    fetch_stops(force)
    fetch_osm(force)


if __name__ == "__main__":
    main(sys.argv[1:])
