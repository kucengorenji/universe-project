"""Skirmish soldier v3, after the look of Valkyria Chronicles (PS3): a slim, smooth figure for toon
shading (about 7.5 heads, 1.72 m), a head lofted from profiles with no eyes or mouth (the game paints
the face, src/skirmish/units/facePainter.js), clumped hair, a field tunic with a short skirt,
trousers into boots, gloves, webbing and helmets, and a painted atlas (soldier_atlas.png).

One skinned mesh on one armature, so each soldier is one draw call. Per-vertex data the game
reads (src/skirmish/units/vcSoldiers.js):
  TEXCOORD_0 ("atlas"): the painted atlas (see the comment above BANDS)
  TEXCOORD_1 ("meta"): u = palette slot (0 keep the authored colour, 1 skin, 2 hair, 3 tunic,
      4 scarf, 5 trousers, 6 boots, 7 helmet, 8 iris, 9 gloves)
    v = piece (0 always shown; 1-5 hair styles; 6 federation helmet; 7 imperial helmet;
      10.. kit tags in KIT order; 30 the face, where the painted face is projected)
The game shows one hair style, one helmet (or none) and the class's kit; the other pieces collapse
to a point in the vertex shader.

Bones keep the names the runtime IK uses (hips, spine, chest, neck, head, clavicle_*, shoulder_*,
elbow_*, wrist_*, hip_*, knee_*, ankle_*, toe_*), every limb's local X is the world X axis in the
rest pose, so a positive X rotation swings a limb back and bends a knee.
Actions (glTF animations): idle, walk, run, crouch, crouch_walk, kneel, hit, fall_back, fall_front.

Run:  Blender -b --factory-startup --python soldier_vc.py -- <out.glb> [<soldier_atlas.png>]
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
         **{f"kit_{k}": 10 + i for i, k in enumerate(KIT)}, "face": 30}
SLOT = {"keep": 0, "skin": 1, "hair": 2, "tunic": 3, "scarf": 4, "pants": 5, "boots": 6, "helmet": 7, "iris": 8, "glove": 9}

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
        self.normals = {}  # part index -> fn(position) -> custom normal (smooth shading overrides)

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


def loft(rings, cap=True, uv=None, wrap=True):
    """Quads between equal-size rings of points; caps at the ends. uv(k, i) -> (u, v) sets an
    "atlas" UV per ring k and point i; wrap=False leaves the rings open (a seam for the UVs)."""
    bm = bmesh.new()
    loops = [[bm.verts.new(V(p)) for p in r] for r in rings]
    n = len(loops[0])
    for a, b in zip(loops, loops[1:]):
        for i in range(n if wrap else n - 1):
            j = (i + 1) % n
            bm.faces.new([a[i], a[j], b[j], b[i]])
    if cap:
        bm.faces.new(list(reversed(loops[0])))
        bm.faces.new(loops[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if uv:
        index = {v: (k, i) for k, r in enumerate(loops) for i, v in enumerate(r)}
        lay = bm.loops.layers.uv.new("atlas")
        for f in bm.faces:
            for l in f.loops:
                l[lay].uv = uv(*index[l.vert])
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
        return "white", "glove"  # wrists, under the glove's cuff
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
            B.add(ellipsoid((sx * WR.x, WR.y - 0.01, WR.z - 0.07), (0.022, 0.04, 0.06), 8, 6), "white", "glove", "always", f"wrist_{s}")
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
            B.add(bm, "white", "glove", "always", f"wrist_{s}")
        # glove cuff
        B.add(loft([ring((sx * WR.x, WR.y, WR.z + 0.012), 0.030, 0.027, 12), ring((sx * WR.x, WR.y, WR.z - 0.012), 0.029, 0.026, 12)]), "fold", "tunic", "always", f"wrist_{s}")


# ---------------------------------------------------------------- head: a lofted anime head
# The head is lofted from a side profile and a width profile (z: front y, back y, half width, face
# flatness), with a small nose and lips added on the centre line. Eyes, brows, mouth and the
# painted shading are not geometry: the game paints them per character into a face texture that
# is projected from the front onto the "face" piece (src/skirmish/units/facePainter.js).
HEAD_C = V((0, 0.003, 1.60))
EYE_Z = 1.594  # the painted eyes' centre line (facePainter.js must agree)
# (z, front y, back y, half width, flatness); the face below the eyes is drawn 0.9 high
HEAD_PROFILE = [(z if z >= EYE_Z else EYE_Z - (EYE_Z - z) * 0.9, f, b, w, n) for z, f, b, w, n in [
    (1.478, -0.034, 0.000, 0.010, 2.0),
    (1.486, -0.062, 0.010, 0.026, 2.0),
    (1.500, -0.077, 0.028, 0.040, 2.1),
    (1.516, -0.083, 0.044, 0.049, 2.2),
    (1.532, -0.086, 0.057, 0.057, 2.3),
    (1.550, -0.088, 0.068, 0.064, 2.5),
    (1.568, -0.089, 0.077, 0.069, 2.7),
    (1.590, -0.088, 0.085, 0.073, 2.8),
    (1.610, -0.089, 0.091, 0.075, 2.7),
    (1.632, -0.086, 0.096, 0.077, 2.5),
    (1.658, -0.076, 0.097, 0.076, 2.3),
    (1.684, -0.059, 0.088, 0.068, 2.1),
    (1.705, -0.039, 0.070, 0.053, 2.0),
    (1.719, -0.019, 0.044, 0.032, 2.0),
    (1.726, -0.004, 0.012, 0.010, 2.0),
]]


def profile(z):
    """(front y, back y, half width, flatness) at height z: cubic Hermite through HEAD_PROFILE."""
    P = HEAD_PROFILE
    z = min(max(z, P[0][0]), P[-1][0])
    i = max(k for k in range(len(P) - 1) if P[k][0] <= z) if z < P[-1][0] else len(P) - 2
    z0, z1 = P[i][0], P[i + 1][0]
    t = (z - z0) / (z1 - z0)
    out = []
    for c in range(1, 5):
        def slope(k):
            a, b = P[max(k - 1, 0)], P[min(k + 1, len(P) - 1)]
            return (b[c] - a[c]) / (b[0] - a[0])
        p0, p1, m0, m1 = P[i][c], P[i + 1][c], slope(i) * (z1 - z0), slope(i + 1) * (z1 - z0)
        h = (2 * t ** 3 - 3 * t ** 2 + 1) * p0 + (t ** 3 - 2 * t ** 2 + t) * m0 + (-2 * t ** 3 + 3 * t ** 2) * p1 + (t ** 3 - t ** 2) * m1
        out.append(h)
    return out


def section(z, th):
    """Point on the head's cross-section at height z, angle th round from the front (+ toward +x)."""
    yf, yb, w, n = profile(z)
    c, s = math.cos(th), math.sin(th)
    if c >= 0:
        e = 2.0 / n
        x, y = w * math.copysign(abs(s) ** e, s), yf * abs(c) ** e
    else:
        x, y = w * s, yb * -c
    return x, y


