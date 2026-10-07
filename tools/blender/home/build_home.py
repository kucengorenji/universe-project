"""Build original cozy furniture with textured UVs, three LODs and editable source.

Run in a new Blender background process. Outputs belong exclusively to this kit.
"""
import bpy
import bmesh
import json
import math
import random
import struct
import sys
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[3]
WORK = ROOT / 'tools/blender/home'
SOURCE = WORK / 'source'
TEXTURES = WORK / 'textures'
QA = WORK / 'qa'
OUT = ROOT / 'public/models/home_cozy.glb'
for folder in (SOURCE, TEXTURES, QA):
    folder.mkdir(parents=True, exist_ok=True)

SEED = 41026
MATS = {}
SPECS = {}
LOD = 0
PARTS = []


def atlas():
    """Lossless original 4x4 painted multiplier atlas; no external image inputs."""
    n = 1024
    rng = random.Random(SEED)
    image = bpy.data.images.new('home_painted_atlas', width=n, height=n, alpha=False)
    pixels = [1.0] * (n * n * 4)
    for y in range(n):
        for x in range(n):
            tx, ty = x // 256, y // 256
            u, v = (x % 256) / 255, (y % 256) / 255
            slot = tx + ty * 4
            grain = (rng.random() - .5) * .06
            broad = .025 * math.sin(u * 13 + math.sin(v * 5)) * math.cos(v * 9)
            val = .91 + grain + broad
            if slot in (0, 1):
                val += .026 * math.sin(v * 80 + math.sin(u * 14) * 2)
                val -= .028 * (abs(math.sin(v * math.pi * 4)) < .04)
            elif slot in (2, 3, 12, 13):
                val += .028 * math.sin(u * 300) * math.sin(v * 300)
                if slot in (3, 13): val -= .08 * (abs(math.sin(u * math.pi * 5)) < .16)
            elif slot == 5:
                row = int(v * 5)
                mortar = v * 5 % 1 < .055 or (u * 3 + (row % 2) * .5) % 1 < .035
                val = .75 if mortar else .94 + grain + broad
            elif slot == 6:
                val -= .11 * (v * 4 % 1 < .05)
                val += .035 * math.cos(u * math.pi * 10)
            elif slot == 7:
                val -= .06 * abs(math.sin(u * 16 + v * 18))
            elif slot == 10:
                val -= .05 * (u * 11 % 1 < .04)
            elif slot == 14:
                val += .035 * math.sin(u * 30 + v * 16)
            val = max(.64, min(1, val))
            i = (y * n + x) * 4
            pixels[i:i + 4] = [val, val, val, 1]
    image.pixels.foreach_set(pixels)
    image.filepath_raw = str(TEXTURES / 'home_painted_atlas.png')
    image.file_format = 'PNG'
    image.save()
    image.pack()
    return image


def material(name, color, slot, image):
    m = bpy.data.materials.new('HOME_' + name)
    m.use_nodes = True
    m.diffuse_color = (*color, 1)
    m['atlasSlot'] = slot
    nodes, links = m.node_tree.nodes, m.node_tree.links
    bs = nodes.get('Principled BSDF')
    bs.inputs['Roughness'].default_value = .84
    tx = nodes.new('ShaderNodeTexImage')
    tx.image = image
    mix = nodes.new('ShaderNodeMixRGB')
    mix.blend_type = 'MULTIPLY'
    mix.inputs[0].default_value = 1
    mix.inputs[2].default_value = (*color, 1)
    links.new(tx.outputs['Color'], mix.inputs[1])
    links.new(mix.outputs[0], bs.inputs['Base Color'])
    MATS[name] = m
    return m


