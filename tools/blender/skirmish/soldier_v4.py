"""Skirmish soldier v4, after the look of Valkyria Chronicles (PS3), on a real human base.

The body is a MakeHuman base mesh made with MPFB 2 (CC0; the add-on must be installed in this
Blender as an extension, bl_ext.user_default.mpfb), shaped toward VC1 proportions (about 7 heads:
the head scaled up, a slimmer neck) and given an anime-leaning face (smaller nose and mouth, a
softer chin; the eyes are painted at runtime, see src/skirmish/units/facePainter.js). It is rigged
with MPFB's game engine skeleton, renamed to the bone names the runtime uses (hips, spine,
chest, neck, head, clavicle_*, shoulder_*, elbow_*, wrist_*, hip_*, knee_*, ankle_*, toe_*).

Animation comes from the Quaternius Universal Animation Library (CC0; the Godot GLB of the
standard pack, path in UAL below), retargeted onto the rig: the rig is posed to match the source's
rest pose bone by bone (its T-pose), then every frame each bone takes the source bone's rotation
relative to that pose, in world space; the hips' travel is scaled by the leg length.

Stages (run with --stage to stop after one and write preview renders):
  body   the shaped base mesh and its rig
  anim   the retargeted clips (previews: a frame of each)
  dress  the uniform: tunic, skirt, breeches, boots from MakeHuman's clothing helpers, with collar,
         belt, cuffs and boot tops fitted by casting rays at the body; the body under it is removed
  hair   the hair styles: flat tapering locks laid over the skull (rays at the head find it)
  (none) everything: one skinned mesh (and a decimated far one), the painted atlas, the clips, and
         the GLB with the face frame in the mesh's extras (see FACE below)

One skinned mesh on one armature, so each soldier is one draw call. Per-vertex data the game reads
(src/skirmish/units/vcSoldiers.js):
  TEXCOORD_0 ("atlas"): the painted atlas (R shade, G trim piping / hair sheen, B pencil ink)
  TEXCOORD_1 ("meta"): u = palette slot (0 keep the authored colour, 1 skin, 2 hair, 3 tunic,
      4 scarf, 5 trousers, 6 boots, 7 helmet, 8 iris, 9 gloves); v = piece (0 always shown; 1-5
      hair styles; 6/7 helmets; 10.. kit tags in KIT order; 30 the face)

Run:  Blender -b --python soldier_v4.py -- <out.glb> --ual <AnimationLibrary_Godot_Standard.glb> [--atlas <atlas.png>]
      [--stage body|dress|hair|anim --preview <dir>]
"""
import math
import os
import sys

import functools
import addon_utils
import bmesh
import bpy
from mathutils import Matrix, Vector as V
from mathutils.bvhtree import BVHTree

TAU = math.tau
print = functools.partial(print, flush=True)  # progress shows even if Blender dies later

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = ARGS[0] if ARGS and not ARGS[0].startswith("--") else None


def arg(name, default=None):
    return ARGS[ARGS.index(name) + 1] if name in ARGS else default


STAGE = arg("--stage")
PREVIEW = arg("--preview")

addon_utils.enable("bl_ext.user_default.mpfb", default_set=True)
from bl_ext.user_default.mpfb.services.humanservice import HumanService  # noqa: E402
from bl_ext.user_default.mpfb.services.targetservice import TargetService  # noqa: E402

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)
COL = bpy.context.scene.collection

# ---------------------------------------------------------------- the body
# MakeHuman macros (0..1): a young, slim, athletic soldier with idealised proportions
MACRO = {"gender": 0.92, "age": 0.44, "muscle": 0.56, "weight": 0.4, "height": 0.42, "proportions": 1.0}
# shape targets: VC1 leans anime in the face (small nose and mouth, soft narrow chin, fuller
# cheeks), long-limbed and narrow-waisted in the body
TARGETS = {
    "nose-scale-depth-decr": 0.7, "nose-scale-horiz-decr": 0.45, "nose-scale-vert-decr": 0.35, "nose-point-width-decr": 0.6,
    "nose-flaring-decr": 0.6, "nose-hump-decr": 0.8, "nose-volume-decr": 0.5,
    "mouth-scale-horiz-decr": 0.35, "mouth-lowerlip-volume-decr": 0.4, "mouth-upperlip-volume-decr": 0.3,
    "chin-width-decr": 0.45, "chin-prominent-decr": 0.3, "chin-bones-decr": 0.5, "chin-triangle": 0.35,
    "l-cheek-bones-decr": 0.5, "r-cheek-bones-decr": 0.5, "l-cheek-volume-incr": 0.25, "r-cheek-volume-incr": 0.25,
    "head-oval": 0.4, "head-age-decr": 0.2, "forehead-scale-vert-incr": 0.15,
    "l-eye-bag-decr": 0.8, "r-eye-bag-decr": 0.8, "l-eye-push1-out": 0.4, "r-eye-push1-out": 0.4,
    "neck-scale-horiz-decr": 0.35, "neck-scale-depth-decr": 0.25,
    "measure-waist-circ-decr": 0.35, "torso-vshape-incr": 0.25, "upperlegs-height-incr": 0.25, "lowerlegs-height-incr": 0.2,
}
HEAD_SCALE = 1.12  # VC1 heads are a little large for the body (about 7 heads tall)

UAL = arg("--ual")  # Animation Library[Standard]/Godot/AnimationLibrary_Godot_Standard.glb (not in the repo)
# game clip <- (source clip, its natural ground speed is measured; loop). The game walks at 3.2 m/s
# and runs at 5.2: a jog and a sprint
CLIPS = {
    "idle": ("Idle_Loop", True), "walk": ("Jog_Fwd_Loop", True), "run": ("Sprint_Loop", True),
    "crouch": ("Crouch_Idle_Loop", True), "crouch_walk": ("Crouch_Fwd_Loop", True), "kneel": ("Fixing_Kneeling", False),
    "hit": ("Hit_Chest", False), "fall_back": ("Death01", False), "fall_front": ("Death01", False),
}
# source (UAL, Rigify DEF bones) -> target (runtime names, fingers keep MPFB's)
BONE_MAP = {
    "DEF-hips": "hips", "DEF-spine.001": "spine", "DEF-spine.002": "spine_mid", "DEF-spine.003": "chest", "DEF-neck": "neck", "DEF-head": "head",
    **{f"DEF-{a}.{S}": f"{b}_{S}" for S in "LR" for a, b in (("shoulder", "clavicle"), ("upper_arm", "shoulder"), ("forearm", "elbow"), ("hand", "wrist"),
                                                             ("thigh", "hip"), ("shin", "knee"), ("foot", "ankle"), ("toe", "toe"))},
    **{f"DEF-{f}.0{k}.{S}": f"{t}_0{k}_{S.lower()}" for S in "LR" for f, t in (("f_index", "index"), ("f_middle", "middle"), ("f_ring", "ring"), ("f_pinky", "pinky"), ("thumb", "thumb")) for k in (1, 2, 3)},
}

# runtime bone names (src/skirmish/units/vcSoldiers.js, soldiers.js IK) from MPFB's game engine rig
RENAME = {
    "Root": "root", "pelvis": "hips", "spine_01": "spine", "spine_02": "spine_mid", "spine_03": "chest", "neck_01": "neck", "head": "head",
    "clavicle_l": "clavicle_L", "upperarm_l": "shoulder_L", "lowerarm_l": "elbow_L", "hand_l": "wrist_L",
    "clavicle_r": "clavicle_R", "upperarm_r": "shoulder_R", "lowerarm_r": "elbow_R", "hand_r": "wrist_R",
    "thigh_l": "hip_L", "calf_l": "knee_L", "foot_l": "ankle_L", "ball_l": "toe_L",
    "thigh_r": "hip_R", "calf_r": "knee_R", "foot_r": "ankle_R", "ball_r": "toe_R",
}


