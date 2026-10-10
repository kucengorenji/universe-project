"""Valley animals for farm.html (docs/FARM_PLAN.md, milestone V4).

/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
    --python tools/blender/valley/build_valley_animals.py

Chibi farm animals built like the actors: pivot Empties (the bones) with rigid mesh parts as
children, so the game merges each animal into one rigidly skinned mesh and poses it in code.
Each animal sits under an Empty animal_<id> with its root pivot <id>_root at the feet, facing -Y
(glTF +Z). Colours come from src/valley/valleyPalette.json (kit).
Output: public/models/valley_animals.glb, report docs/qa/valley/animals.json.
"""
import json
import math
import os
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = Path(os.environ.get('GLOBE_ROOT', Path(__file__).resolve().parents[3]))
KIT = json.loads((ROOT / 'src/valley/valleyPalette.json').read_text())['kit']
OUT = ROOT / 'public/models/valley_animals.glb'
REPORT = ROOT / 'docs/qa/valley/animals.json'

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
MATERIALS = {}


def srgb(hex_colour):
    h = hex_colour.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


def material(key):
    if key not in MATERIALS:
        m = bpy.data.materials.new(f'M_{key}')
        m.diffuse_color = (*srgb(KIT[key]), 1)
        m.use_nodes = True
        m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = m.diffuse_color
        MATERIALS[key] = m
    return MATERIALS[key]


def link(obj, parent):
    scene.collection.objects.link(obj)
    if parent is not None:
        obj.parent = parent
    return obj


def pivot(name, parent, loc):
    e = bpy.data.objects.new(name, None)
    link(e, parent)
    e['world'] = list(loc)
    e.location = Vector(loc) - Vector(parent['world']) if parent is not None else Vector(loc)
    return e


def part(name, bm, colour, piv, smooth=True):
    """A rigid part under its pivot, with a painted shading gradient (darker underneath) in COLOR_0."""
    me = bpy.data.meshes.new(name)
    zs = [v.co.z for v in bm.verts]
    zmin, zmax = min(zs), max(zs)
    shade = [0.84 + 0.16 * min(1.0, (v.co.z - zmin) / max(1e-6, zmax - zmin) * 1.4) for v in bm.verts]
    bmesh.ops.translate(bm, vec=-Vector(piv['world']), verts=bm.verts)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(material(colour))
    me.polygons.foreach_set('use_smooth', [smooth] * len(me.polygons))
    col = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    for i, k in enumerate(shade):
        col.data[i].color = (k, k, k, 1)
    link(bpy.data.objects.new(name, me), piv)


def ball(r, loc, scale=(1, 1, 1), sub=2):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=r)
    bmesh.ops.scale(bm, vec=scale, verts=bm.verts)
    bmesh.ops.translate(bm, vec=loc, verts=bm.verts)
    return bm


def tube(r1, r2, a, b, seg=8):
    a, b = Vector(a), Vector(b)
    axis = b - a
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r1, radius2=r2, depth=axis.length)
    rot = Vector((0, 0, 1)).rotation_difference(axis.normalized()).to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=Matrix.Translation((a + b) / 2) @ rot, verts=bm.verts)
    return bm


def cone_at(r, h, loc, rot=(0, 0, 0), seg=8):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=0.0, depth=h)
    m = Matrix.Translation(loc) @ Matrix.Rotation(rot[2], 4, 'Z') @ Matrix.Rotation(rot[1], 4, 'Y') @ Matrix.Rotation(rot[0], 4, 'X')
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    return bm


def eyes(head, cx, cy, cz, spread, r=0.018, forward=-1, blush=None):
    """Glossy dark eyes with a white catch-light, and (for the cute ones) pink cheeks."""
    for s in (-1, 1):
        part(f'eye_{s}', ball(r, (cx + s * spread, cy, cz), (1, 0.6, 1.25), 2), 'eye', head)
        part(f'eyehi_{s}', ball(r * 0.36, (cx + s * spread + s * r * 0.3, cy - r * 0.55, cz + r * 0.45), (1, 0.6, 1), 1), 'flowerWhite', head)
        if blush:
            part(f'blush_{s}', ball(r * 0.95, (cx + s * (spread + r * 1.3), cy + r * 0.3, cz - r * 1.6), (1, 0.4, 0.6), 1), blush, head)


