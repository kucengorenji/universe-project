"""Valley kit for farm.html (docs/FARM_PLAN.md, milestones V0-V2).

/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
    --python tools/blender/valley/build_valley_kit.py

Each asset is an Empty at the origin whose children are meshes named <asset>_<part>:
  *_canopy  soft blob foliage; the game replaces its normals with spherical ones
  *_glow    window glass that lights up at night
<asset>_far is the coarser stand-in the game swaps in for distant instances (trees).
Colours come from src/valley/valleyPalette.json, painted as a COLOR_0 gradient and multiplied
by ambient occlusion baked in Cycles (tinted cool, so creases read as painted shadow, not black).
Output: public/models/valley_kit.glb, report docs/qa/valley/kit.json.
"""
import json
import math
import os
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector, noise

ROOT = Path(os.environ.get('GLOBE_ROOT', Path(__file__).resolve().parents[3]))
PALETTE = json.loads((ROOT / 'src/valley/valleyPalette.json').read_text())
KIT = PALETTE['kit']
OUT = ROOT / 'public/models/valley_kit.glb'
REPORT = ROOT / 'docs/qa/valley/kit.json'
AO_TINT = (0.56, 0.52, 0.72)  # what a fully occluded crease multiplies by
AO_DISTANCE = 1.1


def linear(hex_colour):
    h = hex_colour.lstrip('#')
    srgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]


def lerp(a, b, t):
    return [x + (y - x) * t for x, y in zip(a, b)]


def smoothstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


# ------------------------------------------------------------------ scene

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
MATERIAL = bpy.data.materials.new('M_valley')
MATERIAL.use_nodes = True
nodes = MATERIAL.node_tree.nodes
attribute = nodes.new('ShaderNodeVertexColor')
attribute.layer_name = 'Col'
MATERIAL.node_tree.links.new(attribute.outputs['Color'], nodes['Principled BSDF'].inputs['Base Color'])


def to_object(bm, name, colour, smooth=False):
    """colour: hex, (bottom_hex, top_hex), or a function (co, zmin, zmax) -> linear rgb."""
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    mesh.materials.append(MATERIAL)
    mesh.polygons.foreach_set('use_smooth', [smooth] * len(mesh.polygons))
    zs = [v.co.z for v in mesh.vertices]
    zmin, zmax = min(zs), max(zs)
    if isinstance(colour, str):
        paint = lambda co, a, b, c=linear(colour): c
    elif isinstance(colour, tuple):
        lo, hi = linear(colour[0]), linear(colour[1])
        paint = lambda co, a, b: lerp(lo, hi, smoothstep(a, b, co.z))
    else:
        paint = colour
    layer = mesh.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
    for loop in mesh.loops:
        layer.data[loop.index].color = (*paint(mesh.vertices[loop.vertex_index].co, zmin, zmax), 1)
    return obj


def box(size, loc, bevel=0.03, rot=(0, 0, 0), segments=1):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    if bevel:
        bmesh.ops.bevel(bm, geom=bm.edges[:], offset=bevel, segments=segments, affect='EDGES', profile=0.5)
    place(bm, loc, rot)
    return bm


def cone(r1, r2, depth, loc, segments=8, rot=(0, 0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, radius1=r1, radius2=r2, depth=depth)
    place(bm, loc, rot)
    return bm


def place(bm, loc, rot):
    m = Matrix.Translation(loc) @ Matrix.Rotation(rot[2], 4, 'Z') @ Matrix.Rotation(rot[1], 4, 'Y') @ Matrix.Rotation(rot[0], 4, 'X')
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)


def blobs(spheres, seed, wobble=0.16, subdivisions=3, squash=1.0):
    """Soft foliage: displaced icospheres, merged into one bmesh."""
    bm = bmesh.new()
    for i, (x, y, z, r) in enumerate(spheres):
        part = bmesh.new()
        bmesh.ops.create_icosphere(part, subdivisions=subdivisions, radius=r)
        for v in part.verts:
            n = v.co.normalized()
            v.co += n * noise.noise(v.co * (1.6 / r) + Vector((seed, i * 3.1, 0))) * wobble * r
            v.co.z *= squash
            v.co += Vector((x, y, z))
        mesh = bpy.data.meshes.new('tmp')
        part.to_mesh(mesh)
        part.free()
        bm.from_mesh(mesh)
        bpy.data.meshes.remove(mesh)
    return bm


def foliage(dark, mid, light):
    lo, md, hi = linear(dark), linear(mid), linear(light)

    def paint(co, zmin, zmax):
        t = (co.z - zmin) / max(1e-6, zmax - zmin)
        c = lerp(lo, md, smoothstep(0.0, 0.55, t))
        return lerp(c, hi, smoothstep(0.55, 1.0, t))
    return paint


def assemble(name, parts, offset):
    """parts: {suffix: [objects]} -> one mesh per suffix under an Empty."""
    joined_parts = []
    for suffix, objs in parts.items():
        if not objs:  # e.g. no windows, so no glow
            continue
        bpy.ops.object.select_all(action='DESELECT')
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        if len(objs) > 1:
            bpy.ops.object.join()
        joined = bpy.context.view_layer.objects.active
        joined.name = joined.data.name = f'{name}_{suffix}'
        joined_parts.append(joined)
    # Created after the joins so the Empty gets the bare asset name, not a .001 suffix
    root = bpy.data.objects.new(name, None)
    scene.collection.objects.link(root)
    for joined in joined_parts:
        joined.parent = root
    root.location = offset
    return root


# ------------------------------------------------------------------ assets

BRIDGES = json.loads((ROOT / 'src/valley/world/bridges.json').read_text())


def flare(trunk, below=0.35, k=1.45):
    for v in trunk.verts:  # root flare
        if v.co.z < below:
            v.co.x *= k
            v.co.y *= k
    return trunk


def broadleaf(spheres, seed, colours, trunk_h=2.6, trunk_r=(0.34, 0.2), subdivisions=3, extra=None):
    trunk = flare(cone(trunk_r[0], trunk_r[1], trunk_h, (0, 0, trunk_h / 2), segments=9))
    branches = [cone(0.13, 0.07, 1.3, (0.42, 0.1, trunk_h - 0.05), 6, (0, 0.75, 0.2)),
                cone(0.12, 0.06, 1.2, (-0.38, -0.12, trunk_h), 6, (0.1, -0.8, 0))]
    wood = [to_object(trunk, 'trunk', (KIT['trunkDark'], KIT['trunk']), smooth=True)]
    wood += [to_object(b, 'branch', KIT['trunk'], smooth=True) for b in branches]
    leaves = [to_object(blobs(spheres, seed=seed, subdivisions=subdivisions), 'canopy', foliage(*colours), smooth=True)]
    if extra:
        leaves += extra()
    return {'trunk': wood, 'canopy': leaves}


OAK = [(0, 0, 3.6, 1.7), (1.05, 0.35, 3.15, 1.15), (-0.95, 0.55, 3.25, 1.2),
       (0.25, -0.95, 3.3, 1.15), (-0.45, -0.5, 4.25, 1.05), (0.4, 0.45, 4.45, 1.1)]
