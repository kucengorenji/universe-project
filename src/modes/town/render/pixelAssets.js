import * as THREE from 'three';
import { mulberry32 } from '../../../math/random.js';
import { PLANET_TYPES, TERRAN_PALETTE } from '../../../world/planetTypes.js';
import { PIXEL_YAW } from './pixelConfig.js';
import { WATER_Y } from '../scale.js';

/** Editable, deterministic pixel assets; source pixels stay available for exports and QA. */
export function treePixels(kind = 'oak', seed = 17) {
  const width = 64, height = 96, data = new Uint8Array(width * height * 4), rng = mulberry32(seed);
  const colors = kind === 'autumn' ? ['#394943', '#775835', '#b37b3b', '#e9a452', '#ffcd78', '#ffe2a0']
    : kind === 'snow' ? ['#304c59', '#436a70', '#7ba0a4', '#c1d9d9', '#e4efdf', '#fff9dd']
      : ['#213f49', '#2b655c', '#358f72', '#58b886', '#8dd596', '#b9e5a2'];
  const rgb = colors.map(c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]);
  const put = (x, y, color) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const i = (y * width + x) * 4; data.set([...color, 255], i);
  };
  const trunk = [76, 66, 46], lightWood = [130, 110, 65];
  for (let y = 35; y < 94; y++) for (let x = 29; x <= 34; x++) put(x, y, x < 32 ? lightWood : trunk);
  for (let y = 45; y < 76; y++) for (let x = 0; x < 3; x++) {
    put(31 - Math.floor((76 - y) * .55) + x, y, trunk);
    put(32 + Math.floor((76 - y) * .48) + x, y, lightWood);
  }
  const clumps = kind === 'pine' || kind === 'snow'
    ? [[32, 58, 27, 14], [32, 41, 22, 15], [32, 25, 16, 15], [32, 13, 9, 10]]
    : kind === 'bush' ? [[31, 67, 27, 20], [17, 70, 13, 15], [47, 69, 13, 15]]
      : [[30, 36, 27, 26], [16, 44, 13, 19], [47, 43, 14, 22], [34, 20, 20, 16], [32, 56, 23, 16]];
  if (kind === 'bush') data.fill(0);
  for (const [cx, cy, rx, ry] of clumps) {
    for (let y = Math.max(0, cy - ry - 2); y < Math.min(height, cy + ry + 2); y++) {
      for (let x = Math.max(0, cx - rx - 2); x < Math.min(width, cx + rx + 2); x++) {
        const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
        const noise = rng();
        if (d > 1 + (noise - .5) * .16) continue;
        const lit = .7 - (x - cx) / rx * .23 - (y - cy) / ry * .27;
        const patch = Math.sin(Math.floor(x / 3) * 3.7 + Math.floor(y / 2) * 2.1 + seed);
        let shade = d > .90 ? 0 : Math.max(1, Math.min(5, Math.floor(lit * 4 + patch * .8 + noise * 1.5)));
        if (noise > .93 && y < cy + ry * .25) shade = Math.min(5, shade + 1);
        put(x, y, rgb[shade]);
      }
    }
  }
  return { width, height, data };
}

export function surfacePixels(seed = 41) {
  const width = 32, height = 32, depth = 16, data = new Uint8Array(width * height * depth * 4), rng = mulberry32(seed);
  for (let layer = 0; layer < depth; layer++) for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let tone = .92 + rng() * .16;
    if ([2, 4, 5, 6, 9, 10, 15].includes(layer)) {
      const row = Math.floor(y / 8), shifted = (x + (row % 2) * 8) % 16;
      if (y % 8 === 0 || shifted === 0) tone = .57;
      else if (y % 8 === 1 || shifted === 1) tone = 1.17;
    } else if ([3, 8].includes(layer)) {
      if (x % 8 === 0) tone = .54;
      else tone += Math.sin(y * .5 + Math.floor(x / 8) * 2 + Math.sin(x) * .4) > .4 ? .09 : -.06;
      if (y % 23 === 0 && x % 8 === 2) tone = .45;
    } else if (layer === 12) {
      tone = rng() > .91 ? 1.27 : rng() > .8 ? .75 : .98;
    }
    const i = ((layer * height + y) * width + x) * 4;
    data.set([Math.min(255, tone * 205), Math.min(255, tone * 205), Math.min(255, tone * 205), 255], i);
  }
  return { width, height, depth, data };
}

function treeKind(item, flora) {
  if (/bush|flowers|tuft|grass/.test(item.asset)) return 'bush';
  if (flora === 'snow' || /snow/.test(item.asset)) return 'snow';
  if (item.asset === 't_oak' && item.variant === 2 || item.asset === 't_birch' && item.variant === 1) return 'autumn';
  return /pine|spruce|cypress/.test(item.asset) ? 'pine' : 'oak';
}

export const PIXEL_FADE_SHADER = `
  uniform vec2 uPixelFocus;
  uniform float uPixelFocusDepth;
  uniform float uPixelFocusRadius;
  uniform float uPixelActor;
  varying float vPixelTreeDepth;
  float pixelDither(vec2 p) {
    vec2 q=mod(floor(p),4.0);
    float a=mod(q.x,2.0)*2.0+mod(q.y,2.0)*3.0;
    float b=floor(q.x/2.0)*2.0+floor(q.y/2.0)*3.0;
    return mod(a,4.0)/4.0+mod(b,4.0)/16.0;
  }
`;

