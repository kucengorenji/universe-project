"""Skirmish military kit (public/models/military.glb): weapons, field fortifications, camp props,
the enemy tank and a village windmill, faceted like the soldiers (convex hulls, flat shaded).

Pack conventions match src/render/assetLibrary.js: each asset is an Empty named after it with one
child <name>_LOD0; colours come from material base colours (baked to vertex colours at load);
metres, origin on the ground at the base centre, front = Blender -Y (three.js +Z).
  - weapons: origin at the right hand's grip, barrel toward -Y; w_* also carry an empty
    <name>_support where the left hand holds it (read by src/skirmish/units/soldiers.js)
  - M_paint surfaces are tinted per instance (flag cloth, tank paint)
  - M_radiator glows: the tank's weak point
  - the tank turret (p_tank_turret) is its own asset, origin on the turret ring

Run:  Blender -b --factory-startup --python military_kit.py -- <out.glb>
"""
import math
import sys

import bpy
import bmesh
from mathutils import Matrix, Vector as V

TAU = math.tau

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
COL = bpy.data.collections.new("MILITARY")
bpy.context.scene.collection.children.link(COL)


def srgb(h):
    h = h.lstrip("#")
    f = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return tuple(f(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)) + (1.0,)


PAL = {
    "wood": "#7A5233", "wood_dark": "#553A25", "wood_light": "#9C7449", "steel": "#55595E", "steel_dark": "#34373B",
    "brass": "#B08A3C", "burlap": "#B6A276", "burlap_dark": "#9A875E", "canvas": "#A9A07A", "canvas_dark": "#8A8263",
    "concrete": "#A7A396", "concrete_dark": "#86827A", "brick": "#9C5A44", "brick_dark": "#7C4636", "mortar": "#C9BCA2",
    "paint": "#FFFFFF", "rope": "#8C7A55", "radiator": "#E0602C", "rubber": "#2A2826", "plaster": "#E6D8BA",
    "roof": "#7A4A3A", "sail": "#E8DDC2", "glass": "#3A4A55",
}
_mats = {}


def mat(key):
    name = "M_" + key
    if name not in _mats:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = srgb(PAL[key])
        m.diffuse_color = srgb(PAL[key])
        _mats[name] = m
    return _mats[name]


def boxpts(c, s, rot=None):
    R = Matrix.Identity(3)
    if rot:
        R = Matrix.Rotation(math.radians(rot[2]), 3, "Z") @ Matrix.Rotation(math.radians(rot[1]), 3, "Y") @ Matrix.Rotation(math.radians(rot[0]), 3, "X")
    return [R @ V((sx * s[0] / 2, sy * s[1] / 2, sz * s[2] / 2)) + V(c) for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]


def circle(c, r, n=8, axis="Z", sx=1.0, sy=1.0, rot=0.0):
    """Ring of n points around centre c, in the plane normal to axis."""
    out = []
    for i in range(n):
        a = rot + i * TAU / n
        u, v = math.cos(a) * r * sx, math.sin(a) * r * sy
        d = {"Z": (u, v, 0), "Y": (u, 0, v), "X": (0, u, v)}[axis]
        out.append(V(c) + V(d))
    return out