def nose_and_lips(x, z):
    """Forward offset (m) of the face's centre line: a small nose, the lips, the chin."""
    off = 0.0
    if 1.545 < z < 1.612:
        if z > 1.559:
            t = (1.612 - z) / 0.053
            h, sig = 0.009 * t ** 1.8, 0.005 + 0.003 * t
        else:
            t = (z - 1.545) / 0.014
            h, sig = 0.009 * t ** 0.7, 0.0085
        off += h * math.exp(-(x / sig) ** 2)
    off += 0.0018 * math.exp(-((z - 1.535) / 0.0045) ** 2 - (x / 0.012) ** 2)  # upper lip
    off += 0.0012 * math.exp(-((z - 1.526) / 0.0045) ** 2 - (x / 0.010) ** 2)  # lower lip
    off += 0.0025 * math.exp(-((z - 1.502) / 0.008) ** 2 - (x / 0.015) ** 2)  # chin
    return off


def head_point(z, th):
    x, y = section(z, th)
    if math.cos(th) > 0.3:
        y -= nose_and_lips(x, z) * min(1.0, (math.cos(th) - 0.3) / 0.4)
    return V((x, y, z))


def inside_head(p):
    P = HEAD_PROFILE
    if not P[0][0] <= p.z <= P[-1][0]:
        return False
    yf, yb, w, n = profile(p.z)
    if p.y < 0:
        return (abs(p.x) / w) ** n + (abs(p.y) / -yf) ** n <= 1.0
    return (p.x / w) ** 2 + (p.y / max(yb, 1e-4)) ** 2 <= 1.0


def head_radius(d):
    """Distance from HEAD_C to the head surface along the unit direction d (bisection)."""
    lo, hi = 0.0, 0.2
    for _ in range(22):
        mid = (lo + hi) / 2
        if inside_head(HEAD_C + d * mid):
            lo = mid
        else:
            hi = mid
    return lo


def build_head():
    # columns crowd toward the face (where the nose needs them), levels toward the features
    n = lod(64, 30)
    thetas = []
    for i in range(n):
        t = -1.0 + 2.0 * i / n
        thetas.append(math.pi * (0.45 * t + 0.55 * t ** 3))
    P = HEAD_PROFILE
    zs = []
    z = P[0][0] + 0.002
    while z < P[-1][0] - 0.002:
        zs.append(z)
        z += lod(0.0035 if 1.52 < z < 1.625 else 0.007, 0.011)
    rings_ = [[head_point(z, th) for th in thetas] for z in zs]
    bm = loft(rings_)
    B.add(bm, "white", "skin", "face", "head")
    # face normals from a much flatter shape: the face lights almost evenly, like a painted one
    c, r = V((0, 0.02, 1.59)), V((0.16, 0.095, 0.24))
    B.normals[len(B.parts) - 1] = lambda p: V(((p.x - c.x) / r.x ** 2, (p.y - c.y) / r.y ** 2, (p.z - c.z) / r.z ** 2)).normalized()
    for sx in (1, -1):
        # ears: a flattened shell, tilted back, mostly under the hair
        ear = ellipsoid((sx * 0.072, 0.014, 1.588), (0.009, 0.018, 0.027), lod(12, 8), lod(10, 6), rot=(-12, 0, sx * 8))
        B.add(ear, "fold", "skin", "always", "head")
        if not LOD:
            B.add(ellipsoid((sx * 0.077, 0.012, 1.588), (0.003, 0.010, 0.016), 8, 6, rot=(-12, 0, sx * 8)), "crease", "skin", "always", "head")


# ---------------------------------------------------------------- hair: flat curved locks
# Hair UVs land in the strand band at the top of the atlas: HAIR_COLS columns, each a lock's worth
# of painted strands (edge lines, a sheen band), root at the top of the band, tip at the bottom.
ATLAS = 2048
HAIR_V0 = 0.875
HAIR_COLS = 16


def strand_uv(col, across, along):
    """Atlas UV in strand column `col` (any real: columns run on continuously), across 0..1, along root 0 .. tip 1."""
    u = (col + 0.04 + 0.92 * across) / HAIR_COLS
    v = 1.0 - 0.006 - along * (1.0 - HAIR_V0 - 0.012)
    return (u, v)


def scalp_point(theta, phi, grow=0.012):
    """A point just off the head (theta around from the front, phi up from HEAD_C's level)."""
    d = V((math.sin(theta) * math.cos(phi), -math.cos(theta) * math.cos(phi), math.sin(phi)))
    return HEAD_C + d * (head_radius(d) + grow)


