"""Stylized asset pack for the Planet Globe web app (Blender 4.x / 5.x).

Run inside Blender (e.g. via Blender MCP):
    exec(open('/abs/path/tools/blender/build_assets.py').read(), globals())

Scene layout (saved to tools/blender/globe_assets.blend):
    GlobeAssets/                    root collection
      Nature/ Farm/ Settlement_Fantasy/ Settlement_Modern/ Infrastructure/ Vehicles/
        <asset>            Empty, one per asset, laid out on a grid per category
          <asset>_LOD0     mid-poly: more segments, bevelled edges, small extra details
          <asset>_LOD1     standard low-poly
          <asset>_LOD2     far stand-in (hand-made for trees, decimated otherwise)
    Materials: one flat palette library, named M_<colour>.

Conventions: Z-up, footprint radius ~1 = one hex tile, forward = +X for
vehicles and spans (walls, fences, bridges, crop rows are 1 unit along X).

Exports to public/models/:
    assets.glb       LOD1 + LOD2 (loaded first)
    assets_lod0.glb  LOD0 (streamed in afterwards)
Both ship without normals / UVs: the web app bakes material colours into
vertex colours and rebuilds faceted normals for its toon shading.
"""
import bpy, bmesh, math, os, random
from mathutils import Vector

ROOT = os.environ.get('GLOBE_ROOT', '/Users/mikelrisyad/Developer/globe')
OUT = os.path.join(ROOT, 'public', 'models')
BLEND = os.path.join(ROOT, 'tools', 'blender', 'globe_assets.blend')
os.makedirs(OUT, exist_ok=True)
rnd = random.Random(11)
Q = 1  # quality level being built: 0 = LOD0 (mid-poly), 1 = LOD1, 2 = LOD2

CATEGORY = {
    'Nature': ['tree_pine', 'tree_pine_snow', 'tree_round', 'bush', 'tree_palm', 'tree_acacia', 'cactus', 'rock',
               'rock_mesa', 'ice_block', 'grass_tuft', 'tree_round_b', 'tree_pine_b', 'bush_b', 'rock_b', 'reeds'],
    'Farm': ['barn', 'windmill', 'hay_bale', 'wheat_row', 'crop_row', 'fence_segment'],
    'Settlement_Fantasy': ['house_a', 'house_b', 'house_c', 'tower', 'castle', 'temple', 'wall_segment', 'wall_tower',
                           'dock', 'lighthouse'],
    'Settlement_Modern': ['tower_glass_a', 'tower_glass_b', 'apartment', 'modern_house', 'landmark_spire',
                          'container_stack', 'port_crane'],
    'Infrastructure': ['bridge', 'bridge_wood', 'bridge_stone', 'bridge_modern'],
    'Vehicles': ['boat', 'ship', 'caravan', 'truck', 'container_ship', 'airplane', 'balloon'],
}
CATEGORY_OF = {name: cat for cat, names in CATEGORY.items() for name in names}


# ------------------------------------------------------------------ scene reset
def reset_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in list(bpy.data.collections):
        bpy.data.collections.remove(coll)
    for store in (bpy.data.meshes, bpy.data.materials):
        for d in list(store):
            store.remove(d)


reset_scene()


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
    'glass': 0x6f9fc8, 'glass_dark': 0x3e5f80, 'concrete': 0xc9c7c1, 'asphalt': 0x55575c, 'steel': 0x9aa3ad,
    'white': 0xf2f2ee, 'c_red': 0xc4513a, 'c_blue': 0x3f6fb0, 'c_yellow': 0xe0b030, 'c_green': 0x3f8f5a,
    'balloon_a': 0xe0584a, 'balloon_b': 0xf2c14e, 'flower': 0xf19ec8, 'flower_y': 0xf5d547, 'reed': 0x6f9a3a,
    'cattail': 0x6b4426, 'moss': 0x6f8f4a, 'birch': 0xe9e4d8, 'poplar': 0x4f9a3e,
}
C = {}
for k, v in PALETTE.items():
    m = bpy.data.materials.new(f'M_{k}')
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*srgb(v), 1)
    b.inputs['Roughness'].default_value = 0.9
    m.diffuse_color = (*srgb(v), 1)  # viewport solid colour matches the palette
    C[k] = m


