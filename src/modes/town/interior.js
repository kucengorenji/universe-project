import * as THREE from 'three';
import { mulberry32 } from '../../map/mapGenerator.js';
import { createToonMaterial } from '../../render/assetLibrary.js';
import { Colliders } from './colliders.js';
import { makePerson, animatePerson, disposePerson } from './peopleRig.js';
import { generateInteriorLayout, measureFurnitureBounds } from './interiorLayout.js';
import { seedFor } from '../../world/identity.js';
import { assignInteractionIds, captureInterior, restoreInterior } from '../../world/interiorState.js';

// Inside a building: a room (or a few, split by half walls) generated from the
// building's type and seed, furnished from furniture.glb, textured from the
// interior atlas, seen as a dollhouse (the walls between camera and room hide).
// Every piece of furniture that can do something is an interactable.
//
// Local frame: room centred on the origin, the entrance in the +Z wall.

const WALL_H = 2.8;
const ATLAS = {
  wood_floor: 0, parquet: 1, kitchen_tiles: 2, carpet: 3, wallpaper_stripes: 4, wallpaper_pattern: 5, plaster: 6, brick: 7,
  stone: 8, wood_panel: 9, marble: 10, concrete: 11, bath_tiles: 12, rug: 13, ceiling: 14, fabric: 15
};

/** Which room a building opens into. */
export const ENTERABLE = {
  f_house_small: { kind: 'cottage', label: 'Masuk rumah' },
  f_house: { kind: 'house', label: 'Masuk rumah' },
  f_house_tall: { kind: 'house', label: 'Masuk rumah' },
  f_townhouse: { kind: 'house', label: 'Masuk rumah' },
  f_tavern: { kind: 'tavern', label: 'Masuk kedai' },
  f_shop: { kind: 'shop', label: 'Masuk toko' },
  m_house: { kind: 'house', label: 'Masuk rumah' },
  m_shop: { kind: 'shop', label: 'Masuk toko' },
  m_apartment: { kind: 'apartment', label: 'Masuk apartemen' },
  m_office: { kind: 'office', label: 'Masuk kantor' }
};

const SIZES = { cottage: [7, 6], house: [10, 8], tavern: [12, 9], shop: [9, 7], apartment: [10, 8], office: [12, 10] };

