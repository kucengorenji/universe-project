"""Skirmish soldier, faceted low-poly: the office townsfolk (docs/art-direction/npc-v1/blender/office_faceted.py)
re-dressed as a 1930s infantryman, after the look of Valkyria Chronicles: a buttoned field tunic with a
stand collar and breast pockets, a scarf, webbing with ammo pouches, trousers bloused into puttees
and ankle boots, and a steel helmet.

The rig, head, expressions, hands and legs are the office model's, so the runtime contract of
src/modes/town/people/chunkyPeople.js holds (23 pivots, palette slots by material name, optional
pieces by mesh name). Variants live side by side in one file and the game keeps one per soldier:
  - hat_fed_helmet / hat_imp_helmet    one per faction (piece 3, the "cap" slot colours it)
  - kit_<tag>_*                        class gear; src/skirmish/units/soldiers.js keeps the tags
                                       a class lists (pouches, pack, tools, armor, goggles, tubes)
  - tie_scarf_*                        the scarf (piece 6, the "tie" slot colours it)
Weapons are separate assets (military_kit.py), held at the wrist in code.

Run:  Blender -b --factory-startup --python soldier_faceted.py -- <out.glb>
"""
import math
import os
import sys

import bpy
from mathutils import Vector as V

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "..", "docs", "art-direction", "npc-v1", "blender"))
import office_faceted as O  # noqa: E402  (shares the collection, rig and helpers)

Part, ring, oring, boxpts, mat, emp = O.Part, O.ring, O.oring, O.boxpts, O.mat, O.emp
EL, WR, AN, SH = O.EL, O.WR, O.AN, O.SH
CHEST_Z, BALL_Y = O.CHEST_Z, O.BALL_Y

# Authoring colours (the player faction); the game recolours the slotted materials per faction
PAL = {
    "tunic": "#4F6F8F", "tunic_fold": "#3F5A75", "pants": "#3D4F63", "helmet": "#55705A",
    "scarf": "#C8A23A", "web": "#B49A6A", "web_dark": "#8A744C", "pouch": "#9C8558", "pack": "#6E6A4A",
    "boot": "#4A3222", "sole": "#241A14", "puttee": "#6B6250", "metal": "#5A5E62", "brass": "#B08A3C",
    "wood": "#7A5233", "armor": "#6E7C86", "lens": "#2C3A44",
}


def remove(prefixes):
    for name in [n for n in O.objs if n.startswith(prefixes)]:
        o = O.objs.pop(name)
        bpy.data.objects.remove(o, do_unlink=True)


# ---------------------------------------------------------------- tunic
def tunic(z):
    """(half width, front, back) of the field tunic at height z: the shirt grown for wool, a skirt over the hips."""
    keys = [(0.80, 0.160, -0.104, 0.104), (0.88, 0.156, -0.106, 0.100), (0.95, 0.150, -0.108, 0.100),
            (1.00, 0.152, -0.110, 0.100), (1.15, 0.156, -0.114, 0.102), (1.26, 0.166, -0.116, 0.106),
            (1.340, 0.170, -0.104, 0.104), (1.392, 0.104, -0.064, 0.074)]
    for a, b in zip(keys, keys[1:]):
        if a[0] <= z <= b[0]:
            t = (z - a[0]) / (b[0] - a[0])
            return tuple(a[i] + (b[i] - a[i]) * t for i in (1, 2, 3))
    return keys[-1][1:] if z > keys[-1][0] else keys[0][1:]