def chicken():
    root = pivot('chicken_root', None, (0, 0, 0))
    body = pivot('body', root, (0, 0, 0.22))
    neck = pivot('neck', body, (0, -0.08, 0.3))
    head = pivot('head', neck, (0, -0.1, 0.4))
    part('body', ball(0.16, (0, 0.01, 0.24), (0.9, 1.05, 0.85), 3), 'chickenWhite', body)
    part('belly', ball(0.12, (0, -0.02, 0.18), (0.9, 1, 0.8), 2), 'chickenShade', body)
    tail = pivot('tail', body, (0, 0.13, 0.3))
    part('tail', ball(0.08, (0, 0.18, 0.36), (0.6, 0.9, 1.3), 1), 'chickenWhite', tail)
    for s, side in ((1, 'L'), (-1, 'R')):
        w = pivot(f'wing_{side}', body, (s * 0.13, 0.0, 0.3))
        part(f'wing_{side}', ball(0.09, (s * 0.15, 0.03, 0.24), (0.35, 1, 0.7), 1), 'chickenShade', w)
        leg = pivot(f'leg_{side}', root, (s * 0.06, 0.0, 0.12))
        part(f'leg_{side}', tube(0.014, 0.012, (s * 0.06, 0, 0.12), (s * 0.06, 0, 0.02), 6), 'beak', leg)
        part(f'foot_{side}', ball(0.03, (s * 0.06, -0.025, 0.012), (1, 1.6, 0.35), 1), 'beak', leg)
    part('neck', ball(0.075, (0, -0.1, 0.36), (0.9, 0.9, 1.2), 1), 'chickenWhite', neck)
    part('head', ball(0.092, (0, -0.12, 0.45), (1, 1, 1), 3), 'chickenWhite', head)
    part('comb', ball(0.04, (0, -0.12, 0.53), (0.5, 1.2, 0.8), 1), 'comb', head)
    part('wattle', ball(0.022, (0, -0.19, 0.39), (0.7, 0.6, 1.2), 1), 'comb', head)
    part('beak', cone_at(0.025, 0.06, (0, -0.215, 0.435), (math.pi / 2, 0, 0)), 'beak', head)
    eyes(head, 0, -0.19, 0.465, 0.046, 0.016, blush='flowerPink')
    return root


def cow():
    root = pivot('cow_root', None, (0, 0, 0))
    body = pivot('body', root, (0, 0, 0.8))
    part('body', ball(0.5, (0, 0.05, 0.85), (0.82, 1.4, 0.72), 3), 'cowWhite', body)
    for i, (x, y, z, r) in enumerate(((0.3, 0.2, 1.0, 0.2), (-0.28, -0.25, 0.95, 0.17), (0.18, 0.55, 0.8, 0.15), (-0.32, 0.45, 1.05, 0.13))):
        part(f'spot_{i}', ball(r, (x * 1.12, y, z), (0.35, 1.2, 1), 2), 'cowSpot', body)
    part('udder', ball(0.13, (0, 0.38, 0.47), (1, 1, 0.7), 2), 'cowPink', body)
    neck = pivot('neck', body, (0, -0.55, 1.0))
    head = pivot('head', neck, (0, -0.75, 1.08))
    part('head', ball(0.26, (0, -0.82, 1.12), (0.95, 1.0, 0.95), 3), 'cowWhite', head)
    part('muzzle', ball(0.16, (0, -1.0, 1.0), (1.1, 0.8, 0.75), 2), 'cowPink', head)
    for s in (-1, 1):
        part(f'nostril_{s}', ball(0.025, (s * 0.06, -1.12, 1.02), (1, 0.5, 1), 1), 'cowSpot', head)
        part(f'horn_{s}', cone_at(0.04, 0.12, (s * 0.15, -0.78, 1.33), (0, s * 0.5, 0)), 'horn', head)
        part(f'ear_{s}', ball(0.07, (s * 0.25, -0.75, 1.2), (1.2, 0.4, 0.6), 1), 'cowWhite', head)
    eyes(head, 0, -1.0, 1.22, 0.12, 0.032)
    tail = pivot('tail', body, (0, 0.72, 1.05))
    part('tail', tube(0.025, 0.02, (0, 0.74, 1.05), (0, 0.82, 0.6), 6), 'cowWhite', tail)
    part('tuft', ball(0.06, (0, 0.82, 0.56), (1, 1, 1.4), 1), 'cowSpot', tail)
    for name, (x, y) in {'leg_FL': (0.25, -0.38), 'leg_FR': (-0.25, -0.38), 'leg_BL': (0.25, 0.42), 'leg_BR': (-0.25, 0.42)}.items():
        leg = pivot(name, root, (x, y, 0.55))
        part(name, tube(0.09, 0.08, (x, y, 0.6), (x, y, 0.1), 8), 'cowWhite', leg)
        part(f'{name}_hoof', tube(0.085, 0.085, (x, y, 0.12), (x, y, 0.0), 8), 'hoof', leg)
    return root


