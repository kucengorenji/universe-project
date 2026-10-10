// Going into buildings: doors, the fade-guarded transitions, the room while inside, stairs, sleeping and remembering where the player was.
// Methods of the town instance (mixed into TownMode, see mixin.js): they use its state and are called as this.<name>().

import * as THREE from 'three';
import { Interior, ENTERABLE } from '../interior/interior.js';
import { buildingId, seedFor } from '../../../world/identity.js';
import { openInteriorSession, storeInterior } from '../interior/interiorSession.js';
import { findTownDoors, nearestDoor as closestDoor } from '../interior/doors.js';
import { isOn } from '../../../core/experiments.js';
import { PIXEL_YAW } from '../render/pixelConfig.js';
import { t as tr } from '../../../i18n/index.js';
import { STREET_FOV, _v } from './shared.js';

export class InteriorMethods {
  /** One fade-and-change at a time (TransitionGuard). A failure is recorded for QA and the cover is lifted. */
  transition(task) {
    return this.transitions.run(async (ticket) => {
      try {
        return await task(ticket);
      } catch (error) {
        console.error(error);
        this.ctx.engine.lastError = error;
        if (ticket.alive) {
          ticket.end();
          await this.ctx.overlay.reveal({ duration: 300 });
        }
      }
    });
  }

  get fading() { return this.transitions.busy; }

  /** Front doors of every building you can go into (interior/doors.js). */
  findDoors() { return findTownDoors(this.layout, this.footprints, { enterable: ENTERABLE, hasInteriors: isOn('lazyInterior') || this.furniturePack.ready }); }

  nearestDoor(x, z, reach = 2.4) { return closestDoor(this.doors, x, z, reach); }

  async enterBuilding(door, { floor = 0 } = {}) {
    if (this.transitions.busy || this.transfer || this.interior) return;
    if (door.b.homeRecord) {
      return this.ctx.director.go({ mode: 'home', planet: this.route.planet, city: this.route.city, home: door.b.homeRecord.id });
    }
    return this.transition(async (ticket) => {
      this.tween = null;
      this.orbit.enabled = false;
      this.hud.setPrompt(null);
      const overlay = this.ctx.overlay;
      await overlay.cover('fade', { duration: 280 });
      if (!ticket.alive) return; // the director took the screen while this fade ran
      this.pixel?.setActive(false);
      await this.ctx.world.ready;
      if (!ticket.alive) return;
      const pack = await this.furniturePack.start('enter'); // already there if a door was near
      await this.character.loadFemale?.().catch(() => null); // the people inside may need the women's body
      if (!ticket.alive) return;
      if (!pack) throw new Error('The furniture pack could not be loaded');
      // A room this build cannot read is quarantined (world/savedRecords.js), never replaced by an empty one
      const session = openInteriorSession(this.ctx.world.state, this.route.planet, door, floor);
      this.interiorRecord = session.record;
      this.interiorArgs = {
        building: door.b,
        pack,
        character: this.character,
        modern: this.layout.modern,
        seed: seedFor(this.layout.seed, door.b.id, 'interior-v1'),
        layoutVersion: session.legacy ? 1 : 2,
        night: this.night || 0,
        shadows: this.ctx.engine.quality.settings.shadows
      };
      const inside = new Interior({...this.interiorArgs, floor: session.floor, state: session.snapshot});
      this.interior = inside;
      this.interiorStateKey = session.key;
      this.interiorDoor = door;
      this.outside = { x: this.player.x, z: this.player.z };
      if (this.avatar) inside.scene.add(this.avatar.root);
      Object.assign(this.player, { x: inside.spawn.x, z: inside.spawn.z, y: 0, yaw: inside.spawn.yaw, speed: 0, jump: 0, vy: 0 });
      this.pose = null;
      this.follow.yaw = inside.spawn.yaw + Math.PI;
      this.follow.pitch = 0.85;
      this.follow.dist = 7.5 * Math.max(1, Math.max(inside.W, inside.D * 1.3) / 10); // big rooms pull the camera back
      this.camera.near = 0.1;
      this.camera.fov = 48;
      this.camera.updateProjectionMatrix();
      this.snapInteriorCamera();
      this.view = 'interior';
      this.hud.setView('interior');
      this.hud.setInteriorFloor(inside.floor,inside.blueprint?.floors||1);
      this.ctx.engine.post.configure('interior', { boost: 0 });
      this.ctx.audio?.setScene('interior');
      for (const it of inside.interactables) {
        if (it.kind === 'media' && it.on) it.radio ? this.ctx.audio?.radio(true) : this.ctx.audio?.tv(true);
        if (it.kind === 'fire' && it.on) this.ctx.audio?.fire(true);
      }
      this.ctx.tips?.show('interior');
      this.minimap.show(false);
      this.ctx.audio?.sfx('door');
      this.ui.classList.add('is-inside');
      this.saveInterior();
      this.saveInteriorLocation();
      this.journeyTown?.opened(door.b.id, this.interiorRecord.floors, inside.lampState());
      if (session.quarantined) this.showHomeMessage(tr('save.quarantined'));
      ticket.end();
      this.ctx.missions?.emit('enter_house');
      await overlay.reveal({ duration: 420 });
    });
  }