def build_tunic():
    cloth = mat("M_shirt", PAL["tunic"], 0.9)
    fold = mat("M_shirt_fold", PAL["tunic_fold"], 0.9)
    brass = mat("M_brass", PAL["brass"], 0.4)
    scarf = mat("M_tie", PAL["scarf"], 0.8)

    ZS = (0.80, 0.88, 0.95, 1.00, 1.15, 1.26, 1.340, 1.392)
    # skirt on the hips, waist on the spine, chest on the chest: overlapping so twists never gape
    spans = (("skirt", "hips", (0.80, 0.97)), ("waist", "spine", (0.94, CHEST_Z + 0.035)), ("chest", "chest", (CHEST_Z - 0.035, 1.392)))
    for name, bone, (lo, hi) in spans:
        zs = [lo] + [z for z in ZS if lo < z < hi] + [hi]
        p = Part(f"top_tunic_{name}", bone, cloth)
        p.rings(*[ring(0, 0.0, z, *tunic(z)) for z in zs])
        if name == "skirt":
            # the skirt flares a little at the hem
            p.rings(ring(0, 0.0, 0.80, 0.166, -0.110, 0.110), ring(0, 0.0, 0.83, 0.160, -0.106, 0.106))
        if name == "chest":
            # stand collar, closed at the throat
            p.rings(oring(0, 0.010, 1.375, 0.060, n=10, sy=0.92), oring(0, 0.012, 1.428, 0.056, n=10, sy=0.92))
            # epaulettes on the shoulders
            for sx in (1, -1):
                p.box((sx * 0.120, 0.004, 1.366), (0.090, 0.050, 0.016), rot=(0, sx * -14, 0))
        p.done()

        # front placket with brass buttons
        p = Part(f"top_tunic_placket_{name}", bone, fold)
        z0, z1 = max(lo, 0.82), min(hi, 1.37)
        if z1 > z0:
            _, f0, _ = tunic(z0)
            _, f1, _ = tunic(z1)
            p.hull([(x, f + d, z) for x in (-0.012, 0.012) for z, f in ((z0, f0), (z1, f1)) for d in (-0.005, 0.010)])
        p.done()
        p = Part(f"top_tunic_buttons_{name}", bone, brass)
        for z in (1.33, 1.22, 1.11, 1.00, 0.89):
            if not (lo + 0.01 < z < hi - 0.01) or (bone == "spine" and z > CHEST_Z) or (bone == "chest" and z < CHEST_Z):
                continue
            _, f, _ = tunic(z)
            p.hull(oring(0, f - 0.006, z - 0.002, 0.008, n=6) + oring(0, f - 0.010, z + 0.002, 0.007, n=6))
        p.done()

    # breast pockets with flaps (chest), hip pockets (skirt)
    p = Part("top_tunic_pockets", "chest", fold)
    for sx in (1, -1):
        _, f, _ = tunic(1.24)
        p.box((sx * 0.072, f - 0.004, 1.228), (0.066, 0.012, 0.078))
        p.box((sx * 0.072, f - 0.010, 1.272), (0.072, 0.012, 0.024), rot=(-8, 0, 0))
    p.done()
    p = Part("top_tunic_hip_pockets", "hips", fold)
    for sx in (1, -1):
        _, f, _ = tunic(0.86)
        p.box((sx * 0.090, f - 0.004, 0.862), (0.074, 0.012, 0.080), rot=(0, 0, sx * -4))
    p.done()

    # the scarf (optional piece): a loose knot at the throat, one tail down the chest
    p = Part("tie_scarf_knot", "chest", scarf)
    p.rings(oring(0, 0.012, 1.384, 0.068, n=10, sy=0.94), oring(0, 0.014, 1.414, 0.064, n=10, sy=0.94))
    _, f, _ = tunic(1.33)
    p.hull(boxpts((0.020, f - 0.040, 1.356), (0.050, 0.030, 0.044), rot=(0, 18, 0)))
    p.hull(boxpts((0.024, f - 0.030, 1.346), (0.040, 0.016, 0.020)) + boxpts((0.044, f - 0.022, 1.228), (0.050, 0.012, 0.016), rot=(0, -8, 0)))
    p.done()

    for side, sx in (("L", 1), ("R", -1)):
        # full sleeves: upper on the shoulder, lower on the elbow, a turned-back cuff at the wrist
        p = Part(f"top_tunic_sleeve_{side}", f"shoulder_{side}", cloth)
        p.rings(oring(sx * 0.150, 0.010, 1.382, 0.046, rot=math.pi / 8),
                oring(sx * 0.176, 0.012, 1.325, 0.064, rot=math.pi / 8),
                oring(sx * 0.184, 0.018, 1.20, 0.060, rot=math.pi / 8),
                oring(sx * EL["x"], 0.022, 1.090, 0.056, rot=math.pi / 8))
        p.done()
        p = Part(f"top_tunic_forearm_{side}", f"elbow_{side}", cloth)
        p.rings(oring(sx * EL["x"], 0.022, 1.112, 0.054, rot=math.pi / 8),
                oring(sx * EL["x"], 0.022, 1.075, 0.056, rot=math.pi / 8),
                oring(sx * 0.193, 0.016, 0.960, 0.050, sy=1.06, rot=math.pi / 8),
                oring(sx * 0.197, 0.008, 0.858, 0.044, sy=1.10, rot=math.pi / 8))
        p.done()
        p = Part(f"top_tunic_cuff_{side}", f"elbow_{side}", fold)
        p.rings(oring(sx * 0.197, 0.008, 0.880, 0.047, sy=1.10, rot=math.pi / 8), oring(sx * 0.198, 0.006, 0.836, 0.046, sy=1.12, rot=math.pi / 8))
        p.done()


