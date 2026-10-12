"""Prototype: a procedural stand-in city at dusk (made-up buildings). Reference for materials, light and camera only."""
import math, random, sys
import bpy
from mathutils import Vector

OUT = sys.argv[-1] if sys.argv[-1].endswith('.png') else 'build/preview.png'
random.seed(7)
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene


def mat(name, color, rough=0.7, metal=0.0, emit=None, strength=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emit:
        b.inputs['Emission Color'].default_value = (*emit, 1)
        b.inputs['Emission Strength'].default_value = strength
    return m


def facade(name, stone, lit_bias):
    """Stone mortar grid with windows, some of them lit."""
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; N = nt.nodes; L = nt.links
    N.clear()
    out = N.new('ShaderNodeOutputMaterial')
    tc = N.new('ShaderNodeTexCoord')
    mp = N.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (1.0, 1.0, 1.0)
    br = N.new('ShaderNodeTexBrick')
    br.offset = 0.0; br.squash = 1.0
    br.inputs['Scale'].default_value = 2.6
    br.inputs['Mortar Size'].default_value = 0.11
    br.inputs['Brick Width'].default_value = 0.9
    br.inputs['Row Height'].default_value = 1.15
    br.inputs['Bias'].default_value = lit_bias
    br.inputs['Color1'].default_value = (0.012, 0.014, 0.022, 1)
    br.inputs['Color2'].default_value = (1.0, 0.62, 0.26, 1)
    br.inputs['Mortar'].default_value = (*stone, 1)
    win = N.new('ShaderNodeBsdfPrincipled')
    win.inputs['Roughness'].default_value = 0.15
    win.inputs['Emission Strength'].default_value = 3.0
    st = N.new('ShaderNodeBsdfPrincipled'); st.inputs['Base Color'].default_value = (*stone, 1); st.inputs['Roughness'].default_value = 0.8
    mix = N.new('ShaderNodeMixShader')
    L.new(tc.outputs['Object'], mp.inputs['Vector'])
    # project windows on vertical faces: use x+y as horizontal, z as vertical
    sep = N.new('ShaderNodeSeparateXYZ'); comb = N.new('ShaderNodeCombineXYZ'); add = N.new('ShaderNodeMath'); add.operation = 'ADD'
    L.new(tc.outputs['Object'], sep.inputs[0])
    L.new(sep.outputs['X'], add.inputs[0]); L.new(sep.outputs['Y'], add.inputs[1])
    L.new(add.outputs[0], comb.inputs['X']); L.new(sep.outputs['Z'], comb.inputs['Y'])
    L.new(comb.outputs[0], br.inputs['Vector'])
    L.new(br.outputs['Color'], win.inputs['Base Color'])
    L.new(br.outputs['Color'], win.inputs['Emission Color'])
    L.new(br.outputs['Fac'], mix.inputs['Fac'])
    L.new(win.outputs[0], mix.inputs[1]); L.new(st.outputs[0], mix.inputs[2])
    L.new(mix.outputs[0], out.inputs['Surface'])
    return m


def box(name, loc, size, material):
    bpy.ops.mesh.primitive_cube_add(location=loc)
    o = bpy.context.active_object; o.name = name
    o.scale = (size[0] / 2, size[1] / 2, size[2] / 2)
    bpy.ops.object.transform_apply(scale=True)
    o.data.materials.append(material)
    return o

# ---------------------------------------------------------------- materials
STONES = [(0.62, 0.56, 0.46), (0.48, 0.30, 0.22), (0.36, 0.37, 0.40), (0.70, 0.66, 0.58), (0.22, 0.23, 0.26)]
FACADES = [facade(f'facade{i}', s, random.uniform(-0.9, -0.65)) for i, s in enumerate(STONES)]
ROOF = mat('roof', (0.30, 0.29, 0.28), 0.9)
STREET = mat('street', (0.075, 0.072, 0.07), 0.6)
WALK = mat('walk', (0.28, 0.27, 0.25), 0.9)
WATER = mat('water', (0.03, 0.10, 0.11), 0.05)
PARK = mat('park', (0.10, 0.20, 0.07), 0.9)
STEEL = mat('steel', (0.06, 0.06, 0.06), 0.5, 0.6)
CAR = mat('car', (0.75, 0.75, 0.72), 0.35, 0.8)
CARLIT = mat('carlit', (0.9, 0.9, 0.85), 0.4, 0.0, (1.0, 0.85, 0.6), 3.0)
TREE = mat('tree', (0.06, 0.14, 0.05), 0.9)

# ---------------------------------------------------------------- city
B, G, N = 10.0, 14.0, 7
ext = N * G
box('street', (ext / 2 - 2, ext / 2 - 2, -0.05), (ext + 40, ext + 40, 0.1), STREET)
box('lake', (ext + 60, ext / 2, -0.12), (100, 400, 0.1), WATER)
box('river', (ext / 2 - 2, 12, -0.04), (ext + 40, 3.6, 0.1), WATER)
for j in range(N):
    for i in range(N):
        x0, y0 = i * G, j * G
        if j == 0 and False:
            continue
        cx, cy = x0 + B / 2, y0 + B / 2
        if i == N - 1:  # Grant Park strip by the lake
            box(f'park{i}{j}', (cx, cy, 0.05), (B, B, 0.1), PARK)
            for _ in range(10):
                bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=random.uniform(0.7, 1.2), location=(x0 + random.uniform(1, 9), y0 + random.uniform(1, 9), 1.0))
                bpy.context.active_object.data.materials.append(TREE)
            continue
        box(f'walk{i}{j}', (cx, cy, 0.06), (B + 1.2, B + 1.2, 0.12), WALK)
        core = 2 <= i <= 4 and 2 <= j <= 4
        sub = 2 if random.random() > 0.35 else 1
        step = B / sub
        for a in range(sub):
            for b in range(sub):
                if random.random() < 0.07:
                    continue
                lx, ly = x0 + a * step + step / 2, y0 + b * step + step / 2
                w = step - 0.6
                h = random.uniform(16, 42) if core else random.uniform(4, 16)
                if i == 3 and j == 3 and a == 0 and b == 0:
                    h = 62
                f = random.choice(FACADES)
                box(f'b{i}{j}{a}{b}', (lx, ly, h / 2), (w, w, h), f)
                box(f'r{i}{j}{a}{b}', (lx, ly, h + 0.15), (w + 0.2, w + 0.2, 0.3), ROOF)
                # Chicago setbacks on the tall ones
                hh, ww = h, w
                while hh > 24 and random.random() < 0.8:
                    ww *= 0.72; add = random.uniform(5, 10)
                    box(f's{i}{j}{a}{b}{hh:.0f}', (lx, ly, hh + add / 2), (ww, ww, add), f)
                    hh += add
                    box(f'sr{i}{j}{a}{b}{hh:.0f}', (lx, ly, hh + 0.12), (ww + 0.15, ww + 0.15, 0.24), ROOF)

