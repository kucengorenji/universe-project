"""Rebuild only vehicle-kit roots; preserve town payloads and skirmish character assets.

Blender --background --python tools/blender/build_cozy_actors.py
"""
import json
import os
import sys
import tempfile
from pathlib import Path
import bpy

ROOT = Path(os.environ.get('GLOBE_ROOT', Path(__file__).resolve().parents[2]))
os.environ.setdefault('GLOBE_ROOT', str(ROOT))
HERE = ROOT / 'tools/blender'
sys.path.insert(0, str(HERE))
from town.cozy_vehicles import vehicle_builders
from town.merge_refresh import merge_refresh, read_glb
from town.validate_refresh import root_payload

REPORT = ROOT / 'docs/qa/cozy-actors'
REPORT.mkdir(parents=True, exist_ok=True)
TARGET = ROOT / 'public/models'
scratch = Path(tempfile.mkdtemp(prefix='globe-cozy-actors-'))
baseline = scratch / 'town-before.glb'
baseline.write_bytes((TARGET / 'town.glb').read_bytes())
ns = {'__name__': 'town_build', '__file__': str(HERE / 'build_town_space.py')}
definitions = (HERE / 'build_town_space.py').read_text()
exec(compile(definitions, ns['__file__'], 'exec'), ns)

# Only these authored replacement materials change; the merge reuses all other buffers.
colours = {'paint': 0xffffff, 'glass_dark': 0x7da9b5, 'chrome': 0xd8d6bd, 'rubber': 0x555359,
           'canvas': 0xffe9c4, 'white': 0xfff5df, 'wood': 0xaf7951, 'wood_light': 0xd7a472,
           'wood_dark': 0x795b46, 'mane': 0x725544, 'harness': 0xb68255, 'steel_dark': 0x6f8b8e,
           'canvas_green': 0x91bfa4, 'tail': 0xe98d78, 'lamp': 0xffefb0}
for key, value in colours.items():
    material = ns['MATERIALS'][ns['MAT_INDEX'][key]]
    material.diffuse_color = (*ns['srgb'](value), 1)
    material.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = material.diffuse_color
# Limb material names carry rigid skin regions through the existing merged-geometry loader.
for part in range(1, 9):
    for suffix, base in (('', 'paint'), ('_hoof', 'wood_dark')):
        material = ns['MATERIALS'][ns['MAT_INDEX'][base]].copy()
        material.name = f'M_horse_{part}{suffix}'
        ns['MAT_INDEX'][f'horse_{part}{suffix}'] = len(ns['MATERIALS'])
        ns['MATERIALS'].append(material)
builders = vehicle_builders(ns)
legacy = json.loads((HERE / 'town/legacy_layout_bounds.json').read_text())['variants']
counts = {}
for level in range(3):
    ns['Q'] = level
    for name, builder in builders.items():
        obj = ns['asset'](name, 'Vehicles', builder)
        root = ns['EMPTIES'][name]
        root.location = (0, 0, 0)
        obj.location = (0, 0, 0)
        root['cozyVehicleRevision'] = 2
        if name == 'vh_horse':
            root['articulatedLegs'] = 1
        root['smoothCrease'] = 1.05
        root['layoutFootprint'] = legacy[name]
        counts.setdefault(name, []).append(ns['tris'](obj))
bpy.ops.object.select_all(action='DESELECT')
for name in builders:
    ns['EMPTIES'][name].select_set(True)
    for level in range(3):
        ns['LODS'][level][name].select_set(True)
bpy.ops.export_scene.gltf(filepath=str(scratch / 'vehicles.glb'), export_format='GLB', use_selection=True,
                          export_texcoords=False, export_normals=True, export_animations=False, export_extras=True)
summary = merge_refresh(baseline, scratch / 'vehicles.glb', scratch / 'town.glb', builders)
old, ob = read_glb(baseline)
new, nb = read_glb(scratch / 'town.glb')
roots = lambda doc: {doc['nodes'][i]['name']: i for i in doc['scenes'][doc.get('scene', 0)]['nodes']}
a, b = roots(old), roots(new)
assert a.keys() == b.keys()
for name in a.keys() - builders.keys():
    assert root_payload(old, ob, a[name]) == root_payload(new, nb, b[name]), name
summary['untouchedPayloadsVerified'] = len(a.keys() - builders.keys())

# A scoped editable source, with vehicle LODs in rows.
for index, name in enumerate(builders):
    ns['EMPTIES'][name].location = (10 + index % 5 * 6, index // 5 * 14, 0)
    for level in range(3):
        ns['LODS'][level][name].location = (0, level * 4, 0)
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(HERE / 'cozy_actors.blend'))

# All source/export steps must succeed before replacing any runtime file.
for name in ('town',):
    with tempfile.NamedTemporaryFile(dir=TARGET, suffix='.glb', delete=False) as f:
        f.write((scratch / (name + '.glb')).read_bytes())
        staged = f.name
    os.chmod(staged, 0o644)
    os.replace(staged, TARGET / (name + '.glb'))
report = {'revision': 2, 'blender': bpy.app.version_string, 'baselineDirectory': str(scratch),
          'units': 'metres', 'up': '+Y', 'front': '+Z', 'pivot': 'ground centre; wheels centred on X axle',
          'vehicleTriangles': counts, 'merge': summary,
          'files': {name: (TARGET / (name + '.glb')).stat().st_size for name in ('town',)}}
(REPORT / 'manifest.json').write_text(json.dumps(report, indent=2) + '\n')
print('COZY_ACTORS_COMPLETE', json.dumps(report))
