"""Turn the raw downloads into build/loop.json.

Usage: python -m pipeline.build
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from shapely.geometry import LineString, Point, Polygon, shape
from shapely.ops import unary_union
from shapely.strtree import STRtree

from pipeline import osm
from pipeline.area import BBOX
from pipeline.geometry import (
    clean_polygon,
    heading_at,
    polygon_json,
    polygons_of,
    polyline_length,
    project_distance,
    r2,
)
from pipeline.heights import material_of, parse_count, parse_length, resolve_height
from pipeline.projection import DEFAULT_ORIGIN, LocalProjection

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
BUILD = ROOT / "build"

# Height of the top of rail above the street on the Loop structure. Not in the
# data. Estimated from the usual 14 to 15 ft street clearance under the L plus
# the depth of the girders and deck.
TRACK_Z = 6.0
TRACK_Z_ESTIMATED = True

LOOP_STATIONS = [
    # (CTA map id, CTA name, name used in OpenStreetMap)
    (40380, "Clark/Lake", "Clark/Lake"),
    (40260, "State/Lake", "State/Lake (Closed)"),
    (41700, "Washington/Wabash", "Washington/Wabash"),
    (40680, "Adams/Wabash", "Adams/Wabash"),
    (40850, "Harold Washington Library-State/Van Buren", "Harold Washington Library-State/Van Buren"),
    (40160, "LaSalle/Van Buren", "LaSalle/Van Buren"),
    (40040, "Quincy", "Quincy"),
    (40730, "Washington/Wells", "Washington/Wells"),
]
APPROACH_STATIONS = [(40460, "Merchandise Mart", "Merchandise Mart")]
CLOSED_STATIONS = {
    40260: {
        "status": "closed",
        "note": "Closed on 5 January 2026 for a full rebuild, expected to reopen in 2029. "
        "Trains pass through without stopping.",
        "source": "OpenStreetMap node 258296349 (disused:railway=station), CTA",
    }
}
REMOVED_STATIONS = ["Randolph/Wabash", "Madison/Wabash"]

# Lines on the elevated Loop and the OSM route relations for each direction.
# trDr codes follow the CTA Train Tracker documentation.
LINES = {
    "brn": {"name": "Brown", "color": "#62361B"},
    "g": {"name": "Green", "color": "#009B3A"},
    "org": {"name": "Orange", "color": "#F9461C"},
    "p": {"name": "Purple", "color": "#522398"},
    "pink": {"name": "Pink", "color": "#E27EA6"},
}
# CTA stop list flags per line code.
STOP_FLAGS = {"brn": "brn", "g": "g", "org": "o", "p": "p", "pink": "pnk"}

STREET_WIDTHS = {  # curb to curb, meters, used when OSM has no width or lanes
    "motorway": 14.0,
    "trunk": 14.0,
    "primary": 14.0,
    "secondary": 12.0,
    "tertiary": 11.0,
    "unclassified": 9.0,
    "residential": 9.0,
    "motorway_link": 7.0,
    "trunk_link": 7.0,
    "secondary_link": 7.0,
    "service": 5.0,
    "pedestrian": 6.0,
}
LANE_WIDTH = 3.3


@dataclass
class Context:
    data: osm.OsmData
    proj: LocalProjection
    area: Polygon
    area_margin: Polygon

    def xy(self, node_ids: list[int]) -> list[tuple[float, float]] | None:
        coords = self.data.coords(node_ids)
        if coords is None:
            return None
        return self.proj.many_to_local(coords)

    def node_xy(self, nid: int) -> tuple[float, float]:
        n = self.data.nodes[nid]
        return self.proj.to_local(n.lat, n.lon)


# --------------------------------------------------------------------- setup


def find_origin(data: osm.OsmData) -> tuple[float, float, str]:
    state: set[int] = set()
    madison: set[int] = set()
    for w in data.ways.values():
        if "highway" not in w.tags:
            continue
        name = w.tags.get("name", "")
        if name.endswith("State Street"):
            state.update(w.nodes)
        if name.endswith("Madison Street"):
            madison.update(w.nodes)
    shared = sorted(state & madison)
    if shared:
        n = data.nodes[shared[0]]
        return n.lat, n.lon, f"OpenStreetMap node {n.id}"
    return DEFAULT_ORIGIN[0], DEFAULT_ORIGIN[1], "fallback constant"


def area_polygon(proj: LocalProjection) -> Polygon:
    corners = [
        (BBOX.south, BBOX.west),
        (BBOX.south, BBOX.east),
        (BBOX.north, BBOX.east),
        (BBOX.north, BBOX.west),
    ]
    return Polygon(proj.many_to_local(corners))


def way_polygon(ctx: Context, way: osm.Way) -> Polygon | None:
    if not way.closed:
        return None
    pts = ctx.xy(way.nodes)
    if pts is None or len(pts) < 4:
        return None
    return clean_polygon(Polygon(pts))


def relation_polygons(ctx: Context, rel: osm.Relation) -> list[Polygon]:
    """Assemble a multipolygon relation into shapely polygons."""
    outers: list[list[int]] = []
    inners: list[list[int]] = []
    for m in rel.members:
        if m.type != "way" or m.ref not in ctx.data.ways:
            continue
        nodes = ctx.data.ways[m.ref].nodes
        (inners if m.role == "inner" else outers).append(nodes)
    rings_out = [r for r in osm.join_ways(outers) if r[0] == r[-1] and len(r) >= 4]
    rings_in = [r for r in osm.join_ways(inners) if r[0] == r[-1] and len(r) >= 4]
    holes = [ctx.xy(r) for r in rings_in]
    holes_poly = [Polygon(h) for h in holes if h]
    polys: list[Polygon] = []
    for ring in rings_out:
        pts = ctx.xy(ring)
        if not pts:
            continue
        outer = Polygon(pts)
        if not outer.is_valid:
            outer = outer.buffer(0)
        mine = [h for h in holes_poly if outer.contains(h.representative_point())]
        poly = Polygon(outer.exterior.coords, [h.exterior.coords for h in mine]) if mine else outer
        cleaned = clean_polygon(poly) if isinstance(poly, Polygon) else None
        if cleaned is not None:
            polys.append(cleaned)
    return polys


def element_polygons(ctx: Context, el: osm.Way | osm.Relation) -> list[Polygon]:
    if isinstance(el, osm.Way):
        p = way_polygon(ctx, el)
        return [p] if p is not None else []
    if el.tags.get("type") in ("multipolygon", "building"):
        return relation_polygons(ctx, el)
    return []


# --------------------------------------------------------------- buildings


def load_city_footprints(ctx: Context) -> list[dict]:
    path = DATA / "building-footprints.geojson"
    if not path.exists():
        return []
    raw = json.loads(path.read_text())
    out = []
    for f in raw.get("features", []):
        props = f.get("properties") or {}
        if (props.get("bldg_statu") or "").upper() != "ACTIVE":
            continue
        geom = f.get("geometry")
        if not geom:
            continue
        polys = []
        for poly in polygons_of(shape(geom)):
            pts = ctx.proj.many_to_local([(lat, lon) for lon, lat in poly.exterior.coords])
            holes = [ctx.proj.many_to_local([(lat, lon) for lon, lat in ring.coords]) for ring in poly.interiors]
            cleaned = clean_polygon(Polygon(pts, holes))
            if cleaned is not None:
                polys.append(cleaned)
        if not polys:
            continue
        stories = parse_count(props.get("stories")) or parse_count(props.get("no_stories"))
        out.append(
            {
                "bldg_id": str(props.get("bldg_id") or ""),
                "polygons": polys,
                "geom": unary_union(polys),
                "stories": stories,
                "name": (props.get("bldg_name1") or "").strip() or None,
            }
        )
    return out


def is_l_shelter(tags: dict[str, str]) -> bool:
    return tags.get("railway") == "signal_box"


def build_buildings(ctx: Context, shelter_ids: set[tuple[str, int]], l_corridor) -> tuple[list[dict], dict]:
    data = ctx.data
    city = load_city_footprints(ctx)
    city_by_id = {c["bldg_id"]: c for c in city if c["bldg_id"]}
    city_tree = STRtree([c["geom"] for c in city]) if city else None

    outlines: list[tuple[osm.Way | osm.Relation, Polygon]] = []
    parts: list[tuple[osm.Way | osm.Relation, Polygon]] = []
    skipped = {"shelter_or_on_structure": 0, "underground": 0, "outside": 0}

    elements: list[osm.Way | osm.Relation] = [*data.ways.values(), *data.relations.values()]
    for el in elements:
        tags = el.tags
        kind = "part" if "building:part" in tags else ("outline" if "building" in tags else None)
        if kind is None or tags.get("building") == "no" or tags.get("building:part") == "no":
            continue
        key = ("way" if isinstance(el, osm.Way) else "relation", el.id)
        layer = parse_count(tags.get("layer")) if tags.get("layer", "").lstrip("-").isdigit() else None
        if tags.get("location") == "underground" or (tags.get("layer", "").startswith("-")):
            skipped["underground"] += 1
            continue
        for poly in element_polygons(ctx, el):
            if not ctx.area.contains(poly.representative_point()):
                skipped["outside"] += 1
                continue
            on_structure = (
                key in shelter_ids
                or is_l_shelter(tags)
                or (kind == "outline" and layer is not None and layer >= 1 and poly.within(l_corridor))
            )
            if on_structure:
                skipped["shelter_or_on_structure"] += 1
                continue
            (parts if kind == "part" else outlines).append((el, poly))

    # Assign parts to the outline that contains them (Simple 3D Buildings).
    outline_tree = STRtree([p for _, p in outlines]) if outlines else None
    parent_of_part: dict[int, int] = {}
    outlines_with_parts: set[int] = set()
    for pi, (_, ppoly) in enumerate(parts):
        if outline_tree is None:
            break
        rp = ppoly.representative_point()
        for oi in outline_tree.query(rp, predicate="within"):
            parent_of_part[pi] = int(oi)
            outlines_with_parts.add(int(oi))
            break

    def city_match(el: osm.Way | osm.Relation, poly: Polygon) -> dict | None:
        cid = el.tags.get("chicago:building_id")
        if cid and cid in city_by_id:
            return city_by_id[cid]
        if city_tree is None:
            return None
        best, best_score = None, 0.0
        for ci in city_tree.query(poly):
            cg = city[int(ci)]["geom"]
            inter = poly.intersection(cg).area
            if inter <= 0:
                continue
            score = inter / max(poly.area, cg.area)
            if score > best_score:
                best, best_score = city[int(ci)], score
        return best if best_score >= 0.5 else None

    buildings: list[dict] = []
    used_city: set[str] = set()

    def emit(el, poly, tags, parent_tags, city_rec, role):
        stories = city_rec["stories"] if city_rec else None
        h = resolve_height(tags, None, poly.area)
        if h.source.startswith("default") and parent_tags is not None:
            # A part without its own height is usually a podium or base (the
            # Willis Tower base is one). Giving it the parent's full height would
            # hide the real massing, so it keeps the default, capped by the parent.
            parent_h = resolve_height(parent_tags, stories)
            h = type(h)(min(h.height, parent_h.height), h.min_height, True, f"{h.source}:part")
        elif h.source.startswith("default"):
            h = resolve_height(tags, stories, poly.area)
        material, glass = material_of(tags)
        if material is None and parent_tags is not None:
            material, glass = material_of(parent_tags)
        if h.height <= h.min_height:
            return
        name = tags.get("name") or (parent_tags or {}).get("name") or (city_rec or {}).get("name")
        roof = tags.get("roof:shape") or (parent_tags or {}).get("roof:shape")
        rec = {
            "id": f"{'w' if isinstance(el, osm.Way) else 'r'}{el.id}",
            "role": "roof" if tags.get("building") == "roof" else role,
            **polygon_json(poly),
            "height": r2(h.height),
            "min_height": r2(h.min_height),
            "height_estimated": h.estimated,
            "height_source": h.source,
        }
        if material:
            rec["material"] = material
        if glass:
            rec["glass"] = True
        colour = tags.get("building:colour") or (parent_tags or {}).get("building:colour")
        if colour:
            rec["colour"] = colour
        if roof and roof != "flat":
            rec["roof_shape"] = roof
        if name:
            rec["name"] = name
        if city_rec:
            rec["city_bldg_id"] = city_rec["bldg_id"]
            used_city.add(city_rec["bldg_id"])
        buildings.append(rec)

    for oi, (el, poly) in enumerate(outlines):
        if oi in outlines_with_parts:
            match = city_match(el, poly)
            if match:
                used_city.add(match["bldg_id"])
            continue
        emit(el, poly, el.tags, None, city_match(el, poly), "building")
    for pi, (el, poly) in enumerate(parts):
        parent = outlines[parent_of_part[pi]][0] if pi in parent_of_part else None
        parent_poly = outlines[parent_of_part[pi]][1] if pi in parent_of_part else None
        city_rec = city_match(parent, parent_poly) if parent is not None and parent_poly is not None else None
        emit(el, poly, el.tags, parent.tags if parent is not None else None, city_rec, "part")

    # City footprints that OpenStreetMap does not cover.
    osm_union = unary_union([p for _, p in outlines] + [p for _, p in parts])
    added_from_city = 0
    for c in city:
        if c["bldg_id"] in used_city:
            continue
        g = c["geom"]
        if not ctx.area.contains(g.representative_point()):
            continue
        if g.intersection(osm_union).area > 0.3 * g.area:
            continue
        for poly in c["polygons"]:
            h = resolve_height({}, c["stories"], poly.area)
            rec = {
                "id": f"city{c['bldg_id']}",
                "role": "building",
                **polygon_json(poly),
                "height": r2(h.height),
                "min_height": 0.0,
                "height_estimated": True,
                "height_source": h.source,
                "city_bldg_id": c["bldg_id"],
            }
            if c["name"]:
                rec["name"] = c["name"]
            buildings.append(rec)
            added_from_city += 1

    stats = {
        "osm_outlines": len(outlines),
        "osm_parts": len(parts),
        "outlines_replaced_by_parts": len(outlines_with_parts),
        "added_from_city_footprints": added_from_city,
        "city_footprints_in_area": len(city),
        "skipped": skipped,
    }
    return buildings, stats


# ------------------------------------------------------------------ tracks


def is_elevated_track(tags: dict[str, str]) -> bool:
    if tags.get("railway") != "subway":
        return False
    if tags.get("tunnel") in ("yes", "building_passage") or tags.get("layer", "").startswith("-"):
        return False
    layer = tags.get("layer", "0")
    return tags.get("bridge") in ("yes", "viaduct", "movable") or (layer.isdigit() and int(layer) >= 1)


def build_track_ways(ctx: Context) -> list[dict]:
    out = []
    for w in ctx.data.ways.values():
        if not is_elevated_track(w.tags):
            continue
        pts = ctx.xy(w.nodes)
        if not pts or len(pts) < 2:
            continue
        line = LineString(pts)
        if not line.intersects(ctx.area_margin):
            continue
        clipped = line.intersection(ctx.area_margin)
        segments = [clipped] if isinstance(clipped, LineString) else list(getattr(clipped, "geoms", []))
        for i, seg in enumerate(segments):
            if not isinstance(seg, LineString) or seg.length < 0.5:
                continue
            rec = {
                "id": f"w{w.id}" + (f"-{i}" if len(segments) > 1 else ""),
                "osm_id": w.id,
                "name": w.tags.get("name"),
                "service": w.tags.get("service"),
                "bridge": w.tags.get("bridge"),
                "points": [[r2(x), r2(y)] for x, y in seg.coords],
            }
            out.append(rec)
    return out


def classify_loop_tracks(track_ways: list[dict], line_paths: dict[str, list[dict]]) -> None:
    """Mark main tracks as the Inner or Outer Loop using the lines that run on them.

    CTA's stop list puts Brown on the Outer Loop and Orange, Pink and Purple on
    the Inner Loop, so any Loop way that Brown runs on is the Outer Loop.
    """

    def used_by(code: str) -> set[int]:
        ids: set[int] = set()
        for pattern in line_paths.get(code, []):
            ids.update(pattern["way_ids"])
        return ids

    outer = used_by("brn")
    inner = used_by("org") | used_by("pink") | used_by("p")
    for t in track_ways:
        if t["service"]:
            t["track"] = t["service"]
        elif t["osm_id"] in outer and t["osm_id"] not in inner:
            t["track"] = "outer_loop" if t["name"] == "Loop 'L'" else "main"
        elif t["osm_id"] in inner and t["osm_id"] not in outer:
            t["track"] = "inner_loop" if t["name"] == "Loop 'L'" else "main"
        else:
            t["track"] = "main"
        lines = sorted(
            code for code, patterns in line_paths.items() if any(t["osm_id"] in p["way_ids"] for p in patterns)
        )
        t["lines"] = lines


# ------------------------------------------------------------------- lines


def load_cta_stops() -> list[dict]:
    path = DATA / "cta-l-stops.json"
    return json.loads(path.read_text()) if path.exists() else []


def route_relations(data: osm.OsmData) -> dict[str, list[osm.Relation]]:
    ref_to_code = {"Brown": "brn", "Green": "g", "Orange": "org", "Purple": "p", "Pink": "pink"}
    out: dict[str, list[osm.Relation]] = {c: [] for c in LINES}
    for r in data.relations.values():
        if r.tags.get("type") == "route" and r.tags.get("route") == "subway":
            code = ref_to_code.get(r.tags.get("ref", ""))
            if code:
                out[code].append(r)
    return out


def route_ends(rel: osm.Relation) -> tuple[str, str]:
    """Start and end of a route, read from its name ("CTA Brown Line: Kimball → Loop").

    The name is more reliable than the from/to tags, which have typos and copy errors.
    """
    name = rel.tags.get("name", "")
    if ": " in name and " → " in name:
        a, b = name.split(": ", 1)[1].split(" → ", 1)
        return a.strip(), b.strip()
    return rel.tags.get("from", ""), rel.tags.get("to", "")


def match_cta_stop(cta_stops: list[dict], code: str, name: str, lat: float, lon: float, heading: float) -> dict | None:
    """Pick the CTA platform for an OSM stop: same line, closest station, platform facing our direction."""
    flag = STOP_FLAGS[code]
    candidates = [s for s in cta_stops if s.get(flag) and s.get("location")]
    if not candidates:
        return None

    def dist(s: dict) -> float:
        loc = s["location"]
        return math.hypot(
            (float(loc["latitude"]) - lat) * 111_000,
            (float(loc["longitude"]) - lon) * 83_000,
        )

    nearest = min(candidates, key=dist)
    if dist(nearest) > 400:
        return None
    same_station = [s for s in candidates if s["map_id"] == nearest["map_id"]]
    want = {"N": 0.0, "E": 90.0, "S": 180.0, "W": 270.0}

    def angle_off(s: dict) -> float:
        d = want.get(s.get("direction_id", ""), 0.0)
        return abs((heading - d + 180) % 360 - 180)

    return min(same_station, key=angle_off)


def simplify_path(ctx: Context, pts_xy: list[tuple[float, float]], latlon: list[tuple[float, float]]):
    """Keep full detail inside the model, simplify the far parts of the line."""
    near = ctx.area_margin.buffer(200)
    keep = [0]
    for i in range(1, len(pts_xy) - 1):
        # Far from the model, drop points within 2 m of the chord from the last kept point.
        if not near.contains(Point(pts_xy[i])):
            chord = LineString([pts_xy[keep[-1]], pts_xy[i + 1]])
            if Point(pts_xy[i]).distance(chord) < 2.0:
                continue
        keep.append(i)
    keep.append(len(pts_xy) - 1)
    return [pts_xy[i] for i in keep], [latlon[i] for i in keep]


def build_line_paths(ctx: Context, cta_stops: list[dict]) -> dict[str, list[dict]]:
    data = ctx.data
    out: dict[str, list[dict]] = {}
    for code, rels in route_relations(data).items():
        patterns = []
        for rel in sorted(rels, key=lambda r: r.id):
            way_ids = [
                m.ref
                for m in rel.members
                if m.type == "way" and m.role in ("", "forward", "backward") and m.ref in data.ways
            ]
            node_path = osm.chain_route([data.ways[w].nodes for w in way_ids])
            # Drop consecutive duplicates.
            node_path = [n for i, n in enumerate(node_path) if i == 0 or n != node_path[i - 1]]
            latlon = data.coords(node_path)
            if not latlon:
                continue
            xy = ctx.proj.many_to_local(latlon)
            xy, latlon = simplify_path(ctx, xy, latlon)
            length = polyline_length(xy)
            stops = []
            for m in rel.members:
                if m.type != "node" or not m.role.startswith("stop") or m.ref not in data.nodes:
                    continue
                n = data.nodes[m.ref]
                p = ctx.proj.to_local(n.lat, n.lon)
                d, off = project_distance(xy, p)
                if off > 40:
                    continue
                heading = heading_at(xy, d)
                cta = match_cta_stop(cta_stops, code, n.tags.get("name", ""), n.lat, n.lon, heading)
                stop = {
                    "name": cta["station_name"] if cta else n.tags.get("name"),
                    "osm_name": n.tags.get("name"),
                    "distance": round(d, 1),
                    "heading": round(heading),
                }
                if cta:
                    stop["station_id"] = int(cta["map_id"])
                    stop["stop_id"] = int(cta["stop_id"])
                    stop["stop_name"] = cta["stop_name"]
                stops.append(stop)
            stops.sort(key=lambda s: s["distance"])
            # Some relations list the same platform twice; keep the first.
            dedup = []
            for s in stops:
                if (
                    dedup
                    and s.get("station_id") == dedup[-1].get("station_id")
                    and abs(s["distance"] - dedup[-1]["distance"]) < 150
                ):
                    continue
                dedup.append(s)
            patterns.append(
                {
                    "osm_relation": rel.id,
                    "name": rel.tags.get("name"),
                    "from": route_ends(rel)[0],
                    "to": route_ends(rel)[1],
                    "length": round(length, 1),
                    "way_ids": way_ids,
                    "points": [[round(x, 1), round(y, 1)] for x, y in xy],
                    "latlon": [[round(a, 6), round(b, 6)] for a, b in latlon],
                    "stops": dedup,
                }
            )
        out[code] = patterns
    return out


# ---------------------------------------------------------------- stations


def stop_area_members(data: osm.OsmData) -> dict[str, osm.Relation]:
    return {
        r.tags.get("name", ""): r
        for r in data.relations.values()
        if r.tags.get("public_transport") == "stop_area"
        and any(m.role == "platform" for m in r.members)
        and not any(
            m.type == "way" and m.ref in data.ways and data.ways[m.ref].tags.get("layer", "").startswith("-")
            for m in r.members
            if m.role == "platform"
        )
    }


def synth_platforms(ctx: Context, center: tuple[float, float], loop_ways: list[dict]) -> list[dict]:
    """Estimated platforms for a station whose platforms are not mapped (State/Lake).

    A side platform outside each Loop track, 150 m long and 3.7 m wide.
    """
    out = []
    c = Point(center)
    for track in ("inner_loop", "outer_loop"):
        ways = [w for w in loop_ways if w.get("track") == track]
        if not ways:
            continue
        best = min(ways, key=lambda w: LineString(w["points"]).distance(c))
        line = LineString(best["points"])
        d = line.project(c)
        a, b = line.interpolate(max(d - 75, 0)), line.interpolate(min(d + 75, line.length))
        seg = LineString([a, b])
        # Put the platform on the side away from the other track.
        other = [w for w in loop_ways if w.get("track") not in (track, None) and w.get("track", "").endswith("loop")]
        side = 1.0
        if other:
            o = min(other, key=lambda w: LineString(w["points"]).distance(c))
            left = seg.offset_curve(3.0)
            right = seg.offset_curve(-3.0)
            ol = LineString(o["points"])
            side = 1.0 if left.distance(ol) > right.distance(ol) else -1.0
        near = seg.offset_curve(side * 1.6)
        far = seg.offset_curve(side * 5.3)
        poly = Polygon(list(near.coords) + list(reversed(list(far.coords))))
        out.append({"track": track, **polygon_json(poly), "estimated": True})
    return out


def build_stations(
    ctx: Context, track_ways: list[dict], line_paths: dict[str, list[dict]]
) -> tuple[list[dict], set[tuple[str, int]]]:
    data = ctx.data
    areas = stop_area_members(data)
    shelters: set[tuple[str, int]] = set()
    loop_ways = [t for t in track_ways if t.get("track") in ("inner_loop", "outer_loop")]
    stations = []
    for map_id, cta_name, osm_name in LOOP_STATIONS + APPROACH_STATIONS:
        node = next(
            (
                n
                for n in data.nodes.values()
                if n.tags.get("name") == osm_name
                and (n.tags.get("railway") == "station" or n.tags.get("disused:railway") == "station")
                and n.tags.get("station") == "subway"
                and BBOX.contains(n.lat, n.lon)
                and _is_elevated_station(data, n)
            ),
            None,
        )
        if node is None:
            raise SystemExit(f"station not found in OSM data: {osm_name}")
        center = ctx.proj.to_local(node.lat, node.lon)
        rec: dict = {
            "id": map_id,
            "name": cta_name,
            "loop": any(map_id == s[0] for s in LOOP_STATIONS),
            "status": "open",
            "osm_node": node.id,
            "location": [r2(center[0]), r2(center[1])],
            "platforms": [],
            "canopies": [],
        }
        rec.update(CLOSED_STATIONS.get(map_id, {}))
        area = areas.get(osm_name if osm_name in areas else cta_name)
        if area is not None:
            for m in area.members:
                el = (
                    data.ways.get(m.ref)
                    if m.type == "way"
                    else data.relations.get(m.ref)
                    if m.type == "relation"
                    else None
                )
                if el is None:
                    continue
                if m.role == "platform":
                    for poly in element_polygons(ctx, el):
                        rec["platforms"].append({**polygon_json(poly), "osm_id": f"{m.type[0]}{m.ref}"})
                elif m.role in ("shelter", "station") or (m.role == "" and "building" in el.tags):
                    shelters.add((m.type, m.ref))
                    for poly in element_polygons(ctx, el):
                        rec["canopies"].append(
                            {**polygon_json(poly), "osm_id": f"{m.type[0]}{m.ref}", "kind": m.role or "building"}
                        )
        if not rec["platforms"]:
            rec["platforms"] = synth_platforms(ctx, center, loop_ways)
            rec["platforms_estimated"] = True
        # Attach the side of the Loop each platform serves and its CTA stop.
        stops = {}
        for patterns in line_paths.values():
            for p in patterns:
                for s in p["stops"]:
                    if s.get("station_id") == map_id:
                        stops[s["stop_id"]] = s["stop_name"]
        rec["stops"] = [{"stop_id": k, "name": v} for k, v in sorted(stops.items())]
        stations.append(rec)
    return stations, shelters


def _is_elevated_station(data: osm.OsmData, node: osm.Node) -> bool:
    # Clark/Lake has two station nodes: the elevated one and the Blue Line subway.
    if node.tags.get("layer", "0").startswith("-"):
        return False
    for r in data.relations.values():
        if r.tags.get("public_transport") != "stop_area":
            continue
        if any(m.type == "node" and m.ref == node.id for m in r.members):
            plats = [data.ways.get(m.ref) for m in r.members if m.role == "platform" and m.type == "way"]
            if plats and all(p is not None and p.tags.get("layer", "").startswith("-") for p in plats):
                return False
    return True


# ------------------------------------------------------------- junctions


def intersection_of(data: osm.OsmData, ctx: Context, a: str, b: str) -> tuple[float, float] | None:
    na: set[int] = set()
    nb: set[int] = set()
    for w in data.ways.values():
        if "highway" not in w.tags or w.tags.get("layer", "0").startswith("-"):
            continue
        name = w.tags.get("name", "")
        if name.endswith(a):
            na.update(w.nodes)
        if name.endswith(b):
            nb.update(w.nodes)
    shared = sorted(na & nb)
    if not shared:
        return None
    pts = [ctx.node_xy(n) for n in shared]
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


def build_junctions(ctx: Context) -> list[dict]:
    data = ctx.data
    out = []
    for name, a, b, note in (
        (
            "Tower 18",
            "Lake Street",
            "Wells Street",
            "Junction of the Loop with the North Side Main Line and the Lake Street line.",
        ),
        ("Tower 12", "Van Buren Street", "Wabash Avenue", "Junction of the Loop with the South Side Elevated."),
    ):
        p = intersection_of(data, ctx, a, b)
        if p is None:
            continue
        rec = {"name": name, "location": [r2(p[0]), r2(p[1])], "note": note, "signal_boxes": []}
        for w in data.ways.values():
            if w.tags.get("railway") != "signal_box":
                continue
            poly = way_polygon(ctx, w)
            if poly is not None and poly.centroid.distance(Point(p)) < 40:
                rec["signal_boxes"].append({**polygon_json(poly), "osm_id": f"w{w.id}"})
        out.append(rec)
    return out


# -------------------------------------------------------- river, bridges, streets


def build_water(ctx: Context) -> list[dict]:
    polys = []
    for el in [*ctx.data.ways.values(), *ctx.data.relations.values()]:
        t = el.tags
        if t.get("natural") != "water" or t.get("water") not in ("river", None):
            continue
        if t.get("name") and "Fountain" in t.get("name", ""):
            continue
        for p in element_polygons(ctx, el):
            clipped = p.intersection(ctx.area_margin)
            polys.extend(polygons_of(clipped))
    merged = polygons_of(unary_union(polys)) if polys else []
    return [{**polygon_json(p), "name": "Chicago River"} for p in merged if p.area > 50]


def build_bridges(ctx: Context) -> list[dict]:
    out = []
    for el in [*ctx.data.ways.values(), *ctx.data.relations.values()]:
        if el.tags.get("man_made") != "bridge":
            continue
        for p in element_polygons(ctx, el):
            if not ctx.area_margin.intersects(p):
                continue
            rec = {**polygon_json(p), "osm_id": f"{'w' if isinstance(el, osm.Way) else 'r'}{el.id}"}
            if el.tags.get("name"):
                rec["name"] = el.tags["name"]
            if el.tags.get("bridge:movable") or el.tags.get("bridge:structure") == "bascule":
                rec["movable"] = el.tags.get("bridge:movable") or "bascule"
            out.append(rec)
    return out


def street_width(tags: dict[str, str]) -> tuple[float, bool]:
    w = parse_length(tags.get("width"))
    if w and 3 <= w <= 40:
        return w, False
    lanes = parse_count(tags.get("lanes"))
    if lanes:
        parking = 2.4 if tags.get("highway") in ("secondary", "tertiary", "residential", "unclassified") else 0.0
        return lanes * LANE_WIDTH + parking, True
    return STREET_WIDTHS.get(tags.get("highway", ""), 8.0), True


def build_streets(ctx: Context) -> tuple[list[dict], list[dict], list[dict]]:
    lines = []
    shapes = []
    footways = []
    for w in ctx.data.ways.values():
        t = w.tags
        hw = t.get("highway")
        if not hw:
            continue
        if t.get("tunnel") or t.get("layer", "0").startswith("-") or t.get("covered") == "yes":
            continue
        pts = ctx.xy(w.nodes)
        if not pts or len(pts) < 2:
            continue
        line = LineString(pts)
        if not line.intersects(ctx.area_margin):
            continue
        line = line.intersection(ctx.area_margin)
        if line.is_empty:
            continue
        if hw in STREET_WIDTHS and t.get("service") not in ("parking_aisle", "drive-through"):
            width, est = street_width(t)
            if t.get("service") == "alley":
                width = 4.9
            segs = (
                [line]
                if isinstance(line, LineString)
                else [g for g in getattr(line, "geoms", []) if isinstance(g, LineString)]
            )
            for seg in segs:
                lines.append(
                    {
                        "name": t.get("name"),
                        "highway": hw,
                        "service": t.get("service"),
                        "bridge": t.get("bridge"),
                        "layer": int(t["layer"]) if t.get("layer", "").isdigit() else 0,
                        "width": r2(width),
                        "width_estimated": est,
                        "points": [[r2(x), r2(y)] for x, y in seg.coords],
                    }
                )
                if not t.get("bridge"):
                    shapes.append(seg.buffer(width / 2, cap_style="flat", join_style="round"))
        elif (
            hw in ("footway", "pedestrian", "path")
            and t.get("footway") != "sidewalk"
            and w.closed
            and t.get("area") == "yes"
        ):
            poly = way_polygon(ctx, w)
            if poly is not None:
                footways.append(polygon_json(poly))
    # Buffered ends leave notches at intersections; a small closing fills them.
    surface = unary_union(shapes).buffer(1.0).buffer(-1.0).intersection(ctx.area_margin) if shapes else None
    surfaces = [polygon_json(p) for p in polygons_of(surface) if p.area > 4]
    return lines, surfaces, footways


def build_parks(ctx: Context) -> list[dict]:
    out = []
    for el in [*ctx.data.ways.values(), *ctx.data.relations.values()]:
        if el.tags.get("leisure") != "park":
            continue
        for p in element_polygons(ctx, el):
            for c in polygons_of(p.intersection(ctx.area_margin)):
                if c.area > 100:
                    out.append({**polygon_json(c), "name": el.tags.get("name")})
    return out


# -------------------------------------------------------------------- main


def build() -> dict:
    osm_path = DATA / "loop.osm"
    if not osm_path.exists():
        raise SystemExit("data/loop.osm is missing. Run: python -m pipeline.fetch")
    data = osm.load(osm_path)
    lat0, lon0, origin_source = find_origin(data)
    proj = LocalProjection(lat0, lon0)
    area = area_polygon(proj)
    ctx = Context(data, proj, area, area.buffer(0.01))

    cta_stops = load_cta_stops()
    line_paths = build_line_paths(ctx, cta_stops)
    track_ways = build_track_ways(ctx)
    classify_loop_tracks(track_ways, line_paths)
    stations, shelters = build_stations(ctx, track_ways, line_paths)

    corridor = unary_union([LineString(t["points"]).buffer(9.0) for t in track_ways])
    buildings, bstats = build_buildings(ctx, shelters, corridor)
    junctions = build_junctions(ctx)
    river = build_water(ctx)
    bridges = build_bridges(ctx)
    streets, street_surfaces, plazas = build_streets(ctx)
    parks = build_parks(ctx)

    minx, miny, maxx, maxy = area.bounds
    lines_out = {}
    for code, meta in LINES.items():
        patterns = line_paths.get(code, [])
        lines_out[code] = {**meta, "patterns": patterns}

    estimated = sum(1 for b in buildings if b["height_estimated"])
    sources: dict[str, int] = {}
    for b in buildings:
        sources[b["height_source"]] = sources.get(b["height_source"], 0) + 1

    return {
        "meta": {
            "generated": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "units": "meters",
            "axes": "x east, y north, z up",
            "origin": {"name": "State St & Madison St", "lat": lat0, "lon": lon0, "source": origin_source},
            "projection": proj.proj4,
            "bbox_latlon": {"south": BBOX.south, "west": BBOX.west, "north": BBOX.north, "east": BBOX.east},
            "bounds": [r2(minx), r2(miny), r2(maxx), r2(maxy)],
            "area": polygon_json(area),
            "track_z": TRACK_Z,
            "track_z_estimated": TRACK_Z_ESTIMATED,
            "sources": [
                "OpenStreetMap contributors (ODbL), via the Overpass API",
                "City of Chicago Data Portal: Building Footprints (syp8-uezg)",
                "City of Chicago Data Portal: CTA L stops (8pix-ypme)",
            ],
            "counts": {
                "buildings": len(buildings),
                "buildings_height_estimated": estimated,
                "height_sources": sources,
                **bstats,
            },
            "removed_stations": REMOVED_STATIONS,
        },
        "buildings": buildings,
        "tracks": track_ways,
        "lines": lines_out,
        "stations": stations,
        "junctions": junctions,
        "river": river,
        "bridges": bridges,
        "streets": streets,
        "street_surfaces": street_surfaces,
        "plazas": plazas,
        "parks": parks,
    }


def main() -> None:
    BUILD.mkdir(exist_ok=True)
    result = build()
    out = BUILD / "loop.json"
    out.write_text(json.dumps(result, separators=(",", ":")))
    c = result["meta"]["counts"]
    print(f"wrote {out.relative_to(ROOT)} ({out.stat().st_size / 1e6:.1f} MB)")
    print(
        f"buildings {c['buildings']} (estimated heights {c['buildings_height_estimated']}), "
        f"tracks {len(result['tracks'])}, stations {len(result['stations'])}"
    )


if __name__ == "__main__":
    main()
