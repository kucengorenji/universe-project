import * as THREE from 'three';
import { mulberry32 } from '../../../math/random.js';
import { Colliders } from '../navigation/colliders.js';
import { makePerson, animatePerson, disposePerson } from '../people/peopleRig.js';
import { makeTownPerson, animateTownPerson, disposeTownPerson } from '../people/skirmishPeople.js';
import { generateInteriorLayout, measureFurnitureBounds } from './interiorLayout.js';
import { seedFor } from '../../../world/identity.js';
import { assignInteractionIds, captureInterior, restoreInterior } from '../../../world/interiorState.js';
import { buildShell, addWindow, roomScheme, roundedSlab, slab, WALL_H, WINDOW_Y } from './roomShell.js';
import { t } from '../../../i18n/index.js';

// Inside a building: a room (or a few, split by half walls) generated from the
// building's type and seed, furnished from furniture.glb and dressed like a
// kitchen diorama (roomShell.js). The walls between camera and room drop to
// low stubs, so it reads as a cut-away model. Every piece of furniture that
// can do something is an interactable.
//
// Local frame: room centred on the origin, the entrance in the +Z wall.

/**
 * loadAssetPack options for furniture.glb: the bevelled props get smooth
 * normals; LEDs, embers, flames and the CRT always glow (1), lamp shades (0.5)
 * only while their lamp is on.
 */
export const FURNITURE_PACK = {
  crease: THREE.MathUtils.degToRad(50),
  glow: { M_led_green: 1, M_ember: 1, M_fire: 1, M_screen_blue: 1, M_lampshade: 0.5, M_glass: 0, M_glass_dark: 0 }
};

/** Soft-lit painted plastic for the props, glowing where the pack's emissive attribute says so. */
function propMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.58, metalness: 0 });
  const lit = { value: 0 };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uLit = lit;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float emissive;\nvarying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = emissive;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uLit;\nvarying float vGlow;')
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * (step(0.9, vGlow) * 0.85 + step(0.3, vGlow) * step(vGlow, 0.9) * uLit * 0.7);'
      );
  };
  m.customProgramCacheKey = () => 'room-prop';
  m.userData.lit = lit;
  return m;
}

/** Which room a building opens into. */
export const ENTERABLE = {
  f_house_small: { kind: 'cottage', get label() { return t('interior.enter.house'); } },
  f_house: { kind: 'house', get label() { return t('interior.enter.house'); } },
  f_house_tall: { kind: 'house', get label() { return t('interior.enter.house'); } },
  f_townhouse: { kind: 'house', get label() { return t('interior.enter.house'); } },
  f_tavern: { kind: 'tavern', get label() { return t('interior.enter.tavern'); } },
  f_shop: { kind: 'shop', get label() { return t('interior.enter.shop'); } },
  m_house: { kind: 'house', get label() { return t('interior.enter.house'); } },
  m_shop: { kind: 'shop', get label() { return t('interior.enter.shop'); } },
  m_apartment: { kind: 'apartment', get label() { return t('interior.enter.apartment'); } },
  m_office: { kind: 'office', get label() { return t('interior.enter.office'); } }
};

const SIZES = { cottage: [7, 6], house: [10, 8], tavern: [12, 9], shop: [9, 7], apartment: [10, 8], office: [12, 10] };

/** Wall decor the room hangs in free wall spans, with the width each needs and its height. */
/** Planner pieces whose look follows the era, not the seed: [fantasy, modern] variant. */
const ERA_VARIANT = { fu_counter: [1, 0], fu_chair: [0, 1] };

const DECOR = { fu_wall_shelf: { w: 1.0, y: 1.5 }, fu_picture_v0: { w: 0.7, y: 1.78 }, fu_picture_v1: { w: 0.7, y: 1.78 }, fu_clock: { w: 0.5, y: 1.95 } };

