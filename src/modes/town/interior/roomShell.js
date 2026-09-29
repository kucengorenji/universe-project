import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ROOM_SCHEMES, ROOM_STAGE } from '../../../art/palette.js';

// Room shell in the kitchen-diorama look: a tiled, planked or carpeted floor on
// a wooden plinth, two-tone walls (panelled wainscot, chair rail, skirting) under
// a fat rounded cap, and a low stub for every wall. Interior.update shows the
// stub instead of the wall whenever that wall stands between camera and room,
// so the room reads as a cut-away model rather than losing whole walls.
//
// Walls are groups in their own frame: local X runs along the wall, the inner
// face is z = 0 and the room is on +Z. Anything hung on a wall is added to its
// `full` group, so it disappears with the wall.

export const WALL_H = 2.8;
export const WALL_T = 0.2;
const STUB_H = 0.62;
const WAINSCOT_H = 0.86;
export const WINDOW_Y = 1.72;

/** Scheme for a room kind; pick in [0, 1). */
export function roomScheme(kind, pick) {
  const list = ROOM_SCHEMES[kind] || ROOM_SCHEMES.house;
  return list[Math.min(list.length - 1, Math.floor(pick * list.length))];
}

/** Axis-aligned slab with metre UVs on every face (attribute uvm). */
export function slab(x0, x1, y0, y1, z0, z1) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const pos = g.attributes.position;
  const nrm = g.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (Math.abs(nrm.getY(i)) > 0.5) uv.set([x, z], i * 2);
    else if (Math.abs(nrm.getX(i)) > 0.5) uv.set([z, y], i * 2);
    else uv.set([x, y], i * 2);
  }
  g.setAttribute('uvm', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** Rounded box from bounds (trim, caps, frames). */
export function roundedSlab(x0, x1, y0, y1, z0, z1, r = 0.04) {
  const w = x1 - x0;
  const h = y1 - y0;
  const d = z1 - z0;
  const g = new RoundedBoxGeometry(w, h, d, 2, Math.min(r, Math.min(w, h, d) * 0.49));
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}

const paint = (color, roughness = 0.85) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });

const UVM_VERTEX = (shader) => {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec2 uvm;\nvarying vec2 vUvm;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvUvm = uvm;');
};

const FLOOR_GLSL = /* glsl */ `
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uC;
uniform float uKind;
uniform float uSeed;
varying vec2 vUvm;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed) * 43758.5453); }
// 1 inside, 0 on a line of half-width w (tile units) around the cell edge, anti-aliased
float inset(vec2 f, float w) {
  float d = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
  float aa = fwidth(d) * 1.2;
  return smoothstep(w - aa, w + aa, d);
}
vec3 floorColour(vec2 p) {
  if (uKind < 0.5) {
    // Glazed tiles, 0.5 m: checker, a few accent tiles, rounded edges, dark grout
    vec2 q = p / 0.5;
    vec2 cell = floor(q);
    vec2 f = fract(q);
    vec3 col = mix(uA, uB, mod(cell.x + cell.y, 2.0));
    if (h21(cell) > 0.9) col = uC;
    col *= 0.94 + 0.1 * h21(cell + 7.3);
    float d = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
    col *= mix(0.78, 1.0, smoothstep(0.02, 0.14, d));
    col *= 1.0 + 0.06 * smoothstep(0.35, 0.0, length(f - vec2(0.3, 0.7)));
    return mix(uA * 0.45, col, inset(f, 0.025));
  }
  if (uKind < 1.5) {
    // Planks 0.2 m wide in staggered runs, three tones, grain and dark joints
    float w = 0.2;
    float row = floor(p.y / w);
    float len = 1.4 + 0.8 * h21(vec2(row, 1.7));
    float along = (p.x + h21(vec2(row, 3.1)) * 3.0) / len;
    vec2 id = vec2(row, floor(along));
    float t = h21(id);
    vec3 col = t < 0.34 ? uA : t < 0.67 ? uB : uC;
    col *= 0.95 + 0.1 * h21(id + 5.1);
    float fy = fract(p.y / w);
    float grain = sin(p.y * 140.0 + sin(p.x * 2.3 + t * 17.0) * 3.0);
    col *= 0.975 + 0.035 * grain;
    col *= mix(0.84, 1.0, smoothstep(0.0, 0.18, fy) * smoothstep(1.0, 0.82, fy));
    float fa = fract(along);
    float d = min(min(fa, 1.0 - fa) * len, min(fy, 1.0 - fy) * w);
    float aa = fwidth(d) * 1.2;
    return mix(uA * 0.4, col, smoothstep(0.005 - aa, 0.005 + aa, d));
  }
  // Carpet tiles, 0.5 m, alternating pile direction and a fibre speckle
  vec2 q = p / 0.5;
  vec2 cell = floor(q);
  vec3 col = mix(uA, uB, mod(cell.x + cell.y, 2.0));
  col *= 0.96 + 0.08 * h21(floor(p * 45.0));
  return mix(uC * 0.8, col, inset(fract(q), 0.008));
}
`;

