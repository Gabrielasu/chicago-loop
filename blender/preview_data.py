"""Quick check of build/loop.json in Blender: plain extrusions, Workbench render.

Usage: .venv/bin/python blender/preview_data.py [build/loop.json] [build/phase1-preview.png]
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from loopgeom import MeshBuilder, new_collection

args = [a for a in sys.argv[1:] if not a.startswith("-")]
src = Path(next((a for a in args if a.endswith(".json")), "build/loop.json"))
out = Path(next((a for a in args if a.endswith(".png")), "build/phase1-preview.png"))
model = json.loads(src.read_text())

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def mat(name: str, rgb: tuple[float, float, float]) -> bpy.types.Material:
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*rgb, 1.0)
    return m


def srgb(hex_color: str) -> tuple[float, float, float]:
    h = hex_color.lstrip("#")
    c = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)  # type: ignore[return-value]


col = new_collection("preview")
tz = model["meta"]["track_z"]

b = MeshBuilder()
for bl in model["buildings"]:
    m = 1 if bl["height_estimated"] else 0
    b.prism(bl["outer"], bl["holes"], bl["min_height"], bl["height"], mat=m)
b.to_object("buildings", [mat("measured", (0.80, 0.80, 0.78)), mat("estimated", (0.62, 0.66, 0.74))], col)

g = MeshBuilder()
for s in model["street_surfaces"]:
    g.flat(s["outer"], s["holes"], 0.02)
g.to_object("streets", [mat("street", (0.35, 0.35, 0.35))], col)

w = MeshBuilder()
for r in model["river"]:
    w.flat(r["outer"], r["holes"], 0.05)
w.to_object("river", [mat("water", (0.25, 0.4, 0.55))], col)

tracks = MeshBuilder()
for t in model["tracks"]:
    tracks.ribbon(t["points"], tz, 2.6, 0.6)
tracks.to_object("tracks", [mat("steel", (0.05, 0.05, 0.05))], col)

lines = MeshBuilder()
mats = []
for i, (code, line) in enumerate(model["lines"].items()):
    mats.append(mat(code, srgb(line["color"])))
    for k, p in enumerate(line["patterns"][:2]):
        pts = p["points"]
        lines.ribbon(pts, tz + 1.5 + i * 0.6 + k * 0.3, 1.2, 0.3, mat=i)
lines.to_object("lines", mats, col)

st = MeshBuilder()
for s in model["stations"]:
    for p in s["platforms"]:
        st.prism(p["outer"], p["holes"], tz - 0.2, tz + 1.0, mat=1 if s["status"] != "open" else 0)
st.to_object("stations", [mat("platform", (0.95, 0.75, 0.2)), mat("closed", (0.9, 0.2, 0.2))], col)

ground = MeshBuilder()
x0, y0, x1, y1 = model["meta"]["bounds"]
ground.flat([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], [], 0.0)
ground.to_object("ground", [mat("ground", (0.75, 0.74, 0.70))], col)

cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
cam_data.ortho_scale = max(x1 - x0, y1 - y0) * 1.0
cam_data.clip_start = 1.0
cam_data.clip_end = 10000.0
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
cam.location = (cx - 900, cy - 1300, 1500)
direction = (cx - cam.location.x, cy - cam.location.y, -cam.location.z)
cam.rotation_euler = (
    math.atan2(math.hypot(direction[0], direction[1]), -direction[2]),
    0,
    math.atan2(direction[1], direction[0]) - math.pi / 2,
)
scene.camera = cam

scene.render.engine = "BLENDER_WORKBENCH"
shading = scene.display.shading
shading.light = "STUDIO"
shading.color_type = "MATERIAL"
shading.show_shadows = True
shading.show_cavity = True
scene.display.shadow_focus = 0.5
scene.render.resolution_x, scene.render.resolution_y = 1600, 900
scene.render.filepath = str(out)
out.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.render.render(write_still=True)
print("wrote", out)

# A plan view to check track and station geometry.
plan = out.with_name(out.stem + "-plan.png")
bpy.data.objects["buildings"].hide_render = True
cam.location = (cx, cy, 2000)
cam.rotation_euler = (0, 0, 0)
cam_data.ortho_scale = max(x1 - x0, y1 - y0) * 1.02
scene.render.resolution_x, scene.render.resolution_y = 1400, 1600
fp = MeshBuilder()
for bl in model["buildings"]:
    fp.flat(bl["outer"], bl["holes"], 0.3)
fp.to_object("footprints", [mat("footprint", (0.88, 0.87, 0.84))], col)
scene.render.filepath = str(plan)
bpy.ops.render.render(write_still=True)
print("wrote", plan)