class Asset:
    """One asset: material -> bmesh of convex hulls; done() makes Empty + <name>_LOD0."""

    def __init__(self, name):
        self.name = name
        self.parts = {}
        self.marks = {}

    def hull(self, key, pts):
        bm = self.parts.setdefault(key, bmesh.new())
        verts = [bm.verts.new(V(p)) for p in pts]
        bmesh.ops.remove_doubles(bm, verts=verts, dist=1e-6)
        verts = [v for v in verts if v.is_valid]
        res = bmesh.ops.convex_hull(bm, input=verts, use_existing_faces=False)
        junk = list({v for v in res["geom_interior"] + res["geom_unused"] if isinstance(v, bmesh.types.BMVert) and v.is_valid})
        if junk:
            bmesh.ops.delete(bm, geom=junk, context="VERTS")
        return self

    def box(self, key, c, s, rot=None):
        return self.hull(key, boxpts(c, s, rot))

    def cyl(self, key, a, b, r, n=8, r2=None):
        """Prism between points a and b (any direction)."""
        a, b = V(a), V(b)
        d = (b - a).normalized()
        u = d.orthogonal().normalized()
        w = d.cross(u)
        pts = []
        for c, rr in ((a, r), (b, r if r2 is None else r2)):
            for i in range(n):
                t = i * TAU / n + math.pi / n
                pts.append(c + (u * math.cos(t) + w * math.sin(t)) * rr)
        return self.hull(key, pts)

    def mark(self, name, at):
        self.marks[name] = V(at)

    def done(self):
        holder = bpy.data.objects.new(self.name, None)
        COL.objects.link(holder)
        me = bpy.data.meshes.new(self.name + "_LOD0")
        bm = bmesh.new()
        for key, part in self.parts.items():
            bmesh.ops.dissolve_limit(part, angle_limit=math.radians(1.0), verts=part.verts, edges=part.edges)
            bmesh.ops.triangulate(part, faces=part.faces)
            tmp = bpy.data.meshes.new("tmp")
            part.to_mesh(tmp)
            part.free()
            slot = list(self.parts).index(key)
            for p in tmp.polygons:
                p.material_index = slot
            bm.from_mesh(tmp)
            bpy.data.meshes.remove(tmp)
        bm.to_mesh(me)
        bm.free()
        for key in self.parts:
            me.materials.append(mat(key))
        for p in me.polygons:
            p.use_smooth = False
        lod = bpy.data.objects.new(self.name + "_LOD0", me)
        COL.objects.link(lod)
        lod.parent = holder
        for n, at in self.marks.items():
            e = bpy.data.objects.new(f"{self.name}_{n}", None)
            COL.objects.link(e)
            e.parent = holder
            e.location = at
        return holder


# ================================================================ weapons
def rifle(name, length=0.80, scope=False):
    a = Asset(name)
    # stock: butt behind the hand, wrist at the grip
    a.hull("wood", boxpts((0, 0.30, -0.055), (0.040, 0.020, 0.120)) + boxpts((0, 0.06, -0.010), (0.036, 0.04, 0.050)))
    a.hull("wood", boxpts((0, 0.06, -0.010), (0.036, 0.04, 0.050)) + boxpts((0, -0.02, 0.012), (0.034, 0.03, 0.040)))
    # fore-stock under the barrel
    a.hull("wood", boxpts((0, -0.02, 0.012), (0.034, 0.02, 0.040)) + boxpts((0, -length * 0.72, 0.022), (0.026, 0.02, 0.026)))
    # receiver, bolt handle, trigger guard
    a.box("steel_dark", (0, -0.06, 0.040), (0.026, 0.16, 0.024))
    a.box("steel", (0.028, -0.010, 0.046), (0.030, 0.010, 0.010))
    a.hull("steel", circle((0.046, -0.010, 0.046), 0.008, 6, "X"))
    a.box("steel_dark", (0, -0.020, -0.012), (0.010, 0.04, 0.010))
    # barrel past the fore-stock, front sight
    a.cyl("steel_dark", (0, -0.10, 0.040), (0, -length, 0.036), 0.010, 6)
    a.box("steel_dark", (0, -length + 0.02, 0.052), (0.006, 0.010, 0.016))
    if scope:
        a.cyl("steel_dark", (0, 0.05, 0.090), (0, -0.25, 0.090), 0.018, 8)
        a.cyl("steel_dark", (0, -0.25, 0.090), (0, -0.30, 0.090), 0.018, 8, r2=0.024)
        a.cyl("steel_dark", (0, 0.05, 0.090), (0, 0.08, 0.090), 0.018, 8, r2=0.022)
        a.box("steel", (0, -0.03, 0.064), (0.012, 0.012, 0.030))
        a.box("steel", (0, -0.18, 0.064), (0.012, 0.012, 0.030))
    a.mark("support", (0, -length * 0.45, 0.0))
    a.mark("muzzle", (0, -length, 0.036))
    return a.done()


