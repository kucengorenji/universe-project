"""C01 (Café hero), faceted low-poly: adult proportions (~6.5 heads, 1.76 m to the cap),
planar facets like the user reference (docs/art-direction/npc-v1/references/00, 04).
Every piece is a convex hull of a few cross-section rings, flat shaded, so the silhouette
reads as cut planes rather than rounded boxes.

Same contract as c01_overcooked.py, which src/modes/town/people/chunkyPeople.js relies on:
  - pivots (empties): NPC_C01 > hips > spine > neck > head, shoulder > elbow > wrist,
    hip > knee > ankle, and cup
  - material names drive the per-person colour slots (M_skin, M_hair, M_shirt_stripe, ...)
  - mesh names drive the optional pieces (glasses_*, beard_B02*, hat_*, prop_cup*, hair_*_crown)
Z-up, front = -Y, metres, origin on the ground between the feet.

Run:  Blender -b --factory-startup --python c01_faceted.py -- <out.glb> [preview_dir]
"""
import math
import os
import sys

import bpy
import bmesh
from mathutils import Matrix, Vector

ROOT_NAME = "NPC_C01"
COL_NAME = "NPC_C01_SOURCE"
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


PAL = {
    "skin": "#E39E6E", "skin_dark": "#C9825A", "hair": "#2A2422", "beard": "#33343A",
    "cap": "#25262B", "shirt": "#6E9ACB", "shirt_dark": "#4F79A8", "under": "#EEE7D8",
    "button": "#EFE6D3", "pants": "#2B2C30", "cuff": "#3A3B40", "shoe_upper": "#26272C",
    "shoe_sole": "#E9DFC9", "lace": "#F3ECDC", "cup": "#C99A62", "cup_sleeve": "#8E6A3F",
    "lid": "#232328", "mouth": "#6E3A31", "eye": "#1B1B1F", "frame": "#161618",
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
SH = {"x": 0.195, "z": 1.385}
EL = {"x": 0.214, "z": 1.10}
WR = {"x": 0.226, "z": 0.855}
HIP = {"x": 0.094, "z": 0.905}
KN = {"x": 0.100, "z": 0.505}
AN = {"x": 0.106, "z": 0.105}


CHEST_Z = 1.16  # waist / chest split of the torso
BALL_Y = -0.118  # ball of the foot: the toe pivot


def build_rig():
    emp(ROOT_NAME, (0, 0, 0))
    emp("hips", (0, 0, 0.93), ROOT_NAME)
    emp("spine", (0, 0, 0.95), "hips")
    emp("chest", (0, 0.0, CHEST_Z), "spine")
    emp("neck", (0, 0.008, 1.43), "chest")
    emp("head", (0, 0.008, 1.49), "neck")
    for side, sx in (("L", 1), ("R", -1)):
        emp(f"clavicle_{side}", (sx * 0.045, 0.012, 1.395), "chest")
        emp(f"shoulder_{side}", (sx * SH["x"], 0.01, SH["z"]), f"clavicle_{side}")
        emp(f"elbow_{side}", (sx * EL["x"], 0.02, EL["z"]), f"shoulder_{side}")
        emp(f"wrist_{side}", (sx * WR["x"], 0.0, WR["z"]), f"elbow_{side}")
        emp(f"hip_{side}", (sx * HIP["x"], 0, HIP["z"]), "hips")
        emp(f"knee_{side}", (sx * KN["x"], -0.004, KN["z"]), f"hip_{side}")
        emp(f"ankle_{side}", (sx * AN["x"], 0.01, AN["z"]), f"knee_{side}")
        emp(f"toe_{side}", (sx * AN["x"], BALL_Y, 0.022), f"ankle_{side}")


# ---------------------------------------------------------------- head
HY = 0.008  # head centre line (y)
# (z, half width, front, back): a planar skull, square jaw, blocky chin
HEAD_RINGS = [
    (1.462, 0.034, -0.090, -0.035),
    (1.490, 0.070, -0.096, 0.010),
    (1.520, 0.090, -0.100, 0.060),
    (1.560, 0.099, -0.106, 0.095),
    (1.610, 0.101, -0.106, 0.108),
    (1.660, 0.099, -0.101, 0.112),
    (1.705, 0.086, -0.080, 0.100),
    (1.738, 0.056, -0.045, 0.064),
]


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
    # nose: a wedge off the face plane
    ny = face_y(1.59)
    p.hull([(0, ny + 0.004, 1.628), (0.011, ny + 0.002, 1.622), (-0.011, ny + 0.002, 1.622),
            (0, ny - 0.030, 1.570), (0.016, ny - 0.012, 1.560), (-0.016, ny - 0.012, 1.560),
            (0.021, ny + 0.004, 1.560), (-0.021, ny + 0.004, 1.560), (0, ny - 0.016, 1.556)])
    # ears
    for sx in (1, -1):
        p.hull([(sx * 0.094, 0.000, 1.552), (sx * 0.094, 0.030, 1.556), (sx * 0.094, 0.000, 1.628), (sx * 0.094, 0.034, 1.632),
                (sx * 0.114, 0.006, 1.560), (sx * 0.116, 0.036, 1.566), (sx * 0.116, 0.008, 1.622), (sx * 0.118, 0.040, 1.628)])
    p.done()
    p = Part("face_ears", "head", skin_d)
    for sx in (1, -1):
        p.box((sx * 0.114, 0.022, 1.592), (0.006, 0.020, 0.040))
    p.done()

    build_expressions()

    p = Part("neck", "neck", skin)
    p.rings(oring(0, 0.012, 1.37, 0.050, sy=0.95, rot=math.pi / 8), oring(0, 0.018, 1.50, 0.046, sy=0.95, rot=math.pi / 8))
    p.done()


# ---------------------------------------------------------------- expressions
# Each facial feature comes in variants named expr_<feature>_<variant>. The game shows one
# variant per feature (the others collapse in the vertex shader), so an expression is a
# combination: smile = squint eyes + raised brows + smile mouth, and so on. The order of
# each list is the variant index the runtime uses (chunkyPeople.js EXPR). Mouths are drawn
# on the skin; with the beard on, the game pushes them forward onto the beard's surface.
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
    ez, ex = 1.605, 0.041
    ey = face_y(ez) - 0.001

    def part(feature, variant, material, suffix=""):
        return Part(f"expr_{feature}_{variant}{suffix}", "head", material)

    # eyes: (width, height, lift) per variant; squint is a flat arch for a smile or laugh
    for variant, (w, h, dz) in {"open": (0.017, 0.016, 0.0), "closed": (0.021, 0.0045, -0.004),
                                "wide": (0.018, 0.022, 0.002), "squint": (0.020, 0.007, -0.001)}.items():
        p = part("eyes", variant, eye)
        for sx in (1, -1):
            if variant == "squint":
                for k in (-1, 1):  # two slanted halves: an upside-down V
                    p.box((sx * ex + k * 0.0055, ey, ez + dz), (0.012, 0.006, h * 0.7), rot=(0, k * 22, 0))
            else:
                p.box((sx * ex, ey, ez + dz), (w, 0.006, h))
        p.done()

    # brows: (lift, tilt in degrees; positive raises the inner ends)
    for variant, (dz, tilt) in {"neutral": (0.0, -5), "raised": (0.0055, 0), "worried": (0.003, 16), "angry": (-0.004, -20)}.items():
        p = part("brows", variant, brow)
        for sx in (1, -1):
            z = 1.636 + dz
            p.box((sx * 0.043, face_y(z) - 0.004, z), (0.048, 0.012, 0.013), rot=(0, sx * tilt, 0))
        p.done()

    # mouths
    mz = 1.512
    my = face_y(mz) - 0.001
    p = part("mouth", "neutral", mouth)
    p.box((0, my, mz), (0.034, 0.006, 0.006))
    p.done()
    for variant, bend in (("smile", 1), ("frown", -1)):
        p = part("mouth", variant, mouth)
        p.box((0, my, mz - bend * 0.002), (0.020, 0.006, 0.006))
        for sx in (1, -1):
            p.box((sx * 0.016, my + 0.001, mz + bend * 0.002), (0.014, 0.006, 0.006), rot=(0, sx * bend * -28, 0))
        p.done()
    p = part("mouth", "open", mouth)
    p.hull(boxpts((0, my, mz - 0.003), (0.022, 0.006, 0.016)) + boxpts((0, my, mz - 0.003), (0.016, 0.006, 0.022)))
    p.done()
    p = part("mouth", "grin", mouth)
    p.hull(boxpts((0, my, mz - 0.002), (0.040, 0.006, 0.006)) + boxpts((0, my, mz - 0.008), (0.026, 0.006, 0.010)))
    p.done()
    p = part("mouth", "grin", teeth, "_teeth")
    p.box((0, my - 0.0015, mz + 0.0), (0.028, 0.004, 0.004))
    p.done()


def build_headgear():
    hair = mat("M_hair", PAL["hair"], 0.85)
    beard = mat("M_beard", PAL["beard"], 0.9)
    cap = mat("M_cap", PAL["cap"], 0.85)
    frame = mat("M_glasses", PAL["frame"], 0.4)

    # hair R04 (crop under the cap): sides and back only, sideburns down to the ear top
    back_half = lambda r: [q for q in r if q.y > HY - 0.035]
    p = Part("hair_R04_cap", "head", hair)
    pts = []
    for i in (3, 4, 5, 6):
        pts += back_half(head_ring(i, grow=0.007, k=0.7))
    for sx in (1, -1):
        pts += [V((sx * 0.106, HY - 0.040, 1.585)), V((sx * 0.106, HY - 0.040, 1.66))]
    pts += [q for q in head_ring(2, grow=0.006) if q.y > HY + 0.05]
    p.hull(pts)
    p.done()
    # crown: the top of the head, shown only without the cap
    p = Part("hair_R04_crown", "head", hair)
    p.rings(head_ring(5, grow=0.008, k=0.7), head_ring(6, grow=0.012, k=0.7), head_ring(7, grow=0.014, k=0.7))
    p.done()

    # beard B02: jaw and chin with a diagonal cheek line, moustache over the mouth
    p = Part("beard_B02", "head", beard)
    g = 0.008
    pts = []
    for i, (z, w, f, b) in enumerate(HEAD_RINGS[:4]):
        pts += ring(0, HY, z, w + g, f - g - (0.004 if i < 2 else 0), b + g * 0.5)
    pts += [V((0, HY - 0.094, 1.442)), V((0.026, HY - 0.090, 1.446)), V((-0.026, HY - 0.090, 1.446))]
    for sx in (1, -1):
        pts += [V((sx * 0.108, HY + 0.000, 1.605)), V((sx * 0.108, HY + 0.045, 1.605)), V((sx * 0.100, HY - 0.070, 1.568))]
    pts += [V((0.030, face_y(1.55) - 0.012, 1.553)), V((-0.030, face_y(1.55) - 0.012, 1.553))]
    p.hull(pts)
    p.done()

    # glasses G01: thick rectangular frames
    p = Part("glasses_G01", "head", frame)
    gy, gz = face_y(1.605) - 0.012, 1.604
    w, h, t, d = 0.064, 0.044, 0.010, 0.009
    for sx in (1, -1):
        cx = sx * 0.045
        p.box((cx, gy, gz + h / 2 - t / 2), (w, d, t))
        p.box((cx, gy, gz - h / 2 + t / 2), (w, d, t))
        p.box((cx + w / 2 - t / 2, gy, gz), (t, d, h))
        p.box((cx - w / 2 + t / 2, gy, gz), (t, d, h))
        p.box((sx * 0.082, gy + 0.004, gz + 0.012), (0.012, 0.012, 0.010))  # hinge
        p.hull(boxpts((sx * 0.090, gy + 0.010, gz + 0.012), (0.008, 0.006, 0.008)) + boxpts((sx * 0.106, HY + 0.030, gz + 0.004), (0.008, 0.008, 0.008)))
    p.box((0, gy, gz + 0.008), (0.028, d, 0.008))  # bridge
    p.done()

    # cap A01: faceted crown, flat bill, button
    p = Part("hat_A01_cap", "head", cap)
    p.rings(ring(0, HY + 0.006, 1.652, 0.110, -0.110, 0.120, 0.68), ring(0, HY + 0.006, 1.705, 0.106, -0.104, 0.116, 0.68),
            ring(0, HY + 0.010, 1.748, 0.082, -0.072, 0.090, 0.66), ring(0, HY + 0.012, 1.766, 0.036, -0.026, 0.040))
    by = HY - 0.100
    bill = [(0.094, 0.0), (0.090, -0.040), (0.070, -0.074), (0.036, -0.092), (0.0, -0.096)]
    pts = []
    for x, dy in bill:
        for s in ((1, -1) if x else (1,)):
            zf = 1.664 + dy * 0.16  # tips down a little
            pts += [V((s * x, by + dy, zf)), V((s * x, by + dy, zf + 0.011))]
    p.hull(pts)
    p.hull(oring(0, HY + 0.014, 1.766, 0.012, n=6) + oring(0, HY + 0.014, 1.776, 0.008, n=6))
    p.done()


# ---------------------------------------------------------------- body
def build_body():
    skin = mat("M_skin", PAL["skin"])
    for side, sx in (("L", 1), ("R", -1)):
        # upper arm (the sleeve covers the shoulder)
        p = Part(f"arm_{side}_upper", f"shoulder_{side}", skin)
        p.rings(oring(sx * 0.200, 0.012, 1.33, 0.050, sx=1.0, sy=1.05, rot=math.pi / 8),
                oring(sx * 0.207, 0.018, 1.21, 0.050, sy=1.05, rot=math.pi / 8),
                oring(sx * EL["x"], 0.020, 1.105, 0.043, rot=math.pi / 8))
        p.done()
        # forearm with an elbow cap so bending never opens a gap
        p = Part(f"arm_{side}_lower", f"elbow_{side}", skin)
        p.rings(oring(sx * EL["x"], 0.020, 1.135, 0.040, rot=math.pi / 8), oring(sx * EL["x"], 0.020, 1.10, 0.045, rot=math.pi / 8),
                oring(sx * 0.219, 0.012, 1.02, 0.045, sy=1.05, rot=math.pi / 8), oring(sx * WR["x"], 0.0, 0.865, 0.033, sx=0.85, sy=1.15, rot=math.pi / 8))
        p.done()
        # hand: palm, four blocky fingers curled in a little, thumb forward
        p = Part(f"hand_{side}", f"wrist_{side}", skin)
        cx = sx * WR["x"]
        p.hull(boxpts((cx, 0.0, 0.860), (0.036, 0.066, 0.02)) + boxpts((cx - sx * 0.002, -0.001, 0.778), (0.038, 0.086, 0.02)))
        for i, y in enumerate((-0.030, -0.010, 0.010, 0.030)):
            L = (0.056, 0.064, 0.060, 0.048)[i]
            p.hull(boxpts((cx - sx * 0.002, y, 0.772), (0.032, 0.0185, 0.012)) +
                   boxpts((cx - sx * 0.008, y, 0.772 - L * 0.6), (0.028, 0.018, 0.012)) +
                   boxpts((cx - sx * 0.016, y, 0.772 - L), (0.022, 0.017, 0.010)))
        p.hull(boxpts((cx - sx * 0.004, -0.034, 0.838), (0.030, 0.022, 0.032)) + boxpts((cx - sx * 0.014, -0.058, 0.786), (0.022, 0.020, 0.022)))
        p.done()

    pants = mat("M_pants", PAL["pants"], 0.8)
    cuff = mat("M_cuff", PAL["cuff"], 0.8)
    p = Part("pants_P01_pelvis", "hips", pants)
    p.rings(ring(0, 0.002, 1.010, 0.158, -0.100, 0.092), ring(0, 0.002, 0.920, 0.166, -0.104, 0.100), ring(0, 0.004, 0.830, 0.150, -0.088, 0.098))
    p.done()
    for side, sx in (("L", 1), ("R", -1)):
        p = Part(f"pants_P01_thigh_{side}", f"hip_{side}", pants)
        p.rings(ring(sx * 0.090, 0.004, 0.905, 0.083, -0.086, 0.088), ring(sx * 0.096, 0.0, 0.720, 0.080, -0.080, 0.082),
                ring(sx * KN["x"], -0.004, 0.505, 0.068, -0.070, 0.070))
        p.done()
        p = Part(f"pants_P01_shin_{side}", f"knee_{side}", pants)
        p.rings(ring(sx * KN["x"], -0.004, 0.545, 0.066, -0.068, 0.068), ring(sx * KN["x"], -0.006, 0.505, 0.071, -0.074, 0.070),
                ring(sx * 0.104, 0.004, 0.300, 0.071, -0.072, 0.072), ring(sx * AN["x"], 0.010, 0.170, 0.075, -0.076, 0.076))
        p.done()
        # rolled cuff: a wider faceted band
        p = Part(f"pants_P01_cuff_{side}", f"ankle_{side}", cuff)
        p.rings(ring(sx * AN["x"], 0.010, 0.108, 0.082, -0.083, 0.083), ring(sx * AN["x"], 0.010, 0.180, 0.083, -0.084, 0.084))
        p.done()


# ---------------------------------------------------------------- clothing
def torso(z):
    """(half width, front, back) of the shirt at height z."""
    keys = [(0.86, 0.172, -0.110, 0.102), (1.00, 0.166, -0.110, 0.100), (1.15, 0.176, -0.120, 0.104),
            (1.28, 0.190, -0.120, 0.108), (1.365, 0.192, -0.100, 0.104), (1.415, 0.118, -0.068, 0.078)]
    for a, b in zip(keys, keys[1:]):
        if a[0] <= z <= b[0]:
            t = (z - a[0]) / (b[0] - a[0])
            return tuple(a[i] + (b[i] - a[i]) * t for i in (1, 2, 3))
    return keys[-1][1:] if z > keys[-1][0] else keys[0][1:]


def build_top():
    shirt = mat("M_shirt_stripe", PAL["shirt"], 0.8)
    shirt_d = mat("M_shirt_dark", PAL["shirt_dark"], 0.8)
    under = mat("M_under", PAL["under"], 0.85)
    button = mat("M_button", PAL["button"], 0.5)

    # The torso is two rigid pieces: waist (spine) and chest. They overlap by a few
    # centimetres so twisting one against the other never opens a gap.
    ZS = (0.86, 1.00, 1.15, 1.28, 1.365, 1.415)
    LO, HI = (0.86, CHEST_Z + 0.035), (CHEST_Z - 0.035, 1.415)

    def span(zs, lo, hi):
        return [lo] + [z for z in zs if lo < z < hi] + [hi]

    for name, bone, (lo, hi) in (("waist", "spine", LO), ("chest", "chest", HI)):
        p = Part(f"top_T01_overshirt_{name}", bone, shirt)
        p.rings(*[ring(0, 0.0, z, *torso(z)) for z in span(ZS, lo, hi)])
        if bone == "chest":
            # collar: a band round the back of the neck and two points lying on the chest
            p.rings(oring(0, 0.018, 1.395, 0.066, sy=0.95, rot=math.pi / 8), oring(0, 0.022, 1.445, 0.060, sy=0.95, rot=math.pi / 8))
            for sx in (1, -1):
                leaf = [(0.050, 1.412), (0.096, 1.392), (0.074, 1.318), (0.050, 1.352)]
                p.hull([V((sx * x, torso(z)[1] - d, z)) for x, z in leaf for d in (0.006, -0.004)])
        p.done()

        # open front: the undershirt shows between the lapels
        p = Part(f"top_T01_undershirt_{name}", bone, under)
        pts = []
        panel = [(0.865, 0.064), (1.00, 0.060), (1.15, 0.056), (1.28, 0.052), (1.33, 0.050), (1.365, 0.049), (1.39, 0.048), (1.41, 0.046)]
        width = lambda z: next(w0 + (w1 - w0) * (z - z0) / (z1 - z0) for (z0, w0), (z1, w1) in zip(panel, panel[1:]) if z0 <= z <= z1)
        for z in span([z for z, _ in panel], max(lo, 0.865), min(hi, 1.41)):
            _, f, _ = torso(z)
            w = width(z)
            pts += [V((w, f - 0.004, z)), V((-w, f - 0.004, z)), V((w, f + 0.03, z)), V((-w, f + 0.03, z))]
        p.hull(pts)
        if bone == "chest":
            # crew neck, sitting inside the collar
            p.rings(oring(0, 0.004, 1.370, 0.060, sy=0.95, rot=math.pi / 8), oring(0, 0.008, 1.405, 0.054, sy=0.95, rot=math.pi / 8))
        p.done()

        # placket (and the pocket on the chest)
        p = Part(f"top_T01_details_{name}", bone, shirt_d)
        z0, z1 = max(lo, 0.87), min(hi, 1.31)
        _, f0, _ = torso(z0)
        _, f1, _ = torso(z1)
        p.hull([(-0.066, f0 - 0.005, z0), (-0.088, f0 - 0.005, z0), (-0.066, f1 - 0.005, z1), (-0.088, f1 - 0.005, z1),
                (-0.066, f0 + 0.01, z0), (-0.088, f0 + 0.01, z0), (-0.066, f1 + 0.01, z1), (-0.088, f1 + 0.01, z1)])
        if bone == "chest":
            _, f, _ = torso(1.24)
            p.box((0.118, f - 0.004, 1.235), (0.062, 0.008, 0.070))
        p.done()

        p = Part(f"top_T01_buttons_{name}", bone, button)
        for z in (1.27, 1.15, 1.03, 0.91):
            if (z > CHEST_Z) != (bone == "chest"):
                continue
            _, f, _ = torso(z)
            hexagon = ((0.008, 0), (-0.008, 0), (0.004, 0.007), (-0.004, 0.007), (0.004, -0.007), (-0.004, -0.007))
            p.hull([V((-0.077 + dx, f - dy, z + dz)) for dx, dz in hexagon for dy in (0.005, 0.010)])
        p.done()

    for side, sx in (("L", 1), ("R", -1)):
        p = Part(f"top_T01_sleeve_{side}", f"shoulder_{side}", shirt)
        p.rings(oring(sx * 0.172, 0.008, 1.398, 0.046, rot=math.pi / 8),
                oring(sx * 0.198, 0.010, 1.345, 0.071, sy=1.0, rot=math.pi / 8),
                oring(sx * 0.206, 0.016, 1.205, 0.074, sy=1.0, rot=math.pi / 8))
        # turned-up hem
        p.rings(oring(sx * 0.206, 0.016, 1.232, 0.078, rot=math.pi / 8), oring(sx * 0.207, 0.017, 1.198, 0.078, rot=math.pi / 8))
        p.done()


def build_shoes():
    black = mat("M_shoe_upper", PAL["shoe_upper"], 0.75)
    sole = mat("M_shoe_sole", PAL["shoe_sole"], 0.6)
    lace = mat("M_lace", PAL["lace"], 0.65)
    ST = 0.044  # platform sole thickness
    B0, B1 = BALL_Y + 0.008, BALL_Y - 0.004  # heel piece ends / toe piece starts (they overlap)
    for side, sx in (("L", 1), ("R", -1)):
        cx = sx * AN["x"]
        P = lambda x, y, z, s=1: V((cx + s * x, y, z))
        # Two rigid pieces hinged at the ball of the foot: the toe bends as the heel lifts
        p = Part(f"shoes_S01_sole_{side}", f"ankle_{side}", sole)
        p.hull([P(x, y, z, s) for x, y in ((0.044, 0.082), (0.058, 0.052), (0.061, B0)) for s in (1, -1) for z in (0.0, ST)])
        p.done()
        p = Part(f"shoes_S01_toe_sole_{side}", f"toe_{side}", sole)
        p.hull([P(x, y, z, s) for x, y in ((0.061, B1), (0.057, -0.160), (0.052, -0.214), (0.026, -0.236)) for s in (1, -1) for z in (0.0, ST)])
        # rubber toe cap
        p.hull([P(x, y, z, s) for s in (1, -1) for x, y, z in
                ((0.052, -0.214, ST), (0.026, -0.236, ST), (0.057, -0.150, ST), (0.046, -0.198, 0.082), (0.022, -0.218, 0.079), (0.050, -0.152, 0.088))])
        p.done()
        # canvas upper: heel counter, collar round the ankle, vamp sloping to the toe
        prof = [(0.074, 0.146, 0.047), (0.046, 0.158, 0.054), (-0.030, 0.142, 0.057), (-0.098, 0.110, 0.056), (B0, 0.100, 0.055)]
        p = Part(f"shoes_S01_upper_{side}", f"ankle_{side}", black)
        p.hull([P(w * k, y, z, s) for y, z1, w in prof for s in (1, -1) for k, z in ((1.0, ST), (0.82, z1))])
        p.done()
        p = Part(f"shoes_S01_toe_upper_{side}", f"toe_{side}", black)
        prof = [(B1, 0.102, 0.055), (-0.156, 0.086, 0.051)]
        p.hull([P(w * k, y, z, s) for y, z1, w in prof for s in (1, -1) for k, z in ((1.0, ST), (0.82, z1))])
        p.done()
        # laces: crossed ladder down the vamp
        p = Part(f"shoes_S01_laces_{side}", f"ankle_{side}", lace)
        for i, y in enumerate((-0.022, -0.056, -0.090)):
            z = 0.146 - i * 0.015 - (0.004 if i else 0)
            for a in (28, -28):
                p.box((cx, y, z + 0.004), (0.064, 0.011, 0.007), rot=(-22, 0, a))
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
    # R holds the cup in front of the chest, L hangs relaxed with a soft elbow
    rot("shoulder_R", x=-22, y=-6, z=0)
    rot("elbow_R", x=-78, y=-12)
    rot("wrist_R", z=-12)
    rot("shoulder_L", x=5, y=0, z=4)
    rot("elbow_L", x=-12, y=10)
    rot("head", z=-6)
    rot("hips", z=2)
    rot("hip_L", x=-3, y=0, z=2)
    rot("hip_R", x=3, y=0, z=-2)
    rot("ankle_L", z=-8)
    rot("ankle_R", z=8)
    bpy.context.view_layer.update()
    # the cup rides in the right fist, upright
    cup = objs["cup"]
    hand = objs["wrist_R"]
    tgt = hand.matrix_world @ V((0.040, -0.012, -0.090))
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
    print(f"C01 faceted: {triangles()} triangles, {sum(o.type == 'MESH' for o in col.objects)} meshes")
    if argv:
        export(argv[0])
        print("exported", argv[0])