def target_path(name):
    path = TargetService.target_full_path(name)
    if not path:
        raise RuntimeError(f"no MPFB target {name}")
    return path


def select_only(*obs, active=None):
    bpy.ops.object.select_all(action="DESELECT")
    for o in obs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or obs[0]


def build_body():
    macro = TargetService.get_default_macro_info_dict()
    macro.update(MACRO)
    body = HumanService.create_human(mask_helpers=False, detailed_helpers=True, extra_vertex_groups=True, scale=0.1, macro_detail_dict=macro)
    for name, w in TARGETS.items():
        TargetService.load_target(body, target_path(name), weight=w)
    rig = HumanService.add_builtin_rig(body, "game_engine", import_weights=True)
    # bake the shape keys; keep the clothing and hair helpers as their own meshes, then drop the
    # helper geometry (joint cubes, eyeballs, teeth, tongue) from the body
    select_only(body)
    TargetService.bake_targets(body)
    helpers = {name: split_group(body, f"helper-{name}", f"helper_{name}") for name in ("tights", "skirt", "hair", "l-eye", "r-eye")}
    keep_group(body, "body")
    for m in list(body.modifiers):
        if m.type != "ARMATURE":
            body.modifiers.remove(m)
    eye_domes(body, [helpers.pop("l-eye"), helpers.pop("r-eye")])
    for h in helpers.values():
        scale_head(h, rig)
    scale_head(body, rig)
    ground(body, rig, *helpers.values())
    rename_bones(rig, body, *helpers.values())
    body.name, rig.name = "soldier_body", "soldier_rig"
    return body, rig, helpers


def scale_head(body, rig):
    """Scale the head about the top of the neck by its skin weight, so the neck blends in."""
    pivot = rig.matrix_world @ rig.data.bones["head"].head_local
    if body.name == "Human":  # the body itself: the eye centres go with it
        EYES[:] = [pivot + (e - pivot) * HEAD_SCALE for e in EYES]
    gi = body.vertex_groups["head"].index
    for v in body.data.vertices:
        w = next((g.weight for g in v.groups if g.group == gi), 0.0)
        if w > 0:
            k = 1 + (HEAD_SCALE - 1) * w
            v.co = pivot + (v.co - pivot) * k


def vertex_set(obj, group, minimum=0.5):
    gi = obj.vertex_groups[group].index
    return {v.index for v in obj.data.vertices if any(g.group == gi and g.weight > minimum for g in v.groups)}


def keep_only(obj, keep):
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.index not in keep], context="VERTS")
    bm.to_mesh(obj.data)
    bm.free()


def keep_group(obj, group):
    keep_only(obj, vertex_set(obj, group))


def split_group(body, group, name):
    """A copy of the body holding only one helper group's vertices (with the body's weights and armature)."""
    obj = body.copy()
    obj.data = body.data.copy()
    obj.name = obj.data.name = name
    COL.objects.link(obj)
    keep_group(obj, group)
    for m in list(obj.modifiers):
        if m.type != "ARMATURE":
            obj.modifiers.remove(m)
    return obj


EYES = []  # eye centres (rest pose, before the head is scaled and the body grounded)