APPLE = [(0, 0, 2.9, 1.3), (0.85, 0.2, 2.6, 0.9), (-0.8, 0.35, 2.65, 0.95), (0.1, -0.8, 2.7, 0.9), (0, 0.1, 3.6, 0.95)]
SAKURA = [(0, 0, 3.3, 1.35), (1.2, 0.3, 3.0, 0.95), (-1.15, 0.4, 3.05, 1.0), (0.3, -1.05, 3.1, 0.9),
          (-0.5, -0.6, 3.8, 0.85), (0.55, 0.5, 3.9, 0.9)]


def tree_oak(sub=3):
    return broadleaf(OAK, 1.7, (KIT['leafDark'], KIT['leaf'], KIT['leafLight']), subdivisions=sub)


def tree_apple(sub=3):
    def fruit():
        out = []
        for i, (x, y, z, r) in enumerate(APPLE[:4]):
            for k in range(3):
                a = i * 1.7 + k * 2.1
                d = Vector((math.cos(a), math.sin(a), -0.35)).normalized()
                out.append(to_object(sphere_bm(0.13, (x + d.x * r * 0.97, y + d.y * r * 0.97, z + d.z * r * 0.97), 2), 'fruit', KIT['apple'], smooth=True))
        return out
    return broadleaf(APPLE, 3.3, (KIT['leafDark'], KIT['leaf'], KIT['leafLight']), trunk_h=2.1, trunk_r=(0.26, 0.16),
                     subdivisions=sub, extra=fruit if sub == 3 else None)


def tree_sakura(sub=3):
    return broadleaf(SAKURA, 5.9, (KIT['blossomDark'], KIT['blossom'], KIT['blossomLight']), trunk_h=2.5, trunk_r=(0.28, 0.16), subdivisions=sub)


def tree_pine(sub=3):
    trunk = flare(cone(0.26, 0.12, 4.6, (0, 0, 2.3), segments=8), 0.3, 1.35)
    tiers = []
    for i, (z, r) in enumerate(((1.9, 1.55), (3.0, 1.25), (4.0, 0.95), (4.9, 0.65), (5.6, 0.38))):
        tiers.append((0, 0, z, r))
    bm = blobs(tiers, seed=8.1, wobble=0.12, subdivisions=sub, squash=0.62)
    return {'trunk': [to_object(trunk, 'trunk', (KIT['trunkDark'], KIT['trunk']), smooth=True)],
            'canopy': [to_object(bm, 'canopy', foliage(KIT['pineDark'], KIT['pine'], KIT['pineLight']), smooth=True)]}


def bush():
    bm = blobs([(0, 0, 0.45, 0.62), (0.5, 0.15, 0.35, 0.45), (-0.45, 0.2, 0.36, 0.48), (0.05, -0.4, 0.33, 0.42)],
               seed=4.2, squash=0.85)
    return {'canopy': [to_object(bm, 'bush', foliage(KIT['leafDark'], KIT['bush'], KIT['leafLight']), smooth=True)]}


def bush_flower():
    out = bush()
    for i in range(9):
        a = i * 2.4
        d = Vector((math.cos(a), math.sin(a), 0.55 + 0.3 * math.sin(i))).normalized()
        out['canopy'].append(to_object(sphere_bm(0.08, (d.x * 0.55, d.y * 0.5, 0.42 + d.z * 0.42), 1), 'bloom',
                                       (KIT['flowerPink'], KIT['flowerWhite'])[i % 2]))
    return out


ROOFS = {
    'thatch': ('thatchDark', 'thatch', 4, 0.4, 0.13),
    'red': ('roofRedDark', 'roofRed', 6, 0.22, 0.06),
    'blue': ('roofBlueDark', 'roofBlue', 6, 0.22, 0.06),
    'green': ('roofGreenDark', 'roofGreen', 6, 0.22, 0.06),
    'barn': ('roofRedDark', 'barnDark', 5, 0.24, 0.06),
    'shingle': ('roofOrangeDark', 'roofOrange', 7, 0.1, 0.0),  # individual tiles, staggered (the sheet's roof)
}


