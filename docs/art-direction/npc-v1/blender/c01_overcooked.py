"""C01 (Café hero) in an Overcooked-like style: chunky proportions (~3.5 heads), big head,
mitten hands, rounded soft forms, flat saturated colours.  Z-up, front = -Y, metres, origin
on the ground between the feet, height ~1.75 m.  Rigid-part hierarchy of empties so the pose
can be changed later (rig: root > hips > spine > neck > head, shoulder > elbow > wrist > hand,
hip > knee > ankle > foot).

Run inside Blender:  exec(open(path).read())
"""
import math
import bpy
import bmesh
from mathutils import Vector, Matrix

ROOT_NAME = "NPC_C01"
COL_NAME = "NPC_C01_SOURCE"


# ---------------------------------------------------------------- materials
def srgb(h):
    h = h.lstrip("#")
    r, g, b = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    f = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (f(r), f(g), f(b), 1.0)


_mats = {}


def mat(name, hex_, rough=0.62):
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = srgb(hex_)
    bsdf.inputs["Roughness"].default_value = rough
    for k in ("Specular IOR Level", "Specular"):
        if k in bsdf.inputs:
            bsdf.inputs[k].default_value = 0.15
    _mats[name] = m
    return m


def striped_mat(name, base_hex, stripe_hex, scale=26.0, width=0.22):
    """Vertical stripes on object-space X."""
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = 0.7
    for k in ("Specular IOR Level", "Specular"):
        if k in bsdf.inputs:
            bsdf.inputs[k].default_value = 0.1
    tc = nt.nodes.new("ShaderNodeTexCoord")
    wave = nt.nodes.new("ShaderNodeTexWave")
    wave.wave_type = "BANDS"
    wave.bands_direction = "X"
    wave.wave_profile = "SAW"
    wave.inputs["Scale"].default_value = scale
    wave.inputs["Distortion"].default_value = 0.0
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "CONSTANT"
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = srgb(base_hex)
    ramp.color_ramp.elements[1].position = 1.0 - width
    ramp.color_ramp.elements[1].color = srgb(stripe_hex)
    nt.links.new(tc.outputs["Object"], wave.inputs["Vector"])
    nt.links.new(wave.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    _mats[name] = m
    return m


PAL = {
    "skin": "#E39E6E",
    "skin_dark": "#C9825A",
    "hair": "#2A2422",
    "beard": "#33343A",
    "cap": "#25262B",
    "cap_dark": "#191A1E",
    "shirt": "#4C79B4",
    "shirt_stripe": "#B9CDE8",
    "shirt_dark": "#3F6699",
    "under": "#E8DCC2",
    "button": "#EFE6D3",
    "pants": "#3B3C41",
    "cuff": "#6A6B70",
    "shoe_upper": "#26272C",
    "shoe_sole": "#EFE6D3",
    "lace": "#F5EEDD",
    "cup": "#C99A62",
    "cup_sleeve": "#8E6A3F",
    "lid": "#232328",
    "mouth": "#7A3B32",
    "eye": "#1B1B1F",
    "lens": "#D9E4EC",
}


# ---------------------------------------------------------------- scene helpers
def get_col():
    c = bpy.data.collections.get(COL_NAME)
    if c:
        for o in list(c.objects):
            bpy.data.objects.remove(o, do_unlink=True)
        for me in [m for m in bpy.data.meshes if m.users == 0]:
            bpy.data.meshes.remove(me)
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
    e.empty_display_size = 0.06
    col.objects.link(e)
    world = Vector(world)
    if parent:
        e.parent = objs[parent]
        e.location = world - pos[parent]
    else:
        e.location = world
    pos[name] = world
    objs[name] = e
    return e


class Part:
    """Accumulates primitives (world coordinates) into one mesh under an empty."""

    def __init__(self, name, parent, material):
        self.name, self.parent, self.material = name, parent, material
        self.bm = bmesh.new()

    # -- primitives ------------------------------------------------------
    def _tail(self, before):
        return [v for v in self.bm.verts if v not in before]

    def _finish_prim(self, start, c, rot):
        new = self._tail(start)
        R = Matrix.Identity(3)
        if rot:
            R = (Matrix.Rotation(math.radians(rot[2]), 3, "Z")
                 @ Matrix.Rotation(math.radians(rot[1]), 3, "Y")
                 @ Matrix.Rotation(math.radians(rot[0]), 3, "X"))
        for v in new:
            v.co = R @ v.co + Vector(c)
        return new

    def _bevel(self, verts, r, seg):
        edges = list({e for v in verts for e in v.link_edges})
        bmesh.ops.bevel(self.bm, geom=edges, offset=r, offset_type="OFFSET",
                        segments=seg, profile=0.5, affect="EDGES")

    def box(self, c, s, r=0.02, seg=3, rot=None):
        bm = self.bm
        start = set(bm.verts)
        res = bmesh.ops.create_cube(bm, size=1.0)
        for v in res["verts"]:
            v.co = Vector((v.co.x * s[0], v.co.y * s[1], v.co.z * s[2]))
        r = min(r, min(s) / 2 * 0.95)
        if r > 0:
            self._bevel(res["verts"], r, seg)
        return self._finish_prim(start, c, rot)

    def sphere(self, c, radii, u=20, v=12, rot=None):
        bm = self.bm
        start = set(bm.verts)
        res = bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=1.0)
        for vt in res["verts"]:
            vt.co = Vector((vt.co.x * radii[0], vt.co.y * radii[1], vt.co.z * radii[2]))
        return self._finish_prim(start, c, rot)

    def cyl(self, c, r_bot, r_top, h, seg=20, bevel=0.01, rot=None):
        bm = self.bm
        start = set(bm.verts)
        res = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg,
                                    radius1=r_bot, radius2=r_top, depth=h)
        if bevel > 0:
            # bevel only the cap rims; bevelling the vertical seams gives ridged sides
            rim = list({e for v in res["verts"] for e in v.link_edges
                        if abs(e.verts[0].co.z - e.verts[1].co.z) < 1e-6})
            b = min(bevel, h / 2 * 0.9, min(r_bot, r_top) * 0.9)
            bmesh.ops.bevel(self.bm, geom=rim, offset=b, offset_type="OFFSET",
                            segments=2, profile=0.5, affect="EDGES")
        return self._finish_prim(start, c, rot)

    def cut(self, prim_verts, plane_co, plane_no):
        """Remove the part of a primitive on the -normal side of a plane."""
        faces = list({f for v in prim_verts if v.is_valid for f in v.link_faces})
        edges = list({e for f in faces for e in f.edges})
        verts = list({v for e in edges for v in e.verts})
        bmesh.ops.bisect_plane(self.bm, geom=verts + edges + faces, dist=1e-5,
                               plane_co=plane_co, plane_no=plane_no, clear_inner=True)

    # -- output ----------------------------------------------------------
    def done(self, smooth=True):
        bm = self.bm
        off = pos[self.parent]
        for v in bm.verts:
            v.co -= off
        mesh = bpy.data.meshes.new(self.name)
        bm.to_mesh(mesh)
        bm.free()
        for p in mesh.polygons:
            p.use_smooth = smooth
        mesh.materials.append(self.material)
        o = bpy.data.objects.new(self.name, mesh)
        col.objects.link(o)
        o.parent = objs[self.parent]
        if smooth:
            wn = o.modifiers.new("WeightedNormal", "WEIGHTED_NORMAL")
            wn.keep_sharp = True
        objs[self.name] = o
        return o


