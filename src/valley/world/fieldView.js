import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createValleyMaterial } from '../render/valleyMaterial.js';
import PALETTE from '../valleyPalette.json';

// What the field looks like (world/fieldState.js): every tilled cell is a soft square mound of
// broken soil, darker and glossier while wet; crops stand on their cells (one instanced batch per
// stage); a cursor frames the cell the player is facing.

const SEG = 3; // quads per cell side
const MOUND = 0.07;
const S = PALETTE.surface;

export class FieldView {
  constructor(state, ground, kit) {
    this.state = state;
    this.ground = ground;
    this.group = new THREE.Group();
    this.group.name = 'field';
    const n = state.cols * state.rows, vpc = (SEG + 1) ** 2;
    const pos = new Float32Array(n * vpc * 3), col = new Float32Array(n * vpc * 3), index = [];
    for (let i = 0; i < n; i++) {
      const base = i * vpc;
      for (let a = 0; a < SEG; a++) for (let b = 0; b < SEG; b++) {
        const v = base + a * (SEG + 1) + b;
        index.push(v, v + SEG + 1, v + 1, v + 1, v + SEG + 1, v + SEG + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(index);
    this.soil = new THREE.Mesh(g, createValleyMaterial({ vertexColors: true, brush: 0.14 }));
    this.soil.receiveShadow = true;
    this.soil.name = 'field-soil';
    this.group.add(this.soil);
    this.colors = { tilled: new THREE.Color(S.fieldDark), top: new THREE.Color(S.field), wetTint: new THREE.Color('#5a4a52') };

    // Crops: one instanced batch per stage, every cell capacity
    this.crops = ['crop_sprout', 'crop_leafy', 'crop_ripe'].map((asset) => {
      const parts = kit[asset].map(({ geometry, material }) => {
        const mesh = new THREE.InstancedMesh(geometry, material, n);
        mesh.count = 0;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.group.add(mesh);
        return mesh;
      });
      return parts;
    });

    // Cursor: four thin bars around the facing cell, one mesh
    const bars = [0, 1, 2, 3].map((k) => {
      const side = k < 2 ? 1 : -1, bar = new THREE.BoxGeometry(state.cell + 0.05, 0.03, 0.05);
      if (k % 2 === 0) return bar.translate(0, 0, (side * state.cell) / 2);
      return bar.rotateY(Math.PI / 2).translate((side * state.cell) / 2, 0, 0);
    });
    this.cursor = new THREE.Mesh(mergeGeometries(bars), new THREE.MeshBasicMaterial({ color: '#fff6d8', transparent: true, opacity: 0.85, depthWrite: false }));
    bars.forEach((g) => g.dispose());
    this.cursor.name = 'field-cursor';
    this.cursor.visible = false;
    this.group.add(this.cursor);
    this.built = -1;
    this.wait = 0;
    this.refresh();
  }

  /** Rebuild the soil and crops after a change, and every 0.25 s while cells dry. */
  update(dt, drying) {
    this.wait -= dt;
    if (this.state.version !== this.built || (drying && this.wait <= 0)) this.refresh();
  }

  refresh() {
    const st = this.state, { cell, cols } = st, vpc = (SEG + 1) ** 2;
    const pos = this.soil.geometry.attributes.position, col = this.soil.geometry.attributes.color;
    const c = new THREE.Color();
    for (let i = 0; i < st.tilled.length; i++) {
      const cx = i % cols, cr = Math.floor(i / cols), x0 = st.x0 + cx * cell, z0 = st.z0 + cr * cell;
      const tilled = st.tilled[i], wet = st.wet[i];
      for (let a = 0; a <= SEG; a++) for (let b = 0; b <= SEG; b++) {
        const v = i * vpc + a * (SEG + 1) + b, u = b / SEG, w = a / SEG;
        const x = x0 + u * cell, z = z0 + w * cell;
        // Mound: highest in the middle of the cell, a small gap of furrow at its edges
        const m = Math.sin(Math.PI * Math.min(1, Math.max(0, (u - 0.06) / 0.88))) ** 0.7 * Math.sin(Math.PI * Math.min(1, Math.max(0, (w - 0.06) / 0.88))) ** 0.7;
        const visible = tilled || wet > 0;
        const y = visible ? this.ground.heightAt(x, z) + 0.012 + (tilled ? m * MOUND : 0) : this.ground.heightAt(x, z) - 0.2;
        pos.setXYZ(v, x, y, z);
        if (tilled) c.copy(this.colors.tilled).lerp(this.colors.top, m * 0.8);
        else c.copy(this.colors.tilled).lerp(this.colors.top, 0.3);
        // Wet soil: darker, a little cooler
        if (wet > 0) c.multiplyScalar(1 - 0.42 * Math.min(1, wet * 1.6)).lerp(this.colors.wetTint, 0.18 * wet);
        col.setXYZ(v, c.r, c.g, c.b);
      }
    }
    pos.needsUpdate = col.needsUpdate = true;
    this.soil.geometry.computeVertexNormals();
    this.soil.geometry.computeBoundingSphere();

    // Crops: sit on the mound top, a little turn each so the rows do not look stamped
    const counts = [0, 0, 0], m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1.7, 1.7, 1.7), p = new THREE.Vector3();
    for (let i = 0; i < st.crop.length; i++) {
      const stage = st.crop[i];
      if (!stage) continue;
      const [x, z] = st.center(i % cols, Math.floor(i / cols));
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, i * 2.39);
      m4.compose(p.set(x, this.ground.heightAt(x, z) + MOUND * 0.8, z), q, s);
      for (const mesh of this.crops[stage - 1]) mesh.setMatrixAt(counts[stage - 1], m4);
      counts[stage - 1]++;
    }
    this.crops.forEach((parts, k) => parts.forEach((mesh) => {
      mesh.count = counts[k];
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }));
    this.built = st.version;
    this.wait = 0.25;
  }

  /** Frame a cell (or hide the cursor with null). */
  showCursor(cell, t) {
    this.cursor.visible = !!cell;
    if (!cell) return;
    const [x, z] = this.state.center(cell.c, cell.r);
    this.cursor.position.set(x, this.ground.heightAt(x, z) + MOUND + 0.03, z);
    const k = 0.75 + 0.25 * Math.sin(t * 6);
    this.cursor.material.opacity = 0.55 + 0.35 * k;
  }
}
