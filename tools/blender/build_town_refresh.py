"""Rebuild town architecture only, preserving untouched pack buffers.

Run: Blender --background --python tools/blender/build_town_refresh.py
No space, character, furniture or atlas outputs are touched. The editable blend
contains the complete merged town collection; source formulas live in town/.
"""
import json
import os
import sys
import tempfile
from pathlib import Path
import bpy

ROOT = Path(os.environ.get('GLOBE_ROOT', '/Users/mikelrisyad/Developer/globe'))
HERE = ROOT / 'tools/blender'
sys.path.insert(0, str(HERE))
from town.buildings import building_builders, BUILDING_VARIANTS
from town.merge_refresh import merge_refresh
from town.validate_refresh import validate
from town.support_props import support_builders

TARGET = ROOT / 'public/models/town.glb'
BASELINE = Path(os.environ.get('TOWN_REFRESH_BASELINE', '/private/tmp/town-before-refresh.glb'))
STAGING = Path('/private/tmp/town-refresh-authored.glb')
MERGED = Path('/private/tmp/town-refresh-merged.glb')
BLEND = HERE / 'town_refresh_assets.blend'
CONTRACT = json.loads((HERE / 'town/legacy_layout_bounds.json').read_text())
if not BASELINE.exists():
    BASELINE.write_bytes(TARGET.read_bytes())

# Production definitions include scene reset, intentionally isolated here.
ns = {'__name__': 'town_build', '__file__': str(HERE / 'build_town_space.py')}
exec(compile((HERE / 'build_town_space.py').read_text(), ns['__file__'], 'exec'), ns)
ns['refresh_bounds'] = {
    name: {'minX': b['minX'], 'maxX': b['maxX'], 'minY': -b['maxZ'], 'maxY': -b['minZ'],
           'minZ': 0., 'maxZ': b['maxY']}
    for name, b in CONTRACT['variants'].items()
}
builders = building_builders(ns)
building_names = set(builders)
builders.update(support_builders(ns))

# Author at exactly the original origin. Clamp lateral details to the original
# envelope, then match the legacy top height; do not shift the entrance axes.
height_scales = {}
def fit_building(name):
    parts = ns['PARTS']
    b = ns['refresh_bounds'][name]
    top = max(v[2] for vs, fs, mi in parts for v in vs)
    # LOD0 defines one height transform for all levels. Removing a solar panel,
    # chimney or moulding must not expand the remaining shell at another LOD.
    zscale = height_scales.setdefault(name, b['maxZ'] / top)
    for i, (vs, fs, mi) in enumerate(parts):
        parts[i] = ([(max(b['minX'], min(b['maxX'], x)),
                       max(b['minY'], min(b['maxY'], y)), max(0., min(b['maxZ'], z * zscale)))
                      for x, y, z in vs], fs, mi)

for level in range(3):
    ns['Q'] = level
    for name, build in builders.items():
        def wrapped(name=name, build=build):
            build()
            if name in building_names:
                fit_building(name)
        cat = 'Fantasy' if name.startswith('f_') else 'Modern' if name.startswith('m_') else 'Support'
        obj = ns['asset'](name, cat, wrapped)
        root = ns['EMPTIES'][name]
        root['townAssetRevision'] = 1
        obj['townAssetRevision'] = 1
        if name in CONTRACT['variants']:
            root['layoutFootprint'] = CONTRACT['variants'][name]
        # Keep all holder roots at zero for export (runtime uses baked local geometry).
        root.location = (0, 0, 0)
        obj.location = (0, 0, 0)

bpy.ops.object.select_all(action='DESELECT')
for name in builders:
    ns['EMPTIES'][name].select_set(True)
    for level in range(3):
        ns['LODS'][level][name].select_set(True)
bpy.ops.export_scene.gltf(filepath=str(STAGING), export_format='GLB', use_selection=True,
    export_apply=True, export_texcoords=False, export_normals=False,
    export_animations=False, export_extras=True)
summary = merge_refresh(BASELINE, STAGING, MERGED, builders.keys())
preservation = validate(BASELINE, MERGED)

# An editable catalogue: untouched original roots are imported alongside the
# authored replacements, arranged in rows with every LOD visible for inspection.
bpy.ops.object.select_all(action='DESELECT')
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=str(BASELINE))
imported = set(bpy.data.objects) - before
for root in [o for o in imported if o.parent not in imported]:
    if root.name.split('.')[0] in builders:
        for obj in reversed(root.children_recursive):
            bpy.data.objects.remove(obj, do_unlink=True)
        bpy.data.objects.remove(root, do_unlink=True)
# Importer adds .001 to duplicate authored names; non-rebuilt names remain exact.
for index, root in enumerate(sorted((o for o in bpy.data.objects if o.parent is None), key=lambda o: o.name)):
    root.location = (index % 10 * 65., -(index // 10) * 70., 0)
    for child in root.children:
        if '_LOD' in child.name:
            level = int(child.name.split('_LOD')[-1].split('.')[0])
            child.location = (0, level * 22., 0)
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))
# Atomic replacement after both staging export and source save succeeded.
with tempfile.NamedTemporaryFile(dir=TARGET.parent, suffix='.glb', delete=False) as output:
    output.write(MERGED.read_bytes())
    staged_output = Path(output.name)
os.replace(staged_output, TARGET)
report = {'revision': 1, 'buildingFamilies': len(BUILDING_VARIANTS), 'buildingVariants': len(building_names),
          **summary, **preservation, 'bytes': TARGET.stat().st_size,
          'triangles': {name: [ns['tris'](ns['LODS'][q][name]) for q in range(3)] for name in builders}}
(HERE / 'town/refresh_manifest.json').write_text(json.dumps(report, indent=2) + '\n')
print('TOWN_REFRESH_COMPLETE', json.dumps({k: v for k, v in report.items() if k != 'triangles'}))
