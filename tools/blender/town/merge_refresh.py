"""Merge selected replacement roots without round-tripping untouched GLB payloads."""
import copy
import json
import struct
from pathlib import Path


def read_glb(path):
    raw = Path(path).read_bytes()
    magic, version, length = struct.unpack_from('<4sII', raw)
    if magic != b'glTF' or version != 2 or length != len(raw):
        raise ValueError('Invalid GLB header')
    offset, doc, blob = 12, None, b''
    while offset < len(raw):
        size, kind = struct.unpack_from('<II', raw, offset)
        part = raw[offset + 8:offset + 8 + size]
        if kind == 0x4E4F534A:
            doc = json.loads(part)
        elif kind == 0x004E4942:
            blob = part
        offset += size + 8
    return doc, blob


def write_glb(path, doc, blob):
    doc['buffers'] = [{'byteLength': len(blob)}]
    text = json.dumps(doc, separators=(',', ':')).encode()
    text += b' ' * (-len(text) % 4)
    blob += b'\0' * (-len(blob) % 4)
    raw = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(text) + 8 + len(blob))
    raw += struct.pack('<II', len(text), 0x4E4F534A) + text
    raw += struct.pack('<II', len(blob), 0x004E4942) + blob
    Path(path).write_bytes(raw)


def merge_refresh(original_path, replacement_path, output_path, replacement_names):
    sources = [read_glb(original_path), read_glb(replacement_path)]
    out = {'asset': {'version': '2.0', 'generator': 'Town architecture pipeline'},
           'scene': 0, 'scenes': [{'name': 'Town', 'nodes': []}],
           'nodes': [], 'meshes': [], 'materials': [], 'accessors': [], 'bufferViews': []}
    blob = bytearray()
    maps = [{key: {} for key in ('nodes', 'meshes', 'materials', 'accessors', 'bufferViews')} for _ in sources]

    def item(source, kind, idx):
        if idx in maps[source][kind]:
            return maps[source][kind][idx]
        doc, data = sources[source]
        value = copy.deepcopy(doc[kind][idx])
        target = len(out[kind])
        maps[source][kind][idx] = target
        out[kind].append(value)
        if kind == 'nodes':
            if 'children' in value:
                value['children'] = [item(source, 'nodes', n) for n in value['children']]
            if 'mesh' in value:
                value['mesh'] = item(source, 'meshes', value['mesh'])
            if 'skin' in value or 'camera' in value:
                raise ValueError('Town pack root must be static')
        elif kind == 'meshes':
            for p in value['primitives']:
                p['attributes'] = {a: item(source, 'accessors', i) for a, i in p['attributes'].items()}
                if 'indices' in p:
                    p['indices'] = item(source, 'accessors', p['indices'])
                if 'material' in p:
                    p['material'] = item(source, 'materials', p['material'])
        elif kind == 'accessors':
            if 'bufferView' in value:
                value['bufferView'] = item(source, 'bufferViews', value['bufferView'])
            if 'sparse' in value:
                for k in ('indices', 'values'):
                    value['sparse'][k]['bufferView'] = item(source, 'bufferViews', value['sparse'][k]['bufferView'])
        elif kind == 'bufferViews':
            start = value.get('byteOffset', 0)
            blob.extend(b'\0' * (-len(blob) % 4))
            value['byteOffset'] = len(blob)
            value['buffer'] = 0
            blob.extend(data[start:start + value['byteLength']])
        elif kind == 'materials':
            # Palette-only packs have no texture resources to remap.
            if any('Texture' in k for k in value) or any('Texture' in k for k in value.get('pbrMetallicRoughness', {})):
                raise ValueError('Unexpected textured material')
        return target

    def roots(doc):
        return {doc['nodes'][i]['name']: i for i in doc['scenes'][doc.get('scene', 0)]['nodes']}
    old, new = roots(sources[0][0]), roots(sources[1][0])
    names = set(replacement_names)
    if not names <= new.keys():
        raise ValueError(f'Missing replacements: {names - new.keys()}')
    for name, idx in old.items():
        source = 1 if name in names else 0
        root = item(source, 'nodes', new[name] if source else idx)
        out['scenes'][0]['nodes'].append(root)
    for name in sorted(names - old.keys()):
        out['scenes'][0]['nodes'].append(item(1, 'nodes', new[name]))
    write_glb(output_path, out, bytes(blob))
    return {'originalRoots': len(old), 'replacementRoots': len(names),
            'preservedRoots': len(old.keys() - names), 'finalRoots': len(out['scenes'][0]['nodes'])}
