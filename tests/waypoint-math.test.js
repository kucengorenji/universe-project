import test from 'node:test';
import assert from 'node:assert/strict';
import { onScreen, edgeAnchor, minimapPin } from '../src/modes/town/ui/waypointMath.js';

const W = 1280, H = 720;
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('a target behind the camera is never on screen; the badge/arrow switch has hysteresis', () => {
  assert.equal(onScreen({ ndc: { x: 0, y: 0 }, behind: true, width: W, height: H }), false);
  assert.equal(onScreen({ ndc: null, behind: false, width: W, height: H }), false);
  const edge = { x: 0.98, y: 0 }; // 12 px from the right border
  assert.equal(onScreen({ ndc: edge, behind: false, width: W, height: H, wasOn: false }), false, 'not yet back on screen');
  assert.equal(onScreen({ ndc: edge, behind: false, width: W, height: H, wasOn: true }), true, 'a badge stays a badge near the border');
  assert.equal(onScreen({ ndc: { x: 0.9, y: 0 }, behind: false, width: W, height: H }), true);
  assert.equal(onScreen({ ndc: { x: 1.2, y: 0 }, behind: false, width: W, height: H, wasOn: true }), false);
});

test('the edge arrow rides the inset rectangle in the direction of the target', () => {
  const right = edgeAnchor({ width: W, height: H, dir: { x: 1, y: 0 } });
  near(right.x, W - 24 - 22); near(right.y, H / 2); near(right.angle, 0);
  const up = edgeAnchor({ width: W, height: H, dir: { x: 0, y: -1 } });
  near(up.y, 24 + 22); near(up.x, W / 2); near(up.angle, -Math.PI / 2);
  const corner = edgeAnchor({ width: W, height: H, dir: { x: 1, y: 1 } });
  assert.ok(corner.x <= W - 24 - 22 + 1e-6 && corner.y <= H - 24 - 22 + 1e-6, 'never leaves the inset');
  const none = edgeAnchor({ width: W, height: H, dir: { x: 0, y: 0 } });
  near(none.y, H - 24 - 22); // straight behind: down
});

test('the arrow slides along the edge to clear the minimap and keeps pointing at the target', () => {
  const minimap = { left: W - 24 - 160, top: H / 2 - 80, right: W - 24, bottom: H / 2 + 80 }; // sits where the arrow would
  const plain = edgeAnchor({ width: W, height: H, dir: { x: 1, y: 0 } });
  const moved = edgeAnchor({ width: W, height: H, dir: { x: 1, y: 0 }, avoid: [minimap] });
  assert.ok(moved.y + 22 + 12 <= minimap.top + 1e-6 || moved.y - 22 - 12 >= minimap.bottom - 1e-6, 'clear of the minimap by 12 px');
  assert.equal(moved.angle, plain.angle);
  assert.ok(moved.x <= W - 24 - 22 + 1e-6);
  const bottomRect = { left: W / 2 - 100, top: H - 24 - 60, right: W / 2 + 100, bottom: H - 24 };
  const down = edgeAnchor({ width: W, height: H, dir: { x: 0, y: 1 }, avoid: [bottomRect] });
  assert.ok(down.x + 22 + 12 <= bottomRect.left + 1e-6 || down.x - 22 - 12 >= bottomRect.right - 1e-6, 'slides sideways on the bottom edge');
});

test('the minimap pin turns with the map, stays upright, and clamps to the rim when far away', () => {
  const view = { x: 0, z: -1 }; // looking north: -Z is up
  const ahead = minimapPin({ d: { x: 0, z: -45 }, view, radius: 90 });
  near(ahead.x, 0); near(ahead.y, -0.5); assert.equal(ahead.inside, true);
  const right = minimapPin({ d: { x: 45, z: 0 }, view, radius: 90 });
  assert.ok(right.x > 0.49 && Math.abs(right.y) < 1e-9, 'east is to the right when looking north');
  const turned = minimapPin({ d: { x: 45, z: 0 }, view: { x: 1, z: 0 }, radius: 90 });
  near(turned.x, 0); assert.ok(turned.y < 0, 'looking east, east is up');
  const far = minimapPin({ d: { x: 0, z: -900 }, view, radius: 90 });
  assert.equal(far.inside, false);
  near(Math.hypot(far.x, far.y), 0.86); near(far.x, 0);
  assert.ok(far.angle < 0, 'the angle still points at the target');
});

import { clearOfPanel } from '../src/modes/town/ui/waypointMath.js';

test('the home badge drops below the objective bar instead of hiding under it', () => {
  const panel = { left: 420, top: 76, right: 860, bottom: 150 };
  // anchored at y = 110: a 120 x 32 badge would span y 78..110, inside the panel
  assert.equal(clearOfPanel({ x: 640, y: 110, width: 120, height: 32, panel }), 150 + 8 + 32, 'its top is 8 px under the bar');
  assert.equal(clearOfPanel({ x: 640, y: 400, width: 120, height: 32, panel }), 400, 'elsewhere it stays on its door');
  assert.equal(clearOfPanel({ x: 100, y: 110, width: 120, height: 32, panel }), 110, 'beside the bar it stays');
  assert.equal(clearOfPanel({ x: 380, y: 110, width: 120, height: 32, panel }), 150 + 8 + 32, 'a badge that only grazes the bar is moved too');
  assert.equal(clearOfPanel({ x: 640, y: 110, width: 120, height: 32, panel: null }), 110, 'no bar, no change');
  const moved = clearOfPanel({ x: 640, y: 110, width: 120, height: 32, panel });
  assert.ok(moved - 32 >= panel.bottom + 8 - 1e-9);
});

