"""Skirmish soldier v2, after the look of Valkyria Chronicles (PS3): a slim, smooth, mid-poly figure
for toon shading (about 7.5 heads, 1.72 m), anime face (large painted-shape eyes, small nose and
mouth), clumped hair, a field tunic with a short skirt, trousers into boots, webbing and helmets.

One skinned mesh on one armature, so each soldier is one draw call. Per-vertex data the game
reads (src/skirmish/units/vcSoldiers.js), in its only UV map ("meta", TEXCOORD_0):
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


def hexof(name):
    """A colour by name (COLOR, SHADE) or as '#rrggbb'."""
    return COLOR.get(name) or SHADE.get(name) or name


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
LOD = 0  # 0: the close model; 1: the far model (fewer segments, no small details)


def lod(a, b):
    return a if LOD == 0 else b


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

# Slotted parts carry a shade in their vertex colour (white = the palette colour as is; greys make
# creases, seams and gradients that survive recolouring). Unslotted parts carry their real colour.
SHADE = {"white": "#FFFFFF", "fold": "#DCDCDC", "crease": "#A8A8A8", "seam": "#8A8A8A", "deep": "#6E6E6E"}


def body_skin():
    """The clothed body as one smooth surface: a vertex graph with radii for the Skin modifier
    (more nodes than before, so shoulders, elbows, calves and the chest have shape), subdivided."""
    me = bpy.data.meshes.new("body_graph")
    ob = bpy.data.objects.new("body_graph", me)
    COL.objects.link(ob)
    nodes = [
        ("pelvis", (0, 0.0, 0.93), 0.150, 0.105),
        ("waist", (0, 0.0, H["waist"]), 0.132, 0.094),
        ("ribs", (0, -0.004, 1.13), 0.142, 0.100),
        ("chest", (0, -0.008, H["chest"]), 0.152, 0.106),
        ("upper", (0, 0.0, 1.33), 0.162, 0.098),
        ("yoke", (0, 0.004, 1.395), 0.120, 0.080),
        ("neck0", (0, 0.01, 1.44), 0.050, 0.048),
        ("neck1", (0, 0.012, 1.505), 0.043, 0.043),
    ]
    for s, sx in (("L", 1), ("R", -1)):
        nodes += [
            (f"sh{s}", (sx * SH_X, 0.01, 1.382), 0.060, 0.058),
            (f"dl{s}", (sx * 0.202, 0.014, 1.30), 0.050, 0.052),  # deltoid
            (f"bi{s}", (sx * 0.222, 0.018, 1.21), 0.044, 0.046),
            (f"el{s}", (sx * EL.x, EL.y, EL.z), 0.038, 0.040),
            (f"fa{s}", (sx * 0.248, 0.012, 1.03), 0.040, 0.037),
            (f"wr{s}", (sx * WR.x, WR.y, WR.z + 0.02), 0.028, 0.025),
            (f"hp{s}", (sx * HIP_X, 0.0, 0.86), 0.086, 0.086),
            (f"th{s}", (sx * 0.092, -0.008, 0.70), 0.078, 0.076),
            (f"tl{s}", (sx * 0.094, -0.01, 0.58), 0.064, 0.064),
            (f"kn{s}", (sx * 0.095, -0.012, H["knee"]), 0.056, 0.058),
            (f"cf{s}", (sx * 0.096, 0.004, 0.38), 0.058, 0.060),  # calf
            (f"sn{s}", (sx * 0.097, 0.0, 0.27), 0.058, 0.058),  # boot top
            (f"an{s}", (sx * 0.097, 0.012, 0.11), 0.050, 0.056),
            (f"ft{s}", (sx * 0.097, -0.10, 0.048), 0.050, 0.040),
            (f"tp{s}", (sx * 0.097, -0.19, 0.042), 0.042, 0.036),
        ]
    names = [n[0] for n in nodes]
    edges = [("pelvis", "waist"), ("waist", "ribs"), ("ribs", "chest"), ("chest", "upper"), ("upper", "yoke"), ("yoke", "neck0"), ("neck0", "neck1")]
    for s in "LR":
        edges += [("upper", f"sh{s}"), (f"sh{s}", f"dl{s}"), (f"dl{s}", f"bi{s}"), (f"bi{s}", f"el{s}"), (f"el{s}", f"fa{s}"), (f"fa{s}", f"wr{s}"),
                  ("pelvis", f"hp{s}"), (f"hp{s}", f"th{s}"), (f"th{s}", f"tl{s}"), (f"tl{s}", f"kn{s}"), (f"kn{s}", f"cf{s}"), (f"cf{s}", f"sn{s}"), (f"sn{s}", f"an{s}"), (f"an{s}", f"ft{s}"), (f"ft{s}", f"tp{s}")]
    me.from_pydata([n[1] for n in nodes], [(names.index(a), names.index(b)) for a, b in edges], [])
    sk = ob.modifiers.new("skin", "SKIN")
    sk.use_smooth_shade = True
    sk.branch_smoothing = 0.7
    for i, n in enumerate(nodes):
        me.skin_vertices[0].data[i].radius = (n[2], n[3])
    me.skin_vertices[0].data[0].use_root = True
    sub = ob.modifiers.new("sub", "SUBSURF")
    sub.levels = lod(2, 1)
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    mesh = bpy.data.meshes.new_from_object(ob.evaluated_get(deps))
    bpy.data.objects.remove(ob, do_unlink=True)
    bm = bmesh.new()
    bm.from_mesh(mesh)
    return bm


def body_slot(c):
    """Colour (shade) and slot of a body face, from its centre: skin above the collar, boots below
    the boot tops, trousers to the tunic's hem, the tunic above; seams darken along the sides."""
    x, y, z = c
    if z > 1.455:
        return "white", "skin"
    if abs(x) > 0.25 and z < 0.875:
        return "white", "skin"  # wrists
    if z < 0.29:
        # boot: a darker sole band and toe cap
        return ("deep" if z < 0.03 else "fold" if y < -0.12 else "white"), "boots"
    if z < 0.93:
        crease = abs(abs(x) - 0.095) < 0.012 and y < -0.05 and z > 0.3  # pressed trouser crease
        return ("crease" if crease else "white"), "pants"
    side = abs(y) < 0.012 and abs(x) > 0.12 and z < 1.38  # side seams
    return ("seam" if side else "white"), "tunic"


