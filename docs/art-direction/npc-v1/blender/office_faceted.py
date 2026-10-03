"""Townsfolk base model, faceted low-poly, after the office reference (references/05-office-reference.webp):
a tall, slim adult with a long face, a messy crop with a tuft, a tucked shirt with the sleeves
rolled below the elbow, a loosened tie, a belt, straight trousers and loafers. Arms are long,
hands large, the waist narrow. Built like c01_faceted.py: every piece is a convex hull or a loft of
a few cross-section rings, flat shaded, so it reads as cut planes.

Runtime contract (src/modes/town/people/chunkyPeople.js), shared with c01_faceted.py:
  - pivots (empties): NPC_C01 > hips > spine > chest > neck > head, clavicle > shoulder > elbow >
    wrist, hip > knee > ankle > toe, and cup (the root keeps the C01 name the loader looks for)
  - material names drive the per-person colour slots (M_skin, M_hair, M_shirt, M_tie, M_pants, ...)
  - mesh names drive the optional pieces (glasses_*, beard_B02*, hat_*, prop_cup*, hair_*_crown, tie_*)
  - legs keep C01's joint heights (hip 0.905, knee 0.505, ankle 0.105): the gait code plants the feet with them
Z-up, front = -Y, metres, origin on the ground between the feet.

Run:  Blender -b --factory-startup --python office_faceted.py -- <out.glb>
"""
import math
import sys

import bpy
import bmesh
from mathutils import Matrix, Vector

ROOT_NAME = "NPC_C01"
COL_NAME = "NPC_SOURCE"
V = Vector


# ---------------------------------------------------------------- materials
def srgb(h):
    h = h.lstrip("#")
    r, g, b = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    f = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (f(r), f(g), f(b), 1.0)


_mats = {}


def mat(name, hex_, rough=0.7):
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = srgb(hex_)
    bsdf.inputs["Roughness"].default_value = rough
    for k in ("Specular IOR Level", "Specular"):
        if k in bsdf.inputs:
            bsdf.inputs[k].default_value = 0.1
    _mats[name] = m
    return m


# Authoring colours from the reference; the game recolours the slotted ones per person
PAL = {
    "skin": "#D99B73", "skin_dark": "#B97C58", "hair": "#2E211B", "beard": "#33302E",
    "cap": "#25262B", "shirt": "#D3D2B9", "shirt_fold": "#BDBDA2", "tie": "#3E5433",
    "button": "#E9E6D6", "pants": "#38383B", "belt": "#2A2420", "buckle": "#8D8A80",
    "sock": "#27272B", "shoe_upper": "#7A4A2C", "shoe_strap": "#5D3620", "shoe_sole": "#2B221C",
    "cup": "#C99A62", "cup_sleeve": "#8E6A3F", "lid": "#232328", "mouth": "#6E3A31",
    "eye": "#1B1B1F", "frame": "#161618",
}


# ---------------------------------------------------------------- scene helpers
def get_col():
    c = bpy.data.collections.get(COL_NAME)
    if c:
        for o in list(c.objects):
            bpy.data.objects.remove(o, do_unlink=True)
    else:
        c = bpy.data.collections.new(COL_NAME)
        bpy.context.scene.collection.children.link(c)
    return c


col = get_col()
pos = {}
objs = {}


def emp(name, world, parent=None):
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = "PLAIN_AXES"
    e.empty_display_size = 0.05
    col.objects.link(e)
    world = V(world)
    if parent:
        e.parent = objs[parent]
        e.location = world - pos[parent]
    else:
        e.location = world
    pos[name] = world
    objs[name] = e
    return e


def ring(cx, cy, z, w, f, b, k=0.62):
    """Octagonal cross-section at height z: half width w, front at cy+f (f<0), back at cy+b."""
    return [V(p) for p in (
        (cx + w * k, cy + f, z), (cx + w, cy + f * 0.42, z), (cx + w, cy + b * 0.42, z), (cx + w * k, cy + b, z),
        (cx - w * k, cy + b, z), (cx - w, cy + b * 0.42, z), (cx - w, cy + f * 0.42, z), (cx - w * k, cy + f, z))]


def oring(cx, cy, z, r, n=8, sx=1.0, sy=1.0, rot=0.0):
    return [V((cx + math.cos(rot + i * 2 * math.pi / n) * r * sx, cy + math.sin(rot + i * 2 * math.pi / n) * r * sy, z)) for i in range(n)]


def boxpts(c, s, rot=None):
    """Corners of a box centred at c with size s (optionally rotated, degrees XYZ)."""
    R = Matrix.Identity(3)
    if rot:
        R = (Matrix.Rotation(math.radians(rot[2]), 3, "Z") @ Matrix.Rotation(math.radians(rot[1]), 3, "Y")
             @ Matrix.Rotation(math.radians(rot[0]), 3, "X"))
    return [R @ V((sx * s[0] / 2, sy * s[1] / 2, sz * s[2] / 2)) + V(c) for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]