export class Interior {
  constructor({ building, pack, character, modern, seed, night, shadows, state = null, floor = 0, layoutVersion = 2 }) {
    this.building = building;
    this.info = ENTERABLE[building.asset];
    this.kind = this.info.kind;
    this.modern = modern;
    this.pack = pack || {};
    this.seed = seed;
    this.rng = mulberry32(seed);
    this.scene = new THREE.Scene();
    this.disposables = [];
    this.interactables = [];
    this.rects = [];
    this.items = [];
    this.lamps = [];
    this.placed = [];
    this.shadows = !!shadows;
    this.material = this.track(propMaterial());
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
    this.buildRoom(night);
    if(this.blueprint)this.buildPartitionsAndStairs();
    this.furnish();
    this.decorate();
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

  buildRoom(night) {
    const { W, D } = this;
    // The v1 generator drew one number here for its wall texture; keep drawing it so v1 rooms furnish the same
    if (!(this.kind === 'tavern' && !this.modern) && !(this.kind === 'office' && this.modern)) this.rng();
    this.scheme = roomScheme(this.kind, (seedFor(this.seed, 'room-scheme') % 1000) / 1000);
    buildShell(this, { scheme: this.scheme, night, seed: this.seed });
    const t = 0.18;
    const dw = 1.2, dx = this.door.x;
    this.rects.push({ x: 0, z: -D / 2 - 0.2, hw: W / 2 + 1, hd: 0.25, yaw: 0 }, { x: -W / 2 - 0.2, z: 0, hw: 0.25, hd: D / 2 + 1, yaw: 0 }, { x: W / 2 + 0.2, z: 0, hw: 0.25, hd: D / 2 + 1, yaw: 0 });
    if(this.floor===0)this.rects.push({x:(-W/2+dx-dw/2)/2,z:D/2+.2,hw:(dx-dw/2+W/2)/2,hd:.25,yaw:0},
      {x:(W/2+dx+dw/2)/2,z:D/2+.2,hw:(W/2-dx-dw/2)/2,hd:.25,yaw:0});
    else this.rects.push({x:0,z:D/2+.2,hw:W/2+t,hd:.25,yaw:0});
    // Windows hang on their wall (hidden with it); side walls under 6 m get one
    const frame = this.pack.fu_window?.[0];
    const [back, left, right, front] = this.walls;
    const along = (len) => (len >= 6 ? [-len / 5, len / 5] : [0]);
    for (const x of [-W / 3, W / 3]) addWindow(this, back, x, WINDOW_Y, frame, this.material);
    for (const x of along(D)) {
      addWindow(this, left, x, WINDOW_Y, frame, this.material);
      addWindow(this, right, x, WINDOW_Y, frame, this.material);
    }
    if (this.floor > 0) for (const x of [-W / 3, W / 3]) addWindow(this, front, x, WINDOW_Y, frame, this.material);
    else {
      // Door mat just inside the entrance
      const mat = new THREE.Mesh(this.track(roundedSlab(dx - 0.5, dx + 0.5, 0, 0.022, D / 2 - 0.78, D / 2 - 0.12, 0.012)), this.mats.trimDark);
      const inner = new THREE.Mesh(this.track(roundedSlab(dx - 0.42, dx + 0.42, 0.004, 0.028, D / 2 - 0.7, D / 2 - 0.2, 0.01)), this.mats.boards);
      mat.receiveShadow = inner.receiveShadow = true;
      this.scene.add(mat, inner);
    }
    this.doorX = dx;
  }

  buildPartitionsAndStairs() {
    const plan=this.blueprint;
    for(const p of plan.partitions)this.partition(p.x-p.hw,p.x+p.hw,p.z-p.hd,p.z+p.hd);
    if(plan.floors<2)return;
    const x=plan.W/2-.65,z=-plan.D/2+.15;
    const { boards, trim, trimDark } = this.mats;
    const add = (geo, mat) => {
      const m = new THREE.Mesh(this.track(geo), mat);
      m.receiveShadow = true;
      m.castShadow = this.shadows;
      this.scene.add(m);
    };
    if(this.floor+1<plan.floors){
      // Painted flight with fat wooden treads, climbing towards the back wall
      for(let i=0;i<14;i++){
        const top=(14-i)*.2, z0=z+i*.185, z1=z0+.185;
        add(slab(x-.55,x+.55,0,top-.05,z0,z1),boards);
        add(roundedSlab(x-.58,x+.58,top-.07,top,z0-.01,z1+.03,.03),trim);
      }
      // Sloped stringer on the room side and a newel post at the foot
      const len=Math.hypot(2.6,2.6)+.2;
      const stringer=new THREE.Mesh(this.track(roundedSlab(-.05,.05,-.1,.1,-len/2,len/2,.04)),trimDark);
      stringer.position.set(x-.6,1.62,z+1.3);
      stringer.rotation.x=Math.PI/4;
      stringer.receiveShadow=true;
      this.scene.add(stringer);
      add(roundedSlab(x-.67,x-.53,0,1.0,z+2.5,z+2.64,.04),trim);
      const knob=new THREE.Mesh(this.track(new THREE.SphereGeometry(.09,16,12)),trim);
      knob.position.set(x-.6,1.06,z+2.57);
      this.scene.add(knob);
    } else {
      // Stairwell from above: a dark opening with a wooden rim and a rail on the room side
      add(slab(x-.55,x+.55,.005,.015,z,z+2.6),this.track(new THREE.MeshBasicMaterial({color:0x2a2420})));
      add(roundedSlab(x-.66,x-.55,0,.05,z,z+2.66,.02),trim);
      add(roundedSlab(x-.66,x+.55,0,.05,z+2.55,z+2.66,.02),trim);
      for(let k=0;k<5;k++)add(roundedSlab(x-.64,x-.57,0,.95,z+.1+k*.6,z+.17+k*.6,.03),trimDark);
      add(roundedSlab(x-.67,x-.54,.92,1.04,z+.05,z+2.62,.045),trim);
    }
    this.rects.push({x,z:z+1.3,hw:.55,hd:1.3,yaw:0});
    this.placed.push({ asset: 'stairs', x, z: z + 1.3, hw: 0.6, hd: 1.3, top: this.floor + 1 < plan.floors ? WALL_H : 1.05 });
  }

  /** Brick up the windows behind a tall piece standing against a wall. */
  closeWindows(x, z, r) {
    for (const p of this.panes) if (Math.hypot(p.x - x, p.z - z) < r) p.parts.forEach((m) => (m.visible = false));
  }

  /** Half-height partition with a rounded cap (keeps the cut-away view open). */
  partition(x0, x1, z0, z1) {
    const m = new THREE.Mesh(this.track(slab(x0, x1, 0, 1.12, z0, z1)), this.mats.boards);
    const cap = new THREE.Mesh(this.track(roundedSlab(x0 - 0.03, x1 + 0.03, 1.08, 1.2, z0 - 0.05, z1 + 0.05, 0.05)), this.mats.trim);
    m.receiveShadow = cap.receiveShadow = true;
    this.scene.add(m, cap);
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
    mesh.castShadow = this.shadows;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    if (!geo.boundingBox) geo.computeBoundingBox();
    const b = geo.boundingBox;
    const cx = (b.min.x + b.max.x) / 2;
    const cz = (b.min.z + b.max.z) / 2;
    // Box in world: rotate the centre offset, layout yaw = -rotation.y
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const rect = { x: x + cx * c + cz * s, z: z - cx * s + cz * c, hw: (b.max.x - b.min.x) / 2, hd: (b.max.z - b.min.z) / 2, yaw: -yaw };
    if (collide) this.rects.push(rect);
    // Axis-aligned footprint and height, for hanging wall decor and rugs around it
    const ac = Math.abs(c), as = Math.abs(s);
    if (y === 0) this.placed.push({ asset, x: rect.x, z: rect.z, hw: rect.hw * ac + rect.hd * as, hd: rect.hw * as + rect.hd * ac, top: b.max.y, yaw });
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
    this.interactables.push({ kind: 'seat', x: f.x, z: f.z, reach: 1.5, label: () => t('interior.sit'), seat: { x: f.x, z: f.z, yaw, lift: 0 } });
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
      const it = { kind: 'item', asset, variant, mesh: m, x, z, reach: 1.3, label: () => t('interior.take', { item: itemName(asset) }) };
      this.items.push(it);
      this.interactables.push(it);
    };
    const lamp = (asset, x, z, y = 0) => {
      const m = this.put(asset, x, z, 0, { collide: asset === 'fu_lamp_floor', y });
      if (!m) return;
      const floorLamp = asset === 'fu_lamp_floor';
      m.material = this.track(propMaterial()); // its own, so only this shade lights up
      const light = new THREE.PointLight(0xffd79a, 0, 6, 1.4);
      light.position.set(x, y + (floorLamp ? 1.5 : 0.45), z);
      this.scene.add(light);
      // The bulb peeks out under the shade
      const glow = new THREE.Mesh(this.track(new THREE.SphereGeometry(floorLamp ? 0.085 : 0.05, 12, 8)), this.track(new THREE.MeshBasicMaterial({ color: 0xffe6b0, transparent: true, opacity: 0 })));
      glow.position.set(x, y + (floorLamp ? 1.36 : 0.29), z);
      this.scene.add(glow);
      const l = { kind: 'light', x, z, reach: 1.4, light, glow, lit: m.material.userData.lit, on: false, label: () => t(l.on ? 'interior.light.off' : 'interior.light.on') };
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
        mesh.castShadow = this.shadows;
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
      const d = { kind: 'door', x: f.x, z: f.z, reach: 1.5, leaves: leaves.filter(Boolean), open: 0, target: 0, event, label: () => t(d.target ? `interior.close.${label}` : `interior.open.${label}`) };
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
      const tv = { kind: 'media', x: f.x, z: f.z, reach: 1.8, mat, on: false, label: () => t(tv.on ? 'interior.tv.off' : 'interior.tv.on') };
      this.interactables.push(tv);
      this.tvs = [...(this.tvs || []), tv];
    };
    const radio = (x, y, z) => {
      this.put('fu_radio', x, z, 0, { collide: false, y });
      const r = { kind: 'media', radio: true, x, z, reach: 1.3, on: false, label: () => t(r.on ? 'interior.radio.off' : 'interior.radio.on') };
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
      const fp = { kind: 'fire', x: p.x, z: p.z, reach: 1.6, fire, light, on: false, label: () => t(fp.on ? 'interior.fire.off' : 'interior.fire.on') };
      this.interactables.push(fp);
      this.fires = [...(this.fires || []), fp];
    };
    const bed = (x, z, yaw) => {
      this.put('fu_bed', x, z, yaw, { variant: Math.floor(rng() * 2) });
      const side = this.front(x, z, yaw + Math.PI / 2, 1.2);
      this.interactables.push({ kind: 'bed', x: side.x, z: side.z, reach: 1.7, label: () => t('interior.sleep'), bed: { x, z, yaw } });
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
        const {asset,x,z,yaw,kind}=node;
        const variant=ERA_VARIANT[asset]?.[this.modern?1:0]??node.variant;
        const start=this.interactables.length;
        if(kind==='bed')bed(x,z,yaw);
        else if(kind==='seat')this.seat(asset,x,z,yaw,{variant});
        else if(kind==='light')lamp(asset,x,z);
        else if(kind==='cabinet')hinged(asset,'fu_wardrobe_door',x,z,yaw,.6,.27,1.2,'cabinet','open');
        else if(kind==='fridge')hinged(asset,'fu_fridge_door',x,z,yaw,.33,.35,.66,'fridge','open');
        else if(kind==='media')tv(x,z,yaw);
        else if(kind==='fire')fireplace(x,z,yaw);
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
      for(const stair of this.blueprint.stairs)this.interactables.push({kind:'stairs',...stair,reach:.8,label:()=>this.holding?t('interior.stairs.drop'):t(stair.target>this.floor?'interior.stairs.up':'interior.stairs.down',{floor:stair.target+1})});
      if(this.floor===0)this.interactables.push({kind:'exit',x:this.door.x,z:this.door.z,reach:1.1,label:()=> t('interior.exit')});
      return;
    }

    if (k === 'cottage' || k === 'house' || k === 'apartment') {
      const big = k !== 'cottage';
      // Bedroom corner (left back)
      bed(-W / 2 + 1.2, back + 0.6, 0);
      hinged('fu_wardrobe', 'fu_wardrobe_door', -W / 2 + 0.4, -D / 2 + 3.2, Math.PI / 2, 0.6, 0.27, 1.2, 'cabinet', 'open');
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
        if (!fantasy) hinged('fu_fridge', 'fu_fridge_door', -W / 2 + 0.45, D / 2 - 2.8, Math.PI / 2, 0.33, 0.35, 0.66, 'fridge', 'open');
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
      if (!fantasy) hinged('fu_fridge', 'fu_fridge_door', W / 2 - 1.4, back, 0, 0.33, 0.35, 0.66, 'fridge', 'open');
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
      hinged('fu_fridge', 'fu_fridge_door', W / 2 - 0.45, D / 2 - 2.3, -Math.PI / 2, 0.33, 0.35, 0.66, 'fridge', 'open');
      item('it_apple', W / 2 - 1.4, 0.94, D / 2 - 0.8);
      tv(0, -D / 2 + 0.4, 0);
      this.put('fu_plant', -W / 2 + 0.5, D / 2 - 0.6, 0);
      this.put('fu_plant', W / 2 - 0.5, -D / 2 + 0.5, 0, { variant: 1 });
      lamp('fu_lamp_floor', -W / 2 + 0.5, -D / 2 + 0.5);
      this.residentSpot = { seat: true, x: -W / 2 + 2.1, z: -D / 2 + 2.55, yaw: Math.PI };
    }
    this.interactables.push({ kind: 'exit', x: this.door.x, z: this.door.z, reach: 1.3, label: () => t('interior.exit') });
  }

