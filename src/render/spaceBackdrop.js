import * as THREE from 'three';
import { createNoise3D } from '../math/simplex3d.js';
import { mulberry32 } from '../math/random.js';

/**
 * Deep-space backdrop: a procedural nebula sphere concentrated along a tilted
 * galactic band, and a star field that is denser inside that band. Both live
 * in world space, so turning the camera slowly reveals the sky around it.
 * Used by the planet view (radius 300) and the star system (radius 2400).
 */
export function createSpaceBackdrop({ radius = 300, pixelRatio = 1, count = 3200, texWidth = 512 } = {}) {
  const noise = createNoise3D(7331);
  const band = new THREE.Vector3(0.35, 1, 0.2).normalize(); // galactic pole
  const W = texWidth;
  const H = texWidth / 2;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, H);
  const deep = [27, 58, 107];
  const teal = [31, 95, 110];
  const dust = [70, 60, 96];
  const d = new THREE.Vector3();
  for (let y = 0; y < H; y++) {
    const phi = (y / H) * Math.PI;
    for (let x = 0; x < W; x++) {
      const th = (x / W) * Math.PI * 2;
      // Same mapping as SphereGeometry's UVs, so the texture has no seams
      d.set(-Math.cos(th) * Math.sin(phi), Math.cos(phi), Math.sin(th) * Math.sin(phi));
      const inBand = Math.exp(-Math.pow(d.dot(band) * 3.2, 2));
      const n = noise.fbm(d.x * 2.2, d.y * 2.2, d.z * 2.2, 5, 2.0, 0.55) * 0.5 + 0.5;
      const wisps = noise.fbm(d.x * 6 + 9, d.y * 6, d.z * 6, 3, 2.0, 0.5) * 0.5 + 0.5;
      const a = THREE.MathUtils.clamp((n - 0.42) * 2.2, 0, 1) * (0.25 + inBand * 0.75) * (0.6 + wisps * 0.4);
      const mix = THREE.MathUtils.clamp(wisps * 1.3 - 0.2, 0, 1);
      const c = deep.map((v, i) => v + (teal[i] - v) * mix + (dust[i] - v) * inBand * 0.25 * (1 - mix));
      const o = (y * W + x) * 4;
      img.data[o] = c[0];
      img.data[o + 1] = c[1];
      img.data[o + 2] = c[2];
      img.data[o + 3] = a * 150;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const nebula = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 48, 24),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, transparent: true, depthWrite: false, toneMapped: false, fog: false })
  );
  nebula.renderOrder = -2;

  // Star field: denser along the band, a few bright ones, slight colour temperature spread
  const rng = mulberry32(424242);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const tmp = new THREE.Vector3();
  const temps = [new THREE.Color(0xbcd4ff), new THREE.Color(0xffffff), new THREE.Color(0xfff1d6), new THREE.Color(0xffd9b0)];
  for (let i = 0; i < count; i++) {
    let accepted = false;
    while (!accepted) {
      const z = rng() * 2 - 1;
      const t = rng() * Math.PI * 2;
      tmp.set(Math.sqrt(1 - z * z) * Math.cos(t), z, Math.sqrt(1 - z * z) * Math.sin(t));
      accepted = rng() < 0.35 + 0.65 * Math.exp(-Math.pow(tmp.dot(band) * 2.5, 2));
    }
    tmp.multiplyScalar(radius * (280 / 300));
    pos.set([tmp.x, tmp.y, tmp.z], i * 3);
    const c = temps[Math.floor(rng() * temps.length)];
    const bright = rng() < 0.04;
    const b = bright ? 1 : 0.45 + rng() * 0.4;
    col.set([c.r * b, c.g * b, c.b * b], i * 3);
    size[i] = bright ? 2.4 + rng() * 1.4 : 0.8 + rng() * 1.1;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('size', new THREE.BufferAttribute(size, 1));
  const stars = new THREE.Points(
    g,
    new THREE.ShaderMaterial({
      uniforms: { uPixelRatio: { value: pixelRatio } },
      vertexShader: `
        attribute float size;
        varying vec3 vColor;
        uniform float uPixelRatio;
        void main() {
          vColor = color;
          gl_PointSize = size * uPixelRatio;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          gl_FragColor = vec4(vColor, 1.0 - smoothstep(0.2, 0.5, d));
        }
      `,
      vertexColors: true,
      transparent: true,
      depthWrite: false
    })
  );
  stars.renderOrder = -1;
  stars.frustumCulled = false;
  return { nebula, stars };
}