  async exitBuilding() {
    if (!this.interior || this.transitions.busy) return;
    return this.transition(async (ticket) => {
      this.hud.setPrompt(null);
      const overlay = this.ctx.overlay;
      await overlay.cover('fade', { duration: 280 });
      if (!ticket.alive) return; // exit() already saved and disposed the room
      const d = this.interiorDoor;
      this.saveInterior();
      if (this.avatar) this.scene.add(this.avatar.root);
      this.interior.dispose();
      this.interior = null;
      this.journeyTown?.closed();
      this.ctx.world.state.set('playerLocation', null);
      this.pose = null;
      this.placePlayer(d.x + Math.sin(d.outYaw) * 0.6, d.z + Math.cos(d.outYaw) * 0.6);
      this.player.yaw = d.outYaw;
      this.follow.yaw = d.outYaw + Math.PI;
      this.follow.pitch = 0.32;
      this.follow.dist = 6.5;
      this.camera.near = 0.3;
      this.camera.fov = STREET_FOV;
      this.camera.updateProjectionMatrix();
      this.view = 'walk';
      this.hud.setView('walk');
      if (this.pixelActive) {
        this.pixel.setActive(true); this.pixel.setView('walk'); this.follow.yaw = PIXEL_YAW; this.pixel.update(0, true);
        this.hud.setStyle(this.townStyle, this.pixel.rig.levels.walk);
      }
      this.ctx.engine.post.configure('town');
      this.minimap.show(true);
      this.ctx.audio?.stopRoom();
      this.ctx.audio?.setScene('town', { modern: this.layout.modern });
      this.ctx.audio?.sfx('door');
      this.ui.classList.remove('is-inside');
      ticket.end();
      await overlay.reveal({ duration: 420 });
    });
  }

  /** Sit / sleep poses, the bed skipping the night, and everything else the interior does. */
  async useInterior(it) {
    const inside = this.interior;
    const p = this.player;
    if (this.pose) {
      // Standing up (or waking up) from a seat or a bed
      const back = this.pose.stand;
      this.pose = null;
      p.x = back.x;
      p.z = back.z;
      return;
    }
    const before = this.journeyTown && inside.snapshot();
    const r = inside.use(it, p);
    this.saveInterior();
    this.journeyTown?.used({ buildingId: this.interiorDoor.b.id, floor: inside.floor, before, after: inside.snapshot(), holding: inside.holding, lights: inside.lampState() });
    if (r.event) this.ctx.missions?.emit(r.event);
    if (r.action === 'exit') return this.exitBuilding();
    if (r.action === 'floor') return this.changeInteriorFloor(r.target);
    const audio = this.ctx.audio;
    if (r.action === 'radio_on') audio?.radio(true);
    else if (r.action === 'radio_off') audio?.radio(false);
    else if (it.kind === 'media') audio?.tv(it.on);
    else if (it.kind === 'fire') audio?.fire(it.on);
    else if (it.kind === 'light') audio?.sfx('switch');
    else if (it.kind === 'door') audio?.sfx('door');
    else if (r.action === 'hold') audio?.sfx('pickup');
    else if (r.action === 'drop') audio?.sfx('drop');
    else if (r.action === 'sit' || r.action === 'sleep') audio?.sfx('sit');
    if (r.action === 'sit') {
      this.pose = { name: 'sit', lift: 0, stand: { x: it.x + Math.sin(r.pose.yaw) * 0.6, z: it.z + Math.cos(r.pose.yaw) * 0.6 } };
      p.x = r.pose.x;
      p.z = r.pose.z;
      p.yaw = r.pose.yaw;
      p.speed = 0;
    } else if (r.action === 'sleep') {
      const b = r.pose;
      this.pose = { name: 'sleep', lift: -0.34, stand: { x: it.x, z: it.z } };
      p.x = b.x;
      p.z = b.z;
      p.yaw = b.yaw;
      p.speed = 0;
      // Lights out, skip to the morning, lights up
      const overlay = this.ctx.overlay;
      await this.transition(async (ticket) => {
        await overlay.cover('fade', { duration: 900 });
        if (!ticket.alive) return;
        this.ctx.world.skipTime(this.secondsToMorning());
        this.ctx.missions?.emit('sleep');
        await new Promise((res) => setTimeout(res, 500));
        if (!ticket.alive) return;
        ticket.end();
        await overlay.reveal({ duration: 1200 });
      });
    }
  }