export class PixelVegetation {
  constructor(mode, uniforms) {
    this.group = new THREE.Group(); this.group.name = 'Town.pixelVegetation';
    this.owned = []; this.materials = [];
    const look = PLANET_TYPES[mode.planet.type]?.look || {}, flora = look.flora;
    const palette = look.palette || TERRAN_PALETTE;
    const bins = new Map();
    const decor = [], random = mulberry32(mode.layout.seed + 711);
    if (!['dry', 'none'].includes(flora)) for (const river of mode.layout.rivers || []) {
      for (let j = 0; j < river.pts.length - 1; j++) {
        const [ax, az] = river.pts[j], [bx, bz] = river.pts[j + 1], length = Math.hypot(bx - ax, bz - az);
        const steps = Math.max(1, Math.floor(length / 2.8));
        for (let k = 0; k < steps; k++) for (const side of [-1, 1]) {
          const t = (k + .5) / steps, offset = river.w * .5 + 3.5 + random() * 3.5;
          const x = ax + (bx - ax) * t - (bz - az) / Math.max(.001, length) * offset * side;
          const z = az + (bz - az) * t + (bx - ax) / Math.max(.001, length) * offset * side;
          if (Math.hypot(x, z) > mode.layout.dioramaR - 8 || mode.builder.heightAt(x, z) < WATER_Y + .35) continue;
          const resolved = mode.colliders.resolve(x, z, 1.2);
          if (Math.hypot(resolved.x - x, resolved.z - z) > .01) continue;
          const onRoad = mode.layout.streets.some(street => street.pts.some((point, index) => {
            const next = street.pts[index + 1]; if (!next) return false;
            const dx = next[0] - point[0], dz = next[1] - point[1];
            const u = Math.max(0, Math.min(1, ((x - point[0]) * dx + (z - point[1]) * dz) / Math.max(.001, dx * dx + dz * dz)));
            return Math.hypot(x - point[0] - dx * u, z - point[1] - dz * u) < street.w / 2 + 1.5;
          }));
          if (!onRoad) decor.push({ asset: 'b_bush', x, z, w: 2.1 + random() * 1.4 });
        }
      }
    }
    this.decorCount = decor.length;
    for (const item of [...mode.layout.trees, ...decor]) {
      // Preserve specialist dry-world models (palms, cacti, rocks) and their biome identity.
      if (!/^(t_|tree_|b_bush|bush|g_tuft|grass_tuft|b_flowers)/.test(item.asset) || /palm|acacia/.test(item.asset) || ['dry', 'none'].includes(flora)) continue;
      const kind = treeKind(item, flora);
      if (!bins.has(kind)) bins.set(kind, []);
      bins.get(kind).push(item);
    }
    const geometry = new THREE.PlaneGeometry(1, 1); geometry.translate(0, .5, 0);
    // Typed-array pixels are authored top-down; the card's ground edge samples the last raster row.
    const uv = geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    this.owned.push(geometry);
    const quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), PIXEL_YAW);
    const matrix = new THREE.Matrix4(), pos = new THREE.Vector3(), scale = new THREE.Vector3();
    for (const [kind, items] of bins) {
      const pixels = treePixels(kind);
      const texture = new THREE.DataTexture(pixels.data, pixels.width, pixels.height);
      texture.colorSpace = THREE.SRGBColorSpace; texture.magFilter = texture.minFilter = THREE.NearestFilter;
      texture.generateMipmaps = false; texture.needsUpdate = true;
      const material = new THREE.MeshBasicMaterial({ map: texture, alphaTest: .5, side: THREE.DoubleSide, fog: true });
      material.onBeforeCompile = shader => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying float vPixelTreeDepth;')
          .replace('#include <project_vertex>', '#include <project_vertex>\nvPixelTreeDepth=-mvPosition.z;');
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${PIXEL_FADE_SHADER}\nuniform float uPixelNight;`)
          .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
            float fade=(1.-smoothstep(uPixelFocusRadius*.65,uPixelFocusRadius,length(gl_FragCoord.xy-uPixelFocus))) * uPixelActor;
            if(vPixelTreeDepth<uPixelFocusDepth-.15 && pixelDither(gl_FragCoord.xy)<fade*.88)discard;`)
          .replace('#include <tonemapping_fragment>', 'gl_FragColor.rgb*=mix(vec3(1.),vec3(.25,.35,.51),uPixelNight);\n#include <tonemapping_fragment>');
      };
      material.customProgramCacheKey = () => 'town-pixel-tree-v1';
      const mesh = new THREE.InstancedMesh(geometry, material, items.length); mesh.name = `Pixel.${kind}`;
      items.forEach((item, i) => {
        const bush = kind === 'bush', width = Math.max(bush ? 1 : 3, item.w || 5), height = width * (bush ? .75 : 1.6);
        pos.set(item.x, mode.builder.heightAt(item.x, item.z) - .05, item.z);
        matrix.compose(pos, quaternion, scale.set(width, height, 1)); mesh.setMatrixAt(i, matrix);
        const tint = new THREE.Color(1, 1, 1);
        if (mode.planet.type !== 'terran' && !['autumn', 'snow'].includes(kind)) tint.set(palette.forest).lerp(new THREE.Color('#9fe3b3'), .55);
        mesh.setColorAt(i, tint);
      });
      mesh.computeBoundingSphere(); this.group.add(mesh);
      this.owned.push(texture, material, { dispose: () => mesh.dispose() }); this.materials.push(material);
    }
    this.count = [...bins.values()].reduce((sum, items) => sum + items.length, 0);
  }
  dispose() { this.owned.forEach(item => item.dispose()); }
}