# ------------------------------------------------------------------ quality-aware primitives
def segs(v):
    """Radial segments: LOD0 gets ~1.6x, never fewer than v + 2."""
    return v if Q else max(v + 2, int(round(v * 1.6)))


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
    if Q == 0 and not bevel and min(size) > 0.03:
        bevel = min(0.012, min(size) * 0.12)  # LOD0: soften every hard edge a little
    if bevel:
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        mod = o.modifiers.new('bv', 'BEVEL')
        mod.width = bevel
        mod.segments = 2 if Q == 0 else 1
        bpy.ops.object.modifier_apply(modifier='bv')
    return o


def cyl(m, loc, r, d, v=10, r2=None, rot=(0, 0, 0), jitter=0.0):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=segs(v), radius=r, depth=d)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=segs(v), radius1=r, radius2=r2, depth=d)
    return finish(bpy.context.object, m, loc, rot, jitter=jitter)


def cone(m, loc, r, d, v=10, jitter=0.0, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cone_add(vertices=segs(v), radius1=r, radius2=0, depth=d)
    return finish(bpy.context.object, m, loc, rot, jitter=jitter)


def blob(m, loc, r, scale=(1, 1, 1), sub=1, jitter=0.0):
    sub = min(2, sub + (1 if Q == 0 and r >= 0.1 else 0))
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub, radius=r)
    return finish(bpy.context.object, m, loc, scale=scale, jitter=jitter)


def lowblob(m, loc, r, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=6, ring_count=4, radius=r)
    return finish(bpy.context.object, m, loc, scale=scale)


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


# ------------------------------------------------------------------ scene organisation
ROOT_COLL = bpy.data.collections.new('GlobeAssets')
bpy.context.scene.collection.children.link(ROOT_COLL)
CAT_COLL = {}
for i, cat in enumerate(CATEGORY):
    coll = bpy.data.collections.new(cat)
    ROOT_COLL.children.link(coll)
    CAT_COLL[cat] = coll
EMPTIES = {}
LODS = {0: {}, 1: {}, 2: {}}


def holder(name):
    """Empty that groups an asset's LODs, placed on its category's row."""
    if name in EMPTIES:
        return EMPTIES[name]
    cat = CATEGORY_OF.get(name, 'Nature')
    row = list(CATEGORY).index(cat)
    col = CATEGORY[cat].index(name) if name in CATEGORY[cat] else len(CATEGORY[cat])
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = 'PLAIN_AXES'
    e.empty_display_size = 0.3
    e.location = (col * 4.5, -row * 4.0, 0)
    CAT_COLL[cat].objects.link(e)
    EMPTIES[name] = e
    return e


def asset(name, objs):
    """Join parts into <name>_LOD<Q>, file it under its category and holder."""
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.object
    o.name = f'{name}_LOD{Q}'
    o.data.name = o.name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for p in o.data.polygons:
        p.use_smooth = False
    for coll in list(o.users_collection):
        coll.objects.unlink(o)
    e = holder(name)
    CAT_COLL[CATEGORY_OF.get(name, 'Nature')].objects.link(o)
    o.parent = e
    o.location = (Q * 1.4, 0, 0)  # LODs side by side under their holder
    LODS[Q][name] = o
    return o


def tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


