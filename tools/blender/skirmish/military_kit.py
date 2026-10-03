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
    "stone": "#B3A88F", "stone_light": "#C9BFA6", "stone_dark": "#8C826E",
    "leaf": "#5E8A3E", "leaf_dark": "#4C7334", "leaf_light": "#73A04A",
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
def bag(a, c, yaw=0.0, key="burlap", s=(0.6, 0.33, 0.17), tilt=0.0):
    """One sandbag: a filled pillow, rounded in plan (a superellipse), thinner at its tied ends."""
    R = Matrix.Rotation(yaw, 3, "Z") @ Matrix.Rotation(tilt, 3, "X")
    pts = []
    for zk, k in ((-0.5, 0.86), (-0.22, 1.0), (0.18, 0.98), (0.5, 0.74)):
        for i in range(10):
            ang = i * TAU / 10
            ca, sa = math.cos(ang), math.sin(ang)
            u = math.copysign(abs(ca) ** 0.55, ca)
            v = math.copysign(abs(sa) ** 0.55, sa)
            z = zk * s[2] * (1.0 - 0.45 * abs(u) ** 3)  # the tied ends pinch flat
            pts.append(R @ V((u * s[0] / 2 * k, v * s[1] / 2 * k, z)) + V(c))
    a.hull(key, pts)


def course(a, length, z, depth_y=0.0, offset=0.0, rng=None, keys=("burlap", "burlap", "burlap_dark")):
    """A row of bags laid end to end along X, centred, touching."""
    L = 0.58
    n = int(round(length / L))
    x0 = -n * L / 2 + L / 2 + offset
    for i in range(n):
        j = (hash((round(z * 100), i, round(depth_y * 100))) % 1000) / 1000
        bag(a, (x0 + i * L, depth_y + (j - 0.5) * 0.03, z), yaw=(j - 0.5) * 0.12, key=keys[(i + int(z * 10)) % len(keys)], tilt=(j - 0.5) * 0.08)


def sandbag_wall():
    a = Asset("p_sandbag_wall")  # 2.4 m long, 0.85 m high: five courses in front, two behind
    for k in range(5):
        z = 0.085 + k * 0.15
        course(a, 2.4 if k % 2 == 0 else 1.8, z, 0.0, 0.0)
    for k in range(2):
        course(a, 2.4 if k % 2 else 1.8, 0.085 + k * 0.15, 0.32)
    return a.done()


