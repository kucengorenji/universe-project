"""Scenes, lights, cameras and still renders for previews (EEVEE by default)."""
import math

import bpy
from mathutils import Vector

from . import kit


def new_scene(name):
    sc = bpy.data.scenes.get(name) or bpy.data.scenes.new(name)
    sc.unit_settings.system = 'METRIC'
    return sc


def setup(sc, res=(1600, 1000), samples=48, view='Standard', exposure=0.0, engine='BLENDER_EEVEE',
          world_hex=0xF1EBDD, world_strength=1.0, transparent=False):
    r = sc.render
    r.engine = engine
    r.resolution_x, r.resolution_y = res
    r.resolution_percentage = 100
    r.film_transparent = transparent
    r.image_settings.file_format = 'PNG'
    r.image_settings.color_mode = 'RGBA' if transparent else 'RGB'
    sc.view_settings.view_transform = view
    sc.view_settings.look = 'None'
    sc.view_settings.exposure = exposure
    sc.display_settings.display_device = 'sRGB'
    if engine == 'BLENDER_EEVEE':
        ev = sc.eevee
        ev.taa_render_samples = samples
        ev.use_shadows = True
        ev.use_raytracing = True
        ev.use_fast_gi = True
    elif engine == 'CYCLES':
        sc.cycles.samples = samples
        sc.cycles.use_denoising = True
    world = bpy.data.worlds.get(f'W_{sc.name}') or bpy.data.worlds.new(f'W_{sc.name}')
    world.use_nodes = True
    bg = world.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value = (*kit.lin(world_hex), 1)
    bg.inputs['Strength'].default_value = world_strength
    sc.world = world
    return sc


def add_sun(sc, coll, name, direction, energy=3.0, hex_=0xFFF2DC, angle_deg=6.0):
    """Sun whose light travels along `direction` (a Vector)."""
    d = bpy.data.lights.get(name) or bpy.data.lights.new(name, 'SUN')
    d.energy, d.color, d.angle = energy, kit.lin(hex_), math.radians(angle_deg)
    o = bpy.data.objects.get(name) or bpy.data.objects.new(name, d)
    if o.name not in coll.objects:
        coll.objects.link(o)
    o.rotation_euler = Vector(direction).normalized().to_track_quat('-Z', 'Y').to_euler()
    return o


def add_area(sc, coll, name, loc, target, energy=200.0, size=3.0, hex_=0xFFFFFF, shape='SQUARE'):
    d = bpy.data.lights.get(name) or bpy.data.lights.new(name, 'AREA')
    d.energy, d.color, d.size, d.shape = energy, kit.lin(hex_), size, shape
    o = bpy.data.objects.get(name) or bpy.data.objects.new(name, d)
    if o.name not in coll.objects:
        coll.objects.link(o)
    o.location = loc
    o.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    return o


def add_camera(sc, coll, name, loc, target, lens=50.0, ortho_scale=None, clip=(0.05, 200.0)):
    d = bpy.data.cameras.get(name) or bpy.data.cameras.new(name)
    d.lens = lens
    d.clip_start, d.clip_end = clip
    d.type = 'ORTHO' if ortho_scale else 'PERSP'
    if ortho_scale:
        d.ortho_scale = ortho_scale
    o = bpy.data.objects.get(name) or bpy.data.objects.new(name, d)
    if o.name not in coll.objects:
        coll.objects.link(o)
    o.location = loc
    o.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    return o


def floor(sc, coll, name='Floor', size=60.0, hex_=0xF1EBDD, z=0.0, rough=0.9):
    """Big matte ground plane in a flat colour."""
    me = bpy.data.meshes.get(name) or bpy.data.meshes.new(name)
    me.clear_geometry()
    h = size / 2
    me.from_pydata([(-h, -h, z), (h, -h, z), (h, h, z), (-h, h, z)], [], [(0, 1, 2, 3)])
    me.update()
    o = bpy.data.objects.get(name) or bpy.data.objects.new(name, me)
    if o.name not in coll.objects:
        coll.objects.link(o)
    m = bpy.data.materials.get(f'M_{name}') or bpy.data.materials.new(f'M_{name}')
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*kit.lin(hex_), 1)
    b.inputs['Roughness'].default_value = rough
    if not me.materials:
        me.materials.append(m)
    return o


def cyc(sc, coll, name='Cyc', hex_=0xF3EEE2, width=60.0, front=30.0, wall=7.0, radius=4.0, height=14.0, rough=0.92):
    """Seamless backdrop: a floor that curves up into a wall `wall` metres behind the origin (+Y)."""
    prof = [(-front, 0.0), (wall - radius, 0.0)]
    steps = 14
    for i in range(1, steps + 1):
        a = (math.pi / 2) * i / steps
        prof.append((wall - radius + radius * math.sin(a), radius - radius * math.cos(a)))
    prof.append((wall, height))
    me = bpy.data.meshes.get(name) or bpy.data.meshes.new(name)
    me.clear_geometry()
    hw = width / 2
    verts, faces = [], []
    for y, z in prof:
        verts += [(-hw, y, z), (hw, y, z)]
    for i in range(len(prof) - 1):
        a = 2 * i
        faces.append((a, a + 1, a + 3, a + 2))
    me.from_pydata(verts, [], faces)
    for p in me.polygons:
        p.use_smooth = True
    me.update()
    o = bpy.data.objects.get(name) or bpy.data.objects.new(name, me)
    if o.name not in coll.objects:
        coll.objects.link(o)
    m = bpy.data.materials.get(f'M_{name}') or bpy.data.materials.new(f'M_{name}')
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*kit.lin(hex_), 1)
    b.inputs['Roughness'].default_value = rough
    if not me.materials:
        me.materials.append(m)
    return o


def render(sc, cam, path, res=None, samples=None):
    sc.camera = cam
    sc.render.filepath = path
    if res:
        sc.render.resolution_x, sc.render.resolution_y = res
    if samples:
        if sc.render.engine == 'BLENDER_EEVEE':
            sc.eevee.taa_render_samples = samples
        else:
            sc.cycles.samples = samples
    bpy.ops.render.render(write_still=True, scene=sc.name)
    return path


def show(sc):
    """Make `sc` the active scene of the window and use material-preview shading in 3D views."""
    win = bpy.context.window
    if win is not None:
        win.scene = sc
        for area in win.screen.areas:
            if area.type == 'VIEW_3D':
                for space in area.spaces:
                    if space.type == 'VIEW_3D':
                        space.shading.type = 'MATERIAL'