def smg():
    a = Asset("w_smg")
    a.hull("wood", boxpts((0, 0.24, -0.060), (0.036, 0.020, 0.100)) + boxpts((0, 0.04, -0.004), (0.034, 0.04, 0.044)))
    a.hull("wood", boxpts((0, 0.0, -0.040), (0.030, 0.035, 0.080)) + boxpts((0, 0.02, 0.010), (0.030, 0.035, 0.030)))  # pistol grip
    a.cyl("steel_dark", (0, 0.04, 0.030), (0, -0.30, 0.030), 0.024, 8)  # receiver
    a.cyl("steel", (0, -0.12, 0.030), (0, -0.40, 0.030), 0.020, 8)  # perforated jacket
    a.cyl("steel_dark", (0, -0.40, 0.030), (0, -0.44, 0.030), 0.012, 6)
    # drum magazine under the receiver
    a.cyl("steel_dark", (-0.032, -0.10, -0.040), (0.032, -0.10, -0.040), 0.060, 10)
    a.hull("wood", boxpts((0, -0.24, -0.030), (0.030, 0.06, 0.06)) + boxpts((0, -0.24, 0.006), (0.030, 0.06, 0.02)))  # fore-grip
    a.mark("support", (0, -0.24, -0.055))
    a.mark("muzzle", (0, -0.44, 0.030))
    return a.done()


def lance():
    """The anti-tank lance: a long tube with a conical warhead, a hand guard and a trigger grip."""
    a = Asset("w_lance")
    a.cyl("steel", (0, 0.42, 0.06), (0, -0.85, 0.06), 0.045, 8)
    a.cyl("steel_dark", (0, 0.42, 0.06), (0, 0.52, 0.06), 0.045, 8, r2=0.055)  # flared back end
    a.cyl("brass", (0, -0.85, 0.06), (0, -0.98, 0.06), 0.075, 8)  # warhead body
    a.cyl("brass", (0, -0.98, 0.06), (0, -1.26, 0.06), 0.075, 8, r2=0.004)  # cone
    a.cyl("steel_dark", (0, -0.20, 0.06), (0, -0.24, 0.06), 0.110, 8)  # hand guard disc
    a.box("wood", (0, 0.0, -0.02), (0.030, 0.040, 0.110))  # grip
    a.box("wood", (0, -0.36, -0.01), (0.030, 0.040, 0.090))  # fore-grip
    a.mark("support", (0, -0.36, -0.04))
    a.mark("muzzle", (0, -1.26, 0.06))
    return a.done()


def grenade():
    a = Asset("w_grenade")
    a.hull("steel_dark", circle((0, 0, 0.0), 0.030, 8, sx=1, sy=1) + circle((0, 0, 0.035), 0.036, 8) + circle((0, 0, 0.075), 0.026, 8))
    a.box("steel", (0, 0, 0.088), (0.016, 0.016, 0.020))
    a.box("steel", (0.016, 0, 0.074), (0.008, 0.012, 0.050), rot=(0, -12, 0))
    return a.done()


# ================================================================ fortifications
def bag(a, c, yaw=0.0, key="burlap", s=(0.62, 0.34, 0.16)):
    """One sandbag: a squashed pillow."""
    R = Matrix.Rotation(yaw, 3, "Z")
    pts = []
    for z, k in ((-s[2] / 2, 0.82), (-s[2] / 4, 0.98), (s[2] / 4, 0.98), (s[2] / 2, 0.72)):
        for q in circle((0, 0, 0), 1.0, 10, sx=s[0] / 2 * k, sy=s[1] / 2 * k):
            pts.append(R @ (q + V((0, 0, z))) + V(c))
    a.hull(key, pts)


def sandbag_wall():
    a = Asset("p_sandbag_wall")  # 2.4 m straight, 0.92 m high
    for row in range(5):
        z = 0.08 + row * 0.165
        off = 0.0 if row % 2 == 0 else 0.30
        n = 4 if row % 2 == 0 else 3
        for i in range(n):
            x = -0.90 + off + i * 0.60
            bag(a, (x, 0.0, z), yaw=(i * 0.07 - 0.1) * (1 if row % 2 else -1), key="burlap" if (i + row) % 3 else "burlap_dark")
        if row < 2:  # the base is two bags deep
            for i in range(n):
                x = -0.90 + off + i * 0.60
                bag(a, (x, 0.32, z), key="burlap_dark")
    return a.done()


def sandbag_arc():
    a = Asset("p_sandbag_arc")  # a quarter ring, radius 1.8 m, open toward +Y (behind)
    R = 1.8
    for row in range(5):
        z = 0.08 + row * 0.165
        n = 5 if row % 2 == 0 else 4
        for i in range(n):
            t = (i + (0 if row % 2 == 0 else 0.5)) / 4.0
            ang = math.radians(-135 + 90 * t)
            bag(a, (math.cos(ang) * R, math.sin(ang) * R + R, z), yaw=ang + math.pi / 2, key="burlap" if (i + row) % 3 else "burlap_dark")
    return a.done()


