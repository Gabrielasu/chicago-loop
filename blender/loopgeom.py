"""Mesh building helpers shared by the Blender scripts.

Everything works on plain lists so a whole layer (all buildings, all columns)
can be written into a single mesh, which keeps the scene and the glTF light.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Sequence

import bpy
from mathutils import Vector
from mathutils.geometry import tessellate_polygon

XY = Sequence[float]


class MeshBuilder:
    """Accumulates vertices and faces, then writes one Blender mesh."""

    def __init__(self) -> None:
        self.verts: list[tuple[float, float, float]] = []
        self.faces: list[tuple[int, ...]] = []
        self.face_mats: list[int] = []

    def add_vert(self, v: Sequence[float]) -> int:
        self.verts.append((float(v[0]), float(v[1]), float(v[2])))
        return len(self.verts) - 1

    def add_face(self, idx: Sequence[int], mat: int = 0) -> None:
        self.faces.append(tuple(idx))
        self.face_mats.append(mat)

    def prism(
        self,
        outer: Sequence[XY],
        holes: Sequence[Sequence[XY]],
        z0: float,
        z1: float,
        mat: int = 0,
        roof_mat: int | None = None,
        bottom: bool = False,
    ) -> None:
        """Extrude a polygon with holes from z0 to z1."""
        outer = _ccw(_dedupe(outer))
        holes = [_cw(_dedupe(h)) for h in holes if len(h) >= 3]
        if len(outer) < 3 or z1 - z0 <= 1e-3:
            return
        rings = [outer, *holes]
        flat = [p for ring in rings for p in ring]
        tris = tessellate_polygon([[Vector((p[0], p[1], 0.0)) for p in ring] for ring in rings])
        top = [self.add_vert((p[0], p[1], z1)) for p in flat]
        rm = mat if roof_mat is None else roof_mat
        for a, b, c in tris:
            # tessellate_polygon winding is not guaranteed; force upward normals.
            pa, pb, pc = flat[a], flat[b], flat[c]
            if (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]) < 0:
                b, c = c, b
            self.add_face((top[a], top[b], top[c]), rm)
        if bottom:
            bot = [self.add_vert((p[0], p[1], z0)) for p in flat]
            for a, b, c in tris:
                pa, pb, pc = flat[a], flat[b], flat[c]
                if (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]) > 0:
                    b, c = c, b
                self.add_face((bot[a], bot[b], bot[c]), mat)
        for ring in rings:
            n = len(ring)
            lo = [self.add_vert((p[0], p[1], z0)) for p in ring]
            hi = [self.add_vert((p[0], p[1], z1)) for p in ring]
            for i in range(n):
                j = (i + 1) % n
                self.add_face((lo[i], lo[j], hi[j], hi[i]), mat)

    def flat(self, outer: Sequence[XY], holes: Sequence[Sequence[XY]], z: float, mat: int = 0) -> None:
        outer = _ccw(_dedupe(outer))
        holes = [_cw(_dedupe(h)) for h in holes if len(h) >= 3]
        if len(outer) < 3:
            return
        rings = [outer, *holes]
        flat = [p for ring in rings for p in ring]
        tris = tessellate_polygon([[Vector((p[0], p[1], 0.0)) for p in ring] for ring in rings])
        idx = [self.add_vert((p[0], p[1], z)) for p in flat]
        for a, b, c in tris:
            pa, pb, pc = flat[a], flat[b], flat[c]
            if (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]) < 0:
                b, c = c, b
            self.add_face((idx[a], idx[b], idx[c]), mat)

    def box(self, center: Sequence[float], size: Sequence[float], yaw: float = 0.0, mat: int = 0) -> None:
        """Axis box rotated by yaw (radians) around z."""
        cx, cy, cz = center
        hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
        c, s = math.cos(yaw), math.sin(yaw)
        corners = []
        for dz in (-hz, hz):
            for dx, dy in ((-hx, -hy), (hx, -hy), (hx, hy), (-hx, hy)):
                corners.append(self.add_vert((cx + dx * c - dy * s, cy + dx * s + dy * c, cz + dz)))
        b0, b1, b2, b3, t0, t1, t2, t3 = corners
        for f in (
            (b0, b3, b2, b1),
            (t0, t1, t2, t3),
            (b0, b1, t1, t0),
            (b1, b2, t2, t1),
            (b2, b3, t3, t2),
            (b3, b0, t0, t3),
        ):
            self.add_face(f, mat)

    def beam(self, a: Sequence[float], b: Sequence[float], width: float, height: float, mat: int = 0) -> None:
        """A rectangular member between two 3D points (top at the points' z for horizontal beams)."""
        ax, ay, az = a
        bx, by, bz = b
        dx, dy, dz = bx - ax, by - ay, bz - az
        length = math.sqrt(dx * dx + dy * dy + dz * dz)
        if length < 1e-4:
            return
        d = Vector((dx, dy, dz)) / length
        up = Vector((0, 0, 1)) if abs(d.z) < 0.95 else Vector((1, 0, 0))
        side = d.cross(up).normalized() * (width / 2)
        upv = side.cross(d).normalized() * (height / 2)
        A, B = Vector(a), Vector(b)
        pts = [
            A - side - upv,
            A + side - upv,
            A + side + upv,
            A - side + upv,
            B - side - upv,
            B + side - upv,
            B + side + upv,
            B - side + upv,
        ]
        idx = [self.add_vert(p) for p in pts]
        a0, a1, a2, a3, b0, b1, b2, b3 = idx
        for f in (
            (a0, a3, a2, a1),
            (b0, b1, b2, b3),
            (a0, a1, b1, b0),
            (a1, a2, b2, b1),
            (a2, a3, b3, b2),
            (a3, a0, b0, b3),
        ):
            self.add_face(f, mat)

    def ribbon(self, points: Sequence[XY], z: float, width: float, thickness: float, mat: int = 0) -> None:
        """A flat band of given width following a polyline, as a closed solid."""
        self.sweep(points, z, width, thickness, 0.0, mat)

    def sweep(
        self, points: Sequence[XY], z_top: float, width: float, height: float, offset: float = 0.0, mat: int = 0
    ) -> None:
        """A rectangular section swept along a polyline, offset sideways (left is positive)."""
        n = len(points)
        if n < 2:
            return
        left = offset_polyline(points, offset + width / 2)
        right = offset_polyline(points, offset - width / 2)
        z0 = z_top - height
        top_l = [self.add_vert((p[0], p[1], z_top)) for p in left]
        top_r = [self.add_vert((p[0], p[1], z_top)) for p in right]
        bot_l = [self.add_vert((p[0], p[1], z0)) for p in left]
        bot_r = [self.add_vert((p[0], p[1], z0)) for p in right]
        for i in range(n - 1):
            self.add_face((top_r[i], top_r[i + 1], top_l[i + 1], top_l[i]), mat)
            self.add_face((bot_l[i], bot_l[i + 1], bot_r[i + 1], bot_r[i]), mat)
            self.add_face((top_l[i], top_l[i + 1], bot_l[i + 1], bot_l[i]), mat)
            self.add_face((bot_r[i], bot_r[i + 1], top_r[i + 1], top_r[i]), mat)
        self.add_face((top_l[0], bot_l[0], bot_r[0], top_r[0]), mat)
        self.add_face((top_r[-1], bot_r[-1], bot_l[-1], top_l[-1]), mat)

    def to_object(
        self, name: str, materials: Iterable[bpy.types.Material], collection: bpy.types.Collection, smooth: bool = False
    ) -> bpy.types.Object:
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(self.verts, [], self.faces)
        for m in materials:
            mesh.materials.append(m)
        if self.face_mats and len(mesh.polygons) == len(self.face_mats):
            mesh.polygons.foreach_set("material_index", self.face_mats)
        mesh.validate(clean_customdata=False)
        if not smooth:
            mesh.polygons.foreach_set("use_smooth", [False] * len(mesh.polygons))
        mesh.update()
        obj = bpy.data.objects.new(name, mesh)
        collection.objects.link(obj)
        return obj


def _dedupe(ring: Sequence[XY]) -> list[tuple[float, float]]:
    out: list[tuple[float, float]] = []
    for p in ring:
        q = (float(p[0]), float(p[1]))
        if not out or math.dist(out[-1], q) > 1e-3:
            out.append(q)
    if len(out) > 1 and math.dist(out[0], out[-1]) <= 1e-3:
        out.pop()
    return out


def signed_area(ring: Sequence[XY]) -> float:
    return 0.5 * sum(
        ring[i][0] * ring[(i + 1) % len(ring)][1] - ring[(i + 1) % len(ring)][0] * ring[i][1] for i in range(len(ring))
    )


def _ccw(ring):
    return ring if signed_area(ring) >= 0 else list(reversed(ring))


def _cw(ring):
    return ring if signed_area(ring) <= 0 else list(reversed(ring))


def offset_polyline(points: Sequence[XY], d: float) -> list[tuple[float, float]]:
    """Offset a polyline to the left by d (mitred joins, limited)."""
    n = len(points)
    out = []
    for i in range(n):
        p = Vector((points[i][0], points[i][1]))
        if i == 0:
            t = Vector((points[1][0], points[1][1])) - p
        elif i == n - 1:
            t = p - Vector((points[i - 1][0], points[i - 1][1]))
        else:
            t1 = (p - Vector((points[i - 1][0], points[i - 1][1]))).normalized()
            t2 = (Vector((points[i + 1][0], points[i + 1][1])) - p).normalized()
            t = t1 + t2
            if t.length < 1e-6:
                t = t2
        t.normalize()
        nrm = Vector((-t.y, t.x))
        scale = 1.0
        if 0 < i < n - 1:
            t1 = (p - Vector((points[i - 1][0], points[i - 1][1]))).normalized()
            nrm1 = Vector((-t1.y, t1.x))
            cosang = max(nrm.dot(nrm1), 0.35)
            scale = 1.0 / cosang
        q = p + nrm * d * scale
        out.append((q.x, q.y))
    return out


def resample(points: Sequence[XY], step: float) -> list[tuple[float, float, float]]:
    """Points every `step` meters along a polyline, with the heading (radians, atan2 of tangent)."""
    out = []
    seg_lengths = [math.dist(points[i], points[i + 1]) for i in range(len(points) - 1)]
    total = sum(seg_lengths)
    if total <= 0:
        return out
    count = max(int(total // step), 1)
    spacing = total / count
    target, acc, i = 0.0, 0.0, 0
    while target <= total + 1e-6 and i < len(seg_lengths):
        while i < len(seg_lengths) and acc + seg_lengths[i] < target - 1e-9:
            acc += seg_lengths[i]
            i += 1
        if i >= len(seg_lengths):
            break
        a, b = points[i], points[i + 1]
        t = (target - acc) / seg_lengths[i] if seg_lengths[i] > 0 else 0
        x = a[0] + (b[0] - a[0]) * t
        y = a[1] + (b[1] - a[1]) * t
        out.append((x, y, math.atan2(b[1] - a[1], b[0] - a[0])))
        target += spacing
    return out


def new_collection(name: str, parent: bpy.types.Collection | None = None) -> bpy.types.Collection:
    col = bpy.data.collections.new(name)
    (parent or bpy.context.scene.collection).children.link(col)
    return col
