"""Generate the stylized low-poly asset pack for the globe.

Run inside Blender (e.g. via Blender MCP):
    exec(open('/abs/path/tools/blender/build_assets.py').read(), globals())

Every asset is modelled around the origin (Blender Z-up), sized so that a
footprint of radius ~1 equals one hex tile, then ALL assets are exported into
one GLB (public/models/assets.glb) as separate named nodes: one request,
no normals / UVs (the web app renders them with a flat-shaded toon material),
colors carried by flat materials and baked to vertex colors in the browser.
"""
import bpy, bmesh, math, os, random
from mathutils import Vector, Matrix

OUT = os.environ.get('GLOBE_MODELS_DIR', '/Users/mikelrisyad/Developer/globe/public/models')
os.makedirs(OUT, exist_ok=True)
rnd = random.Random(11)


def reset():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()
    for coll in (bpy.data.meshes, bpy.data.materials):
        for d in list(coll):
            if d.users == 0:
                coll.remove(d)


reset()
for m in list(bpy.data.materials):
    bpy.data.materials.remove(m)


def srgb(h):
    c = [((h >> s) & 255) / 255 for s in (16, 8, 0)]
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c)


PALETTE = {
    'wall': 0xf1e4c8, 'wall_b': 0xe2cfa6, 'timber': 0x6b4426, 'roof_red': 0xc4513a, 'roof_brown': 0x9a5a36,
    'roof_blue': 0x46679c, 'stone': 0xbdb6a8, 'stone_dark': 0x8b8377, 'wood': 0x8a5a33, 'wood_light': 0xb07a45,
    'leaf': 0x5aa845, 'leaf_dark': 0x3f8a3a, 'leaf_light': 0x7cc254, 'pine': 0x2f6e40, 'pine_dark': 0x245a34,
    'palm': 0x5fb34a, 'acacia': 0x6f9a3a, 'cactus': 0x5d9a48, 'rock': 0x9c958a, 'rock_dark': 0x736c63,
    'mesa': 0xb0643a, 'mesa_light': 0xcf8a52, 'mesa_dark': 0x8a4a2c, 'ice': 0xcfeaf5, 'ice_dark': 0x9fd3ea,
    'snow': 0xf6f9fc, 'grass': 0x7fb24a, 'wheat': 0xe8c14a, 'wheat_dark': 0xc99a2e, 'crop': 0x4f9a3a,
    'hay': 0xe3c16a, 'barn': 0xb5412f, 'trim': 0xf3eee4, 'sail': 0xf7f1e1, 'hull': 0x7a4a2a, 'hull_dark': 0x5a3520,
    'flag': 0xc4513a, 'gold': 0xf0bf45, 'door': 0x4a3020, 'water': 0x4cb6ee, 'canvas': 0xefe6cf, 'ox': 0x8e6b4d,
}
C = {}
for k, v in PALETTE.items():
    m = bpy.data.materials.new(k)
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*srgb(v), 1)
    b.inputs['Roughness'].default_value = 0.9
    C[k] = m


# ------------------------------------------------------------------ helpers
def finish(obj, m, loc=(0, 0, 0), rot=(0, 0, 0), scale=None, jitter=0.0):
    obj.location = loc
    obj.rotation_euler = rot
    if scale:
        obj.scale = scale
    obj.data.materials.clear()
    obj.data.materials.append(C[m])
    if jitter:
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        for v in bm.verts:
            v.co += Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))) * jitter
        bm.to_mesh(obj.data)
        bm.free()
    return obj


def box(m, loc, size, rz=0, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1)
    o = finish(bpy.context.object, m, loc, (0, 0, rz), size)
    if bevel:
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        mod = o.modifiers.new('bv', 'BEVEL')
        mod.width = bevel
        mod.segments = 1
        bpy.ops.object.modifier_apply(modifier='bv')
    return o


def cyl(m, loc, r, d, v=10, r2=None, rot=(0, 0, 0), jitter=0.0):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=v, radius=r, depth=d)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=v, radius1=r, radius2=r2, depth=d)
    return finish(bpy.context.object, m, loc, rot, jitter=jitter)