def barricade():
    a = Asset("p_barricade")  # 2.4 m wooden barricade: X trestles and nailed planks
    for x in (-1.0, 1.0):
        for s in (1, -1):
            a.box("wood_dark", (x, 0, 0.55), (0.10, 0.10, 1.40), rot=(s * 32, 0, 0))
    for i, z in enumerate((0.30, 0.55, 0.80, 1.02)):
        a.box("wood" if i % 2 else "wood_light", (0, -0.30 + z * 0.12, z), (2.5, 0.04, 0.18), rot=(-20, 0, (i - 1.5) * 1.5))
    return a.done()


def hedgehog():
    a = Asset("p_hedgehog")  # Czech hedgehog: three crossed steel angles, 1.4 m
    for ax, ang in (((1, 0, 0), 55), ((0, 1, 0), 55), ((0, 0, 1), 0)):
        d = Matrix.Rotation(math.radians(ang), 3, ax) @ V((0, 0, 1)) if ax != (0, 0, 1) else V((0.7, -0.4, 0.6)).normalized()
        c = V((0, 0, 0.62))
        a.cyl("steel_dark", c - d * 0.85, c + d * 0.85, 0.06, 4)
    return a.done()


def wire():
    a = Asset("p_wire")  # 3 m of barbed wire on screw pickets
    for x in (-1.4, 0.0, 1.4):
        a.cyl("steel_dark", (x, 0, 0), (x, 0, 1.0), 0.025, 4)
    for z in (0.25, 0.55, 0.85):
        for x0, x1 in ((-1.4, 0.0), (0.0, 1.4)):
            a.cyl("steel", (x0, 0, z), (x1, 0, z + 0.04), 0.008, 3)
    # coils: diagonal cross wires
    for x0, x1 in ((-1.4, 0.0), (0.0, 1.4)):
        a.cyl("steel", (x0, 0, 0.15), (x1, 0, 0.9), 0.008, 3)
        a.cyl("steel", (x0, 0, 0.9), (x1, 0, 0.15), 0.008, 3)
    return a.done()


def crate():
    a = Asset("p_crate")  # ammunition crate
    a.box("wood", (0, 0, 0.24), (1.0, 0.56, 0.48))
    for x in (-0.44, 0.44):
        a.box("wood_dark", (x, 0, 0.24), (0.08, 0.60, 0.50))
    a.box("wood_dark", (0, 0, 0.49), (1.02, 0.58, 0.04))
    a.box("steel", (0, -0.29, 0.40), (0.12, 0.02, 0.06))
    return a.done()


def drum():
    a = Asset("p_drum")
    a.cyl("steel", (0, 0, 0), (0, 0, 0.88), 0.29, 10)
    for z in (0.28, 0.60):
        a.cyl("steel_dark", (0, 0, z - 0.02), (0, 0, z + 0.02), 0.30, 10)
    return a.done()


def flagpole():
    a = Asset("p_flag_camp")  # base camp: 6 m pole, a faction flag, a sandbag ring
    a.cyl("wood_dark", (0, 0, 0), (0, 0, 6.0), 0.06, 6)
    a.hull("brass", circle((0, 0, 6.0), 0.07, 6) + [V((0, 0, 6.14))])
    W, H = 1.9, 1.2
    for i in range(6):  # the cloth ripples in a few vertical strips
        x0, x1 = 0.06 + W * i / 6, 0.06 + W * (i + 1) / 6
        y0, y1 = 0.06 * math.sin(i * 1.3), 0.06 * math.sin((i + 1) * 1.3)
        sag = 0.05 * i
        a.hull("paint", [V((x0, y0 + d, 5.85 - sag * 0.4)) for d in (-0.01, 0.01)] + [V((x0, y0 + d, 5.85 - H - sag * 0.2)) for d in (-0.01, 0.01)] +
               [V((x1, y1 + d, 5.85 - sag * 0.4 - 0.02)) for d in (-0.01, 0.01)] + [V((x1, y1 + d, 5.85 - H - sag * 0.2 - 0.02)) for d in (-0.01, 0.01)])
    for i in range(10):
        ang = i * TAU / 10
        bag(a, (math.cos(ang) * 0.8, math.sin(ang) * 0.8, 0.09), yaw=ang + math.pi / 2, s=(0.56, 0.32, 0.18))
    return a.done()


