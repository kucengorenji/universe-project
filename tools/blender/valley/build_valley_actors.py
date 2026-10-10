"""Valley actors for farm.html (docs/FARM_PLAN.md, milestone V1).

/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
    --python tools/blender/valley/build_valley_actors.py

Semi-chibi, 4.5 heads, 1.35 m. Every actor uses the pivot hierarchy and bone names of the NPC v1
townsfolk (public/models/npc.glb): NPC_C01 > hips > spine > chest > neck > head, clavicle >
shoulder > elbow > wrist (> cup), hip > knee > ankle > toe. Meshes are rigid children of their
pivot, so the town's buildTemplate() skins them and animateNpc() walks them; the game measures
the shorter legs from the pivots. Material names pick the per-person palette slot (M_skin,
M_hair, M_shirt, M_under, M_pants, M_shoe_upper, M_cap), mesh names pick the optional pieces
(hat_, glasses_, beard_B02, hair_*_crown) and the expressions (expr_<feature>_<variant>).

Four archetypes, each under an Empty actor_<id>: player, seller, child, elder. Blender makes
names unique with .001 suffixes; the game strips them per actor.
Output: public/models/valley_actors.glb, report docs/qa/valley/actors.json.
"""
import json
import math
import os
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = Path(os.environ.get('GLOBE_ROOT', Path(__file__).resolve().parents[3]))
OUT = ROOT / 'public/models/valley_actors.glb'
REPORT = ROOT / 'docs/qa/valley/actors.json'

# Proportions (m). Head 0.30 of 1.35. Blender is Z-up, the actor faces -Y (glTF +Z).
HEAD_R = 0.152
HEAD_C = 1.35 - HEAD_R          # centre of the skull
# The skull is an ellipsoid, a little wider than tall: round chibi cheeks (the turnaround's face)
HEAD_SX, HEAD_SZ = 1.07, 0.97
NECK_Z = 1.02
CHEST_Z = 0.80
SPINE_Z = 0.66
HIPS_Z = 0.60
HIP_X, HIP_DROP = 0.075, 0.02   # hip joints 0.58 above the ground
THIGH, SHIN, ANKLE_H, BALL = 0.24, 0.24, 0.10, 0.085
SHOULDER = (0.142, 0.965)  # narrow child's shoulders: the head stays the widest thing
UPPER_ARM, FORE_ARM = 0.2, 0.18  # hands reach mid-thigh, as in the turnaround

# Base colours only: the game repaints slotted materials per person.
MATS = {
    'M_skin': '#f3c9a1', 'M_hair': '#7a4a2e', 'M_shirt': '#efe8d6', 'M_under': '#d9c39a',
    'M_pants': '#4f78b8', 'M_shoe_upper': '#7a4f33', 'M_cap': '#3f6aa8', 'M_shoe_sole': '#4a3426',
    'M_eye': '#2b211c', 'M_eye_hi': '#ffffff', 'M_mouth': '#8a3b32', 'M_blush': '#f19a8c',
    'M_beard': '#ece6dc', 'M_glasses': '#5a4636', 'M_button': '#e4c66a', 'M_brow': '#6a4026', 'M_iris': '#8a5230',
    'M_pupil': '#2a160c', 'M_tongue': '#d9837a', 'M_brim': '#e8b23c', 'M_emblem': '#c6402f', 'M_glove': '#4b423e',
    'M_glove_cuff': '#c0472f', 'M_leather': '#7a4a2a', 'M_brass': '#b88b3e', 'M_canvas': '#86814f', 'M_sole': '#3b2f29',
    'M_lace': '#3a2a20', 'M_stitch': '#cf9a52', 'M_cuff': '#8fa8cf',
}


def srgb(hex_colour):
    h = hex_colour.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
MATERIALS = {}
for name, colour in MATS.items():
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*srgb(colour), 1)
    m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = m.diffuse_color
    MATERIALS[name] = m


def link(obj, parent):
    scene.collection.objects.link(obj)
    if parent is not None:
        obj.parent = parent
    return obj


def empty(name, parent, loc):
    """A pivot at a world position; returned with its world location remembered."""
    e = bpy.data.objects.new(name, None)
    link(e, parent)
    e['world'] = list(loc)
    if parent is not None:
        p = Vector(parent['world'])
        e.location = Vector(loc) - p
    else:
        e.location = loc
    return e


def painted(name, material, co, zmin, zmax):
    """Painted shading multiplier (COLOR_0) at a world-space vertex, before the AO bake.
    Hair gets the anime 'angel ring' (a lighter band round the crown, darker roots); clothes
    darken towards their hems; skin and the rest stay at 1."""
    if material in ('M_hair', 'M_beard'):
        t = (co.z - HEAD_C) / HEAD_R
        ring = math.exp(-((t - 0.5) / 0.13) ** 2)
        return 0.8 + 0.2 * ring - 0.1 * max(0.0, -t)
    if material in ('M_shirt', 'M_pants', 'M_under', 'M_cap', 'M_shoe_upper'):
        k = (co.z - zmin) / max(1e-6, zmax - zmin)
        return 0.86 + 0.14 * min(1.0, k * 1.6)
    return 1.0


def mesh(name, bm, material, pivot, smooth=True):
    """bm is built in world space; it becomes a child of pivot in that pivot's local space."""
    me = bpy.data.meshes.new(name)
    zs = [v.co.z for v in bm.verts]
    zmin, zmax = (min(zs), max(zs)) if zs else (0, 1)
    shade = [painted(name, material, v.co, zmin, zmax) for v in bm.verts]
    bmesh.ops.translate(bm, vec=-Vector(pivot['world']), verts=bm.verts)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(MATERIALS[material])
    me.polygons.foreach_set('use_smooth', [smooth] * len(me.polygons))
    col = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    for i, k in enumerate(shade):
        col.data[i].color = (k, k, k, 1)
    obj = bpy.data.objects.new(name, me)
    link(obj, pivot)
    return obj


