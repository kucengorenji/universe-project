/** Exact segment/roof-volume test: the perspective boom's 16 samples miss nearby houses at an orthographic eye distance. */
export function pixelBuildingOccluded(from, to, blockers) {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  for (const box of blockers) {
    const c = Math.cos(box.yaw), s = Math.sin(box.yaw);
    const x = (from.x - box.x) * c + (from.z - box.z) * s;
    const z = -(from.x - box.x) * s + (from.z - box.z) * c;
    const axes = [[x, dx * c + dz * s, -box.hw, box.hw], [z, -dx * s + dz * c, -box.hd, box.hd], [from.y, dy, -Infinity, box.top]];
    let near = 0, far = 1, hit = true;
    for (const [origin, direction, min, max] of axes) {
      if (Math.abs(direction) < 1e-8) { if (origin < min || origin > max) { hit = false; break; } continue; }
      const a = (min - origin) / direction, b = (max - origin) / direction;
      near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b));
      if (near > far) { hit = false; break; }
    }
    if (hit && far > .0001 && near < .999) return true;
  }
  return false;
}