def tent():
    a = Asset("p_tent")  # ridge tent, 3 m deep
    for s in (1, -1):
        a.hull("canvas" if s > 0 else "canvas_dark", [V((s * 1.25, y, 0.02)) for y in (-1.5, 1.5)] + [V((s * 0.03, y, 1.9)) for y in (-1.5, 1.5)] +
               [V((s * 1.20, y, 0.02)) for y in (-1.5, 1.5)])
    a.hull("canvas_dark", [V((x, 1.45, z)) for x, z in ((-1.2, 0.02), (1.2, 0.02), (0, 1.88))] + [V((x, 1.5, z)) for x, z in ((-1.2, 0.02), (1.2, 0.02), (0, 1.88))])
    for y in (-1.55, 1.55):
        a.cyl("wood_dark", (0, y, 0), (0, y, 2.05), 0.035, 4)
    a.cyl("rope", (0, -1.55, 2.0), (0, -2.6, 0.0), 0.012, 3)
    return a.done()


def watchtower():
    a = Asset("p_watchtower")  # 6.5 m wooden tower
    for x in (-1.1, 1.1):
        for y in (-1.1, 1.1):
            a.cyl("wood_dark", (x * 1.15, y * 1.15, 0), (x * 0.95, y * 0.95, 5.2), 0.09, 4)
    for z in (1.6, 3.2):
        for s in (1, -1):
            a.cyl("wood", (-1.1, s * 1.05, z - 0.8), (1.1, s * 1.05, z + 0.6), 0.05, 4)
            a.cyl("wood", (s * 1.05, -1.1, z + 0.6), (s * 1.05, 1.1, z - 0.8), 0.05, 4)
    a.box("wood", (0, 0, 4.4), (2.6, 2.6, 0.14))
    for s in (1, -1):
        a.box("wood_light", (0, s * 1.25, 4.95), (2.6, 0.06, 0.9))
        a.box("wood_light", (s * 1.25, 0, 4.95), (0.06, 2.6, 0.9))
    for x in (-1.2, 1.2):
        for y in (-1.2, 1.2):
            a.box("wood_dark", (x, y, 5.7), (0.08, 0.08, 1.6))
    a.hull("canvas_dark", [V((x, y, 6.5)) for x in (-1.5, 1.5) for y in (-1.5, 1.5)] + [V((0, 0, 7.1))])
    a.hull("wood_dark", boxpts((0, -1.6, 2.2), (0.7, 0.08, 0.08)) + boxpts((0, -2.6, 0.02), (0.7, 0.08, 0.08)))  # ladder
    return a.done()


def bunker():
    a = Asset("p_bunker")  # concrete pillbox: hexagonal, 4.4 m across, firing slit to the front
    n = 6
    rot = math.pi / 6
    a.hull("concrete", circle((0, 0, 0), 2.3, n, rot=rot) + circle((0, 0, 0.95), 2.2, n, rot=rot))
    a.hull("concrete", circle((0, 0, 1.30), 2.15, n, rot=rot) + circle((0, 0, 1.75), 2.1, n, rot=rot))
    a.hull("concrete_dark", circle((0, 0, 0.95), 2.0, n, rot=rot) + circle((0, 0, 1.30), 2.0, n, rot=rot))  # the slit's shadow band
    # the slit lip and pillars between the openings
    for i in range(n):
        ang = rot + i * TAU / n + TAU / (2 * n)
        if math.sin(ang) > 0.2:  # back wall: closed
            a.box("concrete", (math.cos(ang) * 2.12, math.sin(ang) * 2.12, 1.12), (1.6, 0.3, 0.36), rot=(0, 0, math.degrees(ang) + 90))
    a.hull("concrete", circle((0, 0, 1.75), 2.35, n, rot=rot) + circle((0, 0, 1.95), 2.3, n, rot=rot))  # roof slab
    a.hull("concrete_dark", circle((0, 0, 1.95), 1.6, n, rot=rot) + circle((0, 0, 2.15), 1.2, n, rot=rot))
    a.box("steel_dark", (0, -2.2, 1.12), (0.08, 0.6, 0.08))  # the MG barrel poking out
    for i in range(8):  # sandbags piled against the front
        ang = math.radians(-160 + i * 20)
        bag(a, (math.cos(ang) * 2.55, math.sin(ang) * 2.55, 0.09), yaw=ang + math.pi / 2)
        if i % 2:
            bag(a, (math.cos(ang) * 2.5, math.sin(ang) * 2.5, 0.26), yaw=ang + math.pi / 2 + 0.1, key="burlap_dark")
    return a.done()