def ball(r, loc, scale=(1, 1, 1), subdivisions=2):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdivisions, radius=r)
    bmesh.ops.scale(bm, vec=scale, verts=bm.verts)
    bmesh.ops.translate(bm, vec=loc, verts=bm.verts)
    return bm


def capsule(r1, r2, a, b, segments=10):
    """A tapered tube from a to b with rounded ends (world space)."""
    a, b = Vector(a), Vector(b)
    axis = b - a
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, radius1=r1, radius2=r2, depth=axis.length)
    rot = Vector((0, 0, 1)).rotation_difference(axis.normalized()).to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=Matrix.Translation((a + b) / 2) @ rot, verts=bm.verts)
    for end, r in ((a, r1), (b, r2)):
        cap = ball(r, end, subdivisions=1)
        tmp = bpy.data.meshes.new('tmp')
        cap.to_mesh(tmp)
        cap.free()
        bm.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)
    return bm


def rounded_box(size, loc, bevel=0.03, segments=2):
    """A box with softened edges; tiny details (bevel 0) stay plain boxes, 12 triangles."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    if bevel > 0.0005:
        bmesh.ops.bevel(bm, geom=bm.edges[:], offset=bevel, segments=segments, affect='EDGES', profile=0.5)
    bmesh.ops.translate(bm, vec=loc, verts=bm.verts)
    return bm


def merge(*bms):
    out = bmesh.new()
    for b in bms:
        tmp = bpy.data.meshes.new('tmp')
        b.to_mesh(tmp)
        b.free()
        out.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)
    return out


# ------------------------------------------------------------------ face decals

def on_head(points2d, lift=0.004, z_off=0.0):
    """Wrap a flat outline (x, z offsets from the head centre, on the face plane) onto the skull."""
    verts = []
    for x, z in points2d:
        z += z_off
        y2 = 1 - (x / (HEAD_R * HEAD_SX)) ** 2 - (z / (HEAD_R * HEAD_SZ)) ** 2
        y = -math.sqrt(max(y2, 1e-6)) * HEAD_R - lift
        verts.append(Vector((x, y, HEAD_C + z)))
    return verts


def flat_shape(outline, lift=0.004):
    """A filled face feature: fan from the centroid, wrapped onto the head."""
    bm = bmesh.new()
    cx = sum(p[0] for p in outline) / len(outline)
    cz = sum(p[1] for p in outline) / len(outline)
    centre = bm.verts.new(on_head([(cx, cz)], lift)[0])
    ring = [bm.verts.new(v) for v in on_head(outline, lift)]
    for i in range(len(ring)):
        bm.faces.new((centre, ring[i], ring[(i + 1) % len(ring)]))
    bm.normal_update()
    # Face away from the skull (the fan winding may point inward)
    for f in bm.faces:
        if f.normal.y > 0:
            f.normal_flip()
    return bm


def ellipse(cx, cz, rx, rz, n=14, start=0, end=2 * math.pi):
    return [(cx + rx * math.cos(start + (end - start) * i / n), cz + rz * math.sin(start + (end - start) * i / n)) for i in range(n)]


def stroke(points, width):
    """An open curve of given width as a ribbon, wrapped onto the head."""
    left, right = [], []
    for i, (x, z) in enumerate(points):
        a = points[max(0, i - 1)]
        b = points[min(len(points) - 1, i + 1)]
        dx, dz = b[0] - a[0], b[1] - a[1]
        l = math.hypot(dx, dz) or 1
        nx, nz = -dz / l * width / 2, dx / l * width / 2
        left.append((x + nx, z + nz))
        right.append((x - nx, z - nz))
    bm = bmesh.new()
    L = [bm.verts.new(v) for v in on_head(left, 0.005)]
    R = [bm.verts.new(v) for v in on_head(right, 0.005)]
    for i in range(len(points) - 1):
        f = bm.faces.new((L[i], R[i], R[i + 1], L[i + 1]))
        f.normal_update()
        if f.normal.y > 0:
            f.normal_flip()
    return bm


def arc(cx, cz, rx, rz, a0, a1, n=8):
    return [(cx + rx * math.cos(a0 + (a1 - a0) * i / n), cz + rz * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]


def face(head, eye_x=0.06, eye_z=-0.03):
    """Expression variants (see EXPR in chunkyPeople.js): only the chosen one of each feature draws."""
    for side in (-1, 1):
        x = side * eye_x
        # open: tall glossy eyes, the Harvest Moon look: a dark eye, a warm iris glowing in its
        # lower half, a big highlight up and out, a small one low and in, a soft upper lash
        # As in the turnaround: a big warm-brown iris filling most of the eye under a dark rim,
        # a darker pupil, one large catch-light up and out, a small one low, a thin upper lash
        mesh(f'expr_eyes_open_{side}', flat_shape(ellipse(x, eye_z, 0.029, 0.042, 18)), 'M_eye', head)
        mesh(f'expr_eyes_open_iris_{side}', flat_shape(ellipse(x, eye_z - 0.005, 0.024, 0.034, 16), 0.005), 'M_iris', head)
        mesh(f'expr_eyes_open_pupil_{side}', flat_shape(ellipse(x, eye_z - 0.002, 0.012, 0.019, 12), 0.0055), 'M_pupil', head)
        mesh(f'expr_eyes_open_hi_{side}', flat_shape(ellipse(x + side * 0.009, eye_z + 0.015, 0.0105, 0.013, 10), 0.006), 'M_eye_hi', head)
        mesh(f'expr_eyes_open_lo_{side}', flat_shape(ellipse(x - side * 0.008, eye_z - 0.022, 0.0045, 0.0045, 6), 0.006), 'M_eye_hi', head)
        mesh(f'expr_eyes_open_lash_{side}', stroke(arc(x, eye_z + 0.004, 0.031, 0.043, 0.5, math.pi - 0.5, 10), 0.006), 'M_eye', head)
        mesh(f'expr_eyes_closed_{side}', stroke(arc(x, eye_z - 0.006, 0.022, 0.012, math.pi, 2 * math.pi), 0.008), 'M_eye', head)
        mesh(f'expr_eyes_wide_{side}', flat_shape(ellipse(x, eye_z, 0.034, 0.05, 18)), 'M_eye', head)
        mesh(f'expr_eyes_wide_iris_{side}', flat_shape(ellipse(x, eye_z - 0.016, 0.025, 0.027, 14), 0.005), 'M_iris', head)
        mesh(f'expr_eyes_wide_hi_{side}', flat_shape(ellipse(x + side * 0.011, eye_z + 0.019, 0.012, 0.014, 10), 0.006), 'M_eye_hi', head)
        mesh(f'expr_eyes_squint_{side}', stroke(arc(x, eye_z - 0.012, 0.022, 0.018, 0.15, math.pi - 0.15), 0.009), 'M_eye', head)
        bz = eye_z + 0.052
        brows = {'neutral': [(x - 0.02, bz), (x + 0.02, bz)],
                 'raised': [(x - 0.02, bz + 0.008), (x, bz + 0.014), (x + 0.02, bz + 0.008)],
                 'worried': [(x - side * 0.02, bz + 0.012), (x + side * 0.02, bz - 0.004)],
                 'angry': [(x - side * 0.02, bz - 0.006), (x + side * 0.02, bz + 0.01)]}
        for name, pts in brows.items():
            mesh(f'expr_brows_{name}_{side}', stroke(pts, 0.008), 'M_brow', head)
        # Blush: not an expression, always on
        mesh(f'face_blush_{side}', flat_shape(ellipse(side * 0.092, eye_z - 0.036, 0.021, 0.011, 10), 0.003), 'M_blush', head)
    mz = eye_z - 0.056
    mouths = {
        'neutral': stroke([(-0.012, mz), (0.012, mz)], 0.006),
        'smile': stroke(arc(0, mz + 0.01, 0.02, 0.014, math.pi + 0.3, 2 * math.pi - 0.3), 0.007),
        'open': flat_shape(ellipse(0, mz - 0.002, 0.013, 0.012)),
        'frown': stroke(arc(0, mz - 0.012, 0.016, 0.01, 0.4, math.pi - 0.4), 0.007),
        'grin': flat_shape(ellipse(0, mz + 0.004, 0.022, 0.016, 14, math.pi, 2 * math.pi) + [(-0.022, mz + 0.004)]),
    }
    # The happy face's open mouth shows a tongue (the turnaround's 'happy')
    mesh('expr_mouth_grin_tongue', flat_shape(ellipse(0, mz - 0.006, 0.012, 0.006, 10), 0.006), 'M_tongue', head)
    for name, bm in mouths.items():
        mesh(f'expr_mouth_{name}', bm, 'M_mouth', head)


# ------------------------------------------------------------------ body

def oriented_box(a, b, w, t, out, material, pivot, name, bevel=0.004):
    """A strap or band from a to b: width w across, thickness t along `out` (the surface normal)."""
    a, b, out = Vector(a), Vector(b), Vector(out).normalized()
    axis = b - a
    length = axis.length
    y = axis.normalized()
    x = y.cross(out).normalized()
    z = x.cross(y)
    bm = rounded_box((w, length, t), (0, 0, 0), bevel, segments=1)
    basis = Matrix((x, y, z)).transposed().to_4x4()
    bmesh.ops.transform(bm, matrix=Matrix.Translation((a + b) / 2) @ basis, verts=bm.verts)
    return mesh(name, bm, material, pivot)


def ring(r, h, z, loc_xy=(0, 0), scale=(1, 1), seg=16, name='ring', material='M_cuff', pivot=None, open_ends=False):
    """A short open tube (cuff, collar, belt) around the vertical axis."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=not open_ends, segments=seg, radius1=r, radius2=r, depth=h)
    bmesh.ops.scale(bm, vec=(scale[0], scale[1], 1), verts=bm.verts)
    bmesh.ops.translate(bm, vec=(loc_xy[0], loc_xy[1], z), verts=bm.verts)
    return mesh(name, bm, material, pivot)