def cottage(W=6.0, D=5.0, H=2.7, roof='thatch', plaster=('plasterShade', 'plaster'), door_x=-1.35,
            windows=((1.4, 'front'), (0.2, 'right'), (0.2, 'left'), (-1.2, 'back'), (1.4, 'back')),
            chimney=(1.7, 1.1), awning='roofRed', timbered=True, planks=None, boards=False, porch=False):
    """A gabled house: plinth, walls (plaster, battens or horizontal boards), timbers, a roof of
    overlapping courses (or staggered tiles), optionally a front porch."""
    P = 0.35
    top = P + H
    pitch = math.radians(36)
    overhang = 0.65
    half = D / 2 + overhang
    slab_w = half / math.cos(pitch)
    dark, light, rows, thick, bevel = ROOFS[roof]
    ridge = top + (D / 2) * math.tan(pitch) + thick / 2 / math.cos(pitch) + 0.02
    body, timber, roofs, glass, stone, details = [], [], [], [], [], []

    stone.append(to_object(box((W + 0.35, D + 0.35, P + 0.35), (0, 0, (P - 0.35) / 2), 0.06), 'plinth', (KIT['stoneDark'], KIT['stone'])))
    if boards:
        # A course of dressed stones round the plinth, alternating sizes
        rng = __import__('random').Random(int(W * 100 + D))
        for sx, sy, length, along in ((0, -1, W + 0.35, 'x'), (0, 1, W + 0.35, 'x'), (-1, 0, D + 0.35, 'y'), (1, 0, D + 0.35, 'y')):
            u = -length / 2
            while u < length / 2 - 0.05:
                w = min(length / 2 - u, 0.32 + rng.random() * 0.3)
                h = P * (0.75 + rng.random() * 0.2)
                c = u + w / 2
                pos = (c, sy * (D / 2 + 0.2), h / 2) if along == 'x' else (sx * (W / 2 + 0.2), c, h / 2)
                size = (w - 0.04, 0.08, h) if along == 'x' else (0.08, w - 0.04, h)
                stone.append(to_object(box(size, pos, 0.0), 'stone', (KIT['stoneDark'], KIT['stone']) if rng.random() < 0.6 else KIT['stone']))
                u += w
    body.append(to_object(box((W, D, H), (0, 0, P + H / 2), 0.02), 'walls', (KIT[plaster[0]], KIT[plaster[1]])))
    bm = bmesh.new()
    pts = [(-D / 2, top), (D / 2, top), (0, ridge - 0.2)]
    for x in (-W / 2, W / 2):
        for y, z in pts:
            bm.verts.new((x, y, z))
    bm.verts.ensure_lookup_table()
    v = bm.verts
    for face in ((0, 1, 2), (5, 4, 3), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)):
        bm.faces.new([v[i] for i in face])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    body.append(to_object(bm, 'gable', KIT['gableCream'] if boards else KIT[plaster[1]]))
    if boards:
        # Horizontal wall boards, each a little proud of the one above (log-cabin siding)
        n = int(H / 0.24)
        for k in range(n):
            z = P + (k + 0.5) * H / n
            colour = (KIT['plankDark'], KIT['plank']) if k % 2 else (KIT['plankDark'], KIT['woodLight'])
            for sy in (-1, 1):
                timber.append(to_object(box((W, 0.05, H / n - 0.02), (0, sy * (D / 2 + 0.025), z), 0.0), 'board', colour))
            for sx in (-1, 1):
                timber.append(to_object(box((0.05, D, H / n - 0.02), (sx * (W / 2 + 0.025), 0, z), 0.0), 'board', colour))
    if planks:
        # Board-and-batten: vertical battens over the walls, every 0.5 m
        for sy in (-1, 1):
            n = int(W / 0.5)
            for i in range(n + 1):
                x = -W / 2 + i * W / n
                timber.append(to_object(box((0.08, 0.06, H), (x, sy * (D / 2 + 0.03), P + H / 2), 0.0), 'batten', KIT[planks]))
        for sx in (-1, 1):
            n = int(D / 0.5)
            for i in range(n + 1):
                y = -D / 2 + i * D / n
                timber.append(to_object(box((0.06, 0.08, H), (sx * (W / 2 + 0.03), y, P + H / 2), 0.0), 'batten', KIT[planks]))

    t = 0.2
    trim = 'barnTrim' if planks else 'timber'
    for sx in (-1, 1):
        for sy in (-1, 1):
            timber.append(to_object(box((t, t, H), (sx * (W / 2 - 0.06), sy * (D / 2 - 0.06), P + H / 2), 0.02), 'post', KIT[trim]))
        if timbered:
            timber.append(to_object(box((0.16, t, ridge - top - 0.3), (sx * (W / 2 + 0.03), 0, (top + ridge - 0.3) / 2), 0.02), 'king', KIT['timber']))
            timber.append(to_object(box((0.16, D * 0.62, 0.16), (sx * (W / 2 + 0.03), 0, top + 0.55), 0.02), 'collar', KIT['timber']))
    for sy in (-1, 1):
        timber.append(to_object(box((W + 0.1, t, 0.2), (0, sy * (D / 2 + 0.02), top - 0.1), 0.02), 'beam', KIT[trim]))
    for sx in (-1, 1):
        timber.append(to_object(box((t, D + 0.1, 0.2), (sx * (W / 2 + 0.02), 0, top - 0.1), 0.02), 'beam', KIT[trim]))

    # Roof in overlapping courses: each row a little proud of the one above, darker at its lip
    for sy in (-1, 1):
        if roof == 'shingle':
            # Staggered tiles, each its own slightly varied colour, every row overlapping the one above
            rng = __import__('random').Random(7 + sy)
            span = W + 2 * overhang
            for r in range(rows):
                a, b = r / rows, (r + 1) / rows + 0.05
                mid, length = (a + b) / 2 * half, (b - a) * slab_w
                normal = Vector((0, sy * math.sin(pitch), math.cos(pitch)))
                centre = Vector((0, sy * mid, ridge - mid * math.tan(pitch))) + normal * 0.03 * r
                n = int(span / 0.56)
                for i in range(n + (r % 2)):
                    x0 = -span / 2 + (i - 0.5 * (r % 2)) * span / n
                    x1 = min(span / 2, x0 + span / n)
                    x0 = max(-span / 2, x0)
                    tilt = (rng.random() - 0.5) * 0.06
                    tile = box((x1 - x0 - 0.03, length, thick), (centre.x + (x0 + x1) / 2, centre.y, centre.z), 0.0, (-sy * pitch + tilt, 0, 0))
                    k = 0.88 + rng.random() * 0.2
                    roofs.append(to_object(tile, 'roof', lambda co, zmin, zmax, k=k: [c * k for c in lerp(linear(KIT[dark]), linear(KIT[light]), smoothstep(zmin, zmax, co.z))]))
            continue
        for r in range(rows):
            a, b = r / rows, (r + 1) / rows + 0.06
            mid, length = (a + b) / 2 * half, (b - a) * slab_w
            normal = Vector((0, sy * math.sin(pitch), math.cos(pitch)))
            centre = Vector((0, sy * mid, ridge - mid * math.tan(pitch))) + normal * (0.05 if roof == 'thatch' else 0.025) * r
            # Thatch keeps a rounded lip; shingle courses read fine with a single bevel segment
            course = box((W + 2 * overhang + 0.04 * r, length, thick), tuple(centre), bevel, (-sy * pitch, 0, 0), segments=2 if roof == 'thatch' else 1)
            roofs.append(to_object(course, 'roof', (KIT[dark], KIT[light])))
    if boards:
        # Cream gable with a timber king post and two braces (the sheet's front gable)
        for sx in (-1, 1):
            gx = sx * (W / 2 + 0.06)
            timber.append(to_object(box((0.1, 0.16, ridge - top - 0.35), (gx, 0, (top + ridge - 0.35) / 2), 0.02), 'king', KIT['timber']))
            for sy in (-1, 1):
                a0 = Vector((gx, sy * D * 0.36, top + 0.1))
                a1 = Vector((gx, 0, ridge - 0.6))
                mid = (a0 + a1) / 2
                ang = math.atan2(a1.z - a0.z, a1.y - a0.y)
                timber.append(to_object(box((0.1, (a1 - a0).length, 0.14), tuple(mid), 0.02, (ang, 0, 0)), 'brace', KIT['timber']))
    ridge_cap = cone(0.3 if roof == 'thatch' else 0.16, 0.3 if roof == 'thatch' else 0.16, W + 2 * overhang + 0.1, (0, 0, ridge - 0.05), 10, (0, math.pi / 2, 0))
    roofs.append(to_object(ridge_cap, 'ridge', KIT[dark], smooth=True))

    fy = -D / 2
    if door_x is not None:
        details.append(to_object(box((1.1, 0.14, 1.95), (door_x, fy - 0.03, P + 0.975), 0.03), 'door', (KIT['woodDark'], KIT['wood'])))
        for x in (door_x - 0.62, door_x + 0.62):
            timber.append(to_object(box((0.16, 0.2, 2.1), (x, fy - 0.05, P + 1.05), 0.02), 'jamb', KIT[trim]))
        timber.append(to_object(box((1.4, 0.22, 0.18), (door_x, fy - 0.06, P + 2.08), 0.02), 'lintel', KIT[trim]))
        if awning:
            details.append(to_object(box((1.9, 0.9, 0.12), (door_x, fy - 0.45, P + 2.45), 0.04, (math.radians(-18), 0, 0)), 'awning', KIT[awning]))
        stone.append(to_object(box((1.6, 0.8, 0.22), (door_x, fy - 0.55, 0.11), 0.05), 'step', KIT['stone']))
        details.append(to_object(sphere_bm(0.06, (door_x + 0.38, fy - 0.12, P + 0.95)), 'knob', KIT['woodLight']))

    def window(x, y, face, w=1.15, h=1.0, z=P + 1.55):
        nx, ny = face
        along = (abs(ny), abs(nx))
        size = lambda a, n, hh: (a * along[0] + n * abs(nx), a * along[1] + n * abs(ny), hh)
        at = lambda off_a, off_n, zz: (x + along[0] * off_a + nx * off_n, y + along[1] * off_a + ny * off_n, zz)
        glass.append(to_object(box(size(w, 0.06, h), at(0, 0.0, z), 0.0), 'glass', KIT['window']))
        for a in (-w / 2, w / 2):
            timber.append(to_object(box(size(0.14, 0.16, h + 0.2), at(a, 0.05, z), 0.0), 'frame', KIT[trim]))
        for zz in (z - h / 2, z + h / 2):
            timber.append(to_object(box(size(w + 0.2, 0.18, 0.14), at(0, 0.06, zz), 0.0), 'frame', KIT[trim]))
        timber.append(to_object(box(size(0.07, 0.1, h), at(0, 0.05, z), 0.0), 'mullion', KIT['woodDark']))
        timber.append(to_object(box(size(w, 0.1, 0.07), at(0, 0.05, z), 0.0), 'mullion', KIT['woodDark']))
        for s in (-1, 1):
            details.append(to_object(box(size(0.5, 0.06, h + 0.1), at(s * (w / 2 + 0.33), 0.1, z), 0.0), 'shutter', (KIT['woodDark'], KIT['wood'])))
        details.append(to_object(box(size(w + 0.25, 0.32, 0.24), at(0, 0.22, z - h / 2 - 0.2), 0.03), 'flowerbox', KIT['woodDark']))
        details.append(to_object(box(size(w + 0.1, 0.26, 0.16), at(0, 0.22, z - h / 2 - 0.02), 0.07, segments=2), 'leaves', KIT['leaf']))
        for i in range(5):
            colour = (KIT['flowerRed'], KIT['flowerYellow'], KIT['flowerPink'])[i % 3]
            details.append(to_object(sphere_bm(0.11, at(-w / 2 + 0.15 + i * (w - 0.3) / 4, 0.26, z - h / 2 + 0.08), 0), 'flower', colour))  # 20-triangle blooms: there are many

    walls = {'front': lambda o: (o, fy - 0.01, (0, -1)), 'back': lambda o: (o, D / 2 + 0.01, (0, 1)),
             'right': lambda o: (W / 2 + 0.01, o, (1, 0)), 'left': lambda o: (-W / 2 - 0.01, o, (-1, 0))}
    for offset, wall in windows:
        window(*walls[wall](offset))
    if chimney:
        cx, cy = chimney
        stone.append(to_object(box((0.75, 0.75, 2.2), (cx, cy, ridge - 0.55), 0.05), 'chimney', (KIT['stoneDark'], KIT['stone'])))
        stone.append(to_object(box((0.9, 0.9, 0.18), (cx, cy, ridge + 0.6), 0.04), 'chimneycap', KIT['stoneDark']))
    if porch:
        # Front porch: a plank deck on stone, posts, a railing, a short shingled roof, steps
        pw, pd = W * 0.62, 1.5
        px = door_x if door_x is not None else 0
        py = fy - pd / 2 - 0.05
        stone.append(to_object(box((pw + 0.2, pd + 0.1, P), (px, py, P / 2 - 0.02), 0.04), 'porchbase', (KIT['stoneDark'], KIT['stone'])))
        for k in range(int(pd / 0.25)):
            timber.append(to_object(box((pw, 0.22, 0.06), (px, fy - 0.15 - k * 0.25, P + 0.03), 0.0), 'deck', (KIT['plankDark'], KIT['plank'])))
        for sxp in (-1, 1):
            post = (px + sxp * (pw / 2 - 0.08), fy - pd + 0.05)
            timber.append(to_object(box((0.14, 0.14, 2.25), (post[0], post[1], P + 1.12), 0.02), 'post', KIT['timber']))
            # Railing on each side of the steps: a top rail and three balusters
            rx = px + sxp * (pw / 2 - 0.42)
            timber.append(to_object(box((0.62, 0.08, 0.08), (rx, post[1], P + 0.8), 0.015), 'rail', KIT['wood']))
            for b in range(3):
                timber.append(to_object(box((0.06, 0.06, 0.62), (rx - 0.2 + b * 0.2, post[1], P + 0.38), 0.0), 'baluster', KIT['wood']))
        rpitch = math.radians(22)
        rz = P + 2.35
        for k in range(3):
            y = fy - 0.2 - k * 0.48
            roofs.append(to_object(box((pw + 0.5, 0.56, 0.08), (px, y, rz - (k * 0.48) * math.tan(rpitch) + 0.02 * k), 0.0, (rpitch, 0, 0)), 'roof', (KIT[dark], KIT[light])))
        for k in range(2):
            stone.append(to_object(box((1.2, 0.3, P * (2 - k) / 3), (px, fy - pd - 0.12 - k * 0.3, P * (2 - k) / 6), 0.02), 'step', KIT['stone']))
        details.append(to_object(box((0.16, 0.16, 0.22), (px + 0.85, fy - 0.12, P + 2.0), 0.02), 'lantern', KIT['woodDark']))
        glass.append(to_object(box((0.11, 0.11, 0.15), (px + 0.85, fy - 0.12, P + 2.0), 0.0), 'lamp', KIT['windowLit']))
    return {'body': body + timber + roofs + stone + details, 'glow': glass}


