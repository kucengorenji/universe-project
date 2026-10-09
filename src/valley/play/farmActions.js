import * as THREE from 'three';
import { ClipPlayer } from '../anim/clips.js';

// The player's hands (docs/FARM_PLAN.md §5, milestone V3). Tools on 1-3 and Space: the hoe tills
// the cell in front, the can wets it, seeds go into tilled soil. E does whatever is in front:
// lift a stone, a log or an apple over the head, pull a ripe crop, shake a tree or a bush, and
// throw whatever is carried. Every change to the world happens on a clip's event frame.

export const TOOLS = [
  { id: 'hoe', label: 'Cangkul', clip: 'hoe', asset: 'tool_hoe' },
  { id: 'can', label: 'Gembor', clip: 'water', asset: 'tool_can' },
  { id: 'seeds', label: 'Benih', clip: 'plant', asset: 'seed_bag' }
];
const REACH = 0.8; // metres ahead of the feet that a tool works on
const MAX_APPLES = 8;

export class FarmActions {
  constructor({ player, kit, field, fieldView, pickups, effects, trees, bushes, animals = [], villagers = null, icons = null, onTalk = null }) {
    this.animals = animals;
    this.villagers = villagers;
    this.icons = icons;
    this.onTalk = onTalk;
    this.player = player;
    this.field = field;
    this.fieldView = fieldView;
    this.pickups = pickups;
    this.effects = effects;
    this.trees = trees; // LodInstances per tree asset
    this.bushes = bushes;
    this.clips = new ClipPlayer(player);
    this.tool = 0;
    this.carrying = null;
    this.log = []; // what happened, for QA: [{ t, what, detail }]
    this.time = 0;
    // Tools ride in the right hand, shown only while in use
    const wrist = player.bones.wrist_R.node;
    this.held = {};
    for (const t of TOOLS) {
      const g = new THREE.Group();
      for (const { geometry, material } of kit[t.asset]) {
        const m = new THREE.Mesh(geometry, material);
        m.castShadow = true;
        g.add(m);
      }
      g.position.set(-0.03, -0.06, -0.01);
      g.visible = false;
      wrist.add(g);
      this.held[t.id] = g;
    }
  }

  get locked() {
    return this.clips.busy;
  }

  facing() {
    const a = this.player.root.rotation.y;
    return { x: Math.sin(a), z: Math.cos(a) };
  }

  front(reach = REACH) {
    const p = this.player.root.position, f = this.facing();
    return { x: p.x + f.x * reach, z: p.z + f.z * reach };
  }

  /** The field cell the tool would hit, or null. */
  targetCell() {
    const f = this.front();
    return this.field.cellAt(f.x, f.z);
  }

  /** What E would do right now, for the hint line. */
  context() {
    if (this.carrying) return { action: 'throw', label: `Lempar ${NAMES[this.carrying.kind] || 'barang'}` };
    const p = this.player.root.position, f = this.facing();
    const item = this.pickups.inFront(p.x, p.z, f);
    if (item) return { action: 'lift', item, label: `Angkat ${NAMES[item.kind] || 'barang'}` };
    const villager = this.villagers?.inFront(p.x, p.z, f);
    if (villager) return { action: 'talk', villager, label: `Ngobrol dengan ${VILLAGER_NAMES[villager.look] || 'warga'}` };
    const animal = this.animalInFront(p, f);
    if (animal) return { action: 'pet', animal, label: `Elus ${NAMES[animal.species]}` };
    const cell = this.targetCell();
    if (cell && this.field.crop[cell.i] === 3) return { action: 'harvest', cell, label: 'Panen lobak' };
    const tree = this.nearestShakeable(this.trees, 1.7);
    if (tree) return { action: 'shake', target: tree, label: tree.lod.asset === 'tree_apple' ? 'Goyang pohon apel' : 'Goyang pohon' };
    const bush = this.nearestShakeable(this.bushes, 1.2);
    if (bush) return { action: 'shake', target: bush, label: 'Goyang semak' };
    return null;
  }