def sandbag_arc():
    a = Asset("p_sandbag_arc")  # a quarter ring, radius 1.8 m, open toward +Y (behind)
    R = 1.8
    for k in range(5):
        z = 0.085 + k * 0.15
        n = 5 if k % 2 == 0 else 4
        for i in range(n):
            t = (i + (0 if k % 2 == 0 else 0.5)) / 4.0
            ang = math.radians(-135 + 90 * t)
            bag(a, (math.cos(ang) * R, math.sin(ang) * R + R, z), yaw=ang + math.pi / 2, key="burlap" if (i + k) % 3 else "burlap_dark")
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
    a = Asset("p_flag_camp")  # base camp: 6 m pole, a waving faction flag, a stone plinth ringed by bags
    a.cyl("wood_dark", (0, 0, 0.3), (0, 0, 6.0), 0.055, 8)
    a.hull("brass", circle((0, 0, 6.0), 0.07, 8) + [V((0, 0, 6.16))])
    a.hull("concrete", circle((0, 0, 0), 0.55, 8) + circle((0, 0, 0.32), 0.45, 8))
    W, H, n = 1.8, 1.1, 10
    for i in range(n):  # the cloth in thin vertical strips along a wave
        x0, x1 = 0.06 + W * i / n, 0.06 + W * (i + 1) / n
        y0, y1 = 0.15 * math.sin(i * 0.9), 0.15 * math.sin((i + 1) * 0.9)
        d0, d1 = 0.04 * i, 0.04 * (i + 1)  # the free end droops
        pts = []
        for x, y, d in ((x0, y0, d0), (x1, y1, d1)):
            for t in (-0.008, 0.008):
                pts += [V((x, y + t, 5.9 - d)), V((x, y + t, 5.9 - H - d * 0.5))]
        a.hull("paint", pts)
    for i in range(8):
        ang = i * TAU / 8
        bag(a, (math.cos(ang) * 0.82, math.sin(ang) * 0.82, 0.085), yaw=ang + math.pi / 2, s=(0.62, 0.32, 0.17))
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
    a = Asset("p_watchtower")  # 6.5 m wooden tower with a ladder
    for x in (-1.1, 1.1):
        for y in (-1.1, 1.1):
            a.cyl("wood_dark", (x * 1.15, y * 1.15, 0), (x * 0.95, y * 0.95, 5.2), 0.09, 6)
    for z in (1.6, 3.2):
        for s_ in (1, -1):
            a.cyl("wood", (-1.1, s_ * 1.05, z - 0.8), (1.1, s_ * 1.05, z + 0.6), 0.05, 4)
            a.cyl("wood", (s_ * 1.05, -1.1, z + 0.6), (s_ * 1.05, 1.1, z - 0.8), 0.05, 4)
    a.box("wood", (0, 0, 4.4), (2.6, 2.6, 0.14))
    for s_ in (1, -1):
        a.box("wood_light", (0, s_ * 1.25, 4.95), (2.6, 0.06, 0.9))
        a.box("wood_light", (s_ * 1.25, 0.15, 4.95), (0.06, 2.3, 0.9))
    for x in (-1.2, 1.2):
        for y in (-1.2, 1.2):
            a.box("wood_dark", (x, y, 5.7), (0.08, 0.08, 1.6))
    a.hull("canvas_dark", [V((x, y, 6.5)) for x in (-1.5, 1.5) for y in (-1.5, 1.5)] + [V((0, 0, 7.1))])
    # the ladder: two rails from the ground to the platform's front edge, rungs every 30 cm
    foot, top = V((0, -2.5, 0.0)), V((0, -1.32, 4.45))
    for x in (-0.28, 0.28):
        a.cyl("wood_dark", foot + V((x, 0, 0)), top + V((x, 0, 0.4)), 0.035, 4)
    L = (top - foot).length
    for k in range(1, int(L / 0.3)):
        p = foot.lerp(top, k * 0.3 / L)
        a.cyl("wood", p + V((-0.28, 0, 0)), p + V((0.28, 0, 0)), 0.022, 4)
    return a.done()