def cone(m, loc, r, d, v=10, jitter=0.0, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cone_add(vertices=v, radius1=r, radius2=0, depth=d)
    return finish(bpy.context.object, m, loc, rot, jitter=jitter)


def blob(m, loc, r, scale=(1, 1, 1), sub=1, jitter=0.0):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub, radius=r)
    return finish(bpy.context.object, m, loc, scale=scale, jitter=jitter)


def mesh(m, verts, faces, loc=(0, 0, 0), rz=0):
    me = bpy.data.meshes.new('mesh')
    me.from_pydata(verts, [], faces)
    me.update()
    o = bpy.data.objects.new('mesh', me)
    bpy.context.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = (0, 0, rz)
    o.data.materials.append(C[m])
    return o


def gable_roof(m, x, y, z, w, d, h, rz=0, over=1.18):
    hw, hd = w / 2 * over, d / 2 * 1.08
    vs = [(-hw, -hd, 0), (hw, -hd, 0), (0, -hd, h), (-hw, hd, 0), (hw, hd, 0), (0, hd, h)]
    fs = [(0, 1, 2), (5, 4, 3), (0, 2, 5, 3), (1, 4, 5, 2), (0, 3, 4, 1)]
    return mesh(m, vs, fs, (x, y, z), rz)


def crenellate(m, cx, cy, z, r, count, size):
    out = []
    for i in range(count):
        a = i / count * math.tau
        out.append(box(m, (cx + math.cos(a) * r, cy + math.sin(a) * r, z + size / 2), (size, size, size), a))
    return out


ASSETS = []