  /** Along-wall interval of a placed piece standing within `reach` of the wall's inner face, else null. */
  wallShadow(wall, p, reach = 0.9) {
    const local = wall.worldToLocal(new THREE.Vector3(p.x, 0, p.z));
    const n = wall.userData.normal;
    const [along, depth] = Math.abs(n.y) > 0.5 ? [p.hw, p.hd] : [p.hd, p.hw];
    return local.z - depth < reach ? [local.x - along, local.x + along] : null;
  }

  /** Rug under the main table, windows closed behind tall pieces, pictures, clocks and shelves in free wall spans. */
  decorate() {
    const rng = mulberry32(seedFor(this.seed, this.floor, 'decor'));
    const { W, D } = this;
    const tall = this.placed.filter((p) => p.top > 1.3);
    if (this.blueprint) {
      const table = this.placed.find((p) => p.asset === 'fu_table' || p.asset === 'fu_coffee_table');
      if (table) {
        const turn = table.hw < table.hd;
        const hw = turn ? 0.7 : 1.0;
        const hd = turn ? 1.0 : 0.7;
        const inside = Math.abs(table.x) + hw < W / 2 - 0.05 && Math.abs(table.z) + hd < D / 2 - 0.05;
        const clear = !this.placed.some((p) => p.top > 1.0 && Math.abs(p.x - table.x) < p.hw + hw && Math.abs(p.z - table.z) < p.hd + hd);
        if (inside && clear) this.put('fu_rug', table.x, table.z, turn ? Math.PI / 2 : 0, { variant: rng() < 0.5 ? 0 : 1, collide: false });
      }
    }
    for (const pane of this.panes) {
      if (tall.some((p) => {
        const span = this.wallShadow(pane.wall, p);
        return span && span[0] < pane.along + 0.7 && span[1] > pane.along - 0.7;
      })) pane.parts.forEach((m) => (m.visible = false));
    }
    let clock = false;
    for (const wall of this.walls.slice(0, 3)) {
      const len = wall.userData.len;
      const blocked = [];
      for (const p of tall) {
        const span = this.wallShadow(wall, p);
        if (span) blocked.push([span[0] - 0.1, span[1] + 0.1]);
      }
      for (const pane of this.panes) if (pane.wall === wall && pane.parts[0].visible) blocked.push([pane.along - 0.92, pane.along + 0.92]);
      blocked.sort((a, b) => a[0] - b[0]);
      const gaps = [];
      let from = -len / 2 + 0.35;
      for (const [a, b] of blocked) {
        if (a > from) gaps.push([from, Math.min(a, len / 2 - 0.35)]);
        from = Math.max(from, b);
      }
      if (from < len / 2 - 0.35) gaps.push([from, len / 2 - 0.35]);
      const kitchen = this.placed.filter((p) => ['fu_counter', 'fu_stove', 'fu_desk'].includes(p.asset) && this.wallShadow(wall, p, 0.5));
      for (const [a, b] of gaps) {
        const g = b - a;
        if (g < 0.62) continue;
        const n = g > 2.6 ? 2 : 1;
        for (let i = 0; i < n; i++) {
          const x = a + (g * (i + 0.5)) / n;
          const room = g / n;
          const overWork = kitchen.some((p) => {
            const s = this.wallShadow(wall, p, 0.5);
            return s[0] < x && s[1] > x;
          });
          const options = overWork ? ['fu_wall_shelf'] : ['fu_picture_v0', 'fu_picture_v1', 'fu_wall_shelf', ...(clock ? [] : ['fu_clock'])];
          const fits = options.filter((o) => DECOR[o].w <= room && this.pack[o]);
          if (!fits.length || rng() < 0.2) continue;
          const name = fits[Math.floor(rng() * fits.length)];
          if (name === 'fu_clock') clock = true;
          const m = new THREE.Mesh(this.pack[name][0], this.material);
          m.position.set(x, DECOR[name].y, 0);
          m.receiveShadow = true;
          wall.userData.full.add(m);
        }
      }
    }
  }