def eye_domes(body, eyes):
    """The eye sockets are deep pockets (the eyeballs were helper geometry). Push every socket vertex
    inside an eyeball out onto its surface: a smooth dome behind the lids for the painted eyes,
    and the lids' edge reads as an ink line."""
    for eye in eyes:
        pts = [v.co.copy() for v in eye.data.vertices]
        c = sum(pts, V()) / len(pts)
        r = sum((p - c).length for p in pts) / len(pts)
        moved = 0
        for v in body.data.vertices:
            d = v.co - c
            if d.length < r * 0.999:
                v.co = c + d.normalized() * r
                moved += 1
        print("EYE", tuple(round(x, 3) for x in c), "r", round(r, 4), "moved", moved)
        EYES.append(c.copy())
        bpy.data.objects.remove(eye, do_unlink=True)
    # smooth the lids into the domes: the painted anime eye is larger than the real opening, and
    # the opening's crease would draw a second, smaller outline inside it
    bm = bmesh.new()
    bm.from_mesh(body.data)
    for c in EYES:
        area = [v for v in bm.verts if (v.co - c).length < 0.024 and v.co.y < c.y + 0.004]
        for _ in range(12):
            bmesh.ops.smooth_vert(bm, verts=area, factor=0.6, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    bm.to_mesh(body.data)
    bm.free()


def ground(body, rig, *others):
    """Stand the soldier on z = 0 (the leg targets lengthened the legs after MPFB grounded them)."""
    dz = -min(v.co.z for v in body.data.vertices)
    EYES[:] = [e + V((0, 0, dz)) for e in EYES]
    for o in (body, *others):
        for v in o.data.vertices:
            v.co.z += dz
    local = rig.matrix_world.inverted().to_3x3() @ V((0, 0, dz))
    select_only(rig)
    bpy.ops.object.mode_set(mode="EDIT")
    for b in rig.data.edit_bones:
        b.head += local
        b.tail += local
    bpy.ops.object.mode_set(mode="OBJECT")


def rename_bones(rig, *meshes):
    for old, new in RENAME.items():
        b = rig.data.bones.get(old)
        if b:
            b.name = new
    for m in meshes:
        for g in m.vertex_groups:
            if g.name in RENAME:
                g.name = RENAME[g.name]


# ---------------------------------------------------------------- the uniform
def landmarks(rig):
    """World positions of the bone heads (and a few derived heights) the dressing is fitted to."""
    L = {b.name: rig.matrix_world @ b.head_local for b in rig.data.bones}
    L["neck_z"] = L["neck"].z
    L["waist_z"] = L["spine_mid"].z - 0.01
    L["hip_z"] = L["hip_L"].z
    L["knee_z"] = L["knee_L"].z
    L["ankle_z"] = L["ankle_L"].z
    L["hem_z"] = L["hip_z"] - 0.42 * (L["hip_z"] - L["knee_z"])
    L["boot_z"] = L["knee_z"] - 0.36 * (L["knee_z"] - L["ankle_z"])
    return L


def bvh_of(*objs):
    bm = bmesh.new()
    for o in objs:
        tmp = bmesh.new()
        tmp.from_mesh(o.data)
        tmp.transform(o.matrix_world)
        me = bpy.data.meshes.new("tmp")
        tmp.to_mesh(me)
        tmp.free()
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
    tree = BVHTree.FromBMesh(bm)
    bm.free()
    return tree


def section(tree, center, u, v, n, reach=0.4, grow=0.0):
    """Points round the outermost surface in the plane of (u, v) through center: rays cast inward
    from `reach` away. grow pushes each point out along the ray."""
    pts = []
    for i in range(n):
        a = i * TAU / n
        d = (u * math.cos(a) + v * math.sin(a)).normalized()
        hit = tree.ray_cast(center + d * reach, -d, reach)
        p = hit[0] if hit[0] is not None else center + d * 0.02
        pts.append(p + d * grow)
    return pts


def loft_obj(name, rings, color, cap=False, close=True):
    """A mesh object of quads between equal-size rings."""
    bm = bmesh.new()
    loops = [[bm.verts.new(V(p)) for p in r] for r in rings]
    n = len(loops[0])
    for a, b in zip(loops, loops[1:]):
        for i in range(n if close else n - 1):
            j = (i + 1) % n
            bm.faces.new([a[i], a[j], b[j], b[i]])
    if cap:
        bm.faces.new(list(reversed(loops[0])))
        bm.faces.new(loops[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # open bands: face away from their own axis
    c = sum((v.co for v in bm.verts), V()) / len(bm.verts)
    bm.normal_update()
    if not cap and sum((f.calc_center_median() - c).dot(f.normal) for f in bm.faces) < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    return mesh_obj(name, bm, color)


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


def cut(src, name, keep_vert, color):
    """A copy of a helper keeping the faces whose every vertex passes keep_vert(co)."""
    bm = bmesh.new()
    bm.from_mesh(src.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if not all(keep_vert(v.co) for v in f.verts)], context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    return mesh_obj(name, bm, color)


def subdivide(ob, levels=1):
    m = ob.modifiers.new("subd", "SUBSURF")
    m.levels = levels
    m.boundary_smooth = "PRESERVE_CORNERS"
    select_only(ob)
    bpy.ops.object.modifier_apply(modifier="subd")


def offset(ob, d):
    ob.data.update()
    for v in ob.data.vertices:
        v.co += v.normal * d


def limb_axis(L, side, a, b):
    return L[f"{a}_{side}"], L[f"{b}_{side}"]


def along(p, a, b):
    """Parameter of p's projection on the segment a-b (0 at a, 1 at b) and its distance from the line."""
    ab = b - a
    t = (p - a).dot(ab) / ab.length_squared
    return t, (p - (a + ab * t)).length


def radial(ob, axis_of, factor):
    """Push vertices away from a limb axis: axis_of(co) -> (a, b) segment, factor(co, t) -> scale."""
    for v in ob.data.vertices:
        a, b = axis_of(v.co)
        t, _ = along(v.co, a, b)
        c = a + (b - a) * max(0.0, min(1.0, t))
        d = v.co - c
        d.z = 0.0 if abs((b - a).normalized().z) > 0.7 else d.z
        v.co = c + (v.co - c) + d * (factor(v.co, t) - 1.0)


def dress(body, rig, helpers):
    L = landmarks(rig)
    print("LANDMARKS", {k: (round(v, 3) if isinstance(v, float) else tuple(round(x, 3) for x in v)) for k, v in L.items() if not any(f in k for f in ("index", "middle", "ring", "pinky", "thumb"))})
    tights, skirt_h = helpers["tights"], helpers["skirt"]
    side = lambda co: "L" if co.x > 0 else "R"

    def beyond_wrist(co, margin=0.0):
        if abs(co.x) < 0.12:
            return False
        a, b = limb_axis(L, side(co), "elbow", "wrist")
        t, dist = along(co, a, b)
        return t > 1.0 + margin and dist < 0.12

    # tunic: torso and sleeves to the wrist; breeches: waist to the boots; boots: below
    tunic = cut(tights, "tunic", lambda co: co.z > L["waist_z"] - 0.06 and not beyond_wrist(co, -0.02), "#4F6F8F")
    breeches = cut(tights, "breeches", lambda co: L["boot_z"] - 0.03 < co.z < L["waist_z"] + 0.02, "#3D4F63")
    boots = cut(tights, "boots", lambda co: co.z < L["boot_z"] + 0.012, "#4A3222")
    skirt = cut(skirt_h, "skirt", lambda co: L["hem_z"] - 0.01 < co.z < L["waist_z"] + 0.05, "#4F6F8F")
    for ob in (tunic, breeches, boots, skirt):
        subdivide(ob)
    offset(tunic, 0.006)
    offset(breeches, 0.005)
    offset(boots, 0.008)
    offset(skirt, 0.012)
    # breeches bloused over the thigh, tight into the boots
    leg = lambda co: limb_axis(L, side(co), "hip", "knee") if co.z > L["knee_z"] else limb_axis(L, side(co), "knee", "ankle")
    def blouse(co, t):
        if co.z > L["knee_z"]:
            return 1.0 + 0.2 * math.sin(math.pi * min(1.0, max(0.0, t)) ** 0.8)
        return 1.0 + 0.1 * max(0.0, 1 - (L["knee_z"] - co.z) / (L["knee_z"] - L["boot_z"]))
    radial(breeches, leg, blouse)
    # an even hem, and the skirt flares from the waist
    for v in skirt.data.vertices:
        if v.co.z < L["hem_z"] + 0.02:
            v.co.z = min(v.co.z, L["hem_z"]) if v.co.z < L["hem_z"] + 0.004 else v.co.z
    hips_c = V((0, L["hips"].y, 0))
    for v in skirt.data.vertices:
        k = max(0.0, (L["waist_z"] - v.co.z) / (L["waist_z"] - L["hem_z"]))
        d = V((v.co.x, v.co.y - hips_c.y, 0))
        v.co += d * 0.16 * k
    # flat soles
    for v in boots.data.vertices:
        if v.co.z < 0.012:
            v.co.z = 0.0
    parts = [tunic, breeches, boots, skirt]

    # fitted rings: collar, belt, cuffs, boot tops
    cloth = bvh_of(tunic, skirt)
    X, Y = V((1, 0, 0)), V((0, 1, 0))
    nz = L["neck_z"]
    neck_c = V((0, L["neck"].y + 0.004, 0))
    # a stand collar sampled on the neck alone (the jaw would catch rays higher up): it rises at the
    # back and dips at the throat
    neck_only = cut(body, "neck_probe", lambda co: nz - 0.06 < co.z < nz + 0.07 and co.y > L["head"].y - 0.02 or nz - 0.06 < co.z < nz + 0.02, "#000000")
    neck_tree = bvh_of(neck_only)
    bpy.data.objects.remove(neck_only, do_unlink=True)
    collar = []
    for k, dz in enumerate((-0.02, 0.008, 0.03)):
        ring_pts = section(neck_tree, V((neck_c.x, neck_c.y, nz + dz)), X, Y, 24, 0.2, 0.011 + 0.002 * k)
        for i, q in enumerate(ring_pts):
            front = max(0.0, -math.sin(i * TAU / 24))  # 1 at the throat (-Y)
            q.z -= front ** 2 * 0.022 * (k / 2)
        collar.append(ring_pts)
    parts.append(loft_obj("collar", collar, "#4F6F8F"))
    wz = L["waist_z"]
    belt = [section(cloth, V((0, L["hips"].y, wz + dz)), X, Y, 32, 0.4, 0.004) for dz in (-0.022, 0.0, 0.022)]
    parts.append(loft_obj("belt", belt, "#5A3E28"))
    front = section(cloth, V((0, L["hips"].y, wz)), X, Y, 4, 0.4, 0.008)[3]  # -Y is the front: angle 270 degrees
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(0.05, 0.01, 0.04), verts=bm.verts)
    bmesh.ops.translate(bm, vec=front, verts=bm.verts)
    parts.append(mesh_obj("buckle", bm, "#C9A24A"))
    for sd in "LR":
        e, w = L[f"elbow_{sd}"], L[f"wrist_{sd}"]
        ax = (w - e).normalized()
        u = ax.cross(V((0, 0, 1))).normalized()
        if u.length < 0.5:
            u = ax.orthogonal().normalized()
        vv = ax.cross(u).normalized()
        cuff = [section(bvh_of(tunic), w - ax * dt, u, vv, 16, 0.15, 0.004) for dt in (0.06, 0.02)]
        parts.append(loft_obj(f"cuff_{sd}", cuff, "#4F6F8F"))
        k, a = L[f"knee_{sd}"], L[f"ankle_{sd}"]
        t = (k.z - L["boot_z"]) / (k.z - a.z)
        c = k.lerp(a, t)
        shin = cut(boots, "shin_probe", lambda co, sx=(1 if sd == "L" else -1): co.x * sx > 0 and co.z > L["boot_z"] - 0.08, "#000000")
        tree = bvh_of(shin)
        bpy.data.objects.remove(shin, do_unlink=True)
        top = [section(tree, V((c.x, c.y, L["boot_z"] + dz)), X, Y, 20, 0.12, 0.004) for dz in (-0.006, 0.0)]
        top.append([q + V((0, 0, 0.026)) for q in top[-1]])
        parts.append(loft_obj(f"boot_top_{sd}", top, "#4A3222"))

    # the body under the uniform goes: keep the head and neck, and the hands
    keep = lambda co: co.z > nz - 0.02 or beyond_wrist(co, -0.12)
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if not all(keep(v.co) for v in f.verts)], context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(body.data)
    bm.free()
    body["color"] = "#F1C9A8"
    return parts, L


# ---------------------------------------------------------------- hair: flat curved locks
# Hair UVs land in the strand band at the top of the atlas: HAIR_COLS columns, each a lock's worth
# of painted strands (edge lines, a sheen band), root at the top of the band, tip at the bottom.
ATLAS = 2048
HAIR_V0 = 0.875
HAIR_COLS = 16
DOWN, FRONT, BACK = V((0, 0, -1)), V((0, -1, 0)), V((0, 1, 0))


class Head:
    """The skull as rays see it: a centre inside it and the distance to its surface by direction."""

    def __init__(self, body, L):
        pts = [v.co.copy() for v in body.data.vertices if v.co.z > L["head"].z + 0.02]
        lo = V((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
        hi = V((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
        self.top = hi.z
        self.c = V(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2 + 0.006, hi.z - (hi.x - lo.x) * 0.55))
        self.r = V(((hi.x - lo.x) / 2, (hi.y - lo.y) / 2, hi.z - self.c.z))
        skull = cut(body, "skull_probe", lambda co: co.z > L["neck_z"] + 0.03, "#000000")
        self.tree = bvh_of(skull)
        bpy.data.objects.remove(skull, do_unlink=True)

    def radius(self, d):
        d = d.normalized()
        hit = self.tree.ray_cast(self.c + d * 0.4, -d, 0.4)
        if hit[0] is None:
            return V((d.x * self.r.x, d.y * self.r.y, d.z * self.r.z)).length
        return (hit[0] - self.c).length

    def point(self, theta, phi, grow=0.012):
        """A point just off the head (theta round from the front, phi up from the centre's level)."""
        d = V((math.sin(theta) * math.cos(phi), -math.cos(theta) * math.cos(phi), math.sin(phi)))
        return self.c + d * (self.radius(d) + grow)

    def normal_fn(self):
        c, r = self.c + V((0, 0.005, -0.01)), self.r * 1.08
        return lambda p: V(((p.x - c.x) / r.x ** 2, (p.y - c.y) / r.y ** 2, (p.z - c.z) / r.z ** 2)).normalized()


def strand_uv(col, across, along):
    """Atlas UV in strand column `col`, across 0..1, along root 0 .. tip 1."""
    u = (col + 0.04 + 0.92 * across) / HAIR_COLS
    v = 1.0 - 0.006 - along * (1.0 - HAIR_V0 - 0.012)
    return (u, v)


class Hair:
    def __init__(self, head, piece, rng):
        self.head, self.piece, self.rng = head, piece, rng
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("atlas")
        self.locks = 0

    def loft(self, rings, uv):
        verts = [[self.bm.verts.new(V(p)) for p in r] for r in rings]
        n = len(verts[0])
        for k, (a, b) in enumerate(zip(verts, verts[1:])):
            for i in range(n):
                j = (i + 1) % n
                f = self.bm.faces.new([a[i], a[j], b[j], b[i]])
                for l, (kk, ii) in zip(f.loops, ((k, i), (k, j), (k + 1, j), (k + 1, i))):
                    l[self.uv].uv = uv(kk, ii)
        tip = verts[-1]
        self.bm.faces.new(tip)

    def cap(self, low_back=0.0, fringe=0.06, n=24):
        """A smooth shell over the top and back of the head: the base every style builds on."""
        H = self.head
        rings = []
        phis = (-0.32 - low_back, 0.0, 0.35, 0.7, 1.05, 1.38)
        fz = H.top - fringe
        for k, phi in enumerate(phis):
            pts = []
            for i in range(n + 1):
                th = math.pi + i * TAU / n
                grow = 0.006 + 0.003 * k
                p = H.point(th, phi, grow)
                if math.cos(th) > 0.3 and p.z < fz:
                    # the hairline over the forehead, laid back onto the head at its new height
                    z = fz + (p.z - fz) * 0.15
                    d = V((math.sin(th), -math.cos(th), (z - H.c.z) / max(H.r.z, 1e-3)))
                    p = H.c + d.normalized() * (H.radius(d) + grow + 0.002)
                pts.append(p)
            rings.append(pts)
        last = len(phis) - 1
        verts = [[self.bm.verts.new(p) for p in r] for r in rings]
        for k, (a, b) in enumerate(zip(verts, verts[1:])):
            for i in range(n):
                f = self.bm.faces.new([a[i], a[i + 1], b[i + 1], b[i]])
                for l, (kk, ii) in zip(f.loops, ((k, i), (k, i + 1), (k + 1, i + 1), (k + 1, i))):
                    l[self.uv].uv = strand_uv(ii * 6.0 / n, 0.5, 1.0 - kk / last)

    def lock(self, theta, phi, length, flow, width=0.03, thick=0.012, bend=0.5, twist=0.0):
        """A flat, tapering ribbon of lens-shaped sections along a curve that leaves the scalp along
        its surface, then falls in the `flow` direction as it bends."""
        H = self.head
        self.locks += 1
        root = H.point(theta, phi, 0.006)
        normal = (root - H.c).normalized()
        flow = V(flow).normalized()
        start = (flow - normal * flow.dot(normal)).normalized() if abs(flow.dot(normal)) < 0.98 else normal.orthogonal()
        p0 = root
        p1 = root + start * length * 0.45 + normal * length * 0.18
        p2 = root + start * length * (1 - bend * 0.3) + flow * length * bend * 0.6 + normal * length * 0.05
        rings, steps = [], 7
        for k in range(steps + 1):
            t = k / steps
            p = p0 * (1 - t) ** 2 + p1 * 2 * t * (1 - t) + p2 * t * t
            if p.z > H.c.z - 0.03:
                d = p - H.c
                rs = H.radius(d)
                p = H.c + d.normalized() * min(max(d.length, rs + 0.006), rs + 0.012 + 0.03 * t)
            tan = ((p1 - p0) * 2 * (1 - t) + (p2 - p1) * 2 * t).normalized()
            side = tan.cross(normal).normalized()
            if side.length < 1e-6:
                side = tan.orthogonal().normalized()
            side = Matrix.Rotation(twist * t, 3, tan) @ side
            up = side.cross(tan).normalized()
            w = width * (1 - 0.9 * t ** 1.8) * (1.0 if t > 0.05 else 0.8) + 0.0015
            th = thick * 1.2 * (1 - 0.85 * t) + 0.001
            rings.append([p + side * math.cos(i * TAU / 6) * w + up * math.sin(i * TAU / 6) * th for i in range(6)])
        col = self.locks % HAIR_COLS
        self.loft(rings, lambda k, i: strand_uv(col, 0.5 + 0.5 * math.cos(i * TAU / 6), k / steps))

    def crown(self, count=14, phi=1.05, length=0.075):
        r = self.rng
        for i in range(count):
            th = math.pi + (i / (count - 1) - 0.5) * 4.4 + r.uniform(-0.1, 0.1)
            radial = V((math.sin(th), -math.cos(th), 0.0))
            self.lock(th, phi + r.uniform(-0.08, 0.08), length * r.uniform(0.85, 1.15), radial * 0.4 + DOWN * 0.9, 0.036, 0.012, 0.75, twist=r.uniform(-0.3, 0.3))

    def object(self, color):
        # faces must face out: custom normals are kept within the hemisphere of their face's normal
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        c = self.head.c
        self.bm.normal_update()
        for f in self.bm.faces:
            if (f.calc_center_median() - c).dot(f.normal) < 0:
                f.normal_flip()
        ob = mesh_obj(self.piece, self.bm, color)
        ob["slot"], ob["piece"] = "hair", self.piece
        fn = self.head.normal_fn()
        me = ob.data
        me.normals_split_custom_set([fn(me.vertices[l.vertex_index].co) for l in me.loops])
        return ob


def build_hair(body, L, styles=(1, 2, 3, 4, 5)):
    import random
    head = Head(body, L)
    out = []
    for style in styles:
        rng = random.Random(7 + style)
        h = Hair(head, f"hair{style}", rng)
        if style == 1:
            # a shaggy, layered medium cut: fringe in points over the brow, sides over the ears, nape locks
            h.cap()
            h.crown(16, 1.0, 0.08)
            for i in range(11):
                th = -0.66 + i * 0.132 + rng.uniform(-0.03, 0.03)
                h.lock(th, 0.72 + rng.uniform(-0.05, 0.08), 0.052 + 0.03 * rng.random(), (math.sin(th) * 0.45, -0.25, -1.0), 0.028, 0.010, 0.6, twist=0.25 * (1 if th > 0 else -1))
            for sx in (1, -1):
                for i in range(5):
                    h.lock(sx * (1.0 + i * 0.22), 0.3 - i * 0.03, 0.085 + 0.01 * rng.random(), (sx * 0.25, 0.1, -1.0), 0.03, 0.011, 0.8, twist=sx * 0.2)
            for i in range(11):
                th = math.pi + (i - 5) * 0.2
                h.lock(th, 0.3, 0.1 + 0.015 * rng.random(), (math.sin(th) * 0.3, 0.35, -1.0), 0.032, 0.012, 0.75)
            for i in range(7):
                th = math.pi + (i - 3) * 0.26
                h.lock(th, -0.12, 0.06, (math.sin(th) * 0.2, 0.25, -1.0), 0.026, 0.009, 0.6)
        elif style == 2:
            # a long swept fringe, longer at the sides
            h.cap()
            h.crown(12, 1.05, 0.07)
            for i in range(11):
                h.lock(-0.75 + i * 0.15, 0.66, 0.075, (0.7, -0.3, -0.6), 0.03, 0.011, 0.55, twist=0.4)
            for sx in (1, -1):
                for i in range(6):
                    h.lock(sx * (1.25 + i * 0.22), 0.3, 0.1, (sx * 0.2, 0.2, -1.0), 0.028, 0.011, 0.85)
            for i in range(10):
                h.lock(math.pi + (i - 4.5) * 0.25, 0.45, 0.1, (0, 0.4, -0.9), 0.03, 0.012, 0.7)
        elif style == 3:
            # a chin-length bob with a straight fringe
            h.cap(low_back=0.3)
            h.crown(12, 1.05, 0.08)
            for i in range(24):
                th = math.pi * 0.32 + i * (math.pi * 1.36 / 23)
                h.lock(th, 0.35, 0.15, (math.sin(th) * 0.1, -math.cos(th) * 0.1, -1.0), 0.032, 0.012, 0.95)
            for i in range(12):
                th = -0.62 + i * 0.113 + rng.uniform(-0.03, 0.03)
                h.lock(th, 0.68 + rng.uniform(-0.04, 0.06), 0.046 + 0.024 * rng.random(), (math.sin(th) * 0.3, -0.35, -1), 0.026, 0.010, 0.8)
        elif style == 4:
            # tied back in a ponytail, a few strands framing the face
            h.cap(low_back=0.1)
            h.crown(10, 1.1, 0.06)
            for i in range(8):
                h.lock(-0.5 + i * 0.14, 0.66, 0.055, (0, 0.5, -0.4), 0.026, 0.010, 0.4)
            for sx in (1, -1):
                h.lock(sx * 0.85, 0.35, 0.13, (sx * 0.1, -0.2, -1), 0.016, 0.008, 0.95)
            tie = head.point(math.pi, 0.35, 0.012)
            for k in range(5):
                a = k * TAU / 5
                base = tie + V((math.cos(a) * 0.01, 0.012, math.sin(a) * 0.01))
                rings = [[base + off + V((math.cos(i * TAU / 7) * r, 0, math.sin(i * TAU / 7) * r * 0.8)) for i in range(7)]
                         for off, r in ((V((0, 0, 0)), 0.02), (V((0, 0.05, -0.08)), 0.018), (V((0, 0.07, -0.2)), 0.012), (V((0, 0.06, -0.28)), 0.002))]
                h.loft(rings, lambda r_, i, col=k + 2: strand_uv(col, 0.5 + 0.5 * math.cos(i * TAU / 7), r_ / 3))
        elif style == 5:
            # close crop (also what shows under a helmet)
            h.cap(fringe=0.045)
        out.append(h.object("#6B4A32"))
        print("HAIR", style, h.locks, "locks")
    return out, head


# ---------------------------------------------------------------- details, assembly
KIT = ["base", "pouches", "pack_small", "mags", "plate", "armor", "tubes", "pack_engineer", "tools", "goggles"]
PIECE = {"always": 0, **{f"hair{k}": k for k in range(1, 6)}, "helm_fed": 6, "helm_imp": 7,
         **{f"kit_{k}": 10 + i for i, k in enumerate(KIT)}, "face": 30}
SLOT = {"keep": 0, "skin": 1, "hair": 2, "tunic": 3, "scarf": 4, "pants": 5, "boots": 6, "helmet": 7, "iris": 8, "glove": 9}
WHITE = "#FFFFFF"


def tag(ob, slot, piece="always", color=None):
    ob["slot"], ob["piece"] = slot, piece
    if color:
        ob["color"] = color
    return ob


def sphere_obj(name, c, r, color, segs=10, rings=6):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=1.0)
    bmesh.ops.scale(bm, vec=r, verts=bm.verts)
    bmesh.ops.translate(bm, vec=c, verts=bm.verts)
    return mesh_obj(name, bm, color)


def details(parts, L, body):
    """Buttons down the placket, a neckerchief knot at the throat, all laid on the cloth by rays."""
    tunic = next(o for o in parts if o.name == "tunic")
    tree = bvh_of(tunic)
    out = []
    for k in range(4):
        z = L["neck_z"] - 0.06 - k * (L["neck_z"] - 0.06 - L["waist_z"] - 0.04) / 3
        hit = tree.ray_cast(V((0.012, -0.5, z)), V((0, 1, 0)), 1.0)
        if hit[0] is not None:
            out.append(tag(sphere_obj(f"button{k}", hit[0] + V((0, -0.002, 0)), (0.0065, 0.0035, 0.0065), "#C9A24A", 8, 5), "keep"))
    hit = tree.ray_cast(V((0.0, -0.5, L["neck_z"] - 0.012)), V((0, 1, 0)), 1.0)
    if hit[0] is not None:
        c = hit[0] + V((0.004, -0.008, 0))
        out.append(tag(sphere_obj("kerchief_knot", c, (0.016, 0.01, 0.014), WHITE, 10, 6), "scarf"))
        for k, dx in enumerate((0.012, -0.008)):
            rings = [[c + off + V((math.cos(i * TAU / 8) * w, math.sin(i * TAU / 8) * 0.003, 0)) for i in range(8)]
                     for off, w in ((V((dx * 0.3, -0.004, -0.01)), 0.012), (V((dx, -0.008, -0.05)), 0.015), (V((dx * 1.5, -0.008, -0.085)), 0.004))]
            out.append(tag(loft_obj(f"kerchief_tail{k}", rings, WHITE), "scarf"))
    return out


def face_frame(body):
    """Eye and mouth positions on the rest pose (Blender x / z): the game maps its painted face
    (src/skirmish/units/facePainter.js, laid out for eyes at z 1.594 and x 0.0335, the mouth at
    z 1.5305) onto them."""
    gi = body.vertex_groups["lips"].index
    lips = [v.co for v in body.data.vertices if any(g.group == gi and g.weight > 0.5 for g in v.groups)]
    mouth_z = sum(p.z for p in lips) / max(1, len(lips))
    e = EYES[0]
    return {"eyeX": round(abs(e.x), 5), "eyeZ": round(e.z, 5), "mouthZ": round(mouth_z, 5)}


def assemble(rig, body, source, parts, hairs, L, head):
    """Vertex colours, meta UVs and atlas UV layers on every part; weights for the parts copied from
    the full body; custom normals that light the face and hair like smooth shells; one mesh."""
    tag(body, "skin", "face", WHITE)
    objs = [body, *parts, *hairs]
    print("  asm layers")
    face_n = head.normal_fn()
    for ob in objs:
        me = ob.data
        if "atlas" not in me.uv_layers:
            me.uv_layers.new(name="atlas")
        meta = me.uv_layers.new(name="meta")
        ca = me.color_attributes.new("Col", "BYTE_COLOR", "CORNER")
        h = ob.get("color", WHITE).lstrip("#")
        col = [(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)] + [1.0]
        slot = SLOT[ob.get("slot", "keep")]
        piece = PIECE[ob.get("piece", "always")]
        for poly in me.polygons:
            for li in poly.loop_indices:
                ca.data[li].color = col if slot == 0 else [1.0, 1.0, 1.0, 1.0]
                meta.data[li].uv = (slot + 0.5, piece + 0.5)
    # the body: hands are the gloves' slot; only the head is the face piece; the face lights flat
    me = body.data
    meta = me.uv_layers["meta"].data
    head_z = L["neck_z"] + 0.03
    for poly in me.polygons:
        c = poly.center
        if c.z < L["neck_z"] - 0.05:
            sl, pc = SLOT["glove"], PIECE["always"]
        elif c.z < head_z:
            sl, pc = SLOT["skin"], PIECE["always"]
        else:
            sl, pc = SLOT["skin"], PIECE["face"]
        for li in poly.loop_indices:
            meta[li].uv = (sl + 0.5, pc + 0.5)
    normals = []
    for l in me.loops:
        v = me.vertices[l.vertex_index]
        n = v.normal.copy()
        if v.co.z > head_z and v.co.y < head.c.y:
            k = min(1.0, (v.co.z - head_z) / 0.04) * 0.75
            n = n.lerp(face_n(v.co), k).normalized()
        normals.append(n)
    print("  asm normals")
    me.normals_split_custom_set(normals)
    print("  asm weights")
    # weights: everything but the body copies the full body's weights from the nearest surface
    names = [b.name for b in rig.data.bones]
    for ob in objs[1:]:
        for n in names:
            if n not in ob.vertex_groups:
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
        arm = ob.modifiers.new("Armature", "ARMATURE")
        arm.object = rig
    print("  asm join")
    # only "atlas" (TEXCOORD_0) and "meta" (TEXCOORD_1): MPFB's own UV map would push them along
    for ob in objs:
        for lay in [l for l in ob.data.uv_layers if l.name not in ("atlas", "meta")]:
            ob.data.uv_layers.remove(lay)
    select_only(*objs, active=body)
    bpy.ops.object.join()
    print("  asm joined")
    body.name = body.data.name = "soldier"
    extra = [g.name for g in body.vertex_groups if g.name not in names]
    for n in extra:
        body.vertex_groups.remove(body.vertex_groups[n])
    print("  asm groups", len(extra), "removed")
    select_only(body)
    bpy.ops.object.vertex_group_limit_total(limit=4)
    print("  asm limited")
    # normalise by hand (vertex_group_normalize_all crashes Blender 5.1 on this mesh)
    orphans = 0
    head_g = body.vertex_groups["head"].index
    for v in body.data.vertices:
        total = sum(g.weight for g in v.groups)
        if total > 1e-6:
            for g in v.groups:
                g.weight /= total
        else:
            orphans += 1
            body.vertex_groups[head_g].add([v.index], 1.0, "REPLACE") if v.co.z > 1.3 else None
    print("  asm normalised;", orphans, "unweighted vertices")
    body.parent = rig
    m = bpy.data.materials.get("M_soldier") or bpy.data.materials.new("M_soldier")
    body.data.materials.clear()
    body.data.materials.append(m)
    return body


def far_model(body):
    """The far model: the close one decimated (keeps UVs, slots and weights well enough at 24 m+)."""
    far = body.copy()
    far.data = body.data.copy()
    far.name = far.data.name = "soldier_lod1"
    COL.objects.link(far)
    mod = far.modifiers.new("dec", "DECIMATE")
    mod.ratio = 0.3
    select_only(far)
    bpy.ops.object.modifier_apply(modifier="dec")
    return far


# ---------------------------------------------------------------- the painted atlas
def meta_of(me):
    lay = me.uv_layers["meta"].data
    return [(int(lay[p.loop_start].uv[0]), int(lay[p.loop_start].uv[1])) for p in me.polygons]


def atlas_unwrap(ob):
    """Smart-project every face but the hair (it has strand UVs) into the atlas below the hair band."""
    me = ob.data
    meta = meta_of(me)
    me.uv_layers.active = me.uv_layers["atlas"]
    select_only(ob)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_mode(type="FACE")
    bm = bmesh.from_edit_mesh(me)
    bm.faces.ensure_lookup_table()
    for f, (slot, _) in zip(bm.faces, meta):
        f.select_set(slot != SLOT["hair"])
    bmesh.update_edit_mesh(me)
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.003, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    lay = me.uv_layers["atlas"].data
    for poly, (slot, _) in zip(me.polygons, meta):
        if slot == SLOT["hair"]:
            continue
        for li in poly.loop_indices:
            u, v = lay[li].uv
            lay[li].uv = (u, v * (HAIR_V0 - 0.005))


def bake_copy(src, keep, name):
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
    ob.parent = None
    return ob


def bake_maps(src, samples=32):
    """Occlusion, position, normal and (slot, piece) baked into float images over the atlas islands."""
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
    is_hair = lambda p: 1 <= p <= 5
    pieces = sorted({p for _, p in meta_of(src.data)})
    objs = {"all": bake_copy(src, lambda p: not is_hair(p), "bake_all"), "base": bake_copy(src, lambda p: p in (0, 30), "bake_base")}
    for p_ in pieces:
        if p_ not in (0, 30) and not is_hair(p_):
            objs[p_] = bake_copy(src, lambda q, p_=p_: q == p_, f"bake_{p_}")
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


def paint_atlas(maps, L):
    """The atlas pixels from the baked maps. Seams, folds and piping are placed by the landmarks."""
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
    nz, wz, hz, kz, bz, hem = (L[k] for k in ("neck_z", "waist_z", "hip_z", "knee_z", "boot_z", "hem_z"))
    cy = L["chest"].y
    sx = L["shoulder_L"].x
    # occlusion: a soft painted shadow, contact lines, pencil hatching in the hollows
    shade *= 0.62 + 0.38 * sm(0.15, 0.85, ao)
    ink = add(True, 0.5 * (1 - sm(0.1, 0.3, ao)))
    tri = np.abs(np.mod((px + py) / 7.0, 1.0) - 0.5) * 2
    ink = add(~SK, np.clip((0.3 - tri) / 0.15, 0, 1) * np.clip((0.62 - ao) / 0.3, 0, 1) * 0.32)
    # watercolour mottling and grain, light painted from above
    shade *= 1 + 0.12 * (fbm(P, 9.0, 3) - 0.5) + 0.05 * (vnoise(P, 140.0, 5) - 0.5)
    shade *= (0.93 + 0.09 * np.clip(N[:, 2], 0, 1)) * (1 - 0.07 * np.clip(-N[:, 2], 0, 1))
    shade *= np.where(T, 1 - 0.07 * np.clip((nz - z) / 0.5, 0, 1), 1.0)
    torso = T & (ax < sx - 0.02) & (z > hem) & (z < nz)
    arm = T & (ax > sx)
    # tunic seams: sides, centre back, the shoulders, armholes, the back of the sleeves
    ink = add(torso & (ax > 0.09) & (z < L["shoulder_L"].z - 0.06), 0.55 * line(y - cy))
    ink = add(torso & (y > cy + 0.03), 0.5 * line(x))
    sh = np.sqrt((ax - sx) ** 2 + (y - L["shoulder_L"].y) ** 2 + (z - L["shoulder_L"].z) ** 2)
    ink = add(T & (z > L["shoulder_L"].z - 0.12), 0.5 * line(sh - 0.075))
    # the front placket and its stitching, breast pockets with flaps
    front = T & (y < cy - 0.05) & (z > wz) & (z < nz - 0.02)
    ink = add(front, 0.6 * np.maximum(line(x - 0.026), line(x + 0.002)))
    ink = add(front, 0.4 * line(x - 0.031, 0.0004) * dash(z))
    pz = L["shoulder_L"].z - 0.1
    pocket = T & (y < cy - 0.05) & (np.abs(z - pz) < 0.05) & (ax > 0.03) & (ax < 0.12)
    d = np.maximum(np.abs(ax - 0.075) - 0.03, np.abs(z - pz) - 0.036)
    ink = add(pocket, 0.55 * line(d))
    ink = add(pocket, 0.5 * line(z - pz - 0.016 + 0.25 * np.maximum(0, 0.03 - np.abs(ax - 0.075))))
    ink = add(pocket, 0.35 * line(d + 0.004, 0.0004) * dash(x + z))
    # elbow creases
    for sd in "LR":
        e = L[f"elbow_{sd}"]
        r = np.sqrt((x - e.x) ** 2 + (y - e.y) ** 2 + (z - e.z) ** 2)
        ink = add(arm & (r < 0.06), 0.35 * np.maximum(line(r - 0.03), line(r - 0.045)) * (1 - sm(0.04, 0.06, r)))
    # piping in the faction's trim: the skirt's hem, the collar's top, the cuffs
    skirt = T & (z < wz - 0.03) & (ax < sx)
    trim = np.maximum(trim, np.where(skirt, sm(hem + 0.014, hem + 0.011, z), 0.0))
    ink = add(skirt, 0.5 * line(z - hem - 0.0125, 0.0005))
    collar = T & (z > nz - 0.03) & (ax < 0.09)
    trim = np.maximum(trim, np.where(collar, sm(nz + 0.026, nz + 0.03, z), 0.0))
    for sd in "LR":
        w_ = L[f"wrist_{sd}"]
        r = np.sqrt((x - w_.x) ** 2 + (y - w_.y) ** 2 + (z - w_.z) ** 2)
        cuff = T & (r < 0.08) & (ax > sx)
        trim = np.maximum(trim, np.where(cuff & (r < 0.07), 1.0, 0.0))
    # breeches: the outer seam, folds behind the knee and over the boots
    for sd, s_ in (("L", 1), ("R", -1)):
        hp = L[f"hip_{sd}"]
        out_ = PA & (x * s_ > 0) & (np.abs(x - hp.x) > 0.06)
        ink = add(out_ & (z > bz), 0.45 * line(y - hp.y))
    knee = PA & (y > L["knee_L"].y) & (np.abs(z - kz) < 0.05)
    ink = add(knee, 0.35 * np.maximum(line(z - kz - 0.012), line(z - kz + 0.014)))
    for h_ in (bz + 0.02, bz + 0.035):
        ink = add(PA & (z < bz + 0.06), 0.4 * line(z - h_ - 0.004 * np.sin(np.arctan2(y, x) * 5), 0.0005))
    # boots: a dark sole and its line, the toe cap, laces up the front, the top edge
    shade *= np.where(BO & (z < 0.028), 0.68, 1.0)
    ink = add(BO, 0.6 * line(z - 0.03, 0.0006))
    ink = add(BO & (y < L["toe_L"].y + 0.02), 0.45 * line(y - L["toe_L"].y + 0.03 + (z - 0.04) * 0.4))
    ink = add(BO & (z > bz - 0.01), 0.45 * line(z - bz - 0.004))
    lace = BO & (y < -0.02) & (z > L["ankle_z"] + 0.03) & (z < bz - 0.02)
    for sd in "LR":
        a_ = L[f"ankle_{sd}"]
        u = x - a_.x
        ink = add(lace & (np.abs(u) < 0.016), 0.45 * line(np.abs(np.mod(z / 0.018, 1.0) - 0.5) * 0.018 - np.abs(u) * 0.55, 0.0006))
    # gloves: a seam over the knuckles; the scarf's folds
    ink = add(GL & (z < L["wrist_L"].z - 0.04), 0.3 * line(np.sin(np.arctan2(y, x) * 7) * 0.003, 0.0005))
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
    """Strands in each lock column: darker roots and edges, pencil strand lines, a sheen band."""
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


def export(path, rig, meshes):
    # every action on its own NLA track, so the exporter writes one animation per clip
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
                              export_vertex_color="ACTIVE", export_all_vertex_colors=False, export_texcoords=True,
                              export_normals=True, export_cameras=False, export_lights=False)


# ---------------------------------------------------------------- animation: retarget from UAL
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


def reference_pose(src, rig):
    """World rotations of the rig posed like the source's rest (a T-pose): each mapped bone turned,
    after its parent's turn, so it points the way its source bone points."""
    inv = {t: s for s, t in BONE_MAP.items()}
    ref = {}
    for b in hierarchy(rig):
        rest = world_rest(rig, b).to_quaternion()
        if b.parent is not None:
            p = b.parent
            rest = (ref[p.name] @ world_rest(rig, p).to_quaternion().inverted()) @ rest
        sname = inv.get(b.name)
        if sname and sname in src.data.bones:
            sb = src.data.bones[sname]
            want = ((src.matrix_world @ sb.tail_local) - (src.matrix_world @ sb.head_local)).normalized()
            have = rest @ V((0, 1, 0))
            rest = have.rotation_difference(want) @ rest
        ref[b.name] = rest
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
    hips_s0 = (src.matrix_world @ src.data.bones["DEF-hips"].head_local)
    hips_t0 = (rig.matrix_world @ rig.data.bones["hips"].head_local)
    leg = lambda arm, a, b: ((arm.matrix_world @ arm.data.bones[a].head_local) - (arm.matrix_world @ arm.data.bones[b].head_local)).length
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
                # location is in the bone's rest frame (relative to its rest head), unscaled by the armature
                rest_w = rig.matrix_world @ b.matrix_local
                pb.location = rest_w.to_3x3().inverted() @ (want - hips_t0)
                pb.keyframe_insert("location", frame=f - f0)
        foot.append((src.matrix_world @ src.pose.bones["DEF-foot.L"].head).y * k_leg)
    src.animation_data.action = None
    for fc in out.fcurves if hasattr(out, "fcurves") else []:
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"
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
    actions = {}
    for name, (clip, loop) in CLIPS.items():
        actions[name] = retarget(src, rig, ref, clip, name, loop)
    bpy.data.objects.remove(src, do_unlink=True)
    return actions


# ---------------------------------------------------------------- previews
def preview(tag, objects, views=(("front", 0), ("side", 90), ("three", 35)), size=(700, 1000), ortho=2.0, focus=None):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.show_cavity = True
    scene.render.resolution_x, scene.render.resolution_y = size
    for o in bpy.data.objects:
        o.hide_render = o not in objects and o.type != "CAMERA"
        if o.type == "MESH" and "color" in o and not o.data.materials:
            m = bpy.data.materials.new(o.name)
            h = o["color"].lstrip("#")
            m.diffuse_color = [((int(h[i:i + 2], 16) / 255) ** 2.2) for i in (0, 2, 4)] + [1.0]
            o.data.materials.append(m)
    cam = bpy.data.objects.get("preview_cam") or bpy.data.objects.new("preview_cam", bpy.data.cameras.new("preview_cam"))
    if cam.name not in COL.objects:
        COL.objects.link(cam)
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = ortho
    scene.camera = cam
    c = focus or V((0, 0, 0.92))
    for name, deg in views:
        a = math.radians(deg)
        cam.location = c + V((math.sin(a) * 6, -math.cos(a) * 6, 0))
        cam.rotation_euler = (math.radians(90), 0, a)
        scene.render.filepath = os.path.join(PREVIEW, f"{tag}_{name}.png")
        bpy.ops.render.render(write_still=True)


def main():
    body, rig, helpers = build_body()
    print("BODY", len(body.data.vertices), "verts", len(body.data.polygons), "faces", "height", round(body.dimensions.z, 3), "rig matrix", [list(map(lambda x: round(x, 3), r)) for r in rig.matrix_world])
    print("BONES", [b.name for b in rig.data.bones if not any(f in b.name for f in ("index", "middle", "ring", "pinky", "thumb"))])
    if STAGE == "body":
        if PREVIEW:
            preview("body", [body])
            preview("helpers", [body, *helpers.values()])
            head = rig.matrix_world @ rig.data.bones["head"].head_local
            preview("head", [body], views=(("front", 0), ("side", 90), ("three", 30)), size=(700, 700), ortho=0.36, focus=head + V((0, 0, 0.1)))
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(PREVIEW or ".", "soldier_v4_body.blend"))
        return
    if STAGE == "dress":
        source = body.copy()
        source.data = body.data.copy()
        parts, L = dress(body, rig, helpers)
        tris = sum(len(p.vertices) - 2 for o in [body, *parts] for p in o.data.polygons)
        print("DRESS", len(parts), "parts", tris, "triangles")
        if PREVIEW:
            preview("dress", [body, *parts])
            head = L["head"]
            preview("dress_head", [body, *parts], views=(("front", 0), ("three", 30)), size=(700, 700), ortho=0.5, focus=head + V((0, 0, 0.0)))
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(PREVIEW or ".", "soldier_v4_dress.blend"))
        return
    if STAGE == "hair":
        parts, L = dress(body, rig, helpers)
        hairs, head = build_hair(body, L)
        if PREVIEW:
            for hh in hairs:
                preview(f"hair_{hh.name}", [body, *parts, hh], views=(("front", 0), ("three", 35), ("back", 180)), size=(600, 600), ortho=0.42, focus=head.c + V((0, 0, -0.03)))
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(PREVIEW or ".", "soldier_v4_hair.blend"))
        return
    if STAGE is None:
        print("STEP dress")
        source = body.copy()
        source.data = body.data.copy()
        COL.objects.link(source)
        parts, L = dress(body, rig, helpers)
        parts += details(parts, L, body)
        for o in parts:
            if "slot" not in o:
                n = o.name
                o["slot"] = "pants" if n == "breeches" else "boots" if n.startswith("boot") else "keep" if n in ("belt", "buckle") else "tunic"
                if o["slot"] != "keep":
                    o["color"] = WHITE
        print("STEP hair")
        hairs, head = build_hair(body, L)
        for o in helpers.values():
            bpy.data.objects.remove(o, do_unlink=True)
        frame = face_frame(body)
        print("STEP assemble")
        model = assemble(rig, body, source, parts, hairs, L, head)
        bpy.data.objects.remove(source, do_unlink=True)
        model["face"] = frame
        print("STEP unwrap")
        atlas_unwrap(model)
        print("STEP far")
        far = far_model(model)
        far["face"] = frame
        atlas = arg("--atlas")
        if atlas:
            print("STEP bake")
            save_atlas(paint_atlas(bake_maps(model), L), atlas)
        print("STEP actions")
        build_actions(rig)
        tris = lambda o: sum(len(p.vertices) - 2 for p in o.data.polygons)
        print(f"SOLDIER close {tris(model)} triangles, far {tris(far)}; face {frame}")
        if OUT:
            export(OUT, rig, [model, far])
            print("EXPORTED", OUT)
        return
    actions = build_actions(rig)
    if STAGE == "anim":
        if PREVIEW:
            for name, (frac) in (("idle", 0.3), ("walk", 0.25), ("run", 0.3), ("crouch", 0.5), ("kneel", 0.5), ("fall_back", 1.0)):
                act = actions[name]
                rig.animation_data.action = act
                bpy.context.scene.frame_set(int(act.frame_range[1] * frac))
                preview(f"anim_{name}", [body], views=(("three", 35), ("side", 90)), size=(500, 700))
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(PREVIEW or ".", "soldier_v4_anim.blend"))
        return


main()