/** Atlas tile sampled with mirrored repeat (seams disappear), scale = metres per repeat. */
function atlasMaterial(tex, tile, scale, { tint = 0xffffff, side = THREE.FrontSide } = {}) {
  const m = createToonMaterial({ color: tint, side });
  const col = tile % 4;
  const row = Math.floor(tile / 4);
  const uni = { uAtlas: { value: tex }, uTile: { value: new THREE.Vector2(col / 4, 1 - (row + 1) / 4) }, uScale: { value: scale } };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uni);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 uvm;\nvarying vec2 vUvm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvUvm = uvm;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uAtlas;\nuniform vec2 uTile;\nuniform float uScale;\nvarying vec2 vUvm;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec2 q = vUvm / uScale;
        vec2 m = abs(fract(q * 0.5) * 2.0 - 1.0); // mirrored repeat
        vec2 uv = uTile + (0.01 + m * 0.98) * 0.25;
        diffuseColor.rgb *= texture2D(uAtlas, uv).rgb;`
      );
  };
  m.customProgramCacheKey = () => `atlas-${tile}`;
  return m;
}

/** Axis-aligned slab (x0..x1, y0..y1, z0..z1) with metre UVs on every face (attribute uvm). */
function slab(x0, x1, y0, y1, z0, z1) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const pos = g.attributes.position;
  const nrm = g.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const nx = Math.abs(nrm.getX(i));
    const ny = Math.abs(nrm.getY(i));
    if (ny > 0.5) uv.set([x, z], i * 2);
    else if (nx > 0.5) uv.set([z, y], i * 2);
    else uv.set([x, y], i * 2);
  }
  g.setAttribute('uvm', new THREE.BufferAttribute(uv, 2));
  return g;
}

export class Interior {
  constructor({ building, pack, atlas, character, modern, seed, night, shadows, state = null, floor = 0, layoutVersion = 2 }) {
    this.building = building;
    this.info = ENTERABLE[building.asset];
    this.kind = this.info.kind;
    this.modern = modern;
    this.pack = pack || {};
    this.rng = mulberry32(seed);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x14161c);
    this.disposables = [];
    this.interactables = [];
    this.rects = [];
    this.items = [];
    this.lamps = [];
    this.material = createToonMaterial({ vertexColors: true });
    this.disposables.push(this.material);
    this.floor = floor;
    this.layoutVersion = layoutVersion;
    if (layoutVersion === 2) {
      const bounds = measureFurnitureBounds(this.pack);
      this.blueprint=generateInteriorLayout({building,kind:this.kind,seed,floor,bounds});
    }
    const [W, D] = this.blueprint ? [this.blueprint.W,this.blueprint.D] : SIZES[this.kind];
    this.W = W;
    this.D = D;
    this.door = { x: this.blueprint?.doorX || 0, z: D / 2 - 0.3 };
    this.spawn = this.blueprint?.spawn || { x: 0, z: D / 2 - 1.3, yaw: Math.PI };
    this.buildRoom(atlas, night);
    if(this.blueprint)this.buildPartitionsAndStairs();
    this.furnish();
    assignInteractionIds(this.interactables);
    this.colliders = new Colliders(this.rects.map((r) => ({ type: 'box', ...r })));
    this.setupLights(night);
    this.residentSeed=seedFor(seed,'resident');
    if (character && (!this.blueprint || (floor===0 && this.residentSeed%3!==0))) this.addResident(character, shadows);
    restoreInterior(this, state);
  }

  snapshot() { return captureInterior(this); }

  track(o) {
    this.disposables.push(o);
    return o;
  }

  // -------------------------------------------------------------- room shell

  buildRoom(atlas, night) {
    const { W, D } = this;
    const fantasy = !this.modern;
    const floorTile = this.kind === 'tavern' ? ATLAS.wood_floor : this.kind === 'office' ? ATLAS.carpet : this.kind === 'shop' ? (fantasy ? ATLAS.wood_floor : ATLAS.marble) : fantasy ? ATLAS.wood_floor : ATLAS.parquet;
    const wallTile = fantasy ? (this.kind === 'tavern' ? ATLAS.stone : this.rng() < 0.5 ? ATLAS.plaster : ATLAS.wood_panel) : this.kind === 'office' ? ATLAS.concrete : [ATLAS.wallpaper_stripes, ATLAS.wallpaper_pattern, ATLAS.plaster][Math.floor(this.rng() * 3)];
    const floorMat = this.track(atlasMaterial(atlas, floorTile, 2.5));
    const wallMat = this.track(atlasMaterial(atlas, wallTile, 2));
    const trimMat = this.track(atlasMaterial(atlas, fantasy ? ATLAS.wood_panel : ATLAS.plaster, 1.5, { tint: 0xcfc3ad }));
    const floor = new THREE.Mesh(this.track(slab(-W / 2, W / 2, -0.1, 0, -D / 2, D / 2)), floorMat);
    floor.receiveShadow = true;
    this.scene.add(floor);
    // Walls: +Z wall has the doorway; each wall remembers its outward normal (for dollhouse hiding)
    this.walls = [];
    const t = 0.18;
    const wall = (geo, nx, nz) => {
      const m = new THREE.Mesh(this.track(geo), wallMat);
      m.userData.normal = new THREE.Vector2(nx, nz);
      this.scene.add(m);
      this.walls.push(m);
      // Skirting board
      return m;
    };
    wall(slab(-W / 2 - t, W / 2 + t, 0, WALL_H, -D / 2 - t, -D / 2), 0, -1);
    wall(slab(-W / 2 - t, -W / 2, 0, WALL_H, -D / 2, D / 2), -1, 0);
    wall(slab(W / 2, W / 2 + t, 0, WALL_H, -D / 2, D / 2), 1, 0);
    const dw = 1.2, dx = this.door.x;
    if(this.floor===0){
      wall(slab(-W / 2 - t, dx - dw / 2, 0, WALL_H, D / 2, D / 2 + t), 0, 1);
      wall(slab(dx + dw / 2, W / 2 + t, 0, WALL_H, D / 2, D / 2 + t), 0, 1);
      wall(slab(dx - dw / 2, dx + dw / 2, 2.25, WALL_H, D / 2, D / 2 + t), 0, 1);
    } else wall(slab(-W/2-t,W/2+t,0,WALL_H,D/2,D/2+t),0,1);
    this.rects.push({ x: 0, z: -D / 2 - 0.2, hw: W / 2 + 1, hd: 0.25, yaw: 0 }, { x: -W / 2 - 0.2, z: 0, hw: 0.25, hd: D / 2 + 1, yaw: 0 }, { x: W / 2 + 0.2, z: 0, hw: 0.25, hd: D / 2 + 1, yaw: 0 });
    if(this.floor===0)this.rects.push({x:(-W/2+dx-dw/2)/2,z:D/2+.2,hw:(dx-dw/2+W/2)/2,hd:.25,yaw:0},
      {x:(W/2+dx+dw/2)/2,z:D/2+.2,hw:(W/2-dx-dw/2)/2,hd:.25,yaw:0});
    else this.rects.push({x:0,z:D/2+.2,hw:W/2+t,hd:.25,yaw:0});
    // Outside light through the doorway and windows (sky colour by time of day)
    const skyCol = new THREE.Color(night > 0.5 ? 0x1b2a48 : 0xcfe4f4);
    this.windowMat = this.track(new THREE.MeshBasicMaterial({ color: skyCol }));
    // Panes hang on their wall, so they hide with it in the dollhouse view
    const [back, left, right, frontL] = this.walls;
    this.panes = [];
    const pane = (wallMesh, w, h, x, y, z, ry) => {
      const g = this.track(new THREE.PlaneGeometry(w, h));
      const m = new THREE.Mesh(g, this.windowMat);
      m.position.set(x, y, z);
      m.rotation.y = ry;
      wallMesh.add(m);
      this.panes.push({ mesh: m, x, z });
    };
    if(this.floor===0)pane(frontL, dw, 2.25, dx, 1.125, D / 2 + t + 0.01, Math.PI);
    else for(const x of [-W/3,W/3])pane(frontL,1.2,1.2,x,1.6,D/2-.01,Math.PI);
    for (const x of [-W / 3, W / 3]) pane(back, 1.2, 1.2, x, 1.6, -D / 2 + 0.01, 0);
    for (const z of [-D / 5, D / 5]) {
      pane(left, 1.1, 1.2, -W / 2 + 0.01, 1.6, z, Math.PI / 2);
      pane(right, 1.1, 1.2, W / 2 - 0.01, 1.6, z, -Math.PI / 2);
    }
    // Door frame
    if(this.floor===0){
      const frame = this.track(slab(dx - dw / 2 - 0.1, dx + dw / 2 + 0.1, 2.25, 2.4, D / 2 - 0.05, D / 2 + t + 0.05));
      this.walls[5].add(new THREE.Mesh(frame, trimMat));
    }
    this.doorX = dx;
  }

  buildPartitionsAndStairs() {
    const plan=this.blueprint;
    for(const p of plan.partitions)this.partition(p.x-p.hw,p.x+p.hw,p.z-p.hd,p.z+p.hd);
    if(plan.floors<2)return;
    const x=plan.W/2-.65,z=-plan.D/2+.15;
    const material=this.track(createToonMaterial({color:this.modern?0xb3aca1:0x8e633e}));
    if(this.floor+1<plan.floors){
      for(let i=0;i<14;i++){
        const step=new THREE.Mesh(this.track(slab(x-.55,x+.55,0,(14-i)*.2,z+i*.185,z+(i+1)*.185)),material);
        this.scene.add(step);
      }
    } else {
      this.scene.add(new THREE.Mesh(this.track(slab(x-.55,x+.55,.005,.015,z,z+2.6)),this.track(new THREE.MeshBasicMaterial({color:0x292c32}))));
    }
    this.rects.push({x,z:z+1.3,hw:.55,hd:1.3,yaw:0});
  }

  /** Brick up the windows behind a tall piece standing against a wall. */
  closeWindows(x, z, r) {
    for (const p of this.panes) if (Math.hypot(p.x - x, p.z - z) < r) p.mesh.visible = false;
  }

  /** Half-height partition (keeps the dollhouse view open). */
  partition(x0, x1, z0, z1) {
    const m = new THREE.Mesh(this.track(slab(x0, x1, 0, 1.15, z0, z1)), this.walls[0].material);
    this.scene.add(m);
    this.rects.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, hw: (x1 - x0) / 2, hd: (z1 - z0) / 2, yaw: 0 });
  }

  // -------------------------------------------------------------- furniture

  /** Place a furniture asset (front facing yaw direction; yaw = three rotation.y). */
  put(asset, x, z, yaw = 0, { variant = 0, collide = true, y = 0 } = {}) {
    const lods = this.pack[`${asset}_v${variant}`] || this.pack[`${asset}_v0`] || this.pack[asset];
    if (!lods) return null;
    const geo = lods[0] || lods[1];
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.position.set(x, y, z);
    mesh.rotation.y = yaw;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    if (collide) {
      if (!geo.boundingBox) geo.computeBoundingBox();
      const b = geo.boundingBox;
      const cx = (b.min.x + b.max.x) / 2;
      const cz = (b.min.z + b.max.z) / 2;
      // Box in world: rotate the centre offset, layout yaw = -rotation.y
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      this.rects.push({ x: x + cx * c + cz * s, z: z - cx * s + cz * c, hw: (b.max.x - b.min.x) / 2, hd: (b.max.z - b.min.z) / 2, yaw: -yaw });
    }
    return mesh;
  }

  /** Point in front of a piece of furniture (local offset forward = +Z of the piece). */
  front(x, z, yaw, d) {
    return { x: x + Math.sin(yaw) * d, z: z + Math.cos(yaw) * d };
  }

  seat(asset, x, z, yaw, opts = {}) {
    const m = this.put(asset, x, z, yaw, opts);
    if (!m) return;
    const f = this.front(x, z, yaw, 0.15);
    this.interactables.push({ kind: 'seat', x: f.x, z: f.z, reach: 1.5, label: () => 'Duduk', seat: { x: f.x, z: f.z, yaw, lift: 0 } });
    return m;
  }

  furnish() {
    const { W, D, rng } = this;
    const fantasy = !this.modern;
    const k = this.kind;
    const back = -D / 2 + 0.45;
    const surface = (x, z, h, r = 0.6) => this.interactables.push({ kind: 'surface', x, z, h, reach: r + 0.9, label: () => null });
    const item = (asset, x, y, z, variant = 0) => {
      const m = this.put(asset, x, z, rng() * 6, { variant, collide: false, y });
      if (!m) return;
      const it = { kind: 'item', asset, variant, mesh: m, x, z, reach: 1.3, label: () => `Ambil ${ITEM_NAMES[asset] || 'barang'}` };
      this.items.push(it);
      this.interactables.push(it);
    };
    const lamp = (asset, x, z, y = 0) => {
      const m = this.put(asset, x, z, 0, { collide: asset === 'fu_lamp_floor', y });
      if (!m) return;
      const light = new THREE.PointLight(0xffd79a, 0, 7, 1.5);
      light.position.set(x, y + (asset === 'fu_lamp_floor' ? 1.5 : 0.45), z);
      this.scene.add(light);
      const glow = new THREE.Mesh(this.track(new THREE.SphereGeometry(asset === 'fu_lamp_floor' ? 0.16 : 0.1, 12, 8)), this.track(new THREE.MeshBasicMaterial({ color: 0xffe6b0, transparent: true, opacity: 0 })));
      glow.position.copy(light.position);
      this.scene.add(glow);
      const l = { kind: 'light', x, z, reach: 1.4, light, glow, on: false, label: () => (l.on ? 'Matikan lampu' : 'Nyalakan lampu') };
      this.lamps.push(l);
      this.interactables.push(l);
    };
    const hinged = (body, doorAsset, x, z, yaw, hingeX, frontZ, doorW, label, event) => {
      this.put(body, x, z, yaw);
      const make = (hx, mirror) => {
        const lods = this.pack[doorAsset];
        if (!lods) return null;
        const holder = new THREE.Group();
        holder.position.set(hx, 0, frontZ);
        const mesh = new THREE.Mesh(lods[0] || lods[1], this.material);
        if (mirror) mesh.scale.x = -1;
        holder.add(mesh);
        const outer = new THREE.Group();
        outer.position.set(x, 0, z);
        outer.rotation.y = yaw;
        outer.add(holder);
        this.scene.add(outer);
        return { holder, sign: mirror ? 1 : -1 };
      };
      const leaves = doorW > 0.8 ? [make(-hingeX, false), make(hingeX, true)] : [make(-hingeX, false)];
      const f = this.front(x, z, yaw, 0.8);
      const d = { kind: 'door', x: f.x, z: f.z, reach: 1.5, leaves: leaves.filter(Boolean), open: 0, target: 0, event, label: () => (d.target ? `Tutup ${label}` : `Buka ${label}`) };
      this.interactables.push(d);
    };
    const tv = (x, z, yaw) => {
      this.put('fu_tv', x, z, yaw);
      const lods = this.pack.fu_tv_screen;
      if (!lods) return;
      const mat = this.track(new THREE.MeshBasicMaterial({ color: 0x0c1016 }));
      const screen = new THREE.Mesh(lods[0], mat);
      screen.position.set(x, 0, z);
      screen.rotation.y = yaw;
      this.scene.add(screen);
      const f = this.front(x, z, yaw, 1.2);
      const t = { kind: 'media', x: f.x, z: f.z, reach: 1.8, mat, on: false, label: () => (t.on ? 'Matikan TV' : 'Nyalakan TV') };
      this.interactables.push(t);
      this.tvs = [...(this.tvs || []), t];
    };
    const radio = (x, y, z) => {
      this.put('fu_radio', x, z, 0, { collide: false, y });
      const r = { kind: 'media', radio: true, x, z, reach: 1.3, on: false, label: () => (r.on ? 'Matikan radio' : 'Nyalakan radio') };
      this.interactables.push(r);
    };
    const fireplace = (x, z, yaw) => {
      this.put('fu_fireplace', x, z, yaw);
      const fire = this.put('fu_fire', x, z, yaw, { collide: false });
      if (fire) fire.visible = false;
      const light = new THREE.PointLight(0xff9a4a, 0, 8, 1.6);
      const f = this.front(x, z, yaw, 0.2);
      light.position.set(f.x, 0.5, f.z);
      this.scene.add(light);
      const p = this.front(x, z, yaw, 1.1);
      const fp = { kind: 'fire', x: p.x, z: p.z, reach: 1.6, fire, light, on: false, label: () => (fp.on ? 'Padamkan perapian' : 'Nyalakan perapian') };
      this.interactables.push(fp);
      this.fires = [...(this.fires || []), fp];
    };
    const bed = (x, z, yaw) => {
      this.put('fu_bed', x, z, yaw, { variant: Math.floor(rng() * 2) });
      const side = this.front(x, z, yaw + Math.PI / 2, 1.2);
      this.interactables.push({ kind: 'bed', x: side.x, z: side.z, reach: 1.7, label: () => 'Tidur', bed: { x, z, yaw } });
    };
    const table = (x, z, yaw, chairs = 2) => {
      this.put('fu_table', x, z, yaw, { variant: Math.floor(rng() * 2) });
      surface(x, z, 0.77, 0.8);
      const offs = chairs >= 4 ? [[-0.4, -0.75], [0.4, -0.75], [-0.4, 0.75], [0.4, 0.75]] : [[0, -0.75], [0, 0.75]];
      offs.slice(0, chairs).forEach(([ox, oz]) => {
        const c = Math.cos(yaw);
        const s = Math.sin(yaw);
        this.seat('fu_chair', x + ox * c + oz * s, z - ox * s + oz * c, yaw + (oz < 0 ? 0 : Math.PI), { variant: fantasy ? 0 : 1 });
      });
      return { x, z };
    };

    if (this.blueprint) {
      for (const node of this.blueprint.furniture) {
        const {asset,x,z,yaw,variant,kind}=node;
        const start=this.interactables.length;
        if(kind==='bed')bed(x,z,yaw);
        else if(kind==='seat')this.seat(asset,x,z,yaw,{variant});
        else if(kind==='light')lamp(asset,x,z);
        else if(kind==='cabinet')hinged(asset,'fu_wardrobe_door',x,z,yaw,.6,.27,1.2,'lemari','open');
        else {
          this.put(asset,x,z,yaw,{variant});
          if(kind==='surface'){
            const h={fu_counter:.93,fu_desk:.76,fu_coffee_table:.43,fu_table:.77}[asset]||.77;
            surface(x,z,h,.55);
            item('it_apple',x-.12,h+.015,z,0);
            item('it_book',x+.17,h+.015,z+.08,variant);
            if(this.modern)radio(x+.25,h+.02,z-.15);
          }
        }
        // Use the exact approach points validated by the floor planner.
        for(const it of this.interactables.slice(start)) {
          if(it.kind==='surface'){it.placementX=it.x;it.placementZ=it.z;}
          if(it.kind!=='item') {it.x=node.approach.x;it.z=node.approach.z;it.reach=Math.max(it.reach,1.3);}
        }
        const seat=this.interactables.slice(start).find(it=>it.kind==='seat');
        if(seat && !this.residentSpot)this.residentSpot={seat:true,...seat.seat};
      }
      for(const stair of this.blueprint.stairs)this.interactables.push({kind:'stairs',...stair,reach:.8,label:()=>this.holding?'Taruh barang sebelum memakai tangga':`${stair.target>this.floor?'Naik':'Turun'} ke lantai ${stair.target+1}`});
      if(this.floor===0)this.interactables.push({kind:'exit',x:this.door.x,z:this.door.z,reach:1.1,label:()=> 'Keluar'});
      return;
    }

    if (k === 'cottage' || k === 'house' || k === 'apartment') {
      const big = k !== 'cottage';
      // Bedroom corner (left back)
      bed(-W / 2 + 1.2, back + 0.6, 0);
      hinged('fu_wardrobe', 'fu_wardrobe_door', -W / 2 + 0.4, -D / 2 + 3.2, Math.PI / 2, 0.6, 0.27, 1.2, 'lemari', 'open');
      this.put('fu_rug', -W / 2 + 1.3, back + 2.2, 0, { variant: 0, collide: false });
      // Living (right)
      const lx = big ? W / 2 - 2.6 : W / 2 - 2.0;
      this.seat('fu_sofa', lx, back + 0.5, 0, { variant: Math.floor(rng() * 3) });
      this.put('fu_coffee_table', lx, back + 1.6, 0);
      surface(lx, back + 1.6, 0.43, 0.5);
      this.put('fu_rug', lx, back + 1.5, 0, { variant: 1, collide: false });
      if (fantasy) {
        // Hearth against the right wall, the armchair turned towards the room
        fireplace(W / 2 - 0.28, back + 1.0, -Math.PI / 2);
        this.closeWindows(W / 2, back + 1.0, 1.4);
        this.seat('fu_armchair', lx - 1.3, back + 1.7, Math.PI / 2, { variant: Math.floor(rng() * 2) });
      } else {
        tv(lx, back + 3.1, Math.PI);
        this.seat('fu_armchair', lx + (big ? 1.7 : 1.3), back + 1.7, -Math.PI / 2, { variant: Math.floor(rng() * 2) });
      }
      lamp('fu_lamp_floor', lx - 1.4, back + 0.35);
      item('it_book', lx - 0.2, 0.44, back + 1.6, Math.floor(rng() * 3));
      item('it_cup', lx + 0.25, 0.44, back + 1.55);
      if (big) {
        // Kitchen along the front-left, with a dining table
        this.partition(-W / 2, -W / 2 + 3.4, 0.2, 0.35);
        this.put('fu_counter', -W / 2 + 1.1, D / 2 - 1.2, Math.PI / 2 + Math.PI, { variant: fantasy ? 1 : 0 });
        surface(-W / 2 + 0.6, D / 2 - 1.2, 0.93, 0.9);
        if (!fantasy) hinged('fu_fridge', 'fu_fridge_door', -W / 2 + 0.45, D / 2 - 2.8, Math.PI / 2, 0.33, 0.35, 0.66, 'kulkas', 'open');
        this.put('fu_stove', -W / 2 + 0.45, D / 2 - 3.6 + (fantasy ? 0.8 : 0), Math.PI / 2);
        const t = table(-W / 2 + 2.6, 1.7, 0, 2);
        item('it_apple', t.x - 0.2, 0.78, t.z);
        item('it_apple', t.x + 0.15, 0.78, t.z + 0.1);
        if (fantasy) item('it_candle', t.x, 0.78, t.z - 0.15);
        else radio(-W / 2 + 0.6, 0.93, D / 2 - 1.8);
        lamp('fu_lamp_table', -W / 2 + 0.6, D / 2 - 0.7, 0.93);
      } else {
        const t = table(W / 2 - 1.6, D / 2 - 2.0, Math.PI / 2, 2);
        item('it_apple', t.x, 0.78, t.z - 0.2);
        item('it_apple', t.x + 0.1, 0.78, t.z + 0.15);
        if (fantasy) item('it_candle', t.x, 0.78, t.z + 0.3);
        this.put('fu_counter', -W / 2 + 1.1, D / 2 - 0.8, Math.PI, { variant: 1 });
        surface(-W / 2 + 1.1, D / 2 - 0.8, 0.93, 0.9);
      }
      const shelfZ = fantasy ? 0.35 : -0.2;
      this.put('fu_bookshelf', W / 2 - 0.3, shelfZ, -Math.PI / 2, { variant: Math.floor(rng() * 2) });
      item('it_book', W / 2 - 0.35, 1.05, shelfZ + 0.3, 1);
      this.put('fu_plant', W / 2 - 0.5, D / 2 - 0.6, 0, { variant: 0 });
      this.residentSpot = { seat: true, x: lx, z: back + 0.65, yaw: 0 };
    } else if (k === 'tavern') {
      fireplace(0, back + 0.1, 0);
      this.put('fu_counter', -W / 2 + 1.6, 0, Math.PI / 2, { variant: 1 });
      this.put('fu_counter', -W / 2 + 1.6, 1.9, Math.PI / 2, { variant: 1 });
      surface(-W / 2 + 1.4, 1, 0.93, 1.6);
      for (const [x, z] of [[1.5, -1.5], [4, -1.5], [1.5, 1.6], [4, 1.6], [-1.8, -1.6]]) {
        const t = table(x, z, 0, 4);
        item(this.rng() < 0.5 ? 'it_cup' : 'it_candle', t.x + 0.2, 0.78, t.z);
      }
      item('it_apple', -W / 2 + 1.4, 0.94, -0.3);
      this.put('fu_bookshelf', W / 2 - 0.3, -D / 2 + 1.5, -Math.PI / 2, { variant: 1 });
      lamp('fu_lamp_floor', W / 2 - 0.6, D / 2 - 0.8);
      this.residentSpot = { seat: false, x: -W / 2 + 0.7, z: 0.9, yaw: Math.PI / 2 };
    } else if (k === 'shop') {
      this.put('fu_counter', 0, back + 1.4, 0, { variant: fantasy ? 1 : 0 });
      surface(0, back + 1.4, 0.93, 1.1);
      for (const x of [-W / 2 + 0.3, W / 2 - 0.3]) {
        for (const z of [-1.5, 0.6]) this.put('fu_bookshelf', x, z, x < 0 ? Math.PI / 2 : -Math.PI / 2, { variant: Math.floor(this.rng() * 2) });
      }
      item('it_apple', -0.4, 0.94, back + 1.4);
      item('it_apple', -0.2, 0.94, back + 1.35);
      item('it_book', 0.3, 0.94, back + 1.45, 2);
      if (!fantasy) hinged('fu_fridge', 'fu_fridge_door', W / 2 - 1.4, back, 0, 0.33, 0.35, 0.66, 'lemari pendingin', 'open');
      else radio(0.7, 0.93, back + 1.4);
      this.put('fu_plant', -W / 2 + 0.6, D / 2 - 0.6, 0, { variant: 1 });
      this.put('fu_rug', 0, 1.2, 0, { variant: 0, collide: false });
      lamp('fu_lamp_floor', -W / 2 + 0.6, back + 0.3);
      this.residentSpot = { seat: false, x: 0, z: back + 0.5, yaw: 0 };
    } else {
      // Office: rows of desks, a meeting table, a pantry corner
      for (let r = 0; r < 2; r++) {
        for (let c = 0; c < 3; c++) {
          const x = -W / 2 + 2.2 + c * 2.6;
          const z = -D / 2 + 1.8 + r * 2.6;
          this.put('fu_desk', x, z, 0);
          surface(x - 0.2, z, 0.76, 0.6);
          this.seat('fu_chair', x - 0.1, z + 0.7, Math.PI, { variant: 1 });
          if (this.rng() < 0.5) item('it_cup', x + 0.4, 0.77, z - 0.1);
        }
      }
      const t = table(W / 2 - 2.0, 1.6, Math.PI / 2, 4);
      item('it_book', t.x, 0.78, t.z, 1);
      this.put('fu_counter', W / 2 - 1.2, D / 2 - 0.8, Math.PI, { variant: 0 });
      surface(W / 2 - 1.2, D / 2 - 0.8, 0.93, 0.9);
      hinged('fu_fridge', 'fu_fridge_door', W / 2 - 0.45, D / 2 - 2.3, -Math.PI / 2, 0.33, 0.35, 0.66, 'kulkas', 'open');
      item('it_apple', W / 2 - 1.4, 0.94, D / 2 - 0.8);
      tv(0, -D / 2 + 0.4, 0);
      this.put('fu_plant', -W / 2 + 0.5, D / 2 - 0.6, 0);
      this.put('fu_plant', W / 2 - 0.5, -D / 2 + 0.5, 0, { variant: 1 });
      lamp('fu_lamp_floor', -W / 2 + 0.5, -D / 2 + 0.5);
      this.residentSpot = { seat: true, x: -W / 2 + 2.1, z: -D / 2 + 2.55, yaw: Math.PI };
    }
    this.interactables.push({ kind: 'exit', x: this.door.x, z: this.door.z, reach: 1.3, label: () => 'Keluar' });
  }

  // -------------------------------------------------------------- light and life

  setupLights(night) {
    const warm = this.modern ? 0xfff4e0 : 0xffe2b8;
    this.hemi = new THREE.HemisphereLight(warm, 0x5a4a3a, night > 0.5 ? 0.55 : 1.05);
    this.ambient = new THREE.AmbientLight(0xffffff, night > 0.5 ? 0.18 : 0.3);
    const sun = new THREE.DirectionalLight(night > 0.5 ? 0x8fa8ff : 0xfff1dc, night > 0.5 ? 0.25 : 1.1);
    sun.position.set(-this.W, 8, this.D);
    this.scene.add(this.hemi, this.ambient, sun);
    // At night the lamps come on by themselves (you can still switch them)
    if (night > 0.5) this.lamps.forEach((l) => this.setLamp(l, true, false));
  }

  addResident(gltf, shadows) {
    const spot = this.residentSpot;
    if (!spot) return;
    const outfits = this.modern ? ['casual_f', 'business', 'casual_m', 'elder'] : ['townsfolk_f', 'peasant', 'elder'];
    const rng=this.blueprint?mulberry32(this.residentSeed):this.rng;
    const p = makePerson(gltf, outfits[Math.floor(rng() * outfits.length)], { shadows, appearanceSeed: Math.floor(rng()*1000000) });
    if (!p) return;
    p.root.position.set(spot.x, 0, spot.z);
    p.root.rotation.y = spot.yaw;
    this.scene.add(p.root);
    this.resident = { p, pose: spot.seat ? 'sit' : null };
    // A seated resident takes that seat
    if (spot.seat) this.interactables = this.interactables.filter((it) => !(it.kind === 'seat' && Math.hypot(it.seat.x - spot.x, it.seat.z - spot.z) < 0.6));
  }

  setLamp(l, on, emit = true) {
    l.on = on;
    l.light.intensity = on ? 6 : 0;
    l.glow.material.opacity = on ? 0.85 : 0;
    return emit && on ? 'light_on' : null;
  }

  // -------------------------------------------------------------- interaction

  nearest(x, z) {
    let best = null;
    let bestD = Infinity;
    for (const it of this.interactables) {
      if (it.taken) continue;
      if (it.kind === 'surface' && !this.holding) continue;
      const d = Math.hypot(it.x - x, it.z - z);
      if (d < it.reach && d < bestD) {
        bestD = d;
        best = it;
      }
    }
    return best;
  }

  promptFor(it) {
    if (!it) return null;
    if (it.kind === 'surface') return `Taruh ${ITEM_NAMES[this.holding.asset] || 'barang'}`;
    return it.label();
  }

  /** Do the thing; returns { event?, action? } for the mode (missions, sit, sleep, exit). */
  use(it, player) {
    switch (it.kind) {
      case 'light':
        return { event: this.setLamp(it, !it.on) };
      case 'door':
        it.target = it.target ? 0 : 1;
        return { event: it.target ? it.event : null };
      case 'media':
        it.on = !it.on;
        if (it.mat) it.mat.color.set(it.on ? 0x6fb7ff : 0x0c1016);
        return { event: it.on ? 'media_on' : null, action: it.radio ? (it.on ? 'radio_on' : 'radio_off') : null };
      case 'fire':
        it.on = !it.on;
        if (it.fire) it.fire.visible = it.on;
        it.light.intensity = it.on ? 8 : 0;
        return { event: it.on ? 'fire_on' : null };
      case 'item':
        if (this.holding) return {};
        it.taken = true;
        it.mesh.visible = false;
        this.holding = it;
        return { event: `pickup_${it.asset.replace('it_', '')}`, action: 'hold' };
      case 'surface': {
        const h = this.holding;
        if (!h) return {};
        h.taken = false;
        h.mesh.visible = true;
        const a = this.rng() * Math.PI * 2;
        h.x = (it.placementX ?? it.x) + Math.cos(a) * 0.25;
        h.z = (it.placementZ ?? it.z) + Math.sin(a) * 0.2;
        h.mesh.position.set(h.x, it.h, h.z);
        this.holding = null;
        return { event: 'place_item', action: 'drop' };
      }
      case 'seat':
        return { event: 'sit', action: 'sit', pose: it.seat };
      case 'bed':
        return { action: 'sleep', pose: it.bed };
      case 'stairs':
        return this.holding ? {} : { action: 'floor', target: it.target };
      case 'exit':
        return { action: 'exit' };
      default:
        return {};
    }
  }

  // -------------------------------------------------------------- loop

  update(dt, t, camera, player) {
    // Dollhouse: hide the walls between the camera and the middle of the room
    const cx = camera.position.x;
    const cz = camera.position.z;
    const l = Math.hypot(cx, cz) || 1;
    for (const w of this.walls) {
      const n = w.userData.normal;
      w.visible = (n.x * cx + n.y * cz) / l < 0.35;
    }
    for (const it of this.interactables) {
      if (it.kind === 'door') {
        it.open += (it.target - it.open) * (1 - Math.exp(-dt * 6));
        it.leaves.forEach((lf) => (lf.holder.rotation.y = lf.sign * it.open * 1.9));
      } else if (it.kind === 'media' && it.on && it.mat) {
        // A flickering programme
        it.mat.color.setHSL((t * 0.05) % 1, 0.55, 0.45 + Math.sin(t * 7) * 0.08);
      } else if (it.kind === 'fire' && it.on) {
        it.light.intensity = 7 + Math.sin(t * 13) * 1.2 + Math.sin(t * 7.3) * 0.8;
      }
    }
    if (this.resident) animatePerson(this.resident.p, dt, 0, { pose: this.resident.pose });
    // Hold the item in front of the player
    if (this.holding && player) {
      const h = this.holding;
      h.mesh.visible = true;
      h.mesh.position.set(player.x + Math.sin(player.yaw) * 0.35, 1.05, player.z + Math.cos(player.yaw) * 0.35);
    }
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose?.());
    disposePerson(this.resident?.p);
  }
}

const ITEM_NAMES = { it_apple: 'apel', it_book: 'buku', it_cup: 'cangkir', it_candle: 'lilin' };
