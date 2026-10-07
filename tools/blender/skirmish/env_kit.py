"""Skirmish environment kit (public/models/skirmish_env.glb): the village, its trees and the field
fortifications, modelled for Valkyria Chronicles' painted look.

Geometry carries the detail (timber framing, framed windows with open shutters, roofs laid in tile
courses, bricks broken along a ruined wall's top, sandbags one by one, lumpy leaf clumps); the
surfaces are painted tiles (surfaces.py) the game samples in world space. Per vertex:
  TEXCOORD_0: u = surface index (surfaces.SURFACES), v unused
  COLOR_0:    the surface's tint times baked ambient occlusion (soft painted shading)

Pack conventions match src/skirmish/battlefield/envKit.js: each asset is an Empty named after it with
one child <name>_LOD0; metres; origin on the ground at the base centre; front = Blender -Y (three.js
+Z). Asset names follow the battlefield generator (f_house_v0.., t_oak_v0.., p_sandbag_wall..).

Run:  Blender -b --factory-startup --python env_kit.py -- <out.glb> [--only name,name] [--preview <dir>]
"""
import functools
import math
import os
import random
import sys
import zlib

import bmesh
import bpy
from mathutils import Matrix, Vector as V, noise

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from surfaces import SURFACES  # noqa: E402

print = functools.partial(print, flush=True)
TAU = math.tau
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = ARGS[0] if ARGS and not ARGS[0].startswith("--") else None


def arg(name, default=None):
    return ARGS[ARGS.index(name) + 1] if name in ARGS else default


ONLY = set(arg("--only", "").split(",")) - {""}
PREVIEW = arg("--preview")
SURF = {k: i for i, k in enumerate(SURFACES)}

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
COL = bpy.context.scene.collection


def hexc(h):
    h = h.lstrip("#")
    return [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]


def shade(h, k):
    """A tint darkened (k < 1) or lightened (k > 1)."""
    c = [min(1.0, x * k) for x in hexc(h)]
    return "#" + "".join(f"{int(x * 255 + 0.5):02x}" for x in c)


# ---------------------------------------------------------------- primitives (temporary bmeshes)
def cube(size, bevel=0.0, segs=1):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    if bevel:
        bmesh.ops.bevel(bm, geom=bm.edges[:], offset=bevel, segments=segs, affect="EDGES", profile=0.5)
    return bm


def cylinder(r1, h, segs=10, r2=None, cap=True):
    """Along +Z from 0 to h."""
    bm = bmesh.new()
    r2 = r1 if r2 is None else r2
    a = [bm.verts.new((math.cos(i * TAU / segs) * r1, math.sin(i * TAU / segs) * r1, 0)) for i in range(segs)]
    b = [bm.verts.new((math.cos(i * TAU / segs) * r2, math.sin(i * TAU / segs) * r2, h)) for i in range(segs)]
    for i in range(segs):
        j = (i + 1) % segs
        bm.faces.new((a[i], a[j], b[j], b[i]))
    if cap:
        bm.faces.new(list(reversed(a)))
        if r2 > 1e-4:
            bm.faces.new(b)
    return bm


def ico(r, subdiv=2):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=r)
    return bm


