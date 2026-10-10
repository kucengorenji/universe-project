import * as THREE from 'three';

// Valley camera rig: the 3/4 follow camera of docs/FARM_PLAN.md §1, now free to orbit and pan.
//   Left drag (one finger): orbit — yaw free, pitch kept between a low 3/4 and near top-down.
//   Right / middle drag, Shift + left drag (two fingers): pan over the ground.
//   Wheel (pinch): zoom. Q/E snap the yaw to the next quarter turn. F recentres on the player.
// A pan holds while the player stands still and eases back once they walk, so the camera
// never loses them. No pointer lock: the app's browser pane refuses it.

const MIN_PITCH = THREE.MathUtils.degToRad(18), MAX_PITCH = THREE.MathUtils.degToRad(74);
const MIN_DIST = 7, MAX_DIST = 46, MAX_PAN = 38;
const QUARTER = Math.PI / 2;

export class ValleyCamera {
  /** blocked(x, y, z): true inside something the camera must not pass through (buildings). */
  constructor(camera, dom, heightAt = null, blocked = null) {
    this.blocked = blocked;
    this.reach = 1; // fraction of the distance the camera can actually back off to
    this.camera = camera;
    this.dom = dom;
    this.heightAt = heightAt; // a panned view rests on the ground under it, not at the player's height
    this.yaw = this.yawTarget = 0;
    this.pitch = this.pitchTarget = THREE.MathUtils.degToRad(40);
    this.distance = this.distanceTarget = 19;
    this.pan = new THREE.Vector3();
    this.panTarget = new THREE.Vector3();
    this.focus = new THREE.Vector3();
    this.pointers = new Map();
    this.dragging = false;
    this.bind();
  }

  /** Ground directions of the current view: right, and forward (away from the camera). */
  axes(yaw = this.yaw) {
    return { right: new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)), forward: new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)) };
  }

  snap(dir) {
    this.yawTarget = (Math.round(this.yawTarget / QUARTER) + dir) * QUARTER;
  }

  recenter() {
    this.panTarget.set(0, 0, 0);
  }

  zoom(factor) {
    this.distanceTarget = THREE.MathUtils.clamp(this.distanceTarget * factor, MIN_DIST, MAX_DIST);
  }

  orbit(dx, dy) {
    this.yawTarget -= dx * 0.0055;
    this.pitchTarget = THREE.MathUtils.clamp(this.pitchTarget + dy * 0.0045, MIN_PITCH, MAX_PITCH);
  }

  /** Drag the ground under the pointer: metres per pixel at the focus distance. */
  drag(dx, dy) {
    const h = this.dom.clientHeight || innerHeight;
    const k = (2 * this.distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / h;
    const { right, forward } = this.axes();
    this.panTarget.addScaledVector(right, -dx * k).addScaledVector(forward, (dy * k) / Math.max(0.35, Math.sin(this.pitch)));
    if (this.panTarget.length() > MAX_PAN) this.panTarget.setLength(MAX_PAN);
  }

  bind() {
    const dom = this.dom;
    const down = (e) => {
      dom.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button, shift: e.shiftKey });
      this.dragging = true;
      this.pinch = null;
    };
    const move = (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      if (this.pointers.size >= 2) {
        // Two fingers: the midpoint pans, the spread zooms
        p.x = e.clientX;
        p.y = e.clientY;
        const [a, b] = [...this.pointers.values()];
        const spread = Math.hypot(a.x - b.x, a.y - b.y), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (this.pinch) {
          this.drag(mid.x - this.pinch.mid.x, mid.y - this.pinch.mid.y);
          if (spread > 10 && this.pinch.spread > 10) this.zoom(this.pinch.spread / spread);
        }
        this.pinch = { spread, mid };
        return;
      }
      p.x = e.clientX;
      p.y = e.clientY;
      const panning = p.button === 2 || p.button === 1 || p.shift || e.shiftKey;
      if (panning) this.drag(dx, dy);
      else this.orbit(dx, dy);
    };
    const up = (e) => {
      this.pointers.delete(e.pointerId);
      this.pinch = null;
      this.dragging = this.pointers.size > 0;
    };
    const wheel = (e) => {
      e.preventDefault();
      // Trackpad pinch arrives as ctrl+wheel with small deltas; mouse wheels as large steps
      const step = e.ctrlKey ? e.deltaY * 0.01 : Math.sign(e.deltaY) * 0.1;
      this.zoom(1 + step);
    };
    const menu = (e) => e.preventDefault();
    dom.style.touchAction = 'none';
    dom.addEventListener('pointerdown', down);
    dom.addEventListener('pointermove', move);
    dom.addEventListener('pointerup', up);
    dom.addEventListener('pointercancel', up);
    dom.addEventListener('wheel', wheel, { passive: false });
    dom.addEventListener('contextmenu', menu);
    this.unbind = () => {
      dom.removeEventListener('pointerdown', down);
      dom.removeEventListener('pointermove', move);
      dom.removeEventListener('pointerup', up);
      dom.removeEventListener('pointercancel', up);
      dom.removeEventListener('wheel', wheel);
      dom.removeEventListener('contextmenu', menu);
    };
  }

  /** Jump straight to the targets (QA fixtures, first frame). */
  settle(target) {
    this.yaw = this.yawTarget;
    this.pitch = this.pitchTarget;
    this.distance = this.distanceTarget;
    this.pan.copy(this.panTarget);
    this.focus.copy(target);
    this.snap = true;
    this.update(0, target, false);
  }

  update(dt, target, moving) {
    const ease = (rate) => 1 - Math.exp(-dt * rate);
    if (moving && !this.dragging) this.panTarget.multiplyScalar(Math.exp(-dt * 2.5));
    this.yaw += (this.yawTarget - this.yaw) * ease(12);
    this.pitch += (this.pitchTarget - this.pitch) * ease(12);
    this.distance += (this.distanceTarget - this.distance) * ease(10);
    this.pan.lerp(this.panTarget, ease(12));
    this.focus.lerp(target, ease(5));
    const look = new THREE.Vector3(0, 0.8, 0).add(this.focus).add(this.pan);
    if (this.heightAt) look.y += (this.heightAt(look.x, look.z) + 0.8 - look.y) * Math.min(1, this.pan.length() / 4);
    // Pull in ahead of any building between the focus and the camera; ease back out once clear
    const c = Math.cos(this.pitch), dir = new THREE.Vector3(Math.sin(this.yaw) * c, Math.sin(this.pitch), Math.cos(this.yaw) * c);
    let reach = 1;
    if (this.blocked) {
      for (let s = 0.6; s <= this.distance; s += 0.35) {
        if (this.blocked(look.x + dir.x * s, look.y + dir.y * s, look.z + dir.z * s)) {
          reach = Math.max(2.2, s - 0.6) / this.distance;
          break;
        }
      }
    }
    this.reach = this.snap ? reach : this.reach + (reach - this.reach) * ease(reach < this.reach ? 20 : 4);
    this.snap = false;
    const d = this.distance * this.reach;
    this.camera.position.copy(look).addScaledVector(dir, d);
    this.camera.lookAt(look);
    this.look = look;
  }
}