def glove(side, s, wr, wrist):
    """Work glove hanging down: palm, four short fingers, a thumb, a red cuff (as in the turnaround)."""
    x, y, z = wrist
    palm = rounded_box((0.05, 0.075, 0.075), (x + s * 0.004, y, z - 0.05), 0.02)
    mesh(f'glove_palm_{side}', palm, 'M_glove', wr)
    for k, fy in enumerate((-0.027, -0.009, 0.009, 0.027)):
        length = 0.045 - abs(fy) * 0.35
        top = Vector((x + s * 0.004, y + fy, z - 0.085))
        tip = top + Vector((-s * 0.006, 0, -length))
        f = merge(tube_open(0.0105, 0.0095, top, tip, 6), ball(0.0098, tip, subdivisions=1))
        mesh(f'glove_finger_{side}_{k}', f, 'M_glove', wr)
    thumb_a = Vector((x + s * 0.022, y - 0.03, z - 0.045))
    thumb_b = thumb_a + Vector((-s * 0.012, -0.014, -0.034))
    mesh(f'glove_thumb_{side}', merge(tube_open(0.012, 0.011, thumb_a, thumb_b, 6), ball(0.011, thumb_b, subdivisions=1)), 'M_glove', wr)
    ring(0.042, 0.036, z - 0.006, (x, y), (1, 1.12), 14, f'glove_cuff_{side}', 'M_glove_cuff', wr)