# ------------------------------------------------------------------ asset definitions
def define_assets():
    # ------------------------------------------------------------------ nature
    def pine(snow=False):
        objs = [cyl('wood', (0, 0, 0.12), 0.06, 0.24, 7)]
        tiers = [(0.36, 0.42, 0.3), (0.29, 0.36, 0.52), (0.21, 0.32, 0.72), (0.12, 0.26, 0.9)]
        for i, (r, h, z) in enumerate(tiers):
            objs.append(cone('pine' if i % 2 == 0 else 'pine_dark', (0, 0, z), r, h, 9, jitter=0.012))
            if snow:
                objs.append(cone('snow', (0, 0, z + h * 0.22), r * 0.62, h * 0.55, 9, jitter=0.008))
        if Q == 0:  # mid-poly: a slim leader tip and a root flare
            objs.append(cone('pine_dark', (0, 0, 1.08), 0.06, 0.18, 7))
            objs.append(cyl('wood', (0, 0, 0.02), 0.09, 0.04, 8, r2=0.06))
        return objs


    asset('tree_pine', pine())
    asset('tree_pine_snow', pine(True))

    asset('tree_round', [
        cyl('wood', (0, 0, 0.16), 0.06, 0.32, 7, r2=0.045),
        blob('leaf', (0, 0, 0.55), 0.3, jitter=0.03),
        blob('leaf_dark', (0.16, 0.08, 0.44), 0.21, jitter=0.02),
        blob('leaf_light', (-0.13, -0.07, 0.68), 0.19, jitter=0.02),
    ] + ([blob('leaf', (0.1, -0.14, 0.62), 0.15, jitter=0.02), blob('leaf_dark', (-0.1, 0.14, 0.5), 0.14, jitter=0.02)] if Q == 0 else []))

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
        if Q == 0:  # mid-poly: windows on both long sides, a ridge beam and a doorstep
            for side in (-1, 1):
                for yy in (-d * 0.25, d * 0.25):
                    objs.append(box('glass_dark', (side * (w / 2 + 0.002), yy, h * 0.55), (0.012, 0.05, 0.05)))
            objs.append(box('timber', (0, 0, h + w * 0.64), (0.02, d * 1.1, 0.02)))
            objs.append(box('stone', (w / 2 + 0.02, 0.05, 0.008), (0.04, 0.09, 0.016)))
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

    # ------------------------------------------------------------------ nature variants
    asset('tree_round_b', [
        cyl('birch', (0, 0, 0.2), 0.045, 0.4, 6, r2=0.035),
        blob('poplar', (0, 0, 0.62), 0.2, (0.8, 0.8, 1.7), jitter=0.02),
        blob('leaf_light', (0.06, 0.03, 0.82), 0.13, (0.8, 0.8, 1.4), jitter=0.015),
    ])

    objs = [cyl('wood', (0, 0, 0.1), 0.04, 0.2, 6)]
    for i, (r, h, z) in enumerate([(0.24, 0.34, 0.26), (0.2, 0.3, 0.44), (0.16, 0.28, 0.62), (0.12, 0.26, 0.8), (0.07, 0.22, 0.98)]):
        objs.append(cone('pine_dark' if i % 2 else 'pine', (0, 0, z), r, h, 8, jitter=0.01))
    asset('tree_pine_b', objs)

    objs = [blob('leaf', (0, 0, 0.1), 0.15, (1, 1, 0.8), jitter=0.02), blob('leaf_dark', (0.12, -0.04, 0.08), 0.11, jitter=0.015)]
    for i in range(6):
        a = i / 6 * math.tau
        objs.append(blob('flower' if i % 2 else 'flower_y', (math.cos(a) * 0.12, math.sin(a) * 0.1, 0.17 + (i % 3) * 0.02), 0.025))
    asset('bush_b', objs)

    asset('rock_b', [
        blob('rock', (0, 0, 0.05), 0.24, (1.3, 0.9, 0.35), jitter=0.03),
        blob('moss', (0.02, 0.02, 0.1), 0.16, (1.2, 0.8, 0.25), jitter=0.02),
        blob('rock_dark', (0.24, -0.1, 0.05), 0.1, (1, 1, 0.7), jitter=0.02),
    ])

    objs = []
    for i in range(9):
        a = i / 9 * math.tau + rnd.uniform(0, 0.5)
        d = 0.04 + rnd.uniform(0, 0.12)
        x, y = math.cos(a) * d, math.sin(a) * d
        h = 0.22 + rnd.uniform(0, 0.14)
        objs.append(cone('reed' if i % 2 else 'grass', (x, y, h / 2), 0.018, h, 4,
                         rot=(rnd.uniform(-0.2, 0.2), rnd.uniform(-0.2, 0.2), 0)))
        if i % 3 == 0:
            objs.append(cyl('cattail', (x, y, h * 0.92), 0.018, 0.06, 6))
    asset('reeds', objs)

    # ------------------------------------------------------------------ bridges (span X -0.5..0.5)
    objs = [box('wood_light', (0, 0, 0.1), (1.0, 0.24, 0.035))]
    for i in range(10):
        objs.append(box('wood', (-0.45 + i * 0.1, 0, 0.12), (0.03, 0.25, 0.01)))
    for x in (-0.45, -0.15, 0.15, 0.45):
        for y in (-0.11, 0.11):
            objs.append(cyl('wood', (x, y, 0.1), 0.018, 0.24, 6))
    objs += [box('wood', (0, 0.11, 0.2), (1.0, 0.02, 0.02)), box('wood', (0, -0.11, 0.2), (1.0, 0.02, 0.02))]
    asset('bridge_wood', objs)

    objs = [box('stone', (0, 0, 0.2), (1.0, 0.3, 0.07), bevel=0.01)]
    for x in (-0.46, -0.16, 0.16, 0.46):
        objs.append(box('stone_dark', (x, 0, 0.09), (0.09, 0.32, 0.2)))
    for x in (-0.31, 0.0, 0.31):
        arch = cyl('stone', (x, 0, 0.13), 0.12, 0.3, 12, rot=(math.pi / 2, 0, 0))
        objs.append(arch)
    for i in range(12):
        objs.append(box('stone', (-0.46 + i * 0.084, 0.14, 0.26), (0.05, 0.03, 0.06)))
        objs.append(box('stone', (-0.46 + i * 0.084, -0.14, 0.26), (0.05, 0.03, 0.06)))
    asset('bridge_stone', objs)

    objs = [box('concrete', (0, 0, 0.16), (1.0, 0.26, 0.04))]
    for x in (-0.28, 0.28):
        objs.append(box('steel', (x, 0.13, 0.32), (0.04, 0.04, 0.5)))
        objs.append(box('steel', (x, -0.13, 0.32), (0.04, 0.04, 0.5)))
        objs.append(box('steel', (x, 0, 0.56), (0.04, 0.3, 0.04)))
        objs.append(box('concrete', (x, 0, 0.06), (0.08, 0.2, 0.14)))
    for side in (0.13, -0.13):
        for seg in ((-0.5, -0.28), (-0.28, 0.0), (0.0, 0.28), (0.28, 0.5)):
            x0, x1 = seg
            z0 = 0.56 if abs(x0) == 0.28 else 0.18
            z1 = 0.56 if abs(x1) == 0.28 else (0.3 if x1 == 0.0 else 0.18)
            L = math.hypot(x1 - x0, z1 - z0)
            c = box('steel', ((x0 + x1) / 2, side, (z0 + z1) / 2), (L, 0.012, 0.012))
            c.rotation_euler = (0, -math.atan2(z1 - z0, x1 - x0), 0)
            objs.append(c)
    objs.append(box('white', (0, 0, 0.183), (1.0, 0.012, 0.004)))
    asset('bridge_modern', objs)

    # ------------------------------------------------------------------ modern city
    def window_bands(x, y, w, d, z0, z1, step, m='glass_dark'):
        out = []
        z = z0 + step / 2
        while z < z1 - 0.01:
            out.append(box(m, (x, y, z), (w * 1.02, d * 1.02, step * 0.28)))
            z += step
        return out


    objs = [box('glass', (0, 0, 0.65), (0.3, 0.3, 1.3), bevel=0.01)]
    objs += window_bands(0, 0, 0.3, 0.3, 0.05, 1.3, 0.1)
    objs += [box('concrete', (0, 0, 1.33), (0.22, 0.22, 0.06)), box('steel', (0.05, 0.05, 1.4), (0.05, 0.05, 0.08))]
    asset('tower_glass_a', objs)

    objs = []
    for w, z0, z1 in ((0.38, 0, 0.5), (0.3, 0.5, 0.95), (0.2, 0.95, 1.3)):
        objs.append(box('concrete', (0, 0, (z0 + z1) / 2), (w, w, z1 - z0)))
        objs += window_bands(0, 0, w, w, z0, z1, 0.08, 'glass')
    objs.append(cyl('steel', (0, 0, 1.45), 0.012, 0.3, 5))
    asset('tower_glass_b', objs)

    objs = [box('white', (0, 0, 0.25), (0.46, 0.3, 0.5), bevel=0.01)]
    objs += window_bands(0, 0, 0.46, 0.3, 0.04, 0.5, 0.1, 'glass')
    objs.append(box('concrete', (0, 0, 0.52), (0.4, 0.24, 0.04)))
    asset('apartment', objs)

    asset('modern_house', [
        box('white', (0, 0, 0.1), (0.36, 0.28, 0.2), bevel=0.008),
        box('white', (0.06, 0.02, 0.26), (0.22, 0.2, 0.14), bevel=0.008),
        box('glass_dark', (0.18, 0, 0.1), (0.012, 0.18, 0.12)),
        box('asphalt', (0, 0, 0.205), (0.37, 0.29, 0.012)),
        box('leaf', (-0.14, -0.1, 0.03), (0.08, 0.08, 0.06)),
    ])

    objs = [cyl('concrete', (0, 0, 0.05), 0.22, 0.1, 12), cyl('white', (0, 0, 0.9), 0.06, 1.7, 10, r2=0.035)]
    objs += [blob('glass', (0, 0, 1.45), 0.13, (1, 1, 0.7), sub=2), cyl('steel', (0, 0, 1.9), 0.012, 0.5, 5)]
    for i in range(3):
        a = i / 3 * math.tau
        leg = cyl('white', (math.cos(a) * 0.1, math.sin(a) * 0.1, 0.4), 0.025, 0.8, 6)
        leg.rotation_euler = (math.sin(a) * 0.2, -math.cos(a) * 0.2, 0)
        objs.append(leg)
    asset('landmark_spire', objs)

    objs = []
    cols = ['c_red', 'c_blue', 'c_yellow', 'c_green']
    for i in range(3):
        for j in range(2):
            for k in range(2):
                objs.append(box(cols[(i + j * 2 + k) % 4], (-0.2 + i * 0.2, -0.06 + j * 0.12, 0.05 + k * 0.1), (0.19, 0.11, 0.095)))
    asset('container_stack', objs)

    objs = [box('c_yellow', (0, -0.12, 0.35), (0.04, 0.04, 0.7)), box('c_yellow', (0, 0.12, 0.35), (0.04, 0.04, 0.7)),
            box('c_yellow', (0.1, 0, 0.72), (0.7, 0.06, 0.06)), box('steel', (-0.18, 0, 0.66), (0.14, 0.16, 0.1)),
            box('steel', (0.3, 0, 0.6), (0.02, 0.02, 0.2)), box('concrete', (0, 0, 0.02), (0.16, 0.36, 0.04))]
    asset('port_crane', objs)

    # ------------------------------------------------------------------ modern vehicles (forward = +X)
    objs = [box('white', (0.24, 0, 0.13), (0.16, 0.2, 0.18), bevel=0.01), box('glass_dark', (0.325, 0, 0.17), (0.01, 0.17, 0.07)),
            box('c_blue', (-0.1, 0, 0.16), (0.46, 0.21, 0.2)), box('asphalt', (0.05, 0, 0.05), (0.7, 0.16, 0.03))]
    for x in (-0.25, -0.1, 0.25):
        for y in (-0.1, 0.1):
            objs.append(cyl('asphalt', (x, y, 0.045), 0.045, 0.03, 10, rot=(math.pi / 2, 0, 0)))
    asset('truck', objs)

    L, W, H = 1.2, 0.3, 0.16
    hull = [(-L / 2, -W / 2, H), (L / 2 - 0.12, -W / 2, H), (L / 2 + 0.06, 0, H), (L / 2 - 0.12, W / 2, H), (-L / 2, W / 2, H),
            (-L / 2 + 0.04, -W / 2 * 0.9, 0), (L / 2 - 0.16, -W / 2 * 0.9, 0), (L / 2 - 0.06, 0, 0.02), (L / 2 - 0.16, W / 2 * 0.9, 0), (-L / 2 + 0.04, W / 2 * 0.9, 0)]
    hf = [(0, 1, 2, 3, 4), (9, 8, 7, 6, 5), (0, 5, 6, 1), (1, 6, 7, 2), (2, 7, 8, 3), (3, 8, 9, 4), (4, 9, 5, 0)]
    objs = [mesh('asphalt', hull, hf), box('c_red', (0, 0, H + 0.005), (L - 0.1, W * 0.98, 0.01))]
    for i in range(6):
        for j in range(2):
            objs.append(box(cols[(i + j) % 4], (0.35 - i * 0.14, -0.065 + j * 0.13, H + 0.06), (0.13, 0.12, 0.1)))
            if i % 2 == 0:
                objs.append(box(cols[(i + j + 1) % 4], (0.35 - i * 0.14, -0.065 + j * 0.13, H + 0.16), (0.13, 0.12, 0.1)))
    objs += [box('white', (-0.5, 0, H + 0.12), (0.12, 0.26, 0.24)), box('glass_dark', (-0.44, 0, H + 0.2), (0.01, 0.24, 0.05))]
    asset('container_ship', objs)

    objs = [cyl('white', (0, 0, 0), 0.06, 0.9, 12, rot=(0, math.pi / 2, 0)),
            cone('white', (0.5, 0, 0), 0.06, 0.12, 12, rot=(0, math.pi / 2, 0)),
            cone('white', (-0.5, 0, 0.01), 0.06, 0.14, 12, rot=(0, -math.pi / 2, 0)),
            box('glass_dark', (0.46, 0, 0.035), (0.05, 0.08, 0.02)),
            mesh('steel', [(0.12, 0, 0), (-0.1, 0.55, 0.02), (-0.2, 0.55, 0.02), (-0.08, 0, 0)], [(0, 1, 2, 3)]),
            mesh('steel', [(0.12, 0, 0), (-0.08, 0, 0), (-0.2, -0.55, 0.02), (-0.1, -0.55, 0.02)], [(0, 1, 2, 3)]),
            mesh('c_red', [(-0.36, 0, 0.04), (-0.52, 0, 0.04), (-0.54, 0, 0.24), (-0.46, 0, 0.24)], [(0, 1, 2, 3)]),
            mesh('steel', [(-0.4, 0, 0.02), (-0.52, 0.2, 0.03), (-0.54, 0.2, 0.03), (-0.5, 0, 0.02)], [(0, 1, 2, 3)]),
            mesh('steel', [(-0.4, 0, 0.02), (-0.5, 0, 0.02), (-0.54, -0.2, 0.03), (-0.52, -0.2, 0.03)], [(0, 1, 2, 3)]),
            cyl('steel', (0.0, 0.24, -0.05), 0.03, 0.12, 8, rot=(0, math.pi / 2, 0)),
            cyl('steel', (0.0, -0.24, -0.05), 0.03, 0.12, 8, rot=(0, math.pi / 2, 0))]
    asset('airplane', objs)

    # ------------------------------------------------------------------ fantasy air (hot-air balloon)
    objs = [blob('balloon_a', (0, 0, 0.72), 0.36, (1, 1, 1.15), sub=2),
            cyl('balloon_b', (0, 0, 0.72), 0.37, 0.14, 16),
            cyl('balloon_b', (0, 0, 0.98), 0.29, 0.1, 16),
            cone('balloon_a', (0, 0, 0.36), 0.2, 0.2, 12, rot=(math.pi, 0, 0)),
            box('wood', (0, 0, 0.08), (0.14, 0.14, 0.1))]
    for x, y in ((-0.06, -0.06), (0.06, -0.06), (-0.06, 0.06), (0.06, 0.06)):
        objs.append(cyl('hull_dark', (x * 1.4, y * 1.4, 0.2), 0.004, 0.24, 4))
    asset('balloon', objs)

