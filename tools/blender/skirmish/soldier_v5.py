"""Skirmish soldier v5, after the look of Valkyria Chronicles (PS3), on VRoid anime bodies.

Bodies, faces and hair come from VRoid Studio's sample models (released by pixiv as CC0 / VRoid
Hub licence allowing modification, redistribution and commercial use without credit; the unzipped
models are not in the repo, see --vroid). One body per sex (Base_Male / Base_Female) carries every
hero of that sex: the face is the body's own, each hero's hair is transplanted from a donor model
(scaled and moved so the donor's eyes land on the body's eyes) and parented rigidly to the head.

The uniform and the kit are modelled here on the body: shells lofted around the body (rings cast
out from each limb's axis onto the skin, then eased out and flared), collar, belt, straps, pouches,
gloves and boots, plus the class kit and two helmets. Animation comes from the Quaternius
Universal Animation Library (CC0, --ual), retargeted onto the VRoid skeleton.

The VRoid rig is cut down to its humanoid bones, renamed to the runtime's names (hips, spine,
spine_mid, chest, neck, head, clavicle_*, shoulder_*, elbow_*, wrist_*, hip_*, knee_*, ankle_*,
toe_*, fingers <finger>_0<k>_<side>) and turned to face glTF +Z. Every bone keeps VRoid's identity
rest rotation, so a bone's local axes are the soldier's own (x left, y up, z forward).

One skinned mesh per sex (and a decimated far copy), one draw call per soldier. Per vertex:
  TEXCOORD_0 ("atlas"): the head atlas (--head: VRoid's face, eye and hair textures, hair, brows
      and irises reduced to brightness) for the head slots, else the cloth atlas (--atlas: R shade,
      G trim piping, B pencil ink)
  TEXCOORD_1 ("meta"): u = palette slot (SLOT), v = piece: an index into the mesh's extras
      "pieces" (always, face, hair_<hero>, hair_base, helm_fed, helm_imp, scarf, kit_<tag>)

Stages (run with --stage to stop after one and write preview renders to --preview):
  import  the body, the face and the transplanted hair styles on the cleaned rig
  dress   the uniform, fittings, kit and helmets
  (none)  everything: the assembled mesh, both atlases, the clips, the GLB

Run:  Blender -b --factory-startup --python soldier_v5.py -- <out.glb> --vroid <dir> --body m|f
      --ual <AnimationLibrary_Godot_Standard.glb> --head <head.png> --atlas <cloth.png>
      [--heroes arlen,...] [--stage import|dress] [--preview <dir>]
"""
import functools
import math
import os
import shutil
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector as V
from mathutils.bvhtree import BVHTree

print = functools.partial(print, flush=True)
TAU = math.tau

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = ARGS[0] if ARGS and not ARGS[0].startswith("--") else None


def arg(name, default=None):
    return ARGS[ARGS.index(name) + 1] if name in ARGS else default


STAGE = arg("--stage")
PREVIEW = arg("--preview")
VROID = arg("--vroid")
SEX = arg("--body", "m")

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
COL = bpy.context.scene.collection

BASE = {"m": "base_male/Base_Male.vrm", "f": "base_female/Base_Female.vrm"}
# hero -> donor of the hair (None: the base's own short back-swept hair)
HAIR = {
    "m": {"arlen": "hairsample_male/HairSample_Male.vrm"},
    "f": {},
}
ONLY = arg("--heroes")
if ONLY:
    HAIR = {s: {h: d for h, d in v.items() if h in ONLY.split(",")} for s, v in HAIR.items()}

FINGERS = {"Thumb": "thumb", "Index": "index", "Middle": "middle", "Ring": "ring", "Little": "pinky"}
RENAME = {
    "J_Bip_C_Hips": "hips", "J_Bip_C_Spine": "spine", "J_Bip_C_Chest": "spine_mid", "J_Bip_C_UpperChest": "chest",
    "J_Bip_C_Neck": "neck", "J_Bip_C_Head": "head",
    **{f"J_Bip_{S}_{a}": f"{b}_{S}" for S in "LR" for a, b in (
        ("Shoulder", "clavicle"), ("UpperArm", "shoulder"), ("LowerArm", "elbow"), ("Hand", "wrist"),
        ("UpperLeg", "hip"), ("LowerLeg", "knee"), ("Foot", "ankle"), ("ToeBase", "toe"))},
    **{f"J_Bip_{S}_{a}{k}": f"{b}_0{k}_{S}" for S in "LR" for a, b in FINGERS.items() for k in (1, 2, 3)},
}


def select_only(*obs, active=None):
    bpy.ops.object.select_all(action="DESELECT")
    for o in obs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or obs[0]


# ---------------------------------------------------------------- import
def import_vrm(rel):
    """A VRM (glTF with VRM extensions) through Blender's glTF importer: the armature and its meshes
    by name (Body, Face, Hair001). The importer's bone shapes are dropped."""
    tmp = os.path.join(bpy.app.tempdir or "/tmp", "vroid_import.glb")
    shutil.copy(os.path.join(VROID, rel), tmp)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=tmp)
    os.remove(tmp)
    new = [o for o in bpy.data.objects if o not in before]
    for o in [o for o in new if o.type == "MESH" and o.name.startswith("Icosphere")]:
        new.remove(o)
        bpy.data.objects.remove(o, do_unlink=True)
    arm = next(o for o in new if o.type == "ARMATURE")
    meshes = {o.name.split(".")[0]: o for o in new if o.type == "MESH"}
    for o in meshes.values():
        o.shape_key_clear()
    return arm, meshes


def eyes(arm):
    """Midpoint of the two eye joints and the distance between them (rest pose, world)."""
    l = arm.matrix_world @ arm.data.bones["J_Adj_L_FaceEye"].head_local
    r = arm.matrix_world @ arm.data.bones["J_Adj_R_FaceEye"].head_local
    return (l + r) / 2, (l - r).length


def to_world(ob):
    """Bake the object's transform into its mesh and unparent it."""
    m = ob.matrix_world.copy()
    ob.parent = None
    ob.data.transform(m)
    ob.matrix_world = Matrix.Identity(4)


def transplant_hair(name, donor_rel, arm):
    """The donor's hair, scaled and moved so its eyes land on the body's, bound rigidly to the head."""
    darm, dmeshes = import_vrm(donor_rel)
    hair = dmeshes.get("Hair001")
    (c0, w0), (c1, w1) = eyes(darm), eyes(arm)
    s = w1 / w0
    to_world(hair)
    hair.data.transform(Matrix.Translation(c1) @ Matrix.Scale(s, 4) @ Matrix.Translation(-c0))
    for o in dmeshes.values():
        if o is not hair:
            bpy.data.objects.remove(o, do_unlink=True)
    bpy.data.objects.remove(darm, do_unlink=True)
    hair.vertex_groups.clear()
    g = hair.vertex_groups.new(name="J_Bip_C_Head")
    g.add(range(len(hair.data.vertices)), 1.0, "REPLACE")
    hair.modifiers.clear()
    hair.parent = arm
    hair.modifiers.new("Armature", "ARMATURE").object = arm
    hair.name = hair.data.name = f"hair_{name}"
    print(f"  hair {name}: {donor_rel} x{s:.3f}, {len(hair.data.polygons)} faces")
    return hair


# ---------------------------------------------------------------- the rig
def clean_rig(arm, meshes):
    """Keep the humanoid J_Bip_ bones (no finger ends): every other bone's weights go to its nearest
    kept ancestor; the hips become the root."""
    keep = lambda b: b.name.startswith("J_Bip_") and not b.name.endswith("_end")
    target = {}
    for b in arm.data.bones:
        a = b
        while a is not None and not keep(a):
            a = a.parent
        target[b.name] = a.name if a is not None else "J_Bip_C_Hips"
    for ob in meshes:
        for vg in list(ob.vertex_groups):
            t = target.get(vg.name)
            if t is None or t == vg.name:
                continue
            dst = ob.vertex_groups.get(t) or ob.vertex_groups.new(name=t)
            for v in ob.data.vertices:
                for g in v.groups:
                    if g.group == vg.index and g.weight > 0:
                        dst.add([v.index], g.weight, "ADD")
            ob.vertex_groups.remove(vg)
    select_only(arm)
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    eb["J_Bip_C_Hips"].parent = None
    for b in [b for b in eb if not keep(b)]:
        eb.remove(b)
    bpy.ops.object.mode_set(mode="OBJECT")


def turn_around(arm, meshes):
    """VRM 0 faces glTF -Z; the game wants +Z. Turn meshes and joints half a turn about the vertical,
    keeping every bone's orientation (so the rest rotations stay identity)."""
    R = Matrix.Rotation(math.pi, 4, "Z")
    for ob in meshes:
        assert ob.matrix_world == Matrix.Identity(4), ob.name
        ob.data.transform(R)
    select_only(arm)
    bpy.ops.object.mode_set(mode="EDIT")
    for b in arm.data.edit_bones:
        roll = b.roll
        b.head, b.tail = R @ b.head, R @ b.tail
        b.roll = roll
    bpy.ops.object.mode_set(mode="OBJECT")


def rename_bones(arm):
    for old, new in RENAME.items():
        b = arm.data.bones.get(old)
        if b:
            b.name = new  # vertex groups of meshes deformed by the armature follow
    left = [b.name for b in arm.data.bones if b.name.startswith("J_")]
    assert not left, left


def joint(arm, name):
    return arm.matrix_world @ arm.data.bones[name].head_local


def build_base():
    arm, meshes = import_vrm(BASE[SEX])
    arm.name = arm.data.name = "rig"
    hairs = {h: transplant_hair(h, d, arm) for h, d in HAIR[SEX].items() if d}
    body, face = meshes["Body"], meshes["Face"]
    parts = [body, face, *hairs.values()]
    for ob in parts:
        if ob.parent is not None and ob.matrix_world != Matrix.Identity(4):
            to_world(ob)
            ob.parent = arm
    clean_rig(arm, parts)
    turn_around(arm, parts)
    rename_bones(arm)
    print("RIG", len(arm.data.bones), "bones:", [b.name for b in arm.data.bones if "_0" not in b.name])
    return arm, body, face, hairs


# ---------------------------------------------------------------- mesh helpers
def mesh_obj(name, bm, color):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    COL.objects.link(ob)
    ob["color"] = color
    return ob


def bvh_of(*objs):
    bm = bmesh.new()
    for o in objs:
        me = o.data.copy()
        me.transform(o.matrix_world)
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
    tree = BVHTree.FromBMesh(bm)
    bm.free()
    return tree


def dominant(ob):
    """Per vertex: the name of the bone weighing most on it."""
    names = {g.index: g.name for g in ob.vertex_groups}
    out = []
    for v in ob.data.vertices:
        best = max(v.groups, key=lambda g: g.weight, default=None)
        out.append(names.get(best.group) if best else None)
    return out


def skin_part(body, name, keep, color):
    """A copy of the body's skin faces whose every vertex passes keep(co, bone)."""
    dom = dominant(body)
    skin = {i for i, m in enumerate(body.data.materials) if "SKIN" in m.name}
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.verts.ensure_lookup_table()
    bad = [f for f in bm.faces if f.material_index not in skin or not all(keep(v.co, dom[v.index]) for v in f.verts)]
    bmesh.ops.delete(bm, geom=bad, context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)  # VRoid splits the skin at UV seams
    return mesh_obj(name, bm, color)


