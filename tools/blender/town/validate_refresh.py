"""Verify untouched node/material/accessor payloads survive the GLB merge exactly.

Usage: python3 tools/blender/town/validate_refresh.py BASELINE FINAL
Runtime bounds/LOD/layout contracts are covered by town-refresh-assets.test.js.
"""
import hashlib
import json
import math
import struct
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from merge_refresh import read_glb


def audit_new_meshes(doc, blob):
    cache = {}
    def values(index):
        if index in cache:
            return cache[index]
        accessor = doc['accessors'][index]
        view = doc['bufferViews'][accessor['bufferView']]
        width = {'SCALAR': 1, 'VEC3': 3}[accessor['type']]
        code = {5123: 'H', 5125: 'I', 5126: 'f'}[accessor['componentType']]
        fmt = '<' + code * width
        stride = view.get('byteStride', struct.calcsize(fmt))
        start = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
        cache[index] = [struct.unpack_from(fmt, blob, start + i * stride)
                        for i in range(accessor['count'])]
        return cache[index]
    count = 0
    for root_index in doc['scenes'][doc.get('scene', 0)]['nodes']:
        root = doc['nodes'][root_index]
        if root.get('extras', {}).get('townAssetRevision') != 1:
            continue
        for child in root['children']:
            node = doc['nodes'][child]
            for primitive in doc['meshes'][node['mesh']]['primitives']:
                positions = values(primitive['attributes']['POSITION'])
                assert all(math.isfinite(x) for v in positions for x in v), node['name']
                indices = ([v[0] for v in values(primitive['indices'])]
                           if 'indices' in primitive else list(range(len(positions))))
                assert len(indices) % 3 == 0, node['name']
                for i in range(0, len(indices), 3):
                    a, b, c = (positions[indices[i + k]] for k in range(3))
                    u, v = [b[k] - a[k] for k in range(3)], [c[k] - a[k] for k in range(3)]
                    cross = (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])
                    assert sum(x * x for x in cross) > 1e-20, f'{node["name"]}: zero-area triangle'
            count += 1
    return count


def root_payload(doc, blob, root):
    def accessor(index):
        a = dict(doc['accessors'][index])
        view = dict(doc['bufferViews'][a.pop('bufferView')])
        start = view.pop('byteOffset', 0)
        view.pop('buffer', None)
        data = blob[start:start + view['byteLength']]
        return {'accessor': a, 'view': view, 'sha256': hashlib.sha256(data).hexdigest()}
    def node(index):
        n = dict(doc['nodes'][index])
        if 'children' in n:
            n['children'] = [node(i) for i in n['children']]
        if 'mesh' in n:
            mesh = dict(doc['meshes'][n['mesh']])
            primitives = []
            for p in mesh['primitives']:
                p = dict(p)
                p['attributes'] = {k: accessor(i) for k, i in p['attributes'].items()}
                if 'indices' in p:
                    p['indices'] = accessor(p['indices'])
                if 'material' in p:
                    p['material'] = doc['materials'][p['material']]
                primitives.append(p)
            mesh['primitives'] = primitives
            n['mesh'] = mesh
        return n
    return node(root)


def validate(original, final):
    old, ob = read_glb(original)
    new, nb = read_glb(final)
    roots = lambda d: {d['nodes'][i]['name']: i for i in d['scenes'][d.get('scene', 0)]['nodes']}
    a, b = roots(old), roots(new)
    assert a.keys() <= b.keys(), f'Lost roots: {a.keys() - b.keys()}'
    preserved = 0
    for name, index in a.items():
        target = b[name]
        if new['nodes'][target].get('extras', {}).get('townAssetRevision') == 1:
            continue
        assert root_payload(old, ob, index) == root_payload(new, nb, target), name
        preserved += 1
    return {'originalRoots': len(a), 'finalRoots': len(b), 'untouchedPayloadsVerified': preserved,
            'finiteNondegenerateMeshesVerified': audit_new_meshes(new, nb)}

if __name__ == '__main__':
    print(json.dumps(validate(*sys.argv[1:3])))
