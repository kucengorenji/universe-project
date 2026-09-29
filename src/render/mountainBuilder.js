import * as THREE from 'three';
import { createNoise3D } from '../math/simplex3d.js';
import { BIOMES } from '../map/mapGenerator.js';

const PALETTE = {
  foothill: new THREE.Color(0x7f9a4c),
  rock: new THREE.Color(0x9a8672),
  rockDark: new THREE.Color(0x6e5f52),
  cliff: new THREE.Color(0x5a4c43),
  snow: new THREE.Color(0xf5f8fb)
};

/**
 * Builds ONE faceted heightfield covering every mountain tile.
 *
 * Adjacent mountain tiles merge into a single massif: each tile gets a
 * "depth" (hops to the nearest non-mountain tile), corners take the average
 * depth of the tiles that share them (0 when any neighbour is lowland), and
 * the fan triangles of every hex are subdivided and displaced by that
 * interpolated depth + ridged noise. Because heights only depend on shared
 * corner values and 3D position, neighbouring tiles stitch without cracks
 * and the silhouette follows the range shape instead of the hex grid.
 */
export function buildMountainGeometry(hexasphere, { landRadius, tileSpacing, seed = 1, edgeMid = null, palette = null }) {
  // Planet types may recolour the rock (hex numbers, same keys as PALETTE)
  const P = palette ? Object.fromEntries(Object.entries(PALETTE).map(([k, c]) => [k, palette[k] !== undefined ? new THREE.Color(palette[k]) : c])) : PALETTE;
  const { tiles, tileMap, globalCorners } = hexasphere;
  const isMtn = (t) => t.biome === BIOMES.MOUNTAIN;
  const mountains = tiles.filter(isMtn);
  if (mountains.length === 0) return null;

  // 1. Depth field (multi-source BFS from lowland tiles)
  const depth = new Map();
  const queue = [];
  for (const t of mountains) {
    if (t.neighbors.some((n) => !isMtn(tileMap.get(n)))) {
      depth.set(t.id, 1);
      queue.push(t.id);
    }
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const id = queue[qi];
    for (const nId of tileMap.get(id).neighbors) {
      const n = tileMap.get(nId);
      if (isMtn(n) && !depth.has(nId)) {
        depth.set(nId, depth.get(id) + 1);
        queue.push(nId);
      }
    }
  }

  // 2. Corner values
  const cornerTiles = new Map();
  for (const t of tiles) {
    for (const c of t.cornerIndices) {
      if (!cornerTiles.has(c)) cornerTiles.set(c, []);
      cornerTiles.get(c).push(t);
    }
  }
  const cornerValue = new Map();
  const valueOfCorner = (c) => {
    if (cornerValue.has(c)) return cornerValue.get(c);
    const owners = cornerTiles.get(c);
    let v = 0;
    if (owners.every(isMtn)) {
      v = owners.reduce((s, t) => s + (depth.get(t.id) ?? 1), 0) / owners.length;
    }
    cornerValue.set(c, v);
    return v;
  };

  // 3. Height function
  const noise = createNoise3D(seed + 991);
  const ridged = (p, f) => 1 - Math.abs(noise.fbm(p.x * f, p.y * f, p.z * f, 3, 2.1, 0.5));
  const freq = landRadius / tileSpacing; // ~1 noise cycle per tile
  const heightAt = (p, d) => {
    if (d <= 0) return 0;
    const dd = Math.min(d, 3);
    const base = Math.pow(dd, 0.65);
    const jag = ridged(p, freq * 0.35);
    const detail = noise.noise(p.x * freq * 1.8, p.y * freq * 1.8, p.z * freq * 1.8);
    return tileSpacing * base * (0.6 + 0.8 * jag * jag * jag + 0.08 * detail);
  };

  // Grid resolution per fan sector (edges split in two when edgeMid is used)
  const k = edgeMid ? { 2: 7, 3: 5, 4: 4, 5: 3 }[hexasphere.subdivision] || 3 : { 2: 9, 3: 7, 4: 5, 5: 4 }[hexasphere.subdivision] || 4;
  const positions = [];
  // Low, gentle spots on the massif flanks: the renderer grows pines there
  const foothills = [];
  // Highest point per mountain tile: fliers keep above it
  const peaks = new Map();
  const colors = [];
  const tmp = new THREE.Vector3();
  const vertex = (C, A, B, vC, vA, vB, i, j) => {
    // barycentric grid: i steps toward A, j toward B
    const wA = i / k;
    const wB = j / k;
    const wC = 1 - wA - wB;
    tmp.set(0, 0, 0).addScaledVector(C, wC).addScaledVector(A, wA).addScaledVector(B, wB).normalize();
    const d = wC * vC + wA * vA + wB * vB;
    const h = heightAt(tmp, d);
    return { p: tmp.clone().multiplyScalar(landRadius + h), h, d };
  };

  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const faceN = new THREE.Vector3();
  const faceColor = new THREE.Color();
  const pushTri = (a, b, c, absLat) => {
    positions.push(a.p.x, a.p.y, a.p.z, b.p.x, b.p.y, b.p.z, c.p.x, c.p.y, c.p.z);
    e1.subVectors(b.p, a.p);
    e2.subVectors(c.p, a.p);
    faceN.crossVectors(e1, e2).normalize();
    const mid = tmp.copy(a.p).add(b.p).add(c.p).normalize();
    const slope = 1 - Math.abs(faceN.dot(mid)); // 0 flat, 1 vertical
    const hn = (a.h + b.h + c.h) / 3 / tileSpacing;
    const dn = (a.d + b.d + c.d) / 3;
    // Snow caps follow the massif core (depth) so they read as one cap, not speckles
    const snowy = dn > 1.55 - absLat * 0.9 && hn > 0.9 - absLat * 0.4;

    if (snowy && slope < 0.8) faceColor.copy(P.snow);
    else if (hn < 0.18) faceColor.copy(P.foothill).lerp(P.rock, hn / 0.18);
    else faceColor.copy(P.rock).lerp(P.rockDark, Math.min(1, hn * 0.5));
    if (slope > 0.6) faceColor.lerp(P.cliff, 0.45);

    for (let v = 0; v < 3; v++) colors.push(faceColor.r, faceColor.g, faceColor.b);
  };

  for (const tile of mountains) {
    const C = tile.center;
    const vC = depth.get(tile.id) ?? 1;
    const absLat = Math.abs(C.y);
    const n = tile.cornerIndices.length;
    for (let ci = 0; ci < n; ci++) {
      const ia = tile.cornerIndices[ci];
      const ib = tile.cornerIndices[(ci + 1) % n];
      const A0 = globalCorners[ia];
      const B0 = globalCorners[ib];
      const vA0 = valueOfCorner(ia);
      const vB0 = valueOfCorner(ib);
      // Each hex edge is bent through the same wobbly midpoint the land mesh uses,
      // so the massif meets the lowland without gaps.
      const sectors = [[A0, B0, vA0, vB0]];
      if (edgeMid) {
        const M = edgeMid(ia, ib);
        const nb = cornerTiles.get(ia).find((t) => t !== tile && cornerTiles.get(ib).includes(t));
        const nbMtn = nb && isMtn(nb);
        const vM = nbMtn ? Math.max((vA0 + vB0) / 2, Math.min(vC, depth.get(nb.id) ?? 1) * 0.5) : 0;
        sectors[0] = [A0, M, vA0, vM];
        sectors.push([M, B0, vM, vB0]);
      }
      for (const [A, B, vA, vB] of sectors) {
        const grid = [];
        for (let i = 0; i <= k; i++) {
          grid[i] = [];
          for (let j = 0; j <= k - i; j++) {
            const g = vertex(C, A, B, vC, vA, vB, i, j);
            grid[i][j] = g;
            if (g.h > (peaks.get(tile.id) ?? 0)) peaks.set(tile.id, g.h);
            const hn = g.h / tileSpacing;
            // interior grid points only (skip shared edge points so they are not doubled)
            if (hn > 0.06 && hn < 0.45 && i > 0 && j > 0 && i + j < k) foothills.push({ p: g.p, hn });
          }
        }
        for (let i = 0; i < k; i++) {
          for (let j = 0; j < k - i; j++) {
            pushTri(grid[i][j], grid[i + 1][j], grid[i][j + 1], absLat);
            if (j < k - i - 1) pushTri(grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1], absLat);
          }
        }
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals(); // non-indexed -> faceted low-poly normals
  return { geometry: geo, foothills, peaks };
}