  /** A cow or dog within petting reach in front (chickens are lifted, through the pickups). */
  animalInFront(p, f) {
    for (const a of this.animals) {
      if (a.species === 'chicken' || a.held) continue;
      const q = a.root.position, dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz);
      if (d < (a.species === 'cow' ? 1.9 : 1.2) && (dx * f.x + dz * f.z) / (d || 1) > 0.3) return a;
    }
    return null;
  }

  nearestShakeable(list, reach) {
    const p = this.player.root.position, f = this.facing();
    let best = null;
    for (const lod of list) {
      const hit = lod.nearest(p.x, p.z, reach);
      if (!hit) continue;
      const dx = hit.p.x - p.x, dz = hit.p.z - p.z, d = Math.hypot(dx, dz) || 1;
      if ((dx * f.x + dz * f.z) / d < 0.3) continue;
      if (!best || hit.d < best.d) best = { ...hit, lod };
    }
    return best;
  }

  setTool(i) {
    if (!this.locked) this.tool = (i + TOOLS.length) % TOOLS.length;
  }

  /** Space: use the selected tool on the cell in front. */
  useTool() {
    if (this.locked || this.carrying) return false;
    const tool = TOOLS[this.tool];
    const cell = this.targetCell();
    this.held[tool.id].visible = true;
    this.clips.play(tool.clip, {
      onEvent: (name) => this.toolEvent(tool.id, name, cell),
      onEnd: () => { this.held[tool.id].visible = false; }
    });
    return true;
  }

  toolEvent(tool, name, cell) {
    const f = this.front();
    const at = new THREE.Vector3(f.x, this.fieldView.ground.heightAt(f.x, f.z) + 0.05, f.z);
    if (tool === 'hoe' && name === 'impact') {
      const ok = cell && this.field.till(cell.i);
      this.effects.burst('dust', at, ok ? 12 : 6, { speed: 1.4 });
      this.note('hoe', ok ? cell.i : null);
    }
    if (tool === 'can' && name === 'pour') {
      this.pouring = true;
      if (cell) this.field.water(cell.i);
      this.note('water', cell ? cell.i : null);
    }
    if (tool === 'can' && name === 'stop') this.pouring = false;
    if (tool === 'seeds' && name === 'drop') {
      const ok = cell && this.field.plant(cell.i);
      this.effects.burst('dust', at, 4, { speed: 0.6, colour: '#d8c59a' });
      this.note('plant', ok ? cell.i : null);
    }
  }

  /** E: lift, harvest, shake or throw, whichever is in front. */
  interact() {
    if (this.locked) return false;
    const c = this.context();
    if (!c) {
      this.clips.play('surprised');
      return false;
    }
    if (c.action === 'throw') {
      const item = this.carrying;
      this.clips.play('throw', {
        onEvent: (name) => {
          if (name !== 'release') return;
          this.pickups.throw(item, this.headTop(), this.facing());
          this.carrying = null;
          this.note('throw', item.kind);
        }
      });
    } else if (c.action === 'lift') {
      this.clips.play('lift', {
        onEvent: (name) => {
          if (name !== 'grab') return;
          this.pickups.carry(c.item);
          this.carrying = c.item;
          this.note('lift', c.item.kind);
        }
      });
      // lift is a held clip: it ends on the carry pose, so switch to the overlay once it is up
      this.afterHold = 'carry';
    } else if (c.action === 'harvest') {
      this.clips.play('harvest', {
        onEvent: (name) => {
          if (name !== 'pull' || !this.field.harvest(c.cell.i)) return;
          const [x, z] = this.field.center(c.cell.c, c.cell.r);
          this.effects.burst('dust', new THREE.Vector3(x, this.fieldView.ground.heightAt(x, z) + 0.05, z), 10, { speed: 1.2 });
          this.carrying = this.pickups.spawn('crop_ripe', x, z);
          this.pickups.carry(this.carrying);
          this.note('harvest', c.cell.i);
        }
      });
      this.afterHold = 'carry';
    } else if (c.action === 'talk') {
      const text = this.villagers.talk(c.villager);
      this.onTalk?.(c.villager, text);
      this.note('talk', c.villager.look);
    } else if (c.action === 'pet') {
      const q = c.animal.root.position, p0 = this.player.root.position;
      this.player.root.rotation.y = Math.atan2(q.x - p0.x, q.z - p0.z);
      this.clips.play('pet', { onEvent: (name) => name === 'touch' && (c.animal.cheer(this.icons), this.note('pet', c.animal.species)) });
    } else if (c.action === 'shake') {
      const { lod, i, p } = c.target;
      // Face the trunk before pushing it
      const p0 = this.player.root.position;
      this.player.root.rotation.y = Math.atan2(p.x - p0.x, p.z - p0.z);
      let hits = 0;
      this.clips.play('shake', { onEvent: (name) => name === 'hit' && this.hit(lod, i, p, hits++ === 0) });
    }
    return true;
  }

  /** first: the first push of a shake, which always brings an apple down (the second may). */
  hit(lod, i, p, first) {
    const f = this.facing();
    const tree = lod.asset.startsWith('tree_');
    lod.shake(i, tree ? 0.06 : 0.18, f);
    const top = new THREE.Vector3(p.x, p.y + (tree ? 3.2 : 0.7), p.z);
    this.effects.burst(lod.asset === 'tree_sakura' ? 'blossom' : 'leaf', top, tree ? 10 : 5, { speed: 1.4, spread: 2 });
    if (lod.asset === 'tree_apple' && this.pickups.count('apple') < MAX_APPLES && (first || Math.random() < 0.5)) {
      // An apple drops from the canopy and rolls to a stop near the trunk
      const a = Math.random() * Math.PI * 2, r = 0.9 + Math.random() * 0.7;
      this.pickups.spawn('apple', p.x + Math.cos(a) * r, p.z + Math.sin(a) * r, { y: p.y + 2.6, v: new THREE.Vector3(Math.cos(a) * 0.6, 0, Math.sin(a) * 0.6) });
      this.note('apple', i);
    }
    this.note('shake', lod.asset);
  }

  headTop() {
    const head = this.player.bones.head.node;
    const v = new THREE.Vector3();
    head.getWorldPosition(v);
    return v.add(new THREE.Vector3(0, 0.36 * this.player.root.scale.y, 0));
  }

  note(what, detail) {
    this.log.push({ t: +this.time.toFixed(2), what, detail });
  }

  /** After the procedural pose each frame: clip on top, carried item over the head, water drops. */
  update(dt) {
    this.time += dt;
    // Held clips (lift, harvest) end on the carry pose: hand over to the carry overlay
    if (this.afterHold && this.clips.clip?.hold && this.clips.time >= this.clips.clip.duration && this.clips.name !== 'carry') {
      this.clips.play(this.carrying ? this.afterHold : 'surprised');
      this.afterHold = null;
    }
    if (!this.carrying && this.clips.name === 'carry') this.clips.stop();
    this.clips.update(dt);
    if (this.carrying) {
      this.player.root.updateMatrixWorld(true);
      this.pickups.holdAt(this.carrying, this.headTop());
    }
    if (this.pouring) {
      // The can's rose (spout tip) in its own frame: Blender (0, -0.29, -0.06) is glTF (0, -0.06, 0.29)
      const rose = this.held.can.localToWorld(new THREE.Vector3(0, -0.06, 0.29));
      this.effects.burst('drop', rose, 2, { dir: new THREE.Vector3(this.facing().x * 0.4, -1, this.facing().z * 0.4), speed: 1.8, spread: 0.6 });
    }
  }
}

const NAMES = { stone_small: 'batu', log: 'kayu', apple: 'apel', crop_ripe: 'lobak', chicken: 'ayam', cow: 'sapi', dog: 'anjing' };
const VILLAGER_NAMES = { seller: 'Bu Sari', elder: 'Kakek Darma', child: 'Tia' };