def asset(name, objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.object
    o.name = name
    o.data.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for p in o.data.polygons:
        p.use_smooth = False
    ASSETS.append(o)
    # park it aside so later assets don't join with it
    o.hide_set(True)
    return o


# ------------------------------------------------------------------ nature
def pine(snow=False):
    objs = [cyl('wood', (0, 0, 0.12), 0.06, 0.24, 7)]
    tiers = [(0.36, 0.42, 0.3), (0.29, 0.36, 0.52), (0.21, 0.32, 0.72), (0.12, 0.26, 0.9)]
    for i, (r, h, z) in enumerate(tiers):
        objs.append(cone('pine' if i % 2 == 0 else 'pine_dark', (0, 0, z), r, h, 9, jitter=0.012))
        if snow:
            objs.append(cone('snow', (0, 0, z + h * 0.22), r * 0.62, h * 0.55, 9, jitter=0.008))
    return objs


asset('tree_pine', pine())
asset('tree_pine_snow', pine(True))

asset('tree_round', [
    cyl('wood', (0, 0, 0.16), 0.06, 0.32, 7, r2=0.045),
    blob('leaf', (0, 0, 0.55), 0.3, jitter=0.03),
    blob('leaf_dark', (0.16, 0.08, 0.44), 0.21, jitter=0.02),
    blob('leaf_light', (-0.13, -0.07, 0.68), 0.19, jitter=0.02),
])

asset('bush', [
    blob('leaf_dark', (0, 0, 0.12), 0.18, (1, 1, 0.8), jitter=0.02),
    blob('leaf', (0.14, 0.05, 0.1), 0.13, (1, 1, 0.8), jitter=0.02),
    blob('leaf_light', (-0.1, 0.09, 0.14), 0.1, jitter=0.015),
])

# palm: curved trunk + drooping two-segment fronds
objs = []
for i in range(6):
    objs.append(cyl('wood' if i % 2 else 'wood_light', (i * i * 0.006, 0, 0.07 + i * 0.13), 0.05 - i * 0.004, 0.14, 7))
top = Vector((0.2, 0, 0.8))
for i in range(7):
    a = i / 7 * math.tau + 0.3
    d = Vector((math.cos(a), math.sin(a), 0))
    s = Vector((-d.y, d.x, 0))
    p0 = Vector((0, 0, 0))
    p1 = d * 0.2 + Vector((0, 0, 0.06))
    p2 = d * 0.42 + Vector((0, 0, -0.1))
    w1, w2 = 0.07, 0.02
    vs = [p0, p1 + s * w1, p2 + s * w2, p2 - s * w2, p1 - s * w1]
    objs.append(mesh('palm', [tuple(v) for v in vs], [(0, 1, 4), (1, 2, 3, 4)], tuple(top)))
objs.append(blob('hull', tuple(top + Vector((0, 0, -0.03))), 0.05))
asset('tree_palm', objs)

asset('tree_acacia', [
    cyl('wood', (0, 0, 0.22), 0.045, 0.44, 7, r2=0.035),
    cyl('wood', (0.08, 0, 0.5), 0.03, 0.22, 6, rot=(0, 0.6, 0)),
    cyl('wood', (-0.08, 0, 0.5), 0.03, 0.22, 6, rot=(0, -0.6, 0)),
    blob('acacia', (0.12, 0, 0.64), 0.26, (1.2, 1, 0.32), jitter=0.02),
    blob('leaf_dark', (-0.12, 0.04, 0.6), 0.22, (1.2, 1, 0.3), jitter=0.02),
])

asset('cactus', [
    cyl('cactus', (0, 0, 0.3), 0.08, 0.6, 8),
    blob('cactus', (0, 0, 0.6), 0.08, (1, 1, 0.8)),
    cyl('cactus', (0.15, 0, 0.36), 0.05, 0.22, 8),
    blob('cactus', (0.15, 0, 0.47), 0.05),
    box('cactus', (0.08, 0, 0.25), (0.14, 0.07, 0.07)),
    cyl('cactus', (-0.14, 0, 0.44), 0.045, 0.18, 8),
    blob('cactus', (-0.14, 0, 0.53), 0.045),
    box('cactus', (-0.07, 0, 0.36), (0.12, 0.06, 0.06)),
])

asset('rock', [
    blob('rock', (0, 0, 0.1), 0.22, (1, 0.85, 0.65), jitter=0.035),
    blob('rock_dark', (0.2, 0.08, 0.06), 0.12, (1, 1, 0.8), jitter=0.02),
    blob('rock', (-0.16, 0.12, 0.04), 0.08, jitter=0.015),
])

objs = []
for (x, y, r, h) in [(0, 0, 0.3, 0.62), (0.34, 0.14, 0.2, 0.42), (-0.28, 0.2, 0.17, 0.3), (0.1, -0.3, 0.14, 0.24)]:
    objs.append(cyl('mesa', (x, y, h / 2), r, h, 7, r2=r * 0.82, jitter=0.02))
    objs.append(cyl('mesa_light', (x, y, h + 0.015), r * 0.84, 0.03, 7))
    objs.append(cyl('mesa_dark', (x, y, 0.03), r * 1.08, 0.06, 7))
asset('rock_mesa', objs)

asset('ice_block', [
    box('ice', (0, 0, 0.18), (0.42, 0.36, 0.36), 0.2, bevel=0.03),
    box('ice_dark', (0.3, 0.12, 0.11), (0.24, 0.22, 0.22), 0.6, bevel=0.02),
    box('snow', (0, 0, 0.37), (0.4, 0.34, 0.04), 0.2),
])

objs = []
for i in range(5):
    a = i / 5 * math.tau
    x, y = math.cos(a) * 0.05, math.sin(a) * 0.05
    objs.append(cone('grass' if i % 2 else 'leaf', (x, y, 0.1), 0.03, 0.2 + (i % 3) * 0.05, 4,
                     rot=(math.cos(a) * 0.3, math.sin(a) * 0.3, 0)))
asset('grass_tuft', objs)


# ------------------------------------------------------------------ buildings
def cottage(roof, w=0.3, d=0.4, h=0.24, chimney=True, two_storey=False):
    objs = [box('wall', (0, 0, h / 2), (w, d, h), bevel=0.012)]
    if two_storey:
        objs.append(box('timber', (0, 0, h * 0.5), (w * 1.02, d * 1.02, 0.025)))
    objs.append(gable_roof(roof, 0, 0, h, w, d, w * 0.62))
    objs.append(box('door', (w / 2 + 0.003, 0.05, 0.06), (0.012, 0.07, 0.12)))
    objs.append(box('door', (w / 2 + 0.003, -0.1, h * 0.62), (0.012, 0.05, 0.05)))
    if chimney:
        objs.append(box('stone_dark', (-w * 0.2, d * 0.28, h + w * 0.42), (0.06, 0.06, 0.16)))
    return objs


asset('house_a', cottage('roof_red'))
asset('house_b', cottage('roof_brown', w=0.28, d=0.56, h=0.22))
asset('house_c', cottage('roof_blue', w=0.32, d=0.36, h=0.38, two_storey=True))


def tower(x=0, y=0, r=0.14, h=0.8, roof='roof_red', flag=True):
    objs = [cyl('stone', (x, y, h / 2), r, h, 12, r2=r * 0.9)]
    objs += crenellate('stone', x, y, h, r * 0.92, 8, r * 0.28)
    objs.append(cone(roof, (x, y, h + r * 1.2), r * 1.2, r * 2.2, 12))
    objs.append(box('door', (x + r * 0.95, y, 0.07), (0.02, 0.07, 0.14)))
    if flag:
        objs.append(cyl('wood', (x, y, h + r * 2.6), 0.008, 0.28, 5))
        objs.append(box('flag', (x + 0.06, y, h + r * 2.6 + 0.08), (0.11, 0.01, 0.07)))
    return objs


asset('tower', tower())

objs = [box('stone', (0, 0, 0.3), (0.56, 0.56, 0.6), bevel=0.015)]
for dx, dy in [(-.28, -.28), (.28, -.28), (-.28, .28), (.28, .28)]:
    objs += tower(dx, dy, 0.1, 0.78, 'roof_blue', flag=False)
objs += tower(0, 0, 0.16, 1.1, 'roof_red')
for i in range(6):
    objs.append(box('stone', (-0.2 + i * 0.08, 0.28, 0.63), (0.04, 0.04, 0.06)))
    objs.append(box('stone', (-0.2 + i * 0.08, -0.28, 0.63), (0.04, 0.04, 0.06)))
objs.append(box('door', (0.285, 0, 0.1), (0.02, 0.14, 0.2)))
asset('castle', objs)

objs = [box('wall', (0, 0, 0.18), (0.6, 0.3, 0.36), bevel=0.012),
        gable_roof('roof_red', 0, 0, 0.36, 0.3, 0.6, 0.2, rz=math.pi / 2),
        box('wall', (-0.24, 0, 0.36), (0.16, 0.16, 0.72)),
        cone('roof_blue', (-0.24, 0, 0.9), 0.13, 0.36, 4, rot=(0, 0, math.pi / 4)),
        box('door', (0.303, 0, 0.08), (0.012, 0.08, 0.16))]
asset('temple', objs)

# wall segment: unit length along X, centred
objs = [box('stone', (0, 0, 0.16), (1.0, 0.14, 0.32), bevel=0.01)]
for i in range(6):
    objs.append(box('stone', (-0.42 + i * 0.168, 0, 0.36), (0.08, 0.14, 0.08)))
asset('wall_segment', objs)
asset('wall_tower', tower(0, 0, 0.13, 0.5, 'roof_red', flag=False))

# fence: unit length along X
asset('fence_segment', [
    box('wood', (-0.48, 0, 0.09), (0.04, 0.04, 0.18)),
    box('wood', (0.0, 0, 0.09), (0.04, 0.04, 0.18)),
    box('wood_light', (0, 0, 0.13), (1.0, 0.025, 0.025)),
    box('wood_light', (0, 0, 0.07), (1.0, 0.025, 0.025)),
])

objs = [box('barn', (0, 0, 0.17), (0.42, 0.6, 0.34), bevel=0.01)]
hw, hd = 0.25, 0.32
vs = [(-hw, -hd, 0), (hw, -hd, 0), (hw * 0.6, -hd, 0.14), (0, -hd, 0.24), (-hw * 0.6, -hd, 0.14),
      (-hw, hd, 0), (hw, hd, 0), (hw * 0.6, hd, 0.14), (0, hd, 0.24), (-hw * 0.6, hd, 0.14)]
fs = [(0, 1, 2, 3, 4), (9, 8, 7, 6, 5), (1, 6, 7, 2), (2, 7, 8, 3), (3, 8, 9, 4), (4, 9, 5, 0), (0, 5, 6, 1)]
objs.append(mesh('roof_brown', vs, fs, (0, 0, 0.34)))
objs.append(box('trim', (0.213, 0, 0.12), (0.01, 0.2, 0.22)))
objs.append(box('barn', (0.216, 0, 0.12), (0.01, 0.16, 0.18)))
asset('barn', objs)

objs = [cyl('wall', (0, 0, 0.32), 0.16, 0.64, 10, r2=0.1), cone('roof_brown', (0, 0, 0.72), 0.13, 0.2, 10),
        box('door', (0.15, 0, 0.07), (0.02, 0.07, 0.14))]
for i in range(4):
    a = i / 4 * math.tau + 0.4
    blade = box('canvas', (0.13, 0, 0.64), (0.02, 0.07, 0.34))
    blade.location = (0.14, math.cos(a) * 0.17, 0.64 + math.sin(a) * 0.17)
    blade.rotation_euler = (a + math.pi / 2, 0, 0)
    objs.append(blade)
objs.append(cyl('wood', (0.14, 0, 0.64), 0.025, 0.04, 8, rot=(0, math.pi / 2, 0)))
asset('windmill', objs)

asset('hay_bale', [cyl('hay', (0, 0, 0.08), 0.08, 0.14, 10, rot=(math.pi / 2, 0, 0)),
                   cyl('wheat_dark', (0, 0, 0.08), 0.082, 0.02, 10, rot=(math.pi / 2, 0, 0))])

# crop rows: unit length along X
objs = [box('wheat_dark', (0, 0, 0.02), (1.0, 0.09, 0.04))]
for i in range(12):
    objs.append(cone('wheat', (-0.46 + i * 0.084, 0, 0.09), 0.05, 0.14, 5, jitter=0.006))
asset('wheat_row', objs)
objs = [box('hull_dark', (0, 0, 0.015), (1.0, 0.08, 0.03))]
for i in range(9):
    objs.append(blob('crop', (-0.44 + i * 0.11, 0, 0.05), 0.045, (1, 1, 0.8)))
asset('crop_row', objs)

# ------------------------------------------------------------------ water & routes
objs = [box('wood_light', (0.35, 0, 0.06), (0.7, 0.18, 0.03))]
for x in (0.05, 0.3, 0.55):
    for y in (-0.08, 0.08):
        objs.append(cyl('wood', (x, y, 0.0), 0.02, 0.14, 6))
objs += [box('wood', (0.6, 0.04, 0.11), (0.08, 0.08, 0.07)), box('wood_light', (0.5, -0.04, 0.1), (0.06, 0.06, 0.06))]
asset('dock', objs)

L, W, H = 0.5, 0.18, 0.08
hull = [(-L / 2, 0, H), (-L / 2 + 0.06, -W / 2, H), (L / 2 - 0.08, -W / 2, H), (L / 2 + 0.04, 0, H + 0.02),
        (L / 2 - 0.08, W / 2, H), (-L / 2 + 0.06, W / 2, H), (-L / 2 + 0.08, 0, 0), (L / 2 - 0.1, 0, 0)]
hull_f = [(0, 1, 2, 3, 4, 5), (1, 6, 7, 2), (4, 7, 6, 5), (0, 6, 1), (5, 6, 0), (2, 7, 3), (3, 7, 4)]
asset('boat', [mesh('hull', hull, hull_f), cyl('wood', (0, 0, 0.3), 0.01, 0.44, 5),
               mesh('sail', [(0.01, 0, 0.12), (0.01, 0, 0.5), (0.2, 0, 0.14)], [(0, 1, 2)])])

L, W, H = 0.96, 0.3, 0.18
hull = [(-L / 2, 0, H + 0.04), (-L / 2 + 0.12, -W / 2, H), (L / 2 - 0.1, -W / 2, H), (L / 2 + 0.1, 0, H + 0.06),
        (L / 2 - 0.1, W / 2, H), (-L / 2 + 0.12, W / 2, H), (-L / 2 + 0.14, 0, 0), (L / 2 - 0.18, 0, 0)]
objs = [mesh('hull', hull, hull_f), box('hull_dark', (-0.34, 0, H + 0.06), (0.2, 0.26, 0.12))]
for x, h in ((0.12, 0.72), (-0.16, 0.6)):
    objs.append(cyl('wood', (x, 0, h / 2 + 0.1), 0.016, h, 6))
    objs.append(box('sail', (x, 0, h * 0.62 + 0.1), (0.03, 0.4, h * 0.42)))
    objs.append(box('sail', (x, 0, h * 0.95 + 0.1), (0.025, 0.28, h * 0.18)))
objs.append(box('flag', (0.16, 0, 0.9), (0.08, 0.01, 0.05)))
asset('ship', objs)

objs = [box('wood', (0, 0, 0.14), (0.42, 0.24, 0.06))]
arch = cyl('canvas', (0, 0, 0.2), 0.13, 0.42, 12, rot=(0, math.pi / 2, 0))
objs.append(arch)
for x in (-0.13, 0.13):
    for y in (-0.14, 0.14):
        objs.append(cyl('hull_dark', (x, y, 0.07), 0.07, 0.03, 10, rot=(math.pi / 2, 0, 0)))
objs += [blob('ox', (0.4, 0, 0.14), 0.09, (1.4, 0.8, 0.8)), blob('ox', (0.5, 0, 0.18), 0.05)]
for x in (0.34, 0.46):
    for y in (-0.04, 0.04):
        objs.append(box('ox', (x, y, 0.05), (0.03, 0.03, 0.1)))
asset('caravan', objs)

# stone arch bridge: spans X from -0.5..0.5
objs = [box('stone', (0, 0, 0.14), (1.0, 0.26, 0.06), bevel=0.01),
        box('stone_dark', (-0.42, 0, 0.06), (0.16, 0.28, 0.12)), box('stone_dark', (0.42, 0, 0.06), (0.16, 0.28, 0.12))]
for i in range(9):
    objs.append(box('stone', (-0.4 + i * 0.1, 0.12, 0.2), (0.06, 0.03, 0.06)))
    objs.append(box('stone', (-0.4 + i * 0.1, -0.12, 0.2), (0.06, 0.03, 0.06)))
asset('bridge', objs)

objs = [cyl('stone_dark', (0, 0, 0.03), 0.3, 0.06, 8),
        cyl('wall', (0, 0, 0.36), 0.1, 0.6, 10, r2=0.07),
        box('roof_red', (0, 0, 0.3), (0.21, 0.21, 0.06)), box('roof_red', (0, 0, 0.5), (0.18, 0.18, 0.05)),
        cyl('gold', (0, 0, 0.72), 0.08, 0.1, 10), cone('roof_red', (0, 0, 0.84), 0.1, 0.14, 10)]
asset('lighthouse', objs)

# ------------------------------------------------------------------ far LODs
# Cheap stand-ins drawn when the camera is zoomed out (same silhouette, ~1/4 tris)
def lowblob(m, loc, r, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=6, ring_count=4, radius=r)
    return finish(bpy.context.object, m, loc, scale=scale)


def pine_lod(snow=False):
    objs = [cone('pine', (0, 0, 0.38), 0.36, 0.62, 6), cone('pine_dark', (0, 0, 0.74), 0.24, 0.46, 6)]
    if snow:
        objs.append(cone('snow', (0, 0, 0.86), 0.16, 0.26, 6))
    return objs


asset('tree_pine_lod', pine_lod())
asset('tree_pine_snow_lod', pine_lod(True))
asset('tree_round_lod', [cyl('wood', (0, 0, 0.16), 0.06, 0.32, 4), lowblob('leaf', (0, 0, 0.55), 0.34)])
objs = [cyl('wood', (0.06, 0, 0.4), 0.045, 0.8, 4)]
for i in range(5):
    a = i / 5 * math.tau
    objs.append(mesh('palm', [(0, 0, 0), (math.cos(a) * 0.42 - math.sin(a) * 0.08, math.sin(a) * 0.42 + math.cos(a) * 0.08, -0.1),
                              (math.cos(a) * 0.42 + math.sin(a) * 0.08, math.sin(a) * 0.42 - math.cos(a) * 0.08, -0.1)],
                     [(0, 1, 2)], (0.2, 0, 0.8)))
asset('tree_palm_lod', objs)

# ------------------------------------------------------------------ export
bpy.ops.object.select_all(action='DESELECT')
for o in ASSETS:
    o.hide_set(False)
    o.select_set(True)
bpy.ops.export_scene.gltf(filepath=f'{OUT}/assets.glb', export_format='GLB', use_selection=True,
                          export_apply=True, export_texcoords=False, export_normals=False)

result = {
    'assets': len(ASSETS),
    'tris': {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in ASSETS},
    'bytes': os.path.getsize(f'{OUT}/assets.glb'),
}
