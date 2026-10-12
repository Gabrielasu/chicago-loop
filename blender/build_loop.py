"""Build the Loop in Blender from build/loop.json, render stills and export build/loop.glb.

Usage:
  .venv/bin/python blender/build_loop.py                       # everything: renders, glb, blend
  .venv/bin/python blender/build_loop.py --render none          # model and glb only
  .venv/bin/python blender/build_loop.py --render aerial --modes day --samples 16

Options:
  --json PATH        input (default build/loop.json)
  --render LIST      comma list of cameras: aerial, junction, street, or all / none
  --modes LIST       day, night or both (default day,night)
  --samples N        Cycles samples (default 32)
  --size WxH         render size (default 1600x900)
  --cpu              force CPU rendering (GPU via Metal/CUDA/OptiX is used when available)
  --no-glb           skip the glTF export
  --out DIR          where renders go (default build/renders)
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector
from shapely.geometry import LineString, MultiPolygon, Point, Polygon
from shapely.ops import unary_union
from shapely.strtree import STRtree

sys.path.insert(0, str(Path(__file__).resolve().parent))
import itertools

import looks
from loopgeom import MeshBuilder, new_collection, resample

ROOT = Path(__file__).resolve().parent.parent

# Dimensions of the L. CTA track is standard gauge. The rest is estimated from
# photographs and drawings of the Loop structure and marked as such in the docs.
GAUGE = 1.435
RAIL_W, RAIL_H = 0.075, 0.16
TIE_LEN, TIE_W, TIE_H, TIE_STEP = 2.6, 0.22, 0.18, 0.75
GIRDER_OFFSET, GIRDER_W, GIRDER_H = 0.95, 0.32, 1.15
BENT_STEP = 14.0  # spacing of column bents along the structure
COLUMN_W = 0.5
COLUMN_MARGIN = 1.7  # from the outermost track centerline to the column
CROSS_H = 1.0
PLATFORM_RISE = 1.0  # platform top above top of rail
CANOPY_CLEAR = 3.1  # canopy underside above the platform
CANOPY_T = 0.28
CAR_LEN, CAR_W, CAR_H = 14.63, 2.84, 3.15  # CTA 5000-series car, 48 ft long


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", default=str(ROOT / "build" / "loop.json"))
    ap.add_argument("--render", default="all")
    ap.add_argument("--modes", default="day,night")
    ap.add_argument("--samples", type=int, default=32)
    ap.add_argument("--size", default="1600x900")
    ap.add_argument("--cpu", action="store_true")
    ap.add_argument("--no-glb", action="store_true")
    ap.add_argument("--out", default=str(ROOT / "build" / "renders"))
    argv = sys.argv[1:]
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    return ap.parse_args(argv)


def slug(text: str) -> str:
    return "".join(c.lower() if c.isalnum() else "_" for c in text).strip("_").replace("__", "_")


def stable_unit(key: str) -> float:
    return int(hashlib.md5(key.encode()).hexdigest()[:8], 16) / 0xFFFFFFFF


# ----------------------------------------------------------------- ground


def build_ground(model: dict, mats: dict, col) -> None:
    area = Polygon(model["meta"]["area"]["outer"])
    river = unary_union([Polygon(r["outer"], r["holes"]) for r in model["river"]]).buffer(0)
    land = area.difference(river)
    polys = list(land.geoms) if isinstance(land, MultiPolygon) else [land]

    base = MeshBuilder()
    for p in polys:
        if p.area < 20:
            continue
        base.prism(list(p.exterior.coords), [list(i.coords) for i in p.interiors], -8.0, 0.0, mat=0)
    obj = base.to_object("ground", [mats["ground"]], col)
    obj["kind"] = "ground"

    water = MeshBuilder()
    for r in model["river"]:
        water.flat(r["outer"], r["holes"], -2.6)
    water_obj = water.to_object("river_water", [mats["water"]], col)
    water_obj["kind"] = "river"

    streets = MeshBuilder()
    for s in model["street_surfaces"]:
        streets.flat(s["outer"], s["holes"], 0.04)
    streets.to_object("street_surface", [mats["street"]], col)

    green = MeshBuilder()
    for p in model["parks"]:
        green.flat(p["outer"], p["holes"], 0.025)
    green.to_object("parks", [mats["park"]], col)

    marks = MeshBuilder()
    # Center lines on the main streets, as thin pale strokes.
    for s in model["streets"]:
        if s["highway"] in ("secondary", "tertiary", "primary", "trunk") and not s["bridge"] and len(s["points"]) > 1:
            marks.ribbon(s["points"], 0.055, 0.12, 0.01)
    marks.to_object("street_marks", [mats["marking"]], col)


def build_bridges(model: dict, mats: dict, col) -> None:
    river = unary_union([Polygon(r["outer"], r["holes"]) for r in model["river"]]).buffer(0)
    area = Polygon(model["meta"]["area"]["outer"])
    b = MeshBuilder()
    for br in model["bridges"]:
        poly = Polygon(br["outer"], br["holes"]).buffer(0)
        if not poly.intersects(river):
            continue
        for part in getattr(poly.intersection(area), "geoms", [poly.intersection(area)]):
            if isinstance(part, Polygon) and part.area > 1:
                coords = [list(part.exterior.coords), [list(i.coords) for i in part.interiors]]
                b.prism(coords[0], coords[1], -1.4, 0.05, mat=0, bottom=True)
    b.to_object("bridges", [mats["bridge"]], col)


# --------------------------------------------------------------- buildings


def building_tone(b: dict) -> str:
    if b.get("glass"):
        return "glass"
    mat = b.get("material") or ""
    if mat in ("metal", "steel", "metal_plates", "concrete", "cement_block"):
        return "grey"
    if mat in ("limestone", "stone", "marble", "granite", "brick", "masonry", "plastered"):
        return "white"
    return "white" if stable_unit(b["id"]) < 0.62 else "grey"


def build_buildings(model: dict, mats: dict, col) -> None:
    groups = {"white": MeshBuilder(), "grey": MeshBuilder(), "glass": MeshBuilder(), "roof": MeshBuilder()}
    for b in model["buildings"]:
        tone = "roof" if b["role"] == "roof" else building_tone(b)
        mb = groups[tone]
        mb.prism(b["outer"], b["holes"], b["min_height"], b["height"], mat=0, bottom=b["min_height"] > 0.5)
    names = {"white": "massing_white", "grey": "massing_grey", "glass": "massing_glass", "roof": "massing_white"}
    for tone, mb in groups.items():
        obj = mb.to_object(f"buildings_{tone}", [mats[names[tone]]], col)
        obj["kind"] = "buildings"


# ---------------------------------------------------------------- the L


def track_lines(model: dict) -> list[tuple[dict, LineString]]:
    return [(t, LineString(t["points"])) for t in model["tracks"] if len(t["points"]) >= 2]


def build_tracks(model: dict, mats: dict, col, tz: float) -> None:
    """Rails, ties and girders, one object per OSM track way so every track has a named node."""
    steel = [mats["steel"], mats["rail"]]
    for t, _line in track_lines(model):
        pts = t["points"]
        mb = MeshBuilder()
        # girders
        for side in (-1, 1):
            mb.sweep(pts, tz - RAIL_H - TIE_H, GIRDER_W, GIRDER_H, side * GIRDER_OFFSET, mat=0)
        # ties
        for x, y, ang in resample(pts, TIE_STEP):
            mb.box((x, y, tz - RAIL_H - TIE_H / 2), (TIE_W, TIE_LEN, TIE_H), yaw=ang, mat=0)
        # rails
        for side in (-1, 1):
            mb.sweep(pts, tz, RAIL_W, RAIL_H, side * GAUGE / 2, mat=1)
        # Warren bracing between the girders, under the deck
        samples = resample(pts, 3.5)
        for i in range(len(samples) - 1):
            (x0, y0, a0), (x1, y1, a1) = samples[i], samples[i + 1]
            s0 = 1 if i % 2 == 0 else -1
            n0 = (-math.sin(a0), math.cos(a0))
            n1 = (-math.sin(a1), math.cos(a1))
            zb = tz - RAIL_H - TIE_H - GIRDER_H + 0.12
            p0 = (x0 + n0[0] * GIRDER_OFFSET * s0, y0 + n0[1] * GIRDER_OFFSET * s0, zb)
            p1 = (x1 - n1[0] * GIRDER_OFFSET * s0, y1 - n1[1] * GIRDER_OFFSET * s0, zb)
            mb.beam(p0, p1, 0.1, 0.1, mat=0)
        kind = t.get("track", "main")
        name = f"track_{kind}_{t['id']}"
        obj = mb.to_object(name, steel, col)
        obj["osm_way"] = t["osm_id"]
        obj["track"] = kind
        obj["lines"] = ",".join(t.get("lines", []))
        if t.get("name"):
            obj["route_name"] = t["name"]


def build_bents(model: dict, mats: dict, col, tz: float, river) -> None:
    """Column bents across the structure every BENT_STEP meters, with cross girders and knee braces."""
    items = track_lines(model)
    lines = [ln for _, ln in items]
    tree = STRtree(lines)
    placed: list[tuple[float, float]] = []
    grid: dict[tuple[int, int], list[tuple[float, float]]] = {}

    def near_existing(x: float, y: float, r: float) -> bool:
        gx, gy = int(x // 10), int(y // 10)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for px, py in grid.get((gx + dx, gy + dy), []):
                    if (px - x) ** 2 + (py - y) ** 2 < r * r:
                        return True
        return False

    mb = MeshBuilder()
    order = sorted(items, key=lambda it: {"inner_loop": 0, "outer_loop": 1, "main": 2}.get(it[0].get("track"), 3))
    for t, _line in order:
        if t.get("track") not in ("inner_loop", "outer_loop", "main"):
            continue
        if t.get("bridge") == "movable":
            continue
        for x, y, ang in resample(t["points"], BENT_STEP):
            if near_existing(x, y, BENT_STEP * 0.6):
                continue
            n = (-math.sin(ang), math.cos(ang))
            probe = LineString([(x - n[0] * 9, y - n[1] * 9), (x + n[0] * 9, y + n[1] * 9)])
            offsets = []
            for idx in tree.query(probe):
                inter = probe.intersection(lines[int(idx)])
                for g in getattr(inter, "geoms", [inter]):
                    if isinstance(g, Point):
                        offsets.append((g.x - x) * n[0] + (g.y - y) * n[1])
            if not offsets:
                offsets = [0.0]
            lo, hi = min(offsets) - COLUMN_MARGIN, max(offsets) + COLUMN_MARGIN
            feet = [(x + n[0] * lo, y + n[1] * lo), (x + n[0] * hi, y + n[1] * hi)]
            if any(river.contains(Point(f)) for f in feet) or river.distance(Point(x, y)) < 3:
                continue
            placed.append((x, y))
            grid.setdefault((int(x // 10), int(y // 10)), []).append((x, y))
            # The cross girder frames into the track girders, tops flush under the ties.
            z_top = tz - RAIL_H - TIE_H
            z_cross = z_top - CROSS_H / 2
            z_bottom = z_top - CROSS_H
            for fx, fy in feet:
                mb.box((fx, fy, z_top / 2), (COLUMN_W, COLUMN_W, z_top), ang)
                mb.box((fx, fy, 0.12), (0.8, 0.8, 0.24), ang)  # base plate on its footing
            a = (feet[0][0] - n[0] * 0.3, feet[0][1] - n[1] * 0.3, z_cross)
            b = (feet[1][0] + n[0] * 0.3, feet[1][1] + n[1] * 0.3, z_cross)
            mb.beam(a, b, 0.42, CROSS_H)
            # knee braces
            for (fx, fy), s in ((feet[0], 1), (feet[1], -1)):
                p0 = (fx + n[0] * s * 0.2, fy + n[1] * s * 0.2, z_bottom - 1.5)
                p1 = (fx + n[0] * s * 1.5, fy + n[1] * s * 1.5, z_bottom + 0.05)
                mb.beam(p0, p1, 0.16, 0.2)
    obj = mb.to_object("l_columns", [mats["steel"]], col)
    obj["kind"] = "l_structure"
    print(f"bents: {len(placed)}")


def build_signal_boxes(model: dict, mats: dict, col, tz: float) -> None:
    for j in model["junctions"]:
        mb = MeshBuilder()
        for sb in j["signal_boxes"]:
            mb.prism(sb["outer"], sb["holes"], tz - 0.2, tz + 3.4, mat=0, bottom=True)
            mb.prism(sb["outer"], [], tz + 3.4, tz + 3.65, mat=1)
        if mb.faces:
            obj = mb.to_object(f"junction_{slug(j['name'])}", [mats["massing_grey"], mats["steel"]], col)
            obj["note"] = j["note"]
        empty = bpy.data.objects.new(f"junction_{slug(j['name'])}_marker", None)
        empty.location = (j["location"][0], j["location"][1], tz)
        col.objects.link(empty)


# ---------------------------------------------------------------- stations


def long_axis(poly: Polygon) -> tuple[tuple[float, float], tuple[float, float], float]:
    """Center line of a polygon's minimum rotated rectangle: (start, end, width)."""
    rect = poly.minimum_rotated_rectangle
    c = list(rect.exterior.coords)[:4]
    e = [math.dist(c[i], c[(i + 1) % 4]) for i in range(4)]
    if e[0] >= e[1]:
        a = ((c[1][0] + c[2][0]) / 2, (c[1][1] + c[2][1]) / 2)
        b = ((c[3][0] + c[0][0]) / 2, (c[3][1] + c[0][1]) / 2)
        width = e[1]
    else:
        a = ((c[0][0] + c[1][0]) / 2, (c[0][1] + c[1][1]) / 2)
        b = ((c[2][0] + c[3][0]) / 2, (c[2][1] + c[3][1]) / 2)
        width = e[0]
    return a, b, width