class Part:
    """Convex hulls (world coordinates) collected into one flat-shaded mesh under a pivot."""

    def __init__(self, name, parent, material):
        self.name, self.parent, self.material = name, parent, material
        self.bm = bmesh.new()

    def hull(self, pts):
        bm = self.bm
        verts = [bm.verts.new(V(p)) for p in pts]
        # de-duplicate this hull's own points only: hulls that touch stay separate islands
        bmesh.ops.remove_doubles(bm, verts=verts, dist=1e-6)
        verts = [v for v in verts if v.is_valid]
        res = bmesh.ops.convex_hull(bm, input=verts, use_existing_faces=False)
        junk = list({v for v in res["geom_interior"] + res["geom_unused"] if isinstance(v, bmesh.types.BMVert) and v.is_valid})
        if junk:
            bmesh.ops.delete(bm, geom=junk, context="VERTS")
        return self

    def rings(self, *rs):
        """A loft through cross-section rings: clean edge loops of quads, capped at both ends.
        Rings of different sizes (or fewer than two) fall back to a convex hull."""
        if len(rs) < 2 or len({len(r) for r in rs}) != 1:
            return self.hull([p for r in rs for p in r])
        bm = self.bm
        loops = [[bm.verts.new(V(p)) for p in r] for r in rs]
        n = len(loops[0])
        for a, b in zip(loops, loops[1:]):
            for i in range(n):
                j = (i + 1) % n
                quad = [a[i], a[j], b[j], b[i]]
                if len({v.co.to_tuple(6) for v in quad}) >= 3:
                    bm.faces.new(quad)
        for cap in (loops[0], loops[-1]):
            if len({v.co.to_tuple(6) for v in cap}) >= 3:
                bm.faces.new(cap)
        geom = [v for l in loops for v in l]
        bmesh.ops.remove_doubles(bm, verts=geom, dist=1e-6)
        faces = list({f for v in geom if v.is_valid for f in v.link_faces})
        bmesh.ops.recalc_face_normals(bm, faces=faces)
        return self

    def box(self, c, s, rot=None):
        return self.hull(boxpts(c, s, rot))

    def band(self, cx, cy, z0, z1, r0, r1, a0, a1, n=6, t=0.006, sy=0.95):
        """An open collar band from angle a0 to a1 (radians, 0 = +X, -90 deg = front): one hull per segment."""
        for i in range(n):
            pts = []
            for a in (a0 + (a1 - a0) * i / n, a0 + (a1 - a0) * (i + 1) / n):
                for z, r in ((z0, r0), (z1, r1)):
                    for rr in (r, r + t):
                        pts.append(V((cx + math.cos(a) * rr, cy + math.sin(a) * rr * sy, z)))
            self.hull(pts)
        return self

    def done(self):
        bm = self.bm
        # Merge coplanar hull triangles into facets
        bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(1.0), verts=bm.verts, edges=bm.edges)
        bmesh.ops.triangulate(bm, faces=bm.faces)
        off = pos[self.parent]
        for v in bm.verts:
            v.co -= off
        mesh = bpy.data.meshes.new(self.name)
        bm.to_mesh(mesh)
        bm.free()
        for p in mesh.polygons:
            p.use_smooth = False
        mesh.materials.append(self.material)
        o = bpy.data.objects.new(self.name, mesh)
        col.objects.link(o)
        o.parent = objs[self.parent]
        objs[self.name] = o
        return o


# ---------------------------------------------------------------- rig
# Narrow, slightly low shoulders and long arms: the wrists hang at the crotch, as in the reference
SH = {"x": 0.172, "z": 1.362}
EL = {"x": 0.188, "z": 1.075}
WR = {"x": 0.198, "z": 0.800}
HIP = {"x": 0.094, "z": 0.905}
KN = {"x": 0.100, "z": 0.505}
AN = {"x": 0.106, "z": 0.105}

CHEST_Z = 1.16  # waist / chest split of the torso
BALL_Y = -0.118  # ball of the foot: the toe pivot
BELT_Z = (0.928, 0.962)


def build_rig():
    emp(ROOT_NAME, (0, 0, 0))
    emp("hips", (0, 0, 0.93), ROOT_NAME)
    emp("spine", (0, 0, 0.95), "hips")
    emp("chest", (0, 0.0, CHEST_Z), "spine")
    emp("neck", (0, 0.010, 1.42), "chest")
    emp("head", (0, 0.008, 1.48), "neck")
    for side, sx in (("L", 1), ("R", -1)):
        emp(f"clavicle_{side}", (sx * 0.040, 0.012, 1.372), "chest")
        emp(f"shoulder_{side}", (sx * SH["x"], 0.012, SH["z"]), f"clavicle_{side}")
        emp(f"elbow_{side}", (sx * EL["x"], 0.022, EL["z"]), f"shoulder_{side}")
        emp(f"wrist_{side}", (sx * WR["x"], 0.004, WR["z"]), f"elbow_{side}")
        emp(f"hip_{side}", (sx * HIP["x"], 0, HIP["z"]), "hips")
        emp(f"knee_{side}", (sx * KN["x"], -0.004, KN["z"]), f"hip_{side}")
        emp(f"ankle_{side}", (sx * AN["x"], 0.01, AN["z"]), f"knee_{side}")
        emp(f"toe_{side}", (sx * AN["x"], BALL_Y, 0.022), f"ankle_{side}")


