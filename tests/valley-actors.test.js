import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildTemplate, makeNpc, animateNpc } from '../src/modes/town/people/chunkyPeople.js';
import { templatesFrom, makeActor, LOOKS } from '../src/valley/world/actors.js';

const parse = (name) => {
  // npc.glb is no longer shipped (tools/blender/legacy); the shared template is still tested against it
  const bytes = readFileSync(new URL(name === 'npc' ? '../tools/blender/legacy/npc.glb' : `../public/models/${name}.glb`, import.meta.url));
  return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), '');
};

test('every valley look has a rigged template on the townsfolk bones, within budget (docs/FARM_PLAN.md §3)', async () => {
  const templates = templatesFrom(await parse('valley_actors'));
  for (const look of Object.values(LOOKS)) {
    const t = templates[look.actor];
    assert.ok(t, `no template for ${look.actor}`);
    // The player is the hero asset (gloves with fingers, laced boots, the six-panel cap): 6.5k; villagers 5k
    assert.ok(t.triangles < (look.actor === 'player' ? 6500 : 5000), `${look.actor}: ${t.triangles} triangles`);
    // Semi-chibi legs, measured from the pivots: a 0.58 m hip over 0.24 + 0.24 + 0.10
    assert.ok(Math.abs(t.legs.hipH - 0.58) < 0.01, `${look.actor} hip ${t.legs.hipH}`);
    assert.ok(Math.abs(t.legs.thigh - 0.24) < 0.005 && Math.abs(t.legs.shin - 0.24) < 0.005);
  }
});

test('a walking valley actor keeps its hips over its short legs', async () => {
  const templates = templatesFrom(await parse('valley_actors'));
  const p = makeActor(templates, 'player', { shadows: false });
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 180; i++) {
    animateNpc(p, 1 / 60, 2.1);
    if (i > 30) {
      lo = Math.min(lo, p.bones.hips.node.position.y);
      hi = Math.max(hi, p.bones.hips.node.position.y);
    }
  }
  // With the adult legs (0.905 m) the hips would sink by ~0.3 m and the feet would bury
  assert.ok(lo > 0.5 && hi < 0.63, `hips between ${lo.toFixed(3)} and ${hi.toFixed(3)}`);
});

test('town NPCs keep the adult leg lengths when nothing is measured', async () => {
  const template = buildTemplate(await parse('npc'));
  assert.equal(template.legs, null);
  assert.equal(makeNpc(template, { shadows: false }).legs.hipH, 0.905);
});