def house_player():
    # The sheet's farmhouse: plank cabin on a stone base, staggered orange tiles, cream gable with
    # timber braces, a covered front porch with railing and steps
    return cottage(6.0, 5.0, 2.7, 'shingle', ('plankDark', 'plank'), door_x=-1.35,
                   windows=((1.4, 'front'), (0.2, 'right'), (0.2, 'left'), (-1.2, 'back'), (1.4, 'back')),
                   chimney=(1.7, 1.1), awning=None, timbered=False, boards=True, porch=True)


def house_villager_a():
    return cottage(5.0, 4.4, 2.6, 'red', ('plasterPink', 'plasterPink'), door_x=0.0,
                   windows=((-1.5, 'front'), (1.5, 'front'), (0.0, 'right'), (0.0, 'left'), (0.0, 'back')), chimney=(-1.3, 0.9), awning=None)


def house_villager_b():
    return cottage(5.4, 4.6, 2.6, 'blue', ('plasterShade', 'plasterBlue'), door_x=1.4,
                   windows=((-1.2, 'front'), (0.3, 'right'), (0.3, 'left'), (0.0, 'back')), chimney=(1.6, -0.9), awning='roofBlue')


def shop():
    out = cottage(7.0, 5.0, 2.9, 'green', ('plasterShade', 'plaster'), door_x=0.0,
                  windows=((-2.2, 'front'), (2.2, 'front'), (0.0, 'right'), (0.0, 'left')), chimney=None, awning=None)
    # Striped awning over the shop front and a hanging sign
    P, fy = 0.35, -2.5
    for i in range(8):
        colour = KIT['roofRed'] if i % 2 == 0 else KIT['awningWhite']
        out['body'].append(to_object(box((0.8, 1.3, 0.08), (-2.8 + i * 0.8, fy - 0.6, P + 2.55), 0.02, (math.radians(-20), 0, 0)), 'awning', colour))
    # The sign sits on the wall between the awning and the eaves, clear of the roof
    out['body'].append(to_object(box((1.8, 0.12, 0.5), (0, fy - 0.08, P + 2.95), 0.04), 'sign', (KIT['woodDark'], KIT['woodLight'])))
    for i in range(3):
        out['body'].append(to_object(sphere_bm(0.11, (-0.45 + i * 0.45, fy - 0.17, P + 2.97), 1), 'signfruit', (KIT['apple'], KIT['flowerYellow'], KIT['turnipTop'])[i]))
    return out