def init_materials(image):
    for args in [
        ('oak', (.40, .24, .12), 0), ('oak_light', (.64, .43, .24), 1),
        ('linen', (.73, .64, .47), 2), ('sage', (.27, .42, .27), 2),
        ('rose', (.58, .29, .24), 3), ('cream', (.82, .75, .61), 11),
        ('porcelain', (.86, .86, .79), 4), ('brick', (.55, .28, .18), 5),
        ('terracotta', (.60, .32, .17), 6), ('leaf', (.24, .43, .19), 7),
        ('glass', (.39, .64, .68), 8), ('stone', (.49, .46, .38), 9),
        ('book_ochre', (.64, .44, .19), 10), ('book_blue', (.23, .38, .46), 10),
        ('rug', (.52, .27, .23), 12), ('rug_edge', (.77, .60, .35), 13),
        ('paper', (.89, .84, .69), 14), ('dark', (.13, .16, .15), 15)
    ]:
        material(*args, image)


def uv_project(obj, mat):
    mesh = obj.data
    uv = mesh.uv_layers.new(name='UVMap') if not mesh.uv_layers else mesh.uv_layers.active
    slot = int(mat['atlasSlot'])
    x, y = slot % 4, slot // 4
    # Eight pixels around each tile keep material borders out of mip levels used nearby.
    lo, span = 8 / 256, 240 / 256
    for poly in mesh.polygons:
        axis = max(range(3), key=lambda a: abs(poly.normal[a]))
        axes = [a for a in range(3) if a != axis]
        a, b = axes
        for li in poly.loop_indices:
            p = mesh.vertices[mesh.loops[li].vertex_index].co
            uu, vv = (p[a] * .55 + .5) % 1, (p[b] * .55 + .5) % 1
            uv.data[li].uv = ((x + lo + uu * span) / 4, (y + lo + vv * span) / 4)


def finish(obj, mat, smooth=False):
    obj.data.materials.append(MATS[mat])
    for p in obj.data.polygons: p.use_smooth = smooth
    uv_project(obj, MATS[mat])
    PARTS.append(obj)
    return obj