def attach(obj, root) -> None:
    """Parent obj to root without moving it (root's matrix is not evaluated yet)."""
    obj.parent = root
    obj.matrix_parent_inverse = Matrix.Translation(root.location).inverted()


def build_stations(model: dict, mats: dict, parent_col, tz: float) -> None:
    track_by_id = {t["id"]: LineString(t["points"]) for t in model["tracks"]}
    top = tz + PLATFORM_RISE
    for st in model["stations"]:
        name = f"station_{st['id']}_{slug(st['name'])}"
        col = new_collection(name, parent_col)
        root = bpy.data.objects.new(name, None)
        root.location = (st["location"][0], st["location"][1], tz)
        root["cta_station_id"] = st["id"]
        root["name"] = st["name"]
        root["status"] = st["status"]
        root["lines"] = ",".join(st["lines"])
        col.objects.link(root)

        plat = MeshBuilder()
        rail = MeshBuilder()
        for p in st["platforms"]:
            plat.prism(p["outer"], p["holes"], top - 0.45, top, mat=0, bottom=True)
            # edge strip on the track side, and a railing on the far side
            poly = Polygon(p["outer"])
            track = track_by_id.get(p.get("track_id", ""))
            edges = [(p["outer"][i], p["outer"][(i + 1) % len(p["outer"])]) for i in range(len(p["outer"]))]
            for a, b in edges:
                if math.dist(a, b) < 4:
                    continue
                mid = Point((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
                near_track = track is not None and track.distance(mid) < track.distance(poly.centroid)
                if near_track:
                    plat.sweep([a, b], top + 0.005, 0.45, 0.01, -0.3, mat=1)
                else:
                    for x, y, _ang in resample([a, b], 2.0):
                        rail.box((x, y, top + 0.55), (0.06, 0.06, 1.1))
                    rail.sweep([a, b], top + 1.1, 0.06, 0.06)
        plat_obj = plat.to_object(f"{name}_platforms", [mats["platform"], mats["platform_edge"]], col)
        rail.to_object(f"{name}_railings", [mats["steel"]], col)
        attach(plat_obj, root)

        if st["status"] == "open":
            build_canopies(st, mats, col, root, name, top)
            build_stairs(st, mats, col, root, name, top)
        build_markers(st, model, mats, col, root, name, top)


def canopy_polys(st: dict) -> list[Polygon]:
    polys = [Polygon(c["outer"], c["holes"]) for c in st["canopies"]]
    polys = [p for p in polys if p.is_valid and p.area > 4]
    if not polys:
        # Not mapped: cover the middle 70 % of each platform.
        for p in st["platforms"]:
            poly = Polygon(p["outer"])
            a, b, w = long_axis(poly)
            ax = (b[0] - a[0], b[1] - a[1])
            s = (a[0] + ax[0] * 0.15, a[1] + ax[1] * 0.15)
            e = (a[0] + ax[0] * 0.85, a[1] + ax[1] * 0.85)
            polys.append(LineString([s, e]).buffer(w / 2 + 0.2, cap_style="flat"))
    return polys


def build_canopies(st: dict, mats: dict, col, root, name: str, top: float) -> None:
    roof = MeshBuilder()
    light = MeshBuilder()
    z0 = top + CANOPY_CLEAR
    for poly in canopy_polys(st):
        roof.prism(list(poly.exterior.coords), [list(i.coords) for i in poly.interiors], z0, z0 + CANOPY_T, bottom=True)
        inner = poly.buffer(-0.6)
        for g in getattr(inner, "geoms", [inner]):
            if isinstance(g, Polygon) and not g.is_empty:
                light.flat(list(g.exterior.coords)[::-1], [], z0 - 0.03)
        a, b, _w = long_axis(poly)
        axis = LineString([a, b])
        if axis.length > 6:
            for x, y, _ in resample([a, b], 9.0)[1:-1] or resample([a, b], axis.length / 2):
                roof.box((x, y, (top + z0) / 2), (0.22, 0.22, z0 - top))
    obj = roof.to_object(f"{name}_canopy", [mats["steel"]], col)
    attach(obj, root)
    lobj = light.to_object(f"{name}_canopy_light", [mats["platform_light"]], col)
    attach(lobj, root)


def build_stairs(st: dict, mats: dict, col, root, name: str, top: float) -> None:
    """A stair from each mapped street entrance up to the nearest platform."""
    plats = [Polygon(p["outer"]) for p in st["platforms"]]
    if not plats or not st["entrances"]:
        return
    stairs = MeshBuilder()
    rise = top
    run = rise / 0.62
    steps = max(int(rise / 0.18), 8)
    width = 1.9
    for ex, ey in st["entrances"]:
        e = Point(ex, ey)
        plat = min(plats, key=lambda p: p.distance(e))
        if plat.distance(e) > 30:
            continue
        a, b, _w = long_axis(plat)
        ax = Vector((b[0] - a[0], b[1] - a[1])).normalized()
        c = plat.centroid
        # climb toward the middle of the platform, along the track
        if (Vector((c.x - ex, c.y - ey))).dot(ax) < 0:
            ax = -ax
        side = Vector((-ax.y, ax.x))
        for i in range(steps):
            t0 = i / steps
            center = Vector((ex, ey)) + ax * (run * (t0 + 0.5 / steps))
            z = rise * (i + 1) / steps
            stairs.box((center.x, center.y, z - 0.09), (run / steps + 0.02, width, 0.18), math.atan2(ax.y, ax.x), mat=0)
        top_pt = Vector((ex, ey)) + ax * run
        for s in (-1, 1):
            off = side * (width / 2 + 0.06) * s
            p0 = (ex + off.x, ey + off.y, 0.0)
            p1 = (top_pt.x + off.x, top_pt.y + off.y, rise)
            stairs.beam((p0[0], p0[1], 0.25), (p1[0], p1[1], rise + 0.25), 0.12, 0.5, mat=1)
            stairs.beam((p0[0], p0[1], 1.05), (p1[0], p1[1], rise + 1.05), 0.05, 0.05, mat=1)
        # landing from the stair head to the platform edge
        edge = plat.exterior.interpolate(plat.exterior.project(Point(top_pt.x, top_pt.y)))
        landing = LineString([(top_pt.x, top_pt.y), (edge.x, edge.y)])
        if landing.length > 0.3:
            stairs.sweep(list(landing.coords), rise, width, 0.3, mat=0)
        stairs.box((top_pt.x, top_pt.y, rise - 0.15), (2.2, 2.2, 0.3), mat=0)
    obj = stairs.to_object(f"{name}_stairs", [mats["platform"], mats["steel"]], col)
    attach(obj, root)


def build_markers(st: dict, model: dict, mats: dict, col, root, name: str, top: float) -> None:
    """Station signs at both ends of each platform with a square per line in CTA colors."""
    mb = MeshBuilder()
    codes = st["lines"]
    line_mats = [mats[f"line_{c}"] for c in model["lines"]]
    code_index = {c: i + 1 for i, c in enumerate(model["lines"])}
    for p in st["platforms"]:
        poly = Polygon(p["outer"])
        a, b, _w = long_axis(poly)
        ax = Vector((b[0] - a[0], b[1] - a[1])).normalized()
        yaw = math.atan2(ax.y, ax.x)
        for end, inward in ((Vector(a), ax), (Vector(b), -ax)):
            pos = end + inward * 1.2
            z = top + 2.35
            width = 0.3 + 0.26 * len(codes)
            mb.box((pos.x, pos.y, z), (0.05, width, 0.5), yaw, mat=0)
            mb.box((pos.x, pos.y, (top + z) / 2), (0.08, 0.08, z - top), yaw, mat=0)
            side = Vector((-ax.y, ax.x))
            for k, code in enumerate(codes):
                o = (k - (len(codes) - 1) / 2) * 0.26
                q = pos + side * o
                for face in (1, -1):
                    qq = q + ax * 0.03 * face
                    mb.box((qq.x, qq.y, z), (0.02, 0.2, 0.2), yaw, mat=code_index[code])
    obj = mb.to_object(f"{name}_signs", [mats["steel"], *line_mats], col)
    attach(obj, root)


# ------------------------------------------------------------------ trains


def point_at(points: list, distance: float) -> tuple[float, float, float]:
    acc = 0.0
    for a, b in itertools.pairwise(points):
        seg = math.dist(a, b)
        if seg > 0 and acc + seg >= distance:
            t = (distance - acc) / seg
            return a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, math.atan2(b[1] - a[1], b[0] - a[0])
        acc += seg
    a, b = points[-2], points[-1]
    return b[0], b[1], math.atan2(b[1] - a[1], b[0] - a[0])


def build_preview_trains(model: dict, mats: dict, col, tz: float) -> None:
    """A few trains placed on their real paths, for the stills only (the viewer draws live ones)."""
    placements = [
        # (line, pattern index, stop name to sit near, offset in m along the path, cars)
        ("brn", 1, "Quincy/Wells", -30.0, 8),
        ("g", 0, "Clark/Lake", -250.0, 6),
        ("org", 1, "LaSalle/Van Buren", 40.0, 8),
        ("pink", 0, "Adams/Wabash", 0.0, 6),
        ("p", 0, "Washington/Wabash", -280.0, 8),
        ("brn", 0, "Merchandise Mart", 200.0, 8),
        ("g", 2, "Adams/Wabash", 160.0, 6),
        ("g", 2, "Clark/Lake", -175.0, 6),
        ("pink", 0, "Washington/Wells", 560.0, 6),
        ("brn", 0, "Washington/Wells", -250.0, 8),
    ]
    for code, idx, stop_name, offset, cars in placements:
        patterns = model["lines"][code]["patterns"]
        if idx >= len(patterns):
            continue
        p = patterns[idx]
        stop = next((s for s in p["stops"] if s["name"] == stop_name), None)
        if stop is None:
            continue
        head = stop["distance"] + offset
        mb = MeshBuilder()
        for k in range(cars):
            d = head - k * (CAR_LEN + 0.6) - CAR_LEN / 2
            x, y, ang = point_at(p["points"], d)
            mb.box((x, y, tz + 0.55 + CAR_H / 2), (CAR_LEN, CAR_W, CAR_H), ang, mat=0)
            mb.box((x, y, tz + 0.55 + 1.95), (CAR_LEN - 1.2, CAR_W + 0.03, 0.95), ang, mat=1)
        obj = mb.to_object(f"train_{code}_{idx}_{slug(stop_name)}", [mats[f"train_{code}"], mats["train_window"]], col)
        obj["line"] = code


def build_street_lamps(model: dict, col) -> None:
    """Point lights along the streets for the night stills. Not exported."""
    data = bpy.data.lights.new("street_lamp", "POINT")
    data.energy = 1100.0
    data.color = (1.0, 0.78, 0.55)
    data.shadow_soft_size = 0.4
    count = 0
    for s in model["streets"]:
        if s["highway"] not in ("primary", "secondary", "tertiary", "trunk", "unclassified", "residential"):
            continue
        if s["bridge"] or len(s["points"]) < 2:
            continue
        side_off = max(s["width"] / 2 - 0.6, 1.5)
        for i, (x, y, ang) in enumerate(resample(s["points"], 38.0)):
            side = 1 if i % 2 == 0 else -1
            nx, ny = -math.sin(ang) * side_off * side, math.cos(ang) * side_off * side
            lamp = bpy.data.objects.new("lamp", data)
            lamp.location = (x + nx, y + ny, 8.5)
            col.objects.link(lamp)
            count += 1
    print(f"street lamps: {count}")


# ------------------------------------------------------------------ camera


def add_camera(name: str, loc, target, lens: float) -> bpy.types.Object:
    data = bpy.data.cameras.new(name)
    data.lens = lens
    data.clip_start = 0.5
    data.clip_end = 20000
    data.sensor_width = 36
    cam = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = loc
    direction = Vector(target) - Vector(loc)
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    return cam


def orbit_camera(name: str, target, azimuth: float, pitch: float, distance: float, lens: float):
    """Camera looking at target from a compass azimuth (degrees, 0 = north) and pitch above the horizon."""
    az, el = math.radians(azimuth), math.radians(pitch)
    loc = (
        target[0] + distance * math.sin(az) * math.cos(el),
        target[1] + distance * math.cos(az) * math.cos(el),
        target[2] + distance * math.sin(el),
    )
    return add_camera(name, loc, target, lens)


def cameras(model: dict, tz: float) -> dict[str, bpy.types.Object]:
    st = {s["name"]: s["location"] for s in model["stations"]}
    tower = next(j["location"] for j in model["junctions"] if j["name"] == "Tower 18")
    ww = st["Washington/Wabash"]
    aw = st["Adams/Wabash"]
    return {
        "aerial": orbit_camera("cam_aerial", (-175, 10, 0), azimuth=181, pitch=52, distance=3500, lens=52),
        # Nearly straight down onto Tower 18, the way the junction reads best: as a plan.
        "junction": add_camera(
            "cam_junction", (tower[0] + 8, tower[1] - 62, 300), (tower[0] + 2, tower[1] + 2, tz - 4), 38
        ),
        # Quincy from above Wells St, south of the platforms, looking north along them.
        "station": add_camera(
            "cam_station_quincy",
            (st["Quincy"][0] + 4, st["Quincy"][1] - 118, 17),
            (st["Quincy"][0] - 2, st["Quincy"][1] - 10, tz + 1),
            28,
        ),
        # Street level on Wabash between Adams and Washington, looking north under the L.
        "street": add_camera(
            "cam_street_wabash",
            (aw[0] - 7.0, (aw[1] + ww[1]) / 2 - 70, 1.65),
            (ww[0] - 2.5, ww[1] + 90, 8.0),
            24,
        ),
    }


# -------------------------------------------------------------------- main


def main() -> None:
    args = parse_args()
    model = json.loads(Path(args.json).read_text())
    tz = model["meta"]["track_z"]

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    mats = looks.make_materials(model)

    cols = {k: new_collection(k) for k in ("buildings", "l_structure", "stations", "river", "streets")}
    preview = new_collection("preview_trains")

    build_ground(model, mats, cols["streets"])
    river_obj = bpy.data.objects["river_water"]
    for c in list(river_obj.users_collection):
        c.objects.unlink(river_obj)
    cols["river"].objects.link(river_obj)
    build_bridges(model, mats, cols["river"])
    build_buildings(model, mats, cols["buildings"])
    river = unary_union([Polygon(r["outer"], r["holes"]) for r in model["river"]]).buffer(0)
    build_tracks(model, mats, cols["l_structure"], tz)
    build_bents(model, mats, cols["l_structure"], tz, river)
    build_signal_boxes(model, mats, cols["l_structure"], tz)
    build_stations(model, mats, cols["stations"], tz)
    build_preview_trains(model, mats, preview, tz)
    build_street_lamps(model, new_collection("night_lamps"))

    cams = cameras(model, tz)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    if not args.no_glb:
        export_glb(model, preview)

    blend = ROOT / "build" / "loop.blend"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend))
    print("saved", blend)

    if args.render == "all":
        wanted = ["aerial", "junction", "street", "station"]
    else:
        wanted = [] if args.render == "none" else args.render.split(",")
    w, h = (int(v) for v in args.size.split("x"))
    looks.setup_render(scene, args.samples, w, h, gpu=not args.cpu)
    for mode in args.modes.split(","):
        looks.apply_mode(scene, mats, mode)
        for key in wanted:
            scene.camera = cams[key]
            looks.apply_camera_exposure(scene, key, mode)
            scene.render.filepath = str(out / f"{key}-{mode}.png")
            bpy.ops.render.render(write_still=True)
            print("wrote", scene.render.filepath)


def export_glb(model: dict, preview_col) -> None:
    path = ROOT / "build" / "loop.glb"
    for obj in bpy.data.objects:
        obj.select_set(False)
    preview_names = {o.name for o in preview_col.all_objects}
    for obj in bpy.data.objects:
        if obj.type in ("MESH", "EMPTY") and obj.name not in preview_names and not obj.name.endswith("_marker"):
            obj.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
        export_extras=True,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=7,
        export_draco_position_quantization=16,
        export_draco_normal_quantization=8,
        export_draco_texcoord_quantization=10,
    )
    print(f"wrote {path} ({path.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