# ------------------------------------------------------------------ far stand-ins (hand-made LOD2)
def define_lod2_overrides():
    def pine_lod(snow=False):
        objs = [cone('pine', (0, 0, 0.38), 0.36, 0.62, 6), cone('pine_dark', (0, 0, 0.74), 0.24, 0.46, 6)]
        if snow:
            objs.append(cone('snow', (0, 0, 0.86), 0.16, 0.26, 6))
        return objs


    asset('tree_pine', pine_lod())
    asset('tree_pine_snow', pine_lod(True))
    asset('tree_round', [cyl('wood', (0, 0, 0.16), 0.06, 0.32, 4), lowblob('leaf', (0, 0, 0.55), 0.34)])
    objs = [cyl('wood', (0.06, 0, 0.4), 0.045, 0.8, 4)]
    for i in range(5):
        a = i / 5 * math.tau
        objs.append(mesh('palm', [(0, 0, 0), (math.cos(a) * 0.42 - math.sin(a) * 0.08, math.sin(a) * 0.42 + math.cos(a) * 0.08, -0.1),
                                  (math.cos(a) * 0.42 + math.sin(a) * 0.08, math.sin(a) * 0.42 - math.cos(a) * 0.08, -0.1)],
                         [(0, 1, 2)], (0.2, 0, 0.8)))
    asset('tree_palm', objs)


