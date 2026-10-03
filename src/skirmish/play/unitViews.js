import * as THREE from 'three';
import { makeSoldier, animateSoldier, disposeSoldier, kick, flinch, setLod } from '../units/vcSoldiers.js';

// 3D bodies for the battle's units: soldiers (one dressed NPC each), the tank (the field
// builder's model, moved here) and nothing extra for bunkers (static scenery). Each frame
// they follow the battle state: position, facing, speed (from how far they moved), stance,
// aim, and lying down when downed or dead.

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class UnitViews {
  constructor(scene, { templates, weapons, arena, tank, shadows, camera = null }) {
    this.scene = scene;
    this.camera = camera;
    this.arena = arena;
    this.views = new Map();
    this.templates = templates;
    this.weapons = weapons;
    this.tankModel = tank;
    this.shadows = shadows;
  }

  add(u) {
    const v = { unit: u, speed: 0, lx: u.x, lz: u.z, aim: false, aimYaw: 0, aimPitch: 0, aimHold: 0, look: null };
    if (u.kind === 'infantry') {
      v.body = makeSoldier(this.templates, this.weapons, { faction: u.side, cls: u.cls, seed: u.face, id: u.id, shadows: this.shadows });
      v.root = v.body.root;
      this.scene.add(v.root);
    } else if (u.kind === 'tank' && this.tankModel) {
      v.root = this.tankModel.group;
      v.turret = this.tankModel.turret;
      v.turretYaw = u.yaw;
    }
    this.views.set(u.id, v);
    return v;
  }

  get(id) {
    return this.views.get(id);
  }

  /**
   * Point a unit's weapon at a world point for `hold` seconds (aiming soldiers, the turret).
   * Infantry turns its body there as well.
   */
  aimAt(u, p, hold = 0.6) {
    const v = this.views.get(u.id);
    if (!v) return;
    const g = this.arena.ground(u.x, u.z);
    const yaw = Math.atan2(p.x - u.x, p.z - u.z);
    const eye = u.kind === 'infantry' ? g + (u.stance === 'crouch' ? 1.12 : 1.5) : g + 2.2;
    const pitch = Math.atan2(p.y - eye, Math.hypot(p.x - u.x, p.z - u.z));
    if (u.kind === 'infantry') u.yaw = yaw;
    v.look = { yaw, pitch };
    v.aimHold = hold;
  }

  /** A round fired: recoil. */
  kick(u) {
    const v = this.views.get(u.id);
    if (v?.body) kick(v.body);
  }

  /** A round struck: flinch. */
  flinch(u) {
    const v = this.views.get(u.id);
    if (v?.body && u.state === 'ok') flinch(v.body);
  }

  update(dt) {
    for (const v of this.views.values()) {
      const u = v.unit;
      if (!v.root) continue;
      const moved = Math.hypot(u.x - v.lx, u.z - v.lz);
      v.speed += ((dt > 0 ? moved / dt : 0) - v.speed) * (1 - Math.exp(-dt * 8));
      v.lx = u.x;
      v.lz = u.z;
      v.root.visible = u.state !== 'evac';
      const y = this.arena.ground(u.x, u.z);
      v.root.position.set(u.x, y, u.z);
      if (u.kind === 'tank') {
        v.root.rotation.y = u.yaw;
        if (v.look) v.turretYaw += wrap(v.look.yaw - v.turretYaw) * (1 - Math.exp(-dt * 3));
        v.turret.rotation.y = wrap(v.turretYaw - u.yaw);
        v.aimHold -= dt;
        if (v.aimHold <= 0) v.look = null;
        continue;
      }
      // the body turns smoothly to the unit's facing; turning on the spot takes small steps
      const dyaw = wrap(u.yaw - v.root.rotation.y) * (1 - Math.exp(-dt * 12));
      v.root.rotation.y += dyaw;
      const turnRate = dt > 0 ? dyaw / dt : 0;
      const stepping = Math.min(1.1, Math.abs(turnRate) * 0.5);
      v.aimHold -= dt;
      const aiming = v.aim || v.aimHold > 0;
      if (v.look) {
        v.body.aimYaw = wrap(v.look.yaw - v.root.rotation.y);
        v.body.aimPitch = v.look.pitch;
      }
      if (!aiming && v.aimHold <= 0) v.look = null;
      if (this.camera) setLod(v.body, this.camera.position.distanceTo(v.root.position));
      const lying = u.state === 'down' ? 'down' : u.state === 'dead' ? 'dead' : false;
      animateSoldier(v.body, dt, u.state === 'ok' ? Math.max(v.speed, stepping) : 0, { aim: aiming && u.state === 'ok', crouch: u.stance === 'crouch', down: lying, turn: turnRate });
    }
  }

  dispose() {
    for (const v of this.views.values()) if (v.body) disposeSoldier(v.body);
    this.views.clear();
  }
}