def box(mat, loc, size, bevel=.035, rotation=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    obj = bpy.context.object
    obj.name = mat + '_rounded'
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0:
        mod = obj.modifiers.new('Authored rounded edge', 'BEVEL')
        mod.width = min(bevel, min(size) * .42)
        mod.segments = [3, 2, 1][LOD]
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
        norm = obj.modifiers.new('Weighted surface normals', 'WEIGHTED_NORMAL')
        norm.keep_sharp = True
        bpy.ops.object.modifier_apply(modifier=norm.name)
    if rotation: obj.rotation_euler = rotation
    return finish(obj, mat, True)


def sphere(mat, loc, size, segments=20):
    seg = max(8, int(segments * [1, .7, .45][LOD]))
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=max(5, seg // 2), radius=1, location=loc)
    obj = bpy.context.object
    obj.scale = tuple(s / 2 for s in size)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(obj, mat, True)


def lathe(mat, loc, profile, seg=20):
    seg = max(8, int(seg * [1, .65, .4][LOD]))
    vertices, faces = [], []
    for r, z in profile:
        for i in range(seg):
            a = i * math.tau / seg
            vertices.append((r * math.cos(a), r * math.sin(a), z))
    for j in range(len(profile) - 1):
        for i in range(seg):
            k = j * seg + i
            faces.append((k, j * seg + (i + 1) % seg, (j + 1) * seg + (i + 1) % seg, k + seg))
    faces.append(tuple(reversed(range(seg))))
    faces.append(tuple((len(profile) - 1) * seg + i for i in range(seg)))
    mesh = bpy.data.meshes.new('turned_profile')
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new('turned_profile', mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = loc
    return finish(obj, mat, True)


def pipe(mat, points, radius=.012, closed=False):
    curve = bpy.data.curves.new('detail_piping', 'CURVE')
    curve.dimensions = '3D'
    curve.resolution_u = 1
    curve.bevel_depth = radius
    curve.bevel_resolution = [2, 1, 0][LOD]
    poly = curve.splines.new('POLY')
    poly.points.add(len(points) - 1)
    for p, xyz in zip(poly.points, points): p.co = (*xyz, 1)
    poly.use_cyclic_u = closed
    obj = bpy.data.objects.new('detail_piping', curve)
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target='MESH')
    obj.select_set(False)
    return finish(bpy.context.object, mat, True)


def leg(x, y, height, radius=.045, mat='oak'):
    return lathe(mat, (x, y, 0), [(radius * .8, 0), (radius * .8, .03), (radius, .06), (radius * .7, height * .55), (radius, height)])


def cushion(mat, x, y, z, w, d, h):
    box(mat, (x, y, z), (w, d, h), min(h * .40, .075))
    if LOD == 0:
        pipe('linen', [(x - w * .45, y - d * .43, z), (x + w * .45, y - d * .43, z),
                      (x + w * .45, y + d * .43, z), (x - w * .45, y + d * .43, z)], .007, True)


def sofa():
    for x in (-.82, .82):
        for y in (-.28, .28): leg(x, y, .19, .052)
    box('sage', (0, 0, .30), (1.89, .77, .30), .095)
    box('sage', (0, .32, .67), (1.87, .20, .54), .08)
    for x in (-.91, .91): box('sage', (x, -.01, .58), (.24, .83, .56), .10)
    for x in (-.51, 0, .51):
        cushion('linen', x, -.10, .51, .49, .62, .16)
        cushion('sage', x, .21, .73, .48, .20, .34)
    if LOD < 2:
        sphere('rose', (-.67, .05, .70), (.31, .16, .29))
        sphere('linen', (.68, .05, .70), (.29, .15, .27))


def chair():
    for x in (-.18, .18):
        for y in (-.18, .18): leg(x, y, .46, .035)
    box('oak_light', (0, 0, .46), (.46, .46, .065), .025)
    cushion('rose', 0, -.015, .50, .39, .38, .065)
    for x in (-.19, .19): box('oak', (x, .19, .68), (.045, .045, .44), .016)
    box('oak_light', (0, .19, .84), (.43, .05, .12), .035)
    if LOD < 2:
        for x in (-.11, 0, .11): box('oak_light', (x, .19, .67), (.027, .034, .25), .01)


def table():
    for x in (-.54, .54):
        for y in (-.29, .29): leg(x, y, .72, .055)
    box('oak', (0, 0, .65), (1.24, .67, .12), .018)
    box('oak_light', (0, 0, .755), (1.40, .85, .065), .035)
    if LOD == 0:
        for x in (-.28, .28): box('oak', (x, 0, .789), (.008, .77, .003), .001)


def bed():
    box('oak', (0, 0, .24), (1.54, 2.05, .26), .05)
    for x in (-.70, .70):
        for y in (-.96, .96): leg(x, y, .36, .075)
    cushion('linen', 0, -.01, .43, 1.48, 1.95, .21)
    box('oak_light', (0, 1.01, .63), (1.60, .12, .63), .06)
    box('sage', (0, 1.015, .68), (1.38, .14, .35), .065)
    cushion('rose', 0, -.28, .55, 1.49, 1.28, .09)
    for x in (-.38, .38): sphere('porcelain', (x, .63, .60), (.63, .41, .15))
    if LOD < 2:
        box('rug_edge', (0, -.38, .60), (1.49, .12, .025), .008)


def knob(x, y, z):
    if LOD < 2: sphere('terracotta', (x, y, z), (.055, .035, .055), 12)


def wardrobe():
    box('oak', (0, 0, .99), (1.0, .53, 1.81), .042)
    box('oak_light', (0, 0, 1.90), (1.10, .60, .08), .03)
    box('oak_light', (0, 0, .09), (1.08, .57, .12), .028)
    for x in (-.245, .245):
        box('cream', (x, -.285, 1.02), (.465, .055, 1.64), .02)
        if LOD < 2:
            for z in (.54, 1.35): box('oak_light', (x, -.322, z), (.36, .025, .61), .025)
        knob(x * .25, -.33, .98)


def shelf():
    box('oak', (0, .12, .88), (.88, .09, 1.70), .028)
    for x in (-.42, .42): box('oak_light', (x, 0, .85), (.07, .32, 1.70), .023)
    for z in (.07, .47, .87, 1.27, 1.67): box('oak_light', (0, 0, z), (.88, .33, .065), .022)
    if LOD < 2:
        rng = random.Random(SEED)
        for row, z in enumerate((.17, .57, .97, 1.37)):
            for i in range(5):
                x = -.30 + i * .115
                h = .19 + rng.random() * .10
                box('book_blue' if (i + row) % 2 else 'book_ochre', (x, -.055, z + h / 2), (.075, .18, h), .009)


def kitchen():
    box('cream', (0, .01, .49), (1.80, .58, .88), .03)
    box('oak', (0, -.04, .12), (1.80, .53, .12), .018)
    box('stone', (0, 0, .94), (1.85, .64, .065), .022)
    for x in (-.57, 0, .57):
        box('sage', (x, -.30, .50), (.52, .045, .72), .022)
        knob(x, -.335, .77)
    if LOD < 2:
        for x in (-.65, -.38):
            for y in (-.14, .13): lathe('dark', (x, y, .975), [(.095, 0), (.095, .009)], 16)
        lathe('porcelain', (.45, 0, .977), [(.14, 0), (.16, .015), (.15, .022)], 24)


def sink():
    box('cream', (0, 0, .45), (.59, .46, .84), .04)
    box('sage', (0, -.245, .44), (.50, .045, .66), .025)
    knob(0, -.274, .68)
    box('porcelain', (0, 0, .89), (.65, .52, .065), .045)
    if LOD < 2:
        lathe('porcelain', (0, -.01, .91), [(.18, 0), (.16, -.045), (.09, -.07)], 24)
        pipe('dark', [(0, .18, .92), (0, .18, 1.04), (0, .06, 1.07), (0, .03, 1.01)], .016)


def toilet():
    lathe('porcelain', (0, -.05, 0), [(.13, .02), (.12, .09), (.11, .24), (.18, .36), (.21, .39)], 28)
    sphere('porcelain', (0, -.08, .40), (.43, .55, .16), 28)
    box('porcelain', (0, .22, .58), (.38, .18, .46), .07)
    box('cream', (0, .22, .82), (.41, .21, .035), .015)
    if LOD < 2:
        sphere('cream', (0, -.11, .485), (.38, .47, .025), 24)
        box('terracotta', (-.12, .111, .70), (.07, .018, .025), .006)


def bath():
    box('porcelain', (0, 0, .28), (.74, 1.69, .49), .18)
    box('cream', (0, 0, .54), (.76, 1.70, .075), .10)
    box('glass', (0, 0, .585), (.54, 1.37, .021), .08)
    if LOD < 2:
        for x in (-.23, .23):
            for y in (-.59, .59): leg(x, y, .08, .035, 'dark')
        pipe('dark', [(0, .67, .58), (0, .67, .77), (0, .56, .80), (0, .51, .73)], .020)


def lamp():
    lathe('oak', (0, 0, 0), [(.18, .01), (.20, .035), (.16, .065), (.05, .085)], 24)
    lathe('oak_light', (0, 0, .075), [(.035, 0), (.03, .18), (.026, 1.2)], 16)
    lathe('linen', (0, 0, 1.30), [(.22, 0), (.225, .02), (.16, .32), (.155, .34)], 28)
    if LOD < 2:
        sphere('paper', (0, 0, 1.35), (.12, .12, .15))
        for z, r in ((1.30, .222), (1.64, .156)):
            pipe('rug_edge', [(r * math.cos(i * math.tau / 24), r * math.sin(i * math.tau / 24), z) for i in range(24)], .009, True)


def rug():
    box('rug_edge', (0, 0, .019), (1.90, 1.40, .038), .019)
    box('rug', (0, 0, .04), (1.70, 1.20, .009), .004)
    if LOD < 2:
        for x in (-.68, -.34, 0, .34, .68):
            box('rug_edge', (x, 0, .046), (.12, .12, .008), .004, (0, 0, math.pi / 4))
    if LOD == 0:
        for x in (-.96, .96):
            for i in range(13): box('linen', (x, -.60 + i * .10, .015), (.095, .012, .02), .005)


def plant():
    lathe('terracotta', (0, 0, 0), [(.13, .01), (.18, .32), (.19, .33), (.19, .37), (.15, .37)], 24)
    lathe('dark', (0, 0, .355), [(.149, 0), (.149, .012)], 20)
    for i in range([9, 7, 4][LOD]):
        a = i * 2.4
        h = .48 + .25 * (i % 3) / 2
        x, y = math.cos(a) * .15, math.sin(a) * .15
        if LOD < 2: pipe('oak_light', [(0, 0, .37), (x, y, h + .10)], .010)
        leaf = sphere('leaf', (x, y, h + .12), (.22, .10, .31), 16)
        leaf.rotation_euler = (math.sin(a) * .45, math.cos(a) * .45, a)


def picture():
    box('oak', (0, 0, .28), (.70, .065, .54), .024)
    box('paper', (0, -.039, .28), (.59, .01, .43), .010)
    # A modeled landscape on the paper; survives neutral albedo and toon conversion.
    sphere('book_ochre', (.16, -.049, .40), (.09, .008, .09), 12)
    box('sage', (0, -.050, .21), (.54, .008, .13), .015)
    box('book_blue', (-.12, -.055, .18), (.29, .008, .06), .008)


def bench():
    for x in (-.55, .55):
        for y in (-.18, .18): leg(x, y, .43, .045)
    for y in (-.18, -.06, .06, .18): box('oak_light', (0, y, .455), (1.40, .10, .055), .020)
    for x in (-.59, .59): box('oak', (x, .20, .63), (.06, .06, .48), .017)
    for z in (.64, .77): box('oak_light', (0, .21, z), (1.40, .045, .095), .022)


def planter():
    box('oak', (0, 0, .18), (.60, .60, .36), .05)
    box('dark', (0, 0, .365), (.50, .50, .023), .013)
    for x in (-.28, .28): box('oak_light', (x, 0, .38), (.065, .63, .07), .020)
    for y in (-.28, .28): box('oak_light', (0, y, .38), (.63, .065, .07), .020)
    for i in range([5, 4, 3][LOD]):
        a = i * 2.4
        sphere('leaf', (math.cos(a) * .12, math.sin(a) * .12, .57), (.25, .23, .31), 16)
        if LOD < 2: sphere('rose', (math.cos(a) * .12, math.sin(a) * .12, .74), (.09, .09, .06), 12)


def window():
    box('glass', (0, .02, .61), (1.00, .045, 1.05), .012)
    for x in (-.55, .55): box('cream', (x, 0, .61), (.10, .13, 1.22), .021)
    for z in (.055, 1.17): box('cream', (0, 0, z), (1.00, .13, .10), .021)
    for x in (0,): box('oak_light', (x, -.056, .61), (.055, .065, 1.03), .012)
    box('oak_light', (0, -.056, .61), (1.00, .065, .055), .012)
    box('stone', (0, -.07, .025), (1.26, .29, .05), .020)


def door():
    box('sage', (0, .01, 1.04), (.84, .105, 2.06), .022)
    for x in (-.46, .46): box('cream', (x, 0, 1.07), (.095, .17, 2.14), .018)
    box('cream', (0, 0, 2.12), (.98, .17, .08), .018)
    if LOD < 2:
        for z in (.43, 1.14): box('oak_light', (0, -.052, z), (.63, .025, .47), .027)
        box('glass', (0, -.057, 1.72), (.60, .025, .33), .024)
        knob(.31, -.068, 1.00)


def chimney():
    box('brick', (0, 0, .55), (.48, .48, 1.10), .025)
    box('stone', (0, 0, 1.12), (.59, .59, .12), .020)
    box('dark', (0, 0, 1.189), (.30, .30, .025), .010)
    if LOD == 0:
        for z in (.22, .45, .68, .91):
            box('stone', (0, -.243, z), (.45, .012, .015), .004)


def fence():
    for x in (-.70, .70):
        box('cream', (x, 0, .44), (.09, .10, .88), .022)
        sphere('oak_light', (x, 0, .90), (.11, .11, .10), 12)
    for z in (.26, .63): box('oak_light', (0, .018, z), (1.50, .06, .065), .017)
    for x in (-.51, -.34, -.17, 0, .17, .34, .51):
        box('cream', (x, -.028, .45), (.065, .045, .73), .018)


def vase():
    lathe('porcelain', (0, 0, 0), [(.07, 0), (.085, .02), (.115, .09), (.12, .16),
                                 (.09, .24), (.06, .29), (.062, .34), (.052, .345)], 28)
    if LOD < 2:
        lathe('dark', (0, 0, .339), [(.049, 0), (.049, .003)], 20)
        pipe('terracotta', [(.116 * math.cos(i * math.tau / 28), .116 * math.sin(i * math.tau / 28), .16) for i in range(28)], .004, True)


BUILDERS = {
    'sofa': sofa, 'chair': chair, 'table': table, 'bed': bed, 'wardrobe': wardrobe,
    'shelf': shelf, 'kitchen': kitchen, 'sink': sink, 'toilet': toilet, 'bath': bath,
    'lamp': lamp, 'rug': rug, 'plant': plant, 'picture': picture, 'bench': bench,
    'planter': planter, 'window': window, 'door': door, 'chimney': chimney, 'fence': fence, 'vase': vase
}
SURFACES = {'table': .79, 'kitchen': .976, 'sink': .92, 'wardrobe': 1.945, 'shelf': 1.704, 'bench': .483}


def join_asset(name, level, collection, root):
    global PARTS, LOD
    LOD, PARTS = level, []
    BUILDERS[name]()
    bpy.ops.object.select_all(action='DESELECT')
    for obj in PARTS: obj.select_set(True)
    bpy.context.view_layer.objects.active = PARTS[0]
    bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = name + '_LOD' + str(level)
    bpy.context.scene.cursor.location = (0, 0, 0)
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    obj.parent = root
    for c in list(obj.users_collection): c.objects.unlink(obj)
    collection.objects.link(obj)
    # Clean accidental zero-area geometry before export; multipart surfaces are intentional.
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.dissolve_degenerate(bm, dist=1e-7, edges=list(bm.edges))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(obj.data)
    bm.free()
    floor_offset = min(v.co.z for v in obj.data.vertices)
    for v in obj.data.vertices: v.co.z -= floor_offset
    obj.data.update()
    obj.data.calc_loop_triangles()
    coords = [v.co for v in obj.data.vertices]
    bounds = {'min': [round(min(v[a] for v in coords), 6) for a in range(3)],
              'max': [round(max(v[a] for v in coords), 6) for a in range(3)]}
    tri = obj.data.loop_triangles
    zero = sum((obj.data.vertices[t.vertices[1]].co - obj.data.vertices[t.vertices[0]].co).cross(
        obj.data.vertices[t.vertices[2]].co - obj.data.vertices[t.vertices[0]].co).length < 1e-10 for t in tri)
    return obj, {'triangles': len(tri), 'sourceVertices': len(obj.data.vertices), 'boundsBlender': bounds,
                 'zeroAreaTriangles': zero, 'uv': bool(obj.data.uv_layers), 'floorAdjustment': floor_offset}


def export_runtime(roots):
    bpy.ops.object.select_all(action='DESELECT')
    for root in roots:
        root.location = (0, 0, 0)
        root.select_set(True)
        for obj in root.children:
            obj.hide_set(False)
            obj.hide_render = False
            obj.select_set(True)
    bpy.context.view_layer.update()
    bpy.ops.export_scene.gltf(filepath=str(OUT), export_format='GLB', use_selection=True,
                             export_texcoords=True, export_normals=True, export_materials='EXPORT',
                             export_animations=False, export_extras=True, export_yup=True)
    data = OUT.read_bytes()
    n = struct.unpack_from('<I', data, 12)[0]
    doc = json.loads(data[20:20 + n])
    for m in doc.get('materials', []):
        source = bpy.data.materials.get(m['name'])
        if source: m.setdefault('pbrMetallicRoughness', {})['baseColorFactor'] = list(source.diffuse_color)
    block = json.dumps(doc, separators=(',', ':')).encode()
    block += b' ' * ((-len(block)) % 4)
    tail = data[20 + n:]
    OUT.write_bytes(struct.pack('<4sII', b'glTF', 2, 20 + len(block) + len(tail)) +
                    struct.pack('<II', len(block), 0x4E4F534A) + block + tail)


def studio(roots):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 24
    scene.cycles.device = 'CPU'
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.63, .67, .60, 1)
    scene.world.node_tree.nodes['Background'].inputs[1].default_value = .60
    scene.view_settings.view_transform = 'AgX'
    for i, root in enumerate(roots):
        root.location = ((i % 5 - 2) * 2.80, (i // 5 - 1.5) * 3.05, 0)
        for obj in root.children:
            obj.hide_render = not obj.name.endswith('LOD0')
            obj.hide_set(not obj.name.endswith('LOD0'))
    bpy.ops.mesh.primitive_plane_add(size=200)
    floor = bpy.context.object
    floor.name = 'QA_studio_floor'
    floor.location.z = -.015
    mat = bpy.data.materials.new('QA_matte_background')
    mat.diffuse_color = (.61, .63, .53, 1)
    floor.data.materials.append(mat)
    for name, loc, energy, size in [('Key', (2, -6, 12), 1800, 9), ('Fill', (-6, -2, 7), 1100, 8)]:
        bpy.ops.object.light_add(type='AREA', location=loc)
        obj = bpy.context.object
        obj.name = 'QA_' + name
        obj.data.energy, obj.data.shape, obj.data.size = energy, 'DISK', size
        obj.rotation_euler = (Vector((0, 0, 0)) - obj.location).to_track_quat('-Z', 'Y').to_euler()
    bpy.ops.object.camera_add(location=(12, -17, 17))
    camera = bpy.context.object
    camera.name = 'QA_camera'
    camera.rotation_euler = (Vector((0, 0, .30)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = 22.0
    scene.camera = camera
    scene.render.resolution_x, scene.render.resolution_y = 1600, 1200
    scene.render.resolution_percentage = 100
    scene.render.filepath = str(QA / 'home_gallery.png')
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE / 'home_cozy.blend'))
    if '--render' in sys.argv: bpy.ops.render.render(write_still=True)


def main():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    bpy.context.scene.unit_settings.system = 'METRIC'
    bpy.context.scene.unit_settings.scale_length = 1
    image = atlas()
    init_materials(image)
    roots = []
    report = {'version': 1, 'seed': SEED, 'blender': bpy.app.version_string, 'assets': {},
              'orientation': {'units': 'metres', 'runtimeUp': '+Y', 'runtimeFront': '+Z',
                              'pivot': 'floor at footprint centre'},
              'texture': {'file': 'textures/home_painted_atlas.png', 'dimensions': [1024, 1024],
                          'colorSpace': 'sRGB', 'channels': 'RGB neutral painted albedo multiplier',
                          'slots': 16, 'paddingPixels': 8, 'gpuRgbaMipBytes': 5592405}}
    for name in BUILDERS:
        collection = bpy.data.collections.new('HOME_' + name)
        bpy.context.scene.collection.children.link(collection)
        root = bpy.data.objects.new(name, None)
        collection.objects.link(root)
        root['catalogType'] = name
        root['units'] = 'metres'
        root['front'] = '+Z after glTF export'
        info = {'lods': {}, 'placement': 'wall' if name in ('picture', 'window', 'door') else 'floor'}
        for level in range(3):
            obj, stats = join_asset(name, level, collection, root)
            info['lods'][level] = stats
        info['sockets'] = {'surface': {'height': SURFACES[name] - info['lods'][0]['floorAdjustment']}} if name in SURFACES else {}
        info['collider'] = {'type': 'box', 'source': 'export LOD0 local bounds',
                            'purpose': 'placement overlap and coarse navigation proxy'}
        report['assets'][name] = info
        roots.append(root)
        print('HOME_BUILT', name, [info['lods'][l]['triangles'] for l in range(3)], flush=True)
    export_runtime(roots)
    (QA / 'authoring.json').write_text(json.dumps(report, indent=2) + '\n')
    studio(roots)
    print('HOME_COMPLETE', len(roots), OUT.stat().st_size, str(OUT), flush=True)


if __name__ == '__main__': main()