def bunker():
    a = Asset("p_bunker")  # concrete pillbox: battered octagonal walls, a slit to the front, an overhanging roof
    n, rot = 8, math.pi / 8
    a.hull("concrete", circle((0, 0, -0.2), 2.45, n, rot=rot) + circle((0, 0, 1.0), 2.25, n, rot=rot))
    a.hull("concrete_dark", circle((0, 0, 0.95), 1.95, n, rot=rot) + circle((0, 0, 1.35), 1.95, n, rot=rot))  # inside, seen through the slit
    corners = [V((math.cos(rot + i * TAU / n), math.sin(rot + i * TAU / n), 0)) for i in range(n)]
    for i in range(n):
        c0, c1 = corners[i], corners[(i + 1) % n]
        mid = (c0 + c1) / 2
        front = mid.y < -0.3  # the three sides facing -Y stay open: the firing slit
        if not front:
            a.hull("concrete", [c * r + V((0, 0, z)) for c in (c0, c1) for r in (1.98, 2.25) for z in (0.98, 1.32)])
        else:
            a.hull("concrete", [c * r + V((0, 0, z)) for c in (c0, c1) for r in (1.98, 2.3) for z in (0.94, 1.0)])  # the sill
    a.hull("concrete", circle((0, 0, 1.3), 2.25, n, rot=rot) + circle((0, 0, 1.75), 2.2, n, rot=rot))
    a.hull("concrete", circle((0, 0, 1.72), 2.6, n, rot=rot) + circle((0, 0, 1.95), 2.6, n, rot=rot) + circle((0, 0, 2.15), 2.2, n, rot=rot))  # roof slab
    a.hull("concrete_dark", circle((0, 0, 2.15), 0.35, 6) + circle((0, 0, 2.45), 0.3, 6))  # periscope housing
    a.cyl("steel_dark", (0.0, -1.6, 1.12), (0.0, -2.55, 1.12), 0.045, 6)  # the MG barrel in the slit
    a.box("steel_dark", (0, -1.55, 1.1), (0.25, 0.3, 0.18))
    a.box("wood_dark", (0, 2.3, 0.65), (0.9, 0.1, 1.3))  # door at the back
    # bags banked against the front, two courses, touching
    R = 2.8
    for k in range(2):
        z = 0.085 + k * 0.15
        steps = 15 - k
        for i in range(steps):
            ang = math.radians(-165 + (150 / (steps - 1)) * i + (5 if k else 0))
            bag(a, (math.cos(ang) * (R - k * 0.1), math.sin(ang) * (R - k * 0.1), z), yaw=ang + math.pi / 2, key="burlap" if (i + k) % 3 else "burlap_dark")
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
def tank():
    a = Asset("p_tank_hull")  # heavy tank, 7.4 m long; front toward -Y
    for sx in (-1.45, 1.45):
        # running gear: eight road wheels, a drive sprocket at the front, an idler at the back
        for i in range(8):
            y = -2.55 + i * 0.73
            a.cyl("steel_dark", (sx - 0.22, y, 0.36), (sx + 0.22, y, 0.36), 0.3, 10)
            a.cyl("rubber", (sx - 0.24, y, 0.36), (sx + 0.24, y, 0.36), 0.22, 10)
        for y, r in ((-3.25, 0.4), (3.25, 0.36)):
            a.cyl("steel", (sx - 0.26, y, 0.62), (sx + 0.26, y, 0.62), r, 10)
        for i in range(4):  # return rollers
            a.cyl("steel", (sx - 0.15, -2.1 + i * 1.4, 0.98), (sx + 0.15, -2.1 + i * 1.4, 0.98), 0.1, 8)
        # the track: lower run, upper run, wrapped round sprocket and idler
        a.box("rubber", (sx, 0, 0.05), (0.62, 6.2, 0.1))
        a.box("rubber", (sx, 0, 1.12), (0.62, 6.5, 0.08))
        for y in (-3.25, 3.25):
            pts = []
            for i in range(9):
                ang = (-math.pi / 2 + i * math.pi / 8) * (1 if y < 0 else -1)
                r = 0.52
                py, pz = y + (-math.cos(ang) * r if y < 0 else math.cos(ang) * r), 0.6 + math.sin(ang) * r
                for x in (sx - 0.31, sx + 0.31):
                    pts.append(V((x, py, pz)))
            a.hull("rubber", pts)
        a.box("steel_dark", (sx, 0, 1.24), (0.72, 7.0, 0.06))  # track guard
    # hull: a sloped glacis, flat deck, raised engine deck at the back
    a.hull("paint", [V((x, y, z)) for x in (-1.05, 1.05) for y, z in ((-3.35, 0.55), (-3.55, 1.0), (-2.55, 1.6), (3.3, 1.6), (3.5, 0.6))])
    a.hull("paint", boxpts((0, 0.3, 1.3), (3.4, 4.8, 0.6)))
    a.hull("paint", boxpts((0, 2.6, 1.78), (2.4, 1.7, 0.36)))
    for i in range(6):  # the radiator: a glowing grille at the back, the weak point
        a.box("radiator", (-0.75 + i * 0.3, 3.46, 1.5), (0.18, 0.06, 0.42))
    a.box("steel_dark", (0, 3.5, 1.5), (2.0, 0.04, 0.5))
    a.cyl("steel_dark", (0.7, -3.0, 1.35), (0.7, -3.65, 1.35), 0.045, 6)  # hull MG
    a.box("steel_dark", (0.7, -3.05, 1.35), (0.3, 0.2, 0.3))
    for sx in (-1, 1):
        a.cyl("steel", (sx * 1.25, -3.5, 1.3), (sx * 1.25, -3.62, 1.3), 0.11, 8)
        a.cyl("glass", (sx * 1.25, -3.62, 1.3), (sx * 1.25, -3.64, 1.3), 0.09, 8)
    a.box("steel_dark", (-0.7, -2.3, 1.62), (0.6, 0.5, 0.06))  # driver's hatch
    a.box("wood", (1.2, 1.2, 1.64), (0.12, 1.6, 0.1))  # tools on the deck
    for sx in (-0.9, 0.9):
        a.cyl("steel_dark", (sx, 3.4, 1.95), (sx, 3.4, 2.35), 0.08, 8)
    a.mark("turret", (0, -0.2, 1.6))
    a.done()

    t = Asset("p_tank_turret")  # origin on the turret ring
    t.hull("paint", circle((0, 0.2, 0.0), 1.35, 10, sx=1.0, sy=1.15, rot=math.pi / 10) + circle((0, 0.3, 0.8), 1.05, 10, sx=1.0, sy=1.1, rot=math.pi / 10))
    t.hull("paint", boxpts((0, -1.05, 0.42), (1.2, 0.5, 0.66)))  # gun mantlet
    t.cyl("steel_dark", (0, -1.2, 0.42), (0, -4.4, 0.42), 0.1, 10)
    t.cyl("steel_dark", (0, -4.1, 0.42), (0, -4.6, 0.42), 0.15, 10)  # muzzle brake
    t.hull("paint", circle((0.45, 0.5, 0.8), 0.36, 10) + circle((0.45, 0.5, 1.1), 0.32, 10))  # cupola
    t.hull("steel_dark", circle((0.45, 0.5, 1.1), 0.3, 10) + circle((0.45, 0.5, 1.15), 0.3, 10))
    t.box("paint", (0, 1.45, 0.45), (1.6, 0.5, 0.55))  # bustle
    t.cyl("steel", (-0.8, 1.4, 0.75), (-0.8, 1.5, 3.0), 0.012, 3)
    t.mark("muzzle", (0, -4.6, 0.42))
    t.done()


