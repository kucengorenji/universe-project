// 2D collision against the town's buildings, walls and props: circles pushed
// out of oriented boxes and circles, looked up through a uniform grid.
// Box orientation follows the layout convention: local X = (cos yaw, sin yaw).

const CELL = 16;

export class Colliders {
  constructor(list) {
    this.map = new Map();
    for (const c of list) {
      const r = c.type === 'box' ? Math.hypot(c.hw, c.hd) : c.r;
      for (let i = Math.floor((c.x - r) / CELL); i <= Math.floor((c.x + r) / CELL); i++) {
        for (let j = Math.floor((c.z - r) / CELL); j <= Math.floor((c.z + r) / CELL); j++) {
          const k = i * 4096 + j;
          if (!this.map.has(k)) this.map.set(k, []);
          this.map.get(k).push(c);
        }
      }
    }
  }

  near(x, z, r) {
    const out = new Set();
    for (let i = Math.floor((x - r) / CELL); i <= Math.floor((x + r) / CELL); i++) {
      for (let j = Math.floor((z - r) / CELL); j <= Math.floor((z + r) / CELL); j++) {
        const list = this.map.get(i * 4096 + j);
        if (list) list.forEach((c) => out.add(c));
      }
    }
    return out;
  }

  /** Where a circle of radius r at (x, z) ends up after being pushed out of everything. */
  resolve(x, z, r) {
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (const c of this.near(x, z, r + 2)) {
        if (c.type === 'circle') {
          const dx = x - c.x;
          const dz = z - c.z;
          const d = Math.hypot(dx, dz);
          const min = r + c.r;
          if (d < min) {
            const nx = d > 1e-6 ? dx / d : 1;
            const nz = d > 1e-6 ? dz / d : 0;
            x = c.x + nx * min;
            z = c.z + nz * min;
            moved = true;
          }
          continue;
        }
        const ca = Math.cos(c.yaw);
        const sa = Math.sin(c.yaw);
        const dx = x - c.x;
        const dz = z - c.z;
        // Into box space
        let lx = dx * ca + dz * sa;
        let lz = -dx * sa + dz * ca;
        const qx = Math.max(-c.hw, Math.min(c.hw, lx));
        const qz = Math.max(-c.hd, Math.min(c.hd, lz));
        const ex = lx - qx;
        const ez = lz - qz;
        const d = Math.hypot(ex, ez);
        if (d >= r) continue;
        if (d > 1e-6) {
          lx = qx + (ex / d) * r;
          lz = qz + (ez / d) * r;
        } else {
          // Centre inside the box: leave through the nearest face
          const px = c.hw - Math.abs(lx);
          const pz = c.hd - Math.abs(lz);
          if (px < pz) lx = Math.sign(lx || 1) * (c.hw + r);
          else lz = Math.sign(lz || 1) * (c.hd + r);
        }
        x = c.x + lx * ca - lz * sa;
        z = c.z + lx * sa + lz * ca;
        moved = true;
      }
      if (!moved) break;
    }
    return { x, z };
  }
}
