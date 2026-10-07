import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as Model from './homeBlueprint.js';
import { furnishPendingRooms } from './homeFurnishing.js';
import { createHomeGroup, setHomeCutaway, disposeHomeGroup, loadHomePack } from './homeBuilder.js';
import { loadHomeRecord, saveHomeDraft, applyHomeDraft } from '../../world/homeState.js';
import './home.css';

const clone = value => structuredClone(value);
const esc = s => String(s).replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
const snap = v => Math.round(v * 4) / 4;
const centroid = points => points.reduce((v,p)=>({x:v.x+p.x/points.length,z:v.z+p.z/points.length}),{x:0,z:0});
const assets = loadHomePack;
const allItems = bp => [...bp.items,...(bp.yard?.items||[])];
const segmentDistance = (p,a,b) => { const dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz||1)));return Math.hypot(p.x-a.x-t*dx,p.z-a.z-t*dz); };

export default class HomeMode {
  static prepare() { return assets(); }
  constructor(ctx,route,arrival) {
    this.ctx=ctx;this.route=route;this.arrival=arrival;this.view='plan';this.tool='select';this.selected=null;this.roomId=null;
    this.keys=new Set();this.history=[];this.historyIndex=0;this.cutaway=true;this.pendingPoints=[];
    this.raycaster=new THREE.Raycaster();this.pointer=new THREE.Vector2();this.walkYaw=0;this.walkPitch=0;
  }
  async enter() {
    await this.ctx.world.ready;
    this.record=loadHomeRecord(this.ctx.world.state,this.route);
    if(!this.record) throw new Error('Rumah tidak ditemukan. Pilih Bangun Rumah dari kota.');
    this.pack=await assets();
    this.bp=clone(this.record.draft||this.record.applied||Model.createHomeBlueprint({id:this.record.id,seed:this.record.seed||this.record.layoutSeed||this.record.townSeed||1,plot:this.record.plot,floors:Math.min(3,this.record.source?.floors||2)}));
    this.floorId=this.bp.floors[0].id;this.history=[clone(this.bp)];
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color(0xe5e3d0);this.scene.fog=new THREE.Fog(0xe5e3d0,60,160);
    const homeHeight=this.bp.floors.at(-1).elevation+this.bp.floors.at(-1).height+this.bp.roof.rise;
    this.camera=new THREE.PerspectiveCamera(42,1,.06,250);this.camera.position.set(19,homeHeight+12,27);
    this.scene.add(new THREE.HemisphereLight(0xfff6df,0x809676,2.4));
    this.sun=new THREE.DirectionalLight(0xffeed0,3.1);this.sun.position.set(-16,25,18);this.sun.castShadow=true;
    this.sun.shadow.mapSize.set(2048,2048);Object.assign(this.sun.shadow.camera,{left:-22,right:22,top:22,bottom:-22,near:1,far:80});
    this.sun.shadow.normalBias=.03;this.sun.shadow.bias=-.0003;this.sun.shadow.autoUpdate=false;this.scene.add(this.sun,this.sun.target);
    this.ctx.engine.renderer.shadowMap.enabled=this.ctx.engine.quality.settings.shadows;
    this.orbit=new OrbitControls(this.camera,this.ctx.engine.renderer.domElement);this.orbit.target.set(0,homeHeight*.42,0);this.orbit.enableDamping=true;this.orbit.minDistance=3;this.orbit.maxDistance=75;this.orbit.maxPolarAngle=Math.PI*.48;
    this.orbit.mouseButtons={LEFT:THREE.MOUSE.ROTATE,MIDDLE:THREE.MOUSE.DOLLY,RIGHT:THREE.MOUSE.PAN};
    this.handleGeometry=new THREE.SphereGeometry(.14,12,8);this.handleMaterials=[0xb65f44,0x63837a,0xe2bc65].map(color=>new THREE.MeshBasicMaterial({color,depthTest:false}));
    this.handles=new THREE.Group();this.scene.add(this.handles);
    this.invalidPreview=new THREE.Mesh(new THREE.BoxGeometry(1,1,1).translate(0,.5,0),new THREE.MeshBasicMaterial({color:0xc75137,wireframe:true,transparent:true,opacity:.8,depthTest:false}));this.invalidPreview.visible=false;this.invalidPreview.renderOrder=101;this.scene.add(this.invalidPreview);
    this.buildUI();this.rebuild();this.bind();this.saveDraft();
    this.setView(this.arrival?.fromTownWalk?'walk':'plan');
  }
  get floor() { return this.bp.floors.find(f=>f.id===this.floorId)||this.bp.floors[0]; }
  get selectedItem() { return allItems(this.bp).find(i=>i.id===this.selected); }
  get selectedRoom() { return this.floor.rooms.find(r=>r.id===this.roomId); }
  selectedRoofSection(){return this.home?.userData.roof.userData.sections.find(s=>(s.roomId||null)===(this.roofSection||null))||this.home?.userData.roof.userData.sections[0];}
  roofParameters(bp=this.bp){return bp.roof.sections?.[this.roofSection]||bp.roof;}
  editableRoof(bp){if(this.roofSection&&!bp.roof.sections?.[this.roofSection]){bp.roof.sections||={};bp.roof.sections[this.roofSection]={rise:bp.roof.rise,overhang:bp.roof.overhang,ridgeOffset:bp.roof.ridgeOffset||0,type:bp.roof.type||'gable',authored:true};}return this.roofParameters(bp);}
  buildUI() {
    this.ui=document.createElement('section');this.ui.className='home-mode';this.ui.setAttribute('aria-label','Pembangunan rumah');
    const styleOptions=Object.entries(Model.HOME_STYLES).map(([id,s])=>'<option value="'+id+'">'+esc(s.label)+'</option>').join('');
    const roomOptions=['living','bedroom','kitchen','bathroom','hall','study','loft'].map(id=>'<option value="'+id+'">'+({living:'Ruang tamu',bedroom:'Kamar tidur',kitchen:'Dapur',bathroom:'Kamar mandi',hall:'Sirkulasi',study:'Ruang kerja',loft:'Loteng'}[id])+'</option>').join('');
    this.ui.innerHTML='<header class="home-header"><div class="home-heading"><button data-act="back" title="Kembali ke kota">← Kota</button><div><span class="home-eyebrow">PROCEDURAL HOME</span><strong>Rumah & pekarangan</strong></div></div><nav class="home-tabs" aria-label="Tampilan rumah"><button data-view="plan">Peta 2D</button><button data-view="orbit">Diorama</button><button data-view="walk">Jelajah</button></nav><div class="home-actions"><button data-act="generate" class="home-primary">Generate 3D</button><button data-act="undo" title="Ctrl/Cmd Z">↶ Undo</button><button data-act="redo">↷ Redo</button><button class="home-primary" data-act="apply">Terapkan ke kota</button></div></header>'+
      '<aside class="home-panel"><div class="home-panel-heading"><span>RANCANGAN</span><span class="home-badge">Draf</span></div><label>Gaya rumah<select data-field="style">'+styleOptions+'</select></label><label>Seed<input data-field="seed" type="text" maxlength="80" spellcheck="false"></label><div class="home-button-row"><button data-act="seed">Seed baru</button><button data-act="variation">Variasi</button></div><div class="home-divider"></div><label>Jumlah lantai<select data-field="floors"><option value="1">1 lantai</option><option value="2">2 lantai</option><option value="3">3 lantai</option></select></label><label class="home-check"><input type="checkbox" data-field="attic"> Tambahkan loteng</label><label>Lantai aktif<select data-field="floor"></select></label><label>Tambah barang ke<select data-field="placeTarget"><option value="floor">Lantai aktif</option><option value="yard">Pekarangan</option></select></label><label class="home-check"><input type="checkbox" data-field="cutaway" checked> Buka atap / dinding</label><div class="home-divider"></div><span class="home-label">ALAT DENAH</span><div class="home-tools"><button data-tool="select">Pilih / geser</button><button data-tool="rect">Kotak</button><button data-tool="polygon">Poligon</button><button data-tool="circle">Lengkung</button><button data-tool="zone">Pekarangan</button><button data-tool="plot">Batas lahan</button></div><label>Fungsi ruangan<select data-field="roomType">'+roomOptions+'</select></label><button data-act="finish" hidden>Selesaikan poligon</button><button class="home-primary home-generate" data-act="generate">Generate rumah 3D →</button><p class="home-footnote">Denah dan model 3D memakai rancangan yang sama. Variasi menjaga bagian yang sudah kamu edit.</p></aside>'+
      '<canvas class="home-plan" aria-label="Denah rumah dan pekarangan"></canvas><aside class="home-inspector"><span class="home-eyebrow">PILIHAN</span><h3 data-selection>Rumah klasik</h3><div data-properties></div><div class="home-divider"></div><label>Bagian atap<select data-field="roofSection"></select></label><div class="home-button-row"><button data-act="roofSplit">Pisah bagian</button><button data-act="roofMerge">Satukan</button></div><label>Bentuk atap<select data-field="roofType"><option value="gable">Pelana</option><option value="hip">Limas</option><option value="cone">Kerucut</option></select></label><label>Tinggi atap<input data-field="roofRise" type="range" min=".3" max="4" step=".1"></label><label>Ujung atap<input data-field="eave" type="range" min=".1" max="1.2" step=".05"></label><button data-act="roof">Edit atap di 3D</button><button data-act="walls">Edit dinding di 3D</button><div class="home-button-row"><button data-act="rotate" disabled>Putar 15°</button><button data-act="delete" disabled>Hapus</button></div><div class="home-divider"></div><p data-validation></p></aside>'+
      '<footer class="home-footer"><div class="home-status" role="status"><span data-save>Draf</span><span data-hint>Pilih ruangan, tarik titik denah, atau gambar ruangan baru.</span></div><div class="home-catalog" aria-label="Katalog barang">'+Object.entries(Model.HOME_CATALOG).filter(([,s])=>s.category!=='architecture').map(([type,s])=>'<button data-add="'+type+'" title="'+esc(s.label)+'"><span>'+esc(s.label)+'</span></button>').join('')+'</div></footer>';
    document.body.append(this.ui);this.planCanvas=this.ui.querySelector('canvas');this.updateUI();
  }
  bind() {
    this.abort=new AbortController();const signal=this.abort.signal;
    this.ui.addEventListener('click',e=>this.action(e),{signal});
    this.ui.addEventListener('change',e=>this.change(e),{signal});
    this.planCanvas.addEventListener('pointerdown',e=>this.planDown(e),{signal});
    this.planCanvas.addEventListener('pointermove',e=>this.planMove(e),{signal});
    this.planCanvas.addEventListener('pointerup',e=>this.planUp(e),{signal});
    this.planCanvas.addEventListener('pointercancel',()=>this.cancelDrag(),{signal});
    this.planCanvas.addEventListener('dblclick',()=>this.finishPolygon(),{signal});
    const canvas=this.ctx.engine.renderer.domElement;
    canvas.addEventListener('pointerdown',e=>this.sceneDown(e),{signal,capture:true});
    canvas.addEventListener('pointermove',e=>this.sceneMove(e),{signal});
    canvas.addEventListener('pointerup',()=>this.sceneUp(),{signal});
    canvas.addEventListener('pointercancel',()=>this.cancelDrag(),{signal});
    window.addEventListener('pointerup',()=>{this.sceneUp();this.planUp();},{signal});
    window.addEventListener('keydown',e=>this.key(e,true),{signal,capture:true});
    window.addEventListener('keyup',e=>this.key(e,false),{signal});
    window.addEventListener('blur',()=>{this.keys.clear();this.cancelDrag();},{signal});
  }
  action(e) {
    const b=e.target.closest('button');if(!b||b.disabled)return;
    if(b.dataset.invalidId){this.selected=b.dataset.invalidId;const item=this.selectedItem;if(item?.floorId!=='yard')this.floorId=item.floorId;this.roomId=null;this.setView('orbit');return;}
    if(b.dataset.view)return this.setView(b.dataset.view);
    if(b.dataset.tool){this.tool=b.dataset.tool;this.pendingPoints=[];this.updateUI();this.drawPlan();return;}
    if(b.dataset.add) {
      const target=this.ui.querySelector('[data-field=placeTarget]').value==='yard'?'yard':this.floorId;
      const next=Model.addHomeItem(this.bp,b.dataset.add,target);
      const before=new Set(allItems(this.bp).map(i=>i.id)),added=allItems(next).find(i=>!before.has(i.id));if(!added){this.message('Tidak ada ruang kosong yang cocok untuk barang ini.',true);return;}this.selected=added.id;this.commit(next);return;
    }
    switch(b.dataset.act) {
      case 'back':this.saveDraft();this.ctx.director.go({mode:'town',planet:this.route.planet,city:this.route.city});break;
      case 'generate':this.commit(furnishPendingRooms(this.bp));this.setView('orbit');break;
      case 'seed':this.newSeed();break;
      case 'variation':this.commit(Model.varyHomeBlueprint(this.bp));break;
      case 'undo':this.stepHistory(-1);break;
      case 'redo':this.stepHistory(1);break;
      case 'finish':this.finishPolygon();break;
      case 'roof':this.tool='roof';this.setView('orbit');this.cutaway=false;this.refreshVisibility();this.makeHandles();this.updateUI();break;
      case 'roofSplit':{const next=clone(this.bp),ids=[...new Set([...next.floors.at(-1).rooms.map(r=>r.id),...this.home.userData.roof.userData.sections.filter(s=>s.exposed).map(s=>s.roomId)])];next.roof.sections=Object.fromEntries(ids.map(id=>[id,next.roof.sections?.[id]||{rise:next.roof.rise,overhang:next.roof.overhang,ridgeOffset:0,type:next.roof.type||'gable',authored:true}]));this.roofSection=ids[0];next.roof.authored=true;this.commit(next);break;}
      case 'roofMerge':{const next=clone(this.bp);delete next.roof.sections;next.roof.authored=true;this.roofSection=null;this.commit(next);break;}
      case 'walls':this.tool='walls';this.setView('orbit');this.cutaway=true;this.refreshVisibility();this.roomId=this.roomId||this.floor.rooms[0]?.id;this.makeHandles();this.updateUI();break;
      case 'rotate':if(this.selectedItem){const p=this.selectedItem.position,result=Model.placeHomeItem(this.bp,this.selected,{...p,rotation:this.selectedItem.rotation+Math.PI/12},{obstacles:this.record.obstacles});if(result.ok)this.commit(result.blueprint);else this.message(result.reason,true);}break;
      case 'delete':{let next=clone(this.bp);if(this.selected){next=Model.removeHomeItem(next,this.selected);this.selected=null;}else if(this.roomId){const f=next.floors.find(f=>f.id===this.floorId);if(f.rooms.length===1){this.message('Sisakan satu ruangan pada lantai ini.',true);break;}f.authored=true;f.rooms=f.rooms.filter(r=>r.id!==this.roomId);this.roomId=null;}this.commit(this.reconcile(next));break;}
      case 'apply':this.apply();break;
    }
  }
  change(e) {
    const field=e.target.dataset.field;if(!field)return;
    if(field==='roofSection'){this.roofSection=e.target.value||null;this.makeHandles();this.updateUI();return;}
    if(field==='floor'){this.floorId=e.target.value;this.roomId=this.selected=null;this.refreshVisibility();this.makeHandles();this.updateUI();this.drawPlan();return;}
    if(field==='cutaway'){this.cutaway=e.target.checked;this.refreshVisibility();return;}
    if(field==='roomType'&&this.selectedRoom){const next=clone(this.bp),room=next.floors.find(f=>f.id===this.floorId).rooms.find(r=>r.id===this.roomId);room.type=e.target.value;room.authored=true;this.commit(this.reconcile(next));return;}
    if(field==='style'){const next=clone(this.bp);next.style=e.target.value;next.authoredStyle=true;this.commit(next);return;}
    if(field==='floors'||field==='attic'){if(Model.editHomeLevels)this.commit(Model.editHomeLevels(this.bp,{floors:Number(this.ui.querySelector('[data-field=floors]').value),attic:this.ui.querySelector('[data-field=attic]').checked}));return;}
    if(['roofRise','eave','roofType'].includes(field)){const next=clone(this.bp),roof=this.editableRoof(next);roof[field==='roofRise'?'rise':field==='eave'?'overhang':'type']=field==='roofType'?e.target.value:Number(e.target.value);roof.authored=next.roof.authored=true;this.commit(next);}
    if(field==='roomHeight'&&this.selectedRoom)this.commit(Model.editHomeFloorHeight(this.bp,this.floorId,Number(e.target.value)));
  }
  newSeed(random=true) {
    const seedField=this.ui.querySelector('[data-field=seed]'),oldSeed=seedField.value.trim()||'1';
    const seed=random?(oldSeed===String(this.bp.seed)?String(crypto.getRandomValues(new Uint32Array(1))[0]||1):oldSeed):this.bp.seed;
    const bp=Model.createHomeBlueprint({id:this.bp.id,seed,style:this.ui.querySelector('[data-field=style]').value,floors:Number(this.ui.querySelector('[data-field=floors]').value),attic:this.ui.querySelector('[data-field=attic]').checked,plot:this.bp.plot});
    this.floorId=bp.floors[0].id;this.selected=this.roomId=null;this.commit(bp);
  }
  reconcile(bp) { return Model.reconcileHomeBlueprint(bp); }
  moveVertex(bp,roomId,index,point){
    const floor=bp.floors.find(f=>f.rooms.some(r=>r.id===roomId)),room=floor.rooms.find(r=>r.id===roomId),old=room.points[index];
    for(const neighbor of floor.rooms)for(let i=0;i<neighbor.points.length;i++)if(Math.hypot(neighbor.points[i].x-old.x,neighbor.points[i].z-old.z)<.0001){neighbor.points[i]={...point};neighbor.authored=true;}
  }
  commit(bp,{rebuild=true}={}) {
    if(JSON.stringify(bp)===JSON.stringify(this.history[this.historyIndex])){this.bp=bp;if(rebuild)this.rebuild();this.updateUI();this.drawPlan();return;}
    this.bp=bp;this.history.splice(this.historyIndex+1);this.history.push(clone(bp));if(this.history.length>60)this.history.shift();this.historyIndex=this.history.length-1;
    if(!this.bp.floors.some(f=>f.id===this.floorId))this.floorId=this.bp.floors[0]?.id;
    this.saveDraft();if(rebuild)this.rebuild();this.updateUI();this.drawPlan();
  }
  stepHistory(delta) {
    this.cancelDrag();
    const i=this.historyIndex+delta;if(i<0||i>=this.history.length)return;this.historyIndex=i;this.bp=clone(this.history[i]);if(!this.bp.floors.some(f=>f.id===this.floorId))this.floorId=this.bp.floors[0]?.id;
    this.selected=this.roomId=null;this.rebuild();this.saveDraft();this.updateUI();this.drawPlan();
  }
  saveDraft() {
    try{saveHomeDraft(this.ctx.world.state,this.route,this.bp);this.ui.querySelector('[data-save]').textContent=this.ctx.world.state.error?'Gagal menyimpan':'Draf tersimpan';this.ctx.world.state.serial?.then(()=>{if(this.ui)this.ui.querySelector('[data-save]').textContent=this.ctx.world.state.error?'Gagal menyimpan':'Draf tersimpan';});}
    catch(e){this.message(e.message,true);}
  }
  validation() { const result=Model.validateHomeBlueprint(this.bp,{obstacles:this.record.obstacles||[]});return Array.isArray(result)?result:(result.errors||[]); }
  async apply() {
    if(this.applying)return;
    const errors=this.validation();if(errors.length){this.message(String(errors[0].message||errors[0]),true);return;}
    this.applying=true;this.ui.querySelector('[data-act=apply]').disabled=true;
    try{applyHomeDraft(this.ctx.world.state,this.route,this.bp);await this.ctx.world.state.serial;if(this.abort.signal.aborted)return;if(this.ctx.world.state.error)this.message('Rumah belum tersimpan: '+this.ctx.world.state.error.message,true);else await this.ctx.director.go({mode:'town',planet:this.route.planet,city:this.route.city});}
    catch(e){if(this.ui)this.message(e.message,true);}
    finally{this.applying=false;if(this.ui)this.updateUI();}
  }
  rebuild() {
    if(this.home)disposeHomeGroup(this.home);
    this.home=createHomeGroup(this.bp,{pack:this.pack});this.scene.add(this.home);this.refreshVisibility();this.makeHandles();this.sun.shadow.needsUpdate=true;this.needsRender=true;this.updateMarkers();
  }
  updateMarkers(){
    if(!this.home)return;
    this.markers?.forEach(m=>{m.removeFromParent();m.geometry.dispose();m.material.dispose();});this.markers=[];
    const result=Model.validateHomeBlueprint(this.bp,{obstacles:this.record.obstacles||[]}),ids=new Set(result.issues.filter(i=>i.code==='placement').map(i=>i.elementId));if(this.selected)ids.add(this.selected);
    this.home.updateMatrixWorld(true);for(const id of ids){const object=this.home.userData.items.get(id);if(!object)continue;const box=new THREE.BoxHelper(object,id===this.selected?0xd9a247:0xc75137);box.userData.floorId=object.userData.floorId;box.visible=object.userData.floorId===this.floorId||object.userData.floorId==='yard';this.scene.add(box);this.markers.push(box);}
  }
  refreshVisibility() { if(this.home){setHomeCutaway(this.home,{floorId:this.floorId,cutaway:this.view==='walk'?false:this.cutaway});this.sun.shadow.needsUpdate=true;this.needsRender=true;this.updateMarkers();} }
  makeHandles() {
    this.handles.clear();if(this.view!=='orbit')return;
    const add=(position,data,color=0)=>{const h=new THREE.Mesh(this.handleGeometry,this.handleMaterials[color]);h.position.set(...position);h.userData.handle=data;h.renderOrder=100;this.handles.add(h);};
    if(this.tool==='walls'&&this.selectedRoom){const room=this.selectedRoom;room.points.forEach((p,index)=>add([p.x,this.floor.elevation+.18,p.z],{kind:'vertex',roomId:room.id,index}));for(const [edge,p] of Object.entries(room.curves||{}))add([p.x,this.floor.elevation+.2,p.z],{kind:'curve',roomId:room.id,index:Number(edge)},1);const c=centroid(room.points);add([c.x,this.floor.elevation+this.floor.height,c.z],{kind:'height'},2);}
    if(this.tool==='roof') {const section=this.selectedRoofSection();if(section){const b=section.bounds,y=section.elevation;add([section.ridge.x,section.ridge.y,section.ridge.z],{kind:'roofRise'},2);add([section.ridge.x,section.ridge.y,section.ridge.z+.6],{kind:'ridge'},1);add([b.maxX,y,(b.minZ+b.maxZ)/2],{kind:'eave'},0);}}
  }
  setView(view) {
    this.cancelDrag();
    if(view==='walk'&&this.view!=='walk') {
      this.savedCamera={position:this.camera.position.clone(),target:this.orbit.target.clone()};
      const c=this.walkSpawn();this.walkPosition=new THREE.Vector3(c.x,this.floor.elevation,c.z);this.walkYaw=0;this.walkPitch=-.08;
    } else if(this.view==='walk'&&this.savedCamera){this.camera.position.copy(this.savedCamera.position);this.orbit.target.copy(this.savedCamera.target);}
    this.view=view;this.orbit.enabled=view==='orbit';this.ui.dataset.view=view;this.refreshVisibility();this.makeHandles();this.updateUI();this.drawPlan();
  }
  updateUI() {
    if(!this.ui)return;const q=s=>this.ui.querySelector(s);
    q('[data-field=style]').value=this.bp.style;q('[data-field=seed]').value=this.bp.seed;
    q('[data-field=floors]').value=this.bp.floors.filter(f=>!f.isAttic).length;q('[data-field=attic]').checked=this.bp.floors.some(f=>f.isAttic);
    q('[data-field=floor]').innerHTML=this.bp.floors.map(f=>'<option value="'+f.id+'">'+(f.isAttic?'Loteng':'Lantai '+(f.index+1))+'</option>').join('');q('[data-field=floor]').value=this.floorId;
    const options=this.home?.userData.roof.userData.sections||[],sections=this.bp.roof.sections;
    if(this.roofSection&&!options.some(s=>s.id===this.roofSection))this.roofSection=null;
    q('[data-field=roofSection]').innerHTML=options.length?options.map((s,i)=>'<option value="'+esc(s.roomId||'')+'">'+(s.roomId?'Bagian '+(i+1)+(s.exposed?' · sayap bawah':''):'Atap keseluruhan')+'</option>').join(''):'<option value="">Atap keseluruhan</option>';if(sections&&!this.roofSection)this.roofSection=options[0]?.roomId;q('[data-field=roofSection]').value=this.roofSection||'';
    const roof=this.roofParameters();q('[data-field=cutaway]').checked=this.cutaway;q('[data-field=roofRise]').value=roof.rise;q('[data-field=eave]').value=roof.overhang;q('[data-field=roofType]').value=roof.type||'gable';q('[data-act=roofSplit]').disabled=this.bp.floors.at(-1).rooms.some(r=>sections?.[r.id]);q('[data-act=roofMerge]').disabled=!sections;
    this.ui.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===this.view)));
    this.ui.querySelectorAll('[data-tool]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tool===this.tool)));
    q('[data-act=undo]').disabled=this.historyIndex===0;q('[data-act=redo]').disabled=this.historyIndex===this.history.length-1;
    q('[data-act=finish]').hidden=!this.pendingPoints.length;
    const item=this.selectedItem,room=this.selectedRoom;
    q('[data-selection]').textContent=item?Model.HOME_CATALOG[item.type].label:room?({living:'Ruang tamu',bedroom:'Kamar tidur',kitchen:'Dapur',bathroom:'Kamar mandi',hall:'Sirkulasi'}[room.type]||room.type):Model.HOME_STYLES[this.bp.style].label;
    const issues=Model.validateHomeBlueprint(this.bp,{obstacles:this.record.obstacles||[]}).issues.filter(i=>i.code==='placement');
    q('[data-properties]').innerHTML=(item?'<p>Snap ke '+esc(item.anchor?.kind||'lantai')+'</p><p>'+item.position.x.toFixed(2)+' m · '+item.position.z.toFixed(2)+' m</p>':room?'<label>Tinggi lantai<input data-field="roomHeight" type="number" min="2" max="4" step=".1" value="'+this.floor.height+'"></label><p>Tarik titik sudut atau kontrol lengkung. Titik emas mengubah tinggi.</p>':'<p>'+this.bp.floors.length+' tingkat · '+allItems(this.bp).length+' barang</p><p>Pilih barang atau ruangan untuk mengedit.</p>')+issues.slice(0,8).map(i=>'<button data-invalid-id="'+esc(i.elementId)+'">'+esc(Model.HOME_CATALOG[allItems(this.bp).find(item=>item.id===i.elementId)?.type]?.label||'Barang')+' perlu dipindah</button>').join('');
    if(room)q('[data-field=roomType]').value=room.type;
    q('[data-act=rotate]').disabled=!item;q('[data-act=delete]').disabled=!item&&!room;
    const errors=this.validation();q('[data-validation]').textContent=errors.length?errors.length+' masalah: '+String(errors[0].message||errors[0]):'Rancangan valid';q('[data-validation]').classList.toggle('is-error',errors.length>0);q('[data-act=apply]').disabled=errors.length>0||this.applying;
    q('[data-hint]').textContent=this.view==='walk'?'WASD berjalan · Shift lari · seret untuk melihat · Esc kembali':this.view==='plan'?'Pilih / tarik titik denah · gambar ruangan · klik Generate':this.tool==='roof'?'Tarik titik emas untuk tinggi, hijau untuk bubungan, merah untuk ujung atap':'Pilih / seret barang · klik kanan untuk pan · scroll untuk zoom';this.updateMarkers();
  }
  message(text,error=false) { const el=this.ui?.querySelector('[data-save]');if(el){el.textContent=text;el.classList.toggle('is-error',error);} }
  planTransform() {
    if(this.planDrag?.transform)return this.planDrag.transform;
    const b={minX:Math.min(...this.bp.plot.map(p=>p.x))-2,maxX:Math.max(...this.bp.plot.map(p=>p.x))+2,minZ:Math.min(...this.bp.plot.map(p=>p.z))-2,maxZ:Math.max(...this.bp.plot.map(p=>p.z))+2},r=this.planCanvas.getBoundingClientRect(),scale=Math.min(r.width/(b.maxX-b.minX),r.height/(b.maxZ-b.minZ));
    return {r,scale,cx:(b.minX+b.maxX)/2,cz:(b.minZ+b.maxZ)/2};
  }
  planPoint(e) { const {r,scale,cx,cz}=this.planTransform();return {x:snap((e.clientX-r.left-r.width/2)/scale+cx),z:snap((e.clientY-r.top-r.height/2)/scale+cz)}; }
  drawPlan() {
    if(!this.planCanvas||this.view!=='plan')return;const {r,scale,cx,cz}=this.planTransform(),canvas=this.planCanvas,dpr=Math.min(devicePixelRatio,2);if(!r.width||!r.height)return;canvas.width=r.width*dpr;canvas.height=r.height*dpr;const c=canvas.getContext('2d');c.scale(dpr,dpr);c.fillStyle='#f1eddf';c.fillRect(0,0,r.width,r.height);
    const pixel=p=>({x:r.width/2+(p.x-cx)*scale,y:r.height/2+(p.z-cz)*scale});
    const path=ps=>{c.beginPath();ps.forEach((p,i)=>{const q=pixel(p);i?c.lineTo(q.x,q.y):c.moveTo(q.x,q.y);});c.closePath();};
    c.strokeStyle='#e4ddcd';c.lineWidth=1;for(let x=Math.floor(cx-r.width/scale/2);x<cx+r.width/scale/2;x++){const p=pixel({x,z:cz});c.beginPath();c.moveTo(p.x,0);c.lineTo(p.x,r.height);c.stroke();}for(let z=Math.floor(cz-r.height/scale/2);z<cz+r.height/scale/2;z++){const p=pixel({x:cx,z});c.beginPath();c.moveTo(0,p.y);c.lineTo(r.width,p.y);c.stroke();}
    for(const obstacle of this.record.obstacles||[]){const ps=obstacle.points||obstacle.polygon;if(!ps?.length)continue;path(ps);c.fillStyle='#d9c1b6';c.fill();c.strokeStyle='#bb9889';c.stroke();}
    path(this.bp.plot);c.fillStyle='#d5ddc2';c.fill();c.strokeStyle='#738267';c.setLineDash([6,5]);c.lineWidth=2;c.stroke();c.setLineDash([]);
    for(const zone of this.bp.yard.zones){path(zone.points);c.fillStyle=zone.type==='path'?'#daccb4':'#aabc91';c.fill();}
    const colors={living:'#e6cba7',bedroom:'#c7d6cb',kitchen:'#ecdcae',bathroom:'#bbd0d5',hall:'#e9e0ce'};
    for(const room of this.floor.rooms){path(Model.sampleRoom(room));c.fillStyle=colors[room.type]||'#d6c7b4';c.fill();c.strokeStyle=this.roomId===room.id?'#a9533c':'#958371';c.lineWidth=this.roomId===room.id?3:2;c.stroke();}
    for(const opening of this.bp.openings.filter(o=>o.floorId===this.floorId)){const p=Model.openingTransform(this.bp,opening);if(!p)continue;const a=pixel({x:p.x-p.dx*opening.width/2,z:p.z-p.dz*opening.width/2}),b=pixel({x:p.x+p.dx*opening.width/2,z:p.z+p.dz*opening.width/2});c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.strokeStyle=opening.kind==='window'?'#76a7aa':'#f6f0e2';c.lineWidth=5;c.stroke();}
    for(const stair of this.bp.stairs.filter(s=>s.fromFloorId===this.floorId||s.toFloorId===this.floorId)){const p=pixel(stair);c.fillStyle='#d0c1a8';c.fillRect(p.x-stair.width*scale/2,p.y-stair.depth*scale/2,stair.width*scale,stair.depth*scale);c.strokeStyle='#9d8b70';c.lineWidth=1;for(let i=1;i<9;i++){const y=p.y-stair.depth*scale/2+i*stair.depth*scale/9;c.beginPath();c.moveTo(p.x-stair.width*scale/2,y);c.lineTo(p.x+stair.width*scale/2,y);c.stroke();}c.fillStyle='#655747';c.font='16px system-ui';c.textAlign='center';c.fillText(stair.fromFloorId===this.floorId?'↓':'↑',p.x,p.y+5);}
    for(const item of allItems(this.bp).filter(i=>i.floorId===this.floorId||i.floorId==='yard')){const spec=Model.HOME_CATALOG[item.type],p=pixel(item.position);if(!spec)continue;c.save();c.translate(p.x,p.y);c.rotate(-(item.rotation||0));c.fillStyle=item.id===this.selected?'#a45a42':'#a29075';c.fillRect(-spec.size[0]*scale/2,-spec.size[2]*scale/2,spec.size[0]*scale,spec.size[2]*scale);c.restore();}
    for(const room of this.floor.rooms){const p=pixel(centroid(room.points)),label=({living:'Ruang tamu',bedroom:'Kamar tidur',kitchen:'Dapur',bathroom:'Kamar mandi',hall:'Sirkulasi',study:'Ruang kerja',loft:'Loteng'}[room.type]||room.type);c.font='500 12px system-ui';c.textAlign='center';const w=c.measureText(label).width;c.fillStyle='#f8f4e9dd';c.fillRect(p.x-w/2-5,p.y-12,w+10,18);c.fillStyle='#655747';c.fillText(label,p.x,p.y);}
    if(this.placementPreview){const p=pixel(this.placementPreview),spec=Model.HOME_CATALOG[this.selectedItem?.type];if(spec){c.save();c.translate(p.x,p.y);c.rotate(-(this.selectedItem.rotation||0));c.strokeStyle='#c75137';c.lineWidth=3;c.strokeRect(-spec.size[0]*scale/2,-spec.size[2]*scale/2,spec.size[0]*scale,spec.size[2]*scale);c.restore();}}
    const handles=this.tool==='plot'?this.bp.plot:this.selectedRoom?.points||[];
    handles.forEach(p=>{const q=pixel(p);c.beginPath();c.arc(q.x,q.y,6,0,Math.PI*2);c.fillStyle='#faf7ee';c.fill();c.strokeStyle='#a9533c';c.lineWidth=2;c.stroke();});
    for(const [edge,p] of Object.entries(this.selectedRoom?.curves||{})){const q=pixel(p);c.beginPath();c.arc(q.x,q.y,5,0,Math.PI*2);c.fillStyle='#618b80';c.fill();}
    if(this.pendingPoints.length){path(this.pendingPoints);c.strokeStyle='#b2674b';c.stroke();this.pendingPoints.forEach(p=>{const q=pixel(p);c.fillRect(q.x-3,q.y-3,6,6);});}
    if(this.planDrag?.start&&this.planDrag?.end&&['rect','circle','zone'].includes(this.tool)){const a=pixel(this.planDrag.start),b=pixel(this.planDrag.end);c.strokeStyle='#b2674b';c.lineWidth=2;if(this.tool==='circle'){c.beginPath();c.ellipse((a.x+b.x)/2,(a.y+b.y)/2,Math.abs(b.x-a.x)/2,Math.abs(b.y-a.y)/2,0,0,Math.PI*2);c.stroke();}else c.strokeRect(a.x,a.y,b.x-a.x,b.y-a.y);}
    c.fillStyle='#827462';c.textAlign='left';c.font='11px system-ui';c.fillText('1 kotak = 1 meter · '+(this.floor.isAttic?'Loteng':'Lantai '+(this.floor.index+1)),20,r.height-20);
  }
  planDown(e) {
    if(e.button!==0)return;const transform=this.planTransform(),p=this.planPoint(e);this.planCanvas.setPointerCapture(e.pointerId);
    if(this.tool==='polygon'){const last=this.pendingPoints.at(-1);if(!last||Math.hypot(last.x-p.x,last.z-p.z)>.01)this.pendingPoints.push(p);this.updateUI();this.drawPlan();return;}
    const handles=this.tool==='plot'?this.bp.plot:this.selectedRoom?.points||[];
    let handle=handles.findIndex(v=>Math.hypot(v.x-p.x,v.z-p.z)<.35);
    let curve=-1;if(handle<0&&this.selectedRoom)curve=Object.entries(this.selectedRoom.curves||{}).find(([i,v])=>Math.hypot(v.x-p.x,v.z-p.z)<.35)?.[0]??-1;
    if(handle>=0||curve>=0){this.planDrag={kind:this.tool==='plot'?'plot':curve>=0?'curve':'vertex',index:Number(curve>=0?curve:handle),original:clone(this.bp),start:p,transform,pointerId:e.pointerId};return;}
    if(this.tool==='select') {
      const item=allItems(this.bp).filter(i=>i.floorId===this.floorId||i.floorId==='yard').reverse().find(i=>Model.pointInPolygon(p,Model.itemFootprint(i)));
      if(item){this.selected=item.id;this.roomId=null;this.planDrag={kind:'item',original:clone(this.bp),start:p,offset:{x:item.position.x-p.x,z:item.position.z-p.z},transform,pointerId:e.pointerId};}
      else {const room=this.floor.rooms.find(r=>Model.pointInPolygon(p,Model.sampleRoom(r)));this.roomId=room?.id||null;this.selected=null;this.planDrag=room?{kind:'room',original:clone(this.bp),start:p,transform,pointerId:e.pointerId}:null;}
      this.updateUI();this.drawPlan();return;
    }
    this.planDrag={kind:'draw',start:p,end:p,transform,pointerId:e.pointerId};
  }
  planMove(e) {
    if(!this.planDrag)return;const p=this.planPoint(e),drag=this.planDrag;drag.end=p;
    if(drag.kind==='item'){this.moveItem({x:p.x+drag.offset.x,z:p.z+drag.offset.z});this.drawPlan();return;}
    if(['vertex','curve','plot','room'].includes(drag.kind)){
      const next=clone(drag.original),room=next.floors.find(f=>f.id===this.floorId).rooms.find(r=>r.id===this.roomId);
      if(drag.kind==='plot')next.plot[drag.index]=p;
      else if(drag.kind==='vertex')this.moveVertex(next,room.id,drag.index,p);
      else if(drag.kind==='curve')room.curves[drag.index]=p;
      else {const dx=p.x-drag.start.x,dz=p.z-drag.start.z;room.points=room.points.map(v=>({x:v.x+dx,z:v.z+dz}));for(const [edge,v] of Object.entries(room.curves||{}))room.curves[edge]={x:v.x+dx,z:v.z+dz};}
      if(room)room.authored=true;this.bp=next;this.drawPlan();return;
    }
    this.drawPlan();
  }
  planUp() {
    const drag=this.planDrag;if(!drag)return;this.planDrag=null;this.placementPreview=null;this.invalidPreview.visible=false;if(this.planCanvas.hasPointerCapture(drag.pointerId))this.planCanvas.releasePointerCapture(drag.pointerId);
    if(drag.kind==='draw'){
      const a=drag.start,b=drag.end;if(Math.abs(a.x-b.x)<1.5||Math.abs(a.z-b.z)<1.5){this.drawPlan();return;}
      const minX=Math.min(a.x,b.x),maxX=Math.max(a.x,b.x),minZ=Math.min(a.z,b.z),maxZ=Math.max(a.z,b.z);
      const next=clone(this.bp);if(this.tool==='zone'){next.yard.zones.push({id:next.id+':zone:'+Date.now(),type:'garden',authored:true,points:[{x:minX,z:minZ},{x:maxX,z:minZ},{x:maxX,z:maxZ},{x:minX,z:maxZ}]});this.commit(next);return;}
      let points=[{x:minX,z:minZ},{x:maxX,z:minZ},{x:maxX,z:maxZ},{x:minX,z:maxZ}],curves;
      if(this.tool==='circle'){const cx=(minX+maxX)/2,cz=(minZ+maxZ)/2;points=[{x:cx,z:minZ},{x:maxX,z:cz},{x:cx,z:maxZ},{x:minX,z:cz}];curves={0:{x:maxX,z:minZ},1:{x:maxX,z:maxZ},2:{x:minX,z:maxZ},3:{x:minX,z:minZ}};}
      this.addRoom(next,points,curves);return;
    }
    if(JSON.stringify(this.bp)!==JSON.stringify(drag.original))this.commit(this.reconcile(this.bp));else this.drawPlan();
  }
  finishPolygon(){if(this.pendingPoints.length<3)return;const points=this.pendingPoints.slice();this.pendingPoints=[];this.addRoom(clone(this.bp),points);}
  addRoom(bp,points,curves){
    const id=bp.id+':room:manual:'+Date.now();bp.floors.find(f=>f.id===this.floorId).rooms.push({id,type:this.ui.querySelector('[data-field=roomType]').value,points,curves,authored:true,needsFurnishing:true});this.roomId=id;this.selected=null;this.tool='select';this.commit(this.reconcile(bp));
  }
  cast(e){const r=this.ctx.engine.renderer.domElement.getBoundingClientRect();this.pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);this.raycaster.setFromCamera(this.pointer,this.camera);}
  planePoint(e,y){this.cast(e);return this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),-y),new THREE.Vector3());}
  sceneDown(e){
    if(e.button!==0)return;
    if(this.view==='walk'){this.lookDrag={x:e.clientX,y:e.clientY};return;}
    if(this.view!=='orbit')return;this.cast(e);
    const handle=this.raycaster.intersectObjects(this.handles.children,false)[0];
    if(handle){const planeY=this.tool==='roof'?this.selectedRoofSection().elevation:this.floor.elevation;this.sceneDrag={...handle.object.userData.handle,original:clone(this.bp),startY:e.clientY,start:this.planePoint(e,planeY),planeY,point:handle.object.position.clone(),pointerId:e.pointerId};this.ctx.engine.renderer.domElement.setPointerCapture(e.pointerId);this.orbit.enabled=false;e.stopImmediatePropagation();return;}
    const hits=this.raycaster.intersectObject(this.home,true);let itemHit;
    let visibleHit;
    for(const hit of hits){let o=hit.object,visible=true;for(let ancestor=o;ancestor;ancestor=ancestor.parent)if(!ancestor.visible)visible=false;if(!visible)continue;visibleHit=hit;while(o&&!o.userData.itemId)o=o.parent;if(o?.userData.itemId)itemHit={id:o.userData.itemId,hit};break;}
    if(itemHit){this.selected=itemHit.id;this.roomId=null;const item=this.selectedItem,y=item.floorId==='yard'?0:this.bp.floors.find(f=>f.id===item.floorId).elevation,p=this.planePoint(e,y);this.sceneDrag={kind:'item',original:clone(this.bp),pointerId:e.pointerId,planeY:y,offset:p?{x:item.position.x-p.x,z:item.position.z-p.z}:{x:0,z:0}};this.ctx.engine.renderer.domElement.setPointerCapture(e.pointerId);this.orbit.enabled=false;e.stopImmediatePropagation();this.updateUI();}
    else if(visibleHit&&this.tool==='walls'){const room=Model.roomAt(this.bp,visibleHit.point.x,visibleHit.point.z,this.floorId);this.roomId=room?.id||null;this.selected=null;this.makeHandles();this.updateUI();}
  }
  sceneMove(e){
    if(this.view==='walk'&&this.lookDrag){this.walkYaw-=(e.clientX-this.lookDrag.x)*.005;this.walkPitch=Math.max(-1.1,Math.min(1.1,this.walkPitch-(e.clientY-this.lookDrag.y)*.005));this.lookDrag={x:e.clientX,y:e.clientY};return;}
    const drag=this.sceneDrag;if(!drag)return;
    const p=this.planePoint(e,drag.planeY??this.floor.elevation);if(!p)return;
    if(drag.kind==='item'){this.moveItem({x:p.x+drag.offset.x,z:p.z+drag.offset.z});return;}
    let next=clone(drag.original);const dy=(drag.startY-e.clientY)*.025,room=next.floors.find(f=>f.id===this.floorId).rooms.find(r=>r.id===drag.roomId);
    if(drag.kind==='vertex')this.moveVertex(next,room.id,drag.index,{x:snap(p.x),z:snap(p.z)});
    if(drag.kind==='curve'){room.curves[drag.index]={x:snap(p.x),z:snap(p.z)};room.authored=true;}
    if(drag.kind==='height'){const f=next.floors.find(f=>f.id===this.floorId),height=Math.max(2.2,Math.min(4,f.height+dy));next=Model.editHomeFloorHeight(drag.original,this.floorId,height);}
    const roof=['roofRise','ridge','eave'].includes(drag.kind)?this.editableRoof(next):next.roof,originalRoof=this.roofParameters(drag.original);
    if(drag.kind==='roofRise')roof.rise=Math.max(.3,Math.min(4,originalRoof.rise+dy));
    if(drag.kind==='ridge')roof.ridgeOffset=Math.max(-2,Math.min(2,(originalRoof.ridgeOffset||0)+p.x-drag.start.x));
    if(drag.kind==='eave')roof.overhang=Math.max(.1,Math.min(1.2,originalRoof.overhang+(p.x-drag.start.x)*.2));
    if(['roofRise','ridge','eave'].includes(drag.kind))roof.authored=next.roof.authored=true;
    this.bp=next;if(!this.rebuildTimer)this.rebuildTimer=setTimeout(()=>{this.rebuildTimer=null;this.rebuild();this.updateUI();},45);
  }
  moveItem(p){
    const item=this.selectedItem;if(!item)return;
    let y=item.floorId==='yard'?0:this.bp.floors.find(f=>f.id===item.floorId)?.elevation||0;
    const spec=Model.HOME_CATALOG[item.type];
    if(spec.surface==='wall')y=item.position.y;
    if(spec.surface==='surface'){
      const host=allItems(this.bp).find(i=>i.id!==item.id&&i.floorId===item.floorId&&['table','shelf','kitchen'].includes(i.type)&&Math.abs(p.x-i.position.x)<Model.HOME_CATALOG[i.type].size[0]/2&&Math.abs(p.z-i.position.z)<Model.HOME_CATALOG[i.type].size[2]/2);
      if(host)y=host.position.y+Model.HOME_CATALOG[host.type].size[1];
    }
    const result=Model.placeHomeItem(this.bp,item.id,{x:snap(p.x),y,z:snap(p.z),rotation:item.rotation},{obstacles:this.record.obstacles||[]});
    if(!result.ok){this.message(result.reason||'Posisi tidak valid',true);this.ui.dataset.invalid='true';this.placementPreview={x:snap(p.x),z:snap(p.z)};this.invalidPreview.position.set(snap(p.x),y,snap(p.z));this.invalidPreview.scale.set(...spec.size);this.invalidPreview.rotation.y=item.rotation||0;this.invalidPreview.visible=this.view==='orbit';return;}
    this.placementPreview=null;this.invalidPreview.visible=false;
    this.bp=result.blueprint;const updated=allItems(this.bp).find(i=>i.id===item.id),holder=this.home.userData.items.get(item.id);if(holder){holder.position.copy(updated.position);holder.rotation.y=updated.rotation||0;}this.sun.shadow.needsUpdate=true;this.ui.dataset.invalid='false';this.message('Snap · posisi valid');
  }
  sceneUp(){this.lookDrag=null;if(!this.sceneDrag)return;const drag=this.sceneDrag,id=drag.pointerId;this.sceneDrag=null;this.placementPreview=null;this.invalidPreview.visible=false;const canvas=this.ctx.engine.renderer.domElement;if(canvas.hasPointerCapture(id))canvas.releasePointerCapture(id);if(this.rebuildTimer){clearTimeout(this.rebuildTimer);this.rebuildTimer=null;}this.orbit.enabled=this.view==='orbit';if(JSON.stringify(this.bp)!==JSON.stringify(drag.original))this.commit(this.reconcile(this.bp));}
  cancelDrag(){const drag=this.planDrag||this.sceneDrag;this.lookDrag=null;this.planDrag=this.sceneDrag=null;this.placementPreview=null;if(this.invalidPreview)this.invalidPreview.visible=false;if(this.rebuildTimer){clearTimeout(this.rebuildTimer);this.rebuildTimer=null;}if(drag){for(const canvas of [this.planCanvas,this.ctx.engine.renderer.domElement])if(canvas?.hasPointerCapture(drag.pointerId))canvas.releasePointerCapture(drag.pointerId);if(drag.original){this.bp=drag.original;this.rebuild();}if(this.ui)this.ui.dataset.invalid='false';this.drawPlan();}if(this.orbit)this.orbit.enabled=this.view==='orbit';}
  key(e,down){
    if(e.target.closest?.('input,select,textarea'))return;
    if(down&&(e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.stopPropagation();this.stepHistory(e.shiftKey?1:-1);return;}
    if(down&&e.key==='Escape'){e.preventDefault();e.stopPropagation();this.cancelDrag();if(this.view==='walk')this.setView('orbit');else if(this.pendingPoints.length){this.pendingPoints=[];this.drawPlan();}return;}
    if(down&&e.key==='Enter'&&this.pendingPoints.length){e.preventDefault();this.finishPolygon();return;}
    down?this.keys.add(e.code):this.keys.delete(e.code);
    if(this.view==='walk'&&['KeyW','KeyA','KeyS','KeyD','Space'].includes(e.code)){e.preventDefault();e.stopPropagation();}
  }
  walkSurface(x,z,currentY){
    let y=0;
    for(const stair of this.bp.stairs){if(Math.abs(x-stair.x)<stair.width/2&&Math.abs(z-stair.z)<stair.depth/2+.3){const a=this.bp.floors.find(f=>f.id===stair.fromFloorId),b=this.bp.floors.find(f=>f.id===stair.toFloorId);const sy=a.elevation+Math.max(0,Math.min(1,(z-stair.z+stair.depth/2)/stair.depth))*(b.elevation-a.elevation);if(Math.abs(sy-currentY)<.65)return sy;}}
    const floor=this.bp.floors.filter(f=>Math.abs(f.elevation-currentY)<.55).find(f=>f.rooms.some(r=>Model.pointInPolygon({x,z},Model.sampleRoom(r))));
    if(floor)y=floor.elevation;else if(currentY>.6)return null;
    if(!Model.pointInPolygon({x,z},this.bp.plot))return null;
    const level=floor?.id;
    for(const wall of this.home.userData.walkWalls.filter(w=>w.floorId===level))if(segmentDistance({x,z},wall.a,wall.b)<.19&&!wall.openings.some(o=>Math.hypot(x-o.position.x,z-o.position.z)<o.width/2-.08))return null;
    for(const item of allItems(this.bp).filter(i=>i.floorId===(level||'yard'))){const spec=Model.HOME_CATALOG[item.type];if(!spec||spec.collision===false)continue;const dx=x-item.position.x,dz=z-item.position.z,c=Math.cos(item.rotation||0),s=Math.sin(item.rotation||0);if(Math.abs(dx*c-dz*s)<spec.size[0]/2+.13&&Math.abs(dx*s+dz*c)<spec.size[2]/2+.13)return null;}
    return y;
  }
  walkSpawn(){
    const rooms=this.floor.rooms.slice().sort((a,b)=>(a.type==='hall'?-1:0)-(b.type==='hall'?-1:0));
    for(const room of rooms){const points=Model.sampleRoom(room),c=centroid(points),candidates=[{x:c.x,z:Math.max(...points.map(p=>p.z))-.7},c,{x:c.x,z:Math.min(...points.map(p=>p.z))+.7}];for(let z=Math.min(...points.map(p=>p.z))+.3;z<Math.max(...points.map(p=>p.z));z+=.3)for(let x=Math.min(...points.map(p=>p.x))+.3;x<Math.max(...points.map(p=>p.x));x+=.3)candidates.push({x,z});for(const p of candidates)if(Model.pointInPolygon(p,points)&&!this.bp.stairs.some(s=>Math.abs(p.x-s.x)<s.width/2+.1&&Math.abs(p.z-s.z)<s.depth/2+.1)&&this.walkSurface(p.x,p.z,this.floor.elevation)===this.floor.elevation)return p;}
    return centroid(Model.sampleRoom(this.floor.rooms[0]));
  }
  update(dt){
    if(this.view==='orbit')this.orbit.update();
    if(this.view==='walk'){
      const forward=(this.keys.has('KeyW')?1:0)-(this.keys.has('KeyS')?1:0),side=(this.keys.has('KeyD')?1:0)-(this.keys.has('KeyA')?1:0),speed=this.keys.has('ShiftLeft')?4:2.2;
      const normal=Math.max(1,Math.hypot(forward,side)),distance=dt*speed/normal,totalX=(-Math.sin(this.walkYaw)*forward+Math.cos(this.walkYaw)*side)*distance,totalZ=(-Math.cos(this.walkYaw)*forward-Math.sin(this.walkYaw)*side)*distance,steps=Math.max(1,Math.ceil(Math.hypot(totalX,totalZ)/.08)),dx=totalX/steps,dz=totalZ/steps;
      for(let step=0;step<steps;step++){let y=this.walkSurface(this.walkPosition.x+dx,this.walkPosition.z+dz,this.walkPosition.y);
        if(y!==null){this.walkPosition.x+=dx;this.walkPosition.z+=dz;this.walkPosition.y=y;}else{y=this.walkSurface(this.walkPosition.x+dx,this.walkPosition.z,this.walkPosition.y);if(y!==null){this.walkPosition.x+=dx;this.walkPosition.y=y;}y=this.walkSurface(this.walkPosition.x,this.walkPosition.z+dz,this.walkPosition.y);if(y!==null){this.walkPosition.z+=dz;this.walkPosition.y=y;}}
      }
      const landed=this.bp.floors.find(f=>Math.abs(f.elevation-this.walkPosition.y)<.06&&f.rooms.some(r=>Model.pointInPolygon(this.walkPosition,Model.sampleRoom(r))));if(landed&&landed.id!==this.floorId){this.floorId=landed.id;this.roomId=this.selected=null;this.updateUI();}
      this.camera.position.set(this.walkPosition.x,this.walkPosition.y+1.6,this.walkPosition.z);this.camera.rotation.set(this.walkPitch,this.walkYaw,0,'YXZ');
    }
  }
  render(){if(this.view==='plan'&&!this.needsRender)return;this.ctx.engine.draw(this.scene,this.camera);this.needsRender=false;}
  resize(w,h){if(this.camera){this.camera.aspect=w/h;this.camera.updateProjectionMatrix();}this.needsRender=true;if(this.planCanvas)this.drawPlan();}
  depart(){this.cancelDrag();this.saveDraft();return {cover:'fade'};}
  exit(){this.cancelDrag();this.saveDraft();this.abort?.abort();clearTimeout(this.rebuildTimer);this.orbit?.dispose();this.markers?.forEach(m=>{m.geometry.dispose();m.material.dispose();});if(this.home)disposeHomeGroup(this.home);this.handleGeometry?.dispose();this.handleMaterials?.forEach(m=>m.dispose());this.invalidPreview?.geometry.dispose();this.invalidPreview?.material.dispose();this.sun?.shadow.map?.dispose();this.ui?.remove();this.ui=null;this.keys.clear();}
}