def relax(ob, iterations=8, factor=0.5, pin_boundary=True):
    """Laplacian smoothing: muscles and bones go, the silhouette stays."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    verts = [v for v in bm.verts if not (pin_boundary and v.is_boundary)]
    for _ in range(iterations):
        bmesh.ops.smooth_vert(bm, verts=verts, factor=factor, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    bm.to_mesh(ob.data)
    bm.free()


def ease(ob, amount):
    """Push every vertex out along its normal by amount(co) metres."""
    ob.data.update()
    pts = [(v, v.normal.copy()) for v in ob.data.vertices]
    for v, n in pts:
        v.co += n * amount(v.co)


def subdivide(ob, levels=1):
    m = ob.modifiers.new("subd", "SUBSURF")
    m.levels = levels
    m.boundary_smooth = "PRESERVE_CORNERS"
    select_only(ob)
    bpy.ops.object.modifier_apply(modifier="subd")


def section(tree, center, u, v, n, reach=0.5):
    """The outermost surface round center in the plane of (u, v): n rays cast inward from reach.
    Returns (point or None, direction) per angle."""
    out = []
    for i in range(n):
        a = i * TAU / n
        d = (u * math.cos(a) + v * math.sin(a)).normalized()
        hit = tree.ray_cast(center + d * reach, -d, reach)
        out.append((hit[0], d))
    return out


def hull_ring(hits, center, u, v, grow, fallback=0.1):
    """A ring through the hits made convex (in the plane), pushed out by grow(angle index)."""
    n = len(hits)
    r = [((p - center).dot(d) if p is not None else None) for p, d in hits]
    got = [i for i in range(n) if r[i] is not None]
    if not got:
        r = [fallback] * n
    # a ray that missed (an edge of the shell) takes its radius from the nearest hits either side
    for i in range(n):
        if r[i] is None:
            a = max((j for j in got if j < i), default=got[-1] - n)
            b = min((j for j in got if j > i), default=got[0] + n)
            t = (i - a) / (b - a)
            r[i] = r[a % n] * (1 - t) + r[b % n] * t
    # convex: a radius inside the chord between its neighbours k steps away is lifted onto it
    # (the chord between radii a and b at +-phi crosses the bisector at 2ab cos(phi) / (a + b))
    for k in (1, 2, 3):
        c = math.cos(k * TAU / n)
        for _ in range(2):
            for i in range(n):
                a, b = r[(i - k) % n], r[(i + k) % n]
                r[i] = max(r[i], 2 * a * b * c / max(1e-6, a + b))
    return [center + (u * math.cos(i * TAU / n) + v * math.sin(i * TAU / n)).normalized() * (r[i] + grow(i)) for i in range(n)]


def loft_obj(name, rings, color, close=True, cap_end=False):
    """Quads between equal-size rings, facing out."""
    bm = bmesh.new()
    loops = [[bm.verts.new(V(p)) for p in r] for r in rings]
    n = len(loops[0])
    for a, b in zip(loops, loops[1:]):
        for i in range(n if close else n - 1):
            j = (i + 1) % n
            bm.faces.new([a[i], a[j], b[j], b[i]])
    if cap_end:
        bm.faces.new(loops[-1])
    bm.normal_update()
    c = sum((v.co for v in bm.verts), V()) / len(bm.verts)
    if sum((f.calc_center_median() - c).dot(f.normal) for f in bm.faces) < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    return mesh_obj(name, bm, color)


def box_obj(name, center, size, color, rot=None, bevel=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    if bevel:
        bmesh.ops.bevel(bm, geom=bm.edges[:], offset=bevel, segments=2, affect="EDGES", profile=0.5)
    if rot is not None:
        bmesh.ops.rotate(bm, verts=bm.verts, cent=V(), matrix=rot)
    bmesh.ops.translate(bm, vec=center, verts=bm.verts)
    ob = mesh_obj(name, bm, color)
    for p in ob.data.polygons:
        p.use_smooth = False
    return ob


def delete_faces(ob, bad):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.verts.ensure_lookup_table()
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if bad(f)], context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(ob.data)
    bm.free()


# ---------------------------------------------------------------- the uniform
def landmarks(arm):
    """Joint positions (rest, world) and the heights the uniform is cut to."""
    L = {b.name: joint(arm, b.name) for b in arm.data.bones}
    L["waist_z"] = L["hips"].z + 0.42 * (L["spine"].z - L["hips"].z) + 0.03
    L["hem_z"] = L["hip_L"].z - 0.42 * (L["hip_L"].z - L["knee_L"].z)
    L["boot_z"] = L["knee_L"].z - 0.18 * (L["knee_L"].z - L["ankle_L"].z)
    L["collar_z"] = L["neck"].z - 0.012
    L["neck_z"] = L["neck"].z
    L["hip_z"], L["knee_z"], L["ankle_z"] = L["hip_L"].z, L["knee_L"].z, L["ankle_L"].z
    return L


def along(p, a, b):
    """Projection parameter of p on segment a-b (0 at a, 1 at b)."""
    ab = b - a
    return (p - a).dot(ab) / ab.length_squared


TUNIC, PANTS, BOOTS, GLOVE, LEATHER, BRASS, TRIM = "#4F6F8F", "#3D4F63", "#4A3222", "#3E3029", "#5A3E28", "#C9A24A", "#ECE4CC"
LIMBS = ("shoulder", "elbow", "wrist", "clavicle")
LEGS = ("hip", "knee", "ankle", "toe")
FINGER = ("thumb", "index", "middle", "ring", "pinky")


def bone_kind(bone):
    if bone is None:
        return None
    base = bone.split("_")[0]
    return base


def dress(arm, body):
    """The uniform's shells and fittings on the body. Returns (parts, landmarks)."""
    L = landmarks(arm)
    side = lambda co: "L" if co.x > 0 else "R"
    print("LANDMARKS", {k: round(L[k], 3) for k in ("waist_z", "hem_z", "boot_z", "collar_z")})

    def past_wrist(co, margin=0.0):
        a, b = L[f"elbow_{side(co)}"], L[f"wrist_{side(co)}"]
        return abs(co.x) > 0.2 and along(co, a, b) > 1.0 + margin

    # tunic (torso and sleeves): the skin above the waist up to the collar, without hands and head
    upper = {"hips", "spine", "spine", "chest", "neck", "clavicle", "shoulder", "elbow", "wrist"}
    tunic = skin_part(body, "tunic", lambda co, b: bone_kind(b) in upper and co.z > L["waist_z"] - 0.07 and co.z < L["neck"].z + 0.02
                      and not past_wrist(co, -0.03) and bone_kind(b) not in FINGER, TUNIC)
    relax(tunic, 12, 0.6)
    sx = L["shoulder_L"].x

    def tunic_ease(co):
        if abs(co.x) > sx + 0.02:  # sleeves: roomier toward the cuff
            t = max(0.0, min(1.0, along(co, L[f"shoulder_{side(co)}"], L[f"wrist_{side(co)}"])))
            return 0.014 + 0.012 * t
        return 0.016 + 0.008 * max(0.0, min(1.0, (L["chest"].z - co.z) / 0.2))
    ease(tunic, tunic_ease)
    relax(tunic, 4, 0.5)

    # trousers: hips and legs from the waist to the boot tops
    trousers = skin_part(body, "trousers", lambda co, b: bone_kind(b) in ("hips", "hip", "knee", "spine") and L["boot_z"] - 0.06 < co.z < L["waist_z"] + 0.02, PANTS)
    relax(trousers, 10, 0.6)
    kz = L["knee_L"].z

    def trouser_ease(co):
        if co.z > L["hip_L"].z:
            return 0.016
        t = (L["hip_L"].z - co.z) / (L["hip_L"].z - kz)
        if t < 1.0:  # roomy, a little bloused over the thigh
            return 0.024 + 0.016 * math.sin(math.pi * min(1.0, t * 1.1) ** 0.9)
        return 0.022 - 0.018 * min(1.0, (kz - co.z) / (kz - L["boot_z"]))  # tucked into the boots
    ease(trousers, trouser_ease)

    # boots: the lower leg below the boot top and the foot; flat soles
    boots = skin_part(body, "boots", lambda co, b: bone_kind(b) in ("knee", "ankle", "toe") and co.z < L["boot_z"] + 0.01, BOOTS)
    relax(boots, 6, 0.5)
    ease(boots, lambda co: 0.012 + 0.008 * max(0.0, min(1.0, (co.z - L["boot_z"] + 0.12) / 0.12)) if co.z > L["ankle_L"].z + 0.04 else 0.009)
    for v in boots.data.vertices:
        if v.co.z < 0.02:
            v.co.z = 0.0

    # gloves: the hands, a little thicker
    gloves = skin_part(body, "gloves", lambda co, b: (bone_kind(b) in FINGER or bone_kind(b) == "wrist") and past_wrist(co, -0.06), GLOVE)
    ease(gloves, lambda co: 0.004)

    parts = [tunic, trousers, boots, gloves]
    for ob in parts:
        subdivide(ob)

    # the tunic's skirt: rings round the hips from the waist to the hem, convex, flaring
    hips_tree = bvh_of(trousers)
    X, Y = V((1, 0, 0)), V((0, 1, 0))
    cy = L["hips"].y
    n = 40
    rings = []
    steps = 9
    for k in range(steps + 1):
        t = k / steps
        z = L["waist_z"] + 0.02 - t * (L["waist_z"] + 0.02 - L["hem_z"])
        c = V((0, cy, z))
        hits = section(hips_tree, c, X, Y, n)
        rings.append(hull_ring(hits, c, X, Y, lambda i, t=t: 0.012 + 0.032 * t ** 1.3 + 0.01 * t * (1 - math.cos(i * TAU / n * 2)) / 2))
    skirt = loft_obj("skirt", rings, TUNIC)
    # a vent at the back (-Y is the front, +Y the back: angle 90 degrees) and slits at the sides,
    # so each panel follows its leg
    def slit(f):
        c = f.calc_center_median()
        a = math.atan2(c.y - cy, c.x)
        low = c.z < L["hem_z"] + 0.6 * (L["waist_z"] - L["hem_z"])
        return low and (abs(a - math.pi / 2) < 0.07 or abs(abs(a) - 0.0) < 0.06 or abs(abs(a) - math.pi) < 0.06)
    delete_faces(skirt, slit)
    subdivide(skirt)
    parts.append(skirt)

    # fittings cast onto the cloth
    cloth = bvh_of(tunic, skirt)
    wz = L["waist_z"]
    belt = [hull_ring(section(cloth, V((0, cy, wz + dz)), X, Y, 48), V((0, cy, wz + dz)), X, Y, lambda i: 0.005) for dz in (-0.024, -0.008, 0.008, 0.024)]
    parts.append(loft_obj("belt", belt, LEATHER))
    front = hull_ring(section(cloth, V((0, cy, wz)), X, Y, 4), V((0, cy, wz)), X, Y, lambda i: 0.012)[3]
    parts.append(box_obj("buckle", front, (0.05, 0.012, 0.042), BRASS, bevel=0.003))

    # stand collar: rings on the neck alone, rising at the back, dipping at the throat
    neck = skin_part(body, "neck_probe", lambda co, b: L["collar_z"] - 0.05 < co.z < L["neck"].z + 0.045 and bone_kind(b) in ("neck", "chest"), "#000000")
    nt = bvh_of(neck)
    bpy.data.objects.remove(neck, do_unlink=True)
    nc = V((0, L["neck"].y + 0.003, 0))
    collar = []
    for k, dz in enumerate((-0.03, -0.004, 0.022, 0.036)):
        c = V((nc.x, nc.y, L["collar_z"] + dz))
        ring = hull_ring(section(nt, c, X, Y, 32, 0.2), c, X, Y, lambda i, k=k: 0.012 + 0.003 * k)
        for i, q in enumerate(ring):
            fr = max(0.0, -math.sin(i * TAU / 32))  # 1 at the throat
            q.z -= fr ** 3 * 0.024 * (k / 3)
        collar.append(ring)
    parts.append(loft_obj("collar", collar, TUNIC))

    # cuffs turned back over the sleeve ends; gauntlet tops on the gloves
    sleeve = bvh_of(tunic)
    for sd in "LR":
        e, w = L[f"elbow_{sd}"], L[f"wrist_{sd}"]
        ax = (w - e).normalized()
        u = ax.cross(V((0, 0, 1))).normalized()
        vv = ax.cross(u).normalized()
        cuff = [hull_ring(section(sleeve, w - ax * dt, u, vv, 20, 0.15), w - ax * dt, u, vv, lambda i, g=g: g) for dt, g in ((0.075, 0.004), (0.045, 0.006), (0.015, 0.009))]
        parts.append(loft_obj(f"cuff_{sd}", cuff, TUNIC))
        glove_t = bvh_of(gloves)
        # the glove's wrist is fitted a little into the hand, then flares back over the cuff
        c0 = w + ax * 0.03
        ring = hull_ring(section(glove_t, c0, u, vv, 20, 0.15), c0, u, vv, lambda i: 0.003)
        top = [ring] + [[c0 + (q - c0) * k - ax * dt for q in ring] for dt, k in ((0.03, 1.1), (0.075, 1.38))]
        parts.append(loft_obj(f"gauntlet_{sd}", top, GLOVE))
        # boot tops: a folded band
        k_, a_ = L[f"knee_{sd}"], L[f"ankle_{sd}"]
        c = V((k_.x + (a_.x - k_.x) * (k_.z - L["boot_z"]) / (k_.z - a_.z), k_.y, L["boot_z"]))
        own = boots.copy()
        own.data = boots.data.copy()
        delete_faces(own, lambda f, s_=(1 if sd == "L" else -1): f.calc_center_median().x * s_ < 0.0)
        bt = bvh_of(own)
        top_z = max(v.co.z for v in own.data.vertices) if own.data.vertices else L["boot_z"]
        bpy.data.objects.remove(own, do_unlink=True)
        c1 = V((c.x, c.y, top_z - 0.012))
        ring = hull_ring(section(bt, c1, X, Y, 24, 0.15), c1, X, Y, lambda i: 0.003)
        band = [ring] + [[c1 + (q - c1) * k + V((0, 0, dz)) for q in ring] for dz, k in ((0.014, 1.02), (0.024, 1.035))]
        parts.append(loft_obj(f"boot_top_{sd}", band, BOOTS))
    for ob in parts:
        tag(ob, {"tunic": "tunic", "skirt": "tunic", "collar": "tunic", "trousers": "pants", "boots": "boots", "gloves": "glove",
                 "belt": "leather", "buckle": "brass"}.get(ob.name, "tunic" if ob.name.startswith("cuff") else
                                                          "glove" if ob.name.startswith("gauntlet") else "boots"))
    tag(next(o for o in parts if o.name == "buckle"), "brass", bone="hips")
    for sd in "LR":  # rings round one limb ride its bone
        for name, bone in ((f"boot_top_{sd}", f"knee_{sd}"), (f"gauntlet_{sd}", f"wrist_{sd}"), (f"cuff_{sd}", f"elbow_{sd}")):
            next(o for o in parts if o.name == name)["bone"] = bone
    return parts, L


