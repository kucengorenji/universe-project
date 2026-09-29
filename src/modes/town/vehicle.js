import * as THREE from 'three';

// Arcade car physics in the spirit of GTA: weight transfer you can see, grip
// that lets go under the handbrake, speed-sensitive steering, suspension that
// follows the ground, and collisions that bounce instead of stopping dead.
//
// Frame: yaw is three.js rotation.y; forward = (sin yaw, cos yaw), right =
// (-cos yaw, sin yaw) in x/z (right-hand, looking along forward).

export const VEHICLE_TYPES = {
  sedan: { top: 26, accel: 11, brake: 22, reverse: 7, grip: 7.5, drift: 1.4, wheelbase: 2.7, steer: 0.62, length: 4.4, width: 1.9, mass: 1 },
  hatch: { top: 23, accel: 12, brake: 22, reverse: 7, grip: 8.5, drift: 1.6, wheelbase: 2.4, steer: 0.68, length: 3.9, width: 1.8, mass: 0.85 },
  suv: { top: 24, accel: 9.5, brake: 19, reverse: 6, grip: 6.5, drift: 1.2, wheelbase: 2.9, steer: 0.55, length: 4.7, width: 2.0, mass: 1.3 },
  van: { top: 20, accel: 7.5, brake: 17, reverse: 5, grip: 6, drift: 1.1, wheelbase: 3.1, steer: 0.52, length: 5.0, width: 2.0, mass: 1.5 },
  bus: { top: 16, accel: 4.5, brake: 12, reverse: 3, grip: 5.5, drift: 1.0, wheelbase: 6.2, steer: 0.5, length: 11, width: 2.6, mass: 3 },
  sport: { top: 38, accel: 16, brake: 28, reverse: 8, grip: 9, drift: 1.8, wheelbase: 2.6, steer: 0.6, length: 4.4, width: 1.95, mass: 0.9 },
  pickup: { top: 25, accel: 10, brake: 19, reverse: 6, grip: 6.8, drift: 1.3, wheelbase: 3.2, steer: 0.55, length: 5.3, width: 1.95, mass: 1.3 },
  police: { top: 34, accel: 14, brake: 26, reverse: 8, grip: 8.5, drift: 1.6, wheelbase: 2.7, steer: 0.62, length: 4.5, width: 1.85, mass: 1 },
  // Horse-drawn: the horses walk ahead of the body, so the collision length covers them
  cart: { top: 8, accel: 3.2, brake: 7, reverse: 2, grip: 9, drift: 3, wheelbase: 2.2, steer: 0.7, length: 6.2, width: 1.8, mass: 1.2 },
  wagon: { top: 7.5, accel: 3, brake: 6.5, reverse: 1.8, grip: 9, drift: 3, wheelbase: 2.6, steer: 0.62, length: 7.0, width: 2.1, mass: 1.5 },
  caravan: { top: 7, accel: 2.8, brake: 6, reverse: 1.8, grip: 9, drift: 3, wheelbase: 2.6, steer: 0.62, length: 7.2, width: 2.2, mass: 1.6 }
};

const _v = new THREE.Vector3();

export class Car {
  constructor(spec, { x = 0, z = 0, yaw = 0 } = {}) {
    this.spec = spec;
    this.x = x;
    this.z = z;
    this.y = 0;
    this.yaw = yaw;
    this.vx = 0;
    this.vz = 0;
    this.yawRate = 0;
    this.steer = 0;
    this.pitch = 0;
    this.roll = 0;
    this.pitchV = 0;
    this.rollV = 0;
    this.bob = 0;
    this.bobV = 0;
    this.throttle = 0;
    this.skid = 0; // 0..1, for smoke / tyre sound
    this.impact = 0; // last collision strength (camera shake, sound)
    this.wheelSpin = 0;
  }

  get forwardSpeed() {
    return this.vx * Math.sin(this.yaw) + this.vz * Math.cos(this.yaw);
  }

  get speed() {
    return Math.hypot(this.vx, this.vz);
  }