def barn():
    out = cottage(8.0, 6.0, 3.2, 'barn', ('barnDark', 'barn'), door_x=None, windows=((2.5, 'right'), (-2.5, 'left')),
                  chimney=None, awning=None, timbered=False, planks='barnDark')
    P, fy = 0.35, -3.0
    # Big double door with an X brace, a hay loft hatch above
    for s in (-1, 1):
        out['body'].append(to_object(box((1.3, 0.12, 2.5), (s * 0.67, fy - 0.08, P + 1.25), 0.03), 'door', (KIT['barnDark'], KIT['barn'])))
        for k in (-1, 1):
            out['body'].append(to_object(box((0.12, 0.06, 2.75), (s * 0.67, fy - 0.16, P + 1.25), 0.0, (0, k * 0.48, 0)), 'brace', KIT['barnTrim']))
        out['body'].append(to_object(box((1.4, 0.07, 0.12), (s * 0.67, fy - 0.15, P + 2.45), 0.0), 'brace', KIT['barnTrim']))
    out['body'].append(to_object(box((1.4, 0.1, 1.0), (0, fy - 0.06, P + 3.75), 0.03), 'loft', KIT['barnTrim']))
    out['body'].append(to_object(box((1.1, 0.08, 0.7), (0, fy - 0.1, P + 3.75), 0.02), 'loft', KIT['hay']))
    return out


def coop():
    out = cottage(3.0, 2.4, 1.6, 'red', ('woodDark', 'wood'), door_x=None, windows=(), chimney=None, awning=None,
                  timbered=False, planks='woodDark')
    P = 0.35
    out['body'].append(to_object(box((0.55, 0.1, 0.6), (0.6, -1.25, P + 0.3), 0.02), 'hatch', KIT['woodDark']))
    ramp = box((0.5, 1.2, 0.06), (0.6, -1.75, 0.25), 0.01, (math.radians(-22), 0, 0))
    out['body'].append(to_object(ramp, 'ramp', KIT['woodLight']))
    out['body'].append(to_object(box((1.6, 0.6, 0.5), (-0.5, -1.55, 0.25), 0.04), 'nest', KIT['hay']))
    return out


def crop(stage):
    """Turnip-like crop, three stages: sprout, leafy, ripe (bulb showing)."""
    parts = []
    n, length = ((2, 0.12), (5, 0.24), (6, 0.3))[stage]
    for i in range(n):
        a = i * 2 * math.pi / n + stage * 0.4
        leaf = sphere_bm(0.06 + 0.02 * stage, (0, 0, 0), 2)
        bmesh.ops.scale(leaf, vec=(length / 0.12 * 0.5, 0.45, 0.18), verts=leaf.verts)
        place(leaf, (math.cos(a) * length * 0.45, math.sin(a) * length * 0.45, 0.05 + length * 0.35), (0, -0.7, a))
        parts.append(to_object(leaf, 'leaf', (KIT['crop'], KIT['cropLight']), smooth=True))
    if stage == 2:
        parts.append(to_object(sphere_bm(0.11, (0, 0, 0.05), 2), 'bulb', (KIT['turnip'], KIT['turnipTop']), smooth=True))
    return {'canopy': parts}


def shipping_bin():
    parts = [to_object(box((1.3, 0.85, 0.7), (0, 0, 0.35), 0.04), 'box', (KIT['woodDark'], KIT['wood']))]
    parts.append(to_object(box((1.38, 0.92, 0.1), (0, 0.05, 0.78), 0.03, (math.radians(-8), 0, 0)), 'lid', KIT['woodLight']))
    for x in (-0.45, 0.45):
        parts.append(to_object(box((0.08, 0.9, 0.72), (x, 0, 0.36), 0.0), 'band', KIT['metal']))
    return {'body': parts}


def well():
    ring = cone(0.85, 0.85, 0.8, (0, 0, 0.4), 14)
    hole = cone(0.62, 0.62, 0.05, (0, 0, 0.81), 14)
    parts = [to_object(ring, 'ring', (KIT['stoneDark'], KIT['stone'])), to_object(hole, 'water', KIT['window'])]
    for s in (-1, 1):
        parts.append(to_object(box((0.14, 0.14, 2.0), (s * 0.78, 0, 1.4), 0.03), 'post', KIT['woodDark']))
    for s in (-1, 1):
        parts.append(to_object(box((2.0, 0.9, 0.08), (0, s * 0.36, 2.55), 0.03, (s * math.radians(32), 0, 0)), 'roof', (KIT['roofRedDark'], KIT['roofRed'])))
    parts.append(to_object(cone(0.06, 0.06, 1.7, (0, 0, 2.05), 8, (0, math.pi / 2, 0)), 'axle', KIT['wood']))
    parts.append(to_object(cone(0.16, 0.13, 0.25, (0.15, 0, 1.45), 10), 'bucket', KIT['wood']))
    return {'body': parts}


def woodpile():
    parts = []
    for row, n in enumerate((5, 4, 3)):
        for i in range(n):
            x = (i - (n - 1) / 2) * 0.27
            parts.append(to_object(cone(0.13, 0.13, 1.1, (x, 0, 0.13 + row * 0.23), 8, (math.pi / 2, 0, 0)), 'log', (KIT['trunkDark'], KIT['woodLight'])))
    return {'body': parts}