# ---------------------------------------------------------------- tags, fittings, kit
# palette slots the game colours (src/skirmish/units/vcSoldiers.js); "head" and "hair" sample the
# painted head atlas (VRoid's own face and hair textures), everything else the cloth atlas
SLOT = {"keep": 0, "skin": 1, "hair": 2, "tunic": 3, "scarf": 4, "pants": 5, "boots": 6, "helmet": 7, "glove": 8,
        "leather": 9, "brass": 10, "metal": 11, "canvas": 12, "lens": 13, "face": 14, "iris": 15}
HEAD_SLOTS = ("skin", "hair", "face", "iris")
KIT = ["base", "pouches", "pack_small", "mags", "plate", "armor", "tubes", "pack_engineer", "tools", "goggles"]


def tag(ob, slot, piece="always", bone=None):
    """Palette slot, piece (shown per soldier) and, for rigid items, the one bone it rides on."""
    ob["slot"], ob["piece"] = slot, piece
    if bone:
        ob["bone"] = bone
    return ob


def ray(tree, origin, direction, dist=2.0):
    """Surface hit (point, outward normal) along a ray, or (None, None)."""
    loc, nrm, _, _ = tree.ray_cast(origin, direction.normalized(), dist)
    if loc is None:
        return None, None
    if nrm.dot(direction) > 0:
        nrm = -nrm
    return loc, nrm


def frame(normal, up=V((0, 0, 1))):
    """Axes (side, up, out) for an item lying on a surface with this outward normal."""
    n = normal.normalized()
    side = up.cross(n)
    if side.length < 1e-4:
        side = V((1, 0, 0))
    side.normalize()
    return side, n.cross(side).normalized(), n