# ---------------------------------------------------------------- the L
a0, a1, tz = 2 * G - 2, 5 * G - 2, 5.0
corners = [(a0, a0), (a1, a0), (a1, a1), (a0, a1)]
for k in range(4):
    (x1, y1), (x2, y2) = corners[k], corners[(k + 1) % 4]
    mid = ((x1 + x2) / 2, (y1 + y2) / 2, tz)
    length = math.hypot(x2 - x1, y2 - y1) + 1.6
    sx, sy = (length, 1.6) if y1 == y2 else (1.6, length)
    box(f'deck{k}', mid, (sx, sy, 0.5), STEEL)
    steps = int(length // 4)
    for s in range(steps + 1):
        t = s / steps
        px, py = x1 + (x2 - x1) * t, y1 + (y2 - y1) * t
        box(f'pier{k}{s}', (px, py, tz / 2), (0.25, 1.4, tz), STEEL)
# a train of four cars on the south side of the loop
for c in range(4):
    box(f'car{c}', (a0 + 10 + c * 3.3, a0, tz + 0.8), (3.1, 1.1, 1.1), CAR)
    box(f'carw{c}', (a0 + 10 + c * 3.3, a0, tz + 0.95), (2.7, 1.15, 0.3), CARLIT)

# ---------------------------------------------------------------- light, camera
world = bpy.data.worlds.new('dusk'); sc.world = world; world.use_nodes = True
bg = world.node_tree.nodes['Background']
bg.inputs['Color'].default_value = (0.20, 0.17, 0.30, 1); bg.inputs['Strength'].default_value = 0.8
bpy.ops.object.light_add(type='SUN', rotation=(math.radians(82), 0, math.radians(-125)))
sun = bpy.context.active_object; sun.data.energy = 3.2; sun.data.color = (1.0, 0.62, 0.38); sun.data.angle = math.radians(3)

target = Vector((3.5 * G, 3.5 * G, 6))
bpy.ops.object.empty_add(location=target); tgt = bpy.context.active_object
bpy.ops.object.camera_add(location=(target.x - 150, target.y - 175, 150))
cam = bpy.context.active_object; sc.camera = cam
tc = cam.constraints.new('TRACK_TO'); tc.target = tgt; tc.track_axis = 'TRACK_NEGATIVE_Z'; tc.up_axis = 'UP_Y'
cam.data.lens = 85
cam.data.dof.use_dof = True; cam.data.dof.focus_object = tgt; cam.data.dof.aperture_fstop = 0.12

sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'
sc.cycles.samples = int(sys.argv[-2]) if sys.argv[-2].isdigit() else 48
sc.cycles.use_denoising = True
sc.render.resolution_x, sc.render.resolution_y = 1600, 900
sc.view_settings.view_transform = 'AgX'
sc.view_settings.look = 'AgX - Punchy'
sc.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print('wrote', OUT)
