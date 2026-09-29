"""Original B1 environment pack. Run only in a NEW --background --factory-startup process.
Generated image maps + token palette, 25 structural variants, 3 LODs, editable source,
separate GLBs, a reusable pack, contact sheet and arrangement render.
No mutation of the active UI Blender scene or production runtime files.
"""
import bpy, math, random, json, os, sys, hashlib, argparse, struct, bmesh
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[4]
WORK = ROOT / 'tools/blender/environment'
OUT = WORK / 'exports/staging/b1'
QA = WORK / 'qa/renders/b1'
SOURCE = WORK / 'source/b1'
for p in (OUT, QA, SOURCE): p.mkdir(parents=True, exist_ok=True)
PLAN = json.loads((WORK/'catalog/production-plan.json').read_text())
PALETTE = json.loads((WORK/'catalog/b1-palette-snapshot.json').read_text())
ASSETS = [a for a in PLAN['assets'] if a['batch']=='B1']
SEED = 290926
MATS = {}
REPORT = {'generator':'build_b1.py','version':1,'seed':SEED,'blender':bpy.app.version_string,
 'execution':'headless CLI, not MCP','paletteSha256':PALETTE['sha256'],
 'status':'candidate-export; runtime promotion pending','variants':{}}

def rgb(hexstr):
    a=[int(hexstr[i:i+2],16)/255 for i in (1,3,5)]
    return tuple(v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in a)
def tint(a, factor=1, mix=None, amount=0):
    c=rgb(a) if isinstance(a,str) else a
    if mix: c=tuple(v*(1-amount)+w*amount for v,w in zip(c,rgb(mix)))
    return tuple(min(1,max(0,v*factor)) for v in c)
P=PALETTE['MAP_COLORS']; R=PALETTE['ROOF_PALETTES']['terran']['main']

def material(name, color, texture=None, band=None):
    if name in MATS:return MATS[name]
    m=bpy.data.materials.new(name);m.use_nodes=True;m.diffuse_color=(*color,1)
    bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(*color,1)
    bs.inputs['Roughness'].default_value=.9;bs.inputs['Specular IOR Level'].default_value=.15
    if texture:
        p=WORK/'textures/masters'/texture/(texture+'_v001.png')
        if not p.exists():raise FileNotFoundError(p)
        im=bpy.data.images.load(str(p),check_existing=True)
        # Raw grayscale is a neutral RGB albedo multiplier for portable glTF;
        # it is not passed into the existing scalar NoColorSpace town atlas.
        im.colorspace_settings.name='sRGB'
        tx=m.node_tree.nodes.new('ShaderNodeTexImage');tx.image=im;tx.extension='REPEAT'
        mult=m.node_tree.nodes.new('ShaderNodeMixRGB');mult.blend_type='MULTIPLY'
        mult.inputs[0].default_value=1;mult.inputs[2].default_value=(*color,1)
        m.node_tree.links.new(tx.outputs['Color'],mult.inputs[1])
        m.node_tree.links.new(mult.outputs[0],bs.inputs['Base Color'])
        m['textureSet']=texture
    m['paletteSource']='src/art/palette.js';m['band']=band if band is not None else -1
    MATS[name]=m;return m

def init_materials():
    material('ENV_bark',tint(P['dock'],.58),'wood_bark')
    material('ENV_wood',tint(P['dock'],1.1),'wood_trim')
    material('ENV_wood_dark',tint(P['dock'],.58),'wood_trim')
    for i,f in enumerate((.73,.91,1.08,1.22)):
        material('ENV_leaf_'+str(i),tint(P['treeLight'],f,mix=P['meadow'],amount=.35))
    for i,f in enumerate((.82,1,1.14)):
        material('ENV_stone_'+str(i),tint(P['wall'],f,mix=P['sand'],amount=.22),'stone_rock')
    material('ENV_plaster',tint(P['wallsModern'],1.25),'architecture_trim',3)
    material('ENV_roof',tint(R[0],1.15),'architecture_trim',1)
    material('ENV_roof_light',tint(R[2],1.2),'architecture_trim',1)
    material('ENV_roof_dark',tint(R[1],.8),'architecture_trim',1)
    material('ENV_tile',tint(R[0],1.15))
    material('ENV_tile_light',tint(R[0],1.23))
    material('ENV_tile_dark',tint(R[0],1.07))
    material('ENV_modern',tint(P['wallsModern'],1.2),'modern_trim',3)
    material('ENV_metal',tint(P['wall'],.4),'modern_trim',1)
    material('ENV_glass',tint(P['glass'],.62))
    material('ENV_grass_ground',tint(P['meadow'],.95),'ground_grass')
    material('ENV_dirt_ground',tint(P['path'],.9),'ground_dirt')
    material('ENV_cobble_ground',tint(P['wall'],1.1),'stone_cobble')