# ------------------------------------------------------------------ build
for q in (0, 1):
    Q = q
    rnd.seed(11)
    define_assets()

Q = 2
define_lod2_overrides()
# Everything else gets a decimated LOD2, unless it is already cheap
for name, src in LODS[1].items():
    if name in LODS[2] or tris(src) < 80:
        continue
    o = src.copy()
    o.data = src.data.copy()
    o.name = o.data.name = f'{name}_LOD2'
    CAT_COLL[CATEGORY_OF.get(name, 'Nature')].objects.link(o)
    o.parent = src.parent
    o.location = (2 * 1.4, 0, 0)
    mod = o.modifiers.new('decimate', 'DECIMATE')
    mod.ratio = 0.45
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.ops.object.modifier_apply(modifier='decimate')
    o.data.validate(clean_customdata=False)  # drop degenerate faces decimation can leave behind
    LODS[2][name] = o


# ------------------------------------------------------------------ export
def export(path, lod_levels):
    bpy.ops.object.select_all(action='DESELECT')
    for e in EMPTIES.values():
        e.select_set(True)
    for q in lod_levels:
        for o in LODS[q].values():
            o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True,
                              export_apply=True, export_texcoords=False, export_normals=False)
    return os.path.getsize(path)


sizes = {
    'assets.glb': export(f'{OUT}/assets.glb', (1, 2)),
    'assets_lod0.glb': export(f'{OUT}/assets_lod0.glb', (0,)),
}
bpy.ops.wm.save_as_mainfile(filepath=BLEND, copy=True)

result = {
    'assets': len(EMPTIES),
    'bytes': sizes,
    'tris': {name: [tris(LODS[q][name]) if name in LODS[q] else None for q in (0, 1, 2)] for name in EMPTIES},
}