# ---------------------------------------------------------------- head
HY = 0.008  # head centre line (y)
# (z, half width, front, back): a long, narrow face with a tapering jaw and a planar skull
HEAD_RINGS = [
    (1.446, 0.026, -0.084, -0.030),
    (1.476, 0.056, -0.093, 0.006),
    (1.514, 0.076, -0.099, 0.054),
    (1.560, 0.087, -0.104, 0.090),
    (1.612, 0.091, -0.104, 0.105),
    (1.662, 0.090, -0.099, 0.110),
    (1.706, 0.080, -0.080, 0.100),
    (1.740, 0.052, -0.046, 0.064),
]
EAR_X = 0.086


def face_y(z):
    """Front plane of the head at height z (interpolated between rings)."""
    for (z0, _, f0, _), (z1, _, f1, _) in zip(HEAD_RINGS, HEAD_RINGS[1:]):
        if z0 <= z <= z1:
            return HY + f0 + (f1 - f0) * (z - z0) / (z1 - z0)
    return HY + HEAD_RINGS[-1][2]


def head_ring(i, grow=0.0, k=0.62):
    z, w, f, b = HEAD_RINGS[i]
    return ring(0, HY, z, w + grow, f - grow, b + grow, k)


def build_head():
    skin = mat("M_skin", PAL["skin"])
    skin_d = mat("M_skin_dark", PAL["skin_dark"])
    p = Part("head_H01", "head", skin)
    p.rings(*[head_ring(i) for i in range(len(HEAD_RINGS))])
    # a long straight nose: a wedge off the face plane
    ny = face_y(1.59)
    p.hull([(0, ny + 0.004, 1.634), (0.010, ny + 0.002, 1.628), (-0.010, ny + 0.002, 1.628),
            (0, ny - 0.036, 1.560), (0.016, ny - 0.014, 1.550), (-0.016, ny - 0.014, 1.550),
            (0.021, ny + 0.004, 1.552), (-0.021, ny + 0.004, 1.552), (0, ny - 0.020, 1.545)])
    # ears, a little prominent
    for sx in (1, -1):
        x0, x1 = sx * EAR_X, sx * (EAR_X + 0.022)
        p.hull([(x0, 0.000, 1.548), (x0, 0.032, 1.552), (x0, 0.000, 1.632), (x0, 0.036, 1.636),
                (x1, 0.006, 1.556), (x1, 0.040, 1.562), (x1, 0.008, 1.626), (x1 + sx * 0.002, 0.044, 1.632)])
    p.done()
    p = Part("face_ears", "head", skin_d)
    for sx in (1, -1):
        p.box((sx * (EAR_X + 0.020), 0.024, 1.592), (0.006, 0.020, 0.042))
    p.done()

    build_expressions()

    # a long neck
    p = Part("neck", "neck", skin)
    p.rings(oring(0, 0.014, 1.33, 0.047, sy=0.95, rot=math.pi / 8), oring(0, 0.018, 1.49, 0.043, sy=0.95, rot=math.pi / 8))
    # Adam's apple
    p.hull(boxpts((0, 0.014 - 0.046, 1.43), (0.016, 0.010, 0.022)))
    p.done()


# ---------------------------------------------------------------- expressions
# Each facial feature comes in variants named expr_<feature>_<variant>. The game shows one
# variant per feature (the others collapse in the vertex shader), so an expression is a
# combination. The order of each list is the variant index the runtime uses (chunkyPeople.js
# EXPR). Mouths are drawn on the skin; with the beard on, the game pushes them onto the beard.
EXPR = {
    "eyes": ("open", "closed", "wide", "squint"),
    "brows": ("neutral", "raised", "worried", "angry"),
    "mouth": ("neutral", "smile", "open", "frown", "grin"),
}
EXPR_DEFAULT = {"eyes": "open", "brows": "neutral", "mouth": "neutral"}