def windmill():
    a = Asset("p_windmill_body")  # tower mill, 11 m to the cap
    a.hull("plaster", circle((0, 0, 0), 2.6, 10, rot=math.pi / 10) + circle((0, 0, 8.4), 1.7, 10, rot=math.pi / 10))
    a.hull("roof", circle((0, 0, 8.3), 2.0, 10, rot=math.pi / 10) + circle((0, 0.2, 9.8), 1.1, 10, sx=1, sy=1.3, rot=math.pi / 10) + [V((0, 0.3, 10.6))])
    a.box("wood_dark", (0, -2.55, 1.0), (1.0, 0.14, 2.0))  # door
    for z in (3.4, 6.0):
        a.box("glass", (0, -2.3 + (z - 3.4) * 0.11, z), (0.6, 0.14, 0.8), rot=(-5, 0, 0))
    a.cyl("wood_dark", (0, -1.2, 9.2), (0, -2.35, 9.2), 0.16, 8)  # the wind shaft, out of the cap to the hub
    a.mark("hub", (0, -2.35, 9.2))
    a.done()
    s = Asset("p_windmill_sails")  # origin on the hub; the sails turn about the Y axis
    s.cyl("wood_dark", (0, 0.15, 0), (0, -0.35, 0), 0.3, 10)
    for i in range(4):
        ang = i * TAU / 4 + 0.3
        d = V((math.cos(ang), 0, math.sin(ang)))
        n = V((-math.sin(ang), 0, math.cos(ang)))
        s.cyl("wood_dark", d * 0.25, d * 6.0, 0.07, 4)  # the stock
        for k in range(6):  # laths across the sail frame
            r = 1.3 + k * 0.9
            s.cyl("wood", d * r + n * 0.05, d * r + n * 1.05, 0.025, 4)
        s.cyl("wood", d * 1.3 + n * 1.05, d * 5.8 + n * 1.05, 0.03, 4)  # the outer rail
        s.hull("sail", [d * r + n * w + V((0, y, 0)) for r in (1.35, 5.75) for w in (0.08, 1.0) for y in (0.06, 0.08)])
    s.done()


