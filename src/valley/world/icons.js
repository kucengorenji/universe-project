import * as THREE from 'three';

// Reaction icons over heads (docs/FARM_PLAN.md §5.4): one painted language for feedback —
// heart (happy), alert (startled), note (pleased), zzz (asleep), dots (thinking). A soft cream
// bubble with an ink rim, drawn once per kind on a canvas; they pop in, float up and fade.

const KINDS = {
  heart: (c) => { c.fillStyle = '#e8574d'; c.beginPath(); c.moveTo(64, 92); c.bezierCurveTo(20, 62, 30, 26, 64, 46); c.bezierCurveTo(98, 26, 108, 62, 64, 92); c.fill(); },
  alert: (c) => { c.fillStyle = '#e0a51e'; c.fillRect(56, 26, 16, 48); c.beginPath(); c.arc(64, 90, 9, 0, Math.PI * 2); c.fill(); },
  note: (c) => { c.fillStyle = '#4f78b8'; c.beginPath(); c.ellipse(52, 86, 14, 11, -0.4, 0, Math.PI * 2); c.fill(); c.fillRect(62, 32, 7, 56); c.beginPath(); c.moveTo(66, 32); c.quadraticCurveTo(92, 40, 86, 62); c.quadraticCurveTo(84, 46, 66, 44); c.fill(); },
  zzz: (c) => { c.fillStyle = '#6a6aa8'; c.font = 'bold 34px "Barlow Condensed", sans-serif'; c.fillText('z', 40, 92); c.font = 'bold 44px "Barlow Condensed", sans-serif'; c.fillText('Z', 60, 70); },
  dots: (c) => { c.fillStyle = '#7a6656'; for (const x of [44, 64, 84]) { c.beginPath(); c.arc(x, 66, 8, 0, Math.PI * 2); c.fill(); } }
};

const textures = {};
function texture(kind) {
  if (textures[kind]) return textures[kind];
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const c = canvas.getContext('2d');
  c.fillStyle = '#fffaf0';
  c.strokeStyle = '#4a3626';
  c.lineWidth = 6;
  c.beginPath();
  c.arc(64, 60, 46, 0, Math.PI * 2);
  c.moveTo(52, 102);
  c.lineTo(64, 122);
  c.lineTo(76, 102);
  c.fill();
  c.stroke();
  c.beginPath();
  c.arc(64, 60, 43, 0, Math.PI * 2);
  c.fill();
  KINDS[kind](c);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return (textures[kind] = t);
}

export class Icons {
  constructor(scene) {
    this.scene = scene;
    this.live = [];
  }

  /** Show `kind` over `target` (an Object3D) for `seconds`, `height` metres above its origin. */
  show(target, kind, seconds = 1.4, height = 1.7) {
    // One icon per target at a time: a new one replaces the old
    for (const icon of this.live) if (icon.target === target) icon.t = icon.life;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture(kind), depthTest: false, transparent: true }));
    sprite.renderOrder = 10;
    this.scene.add(sprite);
    this.live.push({ sprite, target, kind, life: seconds, t: 0, height });
  }

  update(dt) {
    const at = new THREE.Vector3();
    for (const icon of this.live) {
      icon.t += dt;
      const k = icon.t / icon.life;
      icon.target.getWorldPosition(at);
      // Pop in with a small overshoot, float up, fade out over the last quarter
      const pop = Math.min(1, icon.t / 0.18), size = 0.42 * (pop < 1 ? pop * 1.15 : 1 + 0.15 * Math.max(0, 1 - (icon.t - 0.18) / 0.12));
      icon.sprite.scale.set(size, size, 1);
      icon.sprite.position.set(at.x, at.y + icon.height + k * 0.25, at.z);
      icon.sprite.material.opacity = k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1;
    }
    for (const icon of this.live.filter((i) => i.t >= i.life)) {
      this.scene.remove(icon.sprite);
      icon.sprite.material.dispose();
    }
    this.live = this.live.filter((i) => i.t < i.life);
  }
}