def dog():
    root = pivot('dog_root', None, (0, 0, 0))
    body = pivot('body', root, (0, 0, 0.3))
    part('body', ball(0.17, (0, 0.03, 0.32), (0.85, 1.55, 0.85), 3), 'dogTan', body)
    part('chest', ball(0.12, (0, -0.15, 0.28), (0.9, 0.9, 1), 2), 'dogCream', body)
    neck = pivot('neck', body, (0, -0.2, 0.42))
    head = pivot('head', neck, (0, -0.26, 0.5))
    part('head', ball(0.15, (0, -0.28, 0.53), (1.05, 0.95, 0.92), 3), 'dogTan', head)
    part('snout', ball(0.07, (0, -0.42, 0.48), (1, 1.1, 0.75), 2), 'dogCream', head)
    part('nose', ball(0.025, (0, -0.49, 0.5), (1, 0.7, 0.8), 1), 'eye', head)
    for s in (-1, 1):
        part(f'ear_{s}', cone_at(0.055, 0.12, (s * 0.08, -0.25, 0.66), (0, s * 0.3, 0)), 'dogDark', head)
    eyes(head, 0, -0.4, 0.57, 0.062, 0.022, blush='flowerPink')
    tail = pivot('tail', body, (0, 0.24, 0.42))
    part('tail', ball(0.065, (0, 0.24, 0.5), (0.8, 0.8, 1.4), 2), 'dogTan', tail)
    part('tailtip', ball(0.04, (0, 0.2, 0.58), (1, 1, 1), 1), 'dogCream', tail)
    for name, (x, y) in {'leg_FL': (0.08, -0.14), 'leg_FR': (-0.08, -0.14), 'leg_BL': (0.08, 0.2), 'leg_BR': (-0.08, 0.2)}.items():
        leg = pivot(name, root, (x, y, 0.24))
        part(name, tube(0.04, 0.035, (x, y, 0.25), (x, y, 0.03), 6), 'dogTan', leg)
        part(f'{name}_paw', ball(0.04, (x, y - 0.015, 0.03), (1, 1.2, 0.6), 1), 'dogCream', leg)
    return root


ANIMALS = {'chicken': chicken, 'cow': cow, 'dog': dog}
roots = {}
for name, build in ANIMALS.items():
    holder = bpy.data.objects.new(f'animal_{name}', None)
    holder['world'] = [0, 0, 0]
    link(holder, None)
    root = build()
    root.parent = holder
    roots[name] = holder

# Bake ambient occlusion into the painted shading (animals spread apart so they do not shade each other)
for i, holder in enumerate(roots.values()):
    holder.location = (i * 5.0, 0, 0)
bpy.ops.mesh.primitive_plane_add(size=40, location=(5, 0, 0))
plane = bpy.context.active_object
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 96
scene.cycles.seed = 5
scene.world = bpy.data.worlds.new('bake')
scene.world.light_settings.distance = 0.3
TINT = (0.66, 0.6, 0.72)
bpy.context.view_layer.update()
for holder in roots.values():
    for obj in holder.children_recursive:
        if obj.type != 'MESH' or obj.name.startswith(('eye', 'blush')):
            continue
        me = obj.data
        ao = me.color_attributes.new('AO', 'FLOAT_COLOR', 'POINT')
        me.color_attributes.active_color = ao
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')
        col = me.color_attributes['Col']
        for k in range(len(me.vertices)):
            a = 0.35 + 0.65 * ao.data[k].color[0]
            c = col.data[k].color
            col.data[k].color = tuple(c[j] * (TINT[j] + (1 - TINT[j]) * a) for j in range(3)) + (1,)
        me.color_attributes.remove(me.color_attributes['AO'])
        me.color_attributes.active_color = me.color_attributes['Col']
        me.color_attributes.render_color_index = 0
bpy.data.objects.remove(plane)
for holder in roots.values():
    holder.location = (0, 0, 0)

bpy.ops.object.select_all(action='SELECT')
OUT.parent.mkdir(parents=True, exist_ok=True)
options = dict(filepath=str(OUT), export_format='GLB', use_selection=True, export_texcoords=False,
               export_normals=True, export_animations=False, export_extras=False, export_apply=True)
try:
    bpy.ops.export_scene.gltf(**options, export_vertex_color='ACTIVE')
except TypeError:
    bpy.ops.export_scene.gltf(**options, export_colors=True)
report = {}
for name, holder in roots.items():
    objs = list(holder.children_recursive)
    report[name] = {'triangles': sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs if o.type == 'MESH'),
                    'bones': sum(1 for o in objs if o.type == 'EMPTY')}
REPORT.write_text(json.dumps({'animals': report, 'bytes': OUT.stat().st_size}, indent=2) + '\n')
print('valley animals', json.dumps(report))
