import * as THREE from 'three';
import { JOURNEY_PALETTE } from '../../../art/palette.js';
import { t } from '../../../i18n/index.js';
import { onScreen, edgeAnchor, clearOfPanel } from './waypointMath.js';

// The home marker in the town: a small painted plaque (roof and body silhouette) hanging
// over the starter door with two arcs on the ground, a labelled badge on screen, and an
// arrow on the screen edge when the door is out of view or behind the camera. It only
// points; it has no collider, no click and no say in whether a step is done.
// World part: three meshes, shared geometry, unlit material (readable at night, no
// light, shadow or full-screen pass).

const HOUSE = [[-0.16, 0], [0.16, 0], [0.16, 0.17], [0, 0.34], [-0.16, 0.17]];
const DOOR_TOP = 2.1; // metres; the plaque hangs 0.25 m above the door
const AVOID = ['.minimap', '.speedo', '.interact-prompt', '.joystick', '.pause-toggle', '.journey-hud', '.topbar'];
const ICON = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M3 12 12 4l9 8v8H3z" fill="var(--journey-target)" stroke="var(--journey-outline)" stroke-width="2" stroke-linejoin="round"/></svg>`;
const CHEVRON = `<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M3 1l6 5-6 5" fill="none" stroke="var(--journey-outline)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const houseShape = (grow = 0) => {
  const shape = new THREE.Shape();
  HOUSE.forEach(([x, y], i) => {
    const px = x * (1 + grow), py = 0.17 + (y - 0.17) * (1 + grow);
    if (i) shape.lineTo(px, py); else shape.moveTo(px, py);
  });
  shape.closePath();
  return shape;
};

export class TownWaypoint {
  constructor({ scene, parent, groundAt, reducedMotion = false }) {
    this.scene = scene;
    this.groundAt = groundAt;
    this.reducedMotion = reducedMotion;
    this.target = null;
    this.night = 0;
    this.wasOn = false;
    this.avoid = [];
    this.avoidAt = -1;
    this.geometry = { face: new THREE.ShapeGeometry(houseShape()), outline: new THREE.ShapeGeometry(houseShape(0.22)), arcs: this.makeArcs() };
    const basic = (color, extra = {}) => new THREE.MeshBasicMaterial({ color, toneMapped: false, side: THREE.DoubleSide, transparent: true, ...extra });
    this.material = { face: basic(JOURNEY_PALETTE.target), outline: basic(JOURNEY_PALETTE.outline), arcs: basic(JOURNEY_PALETTE.edge, { opacity: 0.9 }) };
    this.group = new THREE.Group();
    this.group.visible = false;
    this.plaque = new THREE.Group();
    const outline = new THREE.Mesh(this.geometry.outline, this.material.outline);
    outline.position.z = -0.012;
    this.plaque.add(outline, new THREE.Mesh(this.geometry.face, this.material.face));
    this.ground = new THREE.Mesh(this.geometry.arcs, this.material.arcs);
    this.ground.rotation.x = -Math.PI / 2;
    this.group.add(this.plaque, this.ground);
    scene.add(this.group);

    this.root = document.createElement('div');
    this.root.className = 'journey-wayfinding';
    this.root.innerHTML = `
      <div class="journey-pin" hidden>${ICON}<span>${t('journey.marker.home')}</span></div>
      <div class="journey-arrow" role="img" aria-label="${t('journey.marker.offscreen')}" hidden>${ICON}${CHEVRON}</div>`;
    parent.appendChild(this.root);
    this.pin = this.root.querySelector('.journey-pin');
    this.arrow = this.root.querySelector('.journey-arrow');
    this.chevron = this.arrow.querySelector('svg:last-of-type');
    this._p = new THREE.Vector3();
    this._c = new THREE.Vector3();
  }

  makeArcs() {
    const a = new THREE.RingGeometry(0.7, 0.735, 12, 1, -0.95, 0.8);
    const b = new THREE.RingGeometry(0.7, 0.735, 12, 1, Math.PI + 0.15, 0.8);
    const merged = new THREE.BufferGeometry();
    const positions = [...a.attributes.position.array, ...b.attributes.position.array];
    const offset = a.attributes.position.count;
    merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    merged.setIndex([...a.index.array, ...[...b.index.array].map((i) => i + offset)]);
    a.dispose();
    b.dispose();
    return merged;
  }

  /** { x, z, outYaw } of the door (town metres) or null to hide everything. */
  setTarget(target) {
    this.target = target;
    if (!target) return this.hide();
    const y = this.groundAt(target.x, target.z);
    this.anchor = { x: target.x, y, z: target.z };
    this.group.position.set(target.x, y, target.z);
    this.plaque.position.set(0, DOOR_TOP + 0.25, 0);
    this.plaque.rotation.y = target.outYaw;
    this.ground.position.y = 0.04;
    this.ground.rotation.z = target.outYaw;
    this.group.visible = true;
  }

  hide() {
    this.group.visible = false;
    this.pin.hidden = true;
    this.arrow.hidden = true;
    this.wasOn = false;
  }

  sampleAvoid(now) {
    if (now - this.avoidAt < 200) return;
    this.avoidAt = now;
    this.avoid = [];
    this.panel = null;
    for (const el of document.querySelectorAll(AVOID.join(','))) {
      if (el.closest('[hidden]') || el.hidden) continue;
      const r = el.getBoundingClientRect();
      if (r.width && r.height) this.avoid.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
      if (el.classList.contains('journey-hud') && r.width && r.height) this.panel = this.avoid.at(-1);
    }
  }

  /** At night the ground arcs glow in the target gold instead of the pale edge colour (no light, no extra mesh). */
  setNight(night) {
    this.night = night;
    this.material.arcs.color.set(JOURNEY_PALETTE.edge).lerp(this._gold ||= new THREE.Color(JOURNEY_PALETTE.target), night);
  }

  /** For QA: what is on screen and in what colour. */
  metrics() {
    return { visible: this.group.visible, badge: !this.pin.hidden, arrow: !this.arrow.hidden, night: this.night, arcs: `#${this.material.arcs.color.getHexString()}`, pulse: this.material.face.opacity, calls: 3 };
  }

  /** `active` is false while the marker should be silent (interior, journey finished, no starter door). */
  update(time, { camera, active }) {
    if (!this.target || !active) { if (this.group.visible || !this.pin.hidden || !this.arrow.hidden) this.hide(); return; }
    this.group.visible = true;
    const pulse = this.reducedMotion ? 1 : 0.925 + 0.075 * Math.sin((time * Math.PI * 2) / 2.4);
    this.material.face.opacity = this.material.outline.opacity = pulse;
    const width = window.innerWidth, height = window.innerHeight;
    const top = this._p.set(this.anchor.x, this.anchor.y + DOOR_TOP + 0.42, this.anchor.z);
    const cam = this._c.copy(top).applyMatrix4(camera.matrixWorldInverse);
    const behind = cam.z > 0;
    const ndc = behind ? null : top.clone().project(camera);
    const on = onScreen({ ndc, behind, width, height, wasOn: this.wasOn });
    this.wasOn = on;
    this.pin.hidden = !on;
    this.arrow.hidden = on;
    if (on) {
      this.sampleAvoid(performance.now());
      const x = (ndc.x * 0.5 + 0.5) * width;
      // the badge never sits under the objective bar: it drops below it (the objective is on screen, the door is the badge's job)
      const y = clearOfPanel({ x, y: (-ndc.y * 0.5 + 0.5) * height, width: 120, height: 32, panel: this.panel });
      this.pin.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`;
      return;
    }
    this.sampleAvoid(performance.now());
    const spot = edgeAnchor({ width, height, dir: { x: cam.x, y: -cam.y }, avoid: this.avoid });
    this.arrow.style.transform = `translate(${Math.round(spot.x)}px, ${Math.round(spot.y)}px) translate(-50%, -50%)`;
    this.chevron.style.transform = `rotate(${spot.angle}rad)`;
  }

  dispose() {
    this.scene.remove(this.group);
    Object.values(this.geometry).forEach((g) => g.dispose());
    Object.values(this.material).forEach((m) => m.dispose());
    this.root.remove();
  }
}