def build_body():
    B.add(body_skin(), body_slot, "skin", "always", "@body", True)
    build_hands()


# ---------------------------------------------------------------- hands with fingers, gripping
def finger(bm_list, base, along, curl_axis, lengths, r0, curl):
    """A tapered finger from base: segments along `along`, each bent by `curl` (radians) about curl_axis."""
    d = V(along).normalized()
    p = V(base)
    rings_ = []
    radius = r0
    ax = V(curl_axis).normalized()
    for k, L in enumerate(lengths):
        n = d.orthogonal().normalized()
        w = d.cross(n)
        rings_.append([p + (n * math.cos(i * TAU / 7) + w * math.sin(i * TAU / 7)) * radius for i in range(7)])
        p = p + d * L
        d = Matrix.Rotation(curl, 3, ax) @ d
        radius *= 0.86
    n = d.orthogonal().normalized()
    w = d.cross(n)
    rings_.append([p + (n * math.cos(i * TAU / 7) + w * math.sin(i * TAU / 7)) * radius * 0.7 for i in range(7)])
    bm_list.append(loft(rings_))


def build_hands():
    if LOD:
        for s, sx in (("L", 1), ("R", -1)):
            B.add(ellipsoid((sx * WR.x, WR.y - 0.01, WR.z - 0.07), (0.022, 0.04, 0.06), 8, 6), "white", "skin", "always", f"wrist_{s}")
        return
    for s, sx in (("L", 1), ("R", -1)):
        w = V((sx * WR.x, WR.y, WR.z))
        parts = []
        # the palm hangs below the wrist, its inside facing the body, fingers curled forward round a grip
        palm_c = w + V((sx * 0.004, -0.004, -0.05))
        palm = ellipsoid(palm_c, (0.017, 0.038, 0.045), 10, 8)
        parts.append(palm)
        for i, (dy, L) in enumerate(((-0.026, 0.026), (-0.009, 0.029), (0.008, 0.028), (0.024, 0.022))):
            base = w + V((sx * 0.004, dy, -0.088))
            finger(parts, base, (0, 0, -1), (1, 0, 0), (L, L * 0.75, L * 0.6), 0.0085, -0.9)  # curled forward round a grip
        thumb_base = w + V((-sx * 0.006, -0.028, -0.035))
        finger(parts, thumb_base, (-sx * 0.3, -0.7, -0.6), (0, 0, 1), (0.024, 0.02), 0.0095, 0.5 * sx)
        for bm in parts:
            B.add(bm, "white", "skin", "always", f"wrist_{s}")
        # glove cuff
        B.add(loft([ring((sx * WR.x, WR.y, WR.z + 0.012), 0.030, 0.027, 12), ring((sx * WR.x, WR.y, WR.z - 0.012), 0.029, 0.026, 12)]), "fold", "tunic", "always", f"wrist_{s}")


# ---------------------------------------------------------------- head: a sculpted anime head
HEAD_C = V((0, 0.0, H["head"]))