# ---------------------------------------------------------------- webbing + class kit
def build_webbing():
    web = mat("M_webbing", PAL["web"], 0.85)
    dark = mat("M_webbing_dark", PAL["web_dark"], 0.85)
    pouch = mat("M_pouch", PAL["pouch"], 0.85)
    brass = mat("M_brass", PAL["brass"], 0.4)
    metal = mat("M_metal", PAL["metal"], 0.45)
    pack = mat("M_pack", PAL["pack"], 0.9)
    wood = mat("M_wood", PAL["wood"], 0.8)
    armor = mat("M_armor", PAL["armor"], 0.5)
    lens = mat("M_lens", PAL["lens"], 0.2)

    # waist belt over the tunic, with a plate buckle
    p = Part("kit_base_belt", "spine", web)
    p.rings(ring(0, 0.0, 0.945, 0.160, -0.118, 0.110), ring(0, 0.0, 0.990, 0.158, -0.118, 0.108))
    p.done()
    p = Part("kit_base_buckle", "spine", brass)
    p.box((0, -0.122, 0.968), (0.050, 0.010, 0.040))
    p.done()
    # Y-straps over the shoulders, crossing at the back
    p = Part("kit_base_straps", "chest", dark)
    for sx in (1, -1):
        for zf, zt in ((0.99, 1.18), (1.18, 1.36)):
            _, ff, _ = tunic(zf)
            _, ft, _ = tunic(zt)
            p.hull(boxpts((sx * 0.090, ff - 0.006, zf), (0.030, 0.010, 0.02)) + boxpts((sx * 0.100, ft - 0.006, zt), (0.030, 0.010, 0.02)))
        p.hull(boxpts((sx * 0.100, -0.080, 1.37), (0.032, 0.012, 0.02)) + boxpts((sx * 0.100, 0.070, 1.37), (0.032, 0.012, 0.02)))
        p.hull(boxpts((sx * 0.100, 0.108, 1.36), (0.030, 0.010, 0.02)) + boxpts((0.0, 0.112, 1.16), (0.030, 0.010, 0.02)))
    p.hull(boxpts((0.0, 0.112, 1.16), (0.030, 0.010, 0.02)) + boxpts((0.0, 0.112, 0.99), (0.030, 0.010, 0.02)))
    p.done()

    # ammo pouches, two each side of the buckle (riflemen)
    p = Part("kit_pouches_front", "spine", pouch)
    for x in (0.050, 0.104):
        for sx in (1, -1):
            p.box((sx * x, -0.128, 0.960), (0.048, 0.034, 0.060))
            p.box((sx * x, -0.132, 0.995), (0.052, 0.040, 0.014), rot=(-10, 0, 0))
    p.done()
    # SMG magazine pouches: long, upright, on the chest
    p = Part("kit_mags_chest", "chest", pouch)
    for sx in (1, -1):
        _, f, _ = tunic(1.20)
        for dx in (0.0, 0.032):
            p.box((sx * (0.060 + dx), f - 0.020, 1.180), (0.028, 0.026, 0.120))
    p.done()
    # canteen and entrenching tool at the back of the belt (everyone)
    p = Part("kit_base_canteen", "spine", metal)
    p.hull(oring(-0.140, 0.060, 0.900, 0.042, n=8, sx=0.6) + oring(-0.140, 0.060, 0.980, 0.040, n=8, sx=0.6))
    p.done()

    # small pack high on the back
    p = Part("kit_pack_small", "chest", pack)
    p.box((0, 0.150, 1.200), (0.220, 0.090, 0.200))
    p.box((0, 0.156, 1.300), (0.226, 0.100, 0.030), rot=(-8, 0, 0))
    p.hull(oring(0, 0.160, 1.330, 0.040, n=8, sx=2.4, sy=0.9) + oring(0, 0.160, 1.350, 0.036, n=8, sx=2.4, sy=0.9))  # rolled blanket
    p.done()
    # engineer: big pack with a toolbox and a shovel across it
    p = Part("kit_pack_engineer", "chest", pack)
    p.box((0, 0.170, 1.180), (0.260, 0.130, 0.270))
    p.box((0, 0.176, 1.322), (0.270, 0.140, 0.030), rot=(-6, 0, 0))
    p.done()
    p = Part("kit_tools_engineer", "chest", metal)
    p.box((0.0, 0.250, 1.080), (0.200, 0.050, 0.080))  # toolbox
    p.hull(boxpts((-0.130, 0.250, 1.420), (0.012, 0.012, 0.012)) + boxpts((0.110, 0.250, 1.060), (0.012, 0.012, 0.012)))  # pick
    p.done()
    p = Part("kit_tools_shovel", "chest", wood)
    p.hull(boxpts((0.120, 0.245, 1.420), (0.016, 0.016, 0.016)) + boxpts((-0.090, 0.245, 1.040), (0.016, 0.016, 0.016)))
    p.done()
    # lancer: plate armour over the chest and shoulders, a rack of lance rounds on the back
    p = Part("kit_armor_chest", "chest", armor)
    _, f, b = tunic(1.24)
    p.hull([V((x * k, f - 0.020 - d, z)) for x, z, k in ((0.140, 1.34, 1), (0.150, 1.20, 1), (0.130, 1.14, 1)) for k in (1, -1) for d in (0.0, 0.020)] +
           [V((0, f - 0.052, 1.25))])
    p.hull([V((x * k, b + 0.010 + d, z)) for x, z in ((0.140, 1.34), (0.150, 1.16)) for k in (1, -1) for d in (0.0, 0.018)])
    p.done()
    for side, sx in (("L", 1), ("R", -1)):
        p = Part(f"kit_armor_pauldron_{side}", f"clavicle_{side}", armor)
        p.rings(oring(sx * 0.176, 0.012, 1.405, 0.060, n=8, sx=1.1, rot=math.pi / 8),
                oring(sx * 0.196, 0.012, 1.350, 0.088, n=8, sx=0.9, rot=math.pi / 8),
                oring(sx * 0.214, 0.012, 1.290, 0.090, n=8, sx=0.7, rot=math.pi / 8))
        p.done()
    p = Part("kit_tubes_lancer", "chest", metal)
    for dx in (-0.070, 0.0, 0.070):
        p.hull(oring(dx, 0.170, 1.040, 0.032, n=6) + oring(dx, 0.170, 1.400, 0.032, n=6))
    p.box((0, 0.170, 1.210), (0.240, 0.070, 0.030))
    p.done()
    # sniper: goggles pushed up on the helmet brim, a light pack
    p = Part("kit_goggles_sniper", "head", metal)
    gy, gz = O.HY - 0.132, 1.680
    for sx in (1, -1):
        p.hull(oring(sx * 0.040, gy, gz, 0.022, n=8, sy=0.5, rot=math.pi / 8) + oring(sx * 0.040, gy - 0.014, gz, 0.020, n=8, sy=0.5, rot=math.pi / 8))
    p.done()
    p = Part("kit_goggles_lens", "head", lens)
    for sx in (1, -1):
        p.hull(oring(sx * 0.040, gy - 0.016, gz, 0.017, n=8, sy=0.2, rot=math.pi / 8))
    p.done()
    # shocktrooper: a breastplate (lighter than the lancer's)
    p = Part("kit_plate_shock", "chest", armor)
    _, f, _ = tunic(1.22)
    p.hull([V((x * k, f - 0.012 - d, z)) for x, z in ((0.110, 1.33), (0.120, 1.16)) for k in (1, -1) for d in (0.0, 0.016)] + [V((0, f - 0.040, 1.25))])
    p.done()