/** Procedural floor (tiles, planks or carpet) in world metres (slab uvm). */
export function floorMaterial(scheme, seed) {
  const f = scheme.floor;
  const m = paint(0xffffff, f.type === 'tiles' ? 0.45 : 0.75);
  const uni = {
    uA: { value: new THREE.Color(f.a) },
    uB: { value: new THREE.Color(f.b) },
    uC: { value: new THREE.Color(f.c) },
    uKind: { value: f.type === 'tiles' ? 0 : f.type === 'planks' ? 1 : 2 },
    uSeed: { value: (seed % 1009) * 0.173 }
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uni);
    UVM_VERTEX(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FLOOR_GLSL}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = floorColour(vUvm);');
  };
  m.customProgramCacheKey = () => 'room-floor';
  return m;
}

/** Painted tongue-and-groove boards (wainscot, stub walls): vertical grooves every 12 cm. */
function boardMaterial(color) {
  const m = paint(color, 0.7);
  m.onBeforeCompile = (shader) => {
    UVM_VERTEX(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vUvm;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float s = fract(vUvm.x / 0.12);
        float aa = fwidth(vUvm.x / 0.12) * 1.5;
        diffuseColor.rgb *= mix(0.8, 1.0, smoothstep(0.0, 0.06 + aa, s) * smoothstep(1.0, 0.94 - aa, s));`
      );
  };
  m.customProgramCacheKey = () => 'room-boards';
  return m;
}

/**
 * Build floor, plinth and walls into room.scene. Sets room.walls (groups with
 * full / stub children and an outward normal), room.panes, room.windowMat and
 * room.mats (wall, boards, trim) for partitions and stairs.
 */
export function buildShell(room, { scheme, night, seed }) {
  const { W, D } = room;
  const t = WALL_T;
  const track = (o) => room.track(o);
  const mats = {
    wall: track(paint(scheme.wall, 0.92)),
    boards: track(boardMaterial(scheme.wainscot)),
    trim: track(paint(scheme.trim, 0.6)),
    trimDark: track(paint(new THREE.Color(scheme.trim).multiplyScalar(0.72), 0.6)),
    floor: track(floorMaterial(scheme, seed))
  };
  room.mats = mats;
  room.scene.background = new THREE.Color(night > 0.5 ? ROOM_STAGE.night : ROOM_STAGE.day);
  const mesh = (geo, mat, parent = room.scene, { receive = true } = {}) => {
    const m = new THREE.Mesh(track(geo), mat);
    m.receiveShadow = receive;
    parent.add(m);
    return m;
  };

  // Floor on a plinth, with a trim ledge showing outside the walls
  mesh(slab(-W / 2 - t, W / 2 + t, -0.1, 0, -D / 2 - t, D / 2 + t), mats.floor);
  mesh(roundedSlab(-W / 2 - t - 0.14, W / 2 + t + 0.14, -0.13, -0.005, -D / 2 - t - 0.14, D / 2 + t + 0.14, 0.05), track(paint(ROOM_STAGE.plinthTop, 0.6)));
  mesh(roundedSlab(-W / 2 - t - 0.08, W / 2 + t + 0.08, -0.5, -0.1, -D / 2 - t - 0.08, D / 2 + t + 0.08, 0.06), track(paint(ROOM_STAGE.plinth, 0.7)));

  // Walls: back, left, right, front (the front one has the doorway on the ground floor)
  const skyCol = new THREE.Color(night > 0.5 ? 0x223558 : 0xd3ecf7);
  room.windowMat = track(new THREE.MeshBasicMaterial({ color: skyCol }));
  room.walls = [];
  room.panes = [];
  const door = room.floor === 0 ? { x: -room.door.x, w: 1.2, h: 2.25 } : null;
  const defs = [
    { pos: [0, 0, -D / 2], yaw: 0, len: W, ends: t, n: [0, -1] },
    { pos: [-W / 2, 0, 0], yaw: Math.PI / 2, len: D, ends: 0, n: [-1, 0] },
    { pos: [W / 2, 0, 0], yaw: -Math.PI / 2, len: D, ends: 0, n: [1, 0] },
    { pos: [0, 0, D / 2], yaw: Math.PI, len: W, ends: t, n: [0, 1], door }
  ];
  for (const def of defs) {
    const g = new THREE.Group();
    g.position.fromArray(def.pos);
    g.rotation.y = def.yaw;
    room.scene.add(g);
    const full = new THREE.Group();
    const stub = new THREE.Group();
    stub.visible = false;
    g.add(full, stub);
    g.userData.normal = new THREE.Vector2(def.n[0], def.n[1]);
    g.userData.full = full;
    g.userData.stub = stub;
    g.userData.len = def.len;
    const L = def.len / 2 + def.ends;
    const inner = def.len / 2;
    // Spans of the wall run, cut around the doorway
    const spans = def.door ? [[-L, def.door.x - def.door.w / 2], [def.door.x + def.door.w / 2, L]] : [[-L, L]];
    const inSpans = def.door ? [[-inner, def.door.x - def.door.w / 2], [def.door.x + def.door.w / 2, inner]] : [[-inner, inner]];
    for (const [a, b] of spans) {
      if (b - a < 0.01) continue;
      mesh(slab(a, b, 0, WALL_H, -t, 0), mats.wall, full);
      mesh(roundedSlab(a - 0.03, b + 0.03, WALL_H - 0.04, WALL_H + 0.1, -t - 0.06, 0.06, 0.05), mats.trim, full);
      mesh(slab(a, b, 0, STUB_H, -t, 0), mats.boards, stub);
      mesh(roundedSlab(a - 0.03, b + 0.03, STUB_H - 0.03, STUB_H + 0.09, -t - 0.06, 0.06, 0.05), mats.trim, stub);
    }
    for (const [a, b] of inSpans) {
      if (b - a < 0.01) continue;
      mesh(slab(a, b, 0, WAINSCOT_H, 0, 0.025), mats.boards, full);
      mesh(roundedSlab(a, b, WAINSCOT_H - 0.03, WAINSCOT_H + 0.05, -0.01, 0.06, 0.02), mats.trim, full);
      mesh(roundedSlab(a, b, 0, 0.1, -0.01, 0.05, 0.015), mats.trimDark, full);
      mesh(roundedSlab(a, b, 0, 0.1, -0.01, 0.05, 0.015), mats.trimDark, stub);
    }
    if (def.door) {
      const { x, w, h } = def.door;
      mesh(slab(x - w / 2, x + w / 2, h, WALL_H, -t, 0), mats.wall, full);
      mesh(roundedSlab(x - w / 2 - 0.03, x + w / 2 + 0.03, WALL_H - 0.04, WALL_H + 0.1, -t - 0.06, 0.06, 0.05), mats.trim, full);
      // Chunky frame and the daylight beyond the doorway
      for (const s of [-1, 1]) mesh(roundedSlab(x + s * (w / 2 + 0.06) - 0.07, x + s * (w / 2 + 0.06) + 0.07, 0, h + 0.1, -t - 0.02, 0.07, 0.03), mats.trim, full);
      mesh(roundedSlab(x - w / 2 - 0.13, x + w / 2 + 0.13, h, h + 0.17, -t - 0.02, 0.08, 0.035), mats.trim, full);
      const p = new THREE.Mesh(track(new THREE.PlaneGeometry(w, h)), room.windowMat);
      p.position.set(x, h / 2, -t - 0.01);
      full.add(p);
    }
    room.walls.push(g);
  }
  room.scene.updateMatrixWorld(true);
  return mats;
}

/** World (x, z) of a point on a wall given along-wall offset. */
export function wallToWorld(wall, x, z = 0.1) {
  const v = new THREE.Vector3(x, 0, z).applyMatrix4(wall.matrixWorld);
  return { x: v.x, z: v.z };
}

/** A glass pane (sky colour) centred at (x, y) on a wall, plus the chunky window frame from the pack. */
export function addWindow(room, wall, x, y, frameGeo, material) {
  const full = wall.userData.full;
  const pane = new THREE.Mesh(room.track(new THREE.PlaneGeometry(1.2, 1.2)), room.windowMat);
  pane.position.set(x, y, 0.012);
  full.add(pane);
  const parts = [pane];
  if (frameGeo) {
    const frame = new THREE.Mesh(frameGeo, material);
    frame.position.set(x, y, 0);
    frame.castShadow = false;
    frame.receiveShadow = true;
    full.add(frame);
    parts.push(frame);
  }
  const w = wallToWorld(wall, x);
  room.panes.push({ parts, x: w.x, z: w.z, wall, along: x, y });
}
