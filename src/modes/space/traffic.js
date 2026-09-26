import * as THREE from 'three';
import { mulberry32 } from '../../map/mapGenerator.js';
import { createToonMaterial } from '../../render/assetLibrary.js';

// NPC ships: cargo haulers and patrols travelling between planets, pausing in
// orbit, then heading off again. They make the system feel inhabited.

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

function engineGlow(size) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,200,140,0.8)');
  grad.addColorStop(1, 'rgba(255,140,60,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  s.scale.setScalar(size);
  return s;
}

export class SpaceTraffic {
  /**
   * mode: the SpaceMode (planet positions, park points, star-avoiding routes)
   */
  constructor(mode, pack, { count = 6, seed = 1 } = {}) {
    this.mode = mode;
    this.ships = [];
    this.group = new THREE.Group();
    this.material = createToonMaterial({ vertexColors: true });
    const rng = mulberry32(seed);
    const kinds = [
      ['ship_cargo', 20, 1.1, [[0, 0.15, -2.4, 1.1]]],
      ['ship_cargo', 18, 1.1, [[0, 0.15, -2.4, 1.1]]],
      ['ship_patrol', 30, 0.9, [[0, 0.03, -0.74, 0.5]]],
      ['ship_freighter', 22, 1, [[-0.2, 0.1, -1.36, 0.5], [0.2, 0.1, -1.36, 0.5]]]
    ];
    const planets = mode.system.planets.length;
    for (let i = 0; i < count; i++) {
      const [asset, speed, scale, engines] = kinds[i % kinds.length];
      const lods = pack?.[asset];
      if (!lods) continue;
      const lod = new THREE.LOD();
      [lods[0], lods[1], lods[2]].forEach((g, k) => g && lod.addLevel(new THREE.Mesh(g, this.material), [0, 25, 90][k]));
      const obj = new THREE.Group();
      obj.add(lod);
      engines.forEach(([x, y, z, s]) => {
        const glow = engineGlow(s);
        glow.position.set(x, y, z);
        obj.add(glow);
      });
      obj.scale.setScalar(scale);
      this.group.add(obj);
      const from = Math.floor(rng() * planets);
      const ship = { obj, speed: speed * (0.85 + rng() * 0.3), vel: new THREE.Vector3(), from, to: (from + 1 + Math.floor(rng() * (planets - 1))) % planets, wait: rng() * 8 };
      // Start somewhere along the way so the lanes are busy from the first frame
      mode.parkPoint(ship.from, ship.obj.position);
      ship.obj.position.lerp(mode.parkPoint(ship.to, _v), rng() * 0.8);
      this.ships.push(ship);
    }
    this.rng = rng;
  }

  update(dt) {
    const planets = this.mode.system.planets.length;
    for (const s of this.ships) {
      if (s.wait > 0) {
        // Holding orbit: drift with the planet
        s.wait -= dt;
        s.obj.position.addScaledVector(this.mode.planetVelocity(s.to, _v), dt);
        if (s.wait <= 0) {
          s.from = s.to;
          s.to = (s.to + 1 + Math.floor(this.rng() * (planets - 1))) % planets;
        }
        continue;
      }
      const target = this.mode.routeToFrom(s.obj.position, this.mode.parkPoint(s.to, _v2).addScaledVector(_v.set(this.rng() - 0.5, 0.3, this.rng() - 0.5), 0));
      const to = _v.copy(target).sub(s.obj.position);
      const dist = to.length();
      const want = to.normalize().multiplyScalar(Math.min(s.speed, Math.max(3, dist * 0.6)));
      s.vel.lerp(want, 1 - Math.exp(-dt * 1.2));
      s.obj.position.addScaledVector(s.vel, dt);
      if (s.vel.lengthSq() > 0.01) {
        const look = _v2.copy(s.obj.position).add(s.vel);
        s.obj.lookAt(look);
      }
      if (dist < 3) s.wait = 6 + this.rng() * 10;
    }
  }

  dispose() {
    this.material.dispose();
    this.group.traverse((o) => {
      if (o.isSprite) {
        o.material.map.dispose();
        o.material.dispose();
      }
    });
  }
}