def prism(profile, length):
    """A 2D profile in (y, z) extruded along X from -length/2 to length/2 (counter-clockwise profile)."""
    bm = bmesh.new()
    a = [bm.verts.new((-length / 2, y, z)) for y, z in profile]
    b = [bm.verts.new((length / 2, y, z)) for y, z in profile]
    n = len(profile)
    bm.faces.new(list(reversed(a)))
    bm.faces.new(b)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((a[i], a[j], b[j], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def tube(points, radii, segs=8, cap=True):
    """A tapered tube through points (Vectors) with a radius at each."""
    bm = bmesh.new()
    rings = []
    for k, (p, r) in enumerate(zip(points, radii)):
        t = (points[min(k + 1, len(points) - 1)] - points[max(k - 1, 0)]).normalized()
        u = t.orthogonal().normalized()
        v = t.cross(u)
        rings.append([bm.verts.new(p + (u * math.cos(i * TAU / segs) + v * math.sin(i * TAU / segs)) * r) for i in range(segs)])
    for ra, rb in zip(rings, rings[1:]):
        for i in range(segs):
            j = (i + 1) % segs
            bm.faces.new((ra[i], ra[j], rb[j], rb[i]))
    if cap:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def hull(points):
    """The convex hull of points: a solid with sloping faces."""
    bm = bmesh.new()
    vs = [bm.verts.new(V(p)) for p in points]
    bmesh.ops.convex_hull(bm, input=vs)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def lumpy(bm, amount, freq, seed=0):
    """Push vertices along their normals by noise: leaf clumps, rubble, rounded stones."""
    bm.normal_update()
    off = V((seed * 7.1, seed * 3.3, seed * 5.7))
    for v in bm.verts:
        n = noise.noise(v.co * freq + off)
        v.co += v.normal * n * amount


def pillow(size, seed=0):
    """A sandbag: a box rounded toward an ellipsoid, a little lopsided."""
    bm = cube((1, 1, 1))
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=3, use_grid_fill=True)
    for v in bm.verts:
        c = v.co
        sph = c.normalized() * 0.5 * 1.15
        v.co = c.lerp(sph, 0.55)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    rnd = random.Random(seed)
    for v in bm.verts:
        v.co.z += (v.co.x / size[0]) * rnd.uniform(-0.02, 0.02)
        if v.co.z < 0:
            v.co.z *= 0.7  # a flatter bottom where it rests
    return bm


def place(bm, loc=(0, 0, 0), rot=(0, 0, 0), scale=None):
    if scale:
        bmesh.ops.scale(bm, vec=scale, verts=bm.verts)
    R = Matrix.Rotation(rot[2], 4, "Z") @ Matrix.Rotation(rot[1], 4, "Y") @ Matrix.Rotation(rot[0], 4, "X")
    bmesh.ops.transform(bm, matrix=R, verts=bm.verts)
    bmesh.ops.translate(bm, vec=V(loc), verts=bm.verts)
    return bm


class Part:
    """One asset's geometry: every face carries a (surface, tint) through its material slot."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.keys = []
        self.scratch = bpy.data.meshes.new("scratch")

    def add(self, bm, surface, tint="#ffffff", smooth=False):
        key = (surface, tint)
        if key not in self.keys:
            self.keys.append(key)
        i = self.keys.index(key)
        for f in bm.faces:
            f.material_index = i
            f.smooth = smooth
        bm.to_mesh(self.scratch)
        bm.free()
        self.bm.from_mesh(self.scratch)
        return self

    def box(self, c, size, surface, tint="#ffffff", rot=(0, 0, 0), bevel=0.0, smooth=False):
        return self.add(place(cube(size, bevel), c, rot), surface, tint, smooth)

    def object(self, sharp_deg=40.0):
        me = bpy.data.meshes.new(self.name + "_LOD0")
        self.bm.to_mesh(me)
        self.bm.free()
        bpy.data.meshes.remove(self.scratch)
        for surface, tint in self.keys:
            m = bpy.data.materials.new(f"{surface}|{tint}")
            m["surface"], m["tint"] = surface, tint
            me.materials.append(m)
        # hard edges stay hard; the rest shades smooth
        bm = bmesh.new()
        bm.from_mesh(me)
        for e in bm.edges:
            if len(e.link_faces) == 2 and e.calc_face_angle(0) > math.radians(sharp_deg):
                e.smooth = False
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new(self.name + "_LOD0", me)
        COL.objects.link(ob)
        return ob


# ---------------------------------------------------------------- the village houses
# footprints (w along X, d along Y) match the generator's HOUSES (generateField.js)
STYLES = {
    "f_house_small": [dict(floors=1, style="plaster", wall="#efe4cc", roof="#b86a48", shutters="#4a6a5a"),
                      dict(floors=1, style="stone", wall="#d8ccb0", roof="#a85a40", shutters="#6a4a3a"),
                      dict(floors=1, style="timber", wall="#f2e8d0", roof="#9a5a48", shutters="#3a5a7a")],
    "f_house": [dict(floors=2, style="timber", wall="#f0e6cc", roof="#b0603e", shutters="#4a6a5a"),
                dict(floors=2, style="plaster", wall="#e8d6a8", roof="#a85a40", shutters="#7a3a30"),
                dict(floors=2, style="brick", wall="#ffffff", roof="#8a5040", shutters="#3a5a7a")],
    "f_house_tall": [dict(floors=3, style="timber", wall="#f2ead6", roof="#a85a40", shutters="#5a6a3a", dormer=True),
                     dict(floors=3, style="plaster", wall="#e4d8c0", roof="#9a5a48", shutters="#4a6a7a", dormer=True)],
    "f_townhouse": [dict(floors=3, style="plaster", wall="#e8c8a8", roof="#a85a40", shutters="#4a6a5a"),
                    dict(floors=3, style="brick", wall="#ffffff", roof="#7a4a3a", shutters="#7a3a30")],
    "f_shop": [dict(floors=2, style="plaster", wall="#f0e0b8", roof="#b0603e", shutters="#3a5a7a", shop="#a8463a"),
               dict(floors=2, style="timber", wall="#efe4cc", roof="#a85a40", shutters="#4a6a5a", shop="#3a6a4a")],
    "f_tavern": [dict(floors=2, style="timber", wall="#f2e6c8", roof="#9a5240", shutters="#6a3a2a", shop="#7a3a2a", dormer=True)],
}
SIZES = {"f_house_small": (6.5, 6), "f_house": (8, 7), "f_house_tall": (7.5, 7), "f_townhouse": (6.5, 7), "f_shop": (8.5, 7.5), "f_tavern": (12, 9)}
TIMBER, STONE_T, GLASS_T = "#5a3e2a", "#d0c6ae", "#ffffff"


def window(P, face, u, z, wd, ht, w, d, shutters, timber_head=True):
    """A framed window on a face (front/back/left/right) at position u along it and sill height z:
    glass, frame, mullion cross, stone sill, a lintel, shutters opened flat beside it."""
    nrm = {"front": V((0, -1, 0)), "back": V((0, 1, 0)), "left": V((-1, 0, 0)), "right": V((1, 0, 0))}[face]
    along = {"front": V((1, 0, 0)), "back": V((-1, 0, 0)), "left": V((0, -1, 0)), "right": V((0, 1, 0))}[face]
    half = {"front": d / 2, "back": d / 2, "left": w / 2, "right": w / 2}[face]
    yaw = math.atan2(along.y, along.x)
    at = lambda du, dz, out: nrm * (half + out) + along * (u + du) + V((0, 0, z + dz))
    rot = (0, 0, yaw)
    P.box(at(0, ht / 2, 0.006), (wd, 0.02, ht), "glass", GLASS_T, rot)
    f = 0.07
    for du, dz, sx, sz in ((-(wd / 2), ht / 2, f, ht + f), (wd / 2, ht / 2, f, ht + f), (0, ht, wd + f, f), (0, 0, wd + f, f), (0, ht * 0.55, wd, 0.04), (0, ht / 2, 0.04, ht)):
        P.box(at(du, dz, 0.035), (sx, 0.07, sz), "painted", "#efe8dc", rot)
    P.box(at(0, -0.05, 0.08), (wd + 0.24, 0.16, 0.08), "stone", STONE_T, rot, bevel=0.01)
    P.box(at(0, ht + 0.1, 0.04), (wd + 0.3, 0.08, 0.14), "timber" if timber_head else "stone", TIMBER if timber_head else STONE_T, rot)
    if shutters:
        for s in (-1, 1):
            P.box(at(s * (wd / 2 + wd / 4 + 0.05), ht / 2, 0.03), (wd / 2, 0.04, ht + 0.04), "painted", shutters, rot)
            for k in (0.25, 0.75):  # the battens
                P.box(at(s * (wd / 2 + wd / 4 + 0.05), ht * k, 0.055), (wd / 2 - 0.02, 0.02, 0.06), "painted", shade(shutters, 0.8), rot)


def flower_box(P, face, u, z, wd, w, d, rng):
    nrm = {"front": V((0, -1, 0)), "back": V((0, 1, 0))}[face]
    along = V((1, 0, 0)) if face == "front" else V((-1, 0, 0))
    c = nrm * (d / 2 + 0.14) + along * u + V((0, 0, z - 0.14))
    yaw = math.atan2(along.y, along.x)
    P.box(c, (wd + 0.1, 0.22, 0.2), "plank", "#8a6a48", (0, 0, yaw))
    for k in range(4):
        bm = ico(0.14, 1)
        lumpy(bm, 0.05, 6, rng.random() * 10)
        P.add(place(bm, c + along * ((k - 1.5) * wd / 4) + V((0, 0, 0.14))), "leaf", rng.choice(["#c8546a", "#d86a4a", "#e8c84a", "#d8708a"]), smooth=True)


def roof_tint(color, k=0.38):
    """The roof tiles' texture is already terracotta: a house's roof colour only nudges it."""
    c = hexc(color)
    base = hexc("#b0603e")
    t = [min(1.0, (1 - k) + k * (x / max(b, 1e-3))) for x, b in zip(c, base)]
    return "#" + "".join(f"{int(min(1, x) * 255 + 0.5):02x}" for x in t)


def roof_courses(P, w, d, H, rise, color, over=0.45, gable_over=0.3, course=0.34, thick=0.06):
    """A gable roof (ridge along X) laid as courses of tiles: each course a slab tipped a little
    steeper than the roof so its lower edge stands proud, like overlapping tiles."""
    slope = math.atan2(rise, d / 2)
    L = math.hypot(d / 2 + over, rise + over * math.tan(slope))
    n = max(4, int(L / course + 0.5))
    step = L / n
    for side in (-1, 1):
        for k in range(n):
            s = (k + 0.5) * step  # from the eave up the slope
            y = side * (d / 2 + over - s * math.cos(slope))
            z = H - over * math.tan(slope) + s * math.sin(slope)
            tip = -side * (slope + math.radians(5))  # rising toward the ridge, a little steeper
            c = V((0, y, z)) + V((0, side * math.sin(slope), math.cos(slope))) * (thick / 2 + 0.02)
            P.box(c, (w + 2 * gable_over, step + 0.06, thick), "roof_tile", shade(roof_tint(color), 0.96 + 0.08 * ((k * 7) % 3) / 2), (tip, 0, 0))
    # ridge cap and the gable barge boards
    ridge = place(cylinder(0.13, w + 2 * gable_over + 0.04, 8), (0, 0, 0), (0, math.pi / 2, 0))
    bmesh.ops.translate(ridge, vec=V((-(w / 2 + gable_over + 0.02), 0, H + rise + 0.08)), verts=ridge.verts)
    P.add(ridge, "roof_tile", shade(roof_tint(color), 0.8))
    for sx in (-1, 1):
        for side in (-1, 1):
            a = V((sx * (w / 2 + gable_over - 0.02), side * (d / 2 + over), H - over * math.tan(slope) - 0.02))
            b = V((sx * (w / 2 + gable_over - 0.02), 0, H + rise + 0.02))
            mid = (a + b) / 2
            length = (b - a).length
            P.box(mid, (0.06, length, 0.22), "timber", TIMBER, (-side * slope, 0, 0))


def house(name, w, d, floors=2, style="plaster", wall="#efe4cc", roof="#b06040", shutters="#4a6a5a", shop=None, dormer=False, seed=0):
    rng = random.Random(seed)
    P = Part(name)
    gh, fh = 3.1, 2.8
    H = 0.45 + gh + fh * (floors - 1)
    rise = (d / 2) * math.tan(math.radians(rng.uniform(40, 47)))
    ground = {"stone": "stone", "brick": "brick", "timber": "stone", "plaster": "plaster"}[style]
    upper = {"stone": "stone", "brick": "brick", "timber": "plaster", "plaster": "plaster"}[style]
    wt = wall if upper in ("plaster",) else "#ffffff"
    # the body: walls up to the eaves and the gables, one prism (the roof hides its slopes)
    P.add(prism([(-d / 2, 0), (d / 2, 0), (d / 2, H), (0, H + rise), (-d / 2, H)], w), upper, wt)
    if ground != upper:
        P.box((0, 0, 0.45 + gh / 2), (w + 0.04, d + 0.04, gh), ground, STONE_T if ground == "stone" else "#ffffff")
    P.box((0, 0, 0.24), (w + 0.16, d + 0.16, 0.5), "stone", shade(STONE_T, 0.9), bevel=0.02)
    # corner quoins (stone) or posts (timber), and the bands between the storeys
    for sx in (-1, 1):
        for sy in (-1, 1):
            if style == "timber":
                P.box((sx * (w / 2 + 0.02), sy * (d / 2 + 0.02), (0.45 + gh + H) / 2), (0.2, 0.2, H - 0.45 - gh), "timber", TIMBER)
            else:
                for k in range(int((H - 0.5) / 0.45)):
                    z = 0.7 + k * 0.45
                    long = k % 2 == 0
                    P.box((sx * (w / 2 + 0.015) - sx * (0.18 if long else 0.1), sy * (d / 2 + 0.015) - sy * (0.1 if long else 0.18), z),
                          (0.36 if long else 0.2, 0.2 if long else 0.36, 0.4), "stone", STONE_T, bevel=0.015)
    for f in range(1, floors):
        z = 0.45 + gh + fh * (f - 1)
        P.box((0, 0, z), (w + 0.12, d + 0.12, 0.2), "timber" if style == "timber" else "stone", TIMBER if style == "timber" else STONE_T)
    if style == "timber":  # framing on the upper floors: posts, rails, braces beside the corners
        for f in range(1, floors):
            z0 = 0.45 + gh + fh * (f - 1)
            for face, half, span, axis in (("front", d / 2, w, "x"), ("back", d / 2, w, "x"), ("left", w / 2, d, "y"), ("right", w / 2, d, "y")):
                n = {"front": V((0, -1, 0)), "back": V((0, 1, 0)), "left": V((-1, 0, 0)), "right": V((1, 0, 0))}[face]
                al = V((1, 0, 0)) if axis == "x" else V((0, 1, 0))
                yaw = 0 if axis == "x" else math.pi / 2
                posts = max(3, int(span / 1.3))
                for k in range(posts + 1):
                    u = -span / 2 + span * k / posts
                    P.box(n * (half + 0.03) + al * u + V((0, 0, z0 + fh / 2)), (0.14, 0.06, fh), "timber", TIMBER, (0, 0, yaw))
                P.box(n * (half + 0.03) + V((0, 0, z0 + 0.9)), (span, 0.06, 0.12), "timber", TIMBER, (0, 0, yaw))
                P.box(n * (half + 0.03) + V((0, 0, z0 + fh - 0.1)), (span, 0.06, 0.12), "timber", TIMBER, (0, 0, yaw))
                for s in (-1, 1):  # braces in the corner panels
                    u0 = s * (span / 2 - span / posts / 2)
                    ang = math.atan2(fh - 0.3, span / posts) * s
                    rot = (0, ang, yaw) if axis == "x" else (ang, 0, yaw - math.pi / 2)
                    P.box(n * (half + 0.035) + al * u0 + V((0, 0, z0 + fh / 2)), (math.hypot(span / posts, fh - 0.3) * 0.9, 0.05, 0.12), "timber", TIMBER, (0, -ang, yaw) if axis == "x" else (0, -ang, yaw))
    # windows and the door
    cols = max(2, int(w / 2.3))
    door_col = rng.randrange(cols) if not shop else cols // 2
    for f in range(floors):
        zf = 0.45 + (0 if f == 0 else gh + fh * (f - 1))
        sill = zf + (0.95 if f == 0 else 0.85)
        ht = 1.35 if f == 0 else 1.25
        for k in range(cols):
            u = -w / 2 + w * (k + 0.5) / cols
            if f == 0 and k == door_col:
                continue
            if f == 0 and shop:
                continue
            window(P, "front", u, sill, 0.95, ht, w, d, shutters)
            if rng.random() < 0.8:
                window(P, "back", -u, sill, 0.95, ht, w, d, shutters)
            if f > 0 and rng.random() < 0.35:
                flower_box(P, "front", u, sill, 0.95, w, d, rng)
        for face, span in (("left", d), ("right", d)):
            if rng.random() < 0.7:
                window(P, face, 0, sill, 0.85, ht, w, d, shutters if f > 0 else None)
    du = -w / 2 + w * (door_col + 0.5) / cols
    P.box((du, -d / 2 - 0.03, 0.45 + 1.1), (1.15, 0.08, 2.2), "plank", shade(shutters, 0.9))
    for dx, sx, sz, dz in ((-0.62, 0.12, 2.35, 1.17), (0.62, 0.12, 2.35, 1.17), (0, 1.36, 0.14, 2.35)):
        P.box((du + dx, -d / 2 - 0.05, 0.45 + dz), (sx, 0.12, sz), "timber", TIMBER)
    P.box((du, -d / 2 - 0.35, 0.22), (1.6, 0.7, 0.44), "stone", STONE_T, bevel=0.02)
    if shop:  # a shop front: a wide window, an awning, a board over it
        P.box((0, -d / 2 - 0.02, 0.45 + 1.35), (w * 0.62, 0.04, 1.9), "glass", GLASS_T)
        for k in range(5):
            P.box((-w * 0.31 + w * 0.62 * k / 4, -d / 2 - 0.06, 0.45 + 1.35), (0.1, 0.1, 1.95), "painted", shop)
        P.box((0, -d / 2 - 0.06, 0.45 + 0.3), (w * 0.64, 0.1, 0.12), "painted", shop)
        P.box((0, -d / 2 - 0.06, 0.45 + 2.4), (w * 0.64, 0.1, 0.14), "painted", shop)
        P.box((0, -d / 2 - 0.6, 0.45 + 2.75), (w * 0.7, 1.2, 0.05), "canvas", shop, (math.radians(-18), 0, 0))
        P.box((0, -d / 2 - 0.08, 0.45 + 3.0), (w * 0.5, 0.08, 0.45), "painted", "#2a3a2a")
    roof_courses(P, w, d, H, rise, roof)
    # a chimney through the roof, a dormer on bigger houses
    cx = rng.choice((-1, 1)) * w * 0.28
    P.box((cx, d * 0.12, H + rise * 0.7), (0.62, 0.62, rise * 1.1 + 1.0), "brick", "#ffffff")
    P.box((cx, d * 0.12, H + rise * 0.7 + (rise * 1.1 + 1.0) / 2 + 0.05), (0.76, 0.76, 0.12), "stone", STONE_T)
    if dormer:
        dz, dy = H + rise * 0.35, -d * 0.18
        P.add(place(prism([(-0.7, 0), (0.7, 0), (0.7, 1.1), (0, 1.7), (-0.7, 1.1)], 1.4), (0, dy, dz), (0, 0, math.pi / 2)), "plaster", wall)
        window(P, "front", 0, dz + 0.25, 0.7, 0.8, 1.4, 2 * (-dy + 0.7), None)
    return P.object()


# ---------------------------------------------------------------- the ruined wall (cover)
def ruin_wall():
    """A broken brick wall 4 m long: stepped courses along its top, a window gap, plaster clinging
    to the front, loose bricks and rubble at its foot."""
    rng = random.Random(5)
    P = Part("p_ruin_wall")
    L, T = 4.0, 0.5
    cols = 10
    cw = L / cols
    heights = []
    for k in range(cols):
        base = 2.7 - abs(k - 2.5) * 0.28 + rng.uniform(-0.35, 0.25)
        heights.append(max(0.6, base if k < 7 else 1.0 + rng.uniform(-0.3, 0.4)))
    for k, h in enumerate(heights):
        x = -L / 2 + cw * (k + 0.5)
        if k in (4, 5) and h > 2.0:  # the window gap
            P.box((x, 0, 0.45), (cw, T, 0.9), "brick", "#ffffff")
            P.box((x, 0, 2.05 + (h - 2.05) / 2), (cw, T, h - 2.05), "brick", "#ffffff")
        else:
            P.box((x, 0, h / 2), (cw, T, h), "brick", "#ffffff")
        # loose bricks stepping off the top
        for b in range(rng.randrange(1, 4)):
            P.box((x + rng.uniform(-0.15, 0.15), rng.uniform(-0.12, 0.12), h + 0.035 + b * 0.002), (0.24, 0.12, 0.07), "brick", "#ffffff",
                  (0, 0, rng.uniform(-0.4, 0.4)), bevel=0.008)
    # plaster patches on the front, broken edges
    for x0, x1, z1 in ((-2.0, -0.6, 1.9), (0.4, 1.4, 1.2)):
        P.box(((x0 + x1) / 2, -T / 2 - 0.012, z1 / 2 + 0.2), (x1 - x0, 0.03, z1 - 0.2), "plaster", "#e8dcc4")
    # rubble: broken bricks and lumps along the foot, both sides
    for k in range(26):
        side = rng.choice((-1, 1))
        x = rng.uniform(-L / 2 - 0.3, L / 2 + 0.3)
        y = side * (T / 2 + rng.uniform(0.05, 0.9))
        if rng.random() < 0.6:
            P.box((x, y, 0.05), (0.24, 0.12, 0.07), "brick", "#ffffff", (rng.uniform(-0.3, 0.3), rng.uniform(-0.3, 0.3), rng.uniform(0, TAU)), bevel=0.01)
        else:
            bm = ico(rng.uniform(0.12, 0.3), 1)
            lumpy(bm, 0.06, 5, k)
            P.add(place(bm, (x, y, 0.02), (0, 0, 0), (1, 1, 0.55)), "stone", "#c8b8a0", smooth=True)
    return P.object()


# ---------------------------------------------------------------- sandbags
def bag_course(P, n, z, length, y=0.0, depth=0.0, seed=0, arc=None):
    rng = random.Random(seed)
    for k in range(n):
        t = (k + 0.5) / n
        if arc:
            a = arc[0] + (arc[1] - arc[0]) * t
            pos = V((math.sin(a) * arc[2], -math.cos(a) * arc[2] + arc[2], z))
            yaw = a
        else:
            pos = V((-length / 2 + length * t + (0.15 if (seed % 2) else 0), y, z))
            yaw = rng.uniform(-0.06, 0.06)
        bm = pillow((0.58, 0.32, 0.17), seed * 31 + k)
        tint = rng.choice(["#ffffff", "#f2ead8", "#e4d8bc", "#fbf4e4"])
        P.add(place(bm, pos + V((0, 0, 0.085)), (rng.uniform(-0.05, 0.05), rng.uniform(-0.04, 0.04), yaw)), "sandbag", tint, smooth=True)


def sandbag_wall():
    P = Part("p_sandbag_wall")
    for c in range(4):
        n = 4 if c % 2 == 0 else 3
        for row, y in enumerate((-0.17, 0.17) if c < 2 else (0.0,)):
            bag_course(P, n, c * 0.155, 2.4 if n == 4 else 1.8, y, seed=c * 3 + row)
    return P.object()


def sandbag_arc():
    P = Part("p_sandbag_arc")
    for c in range(4):
        r = 1.2 - (0.0 if c < 2 else 0.1)
        n = 6 if c % 2 == 0 else 5
        bag_course(P, n, c * 0.155, 0, seed=c, arc=(-1.1 + 0.1 * (c % 2), 1.1 - 0.1 * (c % 2), r))
        if c < 2:
            bag_course(P, n, c * 0.155, 0, seed=c + 10, arc=(-1.0, 1.0, r + 0.32))
    return P.object()


# ---------------------------------------------------------------- trees, hedges
LEAF_TINTS = {"oak": ["#ffffff", "#e8f0d8", "#f4ffe0"], "birch": ["#f0ffd8", "#e8f8c8"], "pine": ["#7a9a70", "#6a8a64"], "spruce": ["#6a8a6a", "#5a7a5c"]}


def deciduous(name, height, seed, kind="oak"):
    rng = random.Random(seed)
    P = Part(name)
    trunk_h = height * (0.38 if kind == "oak" else 0.5)
    lean = V((rng.uniform(-0.3, 0.3), rng.uniform(-0.3, 0.3), 0))
    pts = [V((0, 0, -0.3)), V((0, 0, trunk_h * 0.4)) + lean * 0.3, V((0, 0, trunk_h)) + lean]
    r0 = height * (0.045 if kind == "oak" else 0.03)
    P.add(tube(pts, [r0 * 1.3, r0, r0 * 0.8], 9), "bark", "#ffffff" if kind == "oak" else "#f4f0e8", smooth=True)
    top = pts[-1]
    tips = []
    for k in range(rng.randrange(4, 6)):
        a = k * TAU / 5 + rng.uniform(-0.4, 0.4)
        out = V((math.cos(a), math.sin(a), 0)) * height * rng.uniform(0.18, 0.28)
        up = V((0, 0, height * rng.uniform(0.15, 0.3)))
        start = top - V((0, 0, rng.uniform(0, trunk_h * 0.25)))
        mid = start + out * 0.5 + up * 0.7
        tip = start + out + up
        P.add(tube([start, mid, tip], [r0 * 0.6, r0 * 0.4, r0 * 0.2], 6), "bark", "#ffffff", smooth=True)
        tips.append(tip)
    # leaf clumps round the tips and the crown, lumpy, overlapping
    crown = top + V((0, 0, height * 0.32))
    blobs = [(t, height * rng.uniform(0.15, 0.2)) for t in tips] + [(crown, height * 0.24), (crown + V((0, 0, height * 0.12)), height * 0.17)]
    for k in range(3):
        a = rng.uniform(0, TAU)
        blobs.append((crown + V((math.cos(a), math.sin(a), rng.uniform(-0.3, 0.1))) * height * 0.2, height * rng.uniform(0.13, 0.17)))
    tints = LEAF_TINTS[kind]
    for k, (c, r) in enumerate(blobs):
        bm = ico(r, 2)
        lumpy(bm, r * 0.28, 1.6 / r, seed * 13 + k)
        P.add(place(bm, c, (0, 0, 0), (1, 1, 0.85)), "leaf", rng.choice(tints), smooth=True)
    return P.object()


def conifer(name, height, seed, kind="pine"):
    rng = random.Random(seed)
    P = Part(name)
    r0 = height * 0.025
    P.add(tube([V((0, 0, -0.3)), V((0, 0, height * 0.9))], [r0 * 1.2, r0 * 0.4], 8), "bark", "#e8d8c8", smooth=True)
    layers = 6 if kind == "spruce" else 4
    base_z = height * (0.18 if kind == "spruce" else 0.45)
    tints = LEAF_TINTS[kind]
    for k in range(layers):
        t = k / (layers - 1)
        z = base_z + (height * 0.95 - base_z) * t
        R = height * (0.32 if kind == "spruce" else 0.26) * (1 - t * 0.75)
        h = height * (0.3 if kind == "spruce" else 0.22)
        bm = bmesh.new()
        n = 14
        ring = [bm.verts.new((math.cos(i * TAU / n) * R * (1.0 if i % 2 == 0 else 0.72), math.sin(i * TAU / n) * R * (1.0 if i % 2 == 0 else 0.72), -h * 0.45 + (0 if i % 2 == 0 else h * 0.12))) for i in range(n)]
        apex = bm.verts.new((0, 0, h * 0.55))
        for i in range(n):
            bm.faces.new((ring[i], ring[(i + 1) % n], apex))
        bm.faces.new(list(reversed(ring)))
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=1, use_grid_fill=True)
        lumpy(bm, R * 0.12, 2.5 / R, seed * 7 + k)
        P.add(place(bm, (0, 0, z), (0, 0, rng.uniform(0, TAU))), "leaf", rng.choice(tints), smooth=True)
    return P.object()


def hedge():
    rng = random.Random(9)
    P = Part("p_hedge")
    for k in range(5):
        bm = ico(rng.uniform(0.45, 0.6), 2)
        lumpy(bm, 0.12, 3.0, k)
        P.add(place(bm, (-0.6 + k * 0.3, rng.uniform(-0.1, 0.1), 0.55), (0, 0, 0), (1, 0.75, 1.05)), "leaf", rng.choice(LEAF_TINTS["oak"]), smooth=True)
    return P.object()


# ---------------------------------------------------------------- field fortifications and camp props
WOOD, WOOD_D, STEEL = "#ffffff", "#c8b8a8", "#ffffff"


def barricade():
    """2.4 m of barricade: two X trestles, rough planks nailed across at odd angles."""
    rng = random.Random(3)
    P = Part("p_barricade")
    for x in (-1.0, 1.0):
        for s in (1, -1):
            P.box((x, 0, 0.55), (0.12, 0.12, 1.45), "timber", WOOD, (s * 0.62, 0, 0), bevel=0.01)
    for k, z in enumerate((0.3, 0.55, 0.8, 1.02)):
        P.box((rng.uniform(-0.08, 0.08), -0.2 - 0.02 * k, z), (2.5 + rng.uniform(-0.1, 0.2), 0.05, 0.22), "plank", rng.choice(["#ffffff", "#e8dcc8", "#f4ecdc"]),
              (0, rng.uniform(-0.08, 0.08), 0), bevel=0.008)
    return P.object()


def hedgehog():
    """A Czech hedgehog: three crossed steel angles."""
    P = Part("p_hedgehog")
    for k in range(3):
        a = k * TAU / 3
        d = V((math.cos(a) * 0.62, math.sin(a) * 0.62, 0.78)).normalized()
        c = V((0, 0, 0.62))
        for part in ((0.1, 0.012), (0.012, 0.1)):  # an L section
            bm = cube((part[0], part[1], 1.75), bevel=0.004)
            R = V((0, 0, 1)).rotation_difference(d).to_matrix().to_4x4()
            bmesh.ops.transform(bm, matrix=R, verts=bm.verts)
            bmesh.ops.translate(bm, vec=c, verts=bm.verts)
            P.add(bm, "metal", STEEL)
    return P.object()


def wire():
    """3 m of barbed wire: screw pickets and three sagging strands with barbs."""
    rng = random.Random(4)
    P = Part("p_wire")
    for x in (-1.4, 0.0, 1.4):
        P.add(place(cylinder(0.025, 1.05, 6), (x, 0, 0), (0, 0, 0)), "metal", "#a8a8a8")
    for z in (0.3, 0.62, 0.94):
        pts = [V((-1.5 + 3.0 * t / 12, rng.uniform(-0.03, 0.03), z - 0.06 * math.sin(math.pi * ((t / 12 * 2) % 1.0)))) for t in range(13)]
        P.add(tube(pts, [0.008] * len(pts), 4, cap=False), "metal", "#9a9a9a")
        for p in pts[1:-1]:
            P.box(p, (0.07, 0.01, 0.01), "metal", "#9a9a9a", (rng.uniform(0, 3), rng.uniform(0, 3), 0))
    return P.object()


def crate():
    """An ammunition crate: planked box, battens, rope handles, stencilled lid."""
    P = Part("p_crate")
    P.box((0, 0, 0.25), (1.0, 0.56, 0.48), "plank", "#e8d8bc", bevel=0.012)
    for x in (-0.44, 0.44):
        P.box((x, 0, 0.25), (0.06, 0.6, 0.5), "timber", "#ffffff", bevel=0.006)
    P.box((0, 0, 0.495), (0.98, 0.54, 0.02), "plank", "#f2e4c8")
    for s in (-1, 1):
        P.add(tube([V((s * 0.53, -0.08, 0.32)), V((s * 0.56, 0, 0.27)), V((s * 0.53, 0.08, 0.32))], [0.015] * 3, 5, cap=False), "canvas", "#c8b890")
    return P.object()


def drum():
    """A fuel drum: rolling hoops, a bung, rust and dents in the paint."""
    P = Part("p_drum")
    P.add(cylinder(0.29, 0.88, 14), "metal", "#8aa07a", smooth=True)
    for z in (0.29, 0.6):
        P.add(place(cylinder(0.3, 0.035, 14), (0, 0, z)), "metal", "#7a8a6a", smooth=True)
    P.add(place(cylinder(0.04, 0.03, 8), (0.15, 0.05, 0.88)), "metal", "#5a5a5a")
    return P.object()


def tent():
    """A ridge tent, 2.5 x 3 m: sagging canvas, a door flap tied back, poles, guy ropes, pegs."""
    P = Part("p_tent")
    n = 8
    for s in (1, -1):  # each roof side: a sagging canvas sheet
        bm = bmesh.new()
        grid = [[bm.verts.new((s * (0.03 + 1.22 * (1 - j / 4)), -1.5 + 3.0 * i / n,
                               1.9 * j / 4 - 0.06 * math.sin(math.pi * i / n) * math.sin(math.pi * j / 4))) for i in range(n + 1)] for j in range(5)]
        for j in range(4):
            for i in range(n):
                bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]) if s > 0 else (grid[j][i], grid[j + 1][i], grid[j + 1][i + 1], grid[j][i + 1]))
        bm.normal_update()
        if sum(f.normal.x * s for f in bm.faces) < 0:  # the sheet faces out from the ridge
            bmesh.ops.reverse_faces(bm, faces=bm.faces)
        bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.02)
        P.add(bm, "canvas", "#ffffff" if s > 0 else "#e4dcc4", smooth=True)
    for y in (-1.5, 1.5):  # end walls; the front one with its door flaps tied back
        if y > 0:
            P.add(place(prism([(-1.25, 0.02), (1.25, 0.02), (0.03, 1.9)], 0.02), (0, y, 0), (0, 0, math.pi / 2)), "canvas", "#e8e0c8")
        else:
            for s in (1, -1):
                P.add(place(prism([(0.0, 0.02), (s * 1.25, 0.02), (0.03 * s, 1.9)][::s], 0.02), (s * 0.12, y - 0.05, 0), (0, 0, math.pi / 2)), "canvas", "#e8e0c8")
    for y in (-1.55, 1.55):
        P.add(place(cylinder(0.035, 1.95, 6), (0, y, 0)), "timber", WOOD)
    P.add(place(cylinder(0.03, 3.2, 6), (0, -1.6, 1.92), (-math.pi / 2, 0, 0)), "timber", WOOD)
    for x, y in ((1.9, -1.7), (-1.9, -1.7), (1.9, 1.7), (-1.9, 1.7)):
        top = V((0, math.copysign(1.55, y), 1.85))
        peg = V((x, y + math.copysign(0.4, y), 0.05))
        P.add(tube([top, peg], [0.008, 0.008], 4, cap=False), "canvas", "#a89870")
        P.add(place(cylinder(0.02, 0.2, 4), peg - V((0, 0, 0.1))), "timber", WOOD)
    return P.object()


def bunker():
    """A concrete pillbox: battered octagonal walls with form lines, a firing slit under a lip, an
    earth-banked base, sandbags round the slit and a rough camouflage of turf on the roof."""
    rng = random.Random(6)
    P = Part("p_bunker")
    n = 8
    base = cylinder(2.45, 1.25, n, r2=2.25)
    bmesh.ops.rotate(base, verts=base.verts, cent=V(), matrix=Matrix.Rotation(math.pi / 8, 3, "Z"))
    P.add(place(base, (0, 0, -0.15)), "concrete", "#ffffff")
    roof = cylinder(2.6, 0.32, n, r2=2.5)
    bmesh.ops.rotate(roof, verts=roof.verts, cent=V(), matrix=Matrix.Rotation(math.pi / 8, 3, "Z"))
    P.add(place(roof, (0, 0, 1.1)), "concrete", "#e8e4dc")
    cap = ico(2.3, 2)
    lumpy(cap, 0.12, 1.2, 6)
    P.add(place(cap, (0, 0, 1.25), (0, 0, 0), (1, 1, 0.22)), "grass", "#ffffff", smooth=True)
    P.box((0, -2.36, 0.72), (1.9, 0.3, 0.2), "glass", "#202020")  # the slit (dark)
    P.box((0, -2.55, 0.86), (2.3, 0.4, 0.1), "concrete", "#d8d4cc")
    for k in range(14):  # earth banked round the foot
        a = k * TAU / 14
        bm = ico(0.7, 1)
        lumpy(bm, 0.2, 1.8, k)
        P.add(place(bm, (math.cos(a) * 2.55, math.sin(a) * 2.55, -0.05), (0, 0, a), (1.4, 0.8, 0.5)), "dirt", "#ffffff", smooth=True)
    for k in range(6):  # sandbags at the slit's sides
        s = -1 if k < 3 else 1
        bm = pillow((0.58, 0.32, 0.17), 60 + k)
        P.add(place(bm, (s * (1.35 + 0.05 * (k % 3)), -2.45, 0.1 + (k % 3) * 0.16), (0, 0, s * 0.2 + rng.uniform(-0.1, 0.1))), "sandbag", "#ffffff", smooth=True)
    return P.object()


def watchtower():
    """A 6.5 m wooden watchtower: four splayed legs braced in X, a ladder, a planked platform with
    a rail and a little pitched roof."""
    P = Part("p_watchtower")
    top = 5.0
    legs = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            a, b = V((sx * 1.25, sy * 1.25, 0)), V((sx * 0.95, sy * 0.95, top))
            legs.append((a, b))
            P.add(tube([a, b], [0.1, 0.09], 6), "timber", WOOD)
    for (a1, b1), (a2, b2) in ((legs[0], legs[1]), (legs[2], legs[3]), (legs[0], legs[2]), (legs[1], legs[3])):
        for z0, z1 in ((0.4, 2.6), (2.6, 4.8)):
            p = lambda a, b, z: a.lerp(b, z / top)
            P.add(tube([p(a1, b1, z0), p(a2, b2, z1)], [0.05, 0.05], 5), "timber", WOOD_D)
            P.add(tube([p(a2, b2, z0), p(a1, b1, z1)], [0.05, 0.05], 5), "timber", WOOD_D)
    P.box((0, 0, top + 0.05), (2.5, 2.5, 0.12), "plank", "#ffffff")
    for s in (-1, 1):
        P.box((s * 1.22, 0, top + 0.55), (0.06, 2.5, 0.9), "plank", "#e8dcc8")
        P.box((0, s * 1.22, top + 0.55), (2.5, 0.06, 0.9), "plank", "#e8dcc8")
    for sx in (-1, 1):
        for sy in (-1, 1):
            P.add(place(cylinder(0.06, 1.7, 6), (sx * 1.15, sy * 1.15, top)), "timber", WOOD)
    P.add(place(prism([(-1.55, 0), (1.55, 0), (0, 0.8)], 3.1), (0, 0, top + 1.7), (0, 0, math.pi / 2)), "plank", "#c8b090")
    for s in (-1, 1):  # the ladder
        P.add(tube([V((s * 0.25, -1.6, 0)), V((s * 0.25, -1.1, top))], [0.04, 0.04], 5), "timber", WOOD)
    for k in range(12):
        z = 0.3 + k * 0.4
        y = -1.6 + 0.5 * z / top
        P.box((0, y, z), (0.5, 0.05, 0.05), "timber", WOOD)
    return P.object()


def windmill_body():
    """A tower mill, 11 m to the cap: a whitewashed tapering tower with stone bands, a door and two
    windows, a boat-shaped wooden cap, the wind shaft out to the hub at (0, -2.35, 9.2)."""
    P = Part("p_windmill_body")
    n = 16
    P.add(cylinder(2.6, 8.4, n, r2=1.75), "plaster", "#f4ecdc", smooth=True)
    for z in (0.0, 4.2):  # stone bands
        r = 2.6 - (2.6 - 1.75) * z / 8.4
        P.add(place(cylinder(r + 0.06, 0.35, n, r2=r + 0.04), (0, 0, z)), "stone", STONE_T, smooth=True)
    cap = ico(1.9, 2)
    bmesh.ops.scale(cap, vec=(1.0, 1.35, 0.85), verts=cap.verts)
    for v in cap.verts:
        v.co.z = max(v.co.z, 0)
    P.add(place(cap, (0, 0.15, 8.35)), "plank", "#c89a70", smooth=True)
    P.add(place(cylinder(2.0, 0.3, n), (0, 0, 8.2)), "timber", WOOD)
    P.add(tube([V((0, -1.2, 9.2)), V((0, -2.35, 9.2))], [0.16, 0.16], 8), "timber", WOOD_D)
    P.box((0, -2.55, 0.95), (1.0, 0.15, 1.9), "plank", "#7a5a3a")
    for z, a in ((3.6, 0.3), (6.2, -0.4)):
        r = 2.6 - (2.6 - 1.75) * z / 8.4
        P.box((math.sin(a) * r, -math.cos(a) * r, z), (0.6, 0.12, 0.8), "glass", GLASS_T, (0, 0, a))
        P.box((math.sin(a) * (r + 0.05), -math.cos(a) * (r + 0.05), z - 0.45), (0.8, 0.14, 0.1), "stone", STONE_T, (0, 0, a))
    return P.object()


def windmill_sails():
    """Four lattice sails on stocks, origin on the hub; they turn about Blender Y (three.js Z)."""
    P = Part("p_windmill_sails")
    P.add(place(cylinder(0.32, 0.4, 10), (0, -0.4, 0), (math.pi / 2, 0, 0)), "timber", WOOD_D, smooth=True)
    for k in range(4):
        a = k * math.pi / 2 + 0.2
        R = Matrix.Rotation(a, 4, "Y")
        stock = cube((0.16, 0.12, 8.6))
        bmesh.ops.translate(stock, vec=V((0, -0.3, 4.3)), verts=stock.verts)
        bmesh.ops.transform(stock, matrix=R, verts=stock.verts)
        P.add(stock, "timber", WOOD)
        frame = bmesh.new()
        for i in range(9):  # bars across
            b = cube((1.6, 0.05, 0.06))
            bmesh.ops.translate(b, vec=V((0.85, -0.32, 1.4 + i * 0.85)), verts=b.verts)
            bmesh.ops.transform(b, matrix=R, verts=b.verts)
            P.add(b, "timber", WOOD)
        for x in (0.1, 1.65):
            b = cube((0.06, 0.05, 7.0))
            bmesh.ops.translate(b, vec=V((x, -0.32, 4.9)), verts=b.verts)
            bmesh.ops.transform(b, matrix=R, verts=b.verts)
            P.add(b, "timber", WOOD)
        cloth = cube((1.5, 0.01, 6.6))
        bmesh.ops.translate(cloth, vec=V((0.88, -0.36, 4.9)), verts=cloth.verts)
        bmesh.ops.transform(cloth, matrix=R, verts=cloth.verts)
        P.add(cloth, "canvas", "#fff8e8")
        frame.free()
    return P.object()


def bridge():
    """A stone road bridge, 18 m end to end and 7 m wide (the game scales the width to the road):
    a cobbled deck on one segmental arch of dressed voussoirs, rubble spandrels, parapets with
    coping and end posts. Origin on the middle of the deck surface; the road runs along Y."""
    P = Part("p_bridge")
    W, L, span, rise, spring = 3.5, 9.0, 6.0, 2.6, -3.4

    def soffit(y):
        return spring if abs(y) >= span else spring + rise * math.sqrt(1 - (y / span) ** 2)
    P.box((0, 0, -0.06), (2 * W - 0.8, 2 * L, 0.12), "cobble", "#ffffff")
    ys = [-L + i * 0.5 for i in range(int(2 * L / 0.5) + 1)]
    for y0, y1 in zip(ys, ys[1:]):
        z0, z1 = soffit(y0), soffit(y1)
        for sx in (-1, 1):
            # spandrel wall from the deck down to the arch, its bottom following the curve
            P.add(hull([(sx * x, y, z) for x in (W - 0.4, W) for y, zb in ((y0, z0), (y1, z1)) for z in (-0.1, zb)]), "stone", "#ffffff")
            if abs((y0 + y1) / 2) < span:  # the ring of voussoirs along the arch's edge
                P.add(hull([(sx * x, y, z) for x in (W - 0.08, W + 0.04) for y, zb in ((y0 + 0.015, z0), (y1 - 0.015, z1)) for z in (zb, zb + 0.45)]), "stone", "#d8ccb4")
        # the vault under the deck
        P.add(hull([(x, y, z) for x in (-W + 0.4, W - 0.4) for y, zb in ((y0, z0), (y1, z1)) for z in (zb, zb + 0.3)]), "stone", "#c8bca4")
    for sx in (-1, 1):
        P.box((sx * (W - 0.2), 0, 0.42), (0.4, 2 * L - 0.6, 0.84), "stone", "#ffffff")
        P.box((sx * (W - 0.2), 0, 0.89), (0.52, 2 * L - 0.4, 0.12), "stone", "#e8e0cc", bevel=0.02)
        for y in (-L + 0.3, L - 0.3):
            P.box((sx * (W - 0.2), y, 0.6), (0.6, 0.6, 1.2), "stone", "#e8e0cc", bevel=0.03)
    return P.object()


# ---------------------------------------------------------------- field dressing (no collision)
def fence():
    """3 m of post-and-rail fence."""
    rng = random.Random(7)
    P = Part("p_fence")
    for x in (-1.5, 0.0, 1.5):
        P.box((x, 0, 0.5), (0.1, 0.1, 1.05), "timber", WOOD, (0, rng.uniform(-0.05, 0.05), 0))
    for z in (0.45, 0.85):
        P.box((0, 0.06, z + rng.uniform(-0.03, 0.03)), (3.1, 0.05, 0.1), "plank", "#e8dcc8", (0, rng.uniform(-0.03, 0.03), 0))
    return P.object()


def haystack():
    """A haystack: a rounded cone of hay on a skirt."""
    P = Part("p_haystack")
    bm = cylinder(1.6, 2.4, 14, r2=0.2)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=2, use_grid_fill=True)
    for v in bm.verts:
        z = v.co.z / 2.4
        r = 1.6 * (1 - z ** 1.6) + 0.15
        d = V((v.co.x, v.co.y, 0))
        if d.length > 1e-4:
            v.co.x, v.co.y = (d.normalized() * r)[:2]
    lumpy(bm, 0.08, 2.0, 3)
    P.add(bm, "hay", "#ffffff", smooth=True)
    return P.object()


def stooks():
    """Three wheat stooks: sheaves stood together in a row."""
    rng = random.Random(8)
    P = Part("p_stooks")
    for k in range(3):
        c = V((-1.6 + k * 1.6 + rng.uniform(-0.2, 0.2), rng.uniform(-0.2, 0.2), 0))
        for s in range(5):
            a = s * TAU / 5
            bm = cylinder(0.14, 1.05, 6, r2=0.09)
            bmesh.ops.rotate(bm, verts=bm.verts, cent=V(), matrix=Matrix.Rotation(0.22, 3, V((math.sin(a), -math.cos(a), 0))))
            P.add(place(bm, c + V((math.cos(a) * 0.18, math.sin(a) * 0.18, 0))), "hay", "#ffffff", smooth=True)
            ear = ico(0.13, 1)
            lumpy(ear, 0.03, 8, k * 10 + s)
            P.add(place(ear, c + V((math.cos(a) * 0.02, math.sin(a) * 0.02, 1.02)), (0, 0, 0), (1, 1, 1.4)), "hay", "#f8ecc0", smooth=True)
    return P.object()


def cabbages():
    """A 3 m row of cabbages (vegetable plots are rows of these)."""
    rng = random.Random(10)
    P = Part("p_cabbages")
    for k in range(7):
        bm = ico(0.2, 1)
        lumpy(bm, 0.05, 7, k)
        P.add(place(bm, (-1.35 + k * 0.45 + rng.uniform(-0.05, 0.05), rng.uniform(-0.04, 0.04), 0.12), (0, 0, rng.uniform(0, 3)), (1, 1, 0.75)),
              "leaf", rng.choice(["#c8e8a8", "#b8d898", "#d0f0b0"]), smooth=True)
    return P.object()


# ---------------------------------------------------------------- build, bake, export
def assets():
    out = {}
    for kind, styles in STYLES.items():
        w, d = SIZES[kind]
        for v, st in enumerate(styles):
            name = f"{kind}_v{v}" if len(styles) > 1 or kind != "f_tavern" else kind
            out[name] = lambda name=name, w=w, d=d, st=st, v=v: house(name, w, d, seed=zlib.crc32(name.encode()) & 0xFFFF, **st)
    out["p_ruin_wall"] = ruin_wall
    out["p_sandbag_wall"] = sandbag_wall
    out["p_sandbag_arc"] = sandbag_arc
    for v in range(2):
        out[f"t_oak_v{v}"] = lambda v=v: deciduous(f"t_oak_v{v}", 9.0, 100 + v, "oak")
        out[f"t_pine_v{v}"] = lambda v=v: conifer(f"t_pine_v{v}", 12.0, 200 + v, "pine")
        out[f"t_spruce_v{v}"] = lambda v=v: conifer(f"t_spruce_v{v}", 13.0, 300 + v, "spruce")
    out["t_birch_v0"] = lambda: deciduous("t_birch_v0", 9.0, 400, "birch")
    out["p_hedge"] = hedge
    for f in (barricade, hedgehog, wire, crate, drum, tent, bunker, watchtower, windmill_body, windmill_sails, bridge, fence, haystack, stooks, cabbages):
        out["p_" + f.__name__ if not f.__name__.startswith("windmill") else "p_" + f.__name__] = f
    return out


def bake_ao(ob, distance):
    """Ambient occlusion into the vertex colours (the ground plane below adds contact shadows)."""
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 24
    sc.render.bake.target = "VERTEX_COLORS"
    if not sc.world:
        sc.world = bpy.data.worlds.new("bake")
    sc.world.light_settings.distance = distance
    me = ob.data
    ca = me.color_attributes.new("ao", "BYTE_COLOR", "CORNER")
    me.color_attributes.active_color = ca
    for o in bpy.data.objects:
        o.hide_render = o is not ob and o.name != "bake_ground"
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.bake(type="AO")


def finish(ob, distance):
    """Bake, then fold surface ids into TEXCOORD_0 and tint x occlusion into COLOR_0."""
    bake_ao(ob, distance)
    me = ob.data
    ao = me.color_attributes["ao"].data
    col = me.color_attributes.new("Col", "BYTE_COLOR", "CORNER")
    uv = me.uv_layers.new(name="UVMap")
    for p in me.polygons:
        m = me.materials[p.material_index]
        s = SURF[m["surface"]]
        t = hexc(m["tint"])
        for li in p.loop_indices:
            a = ao[li].color[0]
            k = 0.45 + 0.55 * a  # occlusion as a soft wash, never black
            col.data[li].color = (t[0] * k, t[1] * k, t[2] * k, 1.0)
            uv.data[li].uv = (s + 0.5, 0.5)
    me.color_attributes.remove(me.color_attributes["ao"])
    me.color_attributes.active_color = me.color_attributes["Col"]
    me.materials.clear()
    me.materials.append(bpy.data.materials.get("M_env") or bpy.data.materials.new("M_env"))


def main():
    ground = bpy.data.objects.new("bake_ground", bpy.data.meshes.new("bake_ground"))
    bm = cube((60, 60, 0.02))
    bmesh.ops.translate(bm, vec=V((0, 0, -0.01)), verts=bm.verts)
    bm.to_mesh(ground.data)
    bm.free()
    COL.objects.link(ground)
    holders = []
    for name, build in assets().items():
        if ONLY and name not in ONLY:
            continue
        ob = build()
        dist = 1.4 if name.startswith("f_") else 1.2 if name.startswith("t_") else 0.35
        finish(ob, dist)
        holder = bpy.data.objects.new(name, None)
        COL.objects.link(holder)
        ob.parent = holder
        holders.append((holder, ob))
        tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
        print(f"ASSET {name}: {tris} triangles")
    bpy.data.objects.remove(ground, do_unlink=True)
    if PREVIEW:
        preview(holders)
    if OUT:
        bpy.ops.object.select_all(action="DESELECT")
        for h, ob in holders:
            h.select_set(True)
            ob.select_set(True)
        bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=True, export_yup=True, export_apply=False,
                                  export_vertex_color="ACTIVE", export_texcoords=True, export_normals=True, export_materials="PLACEHOLDER",
                                  export_animations=False, export_cameras=False, export_lights=False)
        print("EXPORTED", OUT, len(holders), "assets")


def preview(holders):
    """Workbench renders of each asset with its vertex colours (shape and occlusion, no surface tiles)."""
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.display.shading.light = "STUDIO"
    sc.display.shading.color_type = "VERTEX"
    sc.display.shading.show_cavity = True
    sc.render.resolution_x = sc.render.resolution_y = 600
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    COL.objects.link(cam)
    sc.camera = cam
    for h, ob in holders:
        for _, o in holders:
            o.hide_render = o is not ob
        bb = [ob.matrix_world @ V(c) for c in ob.bound_box]
        size = max((max(p[i] for p in bb) - min(p[i] for p in bb)) for i in range(3))
        c = sum(bb, V()) / 8
        cam.data.type = "ORTHO"
        cam.data.ortho_scale = size * 1.3
        a = math.radians(35)
        cam.location = c + V((math.sin(a) * 30, -math.cos(a) * 30, 14))
        cam.rotation_euler = (c - cam.location).to_track_quat("-Z", "Y").to_euler()
        sc.render.filepath = os.path.join(PREVIEW, f"{h.name}.png")
        bpy.ops.render.render(write_still=True)


main()