# ---------------------------------------------------------------- rig skeleton
def build_rig():
    emp(ROOT_NAME, (0, 0, 0))
    emp("hips", (0, 0, 0.66), ROOT_NAME)
    emp("spine", (0, 0, 0.66), "hips")
    emp("neck", (0, 0, 1.04), "spine")
    emp("head", (0, 0, 1.13), "neck")
    for side, sx in (("L", 1), ("R", -1)):
        emp(f"shoulder_{side}", (sx * 0.27, 0, 0.98), "spine")
        emp(f"elbow_{side}", (sx * 0.27, 0, 0.72), f"shoulder_{side}")
        emp(f"wrist_{side}", (sx * 0.27, 0, 0.51), f"elbow_{side}")
        emp(f"hip_{side}", (sx * 0.115, 0, 0.66), "hips")
        emp(f"knee_{side}", (sx * 0.115, 0, 0.40), f"hip_{side}")
        emp(f"ankle_{side}", (sx * 0.115, 0, 0.115), f"knee_{side}")


# ---------------------------------------------------------------- body
def build_body():
    skin = mat("M_skin", PAL["skin"], 0.7)
    skin_d = mat("M_skin_dark", PAL["skin_dark"], 0.7)

    # head H01 - chunky rounded block
    p = Part("head_H01", "head", skin)
    p.box((0, 0, 1.38), (0.54, 0.50, 0.50), r=0.13, seg=5)
    p.sphere((0.276, 0.0, 1.36), (0.024, 0.04, 0.05))     # ears
    p.sphere((-0.276, 0.0, 1.36), (0.024, 0.04, 0.05))
    p.box((0, -0.262, 1.325), (0.055, 0.06, 0.085), r=0.02)  # nose
    p.done()

    p = Part("neck", "neck", skin_d)
    p.cyl((0, 0, 1.10), 0.075, 0.07, 0.12, bevel=0.012)
    p.done()

    # face details
    p = Part("face_eyes", "head", mat("M_eye", PAL["eye"], 0.4))
    for sx in (-1, 1):
        p.sphere((sx * 0.105, -0.247, 1.375), (0.026, 0.016, 0.034))
        p.box((sx * 0.105, -0.258, 1.475), (0.14, 0.03, 0.05), r=0.012,
              rot=(0, sx * -8, 0))                        # brows
    p.done()

    # arms
    for side, sx in (("L", 1), ("R", -1)):
        p = Part(f"arm_{side}_upper", f"shoulder_{side}", skin)
        p.cyl((sx * 0.27, 0, 0.845), 0.056, 0.058, 0.26, bevel=0.015)
        p.done()
        p = Part(f"arm_{side}_lower", f"elbow_{side}", skin)
        p.sphere((sx * 0.27, 0, 0.72), (0.06, 0.06, 0.06))
        p.cyl((sx * 0.27, 0, 0.615), 0.05, 0.056, 0.22, bevel=0.012)
        p.done()
        p = Part(f"hand_{side}", f"wrist_{side}", skin)
        p.box((sx * 0.27, 0, 0.475), (0.10, 0.09, 0.105), r=0.035, seg=4)   # mitten
        p.box((sx * 0.27 - sx * 0.065, -0.035, 0.485), (0.05, 0.055, 0.075), r=0.02,
              rot=(0, sx * 10, 0))                                            # thumb
        p.done()

    # pelvis + legs (pants)
    pants = mat("M_pants", PAL["pants"], 0.75)
    cuff = mat("M_cuff", PAL["cuff"], 0.75)
    p = Part("pants_P01_pelvis", "hips", pants)
    p.box((0, 0, 0.69), (0.41, 0.28, 0.16), r=0.06, seg=4)
    p.done()
    for side, sx in (("L", 1), ("R", -1)):
        p = Part(f"pants_P01_thigh_{side}", f"hip_{side}", pants)
        p.cyl((sx * 0.115, 0, 0.53), 0.098, 0.108, 0.26, bevel=0.02)
        p.done()
        p = Part(f"pants_P01_shin_{side}", f"knee_{side}", pants)
        p.sphere((sx * 0.115, 0, 0.40), (0.10, 0.10, 0.10))
        p.cyl((sx * 0.115, 0, 0.275), 0.098, 0.098, 0.24, bevel=0.02)
        p.done()
        p = Part(f"pants_P01_cuff_{side}", f"ankle_{side}", cuff)
        p.cyl((sx * 0.115, 0, 0.155), 0.113, 0.113, 0.06, bevel=0.018)
        p.done()


