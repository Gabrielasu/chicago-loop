"""Roof shapes from OpenStreetMap (roof:shape, roof:height, roof:direction).

Each function adds the roof above `base` to a MeshBuilder and assumes the walls
were built up to `base`. Shapes that need a rectangle (hipped, gabled) fall back
to a pyramid when the footprint is far from one.
"""

from __future__ import annotations

import math
from collections.abc import Sequence

from loopgeom import MeshBuilder, _ccw, _dedupe
from shapely.geometry import Polygon

XY = Sequence[float]

# Roof height as a share of the footprint's short side when the data has none (estimated).
DEFAULT_SHARE = {"pyramidal": 0.35, "hipped": 0.28, "gabled": 0.28, "dome": 0.5, "mansard": 0.18, "skillion": 0.15}
SUPPORTED = set(DEFAULT_SHARE)


def roof_height(b: dict) -> float:
    """Height of the roof part of a building, from the data or estimated, never more than half the building."""
    poly = Polygon(b["outer"])
    rect = poly.minimum_rotated_rectangle
    c = list(rect.exterior.coords)
    short = min(math.dist(c[0], c[1]), math.dist(c[1], c[2]))
    total = b["height"] - b["min_height"]
    rh = b.get("roof_height")
    # Some roof heights in OpenStreetMap are really the building height; ignore those.
    if rh is None or rh <= 0 or (rh > 0.5 * total and poly.area > 60):
        rh = DEFAULT_SHARE.get(b["roof_shape"], 0.2) * short
    return max(min(rh, 0.5 * total if poly.area > 60 else 0.95 * total), 0.0)


def _long_axis(ring: list[tuple[float, float]]):
    """Center line of the minimum rotated rectangle and its half width, plus how rectangular the ring is."""
    poly = Polygon(ring)
    rect = poly.minimum_rotated_rectangle
    c = list(rect.exterior.coords)[:4]
    e0, e1 = math.dist(c[0], c[1]), math.dist(c[1], c[2])
    if e0 >= e1:
        a = ((c[1][0] + c[2][0]) / 2, (c[1][1] + c[2][1]) / 2)
        b = ((c[3][0] + c[0][0]) / 2, (c[3][1] + c[0][1]) / 2)
        half = e1 / 2
    else:
        a = ((c[0][0] + c[1][0]) / 2, (c[0][1] + c[1][1]) / 2)
        b = ((c[2][0] + c[3][0]) / 2, (c[2][1] + c[3][1]) / 2)
        half = e0 / 2
    fill = poly.area / rect.area if rect.area > 0 else 0
    return a, b, half, fill


def pyramid(mb: MeshBuilder, ring, base: float, rh: float, mat: int = 0) -> None:
    c = Polygon(ring).centroid
    apex = mb.add_vert((c.x, c.y, base + rh))
    idx = [mb.add_vert((p[0], p[1], base)) for p in ring]
    for i in range(len(ring)):
        mb.add_face((idx[i], idx[(i + 1) % len(ring)], apex), mat)


def dome(mb: MeshBuilder, ring, base: float, rh: float, mat: int = 0, steps: int = 8) -> None:
    c = Polygon(ring).centroid
    prev = [mb.add_vert((p[0], p[1], base)) for p in ring]
    for k in range(1, steps):
        a = (math.pi / 2) * k / steps
        s, z = math.cos(a), base + rh * math.sin(a)
        cur = [mb.add_vert((c.x + (p[0] - c.x) * s, c.y + (p[1] - c.y) * s, z)) for p in ring]
        for i in range(len(ring)):
            j = (i + 1) % len(ring)
            mb.add_face((prev[i], prev[j], cur[j], cur[i]), mat)
        prev = cur
    apex = mb.add_vert((c.x, c.y, base + rh))
    for i in range(len(ring)):
        mb.add_face((prev[i], prev[(i + 1) % len(ring)], apex), mat)


