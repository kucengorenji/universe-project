"""Re-export packed source with portable JPEG images, preserving lossless masters."""
import bpy, importlib.util
from pathlib import Path
p=Path(__file__).with_name('build_b1.py')
spec=importlib.util.spec_from_file_location('b1',p);b1=importlib.util.module_from_spec(spec);spec.loader.exec_module(b1)
b1.MATS.update({m.name:m for m in bpy.data.materials})
roots=[o for o in bpy.context.scene.objects if o.type=='EMPTY' and o.parent is None and o.name.startswith('env_')]
objects=[o for root in roots for o in [root,*root.children_recursive]]
b1.export_selected(b1.OUT/'environment_b1_v001.glb',objects)
for root in roots:b1.export_selected(b1.OUT/(root.name+'_v001.glb'),[root,*root.children_recursive])
print('B1_REEXPORT_COMPLETE',len(roots))