def build_expressions():
    eye = mat("M_eye", PAL["eye"], 0.4)
    brow = mat("M_hair", PAL["hair"], 0.85)
    mouth = mat("M_mouth", PAL["mouth"], 0.6)
    teeth = mat("M_teeth", "#F4F0E6", 0.5)
    ez, ex = 1.603, 0.038
    ey = face_y(ez) - 0.001

    def part(feature, variant, material, suffix=""):
        return Part(f"expr_{feature}_{variant}{suffix}", "head", material)

    # eyes: (width, height, lift) per variant. The open eye is small and heavy-lidded, as drawn
    for variant, (w, h, dz) in {"open": (0.017, 0.014, -0.001), "closed": (0.020, 0.0045, -0.004),
                                "wide": (0.017, 0.019, 0.002), "squint": (0.019, 0.007, -0.001)}.items():
        p = part("eyes", variant, eye)
        for sx in (1, -1):
            if variant == "squint":
                for k in (-1, 1):  # two slanted halves: an upside-down V
                    p.box((sx * ex + k * 0.0052, ey, ez + dz), (0.011, 0.006, h * 0.7), rot=(0, k * 22, 0))
            else:
                p.box((sx * ex, ey, ez + dz), (w, 0.006, h))
        p.done()

    # brows: heavy, low; (lift, tilt in degrees; positive raises the inner ends)
    for variant, (dz, tilt) in {"neutral": (0.0, 6), "raised": (0.006, 2), "worried": (0.003, 18), "angry": (-0.004, -20)}.items():
        p = part("brows", variant, brow)
        for sx in (1, -1):
            z = 1.628 + dz
            p.box((sx * 0.041, face_y(z) - 0.004, z), (0.046, 0.013, 0.014), rot=(0, sx * tilt, 0))
        p.done()

    # mouths
    mz = 1.500
    my = face_y(mz) - 0.001
    p = part("mouth", "neutral", mouth)
    p.box((0, my, mz), (0.030, 0.006, 0.006))
    p.done()
    for variant, bend in (("smile", 1), ("frown", -1)):
        p = part("mouth", variant, mouth)
        p.box((0, my, mz - bend * 0.002), (0.018, 0.006, 0.006))
        for sx in (1, -1):
            p.box((sx * 0.014, my + 0.001, mz + bend * 0.002), (0.013, 0.006, 0.006), rot=(0, sx * bend * -28, 0))
        p.done()
    p = part("mouth", "open", mouth)
    p.hull(boxpts((0, my, mz - 0.003), (0.020, 0.006, 0.015)) + boxpts((0, my, mz - 0.003), (0.015, 0.006, 0.021)))
    p.done()
    p = part("mouth", "grin", mouth)
    p.hull(boxpts((0, my, mz - 0.002), (0.036, 0.006, 0.006)) + boxpts((0, my, mz - 0.008), (0.024, 0.006, 0.010)))
    p.done()
    p = part("mouth", "grin", teeth, "_teeth")
    p.box((0, my - 0.0015, mz + 0.0), (0.026, 0.004, 0.004))
    p.done()


def build_headgear():
    hair = mat("M_hair", PAL["hair"], 0.85)
    beard = mat("M_beard", PAL["beard"], 0.9)
    cap = mat("M_cap", PAL["cap"], 0.85)
    frame = mat("M_glasses", PAL["frame"], 0.4)

    # short back and sides (also what shows under the cap), sideburns to mid ear
    back_half = lambda r: [q for q in r if q.y > HY - 0.035]
    p = Part("hair_R04_cap", "head", hair)
    pts = []
    for i in (3, 4, 5, 6):
        pts += back_half(head_ring(i, grow=0.006, k=0.7))
    for sx in (1, -1):
        pts += [V((sx * (EAR_X + 0.005), HY - 0.036, 1.578)), V((sx * (EAR_X + 0.005), HY - 0.038, 1.66))]
    pts += [q for q in head_ring(2, grow=0.005) if q.y > HY + 0.045]
    p.hull(pts)
    p.done()

    # the messy top, shown whenever the cap is off: a rounded crown, the front swept up into
    # a short quiff, a lock falling forward over the right brow and a cowlick at the back
    p = Part("hair_R04_crown", "head", hair)
    lift = lambda r, dz: [V((q.x, q.y, q.z + dz)) for q in r]
    # the hairline sits high on the forehead and higher still at the temples
    front = lambda r, dz: [V((q.x, q.y, q.z + (dz * (1.4 if abs(q.x) > 0.05 else 1.0) if q.y < HY - 0.04 else 0.0))) for q in r]
    p.rings(front(head_ring(5, grow=0.009, k=0.7), 0.022), front(lift(head_ring(6, grow=0.014, k=0.72), 0.004), 0.008),
            lift(head_ring(7, grow=0.016, k=0.74), 0.012))
    fy = face_y(1.69)
    # quiff: rises from the hairline and leans back over the crown
    p.hull([(x, fy - 0.006, 1.700 - abs(x) * 0.1) for x in (-0.062, -0.030, 0.0, 0.030, 0.062)] +
           [(x, fy + 0.006, 1.758 - abs(x) * 0.3) for x in (-0.058, -0.020, 0.020, 0.058)] +
           [(x, HY + 0.020, 1.768) for x in (-0.046, 0.046)])
    # the forelock: from the top of the quiff, forward and down over the right brow
    p.hull(boxpts((-0.018, fy - 0.004, 1.752), (0.030, 0.020, 0.014), rot=(0, 10, 0)) +
           boxpts((-0.040, fy - 0.022, 1.722), (0.022, 0.012, 0.012), rot=(0, 25, 0)))
    p.hull(boxpts((-0.040, fy - 0.022, 1.722), (0.022, 0.012, 0.012), rot=(0, 25, 0)) +
           boxpts((-0.046, face_y(1.66) - 0.012, 1.656), (0.012, 0.008, 0.010)))
    # a tuft sticking up at the top, left of the parting
    p.hull(boxpts((0.030, HY - 0.030, 1.764), (0.036, 0.030, 0.010)) + [V((0.040, HY - 0.040, 1.790)), V((0.046, HY - 0.032, 1.788))])
    # cowlick at the back of the crown
    p.hull(boxpts((0.0, HY + 0.070, 1.745), (0.040, 0.030, 0.012)) + [V((0.006, HY + 0.080, 1.772))])
    p.done()

    # beard B02 (optional): jaw and chin with a diagonal cheek line, moustache over the mouth
    p = Part("beard_B02", "head", beard)
    g = 0.007
    pts = []
    for i, (z, w, f, b) in enumerate(HEAD_RINGS[:4]):
        pts += ring(0, HY, z, w + g, f - g - (0.004 if i < 2 else 0), b + g * 0.5)
    pts += [V((0, HY - 0.089, 1.428)), V((0.022, HY - 0.085, 1.432)), V((-0.022, HY - 0.085, 1.432))]
    for sx in (1, -1):
        pts += [V((sx * (EAR_X + 0.008), HY + 0.000, 1.600)), V((sx * (EAR_X + 0.008), HY + 0.042, 1.600)), V((sx * (EAR_X + 0.002), HY - 0.066, 1.562))]
    pts += [V((0.028, face_y(1.54) - 0.012, 1.542)), V((-0.028, face_y(1.54) - 0.012, 1.542))]
    p.hull(pts)
    p.done()

    # glasses G01 (optional): thick rectangular frames
    p = Part("glasses_G01", "head", frame)
    gy, gz = face_y(1.603) - 0.012, 1.602
    w, h, t, d = 0.058, 0.040, 0.009, 0.009
    for sx in (1, -1):
        cx = sx * 0.041
        p.box((cx, gy, gz + h / 2 - t / 2), (w, d, t))
        p.box((cx, gy, gz - h / 2 + t / 2), (w, d, t))
        p.box((cx + w / 2 - t / 2, gy, gz), (t, d, h))
        p.box((cx - w / 2 + t / 2, gy, gz), (t, d, h))
        p.box((sx * 0.074, gy + 0.004, gz + 0.011), (0.012, 0.012, 0.010))  # hinge
        p.hull(boxpts((sx * 0.082, gy + 0.010, gz + 0.011), (0.008, 0.006, 0.008)) + boxpts((sx * (EAR_X + 0.004), HY + 0.030, gz + 0.004), (0.008, 0.008, 0.008)))
    p.box((0, gy, gz + 0.007), (0.026, d, 0.008))  # bridge
    p.done()

    # cap A01 (optional): faceted crown, flat bill, button
    p = Part("hat_A01_cap", "head", cap)
    p.rings(ring(0, HY + 0.006, 1.652, 0.101, -0.108, 0.118, 0.68), ring(0, HY + 0.006, 1.705, 0.097, -0.102, 0.114, 0.68),
            ring(0, HY + 0.010, 1.750, 0.075, -0.071, 0.088, 0.66), ring(0, HY + 0.012, 1.768, 0.033, -0.026, 0.040))
    by = HY - 0.098
    bill = [(0.086, 0.0), (0.083, -0.040), (0.065, -0.074), (0.034, -0.092), (0.0, -0.096)]
    pts = []
    for x, dy in bill:
        for s in ((1, -1) if x else (1,)):
            zf = 1.664 + dy * 0.16  # tips down a little
            pts += [V((s * x, by + dy, zf)), V((s * x, by + dy, zf + 0.011))]
    p.hull(pts)
    p.hull(oring(0, HY + 0.014, 1.768, 0.012, n=6) + oring(0, HY + 0.014, 1.778, 0.008, n=6))
    p.done()