def ruin_wall():
    a = Asset("p_ruin_wall")  # a broken brick house wall, 4 m long
    tops = [2.6, 2.9, 2.2, 1.5, 1.8, 0.9, 1.2, 0.6]
    w = 4.0 / len(tops)
    for i, h in enumerate(tops):
        x = -2.0 + w * (i + 0.5)
        a.hull("brick" if i % 3 else "brick_dark", boxpts((x, 0, h / 2), (w * 1.02, 0.32, h)) + [V((x + w * 0.3, 0.0, h + 0.18))])
    a.box("mortar", (-1.0, -0.17, 1.4), (0.9, 0.02, 0.9))  # a window opening's plaster reveal
    for i in range(7):  # rubble at the foot
        x = -1.8 + i * 0.62
        a.hull("brick_dark", boxpts((x, -0.45 - (i % 2) * 0.2, 0.12), (0.45, 0.35, 0.24), rot=(0, 0, i * 23)))
    return a.done()


# ================================================================ the enemy tank
def track(a, sx):
    L, R = 3.4, 0.42
    a.hull("rubber", circle((sx, -L, 0.55), R, 10, "X") + circle((sx, L, 0.55), R, 10, "X") +
           [V((sx + d, y, 0.0)) for y in (-L + 0.4, L - 0.4) for d in (-0.32, 0.32)] +
           [V((sx + d, y, 0.55)) for y in (-L, L) for d in (-0.32, 0.32)])
    a.box("steel_dark", (sx, 0, 1.05), (0.7, 7.2, 0.08))  # track guard
    for i in range(7):
        y = -2.7 + i * 0.9
        a.cyl("steel", (sx - 0.34, y, 0.42), (sx + 0.34, y, 0.42), 0.34, 8)


def tank():
    a = Asset("p_tank_hull")  # heavy tank, 7.4 m long; front toward -Y
    for sx in (-1.45, 1.45):
        track(a, sx)
    # hull: a sloped glacis, flat deck, raised engine deck at the back
    a.hull("paint", [V((x, y, z)) for x in (-1.1, 1.1) for y, z in ((-3.5, 0.55), (-3.6, 1.0), (-2.6, 1.55), (3.4, 1.55), (3.6, 0.6))])
    a.hull("paint", boxpts((0, 0.3, 1.25), (3.6, 4.6, 0.55)))
    a.hull("paint", boxpts((0, 2.6, 1.72), (2.4, 1.7, 0.36)))  # engine deck
    # the radiator: a glowing grille at the back of the engine deck, the weak point
    for i in range(6):
        a.box("radiator", (-0.75 + i * 0.3, 3.46, 1.45), (0.18, 0.06, 0.42))
    a.box("steel_dark", (0, 3.5, 1.45), (2.0, 0.04, 0.5))
    # hull MG and headlights
    a.cyl("steel_dark", (0.7, -3.0, 1.30), (0.7, -3.6, 1.30), 0.04, 6)
    for sx in (-1, 1):
        a.cyl("steel", (sx * 1.25, -3.55, 1.2), (sx * 1.25, -3.65, 1.2), 0.11, 8)
        a.cyl("glass", (sx * 1.25, -3.65, 1.2), (sx * 1.25, -3.67, 1.2), 0.09, 8)
    # exhausts
    for sx in (-0.9, 0.9):
        a.cyl("steel_dark", (sx, 3.4, 1.9), (sx, 3.4, 2.3), 0.08, 6)
    a.mark("turret", (0, -0.2, 1.52))
    a.done()

    t = Asset("p_tank_turret")  # origin on the turret ring
    t.hull("paint", circle((0, 0.2, 0.0), 1.35, 8, sx=1.0, sy=1.15, rot=math.pi / 8) + circle((0, 0.3, 0.85), 1.05, 8, sx=1.0, sy=1.1, rot=math.pi / 8))
    t.hull("paint", boxpts((0, -1.05, 0.45), (1.2, 0.5, 0.7)))  # gun mantlet
    t.cyl("steel_dark", (0, -1.2, 0.45), (0, -4.6, 0.45), 0.10, 8)
    t.cyl("steel_dark", (0, -4.3, 0.45), (0, -4.7, 0.45), 0.15, 8)  # muzzle brake
    t.hull("paint", circle((0.45, 0.5, 0.85), 0.36, 8) + circle((0.45, 0.5, 1.15), 0.32, 8))  # cupola
    t.hull("steel_dark", circle((0.45, 0.5, 1.15), 0.30, 8) + circle((0.45, 0.5, 1.2), 0.30, 8))
    t.box("steel_dark", (-0.8, 1.4, 0.5), (0.12, 0.12, 1.4), rot=(0, 0, 0))  # antenna mount
    t.cyl("steel", (-0.8, 1.4, 1.1), (-0.8, 1.5, 3.2), 0.012, 3)
    t.mark("muzzle", (0, -4.7, 0.45))
    t.done()


