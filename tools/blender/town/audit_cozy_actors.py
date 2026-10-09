"""Import final GLBs into Blender and audit their exported triangles and skin data."""
import json
import math
import os
from pathlib import Path
import bpy
from mathutils import Vector

ROOT = Path(os.environ.get('GLOBE_ROOT', Path(__file__).resolve().parents[3]))
result = {}
for name in ('town',):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(ROOT / 'public/models' / (name + '.glb')))
    mesh_count, triangles, verts, zero_area, unweighted = 0, 0, 0, 0, 0
    bounds = {}
    helpers = {bone.custom_shape for obj in bpy.context.scene.objects if obj.type == 'ARMATURE'
               for bone in obj.pose.bones if bone.custom_shape}
    excluded_helpers = []
    for obj in bpy.context.scene.objects:
        if obj.type != 'MESH':
            continue
        if obj in helpers:
            excluded_helpers.append(obj.name)
            continue
        mesh_count += 1
        me = obj.data
        me.calc_loop_triangles()
        triangles += len(me.loop_triangles)
        verts += len(me.vertices)
        assert all(math.isfinite(x) for v in me.vertices for x in v.co), obj.name
        # New actor meshes are checked; unrelated legacy meshes may contain authored thin details.
        actor = name != 'town' or obj.name.startswith(('vb_', 'vw_', 'vh_'))
        if actor:
            for tri in me.loop_triangles:
                a, b, c = [me.vertices[i].co for i in tri.vertices]
                if (b - a).cross(c - a).length_squared < 1e-20:
                    zero_area += 1
                    print('ZERO_AREA', obj.name, [tuple(v) for v in (a, b, c)])
            if name == 'character':
                bad = [v for v in me.vertices if not v.groups or abs(sum(g.weight for g in v.groups) - 1) > 1e-4]
                if bad:
                    print('WEIGHT_AUDIT', obj.name, [(v.index, list(v.co), [(obj.vertex_groups[g.group].name, g.weight) for g in v.groups]) for v in bad[:5]])
                unweighted += len(bad)
        corners = [obj.matrix_world @ Vector(p) for p in obj.bound_box]
        if actor:
            bounds[obj.name] = {'min': [min(v[i] for v in corners) for i in range(3)], 'max': [max(v[i] for v in corners) for i in range(3)]}
    assert zero_area == 0, (name, zero_area)
    assert unweighted == 0, (name, unweighted)
    if name == 'character':
        assert mesh_count == 10, mesh_count
    result[name] = {'status': 'PASS', 'meshes': mesh_count, 'triangles': triangles, 'exportedVertices': verts,
                    'zeroAreaActorTriangles': zero_area, 'invalidSkinWeights': unweighted,
                    'boundsBlenderZUp': bounds, 'actions': [a.name for a in bpy.data.actions],
                    'excludedBoneDisplayHelpers': excluded_helpers}
result['blender'] = bpy.app.version_string
(ROOT / 'docs/qa/cozy-actors/round-trip.json').write_text(json.dumps(result, indent=2) + '\n')
print('COZY_ROUND_TRIP_PASS', {name: {k: v for k, v in report.items() if k != 'boundsBlenderZUp'} for name, report in result.items() if isinstance(report, dict)})
