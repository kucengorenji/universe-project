"""Original textured scenery pack. Run in a NEW background Blender process.
Embedded 256px surface + 512px cutout atlases; indexed UVs and three mesh LODs.
Coordinates: metres, Z up, front -Y. No external art or dependencies.
"""
import bpy, math, random, os, json, struct
from mathutils import Vector
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
rng = random.Random(427)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
# Four horizontal tiles: timber, stone, painted metal, leafy canopy.
N=256
img=bpy.data.images.new('SceneryAtlas',width=N,height=N,alpha=False)
pixels=[]
for y in range(N):
    for x in range(N):
        tile=x//64; u=x%64; v=y%64
        noise=rng.random()-.5
        if tile==0:
            grain=math.sin(u*.8+math.sin(y*.06)*2)*.045 + noise*.035
            seam=.62 if u%16==0 else 1
            c=[(.47+grain)*seam,(.31+grain)*seam,(.17+grain)*seam]
        elif tile==1:
            seam=.75 if (v%16==0 or (u+(v//16%2)*8)%24==0) else 1
            c=[(.59+noise*.13)*seam,(.58+noise*.12)*seam,(.52+noise*.1)*seam]
        elif tile==2:
            seam=.8 if u%16<2 else 1
            c=[(.63+noise*.03)*seam,(.68+noise*.03)*seam,(.67+noise*.03)*seam]
        else:
            # overlapping oval leaf marks, not photographic images
            leaf=math.sin(u*.81+v*.43)*math.sin(v*.67-u*.37)
            c=[.38+leaf*.06+noise*.025,.56+leaf*.09+noise*.025,.22+leaf*.04]
        pixels.extend([*c,1])
img.pixels.foreach_set(pixels)
img.filepath_raw=os.path.join(ROOT,'tools/blender/textures/scenery_atlas.png'); img.file_format='PNG'; img.save()
mat=bpy.data.materials.new('Scenery_shared'); mat.use_nodes=True
bs=mat.node_tree.nodes.get('Principled BSDF'); bs.inputs['Roughness'].default_value=.82
tex=mat.node_tree.nodes.new('ShaderNodeTexImage'); tex.image=img
mat.node_tree.links.new(tex.outputs['Color'],bs.inputs['Base Color'])
foliage=bpy.data.materials.new('Foliage_cutout');foliage.use_nodes=True
foliage.diffuse_color=(.45,.7,.25,1)
leafbs=foliage.node_tree.nodes.get('Principled BSDF');leafbs.inputs['Roughness'].default_value=.9
leaftex=foliage.node_tree.nodes.new('ShaderNodeTexImage')
leaftex.image=bpy.data.images.load(os.path.join(ROOT,'tools/blender/textures/flora_cards.png'))
foliage.node_tree.links.new(leaftex.outputs['Color'],leafbs.inputs['Base Color'])
foliage.node_tree.links.new(leaftex.outputs['Alpha'],leafbs.inputs['Alpha'])

def leaf_card(p,loc,size,tile,angle=0,tilt=0):
    # A bent card catches light from two directions. Alpha-tested, never blended.
    w,h=size
    verts=[(-w/2,0,0),(0,.1*w,0),(w/2,0,0),(-w/2,0,h),(0,.1*w,h),(w/2,0,h)]
    mesh=bpy.data.meshes.new('Leaf card');mesh.from_pydata(verts,[],[(0,1,4,3),(1,2,5,4)]);mesh.update()
    o=bpy.data.objects.new('Leaf spray',mesh);bpy.context.collection.objects.link(o)
    o.parent=p;o.location=loc;o.rotation_euler=(tilt,0,angle);mesh.materials.append(foliage)
    uv=mesh.uv_layers.new(name='UVMap')
    for face in mesh.polygons:
        for li in face.loop_indices:
            vi=mesh.loops[li].vertex_index;u=vi%3/2;v=vi//3
            uv.data[li].uv=((tile%4+.02+u*.96)/4,1-(tile//4+1-.02-v*.96)/4)
    return o

def palm_frond(p,loc,angle,lod,length):
    rows=[7,5,3][lod];verts=[]
    for j in range(rows):
        t=j/(rows-1)
        for side in [-1,0,1]:
            verts.append((side*.85,t*length,math.sin(t*math.pi)*.8-t*.5+(.12 if side==0 else 0)))
    faces=[(j*3+k,j*3+k+1,(j+1)*3+k+1,(j+1)*3+k) for j in range(rows-1) for k in range(2)]
    mesh=bpy.data.meshes.new('Curved palm frond');mesh.from_pydata(verts,[],faces);mesh.update()
    o=bpy.data.objects.new('Palm frond',mesh);bpy.context.collection.objects.link(o);o.parent=p;o.location=loc;o.rotation_euler.z=angle
    mesh.materials.append(foliage);uv=mesh.uv_layers.new(name='UVMap')
    for face in mesh.polygons:
        face.use_smooth=True
        for li in face.loop_indices:
            vi=mesh.loops[li].vertex_index;u=vi%3/2;v=(vi//3)/(rows-1)
            uv.data[li].uv=((2+.02+u*.96)/4,1-(3-.02-v*.96)/4)

def finish(obj,parent,tile,bevel=0):
    obj.parent=parent; obj.data.materials.clear(); obj.data.materials.append(mat)
    if not obj.data.uv_layers: obj.data.uv_layers.new(name='UVMap')
    for loop in obj.data.uv_layers.active.data:
        loop.uv.x=(tile+.035+loop.uv.x*.93)/4
        loop.uv.y=loop.uv.y*.98+.01
    if bevel:
        mod=obj.modifiers.new('Edge highlights','BEVEL'); mod.width=bevel; mod.segments=2
        bpy.context.view_layer.objects.active=obj; bpy.ops.object.modifier_apply(modifier=mod.name)
    return obj

def box(p,loc,size,tile,bevel=0):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc); o=bpy.context.object; o.scale=size
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    return finish(o,p,tile,bevel)

def beam(p,a,b,r,tile,vertices=12):
    a,b=Vector(a),Vector(b); d=b-a
    bpy.ops.mesh.primitive_cone_add(vertices=vertices,radius1=r,radius2=r*.72,depth=d.length,location=(a+b)/2)
    o=bpy.context.object; o.rotation_euler=d.to_track_quat('Z','Y').to_euler()
    for f in o.data.polygons: f.use_smooth=True
    return finish(o,p,tile)

def clump(p,loc,size,lod):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=[16,10,6][lod],ring_count=[8,6,4][lod],radius=1,location=loc)
    o=bpy.context.object; o.scale=size
    for v in o.data.vertices:
        factor=1+.07*math.sin(v.co.x*7+v.co.z*4)*math.cos(v.co.y*6-v.co.z*3)
        v.co*=factor
    for f in o.data.polygons: f.use_smooth=True
    return finish(o,p,3)

def crown(p,loc,size,lod,tile=0):
    clump(p,loc,tuple(v*(.5 if lod<2 else 1) for v in size),lod)
    if lod==2:return
    for i in range(16 if lod==0 else 6):
        a=i*2.399;zoff=((i%3)-1)*size[2]*.46
        leaf_card(p,(loc[0]+math.cos(a)*size[0]*.66,loc[1]+math.sin(a)*size[1]*.66,loc[2]+zoff-size[2]*.55),
                  (size[0]*1.65,size[2]*1.7),tile,a,math.sin(i*1.7)*1.0)

def empty(name,parent=None):
    o=bpy.data.objects.new(name,None); bpy.context.collection.objects.link(o); o.parent=parent; return o

def tree(p,species,lod,variant=0):
    palm=species=='palm'; conifer=species in ('pine','spruce','cypress'); birch=species=='birch'
    H=8 if conifer else 7 if palm else 5.8
    lean=.18+variant*.42
    if palm:
        for j in range(4):
            t=j/4;n=(j+1)/4
            beam(p,(.7*t*t,0,H*.87*t),(.7*n*n,0,H*.87*n),.3-t*.13,0,[14,10,6][lod])
    else:
        beam(p,(0,0,0),(lean,0,H*.72),.23 if birch else .36,1 if birch else 0,[14,10,6][lod])
    if conifer:
        for i in range(3 if lod<2 else 2):
            radius=((1.8 if species!='cypress' else .95)-i*.3)*(1.45 if lod==2 else 1)
            bpy.ops.mesh.primitive_cone_add(vertices=[16,10,7][lod],radius1=radius,radius2=.1,depth=H*.5,location=(.1,0,H*.46+i*(2.2 if lod==2 else 1.1)))
            finish(bpy.context.object,p,3)
            if lod<2:
                for j in range(10 if lod==0 else 5):
                    a=j*2.399+i
                    leaf_card(p,(math.cos(a)*(1.35-i*.2),math.sin(a)*(1.35-i*.2),H*.3+i*1.1),(1.6,1.4),9,a,.4)
    elif palm:
        for i in range([9,7,5][lod]):
            a=i*math.tau/[9,7,5][lod]
            palm_frond(p,(.7,0,H*.87),a,lod,3.3+(i%3)*.3)
    else:
        if lod==2:
            # Preserve the near canopy envelope; a tiny single clump popped
            # visibly when whole forest chunks switched to their far LOD.
            wide=species=='acacia'
            clump(p,(lean,0,5.05+variant*.2),(3.9 if wide else 3.5,3.35 if wide else 3,2.2 if wide else 2.85),lod)
            for i in range(6):
                a=i*2.399
                leaf_card(p,(lean+math.cos(a)*2.1,math.sin(a)*1.8,3.6+(i%3)*.7),(2.8,2.8),1 if birch else 0,a,.7*math.sin(a))
            return
        points=[(-1.1,0,.2),(1,.5,.1),(.1,-.9,.3),(0,.3,1.3)]
        for i,(x,y,z) in enumerate(points):
            wide=species=='acacia'
            if lod<2: beam(p,(.1,0,H*.4),(x,y,H*.7+z),.12,0,[10,7,5][lod])
            crown(p,(x+lean,y,H*.7+z+variant*(i%2)*.45),(2.1 if wide else 1.5,1.8 if wide else 1.4,.9 if wide else 1.7),lod,1 if birch else 0)
        if species=='fruit' and lod==0:
            for i in range(9):
                a=i*2.4; clump(p,(math.cos(a)*1.5,math.sin(a)*1.5,4.3+(i%3)*.45),(.12,.12,.12),2)

def dock(p,modern,lod):
    length=34 if modern else 22; width=7 if modern else 4
    tile=1 if modern else 0
    box(p,(0,0,.65),(width,length,.6),tile,.07 if lod==0 else 0)
    for x in (-width*.42,width*.42):
        for y in (-length*.4,0,length*.4):
            beam(p,(x,y,-3),(x,y,1.1),.25,tile,[14,10,6][lod])
            if lod<2: beam(p,(x,y,1),(x,y,1.6),.15,2,10)
    if modern:
        box(p,(0,-length*.27,2.3),(3.6,6,2.7),2,.1 if lod==0 else 0)
        if lod<2:
            beam(p,(-2,length*.23,1),(-2,length*.23,9),.3,2)
            beam(p,(-2,length*.23,9),(4,length*.23,9),.22,2)
            beam(p,(3.5,length*.23,9),(3.5,length*.23,4),.05,2,6)
    # Loose crates are separate g_crate instances with layout-owned colliders.

def garden(p,kind,lod):
    if kind=='bush': crown(p,(0,0,.65),(.95,.8,.65),lod,3)
    elif kind=='flowers':
        for i in range([6,4,2][lod]):leaf_card(p,(math.sin(i*2.4)*.5,math.cos(i*2.4)*.5,0),(.65,.7),12+i%4,i*2.4)
    elif kind=='bench':
        box(p,(0,0,.52),(2.2,.65,.13),0,.04 if lod==0 else 0)
        box(p,(0,.28,.98),(2.2,.12,.7),0)
        for x in [-.8,.8]:box(p,(x,0,.23),(.12,.55,.46),2)
    elif kind=='planter':
        box(p,(0,0,.35),(1.6,1.6,.7),1,.06 if lod==0 else 0)
        crown(p,(0,0,1.0),(.85,.85,.6),lod,3)
    elif kind=='pergola':
        for x in [-2,2]:
            for y in [-1.7,1.7]:box(p,(x,y,1.55),(.18,.18,3.1),0)
        for x in [-2,-1,0,1,2]:box(p,(x,0,3.15),(.18,4.0,.16),0)
        if lod<2:
            for x in [-1.5,1.5]:crown(p,(x,0,3.3),(.65,1.3,.35),lod,3)
    elif kind=='crate':box(p,(0,0,.6),(1.2,1.2,1.2),0,.03 if lod==0 else 0)

assets={**{'t_'+s:('tree',s) for s in ['oak','birch','pine','spruce','cypress','palm','acacia','fruit']},'f_dock':('dock',False),'m_dock':('dock',True)}
assets.update({'t_'+s+'_v1':('tree',s) for s in ['oak','birch','pine','fruit']})
assets.update({name:('garden',kind) for name,kind in [('b_bush','bush'),('b_flowers','flowers'),('m_bench','bench'),('g_planter','planter'),('g_pergola','pergola'),('g_crate','crate')]})
for name,(kind,arg) in assets.items():
    root=empty(name)
    for lod in range(3):
        group=empty(name+'_LOD'+str(lod),root)
        if kind=='tree': tree(group,arg,lod,1 if name.endswith('_v1') else 0)
        elif kind=='dock': dock(group,arg,lod)
        else:garden(group,arg,lod)
        meshes=[o for o in group.children if o.type=='MESH']
        bpy.ops.object.select_all(action='DESELECT')
        for o in meshes:o.select_set(True)
        bpy.context.view_layer.objects.active=meshes[0]; bpy.ops.object.join()
        meshes[0].name=name+'_mesh'+str(lod)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT,'tools/blender/scenery_assets.blend'))
bpy.ops.export_scene.gltf(filepath=os.path.join(ROOT,'public/models/scenery.glb'),export_format='GLB',export_texcoords=True,export_normals=True,export_materials='EXPORT',export_animations=False)
# Explicit alpha mode survives Blender exporter versions with different UI names.
path=os.path.join(ROOT,'public/models/scenery.glb')
data=open(path,'rb').read();length=struct.unpack_from('<I',data,12)[0]
doc=json.loads(data[20:20+length]);tail=data[20+length:]
for material in doc.get('materials',[]):
    if material.get('name')=='Foliage_cutout':material.update(alphaMode='MASK',alphaCutoff=.45,doubleSided=True)
raw=json.dumps(doc,separators=(',',':')).encode();raw+=b' '*((-len(raw))%4)
open(path,'wb').write(struct.pack('<4sII',b'glTF',2,20+len(raw)+len(tail))+struct.pack('<I4s',len(raw),b'JSON')+raw+tail)
print('SCENERY COMPLETE')
