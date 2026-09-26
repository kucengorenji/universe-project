"""Town + space asset packs for the Planet Globe web app (Blender 5.x).

Run inside Blender (Blender MCP, or headless):
    exec(open('/abs/path/tools/blender/build_town_space.py').read(), globals())

Same conventions as build_assets.py: each asset is an Empty named after it,
with children <name>_LOD0 / _LOD1 / _LOD2; materials come from one flat palette
(M_<colour>); packs ship without normals / UVs (the app bakes material colours
into vertex colours and rebuilds faceted normals for toon shading).

Town pack (public/models/town.glb):
    metre scale, origin at the base centre, FRONT = Blender -Y (three.js +Z).
    Spans (walls, palisades) are modelled SPAN_LEN metres long along X.
    Variants are separate assets named <asset>_v<k>.
Space pack (public/models/space.glb):
    ships (frigate, interceptor, freighter, cargo, patrol) and the planet
    rover, space units (a ship is about 1.5 long), nose = Blender -Y.
Also: furniture.glb (interiors, doors with the origin on the hinge),
character.glb (one rig, ten outfits with vertex colours, seven clips) and
public/textures/interior_atlas.jpg (4 x 4 tiles rendered from node materials).

Geometry is assembled with bmesh (no operators), so the script runs the same
through the MCP sandbox and in `blender --background`.
"""
import bpy, bmesh, math, os, random
from mathutils import Matrix, Vector

ROOT = os.environ.get('GLOBE_ROOT', '/Users/mikelrisyad/Developer/globe')
OUT = os.path.join(ROOT, 'public', 'models')
BLEND = os.path.join(ROOT, 'tools', 'blender', 'town_space_assets.blend')
os.makedirs(OUT, exist_ok=True)
rnd = random.Random(7)
Q = 0  # level being built: 0 = LOD0 (full detail), 1 = LOD1, 2 = LOD2
TAU = math.tau


# ------------------------------------------------------------------ scene reset (MCP-safe: no reload operators)
def reset_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in list(bpy.data.collections):
        bpy.data.collections.remove(coll)
    for store in (bpy.data.meshes, bpy.data.materials, bpy.data.armatures, bpy.data.actions):
        for d in list(store):
            store.remove(d)


reset_scene()


def srgb(h):
    c = [((h >> s) & 255) / 255 for s in (16, 8, 0)]
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c)


PALETTE = {
    # fantasy
    'plaster': 0xf1e4c8, 'plaster_b': 0xe8d6b0, 'plaster_c': 0xf4efe4, 'plaster_d': 0xe3c9a6,
    'timber': 0x5e3b22, 'timber_light': 0x7a5030, 'stone': 0xbdb6a8, 'stone_dark': 0x8b8377, 'stone_light': 0xd6d0c4,
    'roof_red': 0xc4513a, 'roof_red_dark': 0xa8412e, 'roof_brown': 0x9a5a36, 'roof_brown_dark': 0x7d4629,
    'roof_blue': 0x46679c, 'roof_blue_dark': 0x39557f, 'roof_slate': 0x5a6270, 'roof_slate_dark': 0x474e5a,
    'door': 0x4a3020, 'wood': 0x8a5a33, 'wood_light': 0xb07a45, 'glass': 0x3e5f80, 'glass_lit': 0xffd98a,
    'gold': 0xf0bf45, 'flag_green': 0x027b49, 'flag_red': 0xfa4d43, 'canvas': 0xefe6cf, 'canvas_red': 0xc4513a,
    'canvas_blue': 0x3f6fb0, 'canvas_green': 0x3f8f5a, 'canvas_yellow': 0xe0b030, 'flower': 0xf19ec8, 'leaf': 0x5aa845,
    'water': 0x3f79b8, 'iron': 0x3a3a3a, 'fire': 0xffb347, 'hay': 0xe3c16a,
    # modern
    'concrete': 0xc9c7c1, 'concrete_dark': 0x9d9b95, 'concrete_light': 0xe4e2dc, 'white': 0xf2f2ee,
    'glass_blue': 0x5f8fb8, 'glass_teal': 0x4f9aa0, 'glass_dark': 0x2f4a66, 'steel': 0x9aa3ad, 'steel_dark': 0x5d6066,
    'brick': 0xb45a3c, 'brick_dark': 0x8f4430, 'asphalt': 0x4f5157, 'rubber': 0x222222, 'accent_green': 0x027b49,
    'accent_red': 0xfa4d43, 'accent_yellow': 0xfbb833, 'car_red': 0xc4513a, 'car_blue': 0x3f6fb0, 'car_white': 0xf2f2ee,
    'car_black': 0x2f2f33, 'car_yellow': 0xe0b030, 'lamp': 0xfff3c4, 'grass': 0x7fb24a, 'wood_deck': 0x9a6a3e,
    # space
    'hull': 0xe9ecef, 'hull_b': 0xcfd4da, 'hull_dark': 0x3a4150, 'engine': 0x9fe8ff, 'cockpit': 0x7fd6ff,
    # character
    'skin': 0xf1c9a5, 'hair': 0x3b2a1e, 'shirt': 0x027b49, 'pants': 0x2f3240, 'boots': 0x3a2a1c, 'belt': 0x5a3b22,
    # nature
    'bark': 0x6b4a33, 'bark_dark': 0x4f3624, 'bark_birch': 0xece6da, 'bark_mark': 0x3a3430, 'leaf_a': 0x4f9a3e,
    'leaf_b': 0x3d8436, 'leaf_c': 0x6cb04a, 'leaf_birch': 0x86bf52, 'autumn_a': 0xd9822b, 'autumn_b': 0xc2552a,
    'autumn_c': 0xe6b23c, 'conifer_a': 0x2c6b43, 'conifer_b': 0x225838, 'cypress': 0x3a6e3c, 'palm_leaf': 0x5fae47,
    'palm_trunk': 0x9a7650, 'coconut': 0x6b4a2a, 'fruit_red': 0xd33b2c, 'blossom': 0xf3b6cf, 'rock_a': 0x9c958a,
    'rock_b': 0x80796f, 'rock_c': 0xb2aba0, 'moss_rock': 0x6f8f4a, 'flower_w': 0xf6f3ea, 'flower_p': 0xb57ad6,
    'snow': 0xf6f9fc, 'flower_y': 0xf5d547, 'c_red': 0xc4513a, 'c_blue': 0x3f6fb0, 'c_yellow': 0xe0b030, 'c_green': 0x3f8f5a,
    # vehicles
    'car_green': 0x3f8f5a, 'car_silver': 0xb9bec4, 'car_orange': 0xe07b2e, 'taxi': 0xf2c230, 'police_blue': 0x2f4f9a,
    'chrome': 0xd8dde2, 'tail': 0xd8312a, 'indicator': 0xf29a2e, 'horse_a': 0x7b5236, 'horse_b': 0x4e3524,
    'horse_c': 0xc9b79a, 'mane': 0x2b2019, 'harness': 0x3b2a1c,
    # interiors
    'fabric_a': 0x5f7fa8, 'fabric_b': 0xb0513f, 'fabric_c': 0x7f9a5a, 'linen': 0xf1ece0, 'pillow': 0xe8e2d4,
    'wood_dark': 0x5a3a24, 'wood_mid': 0x8a6040, 'wood_pale': 0xc49a6c, 'metal_white': 0xe8e8e4, 'screen': 0x1c2430,
    'screen_on': 0x6fb7ff, 'book_a': 0x8a3b2e, 'book_b': 0x2e5a8a, 'book_c': 0x3f7a4a, 'book_d': 0xc9a24a,
    'ceramic': 0xf4f1ea, 'lampshade': 0xf3e3b8, 'rug_a': 0xa8453a, 'rug_b': 0xd9c08a, 'pot': 0xb86a45,
    # people (outfits)
    'shirt_red': 0xfa4d43, 'shirt_blue': 0x3f6fb0, 'shirt_white': 0xf2f2ee, 'shirt_yellow': 0xe0b030,
    'suit': 0x2f3440, 'tie': 0xa83232, 'vest': 0xf28a2e, 'helmet': 0xf2c230, 'dress': 0x9a4f8f, 'tunic': 0x8a6a3e,
    'hood': 0x5a6b3e, 'armor': 0x9aa3ad, 'hair_blond': 0xd9b25c, 'hair_grey': 0xb8b8b4, 'hair_red': 0xa8502c,
    'skin_b': 0xd9a47a, 'skin_c': 0xa8714a, 'skin_d': 0x7a4c2e, 'jeans': 0x3b4e7a, 'skirt': 0x2f3f5f,
}
MAT_INDEX = {}
MATERIALS = []
for k, v in PALETTE.items():
    m = bpy.data.materials.new(f'M_{k}')
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*srgb(v), 1)
    b.inputs['Roughness'].default_value = 0.85
    m.diffuse_color = (*srgb(v), 1)
    MAT_INDEX[k] = len(MATERIALS)
    MATERIALS.append(m)


# ------------------------------------------------------------------ part accumulator
# Parts are collected as plain vertex / face lists with a material, then turned
# into one mesh per LOD. Transform order for every primitive: scale -> (bevel)
# -> rotate -> translate.
PARTS = []


def M(loc=(0, 0, 0), rz=0.0, rx=0.0, ry=0.0):
    return Matrix.Translation(Vector(loc)) @ Matrix.Rotation(rz, 4, 'Z') @ Matrix.Rotation(ry, 4, 'Y') @ Matrix.Rotation(rx, 4, 'X')


def _emit(bm, mat, matrix=None):
    if matrix is not None:
        bmesh.ops.transform(bm, matrix=matrix, verts=bm.verts)
    idx = {v: i for i, v in enumerate(bm.verts)}
    vs = [tuple(v.co) for v in bm.verts]
    fs = [[idx[v] for v in f.verts] for f in bm.faces]
    PARTS.append((vs, fs, MAT_INDEX[mat]))
    bm.free()


