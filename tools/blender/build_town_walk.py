"""Retarget UAL Walk_Loop onto the unchanged Skirmish v5 rigs.

Blender -b --python tools/blender/build_town_walk.py -- --source <v5 blend directory>
    --ual <AnimationLibrary_Godot_Standard.glb>
Exports animation-only packs, leaving the proven skirmish models untouched.
"""
import json
import sys
from pathlib import Path
import bpy

ROOT = Path(__file__).resolve().parents[2]
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
source = Path(args[args.index('--source') + 1]) if '--source' in args else ROOT / 'tools/blender'
ual = args[args.index('--ual') + 1] if '--ual' in args else None
script = ROOT / 'tools/blender/skirmish/soldier_v5.py'
# Reuse the exact v5 retargeter without running its mesh/atlas generator.
ns = {'__file__': str(script), '__name__': 'town_walk'}
exec(compile(script.read_text().rsplit('\nmain()', 1)[0], str(script), 'exec'), ns)
ns['UAL'] = ual
report = {'source': 'Quaternius Universal Animation Library, Walk_Loop (CC0)', 'bodies': {}}
for sex in ('m', 'f'):
    name = f'soldier_v5_{sex}' if ual else f'town_walk_{sex}'
    bpy.ops.wm.open_mainfile(filepath=str(source / f'{name}.blend'))
    rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE' and 'hips' in o.data.bones)
    rig.animation_data_clear()
    if ual:
        for action in list(bpy.data.actions):
            bpy.data.actions.remove(action)
        src = ns['import_ual']()
        action = ns['retarget'](src, rig, ns['reference_pose'](src, rig), 'Walk_Loop', 'town_walk', True)
        bpy.data.objects.remove(src, do_unlink=True)
    else:
        action = bpy.data.actions['town_walk']
    rig.animation_data_create()
    rig.animation_data.action = None
    track = rig.animation_data.nla_tracks.new()
    track.name = 'town_walk'
    track.strips.new('town_walk', 0, action)
    for pb in rig.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
    bpy.context.scene.frame_set(0)
    bpy.ops.object.select_all(action='DESELECT')
    rig.select_set(True)
    target = ROOT / f'public/models/town_walk_{sex}.glb'
    bpy.ops.export_scene.gltf(filepath=str(target), export_format='GLB', use_selection=True,
        export_yup=True, export_animations=True, export_animation_mode='NLA_TRACKS',
        export_force_sampling=True, export_optimize_animation_size=True,
        export_skins=False, export_extras=True, export_cameras=False, export_lights=False)
    report['bodies'][sex] = {'speed': action['speed'], 'bytes': target.stat().st_size}
    # Keep a small editable rig/action; the runtime already supplies the original body.
    for obj in list(bpy.data.objects):
        if obj != rig:
            bpy.data.objects.remove(obj, do_unlink=True)
    for other in list(bpy.data.actions):
        if other != action:
            bpy.data.actions.remove(other)
    bpy.data.orphans_purge(do_recursive=True)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / f'tools/blender/town_walk_{sex}.blend'))
(ROOT / 'src/modes/town/people/townWalk.json').write_text(json.dumps(report, indent=2) + '\n')
print('TOWN_WALK_COMPLETE', report)
