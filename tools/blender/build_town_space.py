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
    ship_frigate, space units (about 1.6 long), nose = Blender -Y.

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


SPACE = {'ship_frigate': (ship_frigate, 1)}


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


def character_parts():
    """Returns [(bone, verts, faces, material index)] for a stylised explorer (front = -Y)."""
    out = []

    def grab(bone):
        for vs, fs, mi in PARTS:
            out.append((bone, vs, fs, mi))
        PARTS.clear()

    PARTS.clear()
    # Pelvis and belt
    box('pants', (0, 0, 0.94), (0.34, 0.2, 0.18), bevel=0.03)
    box('belt', (0, 0, 1.03), (0.36, 0.22, 0.06), bevel=0.01)
    box('gold', (0, -0.115, 1.03), (0.06, 0.02, 0.05), bevel=0)
    grab('hips')
    # Torso: jacket that widens to the shoulders, collar, shoulder pads, backpack
    hull('shirt', [(-0.17, -0.11, 1.06), (0.17, -0.11, 1.06), (-0.17, 0.1, 1.06), (0.17, 0.1, 1.06),
                   (-0.22, -0.12, 1.36), (0.22, -0.12, 1.36), (-0.22, 0.11, 1.36), (0.22, 0.11, 1.36),
                   (-0.16, -0.09, 1.45), (0.16, -0.09, 1.45), (-0.16, 0.09, 1.45), (0.16, 0.09, 1.45)])
    box('pants', (0, -0.125, 1.24), (0.05, 0.02, 0.34), bevel=0)  # zip line
    box('shirt', (0, 0.01, 1.47), (0.2, 0.16, 0.06), bevel=0.02)  # collar
    for sx in (-1, 1):
        sphere('shirt', (sx * 0.22, 0, 1.4), 0.075, (1, 1.1, 0.9), sub=2)
    box('belt', (0, 0.16, 1.25), (0.26, 0.1, 0.3), bevel=0.03)  # backpack
    box('boots', (0, 0.215, 1.18), (0.2, 0.02, 0.1), bevel=0)
    grab('spine')
    # Head: skull, hair, nose, ears, eyes
    cyl('skin', (0, 0, 1.46), 0.05, 0.06, 10)  # neck
    box('skin', (0, 0, 1.64), (0.2, 0.2, 0.24), bevel=0.05)
    box('hair', (0, 0.015, 1.765), (0.215, 0.215, 0.06), bevel=0.03)
    box('hair', (0, 0.1, 1.69), (0.215, 0.03, 0.16), bevel=0.01)
    for sx in (-1, 1):
        box('hair', (sx * 0.1, 0.03, 1.72), (0.03, 0.16, 0.08), bevel=0)
        box('skin', (sx * 0.105, 0.02, 1.64), (0.02, 0.05, 0.06), bevel=0)  # ears
        box('iron', (sx * 0.045, -0.101, 1.665), (0.03, 0.01, 0.03), bevel=0)  # eyes
    box('skin', (0, -0.11, 1.625), (0.035, 0.03, 0.05), bevel=0)  # nose
    grab('head')
    for side, sx in (('L', 1), ('R', -1)):
        cyl('shirt', (sx * 0.235, 0, 1.13), 0.058, 0.3, 10, r2=0.062)
        grab(f'upper_arm.{side}')
        cyl('shirt', (sx * 0.245, 0, 0.93), 0.05, 0.21, 10, r2=0.056)
        cyl('belt', (sx * 0.245, 0, 0.9), 0.056, 0.05, 10)  # cuff
        box('skin', (sx * 0.25, 0, 0.84), (0.07, 0.09, 0.1), bevel=0.02)  # hand
        grab(f'lower_arm.{side}')
        cyl('pants', (sx * 0.1, 0, 0.5), 0.068, 0.44, 10, r2=0.078)
        grab(f'thigh.{side}')
        cyl('pants', (sx * 0.1, 0, 0.2), 0.058, 0.32, 10, r2=0.066)
        box('boots', (sx * 0.1, -0.035, 0.1), (0.13, 0.22, 0.2), bevel=0.03)
        box('boots', (sx * 0.1, -0.04, 0.02), (0.14, 0.25, 0.04), bevel=0)
        grab(f'shin.{side}')
    return out


def build_character():
    arm_data = bpy.data.armatures.new('ExplorerRig')
    arm = bpy.data.objects.new('ExplorerRig', arm_data)
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
    parts = character_parts()
    verts, faces, mats, groups = [], [], [], {}
    for bone, vs, fs, mi in parts:
        base = len(verts)
        verts.extend(vs)
        groups.setdefault(bone, []).extend(range(base, base + len(vs)))
        for f in fs:
            faces.append([i + base for i in f])
            mats.append(mi)
    me = bpy.data.meshes.new('Explorer')
    me.from_pydata(verts, [], faces)
    used = sorted(set(mats))
    for mi in used:
        me.materials.append(MATERIALS[mi])
    remap = {mi: k for k, mi in enumerate(used)}
    for p, mi in zip(me.polygons, mats):
        p.material_index = remap[mi]
        p.use_smooth = False
    me.validate(clean_customdata=False)
    body = bpy.data.objects.new('Explorer', me)
    coll('Character').objects.link(body)
    for bone, idx in groups.items():
        vg = body.vertex_groups.new(name=bone)
        vg.add(idx, 1.0, 'REPLACE')
    body.parent = arm
    mod = body.modifiers.new('Armature', 'ARMATURE')
    mod.object = arm

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

    make_action('idle', 48, idle)
    make_action('walk', 24, gait(0.5, 0.9, 0.42, 0.25, 0.05, 0.035))
    make_action('run', 16, gait(0.85, 1.6, 0.9, 1.1, 0.22, 0.07))
    return arm, body


# ================================================================== BUILD + EXPORT
def build_packs():
    global Q
    for q in (0, 1, 2):
        Q = q
        rnd.seed(7)
        for table, cat in ((FANTASY, 'Fantasy'), (MODERN, 'Modern'), (SPACE, 'Space')):
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


def export_character(path, arm, body):
    bpy.ops.object.select_all(action='DESELECT')
    arm.select_set(True)
    body.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_texcoords=False,
                              export_normals=True, export_skins=True, export_animations=True,
                              export_animation_mode='NLA_TRACKS', export_force_sampling=True)
    return os.path.getsize(path)


if __name__ != 'town_build':  # the preview harness only wants the definitions
    build_packs()
    arm, body = build_character()
    sizes = {
        'town.glb': export_pack(f'{OUT}/town.glb', ('Fantasy', 'Modern')),
        'space.glb': export_pack(f'{OUT}/space.glb', ('Space',)),
        'character.glb': export_character(f'{OUT}/character.glb', arm, body),
    }
    bpy.ops.wm.save_as_mainfile(filepath=BLEND, copy=True)
    result = {
        'assets': len(EMPTIES),
        'bytes': sizes,
        'tris': {name: [tris(LODS[q][name]) if name in LODS[q] else None for q in (0, 1, 2)] for name in EMPTIES},
        'character_tris': tris(body),
    }
