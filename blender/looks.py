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
    "edge": ((0.06, 0.06, 0.065), (0.10, 0.09, 0.08), 0.9, 0.0),
    "tree": ((0.60, 0.625, 0.565), (0.028, 0.032, 0.03), 0.95, 0.0),
    "trunk": ((0.42, 0.41, 0.39), (0.03, 0.03, 0.03), 0.9, 0.0),
}

DAY_EXPOSURE = -0.55
NIGHT_EXPOSURE = 1.8

NIGHT_EMISSION = {
    "train_window": ((1.0, 0.93, 0.82), 1.4),
    "platform_light": ((1.0, 0.80, 0.58), 4.5),
    "platform": ((1.0, 0.84, 0.66), 0.35),
    "platform_edge": ((1.0, 0.88, 0.70), 0.7),
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


# Lit windows at night. Floors every 3.9 m, window bays every 3 m along each
# facade. A stable hash decides which windows are lit, a slow noise makes some
# blocks busier than others, and the light is mostly warm with some cool white.
WINDOW_BAY = 3.0
WINDOW_FLOOR = 3.9
WINDOW_FLOORS = 0.42  # share of office floors lit in the evening (the stills are set around 9 pm)
WINDOW_STRENGTH = 0.3  # Cycles renders the night brighter than the viewer (exposure), so half its value


def _math(nt, op: str, a, b=None, clamp: bool = False):
    n = nt.nodes.new("ShaderNodeMath")
    n.operation = op
    n.use_clamp = clamp
    for i, v in enumerate((a, b)):
        if v is None:
            continue
        if isinstance(v, (int, float)):
            n.inputs[i].default_value = v
        else:
            nt.links.new(v, n.inputs[i])
    return n.outputs[0]


def add_window_lights(mat: bpy.types.Material, frame_u: float, frame_v: float, glass_facade: bool = False) -> None:
    """Drive the material's emission with a procedural grid of lit windows.

    frame_u and frame_v are the share of each bay and floor taken by wall
    rather than glass: masonry has deep frames, curtain walls almost none.
    The value node "night" switches the windows on (1) and off (0).
    """
    nt = mat.node_tree
    bsdf = _principled(mat)
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    night = nt.nodes.new("ShaderNodeValue")
    night.name = "night"
    night.label = "night"
    night.outputs[0].default_value = 0.0

    n = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geo.outputs["Normal"], n.inputs[0])
    p = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geo.outputs["Position"], p.inputs[0])

    # Only walls: |nz| small.
    wall = _math(nt, "LESS_THAN", _math(nt, "ABSOLUTE", n.outputs["Z"]), 0.3)
    # Distance along the wall: position dotted with the horizontal tangent (-ny, nx).
    u = _math(
        nt,
        "ADD",
        _math(nt, "MULTIPLY", p.outputs["X"], _math(nt, "MULTIPLY", n.outputs["Y"], -1.0)),
        _math(nt, "MULTIPLY", p.outputs["Y"], n.outputs["X"]),
    )
    # Which wall: its distance from the origin along the normal.
    plane = _math(
        nt,
        "ROUND",
        _math(
            nt,
            "ADD",
            _math(nt, "MULTIPLY", p.outputs["X"], n.outputs["X"]),
            _math(nt, "MULTIPLY", p.outputs["Y"], n.outputs["Y"]),
        ),
    )
    su = _math(nt, "DIVIDE", u, WINDOW_BAY)
    sv = _math(nt, "DIVIDE", p.outputs["Z"], WINDOW_FLOOR)
    fu = _math(nt, "FRACT", su)
    fv = _math(nt, "FRACT", sv)
    in_u = _math(
        nt, "MULTIPLY", _math(nt, "GREATER_THAN", fu, frame_u / 2), _math(nt, "LESS_THAN", fu, 1 - frame_u / 2)
    )
    in_v = _math(
        nt, "MULTIPLY", _math(nt, "GREATER_THAN", fv, frame_v * 0.65), _math(nt, "LESS_THAN", fv, 1 - frame_v * 0.35)
    )
    glass = _math(nt, "MULTIPLY", in_u, in_v)

    def noise3(x, y, z):
        """Stable random value in [0, 1) for three inputs (a white noise texture)."""
        v = nt.nodes.new("ShaderNodeCombineXYZ")
        for k, val in zip(("X", "Y", "Z"), (x, y, z), strict=True):
            if isinstance(val, (int, float)):
                v.inputs[k].default_value = val
            else:
                nt.links.new(val, v.inputs[k])
        w = nt.nodes.new("ShaderNodeTexWhiteNoise")
        w.noise_dimensions = "3D"
        nt.links.new(v.outputs[0], w.inputs["Vector"])
        return w.outputs["Value"]

    col_u = _math(nt, "FLOOR", su)
    level = _math(nt, "FLOOR", sv)
    # Same rules as the viewer (web/src/scene/windows.ts): whole floors lit in bands,
    # a few stray windows on dark floors, lobbies at street level, one light per facade.
    blocks = nt.nodes.new("ShaderNodeTexNoise")
    blocks.inputs["Scale"].default_value = 0.011
    blocks.inputs["Detail"].default_value = 0.0
    nt.links.new(geo.outputs["Position"], blocks.inputs["Vector"])
    floors = _math(nt, "MULTIPLY", WINDOW_FLOORS, _math(nt, "ADD", 0.5, blocks.outputs["Fac"]))
    floor_lit = _math(nt, "LESS_THAN", noise3(level, plane, 11.0), floors)
    threshold = _math(nt, "ADD", 0.07, _math(nt, "MULTIPLY", floor_lit, 0.83))
    upper = _math(nt, "LESS_THAN", noise3(col_u, level, plane), threshold)
    lobby = _math(nt, "MULTIPLY", _math(nt, "LESS_THAN", noise3(col_u, plane, 3.0), 0.8), 0.8)
    street_level = _math(nt, "LESS_THAN", sv, 1.0)
    lit = _math(
        nt,
        "ADD",
        _math(nt, "MULTIPLY", street_level, lobby),
        _math(nt, "MULTIPLY", _math(nt, "SUBTRACT", 1.0, street_level), upper),
    )
    level_k = _math(nt, "ADD", 0.6, _math(nt, "MULTIPLY", noise3(col_u, level, _math(nt, "ADD", plane, 41.0)), 0.4))

    # One light per facade: warm, neutral or cool white (glass facades lean cool).
    pick = noise3(plane, 5.0, 9.0)
    if glass_facade:
        pick = _math(nt, "ADD", 0.45, _math(nt, "MULTIPLY", pick, 0.55))
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "CONSTANT"
    els = ramp.color_ramp.elements
    els[0].position = 0.0
    els[0].color = (1.0, 0.62, 0.32, 1)
    els[1].position = 0.42
    els[1].color = (1.0, 0.8, 0.58, 1)
    e3 = els.new(0.78)
    e3.color = (0.8, 0.9, 1.0, 1)
    nt.links.new(pick, ramp.inputs["Fac"])

    window = _math(nt, "MULTIPLY", _math(nt, "MULTIPLY", wall, glass), _math(nt, "MULTIPLY", lit, level_k))

    # Floodlit crowns on towers over 120 m (the _roofz attribute is the building's roof height).
    roof_attr = nt.nodes.new("ShaderNodeAttribute")
    roof_attr.attribute_name = "_roofz"
    roof = roof_attr.outputs["Fac"]
    span = _math(nt, "MAXIMUM", 9.0, _math(nt, "MINIMUM", 34.0, _math(nt, "MULTIPLY", roof, 0.09)))
    t = _math(nt, "SUBTRACT", 1.0, _math(nt, "DIVIDE", _math(nt, "SUBTRACT", roof, p.outputs["Z"]), span), clamp=True)
    crown_on = _math(
        nt,
        "MULTIPLY",
        _math(nt, "GREATER_THAN", roof, 120.0),
        _math(nt, "GREATER_THAN", noise3(_math(nt, "FLOOR", roof), 3.0, 1.0), 0.18),
    )
    crown = _math(nt, "MULTIPLY", _math(nt, "MULTIPLY", _math(nt, "MULTIPLY", t, t), crown_on), wall)
    crown = _math(nt, "MULTIPLY", crown, 0.42 / WINDOW_STRENGTH)

    strength = _math(nt, "ADD", window, crown)
    strength = _math(nt, "MULTIPLY", strength, night.outputs[0])
    strength = _math(nt, "MULTIPLY", strength, WINDOW_STRENGTH)
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Emission Color"])
    nt.links.new(strength, bsdf.inputs["Emission Strength"])