  async changeInteriorFloor(floor) {
    if(this.transitions.busy || !this.interior?.blueprint || this.interior.holding || !Number.isInteger(floor) || floor<0 || floor>=this.interior.blueprint.floors)return;
    return this.transition(async (ticket) => {
      await this.ctx.overlay.cover('fade',{duration:180});
      if(!ticket.alive)return;
      this.saveInterior();
      const previous=this.interior;
      const next=new Interior({...this.interiorArgs,floor,state:this.interiorRecord.floors[floor]});
      if(this.avatar)next.scene.add(this.avatar.root);
      previous.dispose();
      this.interior=next;
      this.pose=null;
      Object.assign(this.player,{...next.spawn,y:0,speed:0,jump:0,vy:0});
      this.snapInteriorCamera();
      this.ctx.audio?.stopRoom();
      for(const it of next.interactables)if(it.kind==='media'&&it.on)it.radio?this.ctx.audio?.radio(true):this.ctx.audio?.tv(true);
      this.hud.setInteriorFloor(floor,next.blueprint.floors);
      this.saveInterior();
      this.saveInteriorLocation();
      ticket.end();
      await this.ctx.overlay.reveal({duration:220});
    });
  }

  snapInteriorCamera() {
    const p=this.player,f=this.follow;
    const look=new THREE.Vector3(p.x*.6,1,p.z*.6);
    this.camera.position.set(Math.sin(f.yaw)*Math.cos(f.pitch),Math.sin(f.pitch),Math.cos(f.yaw)*Math.cos(f.pitch)).multiplyScalar(f.dist).add(look);
    this.camera.lookAt(look);
  }

  saveInteriorLocation() {
    this.ctx.world.state.set('playerLocation', { planet:this.route.planet, city:this.route.city, buildingId:this.interiorDoor.b.id, floor:this.interior.floor });
  }

  async restoreInteriorLocation(saved) {
    if(!saved || saved.planet!==this.route.planet || saved.city!==this.route.city)return;
    const door=this.doors.find(d=>d.b.id===saved.buildingId);
    if(door)await this.enterBuilding(door,{floor:saved.floor});
  }

  /** How long until the sun is up again at this city (past the coming night if it is day now). */
  secondsToMorning() {
    const w = this.ctx.world;
    const now = w.now();
    let sawNight = w.sunAt(this.route.planet, this.layout.frame, now).y < -0.05;
    for (let s = 10; s < 4000; s += 10) {
      const e = w.sunAt(this.route.planet, this.layout.frame, now + s).y;
      if (e < -0.05) sawNight = true;
      if (sawNight && e > 0.2) return s;
    }
    return 0;
  }

  updateInterior(dt, t) {
    const inside = this.interior;
    const p = this.player;
    if (!this.pose && !this.fading) {
      const i = this.intent();
      const f = this.follow;
      const fx = -Math.sin(f.yaw);
      const fz = -Math.cos(f.yaw);
      let mx = fx * i.forward - fz * i.right;
      let mz = fz * i.forward + fx * i.right;
      const len = Math.hypot(mx, mz);
      if (len > 0.01) {
        mx /= Math.max(1, len);
        mz /= Math.max(1, len);
        let d = Math.atan2(mx, mz) - p.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        p.yaw += d * (1 - Math.exp(-dt * 12));
        p.speed = THREE.MathUtils.lerp(p.speed, (i.run ? 3.4 : 1.5) * Math.min(1, len), 1 - Math.exp(-dt * 8));
      } else p.speed = THREE.MathUtils.lerp(p.speed, 0, 1 - Math.exp(-dt * 10));
      const r = inside.colliders.resolve(p.x + Math.sin(p.yaw) * p.speed * dt, p.z + Math.cos(p.yaw) * p.speed * dt, 0.32);
      p.x = THREE.MathUtils.clamp(r.x, -inside.W / 2 + 0.3, inside.W / 2 - 0.3);
      p.z = THREE.MathUtils.clamp(r.z, -inside.D / 2 + 0.3, inside.D / 2 - 0.2);
    } else p.speed = 0;
    p.y = 0;
    p.phase += dt * (p.speed * 3.1 + 0.6);
    // Dollhouse camera: high, looking down over the player; walls in the way hide themselves
    const f = this.follow;
    const look = _v.set(p.x * 0.6, 1.0, p.z * 0.6);
    const pos = new THREE.Vector3(Math.sin(f.yaw) * Math.cos(f.pitch), Math.sin(f.pitch), Math.cos(f.yaw) * Math.cos(f.pitch)).multiplyScalar(f.dist).add(look);
    this.camera.position.lerp(pos, 1 - Math.exp(-dt * 8));
    this.camera.lookAt(look);
    inside.update(dt, t, this.camera, p);
    // Prompt: the thing you are standing at
    let text = null;
    if (this.pose) text = tr(this.pose.name === 'sleep' ? 'town.prompt.wake' : 'town.prompt.stand');
    else if (!this.fading) text = inside.promptFor(inside.nearest(p.x, p.z));
    this.hud.setPrompt(text, 'E');
  }

  // ------------------------------------------------------------------ vehicles

  saveInterior() {
    if (!this.interior || !this.interiorStateKey) return;
    storeInterior(this.ctx.world.state, { key: this.interiorStateKey, record: this.interiorRecord }, this.interior);
  }
}