  // -------------------------------------------------------------- light and life

  setupLights(night) {
    const dark = night > 0.5;
    this.hemi = new THREE.HemisphereLight(0xfff3e0, 0x9a7658, dark ? 0.35 : 1.15);
    this.ambient = new THREE.AmbientLight(0xffffff, dark ? 0.08 : 0.2);
    // Key light from above the camera side, so shadows fall into the room; a cool fill from the right
    const key = new THREE.DirectionalLight(dark ? 0x9fb2ff : 0xfff0d6, dark ? 0.3 : 2.0);
    key.position.set(-this.W * 0.3, 8, this.D * 0.7);
    if (this.shadows) {
      key.castShadow = true;
      const e = Math.hypot(this.W, this.D) / 2 + 0.5;
      Object.assign(key.shadow.camera, { left: -e, right: e, top: e, bottom: -e, near: 0.5, far: 25 });
      key.shadow.mapSize.set(2048, 2048);
      key.shadow.bias = -0.0005;
      key.shadow.normalBias = 0.03;
    }
    const fill = new THREE.DirectionalLight(0xe2eaff, dark ? 0.08 : 0.45);
    fill.position.set(this.W * 0.6, 4, -this.D * 0.1);
    this.scene.add(this.hemi, this.ambient, key, key.target, fill, fill.target);
    // At night the lamps come on by themselves (you can still switch them)
    if (dark) this.lamps.forEach((l) => this.setLamp(l, true, false));
  }

