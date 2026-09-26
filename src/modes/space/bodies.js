import * as THREE from 'three';
import { mulberry32 } from '../../map/mapGenerator.js';
import { PLANET_TYPES } from '../../world/planetTypes.js';
import { toTexture } from './bake.js';

// Everything in the star system except the ship. Planet surfaces are one
// sphere each with a baked texture (see planetBake.worker.js); lighting,
// terminator, night-side city lights and the atmosphere rim are shaded here.

const planetVertex = `
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPosW = wp.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const planetFragment = `
  uniform sampler2D map;
  uniform vec3 uSun;
  uniform vec3 uSunColor;
  uniform vec3 uAtmo;
  uniform float uAtmoStrength;
  uniform vec3 uGlow;
  uniform float uGlowDay;
  uniform float uBright;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying vec2 vUv;
  void main() {
    vec4 tex = texture2D(map, vUv);
    vec3 N = normalize(vNormalW);
    vec3 L = normalize(uSun - vPosW);
    vec3 V = normalize(cameraPosition - vPosW);
    float ndl = dot(N, L);
    // Stylised: wrapped diffuse and a soft terminator
    float day = smoothstep(-0.18, 0.22, ndl);
    float diffuse = clamp(ndl * 0.55 + 0.45, 0.0, 1.0);
    vec3 col = tex.rgb * uSunColor * (0.03 + diffuse * day * uBright);
    // Self-illumination: city lights at night, lava everywhere
    col += uGlow * tex.a * mix(1.0 - day, 1.0, uGlowDay);
    float fres = pow(1.0 - max(dot(N, V), 0.0), 2.6);
    col += uAtmo * fres * uAtmoStrength * (0.15 + day * 0.85);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const cloudFragment = `
  uniform sampler2D map;
  uniform vec3 uSun;
  uniform vec3 uTint;
  uniform float uOpacity;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying vec2 vUv;
  void main() {
    float a = texture2D(map, vUv).a;
    vec3 N = normalize(vNormalW);
    float day = smoothstep(-0.2, 0.3, dot(N, normalize(uSun - vPosW)));
    gl_FragColor = vec4(uTint * (0.05 + day * 1.05), a * uOpacity * (0.35 + day * 0.65));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const atmoFragment = `
  uniform vec3 uSun;
  uniform vec3 uInner;
  uniform vec3 uOuter;
  uniform vec3 uCenter;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying vec2 vUv;
  void main() {
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(cameraPosition - vPosW);
    float fres = clamp(1.0 - abs(dot(V, N)), 0.0, 1.0);
    float glow = pow(1.0 - fres, 1.6);
    float lit = smoothstep(-0.35, 0.4, dot(normalize(vPosW - uCenter), normalize(uSun - uCenter)));
    gl_FragColor = vec4(mix(uInner, uOuter, glow), glow * 0.85 * (0.12 + lit * 0.88));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const starFragment = `
  uniform float uTime;
  uniform vec3 uColor;
  uniform vec3 uHot;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying vec2 vUv;
  // cheap value noise for granulation
  float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  float vnoise(vec3 p) {
    vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    float n = mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                  mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
    return n;
  }
  void main() {
    vec3 N = normalize(vNormalW);
    vec3 p = N * 5.0 + vec3(uTime * 0.05, uTime * 0.03, 0.0);
    float g = vnoise(p) * 0.6 + vnoise(p * 2.7) * 0.3 + vnoise(p * 7.1) * 0.1;
    vec3 V = normalize(cameraPosition - vPosW);
    float limb = pow(max(dot(N, V), 0.0), 0.45);
    vec3 col = mix(uColor * 0.85, uHot, g) * (0.75 + limb * 0.55);
    gl_FragColor = vec4(col * 1.6, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function radialTexture(stops, size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(([o, col]) => g.addColorStop(o, col));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function ringTexture(seed, warm) {
  const rng = mulberry32(seed);
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 1;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(512, 1);
  const base = warm ? [218, 196, 160] : [180, 205, 220];
  let a = 0;
  for (let x = 0; x < 512; x++) {
    if (x % 8 === 0) a = rng();
    const gap = rng() < 0.015 ? 0 : 1;
    const edge = Math.min(1, x / 30, (511 - x) / 30);
    const alpha = (0.25 + a * 0.6) * gap * edge;
    const shade = 0.75 + a * 0.35;
    img.data.set([base[0] * shade, base[1] * shade, base[2] * shade, alpha * 255], x * 4);
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** RingGeometry with u running from inner to outer radius (so a 1D texture maps radially). */
function ringGeometry(inner, outer) {
  const g = new THREE.RingGeometry(inner, outer, 128, 1);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    uv.setXY(i, (v.length() - inner) / (outer - inner), 0.5);
  }
  g.rotateX(-Math.PI / 2);
  return g;
}

function rockGeometry(seed) {
  const rng = mulberry32(seed);
  const g = new THREE.IcosahedronGeometry(1, 1);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  // Displace shared corners identically: IcosahedronGeometry is non-indexed
  const bump = new Map();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    if (!bump.has(key)) bump.set(key, 0.7 + rng() * 0.5);
    v.multiplyScalar(bump.get(key));
    pos.setXYZ(i, v.x * 1.3, v.y * 0.8, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export class SystemBodies {
  constructor(system, baked, quality) {
    this.system = system;
    this.group = new THREE.Group();
    this.disposables = [];
    this.planets = [];
    this.sunPos = new THREE.Vector3(0, 0, 0);
    const detail = quality.settings.detail;
    this.buildStar(system.star);
    this.buildPlanets(system, baked, detail);
    this.buildBelt(system.belt, detail);
  }

  track(...items) {
    this.disposables.push(...items);
    return items[0];
  }

  buildStar(star) {
    const color = new THREE.Color(star.color);
    const mat = this.track(
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(star.glow) }, uHot: { value: color } },
        vertexShader: planetVertex,
        fragmentShader: starFragment
      })
    );
    this.starMat = mat;
    const geo = this.track(new THREE.SphereGeometry(star.radius, 64, 48));
    this.star = new THREE.Mesh(geo, mat);
    this.group.add(this.star);
    // Glow halo and a wide soft corona (additive sprites, always face the camera)
    const halo = this.track(radialTexture([[0, 'rgba(255,255,255,1)'], [0.18, 'rgba(255,240,210,0.9)'], [0.4, 'rgba(255,190,120,0.25)'], [1, 'rgba(255,160,80,0)']]));
    const haloMat = this.track(new THREE.SpriteMaterial({ map: halo, color: star.glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    const s1 = new THREE.Sprite(haloMat);
    s1.scale.setScalar(star.radius * 6);
    const corona = this.track(radialTexture([[0, 'rgba(255,220,170,0.35)'], [0.5, 'rgba(255,170,90,0.08)'], [1, 'rgba(255,140,60,0)']]));
    const coronaMat = this.track(new THREE.SpriteMaterial({ map: corona, color: star.glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    const s2 = new THREE.Sprite(coronaMat);
    s2.scale.setScalar(star.radius * 22);
    this.group.add(s1, s2);
    this.light = new THREE.PointLight(star.light, 3.2, 0, 0);
    this.group.add(this.light, new THREE.AmbientLight(0x6a7899, 0.35));
  }

  buildPlanets(system, baked, detail) {
    const cloudsTex = baked.clouds ? this.track(toTexture(baked.clouds)) : null;
    const moonGeo = this.track(new THREE.IcosahedronGeometry(1, 3));
    const moonMat = this.track(new THREE.MeshLambertMaterial({ color: 0x9d968e, flatShading: true }));
    const orbitMat = this.track(new THREE.LineBasicMaterial({ color: 0x9cb6d8, transparent: true, opacity: 0.16, depthWrite: false }));
    const seg = Math.round(48 + 48 * detail);

    for (const p of system.planets) {
      const type = PLANET_TYPES[p.type];
      const look = type.look || {};
      const holder = new THREE.Group(); // orbital position
      const body = new THREE.Group(); // spin (planet-local frame == globe frame)
      holder.add(body);
      const img = baked.images.get(p.index);
      const map = this.track(img ? toTexture(img) : new THREE.DataTexture(new Uint8Array([120, 120, 120, 0]), 1, 1));
      map.needsUpdate = true;
      const atmoCols = p.type === 'gas' ? [0xf1dcc0, 0xc9a070] : look.atmosphere === undefined ? [0x8cccff, 0x408cf2] : look.atmosphere;
      const lava = !!look.water?.unlit;
      const surface = this.track(
        new THREE.ShaderMaterial({
          uniforms: {
            map: { value: map },
            uSun: { value: this.sunPos },
            uSunColor: { value: new THREE.Color(system.star.light) },
            uAtmo: { value: new THREE.Color(atmoCols ? atmoCols[0] : 0x000000) },
            uAtmoStrength: { value: atmoCols ? 0.55 : 0 },
            uGlow: { value: new THREE.Color(lava ? 0xff7a2a : 0xffc873) },
            uGlowDay: { value: lava ? 0.6 : 0 },
            uBright: { value: 1.25 }
          },
          vertexShader: planetVertex,
          fragmentShader: planetFragment
        })
      );
      const sphere = new THREE.Mesh(this.track(new THREE.SphereGeometry(p.radius, seg, Math.round(seg * 0.66))), surface);
      body.add(sphere);

      let clouds = null;
      const cloudLook = p.type === 'gas' ? null : look.clouds === undefined ? { count: 70 } : look.clouds;
      if (cloudLook && cloudsTex) {
        const cm = this.track(
          new THREE.ShaderMaterial({
            uniforms: {
              map: { value: cloudsTex },
              uSun: { value: this.sunPos },
              uTint: { value: new THREE.Color(cloudLook.color ?? 0xffffff) },
              uOpacity: { value: Math.min(1, (cloudLook.count ?? 70) / 90) }
            },
            vertexShader: planetVertex,
            fragmentShader: cloudFragment,
            transparent: true,
            depthWrite: false
          })
        );
        clouds = new THREE.Mesh(this.track(new THREE.SphereGeometry(p.radius * 1.035, seg, Math.round(seg * 0.66))), cm);
        body.add(clouds);
      }
      let atmo = null;
      if (atmoCols) {
        const am = this.track(
          new THREE.ShaderMaterial({
            uniforms: {
              uSun: { value: this.sunPos },
              uInner: { value: new THREE.Color(atmoCols[0]) },
              uOuter: { value: new THREE.Color(atmoCols[1]) },
              uCenter: { value: new THREE.Vector3() }
            },
            vertexShader: planetVertex,
            fragmentShader: atmoFragment,
            side: THREE.BackSide,
            transparent: true,
            depthWrite: false
          })
        );
        atmo = new THREE.Mesh(this.track(new THREE.SphereGeometry(p.radius * 1.09, 64, 40)), am);
        holder.add(atmo);
      }
      if (p.ring) {
        const rm = this.track(
          new THREE.MeshBasicMaterial({ map: this.track(ringTexture(p.seed, p.bands?.[0] < 0.6)), transparent: true, side: THREE.DoubleSide, depthWrite: false })
        );
        const ring = new THREE.Mesh(this.track(ringGeometry(p.ring.inner, p.ring.outer)), rm);
        ring.rotation.x = p.ring.tilt;
        ring.rotation.z = p.ring.tilt * 0.6;
        holder.add(ring);
      }
      const moons = p.moons.map((m) => {
        const mesh = new THREE.Mesh(moonGeo, moonMat);
        mesh.scale.setScalar(m.radius);
        holder.add(mesh);
        return { ...m, mesh };
      });

      // Orbit path
      const pts = [];
      for (let i = 0; i <= 256; i++) {
        const a = (i / 256) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * p.orbit, 0, Math.sin(a) * p.orbit));
      }
      const orbitLine = new THREE.Line(this.track(new THREE.BufferGeometry().setFromPoints(pts)), orbitMat.clone());
      this.track(orbitLine.material);
      this.group.add(holder, orbitLine);

      this.planets.push({ def: p, holder, body, sphere, clouds, atmo, moons, orbitLine, angle: p.phase });
    }
  }

  buildBelt(belt, detail) {
    if (!belt || belt.outer - belt.inner < 4) return;
    const rng = mulberry32(this.system.seed + 3);
    const count = Math.round(belt.count * (0.5 + detail * 0.5));
    const geos = [0, 1, 2].map((i) => this.track(rockGeometry(this.system.seed + i)));
    const mat = this.track(new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }));
    this.belt = new THREE.Group();
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const c = new THREE.Color();
    geos.forEach((geo, gi) => {
      const n = Math.floor(count / 3);
      const inst = new THREE.InstancedMesh(geo, mat, n);
      for (let i = 0; i < n; i++) {
        const a = rng() * Math.PI * 2;
        const r = belt.inner + (belt.outer - belt.inner) * Math.pow(rng(), 0.8);
        const y = (rng() - 0.5) * 3;
        const s = 0.12 + Math.pow(rng(), 3) * 0.9;
        m.compose(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r), q.setFromEuler(e.set(rng() * 6, rng() * 6, rng() * 6)), new THREE.Vector3(s, s, s));
        inst.setMatrixAt(i, m);
        inst.setColorAt(i, c.setHSL(0.07 + rng() * 0.04, 0.12 + rng() * 0.1, 0.32 + rng() * 0.2 + gi * 0.03));
      }
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
      this.belt.add(inst);
    });
    this.group.add(this.belt);
  }

  /** t: world clock (positions), anim: app time (surface animation). */
  update(dt, t, anim = t) {
    this.starMat.uniforms.uTime.value = anim;
    for (const pl of this.planets) {
      const p = pl.def;
      // Positions follow the app clock, so the system keeps turning while you are on a planet
      pl.angle = p.phase + p.orbitSpeed * t;
      pl.holder.position.set(Math.cos(pl.angle) * p.orbit, 0, Math.sin(pl.angle) * p.orbit);
      pl.body.rotation.y = p.phase * 2 + p.spin * t;
      if (pl.clouds) pl.clouds.rotation.y = p.phase * 3 + t * 0.012;
      if (pl.atmo) pl.atmo.material.uniforms.uCenter.value.copy(pl.holder.position);
      for (const m of pl.moons) {
        const a = m.phase + anim * m.speed;
        m.mesh.position.set(Math.cos(a) * m.distance, Math.sin(a * 0.7) * m.distance * 0.08, Math.sin(a) * m.distance);
      }
    }
    if (this.belt) this.belt.rotation.y += dt * 0.004;
  }

  planetPos(index, out = new THREE.Vector3()) {
    return out.copy(this.planets[index].holder.position);
  }

  highlightOrbit(index) {
    this.planets.forEach((pl) => (pl.orbitLine.material.opacity = pl.def.index === index ? 0.55 : 0.16));
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose?.());
    this.disposables = [];
  }
}