def tube_open(r1, r2, a, b, seg=8):
    a, b = Vector(a), Vector(b)
    axis = b - a
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, segments=seg, radius1=r1, radius2=r2, depth=axis.length)
    rot = Vector((0, 0, 1)).rotation_difference(axis.normalized()).to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=Matrix.Translation((a + b) / 2) @ rot, verts=bm.verts)
    return bm


def boot(side, s, an, x):
    """Chunky leather work boot: shaft with a rolled collar, rounded toe cap, laces, dark lugged sole."""
    mesh(f'boot_shaft_{side}', tube_open(0.06, 0.058, (x, 0.005, 0.05), (x, 0.005, 0.17), 14), 'M_shoe_upper', an)
    ring(0.064, 0.03, 0.17, (x, 0.005), (1, 1), 14, f'boot_collar_{side}', 'M_shoe_upper', an)
    foot = merge(ball(0.072, (x, -0.045, 0.058), (1.0, 1.55, 0.78), 2), ball(0.062, (x, 0.02, 0.06), (1.0, 1.0, 0.95), 2))
    mesh(f'boot_foot_{side}', foot, 'M_shoe_upper', an)
    sole = rounded_box((0.13, 0.215, 0.034), (x, -0.032, 0.017), 0.012)
    mesh(f'boot_sole_{side}', sole, 'M_sole', an)
    for k in range(3):
        zz = 0.085 + k * 0.03
        for d in (-1, 1):
            oriented_box((x - 0.022, -0.06 - 0.004 * k, zz), (x + 0.022, -0.06 - 0.004 * k, zz + d * 0.014), 0.007, 0.006, (0, -1, 0), 'M_lace', an, f'boot_lace_{side}_{k}_{d}', 0.0)


def shoe(side, s, an, x):
    """Plain rounded shoe for the villagers."""
    mesh(f'shoe_foot_{side}', merge(ball(0.058, (x, -0.035, 0.045), (1.0, 1.5, 0.75), 2), tube_open(0.05, 0.05, (x, 0.005, 0.03), (x, 0.005, 0.1), 12)), 'M_shoe_upper', an)
    mesh(f'shoe_sole_{side}', rounded_box((0.112, 0.18, 0.026), (x, -0.028, 0.013), 0.01), 'M_sole', an)