# ================================================================ village landmark
def windmill():
    a = Asset("p_windmill_body")  # tower mill, 11 m to the cap
    a.hull("plaster", circle((0, 0, 0), 2.6, 8, rot=math.pi / 8) + circle((0, 0, 8.4), 1.7, 8, rot=math.pi / 8))
    a.hull("roof", circle((0, 0, 8.3), 2.0, 8, rot=math.pi / 8) + circle((0, 0.2, 9.7), 1.0, 8, sx=1, sy=1.4, rot=math.pi / 8) + [V((0, 0.4, 10.6))])
    a.box("wood_dark", (0, -2.55, 1.0), (1.0, 0.12, 2.0))  # door
    for z in (3.4, 6.0):
        a.box("glass", (0, -2.3 + (z - 3.4) * 0.11, z), (0.6, 0.12, 0.8), rot=(-5, 0, 0))
    a.hull("wood", boxpts((0, -2.0, 9.0), (0.3, 0.6, 0.3)) + boxpts((0, -2.6, 9.2), (0.3, 0.2, 0.3)))
    a.mark("hub", (0, -2.7, 9.2))
    a.done()
    s = Asset("p_windmill_sails")  # origin on the hub; sails turn about the Y axis
    s.cyl("wood_dark", (0, 0.1, 0), (0, -0.3, 0), 0.25, 8)
    for i in range(4):
        ang = i * TAU / 4 + 0.3
        d = V((math.cos(ang), 0, math.sin(ang)))
        n = V((-math.sin(ang), 0, math.cos(ang)))
        s.cyl("wood_dark", d * 0.2, d * 6.2, 0.07, 4)
        s.hull("sail", [d * r + n * w + V((0, -0.12, 0)) for r in (1.2, 6.0) for w in (0.05, 1.1)] + [d * r + n * w + V((0, -0.16, 0)) for r in (1.2, 6.0) for w in (0.05, 1.1)])
    s.done()


def build_all():
    rifle("w_rifle")
    rifle("w_sniper", length=0.92, scope=True)
    smg()
    lance()
    grenade()
    sandbag_wall()
    sandbag_arc()
    barricade()
    hedgehog()
    wire()
    crate()
    drum()
    flagpole()
    tent()
    watchtower()
    bunker()
    ruin_wall()
    tank()
    windmill()


def export(path):
    bpy.ops.object.select_all(action="DESELECT")
    for o in COL.objects:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_yup=True, export_apply=False,
                              export_animations=False, export_cameras=False, export_lights=False, export_normals=False,
                              export_texcoords=False)


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    build_all()
    tris = sum(len(o.data.polygons) for o in COL.objects if o.type == "MESH")
    print(f"military kit: {sum(o.type == 'EMPTY' and o.parent is None for o in COL.objects)} assets, {tris} triangles")
    for o in COL.objects:
        if o.type == "MESH":
            print(f"  {o.parent.name}: {len(o.data.polygons)} tris")
    if argv:
        export(argv[0])
        print("exported", argv[0])