def build_head():
    bm = ellipsoid(HEAD_C, (0.087, 0.097, 0.110), segs=lod(28, 14), rings=lod(20, 10))
    for v in bm.verts:
        d = v.co - HEAD_C
        u = d.z / 0.110  # -1 chin .. 1 crown
        front = -d.y / 0.097  # 1 at the face
        if u < 0.05:
            # the jaw narrows to a small pointed chin; the cheeks stay soft
            t = (-u + 0.05) / 1.05
            k = 1.0 - 0.52 * t ** 1.5
            v.co.x = HEAD_C.x + d.x * k
            if front > 0:
                v.co.y = HEAD_C.y + d.y * (1.0 - 0.18 * t) - 0.012 * t
            else:
                v.co.y = HEAD_C.y + d.y * (1.0 - 0.45 * t ** 1.2)
        if front > 0.55 and -0.35 < u < 0.45:
            v.co.y += 0.008 * (front - 0.55)  # a flatter face plane
        # the bridge of a small nose
        g = math.exp(-((d.x / 0.012) ** 2) - (((d.z + 0.018) / 0.022) ** 2))
        if front > 0.7:
            v.co.y -= 0.012 * g
        # the back of the skull rounder and fuller
        if front < -0.2 and u > -0.2:
            v.co.y += 0.006 * (-front - 0.2)
    B.add(bm, "white", "skin", "always", "head")
    for sx in (1, -1):
        ear = ellipsoid((sx * 0.084, 0.01, H["head"] - 0.01), (0.011, 0.024, 0.033), 10, 8)
        B.add(ear, "fold", "skin", "always", "head")
    # nose tip shadow and mouth
    B.add(disc(0.0, 1.565, 0.010, 0.006, rings=1, segs=8), "#D49A82", "keep", "always", "head", False)
    build_face()


def face_y(x, z):
    """Front surface of the head at (x, z)."""
    d = (x / 0.087) ** 2 + ((z - HEAD_C.z) / 0.110) ** 2
    y = HEAD_C.y - 0.097 * math.sqrt(max(0.0, 1 - d))
    if z < HEAD_C.z:
        t = (HEAD_C.z - z) / 0.110
        y = HEAD_C.y + (y - HEAD_C.y) * (1.0 - 0.18 * t) - 0.012 * t
    return y - 0.008 * 0.45 - 0.0015


def disc(x, z, w, h, rings=3, segs=16, shape=None, lift=0.0, color_fn=None):
    """A patch lying on the face: concentric rings round (x, z), following the face's curve, facing out.
    shape(a, px, pz) may reshape the outline; returns a bmesh (faces keep a 'z' for gradients)."""
    bm = bmesh.new()
    # every ring (and the centre) is a scaled copy of the shaped outline round the outline's own
    # middle, so a shape that moves the outline (a lash above the eye) carries its centre along
    outline = []
    for i in range(segs):
        a = i * TAU / segs
        px, pz = math.cos(a) * w / 2, math.sin(a) * h / 2
        if shape:
            px, pz = shape(a, px, pz)
        outline.append((px, pz))
    mx = sum(p[0] for p in outline) / segs
    mz = sum(p[1] for p in outline) / segs
    at = lambda px, pz: V((x + px, face_y(x + px, z + pz) - lift, z + pz))
    centre = bm.verts.new(at(mx, mz))
    prev = None
    for r in range(1, rings + 1):
        k = r / rings
        cur = [bm.verts.new(at(mx + (px - mx) * k, mz + (pz - mz) * k)) for px, pz in outline]
        for i in range(segs):
            j = (i + 1) % segs
            if prev is None:
                bm.faces.new([centre, cur[i], cur[j]])
            else:
                bm.faces.new([prev[i], cur[i], cur[j], prev[j]])
        prev = cur
    for f in bm.faces:
        f.normal_update()
        if f.normal.y > 0:
            f.normal_flip()
    return bm