def oriented_box(name, center, axes, size, color, bevel=0.0):
    """A box of size (w, h, d) along axes (side, up, out) round center."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    if bevel:
        bmesh.ops.bevel(bm, geom=bm.edges[:], offset=bevel, segments=2, affect="EDGES", profile=0.5)
    m = Matrix((axes[0], axes[1], axes[2])).transposed().to_4x4()
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    bmesh.ops.translate(bm, vec=center, verts=bm.verts)
    ob = mesh_obj(name, bm, color)
    for p in ob.data.polygons:
        p.use_smooth = bevel > 0
    return ob


def cylinder_obj(name, a, b, radius, color, segs=12, cap=True):
    """A cylinder from point a to point b."""
    ax = (b - a).normalized()
    u = ax.orthogonal().normalized()
    v = ax.cross(u)
    rings = [[p + (u * math.cos(i * TAU / segs) + v * math.sin(i * TAU / segs)) * radius for i in range(segs)] for p in (a, b)]
    bm = bmesh.new()
    loops = [[bm.verts.new(q) for q in r] for r in rings]
    for i in range(segs):
        j = (i + 1) % segs
        bm.faces.new([loops[0][i], loops[0][j], loops[1][j], loops[1][i]])
    if cap:
        bm.faces.new(list(reversed(loops[0])))
        bm.faces.new(loops[1])
    bm.normal_update()
    if sum((f.calc_center_median() - (a + b) / 2).dot(f.normal) for f in bm.faces) < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    return mesh_obj(name, bm, color)


def sphere_obj(name, c, r, color, segs=8, rings=5):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=1.0)
    bmesh.ops.scale(bm, vec=r, verts=bm.verts)
    bmesh.ops.translate(bm, vec=c, verts=bm.verts)
    return mesh_obj(name, bm, color)


def patch(name, tree, origin, direction, u, v, w, h, thick, color, lift=0.002, n=6, taper=0.0):
    """A slab conformed to a surface: an n x n grid of rays along direction from origin + u*s + v*t
    (s across w, t across h) lands on the surface; the slab stands thick off it. taper narrows the
    bottom (t = -1) edge, for flaps."""
    grid = []
    for j in range(n + 1):
        t = j / n * 2 - 1
        row = []
        for i in range(n + 1):
            s = (i / n * 2 - 1) * (1 - taper * (1 - t) / 2)
            p, nrm = ray(tree, origin + u * (s * w / 2) + v * (t * h / 2) - direction * 0.5, direction, 1.5)
            if p is None:
                return None
            row.append((p, nrm))
        grid.append(row)
    bm = bmesh.new()
    top = [[bm.verts.new(p + q * (lift + thick)) for p, q in row] for row in grid]
    bot = [[bm.verts.new(p + q * lift) for p, q in row] for row in grid]
    tops = []
    for j in range(n):
        for i in range(n):
            tops.append(bm.faces.new([top[j][i], top[j][i + 1], top[j + 1][i + 1], top[j + 1][i]]))
            bm.faces.new([bot[j][i], bot[j + 1][i], bot[j + 1][i + 1], bot[j][i + 1]])
    edge = [(0, i) for i in range(n)] + [(i, n) for i in range(n)] + [(n, n - i) for i in range(n)] + [(n - i, 0) for i in range(n)]
    for (j0, i0), (j1, i1) in zip(edge, edge[1:] + edge[:1]):
        bm.faces.new([top[j0][i0], bot[j0][i0], bot[j1][i1], top[j1][i1]])
    bm.normal_update()
    out = sum((nrm for row in grid for _, nrm in row), V()).normalized()
    if sum(f.normal.dot(out) for f in tops) < 0:  # the top must face away from the surface
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    return mesh_obj(name, bm, color)


def strap(name, tree, guide, width, color, lift=0.004, thick=0.004, step=0.012, axis=V((0, 0, 0))):
    """A flat strap laid along a guide polyline, snapped onto the nearest surface."""
    pts = []
    for a, b in zip(guide, guide[1:]):
        k = max(1, int((b - a).length / step))
        pts += [a.lerp(b, i / k) for i in range(k)]
    pts.append(guide[-1])
    snap = []
    for p in pts:
        loc, nrm, _, _ = tree.find_nearest(p)
        # outward: away from the body's vertical axis (a guide point between two hits lies inside)
        if nrm.dot(V((loc.x - axis.x, loc.y - axis.y, 0))) < 0:
            nrm = -nrm
        snap.append((loc, nrm))
    rows = []
    for i, (loc, nrm) in enumerate(snap):
        t = (snap[min(i + 1, len(snap) - 1)][0] - snap[max(i - 1, 0)][0]).normalized()
        side = t.cross(nrm).normalized()
        b = loc + nrm * lift
        rows.append([b - side * width / 2, b + side * width / 2, b + side * width / 2 + nrm * thick, b - side * width / 2 + nrm * thick])
    ob = loft_obj(name, rows, color)
    for p in ob.data.polygons:
        p.use_smooth = False
    return ob


def fittings(parts, L, body):
    """Placket, buttons, pockets, shoulder straps, the Y harness and the neckerchief."""
    tunic = next(o for o in parts if o.name == "tunic")
    tree = bvh_of(tunic)
    X, Y, Z = V((1, 0, 0)), V((0, 1, 0)), V((0, 0, 1))
    out = []
    nz, wz, cz = L["collar_z"], L["waist_z"], L["chest"].z
    cy = L["chest"].y
    # the placket down the front, its buttons
    top_z, bot_z = nz - 0.03, wz + 0.035
    pl = patch("placket", tree, V((0.012, 0, (top_z + bot_z) / 2)), Y, X, Z, 0.026, top_z - bot_z, 0.003, TUNIC, n=4)
    out.append(tag(pl, "tunic"))
    for k in range(5):
        z = top_z - 0.01 - k * (top_z - bot_z - 0.03) / 4
        p, nrm = ray(tree, V((0.012, -0.5, z)), Y)
        if p is not None:
            out.append(tag(sphere_obj(f"button{k}", p + nrm * 0.007, V((0.0065, 0.0065, 0.0065)), BRASS, 8, 4), "brass", bone="chest" if z > cz - 0.08 else "spine_mid"))
    # breast pockets with flaps and buttons
    pz = L["shoulder_L"].z - 0.12
    for s in (1, -1):
        pk = patch(f"pocket_{s}", tree, V((s * 0.078, 0, pz - 0.012)), Y, X, Z, 0.085, 0.08, 0.004, TUNIC, n=5)
        fl = patch(f"flap_{s}", tree, V((s * 0.078, 0, pz + 0.03)), Y, X, Z, 0.092, 0.034, 0.008, TUNIC, n=5, taper=0.15)
        out += [tag(o, "tunic") for o in (pk, fl) if o]
        p, nrm = ray(tree, V((s * 0.078, -0.5, pz + 0.02)), Y)
        if p is not None:
            out.append(tag(sphere_obj(f"pocket_button_{s}", p + nrm * 0.012, V((0.006, 0.006, 0.006)), BRASS, 8, 4), "brass", bone="chest"))
    # shoulder straps (epaulettes) from the collar to the shoulder seam
    for s, sd in ((1, "L"), (-1, "R")):
        x0, x1 = 0.06, L[f"shoulder_{sd}"].x * s + 0.02
        ep = patch(f"epaulette_{sd}", tree, V((s * (x0 + x1) / 2, L["neck"].y, 0)), -Z, X, Y, x1 - x0, 0.045, 0.005, TUNIC, n=5)
        if ep:
            out.append(tag(ep, "tunic"))
            p, nrm = ray(tree, V((s * (x1 - 0.015), L["neck"].y, 2.0)), -Z)
            if p is not None:
                out.append(tag(sphere_obj(f"epaulette_button_{sd}", p + nrm * 0.01, V((0.006, 0.006, 0.006)), BRASS, 8, 4), "brass", bone=f"clavicle_{sd}"))
    # the Y harness: two straps from the belt up over the shoulders, crossing into one at the back
    front = lambda x, z: ray(tree, V((x, -0.5, z)), Y)[0]
    back = lambda x, z: ray(tree, V((x, 0.5, z)), -Y)[0]
    over = lambda x: ray(tree, V((x, L["neck"].y, 2.0)), -Z)[0]
    meet = back(0.0, cz - 0.1)
    for s, sd in ((1, "L"), (-1, "R")):
        guide = [front(s * 0.085, wz + 0.02), front(s * 0.092, cz - 0.04), front(s * 0.1, L["shoulder_L"].z - 0.02), over(s * 0.105),
                 back(s * 0.09, L["shoulder_L"].z - 0.03), back(s * 0.05, cz - 0.04), meet]
        if all(g is not None for g in guide):
            out.append(tag(strap(f"harness_{sd}", tree, guide, 0.032, LEATHER, lift=0.011, axis=V((0, cy, 0))), "leather"))
    tail = back(0.0, wz + 0.02)
    if meet and tail:
        out.append(tag(strap("harness_back", tree, [meet, tail], 0.036, LEATHER, lift=0.011, axis=V((0, cy, 0))), "leather"))
    ring = meet
    if ring:
        n_ = (ring - V((0, L["chest"].y, ring.z))).normalized()
        out.append(tag(cylinder_obj("harness_ring", ring + n_ * 0.006, ring + n_ * 0.014, 0.022, BRASS, 12), "brass", bone="chest"))
    # neckerchief: a knot at the throat and two tails
    p, nrm = ray(tree, V((0, -0.5, nz - 0.012)), Y)
    if p is not None:
        c = p + nrm * 0.014
        out.append(tag(sphere_obj("kerchief_knot", c, V((0.012, 0.009, 0.011)), TRIM, 10, 6), "scarf", "scarf", bone="chest"))
        for k, dx in enumerate((0.011, -0.008)):
            rings = [[c + off + V((math.cos(i * TAU / 8) * w_, math.sin(i * TAU / 8) * 0.003, 0)) for i in range(8)]
                     for off, w_ in ((V((dx * 0.3, -0.003, -0.009)), 0.009), (V((dx, -0.006, -0.04)), 0.012), (V((dx * 1.5, -0.005, -0.068)), 0.003))]
            out.append(tag(loft_obj(f"kerchief_tail{k}", rings, TRIM), "scarf", "scarf", bone="chest"))
    return out


def kit(parts, L):
    """The class kit (pieces kit_<tag>) and the two helmets."""
    tunic = next(o for o in parts if o.name == "tunic")
    skirt = next(o for o in parts if o.name == "skirt")
    belt = next(o for o in parts if o.name == "belt")
    body_t, belt_t, low_t = bvh_of(tunic), bvh_of(belt), bvh_of(skirt, belt)
    X, Y, Z = V((1, 0, 0)), V((0, 1, 0)), V((0, 0, 1))
    wz, cz, cy = L["waist_z"], L["chest"].z, L["hips"].y
    out = []

    def on(tree, origin, direction, size, name, color, slot, piece, bone, gap=0.002, bevel=0.006, up=Z):
        p, nrm = ray(tree, origin, direction)
        if p is None:
            print("  kit miss", name)
            return None
        ax = frame(V((nrm.x, nrm.y, 0)) if abs(nrm.z) < 0.9 else nrm, up)
        ob = oriented_box(name, p + ax[2] * (size[2] / 2 + gap), ax, size, color, bevel)
        out.append(tag(ob, slot, piece, bone))
        return ob, p, ax

    def toward(angle, z, r=0.6):
        """A ray from outside at angle (0 = front, positive = the soldier's left) toward the waist axis."""
        o = V((math.sin(angle) * r, cy - math.cos(angle) * r, z))
        return o, V((0, cy, z)) - o

    # base: two ammo pouches on the belt, a canteen at the right hip, a bayonet frog on the left
    for s in (1, -1):
        o, d = toward(s * 0.55, wz)
        r = on(belt_t, o, d, (0.07, 0.062, 0.038), f"belt_pouch_{s}", LEATHER, "leather", "kit_base", "hips")
        if r:
            ob, p, ax = r
            out.append(tag(oriented_box(f"belt_flap_{s}", p + ax[2] * 0.042 + ax[1] * 0.018, ax, (0.074, 0.03, 0.01), LEATHER, 0.004), "leather", "kit_base", "hips"))
    o, d = toward(-1.9, wz - 0.07)
    p, nrm = ray(low_t, o, d)
    if p is not None:
        c = p + V((nrm.x, nrm.y, 0)).normalized() * 0.05
        out.append(tag(cylinder_obj("canteen", c - Z * 0.07, c + Z * 0.07, 0.042, "#6B7A5A", 14), "canvas", "kit_base", "hips"))
        out.append(tag(cylinder_obj("canteen_cap", c + Z * 0.07, c + Z * 0.09, 0.014, BRASS, 8), "metal", "kit_base", "hips"))
    o, d = toward(2.0, wz - 0.02)
    on(low_t, o, d, (0.035, 0.2, 0.02), "bayonet", LEATHER, "leather", "kit_base", "hips", up=(Z * 0.9 + X * 0.3).normalized())

    # pouches: small pouches on the harness straps at the chest
    for s in (1, -1):
        on(body_t, V((s * 0.092, -0.5, cz - 0.07)), Y, (0.05, 0.058, 0.03), f"chest_pouch_{s}", LEATHER, "leather", "kit_pouches", "chest")

    # mags (shocktrooper): three tall magazine pouches across the stomach
    for k, x in enumerate((-0.055, 0.0, 0.055)):
        on(body_t, V((x, -0.5, wz + 0.1)), Y, (0.045, 0.11, 0.03), f"mag_{k}", "#6B7A5A", "canvas", "kit_mags", "spine_mid")

    # packs on the back: a small one with a blanket roll, the engineer's big one
    def pack(name, w, h, d, z, piece):
        r = on(body_t, V((0, 0.6, z)), -Y, (w, h, d), name, "#6B7A5A", "canvas", piece, "chest", gap=0.012, bevel=0.022)
        return r
    r = pack("pack_small", 0.25, 0.26, 0.11, cz - 0.07, "kit_pack_small")
    if r:
        ob, p, ax = r
        top = p + ax[2] * 0.07 + Z * 0.165
        out.append(tag(cylinder_obj("blanket", top - X * 0.13, top + X * 0.13, 0.04, "#7A6E5A", 14), "leather", "kit_pack_small", "chest"))
    r = pack("pack_engineer", 0.32, 0.38, 0.16, cz - 0.1, "kit_pack_engineer")
    if r:
        ob, p, ax = r
        # tools: a shovel strapped to the pack's side, a wrench on the belt
        s0 = p + ax[2] * 0.1 - X * 0.19 + Z * 0.12
        out.append(tag(cylinder_obj("shovel_handle", s0, s0 - Z * 0.36, 0.013, "#8A6A4A", 8), "canvas", "kit_tools", "chest"))
        out.append(tag(oriented_box("shovel_blade", s0 - Z * 0.42, (X, Z, Y), (0.012, 0.15, 0.12), "#6E7276", 0.004), "metal", "kit_tools", "chest"))
    o, d = toward(1.3, wz - 0.06)
    on(low_t, o, d, (0.03, 0.17, 0.015), "wrench", "#6E7276", "metal", "kit_tools", "hips", up=(Z - Y * 0.2).normalized())

    # tubes (lancer): three spare lance rounds racked on the back
    for k, x in enumerate((-0.08, 0.0, 0.08)):
        p, nrm = ray(body_t, V((x, 0.6, cz - 0.05)), -Y)
        if p is not None:
            c = p + V((0, nrm.y, 0)).normalized() * 0.06
            out.append(tag(cylinder_obj(f"tube_{k}", c - Z * 0.2, c + Z * 0.18, 0.036, "#55705A", 12), "metal", "kit_tubes", "chest"))
            out.append(tag(cylinder_obj(f"tube_tip_{k}", c + Z * 0.18, c + Z * 0.24, 0.026, "#6E7276", 12), "metal", "kit_tubes", "chest"))

    # plate (shocktrooper): a pauldron on the left shoulder; armor (lancer): both, and a breastplate
    for sd, s, piece in (("L", 1, "kit_plate"), ("L", 1, "kit_armor"), ("R", -1, "kit_armor")):
        sh = L[f"shoulder_{sd}"]
        pl = patch(f"pauldron_{sd}_{piece}", body_t, V((sh.x + s * 0.02, sh.y, 0)), -Z, X, Y, 0.16, 0.15, 0.008, "#55705A", lift=0.012, n=6)
        if pl:
            out.append(tag(pl, "metal", piece, f"shoulder_{sd}"))
    bp = patch("breastplate", body_t, V((0, 0, cz - 0.04)), Y, X, Z, 0.24, 0.2, 0.01, "#55705A", lift=0.012, n=7)
    if bp:
        out.append(tag(bp, "metal", "kit_armor", "chest"))

    # goggles (sniper): hanging on the chest from a band round the neck
    for s in (1, -1):
        p, nrm = ray(body_t, V((s * 0.034, -0.5, L["collar_z"] - 0.07)), Y)
        if p is not None:
            out.append(tag(cylinder_obj(f"goggle_{s}", p + nrm * 0.006, p + nrm * 0.026, 0.022, "#3A3A3E", 12), "metal", "kit_goggles", "chest"))
            out.append(tag(cylinder_obj(f"lens_{s}", p + nrm * 0.026, p + nrm * 0.029, 0.017, "#9AB4C0", 12), "lens", "kit_goggles", "chest"))
    return out


def helmets(L, head_objs):
    """Two helmets over a short-haired head: the Federation's round one with a brim, the Empire's
    deep one with a gas-mask visor (the enemy has no face)."""
    tree = bvh_of(*head_objs)
    X, Y, Z = V((1, 0, 0)), V((0, 1, 0)), V((0, 0, 1))
    h = L["head"]
    top_z = max((o.matrix_world @ V(c)).z for o in head_objs for c in o.bound_box)
    brow = h.z + 0.1
    out = []
    c0 = V((0, h.y + 0.01, 0))

    def dome(name, z0, z1, grow, color, slot, piece, flare=0.0, rings=7, back_drop=0.0):
        rs = []
        for k in range(rings + 1):
            t = k / rings
            z = z0 + (z1 - z0) * t
            c = V((c0.x, c0.y, z))
            ring = hull_ring(section(tree, c, X, Y, 28, 0.3), c, X, Y, lambda i: grow + flare * (1 - t) ** 3)
            for i, q in enumerate(ring):
                q.z -= back_drop * max(0.0, math.sin(i * TAU / 28)) * (1 - t) ** 2
            rs.append(ring)
        cap = V((c0.x, c0.y, top_z + grow * 0.9))
        ob = loft_obj(name, rs + [[cap + (q - cap) * 0.02 for q in rs[-1]]], color)
        subdivide(ob)
        return tag(ob, slot, piece, "head")

    out.append(dome("helm_fed", brow - 0.02, top_z - 0.012, 0.022, "#55705A", "helmet", "helm_fed", flare=0.03))
    out.append(dome("helm_imp", brow - 0.07, top_z - 0.012, 0.024, "#4A4D52", "helmet", "helm_imp", flare=0.035, back_drop=0.05))
    # the visor: a plate over the face from the brow to the chin, two round lenses, a filter
    face_t = bvh_of(*head_objs)
    vis = patch("visor", face_t, V((0, 0, h.z + 0.04)), Y, X, Z, 0.15, 0.13, 0.008, "#2E2F33", lift=0.014, n=7)
    if vis:
        out.append(tag(vis, "metal", "helm_imp", "head"))
    for s in (1, -1):
        p, nrm = ray(face_t, V((s * 0.033, -0.5, h.z + 0.068)), Y)
        if p is not None:
            out.append(tag(cylinder_obj(f"visor_eye_{s}", p + nrm * 0.016, p + nrm * 0.03, 0.022, "#2E2F33", 12), "metal", "helm_imp", "head"))
            out.append(tag(cylinder_obj(f"visor_lens_{s}", p + nrm * 0.03, p + nrm * 0.033, 0.017, "#C24A3A", 12), "lens", "helm_imp", "head"))
    p, nrm = ray(face_t, V((0, -0.5, h.z + 0.005)), Y)
    if p is not None:
        out.append(tag(cylinder_obj("visor_filter", p + nrm * 0.018, p + nrm * 0.05, 0.026, "#3A3A3E", 12), "metal", "helm_imp", "head"))
    return out


# ---------------------------------------------------------------- the head atlas (VRoid's textures)
HEAD_ATLAS = 2048
# per VRoid material (by name fragment): slot, size in the atlas (px)
HEAD_PARTS = [
    ("Face_00_SKIN", "skin", (512, 512)), ("EyeIris", "iris", (512, 256)), ("EyeHighlight", "face", (256, 128)),
    ("EyeWhite", "face", (512, 256)), ("FaceEyeline", "face", (1024, 256)), ("FaceEyelash", "face", (512, 128)),
    ("FaceBrow", "hair", (512, 128)), ("FaceMouth", "face", (256, 256)), ("HAIR", "hair", (512, 512)),
]
SOURCES = {}  # material name -> (base colour factor, alpha mode) from the VRM files read


def read_vrm_materials(rel):
    import json
    import struct
    with open(os.path.join(VROID, rel), "rb") as f:
        b = f.read()
    n = struct.unpack_from("<I", b, 12)[0]
    j = json.loads(b[20:20 + n])
    for m in j["materials"]:
        pbr = m.get("pbrMetallicRoughness", {})
        SOURCES.setdefault(m["name"], (pbr.get("baseColorFactor", [1, 1, 1, 1]), m.get("alphaMode", "OPAQUE")))


def image_of(mat):
    for n in mat.node_tree.nodes:
        if n.type == "TEX_IMAGE" and n.image:
            return n.image
    return None


def pixels(img):
    import numpy as np
    w, h = img.size
    buf = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(buf)
    return buf.reshape(h, w, 4)


def sample(img, us, vs):
    """Bilinear samples of an (h, w, 4) image (rows bottom to top) at UVs, wrapping."""
    import numpy as np
    h, w = img.shape[:2]
    x, y = us * w - 0.5, vs * h - 0.5
    x0, y0 = np.floor(x).astype(np.int64), np.floor(y).astype(np.int64)
    fx, fy = (x - x0)[..., None], (y - y0)[..., None]
    at = lambda xi, yi: img[np.mod(yi, h), np.mod(xi, w)]
    return (at(x0, y0) * (1 - fx) * (1 - fy) + at(x0 + 1, y0) * fx * (1 - fy) + at(x0, y0 + 1) * (1 - fx) * fy + at(x0 + 1, y0 + 1) * fx * fy)


def srgb(c):
    return [(12.92 * x if x <= 0.0031308 else 1.055 * x ** (1 / 2.4) - 0.055) for x in c[:3]] + [c[3] if len(c) > 3 else 1.0]


def shelf_pack(items, size, pad=4):
    """Rects (x, y, w, h) for items [(key, w, h)], tallest first, in shelves across the atlas."""
    out, x, y, row = {}, 0, 0, 0
    for key, w, h in sorted(items, key=lambda it: (-it[2], -it[1])):
        w2, h2 = w + 2 * pad, h + 2 * pad
        if x + w2 > size:
            x, y, row = 0, y + row, 0
        assert y + h2 <= size, "head atlas full"
        out[key] = (x + pad, y + pad, w, h)
        x += w2
        row = max(row, h2)
    return out


def head_atlas(objs, neck, path):
    """Every VRoid texture the head parts use, cropped to the UVs in use, scaled and packed into one
    atlas; the parts' UVs ("atlas") rewritten to match, their faces tagged with a slot. Hair and
    iris (and brows) keep only their brightness, so the game can colour them per soldier. The neck
    samples one texel of plain skin."""
    import numpy as np
    jobs, items = [], []
    for ob in objs:
        me = ob.data
        src = me.uv_layers[0].data
        for mi, m in enumerate(me.materials):
            polys = [p for p in me.polygons if p.material_index == mi]
            if not polys:
                continue
            kind = next(((frag, slot, size) for frag, slot, size in HEAD_PARTS if frag in m.name), None)
            if kind is None:
                continue
            us = np.array([src[li].uv[0] for p in polys for li in p.loop_indices])
            vs = np.array([src[li].uv[1] for p in polys for li in p.loop_indices])
            key = f"{ob.name}:{m.name}"
            jobs.append((key, ob, mi, m, kind, (us.min(), vs.min(), us.max(), vs.max())))
            items.append((key, *kind[2]))
    rects = shelf_pack(items, HEAD_ATLAS)
    A = np.zeros((HEAD_ATLAS, HEAD_ATLAS, 4), dtype=np.float32)
    slot_of = {}
    for key, ob, mi, m, (frag, slot, size), (u0, v0, u1, v1) in jobs:
        x, y, w, h = rects[key]
        img = pixels(image_of(m))
        factor, mode = SOURCES.get(m.name.split(".")[0], ([1, 1, 1, 1], "OPAQUE"))
        f = np.array(srgb(factor), dtype=np.float32)
        # the rect plus a 4 px border (sampled past the UVs in use), 2 x 2 supersampled
        pad = 4
        gx = (np.arange(-pad, w + pad)[None, :] + 0.5)
        gy = (np.arange(-pad, h + pad)[:, None] + 0.5)
        acc = 0
        for ox in (-0.25, 0.25):
            for oy in (-0.25, 0.25):
                uu = u0 + (gx + ox) / w * (u1 - u0) + 0 * gy
                vv = v0 + (gy + oy) / h * (v1 - v0) + 0 * gx
                acc = acc + sample(img, uu, vv)
        px = acc / 4 * f
        if mode == "OPAQUE":
            px[..., 3] = 1.0
        if slot in ("hair", "iris"):
            lum = px[..., 0] * 0.3 + px[..., 1] * 0.59 + px[..., 2] * 0.11
            seen = lum[px[..., 3] > 0.5]
            top = max(1e-3, float(np.percentile(seen, 92))) if seen.size else 1.0
            g = np.clip(lum / top, 0, 1) ** (0.8 if slot == "hair" else 1.0)
            px[..., 0] = px[..., 1] = px[..., 2] = g
        A[y - pad:y + h + pad, x - pad:x + w + pad] = px
        # UVs into the rect
        me = ob.data
        if "atlas" not in me.uv_layers:
            me.uv_layers.new(name="atlas")
        src, dst = me.uv_layers[0].data, me.uv_layers["atlas"].data
        for p in me.polygons:
            if p.material_index != mi:
                continue
            slot_of[(ob.name, p.index)] = slot
            for li in p.loop_indices:
                u, v = src[li].uv
                dst[li].uv = ((x + (u - u0) / max(1e-6, u1 - u0) * w) / HEAD_ATLAS, (y + (v - v0) / max(1e-6, v1 - v0) * h) / HEAD_ATLAS)
    # the neck: one texel of the face's skin, beside the forehead (under the hair anyway)
    face = next(o for o in objs if o.name == "Face")
    me = face.data
    skin_mi = next(i for i, m in enumerate(me.materials) if "Face_00_SKIN" in m.name)
    best, uv = None, (0.1, 0.1)
    for p in me.polygons:
        if p.material_index != skin_mi:
            continue
        c = p.center
        d = abs(c.x - 0.03) + abs(c.z - (max(v.co.z for v in me.vertices) - 0.07)) + max(0.0, c.y + 0.05) * 3
        if best is None or d < best:
            best, uv = d, tuple(me.uv_layers["atlas"].data[p.loop_indices[0]].uv)
    nm = neck.data
    if "atlas" not in nm.uv_layers:
        nm.uv_layers.new(name="atlas")
    for l in nm.uv_layers["atlas"].data:
        l.uv = uv
    for p in nm.polygons:
        slot_of[(neck.name, p.index)] = "skin"
    im = bpy.data.images.new("head_atlas", HEAD_ATLAS, HEAD_ATLAS, alpha=True)
    im.pixels.foreach_set(A.ravel())
    im.filepath_raw = path
    im.file_format = "PNG"
    im.save()
    print("HEAD ATLAS", len(rects), "rects ->", path)
    return slot_of


# ---------------------------------------------------------------- assembly
def decimate(ob, ratio):
    m = ob.modifiers.new("dec", "DECIMATE")
    m.ratio = ratio
    select_only(ob)
    bpy.ops.object.modifier_apply(modifier="dec")


def set_meta(ob, slot_of_poly, piece_index):
    """TEXCOORD_1 ("meta"): u = palette slot, v = piece."""
    me = ob.data
    meta = me.uv_layers.get("meta") or me.uv_layers.new(name="meta")
    for p in me.polygons:
        s = SLOT[slot_of_poly(p)]
        for li in p.loop_indices:
            meta.data[li].uv = (s + 0.5, piece_index + 0.5)


def sides(ob):
    """Vertex -> "_L" / "_R" for the parts of one side: a whole object named *_L / *_R, else each
    connected island lying off the midline, else the vertex itself when it is well off it."""
    if ob.name[-2:] in ("_L", "_R"):
        return {v.index: ob.name[-2:] for v in ob.data.vertices}
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.verts.ensure_lookup_table()
    out, seen = {}, set()
    for v0 in bm.verts:
        if v0.index in seen:
            continue
        isl, stack = [], [v0]
        seen.add(v0.index)
        while stack:
            v = stack.pop()
            isl.append(v)
            for e in v.link_edges:
                w = e.other_vert(v)
                if w.index not in seen:
                    seen.add(w.index)
                    stack.append(w)
        mx = sum(v.co.x for v in isl) / len(isl)
        for v in isl:
            x = mx if abs(mx) > 0.03 else v.co.x
            if abs(x) > 0.03:
                out[v.index] = "_L" if x > 0 else "_R"
    bm.free()
    return out


def weigh(ob, arm, source):
    """Rigid items ride their one bone; cloth copies the body's weights from the nearest skin."""
    names = [b.name for b in arm.data.bones]
    if "bone" in ob:
        ob.vertex_groups.clear()
        ob.vertex_groups.new(name=ob["bone"]).add(range(len(ob.data.vertices)), 1.0, "REPLACE")
    elif not ob.vertex_groups:
        for n in names:
            ob.vertex_groups.new(name=n)
        mod = ob.modifiers.new("dt", "DATA_TRANSFER")
        mod.object = source
        mod.use_vert_data = True
        mod.data_types_verts = {"VGROUP_WEIGHTS"}
        mod.vert_mapping = "POLYINTERP_NEAREST"
        mod.layers_vgroup_select_src = "ALL"
        mod.layers_vgroup_select_dst = "NAME"
        select_only(ob)
        bpy.ops.object.modifier_apply(modifier="dt")
        # the nearest skin can be the other leg's (inside a boot top, between the thighs): a part of
        # one side never follows the other side's limb
        side = {g.index: g.name[-2:] for g in ob.vertex_groups if g.name[-2:] in ("_L", "_R")}
        own = sides(ob)
        for v in ob.data.vertices:
            s = own.get(v.index)
            if s is None:
                continue
            wrong = "_R" if s == "_L" else "_L"
            bad = [g for g in v.groups if side.get(g.group) == wrong]
            if not bad:
                continue
            heavy = max(bad, key=lambda g: g.weight)
            mirror = ob.vertex_groups[heavy.group].name[:-2] + s
            kept = sum(g.weight for g in v.groups if side.get(g.group) != wrong)
            for g in bad:
                ob.vertex_groups[g.group].remove([v.index])
            if kept < 0.2:  # it hung on the other limb alone: take this side's same bone
                ob.vertex_groups[mirror].add([v.index], 1.0, "ADD")
    ob.modifiers.clear()
    ob.parent = arm
    ob.modifiers.new("Armature", "ARMATURE").object = arm


def skirt_weights(skirt, L):
    """The skirt hangs from the hips: near the belt it is all hips, toward the hem the legs take a share."""
    gi = {g.name: g.index for g in skirt.vertex_groups}
    hips = skirt.vertex_groups["hips"]
    for v in skirt.data.vertices:
        k = max(0.0, min(1.0, (L["waist_z"] - v.co.z) / (L["waist_z"] - L["hem_z"])))
        keep = 0.75 * k ** 0.8
        for g in v.groups:
            g.weight *= keep
        hips.add([v.index], 1.0 - keep, "ADD")


def normalise(ob, fallback):
    select_only(ob)
    bpy.ops.object.vertex_group_limit_total(limit=4)
    fb = ob.vertex_groups[fallback].index
    orphans = 0
    for v in ob.data.vertices:
        total = sum(g.weight for g in v.groups)
        if total > 1e-6:
            for g in v.groups:
                g.weight /= total
        else:
            orphans += 1
            ob.vertex_groups[fb].add([v.index], 1.0, "REPLACE")
    return orphans


def assemble(arm, source, body, face, hairs, parts, kits, helms, L, head_png):
    """One skinned mesh: cloth, kit and helmets (cloth atlas), the neck, face and hair styles (head
    atlas). Returns the mesh and the piece names (meta v indexes into them)."""
    hair_objs = list(hairs.values())
    for ob in hair_objs:
        target = 5200
        if len(ob.data.polygons) > target:
            decimate(ob, target / len(ob.data.polygons))
    face_mats = face.data.materials
    extra = [i for i, m in enumerate(face_mats) if "EyeExtra" in m.name]
    delete_faces(face, lambda f: f.material_index in extra)
    slot_of = head_atlas([face, *hair_objs], body, head_png)
    pieces = ["always", "face"] + [o.name for o in hair_objs] + ["helm_fed", "helm_imp", "scarf"] + [f"kit_{k}" for k in KIT]
    head_objs = [body, face, *hair_objs]
    for ob in head_objs:
        piece = "face" if ob is face else ob.name if ob.name.startswith("hair") else "always"
        set_meta(ob, lambda p, ob=ob: slot_of.get((ob.name, p.index), "skin"), pieces.index(piece))
    cloth = [*parts, *kits, *helms]
    for ob in cloth:
        set_meta(ob, lambda p, ob=ob: ob["slot"], pieces.index(ob["piece"]))
        if "atlas" not in ob.data.uv_layers:
            ob.data.uv_layers.new(name="atlas")
    for ob in cloth + [o for o in hair_objs]:
        weigh(ob, arm, source)
    skirt_weights(next(o for o in parts if o.name == "skirt"), L)
    # only "atlas" (TEXCOORD_0) and "meta" (TEXCOORD_1)
    allo = head_objs + cloth
    for ob in allo:
        me = ob.data
        for lay in [l for l in me.uv_layers if l.name not in ("atlas", "meta")]:
            me.uv_layers.remove(lay)
        me.materials.clear()
        for a in list(me.color_attributes):
            me.color_attributes.remove(a)
        ob.shape_key_clear()
    names = [b.name for b in arm.data.bones]
    for ob in allo:
        for n in names:
            if n not in ob.vertex_groups:
                ob.vertex_groups.new(name=n)
    select_only(*allo, active=face)
    bpy.ops.object.join()
    model = face
    model.name = model.data.name = "soldier"
    for g in [g for g in model.vertex_groups if g.name not in names]:
        model.vertex_groups.remove(g)
    orphans = normalise(model, "hips")
    print("ASSEMBLED", len(model.data.polygons), "faces;", orphans, "unweighted vertices")
    m = bpy.data.materials.new("M_soldier")
    model.data.materials.append(m)
    return model, pieces


def metas(me):
    lay = me.uv_layers["meta"].data
    return [(int(lay[p.loop_start].uv[0]), int(lay[p.loop_start].uv[1])) for p in me.polygons]


def is_head(slot):
    return slot in (SLOT[s] for s in HEAD_SLOTS)


# ---------------------------------------------------------------- the cloth atlas
ATLAS = 2048


def cloth_unwrap(ob):
    """Smart-project the cloth, kit and helmet faces (everything but the head) over the cloth atlas."""
    me = ob.data
    meta = metas(me)
    me.uv_layers.active = me.uv_layers["atlas"]
    select_only(ob)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_mode(type="FACE")
    bm = bmesh.from_edit_mesh(me)
    bm.faces.ensure_lookup_table()
    for f, (slot, _) in zip(bm.faces, meta):
        f.select_set(not is_head(slot))
    bmesh.update_edit_mesh(me)
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.003, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode="OBJECT")