def hair_cap(piece, low_back=0.0, fringe_z=1.655, n=24):
    """A smooth shell over the top and back of the head: the base every style builds on."""
    rings_ = []
    phis = (-0.32 - low_back, 0.0, 0.35, 0.7, 1.05, 1.38)
    for k, phi in enumerate(phis):
        pts = []
        for i in range(n + 1):  # the first point repeats: a UV seam at the back
            th = math.pi + i * TAU / n
            grow = 0.006 + 0.003 * k
            p = scalp_point(th, phi, grow)
            if math.cos(th) > 0.3 and p.z < fringe_z:
                # the hairline over the forehead: lifted, and laid back onto the head at its new height
                z = fringe_z + (p.z - fringe_z) * 0.15
                q = head_point(z, math.atan2(p.x, -p.y))
                p = q + (q - V((0, HEAD_C.y, z))).normalized() * (grow + 0.002)
            pts.append(p)
        rings_.append(pts)
    last = len(phis) - 1
    B.add(loft(rings_, uv=lambda k, i: strand_uv(i * 6.0 / n, 0.5, 1.0 - k / last), wrap=False), "white", "hair", piece, "head")
    hair_normals()


def lock(piece, theta, phi, length, flow, width=0.03, thick=0.012, bend=0.5, shade="white", twist=0.0):
    """A lock of hair: a flat, tapering ribbon of lens-shaped sections along a curve that leaves the
    scalp along its surface, then falls in the `flow` direction (a vector) as it bends."""
    global LOCKS
    LOCKS += 1
    if LOD and LOCKS % 3:
        return  # the far model keeps every third lock, a little wider
    if LOD:
        width *= 1.4
    root = scalp_point(theta, phi, 0.006)
    normal = (root - HEAD_C).normalized()
    flow = V(flow).normalized()
    start_dir = (flow - normal * flow.dot(normal)).normalized() if abs(flow.dot(normal)) < 0.98 else normal.orthogonal()
    p0 = root
    p1 = root + start_dir * length * 0.45 + normal * length * 0.18
    p2 = root + start_dir * length * (1 - bend * 0.3) + flow * length * bend * 0.6 + normal * length * 0.05
    rings_ = []
    steps = lod(7, 3)
    for k in range(steps + 1):
        t = k / steps
        p = p0 * (1 - t) ** 2 + p1 * 2 * t * (1 - t) + p2 * t * t
        if p.z > 1.53:
            # hug the skull: no lock floats off it or sinks into it
            d = p - HEAD_C
            rs = head_radius(d.normalized())
            p = HEAD_C + d.normalized() * min(max(d.length, rs + 0.006), rs + 0.012 + 0.03 * t)
        tan = ((p1 - p0) * 2 * (1 - t) + (p2 - p1) * 2 * t).normalized()
        side = tan.cross(normal).normalized()
        if side.length < 1e-6:
            side = tan.orthogonal().normalized()
        side = Matrix.Rotation(twist * t, 3, tan) @ side
        up = side.cross(tan).normalized()
        # clumps with body that still end in a point
        w = width * (1 - 0.9 * t ** 1.8) * (1.0 if t > 0.05 else 0.8) + 0.0015
        th = thick * 1.2 * (1 - 0.85 * t) + 0.001
        sec = []
        for i in range(6):
            a = i * TAU / 6
            sec.append(p + side * math.cos(a) * w + up * math.sin(a) * th)
        rings_.append(sec)
    col = LOCKS % HAIR_COLS
    B.add(loft(rings_, uv=lambda k, i: strand_uv(col, 0.5 + 0.5 * math.cos(i * TAU / 6), k / steps)), shade, "hair", piece, "head")
    hair_normals()


def hair_normals():
    """The last part lights like a smooth shell round the head (clean anime hair shading)."""
    c = HEAD_C + V((0, 0.005, -0.01))
    B.normals[len(B.parts) - 1] = lambda p: V(((p.x - c.x) / 0.09 ** 2, (p.y - c.y) / 0.105 ** 2, (p.z - c.z) / 0.13 ** 2)).normalized()


LOCKS = 0
DOWN = V((0, 0, -1))
FRONT = V((0, -1, 0))
BACK = V((0, 1, 0))


def crown(piece, count=14, phi=1.05, length=0.075):
    """Locks fanning out from the crown and falling round the sides and back: volume on top
    (the front is left to each style's fringe)."""
    for i in range(count):
        th = math.pi + (i / (count - 1) - 0.5) * 4.4 + rng.uniform(-0.1, 0.1)
        radial = V((math.sin(th), -math.cos(th), 0.0))
        lock(piece, th, phi + rng.uniform(-0.08, 0.08), length * rng.uniform(0.85, 1.15), radial * 0.4 + DOWN * 0.9, 0.036, 0.012, 0.75, "fold" if i % 4 == 0 else "white", twist=rng.uniform(-0.3, 0.3))