def build_face():
    ez = 1.582
    for sx in (1, -1):
        ex = sx * 0.035
        almond = lambda a, px, pz: (px, pz * (1.0 if pz > 0 else 0.72) + 0.002 * math.cos(a) * sx)
        # sclera: white, shaded under the upper lid
        B.add(disc(ex, ez, 0.040, 0.036, 3, 16, almond, 0.0005), lambda c: ("#FFFFFF" if c[2] < ez + 0.006 else "#D8DCE4", "keep"), "keep", "eyes_open", "head", False)
        # iris: dark at the top, light at the bottom (shades of the soldier's eye colour)
        def iris_shade(c, ez=ez):
            t = min(1.0, max(0.0, (c[2] - (ez - 0.016)) / 0.032))
            g = int(255 - 150 * t ** 1.3)
            return f"#{g:02X}{g:02X}{g:02X}", "iris"
        B.add(disc(ex + sx * 0.002, ez - 0.002, 0.024, 0.030, 4, 18, lift=0.0012), iris_shade, "iris", "eyes_open", "head", False)
        B.add(disc(ex + sx * 0.002, ez - 0.001, 0.010, 0.013, 2, 12, lift=0.0018), "#1A1A22", "keep", "eyes_open", "head", False)
        if LOD:
            B.add(disc(ex, ez + 0.012, 0.04, 0.012, 1, 10, lift=0.0028), "#2A2119", "keep", "eyes_open", "head", False)
            continue
        B.add(disc(ex - sx * 0.004, ez + 0.007, 0.008, 0.008, 1, 10, lift=0.0024), "#FFFFFF", "keep", "eyes_open", "head", False)
        B.add(disc(ex + sx * 0.006, ez - 0.009, 0.004, 0.004, 1, 8, lift=0.0024), "#FFFFFF", "keep", "eyes_open", "head", False)
        # the heavy upper lash line with a flick at the outer corner, a thin lower lash, a lid crease
        lash = lambda a, px, pz: (px * 1.14 + (sx * 0.004 if px * sx > 0 else 0), 0.016 + pz * 0.3 + (0.003 if px * sx > 0.012 else 0))
        B.add(disc(ex, ez, 0.040, 0.016, 2, 14, lash, 0.0028), "#2A2119", "keep", "eyes_open", "head", False)
        low = lambda a, px, pz: (px * 0.8, -0.0165 + pz * 0.15)
        B.add(disc(ex + sx * 0.003, ez, 0.026, 0.008, 1, 10, low, 0.002), "#6A4A3A", "keep", "eyes_open", "head", False)
        crease = lambda a, px, pz: (px * 1.0, 0.026 + pz * 0.12 + 0.002 * math.cos(px / 0.02))
        B.add(disc(ex, ez, 0.034, 0.008, 1, 10, crease, 0.0015), "#B88A70", "keep", "eyes_open", "head", False)
        # closed: a curved lash line
        shut = lambda a, px, pz: (px * 1.12, -0.001 + pz * 0.22 + 0.007 * math.cos(px / 0.02))
        B.add(disc(ex, ez, 0.040, 0.012, 1, 12, shut, 0.0028), "#2A2119", "keep", "eyes_closed", "head", False)
        # brows: thin tapered arcs in the hair colour
        brow = lambda a, px, pz: (px, pz * (0.45 - 0.25 * (px * sx + 0.02) / 0.04) + 0.005 * math.cos(px / 0.022))
        B.add(disc(sx * 0.038, 1.617, 0.040, 0.010, 1, 12, brow, 0.0015), "fold", "hair", "always", "head", False)
        B.add(disc(sx * 0.050, 1.556, 0.020, 0.010, 2, 10, lift=0.0008), "#F2B4A4", "keep", "always", "head", False)  # blush
    mouth = lambda a, px, pz: (px, pz * 0.4 + 0.0015 * math.cos(px / 0.008))
    B.add(disc(0, 1.532, 0.020, 0.006, 1, 10, mouth, 0.0015), "#A85A50", "keep", "always", "head", False)


# ---------------------------------------------------------------- hair: flat curved locks
def scalp_point(theta, phi, grow=0.012):
    """A point on the cranium (theta around from the front, phi up from the equator)."""
    r = (0.087 + grow, 0.097 + grow, 0.110 + grow)
    return V((HEAD_C.x + math.sin(theta) * math.cos(phi) * r[0], HEAD_C.y - math.cos(theta) * math.cos(phi) * r[1], HEAD_C.z + math.sin(phi) * r[2]))


def hair_cap(piece, low_back=0.0, fringe_z=1.64, n=24):
    """A smooth shell over the top and back of the head: the base every style builds on."""
    rings_ = []
    for k, phi in enumerate((-0.2 - low_back, 0.1, 0.45, 0.8, 1.15, 1.45)):
        pts = []
        for i in range(n):
            th = i * TAU / n
            p = scalp_point(th, phi, 0.008 + 0.004 * k)
            if math.cos(th) > 0.3 and p.z < fringe_z:
                p.z = fringe_z + (p.z - fringe_z) * 0.15
                p.y -= 0.004
            pts.append(p)
        rings_.append(pts)
    B.add(loft(rings_), "white", "hair", piece, "head")


def lock(piece, theta, phi, length, flow, width=0.03, thick=0.012, bend=0.5, shade="white", twist=0.0):
    global LOCKS
    LOCKS += 1
    if LOD and LOCKS % 3:
        return  # the far model keeps every third lock, a little wider
    if LOD:
        width *= 1.4
    """A lock of hair: a flat, tapering ribbon of lens-shaped sections along a curve that leaves the
    scalp along its surface, then falls in the `flow` direction (a vector) as it bends."""
    root = scalp_point(theta, phi, 0.006)
    normal = (root - HEAD_C).normalized()
    flow = V(flow).normalized()
    start_dir = (flow - normal * flow.dot(normal)).normalized() if abs(flow.dot(normal)) < 0.98 else normal.orthogonal()
    p0 = root
    p1 = root + start_dir * length * 0.45 + normal * length * 0.18
    p2 = root + start_dir * length * (1 - bend * 0.3) + flow * length * bend * 0.6 + normal * length * 0.05
    rings_ = []
    steps = lod(6, 3)
    for k in range(steps + 1):
        t = k / steps
        p = p0 * (1 - t) ** 2 + p1 * 2 * t * (1 - t) + p2 * t * t
        tan = ((p1 - p0) * 2 * (1 - t) + (p2 - p1) * 2 * t).normalized()
        side = tan.cross(normal).normalized()
        if side.length < 1e-6:
            side = tan.orthogonal().normalized()
        side = Matrix.Rotation(twist * t, 3, tan) @ side
        up = side.cross(tan).normalized()
        w = width * (1 - t ** 1.4) * (1.0 if t > 0.05 else 0.8) + 0.0015
        th = thick * (1 - t) + 0.001
        sec = []
        for i in range(6):
            a = i * TAU / 6
            sec.append(p + side * math.cos(a) * w + up * math.sin(a) * th)
        rings_.append(sec)
    B.add(loft(rings_), shade, "hair", piece, "head")