def body(actor, look):
    """Pivots and rigid parts for one actor. look: hair style and outfit options:
    sleeves none/short/long, legs shorts/long/skirt, feet boots/shoes, overall, belt, gloves, satchel."""
    root = empty('NPC_C01', actor, (0, 0, 0))
    hips = empty('hips', root, (0, 0, HIPS_Z))
    spine = empty('spine', hips, (0, 0, SPINE_Z))
    chest = empty('chest', spine, (0, 0, CHEST_Z))
    neck = empty('neck', chest, (0, 0, NECK_Z))
    head = empty('head', neck, (0, 0, NECK_Z + 0.04))
    hip_z = HIPS_Z - HIP_DROP

    # Torso: a slim child's chest under the top; the waist in the trouser colour for an overall
    mesh('top_shirt_chest', capsule(0.108, 0.122, (0, 0, CHEST_Z - 0.05), (0, 0, NECK_Z - 0.085), 14), 'M_shirt', chest)
    mesh('top_shirt_waist', capsule(0.116, 0.11, (0, 0, SPINE_Z - 0.02), (0, 0, CHEST_Z - 0.04), 14), look.get('waist', 'M_shirt'), spine)
    mesh('pants_pelvis', ball(0.128, (0, 0.0, HIPS_Z - 0.02), (1, 0.74, 0.72), 3), 'M_pants' if look.get('legs') != 'skirt' else 'M_shirt', hips)
    mesh('neck_skin', capsule(0.042, 0.042, (0, 0, NECK_Z - 0.05), (0, 0, NECK_Z + 0.03), 10), 'M_skin', neck)

    if look.get('overall'):
        # Bib with a pocket and stitching, straps with brass fasteners, crossed straps at the back
        bib = rounded_box((0.15, 0.018, 0.165), (0, -0.128, CHEST_Z + 0.0), 0.008)
        for v in bib.verts:
            v.co.y += (v.co.x / 0.08) ** 2 * 0.032  # follow the chest's curve, over the cotton
        mesh('top_bib', bib, 'M_pants', chest)
        mesh('top_bib_pocket', rounded_box((0.07, 0.01, 0.055), (0, -0.14, CHEST_Z + 0.02), 0.005), 'M_pants', chest)
        for a, b in (((-0.035, -0.146, CHEST_Z - 0.006), (0.035, -0.146, CHEST_Z - 0.006)), ((-0.035, -0.146, CHEST_Z + 0.046), (0.035, -0.146, CHEST_Z + 0.046))):
            oriented_box(a, b, 0.003, 0.002, (0, -1, 0), 'M_stitch', chest, 'top_stitch', 0.0)
        for s in (-1, 1):
            front_top = (s * 0.058, -0.13, CHEST_Z + 0.082)
            shoulder = (s * 0.075, -0.035, NECK_Z - 0.06)
            back_top = (s * 0.068, 0.09, NECK_Z - 0.075)
            cross = (-s * 0.05, 0.122, CHEST_Z - 0.03)
            oriented_box(front_top, shoulder, 0.032, 0.012, (0, -0.5, 1), 'M_pants', chest, f'top_strap_front_{s}')
            oriented_box(shoulder, back_top, 0.032, 0.012, (0, 0.3, 1), 'M_pants', chest, f'top_strap_over_{s}')
            oriented_box(back_top, cross, 0.03, 0.012, (0, 1, 0.2), 'M_pants', chest, f'top_strap_back_{s}')
            # Brass fastener where the strap meets the bib: a loop and its button
            mesh(f'top_fastener_{s}', merge(rounded_box((0.028, 0.008, 0.02), (s * 0.058, -0.143, CHEST_Z + 0.085), 0.0),
                                           ball(0.0105, (s * 0.058, -0.149, CHEST_Z + 0.07), (1, 0.6, 1), 1)), 'M_brass', chest)
        mesh('top_strap_patch', rounded_box((0.042, 0.012, 0.042), (0, 0.128, CHEST_Z - 0.03), 0.005), 'M_pants', chest)
    if look.get('belt'):
        ring(0.124, 0.03, SPINE_Z - 0.06, (0, 0.0), (1, 0.9), 18, 'belt_band', 'M_leather', spine, open_ends=True)
        mesh('belt_buckle', rounded_box((0.042, 0.012, 0.034), (0, -0.114, SPINE_Z - 0.06), 0.005), 'M_brass', spine)
        mesh('belt_buckle_hole', rounded_box((0.028, 0.013, 0.018), (0, -0.117, SPINE_Z - 0.06), 0.0), 'M_leather', spine)
    if look.get('satchel'):
        # Canvas satchel on the belt, behind the right hip
        mesh('satchel_bag', rounded_box((0.11, 0.055, 0.095), (-0.06, 0.118, HIPS_Z + 0.015), 0.018), 'M_canvas', hips)
        mesh('satchel_flap', rounded_box((0.115, 0.02, 0.05), (-0.06, 0.148, HIPS_Z + 0.045), 0.01), 'M_canvas', hips)
        mesh('satchel_buckle', rounded_box((0.02, 0.01, 0.022), (-0.06, 0.159, HIPS_Z + 0.03), 0.0), 'M_brass', hips)
    if look.get('apron'):
        mesh('top_apron', rounded_box((0.2, 0.028, 0.3), (0, -0.142, SPINE_Z + 0.02), 0.014), 'M_under', spine)
    if look.get('vest'):
        mesh('top_vest', capsule(0.128, 0.14, (0, 0.004, CHEST_Z - 0.06), (0, 0.004, NECK_Z - 0.09), 14), 'M_under', chest)
    if look.get('legs') == 'skirt':
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=0.2, radius2=0.135, depth=0.25)
        bmesh.ops.translate(bm, vec=(0, 0, HIPS_Z - 0.1), verts=bm.verts)
        mesh('pants_skirt', bm, 'M_pants', hips)

    # Head: a big soft skull and ears; the face decals ride on it
    mesh('head_skull', ball(HEAD_R, (0, 0, HEAD_C), (HEAD_SX, 1, HEAD_SZ), 3), 'M_skin', head)
    for s in (-1, 1):
        mesh(f'face_ear_{s}', ball(0.03, (s * HEAD_R * HEAD_SX * 0.97, 0.005, HEAD_C - 0.02), (0.55, 0.8, 1)), 'M_skin', head)
    face(head)
    look['hair'](head)
    if look.get('beard'):
        mesh('beard_B02', ball(0.1, (0, -0.07, HEAD_C - 0.1), (1.05, 0.7, 0.75)), 'M_beard', head)
    if look.get('glasses'):
        for s in (-1, 1):
            rimg = bmesh.new()
            outer = [rimg.verts.new((s * 0.056 + 0.036 * math.cos(a), -HEAD_R - 0.014, HEAD_C - 0.012 + 0.03 * math.sin(a))) for a in (2 * math.pi * i / 14 for i in range(14))]
            inner = [rimg.verts.new((s * 0.056 + 0.028 * math.cos(a), -HEAD_R - 0.014, HEAD_C - 0.012 + 0.022 * math.sin(a))) for a in (2 * math.pi * i / 14 for i in range(14))]
            for i in range(14):
                rimg.faces.new((outer[i], outer[(i + 1) % 14], inner[(i + 1) % 14], inner[i]))
            mesh(f'glasses_rim_{s}', rimg, 'M_glasses', head, smooth=False)

    # Arms: a slight A-pose (the turnaround's), hands down to mid-thigh
    sleeves = look.get('sleeves', 'short')
    for side, s in (('L', 1), ('R', -1)):
        sx, sz = SHOULDER
        clav = empty(f'clavicle_{side}', chest, (s * 0.04, 0, sz))
        sh = empty(f'shoulder_{side}', clav, (s * sx, 0, sz))
        elbow = (s * (sx + 0.035), 0.005, sz - UPPER_ARM)
        wrist = (s * (sx + 0.06), -0.008, sz - UPPER_ARM - FORE_ARM)
        el = empty(f'elbow_{side}', sh, elbow)
        wr = empty(f'wrist_{side}', el, wrist)
        if side == 'R':
            empty('cup', wr, (wrist[0], wrist[1] - 0.03, wrist[2] - 0.06))
        shoulder = (s * sx, 0, sz)
        if sleeves == 'none':
            # A round shoulder where the bare arm meets the vest's armhole
            mesh(f'arm_upper_{side}', merge(capsule(0.043, 0.037, shoulder, elbow, 12), ball(0.048, (s * (sx - 0.005), 0, sz - 0.01), (1, 1, 1), 2)), 'M_skin', sh)
        else:
            mesh(f'top_sleeve_{side}', capsule(0.05, 0.046, shoulder, Vector(shoulder).lerp(Vector(elbow), 0.55), 12), 'M_shirt', sh)
            mesh(f'arm_upper_{side}', capsule(0.037, 0.034, Vector(shoulder).lerp(Vector(elbow), 0.4), elbow, 10), 'M_shirt' if sleeves == 'long' else 'M_skin', sh)
        mesh(f'arm_lower_{side}', capsule(0.037, 0.033, elbow, wrist, 10), 'M_shirt' if sleeves == 'long' else 'M_skin', el)
        if look.get('gloves'):
            glove(side, s, wr, wrist)
        else:
            mesh(f'hand_{side}', ball(0.046, (wrist[0], wrist[1], wrist[2] - 0.04), (0.75, 0.9, 1.1), 2), 'M_skin', wr)
            mesh(f'hand_thumb_{side}', ball(0.018, (wrist[0] + s * 0.012, wrist[1] - 0.034, wrist[2] - 0.03), subdivisions=2), 'M_skin', wr)

    # Legs: shorts with rolled cuffs over bare shins, or trousers; boots or shoes
    legs = look.get('legs', 'long')
    for side, s in (('L', 1), ('R', -1)):
        x = s * HIP_X
        hp = empty(f'hip_{side}', hips, (x, 0, hip_z))
        kn = empty(f'knee_{side}', hp, (x, 0, hip_z - THIGH))
        an = empty(f'ankle_{side}', kn, (x, 0, hip_z - THIGH - SHIN))
        empty(f'toe_{side}', an, (x, -BALL, 0.0))
        if legs == 'shorts':
            mesh(f'pants_thigh_{side}', tube_open(0.074, 0.072, (x, 0, hip_z + 0.02), (x, 0, hip_z - THIGH + 0.03), 14), 'M_pants', hp)
            ring(0.077, 0.045, hip_z - THIGH + 0.03, (x, 0), (1, 1), 14, f'pants_cuff_{side}', 'M_cuff', hp)
            mesh(f'leg_thigh_{side}', capsule(0.05, 0.045, (x, 0, hip_z - 0.05), (x, 0, hip_z - THIGH), 10), 'M_skin', hp)
            mesh(f'leg_shin_{side}', capsule(0.043, 0.038, (x, 0, hip_z - THIGH), (x, 0, ANKLE_H + 0.06), 10), 'M_skin', kn)
        else:
            mesh(f'pants_thigh_{side}', capsule(0.066, 0.058, (x, 0, hip_z), (x, 0, hip_z - THIGH), 12), 'M_pants' if legs == 'long' else 'M_skin', hp)
            mesh(f'pants_shin_{side}', capsule(0.055, 0.05, (x, 0, hip_z - THIGH), (x, 0, ANKLE_H + 0.06), 12), look.get('shin', 'M_pants' if legs == 'long' else 'M_skin'), kn)
        (boot if look.get('feet') == 'boots' else shoe)(side, s, an, x)
    return root


