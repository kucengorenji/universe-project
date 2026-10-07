"""Render gallery and thumbnails from the final exported GLB, not the source scene."""
import bpy
import json
import sys
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[3]
WORK = ROOT / 'tools/blender/home'
QA = WORK / 'qa'
CATALOG = json.loads((WORK / 'catalog.json').read_text())
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(ROOT / 'public/models/home_cozy.glb'))
roots = {name: bpy.data.objects.get(name) for name in CATALOG['assets']}
for root in roots.values():
    for obj in root.children_recursive: obj.hide_render = not obj.name.endswith('LOD0')
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 12
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.66, .70, .63, 1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value = .70
scene.view_settings.view_transform = 'AgX'
bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -.012))
floor = bpy.context.object
floor.name = 'QA_floor'
mat = bpy.data.materials.new('QA_background')
mat.diffuse_color = (.67, .69, .59, 1)
floor.data.materials.append(mat)
for loc, energy, size in [((2, -6, 12), 1600, 9), ((-6, -2, 7), 1000, 8)]:
    bpy.ops.object.light_add(type='AREA', location=loc)
    light = bpy.context.object
    light.data.energy, light.data.size = energy, size
    light.rotation_euler = (Vector((0, 0, 0)) - light.location).to_track_quat('-Z', 'Y').to_euler()
bpy.ops.object.camera_add(location=(12, -17, 17))
camera = bpy.context.object
camera.rotation_euler = (Vector((0, 0, .3)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
camera.data.type = 'ORTHO'
camera.data.ortho_scale = 22.0
scene.camera = camera
scene.render.resolution_percentage = 100

for i, root in enumerate(roots.values()): root.location = ((i % 5 - 2) * 2.8, (i // 5 - 1.5) * 3.05, 0)
scene.render.resolution_x, scene.render.resolution_y = 1600, 1200
scene.render.filepath = str(QA / 'home_runtime_gallery.png')
bpy.ops.render.render(write_still=True)

if '--thumbs' in sys.argv:
    thumbs = QA / 'thumbnails'
    thumbs.mkdir(exist_ok=True)
    for root in roots.values():
        root.location = (0, 0, 0)
        for obj in root.children_recursive: obj.hide_render = True
    scene.render.resolution_x = scene.render.resolution_y = 320
    scene.cycles.samples = 8
    for name, root in roots.items():
        record = CATALOG['assets'][name]['dimensions']
        for obj in root.children_recursive: obj.hide_render = not obj.name.endswith('LOD0')
        span = max(record.values())
        target = Vector((0, 0, record['height'] * .45))
        camera.location = (span * 1.3, -span * 1.7, span * 1.3)
        camera.rotation_euler = (target - camera.location).to_track_quat('-Z', 'Y').to_euler()
        camera.data.ortho_scale = span * 1.75
        scene.render.filepath = str(thumbs / (name + '.png'))
        bpy.ops.render.render(write_still=True)
        for obj in root.children_recursive: obj.hide_render = True
print('HOME_RUNTIME_RENDERS_COMPLETE', flush=True)
