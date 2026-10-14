"""Write mock/data/network.json: the parts of build/loop.json the train simulator and viewer need.

Line paths with their stops, the stations, and the elevated tracks inside the
model. Small enough to commit, so the mock and the viewer build without Blender
or the raw data.

Usage: python -m pipeline.export_network
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "mock" / "data" / "network.json"


def export(model: dict) -> dict:
    meta = model["meta"]
    lines = {}
    for code, line in model["lines"].items():
        lines[code] = {
            "name": line["name"],
            "color": line["color"],
            "patterns": [
                {
                    "osmRelation": p["osm_relation"],
                    "name": p["name"],
                    "from": p["from"],
                    "to": p["to"],
                    "length": p["length"],
                    "points": p["points"],
                    "latlon": p["latlon"],
                    "stops": [
                        {
                            "name": s["name"],
                            "stationId": s.get("station_id"),
                            "stopId": s.get("stop_id"),
                            "stopName": s.get("stop_name"),
                            "distance": s["distance"],
                        }
                        for s in p["stops"]
                    ],
                }
                for p in line["patterns"]
            ],
        }
    stations = [
        {
            "id": s["id"],
            "name": s["name"],
            "status": s["status"],
            "loop": s["loop"],
            "location": s["location"],
            "lines": s["lines"],
            "stops": [{"stopId": x["stop_id"], "name": x["name"]} for x in s["stops"]],
            **({"note": s["note"]} if s.get("note") else {}),
        }
        for s in model["stations"]
    ]
    tracks = [
        {"id": t["id"], "track": t["track"], "lines": t.get("lines", []), "points": t["points"]}
        for t in model["tracks"]
        if t["track"] in ("inner_loop", "outer_loop", "main")
    ]
    return {
        "generated": meta["generated"],
        "origin": {"lat": meta["origin"]["lat"], "lon": meta["origin"]["lon"]},
        "projection": meta["projection"],
        "bounds": meta["bounds"],
        "trackZ": meta["track_z"],
        "lines": lines,
        "stations": stations,
        "tracks": tracks,
        "junctions": [{"name": j["name"], "location": j["location"]} for j in model["junctions"]],
    }


TREES_OUT = ROOT / "web" / "public" / "model" / "trees.json"


def export_trees(model: dict) -> list[list[float]]:
    """Trees for the viewer as [x, y, height, crown] rows, local meters."""
    return [[t["x"], t["y"], t["height"], t["crown"]] for t in model.get("trees", [])]


STREETS_OUT = ROOT / "web" / "public" / "model" / "streets.json"
LIT_CLASSES = {"motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "pedestrian"}


def export_streets(model: dict) -> list:
    """Streets for the night light map: [class, width, [x, y, x, y, ...]] in whole decimeters."""
    out = []
    for s in model["streets"]:
        if s["highway"] not in LIT_CLASSES or s.get("service"):
            continue
        flat = [round(v * 10) for p in s["points"] for v in p]
        out.append([s["highway"], round(s["width"], 1), flat])
    return out


def main() -> None:
    model = json.loads((ROOT / "build" / "loop.json").read_text())
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(export(model), separators=(",", ":")))
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1e3:.0f} kB)")
    TREES_OUT.parent.mkdir(parents=True, exist_ok=True)
    TREES_OUT.write_text(json.dumps(export_trees(model), separators=(",", ":")))
    print(f"wrote {TREES_OUT.relative_to(ROOT)} ({TREES_OUT.stat().st_size / 1e3:.0f} kB)")
    STREETS_OUT.write_text(json.dumps(export_streets(model), separators=(",", ":")))
    print(f"wrote {STREETS_OUT.relative_to(ROOT)} ({STREETS_OUT.stat().st_size / 1e3:.0f} kB)")


if __name__ == "__main__":
    main()