# ---------------------------------------------------------------- body
def build_body():
    skin = mat("M_skin", PAL["skin"])
    for side, sx in (("L", 1), ("R", -1)):
        # upper arm (the sleeve covers it)
        p = Part(f"arm_{side}_upper", f"shoulder_{side}", skin)
        p.rings(oring(sx * 0.176, 0.014, 1.31, 0.044, sy=1.05, rot=math.pi / 8),
                oring(sx * 0.182, 0.018, 1.19, 0.042, sy=1.05, rot=math.pi / 8),
                oring(sx * EL["x"], 0.022, 1.08, 0.038, rot=math.pi / 8))
        p.done()
        # long, lean forearm with an elbow cap so bending never opens a gap
        p = Part(f"arm_{side}_lower", f"elbow_{side}", skin)
        p.rings(oring(sx * EL["x"], 0.022, 1.108, 0.035, rot=math.pi / 8), oring(sx * EL["x"], 0.022, 1.075, 0.040, rot=math.pi / 8),
                oring(sx * 0.192, 0.016, 0.99, 0.040, sy=1.08, rot=math.pi / 8), oring(sx * WR["x"], 0.004, 0.810, 0.029, sx=0.85, sy=1.15, rot=math.pi / 8))
        p.done()
        # large hands: palm, four long fingers curled in a little, thumb forward
        p = Part(f"hand_{side}", f"wrist_{side}", skin)
        cx = sx * WR["x"]
        p.hull(boxpts((cx, 0.004, 0.804), (0.036, 0.070, 0.02)) + boxpts((cx - sx * 0.002, 0.003, 0.712), (0.040, 0.092, 0.02)))
        for i, y in enumerate((-0.032, -0.011, 0.010, 0.031)):
            L = (0.062, 0.072, 0.068, 0.054)[i]
            p.hull(boxpts((cx - sx * 0.002, y + 0.003, 0.706), (0.032, 0.0195, 0.012)) +
                   boxpts((cx - sx * 0.008, y + 0.003, 0.706 - L * 0.6), (0.028, 0.019, 0.012)) +
                   boxpts((cx - sx * 0.017, y + 0.003, 0.706 - L), (0.022, 0.018, 0.010)))
        p.hull(boxpts((cx - sx * 0.004, -0.032, 0.778), (0.030, 0.022, 0.034)) + boxpts((cx - sx * 0.015, -0.058, 0.722), (0.022, 0.020, 0.024)))
        p.done()

    # Trousers: slim and straight, a crease down the front (the pointed ring front), a belt
    pants = mat("M_pants", PAL["pants"], 0.8)
    belt = mat("M_belt", PAL["belt"], 0.6)
    buckle = mat("M_buckle", PAL["buckle"], 0.35)
    sock = mat("M_sock", PAL["sock"], 0.9)
    p = Part("pants_P02_pelvis", "hips", pants)
    p.rings(ring(0, 0.002, 0.962, 0.140, -0.092, 0.090), ring(0, 0.002, 0.900, 0.148, -0.096, 0.094), ring(0, 0.004, 0.830, 0.136, -0.084, 0.092))
    p.done()
    p = Part("pants_P02_belt", "hips", belt)
    p.rings(ring(0, 0.002, BELT_Z[0], 0.146, -0.098, 0.095), ring(0, 0.002, BELT_Z[1], 0.143, -0.097, 0.094))
    p.done()
    p = Part("pants_P02_buckle", "hips", buckle)
    p.box((-0.012, 0.002 - 0.101, sum(BELT_Z) / 2), (0.036, 0.008, 0.030))
    p.done()
    for side, sx in (("L", 1), ("R", -1)):
        p = Part(f"pants_P02_thigh_{side}", f"hip_{side}", pants)
        p.rings(ring(sx * 0.084, 0.004, 0.905, 0.074, -0.080, 0.082, 0.5), ring(sx * 0.092, 0.0, 0.720, 0.068, -0.072, 0.074, 0.5),
                ring(sx * KN["x"], -0.004, 0.505, 0.062, -0.066, 0.064, 0.5))
        p.done()
        p = Part(f"pants_P02_shin_{side}", f"knee_{side}", pants)
        p.rings(ring(sx * KN["x"], -0.004, 0.545, 0.060, -0.063, 0.063, 0.5), ring(sx * KN["x"], -0.006, 0.505, 0.064, -0.068, 0.064, 0.5),
                ring(sx * 0.104, 0.004, 0.300, 0.063, -0.066, 0.065, 0.5), ring(sx * AN["x"], 0.010, 0.170, 0.065, -0.068, 0.067, 0.5))
        p.done()
        # the hem breaks over the shoe: lower at the front than at the back
        p = Part(f"pants_P02_hem_{side}", f"ankle_{side}", pants)
        top = ring(sx * AN["x"], 0.010, 0.185, 0.066, -0.069, 0.068, 0.5)
        low = [V((q.x, q.y, 0.064 + max(0.0, q.y - 0.010) * 0.12)) for q in ring(sx * AN["x"], 0.010, 0.0, 0.068, -0.072, 0.070, 0.5)]
        p.rings(top, low)
        p.done()
        p = Part(f"sock_{side}", f"ankle_{side}", sock)
        p.rings(oring(sx * AN["x"], 0.012, 0.060, 0.036), oring(sx * AN["x"], 0.012, 0.140, 0.034))
        p.done()