LOCKS = 0
DOWN = V((0, 0, -1))
FRONT = V((0, -1, 0))
BACK = V((0, 1, 0))


def build_hair():
    # 1: short and spiky, swept up and back
    hair_cap("hair1")
    for i in range(16):
        th = -1.1 + i * (2.2 / 15) + rng.uniform(-0.05, 0.05)
        lock("hair1", th, 0.95 + 0.25 * rng.random(), 0.09 + 0.03 * rng.random(), (math.sin(th) * 0.4, 0.6, 0.7), 0.026, 0.011, 0.2, "white" if i % 3 else "fold")
    for i in range(9):
        th = math.pi + (i - 4) * 0.28
        lock("hair1", th, 0.55, 0.08, (math.sin(th) * 0.3, 0.5, -0.8), 0.028, 0.011, 0.6)
    for i in range(7):
        th = -0.55 + i * 0.18
        lock("hair1", th, 0.62, 0.05, (math.sin(th) * 0.6, -0.4, -0.6), 0.024, 0.010, 0.5, "fold" if i % 2 else "white", twist=0.3)
    # 2: a long swept fringe, longer at the sides
    hair_cap("hair2")
    for i in range(11):
        th = -0.75 + i * 0.15
        lock("hair2", th, 0.66, 0.075, (0.7, -0.3, -0.6), 0.03, 0.011, 0.55, "fold" if i % 3 == 0 else "white", twist=0.4)
    for s in (1, -1):
        for i in range(6):
            lock("hair2", s * (1.25 + i * 0.22), 0.3, 0.1, (s * 0.2, 0.2, -1.0), 0.028, 0.011, 0.85)
    for i in range(10):
        th = math.pi + (i - 4.5) * 0.25
        lock("hair2", th, 0.45, 0.1, (0, 0.4, -0.9), 0.03, 0.012, 0.7)
    # 3: a chin-length bob with a straight fringe
    hair_cap("hair3", low_back=0.3)
    for i in range(24):
        th = math.pi * 0.32 + i * (math.pi * 1.36 / 23)
        lock("hair3", th, 0.35, 0.15, (math.sin(th) * 0.25, -math.cos(th) * 0.25, -1.0), 0.032, 0.012, 0.95, "fold" if i % 4 == 0 else "white")
    for i in range(10):
        th = -0.6 + i * 0.133
        lock("hair3", th, 0.68, 0.058, (0, -0.35, -1), 0.026, 0.010, 0.8, "white")
    # 4: tied back in a ponytail, a few strands framing the face
    hair_cap("hair4", low_back=0.1)
    for i in range(8):
        th = -0.5 + i * 0.14
        lock("hair4", th, 0.66, 0.055, (0, 0.5, -0.4), 0.026, 0.010, 0.4)
    for s in (1, -1):
        lock("hair4", s * 0.85, 0.35, 0.13, (s * 0.1, -0.2, -1), 0.016, 0.008, 0.95, "fold")
    tie = scalp_point(math.pi, 0.35, 0.012)
    B.add(ellipsoid(tie, (0.022, 0.022, 0.022), 10, 8), "fold", "hair", "hair4", "head")
    for k in range(5):
        a = k * TAU / 5
        base = tie + V((math.cos(a) * 0.01, 0.012, math.sin(a) * 0.01))
        B.add(loft([ring(base, 0.02, 0.016, 7), ring(base + V((0, 0.05, -0.08)), 0.018, 0.014, 7), ring(base + V((0, 0.07, -0.2)), 0.012, 0.01, 7), ring(base + V((0, 0.06, -0.28)), 0.002, 0.002, 7)]), "white" if k % 2 else "fold", "hair", "hair4", "head")
    # 5: close crop (also what shows under a helmet)
    hair_cap("hair5")
    for i in range(12):
        th = -1.0 + i * 0.18
        lock("hair5", th, 0.75, 0.045, (0, -0.2, -0.6), 0.022, 0.008, 0.4)


# ---------------------------------------------------------------- uniform details, kit, helmets
def strip(path, width, height, n=4):
    """A thin raised band along a path of points (seams, piping, straps)."""
    rings_ = []
    for k, p in enumerate(path):
        p = V(p)
        q = V(path[min(k + 1, len(path) - 1)]) - V(path[max(k - 1, 0)])
        q.normalize()
        side = q.cross(V((0, 0, 1)) if abs(q.z) < 0.9 else V((1, 0, 0))).normalized()
        up = side.cross(q).normalized()
        rings_.append([p + side * math.cos(i * TAU / n + math.pi / n) * width + up * math.sin(i * TAU / n + math.pi / n) * height for i in range(n)])
    return loft(rings_)