# ------------------------------------------------------------------ hair styles

def spike(base, tip, r, flat=0.78, seg=6):
    """A pointed hair lock from base to tip: a flattened cone with a rounded root."""
    base, tip = Vector(base), Vector(tip)
    axis = tip - base
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=0.002, depth=axis.length)
    bmesh.ops.scale(bm, vec=(1, flat, 1), verts=bm.verts)
    bmesh.ops.translate(bm, vec=(0, 0, axis.length / 2), verts=bm.verts)
    rot = Vector((0, 0, 1)).rotation_difference(axis.normalized()).to_matrix().to_4x4()
    # Flatten across the head's surface: spin the flat side to face out from the skull centre
    outward = (base - Vector((0, 0, HEAD_C)))
    outward.z = 0
    spin = math.atan2(outward.x, -outward.y) if outward.length > 1e-4 else 0
    bmesh.ops.transform(bm, matrix=Matrix.Translation(base) @ rot @ Matrix.Rotation(spin, 4, 'Z'), verts=bm.verts)
    return bm


def on_sphere(theta, phi, r=HEAD_R * 1.04):
    """Point on the skull: theta round from the front (-Y), phi up from the equator."""
    return Vector((math.sin(theta) * math.cos(phi) * r * HEAD_SX, -math.cos(theta) * math.cos(phi) * r, HEAD_C + math.sin(phi) * r * HEAD_SZ))


def hair_spiky(head, name, crown=True):
    """Brown spiky layered hair, as in the turnaround: pointed fringe falling between the eyes,
    locks in front of the ears, layered points at the back, a cowlick standing up at the front."""
    hair_shell(head, f'hair_{name}_base', -0.06)
    locks = []
    # Fringe: points fall to just above the eyes, the middle one longest
    for k, th in enumerate((-0.62, -0.36, -0.12, 0.12, 0.38, 0.64)):
        b = on_sphere(th, 0.42)
        length = 0.085 if abs(th) < 0.2 else 0.066
        t = b + Vector((math.sin(th) * 0.015, -0.022, -length))
        locks.append(spike(b, t, 0.04))
    # Side locks in front of the ears
    for s in (-1, 1):
        for k, (th, ph, ln) in enumerate(((1.05, 0.25, 0.1), (1.32, 0.18, 0.11))):
            b = on_sphere(s * th, ph)
            locks.append(spike(b, b + Vector((s * 0.014, -0.012, -ln)), 0.04))
    # Back: three tiers of points, the lowest at the nape, flicking out a little
    for tier, (ph, ln, n) in enumerate(((0.55, 0.09, 5), (0.2, 0.1, 6), (-0.2, 0.09, 5))):
        for k in range(n):
            th = math.pi + (k - (n - 1) / 2) * (1.9 / n)
            b = on_sphere(th, ph, HEAD_R * 1.06)
            out = Vector((b.x, b.y, 0)).normalized()
            locks.append(spike(b, b + out * 0.045 + Vector((0, 0, -ln)), 0.046))
    mesh(f'hair_{name}_locks', merge(*locks), 'M_hair', head)
    if crown:
        # Top spikes, hidden under a cap (hair crown piece)
        tops = [spike(on_sphere(th, 1.05), on_sphere(th, 1.05) + Vector((math.sin(th) * 0.03, -math.cos(th) * 0.03, 0.05)), 0.04) for th in (0, 2.1, -2.1, math.pi)]
        mesh(f'hair_{name}_crown', merge(*tops), 'M_hair', head)