# ---------------------------------------------------------------- legs: puttees and boots
def build_legs():
    puttee = mat("M_puttee", PAL["puttee"], 0.9)
    pants = mat("M_pants", PAL["pants"], 0.85)
    upper = mat("M_shoe_upper", PAL["boot"], 0.6)
    sole = mat("M_shoe_sole", PAL["sole"], 0.7)
    for side, sx in (("L", 1), ("R", -1)):
        cx = sx * AN["x"]
        # trousers: a fuller shin, bloused over the top of the puttees
        p = Part(f"pants_shin_{side}", f"knee_{side}", pants)
        p.rings(ring(sx * O.KN["x"], -0.004, 0.545, 0.062, -0.066, 0.066, 0.5), ring(sx * O.KN["x"], -0.006, 0.505, 0.068, -0.072, 0.068, 0.5),
                ring(sx * 0.104, 0.002, 0.380, 0.072, -0.076, 0.074, 0.5), ring(sx * 0.105, 0.006, 0.300, 0.074, -0.078, 0.076, 0.5),
                ring(sx * 0.105, 0.008, 0.262, 0.056, -0.058, 0.060, 0.5))
        p.done()
        # wrapped puttees: stacked, slightly tilted bands
        p = Part(f"puttee_{side}", f"ankle_{side}", puttee)
        for i, z in enumerate((0.120, 0.150, 0.180, 0.210, 0.240, 0.268)):
            r = 0.050 + (z - 0.12) * 0.06
            tilt = 0.008 if i % 2 else -0.008
            p.hull([V((q.x, q.y, q.z + tilt * (q.y - 0.01) / 0.05)) for q in oring(cx, 0.010, z - 0.016, r, n=8, sy=1.05, rot=math.pi / 8)] +
                   oring(cx, 0.010, z + 0.016, r + 0.002, n=8, sy=1.05, rot=math.pi / 8))
        p.done()
        # ankle boots: heel piece and toe piece hinged at the ball of the foot, a thick sole
        ST, B0, B1 = 0.026, BALL_Y + 0.008, BALL_Y - 0.004
        P = lambda x, y, z, s=1: V((cx + s * x, y, z))
        p = Part(f"shoes_boot_sole_{side}", f"ankle_{side}", sole)
        p.hull([P(x, y, z, s) for x, y in ((0.044, 0.086), (0.054, 0.050), (0.058, B0)) for s in (1, -1) for z in (0.0, ST)])
        p.done()
        p = Part(f"shoes_boot_toe_sole_{side}", f"toe_{side}", sole)
        p.hull([P(x, y, z, s) for x, y in ((0.058, B1), (0.054, -0.170), (0.044, -0.214), (0.020, -0.234)) for s in (1, -1) for z in (0.0, ST)])
        p.done()
        p = Part(f"shoes_boot_upper_{side}", f"ankle_{side}", upper)
        prof = [(0.082, 0.150, 0.046), (0.050, 0.150, 0.054), (-0.030, 0.120, 0.056), (-0.090, 0.088, 0.054), (B0, 0.078, 0.052)]
        p.hull([P(w * k, y, z, s) for y, z1, w in prof for s in (1, -1) for k, z in ((1.0, ST), (0.86, z1))])
        p.done()
        p = Part(f"shoes_boot_toe_upper_{side}", f"toe_{side}", upper)
        prof = [(B1, 0.076, 0.052), (-0.160, 0.064, 0.050), (-0.206, 0.050, 0.040), (-0.228, 0.036, 0.020)]
        p.hull([P(w * k, y, z, s) for y, z1, w in prof for s in (1, -1) for k, z in ((1.0, ST), (0.82, z1))])
        p.done()