def uv_project(obj, mat, span=2):
    mesh=obj.data;uv=mesh.uv_layers.new(name='UVMap') if not mesh.uv_layers else mesh.uv_layers.active
    band=int(mat.get('band',-1))
    for poly in mesh.polygons:
        normal=poly.normal;axis=max(range(3),key=lambda j:abs(normal[j]))
        for li in poly.loop_indices:
            v=mesh.vertices[mesh.loops[li].vertex_index].co
            a,b=(v.y,v.z) if axis==0 else (v.x,v.z) if axis==1 else (v.x,v.y)
            if band>=0:
                u=a/span;w=(band+.07+(b/span%1)*.86)/4
            else:u,w=a/span,b/span
            uv.data[li].uv=(u,w)

def finish(obj, parent, mat, bevel=0, smooth=False):
    obj.parent=parent;obj.data.materials.append(mat)
    if bevel:
        bpy.context.view_layer.objects.active=obj
        mod=obj.modifiers.new('Selected edge bevel','BEVEL');mod.width=bevel;mod.segments=1
        bpy.ops.object.modifier_apply(modifier=mod.name)
    for f in obj.data.polygons:f.use_smooth=smooth
    uv_project(obj,mat)
    return obj

def mesh_obj(name, vertices, faces, parent, mat, smooth=False):
    data=bpy.data.meshes.new(name);data.from_pydata(vertices,[],faces);data.update()
    bm=bmesh.new();bm.from_mesh(data);bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bm.to_mesh(data);bm.free()
    o=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(o)
    return finish(o,parent,mat,smooth=smooth)

def box(parent, loc, size, mat, bevel=0):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc)
    o=bpy.context.object;o.scale=size
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    return finish(o,parent,mat,bevel)

def branch(parent, points, radii, mat, sides):
    verts=[]
    for j,p in enumerate(points):
        v=Vector(p);d=Vector(points[min(j+1,len(points)-1)])-Vector(points[max(0,j-1)])
        rot=d.to_track_quat('Z','Y')
        for k in range(sides):
            a=k*2*math.pi/sides
            verts.append(v+rot@Vector((math.cos(a)*radii[j],math.sin(a)*radii[j],0)))
    faces=[]
    for j in range(len(points)-1):
        for k in range(sides):
            n=(k+1)%sides;faces.append((j*sides+k,j*sides+n,(j+1)*sides+n,(j+1)*sides+k))
    faces+=[tuple(reversed(range(sides))),tuple((len(points)-1)*sides+k for k in range(sides))]
    return mesh_obj('tapered branch',verts,faces,parent,mat,True)

def clump(parent,loc,scale,sub,mat,phase=0):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub,radius=1,location=loc)
    o=bpy.context.object
    for v in o.data.vertices:
        p=v.co; f=1+.08*math.sin(p.x*5+phase)*math.cos(p.y*4-p.z*3)
        v.co=Vector((p.x*scale[0]*f,p.y*scale[1]*f,p.z*scale[2]*f))
    return finish(o,parent,mat,smooth=True)

def crown_leaf(parent,center,normal,length,width,mat):
    # Sculpted leaf/lozenge shape, not an alpha card or a sphere.
    n=Vector(normal).normalized();rot=n.to_track_quat('Z','Y');c=Vector(center)
    points=[(0,-length,0),(-width,-length*.25,0),(-width*.8,length*.45,0),(0,length,0),(width*.8,length*.45,0),(width,-length*.25,0),(0,0,.13),(0,0,-.06)]
    verts=[c+rot@Vector(p) for p in points]
    faces=[(i,(i+1)%6,6) for i in range(6)]+[((i+1)%6,i,7) for i in range(6)]
    return mesh_obj('canopy leaf cluster',verts,faces,parent,mat,True)