def bake_copy(src, keep, name):
    me = src.data.copy()
    ob = bpy.data.objects.new(name, me)
    COL.objects.link(ob)
    meta = metas(me)
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[f for f, (slot, piece) in zip(bm.faces, meta) if not keep(slot, piece)], context="FACES")
    bm.to_mesh(me)
    bm.free()
    me.uv_layers.active = me.uv_layers["atlas"]
    me.uv_layers["atlas"].active_render = True
    ob.vertex_groups.clear()
    ob.parent = None
    ob.modifiers.clear()
    return ob


def bake_maps(src, pieces, samples=32):
    """Occlusion, position, normal and (slot, piece) baked over the cloth atlas. Each optional piece
    is baked with the always-worn uniform (so a pack darkens the back under it, but the uniform
    alone carries no shadow of a pack it may not wear)."""
    import numpy as np
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = samples
    sc.render.bake.margin = 6
    sc.render.bake.use_clear = False
    sc.world = bpy.data.worlds.new("bake")
    sc.world.light_settings.distance = 0.09
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
    base_p = (pieces.index("always"),)
    used = sorted({pc for sl, pc in metas(src.data) if not is_head(sl)})
    objs = {"all": bake_copy(src, lambda sl, pc: not is_head(sl), "bake_all"),
            "base": bake_copy(src, lambda sl, pc: not is_head(sl) and pc in base_p, "bake_base")}
    for p_ in used:
        if p_ not in base_p:
            objs[p_] = bake_copy(src, lambda sl, pc, p_=p_: not is_head(sl) and pc == p_, f"bake_{p_}")
    for ob in objs.values():
        ob.data.materials.clear()
        ob.data.materials.append(mat)

    def bake(target, visible, kind, **kw):
        for o in bpy.data.objects:
            o.hide_render = o not in visible
        tex.image = imgs[kind]
        select_only(target)
        bpy.ops.object.bake(**kw)

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
    for o in bpy.data.objects:
        o.hide_render = False
    return {k: pixels(im) for k, im in imgs.items()}