# ---------------------------------------------------------------- clothing
def torso(z):
    """(half width, front, back) of the shirt at height z: slim, tucked in, bloused a little over the belt."""
    keys = [(0.93, 0.136, -0.090, 0.088), (1.00, 0.144, -0.100, 0.094), (1.15, 0.146, -0.104, 0.094),
            (1.26, 0.156, -0.106, 0.098), (1.340, 0.160, -0.094, 0.096), (1.392, 0.100, -0.060, 0.070)]
    for a, b in zip(keys, keys[1:]):
        if a[0] <= z <= b[0]:
            t = (z - a[0]) / (b[0] - a[0])
            return tuple(a[i] + (b[i] - a[i]) * t for i in (1, 2, 3))
    return keys[-1][1:] if z > keys[-1][0] else keys[0][1:]


def build_top():
    shirt = mat("M_shirt", PAL["shirt"], 0.8)
    fold = mat("M_shirt_fold", PAL["shirt_fold"], 0.8)
    button = mat("M_button", PAL["button"], 0.5)
    skin = mat("M_skin", PAL["skin"])
    tie = mat("M_tie", PAL["tie"], 0.7)

    # The torso is two rigid pieces: waist (spine) and chest. They overlap by a few
    # centimetres so twisting one against the other never opens a gap.
    ZS = (0.93, 1.00, 1.15, 1.26, 1.340, 1.392)
    LO, HI = (0.93, CHEST_Z + 0.035), (CHEST_Z - 0.035, 1.392)

    def span(zs, lo, hi):
        return [lo] + [z for z in zs if lo < z < hi] + [hi]

    for name, bone, (lo, hi) in (("waist", "spine", LO), ("chest", "chest", HI)):
        p = Part(f"top_T03_shirt_{name}", bone, shirt)
        p.rings(*[ring(0, 0.0, z, *torso(z)) for z in span(ZS, lo, hi)])
        if bone == "chest":
            # collar band round the back of the neck, open at the throat
            p.band(0, 0.016, 1.372, 1.418, 0.056, 0.052, math.radians(-62), math.radians(242), n=10)
            # collar points lying on the chest either side of the open neck
            for sx in (1, -1):
                leaf = [(0.026, 1.392), (0.066, 1.380), (0.056, 1.326), (0.032, 1.346)]
                p.hull([V((sx * x, torso(z)[1] - d, z)) for x, z in leaf for d in (0.008, -0.002)])
        p.done()

        # placket and buttons down the front (the top one undone)
        p = Part(f"top_T03_placket_{name}", bone, fold)
        z0, z1 = max(lo, 0.95), min(hi, 1.33)
        _, f0, _ = torso(z0)
        _, f1, _ = torso(z1)
        p.hull([(-0.010, f0 - 0.004, z0), (-0.030, f0 - 0.004, z0), (-0.010, f1 - 0.004, z1), (-0.030, f1 - 0.004, z1),
                (-0.010, f0 + 0.01, z0), (-0.030, f0 + 0.01, z0), (-0.010, f1 + 0.01, z1), (-0.030, f1 + 0.01, z1)])
        p.done()
        p = Part(f"top_T03_buttons_{name}", bone, button)
        for z in (1.25, 1.15, 1.05):
            if (z > CHEST_Z) != (bone == "chest"):
                continue
            _, f, _ = torso(z)
            hexagon = ((0.006, 0), (-0.006, 0), (0.003, 0.005), (-0.003, 0.005), (0.003, -0.005), (-0.003, -0.005))
            p.hull([V((-0.020 + dx, f - dy, z + dz)) for dx, dz in hexagon for dy in (0.005, 0.009)])
        p.done()

        # the loosened tie (optional piece): knot under the open collar, blade down to the belt
        p = Part(f"tie_T03_{name}", bone, tie)
        if bone == "chest":
            _, f, _ = torso(1.33)
            p.hull([(-0.017, f - 0.012, 1.352), (0.017, f - 0.012, 1.352), (-0.011, f - 0.016, 1.318), (0.011, f - 0.016, 1.318),
                    (-0.015, f + 0.004, 1.354), (0.015, f + 0.004, 1.354), (-0.010, f, 1.318), (0.010, f, 1.318)])
        z_hi, z_lo = min(hi, 1.322), max(lo, 0.962)
        pts = []
        for z in (z_hi, z_lo):
            _, f, _ = torso(z)
            w = 0.013 + (1.322 - z) * 0.052  # widening toward the tip
            hang = (1.322 - z) * 0.035  # hangs a little off the shirt
            pts += [V((x + 0.004, f - 0.008 - hang - d, z)) for x in (-w, w) for d in (0.0, 0.005)]
        if lo < 0.97:
            _, f, _ = torso(0.95)
            pts += [V((0.004, f - 0.020 - d, 0.94)) for d in (0.0, 0.005)]  # the pointed tip
        p.hull(pts)
        p.done()

    # the open neck: skin in the V between the collar points
    p = Part("top_T03_neckline", "chest", skin)
    _, f, _ = torso(1.37)
    p.hull([(-0.028, f - 0.002, 1.392), (0.028, f - 0.002, 1.392), (0.0, f - 0.004, 1.346),
            (-0.028, f + 0.02, 1.392), (0.028, f + 0.02, 1.392), (0.0, f + 0.02, 1.346)])
    p.done()

    for side, sx in (("L", 1), ("R", -1)):
        # sleeve down past the elbow, then rolled up in a thick band
        p = Part(f"top_T03_sleeve_{side}", f"shoulder_{side}", shirt)
        p.rings(oring(sx * 0.150, 0.010, 1.376, 0.042, rot=math.pi / 8),
                oring(sx * 0.174, 0.012, 1.325, 0.060, rot=math.pi / 8),
                oring(sx * 0.182, 0.018, 1.20, 0.058, rot=math.pi / 8),
                oring(sx * EL["x"], 0.022, 1.100, 0.054, rot=math.pi / 8))
        p.done()
        p = Part(f"top_T03_roll_{side}", f"elbow_{side}", fold)
        p.rings(oring(sx * EL["x"], 0.022, 1.112, 0.054, rot=math.pi / 8),
                oring(sx * EL["x"], 0.021, 1.052, 0.056, rot=math.pi / 8),
                oring(sx * 0.189, 0.020, 1.010, 0.054, rot=math.pi / 8))
        p.done()


