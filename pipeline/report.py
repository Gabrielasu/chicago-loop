"""Write docs/data-report.md from build/loop.json.

Usage: python -m pipeline.report
"""

from __future__ import annotations

import json
from pathlib import Path

from shapely.geometry import LineString, Polygon

ROOT = Path(__file__).resolve().parent.parent

SOURCE_LABELS = {
    "osm:height": "OpenStreetMap `height` (measured)",
    "osm:building:levels": "OpenStreetMap `building:levels` x 3.9 m",
    "city:stories": "City of Chicago `stories` x 3.9 m",
    "default": "Default, 4 floors (15.6 m)",
    "default:small": "Default for kiosks, booths and footprints under 60 m2: 1 floor",
    "default:roof": "Canopy (`building=roof`): 0.5 m slab at 4.5 m",
    "default:part": "Building part without height: 4 floors, capped by its building",
    "default:small:part": "Small building part without height: 1 floor",
    "default:roof:part": "Canopy part without height",
}


def render(model: dict) -> str:
    meta = model["meta"]
    counts = meta["counts"]
    buildings = model["buildings"]
    total = len(buildings)
    est = counts["buildings_height_estimated"]
    lines: list[str] = []
    w = lines.append

    w("# Data report")
    w("")
    w(f"Generated from `build/loop.json` ({meta['generated']}). Rerun with `python -m pipeline.report`.")
    w("")
    w("## Area and coordinates")
    w("")
    b = meta["bbox_latlon"]
    w(f"- Bounding box: {b['south']} to {b['north']} N, {-b['east']} to {-b['west']} W.")
    w("  That is Lake St to Congress Pkwy and Wells St to Michigan Ave plus one block on each side.")
    o = meta["origin"]
    w(f"- Origin: {o['name']} at {o['lat']}, {o['lon']} ({o['source']}).")
    w(f"- Projection: `{meta['projection']}`. Meters, x east, y north.")
    x0, y0, x1, y1 = meta["bounds"]
    w(f"- Extent: {x1 - x0:.0f} m east to west, {y1 - y0:.0f} m north to south.")
    w("")
    w("## Buildings")
    w("")
    w(
        f"- {total} building volumes ({counts['osm_outlines']} OpenStreetMap outlines, {counts['osm_parts']} building parts)."
    )
    w(f"- {counts['outlines_replaced_by_parts']} outlines are drawn through their parts instead (Simple 3D Buildings).")
    w(
        f"- {counts['added_from_city_footprints']} footprints come from the City of Chicago where OpenStreetMap has none."
    )
    w(f"- Heights estimated: **{est} of {total}** ({100 * est / total:.0f} %). Measured: {total - est}.")
    glass = sum(1 for x in buildings if x.get("glass"))
    with_material = sum(1 for x in buildings if x.get("material"))
    w(f"- Facade material recorded for {with_material} volumes, {glass} of them glass.")
    w("")
    w("| Height source | Volumes |")
    w("| --- | ---: |")
    for key, n in sorted(counts["height_sources"].items(), key=lambda kv: -kv[1]):
        w(f"| {SOURCE_LABELS.get(key, key)} | {n} |")
    w("")
    w("Tallest volumes:")
    w("")
    w("| Name | Height (m) | Source |")
    w("| --- | ---: | --- |")
    seen = set()
    for x in sorted(buildings, key=lambda x: -x["height"]):
        name = x.get("name") or x["id"]
        if name in seen:
            continue
        seen.add(name)
        w(f"| {name} | {x['height']:.0f} | {x['height_source']} |")
        if len(seen) == 10:
            break
    w("")
    w("## The L")
    w("")
    tz = meta["track_z"]
    w(
        f"- Top of rail at {tz} m above the street{' (estimated, not in the data)' if meta['track_z_estimated'] else ''}."
    )
    tracks = model["tracks"]
    by_kind: dict[str, float] = {}
    for t in tracks:
        by_kind[t["track"]] = by_kind.get(t["track"], 0) + LineString(t["points"]).length
    w(f"- {len(tracks)} elevated track pieces from OpenStreetMap:")
    for kind, length in sorted(by_kind.items(), key=lambda kv: -kv[1]):
        w(f"  - {kind.replace('_', ' ')}: {length:.0f} m")
    w("- Inner and Outer Loop are told apart by the lines that use them: CTA lists Brown on the Outer Loop")
    w("  and Orange, Pink and Purple on the Inner Loop.")
    for j in model["junctions"]:
        x, y = j["location"]
        w(f"- {j['name']} at ({x:.0f}, {y:.0f}): {j['note']} Signal boxes mapped: {len(j['signal_boxes'])}.")
    w("")
    w("| Line | Direction | Path length (km) | Stops in the model |")
    w("| --- | --- | ---: | --- |")
    for _code, line in model["lines"].items():
        for p in line["patterns"]:
            stops = [s["name"] for s in p["stops"] if s.get("station_id") in {st["id"] for st in model["stations"]}]
            w(f"| {line['name']} | {p['from']} to {p['to']} | {p['length'] / 1000:.1f} | {', '.join(stops)} |")
    w("")
    w("## Stations")
    w("")
    w("| Station | CTA id | Status | Platforms | Canopies | Stop ids |")
    w("| --- | ---: | --- | --- | ---: | --- |")
    for s in model["stations"]:
        plats = f"{len(s['platforms'])}" + (" (estimated)" if s.get("platforms_estimated") else "")
        stops = ", ".join(str(x["stop_id"]) for x in s["stops"]) or "none (trains pass through)"
        w(f"| {s['name']} | {s['id']} | {s['status']} | {plats} | {len(s['canopies'])} | {stops} |")
    w("")
    w("## River, bridges and streets")
    w("")
    river_area = sum(Polygon(r["outer"]).area for r in model["river"])
    w(f"- River: {len(model['river'])} polygons, {river_area / 1e4:.1f} ha inside the area.")
    named = sorted({x["name"] for x in model["bridges"] if x.get("name")})
    w(f"- Bridges: {len(model['bridges'])} outlines. Named: {', '.join(named)}.")
    est_width = sum(1 for s in model["streets"] if s["width_estimated"])
    w(f"- Streets: {len(model['streets'])} centerlines; width estimated for {est_width} (from lanes or road class).")
    w(f"- Parks: {len(model['parks'])} polygons.")
    w("")
    w("## Gaps and oddities")
    w("")
    w("- **State/Lake is closed.** CTA closed it on 5 January 2026 for a rebuild expected to finish in 2029,")
    w("  and OpenStreetMap now tags it `disused:railway=station` with its platforms removed. The model keeps")
    w("  the station at its real location with estimated platforms, and the mock trains pass through it.")
    w("- Randolph/Wabash and Madison/Wabash are not in the data and are not modelled (validated).")
    w("- Clark/Lake has two station nodes in OpenStreetMap; the Blue Line subway one is skipped.")
    w("- Platform canopies and the Tower 18 signal box are mapped as buildings on `layer=2` or `layer=3`.")
    skipped = counts["skipped"]["shelter_or_on_structure"]
    w(f"  {skipped} such volumes are kept out of the street level buildings and built on the L structure.")
    w("- Most heights come from floor counts at 3.9 m per floor. Real Loop floor heights range from about")
    w("  3.5 m (newer residential) to over 5 m (early office buildings), so these heights are approximate.")
    w("- Canopies (`building=roof`) have no height in the data; they are drawn as thin slabs at 4.5 m.")
    w("- Building parts without a height are drawn low (4 floors) rather than at the full building height.")
    w("- The Overpass API sometimes times out; `pipeline.fetch` retries and falls back to mirrors.")
    w("- Lower Wacker Drive and other roads below grade are left out (layer below 0).")
    w("")
    w("## Sources")
    w("")
    for s in meta["sources"]:
        w(f"- {s}")
    w("")
    return "\n".join(lines)


def main() -> None:
    model = json.loads((ROOT / "build" / "loop.json").read_text())
    out = ROOT / "docs" / "data-report.md"
    out.write_text(render(model))
    print(f"wrote {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