# ---------------------------------------------------------------- helmets
def build_helmets():
    steel = mat("M_cap", PAL["helmet"], 0.6)
    strap = mat("M_webbing_dark", PAL["web_dark"], 0.85)
    HY = O.HY
    # Federation: a rounded dome with a narrow brim all round
    p = Part("hat_fed_helmet", "head", steel)
    p.rings(ring(0, HY + 0.004, 1.632, 0.112, -0.122, 0.128, 0.70), ring(0, HY + 0.004, 1.648, 0.110, -0.118, 0.124, 0.70),
            ring(0, HY + 0.004, 1.708, 0.104, -0.110, 0.116, 0.68), ring(0, HY + 0.006, 1.762, 0.082, -0.086, 0.092, 0.66),
            ring(0, HY + 0.008, 1.792, 0.040, -0.042, 0.046, 0.62))
    p.rings(ring(0, HY + 0.004, 1.626, 0.132, -0.146, 0.150, 0.72), ring(0, HY + 0.004, 1.640, 0.128, -0.142, 0.146, 0.72))
    p.done()
    # Imperial: a deep helmet, flared skirt over the ears and neck, a short visor
    p = Part("hat_imp_helmet", "head", steel)
    # the skirt covers ears and nape only: its front edge rises from the cheek to above the brow
    p.rings(ring(0, HY + 0.010, 1.560, 0.124, 0.010, 0.150, 0.70), ring(0, HY + 0.008, 1.610, 0.124, -0.050, 0.132, 0.72),
            ring(0, HY + 0.004, 1.652, 0.116, -0.118, 0.122, 0.70), ring(0, HY + 0.004, 1.720, 0.100, -0.110, 0.112, 0.68),
            ring(0, HY + 0.006, 1.770, 0.076, -0.080, 0.086, 0.66), ring(0, HY + 0.008, 1.796, 0.036, -0.038, 0.042, 0.62))
    p.hull(boxpts((0, HY - 0.124, 1.652), (0.170, 0.040, 0.012), rot=(-14, 0, 0)))  # visor
    p.done()
    p = Part("hat_strap", "head", strap)
    for sx in (1, -1):
        p.hull(boxpts((sx * 0.090, HY - 0.010, 1.620), (0.008, 0.016, 0.012)) + boxpts((sx * 0.060, HY - 0.060, 1.452), (0.008, 0.016, 0.012)))
    p.hull(boxpts((0.060, HY - 0.060, 1.452), (0.008, 0.016, 0.012)) + boxpts((-0.060, HY - 0.060, 1.452), (0.008, 0.016, 0.012)))
    p.done()


