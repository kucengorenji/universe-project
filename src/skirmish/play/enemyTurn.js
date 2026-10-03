import * as THREE from 'three';
import { planAction } from '../game/ai.js';
import { DIFFICULTY, WEAPONS } from '../game/rules.js';

// The enemy's turn played out in 3D: the AI plans one action at a time; the unit walks its
// path (the player's soldiers intercept), takes its stance, turns and fires, and the camera
// follows it. Holding Space plays it faster.

const WALK = 4.0;
const TANK = 3.2;

export class EnemyTurn {
  constructor(game) {
    this.game = game;
    this.focus = null;
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this.ready = false;
  }

  async run() {
    const game = this.game;
    const b = game.battle;
    this.running = true;
    this.ready = false;
    while (!b.over && game.phase === 'enemy') {
      await game.wait(0.05); // let a frame through before thinking
      const plan = planAction(b, game.arena);
      if (!plan) break;
      const u = plan.unit;
      b.select(u);
      game.hud.update();
      this.focus = u;
      await game.wait(0.3);
      u.stance = 'stand';
      await this.walk(u, plan.path);
      if (u.state === 'ok') {
        if (plan.stance === 'crouch') u.stance = 'crouch';
        const t = plan.target;
        if (t && t.state === 'ok' && b.canFire(u) && game.arena.sees(u, t)) await this.attack(u, t);
      }
      this.moving = null;
      b.endAction(u);
      game.hud.update();
      await game.wait(0.35);
    }
    this.running = false;
    this.focus = null;
    if (game.phase === 'enemy') game.endEnemyTurn();
  }

  /** Walk (or drive) a path at a steady speed; interception happens in the game loop meanwhile. */
  walk(u, path) {
    const speed = u.kind === 'tank' ? TANK : WALK;
    return new Promise((resolve) => {
      let k = 0;
      this.moving = u;
      this.step = (dt) => {
        if (u.state !== 'ok' || k >= path.length) {
          this.step = null;
          this.moving = null;
          resolve();
          return;
        }
        const [tx, tz] = path[k];
        const dx = tx - u.x, dz = tz - u.z, d = Math.hypot(dx, dz);
        const s = speed * dt;
        const want = Math.atan2(dx, dz);
        u.yaw += Math.atan2(Math.sin(want - u.yaw), Math.cos(want - u.yaw)) * (1 - Math.exp(-dt * (u.kind === 'tank' ? 3 : 12)));
        if (d <= s) {
          u.x = tx;
          u.z = tz;
          k++;
        } else {
          u.x += (dx / d) * s;
          u.z += (dz / d) * s;
        }
        this.game.battle.touch(u);
      };
    });
  }

  async attack(u, t) {
    const game = this.game;
    const D = DIFFICULTY[game.battle.difficulty];
    const p = game.arena.aimPoint(t);
    this.aimTarget = t;
    game.views.aimAt(u, p, 2.2);
    await game.wait(0.6);
    if (u.state !== 'ok' || t.state !== 'ok') return;
    game.battle.useAmmo(u);
    const W = WEAPONS[u.weapon];
    await game.combat.burst(u, { point: game.arena.aimPoint(t) }, { spreadMul: 1 / D.accuracy });
    await game.wait(W.splash ? 0.8 : 0.4);
    this.aimTarget = null;
  }

  /** Per-frame: advance the walk, and chase the acting unit with the camera. */
  update(dt) {
    this.step?.(dt);
    const cam = this.game.camera;
    const u = this.focus;
    if (!u) return;
    const g = this.game.arena.ground(u.x, u.z);
    let pos, look;
    if (this.aimTarget) {
      // over the shooter's shoulder toward the target
      const t = this.aimTarget;
      const dx = t.x - u.x, dz = t.z - u.z, L = Math.hypot(dx, dz) || 1;
      const back = u.kind === 'tank' ? 9 : 3.2;
      pos = new THREE.Vector3(u.x - (dx / L) * back - (dz / L) * 1.2, g + (u.kind === 'tank' ? 5 : 2.2), u.z - (dz / L) * back + (dx / L) * 1.2);
      look = new THREE.Vector3(t.x, this.game.arena.ground(t.x, t.z) + 1, t.z);
    } else {
      const back = u.kind === 'tank' ? 12 : 6.5;
      pos = new THREE.Vector3(u.x - Math.sin(u.yaw) * back, g + (u.kind === 'tank' ? 7 : 3.6), u.z - Math.cos(u.yaw) * back);
      look = new THREE.Vector3(u.x + Math.sin(u.yaw) * 4, g + 1, u.z + Math.cos(u.yaw) * 4);
    }
    pos.y = Math.max(pos.y, this.game.arena.ground(pos.x, pos.z) + 1);
    const k = this.ready ? 1 - Math.exp(-dt * 3) : 1;
    this.ready = true;
    this.camPos.lerp(pos, k);
    this.camLook.lerp(look, k);
    cam.position.copy(this.camPos);
    cam.lookAt(this.camLook);
    if (Math.abs(cam.fov - 50) > 0.01) {
      cam.fov = 50;
      cam.updateProjectionMatrix();
    }
  }
}
