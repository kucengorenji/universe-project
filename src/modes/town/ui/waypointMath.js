// The geometry behind the home locator and the minimap pin. Plain numbers in and out, so
// the rules (which edge, what gets avoided, when the pin clamps to the rim) are checkable.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Is the target on screen? `wasOn` gives the answer some stickiness: it takes `margin` px
 * further inside the screen to switch to the badge than to switch back to the edge arrow,
 * so a target sitting on the border does not flicker between the two.
 *   ndc     { x, y } in -1..1, or null
 *   behind  true when the target is behind the camera
 */
export function onScreen({ ndc, behind, width, height, margin = 16, wasOn = false }) {
  if (behind || !ndc) return false;
  const mx = (margin / (width / 2)) * (wasOn ? -1 : 1), my = (margin / (height / 2)) * (wasOn ? -1 : 1);
  return Math.abs(ndc.x) < 1 - mx && Math.abs(ndc.y) < 1 - my;
}

/**
 * Where the edge arrow sits. `dir` points from the screen centre toward the target
 * (screen pixels, y down). The arrow rides the inset rectangle at the point facing the target; when
 * a rectangle in `avoid` (minimap, prompt, tip, control strip, notice, buttons) is in the way, it moves
 * along the rectangle's edge to the nearest spot that clears every one of them by `gap` px. If the
 * whole edge is blocked it keeps the spot with the least overlap. `size` is the arrow's rendered box,
 * a number or { width, height }. The returned angle (radians, 0 = pointing right) never changes.
 */
export function edgeAnchor({ width, height, inset = 24, dir, size = 44, avoid = [], gap = 12 }) {
  const sw = typeof size === 'number' ? size : size.width, sh = typeof size === 'number' ? size : size.height;
  let { x: dx, y: dy } = dir;
  const len = Math.hypot(dx, dy);
  if (!len) { dx = 0; dy = 1; } else { dx /= len; dy /= len; }
  const left = inset + sw / 2, right = width - inset - sw / 2, top = inset + sh / 2, bottom = height - inset - sh / 2;
  const hw = (right - left) / 2, hh = (bottom - top) / 2;
  const k = Math.min(Math.abs(dx) > 1e-6 ? hw / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-6 ? hh / Math.abs(dy) : Infinity);
  const ideal = { x: width / 2 + dx * k, y: height / 2 + dy * k };
  const angle = Math.atan2(dy, dx);
  // how far the arrow, centred at (x, y), reaches into a rectangle once `gap` is added around it
  const overlap = (x, y) => avoid.reduce((sum, r) => {
    const ox = Math.min(x + sw / 2 + gap, r.right) - Math.max(x - sw / 2 - gap, r.left);
    const oy = Math.min(y + sh / 2 + gap, r.bottom) - Math.max(y - sh / 2 - gap, r.top);
    return ox > 0 && oy > 0 ? sum + ox * oy : sum;
  }, 0);
  if (!overlap(ideal.x, ideal.y)) return { ...ideal, angle };
  // walk the inset rectangle both ways from the ideal spot and take the nearest free one
  const w = right - left, h = bottom - top, perimeter = 2 * (w + h);
  const at = (t) => {
    t = ((t % perimeter) + perimeter) % perimeter;
    if (t < w) return { x: left + t, y: top };
    if (t < w + h) return { x: right, y: top + (t - w) };
    if (t < 2 * w + h) return { x: right - (t - w - h), y: bottom };
    return { x: left, y: bottom - (t - 2 * w - h) };
  };
  const onEdge = (x, y) => {
    const d = [[Math.abs(y - top), x - left], [Math.abs(x - right), w + (y - top)], [Math.abs(y - bottom), w + h + (right - x)], [Math.abs(x - left), 2 * w + h + (bottom - y)]];
    return d.reduce((best, c) => (c[0] < best[0] ? c : best))[1];
  };
  const t0 = onEdge(ideal.x, ideal.y), step = 4;
  let least = { ...ideal, cost: overlap(ideal.x, ideal.y) };
  for (let i = 1; i * step <= perimeter / 2; i++) {
    for (const sign of [1, -1]) {
      const p = at(t0 + sign * i * step);
      const cost = overlap(p.x, p.y);
      if (!cost) return { ...p, angle };
      if (cost < least.cost) least = { ...p, cost };
    }
  }
  return { x: least.x, y: least.y, angle };
}

/**
 * Pin position on the round minimap. `d` is the target relative to the player (metres),
 * `view` the horizontal camera direction that points up on the map, `radius` metres to the rim.
 * Returns map coordinates in -1..1 (x right, y down), whether the target is inside the map,
 * and, when outside, the pin clamped to just inside the rim along the direction to it.
 */
export function minimapPin({ d, view, radius, rim = 0.86 }) {
  const len = Math.hypot(view.x, view.z) || 1;
  const fx = view.x / len, fz = view.z / len, rx = -fz, rz = fx;
  const x = (rx * d.x + rz * d.z) / radius, y = -(fx * d.x + fz * d.z) / radius;
  const r = Math.hypot(x, y);
  if (r <= rim) return { x, y, inside: true, angle: Math.atan2(y, x) };
  return { x: (x / r) * rim, y: (y / r) * rim, inside: false, angle: Math.atan2(y, x) };
}

/**
 * Where a label whose anchor is `y` (its bottom edge) should sit so it does not lie under `panel`
 * (the objective bar). The label is `width` x `height`, centred on `x`. If it would overlap the panel it moves
 * down until its top is `gap` px under the panel; otherwise it stays. Returns the new y.
 */
export function clearOfPanel({ x, y, width, height, panel, gap = 8 }) {
  if (!panel) return y;
  const box = { left: x - width / 2, right: x + width / 2, top: y - height, bottom: y };
  const overlaps = box.right > panel.left && box.left < panel.right && box.bottom > panel.top && box.top < panel.bottom;
  return overlaps ? panel.bottom + gap + height : y;
}
