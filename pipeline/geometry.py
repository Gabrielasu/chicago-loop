"""Small geometry helpers shared by the pipeline steps."""

from __future__ import annotations

import itertools
import math
from collections.abc import Sequence

from shapely.geometry import LineString, MultiPolygon, Polygon
from shapely.geometry.polygon import orient

XY = tuple[float, float]


def r2(v: float) -> float:
    return round(v, 2)


def ring_coords(ring: Sequence[XY]) -> list[list[float]]:
    """Ring as [[x, y], ...] without the closing duplicate point."""
    pts = [[r2(x), r2(y)] for x, y in ring]
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts.pop()
    return pts


def polygon_json(poly: Polygon) -> dict:
    poly = orient(poly, sign=1.0)  # exterior counter-clockwise
    return {
        "outer": ring_coords(list(poly.exterior.coords)),
        "holes": [ring_coords(list(i.coords)) for i in poly.interiors],
    }


def polygons_of(geom) -> list[Polygon]:
    """Flatten any shapely geometry into its polygons."""
    if geom is None or geom.is_empty:
        return []
    if isinstance(geom, Polygon):
        return [geom]
    if isinstance(geom, MultiPolygon):
        return list(geom.geoms)
    if hasattr(geom, "geoms"):
        out: list[Polygon] = []
        for g in geom.geoms:
            out.extend(polygons_of(g))
        return out
    return []


def clean_polygon(poly: Polygon) -> Polygon | None:
    if not poly.is_valid:
        poly = poly.buffer(0)
        if isinstance(poly, MultiPolygon):
            poly = max(poly.geoms, key=lambda g: g.area)
    if not isinstance(poly, Polygon) or poly.is_empty or poly.area < 1.0:
        return None
    return poly.simplify(0.05, preserve_topology=True)


def polyline_length(points: Sequence[XY]) -> float:
    return sum(math.dist(a, b) for a, b in itertools.pairwise(points))


def project_distance(points: Sequence[XY], p: XY) -> tuple[float, float]:
    """Distance along a polyline of the closest point to p, and the offset to it."""
    line = LineString(points)
    from shapely.geometry import Point

    pt = Point(p)
    return float(line.project(pt)), float(line.distance(pt))


def heading_deg(a: XY, b: XY) -> float:
    """Compass bearing from a to b in local coordinates (0 = north, 90 = east)."""
    return (math.degrees(math.atan2(b[0] - a[0], b[1] - a[1])) + 360.0) % 360.0


def heading_at(points: Sequence[XY], distance: float) -> float:
    acc = 0.0
    for a, b in itertools.pairwise(points):
        seg = math.dist(a, b)
        if seg > 0 and acc + seg >= distance:
            return heading_deg(a, b)
        acc += seg
    return heading_deg(points[-2], points[-1])