def _hash(ix, iy, iz, seed):
    import numpy as np
    n = (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791) ^ (seed * 2654435761)
    n = n & 0xFFFFFFFF
    n = ((n ^ (n >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((n ^ (n >> 16)) & 0xFFFF).astype(np.float32) / 65535.0


def vnoise(p, scale, seed=0):
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


def paint_cloth(maps, L, pieces):
    """Cloth atlas pixels from the bakes: R shade (soft painted occlusion, mottling, folds), G trim
    (the faction's piping), B pencil ink (seams, edges, creases, hatching in the hollows)."""
    import numpy as np
    A = ATLAS
    meta = maps["meta"]
    cov = meta[..., 0] > 0.25
    idx = np.nonzero(cov.ravel())[0]
    P = maps["pos"].reshape(-1, 4)[idx, :3].astype(np.float64)
    N = maps["nrm"].reshape(-1, 4)[idx, :3] * 2 - 1
    ao = maps["ao"].reshape(-1, 4)[idx, 0]
    slot = np.floor(meta.reshape(-1, 4)[idx, 0]).astype(int)
    piece = np.floor(meta.reshape(-1, 4)[idx, 1]).astype(int)
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    ax = np.abs(x)
    py, px = np.divmod(idx, A)
    sm = lambda e0, e1, t: np.clip((t - e0) / (e1 - e0), 0, 1) ** 2 * (3 - 2 * np.clip((t - e0) / (e1 - e0), 0, 1))
    line = lambda d, w=0.0006, aa=0.0009: np.clip(1 - (np.abs(d) - w) / aa, 0, 1)
    dash = lambda along, period=0.0065: (np.mod(along / period, 1.0) < 0.55).astype(np.float32)
    S = lambda k: slot == SLOT[k]
    T, PA, BO, GL, LE, CA, ME = S("tunic"), S("pants"), S("boots"), S("glove"), S("leather"), S("canvas"), S("metal") | S("helmet")
    always = piece == pieces.index("always")
    shade = np.ones(len(idx))
    ink = np.zeros(len(idx))
    trim = np.zeros(len(idx))
    add = lambda mask, amount: np.maximum(ink, np.where(mask, amount, 0.0))
    nz, wz, hem, kz, bz = (L[k] for k in ("collar_z", "waist_z", "hem_z", "knee_z", "boot_z"))
    cz, cy = L["chest"].z, L["chest"].y
    sx = L["shoulder_L"].x
    # occlusion as a soft painted shadow, ink in the creases, pencil hatching in the hollows
    shade *= 0.6 + 0.4 * sm(0.12, 0.85, ao)
    ink = add(np.ones(len(idx), bool), 0.55 * (1 - sm(0.08, 0.32, ao)))
    tri = np.abs(np.mod((px + py) / 7.0, 1.0) - 0.5) * 2
    ink = add(np.ones(len(idx), bool), np.clip((0.3 - tri) / 0.15, 0, 1) * np.clip((0.6 - ao) / 0.3, 0, 1) * 0.3)
    # watercolour mottling and grain; light from above
    shade *= 1 + 0.12 * (fbm(P, 9.0, 3) - 0.5) + 0.05 * (vnoise(P, 140.0, 5) - 0.5)
    shade *= (0.93 + 0.09 * np.clip(N[:, 2], 0, 1)) * (1 - 0.08 * np.clip(-N[:, 2], 0, 1))
    tunic_body = T & always & (ax < sx - 0.01) & (z > wz) & (z < nz)
    sleeve = T & always & (ax > sx + 0.01)
    # tunic seams: sides, centre back, shoulder seams and armholes; elbow and sleeve folds
    ink = add(tunic_body & (z < L["shoulder_L"].z - 0.06), 0.5 * line(y - cy - 0.005))
    ink = add(tunic_body & (y > cy + 0.03), 0.45 * line(x))
    sh = np.sqrt((ax - sx) ** 2 + (y - L["shoulder_L"].y) ** 2 + (z - L["shoulder_L"].z) ** 2)
    ink = add(T & always & (z > L["shoulder_L"].z - 0.13), 0.5 * line(sh - 0.08))
    for sd in "LR":
        e = L[f"elbow_{sd}"]
        r = np.sqrt((x - e.x) ** 2 + (y - e.y) ** 2 + (z - e.z) ** 2)
        under = (z < e.z) | (y < e.y)
        ink = add(sleeve & under & (r < 0.07), 0.4 * np.maximum(line(r - 0.03), line(r - 0.05)) * (1 - sm(0.05, 0.07, r)))
        w_ = L[f"wrist_{sd}"]
        rw = np.abs(x - w_.x)
        ink = add(sleeve & (rw < 0.14) & (rw > 0.08), 0.3 * line(np.sin(np.arctan2(z - w_.z, y - w_.y) * 3 + rw * 90) * 0.004, 0.0005))
    # waist folds bunched under the belt
    ink = add(T & always & (np.abs(z - wz) < 0.06) & (ax < sx), 0.35 * line(np.sin(np.arctan2(y - cy, x) * 11) * 0.004 + (z - wz) * 0.04, 0.0006) * (1 - sm(0.03, 0.06, np.abs(z - wz))))
    # piping in the faction's trim: the skirt's hem, the collar's top, the cuffs' edges, the placket
    skirt_ = T & always & (z < wz - 0.025) & (ax < sx)
    trim = np.maximum(trim, np.where(skirt_, sm(hem + 0.016, hem + 0.012, z), 0.0))
    ink = add(skirt_, 0.5 * line(z - hem - 0.014, 0.0005))
    ink = add(skirt_ & (y < cy), 0.3 * line(np.sin(np.arctan2(y - cy, x) * 7) * 0.01, 0.0006) * sm(wz - 0.05, hem, z))
    collar_ = T & always & (z > nz - 0.035) & (ax < 0.1) & (z < nz + 0.05)
    trim = np.maximum(trim, np.where(collar_, sm(nz + 0.028, nz + 0.031, z), 0.0))
    for sd in "LR":
        w_ = L[f"wrist_{sd}"]
        d = np.abs(x - w_.x)
        cuff = T & always & (d < 0.085) & (ax > sx)
        trim = np.maximum(trim, np.where(cuff, sm(0.05, 0.047, d) * sm(0.012, 0.016, d), 0.0))
    front = T & always & (y < cy - 0.05) & (z > wz) & (z < nz - 0.02)
    ink = add(front, 0.55 * np.maximum(line(x - 0.026), line(x + 0.001)))
    ink = add(front, 0.35 * line(x - 0.031, 0.0004) * dash(z))
    # trousers: the outer seam, folds at the knee and over the boots
    for sd, s_ in (("L", 1), ("R", -1)):
        hp = L[f"hip_{sd}"]
        ink = add(PA & (x * s_ > 0) & (np.abs(x - hp.x) > 0.05), 0.45 * line(y - hp.y))
    ink = add(PA & (np.abs(z - kz) < 0.06), 0.35 * np.maximum(line(z - kz - 0.012 - 0.004 * np.sin(x * 90)), line(z - kz + 0.02)))
    for h_ in (bz + 0.03, bz + 0.05, bz + 0.07):
        ink = add(PA & (z < bz + 0.09), 0.4 * line(z - h_ - 0.005 * np.sin(np.arctan2(y, x) * 5), 0.0005))
    # boots: a dark sole, its line, the toe cap, the heel
    shade *= np.where(BO & (z < 0.03), 0.62, 1.0)
    ink = add(BO, 0.6 * line(z - 0.032, 0.0006))
    toe_y = L["toe_L"].y
    ink = add(BO & (y < toe_y + 0.01) & (z < 0.08), 0.45 * line(y - toe_y + 0.035 + (z - 0.04) * 0.5))
    ink = add(BO & (y > L["ankle_L"].y + 0.02) & (z < 0.07), 0.4 * line(z - 0.065))
    # gloves: seams over the knuckles
    ink = add(GL, 0.3 * line(np.sin(np.arctan2(y, z) * 7) * 0.003, 0.0005))
    # leather and canvas: stitched edges (where the occlusion turns), straps across the packs
    ink = add(LE | CA, 0.35 * line(ao - 0.62, 0.01, 0.02) * dash(x + y + z, 0.008))
    pack_ = CA & (y > cy + 0.05) & (z > wz)
    for s_ in (1, -1):
        ink = add(pack_, 0.5 * np.maximum(line(x - s_ * 0.06), line(x - s_ * 0.08)))
        shade *= np.where(pack_ & (np.abs(x - s_ * 0.07) < 0.01), 0.85, 1.0)
    # metal: a pencilled rim light
    ink = add(ME, 0.3 * (1 - sm(0.1, 0.45, ao)))
    out = np.zeros((A * A, 4), dtype=np.float32)
    out[:, 0] = 1.0
    out[:, 3] = 1.0
    out[idx, 0] = np.clip(shade, 0, 1)
    out[idx, 1] = np.clip(trim, 0, 1)
    out[idx, 2] = np.clip(ink, 0, 1)
    return out.reshape(A, A, 4)


def save_png(px, path, name):
    h, w = px.shape[:2]
    im = bpy.data.images.new(name, w, h, alpha=False)
    im.colorspace_settings.name = "Non-Color"
    im.pixels.foreach_set(px.ravel())
    im.filepath_raw = path
    im.file_format = "PNG"
    im.save()


def far_model(model):
    """The far model: the close one decimated (keeps UVs, slots and weights well enough past 24 m)."""
    far = model.copy()
    far.data = model.data.copy()
    far.name = far.data.name = "soldier_lod1"
    COL.objects.link(far)
    decimate(far, 0.3)
    return far


# ---------------------------------------------------------------- animation: retarget from UAL
UAL = arg("--ual")
CLIPS = {
    "idle": ("Idle_Loop", True), "walk": ("Jog_Fwd_Loop", True), "run": ("Sprint_Loop", True),
    "crouch": ("Crouch_Idle_Loop", True), "crouch_walk": ("Crouch_Fwd_Loop", True), "kneel": ("Fixing_Kneeling", False),
    "hit": ("Hit_Chest", False), "fall_back": ("Death01", False), "fall_front": ("Death01", False),
}
BONE_MAP = {
    "DEF-hips": "hips", "DEF-spine.001": "spine", "DEF-spine.002": "spine_mid", "DEF-spine.003": "chest", "DEF-neck": "neck", "DEF-head": "head",
    **{f"DEF-{a}.{S}": f"{b}_{S}" for S in "LR" for a, b in (("shoulder", "clavicle"), ("upper_arm", "shoulder"), ("forearm", "elbow"), ("hand", "wrist"),
                                                             ("thigh", "hip"), ("shin", "knee"), ("foot", "ankle"), ("toe", "toe"))},
    **{f"DEF-{f}.0{k}.{S}": f"{t}_0{k}_{S}" for S in "LR" for f, t in (("f_index", "index"), ("f_middle", "middle"), ("f_ring", "ring"), ("f_pinky", "pinky"), ("thumb", "thumb")) for k in (1, 2, 3)},
}
# bones whose rest direction is a convention, not anatomy: they keep the rig's own rest in the reference pose
NO_AIM = {"hips", "clavicle_L", "clavicle_R"}


def import_ual():
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(UAL))
    new = [o for o in bpy.data.objects if o not in before]
    src = next(o for o in new if o.type == "ARMATURE")
    for o in new:
        if o is not src:
            bpy.data.objects.remove(o, do_unlink=True)
    src.name = "ual_rig"
    return src


def world_rest(arm, bone):
    return arm.matrix_world @ bone.matrix_local


def hierarchy(arm):
    out = []

    def walk(b):
        out.append(b)
        for c in b.children:
            walk(c)
    for b in arm.data.bones:
        if b.parent is None:
            walk(b)
    return out


def aim_of(rig, b):
    """The way a rig bone points at rest (VRoid bones all point up; the limb runs to the child joint)."""
    child = {"shoulder": "elbow", "elbow": "wrist", "hip": "knee", "knee": "ankle", "ankle": "toe"}
    parts = b.name.split("_")
    J = lambda n: joint(rig, n)
    if b.name in ("spine", "spine_mid", "chest", "neck"):
        nxt = {"spine": "spine_mid", "spine_mid": "chest", "chest": "neck", "neck": "head"}[b.name]
        return (J(nxt) - J(b.name)).normalized()
    if b.name == "head":
        return V((0, 0, 1))
    if parts[0] in child:
        return (J(f"{child[parts[0]]}_{parts[1]}") - J(b.name)).normalized()
    if parts[0] == "wrist":
        return (J(f"middle_01_{parts[1]}") - J(b.name)).normalized()
    if parts[0] == "toe":
        return V((0, -1, 0))
    if parts[0] in FINGER:
        k, sd = int(parts[1]), parts[2]
        if k < 3:
            return (J(f"{parts[0]}_0{k + 1}_{sd}") - J(b.name)).normalized()
        return (J(b.name) - J(f"{parts[0]}_02_{sd}")).normalized()
    return None


def reference_pose(src, rig):
    """World rotations of the rig posed like the source's rest (a T-pose): each mapped bone turned,
    after its parent's turn, so it points the way its source bone points."""
    from mathutils import Quaternion
    inv = {t: s for s, t in BONE_MAP.items()}
    ref, delta = {}, {}
    for b in hierarchy(rig):
        rest = world_rest(rig, b).to_quaternion()
        d = delta[b.parent.name].copy() if b.parent else Quaternion()
        sname = inv.get(b.name)
        aim = aim_of(rig, b)
        if sname and sname in src.data.bones and aim is not None and b.name not in NO_AIM:
            sb = src.data.bones[sname]
            want = ((src.matrix_world @ sb.tail_local) - (src.matrix_world @ sb.head_local)).normalized()
            have = d @ aim
            d = have.rotation_difference(want) @ d
        delta[b.name] = d
        ref[b.name] = d @ rest
    return ref


def retarget(src, rig, ref, clip, name, loop):
    action = bpy.data.actions.get(clip)
    src.animation_data_create()
    src.animation_data.action = action
    scene = bpy.context.scene
    f0, f1 = (int(round(x)) for x in action.frame_range)
    fps = scene.render.fps
    inv = {t: s for s, t in BONE_MAP.items()}
    order = hierarchy(rig)
    src_rest = {s: world_rest(src, src.data.bones[s]).to_quaternion() for s in BONE_MAP if s in src.data.bones}
    hips_s0 = src.matrix_world @ src.data.bones["DEF-hips"].head_local
    hips_t0 = rig.matrix_world @ rig.data.bones["hips"].head_local
    leg = lambda a, x, y: ((a.matrix_world @ a.data.bones[x].head_local) - (a.matrix_world @ a.data.bones[y].head_local)).length
    k_leg = (leg(rig, "hip_L", "knee_L") + leg(rig, "knee_L", "ankle_L")) / (leg(src, "DEF-thigh.L", "DEF-shin.L") + leg(src, "DEF-shin.L", "DEF-foot.L"))
    out = bpy.data.actions.new(name)
    rig.animation_data_create()
    rig.animation_data.action = out
    rig_rot = rig.matrix_world.to_quaternion()
    prev = {}
    foot = []
    for f in range(f0, f1 + 1):
        scene.frame_set(f)
        posed = {}
        for b in order:
            pb = rig.pose.bones[b.name]
            rest_rel = (b.parent.matrix_local.inverted() @ b.matrix_local).to_quaternion() if b.parent else b.matrix_local.to_quaternion()
            parent_w = posed[b.parent.name] if b.parent else rig_rot
            sname = inv.get(b.name)
            if sname in src_rest:
                sw = (src.matrix_world @ src.pose.bones[sname].matrix).to_quaternion()
                w = sw @ src_rest[sname].inverted() @ ref[b.name]
            else:
                w = parent_w @ rest_rel
            q = (parent_w @ rest_rel).inverted() @ w
            if b.name in prev and prev[b.name].dot(q) < 0:
                q.negate()
            prev[b.name] = q
            posed[b.name] = parent_w @ rest_rel @ q
            pb.rotation_mode = "QUATERNION"
            pb.rotation_quaternion = q
            pb.keyframe_insert("rotation_quaternion", frame=f - f0)
            if b.name == "hips":
                hs = src.matrix_world @ src.pose.bones["DEF-hips"].head
                want = hips_t0 + (hs - hips_s0) * k_leg
                rest_w = rig.matrix_world @ b.matrix_local
                pb.location = rest_w.to_3x3().inverted() @ (want - hips_t0)
                pb.keyframe_insert("location", frame=f - f0)
        foot.append((src.matrix_world @ src.pose.bones["DEF-foot.L"].head).y * k_leg)
    src.animation_data.action = None
    duration = (f1 - f0) / fps
    speed = (max(foot) - min(foot)) / (duration * 0.5) if loop and duration > 0 else 0
    print("CLIP", name, "from", clip, "frames", f1 - f0 + 1, "dur", round(duration, 2), "speed~", round(speed, 2))
    out.use_fake_user = True
    return out


def build_actions(rig):
    src = import_ual()
    for b in rig.pose.bones:
        b.rotation_mode = "QUATERNION"
    ref = reference_pose(src, rig)
    actions = {name: retarget(src, rig, ref, clip, name, loop) for name, (clip, loop) in CLIPS.items()}
    bpy.data.objects.remove(src, do_unlink=True)
    return actions


def export(path, rig, meshes):
    """Every clip on its own NLA track, so the exporter writes one animation per clip."""
    rig.animation_data_create()
    rig.animation_data.action = None
    for act in bpy.data.actions:
        if act.name in CLIPS:
            track = rig.animation_data.nla_tracks.new()
            track.name = act.name
            track.strips.new(act.name, 0, act)
    for pb in rig.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
    bpy.ops.object.select_all(action="DESELECT")
    for o in (rig, *meshes):
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_yup=True, export_apply=False,
                              export_animations=True, export_animation_mode="NLA_TRACKS", export_skins=True,
                              export_force_sampling=True, export_optimize_animation_size=True, export_extras=True,
                              export_vertex_color="NONE", export_texcoords=True, export_normals=True,
                              export_morph=False, export_cameras=False, export_lights=False, export_materials="PLACEHOLDER")


# ---------------------------------------------------------------- previews
def preview(tag, objects, views=(("front", 0), ("side", 90), ("three", 30)), size=(600, 1000), ortho=1.9, focus=None, engine="EEVEE"):
    """Renders from the front (the soldier faces -Y in Blender), the side and three-quarter."""
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE" if engine == "EEVEE" else "BLENDER_WORKBENCH"
    scene.view_settings.view_transform = "Standard"
    if engine != "EEVEE":
        scene.display.shading.light = "STUDIO"
        scene.display.shading.color_type = "MATERIAL"
        scene.display.shading.show_cavity = True
    if not scene.world:
        scene.world = bpy.data.worlds.new("preview")
        scene.world.use_nodes = True
        scene.world.node_tree.nodes["Background"].inputs[0].default_value = (0.62, 0.62, 0.64, 1)
    if "preview_sun" not in bpy.data.objects:
        sun = bpy.data.objects.new("preview_sun", bpy.data.lights.new("preview_sun", "SUN"))
        COL.objects.link(sun)
        sun.data.energy = 2.5
        sun.rotation_euler = (math.radians(50), 0, math.radians(20))
        fill = bpy.data.objects.new("preview_fill", bpy.data.lights.new("preview_fill", "SUN"))
        COL.objects.link(fill)
        fill.data.energy = 1.2
        fill.rotation_euler = (math.radians(60), 0, math.radians(200))
    scene.render.resolution_x, scene.render.resolution_y = size
    for o in bpy.data.objects:
        o.hide_render = o.type == "MESH" and o not in objects
        if o.type == "MESH" and "color" in o and not o.data.materials:
            m = bpy.data.materials.new(o.name)
            h = o["color"].lstrip("#")
            m.diffuse_color = [((int(h[i:i + 2], 16) / 255) ** 2.2) for i in (0, 2, 4)] + [1.0]
            m.use_nodes = True
            m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = m.diffuse_color
            m.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.8
            o.data.materials.append(m)
    cam = bpy.data.objects.get("preview_cam") or bpy.data.objects.new("preview_cam", bpy.data.cameras.new("preview_cam"))
    if cam.name not in COL.objects:
        COL.objects.link(cam)
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = ortho
    scene.camera = cam
    c = focus or V((0, 0, 0.88))
    for name, deg in views:
        a = math.radians(deg)
        cam.location = c + V((math.sin(a) * 6, -math.cos(a) * 6, 0))
        cam.rotation_euler = (math.radians(90), 0, a)
        scene.render.filepath = os.path.join(PREVIEW, f"{tag}_{name}.png")
        bpy.ops.render.render(write_still=True)


def main():
    arm, body, face, hairs = build_base()
    if STAGE == "import":
        if PREVIEW:
            head = joint(arm, "head")
            for h, hair in hairs.items():
                preview(f"import_{h}", [body, face, hair])
                preview(f"import_{h}_head", [body, face, hair], views=(("front", 0), ("three", 30), ("back", 180)), size=(600, 600), ortho=0.36, focus=head + V((0, 0, 0.08)))
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(PREVIEW or ".", f"soldier_v5_{SEX}_import.blend"))
        return
    source = body.copy()
    source.data = body.data.copy()
    COL.objects.link(source)
    parts, L = dress(arm, body)
    hair_base = split_hair_base(body)
    trim_body(body, L)
    parts += fittings(parts, L, body)
    kits = kit(parts, L)
    helms = helmets(L, [face, hair_base])
    print("DRESS", len(parts), "parts", sum(len(p.data.polygons) for p in parts), "faces;", len(kits), "kit,", len(helms), "helmet parts")
    if STAGE == "dress":
        if PREVIEW:
            for h, hair in list(hairs.items())[:1]:
                scout = [o for o in kits if o["piece"] in ("kit_base", "kit_pouches", "kit_pack_small")]
                shown = [body, face, hair, *parts, *scout]
                lancer = [body, face, hair_base, *parts, *[o for o in kits if o["piece"] in ("kit_base", "kit_armor", "kit_tubes")], *[o for o in helms if o["piece"] == "helm_fed"]]
                enemy = [body, hair_base, *parts, *[o for o in kits if o["piece"] in ("kit_base", "kit_mags", "kit_plate", "kit_pack_small")], *[o for o in helms if o["piece"] == "helm_imp"]]
                engineer = [body, face, hair, *parts, *[o for o in kits if o["piece"] in ("kit_base", "kit_pouches", "kit_pack_engineer", "kit_tools", "kit_goggles")]]
                preview("kit_lancer", lancer, views=(("front", 0), ("three", 30), ("back", 180)))
                preview("kit_enemy", enemy, views=(("front", 0), ("three", 30), ("back", 180)))
                preview("kit_engineer", engineer, views=(("front", 0), ("three", 30), ("back", 180)))
                preview("dress", shown)
                preview("dress_top", shown, views=(("front", 0), ("three", 30), ("back", 180)), size=(700, 700), ortho=0.75, focus=L["chest"] + V((0, 0, 0.0)))
                preview("dress_low", shown, views=(("front", 0), ("three", 30), ("back", 180)), size=(700, 700), ortho=0.9, focus=V((0, 0, 0.55)))
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(PREVIEW or ".", f"soldier_v5_{SEX}_dress.blend"))
        return
    hairs["base"] = hair_base
    read_vrm_materials(BASE[SEX])
    for d in HAIR[SEX].values():
        read_vrm_materials(d)
    model, pieces = assemble(arm, source, body, face, hairs, parts, kits, helms, L, arg("--head"))
    bpy.data.objects.remove(source, do_unlink=True)
    model["pieces"] = pieces
    print("STEP unwrap")
    cloth_unwrap(model)
    far = far_model(model)
    far["pieces"] = pieces
    if arg("--atlas"):
        print("STEP bake")
        save_png(paint_cloth(bake_maps(model, pieces), L, pieces), arg("--atlas"), "cloth_atlas")
    print("STEP actions")
    actions = build_actions(arm)
    tris = lambda o: sum(len(p.vertices) - 2 for p in o.data.polygons)
    print(f"SOLDIER close {tris(model)} triangles, far {tris(far)}; pieces {pieces}")
    if PREVIEW:
        for o in (model, far):
            o.data.materials[0].diffuse_color = (0.55, 0.6, 0.68, 1)
        far.hide_render = True
        for name, frac in (("idle", 0.3), ("walk", 0.25), ("run", 0.3), ("crouch_walk", 0.4), ("kneel", 0.6), ("fall_back", 1.0)):
            act = actions[name]
            arm.animation_data.action = act
            bpy.context.scene.frame_set(int(act.frame_range[1] * frac))
            preview(f"anim_{name}", [model], views=(("three", 30), ("side", 90)), size=(500, 700), engine="WORKBENCH")
        arm.animation_data.action = None
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(PREVIEW, f"soldier_v5_{SEX}.blend"))
    if OUT:
        export(OUT, arm, [model, far])
        print("EXPORTED", OUT)


def split_hair_base(body):
    """The base's own short hair (a cap on the skull, material HairBack) as a hair style of its own."""
    hb = {i for i, m in enumerate(body.data.materials) if "HairBack" in m.name}
    ob = body.copy()
    ob.data = body.data.copy()
    COL.objects.link(ob)
    delete_faces(ob, lambda f: f.material_index not in hb)
    ob.name = ob.data.name = "hair_base"
    return ob


def trim_body(body, L):
    """What the uniform leaves of the body: the skin of the neck above the collar (the face is its
    own mesh)."""
    dom = dominant(body)
    skin = {i for i, m in enumerate(body.data.materials) if "SKIN" in m.name}
    delete_faces(body, lambda f: f.material_index not in skin or not all(v.co.z > L["collar_z"] - 0.035 and bone_kind(dom[v.index]) in ("neck", "head") for v in f.verts))


main()