def build_shoes():
    upper = mat("M_shoe_upper", PAL["shoe_upper"], 0.55)
    strap = mat("M_shoe_strap", PAL["shoe_strap"], 0.55)
    sole = mat("M_shoe_sole", PAL["shoe_sole"], 0.6)
    ST = 0.018  # a thin leather sole
    HEEL_T = 0.030  # and a low heel block
    B0, B1 = BALL_Y + 0.008, BALL_Y - 0.004  # heel piece ends / toe piece starts (they overlap)
    for side, sx in (("L", 1), ("R", -1)):
        cx = sx * AN["x"]
        P = lambda x, y, z, s=1: V((cx + s * x, y, z))
        # Two rigid pieces hinged at the ball of the foot: the toe bends as the heel lifts
        p = Part(f"shoes_S03_sole_{side}", f"ankle_{side}", sole)
        p.hull([P(x, y, z, s) for x, y in ((0.040, 0.082), (0.050, 0.052), (0.054, B0)) for s in (1, -1) for z in (0.0, ST)])
        p.hull([P(x, y, z, s) for x, y in ((0.040, 0.082), (0.048, 0.030)) for s in (1, -1) for z in (0.0, HEEL_T)])
        p.done()
        p = Part(f"shoes_S03_toe_sole_{side}", f"toe_{side}", sole)
        p.hull([P(x, y, z, s) for x, y in ((0.054, B1), (0.050, -0.170), (0.040, -0.214), (0.018, -0.232)) for s in (1, -1) for z in (0.0, ST)])
        p.done()
        # loafer upper: low heel counter and collar, a long vamp
        prof = [(0.076, 0.092, 0.040), (0.048, 0.098, 0.046), (-0.030, 0.090, 0.050), (-0.098, 0.074, 0.049), (B0, 0.068, 0.048)]
        p = Part(f"shoes_S03_upper_{side}", f"ankle_{side}", upper)
        p.hull([P(w * k, y, z, s) for y, z1, w in prof for s in (1, -1) for k, z in ((1.0, ST), (0.84, z1))])
        p.done()
        p = Part(f"shoes_S03_toe_upper_{side}", f"toe_{side}", upper)
        prof = [(B1, 0.066, 0.048), (-0.160, 0.054, 0.046), (-0.204, 0.042, 0.036), (-0.226, 0.030, 0.018)]
        p.hull([P(w * k, y, z, s) for y, z1, w in prof for s in (1, -1) for k, z in ((1.0, ST), (0.80, z1))])
        p.done()
        # the penny strap across the vamp
        p = Part(f"shoes_S03_strap_{side}", f"ankle_{side}", strap)
        p.box((cx, -0.070, 0.080), (0.086, 0.020, 0.008), rot=(-16, 0, 0))
        p.done()