def build_hair():
    # 1: a shaggy, layered medium cut: fringe in points over the brow, sides over the ears, nape locks
    hair_cap("hair1")
    crown("hair1", 16, 1.0, 0.08)
    for i in range(11):
        th = -0.66 + i * 0.132 + rng.uniform(-0.03, 0.03)
        lock("hair1", th, 0.72 + rng.uniform(-0.05, 0.08), 0.052 + 0.03 * rng.random(), (math.sin(th) * 0.45, -0.25, -1.0), 0.028, 0.010, 0.6, "fold" if i % 3 == 1 else "white", twist=0.25 * (1 if th > 0 else -1))
    for s in (1, -1):
        for i in range(5):
            th = s * (1.0 + i * 0.22)
            lock("hair1", th, 0.3 - i * 0.03, 0.085 + 0.01 * rng.random(), (s * 0.25, 0.1, -1.0), 0.03, 0.011, 0.8, "white" if i % 2 else "fold", twist=s * 0.2)
    for i in range(11):
        th = math.pi + (i - 5) * 0.2
        lock("hair1", th, 0.3, 0.1 + 0.015 * rng.random(), (math.sin(th) * 0.3, 0.35, -1.0), 0.032, 0.012, 0.75, "fold" if i % 3 == 0 else "white")
    for i in range(7):
        th = math.pi + (i - 3) * 0.26
        lock("hair1", th, -0.12, 0.06, (math.sin(th) * 0.2, 0.25, -1.0), 0.026, 0.009, 0.6, "fold")
    # 2: a long swept fringe, longer at the sides
    hair_cap("hair2")
    crown("hair2", 12, 1.05, 0.07)
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
    crown("hair3", 12, 1.05, 0.08)
    for i in range(24):
        th = math.pi * 0.32 + i * (math.pi * 1.36 / 23)
        lock("hair3", th, 0.35, 0.15, (math.sin(th) * 0.1, -math.cos(th) * 0.1, -1.0), 0.032, 0.012, 0.95, "fold" if i % 4 == 0 else "white")
    for i in range(12):
        th = -0.62 + i * 0.113 + rng.uniform(-0.03, 0.03)
        lock("hair3", th, 0.68 + rng.uniform(-0.04, 0.06), 0.046 + 0.024 * rng.random(), (math.sin(th) * 0.3, -0.35, -1), 0.026, 0.010, 0.8, "fold" if i % 3 == 2 else "white")
    # 4: tied back in a ponytail, a few strands framing the face
    hair_cap("hair4", low_back=0.1)
    crown("hair4", 10, 1.1, 0.06)
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
        B.add(loft([ring(base, 0.02, 0.016, 7), ring(base + V((0, 0.05, -0.08)), 0.018, 0.014, 7), ring(base + V((0, 0.07, -0.2)), 0.012, 0.01, 7), ring(base + V((0, 0.06, -0.28)), 0.002, 0.002, 7)],
                   uv=lambda r, i, col=k + 2: strand_uv(col, 0.5 + 0.5 * math.cos(i * TAU / 7), r / 3)), "white" if k % 2 else "fold", "hair", "hair4", "head")
    # 5: close crop (also what shows under a helmet)
    hair_cap("hair5", fringe_z=1.67)


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
    B.add(loft([ring((0, 0.008, 1.425), 0.062, 0.058, 18), ring((0, 0.010, 1.472), 0.058, 0.054, 18)], cap=False), "fold", "tunic", "always", None)
    for sx in (1, -1):
        # collar patches: small flat rectangles lying on the collar's front
        ang = math.radians(-90 + sx * 38)
        cx, cy = math.cos(ang) * 0.062, 0.008 + math.sin(ang) * 0.058
        nx, ny = math.cos(ang), math.sin(ang)
        tx, ty = -ny, nx
        B.add(hull([V((cx + nx * d + tx * u, cy + ny * d + ty * u, z)) for d in (0.0, 0.004) for u in (-0.016, 0.016) for z in (1.43, 1.462)]), "crease", "tunic", "always", None)
    B.add(loft([ring((0, 0.006, 1.414), 0.067, 0.063, 18), ring((0, 0.008, 1.432), 0.066, 0.062, 18)], cap=False), "white", "scarf", "always", None)
    # the neckerchief's knot, flat against the throat, and two tails falling over the placket
    B.add(ellipsoid((0.012, -0.072, 1.41), (0.017, 0.011, 0.015), 12, 8), "fold", "scarf", "always", None)
    for k, dx in enumerate((0.016, -0.006)):
        B.add(loft([ring((0.012 + dx * 0.5, -0.08, 1.4), 0.014, 0.004, 8), ring((0.016 + dx, -0.096, 1.35), 0.017, 0.004, 8), ring((0.02 + dx * 1.6, -0.104, 1.29), 0.013, 0.003, 8), ring((0.022 + dx * 2, -0.106, 1.255), 0.004, 0.002, 8)]), "white" if k else "fold", "scarf", "always", None)
    # the tunic's skirt over the hips, flaring, with a back vent line
    B.add(loft([ring((0, 0.0, 0.99), 0.140, 0.102, 24), ring((0, 0.0, 0.90), 0.156, 0.114, 24), ring((0, 0.0, 0.83), 0.168, 0.124, 24)], cap=False), lambda c: ("seam" if abs(c[0]) < 0.006 and c[1] > 0 else "fold", "tunic"), "tunic", "always", "hips")
    # front placket and buttons, shoulder straps (epaulettes)
    B.add(strip([(0.012, tunic_front(z) - 0.002, z) for z in (1.40, 1.30, 1.20, 1.10, 1.02)], 0.014, 0.003), "crease", "tunic", "always", None)
    for z in (1.36, 1.27, 1.18, 1.09) if not LOD else ():
        B.add(ellipsoid((0.012, tunic_front(z) - 0.006, z), (0.0075, 0.004, 0.0075), 8, 5), "#C9A24A", "keep", "always", None)
    for sx in (1, -1):
        B.add(box((sx * 0.118, 0.006, 1.404), (0.085, 0.04, 0.007), rot=(0, sx * -16, 0)), "fold", "tunic", "always", None)
        B.add(ellipsoid((sx * 0.083, 0.006, 1.414), (0.005, 0.005, 0.003), 8, 5), "#C9A24A", "keep", "always", None)
        # breast pocket with a pointed flap and its button
        px = sx * 0.07
        B.add(box((px, -0.112, 1.235), (0.062, 0.008, 0.072)), "fold", "tunic", "always", None)
        if sx > 0 and not LOD:
            # the unit's emblem on the left sleeve: a disc in the faction's colour round a pale centre
            c, n = V((0.262, 0.012, 1.262)), V((1.0, 0.0, -0.12)).normalized()
            B.add(disc_lens(c, n, 0.017), "white", "scarf", "always", "shoulder_L")
            B.add(disc_lens(c + n * 0.0012, n, 0.009), "#ECE4CC", "keep", "always", "shoulder_L")
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


def disc_lens(c, n, r, segs=12):
    """A flat disc of radius r at c facing n."""
    rot = n.to_track_quat("Z", "Y").to_matrix()
    return hull([c + rot @ V((math.cos(i * TAU / segs) * r, math.sin(i * TAU / segs) * r, 0.0)) for i in range(segs)] + [c - n * 0.001])