def pose():
    def rot(name, x=0, y=0, z=0):
        O.objs[name].rotation_euler = (math.radians(x), math.radians(y), math.radians(z))
    # both arms hang (the game poses them); a soldier's square stance
    for side, s in (("L", 1), ("R", -1)):
        rot(f"shoulder_{side}", x=3, z=s * 3)
        rot(f"elbow_{side}", x=-10, y=s * 6)
        rot(f"hip_{side}", z=s * 2)
        rot(f"ankle_{side}", z=-s * 6)
    bpy.context.view_layer.update()


def build_all():
    O.build_rig()
    O.build_head()
    O.build_headgear()
    remove(("hat_A01",))  # the office cap gives way to the helmets
    O.build_body()
    # long sleeves and puttees cover these
    remove(("arm_L_upper", "arm_R_upper", "arm_L_lower", "arm_R_lower", "pants_P02_hem", "pants_P02_shin", "sock_", "pants_P02_belt", "pants_P02_buckle"))
    build_tunic()
    build_webbing()
    build_legs()
    build_helmets()
    emp("cup", (-0.24, -0.16, 0.95), O.ROOT_NAME)  # the runtime expects the pivot; soldiers carry no cup
    pose()


# Blender's exec of this file (render_previews) wants these names
EXPR, objs = O.EXPR, O.objs

if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    O.clean_scene()
    build_all()
    meshes = [o for o in O.col.objects if o.type == "MESH"]
    print(f"soldier faceted: {O.triangles()} triangles, {len(meshes)} meshes")
    if argv:
        O.export(argv[0])
        print("exported", argv[0])