  /**
   * input: { forward (-1..1), right (-1..1), handbrake, boost }
   * world: { heightAt(x, z), resolve(x, z, r) -> {x, z}, blocked(x, z) -> bool }
   */
  update(dt, input, world) {
    if(!Number.isFinite(dt)||dt<=0)return this;
    // Stable suspension/contact response at 30, 60 and 120 Hz.
    if(dt>1/90){const steps=Math.ceil(Math.min(dt,.12)/(1/120)),step=Math.min(dt,.12)/steps;for(let i=0;i<steps;i++)this.update(step,input,world);return this;}
    const S = this.spec;
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    const rx = -Math.cos(this.yaw);
    const rz = Math.sin(this.yaw);
    let vF = this.vx * fx + this.vz * fz;
    let vR = this.vx * rx + this.vz * rz;

    // Longitudinal: engine (fading near top speed), brakes, reverse, drag
    const top = S.top * (input.boost ? 1.25 : 1);
    let a = 0;
    if (input.forward > 0) {
      if (vF < -0.5) a = S.brake * input.forward;
      else a = S.accel * input.forward * Math.max(0, 1 - (Math.max(0, vF) / top)**2) * (input.boost ? 1.3 : 1);
    } else if (input.forward < 0) {
      if (vF > 0.5) a = -S.brake * -input.forward;
      else a = -S.reverse * -input.forward * Math.max(0, 1 + Math.min(0, vF) / (top * 0.3));
    }
    this.throttle = THREE.MathUtils.lerp(this.throttle, Math.abs(input.forward), 1 - Math.exp(-dt * 6));
    a -= vF * Math.abs(vF) * 0.0015 + vF * 0.055;
    if (!input.forward && Math.abs(vF) < 0.4) vF *= Math.exp(-dt * 8);
    if (input.handbrake) a -= Math.sign(vF) * Math.min(Math.abs(vF) / dt, 6);
    vF += a * dt;
    this.accel = a;

    // Steering: less lock at speed, returns to centre on its own
    const lock = S.steer / (1 + Math.abs(vF) * 0.045);
    this.steer = THREE.MathUtils.lerp(this.steer, input.right * lock, 1 - Math.exp(-dt * (input.right ? 11 : 15)));
    // Positive yaw turns toward local +X, which is the car's left: steering right means negative
    const turnLimit=(input.handbrake?14:9)/(Math.abs(vF)+2);
    const targetRate = THREE.MathUtils.clamp(-(vF / S.wheelbase) * Math.tan(this.steer),-turnLimit,turnLimit);
    const grip = input.handbrake ? S.drift : S.grip;
    // The rear steps out under the handbrake: yaw follows the wheels less tightly
    this.yawRate = THREE.MathUtils.lerp(this.yawRate, targetRate, 1 - Math.exp(-dt * grip * 1.6));
    this.yaw += this.yawRate * dt;

    // Lateral grip: sideways velocity bleeds off (slowly when drifting)
    const lateral = vR;
    vR *= Math.exp(-dt * grip * (0.6 + Math.min(1, Math.abs(vF) / 10) * 0.4));
    this.skid = THREE.MathUtils.clamp(Math.abs(lateral) / 4 + (input.handbrake && Math.abs(vF) > 4 ? 0.4 : 0), 0, 1);

    const nfx = Math.sin(this.yaw);
    const nfz = Math.cos(this.yaw);
    const nrx = -Math.cos(this.yaw);
    const nrz = Math.sin(this.yaw);
    this.vx = nfx * vF + nrx * vR;
    this.vz = nfz * vF + nrz * vR;

    // Move, then collide: bounce off what we hit, lose speed with the hit
    const px = this.x + this.vx * dt;
    const pz = this.z + this.vz * dt;
    const r = S.width * 0.55;
    const half = S.length * 0.32;
    let nx = px;
    let nz = pz;
    let hit = 0;
    let hx = 0;
    let hz = 0;
    for (const s of [-1, 1]) {
      // Two circles along the body (front and rear axle)
      const cx = nx + nfx * half * s;
      const cz = nz + nfz * half * s;
      const res = world.resolve(cx, cz, r);
      const dx = res.x - cx;
      const dz = res.z - cz;
      if (dx || dz) {
        nx += dx;
        nz += dz;
        hx += dx;
        hz += dz;
        hit += Math.hypot(dx, dz);
      }
    }
    if (world.blocked(nx, nz)) {
      nx = this.x;
      nz = this.z;
      hx = -this.vx;
      hz = -this.vz;
      hit = 1;
    }
    this.impact = 0;
    if (hit > 0) {
      const l = Math.hypot(hx, hz) || 1;
      const n = [hx / l, hz / l];
      const into = this.vx * n[0] + this.vz * n[1];
      if (into < 0) {
        // Reflect the part of the velocity going into the obstacle, keep some of the slide
        this.impact = Math.min(1, -into / 15);
        this.vx -= (1 + 0.3) * into * n[0];
        this.vz -= (1 + 0.3) * into * n[1];
        this.vx *= 0.9;
        this.vz *= 0.9;
        this.yawRate *= .6;
      }
    }
    this.x = nx;
    this.z = nz;

    // Suspension: body follows the ground under the four wheels, with springs
    const L2 = S.wheelbase / 2;
    const W2 = S.width / 2 - 0.1;
    const h = (f, s) => world.heightAt(this.x + nfx * f * L2 + nrx * s * W2, this.z + nfz * f * L2 + nrz * s * W2);
    const hFL = h(1, -1);
    const hFR = h(1, 1);
    const hRL = h(-1, -1);
    const hRR = h(-1, 1);
    const ground = (hFL + hFR + hRL + hRR) / 4;
    const slopePitch = Math.atan2((hFL + hFR - hRL - hRR) / 2, S.wheelbase);
    const slopeRoll = Math.atan2((hFR + hRR - hFL - hRL) / 2, S.width);
    // Weight transfer: nose dives when braking, squats when accelerating, leans out of corners
    const long = a / 30;
    const latAcc = vF * this.yawRate;
    const spring = (val, vel, target, k, d) => {
      const acc = (target - val) * k - vel * d;
      vel += acc * dt;
      return [val + vel * dt, vel];
    };
    [this.pitch, this.pitchV] = spring(this.pitch, this.pitchV, slopePitch - THREE.MathUtils.clamp(long * 0.6, -0.05, 0.05), 60, 11);
    [this.roll, this.rollV] = spring(this.roll, this.rollV, slopeRoll - THREE.MathUtils.clamp(latAcc * 0.01, -0.07, 0.07), 55, 10);
    // Body lean never exceeds a few degrees beyond the ground slope
    this.pitch = THREE.MathUtils.clamp(this.pitch, slopePitch - 0.09, slopePitch + 0.09);
    this.roll = THREE.MathUtils.clamp(this.roll, slopeRoll - 0.09, slopeRoll + 0.09);
    [this.bob, this.bobV] = spring(this.bob, this.bobV, 0, 80, 10);
    if (Math.abs(ground - this.y) > 0.05 && this.y) this.bobV -= (ground - this.y) * 2;
    this.y = ground;
    this.wheelSpin += vF * dt / 0.36;
    return this;
  }