def build_kit():
    # base: leather braces front and back with a stripe in the faction's colour down the middle
    # (the scarf's palette slot), a canteen
    for sx in (1, -1):
        path = [(sx * 0.06, -0.104, 1.03), (sx * 0.075, -0.112, 1.18), (sx * 0.092, -0.098, 1.33), (sx * 0.1, -0.05, 1.395), (sx * 0.1, 0.05, 1.395), (sx * 0.09, 0.098, 1.33), (sx * 0.03, 0.104, 1.15)]
        B.add(strip(path, 0.017, 0.004), "#6A4A30", "keep", "kit_base", "chest")
        lift = [(x, y - 0.0035 if y < -0.06 else y + 0.0035 if y > 0.06 else y, z + (0.0035 if abs(y) <= 0.06 else 0.0)) for x, y, z in path]
        B.add(strip(lift, 0.0055, 0.0015), "white", "scarf", "kit_base", "chest")
        B.add(ellipsoid((sx * 0.083, -0.118, 1.17), (0.008, 0.004, 0.008), 8, 5), "#C9A24A", "keep", "kit_base", "chest")
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
    # goggles pushed up on the forehead: two lenses on a band round the head, above the fringe roots
    gz = 1.676
    band = [scalp_point(i * TAU / 24, math.asin((gz - HEAD_C.z) / 0.12), 0.024) for i in range(25)]
    B.add(strip(band, 0.004, 0.0015), "#3A3530", "keep", "kit_goggles", "head")
    for sx in (1, -1):
        c = scalp_point(sx * 0.42, math.asin((gz - HEAD_C.z) / 0.12), 0.02)
        nrm = (c - HEAD_C).normalized()
        B.add(loft([ring((0, 0, 0), 0.0145, 0.0145, 12), ring((0, 0, 0.008), 0.0135, 0.0135, 12)]), "#5A5E62", "keep", "kit_goggles", "head")
        bm = B.parts[-1][0]
        rot = nrm.to_track_quat("Z", "Y").to_matrix().to_4x4()
        bmesh.ops.transform(bm, matrix=Matrix.Translation(c) @ rot, verts=bm.verts)
        B.add(disc_lens(c + nrm * 0.0085, nrm, 0.0125), "#2C3A44", "keep", "kit_goggles", "head")


def build_helmets():
    rings_ = []
    for k, (z, r) in enumerate(((1.615, 1.0), (1.64, 1.0), (1.70, 0.96), (1.75, 0.82), (1.78, 0.6), (1.795, 0.3))):
        rings_.append(ring((0, 0.005, z), 0.108 * r, 0.12 * r, 28))
    B.add(loft(rings_), "white", "helmet", "helm_fed", "head")
    B.add(loft([ring((0, 0.005, 1.612), 0.128, 0.142, 28), ring((0, 0.005, 1.624), 0.124, 0.138, 28)]), "fold", "helmet", "helm_fed", "head")
    # the imperial helmet: a dome fitted over the head, a flared skirt over the ears and nape, a
    # short flat visor; an inner shell so the inside reads from below
    rings_ = []
    for z, rx, ry, front in ((1.555, 0.12, 0.13, 0.02), (1.585, 0.108, 0.12, -0.03), (1.625, 0.1, 0.113, -0.098), (1.67, 0.098, 0.111, -0.106),
                             (1.715, 0.092, 0.104, -0.104), (1.75, 0.078, 0.089, -0.09), (1.778, 0.055, 0.064, -0.064), (1.795, 0.026, 0.03, -0.03)):
        pts = ring((0, 0.008, z), rx, ry, 28)
        for p in pts:
            if p.y < front:
                p.y = front
        rings_.append(pts)
    B.add(loft(rings_, cap=False), "white", "helmet", "helm_imp", "head")
    inner = loft([[V((p.x * 0.95, 0.008 + (p.y - 0.008) * 0.95, p.z - 0.004)) for p in r] for r in rings_[:-1]], cap=False)
    bmesh.ops.reverse_faces(inner, faces=inner.faces)
    B.add(inner, "deep", "helmet", "helm_imp", "head")
    for helm in ("helm_fed", "helm_imp"):
        for sx in (1, -1):
            # chin strap: a thin leather band from the helmet's side along the jaw to under the chin
            B.add(strip([(sx * 0.078, 0.004, 1.585), (sx * 0.068, -0.026, 1.535), (sx * 0.04, -0.056, 1.502), (0.0, -0.062, 1.494)], 0.004, 0.0015, 4), "#5A3E28", "keep", helm, "head")


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
        if "atlas" not in me.uv_layers:
            me.uv_layers.new(name="atlas")  # TEXCOORD_0: the painted atlas (hair comes with strand UVs)
        meta = me.uv_layers.new(name="meta")  # TEXCOORD_1: (slot, piece)
        for poly in me.polygons:
            if callable(color):
                cname, sname = color(tuple(poly.center))
                c, sl = srgb(hexof(cname)) + [1.0], SLOT[sname]
            else:
                c, sl = srgb(hexof(color)) + [1.0], slot
            for li in poly.loop_indices:
                ca.data[li].color = c
                meta.data[li].uv = (sl + 0.5, piece + 0.5)
        if idx in B.normals:
            fn = B.normals[idx]
            me.normals_split_custom_set([fn(me.vertices[l.vertex_index].co) for l in me.loops])
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


# ---------------------------------------------------------------- the painted atlas
# soldier_atlas.png (ATLAS square, data, not colour): R a shade multiplier (baked occlusion,
# watercolour mottling, painted light), G trim piping (hair: the sheen band), B pencil ink (seams,
# stitches, folds, contact lines, hatching in the occluded hollows). Bands in v: the close model's
# islands [0, 0.75), the far model's [0.75, HAIR_V0), hair strands [HAIR_V0, 1].
BANDS = ((0.0, 0.75), (0.75, HAIR_V0))


def meta_of(me):
    """Per polygon (slot, piece) from the meta UVs."""
    lay = me.uv_layers["meta"].data
    out = []
    for poly in me.polygons:
        u, v = lay[poly.loop_start].uv
        out.append((int(u), int(v)))
    return out


def select_only(*obs, active=None):
    bpy.ops.object.select_all(action="DESELECT")
    for o in obs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or obs[0]


