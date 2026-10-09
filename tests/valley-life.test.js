import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildHeightField, polylineDistance } from '../src/valley/world/valleyGround.js';
import { buildNav, route } from '../src/valley/world/nav.js';
import { ROUTINES, LINES, anchors } from '../src/valley/world/villagers.js';
import { animalTemplates } from '../src/valley/world/animals.js';

const layout = JSON.parse(readFileSync(new URL('../src/valley/world/layout.json', import.meta.url)));
const ground = buildHeightField(layout);

test('routes follow the path network and end at the goal', () => {
  const nav = buildNav(ground.paths);
  const from = [6.6, -1.4], to = [ground.features[0].x, ground.features[0].z - 1.8]; // field gate -> shop front
  const pts = route(nav, from, to);
  assert.deepEqual(pts.at(-1), to);
  assert.ok(pts.length > 3, 'a long trip goes along the paths');
  // Every waypoint but the last is on a path
  for (const p of pts.slice(0, -1)) assert.ok(ground.paths.some((q) => polylineDistance(q.points, ...p) < q.width), `${p} is off the paths`);
  assert.deepEqual(route(nav, [0, 0], [3, 1]), [[3, 1]], 'a short hop goes straight');
});

test('every routine names a real place, and every awake time has something to say', () => {
  const a = anchors(ground, layout);
  for (const [who, day] of Object.entries(ROUTINES)) {
    for (const [time, act] of Object.entries(day)) {
      assert.ok(a[act.at], `${who} ${time}: no anchor ${act.at}`);
      if (act.kind === 'sit') assert.ok(a[act.at].pos && Number.isFinite(a[act.at].face), `${who} ${time}: a seat needs a position and a facing`);
      if (act.kind !== 'home') assert.ok(LINES[who][time]?.length, `${who} has nothing to say at ${time}`);
    }
  }
});

test('animals: one rigid-skinned template each, within budget', async () => {
  const bytes = readFileSync(new URL('../public/models/valley_animals.glb', import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), '');
  const t = animalTemplates(gltf);
  const budget = { chicken: 1400, cow: 2000, dog: 1500 }; // smoother bodies, glossy eyes and cheeks since the HoLV pass
  for (const [id, limit] of Object.entries(budget)) {
    assert.ok(t[id], `no ${id}`);
    assert.ok(t[id].triangles <= limit, `${id}: ${t[id].triangles}`);
    const bones = [];
    t[id].root.traverse((o) => o.isBone && bones.push(o.name));
    for (const b of ['root', 'body', 'neck', 'head', 'tail']) assert.ok(bones.includes(b), `${id} lacks ${b}`);
  }
});
