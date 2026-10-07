"""Geometry contract checks; run with Blender --background --python this_file.

Builds only the support primitives in memory. Does not export or replace assets.
"""
import importlib.util
import json
import math
from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[3]
ns = {'__name__': 'town_build'}
exec(compile((ROOT / 'tools/blender/build_town_space.py').read_text(),
             'build_town_space.py', 'exec'), ns)
spec = importlib.util.spec_from_file_location('support_props', Path(__file__).with_name('support_props.py'))
support = importlib.util.module_from_spec(spec)
spec.loader.exec_module(support)


def part_bounds():
    points = [v for verts, _, _ in ns['PARTS'] for v in verts]
    return ([min(v[k] for v in points) for k in range(3)],
            [max(v[k] for v in points) for k in range(3)])


# Reproduce existing authored extents in the original convention. This tests the
# same compatibility wrapper as the refresh generator, independently of export.
legacy = {
    'f_well': ('f_well', 0), 'f_lamp': ('f_lamp', 0),
    'f_market_stall_v0': ('f_market_stall', 0),
    'f_market_stall_v1': ('f_market_stall', 1),
    'f_market_stall_v2': ('f_market_stall', 2),
    'm_lamp': ('m_lamp', 0), 'm_bench': ('m_bench', 0),
}
ns['refresh_bounds'] = {}
for name, (function, variant) in legacy.items():
    ns['PARTS'].clear()
    ns['Q'] = 0
    ns[function](variant)
    lo, hi = part_bounds()
    ns['refresh_bounds'][name] = {
        **{'min' + axis: lo[k] for k, axis in enumerate('XYZ')},
        **{'max' + axis: hi[k] for k, axis in enumerate('XYZ')},
    }

builders = support.support_builders(ns)
assert len(builders) == 15
report = {}
for name, builder in builders.items():
    triangles = []
    for lod in range(3):
        ns['Q'] = lod
        obj = ns['asset'](name, 'Support', builder)
        mesh = obj.data
        mesh.calc_loop_triangles()
        triangles.append(len(mesh.loop_triangles))
        assert triangles[-1] > 0, (name, lod, 'empty mesh')
        assert all(math.isfinite(component) for v in mesh.vertices for component in v.co)
        assert all(triangle.area > 1e-12 for triangle in mesh.loop_triangles), (name, lod, 'degenerate triangle')
        target = ns['refresh_bounds'].get(name, support.PROXY_BOUNDS.get(name))
        lo, hi = part_bounds()
        if isinstance(target, dict):
            target_lo = [target['min' + axis] for axis in 'XYZ']
            target_hi = [target['max' + axis] for axis in 'XYZ']
        else:
            target_lo, target_hi = target
        assert max(abs(lo[k] - target_lo[k]) for k in range(3)) < 1e-5, (name, lod, 'min bounds')
        assert max(abs(hi[k] - target_hi[k]) for k in range(3)) < 1e-5, (name, lod, 'max bounds')
        # No geometry may cross another model's holder placement or LOD offset.
        assert tuple(obj.location) == (0, lod * 45, 0)
    assert triangles[0] > triangles[1] > triangles[2], (name, triangles, 'LOD must remove geometry')
    assert triangles[1] < triangles[0] * .65, (name, triangles, 'weak middle LOD')
    assert triangles[2] < triangles[0] * .40, (name, triangles, 'weak distant LOD')
    report[name] = triangles

print('SUPPORT_PROPS_CHECK ' + json.dumps(report, sort_keys=True))
print('PASS: 15 props, 45 finite nondegenerate meshes, exact bounds and genuine LOD reductions')
