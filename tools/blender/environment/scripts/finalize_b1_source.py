"""Organize the editable source; audit raw texture pixels without editing images."""
import bpy,json,hashlib
import numpy as np
from pathlib import Path
w=Path(__file__).resolve().parents[1]
plan=json.loads((w/'catalog/production-plan.json').read_text())
roots=[o for o in bpy.context.scene.objects if o.type=='EMPTY' and o.parent is None and o.name.startswith('env_')]
roots.sort(key=lambda o:o.name)
for i,root in enumerate(roots):
 root.location=((i%5)*13,(i//5)*14,0)
 family=next(a['family'] for a in plan['assets'] if a['assetId']==root['assetId'])
 name='SOURCE_'+family;collection=bpy.data.collections.get(name)
 if collection is None:collection=bpy.data.collections.new(name);bpy.context.scene.collection.children.link(collection)
 for obj in [root,*root.children_recursive]:
  for old in list(obj.users_collection):old.objects.unlink(obj)
  collection.objects.link(obj)
bpy.ops.wm.save_as_mainfile(filepath=str(w/'source/b1/environment_b1_v001.blend'))
report={'status':'pixel diagnostics; not automatic seamless approval','maps':{}}
for p in (w/'textures/masters').glob('*/*_v001.png'):
 im=bpy.data.images.load(str(p),check_existing=True);width,height=im.size
 pixels=np.empty(width*height*4,dtype=np.float32);im.pixels.foreach_get(pixels)
 a=pixels.reshape(height,width,4)[:,:,:3];gray=a.mean(axis=2)
 hx=float(np.abs(gray[:,0]-gray[:,-1]).mean());hy=float(np.abs(gray[0]-gray[-1]).mean())
 ix=float(np.abs(gray[:,1:]-gray[:,:-1]).mean());iy=float(np.abs(gray[1:]-gray[:-1]).mean())
 entry={'resolution':[width,height],'channels':4,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),
  'meanRGBLinear':float(gray.mean()),'seamMeanAbsoluteErrorLinear':{'u':hx,'v':hy},
  'seamToInteriorGradientRatio':{'u':hx/max(ix,1e-6),'v':hy/max(iy,1e-6)},
  'seamlessApproval':'pending visual cleanup; generated opposite edges are not guaranteed identical',
  'masterRole':'neutral RGB albedo multiplier in B1; sRGB decode then palette factor; not scalar town atlas'}
 report['maps'][p.parent.name]=entry
 (p.parent/'metadata.json').write_text(json.dumps(entry,indent=2)+'\n')
(w/'qa/reports/b1-textures.json').write_text(json.dumps(report,indent=2)+'\n')
print('FINALIZED',len(roots),'source variants;',len(report['maps']),'texture diagnostics')