def atlas_unwrap(body, band):
    """Smart-project every face but the hair into the band of the atlas."""
    me = body.data
    meta = meta_of(me)
    for poly, (slot, _) in zip(me.polygons, meta):
        poly.select = slot != SLOT["hair"]
    me.uv_layers.active = me.uv_layers["atlas"]
    select_only(body)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_mode(type="FACE")
    bm = bmesh.from_edit_mesh(me)
    for f, (slot, _) in zip(bm.faces, meta):
        f.select_set(slot != SLOT["hair"])
    bmesh.update_edit_mesh(me)
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.003, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    lay = me.uv_layers["atlas"].data
    v0, v1 = band
    for poly, (slot, _) in zip(me.polygons, meta):
        if slot == SLOT["hair"]:
            continue
        for li in poly.loop_indices:
            u, v = lay[li].uv
            lay[li].uv = (u, v0 + v * (v1 - v0))
    me.uv_layers.active = me.uv_layers["atlas"]


def bake_copy(src, keep, name):
    """A rest-pose copy of src with only the polygons whose piece passes keep(piece)."""
    me = src.data.copy()
    ob = bpy.data.objects.new(name, me)
    COL.objects.link(ob)
    meta = meta_of(me)
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[f for f, (_, piece) in zip(bm.faces, meta) if not keep(piece)], context="FACES")
    bm.to_mesh(me)
    bm.free()
    me.uv_layers.active = me.uv_layers["atlas"]
    me.uv_layers["atlas"].active_render = True
    for vg in list(ob.vertex_groups):
        ob.vertex_groups.remove(vg)
    return ob


def bake_maps(meshes):
    """Bake occlusion, position, normal and (slot, piece) into float images over the atlas islands."""
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 48
    sc.render.bake.margin = 6
    sc.render.bake.use_clear = False
    sc.world = bpy.data.worlds.new("bake")
    sc.world.light_settings.distance = 0.09  # occlusion reach: contact shadows, not the whole body
    imgs = {k: bpy.data.images.new(f"bake_{k}", ATLAS, ATLAS, float_buffer=True) for k in ("ao", "pos", "nrm", "meta")}
    for im in imgs.values():
        im.generated_color = (0, 0, 0, 1)
    mat = bpy.data.materials.new("bake")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    emit = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(emit.outputs[0], out.inputs["Surface"])
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    uvm = nt.nodes.new("ShaderNodeUVMap")
    uvm.uv_map = "meta"
    tex = nt.nodes.new("ShaderNodeTexImage")
    nt.nodes.active = tex
    is_hair = lambda p: 1 <= p <= 5
    for level, src in enumerate(meshes):
        pieces = sorted({p for _, p in meta_of(src.data)})
        objs = {"all": bake_copy(src, lambda p: not is_hair(p), f"bake_all{level}"), "base": bake_copy(src, lambda p: p in (0, 30), f"bake_base{level}")}
        for p in pieces:
            if p not in (0, 30) and not is_hair(p):
                objs[p] = bake_copy(src, lambda q, p=p: q == p, f"bake_{p}_{level}")
        for ob in objs.values():
            ob.data.materials.clear()
            ob.data.materials.append(mat)

        def bake(target, visible, kind, **kw):
            for ob in objs.values():
                ob.hide_render = ob not in visible
            for o in (src, *meshes):
                o.hide_render = True
            tex.image = imgs[kind]
            select_only(target)
            bpy.ops.object.bake(**kw)

        for link in list(emit.inputs["Color"].links):
            nt.links.remove(link)
        nt.links.new(geo.outputs["Position"], emit.inputs["Color"])
        bake(objs["all"], [objs["all"]], "pos", type="EMIT")
        nt.links.remove(emit.inputs["Color"].links[0])
        nt.links.new(uvm.outputs["UV"], emit.inputs["Color"])
        bake(objs["all"], [objs["all"]], "meta", type="EMIT")
        bake(objs["all"], [objs["all"]], "nrm", type="NORMAL", normal_space="OBJECT")
        bake(objs["base"], [objs["base"]], "ao", type="AO")
        for k, ob in objs.items():
            if k not in ("all", "base"):
                bake(ob, [ob, objs["base"]], "ao", type="AO")
        for ob in objs.values():
            bpy.data.objects.remove(ob, do_unlink=True)
    for o in meshes:
        o.hide_render = False
    import numpy as np
    arr = {}
    for k, im in imgs.items():
        buf = np.empty(ATLAS * ATLAS * 4, dtype=np.float32)
        im.pixels.foreach_get(buf)
        arr[k] = buf.reshape(ATLAS, ATLAS, 4)
    return arr


