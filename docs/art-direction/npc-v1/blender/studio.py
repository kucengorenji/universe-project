"""Soft studio lighting + turnaround cameras for the Overcooked-style NPC preview."""
import math
import bpy
from mathutils import Vector

scene = bpy.context.scene
try:
    scene.render.engine = "BLENDER_EEVEE"
except TypeError:
    scene.render.engine = "BLENDER_EEVEE_NEXT"
scene.view_settings.view_transform = "Standard"
scene.view_settings.look = "None"
scene.render.film_transparent = False

STUDIO = "STUDIO"
col = bpy.data.collections.get(STUDIO) or bpy.data.collections.new(STUDIO)
if STUDIO not in [c.name for c in scene.collection.children]:
    scene.collection.children.link(col)
for o in list(col.objects):
    bpy.data.objects.remove(o, do_unlink=True)


def link(o):
    col.objects.link(o)
    return o


# floor
bpy.ops.mesh.primitive_plane_add(size=30, location=(0, 0, 0))
floor = bpy.context.active_object
floor.name = "Studio_floor"
for c in floor.users_collection:
    c.objects.unlink(floor)
link(floor)
m = bpy.data.materials.get("M_floor") or bpy.data.materials.new("M_floor")
m.use_nodes = True
b = m.node_tree.nodes["Principled BSDF"]
b.inputs["Base Color"].default_value = (0.62, 0.55, 0.44, 1)
b.inputs["Roughness"].default_value = 0.9
floor.data.materials.clear()
floor.data.materials.append(m)

# world
w = scene.world or bpy.data.worlds.new("World")
scene.world = w
w.use_nodes = True
bg = w.node_tree.nodes["Background"]
bg.inputs["Color"].default_value = (0.93, 0.90, 0.84, 1)
bg.inputs["Strength"].default_value = 0.55

# lights
sun = bpy.data.lights.new("Key_sun", "SUN")
sun.energy = 2.0
sun.angle = math.radians(18)
sun.color = (1.0, 0.95, 0.88)
so = link(bpy.data.objects.new("Key_sun", sun))
so.rotation_euler = (math.radians(50), 0, math.radians(-35))

fill = bpy.data.lights.new("Fill_area", "AREA")
fill.energy = 180
fill.size = 4
fill.color = (0.85, 0.92, 1.0)
fo = link(bpy.data.objects.new("Fill_area", fill))
fo.location = (3.5, -3.5, 2.5)
fo.rotation_euler = (math.radians(65), 0, math.radians(45))

rim = bpy.data.lights.new("Rim_area", "AREA")
rim.energy = 140
rim.size = 3
ro = link(bpy.data.objects.new("Rim_area", rim))
ro.location = (-2.5, 3.5, 2.8)
ro.rotation_euler = (math.radians(-125), 0, math.radians(-30))

# cameras
target = link(bpy.data.objects.new("Cam_target", None))
target.location = (0, 0, 0.88)


def cam(name, loc, lens=70):
    cd = bpy.data.cameras.new(name)
    cd.lens = lens
    co = link(bpy.data.objects.new(name, cd))
    co.location = loc
    tc = co.constraints.new("TRACK_TO")
    tc.target = target
    tc.track_axis = "TRACK_NEGATIVE_Z"
    tc.up_axis = "UP_Y"
    return co


cam("Cam_C01_three", (2.6, -4.6, 1.5))
cam("Cam_C01_front", (0, -6.5, 0.9))
cam("Cam_C01_side", (6.5, 0, 0.9))
cam("Cam_C01_back", (0, 6.5, 0.9))
cam("Cam_C01_head", (0.9, -2.6, 1.42), lens=85)
scene.camera = bpy.data.objects["Cam_C01_three"]
scene.render.resolution_x = 900
scene.render.resolution_y = 1200