def oak(parent,lod,variant):
    r=random.Random(SEED+variant*73);sides=[12,8,5][lod]
    lean=(variant-1)*.23
    branch(parent,[(0,0,0),(.12,0,.5),(lean,-.12,2),(.18+lean,.08,3.5),(.1,0,5.4)],
           [.7,.54,.38,.3,.12],MATS['ENV_bark'],sides)
    for i in range(5 if lod<2 else 0):
        a=i*math.tau/5+.2
        branch(parent,[(math.cos(a)*1,math.sin(a)*1,.06),(math.cos(a)*.4,math.sin(a)*.4,.22),(0,0,.8)],
               [.12,.24,.3],MATS['ENV_bark'],sides)
    crown=[]
    for i in range(7):
        a=i*2.399+variant*.8;rad=3 if i<5 else .9
        z=4.6+(i%3)*1.1+r.uniform(-.2,.2)
        pos=(math.cos(a)*rad,math.sin(a)*rad,z)
        branch(parent,[(lean,0,2.3+i*.28),(pos[0]*.55,pos[1]*.55,z-.8),pos],
               [.24,.16,.045],MATS['ENV_bark'],sides)
        size=(1.55+r.random()*.2,1.4+r.random()*.3,1.15+r.random()*.3)
        crown.append((pos,size))
    for i,(pos,size) in enumerate(crown):
        clump(parent,pos,size,[3,2,1][lod],MATS['ENV_leaf_'+str(i%4)],i*.7)
        if lod<2:
            for j in range(2):
                a=i*1.7+j*2.1
                q=(pos[0]+math.cos(a)*size[0]*.7,pos[1]+math.sin(a)*size[1]*.7,pos[2]+.12)
                clump(parent,q,(size[0]*.54,size[1]*.57,size[2]*.63),[2,1][lod],MATS['ENV_leaf_'+str((i+j+1)%4)],a)
        if lod==0:
            for j in range(10):
                az=j*2.399+i;zz=.15+(j%4)*.22
                normal=Vector((math.cos(az)*math.sqrt(1-zz*zz),math.sin(az)*math.sqrt(1-zz*zz),zz))
                center=[pos[k]+normal[k]*size[k]*.95 for k in range(3)]
                crown_leaf(parent,center,normal,.42,.25,MATS['ENV_leaf_'+str((i+j)%4)])

def pine(parent,lod,variant):
    sides=[12,8,5][lod];lean=(variant-1)*.25
    branch(parent,[(0,0,0),(.05,0,2),(lean,0,5),(lean*.5,0,9.5)],
           [.34,.25,.16,.025],MATS['ENV_bark'],sides)
    tiers=5+variant
    for j in range(tiers):
        z=1.6+j*(6.15/(tiers-1));rad=2.1-j*(1.45/(tiers-1))
        n=[24,16,7][lod];verts=[]
        for ring,(h,f) in enumerate([(0,.92),(.24,1),(.85,.53),(1.72,.02)]):
            for k in range(n):
                a=math.tau*k/n+j*.43+variant*.2
                scallop=1+(.12 if k%2 else -.04)
                verts.append((math.cos(a)*rad*f*scallop+lean*z/10,math.sin(a)*rad*f*scallop,z+h+(.12*math.sin(k*2) if ring==0 else 0)))
        faces=[]
        for ring in range(3):
            for k in range(n):faces.append((ring*n+k,ring*n+(k+1)%n,(ring+1)*n+(k+1)%n,(ring+1)*n+k))
        faces.append(tuple(reversed(range(n))))
        mesh_obj('lobed pine tier',verts,faces,parent,MATS['ENV_leaf_'+str(j%4)],False)

def rock(parent,lod,variant,tall=False,loc=(0,0,0),scale=None):
    r=random.Random(SEED+variant*113+int(tall)*23)
    n=[8,7,6][lod]
    scale=scale or ((.85,.6,3) if tall else (1,.8,1.5))
    verts=[]
    for j,(height,spread) in enumerate([(0,.78),(.3,1),(.76,.83),(1,.45)]):
        for i in range(n):
            a=math.tau*i/n;noise=r.uniform(.88,1.09)
            x=math.cos(a)*scale[0]*spread*noise+height*(.24 if tall else -.25)*scale[0]
            y=math.sin(a)*scale[1]*spread*noise
            z=height*scale[2]+(r.uniform(-.12,.12)*scale[2] if j>0 else 0)
            verts.append((x+loc[0],y+loc[1],z+loc[2]))
    faces=[]
    for j in range(3):
        for i in range(n):faces.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
    faces.extend([tuple(reversed(range(n))),tuple(3*n+i for i in range(n))])
    o=mesh_obj('broad planar rock',verts,faces,parent,MATS['ENV_stone_1'])
    for mat in ('ENV_stone_0','ENV_stone_2'):o.data.materials.append(MATS[mat])
    for f in o.data.polygons:f.material_index=r.choices([0,1,2],[.65,.15,.2])[0]
    if lod==0:
        bpy.context.view_layer.objects.active=o
        mod=o.modifiers.new('Stone edge wear','BEVEL');mod.width=.045;mod.segments=1
        bpy.ops.object.modifier_apply(modifier=mod.name)