def ridge_roof(mb: MeshBuilder, ring, base: float, rh: float, hipped: bool, mat: int = 0) -> bool:
    """Hipped or gabled roof over the footprint's rectangle. False if the footprint is not rectangular."""
    a, b, half, fill = _long_axis(ring)
    if fill < 0.85:
        return False
    ax = (b[0] - a[0], b[1] - a[1])
    length = math.hypot(*ax)
    if length < 1e-3:
        return False
    u = (ax[0] / length, ax[1] / length)
    inset = min(half, length / 2 - 0.01) if hipped else 0.0
    r0 = (a[0] + u[0] * inset, a[1] + u[1] * inset, base + rh)
    r1 = (b[0] - u[0] * inset, b[1] - u[1] * inset, base + rh)
    # Each footprint vertex rises to the nearer ridge end: a sheet of triangles over the rectangle.
    ridge = [mb.add_vert(r0), mb.add_vert(r1)]
    idx = [mb.add_vert((p[0], p[1], base)) for p in ring]
    n = len(ring)

    def side(p) -> float:
        return (p[0] - a[0]) * -u[1] + (p[1] - a[1]) * u[0]

    def along(p) -> float:
        return (p[0] - a[0]) * u[0] + (p[1] - a[1]) * u[1]

    for i in range(n):
        p, q = ring[i], ring[(i + 1) % n]
        tp, tq = along(p) / length, along(q) / length
        sp, sq = side(p), side(q)
        if not hipped and abs(sp - sq) > half * 1.2:
            # Gable end: a vertical triangle up to the ridge end.
            end = ridge[0] if (tp + tq) / 2 < 0.5 else ridge[1]
            mb.add_face((idx[i], idx[(i + 1) % n], end), mat)
            continue
        rp = ridge[0] if tp < 0.5 else ridge[1]
        rq = ridge[0] if tq < 0.5 else ridge[1]
        if rp == rq:
            mb.add_face((idx[i], idx[(i + 1) % n], rp), mat)
        else:
            mb.add_face((idx[i], idx[(i + 1) % n], rq, rp), mat)
    return True


def skillion(mb: MeshBuilder, ring, base: float, rh: float, direction: float | None, mat: int = 0) -> None:
    """A single sloping roof, falling toward `direction` (compass degrees)."""
    if direction is None:
        a, b, _half, _fill = _long_axis(ring)
        d = (b[0] - a[0], b[1] - a[1])
    else:
        r = math.radians(direction)
        d = (math.sin(r), math.cos(r))
    n = math.hypot(*d) or 1.0
    d = (d[0] / n, d[1] / n)
    proj = [p[0] * d[0] + p[1] * d[1] for p in ring]
    lo, hi = min(proj), max(proj)
    span = hi - lo or 1.0
    tops = [base + rh * (1 - (t - lo) / span) for t in proj]
    # Walls from the base up to the slope, then the sloped top.
    low = [mb.add_vert((p[0], p[1], base)) for p in ring]
    high = [mb.add_vert((p[0], p[1], z)) for p, z in zip(ring, tops, strict=True)]
    m = len(ring)
    for i in range(m):
        j = (i + 1) % m
        mb.add_face((low[i], low[j], high[j], high[i]), mat)
    from mathutils import Vector
    from mathutils.geometry import tessellate_polygon

    for t in tessellate_polygon([[Vector((p[0], p[1], 0)) for p in ring]]):
        i0, i1, i2 = t
        p0, p1, p2 = ring[i0], ring[i1], ring[i2]
        if (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]) < 0:
            i1, i2 = i2, i1
        mb.add_face((high[i0], high[i1], high[i2]), mat)


def mansard(mb: MeshBuilder, ring, base: float, rh: float, mat: int = 0) -> None:
    poly = Polygon(ring)
    _a, _b, half, _fill = _long_axis(ring)
    inner = poly.buffer(-min(half * 0.35, rh * 0.8), join_style="mitre")
    if inner.is_empty or inner.geom_type != "Polygon" or len(inner.exterior.coords) != len(ring) + 1:
        pyramid(mb, ring, base, rh, mat)
        return
    top_ring = _ccw(_dedupe(list(inner.exterior.coords)))
    # Match each outer vertex to the nearest inner one so the slopes are quads.
    tops = []
    for p in ring:
        q = min(top_ring, key=lambda t: math.dist(t, p))
        tops.append(q)
    lo = [mb.add_vert((p[0], p[1], base)) for p in ring]
    hi = [mb.add_vert((q[0], q[1], base + rh)) for q in tops]
    n = len(ring)
    for i in range(n):
        j = (i + 1) % n
        mb.add_face((lo[i], lo[j], hi[j], hi[i]), mat)
    mb.flat(top_ring, [], base + rh, mat)


def add_roof(mb: MeshBuilder, b: dict, mat: int = 0) -> float:
    """Build the walls and roof of a building with a roof shape. Returns the eave height."""
    shape = b["roof_shape"]
    ring = _ccw(_dedupe(b["outer"]))
    rh = roof_height(b)
    base = b["height"] - rh
    mb.prism(b["outer"], b["holes"], b["min_height"], base, mat=mat, bottom=b["min_height"] > 0.5)
    if shape == "skillion":
        # The walls of a skillion rise with the slope; drop the flat top added by prism.
        skillion(mb, ring, base, rh, b.get("roof_direction"), mat)
    elif shape == "dome":
        dome(mb, ring, base, rh, mat)
    elif shape in ("hipped", "gabled"):
        if not ridge_roof(mb, ring, base, rh, hipped=shape == "hipped", mat=mat):
            pyramid(mb, ring, base, rh, mat)
    elif shape == "mansard":
        mansard(mb, ring, base, rh, mat)
    else:
        pyramid(mb, ring, base, rh, mat)
    return base