def _hash(ix, iy, iz, seed):
    import numpy as np
    n = (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791) ^ (seed * 2654435761)
    n = n & 0xFFFFFFFF
    n = ((n ^ (n >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((n ^ (n >> 16)) & 0xFFFF).astype(np.float32) / 65535.0


def vnoise(p, scale, seed=0):
    """Value noise in 3D over an (N, 3) array of points."""
    import numpy as np
    q = p * scale
    i = np.floor(q).astype(np.int64)
    f = q - i
    f = f * f * (3 - 2 * f)
    out = 0.0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (f[:, 0] if dx else 1 - f[:, 0]) * (f[:, 1] if dy else 1 - f[:, 1]) * (f[:, 2] if dz else 1 - f[:, 2])
                out = out + w * _hash(i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz, seed)
    return out


def fbm(p, scale, seed=0, octaves=3):
    total, amp, norm = 0.0, 1.0, 0.0
    for k in range(octaves):
        total = total + amp * vnoise(p, scale * 2 ** k, seed + k * 17)
        norm += amp
        amp *= 0.5
    return total / norm


def paint_atlas(maps):
    """The atlas pixels (ATLAS, ATLAS, 4) from the baked maps: see the comment above BANDS."""
    import numpy as np
    A = ATLAS
    meta = maps["meta"]
    cov = meta[..., 0] > 0.25
    idx = np.nonzero(cov.ravel())[0]
    P = maps["pos"].reshape(-1, 4)[idx, :3].astype(np.float64)
    N = maps["nrm"].reshape(-1, 4)[idx, :3] * 2 - 1
    ao = maps["ao"].reshape(-1, 4)[idx, 0]
    slot = np.floor(meta.reshape(-1, 4)[idx, 0]).astype(int)
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    ax = np.abs(x)
    py, px = np.divmod(idx, A)
    sm = lambda e0, e1, t: np.clip((t - e0) / (e1 - e0), 0, 1) ** 2 * (3 - 2 * np.clip((t - e0) / (e1 - e0), 0, 1))
    line = lambda d, w=0.0006, aa=0.0009: np.clip(1 - (np.abs(d) - w) / aa, 0, 1)
    dash = lambda along, period=0.0065: (np.mod(along / period, 1.0) < 0.55).astype(np.float32)
    T, PA, BO, SK, GL, SC = (slot == SLOT[k] for k in ("tunic", "pants", "boots", "skin", "glove", "scarf"))

    shade = np.ones(len(idx))
    ink = np.zeros(len(idx))
    trim = np.zeros(len(idx))
    add = lambda mask, amount: np.maximum(ink, np.where(mask, amount, 0.0))

    # occlusion: soft painted shadow, contact lines, pencil hatching in the hollows
    shade *= 0.62 + 0.38 * sm(0.15, 0.85, ao)
    ink = add(True, 0.5 * (1 - sm(0.1, 0.3, ao)))
    tri = np.abs(np.mod((px + py) / 7.0, 1.0) - 0.5) * 2
    ink = add(~SK, np.clip((0.3 - tri) / 0.15, 0, 1) * np.clip((0.62 - ao) / 0.3, 0, 1) * 0.32)
    # watercolour mottling and paper grain, light painted from above
    shade *= 1 + 0.12 * (fbm(P, 9.0, 3) - 0.5) + 0.05 * (vnoise(P, 140.0, 5) - 0.5)
    shade *= (0.93 + 0.09 * np.clip(N[:, 2], 0, 1)) * (1 - 0.07 * np.clip(-N[:, 2], 0, 1))
    shade *= np.where(T, 1 - 0.07 * np.clip((1.35 - z) / 0.5, 0, 1), 1.0)
    shade *= np.where(PA, 1 - 0.08 * np.clip((0.85 - z) / 0.6, 0, 1), 1.0)

    torso = T & (ax < 0.175) & (z > 0.86) & (z < 1.42)
    arm = T & (ax > 0.19) & (z < 1.36)
    # tunic seams: sides, centre back, shoulders, armholes, the back of the sleeves
    ink = add(torso & (ax > 0.1) & (z < 1.33), 0.55 * line(y))
    ink = add(torso & (y > 0.03), 0.5 * line(x))
    ink = add(T & (z > 1.33) & (ax > 0.05) & (ax < 0.17), 0.5 * line(y - 0.006))
    ink = add(T & (z > 1.22) & (ax > 0.15) & (ax < 0.21), 0.55 * line(ax - 0.178))
    ink = add(arm & (y > 0), 0.4 * line(y - 0.03))
    # the front placket's edges and its stitching; the breast pockets' outlines
    front = T & (y < -0.06) & (z > 1.0) & (z < 1.41)
    ink = add(front, 0.6 * np.maximum(line(x - 0.026), line(x + 0.002)))
    ink = add(front, 0.4 * line(x - 0.031, 0.0004) * dash(z))
    pocket = T & (y < -0.104) & (z > 1.19) & (z < 1.30)
    d = np.maximum(np.abs(ax - 0.07) - 0.029, np.abs(z - 1.233) - 0.034)
    ink = add(pocket, 0.55 * line(d))
    ink = add(pocket, 0.35 * line(d + 0.004, 0.0004) * dash(x + z))
    # elbow folds on the inside of the sleeve
    r = np.sqrt((ax - 0.235) ** 2 + (y - 0.02) ** 2 + (z - 1.13) ** 2)
    ink = add(arm & (y < 0.0), 0.35 * np.maximum(line(r - 0.024), line(r - 0.038)) * (1 - sm(0.03, 0.05, r)))
    # piping: the skirt's hem, the collar's top, the cuffs (G: the faction's trim colour)
    skirt = T & (z < 0.86)
    trim = np.maximum(trim, np.where(skirt, sm(0.851, 0.848, z), 0.0))
    ink = add(skirt, 0.5 * line(z - 0.8505, 0.0005))
    collar = T & (z > 1.42) & (np.sqrt(x ** 2 + (y - 0.009) ** 2) < 0.075) & (N[:, 0] * x + N[:, 1] * (y - 0.009) > 0)
    trim = np.maximum(trim, np.where(collar, sm(1.4645, 1.4665, z), 0.0))
    ink = add(collar, 0.5 * line(z - 1.4655, 0.0005))
    cuff = T & (ax > 0.235) & (z < 0.93) & (z > 0.885)
    trim = np.maximum(trim, np.where(cuff, 1.0, 0.0))
    ink = add(cuff, 0.45 * line(z - 0.925, 0.0005))

    # trousers: the outer seam, folds behind the knee, at the crotch and bloused over the boots
    legx = ax - 0.095
    ink = add(PA & (legx > 0.03) & (z > 0.3) & (z < 0.9), 0.45 * line(y))
    knee = PA & (y > 0.0) & (np.abs(z - 0.47) < 0.05)
    bow = z - 0.47 - 0.012 * np.cos(np.clip(legx / 0.05, -1, 1) * math.pi / 2)
    ink = add(knee, 0.35 * np.maximum(line(bow - 0.012), line(bow + 0.014)))
    crotch = PA & (y < -0.02) & (z > 0.7) & (z < 0.865) & (ax < 0.075)
    for k in (1, 2):
        ink = add(crotch, 0.3 * line(z - 0.865 + ax * 1.3 + k * 0.022, 0.0005))
    ang = np.arctan2(y, legx)
    for k, h in enumerate((0.338, 0.352)):
        ink = add(PA & (z < 0.37), 0.4 * line(z - h - 0.004 * np.sin(ang * 5 + k), 0.0005))

    # boots: a darker sole and its line, the toe cap, the top edge
    shade *= np.where(BO & (z < 0.032), 0.7, 1.0)
    ink = add(BO, 0.6 * line(z - 0.033, 0.0006))
    ink = add(BO & (y < -0.1), 0.45 * line(y + 0.135 + (z - 0.04) * 0.4))
    ink = add(BO & (z > 0.26), 0.45 * line(z - 0.27))
    # gloves: a seam over the knuckles; the scarf's folds
    ink = add(GL & (z < 0.85), 0.3 * line(z - 0.818 + 0.2 * np.abs(y), 0.0005))
    ink = add(SC, 0.3 * line(np.sin(np.arctan2(y + 0.07, x) * 9) * 0.004, 0.0008))

    out = np.zeros((A * A, 4), dtype=np.float32)
    out[:, 0] = 1.0
    out[:, 3] = 1.0
    out[idx, 0] = np.clip(shade, 0, 1)
    out[idx, 1] = np.clip(trim, 0, 1)
    out[idx, 2] = np.clip(ink, 0, 1)
    out = out.reshape(A, A, 4)
    paint_hair_band(out)
    return out


def paint_hair_band(out):
    """Strands in each of the HAIR_COLS lock columns: darker roots and edges, pencil strand lines, a sheen band."""
    import numpy as np
    A = ATLAS
    r0 = int(HAIR_V0 * A)
    v = (np.arange(r0, A) + 0.5) / A
    along = np.clip((1.0 - 0.006 - v) / (1.0 - HAIR_V0 - 0.012), 0, 1)[:, None]
    u = (np.arange(A) + 0.5) / A
    colf = u * HAIR_COLS
    col = np.floor(colf).astype(int)
    across = np.clip((colf - col - 0.04) / 0.92, 0, 1)[None, :]
    g = np.random.default_rng(11)
    shade = (0.8 + 0.2 * np.clip(along / 0.3, 0, 1) - 0.1 * np.clip((along - 0.7) / 0.3, 0, 1)) * (1 - 0.2 * np.abs(across - 0.5) ** 3 * 8)
    shade = np.broadcast_to(shade, (A - r0, A)).copy()
    ink = np.zeros_like(shade)
    jag = np.zeros((1, A))
    for c in range(HAIR_COLS):
        m = (col == c)[None, :]
        jag[0, col == c] = 0.05 * np.sin(across[0, col == c] * g.uniform(9, 17) + g.uniform(0, 6))
        for _ in range(5):
            a0, w, dark = g.uniform(0.1, 0.9), g.uniform(0.003, 0.008), g.uniform(0.15, 0.4)
            s0, s1, wav = g.uniform(0.0, 0.35), g.uniform(0.6, 1.0), g.uniform(0.0, 0.006)
            d = np.abs(across - a0 - wav * np.sin(along * 7 + a0 * 20))
            ln = np.clip(1 - (d - w) / 0.006, 0, 1) * ((along > s0) & (along < s1)) * m
            shade -= 0.22 * dark * ln
            ink = np.maximum(ink, ln * (dark - 0.2) * 0.55)
        edge = np.clip(1 - (np.minimum(across, 1 - across) - 0.01) / 0.03, 0, 1) * m
        ink = np.maximum(ink, edge * 0.3)
    t = along + jag
    sheen = np.clip((t - 0.3) / 0.04, 0, 1) * np.clip((0.48 - t) / 0.05, 0, 1) * (1 - ink)
    out[r0:, :, 0] = np.clip(shade, 0, 1)
    out[r0:, :, 1] = np.clip(sheen, 0, 1)
    out[r0:, :, 2] = np.clip(ink, 0, 1)


def save_atlas(px, path):
    im = bpy.data.images.new("soldier_atlas", ATLAS, ATLAS, alpha=False)
    im.colorspace_settings.name = "Non-Color"
    im.pixels.foreach_set(px.ravel())
    im.filepath_raw = path
    im.file_format = "PNG"
    im.save()


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
        to = [(0.0, (0, 0, 0)), (0.4, (-10, 0, 0)), (0.55, (-35 if run else -28, 0, 0)), (0.68, (0, 0, 0))]  # the toe rolls off
        res = {}
        for name, ks in (("hip", th), ("knee", kn), ("ankle", an), ("toe", to)):
            pts = sorted(((sh(t) if phase else t), v) for t, v in ks)
            if pts[0][0] > 0:
                pts = [(0.0, pts[-1][1])] + pts
            res[name] = cycle(pts)
        return res
    L, R = leg(0.0), leg(0.5)
    keys = {f"{k}_{side}": leg_[k] for side, leg_ in (("L", L), ("R", R)) for k in ("hip", "knee", "ankle", "toe")}
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
    walk, wh = gait(24, 60, 15, 8, 0.025, 18)
    key_pose(rig, "walk", 1.0, walk, hips=wh)
    run, rh = gait(40, 105, 25, 26, 0.05, 30, run=True)
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


def build_all(atlas_path=None):
    """The close model and the far model, both skinned to one armature, unwrapped into the atlas
    (painted and saved when atlas_path is given)."""
    global B, LOD, LOCKS
    rig = build_armature()
    meshes = []
    for level in (0, 1):
        B, LOD, LOCKS = Builder(), level, 0
        rng.seed(7)
        build_model()
        body = assemble(rig)
        body.name = body.data.name = "soldier" if level == 0 else "soldier_lod1"
        atlas_unwrap(body, BANDS[level])
        meshes.append(body)
    if atlas_path:
        save_atlas(paint_atlas(bake_maps(meshes)), atlas_path)
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
    rig, body, far = build_all(argv[1] if len(argv) > 1 else None)
    tris = lambda o: sum(len(p.vertices) - 2 for p in o.data.polygons)
    print(f"soldier vc: close {tris(body)} triangles ({len(body.data.vertices)} verts), far {tris(far)}; {len(rig.data.bones)} bones, {len(bpy.data.actions)} actions")
    if argv:
        export(argv[0])
        print("exported", argv[0])