def grass(parent,lod,variant):
    r=random.Random(SEED+variant*19)
    for j in range([7,5,3][lod]):
        a=j*2.4+r.random()*.2;h=r.uniform(.22,.36);w=r.uniform(.04,.075);bend=r.uniform(.1,.22)
        points=[(-w,0,0),(w,0,0),(w*.5,bend*.3,h*.62),(0,bend,h),(-w*.5,bend*.3,h*.62),(0,-.015,h*.38)]
        verts=[(x*math.cos(a)-y*math.sin(a),x*math.sin(a)+y*math.cos(a),z) for x,y,z in points]
        mesh_obj('broad curved grass blade',verts,[(0,1,5),(1,2,5),(2,3,5),(3,4,5),(4,0,5),(0,4,3,2,1)],parent,MATS['ENV_leaf_'+str(j%4)])

def shrub(parent,lod,variant):
    for i in range(5+variant):
        a=i*2.4+variant*.6;rad=.3+variant*.09
        loc=(math.cos(a)*rad,math.sin(a)*rad,.35+(i%3)*(.1+variant*.025))
        clump(parent,loc,(.55,.45,.48),[2,2,1][lod],MATS['ENV_leaf_'+str(i%4)],i)

def cliff(parent,lod,variant):
    # Shared end profiles, irregular internal rock planes; no masonry blocks.
    n=7 if lod<2 else 4;verts=[]
    for row in range(3):
        for i in range(n):
            x=-2+4*i/(n-1);edge=i in (0,n-1)
            y=[-1,-.78,-.9][row]+(0 if edge else .12*math.sin(i*2.3+row))
            z=[0,.94,2][row]+(.15*math.cos(i*1.8) if row==1 and not edge else 0)
            verts.append((x,y,z))
    verts += [(-2,1,0),(2,1,0),(-2,1,2),(2,1,2)]
    faces=[]
    for row in range(2):
        for i in range(n-1):faces.append((row*n+i,row*n+i+1,(row+1)*n+i+1,(row+1)*n+i))
    faces += [tuple(range(n))+ (3*n+1,3*n),tuple(range(2*n,3*n))+(3*n+3,3*n+2),
      (0,n,2*n,3*n+2,3*n),(n-1,2*n-1,3*n-1,3*n+3,3*n+1),(3*n,3*n+1,3*n+3,3*n+2)]
    o=mesh_obj('layered cliff volume',verts,faces,parent,MATS['ENV_stone_1'])
    o.data.materials.append(MATS['ENV_stone_0']);o.data.materials.append(MATS['ENV_stone_2'])
    for f in o.data.polygons:f.material_index=(f.index//2)%3

def fence(parent,lod,variant):
    for x in (-.9,.9):box(parent,(x,0,.55),(.2,.18,1.1),MATS['ENV_wood_dark'],.018 if lod==0 else 0)
    for z in (.35,.8):box(parent,(0,-.025,z),(1.8,.12,.14),MATS['ENV_wood'],.012 if lod==0 else 0)
    if lod==0:
        for x in (-.9,.9):
            for z in (.35,.8):
                branch(parent,[(x,-.108,z),(x,-.128,z)],[.023,.023],MATS['ENV_metal'],8)

def dock(parent,lod,variant):
    for x in (-.83,.83):
        for y in (-.83,.83):box(parent,(x,y,.17),(.2,.2,.34),MATS['ENV_wood_dark'],.015 if lod==0 else 0)
    for x in (-.7,.7):box(parent,(x,0,.25),(.14,2,.18),MATS['ENV_wood_dark'],.01 if lod==0 else 0)
    count=10 if lod<2 else 5
    for j in range(count):box(parent,(0,-1+(j+.5)*2/count,.35),(2,2/count-.014,.1),MATS['ENV_wood'],.01 if lod==0 else 0)

def wall(parent,lod,variant,modern=False):
    bevel=.015 if lod==0 else 0
    mat=MATS['ENV_modern' if modern else 'ENV_plaster']
    if not modern:
        # lower-left-front is (0, 0, 0); clear entrance x=.5..1.5, z=0..2.1
        for x in (.25,1.75):box(parent,(x,.1,1.5),(.5,.2,3),mat,bevel)
        box(parent,(1,.1,2.55),(1,.2,.9),mat,bevel)
        for x in (.07,1.93):box(parent,(x,.07,1.5),(.12,.23,3),MATS['ENV_wood_dark'],bevel)
        box(parent,(1,.07,2.93),(2,.23,.14),MATS['ENV_wood_dark'],bevel)
        if lod<2:
            for x in (.45,1.55):box(parent,(x,.015,1.07),(.1,.13,2.14),MATS['ENV_wood'],bevel)
            box(parent,(1,.015,2.18),(1.2,.13,.16),MATS['ENV_wood'],bevel)
    else:
        for x in (.2,1.8):box(parent,(x,.1,1.5),(.4,.2,3),mat,bevel)
        box(parent,(1,.1,.35),(1.2,.2,.7),mat,bevel)
        box(parent,(1,.1,2.75),(1.2,.2,.5),mat,bevel)
        box(parent,(1,.14,1.6),(1.2,.04,1.8),MATS['ENV_glass'])
        if lod==2:return
        for x in (.43,1,1.57):box(parent,(x,.025,1.6),(.055,.08,1.86),MATS['ENV_metal'],bevel/2)
        for z in (.7,1.6,2.5):box(parent,(1,.025,z),(1.2,.08,.055),MATS['ENV_metal'],bevel/2)
        box(parent,(1,-.02,.66),(1.35,.35,.09),mat,bevel)

def roof(parent,lod,variant):
    # Footprint 4x4, ridge z=2. Every slope is a slab with thickness.
    for sign in (-1,1):
        vs=[(0,-2,2),(sign*2,-2,0),(sign*2,2,0),(0,2,2),(0,-2,1.86),(sign*2,-2,-.14),(sign*2,2,-.14),(0,2,1.86)]
        mesh_obj('roof structural slope',vs,[(0,1,2,3),(4,7,6,5),(0,4,5,1),(3,2,6,7),(1,5,6,2),(0,3,7,4)],parent,MATS['ENV_roof'])
        if lod<2:
            rows=6;cols=8 if lod==0 else 4;arc=5 if lod==0 else 3
            for row in range(rows):
                x0=row*2/rows;x1=min(2.06,x0+2/rows+.06)
                for col in range(cols):
                    y0=-2+col*4/cols;w=4/cols
                    verts=[]
                    for x in (x0,x1):
                        for k in range(arc):
                            t=k/(arc-1)
                            verts.append((sign*x,y0+t*w,2-x+.025+.065*math.sin(t*math.pi)+.03*(x-x0)/(x1-x0)))
                    faces=[(k,k+1,arc+k+1,arc+k) if sign<0 else (arc+k,arc+k+1,k+1,k) for k in range(arc-1)]
                    mesh_obj('curved terracotta tile',verts,faces,parent,MATS[['ENV_tile','ENV_tile_light','ENV_tile_dark'][(row*7+col*13)%3]])
    for x in (-2.03,2.03):box(parent,(x,0,-.09),(.13,4.1,.2),MATS['ENV_wood_dark'],.02 if lod==0 else 0)
    branch(parent,[(0,-2.05,2.03),(0,2.05,2.03)],[.12,.12],MATS['ENV_tile_light'],[12,8,5][lod])

BUILDERS={'env_tree_oak':oak,'env_tree_pine':pine,'env_rock_boulder':rock,
 'env_rock_slab':lambda p,l,v:rock(p,l,v,True),'env_grass_tuft':grass,'env_shrub_round':shrub,
 'env_cliff_straight':cliff,'env_fence_straight':fence,'env_dock_straight':dock,
 'env_wall_door':wall,'env_roof_gable':roof,'env_modern_facade':lambda p,l,v:wall(p,l,v,True)}

def empty(name):
    o=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(o);return o

def join_parts(parent):
    parts=[o for o in parent.children_recursive if o.type=='MESH']
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts:o.select_set(True)
    bpy.context.view_layer.objects.active=parts[0];bpy.ops.object.join()
    mesh=bpy.context.object;mesh.name=parent.name+'_mesh'
    mesh.parent=parent
    # Mesh data in root local space, regardless of active primitive origin.
    mw=mesh.matrix_world.copy()
    for v in mesh.data.vertices:v.co=mw@v.co
    mesh.matrix_world=Matrix.Identity(4)
    return mesh

def measure(mesh):
    mesh.data.calc_loop_triangles()
    verts=[v.co for v in mesh.data.vertices]
    return {'triangles':len(mesh.data.loop_triangles),'vertices':len(verts),
     'boundsBlender':{'min':[round(min(v[i] for v in verts),5) for i in range(3)],'max':[round(max(v[i] for v in verts),5) for i in range(3)]},
     'materialSlots':len(mesh.data.materials),'uv':bool(mesh.data.uv_layers)}

def export_selected(path,objects):
    bpy.ops.object.select_all(action='DESELECT')
    originals={obj:obj.matrix_world.copy() for obj in objects if obj.parent is None}
    for obj in originals:obj.matrix_world=Matrix.Identity(4)
    bpy.context.view_layer.update()
    for obj in objects:
        obj.hide_set(False);obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,
      export_texcoords=True,export_normals=True,export_materials='EXPORT',export_animations=False,
      export_extras=True,export_yup=True,export_image_format='JPEG',export_image_quality=85)
    # Blender's generic Multiply node exports the image but loses its constant
    # tint. Write the standard glTF baseColorFactor explicitly from source.
    blob=path.read_bytes();json_len=struct.unpack_from('<I',blob,12)[0]
    doc=json.loads(blob[20:20+json_len]);tail=blob[20+json_len:]
    for mat in doc.get('materials',[]):
        source=MATS.get(mat['name'])
        if source and 'textureSet' in source:
            mat.setdefault('pbrMetallicRoughness',{})['baseColorFactor']=list(source.diffuse_color)
    chunk=json.dumps(doc,separators=(',',':')).encode();chunk+=b' '*((-len(chunk))%4)
    total=12+8+len(chunk)+len(tail)
    path.write_bytes(struct.pack('<4sII',b'glTF',2,total)+struct.pack('<II',len(chunk),0x4E4F534A)+chunk+tail)
    for obj,matrix in originals.items():obj.matrix_world=matrix
    bpy.context.view_layer.update()