def tunic_front(z):
    """The tunic's front surface y at the centre line, roughly."""
    return -0.1 - 0.008 * math.exp(-((z - 1.22) / 0.08) ** 2)


def build_uniform():
    # stand collar with pointed tabs, the scarf knotted at the throat
    B.add(loft([ring((0, 0.008, 1.425), 0.062, 0.058, 18), ring((0, 0.010, 1.472), 0.058, 0.054, 18)]), "fold", "tunic", "always", None)
    for sx in (1, -1):
        # collar patches: small flat rectangles lying on the collar's front
        ang = math.radians(-90 + sx * 38)
        cx, cy = math.cos(ang) * 0.062, 0.008 + math.sin(ang) * 0.058
        nx, ny = math.cos(ang), math.sin(ang)
        tx, ty = -ny, nx
        B.add(hull([V((cx + nx * d + tx * u, cy + ny * d + ty * u, z)) for d in (0.0, 0.004) for u in (-0.016, 0.016) for z in (1.43, 1.462)]), "crease", "tunic", "always", None)
    B.add(loft([ring((0, 0.006, 1.412), 0.068, 0.064, 18), ring((0, 0.008, 1.44), 0.066, 0.062, 18)]), "white", "scarf", "always", None)
    B.add(ellipsoid((0.016, -0.07, 1.408), (0.026, 0.02, 0.024), 12, 8), "fold", "scarf", "always", None)
    for k, dx in enumerate((0.02, -0.004)):
        B.add(loft([ring((0.02 + dx, -0.082, 1.398), 0.018, 0.006, 8), ring((0.03 + dx * 1.5, -0.1, 1.33), 0.016, 0.005, 8), ring((0.036 + dx * 2, -0.104, 1.27), 0.012, 0.004, 8)]), "white" if k else "fold", "scarf", "always", None)
    # the tunic's skirt over the hips, flaring, with a back vent line
    B.add(loft([ring((0, 0.0, 0.99), 0.140, 0.102, 24), ring((0, 0.0, 0.90), 0.156, 0.114, 24), ring((0, 0.0, 0.83), 0.168, 0.124, 24)], cap=False), lambda c: ("seam" if abs(c[0]) < 0.006 and c[1] > 0 else "fold", "tunic"), "tunic", "always", "hips")
    # front placket and buttons, shoulder straps (epaulettes)
    B.add(strip([(0.012, tunic_front(z) - 0.002, z) for z in (1.40, 1.30, 1.20, 1.10, 1.02)], 0.014, 0.003), "crease", "tunic", "always", None)
    for z in (1.36, 1.27, 1.18, 1.09) if not LOD else ():
        B.add(ellipsoid((0.012, tunic_front(z) - 0.006, z), (0.0075, 0.004, 0.0075), 8, 5), "#C9A24A", "keep", "always", None)
    for sx in (1, -1):
        B.add(box((sx * 0.12, 0.006, 1.402), (0.10, 0.052, 0.012), rot=(0, sx * -16, 0)), "fold", "tunic", "always", None)
        B.add(ellipsoid((sx * 0.08, 0.004, 1.412), (0.006, 0.006, 0.004), 8, 5), "#C9A24A", "keep", "always", None)
        # breast pocket with a pointed flap and its button
        px = sx * 0.07
        B.add(box((px, -0.112, 1.235), (0.062, 0.008, 0.072)), "fold", "tunic", "always", None)
        B.add(hull([V((px + dx, -0.118, z)) for dx, z in ((-0.034, 1.285), (0.034, 1.285), (0.0, 1.258)) for _ in (0,)] + [V((px + dx, -0.110, z)) for dx, z in ((-0.034, 1.285), (0.034, 1.285), (0.0, 1.258))]), "crease", "tunic", "always", None)
        B.add(ellipsoid((px, -0.121, 1.264), (0.005, 0.003, 0.005), 8, 5), "#C9A24A", "keep", "always", None)
        # hip pockets on the skirt
        B.add(box((sx * 0.1, -0.122, 0.9), (0.07, 0.008, 0.07), rot=(0, 0, sx * -6)), "crease", "tunic", "always", "hips")
        # sleeve cuffs with a seam, boot tops, laces
        B.add(loft([ring((sx * 0.262, 0.004, 0.925), 0.034, 0.032, 14), ring((sx * 0.265, 0.004, 0.895), 0.033, 0.031, 14)]), "crease", "tunic", "always", None)
        B.add(loft([ring((sx * 0.097, 0.0, 0.272), 0.064, 0.064, 16), ring((sx * 0.097, 0.0, 0.30), 0.066, 0.066, 16)]), "fold", "boots", "always", None)
        for k in range(5 if not LOD else 0):
            z = 0.25 - k * 0.035
            B.add(box((sx * 0.097, -0.054 - k * 0.006, z), (0.03, 0.006, 0.005), rot=(20, 0, 0)), "#D8C8A8", "keep", "always", None)
        # trousers bloused over the boot tops
        B.add(loft([ring((sx * 0.097, 0.0, 0.29), 0.066, 0.066, 16), ring((sx * 0.097, 0.0, 0.33), 0.068, 0.068, 16), ring((sx * 0.097, 0.0, 0.36), 0.06, 0.06, 16)], cap=False), "fold", "pants", "always", None)
    # belt with buckle and holes
    B.add(loft([ring((0, 0.0, 0.985), 0.141, 0.101, 24), ring((0, 0.0, 1.03), 0.139, 0.099, 24)]), "#5A3E28", "keep", "always", None)
    B.add(box((0, -0.103, 1.008), (0.046, 0.008, 0.036)), "#C9A24A", "keep", "always", None)
    B.add(box((0, -0.107, 1.008), (0.028, 0.004, 0.02)), "#5A3E28", "keep", "always", None)