# ---------------------------------------------------------------- props + pose
def build_cup():
    cup = mat("M_cup", PAL["cup"], 0.65)
    sleeve = mat("M_cup_sleeve", PAL["cup_sleeve"], 0.7)
    lid = mat("M_lid", PAL["lid"], 0.5)
    c = V((-0.24, -0.16, 0.95))
    emp("cup", c, ROOT_NAME)
    p = Part("prop_cup_body", "cup", cup)
    p.rings(oring(c.x, c.y, c.z - 0.055, 0.033, n=10), oring(c.x, c.y, c.z + 0.050, 0.041, n=10))
    p.done()
    p = Part("prop_cup_sleeve", "cup", sleeve)
    p.rings(oring(c.x, c.y, c.z - 0.020, 0.0385, n=10), oring(c.x, c.y, c.z + 0.025, 0.0415, n=10))
    p.done()
    p = Part("prop_cup_lid", "cup", lid)
    p.rings(oring(c.x, c.y, c.z + 0.048, 0.045, n=10), oring(c.x, c.y, c.z + 0.064, 0.045, n=10))
    p.rings(oring(c.x, c.y, c.z + 0.064, 0.036, n=10), oring(c.x, c.y, c.z + 0.078, 0.032, n=10))
    p.done()


def pose():
    def rot(name, x=0, y=0, z=0):
        objs[name].rotation_euler = (math.radians(x), math.radians(y), math.radians(z))
    # R holds the cup in front of the chest, L hangs straight down the thigh with a soft elbow
    rot("shoulder_R", x=-22, y=-6, z=0)
    rot("elbow_R", x=-84, y=-12)
    rot("wrist_R", z=-12)
    rot("shoulder_L", x=3, y=0, z=2)
    rot("elbow_L", x=-8, y=6)
    rot("head", x=4)  # a slight droop of the head
    rot("hips", z=2)
    rot("hip_L", x=-3, y=0, z=2)
    rot("hip_R", x=3, y=0, z=-2)
    rot("ankle_L", z=-8)
    rot("ankle_R", z=8)
    bpy.context.view_layer.update()
    # the cup rides in the right fist, upright
    cup = objs["cup"]
    hand = objs["wrist_R"]
    tgt = hand.matrix_world @ V((0.040, -0.014, -0.102))
    cup.parent = hand
    cup.matrix_parent_inverse = hand.matrix_world.inverted()
    cup.matrix_world = Matrix.Translation(tgt)
    bpy.context.view_layer.update()


def build_all():
    build_rig()
    build_head()
    build_headgear()
    build_body()
    build_top()
    build_shoes()
    build_cup()
    pose()


# ---------------------------------------------------------------- run
def clean_scene():
    for o in list(bpy.data.objects):
        if o.name not in col.objects:
            bpy.data.objects.remove(o, do_unlink=True)


def export(path):
    bpy.ops.object.select_all(action="DESELECT")
    for o in col.objects:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_yup=True,
                              export_apply=False, export_animations=False, export_cameras=False, export_lights=False)


def triangles():
    return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in col.objects if o.type == "MESH")


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    clean_scene()
    build_all()
    print(f"office faceted: {triangles()} triangles, {sum(o.type == 'MESH' for o in col.objects)} meshes")
    if argv:
        export(argv[0])
        print("exported", argv[0])