def make_materials(model: dict) -> dict[str, bpy.types.Material]:
    mats = {}
    for name, (day, _night, rough, metal) in PALETTE.items():
        mats[name] = make_material(name, day, rough, metal)
    add_window_lights(mats["massing_white"], frame_u=0.42, frame_v=0.38)
    add_window_lights(mats["massing_grey"], frame_u=0.3, frame_v=0.3)
    add_window_lights(mats["massing_glass"], frame_u=0.04, frame_v=0.16, glass_facade=True)
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
        switch = mats[name].node_tree.nodes.get("night")
        if switch is not None:
            switch.outputs[0].default_value = 1.0 if night else 0.0
            continue
        color, strength = NIGHT_EMISSION.get(name, ((0, 0, 0), 0.0))
        b.inputs["Emission Color"].default_value = (*color, 1.0)
        b.inputs["Emission Strength"].default_value = strength if night else 0.0
    for name, m in mats.items():
        if (name.startswith("train_") and name != "train_window") or name.startswith("line_"):
            b = _principled(m)
            base = b.inputs["Base Color"].default_value
            b.inputs["Emission Color"].default_value = (base[0], base[1], base[2], 1.0)
            b.inputs["Emission Strength"].default_value = (0.45 if name.startswith("train_") else 1.0) if night else 0.0
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
        backdrop.inputs["Color"].default_value = (0.006, 0.007, 0.011, 1)
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
    ("river", "day"): 0.5,
    ("river", "night"): 0.2,
    ("street", "day"): 1.3,
    ("junction", "day"): 1.0,
    ("street", "night"): 0.6,
    ("junction", "night"): 0.6,
    ("station", "day"): 1.0,
    ("station", "night"): -0.3,
}


def apply_camera_exposure(scene: bpy.types.Scene, camera: str, mode: str) -> None:
    base = NIGHT_EXPOSURE if mode == "night" else DAY_EXPOSURE
    scene.view_settings.exposure = base + CAMERA_EXPOSURE.get((camera, mode), 0.0)
