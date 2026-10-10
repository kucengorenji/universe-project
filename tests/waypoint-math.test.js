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