// R4: the arrow keeps clear of every piece of HUD, not only the minimap and the prompt
const clears = (spot, size, rects, gap = 12) => rects.every((r) => !(spot.x + size.width / 2 + gap > r.left && spot.x - size.width / 2 - gap < r.right && spot.y + size.height / 2 + gap > r.top && spot.y - size.height / 2 - gap < r.bottom));
const HUD_1280 = (w = 1280, h = 720) => [
  { left: 0, top: 0, right: w, bottom: 80 }, // top bar
  { left: 24, top: h - 260, right: 208, bottom: h - 76 }, // minimap
  { left: w / 2 - 220, top: h - 156, right: w / 2 + 220, bottom: h - 76 }, // tip card
  { left: w / 2 - 64, top: h - 126, right: w / 2 + 64, bottom: h - 76 }, // prompt
  { left: w - 360, top: h - 56, right: w - 88, bottom: h - 25 }, // control strip
  { left: w - 76, top: h - 68, right: w - 28, bottom: h - 20 } // menu button
];

test('the arrow never overlaps the control strip: the Damar frame (target to the lower right)', () => {
  const size = { width: 56, height: 44 };
  const avoid = HUD_1280();
  for (const [w, h] of [[1280, 720], [800, 600]]) {
    const rects = HUD_1280(w, h);
    const spot = edgeAnchor({ width: w, height: h, dir: { x: 0.5, y: 0.3 }, size, avoid: rects });
    assert.ok(clears(spot, size, rects), `${w}x${h}: ${JSON.stringify(spot)}`);
    assert.ok(spot.x - size.width / 2 >= 24 - 1e-6 && spot.x + size.width / 2 <= w - 24 + 1e-6, 'inset kept');
    assert.ok(spot.y - size.height / 2 >= 24 - 1e-6 && spot.y + size.height / 2 <= h - 24 + 1e-6, 'inset kept');
    near(spot.angle, Math.atan2(0.3, 0.5));
  }
  assert.ok(avoid.length);
});

test('every direction clears every exclusion by 12 px and inset 24, at both screen sizes', () => {
  const size = { width: 56, height: 44 };
  for (const [w, h] of [[1280, 720], [800, 600]]) {
    const rects = HUD_1280(w, h);
    for (let a = 0; a < 360; a += 15) {
      const dir = { x: Math.cos((a * Math.PI) / 180), y: Math.sin((a * Math.PI) / 180) };
      const spot = edgeAnchor({ width: w, height: h, dir, size, avoid: rects });
      assert.ok(clears(spot, size, rects), `${w}x${h} at ${a}°: ${JSON.stringify(spot)}`);
      assert.ok(spot.x - size.width / 2 >= 24 - 1e-6 && spot.x + size.width / 2 <= w - 24 + 1e-6 && spot.y - size.height / 2 >= 24 - 1e-6 && spot.y + size.height / 2 <= h - 24 + 1e-6, `inset at ${a}°`);
      near(spot.angle, Math.atan2(dir.y, dir.x), 1e-9);
    }
  }
});

test('the arrow uses its rendered size, not an assumed 44 px', () => {
  const wide = { width: 120, height: 44 };
  const spot = edgeAnchor({ width: W, height: H, dir: { x: 0, y: -1 }, size: wide });
  near(spot.y, 24 + 22);
  const strip = [{ left: W / 2 - 40, top: 0, right: W / 2 + 40, bottom: 80 }];
  const moved = edgeAnchor({ width: W, height: H, dir: { x: 0, y: -1 }, size: wide, avoid: strip });
  assert.ok(moved.x + wide.width / 2 + 12 <= strip[0].left + 1e-6 || moved.x - wide.width / 2 - 12 >= strip[0].right - 1e-6, 'the clearance counts the whole pill');
});

test('when the preferred edge is full the arrow moves to a free edge instead of clamping on top of the HUD', () => {
  const full = [{ left: 0, top: 0, right: W, bottom: 120 }, { left: 0, top: H - 120, right: W, bottom: H }]; // top and bottom blocked
  const size = { width: 44, height: 44 };
  const spot = edgeAnchor({ width: W, height: H, dir: { x: 0, y: -1 }, size, avoid: full });
  assert.ok(clears(spot, size, full), JSON.stringify(spot));
  assert.ok(spot.x <= 24 + 22 + 1e-6 || spot.x >= W - 24 - 22 - 1e-6, 'it went to a side edge');
  const walled = [{ left: -10, top: -10, right: W + 10, bottom: H + 10 }];
  const last = edgeAnchor({ width: W, height: H, dir: { x: 1, y: 0 }, size, avoid: walled });
  assert.ok(Number.isFinite(last.x) && Number.isFinite(last.y), 'no free edge at all still returns a spot');
});
