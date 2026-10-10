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
 * (screen pixels, y down). The arrow rides the inset rectangle, then slides along that edge
 * until it clears every rectangle in `avoid` (minimap, prompt, buttons) by `gap` px.
 * The returned angle (radians, 0 = pointing right) is unchanged by the sliding.
 */
export function edgeAnchor({ width, height, inset = 24, dir, size = 44, avoid = [], gap = 12 }) {
  let { x: dx, y: dy } = dir;
  const len = Math.hypot(dx, dy);
  if (!len) { dx = 0; dy = 1; } else { dx /= len; dy /= len; }
  const hw = width / 2 - inset - size / 2, hh = height / 2 - inset - size / 2;
  const k = Math.min(Math.abs(dx) > 1e-6 ? hw / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-6 ? hh / Math.abs(dy) : Infinity);
  let x = width / 2 + dx * k, y = height / 2 + dy * k;
  const alongX = Math.abs(dy) >= Math.abs(dx) * (hh / hw); // on the top or bottom edge: slide sideways
  const hits = (rect) => x + size / 2 + gap > rect.left && x - size / 2 - gap < rect.right && y + size / 2 + gap > rect.top && y - size / 2 - gap < rect.bottom;
  for (let pass = 0; pass < 6; pass++) {
    const rect = avoid.find(hits);
    if (!rect) break;
    if (alongX) {
      const left = rect.left - size / 2 - gap, right = rect.right + size / 2 + gap;
      x = Math.abs(x - left) < Math.abs(x - right) ? left : right;
    } else {
      const top = rect.top - size / 2 - gap, bottom = rect.bottom + size / 2 + gap;
      y = Math.abs(y - top) < Math.abs(y - bottom) ? top : bottom;
    }
    x = clamp(x, inset + size / 2, width - inset - size / 2);
    y = clamp(y, inset + size / 2, height - inset - size / 2);
  }
  return { x, y, angle: Math.atan2(dy, dx) };
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
