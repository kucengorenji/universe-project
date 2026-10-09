import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildTemplate, makeNpc, animateNpc, setFace, disposeNpc } from '../../modes/town/people/chunkyPeople.js';
import { softRamp } from '../render/valleyMaterial.js';

// Valley actors (docs/FARM_PLAN.md §4, milestone V1): semi-chibi bodies from
// tools/blender/valley/build_valley_actors.py on the townsfolk rig, so the town's skinning,
// gait (animateNpc, with the shorter legs measured from the pivots), glances, blinks and
// expressions all carry over. Here they get the valley's soft ramp and an ink outline.

/** Palette per look: [skin, hair, top, under (apron/vest), legs (trousers/overall/skirt), shoes, cap]. */
export const LOOKS = {
  // The turnaround's swatches: skin, hair, cotton, (unused), denim, leather, cap
  player: { actor: 'player', palette: ['#f3c39b', '#7a4527', '#eee3c8', '#d9c39a', '#4b6ea8', '#8b5733', '#3a5aa8'], cap: true, mood: 'content' },
  seller: { actor: 'seller', palette: ['#f3c7a0', '#a8552f', '#f4d27a', '#fbf3e2', '#c8634a', '#6e4630', '#000000'], mood: 'smile' },
  child: { actor: 'child', palette: ['#f7d2b0', '#3c2a22', '#f7a8b8', '#ffffff', '#6aa35a', '#c8634a', '#000000'], mood: 'smile', scale: 0.84 },
  elder: { actor: 'elder', palette: ['#e8b892', '#ece6dc', '#c9d3b0', '#7a5a3c', '#8a6a4c', '#5a3a26', '#000000'], glasses: true, beard: true, mood: 'content', lean: 0.1 }
};

const OUTLINE = 0.0035; // metres, along the normal in the bind pose: barely there, as in the reference
// Coloured line: each part's own colour, darkened (soft like the reference, not black ink)
const INK = new THREE.Color('#7a6052');

/** Load the actors pack: one rig template per archetype (Blender's unique-name suffixes stripped). */
export async function loadActors(url) {
  return templatesFrom(await new GLTFLoader().loadAsync(url));
}

export function templatesFrom(gltf) {
  const templates = {};
  for (const actor of [...gltf.scene.children]) { // a copy: each actor moves into its own group
    // Blender's .001 arrives as 001: GLTFLoader drops the dot when it sanitises node names
    const strip = (name) => name.replace(/\.?\d{3}$/, '');
    const id = strip(actor.name).replace(/^actor_/, '');
    actor.traverse((o) => { o.name = strip(o.name); });
    const scene = new THREE.Group();
    scene.add(actor);
    const template = buildTemplate({ scene }, { measureLegs: true, vertexShade: true });
    if (template) templates[id] = template;
  }
  return templates;
}

/** Outline: the same skinned geometry pushed out along its normals, back faces only, coloured. */
function outlineMaterial(uniforms) {
  const m = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide, vertexColors: true });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uHide = uniforms.uHide;
    shader.uniforms.uPalette = uniforms.uPalette;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aPiece;\nattribute float aExpr;\nattribute float aSlot;\nuniform vec4 uHide;\nuniform vec3 uPalette[7];')
      .replace('#include <color_vertex>', `#include <color_vertex>
        int slotIndex = int(aSlot + 0.5);
        if (slotIndex > 0) vColor.rgb *= uPalette[slotIndex - 1];`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed += normalize(objectNormal) * ${OUTLINE.toFixed(4)};
        // Hidden pieces stay hidden, and thin face features and glasses get no outline
        int piece = int(aPiece + 0.5);
        if (aExpr > 0.5 || piece == 1 || (piece > 1 && piece < 5 && uHide[piece - 1] > 0.5) || (piece == 5 && uHide[2] < 0.5) || piece == 6) transformed = vec3(0.0);`);
  };
  m.customProgramCacheKey = () => 'valley-outline-colour';
  return m;
}

/**
 * Cloth you can almost feel, as in the reference renders: a diagonal twill on denim, a fine
 * slub on cotton, mottling on leather, a soft weave on the cap. Drawn in the bind pose (vBind),
 * so it sticks to the cloth as the body moves; fades out with distance before it could shimmer.
 */
function addFabric(material) {
  const base = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    base(shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('varying float vDepth;', 'varying float vDepth;\nvarying float vFabricSlot;')
      .replace('vDepth = -mvPosition.z;', 'vDepth = -mvPosition.z;\nvFabricSlot = aSlot;');
    shader.fragmentShader = shader.fragmentShader
      .replace('varying float vDepth;', `varying float vDepth;
        varying float vFabricSlot;
        float fabricHash(vec3 p) { return fract(sin(dot(floor(p), vec3(12.9898, 78.233, 37.719))) * 43758.5453); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          int fabricSlot = int(vFabricSlot + 0.5);
          float near = 1.0 - smoothstep(4.0, 12.0, vDepth);
          float f = 0.0;
          if (fabricSlot == 5) {
            // Denim: 3/1 twill running diagonally, a few lighter slubs
            float twill = sin((vBind.x + vBind.y * 0.6 + vBind.z * 0.9) * 520.0);
            f = twill * 0.045 + (fabricHash(vBind * 140.0) - 0.5) * 0.05;
          } else if (fabricSlot == 3 || fabricSlot == 4) {
            f = (fabricHash(vBind * 220.0) - 0.5) * 0.035 + sin(vBind.y * 900.0) * 0.012;
          } else if (fabricSlot == 6) {
            f = (fabricHash(vBind * 60.0) - 0.5) * 0.08 + (fabricHash(vBind * 180.0) - 0.5) * 0.04;
          } else if (fabricSlot == 7) {
            f = sin(vBind.x * 700.0) * sin(vBind.y * 700.0) * 0.03;
          }
          diffuseColor.rgb *= 1.0 + f * near;
        }`);
  };
  const key = material.customProgramCacheKey();
  material.customProgramCacheKey = () => `${key}-fabric`;
}

/** A dressed actor: the town person record plus its outline mesh. */
export function makeActor(templates, lookName, { shadows = true } = {}) {
  const look = LOOKS[lookName];
  // Flat colour: the town's 2 cm painted pixels read as noise at the valley's camera distance
  const p = makeNpc(templates[look.actor], { shadows, gradientMap: softRamp(), pixels: false });
  addFabric(p.material);
  const u = p.material.userData.uniforms;
  u.uPalette.value.forEach((c, i) => c.set(look.palette[i]));
  // uHide: glasses, beard, cap, cup (1 = hidden). The hair crown shows whenever the cap is off.
  u.uHide.value.set(look.glasses ? 0 : 1, look.beard ? 0 : 1, look.cap ? 0 : 1, 1);
  u.uTie.value = 0;
  p.style = { stride: 1, arm: 1.1, bounce: 1.2, lean: look.lean || 0, sway: 1, seed: Math.random() * 100 };
  p.mood = look.mood;
  p.look.next = 0.5;
  const outline = new THREE.SkinnedMesh(p.mesh.geometry, outlineMaterial(u));
  outline.name = 'outline';
  outline.frustumCulled = false;
  p.mesh.parent.add(outline);
  outline.bind(p.mesh.skeleton, p.mesh.bindMatrix);
  p.outline = outline;
  if (look.scale) p.root.scale.setScalar(look.scale);
  p.lookName = lookName;
  setFace(p, p.mood);
  return p;
}

export function animateActor(p, dt, speed, opts) {
  animateNpc(p, dt, speed, opts);
}

export function disposeActor(p) {
  p.outline?.material.dispose();
  disposeNpc(p);
}