def crate():
    parts = [to_object(box((0.7, 0.55, 0.45), (0, 0, 0.225), 0.03), 'crate', (KIT['woodDark'], KIT['woodLight']))]
    for i in range(6):
        parts.append(to_object(sphere_bm(0.11, (-0.2 + (i % 3) * 0.2, -0.1 + (i // 3) * 0.2, 0.48), 1), 'produce', (KIT['apple'], KIT['flowerYellow'])[i % 2]))
    return {'body': parts}


def barrel():
    b = cone(0.32, 0.32, 0.85, (0, 0, 0.425), 12)
    for v in b.verts:
        k = 1 + 0.12 * math.cos((v.co.z - 0.425) / 0.425 * math.pi / 2)
        v.co.x *= k
        v.co.y *= k
    parts = [to_object(b, 'barrel', (KIT['woodDark'], KIT['wood']), smooth=True)]
    for z in (0.15, 0.7):
        parts.append(to_object(cone(0.36, 0.36, 0.05, (0, 0, z), 12), 'hoop', KIT['metal']))
    return {'body': parts}


def signpost():
    return {'body': [to_object(box((0.12, 0.12, 1.6), (0, 0, 0.8), 0.03), 'post', KIT['woodDark']),
                     to_object(box((1.0, 0.07, 0.42), (0.3, 0, 1.35), 0.04), 'board', (KIT['wood'], KIT['woodLight'])),
                     to_object(box((0.8, 0.07, 0.34), (-0.2, 0, 0.92), 0.04, (0, 0, 0.12)), 'board', (KIT['wood'], KIT['woodLight']))]}


def mailbox():
    return {'body': [to_object(box((0.1, 0.1, 1.05), (0, 0, 0.52), 0.02), 'post', KIT['woodDark']),
                     to_object(box((0.32, 0.5, 0.3), (0, 0, 1.15), 0.08), 'box', KIT['roofRed']),
                     to_object(box((0.03, 0.04, 0.2), (0.17, 0.12, 1.32), 0.0), 'flag', KIT['flowerYellow'])]}


def bench():
    parts = []
    for i in range(3):
        parts.append(to_object(box((1.6, 0.14, 0.05), (0, -0.15 + i * 0.15, 0.45), 0.015), 'seat', KIT['woodLight']))
    for i in range(2):
        parts.append(to_object(box((1.6, 0.05, 0.13), (0, 0.2, 0.68 + i * 0.18), 0.015), 'back', KIT['woodLight']))
    for x in (-0.7, 0.7):
        parts.append(to_object(box((0.08, 0.45, 0.45), (x, 0, 0.225), 0.02), 'leg', KIT['woodDark']))
        parts.append(to_object(box((0.08, 0.06, 0.9), (x, 0.2, 0.45), 0.02), 'leg', KIT['woodDark']))
    return {'body': parts}


def bridge(length):
    """Arched plank bridge: span along X, centred, abutments at x = ±length/2 (deck curve: bridges.json)."""
    w, lift, arch = BRIDGES['width'], BRIDGES['lift'], BRIDGES['arch'][str(length)]
    deck = lambda t: lift + arch * math.sin(math.pi * t)
    parts = []
    n = int(length / 0.3)
    for i in range(n):
        t = (i + 0.5) / n
        x = -length / 2 + t * length
        slope = math.atan(arch * math.pi / length * math.cos(math.pi * t))
        parts.append(to_object(box((length / n - 0.03, w, 0.08), (x, 0, deck(t) - 0.04), 0.012, (0, -slope, 0)), 'plank',
                               (KIT['woodDark'], KIT['wood']) if i % 3 else (KIT['woodDark'], KIT['woodLight'])))
    posts = max(3, int(length / 1.5) + 1)
    for s in (-1, 1):
        for i in range(posts):
            t = i / (posts - 1)
            x = -length / 2 + t * length
            parts.append(to_object(box((0.13, 0.13, 0.95), (x, s * (w / 2 - 0.05), deck(t) + 0.4), 0.03), 'post', KIT['woodDark']))
        for i in range(posts - 1):
            t0, t1 = i / (posts - 1), (i + 1) / (posts - 1)
            x0, x1 = -length / 2 + t0 * length, -length / 2 + t1 * length
            z0, z1 = deck(t0) + 0.82, deck(t1) + 0.82
            seg = Vector((x1 - x0, 0, z1 - z0))
            parts.append(to_object(box((seg.length + 0.1, 0.09, 0.11), ((x0 + x1) / 2, s * (w / 2 - 0.05), (z0 + z1) / 2), 0.02,
                                       (0, -math.atan2(seg.z, seg.x), 0)), 'rail', KIT['woodLight']))
    # Beams under the deck down to the abutments
    for s in (-1, 1):
        for i in range(8):
            t0, t1 = i / 8, (i + 1) / 8
            seg = Vector(((t1 - t0) * length, 0, deck(t1) - deck(t0)))
            parts.append(to_object(box((seg.length + 0.05, 0.16, 0.18), (-length / 2 + (t0 + t1) / 2 * length, s * (w / 2 - 0.3), (deck(t0) + deck(t1)) / 2 - 0.16), 0.02,
                                       (0, -math.atan2(seg.z, seg.x), 0)), 'beam', KIT['trunkDark']))
    return {'body': parts}


def fence():
    parts = []
    for x in (-1.0, 1.0):
        parts.append(to_object(box((0.15, 0.15, 1.05), (x, 0, 0.45), 0.035), 'post', (KIT['woodDark'], KIT['wood'])))
        parts.append(to_object(box((0.19, 0.19, 0.08), (x, 0, 1.0), 0.03), 'cap', KIT['woodLight']))
    for z in (0.42, 0.78):
        parts.append(to_object(box((2.15, 0.07, 0.13), (0, 0, z), 0.025), 'rail', KIT['woodLight']))
    return {'body': parts}


def sphere_bm(r, loc, subdivisions=1):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdivisions, radius=r)
    place(bm, loc, (0, 0, 0))
    return bm


def rock(seed, scale):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1)
    for v in bm.verts:
        v.co *= 1 + noise.noise(v.co * 1.4 + Vector((seed, 0, 0))) * 0.22
        v.co = Vector((v.co.x * scale[0], v.co.y * scale[1], max(-0.15, v.co.z) * scale[2]))
    return {'body': [to_object(bm, 'rock', (KIT['rockDark'], KIT['rock']), smooth=True)]}


def stepping_stone():
    bm = cone(0.46, 0.4, 0.14, (0, 0, 0.0), segments=9)
    for v in bm.verts:
        v.co.x *= 1 + noise.noise(v.co * 3) * 0.12
    return {'body': [to_object(bm, 'stone', (KIT['stoneDark'], KIT['stone']), smooth=False)]}


def tool_hoe():
    """Held in the right hand: the grip at the origin, the handle running down the arm's -Z (Blender).
    As in the props sheet: a pale wooden haft, a wide dark steel blade on a socket, bent towards you."""
    return {'body': [to_object(cone(0.024, 0.02, 1.05, (0, 0, -0.42), 8), 'handle', (KIT['woodDark'], KIT['woodLight']), smooth=True),
                     to_object(box((0.17, 0.035, 0.15), (0, -0.09, -0.97), 0.008, (math.radians(-20), 0, 0)), 'blade', (KIT['trunkDark'], KIT['steel'])),
                     to_object(box((0.17, 0.04, 0.025), (0, -0.115, -1.04), 0.004, (math.radians(-20), 0, 0)), 'edge', KIT['steel']),
                     to_object(cone(0.04, 0.032, 0.09, (0, -0.02, -0.92), 8, (math.radians(70), 0, 0)), 'socket', KIT['trunkDark'], smooth=True)]}


def tool_can():
    """The sheet's watering can: a round blue body, an arched handle over the top, a long spout
    ending in a perforated rose."""
    body = cone(0.12, 0.115, 0.2, (0, 0.06, -0.21), 14)
    top = sphere_bm(0.118, (0, 0.06, -0.11), 2)
    bmesh.ops.scale(top, vec=(1, 1, 0.35), verts=top.verts)
    spout = cone(0.018, 0.03, 0.34, (0, -0.15, -0.17), 8, (math.radians(-58), 0, 0))
    handle = []
    for k in range(7):
        a0, a1 = math.pi * k / 7, math.pi * (k + 1) / 7
        p0 = Vector((0, 0.06 + math.cos(a0) * 0.09, -0.06 + math.sin(a0) * 0.1))
        p1 = Vector((0, 0.06 + math.cos(a1) * 0.09, -0.06 + math.sin(a1) * 0.1))
        mid, seg = (p0 + p1) / 2, p1 - p0
        handle.append(to_object(box((0.025, seg.length + 0.01, 0.025), tuple(mid), 0.0, (math.atan2(seg.z, seg.y), 0, 0)), 'grip', KIT['roofBlueDark']))
    rose = cone(0.045, 0.045, 0.02, (0, -0.29, -0.06), 12, (math.radians(-58), 0, 0))
    return {'body': [to_object(body, 'can', (KIT['roofBlueDark'], KIT['roofBlue']), smooth=True),
                     to_object(top, 'top', KIT['roofBlue'], smooth=True),
                     to_object(spout, 'spout', KIT['roofBlueDark'], smooth=True),
                     to_object(rose, 'rose', KIT['steel'])] + handle}


def seed_bag():
    """A burlap seed sack gathered at the neck with rope, a green sprout printed on the front."""
    bag = sphere_bm(0.11, (0, 0, -0.13), 2)
    bmesh.ops.scale(bag, vec=(1.05, 0.85, 1.1), verts=bag.verts)
    for v in bag.verts:  # flat bottom, gathered top
        v.co.z = max(v.co.z, -0.24)
        if v.co.z > -0.08:
            k = 1 - (v.co.z + 0.08) / 0.1 * 0.55
            v.co.x *= k
            v.co.y *= k
    return {'body': [to_object(bag, 'bag', (KIT['plankDark'], KIT['burlap']), smooth=True),
                     to_object(cone(0.05, 0.06, 0.03, (0, 0, -0.03), 10), 'rope', KIT['rope']),
                     to_object(cone(0.035, 0.015, 0.05, (0, 0, 0.0), 8), 'neck', KIT['burlap']),
                     to_object(box((0.03, 0.012, 0.05), (0, -0.095, -0.12), 0.0), 'sprout', KIT['leaf']),
                     to_object(box((0.05, 0.012, 0.025), (0.022, -0.095, -0.09), 0.0, (0, 0.5, 0)), 'sprout', KIT['leafLight']),
                     to_object(box((0.05, 0.012, 0.025), (-0.022, -0.095, -0.09), 0.0, (0, -0.5, 0)), 'sprout', KIT['leafLight'])]}


def bucket():
    """Wooden bucket: staves (alternating shades), two dark iron hoops, a rope handle."""
    parts = []
    n = 12
    for i in range(n):
        a = 2 * math.pi * i / n
        r = 0.2
        parts.append(to_object(box((0.11, 0.035, 0.36), (math.cos(a) * r, math.sin(a) * r, 0.18), 0.0, (0, 0, a + math.pi / 2)),
                               'stave', (KIT['plankDark'], KIT['plank'] if i % 2 else KIT['woodLight'])))
    parts.append(to_object(cone(0.19, 0.19, 0.03, (0, 0, 0.03), 12), 'floor', KIT['plankDark']))
    for z in (0.08, 0.28):
        parts.append(to_object(cone(0.218, 0.218, 0.035, (0, 0, z), 14), 'hoop', KIT['trunkDark']))
    for k in range(6):
        a0, a1 = math.pi * k / 6, math.pi * (k + 1) / 6
        p0, p1 = Vector((math.cos(a0) * 0.21, 0, 0.36 + math.sin(a0) * 0.16)), Vector((math.cos(a1) * 0.21, 0, 0.36 + math.sin(a1) * 0.16))
        seg = p1 - p0
        parts.append(to_object(box((seg.length + 0.01, 0.025, 0.025), tuple((p0 + p1) / 2), 0.0, (0, -math.atan2(seg.z, seg.x), 0)), 'handle', KIT['rope']))
    return {'body': parts}


def milk_pail():
    """Steel milk churn: a tapered body, a shoulder, a neck with a lid, a wooden-gripped bail."""
    parts = [to_object(cone(0.2, 0.19, 0.42, (0, 0, 0.21), 14), 'body', (KIT['metal'], KIT['steel']), smooth=True),
             to_object(cone(0.19, 0.11, 0.1, (0, 0, 0.47), 14), 'shoulder', KIT['steel'], smooth=True),
             to_object(cone(0.11, 0.11, 0.08, (0, 0, 0.56), 14), 'neck', KIT['steel'], smooth=True),
             to_object(cone(0.125, 0.12, 0.04, (0, 0, 0.62), 14), 'lid', KIT['metal'], smooth=True)]
    for z in (0.06, 0.38):
        parts.append(to_object(cone(0.205, 0.205, 0.025, (0, 0, z), 14), 'band', KIT['metal']))
    for s_ in (-1, 1):
        parts.append(to_object(box((0.02, 0.02, 0.2), (s_ * 0.13, 0, 0.68), 0.0, (0, -s_ * 0.5, 0)), 'bail', KIT['metal']))
    parts.append(to_object(cone(0.022, 0.022, 0.13, (0, 0, 0.77), 8, (0, math.pi / 2, 0)), 'grip', KIT['woodLight'], smooth=True))
    return {'body': parts}


def hay_bale():
    """A golden hay bale: a soft block with straw tufts poking out, tied with two strings."""
    bale = box((0.9, 0.5, 0.42), (0, 0, 0.21), 0.07, segments=2)
    for v in bale.verts:
        v.co += Vector((noise.noise(v.co * 9) * 0.02, noise.noise(v.co * 9 + Vector((3, 0, 0))) * 0.02, 0))
    parts = [to_object(bale, 'bale', (KIT['thatchDark'], KIT['hay']))]
    for x in (-0.22, 0.22):
        parts.append(to_object(box((0.03, 0.53, 0.45), (x, 0, 0.21), 0.012), 'string', KIT['rope']))
    rng = __import__('random').Random(3)
    for k in range(14):
        x, y = (rng.random() - 0.5) * 0.8, (rng.random() - 0.5) * 0.4
        parts.append(to_object(cone(0.012, 0.0, 0.1, (x, y, 0.45), 4, (rng.random() - 0.5, rng.random() - 0.5, 0)), 'straw', KIT['hay']))
    return {'body': parts}


def wheelbarrow():
    """A wooden wheelbarrow: a plank tray flaring out, a spoked wheel at the front, two handles and legs."""
    parts = []
    tray_z = 0.5
    parts.append(to_object(box((0.55, 0.75, 0.04), (0, -0.05, tray_z), 0.01), 'floor', (KIT['plankDark'], KIT['plank'])))
    for sx in (-1, 1):
        parts.append(to_object(box((0.04, 0.8, 0.26), (sx * 0.31, -0.05, tray_z + 0.13), 0.01, (0, sx * 0.25, 0)), 'side', (KIT['plankDark'], KIT['plank'])))
    parts.append(to_object(box((0.6, 0.04, 0.26), (0, -0.46, tray_z + 0.13), 0.01, (0.3, 0, 0)), 'front', (KIT['plankDark'], KIT['woodLight'])))
    parts.append(to_object(box((0.6, 0.04, 0.26), (0, 0.36, tray_z + 0.13), 0.01, (-0.2, 0, 0)), 'back', (KIT['plankDark'], KIT['woodLight'])))
    for sx in (-1, 1):
        parts.append(to_object(box((0.05, 1.5, 0.05), (sx * 0.22, 0.1, 0.42), 0.012, (-0.12, 0, 0)), 'handle', KIT['woodLight']))
        parts.append(to_object(box((0.045, 0.045, 0.36), (sx * 0.22, 0.42, 0.2), 0.01), 'leg', KIT['woodDark']))
    wheel = cone(0.2, 0.2, 0.06, (0, -0.68, 0.2), 16, (0, math.pi / 2, 0))
    parts.append(to_object(wheel, 'wheel', KIT['trunkDark']))
    parts.append(to_object(cone(0.165, 0.165, 0.065, (0, -0.68, 0.2), 16, (0, math.pi / 2, 0)), 'rim', KIT['woodLight']))
    for k in range(4):
        parts.append(to_object(box((0.03, 0.03, 0.3), (0, -0.68, 0.2), 0.0, (k * math.pi / 4, 0, 0)), 'spoke', KIT['woodDark']))
    return {'body': parts}


def log():
    return {'body': [to_object(cone(0.14, 0.14, 0.7, (0, 0, 0.14), 9, (math.pi / 2, 0, 0)), 'log', (KIT['trunkDark'], KIT['woodLight']), smooth=True)]}


def apple():
    return {'body': [to_object(sphere_bm(0.11, (0, 0, 0.1), 2), 'apple', KIT['apple'], smooth=True),
                     to_object(cone(0.01, 0.008, 0.06, (0, 0, 0.23), 5), 'stem', KIT['trunkDark']),
                     to_object(sphere_bm(0.035, (0.04, 0, 0.23), 1), 'leaf', KIT['leaf'])]}


def stone_small():
    out = rock(11.0, (0.22, 0.2, 0.17))
    return out


ASSETS = {
    'tool_hoe': tool_hoe, 'tool_can': tool_can, 'seed_bag': seed_bag,
    'bucket': bucket, 'milk_pail': milk_pail, 'hay_bale': hay_bale, 'wheelbarrow': wheelbarrow,
    'log': log, 'apple': apple, 'stone_small': stone_small,
    'tree_oak': tree_oak, 'tree_oak_far': lambda: tree_oak(2),
    'tree_apple': tree_apple, 'tree_apple_far': lambda: tree_apple(2),
    'tree_sakura': tree_sakura, 'tree_sakura_far': lambda: tree_sakura(2),
    'tree_pine': tree_pine, 'tree_pine_far': lambda: tree_pine(2),
    'bush': bush, 'bush_flower': bush_flower,
    'house_player': house_player, 'house_villager_a': house_villager_a, 'house_villager_b': house_villager_b,
    'shop': shop, 'barn': barn, 'coop': coop,
    'crop_sprout': lambda: crop(0), 'crop_leafy': lambda: crop(1), 'crop_ripe': lambda: crop(2),
    'shipping_bin': shipping_bin, 'well': well, 'woodpile': woodpile, 'crate': crate, 'barrel': barrel,
    'signpost': signpost, 'mailbox': mailbox, 'bench': bench,
    **{f'bridge_{n}': (lambda n=n: bridge(n)) for n in BRIDGES['lengths']},
    'fence': fence,
    'rock_a': lambda: rock(2.0, (0.9, 0.75, 0.6)),
    'rock_b': lambda: rock(7.5, (0.55, 0.5, 0.42)),
    'stepping_stone': stepping_stone,
}

# ------------------------------------------------------------------ build, bake, export

roots = {}
for i, (name, build) in enumerate(ASSETS.items()):
    roots[name] = assemble(name, build(), (i * 40.0, 0, 0))
    bpy.ops.mesh.primitive_plane_add(size=24, location=(i * 40.0, 0, 0))
    bpy.context.active_object.name = f'_ground_{name}'

scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 160
scene.cycles.seed = 7
scene.world = bpy.data.worlds.new('bake')
scene.world.light_settings.distance = AO_DISTANCE
tint = AO_TINT
for root in roots.values():
    for obj in root.children:
        mesh = obj.data
        # Per vertex, not per face corner: corner bakes carry sampling noise that shows as facets
        ao = mesh.color_attributes.new('AO', 'FLOAT_COLOR', 'POINT')
        mesh.color_attributes.active_color = ao
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')
        col = mesh.color_attributes['Col']
        for i, loop in enumerate(mesh.loops):
            a = ao.data[loop.vertex_index].color[0]
            a = 0.25 + 0.75 * a  # never fully black: the painted look keeps colour in shadow
            c = col.data[i].color
            col.data[i].color = (c[0] * (tint[0] + (1 - tint[0]) * a), c[1] * (tint[1] + (1 - tint[1]) * a),
                                 c[2] * (tint[2] + (1 - tint[2]) * a), 1)
        mesh.color_attributes.remove(mesh.color_attributes['AO'])
        mesh.color_attributes.active_color = mesh.color_attributes['Col']
        mesh.color_attributes.render_color_index = 0

for obj in [o for o in scene.objects if o.name.startswith('_ground_')]:
    bpy.data.objects.remove(obj)
for root in roots.values():
    root.location = (0, 0, 0)

bpy.ops.object.select_all(action='DESELECT')
for root in roots.values():
    root.select_set(True)
    for child in root.children:
        child.select_set(True)
OUT.parent.mkdir(parents=True, exist_ok=True)
options = dict(filepath=str(OUT), export_format='GLB', use_selection=True, export_texcoords=False,
               export_normals=True, export_animations=False, export_extras=True, export_apply=True)
try:
    bpy.ops.export_scene.gltf(**options, export_vertex_color='ACTIVE')
except TypeError:
    bpy.ops.export_scene.gltf(**options, export_colors=True)

report = {}
for name, root in roots.items():
    report[name] = {child.name: sum(len(p.vertices) - 2 for p in child.data.polygons) for child in root.children}
    report[name]['total'] = sum(report[name].values())
REPORT.parent.mkdir(parents=True, exist_ok=True)
REPORT.write_text(json.dumps({'triangles': report, 'bytes': OUT.stat().st_size}, indent=2) + '\n')
print('valley kit', json.dumps(report))
