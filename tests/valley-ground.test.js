import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildHeightField, padDistance, polylineDistance, closestOnPolyline, tangentAt, deckHeight } from '../src/valley/world/valleyGround.js';
import { scatterRules, solidsOf } from '../src/valley/world/scatter.js';

const BRIDGES = JSON.parse(readFileSync(new URL('../src/valley/world/bridges.json', import.meta.url)));

const layout = JSON.parse(readFileSync(new URL('../src/valley/world/layout.json', import.meta.url)));
const kit = JSON.parse(readFileSync(new URL('../docs/qa/valley/kit.json', import.meta.url)));
const ground = buildHeightField(layout);

test('site first: every pad is flat under its footprint (docs/FARM_PLAN.md §6 rule 1)', () => {
  for (const pad of ground.pads.values()) {
    let worst = 0;
    for (let x = pad.x - pad.w / 2; x <= pad.x + pad.w / 2; x += 0.25) {
      for (let z = pad.z - pad.d / 2; z <= pad.z + pad.d / 2; z += 0.25) {
        if (padDistance(pad, x, z) > -0.6) continue; // the outer half metre blends into the shoulder grid cell
        worst = Math.max(worst, Math.abs(ground.heightAt(x, z) - pad.y));
      }
    }
    assert.ok(worst < 0.01, `${pad.id} varies by ${worst.toFixed(3)} m`);
  }
});

test('pads stay above the water line and away from the river', () => {
  for (const pad of ground.pads.values()) {
    assert.ok(pad.y > layout.water + 0.5, `${pad.id} at ${pad.y}`);
    assert.ok(ground.riverDistance(pad.x, pad.z) > layout.river.width / 2 + pad.margin, pad.id);
  }
});

test('heightAt returns the grid samples at grid nodes', () => {
  const { n, half, heights } = ground;
  for (const [i, j] of [[0, 0], [17, 40], [80, 80], [n - 1, n - 1]]) {
    assert.ok(Math.abs(ground.heightAt(-half + i, -half + j) - heights[j * n + i]) < 1e-4);
  }
});

test('layout references only kit assets that exist, and pads that exist', () => {
  for (const o of layout.objects) {
    assert.ok(kit.triangles[o.kit], `unknown kit asset ${o.kit}`);
    if (o.pad) assert.ok(ground.pads.has(o.pad), `unknown pad ${o.pad}`);
  }
});

test('paths never run into the river, and the field fence leaves a gate for its path', () => {
  for (const p of layout.paths) {
    for (const [x, z] of p.points) {
      if (Math.abs(x) >= layout.size / 2 || Math.abs(z) >= layout.size / 2) continue;
      assert.ok(ground.riverDistance(x, z) > layout.river.width / 2 + p.width, `path point ${x},${z}`);
    }
  }
  const gate = layout.paths[1].points.at(-1);
  assert.ok(polylineDistance(layout.fences[0].points, ...gate) > 0.6, 'field path ends in the fence');
});

test('kit stays within its budgets (docs/FARM_PLAN.md §3)', () => {
  const t = kit.triangles;
  for (const [name, { total }] of Object.entries(t)) {
    // The player's farmhouse is the hero building (tiled roof, plank walls, porch): 7.5k
    const limit = /_far$/.test(name) ? 700 : /^tree_/.test(name) ? 3000 : name === 'house_player' ? 7500 : /^(house|shop|barn|coop|bridge)/.test(name) ? 5000 : 1500;
    assert.ok(total <= limit, `${name}: ${total} > ${limit}`);
  }
  for (const tree of ['tree_oak', 'tree_apple', 'tree_sakura', 'tree_pine']) assert.ok(t[`${tree}_far`], `${tree} has no far stand-in`);
});

test('rule 2: the bridge crosses square to the flow with both abutments at one height', () => {
  assert.equal(ground.bridges.length, layout.crossings.length);
  for (const b of ground.bridges) {
    const [a, c] = b.pads;
    assert.equal(a.y, c.y);
    for (const pad of b.pads) assert.ok(Math.abs(ground.heightAt(pad.x, pad.z) - pad.y) < 0.01, `${pad.id} not flat`);
    // Deck ends flush with the abutments (plank thickness only), within 2 cm
    for (const u of [-b.span / 2, b.span / 2]) assert.ok(Math.abs(deckHeight(b, u) - BRIDGES.lift - b.y) < 0.02);
    const at = closestOnPolyline(layout.river.points, b.x, b.z), t = tangentAt(layout.river.points, at.s, 2);
    const skew = Math.abs(90 - (Math.acos(Math.abs(t.x * b.n.x + t.z * b.n.z)) * 180) / Math.PI);
    assert.ok(skew <= BRIDGES.maxSkewDeg, `skew ${skew.toFixed(1)} deg`);
    assert.ok(b.span >= layout.river.width + 2 * BRIDGES.bank, 'span too short for the river');
    // The rerouted path runs onto the deck at both ends
    const path = ground.paths[layout.crossings[0].path];
    const [p0, p1] = [path.points[path.deck], path.points[path.deck + 1]];
    const ends = b.ends.map((e) => [e.x, e.z]);
    for (const p of [p0, p1]) assert.ok(ends.some((e) => Math.hypot(e[0] - p[0], e[1] - p[1]) < 1e-6), 'deck segment does not meet the bridge');
    // And the deck is walkable above the water
    assert.ok(ground.surfaceAt(b.x, b.z) > layout.water + 0.3);
  }
});

test('rule 3: the square goes to the best candidate that passes, or is left out', () => {
  const f = ground.features[0];
  const best = f.candidates.reduce((a, c) => (c.score > a.score ? c : a));
  assert.ok(f.placed && f.x === best.x && f.z === best.z && f.score >= layout.features[0].minScore);
  assert.ok(ground.featureObjects.length === layout.features[0].contents.length);
  const strict = buildHeightField({ ...layout, features: [{ ...layout.features[0], minScore: 0.99 }] });
  assert.equal(strict.features[0].placed, false);
  assert.equal(strict.featureObjects.length, 0);
  assert.ok(!strict.pads.has('square'), 'a skipped feature must not flatten the ground');
});

test('rule 4: scatter keeps off paths and pads, trees keep their distance, bank rocks hug the river', () => {
  const objects = [...layout.objects, ...ground.featureObjects];
  const scattered = scatterRules(ground, layout, objects);
  const trees = [...objects, ...scattered].filter((o) => o.kit.startsWith('tree_'));
  for (const o of scattered) {
    for (const p of ground.paths) assert.ok(polylineDistance(p.points, o.x, o.z) > p.width / 2, `${o.kit} on a path`);
    if (o.scatter !== 'corner') for (const pad of ground.pads.values()) assert.ok(padDistance(pad, o.x, o.z) > 0, `${o.kit} on pad ${pad.id}`);
    if (o.scatter === 'bank') assert.ok(ground.riverDistance(o.x, o.z) < layout.river.width / 2 + 3);
    if (o.scatter === 'forest') for (const t of trees) if (t !== o) assert.ok(Math.hypot(t.x - o.x, t.z - o.z) >= 4.5 - 1e-6);
  }
  assert.ok(scattered.filter((o) => o.scatter === 'forest').length >= 40, 'forest ring too thin');
  // Corner bushes stay outside the walls
  const solids = solidsOf(objects).filter((s) => s.kind === 'rect');
  for (const o of scattered.filter((o) => o.scatter === 'corner')) for (const s of solids) assert.ok(padDistance(s, o.x, o.z) > 0);
});