def cap_dome_point(x, z, lift, rx, ry, rz, cz):
    y2 = 1 - (x / rx) ** 2 - ((z - cz) / rz) ** 2
    return Vector((x, -math.sqrt(max(y2, 1e-6)) * ry - lift, z))


def cap(head):
    """Six-panel cap: blue crown with a top button, a curved yellow peak, a red leaf on the front,
    the yellow strap at the back; the cowlick pokes up through the front."""
    # Sits high, above the brows: from the game's 40-degree camera the eyes must clear the peak
    rx, ry, rz, cz = HEAD_R * 1.12 * HEAD_SX, HEAD_R * 1.14, HEAD_R * 0.95, HEAD_C + 0.08
    bm = ball(1, (0, 0, 0), (rx, ry, rz), 3)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < 0.0], context='VERTS')
    bmesh.ops.translate(bm, vec=(0, 0.004, cz), verts=bm.verts)
    mesh('hat_cap', merge(bm, ball(0.017, (0, 0.004, cz + rz + 0.004), (1, 1, 0.6), 1)), 'M_cap', head)
    # Peak: a curved half-ellipse slab, sides dipping, tilted down a little
    peak = bmesh.new()
    rows, cols, w, d = 5, 14, 0.13, 0.085
    grid = []
    for j in range(rows + 1):
        rowv = []
        for i in range(cols + 1):
            u = i / cols * 2 - 1
            v = j / rows
            x = u * w * math.sqrt(max(0.0, 1 - (v * 0.92) ** 2)) * (1 - 0.15 * v)
            y = -ry * 0.9 - v * d
            z = cz - 0.006 - (x / w) ** 2 * 0.034 - v * 0.016 - v * v * 0.008  # sides curl down, a short peak dips
            rowv.append(peak.verts.new((x, y, z)))
        grid.append(rowv)
    for j in range(rows):
        for i in range(cols):
            peak.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
    geom = bmesh.ops.extrude_face_region(peak, geom=peak.faces[:])
    bmesh.ops.translate(peak, vec=(0, 0, -0.016), verts=[e for e in geom['geom'] if isinstance(e, bmesh.types.BMVert)])
    bmesh.ops.recalc_face_normals(peak, faces=peak.faces)
    mesh('hat_peak', peak, 'M_brim', head)
    # Red leaf emblem on the front panel, wrapped onto the dome
    leaf = [(0.03 * math.sin(math.pi * t) * (1 if k == 0 else -1), cz + 0.045 + 0.075 * (t - 0.5)) for k in (0, 1) for t in ((i / 8) if k == 0 else (1 - i / 8) for i in range(9))]
    bmL = bmesh.new()
    centre = bmL.verts.new(cap_dome_point(0, cz + 0.045, 0.004, rx, ry, rz, cz))
    ringv = [bmL.verts.new(cap_dome_point(x, z, 0.004, rx, ry, rz, cz)) for x, z in leaf]
    for i in range(len(ringv)):
        bmL.faces.new((centre, ringv[i], ringv[(i + 1) % len(ringv)]))
    bmL.normal_update()
    for f in bmL.faces:
        if f.normal.y > 0:
            f.normal_flip()
    mesh('hat_emblem', bmL, 'M_emblem', head)
    # Back strap
    mesh('hat_strap', rounded_box((0.06, 0.012, 0.016), (0, ry * 0.98, cz + 0.012), 0.005), 'M_brim', head)
    # Cowlick: a lock curling up out of the front of the cap, above the peak
    # A small curl, not a horn: out from under the crown's front edge, up and back over itself
    a = Vector((0.006, -ry * 0.93, cz + 0.012))
    b = a + Vector((0.004, -0.012, 0.035))
    c = b + Vector((-0.004, 0.012, 0.022))
    mesh('hat_cowlick', merge(spike(a, b, 0.011, 0.6, 5), spike(b, c, 0.008, 0.6, 5)), 'M_hair', head)


def hair_shell(head, name, z_from, scale=(1.08, 1.08, 1.06), offset=(0, 0.012, 0.012), material='M_hair'):
    """A cap of hair: the top of a slightly larger skull, cut at z_from (relative to the centre)."""
    bm = ball(HEAD_R, (0, 0, 0), (scale[0] * HEAD_SX, scale[1], scale[2] * HEAD_SZ), 3)
    cut = [v for v in bm.verts if v.co.z < z_from or (v.co.y < -HEAD_R * 0.55 and v.co.z < 0.07)]
    bmesh.ops.delete(bm, geom=cut, context='VERTS')
    bmesh.ops.translate(bm, vec=Vector(offset) + Vector((0, 0, HEAD_C)), verts=bm.verts)
    return mesh(name, bm, material, head)


def hair_player(head):
    hair_spiky(head, 'player')
    cap(head)


def hair_bun(head):
    hair_shell(head, 'hair_bun_base', -0.09)
    locks = [spike(on_sphere(th, 0.5), on_sphere(th, 0.5) + Vector((math.sin(th) * 0.01, -0.015, -0.07)), 0.036) for th in (-0.5, -0.2, 0.15, 0.45)]
    for s in (-1, 1):
        locks.append(spike(on_sphere(s * 1.2, 0.15), on_sphere(s * 1.2, 0.15) + Vector((s * 0.01, -0.01, -0.13)), 0.035))
    mesh('hair_bun_fringe', merge(*locks), 'M_hair', head)
    mesh('hair_bun_side', merge(*[ball(0.06, (s * 0.12, 0.035, HEAD_C - 0.05), (0.6, 0.9, 1.3), 2) for s in (-1, 1)]), 'M_hair', head)
    mesh('hair_bun_crown', merge(ball(0.072, (0, 0.085, HEAD_C + 0.12), subdivisions=2), ball(0.03, (0, 0.07, HEAD_C + 0.185), subdivisions=1)), 'M_hair', head)


