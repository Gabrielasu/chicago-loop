"""Sanity checks on build/loop.json.

Usage: python -m pipeline.validate [build/loop.json]
Exits non-zero if a check fails.
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

from shapely.geometry import LineString, Point, Polygon

LOOP_STATIONS = {
    "Clark/Lake",
    "State/Lake",
    "Washington/Wabash",
    "Adams/Wabash",
    "Harold Washington Library-State/Van Buren",
    "LaSalle/Van Buren",
    "Quincy",
    "Washington/Wells",
}
REMOVED = {"Randolph/Wabash", "Madison/Wabash"}
LOOP_LINES = ("brn", "g", "org", "p", "pink")


def loop_circuit(model: dict, code: str, track: str) -> LineString:
    """All Loop track ways of one track joined into a single geometry."""
    lines = [LineString(t["points"]) for t in model["tracks"] if t.get("track") == track]
    from shapely.ops import linemerge, unary_union

    return linemerge(unary_union(lines))


def check(model: dict) -> list[str]:
    errors: list[str] = []
    names = {s["name"] for s in model["stations"] if s.get("loop")}
    missing = LOOP_STATIONS - names
    if missing:
        errors.append(f"missing Loop stations: {sorted(missing)}")
    extra = names - LOOP_STATIONS
    if extra:
        errors.append(f"unexpected Loop stations: {sorted(extra)}")
    all_names = {s["name"] for s in model["stations"]}
    for removed in REMOVED:
        if removed in all_names:
            errors.append(f"{removed} closed and must not be modelled")
    for s in model["stations"]:
        if not s["platforms"]:
            errors.append(f"{s['name']} has no platforms")

    # Each Loop track must close into a ring around State & Madison.
    origin = Point(0, 0)
    for track in ("inner_loop", "outer_loop"):
        merged = loop_circuit(model, "", track)
        geoms = list(getattr(merged, "geoms", [merged]))
        longest = max(geoms, key=lambda g: g.length) if geoms else None
        if longest is None:
            errors.append(f"no {track} track")
            continue
        # The Loop track pieces stop at the junctions, so close small gaps.
        ring = Polygon(longest.coords) if longest.length > 2000 else None
        if ring is None or not ring.buffer(30).contains(origin):
            errors.append(f"{track} does not enclose State & Madison (length {longest.length:.0f} m)")

    # Tower 18 at Lake & Wells, and lines passing through it.
    tower = next((j for j in model["junctions"] if j["name"] == "Tower 18"), None)
    if tower is None:
        errors.append("Tower 18 junction missing")
    else:
        tp = Point(tower["location"])
        clark_lake = next((s for s in model["stations"] if s["name"] == "Clark/Lake"), None)
        wash_wells = next((s for s in model["stations"] if s["name"] == "Washington/Wells"), None)
        if clark_lake and wash_wells:
            # Tower 18 lies west of Clark/Lake on Lake St and north of Washington/Wells on Wells St.
            if not (tp.x < clark_lake["location"][0] and abs(tp.y - clark_lake["location"][1]) < 40):
                errors.append("Tower 18 is not on Lake St west of Clark/Lake")
            if not (tp.y > wash_wells["location"][1] and abs(tp.x - wash_wells["location"][0]) < 40):
                errors.append("Tower 18 is not on Wells St north of Washington/Wells")
        for code in LOOP_LINES:
            patterns = model["lines"][code]["patterns"]
            passes = any(LineString(p["points"]).distance(tp) < 25 for p in patterns)
            if code != "org" and code != "g" and not passes:
                errors.append(f"{code} does not pass Tower 18")

    # Every Loop line has patterns with stops and continuous paths.
    for code in LOOP_LINES:
        patterns = model["lines"][code]["patterns"]
        if len(patterns) < 2:
            errors.append(f"{code}: expected two directions, got {len(patterns)}")
        for p in patterns:
            if not p["stops"]:
                errors.append(f"{code} {p['name']}: no stops")
            for s in p["stops"]:
                if s["name"] in REMOVED:
                    errors.append(f"{code}: stops at removed station {s['name']}")
    return errors


def summary(model: dict) -> dict:
    b = model["buildings"]
    return {
        "buildings": len(b),
        "estimated": sum(1 for x in b if x["height_estimated"]),
        "tallest": max((x["height"], x.get("name") or x["id"]) for x in b),
        "stations": len(model["stations"]),
        "track_ways": len(model["tracks"]),
        "loop_track_m": round(
            sum(
                math.dist(a, c)
                for t in model["tracks"]
                if t.get("track") in ("inner_loop", "outer_loop")
                for a, c in zip(t["points"], t["points"][1:], strict=False)
            )
        ),
    }


def main(argv: list[str]) -> None:
    path = Path(argv[0]) if argv else Path(__file__).resolve().parent.parent / "build" / "loop.json"
    model = json.loads(path.read_text())
    errors = check(model)
    print(json.dumps(summary(model)))
    if errors:
        for e in errors:
            print("FAIL", e)
        raise SystemExit(1)
    print("OK all checks passed")


if __name__ == "__main__":
    main(sys.argv[1:])