def bridge():
    """Stone road bridge, 18 m end to end and 7 m wide (the game scales the width to the road): a deck
    on one segmental arch, parapets with coping, the arch ring picked out in darker stone. Origin on
    the middle of the deck surface; the road runs along Y."""
    a = Asset("p_bridge")
    W, L, span, rise, spring = 3.5, 9.0, 6.0, 2.6, -3.4

    def soffit(y):  # underside of the arch at y
        if abs(y) >= span:
            return spring
        return spring + rise * math.sqrt(1 - (y / span) ** 2)

    a.hull("stone_light", boxpts((0, 0, -0.25), (2 * W, 2 * L, 0.5)))  # the deck
    ys = [-L + i * 0.75 for i in range(int(2 * L / 0.75) + 1)]
    for y0, y1 in zip(ys, ys[1:]):
        for sx in (-1, 1):
            # spandrel wall down to the arch, and the ring of voussoirs along its edge
            pts = [V((sx * x, y, z)) for x in (W - 0.4, W) for y in (y0, y1) for z in (-0.4, soffit(y))]
            a.hull("stone", pts)
            pts = [V((sx * (W + 0.03), y, z)) for y in (y0, y1) for z in (soffit(y), soffit(y) + 0.45)] + [V((sx * (W - 0.1), y, soffit(y))) for y in (y0, y1)]
            if abs((y0 + y1) / 2) < span:
                a.hull("stone_dark", pts)
        # the vault under the deck
        a.hull("stone_dark", [V((x, y, z)) for x in (-W + 0.4, W - 0.4) for y in (y0, y1) for z in (soffit(y), soffit(y) + 0.3)])
    for sx in (-1, 1):
        a.hull("stone", boxpts((sx * (W - 0.2), 0, 0.42), (0.4, 2 * L - 0.6, 0.84)))  # parapet
        a.hull("stone_light", boxpts((sx * (W - 0.2), 0, 0.89), (0.52, 2 * L - 0.4, 0.12)))  # coping
        for y in (-L + 0.3, L - 0.3):
            a.hull("stone_light", boxpts((sx * (W - 0.2), y, 0.6), (0.6, 0.6, 1.2)))  # end posts
    return a.done()


def hedge():
    """A stretch of hedgerow, 1.8 m along X, 1.4 m tall: overlapping faceted leaf clumps, no flowers."""
    a = Asset("p_hedge")
    import random
    r = random.Random(11)
    for i, (x, z, rad, key) in enumerate(((-0.6, 0.62, 0.62, "leaf"), (0.05, 0.72, 0.7, "leaf_dark"), (0.65, 0.6, 0.6, "leaf"), (-0.15, 1.1, 0.48, "leaf_light"), (0.45, 1.05, 0.45, "leaf"))):
        pts = []
        for k in range(14):
            u, v = r.uniform(-1, 1), r.uniform(0, TAU)
            w = math.sqrt(1 - u * u)
            rr = rad * r.uniform(0.85, 1.05)
            pts.append(V((x + w * math.cos(v) * rr, w * math.sin(v) * rr * 0.75, z + u * rr * 0.9)))
        a.hull(key, pts)
    return a.done()


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
    bridge()
    hedge()


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