  addResident(gltf, shadows) {
    const spot = this.residentSpot;
    if (!spot) return;
    const outfits = this.modern ? ['casual_f', 'business', 'casual_m', 'elder'] : ['townsfolk_f', 'peasant', 'elder'];
    const rng=this.blueprint?mulberry32(this.residentSeed):this.rng;
    const outfit = outfits[Math.floor(rng() * outfits.length)], seed = Math.floor(rng() * 1000000);
    const p = gltf.vc ? makeTownPerson(gltf, { shadows, seed }) : makePerson(gltf, outfit, { shadows, appearanceSeed: seed });
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
    l.light.intensity = on ? 2.6 : 0;
    l.glow.material.opacity = on ? 0.85 : 0;
    if (l.lit) l.lit.value = on ? 1 : 0;
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
    if (it.kind === 'surface') return t('interior.put', { item: itemName(this.holding.asset) });
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
        it.light.intensity = it.on ? 3 : 0;
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
    // Cut-away: walls between the camera and the middle of the room drop to their stubs
    const cx = camera.position.x;
    const cz = camera.position.z;
    const l = Math.hypot(cx, cz) || 1;
    for (const w of this.walls) {
      const n = w.userData.normal;
      const open = (n.x * cx + n.y * cz) / l >= 0.35;
      w.userData.full.visible = !open;
      w.userData.stub.visible = open;
    }
    for (const it of this.interactables) {
      if (it.kind === 'door') {
        it.open += (it.target - it.open) * (1 - Math.exp(-dt * 6));
        it.leaves.forEach((lf) => (lf.holder.rotation.y = lf.sign * it.open * 1.9));
      } else if (it.kind === 'media' && it.on && it.mat) {
        // A flickering programme
        it.mat.color.setHSL((t * 0.05) % 1, 0.55, 0.45 + Math.sin(t * 7) * 0.08);
      } else if (it.kind === 'fire' && it.on) {
        it.light.intensity = 2.8 + Math.sin(t * 13) * 0.5 + Math.sin(t * 7.3) * 0.3;
      }
    }
    if (this.resident) (this.resident.p.townPerson ? animateTownPerson : animatePerson)(this.resident.p, dt, 0, { pose: this.resident.pose });
    // Hold the item in front of the player
    if (this.holding && player) {
      const h = this.holding;
      h.mesh.visible = true;
      h.mesh.position.set(player.x + Math.sin(player.yaw) * 0.35, 1.05, player.z + Math.cos(player.yaw) * 0.35);
    }
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose?.());
    if (this.resident?.p.townPerson) disposeTownPerson(this.resident.p);
    else disposePerson(this.resident?.p);
  }
}

const itemName = (asset) => t(['it_apple', 'it_book', 'it_cup', 'it_candle'].includes(asset) ? `interior.item.${asset}` : 'interior.item.other');
