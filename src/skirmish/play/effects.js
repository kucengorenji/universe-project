import * as THREE from 'three';

// Combat effects: tracers, muzzle flashes, dust puffs where rounds land, explosions, and
// floating words over the scene (damage, "KRITIS!", onomatopoeia) in a DOM layer.

const TRACER_LIFE = 0.09;

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,220,150,0.8)');
  grad.addColorStop(1, 'rgba(255,160,60,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Effects {
  constructor(scene, camera, layer) {
    this.scene = scene;
    this.camera = camera;
    this.layer = layer; // absolutely positioned DOM element over the canvas
    this.items = [];
    this.words = [];
    this.tex = glowTexture();
    this.flashMat = new THREE.SpriteMaterial({ map: this.tex, blending: THREE.AdditiveBlending, depthWrite: false, color: '#ffd38a', fog: false });
    this.dustMat = new THREE.SpriteMaterial({ map: this.tex, depthWrite: false, color: '#b9a888', transparent: true, fog: false });
    this.tracerMat = new THREE.LineBasicMaterial({ color: '#ffe2a0', transparent: true, depthWrite: false, fog: false });
    this.blastMat = new THREE.MeshToonMaterial({ color: '#f2a046', emissive: '#f07a2a', emissiveIntensity: 1.4, transparent: true });
    this.smokeMat = new THREE.MeshToonMaterial({ color: '#7a7064', transparent: true });
    this.ball = new THREE.IcosahedronGeometry(1, 1);
    this.smokeSprite = new THREE.SpriteMaterial({ map: this.tex, depthWrite: false, color: '#d8d0c0', transparent: true, fog: false });
    this.shellGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.045, 5);
    this.brassMat = new THREE.MeshToonMaterial({ color: '#c9a24a' });
    this.shake = 0;
  }

  add(obj, life, update) {
    this.scene.add(obj);
    this.items.push({ obj, life, age: 0, update });
  }

  tracer(from, to, color = null) {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(from.x, from.y, from.z), new THREE.Vector3(to.x, to.y, to.z)]);
    const mat = color ? this.tracerMat.clone() : this.tracerMat;
    if (color) mat.color.set(color);
    const line = new THREE.Line(geo, mat);
    line.renderOrder = 2;
    this.add(line, TRACER_LIFE, null);
    line.userData.dispose = () => {
      geo.dispose();
      if (color) mat.dispose();
    };
  }

  /**
   * A shot leaving the barrel: a bright star, a puff of smoke drifting off, and (for rifles and
   * SMGs) a brass case flicked out to the right. Shakes the camera by the blast and the distance.
   */
  muzzle(at, d, weapon) {
    const big = weapon === 'lance' || weapon === 'tank_cannon';
    const size = big ? 1.6 : weapon === 'sniper' ? 0.9 : weapon === 'smg' || weapon.endsWith('_mg') ? 0.55 : 0.75;
    this.flash(at, size);
    this.flash({ x: at.x + d.x * size * 0.4, y: at.y + d.y * size * 0.4, z: at.z + d.z * size * 0.4 }, size * 0.6);
    const smoke = new THREE.Sprite(this.smokeSprite.clone());
    smoke.position.set(at.x + d.x * 0.2, at.y, at.z + d.z * 0.2);
    smoke.scale.setScalar(size * 0.5);
    this.add(smoke, big ? 1.4 : 0.7, (o, k, dt) => {
      o.scale.setScalar(size * (0.5 + 1.4 * k));
      o.material.opacity = 0.55 * (1 - k);
      o.position.y += dt * 0.5;
      o.position.x += d.x * dt * 0.6;
      o.position.z += d.z * dt * 0.6;
    });
    smoke.userData.dispose = () => smoke.material.dispose();
    if (!big) {
      const shell = new THREE.Mesh(this.shellGeo, this.brassMat);
      shell.position.set(at.x - d.x * 0.5, at.y, at.z - d.z * 0.5);
      const v = new THREE.Vector3(-d.z * 2.2 + (Math.random() - 0.5), 2.2 + Math.random(), d.x * 2.2 + (Math.random() - 0.5));
      const spin = new THREE.Vector3(Math.random() * 20, Math.random() * 20, 0);
      this.add(shell, 0.7, (o, k, dt) => {
        v.y -= 9.8 * dt;
        o.position.addScaledVector(v, dt);
        o.rotation.x += spin.x * dt;
        o.rotation.y += spin.y * dt;
      });
    }
    const dist = this.camera.position.distanceTo(new THREE.Vector3(at.x, at.y, at.z));
    const kick = (big ? 0.5 : weapon === 'sniper' ? 0.18 : 0.07) / Math.max(1, dist * 0.4);
    this.shake = Math.max(this.shake, kick);
  }

  flash(at, size = 0.5) {
    const s = new THREE.Sprite(this.flashMat);
    s.position.set(at.x, at.y, at.z);
    s.scale.setScalar(size);
    this.add(s, 0.06, null);
  }

  dust(at, size = 0.6) {
    const s = new THREE.Sprite(this.dustMat.clone());
    s.position.set(at.x, at.y, at.z);
    s.scale.setScalar(size * 0.4);
    this.add(s, 0.45, (o, k) => {
      o.scale.setScalar(size * (0.4 + k));
      o.material.opacity = 0.8 * (1 - k);
      o.position.y += 0.01;
    });
    s.userData.dispose = () => s.material.dispose();
  }

  explosion(at, radius = 3) {
    const fire = new THREE.Mesh(this.ball, this.blastMat.clone());
    fire.position.set(at.x, at.y + 0.3, at.z);
    this.add(fire, 0.5, (o, k) => {
      o.scale.setScalar(radius * (0.3 + 0.8 * Math.sqrt(k)));
      o.material.opacity = 1 - k;
    });
    fire.userData.dispose = () => fire.material.dispose();
    for (let i = 0; i < 6; i++) {
      const puff = new THREE.Mesh(this.ball, this.smokeMat.clone());
      const a = (i / 6) * Math.PI * 2;
      puff.position.set(at.x + Math.cos(a) * radius * 0.3, at.y + 0.5, at.z + Math.sin(a) * radius * 0.3);
      const vx = Math.cos(a) * 1.2, vz = Math.sin(a) * 1.2;
      this.add(puff, 1.6, (o, k, dt) => {
        o.scale.setScalar(radius * 0.35 * (0.5 + k));
        o.position.x += vx * dt;
        o.position.z += vz * dt;
        o.position.y += 1.4 * dt;
        o.material.opacity = 0.85 * (1 - k);
      });
      puff.userData.dispose = () => puff.material.dispose();
    }
    this.flash({ x: at.x, y: at.y + 0.8, z: at.z }, radius * 1.6);
    const d = this.camera.position.distanceTo(new THREE.Vector3(at.x, at.y, at.z));
    this.shake = Math.max(this.shake, Math.min(0.6, 6 / Math.max(4, d)));
  }

  /** A floating word at a world point. kind: 'dmg' | 'crit' | 'sfx' | 'info' */
  word(at, text, kind = 'dmg') {
    const el = document.createElement('div');
    el.className = `fx-word fx-word--${kind}`;
    el.textContent = text;
    this.layer.appendChild(el);
    this.words.push({ el, at: new THREE.Vector3(at.x, at.y, at.z), age: 0, life: kind === 'sfx' ? 0.7 : 1.3, jitter: (Math.random() - 0.5) * 30 });
  }

  update(dt) {
    for (const it of this.items) {
      it.age += dt;
      const k = Math.min(1, it.age / it.life);
      it.update?.(it.obj, k, dt);
    }
    this.items = this.items.filter((it) => {
      if (it.age < it.life) return true;
      it.obj.removeFromParent();
      it.obj.userData.dispose?.();
      return false;
    });
    const w = this.layer.clientWidth, h = this.layer.clientHeight;
    const v = new THREE.Vector3();
    for (const word of this.words) {
      word.age += dt;
      v.copy(word.at).project(this.camera);
      const visible = v.z < 1;
      const k = word.age / word.life;
      word.el.style.display = visible ? '' : 'none';
      word.el.style.transform = `translate(${((v.x + 1) / 2) * w + word.jitter}px, ${((1 - v.y) / 2) * h - 40 * k}px) translate(-50%, -50%) scale(${1 + 0.3 * Math.max(0, 0.15 - k) / 0.15})`;
      word.el.style.opacity = String(1 - Math.max(0, k - 0.6) / 0.4);
    }
    this.words = this.words.filter((word) => {
      if (word.age < word.life) return true;
      word.el.remove();
      return false;
    });
    this.shake *= Math.exp(-dt * 6);
  }

  /** Camera shake offset for this frame. */
  shakeOffset() {
    const s = this.shake;
    return s < 0.002 ? null : new THREE.Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
  }

  clear() {
    for (const it of this.items) {
      it.obj.removeFromParent();
      it.obj.userData.dispose?.();
    }
    this.items = [];
    for (const w of this.words) w.el.remove();
    this.words = [];
  }

  dispose() {
    this.clear();
    this.tex.dispose();
    for (const m of [this.flashMat, this.dustMat, this.tracerMat, this.blastMat, this.smokeMat, this.smokeSprite, this.brassMat]) m.dispose();
    this.ball.dispose();
    this.shellGeo.dispose();
  }
}