# ---------------------------------------------------------------- clothing
def build_top():
    shirt = striped_mat("M_shirt_stripe", PAL["shirt"], PAL["shirt_stripe"], scale=22.0, width=0.22)
    shirt_d = mat("M_shirt_dark", PAL["shirt_dark"], 0.75)
    under = mat("M_under", PAL["under"], 0.8)
    button = mat("M_button", PAL["button"], 0.5)

    p = Part("top_T01_undershirt", "spine", under)
    p.box((0, 0, 0.865), (0.40, 0.25, 0.42), r=0.07, seg=4)
    p.done()

    p = Part("top_T01_overshirt", "spine", shirt)
    h, z = 0.44, 0.855
    p.box((0.138, 0, z), (0.185, 0.29, h), r=0.035)              # front-left panel + side
    p.box((-0.138, 0, z), (0.185, 0.29, h), r=0.035)             # front-right panel
    p.box((0, 0.118, z), (0.45, 0.056, h), r=0.03)               # back panel
    # shoulder yoke so the top is closed
    p.box((0, 0.0, 1.045), (0.45, 0.29, 0.06), r=0.03)
    # collar wings
    p.box((0.075, -0.115, 1.06), (0.12, 0.05, 0.06), r=0.015, rot=(-25, 0, -20))
    p.box((-0.075, -0.115, 1.06), (0.12, 0.05, 0.06), r=0.015, rot=(-25, 0, 20))
    p.done()

    p = Part("top_T01_details", "spine", shirt_d)
    p.box((0.155, -0.150, 0.93), (0.075, 0.014, 0.08), r=0.005, seg=2)   # chest pocket
    p.box((0, 0.155, 1.0), (0.44, 0.012, 0.02), r=0.005, seg=2)          # yoke seam
    p.done()

    p = Part("top_T01_buttons", "spine", button)
    for z in (0.98, 0.86, 0.74, 0.65):
        p.cyl((-0.10, -0.152, z), 0.017, 0.017, 0.012, seg=12, bevel=0.003, rot=(90, 0, 0))
    p.done()

    for side, sx in (("L", 1), ("R", -1)):
        p = Part(f"top_T01_sleeve_{side}", f"shoulder_{side}", shirt)
        p.sphere((sx * 0.265, 0, 0.99), (0.115, 0.115, 0.105))
        p.cyl((sx * 0.27, 0, 0.895), 0.098, 0.106, 0.17, bevel=0.02)
        p.done()


