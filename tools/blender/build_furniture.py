"""Build public/models/furniture.glb in the chunky-toon look (chunky/props.py).

    GLOBE_ROOT=<root> Blender -b --factory-startup --python tools/blender/build_furniture.py [-- --preview]

Writes <root>/public/models/furniture.glb: one Empty per asset (named as in
props.ASSETS) holding a single <name>_LOD0 mesh, one material per palette
token. No normals are exported: the game rebuilds creased smooth normals at
load (loadAssetPack crease option), which keeps the file small.
--preview also renders a lineup to <root>/tools/blender/qa/furniture_lineup.png.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402

from chunky import kit, props, studio  # noqa: E402

ROOT = kit.ROOT
OUT = os.path.join(ROOT, 'public/models/furniture.glb')


class PropBuilder(kit.Builder):
    """Fewer bevel and round segments than the character kit: props are seen from a few metres."""

    def bsegs(self, r):
        if r <= 5e-4:
            return 0
        return 3 if r >= 0.06 else 2 if r >= 0.015 else 1

    def seg(self, n):
        return max(6, round(n * 0.75))


def build():
    for name in ('Cube', 'Light', 'Camera'):
        o = bpy.data.objects.get(name)
        if o is not None:
            bpy.data.objects.remove(o, do_unlink=True)
    src = kit.coll('FURNITURE')
    kit.clear_collection(src)
    holders, meshes = [], []
    report = []
    for i, (name, fn, v) in enumerate(props.names()):
        b = PropBuilder(lod=0)
        fn(b, v)
        tris = b.stats()['tris']
        holder = bpy.data.objects.new(name, None)
        src.objects.link(holder)
        holder.location = ((i % 8) * 3.0, -(i // 8) * 3.0, 0)
        obj = b.to_object(f'{name}_LOD0', src, mode='mat', parent=holder)
        holders.append(holder)
        meshes.append(obj)
        report.append((name, tris))
    return holders, meshes, report


def preview(holders):
    sc = bpy.context.scene
    studio.setup(sc, res=(2000, 1300), samples=32, world_hex=0x8E8E96, world_strength=0.9)
    lights = kit.coll('PREVIEW')
    studio.cyc(sc, lights, hex_=0x8C8C94, width=80, front=40, wall=12)
    for o in lights.objects:
        if o.name == 'Cyc':
            o.location = (10.5, -10, 0)
    studio.add_sun(sc, lights, 'Key', (0.5, 0.8, -1.0), energy=3.2, hex_=0xFFF1DE, angle_deg=12)
    studio.add_area(sc, lights, 'Fill', (4, -30, 18), (10.5, -10, 0), energy=9000, size=20, hex_=0xDDE6FF)
    cam = studio.add_camera(sc, lights, 'Cam', (10.5, -30.0, 19.0), (10.5, -9.2, 0.6), lens=46)
    studio.render(sc, cam, os.path.join(ROOT, 'tools/blender/qa/furniture_lineup.png'))


def main():
    holders, meshes, report = build()
    bpy.context.view_layer.update()
    size = kit.export_glb(OUT, holders + meshes, normals=False)
    total = sum(t for _, t in report)
    for name, tris in report:
        print(f'  {name:22s} {tris:6d} tris')
    print(f'furniture.glb {size} bytes, {len(report)} assets, {total} tris -> {OUT}')
    if '--preview' in sys.argv:
        preview(holders)


main()