  /** Pose an Object3D (model origin on the ground, front +Z). */
  apply(obj) {
    obj.position.set(this.x, this.y + this.bob, this.z);
    obj.rotation.set(-this.pitch, this.yaw, this.roll, 'YXZ');
  }
}

/**
 * GTA-style chase camera: sits behind the direction of travel, lags a little,
 * pulls back and widens with speed, shakes on impacts, and lets the player
 * look around (then drifts back behind the car).
 */
export class ChaseCamera {
  constructor(camera) {
    this.camera = camera;
    this.yaw = 0;
    this.pitch = 0.22;
    this.lookYaw = 0; // player offset
    this.lookPitch = 0;
    this.lastLook = -10;
    this.pos = new THREE.Vector3();
    this.shake = 0;
    this.baseFov = camera.fov;
  }

  update(dt, t, car, heightAt, { dist = 7, height = 2.2 } = {}) {
    const speed = car.speed;
    // Follow the velocity when moving fast (drifts show), the nose when slow
    const velYaw = Math.atan2(car.vx, car.vz);
    const heading = speed > 4 && car.forwardSpeed > 0 ? velYaw : car.yaw + (car.forwardSpeed < -2 ? Math.PI : 0);
    let d = heading - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * (1 - Math.exp(-dt * 5.5));
    if (t - this.lastLook > 1.6) {
      this.lookYaw *= Math.exp(-dt * 2.5);
      this.lookPitch *= Math.exp(-dt * 2.5);
    }
    const yaw = this.yaw + this.lookYaw + Math.PI;
    const pitch = THREE.MathUtils.clamp(this.pitch + this.lookPitch, -0.1, 1.2);
    const far = dist * (1 + Math.min(0.5, speed / 60));
    const target = _v.set(car.x, car.y + height * 0.6, car.z);
    const want = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(far).add(target);
    want.y += height * 0.4;
    const floor = heightAt(want.x, want.z) + 0.8;
    if (want.y < floor) want.y = floor;
    if (!this.init) {
      this.pos.copy(want);
      this.init = true;
    }
    this.pos.lerp(want, 1 - Math.exp(-dt * 7));
    this.shake = Math.max(this.shake * Math.exp(-dt * 6), car.impact);
    const cam = this.camera;
    cam.position.copy(this.pos);
    if (this.shake > 0.01) {
      cam.position.x += (Math.random() - 0.5) * this.shake * 0.6;
      cam.position.y += (Math.random() - 0.5) * this.shake * 0.4;
    }
    // Look a bit ahead of the car along its velocity
    const ahead = Math.min(4, speed * 0.16);
    cam.lookAt(target.x + Math.sin(velYaw) * ahead, target.y + 0.4, target.z + Math.cos(velYaw) * ahead);
    const fov = this.baseFov + Math.min(9, speed * 0.3);
    if (Math.abs(cam.fov - fov) > 0.1) {
      cam.fov += (fov - cam.fov) * (1 - Math.exp(-dt * 3));
      cam.updateProjectionMatrix();
    }
  }

  look(dx, dy, t) {
    this.lookYaw -= dx * 0.006;
    this.lookPitch = THREE.MathUtils.clamp(this.lookPitch + dy * 0.004, -0.3, 0.9);
    this.lastLook = t;
  }

  reset(car) {
    this.yaw = car.yaw;
    this.init = false;
    this.lookYaw = 0;
    this.lookPitch = 0;
  }
}