def build_kit():
    # base: Y-straps front and back, a canteen
    for sx in (1, -1):
        B.add(strip([(sx * 0.06, -0.104, 1.03), (sx * 0.075, -0.112, 1.18), (sx * 0.092, -0.098, 1.33), (sx * 0.1, -0.05, 1.395), (sx * 0.1, 0.05, 1.395), (sx * 0.09, 0.098, 1.33), (sx * 0.03, 0.104, 1.15)], 0.014, 0.004), "#B49A6A", "keep", "kit_base", "chest")
        B.add(ellipsoid((sx * 0.083, -0.113, 1.17), (0.008, 0.004, 0.008), 8, 5), "#8D8A80", "keep", "kit_base", "chest")
    B.add(ellipsoid((-0.15, 0.06, 0.95), (0.034, 0.045, 0.062), 12, 8), "#5A5E62", "keep", "kit_base", "hips")
    B.add(loft([ring((-0.15, 0.06, 1.01), 0.012, 0.012, 8), ring((-0.15, 0.06, 1.03), 0.012, 0.012, 8)]), "#2A2620", "keep", "kit_base", "hips")
    # pouches with flaps and snaps on the belt
    for x in (0.05, 0.1):
        for sx in (1, -1):
            B.add(box((sx * x, -0.114, 0.985), (0.046, 0.03, 0.052)), "#9C8558", "keep", "kit_pouches", "spine")
            B.add(box((sx * x, -0.13, 1.008), (0.05, 0.006, 0.026), rot=(-12, 0, 0)), "#86714A", "keep", "kit_pouches", "spine")
            B.add(ellipsoid((sx * x, -0.135, 0.998), (0.004, 0.003, 0.004), 6, 4), "#8D8A80", "keep", "kit_pouches", "spine")
    for sx in (1, -1):
        for dx in (0.0, 0.03):
            B.add(box((sx * (0.058 + dx), -0.122, 1.17), (0.026, 0.024, 0.11)), "#9C8558", "keep", "kit_mags", "chest")
            B.add(box((sx * (0.058 + dx), -0.135, 1.22), (0.028, 0.006, 0.03), rot=(-10, 0, 0)), "#86714A", "keep", "kit_mags", "chest")
    # packs with a rolled blanket, straps
    B.add(box((0, 0.15, 1.2), (0.22, 0.09, 0.21)), "#6E6A4A", "keep", "kit_pack_small", "chest")
    B.add(box((0, 0.198, 1.245), (0.2, 0.008, 0.11)), "#5E5A3E", "keep", "kit_pack_small", "chest")
    B.add(loft([ring((-0.12, 0.155, 1.335), 0.035, 0.035, 10), ring((0.12, 0.155, 1.335), 0.035, 0.035, 10)]), "#8A7A5A", "keep", "kit_pack_small", "chest")
    B.add(box((0, 0.17, 1.18), (0.26, 0.13, 0.28)), "#6E6A4A", "keep", "kit_pack_engineer", "chest")
    B.add(box((0, 0.237, 1.22), (0.22, 0.006, 0.18)), "#5E5A3E", "keep", "kit_pack_engineer", "chest")
    B.add(box((0, 0.25, 1.08), (0.2, 0.05, 0.08)), "#5A5E62", "keep", "kit_tools", "chest")
    B.add(cone((0.12, 0.25, 1.43), (-0.09, 0.25, 1.04), 0.012, 6), "#5A3E28", "keep", "kit_tools", "chest")
    B.add(box((0.13, 0.25, 1.45), (0.07, 0.015, 0.09)), "#5A5E62", "keep", "kit_tools", "chest")
    # shock trooper breastplate, lancer armour and lance rack
    B.add(hull([V((x * k, -0.118 - d, z)) for x, z in ((0.11, 1.33), (0.12, 1.15)) for k in (1, -1) for d in (0.0, 0.014)] + [V((0, -0.145, 1.25))]), "#7C8A94", "keep", "kit_plate", "chest")
    B.add(hull([V((x * k, -0.12 - d, z)) for x, z in ((0.14, 1.36), (0.15, 1.2), (0.13, 1.13)) for k in (1, -1) for d in (0.0, 0.018)] + [V((0, -0.152, 1.25))]), "#7C8A94", "keep", "kit_armor", "chest")
    for sx in (1, -1):
        B.add(ellipsoid((sx * 0.19, 0.01, 1.39), (0.075, 0.07, 0.05), 14, 8), "#7C8A94", "keep", "kit_armor", "clavicle_L" if sx > 0 else "clavicle_R")
    for dx in (-0.07, 0.0, 0.07):
        B.add(loft([ring((dx, 0.17, 1.04), 0.03, 0.03, 10), ring((dx, 0.17, 1.40), 0.03, 0.03, 10)]), "#5A5E62", "keep", "kit_tubes", "chest")
    for sx in (1, -1):
        B.add(loft([ring((sx * 0.04, -0.118, 1.665), 0.02, 0.008, 12), ring((sx * 0.04, -0.13, 1.665), 0.019, 0.007, 12)]), "#5A5E62", "keep", "kit_goggles", "head")


