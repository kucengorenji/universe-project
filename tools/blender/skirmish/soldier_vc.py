"""Skirmish soldier v2, after the look of Valkyria Chronicles (PS3): a slim, smooth, mid-poly figure
for toon shading (about 7.5 heads, 1.72 m), anime face (large painted-shape eyes, small nose and
mouth), clumped hair, a field tunic with a short skirt, trousers into boots, webbing and helmets.

One skinned mesh on one armature, so each soldier is one draw call. Per-vertex data the game
reads (src/skirmish/units/vcSoldiers.js), in the second UV map ("meta"):
  u = palette slot (0 keep the authored colour, 1 skin, 2 hair, 3 tunic, 4 scarf, 5 trousers,
      6 boots, 7 helmet, 8 iris)
  v = piece (0 always shown; 1-5 hair styles; 6 federation helmet; 7 imperial helmet;
      10.. kit tags in KIT order; 20 eyes open, 21 eyes closed)
The game shows one hair style, one helmet (or none), the class's kit and one eye state; the other
pieces collapse to a point in the vertex shader.

Bones keep the names the runtime IK uses (hips, spine, chest, neck, head, clavicle_*, shoulder_*,
elbow_*, wrist_*, hip_*, knee_*, ankle_*, toe_*), every limb's local X is the world X axis in the
rest pose, so a positive X rotation swings a limb back and bends a knee.
Actions (glTF animations): idle, walk, run, crouch, crouch_walk, kneel, hit, fall_back, fall_front.

Run:  Blender -b --factory-startup --python soldier_vc.py -- <out.glb>
"""
import math
import random
import sys

import bpy
import bmesh
from mathutils import Matrix, Vector as V

TAU = math.tau
rng = random.Random(7)

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)
COL = bpy.context.scene.collection

KIT = ["base", "pouches", "pack_small", "mags", "plate", "armor", "tubes", "pack_engineer", "tools", "goggles"]
PIECE = {"always": 0, "hair1": 1, "hair2": 2, "hair3": 3, "hair4": 4, "hair5": 5, "helm_fed": 6, "helm_imp": 7,
         **{f"kit_{k}": 10 + i for i, k in enumerate(KIT)}, "eyes_open": 20, "eyes_closed": 21}
SLOT = {"keep": 0, "skin": 1, "hair": 2, "tunic": 3, "scarf": 4, "pants": 5, "boots": 6, "helmet": 7, "iris": 8}

# authoring colours (sRGB); slotted ones are replaced per soldier in the game
COLOR = {
    "skin": "#F1C9A8", "hair": "#6B4A32", "tunic": "#4F6F8F", "tunic_dark": "#3F5A75", "scarf": "#C8A23A",
    "pants": "#3D4F63", "boots": "#4A3222", "helmet": "#55705A", "iris": "#3C6E9E", "white": "#FFFFFF",
    "line": "#2A2119", "mouth": "#B5655A", "leather": "#5A3E28", "web": "#B49A6A", "pouch": "#9C8558",
    "pack": "#6E6A4A", "metal": "#5A5E62", "brass": "#C9A24A", "armor": "#7C8A94", "lens": "#2C3A44", "blush": "#F2A99A",
}


def srgb(h):
    h = h.lstrip("#")
    f = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return [f(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)]


# ---------------------------------------------------------------- mesh building with per-vertex data
class Builder:
    """Accumulates triangles with a colour and (slot, piece) per vertex, plus the bone each part rides
    on (None: weights come from the automatic body weighting)."""

    def __init__(self):
        self.parts = []  # (bmesh, colour, slot, piece, bone, smooth)

    def add(self, bm, color, slot="keep", piece="always", bone=None, smooth=True):
        self.parts.append((bm, color, SLOT[slot], PIECE[piece], bone, smooth))


B = Builder()


def hull(pts):
    bm = bmesh.new()
    verts = [bm.verts.new(V(p)) for p in pts]
    bmesh.ops.remove_doubles(bm, verts=verts, dist=1e-6)
    bmesh.ops.convex_hull(bm, input=[v for v in bm.verts], use_existing_faces=False)
    for v in [v for v in bm.verts if not v.link_faces]:
        bm.verts.remove(v)
    return bm


def ellipsoid(c, r, segs=12, rings=8, rot=None):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=1.0)
    M = Matrix.Diagonal((r[0], r[1], r[2], 1.0))
    if rot:
        M = (Matrix.Rotation(math.radians(rot[2]), 4, "Z") @ Matrix.Rotation(math.radians(rot[1]), 4, "Y") @ Matrix.Rotation(math.radians(rot[0]), 4, "X")) @ M
    bmesh.ops.transform(bm, matrix=Matrix.Translation(V(c)) @ M, verts=bm.verts)
    return bm