def box(mat, loc, size, rz=0.0, bevel=None, rx=0.0, ry=0.0):
    """Axis-aligned box of `size` centred at `loc`, optionally bevelled (LOD0 only)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    if bevel is None:
        bevel = min(0.06, min(size) * 0.18) if Q == 0 and min(size) > 0.08 else 0
    if bevel and Q == 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges) + list(bm.verts), offset=bevel, segments=1, affect='EDGES', profile=0.5)
    _emit(bm, mat, M(loc, rz, rx, ry))


def cyl(mat, loc, r, h, seg=12, r2=None, rz=0.0, rx=0.0, ry=0.0, cap=True):
    """Cylinder / frustum standing on `loc` (base centre) along its local Z."""
    bm = bmesh.new()
    seg = max(3, seg if Q == 0 else max(4, seg // 2) if Q == 1 else max(4, seg // 3))
    bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=h)
    bmesh.ops.translate(bm, vec=Vector((0, 0, h / 2)), verts=bm.verts)
    _emit(bm, mat, M(loc, rz, rx, ry))


def cone(mat, loc, r, h, seg=12, rz=0.0):
    cyl(mat, loc, r, h, seg, r2=0.0, rz=rz)


def sphere(mat, loc, r, scale=(1, 1, 1), sub=2):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=max(1, sub - (0 if Q == 0 else 1)), radius=r)
    bmesh.ops.scale(bm, vec=Vector(scale), verts=bm.verts)
    _emit(bm, mat, M(loc))


def poly(mat, verts, faces, loc=(0, 0, 0), rz=0.0):
    bm = bmesh.new()
    vs = [bm.verts.new(v) for v in verts]
    for f in faces:
        bm.faces.new([vs[i] for i in f])
    _emit(bm, mat, M(loc, rz))


def hull(mat, points, loc=(0, 0, 0), rz=0.0):
    """Convex hull of a point set: solid pieces (slanted slabs, wedges) with correct winding."""
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in points]
    res = bmesh.ops.convex_hull(bm, input=vs)
    for g in res.get('geom_interior', []) + res.get('geom_unused', []):
        if isinstance(g, bmesh.types.BMVert) and g.is_valid and not g.link_faces:
            bm.verts.remove(g)
    _emit(bm, mat, M(loc, rz))


def slab(mat, quad, th=0.18):
    """Thick plate under a quad of 4 top points."""
    hull(mat, [tuple(p) for p in quad] + [(p[0], p[1], p[2] - th) for p in quad])


def prism(mat, profile, length, loc=(0, 0, 0), rz=0.0):
    """Extrude a 2D profile [(y, z), ...] (in the YZ plane) along X, centred."""
    n = len(profile)
    hx = length / 2
    verts = [(-hx, y, z) for y, z in profile] + [(hx, y, z) for y, z in profile]
    faces = [list(range(n))[::-1], list(range(n, 2 * n))]
    for i in range(n):
        j = (i + 1) % n
        faces.append([i, j, n + j, n + i])
    poly(mat, verts, faces, loc, rz)


# ------------------------------------------------------------------ architectural pieces
def gable_roof(mat, dark, loc, w, d, pitch_h, over=0.45, ridge_x=True, tiles=True, rz=0.0):
    """Gable roof with real thickness. Ridge along X (eaves on the long sides) or along Y."""
    x0, y0, z0 = loc
    if not ridge_x:
        w, d = d, w
        rz += math.pi / 2
    run = d / 2 + over
    ang = math.atan2(pitch_h, d / 2)
    slope = run / math.cos(ang)
    th = 0.22
    for side in (-1, 1):
        # Each slab is hinged at the ridge and tilted down toward its eave
        cy = side * math.cos(ang) * slope / 2
        cz = pitch_h - math.sin(ang) * slope / 2
        rot = Matrix.Rotation(rz, 4, 'Z')
        c = rot @ Vector((0, cy, cz))
        # rotating about X by -ang lowers the +Y end (and +ang the -Y end)
        box(mat, (x0 + c.x, y0 + c.y, z0 + c.z + th / 2), (w + over * 2, slope, th), rz=rz, rx=-side * ang, bevel=0.03)
        if tiles and Q == 0:
            rows = max(3, int(slope / 0.9))
            for k in range(1, rows):
                t = k / rows
                py = side * math.cos(ang) * slope * t
                pz = pitch_h - math.sin(ang) * slope * t
                c = rot @ Vector((0, py, pz))
                box(dark, (x0 + c.x, y0 + c.y, z0 + c.z + th + 0.02), (w + over * 2 - 0.1, 0.12, 0.06), rz=rz, rx=-side * ang, bevel=0)
    # Ridge cap
    rot = Matrix.Rotation(rz, 4, 'Z')
    box(dark, (x0, y0, z0 + pitch_h + th + 0.05), (w + over * 2 + 0.1, 0.34, 0.2), rz=rz, bevel=0.04)
    # Gable walls (triangles) are the caller's job: see gable_ends()


def gable_ends(mat, loc, w, d, pitch_h, ridge_x=True, rz=0.0):
    x0, y0, z0 = loc
    if not ridge_x:
        w, d = d, w
        rz += math.pi / 2
    prof = [(-d / 2, 0), (d / 2, 0), (0, pitch_h)]
    prism(mat, prof, w - 0.02, (x0, y0, z0), rz)


def hip_roof(mat, loc, w, d, h, over=0.4):
    x0, y0, z0 = loc
    hw, hd = w / 2 + over, d / 2 + over
    r = min(hw, hd) * 0.55
    if hw >= hd:
        top = [(-hw + r * 1.2, 0, h), (hw - r * 1.2, 0, h)]
        verts = [(-hw, -hd, 0), (hw, -hd, 0), (hw, hd, 0), (-hw, hd, 0)] + top
        faces = [[0, 1, 5, 4], [1, 2, 5], [2, 3, 4, 5], [3, 0, 4], [3, 2, 1, 0]]
    else:
        top = [(0, -hd + r * 1.2, h), (0, hd - r * 1.2, h)]
        verts = [(-hw, -hd, 0), (hw, -hd, 0), (hw, hd, 0), (-hw, hd, 0)] + top
        faces = [[0, 1, 4], [1, 2, 5, 4], [2, 3, 5], [3, 0, 4, 5], [3, 2, 1, 0]]
    poly(mat, verts, faces, (x0, y0, z0))


def window(loc, facing, w=1.1, h=1.4, frame='timber', glass='glass', shutters=None, sill=True):
    """Window on a wall. facing: 0 front (-Y), 1 right (+X), 2 back (+Y), 3 left (-X)."""
    if Q == 2:
        return
    rz = [0, math.pi / 2, math.pi, -math.pi / 2][facing]
    x, y, z = loc
    rot = Matrix.Rotation(rz, 4, 'Z')

    def at(dx, dy, dz):
        v = rot @ Vector((dx, dy, dz))
        return (x + v.x, y + v.y, z + v.z)

    box(glass, at(0, -0.02, 0), (w, 0.1, h), rz=rz, bevel=0)
    if Q == 0:
        t = 0.12
        box(frame, at(0, -0.07, h / 2 + t / 2), (w + t * 2, 0.14, t), rz=rz, bevel=0)
        box(frame, at(-w / 2 - t / 2, -0.07, 0), (t, 0.14, h), rz=rz, bevel=0)
        box(frame, at(w / 2 + t / 2, -0.07, 0), (t, 0.14, h), rz=rz, bevel=0)
        box(frame, at(0, -0.07, 0), (w, 0.08, 0.06), rz=rz, bevel=0)  # transom
        box(frame, at(0, -0.07, 0), (0.06, 0.08, h), rz=rz, bevel=0)  # mullion
        if sill:
            box('stone_light', at(0, -0.12, -h / 2 - 0.06), (w + 0.3, 0.26, 0.1), rz=rz, bevel=0)
        if shutters:
            for s in (-1, 1):
                box(shutters, at(s * (w / 2 + 0.36), -0.1, 0), (0.5, 0.06, h), rz=rz, bevel=0)


def door(loc, facing, w=1.1, h=2.2, mat='door', frame='stone_light', arch=False):
    if Q == 2:
        return
    rz = [0, math.pi / 2, math.pi, -math.pi / 2][facing]
    x, y, z = loc
    rot = Matrix.Rotation(rz, 4, 'Z')

    def at(dx, dy, dz):
        v = rot @ Vector((dx, dy, dz))
        return (x + v.x, y + v.y, z + v.z)

    box(mat, at(0, -0.02, h / 2), (w, 0.12, h), rz=rz, bevel=0)
    if Q == 0:
        box(frame, at(0, -0.08, h + 0.08), (w + 0.36, 0.18, 0.16), rz=rz, bevel=0)
        box(frame, at(-w / 2 - 0.09, -0.08, h / 2), (0.18, 0.18, h), rz=rz, bevel=0)
        box(frame, at(w / 2 + 0.09, -0.08, h / 2), (0.18, 0.18, h), rz=rz, bevel=0)
        box('stone_dark', at(0, -0.35, 0.08), (w + 0.5, 0.6, 0.16), rz=rz, bevel=0.02)  # step
        box('gold', at(w * 0.3, -0.1, h * 0.48), (0.08, 0.06, 0.08), rz=rz, bevel=0)  # handle
        if arch:
            cyl(frame, at(0, -0.08, h), w / 2 + 0.18, 0.18, 10, rx=math.pi / 2, rz=rz)


def timber_frame(w, d, z0, floors, fh, facing_sides=(0, 1, 2, 3), braces=True):
    """Dark beams on plastered walls: sills, floor lines, corner posts, diagonal braces."""
    if Q == 2:
        return
    t = 0.18
    top = z0 + floors * fh
    for f in range(floors + 1):
        z = z0 + f * fh
        box('timber', (0, -d / 2 - 0.04, z), (w + 0.1, t, t), bevel=0)
        box('timber', (0, d / 2 + 0.04, z), (w + 0.1, t, t), bevel=0)
        box('timber', (-w / 2 - 0.04, 0, z), (t, d + 0.1, t), bevel=0)
        box('timber', (w / 2 + 0.04, 0, z), (t, d + 0.1, t), bevel=0)
    for sx in (-1, 1):
        for sy in (-1, 1):
            box('timber', (sx * (w / 2 + 0.04), sy * (d / 2 + 0.04), (z0 + top) / 2), (t, t, top - z0), bevel=0)
    if Q == 0 and braces:
        # Short corner braces, clear of the windows
        run = 0.75
        ang = math.atan2(fh * 0.55, run)
        L = math.hypot(fh * 0.55, run)
        for f in range(floors):
            zc = z0 + f * fh + fh * 0.3
            for sx in (-1, 1):
                for y in (-d / 2 - 0.05, d / 2 + 0.05):
                    box('timber', (sx * (w / 2 - run / 2 - 0.05), y, zc), (0.13, 0.12, L), ry=-sx * (math.pi / 2 - ang), bevel=0)


def chimney(loc, h=1.6, mat='stone_dark'):
    x, y, z = loc
    box(mat, (x, y, z + h / 2), (0.7, 0.7, h))
    if Q == 0:
        box('stone', (x, y, z + h + 0.08), (0.9, 0.9, 0.16), bevel=0.02)


# ------------------------------------------------------------------ scene organisation
ROOT_COLL = bpy.data.collections.new('TownSpaceAssets')
bpy.context.scene.collection.children.link(ROOT_COLL)
COLLS = {}
EMPTIES = {}
LODS = {0: {}, 1: {}, 2: {}}
GRID = {}


def coll(name):
    if name not in COLLS:
        c = bpy.data.collections.new(name)
        ROOT_COLL.children.link(c)
        COLLS[name] = c
    return COLLS[name]


def holder(name, cat):
    if name in EMPTIES:
        return EMPTIES[name]
    row = list(COLLS).index(cat) if cat in COLLS else len(COLLS)
    col = GRID.get(cat, 0)
    GRID[cat] = col + 1
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = 'PLAIN_AXES'
    e.location = (col * 60, -row * 70, 0)
    coll(cat).objects.link(e)
    EMPTIES[name] = e
    return e


def asset(name, cat, build):
    """Build one asset at the current Q into <name>_LOD<Q> under its holder."""
    PARTS.clear()
    build()
    verts, faces, mats = [], [], []
    for vs, fs, mi in PARTS:
        base = len(verts)
        verts.extend(vs)
        for f in fs:
            faces.append([i + base for i in f])
            mats.append(mi)
    me = bpy.data.meshes.new(f'{name}_LOD{Q}')
    me.from_pydata(verts, [], faces)
    used = sorted(set(mats))
    for mi in used:
        me.materials.append(MATERIALS[mi])
    remap = {mi: k for k, mi in enumerate(used)}
    for p, mi in zip(me.polygons, mats):
        p.material_index = remap[mi]
        p.use_smooth = False
    me.validate(clean_customdata=False)
    me.update()
    o = bpy.data.objects.new(me.name, me)
    coll(cat).objects.link(o)
    e = holder(name, cat)
    o.parent = e
    o.location = (0, Q * 45 if cat != 'Space' else Q * 3, 0)
    LODS[Q][name] = o
    return o


def tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


# ================================================================== FANTASY TOWN
ROOFS = [('roof_red', 'roof_red_dark'), ('roof_brown', 'roof_brown_dark'), ('roof_blue', 'roof_blue_dark'), ('roof_slate', 'roof_slate_dark')]
WALLS = ['plaster', 'plaster_b', 'plaster_c', 'plaster_d']
SHUTTERS = ['canvas_green', 'canvas_blue', 'canvas_red', 'wood']


def front_windows(w, y, z, n, skip=None, facing=0, **kw):
    """n windows spread across a wall of width w (skipping index `skip`)."""
    if n <= 0:
        return
    step = w / n
    for i in range(n):
        if i == skip:
            continue
        x = -w / 2 + step * (i + 0.5)
        if facing == 0:
            window((x, y, z), 0, **kw)
        else:
            window((x, y, z), 2, **kw)


def side_windows(d, x, z, n, facing, **kw):
    step = d / n
    for i in range(n):
        y = -d / 2 + step * (i + 0.5)
        window((x, y, z), facing, **kw)


def fantasy_house(w, d, floors, v, jetty=0.0, ridge_x=True, dormer=False, lean_to=False, ground='plaster', kind='house'):
    roof, roof_dark = ROOFS[v % 4]
    wall = WALLS[(v + 1) % 4]
    shut = SHUTTERS[v % 4] if v % 3 != 2 else None
    fh = 2.9
    base = 0.45
    box('stone_dark', (0, 0, base / 2), (w + 0.3, d + 0.3, base))
    box(ground if ground != 'plaster' else wall, (0, 0, base + fh / 2), (w, d, fh))
    uw, ud, uy = w, d, 0.0
    if floors > 1:
        uw, ud, uy = w + jetty * 0.5, d + jetty, -jetty / 2 * 0  # jetty overhangs front and back
        for f in range(1, floors):
            box(wall, (0, 0, base + fh * f + fh / 2), (uw, ud, fh))
            if jetty and Q == 0:
                # Joist ends under the overhang
                for k in range(int(uw / 0.8)):
                    x = -uw / 2 + 0.4 + k * 0.8
                    box('timber', (x, -ud / 2 + jetty / 2, base + fh * f - 0.1), (0.16, jetty + 0.1, 0.2), bevel=0)
    top = base + fh * floors
    pitch = (ud / 2 if ridge_x else uw / 2) * (0.95 + (v % 3) * 0.12)
    gable_ends(wall, (0, uy, top), uw, ud, pitch, ridge_x)
    gable_roof(roof, roof_dark, (0, uy, top), uw, ud, pitch, 0.5, ridge_x)
    if kind != 'shop' or floors > 1:
        timber_frame(uw if floors > 1 else w, ud if floors > 1 else d, base + (fh if ground != 'plaster' else 0), floors - (1 if ground != 'plaster' else 0), fh)
    # Door on the front, windows around it
    n = max(1, int((w - 0.6) / 2.2))
    door_i = n // 2
    door((-w / 2 + (w / n) * (door_i + 0.5), -d / 2, base), 0, frame='timber' if ground == 'plaster' else 'stone_light')
    front_windows(w, -d / 2, base + 1.55, n, skip=door_i, shutters=shut, frame='timber')
    front_windows(w, d / 2, base + 1.55, n, facing=2, frame='timber')
    for f in range(1, floors):
        nu = max(1, int((uw - 0.6) / 2.0))
        front_windows(uw, -ud / 2, base + fh * f + 1.5, nu, shutters=shut, frame='timber')
        front_windows(uw, ud / 2, base + fh * f + 1.5, nu, facing=2, frame='timber')
    if d > 5.5:
        for f in range(floors):
            ww, dd = (w, d) if f == 0 else (uw, ud)
            side_windows(dd, ww / 2, base + fh * f + 1.5, 1 if dd < 8 else 2, 1, frame='timber')
            side_windows(dd, -ww / 2, base + fh * f + 1.5, 1 if dd < 8 else 2, 3, frame='timber')
    chimney((uw * 0.28, ud * 0.12, top + pitch * 0.35), 1.4 + pitch * 0.5)
    if dormer and Q < 2:
        dz = top + pitch * 0.35
        box(wall, (0, -ud / 4, dz + 0.7), (1.8, 1.6, 1.4))
        gable_roof(roof, roof_dark, (0, -ud / 4, dz + 1.4), 1.8, 1.6, 0.8, 0.2, ridge_x=False, tiles=False)
        window((0, -ud / 4 - 0.8, dz + 0.8), 0, w=0.8, h=0.9, frame='timber', sill=False)
    if lean_to and Q < 2:
        lw = 2.4
        box('wood', (w / 2 + lw / 2, d * 0.1, base + 1.1), (lw, d * 0.6, 2.2))
        slab(roof, [(w / 2, -d * 0.25, base + 2.6), (w / 2 + lw + 0.3, -d * 0.25, base + 2.0), (w / 2 + lw + 0.3, d * 0.45, base + 2.0), (w / 2, d * 0.45, base + 2.6)])
    if Q == 0:
        # Flower boxes, a lantern by the door, a bench
        for x in (-w * 0.3, w * 0.3):
            if abs(x - (-w / 2 + (w / n) * (door_i + 0.5))) > 1.2:
                box('wood', (x, -d / 2 - 0.25, base + 0.7), (1.2, 0.3, 0.3), bevel=0.02)
                for k in range(4):
                    sphere('flower' if k % 2 else 'leaf', (x - 0.45 + k * 0.3, -d / 2 - 0.25, base + 0.92), 0.13, sub=1)
        dx = -w / 2 + (w / n) * (door_i + 0.5)
        box('iron', (dx + 0.95, -d / 2 - 0.2, base + 2.5), (0.22, 0.22, 0.34), bevel=0)
        box('glass_lit', (dx + 0.95, -d / 2 - 0.2, base + 2.5), (0.16, 0.24, 0.24), bevel=0)


def f_house_small(v):
    fantasy_house(6.2, 5.6, 1, v, ridge_x=v % 2 == 0, lean_to=v == 1, dormer=v == 2)


def f_house(v):
    fantasy_house(7.6, 6.6, 2, v, jetty=0.0 if v == 0 else 0.5, ridge_x=v != 1, dormer=v == 2)


def f_house_tall(v):
    fantasy_house(7.0, 7.4, 3, v + 1, jetty=0.6, ridge_x=False)


def f_townhouse(v):
    fantasy_house(6.0, 9.4, 3, v + 2, jetty=0.4, ridge_x=False, dormer=True)


def f_shop(v):
    fantasy_house(8.0, 7.4, 2, v + 3, jetty=0.5, ground='stone', kind='shop')
    if Q < 2:
        # Striped awning over the shop window and a counter with goods
        cols = ['canvas_red', 'canvas'] if v == 0 else ['canvas_blue', 'canvas']
        for k in range(8 if Q == 0 else 1):
            box(cols[k % 2] if Q == 0 else cols[0], (-3 + k * 0.75 if Q == 0 else 0, -3.7 - 0.9, 3.0), (0.75 if Q == 0 else 6, 1.9, 0.08), rx=-0.35, bevel=0)
        box('wood', (1.6, -4.3, 1.0), (2.6, 0.8, 0.9))
        if Q == 0:
            for k in range(6):
                sphere(['canvas_red', 'canvas_yellow', 'leaf'][k % 3], (0.6 + k * 0.4, -4.3, 1.55), 0.16, sub=1)
            # Hanging sign
            box('iron', (-3.2, -4.3, 3.6), (0.08, 1.2, 0.08), bevel=0)
            box('wood_light', (-3.2, -4.7, 3.1), (0.1, 0.8, 0.6), bevel=0.02)


def f_tavern(v):
    fantasy_house(11.6, 8.6, 2, 1, jetty=0.5, ridge_x=True, dormer=True, ground='stone')
    if Q < 2:
        box('wood', (0, -4.3 - 1.2, 2.9), (6.0, 2.4, 0.2))  # porch roof
        for x in (-2.8, 2.8):
            box('timber', (x, -4.3 - 2.2, 1.5), (0.22, 0.22, 3.0), bevel=0)
        if Q == 0:
            box('iron', (4.8, -4.6, 3.9), (0.08, 1.5, 0.08), bevel=0)
            box('wood_light', (4.8, -5.1, 3.3), (0.12, 1.0, 0.8), bevel=0.03)
            box('gold', (4.8, -5.2, 3.3), (0.14, 0.5, 0.4), bevel=0)
            for k in range(3):
                cyl('wood', (-4.8 + k * 0.75, -5.0, 0), 0.32, 0.9, 10)
                cyl('iron', (-4.8 + k * 0.75, -5.0, 0.62), 0.335, 0.06, 10)
            box('wood', (2.0, -5.3, 0.45), (1.6, 0.6, 0.12))  # bench
            box('wood', (2.0, -5.3, 0.22), (1.5, 0.08, 0.44))


def crenels(cx, cy, z, length, axis, mat='stone', size=0.7, gap=None):
    """Merlons along a wall top (axis 'x' or 'y')."""
    if Q == 2:
        return
    gap = gap or size * (1.0 if Q == 0 else 2.2)
    n = max(1, int(length / (size + gap)))
    step = length / n
    for i in range(n):
        o = -length / 2 + step * (i + 0.5)
        loc = (cx + o, cy, z + size * 0.55) if axis == 'x' else (cx, cy + o, z + size * 0.55)
        box(mat, loc, (size, 0.5, size * 1.1) if axis == 'x' else (0.5, size, size * 1.1))


def round_tower(x, y, r, h, roof='roof_blue', crenel=True, flag=None, windows=3):
    cyl('stone', (x, y, 0), r, h, 20)
    if Q == 0:
        cyl('stone_dark', (x, y, 0), r + 0.25, 1.2, 20)
        cyl('stone_dark', (x, y, h - 0.6), r + 0.35, 0.6, 20)
    if roof:
        crenel = False  # a roof sits on the wall head: no battlements under it
        if Q == 0:
            cyl('timber', (x, y, h - 0.1), r + 0.15, 0.3, 20)
    if crenel and Q < 2:
        n = 12 if Q == 0 else 6
        for i in range(n):
            a = i / n * TAU
            box('stone', (x + math.cos(a) * (r + 0.1), y + math.sin(a) * (r + 0.1), h + 0.35), (0.7, 0.55, 0.8), rz=a)
    if roof:
        cone(roof, (x, y, h + (0.2 if crenel else 0)), r + 0.6, r * 2.1, 20)
        if flag and Q < 2:
            cyl('iron', (x, y, h + r * 2.1), 0.05, 2.2, 6)
            box(flag, (x + 0.55, y, h + r * 2.1 + 1.8), (1.0, 0.05, 0.6), bevel=0)
    for k in range(windows):
        a = k / max(1, windows) * TAU + 0.3
        if Q < 2:
            box('glass', (x + math.cos(a) * (r - 0.05), y + math.sin(a) * (r - 0.05), h * (0.45 + 0.15 * (k % 2))), (0.3, 0.3, 1.2), rz=a, bevel=0)


def f_castle(v):
    S = 21.0  # curtain wall half size
    wh = 10.0
    box('stone_light', (0, 0, 0.1), (S * 2, S * 2, 0.2), bevel=0)  # courtyard
    for side in range(4):
        rz = side * math.pi / 2
        rot = Matrix.Rotation(rz, 4, 'Z')
        if side == 0:
            # Front wall is split by the gatehouse
            for sx in (-1, 1):
                c = Vector((sx * (S / 2 + 3.2), -S, wh / 2))
                box('stone', tuple(c), (S - 6.4, 2.2, wh))
                crenels(c.x, c.y - 0.85, wh, S - 6.4, 'x')
                crenels(c.x, c.y + 0.85, wh, S - 6.4, 'x')
        else:
            c = rot @ Vector((0, -S, wh / 2))
            box('stone', tuple(c), (S * 2, 2.2, wh), rz=rz)
            if Q < 2:
                n = 16 if Q == 0 else 8
                for i in range(n):
                    o = -S + (i + 0.5) * (2 * S / n)
                    for off in (-0.85, 0.85):
                        p = rot @ Vector((o, -S + off, wh + 0.4))
                        box('stone', tuple(p), (0.8, 0.5, 0.9), rz=rz)
    for sx in (-1, 1):
        for sy in (-1, 1):
            round_tower(sx * S, sy * S, 3.8, 15.5, roof='roof_blue', flag='flag_green', windows=3)
    # Gatehouse: two towers and a lintel over the arch
    for sx in (-1, 1):
        box('stone', (sx * 3.4, -S - 0.6, 7.0), (3.6, 5.0, 14.0))
        crenels(sx * 3.4, -S - 3.1, 14.0, 3.6, 'x')
        if Q < 2:
            box('glass', (sx * 3.4, -S - 3.12, 9.5), (0.5, 0.1, 1.6), bevel=0)
    box('stone', (0, -S - 0.6, 10.5), (3.2, 5.0, 7.0))
    box('timber', (0, -S - 1.0, 3.0), (3.2, 0.4, 6.0), bevel=0)  # gate doors
    if Q == 0:
        for k in range(5):
            box('iron', (-1.3 + k * 0.65, -S - 1.25, 3.0), (0.08, 0.1, 6.0), bevel=0)
        box('stone_dark', (0, -S - 3.15, 6.4), (3.6, 0.3, 0.5), bevel=0)
    # Keep with turrets
    kh = 24.0
    box('stone', (0, 4, kh / 2), (16, 16, kh))
    if Q == 0:
        for z in (6, 12, 18):
            box('stone_dark', (0, 4, z), (16.4, 16.4, 0.4), bevel=0)
    for side in range(4):
        for k in range(3):
            for z in (8.0, 14.0, 20.0):
                rz = side * math.pi / 2
                rot = Matrix.Rotation(rz, 4, 'Z')
                p = rot @ Vector((-5 + k * 5, -8, z)) + Vector((0, 4, 0))
                window(tuple(p), side, w=1.0, h=2.0, frame='stone_dark', sill=True)
    crenels(0, 4 - 7.75, kh, 16, 'x')
    crenels(0, 4 + 7.75, kh, 16, 'x')
    crenels(-7.75, 4, kh, 16, 'y')
    crenels(7.75, 4, kh, 16, 'y')
    for sx in (-1, 1):
        for sy in (-1, 1):
            round_tower(sx * 8, 4 + sy * 8, 2.0, kh + 5, roof='roof_blue', crenel=False, flag='flag_green' if sx == sy else None, windows=2)
    # Great hall roof inside the keep's crown
    hip_roof('roof_slate', (0, 4, kh), 12, 12, 5.5, over=0.0)
    if Q < 2:
        # Banners on the keep front
        for x in (-4.5, 4.5):
            box('flag_green', (x, 4 - 8.15, 15), (1.8, 0.1, 5.0), bevel=0)
            if Q == 0:
                box('gold', (x, 4 - 8.22, 15.5), (0.8, 0.06, 0.8), bevel=0)


def f_temple(v):
    # Nave (long along Y), aisles, apse, bell tower at the front
    L, W = 20.0, 9.0
    box('stone_dark', (0, 1.5, 0.3), (W + 5, L + 1, 0.6))
    box('stone_light', (0, 1.5, 0.6 + 5.5), (W, L, 11.0))
    gable_ends('stone_light', (0, 1.5, 11.6), W, L, 5.0, ridge_x=False)
    gable_roof('roof_red', 'roof_red_dark', (0, 1.5, 11.6), W, L, 5.0, 0.5, ridge_x=False)
    for sx in (-1, 1):
        box('stone', (sx * (W / 2 + 1.8), 1.5, 0.6 + 3.2), (3.6, L - 2, 6.4))
        slab('roof_red', [(sx * W / 2, 1.5 - (L - 2) / 2, 8.6), (sx * (W / 2 + 3.9), 1.5 - (L - 2) / 2, 6.6), (sx * (W / 2 + 3.9), 1.5 + (L - 2) / 2, 6.6), (sx * W / 2, 1.5 + (L - 2) / 2, 8.6)], 0.25)
        for k in range(5):
            y = 1.5 - L / 2 + 3 + k * 3.6
            window((sx * (W / 2 + 3.6), y, 3.6), 1 if sx > 0 else 3, w=1.0, h=2.6, frame='stone_dark', glass='glass')
            window((sx * W / 2, y, 8.8), 1 if sx > 0 else 3, w=1.0, h=2.2, frame='stone_dark')
            if Q == 0:
                box('stone', (sx * (W / 2 + 3.7), y + 1.8, 3.2), (0.8, 0.8, 6.4), bevel=0.05)  # buttress
    cyl('stone_light', (0, 1.5 + L / 2, 0.6), 4.4, 9.0, 20)  # apse
    cone('roof_red', (0, 1.5 + L / 2, 9.6), 4.9, 3.6, 20)
    # Bell tower
    tw = 5.4
    box('stone_light', (0, -L / 2 + 0.5, 0.6 + 9.5), (tw, tw, 19.0))
    if Q == 0:
        for z in (6.6, 12.6, 18.4):
            box('stone', (0, -L / 2 + 0.5, z), (tw + 0.3, tw + 0.3, 0.35), bevel=0)
    for side in range(4):
        rot = Matrix.Rotation(side * math.pi / 2, 4, 'Z')
        p = rot @ Vector((0, -tw / 2, 16.5)) + Vector((0, -L / 2 + 0.5, 0))
        window(tuple(p), side, w=1.4, h=2.6, frame='stone', glass='iron', sill=False)
    cone('roof_slate', (0, -L / 2 + 0.5, 19.6), tw * 0.8, 8.0, 4, rz=math.pi / 4)
    if Q < 2:
        cyl('gold', (0, -L / 2 + 0.5, 27.4), 0.08, 1.8, 6)
        box('gold', (0, -L / 2 + 0.5, 28.6), (0.9, 0.12, 0.12), bevel=0)
    door((0, -L / 2 + 0.5 - tw / 2, 0.6), 0, w=2.2, h=3.6, mat='door', frame='stone')
    if Q < 2:
        cyl('stone', (0, -L / 2 + 0.5 - tw / 2 - 0.1, 6.2), 1.2, 0.2, 16, rx=math.pi / 2)  # rose window frame
        cyl('glass_blue', (0, -L / 2 + 0.5 - tw / 2 - 0.2, 6.2), 0.95, 0.12, 16, rx=math.pi / 2)


def f_tower(v):
    round_tower(0, 0, 3.6, 16.0, roof='roof_red', flag='flag_red', windows=4)
    door((0, -3.6, 0), 0, w=1.2, h=2.4)


def f_wall_tower(v):
    round_tower(0, 0, 3.0, 12.0, roof='roof_blue' if v == 0 else None, flag=None, windows=2)


SPAN_WALL = 8.0
SPAN_PALISADE = 3.0


def f_wall(v):
    L = SPAN_WALL
    box('stone', (0, 0, 3.5), (L, 1.8, 7.0))
    if Q == 0:
        box('stone_dark', (0, 0, 0.4), (L + 0.02, 2.1, 0.8), bevel=0)
        for k in range(3):
            box('stone_dark', (-L / 2 + 1.2 + k * 2.8, -0.92, 2.2 + (k % 2) * 1.8), (1.1, 0.08, 0.5), bevel=0)
    crenels(0, -0.65, 7.0, L, 'x')
    crenels(0, 0.65, 7.0, L, 'x')


def f_palisade(v):
    L = SPAN_PALISADE
    n = 6 if Q == 0 else 4 if Q == 1 else 2
    for k in range(n):
        x = -L / 2 + (k + 0.5) * L / n
        h = 2.8 + ((k * 7) % 3) * 0.15
        cyl('wood', (x, 0, 0), 0.22 if Q else 0.24, h, 7)
        cone('wood_light', (x, 0, h), 0.24, 0.5, 7)
    box('timber', (0, -0.3, 1.9), (L, 0.16, 0.24), bevel=0)


def f_gate(v):
    for sx in (-1, 1):
        box('stone', (sx * 4.4, 0, 7.5), (3.8, 5.6, 15.0))
        crenels(sx * 4.4, -2.55, 15.0, 3.8, 'x')
        crenels(sx * 4.4, 2.55, 15.0, 3.8, 'x')
        cone('roof_blue', (sx * 4.4, 0, 15.2), 3.1, 4.5, 4, rz=math.pi / 4)
        window((sx * 4.4, -2.8, 10.0), 0, w=0.6, h=1.6, frame='stone_dark', sill=False)
    box('stone', (0, 0, 11.0), (5.0, 5.2, 4.0))
    crenels(0, -2.35, 13.0, 5.0, 'x')
    if Q < 2:
        box('stone_dark', (0, -2.65, 9.2), (5.2, 0.3, 0.5), bevel=0)
        box('flag_green', (0, -2.7, 11.2), (1.6, 0.08, 2.6), bevel=0)


def f_well(v):
    cyl('stone', (0, 0, 0), 1.45, 0.95, 18)
    cyl('water', (0, 0, 0), 1.1, 0.8, 18)
    if Q == 0:
        cyl('stone_dark', (0, 0, 0.95), 1.55, 0.14, 18)
    for sx in (-1, 1):
        box('timber', (sx * 1.25, 0, 1.6), (0.2, 0.2, 2.4), bevel=0)
    box('timber', (0, 0, 2.55), (2.8, 0.16, 0.16), bevel=0)
    gable_roof('roof_red', 'roof_red_dark', (0, 0, 2.7), 2.6, 1.6, 0.9, 0.25, ridge_x=True, tiles=False)
    if Q == 0:
        cyl('wood', (0.3, 0, 1.6), 0.18, 0.35, 8)
        cyl('iron', (0.3, 0, 1.95), 0.012, 0.6, 4)


def f_market_stall(v):
    cols = [('canvas_red', 'canvas'), ('canvas_blue', 'canvas'), ('canvas_green', 'canvas_yellow')][v % 3]
    box('wood', (0, 0, 0.5), (3.4, 2.0, 1.0))
    for sx in (-1, 1):
        for sy in (-1, 1):
            box('timber', (sx * 1.6, sy * 0.95, 1.35), (0.14, 0.14, 2.7), bevel=0)
    stripes = 6 if Q == 0 else 1
    for k in range(stripes):
        w = 3.8 / stripes
        box(cols[k % 2] if Q == 0 else cols[0], (-1.9 + w * (k + 0.5), 0, 2.75), (w, 2.6, 0.1), rx=0.18, bevel=0)
    if Q == 0:
        for k in range(8):
            box(['hay', 'canvas_red', 'leaf', 'wood_light'][k % 4], (-1.3 + (k % 4) * 0.85, -0.45 + (k // 4) * 0.7, 1.12), (0.55, 0.5, 0.24), bevel=0.03)
        for k in range(5):
            sphere(['canvas_red', 'canvas_yellow', 'leaf'][k % 3], (-1.2 + k * 0.6, -0.5, 1.35), 0.14, sub=1)


def f_lamp(v):
    cyl('timber', (0, 0, 0), 0.12, 3.2, 8, r2=0.09)
    box('iron', (0, -0.3, 3.0), (0.08, 0.6, 0.08), bevel=0)
    box('iron', (0, -0.55, 2.7), (0.36, 0.36, 0.5), bevel=0)
    box('glass_lit', (0, -0.55, 2.7), (0.28, 0.4, 0.38), bevel=0)
    if Q == 0:
        cone('iron', (0, -0.55, 2.95), 0.3, 0.3, 4, rz=math.pi / 4)


def f_dock(v):
    # Pier running out from the shore (origin) toward the front (-Y)
    L, W = 22.0, 4.0
    planks = 22 if Q == 0 else 1
    if Q == 0:
        for k in range(planks):
            box('wood_deck', (0, -(k + 0.5) * (L / planks), 0.9), (W, L / planks - 0.08, 0.16), bevel=0)
    else:
        box('wood_deck', (0, -L / 2, 0.9), (W, L, 0.16), bevel=0)
    for k in range(8 if Q < 2 else 3):
        y = -1 - k * (L - 2) / (7 if Q < 2 else 2)
        for sx in (-1, 1):
            cyl('timber', (sx * (W / 2 - 0.2), y, -3.0), 0.2, 4.2, 8)
    if Q == 0:
        for k in range(4):
            cyl('timber', (W / 2 - 0.2, -3 - k * 5.5, 0.9), 0.18, 0.7, 8)
        box('wood', (0, -L + 0.3, 1.3), (W, 0.2, 0.6), bevel=0)


FANTASY = {
    'f_house_small': (f_house_small, 3), 'f_house': (f_house, 3), 'f_house_tall': (f_house_tall, 2),
    'f_townhouse': (f_townhouse, 2), 'f_shop': (f_shop, 2), 'f_tavern': (f_tavern, 1), 'f_castle': (f_castle, 1),
    'f_temple': (f_temple, 1), 'f_tower': (f_tower, 1), 'f_wall_tower': (f_wall_tower, 1), 'f_wall': (f_wall, 1),
    'f_palisade': (f_palisade, 1), 'f_gate': (f_gate, 1), 'f_well': (f_well, 1), 'f_market_stall': (f_market_stall, 3),
    'f_lamp': (f_lamp, 1), 'f_dock': (f_dock, 1),
}


# ================================================================== MODERN TOWN
def glass_band(w, d, z, h, mat='glass_blue', inset=0.06, sides=(0, 1, 2, 3)):
    """Continuous ribbon window around a floor."""
    if Q == 2:
        return
    for side in sides:
        if side in (0, 2):
            box(mat, (0, (-1 if side == 0 else 1) * (d / 2 + 0.01 - inset), z), (w - 0.6, 0.12, h), bevel=0)
        else:
            box(mat, ((1 if side == 1 else -1) * (w / 2 + 0.01 - inset), 0, z), (0.12, d - 0.6, h), bevel=0)


def mullions(w, d, z0, z1, step, mat='steel_dark'):
    if Q != 0:
        return
    h = z1 - z0
    for side in (0, 2):
        y = (-1 if side == 0 else 1) * (d / 2 + 0.05)
        n = int(w / step)
        for k in range(1, n):
            box(mat, (-w / 2 + k * w / n, y, (z0 + z1) / 2), (0.1, 0.1, h), bevel=0)
    for side in (1, 3):
        x = (1 if side == 1 else -1) * (w / 2 + 0.05)
        n = int(d / step)
        for k in range(1, n):
            box(mat, (x, -d / 2 + k * d / n, (z0 + z1) / 2), (0.1, 0.1, h), bevel=0)


def roof_kit(w, d, z, rng):
    """Parapet, HVAC boxes and a stair core on a flat roof."""
    if Q == 2:
        return
    t = 0.3
    box('concrete_dark', (0, -d / 2 + t / 2, z + 0.5), (w, t, 1.0), bevel=0)
    box('concrete_dark', (0, d / 2 - t / 2, z + 0.5), (w, t, 1.0), bevel=0)
    box('concrete_dark', (-w / 2 + t / 2, 0, z + 0.5), (t, d, 1.0), bevel=0)
    box('concrete_dark', (w / 2 - t / 2, 0, z + 0.5), (t, d, 1.0), bevel=0)
    if Q == 0:
        for k in range(2 + int(rng.random() * 3)):
            bx = (rng.random() - 0.5) * (w - 4)
            by = (rng.random() - 0.5) * (d - 4)
            box('steel', (bx, by, z + 0.7), (1.6 + rng.random(), 1.2 + rng.random(), 1.4))
        box('concrete', (w * 0.2, d * 0.15, z + 1.4), (3.0, 3.0, 2.8))


def m_house(v):
    rng = random.Random(100 + v)
    wall = ['white', 'concrete_light', 'brick'][v % 3]
    accent = ['wood_deck', 'steel_dark', 'concrete_dark'][v % 3]
    # Two offset volumes: ground floor and a cantilevered upper floor
    box('concrete_dark', (0, 0, 0.15), (12.4, 10.4, 0.3), bevel=0)
    box(wall, (-1.0, 0.5, 0.3 + 1.6), (9.6, 8.6, 3.2))
    box(accent, (1.0, -0.3, 3.5 + 1.5), (9.6, 8.8, 3.0))
    box('concrete', (1.0, -0.3, 6.6), (10.0, 9.2, 0.25), bevel=0.05)
    box('concrete', (-1.0, 0.5, 3.55), (10.0, 9.0, 0.2), bevel=0.05)
    # Garage
    box('concrete_light', (4.6, 1.8, 1.5), (3.2, 6.0, 3.0))
    if Q < 2:
        box('steel', (4.6, -1.24, 1.25), (2.6, 0.1, 2.3), bevel=0)
        if Q == 0:
            for k in range(5):
                box('steel_dark', (4.6, -1.3, 0.3 + k * 0.45), (2.6, 0.06, 0.05), bevel=0)
    # Big glazing
    window((-2.0, -3.8, 1.9), 0, w=4.6, h=2.4, frame='steel_dark', glass='glass_dark', sill=False)
    window((1.0, -4.7, 5.0), 0, w=6.5, h=2.0, frame='steel_dark', glass='glass_blue', sill=False)
    window((-5.8, 0.5, 1.9), 3, w=3.0, h=2.0, frame='steel_dark', glass='glass_dark', sill=False)
    window((1.0, 4.1, 5.0), 2, w=5.0, h=1.8, frame='steel_dark', glass='glass_blue', sill=False)
    door((-5.0, -3.75, 0.3), 0, w=1.2, h=2.4, mat='wood', frame='steel_dark')
    if Q == 0:
        box('concrete', (-5.0, -4.6, 2.95), (2.4, 1.8, 0.15), bevel=0)  # entrance canopy
        for k in range(6):  # solar panels
            box('glass_dark', (-1.5 + (k % 3) * 2.2, 1.5 + (k // 3) * 1.8, 6.95), (2.0, 1.6, 0.08), rx=0.25, bevel=0)
        for k in range(8):  # hedge
            sphere('leaf', (-5.6 + k * 1.1, -5.4, 0.55), 0.6, (1, 1, 0.8), sub=1)


def m_shop(v):
    rng = random.Random(200 + v)
    wall = ['brick', 'white', 'concrete_light'][v % 3]
    awn = ['accent_red', 'accent_green', 'accent_yellow'][v % 3]
    floors = 2 + v
    box(wall, (0, 0, (floors * 3.3) / 2), (13.4, 9.6, floors * 3.3))
    # Shopfront: full-height glass in a steel frame
    box('glass_dark', (0, -4.82, 1.7), (11.0, 0.12, 2.8), bevel=0)
    if Q == 0:
        for k in range(1, 5):
            box('steel_dark', (-5.5 + k * 2.2, -4.9, 1.7), (0.12, 0.12, 2.9), bevel=0)
        box('steel_dark', (0, -4.9, 3.15), (11.3, 0.14, 0.14), bevel=0)
    door((4.4, -4.8, 0), 0, w=1.6, h=2.6, mat='glass_teal', frame='steel_dark')
    # Awning and sign
    if Q < 2:
        box(awn, (0, -5.6, 3.35), (11.6, 1.8, 0.12), rx=0.2, bevel=0)
        box('white', (0, -4.9, 3.9), (8.0, 0.2, 0.9), bevel=0.04)
        if Q == 0:
            box(awn, (0, -5.0, 3.9), (6.4, 0.08, 0.5), bevel=0)
    for f in range(1, floors):
        z = f * 3.3 + 1.6
        for k in range(4):
            window((-4.8 + k * 3.2, -4.8, z), 0, w=1.6, h=1.7, frame='white', glass='glass_blue')
    box('concrete_dark', (0, 0, floors * 3.3 + 0.35), (13.8, 10.0, 0.7), bevel=0.05)
    roof_kit(13.4, 9.6, floors * 3.3, rng)


def m_apartment(v):
    rng = random.Random(300 + v)
    floors = 6 + v * 2
    fh = 3.1
    H = floors * fh
    wall = ['concrete_light', 'brick', 'white'][v % 3]
    box('concrete_dark', (0, 0, 1.6), (19.6, 15.6, 3.2))
    box(wall, (0, 0, 3.2 + (H - fh) / 2), (19.0, 15.0, H - fh))
    glass_band(19.6, 15.6, 1.6, 2.4, 'glass_dark')
    door((0, -7.85, 0), 0, w=2.4, h=2.6, mat='glass_teal', frame='steel_dark')
    for f in range(1, floors):
        z = f * fh + 1.55
        for k in range(5):
            x = -7.6 + k * 3.8
            window((x, -7.5, z), 0, w=1.8, h=1.6, frame='white', glass='glass_blue', sill=False)
            window((x, 7.5, z), 2, w=1.8, h=1.6, frame='white', glass='glass_blue', sill=False)
            # Balconies on alternating bays
            if Q < 2 and (k + f) % 2 == 0:
                box('concrete', (x, -8.3, f * fh + 0.1), (3.0, 1.6, 0.2), bevel=0)
                if Q == 0:
                    box('glass_teal', (x, -9.05, f * fh + 0.65), (3.0, 0.08, 0.9), bevel=0)
                    box('steel', (x, -9.05, f * fh + 1.1), (3.0, 0.1, 0.08), bevel=0)
        for k in range(4):
            window((9.5, -5.4 + k * 3.6, z), 1, w=1.4, h=1.5, frame='white', glass='glass_blue', sill=False)
            window((-9.5, -5.4 + k * 3.6, z), 3, w=1.4, h=1.5, frame='white', glass='glass_blue', sill=False)
    box('concrete_dark', (0, 0, H + 0.2), (19.4, 15.4, 0.4), bevel=0)
    roof_kit(19.0, 15.0, H + 0.4, rng)


def m_office(v):
    rng = random.Random(400 + v)
    floors = 10 + v * 3
    fh = 3.6
    H = floors * fh
    glass = ['glass_blue', 'glass_teal'][v % 2]
    box('concrete_dark', (0, 0, 2.2), (21.6, 21.6, 4.4))
    box('glass_dark', (0, -10.85, 2.0), (16, 0.1, 3.6), bevel=0)
    # Core + glass skin with spandrel bands per floor
    box(glass, (0, 0, 4.4 + (H - 4.4) / 2), (20.4, 20.4, H - 4.4), bevel=0)
    if Q < 2:
        step = 1 if Q == 0 else 3
        for f in range(2, floors + 1, step):
            box('concrete_light', (0, 0, f * fh - 0.1), (20.8, 20.8, 0.45 if Q == 0 else 0.8), bevel=0)
        mullions(20.4, 20.4, 4.4, H, 2.55)
    # Setback crown
    box('concrete_light', (0, 0, H + 1.6), (15, 15, 3.2))
    box(glass, (0, 0, H + 1.6), (15.2, 15.2, 2.0), bevel=0)
    roof_kit(15, 15, H + 3.2, rng)
    door((0, -10.8, 0), 0, w=3.2, h=3.2, mat='glass_teal', frame='steel')
    if Q == 0:
        box('concrete', (0, -12.2, 4.3), (8, 3, 0.25), bevel=0)  # canopy
        for x in (-3.5, 3.5):
            cyl('steel', (x, -13.4, 0), 0.15, 4.3, 8)


def m_tower_a(v):
    rng = random.Random(500)
    fh = 3.5
    tiers = [(28.0, 0, 18), (23.0, 18, 26), (17.0, 26, 31)]
    for w, f0, f1 in tiers:
        z0, z1 = f0 * fh, f1 * fh
        box('glass_blue', (0, 0, (z0 + z1) / 2), (w, w, z1 - z0), bevel=0)
        if Q < 2:
            step = 2 if Q == 0 else 6
            for f in range(f0 + 1, f1 + 1, step):
                box('steel', (0, 0, f * fh), (w + 0.3, w + 0.3, 0.35), bevel=0)
            if Q == 0:
                # Vertical fins on the corners and mid-faces
                for sx in (-1, 0, 1):
                    for sy in (-1, 1):
                        box('steel', (sx * w / 2.05, sy * (w / 2 + 0.25), (z0 + z1) / 2), (0.35, 0.5, z1 - z0), bevel=0)
                        box('steel', (sy * (w / 2 + 0.25), sx * w / 2.05, (z0 + z1) / 2), (0.5, 0.35, z1 - z0), bevel=0)
        box('concrete_light', (0, 0, z1 + 0.4), (w + 0.6, w + 0.6, 0.8), bevel=0.05)
    top = 31 * fh + 0.8
    box('concrete', (0, 0, top + 2.0), (8, 8, 4))
    cyl('steel', (0, 0, top + 4.0), 0.6, 22, 8, r2=0.15)
    if Q < 2:
        sphere('accent_red', (0, 0, top + 26.2), 0.6, sub=1)
    box('concrete_dark', (0, 0, 2.5), (30, 30, 5))
    box('glass_dark', (0, -15.05, 2.5), (20, 0.1, 4), bevel=0)
    door((0, -15.0, 0), 0, w=4.0, h=3.6, mat='glass_teal', frame='steel')


def m_tower_b(v):
    fh = 3.5
    floors = 26
    r = 13.5
    cyl('concrete_dark', (0, 0, 0), r + 1.2, 5.0, 24)
    cyl('glass_teal', (0, 0, 5.0), r, floors * fh - 5.0, 28)
    if Q < 2:
        step = 2 if Q == 0 else 6
        for f in range(2, floors + 1, step):
            cyl('white', (0, 0, f * fh - 0.2), r + 0.35, 0.4, 28)
    # Stepped crown and a lit beacon
    cyl('white', (0, 0, floors * fh), r * 0.8, 3.0, 24)
    cyl('glass_teal', (0, 0, floors * fh + 3.0), r * 0.62, 6.0, 20)
    cyl('white', (0, 0, floors * fh + 9.0), r * 0.5, 1.0, 20)
    cone('steel', (0, 0, floors * fh + 10.0), r * 0.35, 12, 12)
    door((0, -r - 1.2, 0), 0, w=4.0, h=3.4, mat='glass_teal', frame='steel')


def m_spire(v):
    # Civic landmark: stepped plaza base, a slender lattice-like tower with a pod and needle
    box('concrete_light', (0, 0, 0.3), (22, 22, 0.6), bevel=0.05)
    box('concrete', (0, 0, 0.8), (17, 17, 0.4), bevel=0.05)
    cyl('water', (0, -7.0, 0.6), 2.2, 0.3, 20)
    if Q == 0:
        cyl('concrete', (0, -7.0, 0.6), 2.5, 0.45, 20)
        for k in range(6):
            a = k / 6 * TAU
            cyl('glass_teal', (math.cos(a) * 1.2, -7.0 + math.sin(a) * 1.2, 0.8), 0.08, 1.2, 6)
    # Tapering shaft from four legs merging into one
    for sx in (-1, 1):
        for sy in (-1, 1):
            hull('steel', [(sx * 5.5, sy * 5.5, 1.0), (sx * 4.3, sy * 5.5, 1.0), (sx * 5.5, sy * 4.3, 1.0), (sx * 4.3, sy * 4.3, 1.0),
                           (sx * 1.6, sy * 1.6, 34), (sx * 1.0, sy * 1.6, 34), (sx * 1.6, sy * 1.0, 34), (sx * 1.0, sy * 1.0, 34)])
    if Q < 2:
        for z in (10, 20, 30):
            k = 1 - (z - 1) / 33 * 0.72
            box('white', (0, 0, z), (11 * k, 11 * k, 0.5), bevel=0)
    box('steel', (0, 0, 34 + 15), (3.2, 3.2, 30))
    cyl('white', (0, 0, 60), 5.2, 1.0, 24)
    cyl('glass_blue', (0, 0, 61), 5.0, 4.0, 24)
    cyl('white', (0, 0, 65), 5.4, 1.2, 24, r2=4.0)
    cyl('steel', (0, 0, 66.2), 0.9, 6, 12)
    cone('white', (0, 0, 72.2), 0.9, 16, 12)
    if Q == 0:
        for k in range(4):
            a = k / 4 * TAU + math.pi / 4
            box('accent_green', (math.cos(a) * 7.6, math.sin(a) * 7.6, 3.2), (0.1, 1.4, 5.0), rz=a, bevel=0)
            cyl('steel', (math.cos(a) * 7.6, math.sin(a) * 7.6, 0.6), 0.06, 6.0, 6)


def m_lamp(v):
    cyl('steel_dark', (0, 0, 0), 0.16, 0.5, 10)
    cyl('steel_dark', (0, 0, 0.5), 0.1, 6.0, 8, r2=0.07)
    box('steel_dark', (0, -0.8, 6.35), (0.1, 1.7, 0.1), bevel=0)
    box('steel_dark', (0, -1.55, 6.25), (0.45, 0.7, 0.16), bevel=0)
    box('lamp', (0, -1.55, 6.15), (0.36, 0.6, 0.06), bevel=0)


def m_bench(v):
    for k in range(3):
        box('wood_deck', (0, -0.25 + k * 0.2, 0.48), (1.9, 0.14, 0.06), bevel=0)
    for k in range(2):
        box('wood_deck', (0, 0.32, 0.72 + k * 0.18), (1.9, 0.05, 0.12), rx=-0.2, bevel=0)
    for x in (-0.8, 0.8):
        box('steel_dark', (x, 0, 0.24), (0.08, 0.6, 0.48), bevel=0)
        box('steel_dark', (x, 0.32, 0.7), (0.08, 0.06, 0.5), bevel=0)


def m_car(v):
    body = ['car_red', 'car_blue', 'car_white', 'car_black', 'car_yellow'][v % 5]
    # Front = -Y. Lower body, then a tapered cabin (hull), wheels and lights
    L, W = 4.4, 1.9
    box(body, (0, 0, 0.62), (W, L, 0.62), bevel=0.12)
    cabin_top = 1.45 if v != 2 else 1.75
    front = -0.55 if v != 2 else -1.1
    hull('glass_dark', [(-W / 2 + 0.08, front, 0.92), (W / 2 - 0.08, front, 0.92), (-W / 2 + 0.08, 1.7, 0.92), (W / 2 - 0.08, 1.7, 0.92),
                        (-W / 2 + 0.2, front + 0.55, cabin_top), (W / 2 - 0.2, front + 0.55, cabin_top), (-W / 2 + 0.2, 1.45, cabin_top), (W / 2 - 0.2, 1.45, cabin_top)])
    box(body, (0, (front + 0.55 + 1.45) / 2, cabin_top + 0.04), (W - 0.36, 1.45 - front - 0.55, 0.1), bevel=0.03)
    for sx in (-1, 1):
        for sy in (-1, 1):
            cyl('rubber', (sx * (W / 2 - 0.1), sy * 1.35, 0.36), 0.36, 0.28, 14, ry=math.pi / 2)
            if Q == 0:
                cyl('steel', (sx * (W / 2 + 0.05), sy * 1.35, 0.36), 0.2, 0.04, 10, ry=math.pi / 2)
    if Q < 2:
        for sx in (-1, 1):
            box('lamp', (sx * 0.62, -L / 2 - 0.01, 0.72), (0.4, 0.06, 0.16), bevel=0)
            box('accent_red', (sx * 0.62, L / 2 + 0.01, 0.74), (0.4, 0.06, 0.14), bevel=0)
        if Q == 0:
            box('steel_dark', (0, -L / 2 - 0.02, 0.45), (1.2, 0.06, 0.18), bevel=0)  # grille
            box('rubber', (0, -L / 2 - 0.05, 0.33), (W, 0.1, 0.14), bevel=0)
            box('rubber', (0, L / 2 + 0.05, 0.33), (W, 0.1, 0.14), bevel=0)


def m_dock(v):
    L, W = 34.0, 6.0
    box('concrete', (0, -L / 2, 0.6), (W, L, 1.2), bevel=0.05)
    for k in range(7 if Q < 2 else 3):
        y = -2 - k * (L - 4) / (6 if Q < 2 else 2)
        for sx in (-1, 1):
            box('concrete_dark', (sx * (W / 2 - 0.4), y, -2.5), (0.8, 0.8, 5.0), bevel=0)
    if Q == 0:
        for k in range(6):
            cyl('iron', (W / 2 - 0.5, -3 - k * 5.8, 1.2), 0.22, 0.6, 10)
            box('rubber', (W / 2 + 0.05, -3 - k * 5.8, 0.4), (0.2, 1.2, 0.8), bevel=0)
        box('accent_yellow', (0, -L / 2, 1.22), (0.2, L - 1, 0.04), bevel=0)


MODERN = {
    'm_house': (m_house, 3), 'm_shop': (m_shop, 2), 'm_apartment': (m_apartment, 2), 'm_office': (m_office, 2),
    'm_tower_a': (m_tower_a, 1), 'm_tower_b': (m_tower_b, 1), 'm_spire': (m_spire, 1), 'm_lamp': (m_lamp, 1),
    'm_bench': (m_bench, 1), 'm_car': (m_car, 5), 'm_dock': (m_dock, 1),
}


# ================================================================== NATURE (metre scale)
def canopy(mats, center, radius, count, spread, seed, squash=0.85, sub=2):
    """Cluster of leafy blobs: a big core and smaller puffs around it, in a few greens."""
    g = random.Random(seed)
    cx, cy, cz = center
    if Q == 2:
        sphere(mats[0], (cx, cy, cz), radius * 1.05, (1, 1, squash), sub=1)
        return
    sphere(mats[0], (cx, cy, cz), radius, (1, 1, squash), sub=sub)
    n = count if Q == 0 else max(2, count // 3)
    for k in range(n):
        a = g.random() * TAU
        e = (g.random() - 0.3) * 0.9
        d = radius * spread * (0.6 + g.random() * 0.4)
        r = radius * (0.45 + g.random() * 0.3)
        p = (cx + math.cos(a) * math.cos(e) * d, cy + math.sin(a) * math.cos(e) * d, cz + math.sin(e) * d * 0.7)
        sphere(mats[(k + 1) % len(mats)], p, r, (1, 1, squash), sub=sub - (0 if r > 0.8 else 1))


def trunk(mat, h, r0, r1, lean=(0, 0), seg=10, branches=0, seed=1):
    g = random.Random(seed)
    cyl(mat, (0, 0, 0), r0, h, seg, r2=r1, rx=lean[0], ry=lean[1])
    if Q == 0:
        for k in range(branches):
            a = k / max(1, branches) * TAU + g.random()
            z = h * (0.55 + g.random() * 0.3)
            cyl(mat, (0, 0, z), r1 * 0.6, h * 0.35, 6, r2=r1 * 0.25, rx=math.cos(a) * 0.9, ry=math.sin(a) * 0.9)


def t_oak(v):
    h = 3.6 + v * 0.6
    trunk('bark', h, 0.42, 0.28, branches=4, seed=10 + v)
    cols = (['leaf_a', 'leaf_b', 'leaf_c'] if v < 2 else ['autumn_a', 'autumn_b', 'autumn_c'])
    canopy(cols, (0, 0, h + 2.4), 2.6, 9, 1.0, 20 + v)


def t_birch(v):
    h = 6.5
    cyl('bark_birch', (0, 0, 0), 0.2, h, 8, r2=0.12)
    if Q == 0:
        g = random.Random(30 + v)
        for k in range(9):
            z = 0.6 + g.random() * (h - 1.2)
            a = g.random() * TAU
            box('bark_mark', (math.cos(a) * 0.17, math.sin(a) * 0.17, z), (0.16, 0.05, 0.05), rz=a, bevel=0)
    canopy(['leaf_birch', 'leaf_c', 'leaf_a'] if v == 0 else ['autumn_c', 'autumn_a', 'leaf_birch'], (0, 0, h + 0.6), 1.5, 8, 0.9, 40 + v, squash=1.35)


def jagged_cone(mat, loc, r, h, seg, seed, spike=0.22):
    """Conifer tier: a cone whose rim alternates in and out (needle clusters), with a little jitter."""
    g = random.Random(seed)
    seg = seg if Q == 0 else max(6, seg // 2) if Q == 1 else 6
    x0, y0, z0 = loc
    verts = [(x0, y0, z0 + h)]
    rim = []
    for i in range(seg):
        a = i / seg * TAU + g.random() * 0.08
        rr = r * (1 - (spike if i % 2 else 0) + (g.random() - 0.5) * 0.08)
        zz = z0 + (g.random() - 0.5) * 0.12 * h - (0.12 * h if i % 2 == 0 else 0)
        rim.append((x0 + math.cos(a) * rr, y0 + math.sin(a) * rr, zz))
    verts += rim
    verts.append((x0, y0, z0 + h * 0.18))  # underside centre, tucked up
    faces = []
    for i in range(seg):
        j = (i + 1) % seg
        faces.append([0, 1 + i, 1 + j])
        faces.append([seg + 1, 1 + j, 1 + i])
    poly(mat, verts, faces)


def t_pine(v):
    h = 1.6
    cyl('bark_dark', (0, 0, 0), 0.3, h + 2, 8, r2=0.18)
    tiers = 5 if Q == 0 else 3 if Q == 1 else 2
    for k in range(tiers):
        f = k / tiers
        r = 2.6 * (1 - f * 0.75)
        z = h + f * 8.2
        th = 3.6 - f * 1.2
        jagged_cone('conifer_a' if k % 2 == 0 else 'conifer_b', (0, 0, z), r, th, 18, 200 + k + v * 10)
        if v == 1 and Q < 2:
            # Snow sits on the upper part of each tier
            jagged_cone('snow', (0, 0, z + th * 0.3), r * 0.76, th * 0.74, 14, 300 + k, spike=0.3)


def t_spruce(v):
    cyl('bark_dark', (0, 0, 0), 0.26, 2.4, 8, r2=0.16)
    tiers = 8 if Q == 0 else 4 if Q == 1 else 2
    for k in range(tiers):
        f = k / tiers
        r = 1.9 * (1 - f * 0.8)
        th = 2.6 - f * 0.9
        jagged_cone('conifer_b' if k % 2 else 'conifer_a', (0, 0, 1.4 + f * 10), r, th, 14, 400 + k + v * 20, spike=0.28)
        if v == 1 and Q < 2 and k % 2 == 0:
            jagged_cone('snow', (0, 0, 1.4 + f * 10 + th * 0.3), r * 0.78, th * 0.74, 12, 500 + k, spike=0.3)


def t_cypress(v):
    cyl('bark', (0, 0, 0), 0.22, 1.6, 8, r2=0.18)
    sphere('cypress', (0, 0, 5.2), 1.3, (1, 1, 3.4), sub=2)
    if Q == 0:
        for k in range(5):
            a = k / 5 * TAU
            sphere('leaf_b', (math.cos(a) * 0.55, math.sin(a) * 0.55, 3.2 + k * 1.1), 0.75, (1, 1, 1.8), sub=1)


def t_palm(v):
    # Curved trunk: stacked, slightly bending segments with ring bands
    segs_n = 9 if Q == 0 else 5 if Q == 1 else 3
    x = 0.0
    z = 0.0
    h = 8.5
    for k in range(segs_n):
        t0 = k / segs_n
        bend = 0.35 * t0 * t0
        seg_h = h / segs_n
        cyl('palm_trunk' if k % 2 == 0 or Q else 'bark', (x, 0, z), 0.3 - t0 * 0.1, seg_h + 0.05, 8, r2=0.28 - t0 * 0.1, ry=bend)
        x += math.sin(bend) * seg_h
        z += math.cos(bend) * seg_h
    fronds = 8 if Q == 0 else 5 if Q == 1 else 4
    for k in range(fronds):
        a = k / fronds * TAU
        L = 3.6
        droop = -1.4
        tip = (x + math.cos(a) * L, math.sin(a) * L, z + droop)
        mid = (x + math.cos(a) * L * 0.5, math.sin(a) * L * 0.5, z + 0.5)
        w = 0.55
        px, py = -math.sin(a) * w, math.cos(a) * w
        hull('palm_leaf', [(x, 0, z), (mid[0] + px, mid[1] + py, mid[2]), (mid[0] - px, mid[1] - py, mid[2]), tip,
                           (mid[0], mid[1], mid[2] - 0.12)])
    if Q < 2:
        for k in range(3):
            sphere('coconut', (x + math.cos(k * 2.1) * 0.35, math.sin(k * 2.1) * 0.35, z - 0.35), 0.22, sub=1)


def t_fruit(v):
    trunk('bark', 2.2, 0.26, 0.18, branches=3, seed=60 + v)
    cols = ['leaf_c', 'leaf_a'] if v == 0 else ['blossom', 'leaf_c']
    canopy(cols, (0, 0, 3.8), 1.9, 7, 0.9, 61 + v)
    if Q < 2 and v == 0:
        g = random.Random(62)
        for k in range(14 if Q == 0 else 5):
            a = g.random() * TAU
            e = (g.random() - 0.3) * 1.2
            sphere('fruit_red', (math.cos(a) * math.cos(e) * 2.0, math.sin(a) * math.cos(e) * 2.0, 3.8 + math.sin(e) * 1.4), 0.14, sub=1)


def t_acacia(v):
    trunk('bark', 3.4, 0.28, 0.2, branches=0, seed=70)
    if Q < 2:
        for sx in (-1, 1):
            cyl('bark', (0, 0, 2.8), 0.16, 2.2, 6, r2=0.1, ry=sx * 0.7)
    canopy(['leaf_b', 'leaf_a', 'autumn_c' if v else 'leaf_c'], (0, 0, 4.6), 2.8, 7, 1.1, 71 + v, squash=0.38)


def b_bush(v):
    canopy(['leaf_b', 'leaf_a', 'leaf_c'], (0, 0, 0.55), 0.8, 6, 0.9, 80 + v, squash=0.8)
    if v == 1 and Q < 2:
        g = random.Random(81)
        for k in range(10 if Q == 0 else 4):
            a = g.random() * TAU
            sphere('flower' if k % 2 else 'flower_y', (math.cos(a) * 0.75, math.sin(a) * 0.75, 0.55 + g.random() * 0.5), 0.1, sub=1)


def b_flowers(v):
    g = random.Random(90 + v)
    cols = [['flower', 'flower_w', 'flower_y'], ['flower_p', 'flower_w', 'flower'], ['flower_y', 'autumn_a', 'flower_w']][v % 3]
    for k in range(18 if Q == 0 else 6 if Q == 1 else 3):
        a = g.random() * TAU
        r = g.random() * 0.9
        x, y = math.cos(a) * r, math.sin(a) * r
        if Q < 2:
            cyl('leaf_a', (x, y, 0), 0.02, 0.35, 4)
        sphere(cols[k % 3], (x, y, 0.38), 0.09 if Q < 2 else 0.2, sub=1)
    if Q < 2:
        sphere('leaf_b', (0, 0, 0.06), 0.9, (1, 1, 0.15), sub=1)


def r_rock(v):
    g = random.Random(100 + v)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2 if Q == 0 else 1, radius=1.0)
    for vert in bm.verts:
        n = 0.75 + g.random() * 0.45
        vert.co *= n
        vert.co.z *= 0.62
        if vert.co.z < -0.1:
            vert.co.z = -0.1  # flat base, sits on the ground
    bmesh.ops.scale(bm, vec=Vector((1.2 + v * 0.3, 1.0, 1.0)), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector((0, 0, 0.1)), verts=bm.verts)
    _emit(bm, ['rock_a', 'rock_b', 'rock_c'][v % 3])
    if v == 2 and Q < 2:
        sphere('moss_rock', (0.1, 0.1, 0.55), 0.55, (1.3, 1.1, 0.35), sub=1)


NATURE = {
    't_oak': (t_oak, 3), 't_birch': (t_birch, 2), 't_pine': (t_pine, 2), 't_spruce': (t_spruce, 2),
    't_cypress': (t_cypress, 1), 't_palm': (t_palm, 1), 't_fruit': (t_fruit, 2), 't_acacia': (t_acacia, 2),
    'b_bush': (b_bush, 2), 'b_flowers': (b_flowers, 3), 'r_rock': (r_rock, 3),
}


# ================================================================== VEHICLES (metre scale, front = -Y)
def car_wheels(L, W, r, front, back, rim='chrome'):
    for sx in (-1, 1):
        for y in (front, back):
            x = sx * (W / 2 - 0.12)
            cyl('rubber', (x - 0.14, y, r), r, 0.28, 16, ry=math.pi / 2)
            if Q < 2:
                cyl(rim, (x + sx * 0.15 - (0.015 if sx > 0 else 0), y, r), r * 0.58, 0.03, 12, ry=math.pi / 2)


def car_body(body, L, W, sill, belt, bonnet, boot, cabin_front, cabin_back, roof, glass='glass_dark', roof_mat=None):
    """Side profile lofted across the width: lower body, glasshouse and roof."""
    y0, y1 = -L / 2, L / 2
    # Lower body: a chamfered block from bumper to bumper
    hull(body, [(-W / 2, y0 + 0.15, sill), (W / 2, y0 + 0.15, sill), (-W / 2, y1 - 0.1, sill), (W / 2, y1 - 0.1, sill),
                (-W / 2, y0, sill + 0.28), (W / 2, y0, sill + 0.28), (-W / 2, y1, sill + 0.3), (W / 2, y1, sill + 0.3),
                (-W / 2 + 0.05, y0 + 0.25, bonnet), (W / 2 - 0.05, y0 + 0.25, bonnet), (-W / 2 + 0.05, y1 - 0.2, boot), (W / 2 - 0.05, y1 - 0.2, boot),
                (-W / 2 + 0.05, cabin_front, belt), (W / 2 - 0.05, cabin_front, belt), (-W / 2 + 0.05, cabin_back, belt), (W / 2 - 0.05, cabin_back, belt)])
    # Glasshouse
    inset = 0.14
    hull(glass, [(-W / 2 + 0.1, cabin_front, belt), (W / 2 - 0.1, cabin_front, belt), (-W / 2 + 0.1, cabin_back, belt), (W / 2 - 0.1, cabin_back, belt),
                 (-W / 2 + inset + 0.08, cabin_front + (roof[0] - cabin_front), roof[2]), (W / 2 - inset - 0.08, cabin_front + (roof[0] - cabin_front), roof[2]),
                 (-W / 2 + inset + 0.08, roof[1], roof[2]), (W / 2 - inset - 0.08, roof[1], roof[2])])
    box(roof_mat or body, (0, (roof[0] + roof[1]) / 2, roof[2] + 0.04), (W - inset * 2 - 0.12, roof[1] - roof[0] + 0.1, 0.09), bevel=0.03)
    if Q == 0:
        # B-pillar: a slanted strip following the glasshouse side, then door lines
        for sx in (-1, 1):
            yb = (roof[0] + roof[1]) / 2
            hull(roof_mat or body, [(sx * (W / 2 - 0.09), yb - 0.07, belt), (sx * (W / 2 - 0.09), yb + 0.07, belt),
                                    (sx * (W / 2 - inset - 0.07), yb - 0.07, roof[2]), (sx * (W / 2 - inset - 0.07), yb + 0.07, roof[2]),
                                    (sx * (W / 2 - 0.13), yb - 0.07, belt), (sx * (W / 2 - inset - 0.11), yb + 0.07, roof[2])])
        for sx in (-1, 1):
            box('rubber', (sx * (W / 2 + 0.005), (cabin_front + roof[0]) / 2 + 0.2, (sill + belt) / 2 + 0.1), (0.02, 0.03, belt - sill - 0.1), bevel=0)
            box('chrome', (sx * (W / 2 + 0.01), cabin_front + 0.45, belt - 0.12), (0.03, 0.18, 0.04), bevel=0)  # handle
            box(roof_mat or body, (sx * (W / 2 + 0.05), cabin_front + 0.1, belt + 0.08), (0.12, 0.07, 0.1), bevel=0.02)  # mirror


def car_lights(L, W, z_front, z_back):
    if Q == 2:
        return
    for sx in (-1, 1):
        box('lamp', (sx * (W / 2 - 0.3), -L / 2 - 0.005, z_front), (0.42, 0.06, 0.14), bevel=0)
        box('tail', (sx * (W / 2 - 0.25), L / 2 + 0.005, z_back), (0.38, 0.06, 0.14), bevel=0)
    if Q == 0:
        box('steel_dark', (0, -L / 2 - 0.02, z_front - 0.12), (W * 0.45, 0.05, 0.16), bevel=0)  # grille
        box('rubber', (0, -L / 2 - 0.05, 0.36), (W - 0.1, 0.1, 0.16), bevel=0.02)
        box('rubber', (0, L / 2 + 0.05, 0.38), (W - 0.1, 0.1, 0.16), bevel=0.02)
        box('chrome', (0, L / 2 + 0.03, z_back - 0.18), (0.5, 0.03, 0.12), bevel=0)  # plate


CAR_COLORS = ['car_red', 'car_blue', 'car_white', 'car_black', 'car_yellow', 'car_green', 'car_silver', 'car_orange']


def v_sedan(v):
    c = CAR_COLORS[v % len(CAR_COLORS)]
    L, W = 4.5, 1.85
    car_body(c, L, W, 0.25, 0.95, 0.9, 0.95, -0.6, 1.25, (-0.2, 0.85, 1.45))
    car_wheels(L, W, 0.34, -1.4, 1.35)
    car_lights(L, W, 0.78, 0.82)


def v_hatch(v):
    c = CAR_COLORS[(v + 2) % len(CAR_COLORS)]
    L, W = 3.9, 1.78
    car_body(c, L, W, 0.25, 0.95, 0.88, 1.0, -0.55, 1.7, (-0.15, 1.45, 1.5))
    car_wheels(L, W, 0.32, -1.2, 1.2)
    car_lights(L, W, 0.78, 1.05)


def v_suv(v):
    c = ['car_black', 'car_silver', 'car_green', 'car_white'][v % 4]
    L, W = 4.75, 1.98
    car_body(c, L, W, 0.42, 1.2, 1.15, 1.2, -0.7, 2.05, (-0.3, 1.9, 1.85))
    car_wheels(L, W, 0.42, -1.5, 1.5)
    car_lights(L, W, 1.0, 1.1)
    if Q < 2:
        for sx in (-0.5, 0.5):
            box('steel', (sx, 0.8, 1.97), (0.06, 2.2, 0.06), bevel=0)  # roof rails


def v_van(v):
    c = ['car_white', 'car_silver', 'car_blue'][v % 3]
    L, W = 5.0, 2.0
    box(c, (0, 0.35, 1.25), (W, L - 0.7, 2.1), bevel=0.12)
    hull(c, [(-W / 2, -L / 2, 0.35), (W / 2, -L / 2, 0.35), (-W / 2, -L / 2 + 0.7, 0.35), (W / 2, -L / 2 + 0.7, 0.35),
             (-W / 2, -L / 2 + 0.1, 1.05), (W / 2, -L / 2 + 0.1, 1.05), (-W / 2 + 0.05, -L / 2 + 0.9, 2.2), (W / 2 - 0.05, -L / 2 + 0.9, 2.2)])
    # Windscreen on the sloped nose, standing a hair proud of the body
    ny, nz = -0.72, 0.5  # outward normal of the slope (y, z)
    o = 0.03
    slab('glass_dark', [(-W / 2 + 0.12, -L / 2 + 0.2 + ny * o, 1.2 + nz * o), (W / 2 - 0.12, -L / 2 + 0.2 + ny * o, 1.2 + nz * o),
                        (W / 2 - 0.14, -L / 2 + 0.82 + ny * o, 2.08 + nz * o), (-W / 2 + 0.14, -L / 2 + 0.82 + ny * o, 2.08 + nz * o)], th=0.03)
    for sx in (-1, 1):
        box('glass_dark', (sx * (W / 2 + 0.005), -L / 2 + 1.1, 1.6), (0.02, 0.8, 0.6), bevel=0)
    car_wheels(L, W, 0.36, -1.55, 1.6)
    car_lights(L, W, 0.8, 1.2)
    if Q == 0:
        box('accent_green' if v == 0 else 'accent_red', (W / 2 + 0.01, 0.6, 1.3), (0.02, 2.6, 0.5), bevel=0)


def v_pickup(v):
    c = ['car_red', 'car_blue', 'car_silver'][v % 3]
    L, W = 5.3, 1.95
    car_body(c, L, W, 0.4, 1.15, 1.15, 1.15, -0.8, 0.55, (-0.35, 0.45, 1.8))
    box(c, (0, 1.6, 1.0), (W, 2.1, 0.3), bevel=0.03)  # bed floor sits in the lower body
    for sx in (-1, 1):
        box(c, (sx * (W / 2 - 0.06), 1.6, 1.35), (0.12, 2.1, 0.45), bevel=0.02)
    box(c, (0, 2.6, 1.35), (W, 0.12, 0.45), bevel=0.02)
    car_wheels(L, W, 0.42, -1.65, 1.7)
    car_lights(L, W, 1.0, 1.2)


def v_bus(v):
    c = ['taxi', 'car_white', 'accent_green'][v % 3]
    L, W, H = 11.0, 2.55, 3.1
    box(c, (0, 0, 0.45 + H / 2), (W, L, H), bevel=0.15)
    box('glass_dark', (0, -L / 2 - 0.01, 2.2), (W - 0.3, 0.05, 1.5), bevel=0)
    n = 7 if Q < 2 else 1
    for sx in (-1, 1):
        if Q < 2:
            for k in range(n):
                box('glass_dark', (sx * (W / 2 + 0.005), -L / 2 + 1.6 + k * 1.3, 2.25), (0.03, 1.1, 1.1), bevel=0)
        else:
            box('glass_dark', (sx * (W / 2 + 0.005), 0, 2.25), (0.03, L - 2, 1.1), bevel=0)
    box('glass_dark', (W / 2 + 0.005, -L / 2 + 0.8, 1.5), (0.03, 1.0, 2.2), bevel=0)  # door
    if Q == 0:
        box('steel_dark', (0, 0, 0.45 + H + 0.2), (1.6, 3.0, 0.4), bevel=0.05)  # roof unit
        box('screen', (0, -L / 2 - 0.02, 3.2), (1.5, 0.04, 0.3), bevel=0)
    for sx in (-1, 1):
        for y in (-L / 2 + 2.0, L / 2 - 2.4):
            cyl('rubber', (sx * (W / 2 - 0.15) - 0.17, y, 0.5), 0.5, 0.34, 16, ry=math.pi / 2)
    car_lights(L, W, 0.9, 1.0)


def v_taxi(v):
    v_sedan(4)
    if Q < 2:
        box('car_black', (0, 0.3, 1.58), (0.8, 0.3, 0.22), bevel=0.03)
        box('lamp', (0, 0.3, 1.58), (0.6, 0.32, 0.12), bevel=0)


def v_police(v):
    L, W = 4.5, 1.85
    car_body('car_white', L, W, 0.25, 0.95, 0.9, 0.95, -0.6, 1.25, (-0.2, 0.85, 1.45), roof_mat='car_white')
    if Q < 2:
        for sx in (-1, 1):
            box('police_blue', (sx * (W / 2 + 0.005), 0.1, 0.62), (0.02, 3.2, 0.3), bevel=0)
        box('steel_dark', (0, 0.3, 1.56), (1.2, 0.26, 0.1), bevel=0)
        box('accent_red', (-0.35, 0.3, 1.65), (0.45, 0.24, 0.14), bevel=0)
        box('police_blue', (0.35, 0.3, 1.65), (0.45, 0.24, 0.14), bevel=0)
    car_wheels(L, W, 0.34, -1.4, 1.35)
    car_lights(L, W, 0.78, 0.82)


def v_sport(v):
    c = ['car_red', 'car_yellow', 'car_orange'][v % 3]
    L, W = 4.45, 1.98
    car_body(c, L, W, 0.18, 0.75, 0.62, 0.8, -0.35, 1.0, (0.05, 0.6, 1.18), roof_mat='car_black')
    if Q < 2:
        box('car_black', (0, 2.05, 1.0), (1.7, 0.3, 0.06), bevel=0)  # spoiler
        for sx in (-0.7, 0.7):
            box('car_black', (sx, 2.05, 0.9), (0.08, 0.2, 0.2), bevel=0)
    car_wheels(L, W, 0.34, -1.35, 1.35, rim='car_black')
    car_lights(L, W, 0.6, 0.7)


# ---- horse-drawn (fantasy)
def horse(x, y, color, facing=0):
    """Standing horse, head toward -Y, about 2.2 m long."""
    rot = Matrix.Rotation(facing, 4, 'Z')

    def at(dx, dy, dz):
        p = rot @ Vector((dx, dy, dz))
        return (x + p.x, y + p.y, p.z)

    sphere(color, at(0, 0, 1.35), 0.55, (0.8, 1.9, 0.85), sub=2)
    for sx in (-1, 1):
        for sy in (-0.65, 0.65):
            cyl(color if Q else 'horse_b', at(sx * 0.22, sy, 0), 0.09, 1.25, 8, r2=0.11)
            if Q < 2:
                cyl('mane', at(sx * 0.22, sy, 0), 0.11, 0.14, 8)  # hooves
    hull(color, [at(-0.18, -0.85, 1.4), at(0.18, -0.85, 1.4), at(-0.14, -1.25, 2.05), at(0.14, -1.25, 2.05),
                 at(-0.2, -0.65, 1.6), at(0.2, -0.65, 1.6), at(-0.12, -1.05, 2.15), at(0.12, -1.05, 2.15)])  # neck
    box(color, at(0, -1.45, 2.0), (0.26, 0.62, 0.3), rz=facing, rx=0.5, bevel=0.06)  # head
    if Q < 2:
        box('mane', at(0, -1.05, 2.2), (0.08, 0.6, 0.2), rz=facing, rx=0.9, bevel=0)
        for sx in (-1, 1):
            box(color, at(sx * 0.08, -1.25, 2.3), (0.05, 0.05, 0.14), bevel=0)  # ears
        box('mane', at(0, 1.05, 1.2), (0.12, 0.12, 0.7), rz=facing, rx=-0.4, bevel=0)  # tail
        box('harness', at(0, -0.4, 1.5), (1.02, 0.12, 0.2), bevel=0)


def v_cart(v):
    # Two-wheeled cart with one horse ahead of it
    box('wood', (0, 0.6, 1.0), (1.6, 2.2, 0.15), bevel=0.02)
    for sx in (-1, 1):
        box('wood', (sx * 0.78, 0.6, 1.3), (0.08, 2.2, 0.5), bevel=0)
        cyl('wood_dark', (sx * 0.95 - 0.06, 0.6, 0.62), 0.62, 0.12, 14, ry=math.pi / 2)
        if Q < 2:
            for k in range(6):
                box('wood', (sx * 0.95, 0.6, 0.62), (0.05, 1.1, 0.06), rx=k * math.pi / 6, bevel=0)
    box('wood', (0, 1.72, 1.3), (1.6, 0.08, 0.5), bevel=0)
    for sx in (-0.35, 0.35):
        box('wood', (sx, -0.9, 1.0), (0.07, 2.4, 0.07), bevel=0)  # shafts
    if Q < 2:
        for k in range(3):
            box('hay' if k % 2 else 'wood_light', (-0.35 + k * 0.35, 0.8, 1.3), (0.5, 0.9, 0.45), bevel=0.05)
    horse(0, -1.8, ['horse_a', 'horse_b', 'horse_c'][v % 3])


def v_wagon(v):
    box('wood', (0, 0.8, 1.05), (1.8, 3.4, 0.18), bevel=0.02)
    for sx in (-1, 1):
        box('wood_light', (sx * 0.86, 0.8, 1.45), (0.1, 3.4, 0.62), bevel=0)
        for y in (-0.4, 2.0):
            cyl('wood_dark', (sx * 1.0 - 0.06, y, 0.55), 0.55, 0.12, 14, ry=math.pi / 2)
    if Q < 2:
        for k in range(4):
            cyl('wood', (-0.4 + (k % 2) * 0.8, 0.2 + (k // 2) * 1.3, 1.14), 0.3, 0.8, 10)  # barrels
    horse(-0.45, -1.9, 'horse_a')
    horse(0.45, -1.9, 'horse_b')


def v_caravan(v):
    box('wood', (0, 0.9, 1.05), (1.9, 3.8, 0.2), bevel=0.02)
    # Canvas hoops: a half-cylinder cover
    arc = 10 if Q == 0 else 6
    pts = []
    for k in range(arc + 1):
        a = math.pi * k / arc
        pts.append((math.cos(a) * 1.0, 1.15 + math.sin(a) * 1.1))
    prof = [(p[0], p[1]) for p in pts]
    verts = [(x, -1.0 + 0.9, z) for x, z in prof] + [(x, 2.8 + 0.9 - 1.0, z) for x, z in prof]
    n = len(prof)
    faces = [[i, i + 1, n + i + 1, n + i] for i in range(n - 1)]
    poly('canvas', [(x, y - 0.0, z) for x, y, z in verts], faces)
    poly('canvas', [(x, y, z) for x, y, z in verts], [[n + i, n + i + 1, i + 1, i] for i in range(n - 1)])  # inside
    if Q == 0:
        # Hoops: short wooden segments following the arch (long axis along its tangent)
        for yk in (0, 1, 2):
            for k in range(arc):
                am = math.pi * (k + 0.5) / arc
                box('wood_dark', (math.cos(am) * 1.03, -0.1 + yk * 1.4, 1.15 + math.sin(am) * 1.13), (0.07, 0.08, math.pi * 1.08 / arc), ry=-am, bevel=0)
    for sx in (-1, 1):
        for y in (-0.2, 2.1):
            cyl('wood_dark', (sx * 1.05 - 0.06, y, 0.6), 0.6, 0.12, 14, ry=math.pi / 2)
    horse(-0.45, -2.0, 'horse_c')
    horse(0.45, -2.0, 'horse_a')


VEHICLES = {
    'v_sedan': (v_sedan, 4), 'v_hatch': (v_hatch, 3), 'v_suv': (v_suv, 2), 'v_van': (v_van, 2), 'v_pickup': (v_pickup, 2),
    'v_bus': (v_bus, 2), 'v_taxi': (v_taxi, 1), 'v_police': (v_police, 1), 'v_sport': (v_sport, 2),
    'v_cart': (v_cart, 2), 'v_wagon': (v_wagon, 1), 'v_caravan': (v_caravan, 1),
}


# ================================================================== FURNITURE (interiors, metre scale, front = -Y)
# Moving parts are their own assets with the origin on the hinge:
#   fu_wardrobe_door (hinge at x = 0, door extends to +X), fu_fridge_door, fu_tv_screen, fu_drawer.
def fu_bed(v):
    frame = ['wood_mid', 'wood_dark'][v % 2]
    box(frame, (0, 0, 0.25), (1.6, 2.1, 0.3), bevel=0.03)
    box('linen', (0, 0.05, 0.47), (1.5, 1.95, 0.18), bevel=0.05)
    box(['fabric_a', 'fabric_b'][v % 2], (0, -0.35, 0.58), (1.55, 1.2, 0.08), bevel=0.03)  # blanket
    for sx in (-0.38, 0.38):
        box('pillow', (sx, 0.78, 0.62), (0.6, 0.35, 0.14), bevel=0.05)
    box(frame, (0, 1.05, 0.6), (1.6, 0.08, 0.9), bevel=0.02)  # headboard
    for sx in (-0.75, 0.75):
        for sy in (-0.98, 0.98):
            box(frame, (sx, sy, 0.1), (0.08, 0.08, 0.2), bevel=0)


def fu_sofa(v):
    c = ['fabric_a', 'fabric_b', 'fabric_c'][v % 3]
    box(c, (0, 0.05, 0.28), (2.0, 0.85, 0.36), bevel=0.05)
    box(c, (0, 0.38, 0.62), (2.0, 0.2, 0.62), bevel=0.06)
    for sx in (-1, 1):
        box(c, (sx * 0.93, 0.05, 0.5), (0.18, 0.85, 0.36), bevel=0.06)
    for k in range(3 if Q < 2 else 1):
        box(c, (-0.6 + k * 0.6, -0.02, 0.5), (0.58, 0.7, 0.14), bevel=0.05)  # cushions
    for sx in (-0.9, 0.9):
        for sy in (-0.3, 0.4):
            box('wood_dark', (sx, sy, 0.05), (0.06, 0.06, 0.1), bevel=0)


def fu_armchair(v):
    c = ['fabric_b', 'fabric_c'][v % 2]
    box(c, (0, 0.05, 0.28), (0.9, 0.8, 0.36), bevel=0.05)
    box(c, (0, 0.36, 0.64), (0.9, 0.18, 0.66), bevel=0.06)
    for sx in (-1, 1):
        box(c, (sx * 0.4, 0.05, 0.52), (0.14, 0.8, 0.3), bevel=0.05)
    box(c, (0, -0.02, 0.5), (0.62, 0.62, 0.12), bevel=0.05)


def fu_chair(v):
    w = ['wood_mid', 'wood_pale'][v % 2]
    box(w, (0, 0, 0.45), (0.45, 0.45, 0.05), bevel=0.01)
    for sx in (-0.19, 0.19):
        for sy in (-0.19, 0.19):
            box(w, (sx, sy, 0.22), (0.04, 0.04, 0.44), bevel=0)
    for sx in (-0.19, 0.19):
        box(w, (sx, 0.2, 0.72), (0.04, 0.04, 0.5), bevel=0)
    box(w, (0, 0.2, 0.9), (0.42, 0.03, 0.12), bevel=0)
    if Q == 0:
        box(w, (0, 0.2, 0.7), (0.42, 0.03, 0.06), bevel=0)


def fu_table(v):
    w = ['wood_mid', 'wood_dark'][v % 2]
    box(w, (0, 0, 0.74), (1.4, 0.85, 0.06), bevel=0.01)
    for sx in (-0.62, 0.62):
        for sy in (-0.36, 0.36):
            box(w, (sx, sy, 0.36), (0.06, 0.06, 0.72), bevel=0)


def fu_coffee_table(v):
    box('wood_pale', (0, 0, 0.4), (1.0, 0.55, 0.05), bevel=0.01)
    box('wood_pale', (0, 0, 0.12), (0.9, 0.45, 0.03), bevel=0)
    for sx in (-0.45, 0.45):
        for sy in (-0.23, 0.23):
            box('wood_dark', (sx, sy, 0.2), (0.04, 0.04, 0.4), bevel=0)


def fu_wardrobe(v):
    w = ['wood_dark', 'wood_mid'][v % 2]
    box(w, (0, 0.05, 1.0), (1.2, 0.6, 2.0), bevel=0.02)
    box('wood_dark', (0, 0.05, 2.03), (1.26, 0.64, 0.06), bevel=0.01)
    box('iron', (0, -0.25, 1.0), (1.1, 0.02, 1.88), bevel=0)  # dark interior seen when open


def fu_wardrobe_door(v):
    # Hinge at x = 0 on the left edge; the door spans +X, facing -Y
    box('wood_mid', (0.3, -0.02, 1.0), (0.58, 0.04, 1.86), bevel=0.01)
    if Q < 2:
        box('wood_dark', (0.3, -0.045, 1.0), (0.46, 0.01, 1.6), bevel=0)
        box('gold', (0.52, -0.06, 1.05), (0.03, 0.03, 0.14), bevel=0)


def fu_fridge(v):
    box('metal_white', (0, 0, 0.9), (0.7, 0.7, 1.8), bevel=0.04)
    box('iron', (0, -0.33, 0.9), (0.62, 0.02, 1.7), bevel=0)


def fu_fridge_door(v):
    box('metal_white', (0.33, -0.03, 0.9), (0.66, 0.06, 1.76), bevel=0.02)
    if Q < 2:
        box('steel', (0.6, -0.07, 1.1), (0.03, 0.03, 0.5), bevel=0)
        box('steel_dark', (0.33, -0.061, 1.25), (0.64, 0.005, 0.02), bevel=0)


def fu_counter(v):
    box('wood_pale' if v else 'metal_white', (0, 0, 0.44), (1.8, 0.6, 0.88), bevel=0.02)
    box('stone_light', (0, 0, 0.9), (1.84, 0.64, 0.05), bevel=0.01)
    box('steel', (0.4, -0.02, 0.9), (0.5, 0.4, 0.06), bevel=0)  # sink
    if Q < 2:
        cyl('chrome', (0.4, 0.18, 0.92), 0.02, 0.3, 8)
        box('chrome', (0.4, 0.1, 1.2), (0.03, 0.18, 0.03), bevel=0)
        for k in range(3):
            box('wood_dark' if v else 'steel_dark', (-0.6 + k * 0.6, -0.31, 0.7), (0.5, 0.01, 0.02), bevel=0)


def fu_stove(v):
    box('metal_white', (0, 0, 0.44), (0.7, 0.6, 0.88), bevel=0.02)
    box('iron', (0, 0, 0.9), (0.7, 0.6, 0.03), bevel=0)
    for sx in (-0.17, 0.17):
        for sy in (-0.13, 0.13):
            cyl('steel_dark', (sx, sy, 0.915), 0.09, 0.015, 12)
    box('iron', (0, -0.305, 0.45), (0.6, 0.01, 0.4), bevel=0)


def fu_tv(v):
    box('wood_dark', (0, 0.1, 0.25), (1.6, 0.45, 0.5), bevel=0.02)  # cabinet
    box('iron', (0, 0.1, 0.9), (1.2, 0.06, 0.72), bevel=0.02)
    box('iron', (0, 0.12, 0.52), (0.2, 0.1, 0.06), bevel=0)


def fu_tv_screen(v):
    box('screen', (0, 0.065, 0.9), (1.1, 0.01, 0.62), bevel=0)


def fu_radio(v):
    box('wood_mid', (0, 0, 0.14), (0.42, 0.2, 0.28), bevel=0.03)
    box('linen', (-0.08, -0.101, 0.15), (0.2, 0.01, 0.18), bevel=0)
    for k in range(2):
        cyl('iron', (0.12, -0.1, 0.1 + k * 0.1), 0.03, 0.02, 10, rx=math.pi / 2)


def fu_lamp_floor(v):
    cyl('iron', (0, 0, 0), 0.18, 0.04, 16)
    cyl('iron', (0, 0, 0.04), 0.02, 1.45, 8)
    cyl('lampshade', (0, 0, 1.4), 0.24, 0.3, 16, r2=0.15)


def fu_lamp_table(v):
    cyl('ceramic', (0, 0, 0), 0.1, 0.3, 12, r2=0.06)
    cyl('lampshade', (0, 0, 0.3), 0.17, 0.2, 12, r2=0.1)


def fu_fireplace(v):
    box('stone', (0, 0.1, 0.6), (1.6, 0.5, 1.2), bevel=0.03)
    box('iron', (0, -0.1, 0.4), (0.9, 0.2, 0.7), bevel=0)  # opening
    box('stone_dark', (0, 0.05, 1.23), (1.8, 0.6, 0.08), bevel=0.02)
    box('stone', (0, 0.25, 1.9), (0.8, 0.3, 1.3), bevel=0.02)  # chimney breast
    if Q < 2:
        for k in range(3):
            cyl('wood_dark', (-0.2 + k * 0.2, -0.05, 0.14), 0.05, 0.4, 8, rx=math.pi / 2, rz=k * 0.4 - 0.4)


def fu_fire(v):
    for k in range(4):
        cone('fire', (-0.15 + k * 0.1, -0.1, 0.12), 0.08, 0.35 + (k % 2) * 0.1, 6)


def fu_bookshelf(v):
    box('wood_dark', (0, 0.05, 1.0), (1.2, 0.35, 2.0), bevel=0.02)
    box('iron', (0, -0.1, 1.0), (1.1, 0.04, 1.9), bevel=0)
    g = random.Random(500 + v)
    cols = ['book_a', 'book_b', 'book_c', 'book_d', 'linen']
    for shelf in range(4):
        z = 0.15 + shelf * 0.47
        box('wood_mid', (0, -0.02, z), (1.1, 0.3, 0.03), bevel=0)
        x = -0.5
        while x < 0.48 and Q < 2:
            w = 0.04 + g.random() * 0.05
            h = 0.25 + g.random() * 0.12
            box(g.choice(cols), (x + w / 2, -0.03, z + 0.015 + h / 2), (w, 0.22, h), bevel=0)
            x += w + 0.005 + (0.08 if g.random() < 0.06 else 0)


def fu_rug(v):
    box(['rug_a', 'fabric_a'][v % 2], (0, 0, 0.01), (2.0, 1.4, 0.02), bevel=0)
    if Q < 2:
        box('rug_b', (0, 0, 0.021), (1.6, 1.0, 0.005), bevel=0)
        box(['rug_a', 'fabric_a'][v % 2], (0, 0, 0.025), (1.2, 0.6, 0.005), bevel=0)


def fu_plant(v):
    cyl('pot', (0, 0, 0), 0.18, 0.35, 12, r2=0.22)
    canopy(['leaf_a', 'leaf_b', 'leaf_c'], (0, 0, 0.75), 0.32, 5, 0.9, 600 + v, squash=1.2, sub=1)


def fu_desk(v):
    box('wood_pale', (0, 0, 0.74), (1.3, 0.65, 0.04), bevel=0.01)
    box('wood_mid', (0.42, 0, 0.37), (0.42, 0.6, 0.7), bevel=0.01)
    box('wood_mid', (-0.6, 0, 0.37), (0.04, 0.6, 0.7), bevel=0)
    if Q < 2:
        box('iron', (-0.1, 0.18, 0.95), (0.55, 0.04, 0.34), bevel=0.01)  # monitor
        box('iron', (-0.1, -0.1, 0.77), (0.4, 0.14, 0.02), bevel=0)  # keyboard


# Small items you can pick up
def it_apple(v):
    sphere('fruit_red', (0, 0, 0.045), 0.045, sub=2)
    cyl('bark', (0, 0, 0.085), 0.004, 0.02, 4)


def it_book(v):
    box(['book_a', 'book_b', 'book_c'][v % 3], (0, 0, 0.02), (0.16, 0.22, 0.04), bevel=0.003)


def it_cup(v):
    cyl('ceramic', (0, 0, 0), 0.04, 0.09, 12, r2=0.045)


def it_candle(v):
    cyl('ceramic', (0, 0, 0), 0.03, 0.14, 10)
    cone('fire', (0, 0, 0.14), 0.012, 0.04, 6)


FURNITURE = {
    'fu_bed': (fu_bed, 2), 'fu_sofa': (fu_sofa, 3), 'fu_armchair': (fu_armchair, 2), 'fu_chair': (fu_chair, 2),
    'fu_table': (fu_table, 2), 'fu_coffee_table': (fu_coffee_table, 1), 'fu_wardrobe': (fu_wardrobe, 2),
    'fu_wardrobe_door': (fu_wardrobe_door, 1), 'fu_fridge': (fu_fridge, 1), 'fu_fridge_door': (fu_fridge_door, 1),
    'fu_counter': (fu_counter, 2), 'fu_stove': (fu_stove, 1), 'fu_tv': (fu_tv, 1), 'fu_tv_screen': (fu_tv_screen, 1),
    'fu_radio': (fu_radio, 1), 'fu_lamp_floor': (fu_lamp_floor, 1), 'fu_lamp_table': (fu_lamp_table, 1),
    'fu_fireplace': (fu_fireplace, 1), 'fu_fire': (fu_fire, 1), 'fu_bookshelf': (fu_bookshelf, 2), 'fu_rug': (fu_rug, 2),
    'fu_plant': (fu_plant, 2), 'fu_desk': (fu_desk, 1),
    'it_apple': (it_apple, 1), 'it_book': (it_book, 3), 'it_cup': (it_cup, 1), 'it_candle': (it_candle, 1),
}


# ================================================================== SPACE
def loft(mat, sections, seg=16):
    """Hull through cross-sections (y, cx, cz, rx, r_top, r_bottom, squareness) ordered by y.
    Superellipse rings; faces wound outward; ends capped."""
    seg = seg if Q == 0 else max(8, seg // 2) if Q == 1 else 6
    if Q == 0 and len(sections) > 2:
        # Smooth the profile: Catmull-Rom between the given sections (3 in-betweens each)
        dense = []
        n = len(sections)
        for i in range(n - 1):
            p0, p1, p2, p3 = sections[max(0, i - 1)], sections[i], sections[i + 1], sections[min(n - 1, i + 2)]
            for k in range(4):
                t = k / 4
                t2, t3 = t * t, t * t * t
                dense.append(tuple(0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
                                   for a, b, c, d in zip(p0, p1, p2, p3)))
        dense.append(sections[-1])
        sections = dense
    rings = []
    for y, cx, cz, rx, rt, rb, p in sections:
        ring = []
        for i in range(seg):
            a = i / seg * TAU
            c, s = math.cos(a), math.sin(a)
            e = 2.0 / p
            x = cx + rx * math.copysign(abs(c) ** e, c)
            z = cz + (rt if s >= 0 else rb) * math.copysign(abs(s) ** e, s)
            ring.append((x, y, z))
        rings.append(ring)
    verts = [v for r in rings for v in r]
    faces = []
    for i in range(len(rings) - 1):
        for k in range(seg):
            a = i * seg + k
            b = i * seg + (k + 1) % seg
            faces.append([a, a + seg, b + seg, b])
    faces.append(list(range(seg)))  # first ring faces -Y
    last = (len(rings) - 1) * seg
    faces.append([last + k for k in range(seg)][::-1])
    poly(mat, verts, faces)


def ship_frigate(v):
    # Nose toward -Y, about 1.6 long. Main hull: a flattened wedge that swells aft.
    loft('hull', [
        (-0.82, 0, 0.02, 0.02, 0.01, 0.01, 2.0),
        (-0.66, 0, 0.03, 0.09, 0.05, 0.04, 2.2),
        (-0.40, 0, 0.05, 0.17, 0.10, 0.07, 2.6),
        (-0.10, 0, 0.06, 0.24, 0.13, 0.09, 3.0),
        (0.25, 0, 0.06, 0.27, 0.14, 0.10, 3.4),
        (0.55, 0, 0.05, 0.25, 0.12, 0.09, 3.4),
        (0.70, 0, 0.05, 0.20, 0.10, 0.08, 3.0),
    ], 40)
    # Armoured dorsal plate and a keel under the hull
    loft('hull_b', [
        (-0.3, 0, 0.1, 0.08, 0.05, 0.02, 2.6),
        (0.0, 0, 0.12, 0.17, 0.09, 0.02, 3.2),
        (0.35, 0, 0.13, 0.2, 0.1, 0.02, 3.6),
        (0.62, 0, 0.12, 0.17, 0.08, 0.02, 3.4),
    ], 32)
    loft('hull_dark', [
        (-0.45, 0, -0.03, 0.05, 0.02, 0.03, 2.4),
        (-0.1, 0, -0.04, 0.12, 0.02, 0.05, 3.0),
        (0.4, 0, -0.04, 0.14, 0.02, 0.05, 3.2),
        (0.66, 0, -0.03, 0.1, 0.02, 0.04, 3.0),
    ], 24)
    # Cockpit canopy
    loft('cockpit', [
        (-0.52, 0, 0.09, 0.02, 0.01, 0.01, 2.0),
        (-0.44, 0, 0.10, 0.07, 0.05, 0.02, 2.2),
        (-0.28, 0, 0.12, 0.09, 0.07, 0.02, 2.4),
        (-0.14, 0, 0.13, 0.08, 0.05, 0.02, 2.4),
        (-0.06, 0, 0.13, 0.03, 0.02, 0.01, 2.0),
    ], 16)
    # Swept wings with drooping tips
    for sx in (-1, 1):
        root_y0, root_y1 = -0.05, 0.45
        tip_y0, tip_y1 = 0.38, 0.58
        span = 0.62
        hull('hull_b', [
            (sx * 0.2, root_y0, 0.04), (sx * 0.2, root_y1, 0.04), (sx * 0.2, root_y0 + 0.05, 0.0), (sx * 0.2, root_y1, 0.0),
            (sx * span, tip_y0, -0.03), (sx * span, tip_y1, -0.03), (sx * span, tip_y0 + 0.02, -0.05), (sx * span, tip_y1, -0.05),
        ])
        hull('hull_dark', [
            (sx * span, tip_y0, -0.02), (sx * span, tip_y1 + 0.02, -0.02), (sx * (span + 0.03), tip_y0 + 0.05, -0.02), (sx * (span + 0.03), tip_y1 + 0.02, -0.02),
            (sx * (span + 0.02), tip_y0 + 0.08, -0.2), (sx * (span + 0.02), tip_y1, -0.2), (sx * (span + 0.05), tip_y0 + 0.1, -0.2), (sx * (span + 0.05), tip_y1, -0.2),
        ])
        # Engine nacelle along the wing root
        loft('hull_dark', [
            (0.05, sx * 0.33, 0.0, 0.03, 0.03, 0.03, 2.0),
            (0.12, sx * 0.33, 0.0, 0.085, 0.085, 0.085, 2.0),
            (0.62, sx * 0.33, 0.0, 0.1, 0.1, 0.1, 2.0),
            (0.78, sx * 0.33, 0.0, 0.085, 0.085, 0.085, 2.0),
        ], 32)
        if Q == 0:
            # Intake lip, cooling fins along the nacelle, RCS thruster blocks
            cyl('hull', (sx * 0.33, 0.06, 0.0), 0.075, 0.03, 24, rx=-math.pi / 2)
            for k in range(8):
                a = k / 8 * TAU
                box('hull_b', (sx * 0.33 + math.cos(a) * 0.1, 0.36, math.sin(a) * 0.1), (0.012, 0.3, 0.03), ry=-a, bevel=0)
            for dz in (-0.07, 0.07):
                box('hull_dark', (sx * 0.145, -0.45, dz * 0.5 + 0.05), (0.04, 0.05, 0.03), bevel=0.005)
                box('engine', (sx * 0.167, -0.45, dz * 0.5 + 0.05), (0.006, 0.03, 0.015), bevel=0)
        cyl('engine', (sx * 0.33, 0.78, 0.0), 0.07, 0.02, 16, rx=-math.pi / 2)
        if Q == 0:
            cyl('hull', (sx * 0.33, 0.2, 0.0), 0.103, 0.04, 16, rx=-math.pi / 2)
            cyl('hull', (sx * 0.33, 0.5, 0.0), 0.106, 0.04, 16, rx=-math.pi / 2)
            box('flag_green', (sx * 0.42, 0.18, 0.035), (0.3, 0.12, 0.012), rz=sx * 0.35, bevel=0)
    # Dorsal fin, tail fins, rear engine block
    hull('hull_b', [(0, 0.2, 0.18), (0, 0.66, 0.16), (0, 0.62, 0.34), (0, 0.5, 0.36), (0.015, 0.3, 0.18), (-0.015, 0.3, 0.18), (0.015, 0.6, 0.18), (-0.015, 0.6, 0.18)])
    for sx in (-1, 1):
        hull('hull_b', [(sx * 0.12, 0.45, 0.12), (sx * 0.14, 0.68, 0.1), (sx * 0.34, 0.66, 0.3), (sx * 0.3, 0.58, 0.31),
                        (sx * 0.125, 0.5, 0.1), (sx * 0.135, 0.66, 0.08)])
    box('hull_dark', (0, 0.72, 0.05), (0.3, 0.06, 0.14), bevel=0.01)
    box('engine', (0, 0.755, 0.05), (0.22, 0.02, 0.08), bevel=0)
    if Q == 0:
        # Panel lines, windows, the faction stripe, sensor dish and antennas
        for y in (-0.3, 0.0, 0.3):
            box('hull_dark', (0, y, 0.2 if y > -0.2 else 0.15), (0.3 if y > -0.2 else 0.2, 0.008, 0.01), bevel=0)
        box('flag_green', (0, 0.1, 0.205), (0.07, 0.55, 0.008), bevel=0)
        for sx in (-1, 1):
            for k in range(5):
                box('cockpit', (sx * 0.245, -0.05 + k * 0.1, 0.07), (0.01, 0.04, 0.018), bevel=0)
        cyl('hull_dark', (0, -0.05, -0.07), 0.05, 0.03, 12, rx=math.pi)
        cyl('steel', (0.06, 0.55, 0.3), 0.004, 0.18, 4)
        cyl('steel', (-0.04, 0.5, 0.33), 0.004, 0.12, 4)
        for sx in (-1, 1):
            box('hull_dark', (sx * 0.12, 0.25, -0.03), (0.08, 0.2, 0.012), bevel=0)  # gear bays
        # Greebles: vents and plates along the spine and flanks (deterministic)
        g = random.Random(42)
        for k in range(70):
            y = -0.35 + g.random() * 0.95
            side = g.choice((-1, 1))
            x = side * (0.03 + g.random() * 0.14)
            z = 0.16 + (0.11 - abs(x)) * 0.25
            sz = (0.02 + g.random() * 0.04, 0.02 + g.random() * 0.06, 0.008 + g.random() * 0.012)
            box(g.choice(('hull_dark', 'hull_b', 'steel')), (x, y, z), sz, bevel=0)
        for sx in (-1, 1):
            for k in range(10):
                y = -0.25 + k * 0.08
                box('hull_dark', (sx * (0.265 - abs(y) * 0.05), y, 0.03), (0.01, 0.05, 0.012), bevel=0)
        # Nose sensor cluster and a chin turret
        sphere('cockpit', (0, -0.8, 0.02), 0.015, sub=2)
        cyl('hull_dark', (0, -0.3, -0.08), 0.035, 0.04, 16, rx=math.pi)
        box('steel', (0, -0.35, -0.12), (0.012, 0.1, 0.012), bevel=0)


def engine_pod(x, y0, y1, z, r, glow=True, seg=24):
    loft('hull_dark', [(y0, x, z, r * 0.4, r * 0.4, r * 0.4, 2.0), (y0 + (y1 - y0) * 0.15, x, z, r, r, r, 2.0),
                       (y1 - (y1 - y0) * 0.1, x, z, r * 1.05, r * 1.05, r * 1.05, 2.0), (y1, x, z, r * 0.85, r * 0.85, r * 0.85, 2.0)], seg)
    if glow:
        cyl('engine', (x, y1, z), r * 0.7, 0.02, seg, rx=-math.pi / 2)
    if Q == 0:
        cyl('hull', (x, y0 + (y1 - y0) * 0.5, z), r * 1.07, (y1 - y0) * 0.08, seg, rx=-math.pi / 2)


def ship_interceptor(v):
    # Needle nose, forward-swept wings, one big engine: fast and twitchy
    loft('hull', [(-0.75, 0, 0.0, 0.015, 0.01, 0.01, 2.0), (-0.5, 0, 0.02, 0.07, 0.05, 0.03, 2.4), (-0.15, 0, 0.03, 0.13, 0.08, 0.05, 2.8),
                  (0.2, 0, 0.03, 0.16, 0.09, 0.06, 3.0), (0.45, 0, 0.03, 0.14, 0.08, 0.06, 3.0)], 36)
    loft('cockpit', [(-0.38, 0, 0.06, 0.01, 0.01, 0.01, 2.0), (-0.3, 0, 0.07, 0.05, 0.04, 0.01, 2.2), (-0.12, 0, 0.09, 0.06, 0.05, 0.01, 2.4), (0.0, 0, 0.09, 0.02, 0.02, 0.01, 2.0)], 16)
    for sx in (-1, 1):
        hull('hull_b', [(sx * 0.12, 0.3, 0.02), (sx * 0.12, 0.05, 0.02), (sx * 0.12, 0.28, -0.01), (sx * 0.12, 0.08, -0.01),
                        (sx * 0.62, -0.2, 0.0), (sx * 0.62, -0.08, 0.0), (sx * 0.62, -0.19, -0.02)])
        hull('flag_red' if v else 'accent_green', [(sx * 0.5, -0.17, 0.005), (sx * 0.5, -0.09, 0.005), (sx * 0.62, -0.2, 0.004), (sx * 0.62, -0.08, 0.004),
                                                   (sx * 0.5, -0.17, 0.012), (sx * 0.62, -0.08, 0.012)])
        cyl('steel', (sx * 0.62, -0.35, 0.0), 0.012, 0.3, 6, rx=-math.pi / 2)  # wingtip cannons
        hull('hull_b', [(sx * 0.08, 0.25, 0.08), (sx * 0.08, 0.45, 0.08), (sx * 0.2, 0.42, 0.24), (sx * 0.19, 0.36, 0.25), (sx * 0.085, 0.3, 0.06)])
    engine_pod(0, 0.3, 0.72, 0.03, 0.11)
    if Q == 0:
        g = random.Random(7)
        for k in range(30):
            y = -0.2 + g.random() * 0.6
            x = (g.random() - 0.5) * 0.18
            box(g.choice(('hull_dark', 'hull_b')), (x, y, 0.105), (0.02 + g.random() * 0.03, 0.02 + g.random() * 0.05, 0.01), bevel=0)


def ship_freighter(v):
    # Boxy hauler: cab up front, spine with cargo pods, four engines
    loft('hull', [(-1.0, 0, 0.05, 0.05, 0.04, 0.04, 2.4), (-0.85, 0, 0.08, 0.22, 0.16, 0.1, 3.0), (-0.55, 0, 0.1, 0.3, 0.2, 0.13, 3.6),
                  (-0.35, 0, 0.1, 0.3, 0.2, 0.13, 3.6)], 32)
    loft('cockpit', [(-0.9, 0, 0.16, 0.02, 0.02, 0.01, 2.0), (-0.82, 0, 0.2, 0.14, 0.07, 0.01, 2.6), (-0.66, 0, 0.24, 0.16, 0.07, 0.01, 2.8), (-0.55, 0, 0.25, 0.08, 0.04, 0.01, 2.2)], 16)
    box('hull_dark', (0, 0.25, 0.1), (0.2, 1.3, 0.16), bevel=0.02)  # spine
    cols = ['c_red', 'c_blue', 'c_yellow', 'c_green']
    for k in range(4):
        for sx in (-1, 1):
            box(cols[(k + (sx > 0)) % 4] if Q < 2 else 'hull_b', (sx * 0.2, -0.2 + k * 0.3, 0.12), (0.22, 0.26, 0.22), bevel=0.01)
            if Q == 0:
                for rib in (-0.08, 0.0, 0.08):
                    box('steel', (sx * 0.2, -0.2 + k * 0.3 + rib, 0.235), (0.225, 0.015, 0.01), bevel=0)
    box('hull', (0, 0.95, 0.1), (0.62, 0.3, 0.3), bevel=0.03)
    for sx in (-1, 1):
        for sz in (-1, 1):
            engine_pod(sx * 0.2, 1.0, 1.35, 0.1 + sz * 0.1, 0.08)
    if Q < 2:
        for sx in (-1, 1):
            hull('hull_b', [(sx * 0.3, -0.5, 0.08), (sx * 0.3, -0.3, 0.08), (sx * 0.55, -0.35, 0.05), (sx * 0.55, -0.28, 0.05), (sx * 0.3, -0.42, 0.04)])
        cyl('steel', (0.05, -0.45, 0.3), 0.01, 0.14, 4)
        cyl('hull_dark', (0, 0.6, 0.28), 0.06, 0.02, 12)


def ship_cargo(v):
    # NPC hauler: very long spine of containers
    loft('hull', [(-1.9, 0, 0.1, 0.1, 0.08, 0.08, 2.6), (-1.6, 0, 0.15, 0.35, 0.25, 0.18, 3.2), (-1.2, 0, 0.15, 0.36, 0.26, 0.18, 3.4)], 24)
    box('hull_dark', (0, 0.3, 0.15), (0.24, 3.0, 0.2), bevel=0.02)
    cols = ['c_red', 'c_blue', 'c_yellow', 'c_green', 'car_white']
    for k in range(8):
        for sx in (-1, 1):
            box(cols[(k * 2 + (sx > 0)) % 5] if Q < 2 else 'hull_b', (sx * 0.24, -0.9 + k * 0.33, 0.18), (0.26, 0.3, 0.28), bevel=0.01)
    box('hull', (0, 1.9, 0.15), (0.8, 0.4, 0.45), bevel=0.04)
    for sx in (-1, 0, 1):
        engine_pod(sx * 0.26, 2.0, 2.4, 0.15, 0.11, seg=16)


def ship_patrol(v):
    ship_interceptor(1)
    if Q < 2:
        for sx in (-1, 1):
            engine_pod(sx * 0.3, 0.1, 0.5, -0.05, 0.06, seg=16)
        box('police_blue', (0, 0.1, 0.12), (0.12, 0.3, 0.02), bevel=0)


def rover(v):
    """Six-wheeled armoured rover (Mako style), about 2 units long, nose = -Y."""
    hull('hull_b', [(-0.45, -0.95, 0.35), (0.45, -0.95, 0.35), (-0.5, 0.95, 0.4), (0.5, 0.95, 0.4),
                    (-0.38, -0.75, 0.62), (0.38, -0.75, 0.62), (-0.42, 0.8, 0.7), (0.42, 0.8, 0.7),
                    (-0.3, -0.2, 0.82), (0.3, -0.2, 0.82), (-0.34, 0.6, 0.84), (0.34, 0.6, 0.84)])
    hull('glass_dark', [(-0.3, -0.62, 0.66), (0.3, -0.62, 0.66), (-0.26, -0.3, 0.8), (0.26, -0.3, 0.8), (-0.3, -0.62, 0.64), (0.3, -0.62, 0.64)])
    for sx in (-1, 1):
        for y in (-0.62, 0.05, 0.72):
            cyl('rubber', (sx * 0.52 - 0.12, y, 0.3), 0.3, 0.24, 16, ry=math.pi / 2)
            if Q < 2:
                cyl('steel', (sx * 0.64 - (0.02 if sx > 0 else 0), y, 0.3), 0.15, 0.03, 10, ry=math.pi / 2)
        box('hull_dark', (sx * 0.5, 0.05, 0.62), (0.1, 1.9, 0.08), bevel=0.02)  # fenders
    # Turret and gun
    cyl('hull_dark', (0, 0.35, 0.84), 0.2, 0.12, 16)
    box('hull_b', (0, 0.3, 1.0), (0.28, 0.4, 0.16), bevel=0.03)
    cyl('steel', (0, 0.1, 1.0), 0.04, 0.6, 8, rx=math.pi / 2)
    if Q < 2:
        for sx in (-1, 1):
            box('lamp', (sx * 0.3, -0.97, 0.5), (0.12, 0.03, 0.07), bevel=0)
        box('accent_green', (0, 0.2, 0.845), (0.5, 0.9, 0.01), bevel=0)
        cyl('steel', (0.3, 0.7, 0.84), 0.008, 0.35, 4)


SPACE = {'ship_frigate': (ship_frigate, 1), 'ship_interceptor': (ship_interceptor, 1), 'ship_freighter': (ship_freighter, 1),
         'ship_cargo': (ship_cargo, 1), 'ship_patrol': (ship_patrol, 1), 'rover': (rover, 1)}


# ================================================================== CHARACTER (rigged, separate file)
BONES = {
    # name: (head, tail, parent)
    'hips': ((0, 0, 0.94), (0, 0, 1.08), None),
    'spine': ((0, 0, 1.08), (0, 0, 1.42), 'hips'),
    'head': ((0, 0, 1.46), (0, 0, 1.78), 'spine'),
    'upper_arm.L': ((0.22, 0, 1.42), (0.24, 0, 1.14), 'spine'),
    'lower_arm.L': ((0.24, 0, 1.14), (0.25, 0, 0.88), 'upper_arm.L'),
    'upper_arm.R': ((-0.22, 0, 1.42), (-0.24, 0, 1.14), 'spine'),
    'lower_arm.R': ((-0.24, 0, 1.14), (-0.25, 0, 0.88), 'upper_arm.R'),
    'thigh.L': ((0.1, 0, 0.92), (0.1, 0, 0.5), 'hips'),
    'shin.L': ((0.1, 0, 0.5), (0.1, 0, 0.09), 'thigh.L'),
    'thigh.R': ((-0.1, 0, 0.92), (-0.1, 0, 0.5), 'hips'),
    'shin.R': ((-0.1, 0, 0.5), (-0.1, 0, 0.09), 'thigh.R'),
}


OUTFITS = {
    # name: skin, hair colour, hair style, top colour, top style, legs colour, legs style, shoes, extras
    'explorer': dict(skin='skin', hair='hair', hairs='short', top='shirt', tops='jacket', legs='pants', legss='pants', shoes='boots', extra=['backpack']),
    'explorer_red': dict(skin='skin', hair='hair', hairs='short', top='shirt_red', tops='jacket', legs='pants', legss='pants', shoes='boots', extra=['backpack']),
    'casual_m': dict(skin='skin_b', hair='hair', hairs='short', top='shirt_blue', tops='shirt', legs='jeans', legss='pants', shoes='boots', extra=[]),
    'casual_f': dict(skin='skin', hair='hair_blond', hairs='long', top='dress', tops='dress', legs='skin', legss='bare', shoes='belt', extra=[]),
    'worker': dict(skin='skin_c', hair='hair', hairs='short', top='shirt_white', tops='shirt', legs='pants', legss='pants', shoes='boots', extra=['vest', 'helmet']),
    'business': dict(skin='skin_d', hair='hair', hairs='short', top='suit', tops='suit', legs='suit', legss='pants', shoes='car_black', extra=['tie']),
    'elder': dict(skin='skin', hair='hair_grey', hairs='bald', top='wood_mid', tops='jacket', legs='jeans', legss='pants', shoes='boots', extra=[]),
    'peasant': dict(skin='skin_b', hair='hair_red', hairs='short', top='tunic', tops='tunic', legs='wood_dark', legss='pants', shoes='boots', extra=['hood']),
    'guard': dict(skin='skin_c', hair='hair', hairs='short', top='armor', tops='armor', legs='pants', legss='pants', shoes='boots', extra=['helmet_steel', 'tabard']),
    'townsfolk_f': dict(skin='skin_d', hair='hair_red', hairs='bun', top='skirt', tops='dress', legs='skin_d', legss='bare', shoes='belt', extra=['apron']),
}


def person_parts(o):
    """[(bone, verts, faces, material index)] for one outfit (front = -Y, about 1.8 m)."""
    out = []

    def grab(bone):
        for vs, fs, mi in PARTS:
            out.append((bone, vs, fs, mi))
        PARTS.clear()

    PARTS.clear()
    skin, top, legs = o['skin'], o['top'], o['legs']
    # Hips (and the skirt of a dress, which moves with the hips)
    box(legs if o['legss'] != 'bare' else top, (0, 0, 0.94), (0.34, 0.2, 0.18), bevel=0.03)
    if o['tops'] in ('dress', 'tunic'):
        cyl(top, (0, 0, 1.06 - (0.62 if o['tops'] == 'dress' else 0.34)), 0.3 if o['tops'] == 'dress' else 0.22, (0.62 if o['tops'] == 'dress' else 0.34), 14, r2=0.18)
    else:
        box('belt', (0, 0, 1.03), (0.36, 0.22, 0.06), bevel=0.01)
        box('gold', (0, -0.115, 1.03), (0.06, 0.02, 0.05), bevel=0)
    if 'apron' in o['extra']:
        box('linen', (0, -0.2, 0.75), (0.34, 0.03, 0.5), bevel=0)
    if 'tabard' in o['extra']:
        box('flag_red', (0, -0.14, 0.85), (0.3, 0.03, 0.42), bevel=0)
    grab('hips')
    # Torso
    wide = 0.25 if o['tops'] == 'armor' else 0.22
    hull(top, [(-0.17, -0.11, 1.06), (0.17, -0.11, 1.06), (-0.17, 0.1, 1.06), (0.17, 0.1, 1.06),
               (-wide, -0.12, 1.36), (wide, -0.12, 1.36), (-wide, 0.11, 1.36), (wide, 0.11, 1.36),
               (-0.16, -0.09, 1.45), (0.16, -0.09, 1.45), (-0.16, 0.09, 1.45), (0.16, 0.09, 1.45)])
    if o['tops'] == 'jacket':
        box('pants', (0, -0.125, 1.24), (0.05, 0.02, 0.34), bevel=0)
        box(top, (0, 0.01, 1.47), (0.2, 0.16, 0.06), bevel=0.02)
    elif o['tops'] == 'suit':
        box('shirt_white', (0, -0.122, 1.36), (0.1, 0.02, 0.18), bevel=0)
    elif o['tops'] == 'armor':
        box('steel_dark', (0, -0.13, 1.18), (0.3, 0.02, 0.04), bevel=0)
    if 'tie' in o['extra']:
        box('tie', (0, -0.13, 1.28), (0.04, 0.02, 0.2), bevel=0)
    if 'vest' in o['extra']:
        hull('vest', [(-0.18, -0.13, 1.08), (0.18, -0.13, 1.08), (-0.2, -0.13, 1.4), (0.2, -0.13, 1.4),
                      (-0.18, 0.12, 1.08), (0.18, 0.12, 1.08), (-0.2, 0.12, 1.4), (0.2, 0.12, 1.4)])
        box('lamp', (0, -0.14, 1.2), (0.36, 0.01, 0.03), bevel=0)
    for sx in (-1, 1):
        sphere('armor' if o['tops'] == 'armor' else top, (sx * 0.22, 0, 1.4), 0.08 if o['tops'] == 'armor' else 0.075, (1.2 if o['tops'] == 'armor' else 1, 1.1, 0.9), sub=2)
    if 'backpack' in o['extra']:
        box('belt', (0, 0.16, 1.25), (0.26, 0.1, 0.3), bevel=0.03)
        box('boots', (0, 0.215, 1.18), (0.2, 0.02, 0.1), bevel=0)
    grab('spine')
    # Head
    cyl(skin, (0, 0, 1.46), 0.05, 0.06, 10)
    box(skin, (0, 0, 1.64), (0.2, 0.2, 0.24), bevel=0.05)
    for sx in (-1, 1):
        box(skin, (sx * 0.105, 0.02, 1.64), (0.02, 0.05, 0.06), bevel=0)
        box('iron', (sx * 0.045, -0.101, 1.665), (0.03, 0.01, 0.03), bevel=0)
    box(skin, (0, -0.11, 1.625), (0.035, 0.03, 0.05), bevel=0)
    hs, hc = o['hairs'], o['hair']
    if 'helmet' in o['extra']:
        sphere('helmet', (0, 0, 1.74), 0.13, (1.05, 1.05, 0.75), sub=2)
        box('helmet', (0, -0.08, 1.71), (0.26, 0.1, 0.02), bevel=0)
    elif 'helmet_steel' in o['extra']:
        sphere('armor', (0, 0, 1.73), 0.135, (1.05, 1.05, 0.8), sub=2)
        box('armor', (0, -0.1, 1.65), (0.03, 0.02, 0.1), bevel=0)  # nose guard
    elif 'hood' in o['extra']:
        hull('hood', [(-0.13, -0.08, 1.52), (0.13, -0.08, 1.52), (-0.14, 0.13, 1.5), (0.14, 0.13, 1.5),
                      (-0.12, -0.1, 1.8), (0.12, -0.1, 1.8), (-0.1, 0.12, 1.83), (0.1, 0.12, 1.83), (0, 0.16, 1.7)])
    elif hs == 'short':
        box(hc, (0, 0.015, 1.765), (0.215, 0.215, 0.06), bevel=0.03)
        box(hc, (0, 0.1, 1.69), (0.215, 0.03, 0.16), bevel=0.01)
        for sx in (-1, 1):
            box(hc, (sx * 0.1, 0.03, 1.72), (0.03, 0.16, 0.08), bevel=0)
    elif hs == 'long':
        box(hc, (0, 0.015, 1.765), (0.22, 0.22, 0.07), bevel=0.03)
        box(hc, (0, 0.11, 1.56), (0.24, 0.05, 0.42), bevel=0.02)
        for sx in (-1, 1):
            box(hc, (sx * 0.11, 0.03, 1.62), (0.03, 0.16, 0.3), bevel=0)
    elif hs == 'bun':
        box(hc, (0, 0.015, 1.765), (0.215, 0.215, 0.06), bevel=0.03)
        sphere(hc, (0, 0.12, 1.76), 0.07, sub=1)
    elif hs == 'bald':
        for sx in (-1, 1):
            box(hc, (sx * 0.1, 0.04, 1.68), (0.03, 0.14, 0.07), bevel=0)
    grab('head')
    for side, sx in (('L', 1), ('R', -1)):
        sleeve = 'armor' if o['tops'] == 'armor' else top if o['tops'] != 'dress' else skin
        cyl(sleeve, (sx * 0.235, 0, 1.13), 0.058, 0.3, 10, r2=0.062)
        grab(f'upper_arm.{side}')
        cyl(sleeve if o['tops'] in ('jacket', 'suit', 'armor') else skin, (sx * 0.245, 0, 0.93), 0.05, 0.21, 10, r2=0.056)
        if o['tops'] in ('jacket', 'suit'):
            cyl('belt' if o['tops'] == 'jacket' else 'shirt_white', (sx * 0.245, 0, 0.9), 0.056, 0.05, 10)
        box(skin, (sx * 0.25, 0, 0.84), (0.07, 0.09, 0.1), bevel=0.02)
        grab(f'lower_arm.{side}')
        cyl(legs, (sx * 0.1, 0, 0.5), 0.068, 0.44, 10, r2=0.078)
        grab(f'thigh.{side}')
        cyl(legs, (sx * 0.1, 0, 0.2), 0.058, 0.32, 10, r2=0.066)
        box(o['shoes'], (sx * 0.1, -0.035, 0.1), (0.13, 0.22, 0.2) if o['shoes'] == 'boots' else (0.11, 0.2, 0.1), bevel=0.03)
        box(o['shoes'], (sx * 0.1, -0.04, 0.02), (0.14, 0.25, 0.04), bevel=0)
        grab(f'shin.{side}')
    return out


def character_parts():
    return person_parts(OUTFITS['explorer'])


def build_character():
    arm_data = bpy.data.armatures.new('PeopleRig')
    arm = bpy.data.objects.new('PeopleRig', arm_data)
    coll('Character').objects.link(arm)
    # Edit bones need edit mode: build them through the object's data in edit mode
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    for name, (h, t, parent) in BONES.items():
        b = arm_data.edit_bones.new(name)
        b.head = h
        b.tail = t
        b.roll = 0
        if parent:
            b.parent = arm_data.edit_bones[parent]
            b.use_connect = False
    bpy.ops.object.mode_set(mode='OBJECT')

    global Q
    Q = 0
    people_mat = bpy.data.materials.new('M_people')
    people_mat.use_nodes = True
    # Base colour from the 'Col' corner attribute (so previews and the glTF agree)
    nt = people_mat.node_tree
    attr = nt.nodes.new('ShaderNodeVertexColor')
    attr.layer_name = 'Col'
    nt.links.new(attr.outputs['Color'], nt.nodes.get('Principled BSDF').inputs['Base Color'])
    bodies = []
    for outfit, spec in OUTFITS.items():
        parts = person_parts(spec)
        verts, faces, mats, groups = [], [], [], {}
        for bone, vs, fs, mi in parts:
            base = len(verts)
            verts.extend(vs)
            groups.setdefault(bone, []).extend(range(base, base + len(vs)))
            for f in fs:
                faces.append([i + base for i in f])
                mats.append(mi)
        me = bpy.data.meshes.new(outfit)
        me.from_pydata(verts, [], faces)
        me.materials.append(people_mat)
        for p in me.polygons:
            p.use_smooth = False
        # Palette colours as a corner colour attribute: one material, one draw call per person
        col = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
        for p, mi in zip(me.polygons, mats):
            c = MATERIALS[mi].diffuse_color
            for li in p.loop_indices:
                col.data[li].color = (c[0], c[1], c[2], 1.0)
        me.color_attributes.active_color = col
        me.validate(clean_customdata=False)
        body = bpy.data.objects.new(outfit, me)
        coll('Character').objects.link(body)
        for bone, idx in groups.items():
            vg = body.vertex_groups.new(name=bone)
            vg.add(idx, 1.0, 'REPLACE')
        body.parent = arm
        mod = body.modifiers.new('Armature', 'ARMATURE')
        mod.object = arm
        bodies.append(body)
    body = bodies[0]

    # Animations: rotation (euler XYZ) on the pose bones, hips bob on location.
    # A positive X rotation swings a down-pointing limb backward (the character faces -Y).
    for pb in arm.pose.bones:
        pb.rotation_mode = 'XYZ'
    arm.animation_data_create()
    fps = 24
    bpy.context.scene.render.fps = fps

    def make_action(name, frames, pose_at):
        act = bpy.data.actions.new(name)
        arm.animation_data.action = act
        for f in range(frames + 1):
            t = f / frames
            for pb in arm.pose.bones:
                pb.rotation_euler = (0, 0, 0)
                pb.location = (0, 0, 0)
            pose_at(t)
            for pb in arm.pose.bones:
                pb.keyframe_insert('rotation_euler', frame=f + 1)
            arm.pose.bones['hips'].keyframe_insert('location', frame=f + 1)
        act.use_fake_user = True
        track = arm.animation_data.nla_tracks.new()
        track.name = name
        track.strips.new(name, 1, act)
        track.mute = True
        arm.animation_data.action = None
        return act

    P = arm.pose.bones
    s = math.sin

    def idle(t):
        b = s(t * TAU)
        P['spine'].rotation_euler = (b * 0.03, 0, 0)
        P['head'].rotation_euler = (-b * 0.02, s(t * TAU * 0.5) * 0.05, 0)
        P['upper_arm.L'].rotation_euler = (b * 0.03, 0, -0.08)
        P['upper_arm.R'].rotation_euler = (b * 0.03, 0, 0.08)
        P['lower_arm.L'].rotation_euler = (-0.12, 0, 0)
        P['lower_arm.R'].rotation_euler = (-0.12, 0, 0)
        P['hips'].location = (0, b * 0.006, 0)  # a bone's local Y runs along it (up for the hips)

    def gait(swing, knee, arm_swing, elbow, lean, bob):
        def pose(t):
            ph = t * TAU
            P['thigh.L'].rotation_euler = (-s(ph) * swing, 0, 0)
            P['thigh.R'].rotation_euler = (s(ph) * swing, 0, 0)
            # Knee bends while the leg swings forward (and never backward)
            P['shin.L'].rotation_euler = (max(0.0, s(ph - 1.2)) * knee + 0.05, 0, 0)
            P['shin.R'].rotation_euler = (max(0.0, s(ph - 1.2 + math.pi)) * knee + 0.05, 0, 0)
            P['upper_arm.L'].rotation_euler = (s(ph) * arm_swing, 0, -0.06)
            P['upper_arm.R'].rotation_euler = (-s(ph) * arm_swing, 0, 0.06)
            P['lower_arm.L'].rotation_euler = (-elbow - max(0.0, -s(ph)) * elbow * 0.6, 0, 0)
            P['lower_arm.R'].rotation_euler = (-elbow - max(0.0, s(ph)) * elbow * 0.6, 0, 0)
            P['spine'].rotation_euler = (-lean, s(ph) * 0.08, 0)
            P['head'].rotation_euler = (lean * 0.6, -s(ph) * 0.06, 0)
            P['hips'].location = (0, -abs(math.cos(ph)) * bob, 0)
        return pose

    def sit(t):
        b = s(t * TAU)
        P['hips'].location = (0, -0.47, 0)
        P['thigh.L'].rotation_euler = (-1.5, 0, 0.04)
        P['thigh.R'].rotation_euler = (-1.5, 0, -0.04)
        P['shin.L'].rotation_euler = (1.45, 0, 0)
        P['shin.R'].rotation_euler = (1.45, 0, 0)
        P['spine'].rotation_euler = (-0.06 + b * 0.02, 0, 0)
        P['upper_arm.L'].rotation_euler = (-0.55, 0, -0.1)
        P['upper_arm.R'].rotation_euler = (-0.55, 0, 0.1)
        P['lower_arm.L'].rotation_euler = (-0.5, 0, 0)
        P['lower_arm.R'].rotation_euler = (-0.5, 0, 0)
        P['head'].rotation_euler = (0.05, s(t * TAU * 0.5) * 0.15, 0)

    def sleep(t):
        b = s(t * TAU)
        # Lying on the back: the whole body pivots back about the hips
        P['hips'].rotation_euler = (-1.57, 0, 0)
        P['spine'].rotation_euler = (b * 0.02, 0, 0)
        P['upper_arm.L'].rotation_euler = (0.05, 0, -0.12)
        P['upper_arm.R'].rotation_euler = (0.05, 0, 0.12)
        P['thigh.L'].rotation_euler = (0.03, 0, 0.03)
        P['thigh.R'].rotation_euler = (0.03, 0, -0.03)
        P['head'].rotation_euler = (-0.15, 0.2, 0)

    def drive(t):
        sit(t)
        P['upper_arm.L'].rotation_euler = (-1.05, 0, -0.15)
        P['upper_arm.R'].rotation_euler = (-1.05, 0, 0.15)
        P['lower_arm.L'].rotation_euler = (-0.35, 0, 0)
        P['lower_arm.R'].rotation_euler = (-0.35, 0, 0)

    def panic(t):
        gait(0.9, 1.7, 0.2, 0.2, 0.1, 0.08)(t)
        # Arms up, flailing
        ph = t * TAU
        P['upper_arm.L'].rotation_euler = (-2.6 + s(ph * 2) * 0.3, 0, -0.3)
        P['upper_arm.R'].rotation_euler = (-2.6 - s(ph * 2) * 0.3, 0, 0.3)

    make_action('idle', 48, idle)
    make_action('walk', 24, gait(0.5, 0.9, 0.42, 0.25, 0.05, 0.035))
    make_action('run', 16, gait(0.85, 1.6, 0.9, 1.1, 0.22, 0.07))
    make_action('sit', 48, sit)
    make_action('sleep', 48, sleep)
    make_action('drive', 24, drive)
    make_action('panic', 14, panic)
    return arm, bodies


# ================================================================== INTERIOR TEXTURE ATLAS
# 4 x 4 tiles of 512 px, rendered flat (emission, Standard view transform) from
# procedural node materials. The app samples a tile with mirrored repeat, so
# the textures need not be seamless.
ATLAS_TILES = [
    'wood_floor', 'parquet', 'kitchen_tiles', 'carpet',
    'wallpaper_stripes', 'wallpaper_pattern', 'plaster', 'brick',
    'stone', 'wood_panel', 'marble', 'concrete',
    'bath_tiles', 'rug', 'ceiling', 'fabric',
]


def atlas_material(name):
    m = bpy.data.materials.new(f'ATLAS_{name}')
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')
    nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    tc = nt.nodes.new('ShaderNodeTexCoord')
    co = tc.outputs['Object']
    rgb = lambda h: (*srgb(h), 1)

    def mix(a, b, fac):
        mx = nt.nodes.new('ShaderNodeMix')
        mx.data_type = 'RGBA'
        nt.links.new(fac, mx.inputs['Factor'])
        if isinstance(a, tuple):
            mx.inputs['A'].default_value = a
        else:
            nt.links.new(a, mx.inputs['A'])
        if isinstance(b, tuple):
            mx.inputs['B'].default_value = b
        else:
            nt.links.new(b, mx.inputs['B'])
        return mx.outputs['Result']

    def noise(scale, detail=4, rough=0.5, vec=None):
        n = nt.nodes.new('ShaderNodeTexNoise')
        n.inputs['Scale'].default_value = scale
        n.inputs['Detail'].default_value = detail
        n.inputs['Roughness'].default_value = rough
        nt.links.new(vec or co, n.inputs['Vector'])
        return n.outputs['Fac']

    def brick(c1, c2, mortar, scale, w=0.5, h=0.25, msize=0.02, vec=None):
        b = nt.nodes.new('ShaderNodeTexBrick')
        b.inputs['Color1'].default_value = rgb(c1)
        b.inputs['Color2'].default_value = rgb(c2)
        b.inputs['Mortar'].default_value = rgb(mortar)
        b.inputs['Scale'].default_value = scale
        b.inputs['Mortar Size'].default_value = msize
        b.inputs['Brick Width'].default_value = w
        b.inputs['Row Height'].default_value = h
        nt.links.new(vec or co, b.inputs['Vector'])
        return b.outputs['Color']

    def checker(c1, c2, scale):
        c = nt.nodes.new('ShaderNodeTexChecker')
        c.inputs['Color1'].default_value = rgb(c1)
        c.inputs['Color2'].default_value = rgb(c2)
        c.inputs['Scale'].default_value = scale
        nt.links.new(co, c.inputs['Vector'])
        return c.outputs['Color']

    def wave(scale, distortion=0.0, bands='X'):
        w = nt.nodes.new('ShaderNodeTexWave')
        w.bands_direction = bands
        w.inputs['Scale'].default_value = scale
        w.inputs['Distortion'].default_value = distortion
        nt.links.new(co, w.inputs['Vector'])
        return w.outputs['Fac']

    def voronoi(scale):
        v = nt.nodes.new('ShaderNodeTexVoronoi')
        v.inputs['Scale'].default_value = scale
        nt.links.new(co, v.inputs['Vector'])
        return v.outputs['Distance']

    if name == 'wood_floor':
        c = brick(0x9a6a42, 0x86593a, 0x5a3a24, 3.0, w=1.6, h=0.2, msize=0.006)
        c = mix(c, (*srgb(0x6e4a2e), 1), noise(18, 6, 0.6))
        color = mix(c, (*srgb(0xb07a4c), 1), wave(6, 8))
    elif name == 'parquet':
        color = mix(brick(0xb58a5a, 0x9c7248, 0x6b4a2e, 6.0, w=0.5, h=0.12, msize=0.008), (*srgb(0x7a5230), 1), noise(30, 4, 0.5))
    elif name == 'kitchen_tiles':
        color = mix(checker(0xf2efe8, 0x3a4150, 8.0), (*srgb(0xd8d4cc), 1), noise(40, 2, 0.4))
    elif name == 'carpet':
        color = mix((*srgb(0x5f7fa8), 1), (*srgb(0x4a6690), 1), noise(60, 8, 0.8))
    elif name == 'wallpaper_stripes':
        color = mix((*srgb(0xe9dcc0), 1), (*srgb(0xc9b58c), 1), wave(10, 0, 'X'))
    elif name == 'wallpaper_pattern':
        color = mix((*srgb(0xb9cfc0), 1), (*srgb(0x8aa896), 1), voronoi(9))
    elif name == 'plaster':
        color = mix((*srgb(0xf1e9da), 1), (*srgb(0xdcd0ba), 1), noise(6, 6, 0.6))
    elif name == 'brick':
        color = mix(brick(0xb45a3c, 0x9a4630, 0xd8cfc0, 4.0, w=0.5, h=0.18, msize=0.02), (*srgb(0x7f3a26), 1), noise(20, 4, 0.5))
    elif name == 'stone':
        color = mix((*srgb(0xbdb6a8), 1), (*srgb(0x8b8377), 1), voronoi(5))
    elif name == 'wood_panel':
        color = mix(brick(0x8a5a33, 0x7a4e2c, 0x4a3020, 2.0, w=0.25, h=2.0, msize=0.01), (*srgb(0x6b4426), 1), wave(3, 6, 'Y'))
    elif name == 'marble':
        color = mix((*srgb(0xf2f0ec), 1), (*srgb(0x9aa0a8), 1), wave(2, 12, 'X'))
    elif name == 'concrete':
        color = mix((*srgb(0xc9c7c1), 1), (*srgb(0xa9a7a1), 1), noise(12, 8, 0.7))
    elif name == 'bath_tiles':
        color = brick(0xdfeef2, 0xd2e6ec, 0xffffff, 8.0, w=0.25, h=0.25, msize=0.03)
    elif name == 'rug':
        color = mix(checker(0xa8453a, 0xd9c08a, 5.0), (*srgb(0x7a2f28), 1), voronoi(14))
    elif name == 'ceiling':
        color = mix((*srgb(0xf6f3ec), 1), (*srgb(0xe8e3d8), 1), noise(4, 3, 0.4))
    else:  # fabric
        color = mix((*srgb(0x7f9a5a), 1), (*srgb(0x5f7a42), 1), checker(0x000000, 0xffffff, 60.0))
    if isinstance(color, tuple):
        em.inputs['Color'].default_value = color
    else:
        nt.links.new(color, em.inputs['Color'])
    return m


def render_atlas(path):
    """Build the atlas scene (4x4 unit planes, ortho camera) and render it. Returns the scene."""
    scene = bpy.data.scenes.get('Atlas') or bpy.data.scenes.new('Atlas')
    for o in list(scene.collection.objects):
        scene.collection.objects.unlink(o)
    for i, name in enumerate(ATLAS_TILES):
        me = bpy.data.meshes.new(f'atlas_{name}')
        me.from_pydata([(-0.5, -0.5, 0), (0.5, -0.5, 0), (0.5, 0.5, 0), (-0.5, 0.5, 0)], [], [[0, 1, 2, 3]])
        me.materials.append(atlas_material(name))
        o = bpy.data.objects.new(f'atlas_{name}', me)
        # Row 0 at the top of the image
        o.location = (i % 4 + 0.5, 3.5 - i // 4, 0)
        scene.collection.objects.link(o)
    cam = bpy.data.objects.get('AtlasCam') or bpy.data.objects.new('AtlasCam', bpy.data.cameras.new('AtlasCam'))
    if cam.name not in scene.collection.objects:
        scene.collection.objects.link(cam)
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 4
    cam.location = (2, 2, 5)
    cam.rotation_euler = (0, 0, 0)
    scene.camera = cam
    scene.render.resolution_x = 2048
    scene.render.resolution_y = 2048
    scene.render.resolution_percentage = 100
    scene.render.engine = 'BLENDER_EEVEE'
    scene.view_settings.view_transform = 'Standard'
    scene.render.filepath = path
    scene.render.image_settings.file_format = 'JPEG'
    scene.render.image_settings.quality = 82
    return scene


# ================================================================== BUILD + EXPORT
def build_packs():
    global Q
    for q in (0, 1, 2):
        Q = q
        rnd.seed(7)
        for table, cat in ((FANTASY, 'Fantasy'), (MODERN, 'Modern'), (NATURE, 'Nature'), (VEHICLES, 'Vehicles'), (SPACE, 'Space'), (FURNITURE, 'Furniture')):
            for name, (fn, nv) in table.items():
                for v in range(nv):
                    key = f'{name}_v{v}' if nv > 1 else name
                    asset(key, cat, lambda fn=fn, v=v: fn(v))


def export_pack(path, cats):
    bpy.ops.object.select_all(action='DESELECT')
    for name, e in EMPTIES.items():
        if any(e.name in COLLS[c].objects for c in cats):
            e.select_set(True)
            for q in (0, 1, 2):
                if name in LODS[q]:
                    LODS[q][name].select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True,
                              export_texcoords=False, export_normals=False, export_animations=False)
    return os.path.getsize(path)


def export_character(path, arm, bodies):
    bpy.ops.object.select_all(action='DESELECT')
    arm.select_set(True)
    for b in bodies:
        b.select_set(True)
    kw = dict(filepath=path, export_format='GLB', use_selection=True, export_texcoords=False, export_normals=True,
              export_skins=True, export_animations=True, export_animation_mode='NLA_TRACKS', export_force_sampling=True)
    try:
        bpy.ops.export_scene.gltf(**kw, export_vertex_color='ACTIVE')
    except TypeError:
        bpy.ops.export_scene.gltf(**kw, export_colors=True)
    return os.path.getsize(path)


if __name__ != 'town_build':  # the preview harness only wants the definitions
    build_packs()
    arm, bodies = build_character()
    body = bodies[0]
    sizes = {
        'town.glb': export_pack(f'{OUT}/town.glb', ('Fantasy', 'Modern', 'Nature', 'Vehicles')),
        'space.glb': export_pack(f'{OUT}/space.glb', ('Space',)),
        'furniture.glb': export_pack(f'{OUT}/furniture.glb', ('Furniture',)),
        'character.glb': export_character(f'{OUT}/character.glb', arm, bodies),
    }
    # Interior atlas (rendered in its own scene)
    atlas_path = os.path.join(ROOT, 'public', 'textures', 'interior_atlas.jpg')
    os.makedirs(os.path.dirname(atlas_path), exist_ok=True)
    atlas_scene = render_atlas(atlas_path)
    main_scene = bpy.context.window.scene if bpy.context.window else None
    try:
        if bpy.context.window:
            bpy.context.window.scene = atlas_scene
        bpy.ops.render.render(write_still=True, scene=atlas_scene.name)
    except Exception as err:  # the MCP route renders it with blender_render instead
        print('atlas render deferred:', err)
    finally:
        if main_scene:
            bpy.context.window.scene = main_scene
    bpy.ops.wm.save_as_mainfile(filepath=BLEND, copy=True)
    result = {
        'assets': len(EMPTIES),
        'bytes': sizes,
        'tris': {name: [tris(LODS[q][name]) if name in LODS[q] else None for q in (0, 1, 2)] for name in EMPTIES},
        'character_tris': tris(body),
    }