def build_helmets():
    rings_ = []
    for k, (z, r) in enumerate(((1.615, 1.0), (1.64, 1.0), (1.70, 0.96), (1.75, 0.82), (1.78, 0.6), (1.795, 0.3))):
        rings_.append(ring((0, 0.005, z), 0.108 * r, 0.12 * r, 28))
    B.add(loft(rings_), "white", "helmet", "helm_fed", "head")
    B.add(loft([ring((0, 0.005, 1.612), 0.128, 0.142, 28), ring((0, 0.005, 1.624), 0.124, 0.138, 28)]), "fold", "helmet", "helm_fed", "head")
    rings_ = []
    for z, rx, ry, front in ((1.54, 0.122, 0.13, 0.03), (1.6, 0.12, 0.128, -0.04), (1.65, 0.112, 0.124, -0.11), (1.72, 0.104, 0.118, -0.11), (1.77, 0.08, 0.09, -0.08), (1.795, 0.035, 0.04, -0.035)):
        pts = ring((0, 0.008, z), rx, ry, 28)
        for p in pts:
            if p.y < front:
                p.y = front
        rings_.append(pts)
    B.add(loft(rings_), "white", "helmet", "helm_imp", "head")
    for helm in ("helm_fed", "helm_imp"):
        for sx in (1, -1):
            # chin strap: a thin leather band from the helmet's side along the jaw to under the chin
            B.add(strip([(sx * 0.084, 0.0, 1.60), (sx * 0.078, -0.03, 1.53), (sx * 0.05, -0.06, 1.48), (0.0, -0.07, 1.465)], 0.004, 0.0015, 4), "#5A3E28", "keep", helm, "head")


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
        ca = me.color_attributes.new("Col", "BYTE_COLOR", "CORNER")
        meta = me.uv_layers.new(name="meta")  # the only UV map: exported as TEXCOORD_0
        for poly in me.polygons:
            if callable(color):
                cname, sname = color(tuple(poly.center))
                c, sl = srgb(hexof(cname)) + [1.0], SLOT[sname]
            else:
                c, sl = srgb(hexof(color)) + [1.0], slot
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
    m = bpy.data.materials.get("M_soldier") or bpy.data.materials.new("M_soldier")
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


def build_model():
    build_body()
    build_head()
    build_hair()
    build_uniform()
    build_kit()
    build_helmets()


def build_all():
    """The close model and the far model, both skinned to one armature."""
    global B, LOD, LOCKS
    rig = build_armature()
    meshes = []
    for level in (0, 1):
        B, LOD, LOCKS = Builder(), level, 0
        build_model()
        body = assemble(rig)
        body.name = body.data.name = "soldier" if level == 0 else "soldier_lod1"
        meshes.append(body)
    build_actions(rig)
    return rig, meshes[0], meshes[1]


def export(path):
    bpy.ops.object.select_all(action="DESELECT")
    for o in bpy.data.objects:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_yup=True, export_apply=False,
                              export_animations=True, export_animation_mode="NLA_TRACKS", export_skins=True,
                              export_force_sampling=False, export_optimize_animation_size=True,
                              export_vertex_color="ACTIVE", export_all_vertex_colors=False, export_texcoords=True,
                              export_normals=True, export_cameras=False, export_lights=False)


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    rig, body, far = build_all()
    tris = lambda o: sum(len(p.vertices) - 2 for p in o.data.polygons)
    print(f"soldier vc: close {tris(body)} triangles ({len(body.data.vertices)} verts), far {tris(far)}; {len(rig.data.bones)} bones, {len(bpy.data.actions)} actions")
    if argv:
        export(argv[0])
        print("exported", argv[0])