def build_shoes():
    black = mat("M_shoe_upper", PAL["shoe_upper"], 0.7)
    sole = mat("M_shoe_sole", PAL["shoe_sole"], 0.55)
    lace = mat("M_lace", PAL["lace"], 0.6)
    for side, sx in (("L", 1), ("R", -1)):
        cx, cy = sx * 0.115, -0.045
        p = Part(f"shoes_S01_sole_{side}", f"ankle_{side}", sole)
        p.box((cx, cy, 0.03), (0.165, 0.335, 0.06), r=0.028, seg=3)
        p.box((cx, cy - 0.125, 0.09), (0.14, 0.11, 0.075), r=0.032, seg=3)   # toe cap
        p.done()
        p = Part(f"shoes_S01_upper_{side}", f"ankle_{side}", black)
        p.box((cx, cy + 0.02, 0.10), (0.145, 0.25, 0.10), r=0.04, seg=3)
        p.cyl((cx, cy + 0.075, 0.155), 0.078, 0.078, 0.06, bevel=0.015)       # ankle collar
        p.done()
        p = Part(f"shoes_S01_laces_{side}", f"ankle_{side}", lace)
        for i, y in enumerate((-0.05, -0.09, -0.13)):
            p.box((cx, cy + 0.0 + (y + 0.045), 0.152 - i * 0.008), (0.10, 0.016, 0.014),
                  r=0.005, seg=2, rot=(-12, 0, 0))
        p.done()


