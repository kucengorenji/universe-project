"""Import the final runtime GLB into Blender and check real exported mesh data."""
import bpy
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
WORK = ROOT / 'tools/blender/home'
GLB = ROOT / 'public/models/home_cozy.glb'
expected = json.loads((WORK / 'qa/export.json').read_text())
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(GLB))
errors, results = [], {}
for name, asset in expected['assets'].items():
    for lod, record in asset['lods'].items():
        obj = bpy.data.objects.get(name + '_LOD' + lod)
        if obj is None:
            errors.append(name + '/' + lod + ': missing imported mesh')
            continue
        meshes = [o for o in [obj, *obj.children_recursive] if o.type == 'MESH']
        triangles = 0
        points = []
        materials, image_names = set(), set()
        for mesh in meshes:
            mesh.data.calc_loop_triangles()
            triangles += len(mesh.data.loop_triangles)
            if not mesh.data.uv_layers: errors.append(mesh.name + ': UV lost')
            if any(abs(n.vector.length - 1) > .02 for n in mesh.data.corner_normals): errors.append(mesh.name + ': normal invalid')
            for v in mesh.data.vertices:
                p = obj.matrix_world.inverted() @ mesh.matrix_world @ v.co
                points.append((p.x, p.z, -p.y))
            for slot in mesh.material_slots:
                if slot.material:
                    materials.add(slot.material.name)
                    for node in slot.material.node_tree.nodes:
                        if node.type == 'TEX_IMAGE' and node.image:
                            image_names.add(node.image.name)
                            if node.image.size[0] != 1024 or node.image.size[1] != 1024: errors.append('atlas dimensions lost')
        lo = [min(p[a] for p in points) for a in range(3)]
        hi = [max(p[a] for p in points) for a in range(3)]
        if triangles != record['triangles']: errors.append(name + '/' + lod + ': triangle count changed')
        if any(abs(lo[a] - record['bounds']['min'][a]) > .003 or abs(hi[a] - record['bounds']['max'][a]) > .003 for a in range(3)):
            errors.append(name + '/' + lod + ': metre bounds changed')
        if not image_names: errors.append(name + '/' + lod + ': texture lost')
        results[name + '_LOD' + lod] = {'triangles': triangles, 'meshes': len(meshes), 'uv': True,
                                       'materials': sorted(materials), 'images': sorted(image_names), 'bounds': {'min': lo, 'max': hi}}
report = {'status': 'FAIL' if errors else 'PASS', 'blender': bpy.app.version_string,
          'runtimeSha256': hashlib.sha256(GLB.read_bytes()).hexdigest(), 'importedLODCount': len(results),
          'checks': {'triangles': True, 'metreScaleAndBounds': True, 'uv': True, 'normals': True, 'textures': True},
          'assets': results, 'errors': errors}
(WORK / 'qa/roundtrip.json').write_text(json.dumps(report, indent=2) + '\n')
print('HOME_ROUNDTRIP', report['status'], len(results), errors, flush=True)
if errors: raise RuntimeError('Runtime GLB round-trip failed')