def hair_pigtails(head):
    hair_shell(head, 'hair_pig_base', -0.05)
    locks = [spike(on_sphere(th, 0.55), on_sphere(th, 0.55) + Vector((math.sin(th) * 0.012, -0.02, -0.065)), 0.034) for th in (-0.55, -0.25, 0.05, 0.35, 0.6)]
    mesh('hair_pig_fringe', merge(*locks), 'M_hair', head)
    tails = []
    for s in (-1, 1):
        tails.append(ball(0.06, (s * 0.17, 0.03, HEAD_C + 0.02), (0.8, 0.8, 1.2), 2))
        tails.append(spike((s * 0.19, 0.035, HEAD_C - 0.01), (s * 0.22, 0.05, HEAD_C - 0.13), 0.05, 0.85))
        tails.append(ball(0.02, (s * 0.165, 0.03, HEAD_C + 0.07), subdivisions=1))
    mesh('hair_pig_tails', merge(*tails), 'M_hair', head)
    mesh('hair_pig_crown', ball(0.05, (0, 0, HEAD_C + HEAD_R + 0.01), (1.2, 1.2, 0.5), 1), 'M_hair', head)


def hair_elder(head):
    bm = ball(HEAD_R, (0, 0, 0), (1.07, 1.07, 1.05), 3)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z > 0.06 or v.co.z < -0.07 or v.co.y < -HEAD_R * 0.35], context='VERTS')
    bmesh.ops.translate(bm, vec=(0, 0.01, HEAD_C), verts=bm.verts)
    mesh('hair_elder_ring', bm, 'M_hair', head)
    mesh('hair_elder_crown', merge(*[ball(0.025, (x, 0.02, HEAD_C + HEAD_R + 0.005), (1, 1.6, 0.5), 1) for x in (-0.03, 0.02)]), 'M_hair', head)


ACTORS = {
    # The turnaround farmer: sleeveless cotton top, denim overall shorts with rolled cuffs, belt,
    # canvas satchel, work gloves with red cuffs, leather boots, the six-panel cap
    'player': {'hair': hair_player, 'overall': True, 'waist': 'M_pants', 'sleeves': 'none', 'legs': 'shorts',
               'feet': 'boots', 'belt': True, 'gloves': True, 'satchel': True},
    'seller': {'hair': hair_bun, 'apron': True, 'legs': 'skirt', 'sleeves': 'short', 'waist': 'M_shirt', 'feet': 'shoes'},
    'child': {'hair': hair_pigtails, 'overall': True, 'waist': 'M_pants', 'sleeves': 'short', 'legs': 'shorts', 'feet': 'shoes'},
    'elder': {'hair': hair_elder, 'beard': True, 'glasses': True, 'vest': True, 'waist': 'M_under', 'sleeves': 'long', 'legs': 'long', 'feet': 'shoes', 'belt': True},
}

roots = {}
for i, (name, look) in enumerate(ACTORS.items()):
    actor = bpy.data.objects.new(f'actor_{name}', None)
    actor['world'] = [0, 0, 0]
    link(actor, None)
    body(actor, dict(look))
    roots[name] = actor

# Bake ambient occlusion into the painted shading: under the chin and hair, armpits, between
# the legs, inside sleeves. Actors are spread apart for the bake so they do not shade each other.
for i, actor in enumerate(roots.values()):
    actor.location = (i * 4.0, 0, 0)
bpy.ops.mesh.primitive_plane_add(size=40, location=(6, 0, 0))
ground_plane = bpy.context.active_object
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 96
scene.cycles.seed = 3
scene.world = bpy.data.worlds.new('bake')
scene.world.light_settings.distance = 0.22
TINT = (0.66, 0.58, 0.72)  # occluded skin and cloth go warm-violet, never grey
bpy.context.view_layer.update()
for actor in roots.values():
    for obj in actor.children_recursive:
        if obj.type != 'MESH' or obj.name.startswith(('expr_', 'face_', 'glasses_')):
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
bpy.data.objects.remove(ground_plane)
for actor in roots.values():
    actor.location = (0, 0, 0)

bpy.ops.object.select_all(action='SELECT')
OUT.parent.mkdir(parents=True, exist_ok=True)
options = dict(filepath=str(OUT), export_format='GLB', use_selection=True, export_texcoords=False,
               export_normals=True, export_animations=False, export_extras=False, export_apply=True)
try:
    bpy.ops.export_scene.gltf(**options, export_vertex_color='ACTIVE')
except TypeError:
    bpy.ops.export_scene.gltf(**options, export_colors=True)


def tris(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons) if obj.type == 'MESH' else 0


report = {}
for name, actor in roots.items():
    every = [actor] + list(actor.children_recursive)
    expr = sum(tris(o) for o in every if o.name.startswith('expr_'))
    report[name] = {'triangles': sum(tris(o) for o in every), 'expressionTriangles': expr,
                    'meshes': sum(1 for o in every if o.type == 'MESH')}
REPORT.parent.mkdir(parents=True, exist_ok=True)
REPORT.write_text(json.dumps({'height': 1.35, 'heads': 1.35 / (2 * HEAD_R), 'legs': {'thigh': THIGH, 'shin': SHIN, 'ankle': ANKLE_H},
                              'actors': report, 'bytes': OUT.stat().st_size}, indent=2) + '\n')
print('valley actors', json.dumps(report))
