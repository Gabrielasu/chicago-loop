"""Materials, light and render settings for the Loop model.

Day: a modern architect's massing model. Warm white and pale grey volumes, real
glass only where the data says so, black steel L, a neutral ground, soft daylight
with crisp shadows. Color only on trains and line markers.

Night: dark model, lit platforms, glowing trains.
"""

from __future__ import annotations

import math

import bpy
from mathutils import Vector


def srgb_to_linear(hex_color: str) -> tuple[float, float, float]:
    h = hex_color.lstrip("#")
    out = []
    for i in (0, 2, 4):
        c = int(h[i : i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return out[0], out[1], out[2]


# name: (day rgb, night rgb, roughness, metallic)
PALETTE: dict[str, tuple[tuple[float, float, float], tuple[float, float, float], float, float]] = {
    "ground": ((0.62, 0.615, 0.60), (0.030, 0.031, 0.034), 0.95, 0.0),
    "street": ((0.55, 0.55, 0.545), (0.020, 0.021, 0.024), 0.9, 0.0),
    "marking": ((0.74, 0.74, 0.73), (0.045, 0.046, 0.05), 0.9, 0.0),
    "park": ((0.52, 0.535, 0.50), (0.026, 0.028, 0.029), 0.95, 0.0),
    "water": ((0.27, 0.31, 0.33), (0.008, 0.010, 0.013), 0.06, 0.0),
    "bridge": ((0.50, 0.50, 0.49), (0.03, 0.03, 0.033), 0.85, 0.0),
    "massing_white": ((0.80, 0.785, 0.75), (0.050, 0.050, 0.054), 0.88, 0.0),
    "massing_grey": ((0.64, 0.64, 0.635), (0.040, 0.040, 0.044), 0.88, 0.0),
    "massing_glass": ((0.38, 0.42, 0.44), (0.025, 0.028, 0.032), 0.12, 0.55),
    "steel": ((0.016, 0.016, 0.018), (0.012, 0.012, 0.014), 0.55, 0.35),
    "rail": ((0.22, 0.22, 0.22), (0.10, 0.10, 0.10), 0.35, 1.0),
    "platform": ((0.58, 0.58, 0.565), (0.07, 0.065, 0.06), 0.9, 0.0),
    "platform_edge": ((0.90, 0.90, 0.88), (0.30, 0.28, 0.25), 0.8, 0.0),
    "platform_light": ((0.02, 0.02, 0.022), (0.02, 0.02, 0.02), 0.6, 0.0),
    "train_window": ((0.035, 0.038, 0.042), (0.05, 0.05, 0.05), 0.15, 0.0),
}

DAY_EXPOSURE = -0.55
NIGHT_EXPOSURE = 1.8

NIGHT_EMISSION = {
    "train_window": ((1.0, 0.93, 0.82), 1.4),
    "platform_light": ((1.0, 0.80, 0.58), 9.0),
    "platform": ((1.0, 0.84, 0.66), 0.9),
    "platform_edge": ((1.0, 0.88, 0.70), 1.6),
}


def _principled(mat: bpy.types.Material) -> bpy.types.Node:
    return mat.node_tree.nodes["Principled BSDF"]


def make_material(name: str, rgb, rough: float, metal: float) -> bpy.types.Material:
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = _principled(m)
    b.inputs["Base Color"].default_value = (*rgb, 1.0)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    m.diffuse_color = (*rgb, 1.0)
    return m


def make_materials(model: dict) -> dict[str, bpy.types.Material]:
    mats = {}
    for name, (day, _night, rough, metal) in PALETTE.items():
        mats[name] = make_material(name, day, rough, metal)
    for code, line in model["lines"].items():
        rgb = srgb_to_linear(line["color"])
        mats[f"line_{code}"] = make_material(f"line_{code}", rgb, 0.5, 0.0)
        mats[f"train_{code}"] = make_material(f"train_{code}", rgb, 0.42, 0.0)
    return mats


def apply_mode(scene: bpy.types.Scene, mats: dict, mode: str) -> None:
    night = mode == "night"
    for name, (day, nite, _r, _m) in PALETTE.items():
        b = _principled(mats[name])
        b.inputs["Base Color"].default_value = (*(nite if night else day), 1.0)
        color, strength = NIGHT_EMISSION.get(name, ((0, 0, 0), 0.0))
        b.inputs["Emission Color"].default_value = (*color, 1.0)
        b.inputs["Emission Strength"].default_value = strength if night else 0.0
    for name, m in mats.items():
        if (name.startswith("train_") and name != "train_window") or name.startswith("line_"):
            b = _principled(m)
            base = b.inputs["Base Color"].default_value
            b.inputs["Emission Color"].default_value = (base[0], base[1], base[2], 1.0)
            b.inputs["Emission Strength"].default_value = (1.1 if name.startswith("train_") else 1.2) if night else 0.0
    setup_world(scene, night)
    setup_sun(scene, night)
    lamps = bpy.data.collections.get("night_lamps")
    if lamps is not None:
        lamps.hide_render = not night
    scene.view_settings.exposure = NIGHT_EXPOSURE if night else DAY_EXPOSURE


def setup_world(scene: bpy.types.Scene, night: bool) -> None:
    world = scene.world or bpy.data.worlds.new("world")
    scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    light_path = nt.nodes.new("ShaderNodeLightPath")
    sky = nt.nodes.new("ShaderNodeBackground")
    backdrop = nt.nodes.new("ShaderNodeBackground")
    mix = nt.nodes.new("ShaderNodeMixShader")
    if night:
        sky.inputs["Color"].default_value = (0.020, 0.025, 0.045, 1)
        sky.inputs["Strength"].default_value = 1.0
        backdrop.inputs["Color"].default_value = (0.016, 0.017, 0.021, 1)
    else:
        sky.inputs["Color"].default_value = (0.60, 0.68, 0.80, 1)
        sky.inputs["Strength"].default_value = 0.32
        backdrop.inputs["Color"].default_value = (0.86, 0.86, 0.85, 1)
    backdrop.inputs["Strength"].default_value = 1.0
    # Light the model with the sky, but show a plain neutral backdrop to the camera.
    nt.links.new(light_path.outputs["Is Camera Ray"], mix.inputs["Fac"])
    nt.links.new(sky.outputs[0], mix.inputs[1])
    nt.links.new(backdrop.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])


def setup_sun(scene: bpy.types.Scene, night: bool) -> None:
    sun = bpy.data.objects.get("sun")
    if sun is None:
        data = bpy.data.lights.new("sun", "SUN")
        sun = bpy.data.objects.new("sun", data)
        scene.collection.objects.link(sun)
    # Afternoon light from the west-south-west, 34 degrees up.
    az, el = (math.radians(242), math.radians(34)) if not night else (math.radians(140), math.radians(50))
    to_sun = Vector((math.sin(az) * math.cos(el), math.cos(az) * math.cos(el), math.sin(el)))
    sun.rotation_euler = (-to_sun).to_track_quat("-Z", "Y").to_euler()
    sun.data.angle = math.radians(0.6)
    if night:
        sun.data.energy = 0.22
        sun.data.color = (0.62, 0.72, 1.0)
    else:
        sun.data.energy = 4.6
        sun.data.color = (1.0, 0.96, 0.90)


def setup_render(scene: bpy.types.Scene, samples: int, width: int, height: int, gpu: bool = True) -> None:
    scene.render.engine = "CYCLES"
    scene.cycles.samples = samples
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 6
    scene.cycles.diffuse_bounces = 3
    scene.cycles.glossy_bounces = 3
    scene.cycles.transparent_max_bounces = 2
    scene.render.resolution_x, scene.render.resolution_y = width, height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.view_transform = "AgX"
    try:
        scene.view_settings.look = "AgX - High Contrast"
    except TypeError:
        scene.view_settings.look = "None"
    scene.cycles.device = "CPU"
    if gpu:
        try:
            prefs = bpy.context.preferences.addons["cycles"].preferences
            for backend in ("METAL", "OPTIX", "CUDA", "HIP", "ONEAPI"):
                try:
                    prefs.compute_device_type = backend
                except TypeError:
                    continue
                prefs.get_devices()
                devices = [d for d in prefs.devices if d.type == backend]
                if devices:
                    for d in prefs.devices:
                        d.use = d.type == backend
                    scene.cycles.device = "GPU"
                    print("Cycles device:", backend, [d.name for d in devices])
                    break
        except Exception as exc:
            print("GPU setup failed, using CPU:", exc)
    if scene.cycles.device == "CPU":
        print("Cycles device: CPU")


# Street canyons get far less light than the aerial view; open them up a little.
CAMERA_EXPOSURE = {
    ("street", "day"): 1.3,
    ("junction", "day"): 1.0,
    ("street", "night"): 0.6,
    ("junction", "night"): 0.6,
    ("station", "day"): 1.0,
    ("station", "night"): 0.6,
}


def apply_camera_exposure(scene: bpy.types.Scene, camera: str, mode: str) -> None:
    base = NIGHT_EXPOSURE if mode == "night" else DAY_EXPOSURE
    scene.view_settings.exposure = base + CAMERA_EXPOSURE.get((camera, mode), 0.0)