def camera_aim(loc,target,ortho):
    cam=bpy.context.scene.camera;cam.location=loc
    cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler()
    cam.data.type='ORTHO';cam.data.ortho_scale=ortho

def text_label(body,loc,size=.3):
    curve=bpy.data.curves.new('label','FONT');curve.body=body;curve.size=size;curve.align_x='CENTER'
    o=bpy.data.objects.new('QA label '+body,curve);bpy.context.collection.objects.link(o)
    o.location=loc;curve.materials.append(material('QA_ink',(.09,.1,.075)))
    return o

def render(path,width=1600,height=1100):
    s=bpy.context.scene;s.render.resolution_x=width;s.render.resolution_y=height;s.render.resolution_percentage=100
    s.render.filepath=str(path);bpy.ops.render.render(write_still=True)

def main():
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    init_materials();all_roots=[];variant_meshes={};first_by_id={}
    for a in ASSETS:
        for variant in range(a['variantTarget']):
            name=a['assetId']+'_'+chr(97+variant);holder=empty(name);holder['assetId']=a['assetId'];holder['variant']=variant
            meshes=[]
            for lod in range(3):
                parent=empty(name+'_LOD'+str(lod));parent.parent=holder
                BUILDERS[a['assetId']](parent,lod,variant)
                meshes.append(join_parts(parent))
            # Rescale nature to the planned metre dimensions using a single common
            # transform across LODs. Architecture retains exact socket geometry.
            if a['family']=='nature':
                b=measure(meshes[0])['boundsBlender'];lo=b['min'];hi=b['max']
                target=[a['sizeTargetM'][0],a['sizeTargetM'][2],a['sizeTargetM'][1]]
                factors=[target[i]/(hi[i]-lo[i]) for i in range(3)]
                center=[(lo[0]+hi[0])/2,(lo[1]+hi[1])/2,lo[2]]
                for m in meshes:
                    for v in m.data.vertices:v.co=Vector([(v.co[i]-center[i])*factors[i] for i in range(3)])
            data={'assetId':a['assetId'],'variantId':name,'lods':{},'units':'metres','baseSeed':SEED,'variantIndex':variant,
                  'pivotPolicy':a['pivotPolicy'],'source':'tools/blender/environment/source/b1/environment_b1_v001.blend',
                  'status':'exported-candidate; gameplay colliders/sockets not integrated'}
            for lod,m in enumerate(meshes):
                d=measure(m);d['ceiling']=a['lodTriangleCeilings'][lod]
                d['withinBudget']=d['triangles']<=d['ceiling'];data['lods'][str(lod)]=d
            # Concrete source geometry socket positions are in runtime X,Y,Z.
            if a['assetId']=='env_wall_door':data['sockets']={'entrance':[1,0,0],'left':[0,0,0],'right':[2,0,0]}
            elif a['assetId']=='env_fence_straight':data['sockets']={'left':[-1,0,0],'right':[1,0,0]}
            elif a['assetId']=='env_dock_straight':data['sockets']={'deck_start':[0,.4,1],'deck_end':[0,.4,-1]}
            elif a['assetId']=='env_cliff_straight':data['sockets']={'left':[-2,0,0],'right':[2,0,0]}
            REPORT['variants'][name]=data
            folder=ROOT/a['sourceDirectory'];folder.mkdir(parents=True,exist_ok=True)
            (folder/(name+'_v001.metadata.json')).write_text(json.dumps(data,indent=2)+'\n')
            all_roots.append(holder);variant_meshes[name]=meshes
            if variant==0:first_by_id[a['assetId']]=holder
    bpy.context.view_layer.update()
    objects=[o for root in all_roots for o in [root,*root.children_recursive]]
    # A readable authoring grid; export_selected strips presentation transforms.
    for i,root in enumerate(all_roots):
        root.location=((i%5)*13,(i//5)*14,0)
        family=next(a['family'] for a in ASSETS if a['assetId']==root['assetId'])
        collection=bpy.data.collections.get('SOURCE_'+family)
        if collection is None:
            collection=bpy.data.collections.new('SOURCE_'+family);bpy.context.scene.collection.children.link(collection)
        for obj in [root,*root.children_recursive]:
            for old in list(obj.users_collection):old.objects.unlink(obj)
            collection.objects.link(obj)
    bpy.context.view_layer.update()
    # Preserve a source scene with every LOD, but keep only LOD0 visible for opening.
    for name,meshes in variant_meshes.items():
        for lod,m in enumerate(meshes):m.hide_render=lod!=0
    for im in bpy.data.images:
        if im.source=='FILE':im.pack()
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'environment_b1_v001.blend'))
    export_selected(OUT/'environment_b1_v001.glb',objects)
    for root in all_roots:
        export_selected(OUT/(root.name+'_v001.glb'),[root,*root.children_recursive])
    (WORK/'qa/reports/b1-authoring.json').write_text(json.dumps(REPORT,indent=2)+'\n')
    if '--skip-renders' in sys.argv:
        print('B1_EXPORT_COMPLETE',len(all_roots),'variants',flush=True)
        return
    # Render-only gallery, never exported into game asset pack.
    for root in all_roots:
        for o in root.children_recursive:o.hide_render=True
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24
    scene.cycles.use_denoising=True;scene.world.color=(.65,.65,.65)
    scene.world.use_nodes=True;scene.world.node_tree.nodes.get('Background').inputs[0].default_value=(.65,.7,.8,1)
    scene.world.node_tree.nodes.get('Background').inputs[1].default_value=.65
    scene.view_settings.view_transform='AgX'
    bpy.ops.object.camera_add(location=(20,-30,28));scene.camera=bpy.context.object
    bpy.ops.object.light_add(type='AREA',location=(-10,-8,23));bpy.context.object.data.energy=2400;bpy.context.object.data.shape='DISK';bpy.context.object.data.size=15
    bpy.ops.object.light_add(type='SUN',location=(0,0,15));bpy.context.object.rotation_euler=(.45,-.55,-.3);bpy.context.object.data.energy=2;bpy.context.object.data.angle=.3
    ground=box(None,(0,0,-.22),(45,40,.35),material('QA_ivory',(.72,.7,.63)),.05)
    gallery=[];labels=[]
    # Large nature in back, modules in front; labels sit flat on presentation floor.
    positions={'env_tree_oak':(-11,6,0),'env_tree_pine':(-2,6,0),'env_rock_boulder':(6,6,0),'env_rock_slab':(12,6,0),
       'env_shrub_round':(-12,-2,0),'env_grass_tuft':(-7,-2,0),'env_cliff_straight':(-1,-2,0),
       'env_fence_straight':(6,-2,0),'env_dock_straight':(11,-2,0),'env_wall_door':(-9,-9,0),
       'env_roof_gable':(-1,-9,.2),'env_modern_facade':(8,-9,0)}
    for a in ASSETS:
        root=first_by_id[a['assetId']];root.location=positions[a['assetId']]
        variant_meshes[root.name][0].hide_render=False
        gallery.append(root)
        pos=root.location;label=text_label(a['assetId'].replace('env_','').upper(),(pos.x,pos.y-2.2,.005),.34);labels.append(label)
    camera_aim((23,-36,31),(0,1,2.8),41)
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'environment_b1_gallery_v001.blend'))
    render(QA/'01-b1-asset-gallery.png',1800,1200)
    # Hero asset frames at a closer scale.
    for a in ASSETS:
        for root in gallery:
            for o in root.children_recursive:o.hide_render=True
        for o in labels:o.hide_render=True
        root=first_by_id[a['assetId']];root.location=(0,0,0);variant_meshes[root.name][0].hide_render=False
        size=a['sizeTargetM'];h=size[1];w=max(size[0],size[2],h)
        camera_aim((w*1.1,-w*1.5,max(h*.95,w*1.2)),(size[0]/2 if a['assetId'] in ('env_wall_door','env_modern_facade') else 0,0,h*.43),w*1.7)
        render(QA/(a['assetId']+'-hero.png'),800,800)
    # A composed environment setup using the same actual exported-source models.
    for root in gallery:
        for o in root.children_recursive:o.hide_render=True
    for o in labels:o.hide_render=True
    ground.data.materials.clear();ground.data.materials.append(MATS['ENV_grass_ground'])
    def instance(asset,pos,rotation=0,scale=1,variant=0):
        key=asset+'_'+chr(97+variant);src=variant_meshes[key][0]
        ob=bpy.data.objects.new('SETUP_'+key,src.data);bpy.context.collection.objects.link(ob)
        ob.location=pos;ob.rotation_euler.z=rotation;ob.scale=(scale,)*3;return ob
    # Landscape vignette, not a navigable production town.
    for asset,pos,scale,var in [('env_tree_oak',(-6,4,0),1,0),('env_tree_oak',(5,6,0),.8,1),('env_tree_pine',(-9,9,0),1,1),('env_tree_pine',(10,8,0),.85,2)]:instance(asset,pos,scale=scale,variant=var)
    for j in range(3):instance('env_cliff_straight',(-4+j*4,10,0))
    for x,y,v in [(-6,-2,0),(-8,2,1),(6,2,2),(8,-3,3)]:instance('env_rock_boulder',(x,y,0),scale=.8,variant=v)
    for x,y in [(-7,1),(7,4),(5,-4),(-4,-2),(9,5)]:instance('env_shrub_round',(x,y,0))
    for j in range(22):
        a=j*2.4;r=5+(j%4)
        instance('env_grass_tuft',(math.cos(a)*r,math.sin(a)*r,0),rotation=a,variant=j%3)
    for x in (-7,-5,5,7):instance('env_fence_straight',(x,-5,0))
    for j in range(3):instance('env_dock_straight',(9,-2-j*2,0))
    # Texture swatches are represented by ground strips, all three masters used.
    box(None,(0,-2,-.005),(3.5,21,.08),MATS['ENV_dirt_ground'],.06)
    box(None,(0,-6,.045),(5,3,.08),MATS['ENV_cobble_ground'],.06)
    camera_aim((23,-32,26),(0,2,3),36)
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'environment_b1_setup_v001.blend'))
    render(QA/'02-b1-environment-setup.png',1600,1200)
    print('B1_COMPLETE',len(all_roots),'variants',len(all_roots)*3,'LOD meshes',flush=True)

if __name__=='__main__':main()
