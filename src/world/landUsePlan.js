export function footprintSamples({ x, z, hw, hd, yaw = 0 }, spacing = 3) {
  const points = [];
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const nx = Math.max(1, Math.ceil(hw * 2 / spacing));
  const nz = Math.max(1, Math.ceil(hd * 2 / spacing));
  for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) {
    const u = -hw + i * hw * 2 / nx, v = -hd + j * hd * 2 / nz;
    points.push({ x: x + u * c - v * s, z: z + u * s + v * c });
  }
  return points;
}

export function dryFootprint(rect, sample, riverDistance, clearance = 1) {
  return footprintSamples(rect).every(p => sample(p.x, p.z).land >= 0.68 && riverDistance(p.x, p.z) >= clearance);
}

export function containsField(field, x, z, margin = 0) {
  const c = Math.cos(field.yaw), s = Math.sin(field.yaw);
  const dx = x - field.x, dz = z - field.z;
  return Math.abs(dx * c + dz * s) <= field.w / 2 + margin && Math.abs(-dx * s + dz * c) <= field.d / 2 + margin;
}