# ---------------------------------------------------------------- head gear
def build_headgear():
    cap = mat("M_cap", PAL["cap"], 0.8)
    hair = mat("M_hair", PAL["hair"], 0.8)
    beard = mat("M_beard", PAL["beard"], 0.85)
    frame = mat("M_glasses", PAL["cap_dark"], 0.35)
    mouth = mat("M_mouth", PAL["mouth"], 0.6)

    # hair R04_cap - short crop visible under the cap
    p = Part("hair_R04_cap", "head", hair)
    p.box((0, 0.035, 1.415), (0.552, 0.44, 0.11), r=0.045)
    p.box((0, 0.16, 1.315), (0.552, 0.21, 0.33), r=0.05)              # nape
    p.box((0.281, -0.10, 1.41), (0.02, 0.12, 0.11), r=0.008, seg=2)   # sideburns
    p.box((-0.281, -0.10, 1.41), (0.02, 0.12, 0.11), r=0.008, seg=2)
    p.done()

    # beard B02 + moustache
    p = Part("beard_B02", "head", beard)
    p.box((0, -0.015, 1.22), (0.556, 0.49, 0.185), r=0.07, seg=4)
    p.box((0, -0.262, 1.29), (0.17, 0.06, 0.05), r=0.02, seg=3)
    p.box((0, -0.255, 1.165), (0.20, 0.10, 0.12), r=0.04, seg=3)        # chin tuft
    p.done()
    p = Part("beard_B02_mouth", "head", mouth)
    p.box((0, -0.286, 1.255), (0.07, 0.012, 0.02), r=0.006, seg=2)
    p.done()

    # glasses G01 - thick rectangular frames
    p = Part("glasses_G01", "head", frame)
    y = -0.268
    for sx in (-1, 1):
        cx = sx * 0.108
        w, h, t, d = 0.185, 0.145, 0.03, 0.026
        p.box((cx, y, 1.375 + h / 2 - t / 2), (w, d, t), r=0.008, seg=2)
        p.box((cx, y, 1.375 - h / 2 + t / 2), (w, d, t), r=0.008, seg=2)
        p.box((cx - w / 2 + t / 2, y, 1.375), (t, d, h), r=0.008, seg=2)
        p.box((cx + w / 2 - t / 2, y, 1.375), (t, d, h), r=0.008, seg=2)
        p.box((sx * 0.247, -0.262, 1.40), (0.11, 0.026, 0.028), r=0.008, seg=2)  # hinge
        p.box((sx * 0.284, -0.17, 1.40), (0.02, 0.19, 0.028), r=0.008, seg=2)    # temple arm
    p.box((0, y, 1.40), (0.04, 0.024, 0.026), r=0.008, seg=2)                  # bridge
    p.done()

    # cap A01
    p = Part("hat_A01_cap", "head", cap)
    p.box((0, 0.015, 1.585), (0.60, 0.565, 0.325), r=0.15, seg=5)            # crown
    p.sphere((0, 0.01, 1.745), (0.032, 0.032, 0.02), u=12, v=8)              # top button
    brim = p.sphere((0, -0.235, 1.46), (0.225, 0.31, 0.042), u=28, v=10, rot=(11, 0, 0))
    p.cut(brim, (0, -0.235, 1.46), (0, -1, 0))
    p.done()


# ---------------------------------------------------------------- props + pose
def build_cup():
    cup = mat("M_cup", PAL["cup"], 0.65)
    sleeve = mat("M_cup_sleeve", PAL["cup_sleeve"], 0.7)
    lid = mat("M_lid", PAL["lid"], 0.5)
    pos["cup"] = Vector((-0.27, -0.18, 0.86))
    e = emp("cup", pos["cup"], ROOT_NAME)
    p = Part("prop_cup_body", "cup", cup)
    c = pos["cup"]
    p.cyl((c.x, c.y, c.z), 0.046, 0.058, 0.15, seg=24, bevel=0.008)
    p.done()
    p = Part("prop_cup_sleeve", "cup", sleeve)
    p.cyl((c.x, c.y, c.z), 0.050, 0.053, 0.06, seg=24, bevel=0.004)
    p.done()
    p = Part("prop_cup_lid", "cup", lid)
    p.cyl((c.x, c.y, c.z + 0.085), 0.062, 0.062, 0.03, seg=24, bevel=0.01)
    p.cyl((c.x, c.y, c.z + 0.108), 0.045, 0.05, 0.02, seg=24, bevel=0.006)
    p.done()


def pose():
    def rot(name, x=0, y=0, z=0):
        objs[name].rotation_euler = (math.radians(x), math.radians(y), math.radians(z))
    # R (screen-left) holds the cup, L keeps a hand near the pocket
    rot("shoulder_R", x=-28, y=-10)
    rot("elbow_R", x=-62, y=-14)
    rot("wrist_R", x=0)
    rot("shoulder_L", x=8, y=-4)
    rot("elbow_L", x=-10, y=14)
    rot("head", z=-7)
    rot("hips", z=2)
    rot("hip_L", x=-4)
    rot("hip_R", x=4)
    rot("ankle_L", z=-7)
    rot("ankle_R", z=8)
    bpy.context.view_layer.update()
    # cup rides in the right hand (world-anchored to the hand, upright)
    cup = objs["cup"]
    hand = objs["wrist_R"]
    tgt = hand.matrix_world @ Vector((0.0, 0.0, -0.035))    # centre of the fist
    cup.parent = hand
    cup.matrix_parent_inverse = hand.matrix_world.inverted()
    cup.matrix_world = Matrix.Translation(tgt)
    bpy.context.view_layer.update()


def build_all():
    build_rig()
    build_body()
    build_top()
    build_shoes()
    build_headgear()
    build_cup()
    pose()


build_all()