def loft(rings, cap=True):
    """Quads between equal-size rings of points; caps at the ends."""
    bm = bmesh.new()
    loops = [[bm.verts.new(V(p)) for p in r] for r in rings]
    n = len(loops[0])
    for a, b in zip(loops, loops[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new([a[i], a[j], b[j], b[i]])
    if cap:
        bm.faces.new(list(reversed(loops[0])))
        bm.faces.new(loops[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def ring(c, rx, ry, n=12, z=None, rot=0.0):
    cx, cy, cz = c
    return [V((cx + math.cos(rot + i * TAU / n) * rx, cy + math.sin(rot + i * TAU / n) * ry, cz)) for i in range(n)]


def cone(base, tip, r, n=6):
    base, tip = V(base), V(tip)
    d = (tip - base).normalized()
    u = d.orthogonal().normalized()
    w = d.cross(u)
    return hull([base + (u * math.cos(i * TAU / n) + w * math.sin(i * TAU / n)) * r for i in range(n)] + [tip])


def box(c, s, rot=None):
    R = Matrix.Identity(3)
    if rot:
        R = Matrix.Rotation(math.radians(rot[2]), 3, "Z") @ Matrix.Rotation(math.radians(rot[1]), 3, "Y") @ Matrix.Rotation(math.radians(rot[0]), 3, "X")
    return hull([R @ V((sx * s[0] / 2, sy * s[1] / 2, sz * s[2] / 2)) + V(c) for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)])


# ---------------------------------------------------------------- proportions (metres; front = -Y)
H = {"ankle": 0.085, "knee": 0.47, "hip": 0.88, "waist": 1.02, "chest": 1.22, "shoulder": 1.40, "neck": 1.46, "chin": 1.50, "head": 1.585, "top": 1.72}
HIP_X, SH_X = 0.085, 0.175
EL = V((0.235, 0.02, 1.13))
WR = V((0.265, 0.0, 0.88))


def body_skin():
    """The whole clothed body as one smooth surface: a vertex graph with radii for the Skin
    modifier, then subdivided. Returns the evaluated mesh object."""
    me = bpy.data.meshes.new("body_graph")
    ob = bpy.data.objects.new("body_graph", me)
    COL.objects.link(ob)
    # (name, position, radius x, radius y)
    nodes = [
        ("pelvis", (0, 0.0, 0.93), 0.150, 0.105),
        ("waist", (0, 0.0, H["waist"]), 0.135, 0.095),
        ("chest", (0, -0.005, H["chest"]), 0.150, 0.105),
        ("upper", (0, 0.0, 1.34), 0.165, 0.098),
        ("neck0", (0, 0.01, 1.44), 0.052, 0.050),
        ("neck1", (0, 0.012, 1.505), 0.045, 0.045),
    ]
    for s, sx in (("L", 1), ("R", -1)):
        nodes += [
            (f"sh{s}", (sx * SH_X, 0.01, 1.385), 0.058, 0.058),
            (f"el{s}", (sx * EL.x, EL.y, EL.z), 0.042, 0.042),
            (f"fa{s}", (sx * 0.252, 0.012, 1.00), 0.038, 0.036),
            (f"wr{s}", (sx * WR.x, WR.y, WR.z), 0.030, 0.026),
            (f"hd{s}", (sx * 0.275, -0.005, 0.80), 0.036, 0.020),
            (f"hp{s}", (sx * HIP_X, 0.0, 0.86), 0.085, 0.085),
            (f"th{s}", (sx * 0.092, -0.005, 0.67), 0.075, 0.075),
            (f"kn{s}", (sx * 0.095, -0.01, H["knee"]), 0.058, 0.058),
            (f"sn{s}", (sx * 0.097, 0.0, 0.28), 0.056, 0.056),  # boot top
            (f"an{s}", (sx * 0.097, 0.01, 0.10), 0.052, 0.058),
            (f"ft{s}", (sx * 0.097, -0.11, 0.045), 0.048, 0.040),
            (f"tp{s}", (sx * 0.097, -0.19, 0.040), 0.040, 0.036),
        ]
    names = [n[0] for n in nodes]
    edges = [("pelvis", "waist"), ("waist", "chest"), ("chest", "upper"), ("upper", "neck0"), ("neck0", "neck1")]
    for s in "LR":
        edges += [("upper", f"sh{s}"), (f"sh{s}", f"el{s}"), (f"el{s}", f"fa{s}"), (f"fa{s}", f"wr{s}"), (f"wr{s}", f"hd{s}"),
                  ("pelvis", f"hp{s}"), (f"hp{s}", f"th{s}"), (f"th{s}", f"kn{s}"), (f"kn{s}", f"sn{s}"), (f"sn{s}", f"an{s}"), (f"an{s}", f"ft{s}"), (f"ft{s}", f"tp{s}")]
    me.from_pydata([n[1] for n in nodes], [(names.index(a), names.index(b)) for a, b in edges], [])
    sk = ob.modifiers.new("skin", "SKIN")
    sk.use_smooth_shade = True
    sk.branch_smoothing = 0.6
    for i, n in enumerate(nodes):
        me.skin_vertices[0].data[i].radius = (n[2], n[3])
    me.skin_vertices[0].data[0].use_root = True
    sub = ob.modifiers.new("sub", "SUBSURF")
    sub.levels = 2
    sub.render_levels = 2
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    mesh = bpy.data.meshes.new_from_object(ob.evaluated_get(deps))
    bpy.data.objects.remove(ob, do_unlink=True)
    bm = bmesh.new()
    bm.from_mesh(mesh)
    return bm


def body_slot(c):
    """Which colour a body face takes, from its centre."""
    x, y, z = c
    if z > 1.455:
        return "skin", "skin"
    if abs(x) > 0.255 and z < 0.86:
        return "skin", "skin"  # hands
    if z < 0.30:
        return "boots", "boots"
    if z < 0.93:
        return "pants", "pants"
    return "tunic", "tunic"


def build_body():
    # one connected surface (the automatic weighting needs that); colours are chosen per face
    B.add(body_skin(), body_slot, "skin", "always", "@body", True)


# ---------------------------------------------------------------- head and face
HEAD_C = V((0, 0.0, H["head"]))


def build_head():
    # cranium and a tapered jaw: an ellipsoid pulled in below the cheeks
    bm = ellipsoid(HEAD_C, (0.088, 0.098, 0.112), segs=16, rings=12)
    for v in bm.verts:
        d = v.co - HEAD_C
        if d.z < 0:
            k = 1.0 - 0.45 * (-d.z / 0.112) ** 1.6  # narrow toward the chin
            v.co.x = HEAD_C.x + d.x * k
            v.co.y = HEAD_C.y + d.y * (1.0 - 0.25 * (-d.z / 0.112) ** 2) - 0.012 * (-d.z / 0.112)
        if d.y < 0 and d.z > -0.02:
            v.co.y += 0.006  # a flatter face plane
    B.add(bm, "skin", "skin", "always", "head")
    # ears and a small nose
    for sx in (1, -1):
        B.add(ellipsoid((sx * 0.086, 0.008, H["head"] - 0.008), (0.012, 0.024, 0.032)), "skin", "skin", "always", "head")
    B.add(hull([V((0, -0.098, 1.588)), V((0.009, -0.093, 1.565)), V((-0.009, -0.093, 1.565)), V((0, -0.106, 1.562)), V((0, -0.09, 1.59))]), "skin", "skin", "always", "head")
    build_face()


def face_y(x, z):
    """Front surface of the head at (x, z), a little proud of it."""
    d = ((x / 0.088) ** 2 + ((z - HEAD_C.z) / 0.112) ** 2)
    return HEAD_C.y - 0.098 * math.sqrt(max(0.0, 1 - d)) - 0.004 + 0.006


def decal(x, z, w, h, n=10, shape=None, lift=0.0):
    """A thin patch lying on the face at (x, z): a flattened shape, slightly curved with the head."""
    pts = []
    for i in range(n):
        a = i * TAU / n
        px, pz = math.cos(a) * w / 2, math.sin(a) * h / 2
        if shape:
            px, pz = shape(a, px, pz)
        for t in (0.0, 0.002):
            pts.append(V((x + px, face_y(x + px, z + pz) - t - lift, z + pz)))
    return hull(pts)


def build_face():
    ez = 1.585
    for sx in (1, -1):
        ex = sx * 0.036
        # anime eye: a tall white almond, a big iris, a dark pupil, a highlight, a heavy upper lash
        almond = lambda a, px, pz: (px, pz * (1.0 if pz > 0 else 0.75))
        B.add(decal(ex, ez, 0.034, 0.030, 14, almond), "white", "keep", "eyes_open", "head", False)
        B.add(decal(ex + sx * 0.002, ez - 0.002, 0.021, 0.026, 12, lift=0.001), "iris", "iris", "eyes_open", "head", False)
        B.add(decal(ex + sx * 0.002, ez - 0.003, 0.010, 0.013, 10, lift=0.002), "line", "keep", "eyes_open", "head", False)
        B.add(decal(ex - sx * 0.004, ez + 0.006, 0.006, 0.007, 8, lift=0.003), "white", "keep", "eyes_open", "head", False)
        lash = lambda a, px, pz: (px * 1.12, pz * 0.35 + 0.016)
        B.add(decal(ex, ez, 0.036, 0.016, 10, lash, lift=0.002), "line", "keep", "eyes_open", "head", False)
        # closed: a curved lash line
        shut = lambda a, px, pz: (px * 1.1, pz * 0.25 - 0.002 + 0.006 * math.cos(px / 0.02))
        B.add(decal(ex, ez, 0.034, 0.012, 10, shut, lift=0.002), "line", "keep", "eyes_closed", "head", False)
        # brows: thin, slightly raised arcs
        brow = lambda a, px, pz: (px, pz * 0.4 + 0.004 * math.cos(px / 0.022))
        B.add(decal(sx * 0.038, 1.616, 0.036, 0.010, 10, brow, lift=0.002), "hair", "hair", "always", "head", False)
        B.add(decal(sx * 0.052, 1.560, 0.016, 0.008, 8, lift=0.001), "blush", "keep", "always", "head", False)
    B.add(decal(0, 1.535, 0.018, 0.005, 10, lift=0.002), "mouth", "keep", "always", "head", False)


# ---------------------------------------------------------------- hair: clumps from the scalp
def scalp_point(theta, phi, grow=0.012):
    """A point on the cranium (theta around from the front, phi up from the equator)."""
    r = (0.088 + grow, 0.098 + grow, 0.112 + grow)
    return V((HEAD_C.x + math.sin(theta) * math.cos(phi) * r[0], HEAD_C.y - math.cos(theta) * math.cos(phi) * r[1], HEAD_C.z + math.sin(phi) * r[2]))


def hair_cap(piece, low_back=0.0, fringe_z=1.64):
    """A shell over the top and back of the head: the base every style builds on."""
    rings_ = []
    for k, phi in enumerate((-0.15 - low_back, 0.15, 0.55, 0.95, 1.35)):
        pts = []
        for i in range(16):
            th = i * TAU / 16
            p = scalp_point(th, phi, 0.010 + 0.004 * k)
            # keep the face open: lift the front of the lower rings to the hairline
            if math.cos(th) > 0.35 and p.z < fringe_z:
                p.z = fringe_z + (p.z - fringe_z) * 0.15
                p.y -= 0.005
            pts.append(p)
        rings_.append(pts)
    bm = loft(rings_)
    B.add(bm, "hair", "hair", piece, "head")


def clump(piece, theta, phi, length, droop, width=0.026, twist=0.0):
    """A pointed lock of hair from the scalp, out and down."""
    base = scalp_point(theta, phi, 0.008)
    out = (base - HEAD_C).normalized()
    tip = base + out * length * (1 - droop) + V((0, 0, -length * droop)) + V((math.sin(twist) * 0.02, 0, 0))
    B.add(cone(base, tip, width, 6), "hair", "hair", piece, "head")


def build_hair():
    # 1: short and spiky (the scout's)
    hair_cap("hair1")
    for i in range(14):
        th = -1.2 + i * (2.4 / 13)
        clump("hair1", th, 0.75 + 0.25 * math.cos(th * 2), 0.08 + 0.02 * (i % 3), 0.15)
    for i in range(7):
        clump("hair1", -0.5 + i * 0.17, 0.25, 0.07, 0.75, 0.022, i)  # fringe
    # 2: swept fringe, longer at the sides
    hair_cap("hair2")
    for i in range(9):
        clump("hair2", -0.7 + i * 0.16, 0.32, 0.10, 0.65, 0.026, -1)
    for s in (1, -1):
        for i in range(4):
            clump("hair2", s * (1.3 + i * 0.2), 0.0, 0.09, 0.85, 0.022)
    # 3: a chin-length bob
    hair_cap("hair3", low_back=0.35)
    for i in range(20):
        th = math.pi * 0.35 + i * (math.pi * 1.3 / 19)
        clump("hair3", th, 0.05, 0.12, 0.9, 0.03)
    for i in range(8):
        clump("hair3", -0.55 + i * 0.16, 0.3, 0.085, 0.8, 0.024)
    # 4: tied back in a ponytail
    hair_cap("hair4", low_back=0.1)
    for i in range(6):
        clump("hair4", -0.45 + i * 0.18, 0.32, 0.075, 0.7, 0.022)
    tie = scalp_point(math.pi, 0.35, 0.012)
    B.add(ellipsoid(tie, (0.022, 0.022, 0.022)), "hair", "hair", "hair4", "head")
    B.add(cone(tie + V((0, 0.01, 0)), tie + V((0, 0.06, -0.22)), 0.032, 8), "hair", "hair", "hair4", "head")
    # 5: close crop
    hair_cap("hair5")
    for i in range(10):
        clump("hair5", -1.0 + i * 0.22, 0.6, 0.045, 0.2, 0.022)


# ---------------------------------------------------------------- uniform details, kit, helmets
def build_uniform():
    # stand collar and the scarf knotted at the throat
    B.add(loft([ring((0, 0.008, 1.425), 0.062, 0.058, 14), ring((0, 0.010, 1.47), 0.058, 0.054, 14)]), "tunic", "tunic", "always", None)
    B.add(loft([ring((0, 0.006, 1.415), 0.068, 0.064, 14), ring((0, 0.008, 1.44), 0.066, 0.062, 14)]), "scarf", "scarf", "always", None)
    B.add(ellipsoid((0.018, -0.07, 1.41), (0.024, 0.018, 0.022)), "scarf", "scarf", "always", None)
    B.add(cone((0.02, -0.08, 1.40), (0.04, -0.105, 1.30), 0.018, 6), "scarf", "scarf", "always", None)
    # the tunic's skirt over the hips, flaring
    B.add(loft([ring((0, 0.0, 0.99), 0.142, 0.102, 18), ring((0, 0.0, 0.84), 0.168, 0.122, 18)], cap=False), "tunic_dark", "tunic", "always", "hips")
    # belt, buckle, breast pockets, buttons
    B.add(loft([ring((0, 0.0, 0.99), 0.140, 0.100, 18), ring((0, 0.0, 1.03), 0.138, 0.098, 18)]), "leather", "keep", "always", None)
    B.add(box((0, -0.101, 1.01), (0.04, 0.008, 0.032)), "brass", "keep", "always", None)
    for sx in (1, -1):
        B.add(box((sx * 0.065, -0.106, 1.245), (0.06, 0.012, 0.07)), "tunic_dark", "tunic", "always", None)
        # cuffs at the wrists, boot tops
        B.add(loft([ring((sx * 0.262, 0.0, 0.905), 0.036, 0.034, 10), ring((sx * 0.266, 0.0, 0.875), 0.035, 0.033, 10)]), "tunic_dark", "tunic", "always", None)
        B.add(loft([ring((sx * 0.097, 0.0, 0.30), 0.062, 0.062, 12), ring((sx * 0.097, 0.0, 0.33), 0.064, 0.064, 12)]), "boots", "boots", "always", None)
    for z in (1.33, 1.21, 1.09):
        B.add(ellipsoid((0, -0.106, z), (0.008, 0.004, 0.008), 8, 4), "brass", "keep", "always", None)


def build_kit():
    # base: Y-straps, canteen
    for sx in (1, -1):
        B.add(box((sx * 0.09, -0.098, 1.2), (0.03, 0.01, 0.34), rot=(8, 0, sx * -6)), "web", "keep", "kit_base", "chest")
        B.add(box((sx * 0.09, 0.098, 1.2), (0.03, 0.01, 0.34), rot=(-8, 0, sx * 6)), "web", "keep", "kit_base", "chest")
        B.add(box((sx * 0.1, 0.0, 1.385), (0.035, 0.2, 0.012)), "web", "keep", "kit_base", "chest")
    B.add(ellipsoid((-0.15, 0.06, 0.95), (0.035, 0.045, 0.06)), "metal", "keep", "kit_base", "hips")
    # pouches on the belt
    for x in (0.05, 0.1):
        for sx in (1, -1):
            B.add(box((sx * x, -0.112, 0.99), (0.046, 0.03, 0.055)), "pouch", "keep", "kit_pouches", "spine")
    # magazines on the chest
    for sx in (1, -1):
        for dx in (0.0, 0.03):
            B.add(box((sx * (0.06 + dx), -0.12, 1.18), (0.026, 0.024, 0.11)), "pouch", "keep", "kit_mags", "chest")
    # packs
    B.add(box((0, 0.15, 1.2), (0.22, 0.09, 0.21)), "pack", "keep", "kit_pack_small", "chest")
    B.add(ellipsoid((0, 0.155, 1.33), (0.11, 0.04, 0.035)), "pack", "keep", "kit_pack_small", "chest")
    B.add(box((0, 0.17, 1.18), (0.26, 0.13, 0.28)), "pack", "keep", "kit_pack_engineer", "chest")
    B.add(box((0, 0.25, 1.08), (0.2, 0.05, 0.08)), "metal", "keep", "kit_tools", "chest")
    B.add(cone((0.12, 0.25, 1.43), (-0.09, 0.25, 1.04), 0.012, 4), "leather", "keep", "kit_tools", "chest")
    # shock trooper breastplate, lancer armour and lance rack
    B.add(hull([V((x * k, -0.118 - d, z)) for x, z in ((0.11, 1.33), (0.12, 1.15)) for k in (1, -1) for d in (0.0, 0.014)] + [V((0, -0.145, 1.25))]), "armor", "keep", "kit_plate", "chest")
    B.add(hull([V((x * k, -0.12 - d, z)) for x, z, kk in ((0.14, 1.36, 1), (0.15, 1.2, 1), (0.13, 1.13, 1)) for k in (1, -1) for d in (0.0, 0.018)] + [V((0, -0.152, 1.25))]), "armor", "keep", "kit_armor", "chest")
    for sx in (1, -1):
        B.add(ellipsoid((sx * 0.19, 0.01, 1.39), (0.075, 0.07, 0.05), 12, 6), "armor", "keep", "kit_armor", "clavicle_L" if sx > 0 else "clavicle_R")
    for dx in (-0.07, 0.0, 0.07):
        B.add(loft([ring((dx, 0.17, 1.04), 0.03, 0.03, 8), ring((dx, 0.17, 1.40), 0.03, 0.03, 8)]), "metal", "keep", "kit_tubes", "chest")
    # sniper goggles on the helmet brim
    for sx in (1, -1):
        B.add(loft([ring((sx * 0.04, -0.118, 1.665), 0.02, 0.008, 10), ring((sx * 0.04, -0.13, 1.665), 0.019, 0.007, 10)]), "metal", "keep", "kit_goggles", "head")


def build_helmets():
    # federation: a smooth dome with a narrow brim
    rings_ = []
    for k, (z, r) in enumerate(((1.615, 1.0), (1.64, 1.0), (1.70, 0.96), (1.75, 0.82), (1.78, 0.6), (1.795, 0.3))):
        rings_.append(ring((0, 0.005, z), 0.108 * r, 0.12 * r, 20))
    B.add(loft(rings_), "helmet", "helmet", "helm_fed", "head")
    B.add(loft([ring((0, 0.005, 1.612), 0.128, 0.142, 20), ring((0, 0.005, 1.624), 0.124, 0.138, 20)]), "helmet", "helmet", "helm_fed", "head")
    # imperial: deep, a flared skirt over ears and nape, open face
    rings_ = []
    for z, rx, ry, front in ((1.54, 0.122, 0.13, 0.03), (1.6, 0.12, 0.128, -0.04), (1.65, 0.112, 0.124, -0.11), (1.72, 0.104, 0.118, -0.11), (1.77, 0.08, 0.09, -0.08), (1.795, 0.035, 0.04, -0.035)):
        pts = ring((0, 0.008, z), rx, ry, 20)
        for p in pts:
            if p.y < front:
                p.y = front  # the face opening
        rings_.append(pts)
    B.add(loft(rings_), "helmet", "helmet", "helm_imp", "head")
    for helm in ("helm_fed", "helm_imp"):
        for sx in (1, -1):
            B.add(box((sx * 0.072, -0.03, 1.50), (0.008, 0.012, 0.12), rot=(0, sx * -12, 0)), "leather", "keep", helm, "head")


# ---------------------------------------------------------------- armature
BONES = {}


def build_armature():
    arm = bpy.data.armatures.new("rig")
    ob = bpy.data.objects.new("SOLDIER", arm)
    COL.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.edit_bones

    def bone(name, head, tail, parent=None, z_axis=(0, -1, 0)):
        b = eb.new(name)
        b.head, b.tail = V(head), V(tail)
        b.align_roll(V(z_axis))
        if parent:
            b.parent = eb[parent]
            b.use_connect = False
        return b

    UP, DOWN, FWD = (0, -1, 0), (0, 1, 0), (0, 0, -1)  # z axes that make each bone's local X the world X
    bone("root", (0, 0, 0), (0, 0, 0.2), None, UP)
    bone("hips", (0, 0, 0.92), (0, 0, 1.0), "root", UP)
    bone("spine", (0, 0, 1.0), (0, 0, 1.18), "hips", UP)
    bone("chest", (0, 0, 1.18), (0, 0, 1.40), "spine", UP)
    bone("neck", (0, 0.01, 1.43), (0, 0.01, 1.5), "chest", UP)
    bone("head", (0, 0.01, 1.5), (0, 0.01, 1.72), "neck", UP)
    for s, sx in (("L", 1), ("R", -1)):
        bone(f"clavicle_{s}", (sx * 0.03, 0.0, 1.39), (sx * SH_X, 0.01, 1.39), "chest", UP)
        bone(f"shoulder_{s}", (sx * SH_X, 0.01, 1.385), (sx * EL.x, EL.y, EL.z), f"clavicle_{s}", DOWN)
        bone(f"elbow_{s}", (sx * EL.x, EL.y, EL.z), (sx * WR.x, WR.y, WR.z), f"shoulder_{s}", DOWN)
        bone(f"wrist_{s}", (sx * WR.x, WR.y, WR.z), (sx * 0.275, -0.005, 0.78), f"elbow_{s}", DOWN)
        bone(f"hip_{s}", (sx * HIP_X, 0, 0.88), (sx * 0.095, -0.01, H["knee"]), "hips", DOWN)
        bone(f"knee_{s}", (sx * 0.095, -0.01, H["knee"]), (sx * 0.097, 0.01, 0.10), f"hip_{s}", DOWN)
        bone(f"ankle_{s}", (sx * 0.097, 0.01, 0.10), (sx * 0.097, -0.11, 0.045), f"knee_{s}", FWD)
        bone(f"toe_{s}", (sx * 0.097, -0.11, 0.045), (sx * 0.097, -0.20, 0.04), f"ankle_{s}", FWD)
    bpy.ops.object.mode_set(mode="OBJECT")
    return ob


# ---------------------------------------------------------------- assembly: one mesh, weights, meta UVs
def assemble(rig):
    """The body takes automatic weights from the armature; parts that follow the body (collar, skirt,
    belt, cuffs) copy the body's weights from the nearest surface; the rest ride rigidly on one bone.
    Then everything is joined into one mesh."""
    objs = []
    for idx, (bm, color, slot, piece, bone, smooth) in enumerate(B.parts):
        me = bpy.data.meshes.new(f"part{idx}")
        bm.to_mesh(me)
        bm.free()
        for p in me.polygons:
            p.use_smooth = smooth
        ca = me.color_attributes.new("Col", "FLOAT_COLOR", "CORNER")
        me.uv_layers.new(name="UVMap")
        meta = me.uv_layers.new(name="meta")
        for poly in me.polygons:
            if callable(color):
                cname, sname = color(tuple(poly.center))
                c, sl = srgb(COLOR[cname]) + [1.0], SLOT[sname]
            else:
                c, sl = srgb(COLOR[color]) + [1.0], slot
            for li in poly.loop_indices:
                ca.data[li].color = c
                meta.data[li].uv = (sl + 0.5, piece + 0.5)
        ob = bpy.data.objects.new(f"part{idx}", me)
        COL.objects.link(ob)
        objs.append((ob, bone))
    body = next(o for o, b in objs if b == "@body")
    follow = [o for o, b in objs if b is None]
    rigid = [(o, b) for o, b in objs if b not in (None, "@body")]

    def only(*obs, active=None):
        bpy.ops.object.select_all(action="DESELECT")
        for o in obs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = active or obs[0]

    only(body, rig, active=rig)
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    names = [b.name for b in rig.data.bones]
    for o in follow:
        for n in names:
            o.vertex_groups.new(name=n)
        mod = o.modifiers.new("dt", "DATA_TRANSFER")
        mod.object = body
        mod.use_vert_data = True
        mod.data_types_verts = {"VGROUP_WEIGHTS"}
        mod.vert_mapping = "POLYINTERP_NEAREST"
        mod.layers_vgroup_select_src = "ALL"
        mod.layers_vgroup_select_dst = "NAME"
        only(o)
        bpy.ops.object.modifier_apply(modifier="dt")
    for o, b in rigid:
        vg = o.vertex_groups.new(name=b)
        vg.add([v.index for v in o.data.vertices], 1.0, "REPLACE")
    only(body, *follow, *[o for o, _ in rigid], active=body)
    bpy.ops.object.join()
    body.name = "soldier"
    body.data.name = "soldier"
    # glTF wants at most 4 influences per vertex, normalised
    only(body)
    bpy.ops.object.vertex_group_limit_total(limit=4)
    bpy.ops.object.vertex_group_normalize_all(lock_active=False)
    m = bpy.data.materials.new("M_soldier")
    m.use_nodes = True
    body.data.materials.append(m)
    return body


# ---------------------------------------------------------------- animation
FPS = 30


def key_pose(rig, action_name, length, keys, loop=True, hips=None):
    """keys: {bone: [(t 0..1, (x, y, z) degrees), ...]}; hips: [(t, (dx, dy, dz) metres in world axes)].
    Rotations are local Euler XYZ on the rest pose (X = the world X axis for every limb)."""
    act = bpy.data.actions.new(action_name)
    rig.animation_data_create()
    rig.animation_data.action = act
    frames = round(length * FPS)
    for name, ks in keys.items():
        pb = rig.pose.bones[name]
        pb.rotation_mode = "XYZ"
        for t, (x, y, z) in ks:
            pb.rotation_euler = (math.radians(x), math.radians(y), math.radians(z))
            pb.keyframe_insert("rotation_euler", frame=1 + t * frames)
    if hips:
        pb = rig.pose.bones["hips"]
        for t, (dx, dy, dz) in hips:
            # hips local axes: x = world X, y = world up, z = world forward (-Y)
            pb.location = (dx, dz, -dy)
            pb.keyframe_insert("location", frame=1 + t * frames)
    if loop:
        for fc in getattr(act, "fcurves", []):
            for kp in fc.keyframe_points:
                kp.interpolation = "BEZIER"
    track = rig.animation_data.nla_tracks.new()
    track.name = action_name
    track.strips.new(action_name, 1, act)
    rig.animation_data.action = None
    for pb in rig.pose.bones:
        pb.rotation_euler = (0, 0, 0)
        pb.location = (0, 0, 0)


def cycle(points):
    """[(t, value)] -> same with t=1 repeating t=0, for seamless loops."""
    return points + [(1.0, points[0][1])]


def gait(stride, knee_swing, knee_load, lean, bob, arm, run=False):
    """A two-step cycle. Left leg: contact at 0, passing at 0.25, contact (other) at 0.5, passing at 0.75."""
    def leg(phase):
        sh = lambda t: (t + phase) % 1.0
        th = [(0.0, (-stride, 0, 0)), (0.12, (-stride * 0.6, 0, 0)), (0.5, (stride, 0, 0)), (0.62, (stride * 0.6, 0, 0)), (0.78, (-stride * 0.1, 0, 0))]
        kn = [(0.0, (5, 0, 0)), (0.1, (knee_load, 0, 0)), (0.4, (8, 0, 0)), (0.62, (knee_swing * 0.8, 0, 0)), (0.75, (knee_swing, 0, 0)), (0.92, (20, 0, 0))]
        an = [(0.0, (-12, 0, 0)), (0.1, (2, 0, 0)), (0.45, (12, 0, 0)), (0.58, (25 if run else 18, 0, 0)), (0.78, (-5, 0, 0))]
        res = {}
        for name, ks in (("hip", th), ("knee", kn), ("ankle", an)):
            pts = sorted(((sh(t) if phase else t), v) for t, v in ks)
            if pts[0][0] > 0:
                pts = [(0.0, pts[-1][1])] + pts
            res[name] = cycle(pts)
        return res
    L, R = leg(0.0), leg(0.5)
    keys = {f"hip_L": L["hip"], "knee_L": L["knee"], "ankle_L": L["ankle"], "hip_R": R["hip"], "knee_R": R["knee"], "ankle_R": R["ankle"]}
    keys["spine"] = cycle([(0.0, (lean * 0.5, 4, 0)), (0.5, (lean * 0.5, -4, 0))])
    keys["chest"] = cycle([(0.0, (lean * 0.5, -6, 0)), (0.5, (lean * 0.5, 6, 0))])
    keys["neck"] = cycle([(0.0, (-lean * 0.7, 2, 0)), (0.5, (-lean * 0.7, -2, 0))])
    keys["shoulder_L"] = cycle([(0.0, (arm, 0, -8)), (0.5, (-arm, 0, -8))])
    keys["shoulder_R"] = cycle([(0.0, (-arm, 0, 8)), (0.5, (arm, 0, 8))])
    keys["elbow_L"] = cycle([(0.0, (-20 - arm * 0.5, 0, 0)), (0.5, (-25, 0, 0))])
    keys["elbow_R"] = cycle([(0.0, (-25, 0, 0)), (0.5, (-20 - arm * 0.5, 0, 0))])
    hips = cycle([(0.0, (0, 0, -bob)), (0.25, (0, 0, bob)), (0.5, (0, 0, -bob)), (0.75, (0, 0, bob))])
    keys["hips"] = cycle([(0.0, (0, 6, 2)), (0.25, (0, 0, 0)), (0.5, (0, -6, -2)), (0.75, (0, 0, 0))])
    return keys, hips


def build_actions(rig):
    walk, wh = gait(24, 60, 15, 6, 0.025, 18)
    key_pose(rig, "walk", 1.0, walk, hips=wh)
    run, rh = gait(40, 105, 25, 16, 0.05, 30, run=True)
    key_pose(rig, "run", 0.66, run, hips=rh)
    # crouched walk: low hips, knees always bent, leaning in
    cw, ch = gait(26, 80, 40, 28, 0.02, 10)
    for s in "LR":
        cw[f"knee_{s}"] = [(t, (v[0] + 45, 0, 0)) for t, v in cw[f"knee_{s}"]]
        cw[f"hip_{s}"] = [(t, (v[0] - 30, 0, 0)) for t, v in cw[f"hip_{s}"]]
        cw[f"ankle_{s}"] = [(t, (v[0] - 15, 0, 0)) for t, v in cw[f"ankle_{s}"]]
    ch = [(t, (dx, dy, dz - 0.22)) for t, (dx, dy, dz) in ch]
    key_pose(rig, "crouch_walk", 0.9, cw, hips=ch)
    # idle: breathing and a slow weight shift
    idle = {
        "chest": cycle([(0.0, (-2, 0, 0)), (0.5, (1, 0, 0))]),
        "spine": cycle([(0.0, (2, 0, 1)), (0.5, (2, 0, -1))]),
        "hip_L": cycle([(0.0, (-2, 0, 2)), (0.5, (-2, 0, 3))]),
        "hip_R": cycle([(0.0, (2, 0, -3)), (0.5, (2, 0, -2))]),
        "knee_L": cycle([(0.0, (4, 0, 0)), (0.5, (8, 0, 0))]),
        "knee_R": cycle([(0.0, (6, 0, 0)), (0.5, (3, 0, 0))]),
        "ankle_L": cycle([(0.0, (-2, 0, 0)), (0.5, (-4, 0, 0))]),
        "ankle_R": cycle([(0.0, (-4, 0, 0)), (0.5, (-2, 0, 0))]),
        "shoulder_L": cycle([(0.0, (0, 0, -8)), (0.5, (2, 0, -8))]),
        "shoulder_R": cycle([(0.0, (0, 0, 8)), (0.5, (2, 0, 8))]),
    }
    key_pose(rig, "idle", 3.0, idle, hips=cycle([(0.0, (0.005, 0, -0.005)), (0.5, (-0.005, 0, 0))]))
    # crouch: hips low, both knees bent (a squat ready to move)
    crouch = {
        "hip_L": [(0, (-75, 0, 6))], "hip_R": [(0, (-60, 0, -6))],
        "knee_L": [(0, (100, 0, 0))], "knee_R": [(0, (110, 0, 0))],
        "ankle_L": [(0, (-25, 0, 0))], "ankle_R": [(0, (-35, 0, 0))],
        "spine": [(0, (18, 0, 0))], "neck": [(0, (-14, 0, 0))],
    }
    key_pose(rig, "crouch", 0.5, crouch, loop=False, hips=[(0, (0, 0, -0.34))])
    # kneel: the right knee down, the left foot planted
    kneel = {
        "hip_L": [(0, (-80, 0, 6))], "knee_L": [(0, (88, 0, 0))], "ankle_L": [(0, (-6, 0, 0))],
        "hip_R": [(0, (-10, 0, -6))], "knee_R": [(0, (110, 0, 0))], "ankle_R": [(0, (40, 0, 0))], "toe_R": [(0, (-45, 0, 0))],
        "spine": [(0, (8, 0, 0))],
    }
    key_pose(rig, "kneel", 0.5, kneel, loop=False, hips=[(0, (0, 0, -0.43))])
    # a hit: the body jerks back and recovers
    hit = {"spine": [(0, (0, 0, 0)), (0.25, (-14, 0, 4)), (1, (0, 0, 0))], "chest": [(0, (0, 0, 0)), (0.25, (-10, 3, 0)), (1, (0, 0, 0))], "neck": [(0, (0, 0, 0)), (0.3, (12, 0, 0)), (1, (0, 0, 0))]}
    key_pose(rig, "hit", 0.45, hit, loop=False)
    # falling: on the back (downed), face down (dead)
    for name, sign in (("fall_back", -1), ("fall_front", 1)):
        fall = {
            "hips": [(0, (0, 0, 0)), (0.35, (sign * 25, 0, 0)), (1, (sign * 88, 0, 0))],
            "spine": [(0, (0, 0, 0)), (0.3, (-sign * 15, 0, 0)), (1, (sign * 4, 0, 0))],
            "hip_L": [(0, (0, 0, 0)), (0.4, (-30, 0, 5)), (1, (-6 if sign > 0 else -35, 0, 8))],
            "hip_R": [(0, (0, 0, 0)), (0.4, (-10, 0, -5)), (1, (-3 if sign > 0 else -20, 0, -10))],
            "knee_L": [(0, (0, 0, 0)), (0.4, (60, 0, 0)), (1, (10 if sign > 0 else 70, 0, 0))],
            "knee_R": [(0, (0, 0, 0)), (0.4, (40, 0, 0)), (1, (6 if sign > 0 else 35, 0, 0))],
            "shoulder_L": [(0, (0, 0, 0)), (0.5, (-60, 0, -30)), (1, (-20, 0, -50))],
            "shoulder_R": [(0, (0, 0, 0)), (0.5, (-40, 0, 30)), (1, (10, 0, 45))],
            "elbow_L": [(0, (0, 0, 0)), (1, (-40, 0, 0))],
            "elbow_R": [(0, (0, 0, 0)), (1, (-20, 0, 0))],
            "neck": [(0, (0, 0, 0)), (1, (sign * -10, 25 * sign, 0))],
        }
        drop = [(0, (0, 0, 0)), (0.35, (0, -sign * 0.15, -0.25)), (0.75, (0, -sign * 0.5, -0.72)), (1, (0, -sign * 0.55, -0.76))]
        key_pose(rig, name, 0.7, fall, loop=False, hips=drop)


def build_all():
    build_body()
    build_head()
    build_hair()
    build_uniform()
    build_kit()
    build_helmets()
    rig = build_armature()
    body = assemble(rig)
    build_actions(rig)
    return rig, body


def export(path):
    bpy.ops.object.select_all(action="DESELECT")
    for o in bpy.data.objects:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_yup=True, export_apply=False,
                              export_animations=True, export_animation_mode="NLA_TRACKS", export_skins=True,
                              export_vertex_color="ACTIVE", export_all_vertex_colors=False, export_texcoords=True,
                              export_normals=True, export_cameras=False, export_lights=False)


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    rig, body = build_all()
    tris = sum(len(p.vertices) - 2 for p in body.data.polygons)
    print(f"soldier vc: {tris} triangles, {len(body.data.vertices)} verts, {len(rig.data.bones)} bones, {len(bpy.data.actions)} actions")
    if argv:
        export(argv[0])
        print("exported", argv[0])
