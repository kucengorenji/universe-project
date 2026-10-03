import * as THREE from 'three';

// Painted faces for the skirmish soldiers, after the Valkyria Chronicles look: almond eyes with a
// heavy upper lash line, a large graded iris and a highlight, thin brows, a nose and mouth of a
// few soft strokes, blush and a little painted shading. Drawn with Canvas 2D into a texture that
// vcSoldiers.js projects from the front onto the head's "face" piece (soldier_vc.py builds the
// head with no eyes or mouth). Left half of the canvas: eyes open; right half: eyes shut.

/** The projected rectangle, in metres: Blender x / z (= glTF x / y) of the rest pose. */
export const FACE_RECT = { x0: -0.08, x1: 0.08, z0: 1.47, z1: 1.67 };
const EYE_Z = 1.594; // soldier_vc.py EYE_Z
const PX = 3200; // pixels per metre
const W = (FACE_RECT.x1 - FACE_RECT.x0) * PX; // 512
const H = (FACE_RECT.z1 - FACE_RECT.z0) * PX; // 640
const X = (x) => (x - FACE_RECT.x0) * PX;
const Y = (z) => (FACE_RECT.z1 - z) * PX;

const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mul = (c, k) => (Array.isArray(k) ? c.map((v, i) => v * k[i]) : c.map((v) => v * k));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const css = (c, a = 1) => `rgba(${c.map((v) => Math.round(Math.max(0, Math.min(255, v)))).join(',')},${a})`;

/**
 * spec: { skin, hair, iris, female, eye: { w, h, tilt, x, iris }, brow: { thick, arch, tilt, gap },
 *         mouth: { w, smile }, blush, freckles, mole: [x, z] | null, scar: bool }
 * Sizes in metres; everything optional except the colours.
 */
export function paintFace(spec) {
  const c = document.createElement('canvas');
  c.width = W * 2;
  c.height = H;
  const g = c.getContext('2d');
  const s = withDefaults(spec);
  for (const shut of [false, true]) {
    g.save();
    g.translate(shut ? W : 0, 0);
    g.beginPath();
    g.rect(0, 0, W, H);
    g.clip();
    shading(g, s);
    blush(g, s);
    if (s.freckles) freckles(g, s);
    nose(g, s);
    mouth(g, s);
    for (const side of [-1, 1]) {
      eye(g, s, side, shut);
      brow(g, s, side);
    }
    if (s.mole) dot(g, X(s.mole[0]), Y(s.mole[1]), 2.2, css(mul(s.skinC, 0.45), 0.85));
    if (s.scar) scar(g, s);
    g.restore();
  }
  return c;
}

const cache = new Map();
/** A shared CanvasTexture per face spec. */
export function faceTexture(spec) {
  const key = JSON.stringify(spec);
  if (!cache.has(key)) {
    const t = new THREE.CanvasTexture(paintFace(spec));
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    cache.set(key, t);
  }
  return cache.get(key);
}

function withDefaults(spec) {
  const female = !!spec.female;
  const eye = { w: 0.032, h: 0.019, tilt: 0.1, x: 0.0335, iris: 0.62, ...spec.eye };
  return {
    ...spec,
    female,
    eye,
    brow: { thick: female ? 0.8 : 1.15, arch: female ? 0.35 : 0.2, tilt: 0, gap: 0, ...spec.brow },
    mouth: { w: female ? 0.0155 : 0.0175, smile: 0, ...spec.mouth },
    blush: spec.blush ?? (female ? 0.7 : 0.3),
    skinC: rgb(spec.skin),
    hairC: rgb(spec.hair),
    irisC: rgb(spec.iris),
    lashC: mix(rgb(spec.hair), [34, 22, 18], 0.75)
  };
}

function radial(g, x, y, r, color, a) {
  const grd = g.createRadialGradient(x, y, 0, x, y, r);
  grd.addColorStop(0, css(color, a));
  grd.addColorStop(1, css(color, 0));
  g.fillStyle = grd;
  g.fillRect(x - r, y - r, r * 2, r * 2);
}

function dot(g, x, y, r, fill) {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = fill;
  g.fill();
}

/** Painted shading: a shadow under the fringe, beside the nose, under the lip, the jaw's sides. */
function shading(g, s) {
  const shade = mul(s.skinC, [0.82, 0.7, 0.68]);
  let grd = g.createLinearGradient(0, Y(1.668), 0, Y(1.628));
  grd.addColorStop(0, css(shade, 0.55));
  grd.addColorStop(1, css(shade, 0));
  g.fillStyle = grd;
  g.fillRect(0, Y(1.668), W, Y(1.628) - Y(1.668));
  for (const side of [-1, 1]) {
    // the jaw's sides turn away: a soft tall oval of shade along each
    g.save();
    g.translate(X(side * 0.074), Y(1.535));
    g.scale(1, 2.2);
    radial(g, 0, 0, 0.026 * PX, shade, 0.5);
    g.restore();
  }
  radial(g, X(0.007), Y(1.572), 0.011 * PX, shade, 0.2); // the shadow side of the nose
  radial(g, X(0.0), Y(1.551), 0.007 * PX, shade, 0.22); // under the nose
  radial(g, X(0.0), Y(1.519), 0.008 * PX, shade, 0.2); // under the lower lip
}

function blush(g, s) {
  if (!s.blush) return;
  for (const side of [-1, 1]) {
    g.save();
    g.translate(X(side * 0.045), Y(1.57));
    g.scale(1.5, 1);
    radial(g, 0, 0, 0.011 * PX, [240, 128, 118], 0.32 * s.blush);
    g.restore();
  }
}

function freckles(g, s) {
  let h = 7;
  const r = () => ((h = (h * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 26; i++) {
    const side = i % 2 ? 1 : -1;
    dot(g, X(side * (0.022 + r() * 0.03)), Y(1.568 + (r() - 0.5) * 0.014), 1 + r() * 1.2, css(mul(s.skinC, 0.62), 0.55));
  }
}

function scar(g, s) {
  g.strokeStyle = css(mul(s.skinC, [0.78, 0.6, 0.58]), 0.8);
  g.lineWidth = 2.2;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(X(-0.052), Y(1.585));
  g.lineTo(X(-0.04), Y(1.56));
  g.stroke();
}

function nose(g, s) {
  const line = mul(s.skinC, [0.66, 0.5, 0.46]);
  g.lineCap = 'round';
  // the tip: a short curved stroke under it, darker on the shadow side
  g.strokeStyle = css(line, 0.85);
  g.lineWidth = 2.6;
  g.beginPath();
  g.moveTo(X(-0.003), Y(1.5555));
  g.quadraticCurveTo(X(0.002), Y(1.5538), X(0.006), Y(1.5572));
  g.stroke();
  // a faint line down the shadow side of the bridge
  const grd = g.createLinearGradient(0, Y(1.59), 0, Y(1.56));
  grd.addColorStop(0, css(line, 0));
  grd.addColorStop(1, css(line, 0.35));
  g.strokeStyle = grd;
  g.lineWidth = 1.8;
  g.beginPath();
  g.moveTo(X(0.005), Y(1.59));
  g.quadraticCurveTo(X(0.0068), Y(1.574), X(0.006), Y(1.561));
  g.stroke();
}

function mouth(g, s) {
  const m = s.mouth;
  const z = 1.5305, hw = m.w / 2;
  const line = mul(s.skinC, [0.6, 0.42, 0.4]);
  g.lineCap = 'round';
  g.strokeStyle = css(line, 0.9);
  g.lineWidth = 2.4;
  g.beginPath();
  g.moveTo(X(-hw), Y(z + 0.0006 + m.smile * 0.0016));
  g.bezierCurveTo(X(-hw * 0.3), Y(z - 0.0007), X(hw * 0.3), Y(z - 0.0007), X(hw), Y(z + 0.0006 + m.smile * 0.0016));
  g.stroke();
  g.strokeStyle = css(mul(line, 0.8), 0.9);
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(X(-hw * 0.35), Y(z - 0.0004));
  g.lineTo(X(hw * 0.35), Y(z - 0.0004));
  g.stroke();
  // the lower lip: a faint stroke below
  g.strokeStyle = css(mul(s.skinC, [0.8, 0.66, 0.64]), 0.5);
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(X(-hw * 0.4), Y(z - 0.0062));
  g.quadraticCurveTo(X(0), Y(z - 0.0072), X(hw * 0.4), Y(z - 0.0062));
  g.stroke();
}

/** The eye in local pixels: origin at its centre, +x toward the temple, y down. */
function eyeShape(e, w, h) {
  const tilt = e.tilt * h;
  return {
    I: [-0.5 * w, 0.1 * h],
    O: [0.5 * w, -0.04 * h - tilt],
    upper: [[-0.3 * w, -0.66 * h], [0.26 * w, -0.72 * h - tilt * 0.5]],
    lower: [[0.32 * w, 0.5 * h - tilt * 0.3], [-0.24 * w, 0.56 * h]]
  };
}

function eye(g, s, side, shut) {
  const e = s.eye;
  const w = e.w * PX, h = e.h * PX;
  const sh = eyeShape(e, w, h);
  const { I, O } = sh;
  g.save();
  g.translate(X(side * e.x), Y(EYE_Z));
  g.scale(side, 1); // mirrored: local +x runs toward this eye's outer corner
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const lash = css(s.lashC, 0.97);
  const crease = css(mul(s.skinC, [0.7, 0.56, 0.52]), 0.7);

  if (shut) {
    // a relaxed closed lid: a downward arc with the lash line and a few lower lashes
    g.strokeStyle = lash;
    g.lineWidth = 0.13 * h;
    g.beginPath();
    g.moveTo(I[0], I[1] - 0.05 * h);
    g.bezierCurveTo(-0.2 * w, 0.32 * h, 0.25 * w, 0.32 * h, O[0], O[1] + 0.12 * h);
    g.stroke();
    g.strokeStyle = crease;
    g.lineWidth = 0.05 * h;
    g.beginPath();
    g.moveTo(-0.25 * w, -0.25 * h);
    g.quadraticCurveTo(0.05 * w, -0.05 * h, 0.4 * w, -0.2 * h);
    g.stroke();
    g.restore();
    return;
  }

  const opening = () => {
    g.beginPath();
    g.moveTo(...I);
    g.bezierCurveTo(...sh.upper[0], ...sh.upper[1], ...O);
    g.bezierCurveTo(...sh.lower[0], ...sh.lower[1], ...I);
    g.closePath();
  };
  // sclera, greyed under the upper lid
  opening();
  let grd = g.createLinearGradient(0, -0.7 * h, 0, 0.4 * h);
  grd.addColorStop(0, '#b9bfcb');
  grd.addColorStop(0.55, '#f6f6f8');
  grd.addColorStop(1, '#ffffff');
  g.fillStyle = grd;
  g.fill();
  g.save();
  opening();
  g.clip();
  // the iris: dark at the top, light below, a darker rim; the pupil
  const ic = [0.03 * w, 0.06 * h];
  const r = e.iris * h;
  grd = g.createLinearGradient(0, ic[1] - r, 0, ic[1] + r);
  grd.addColorStop(0, css(mul(s.irisC, 0.28)));
  grd.addColorStop(0.45, css(mul(s.irisC, 0.8)));
  grd.addColorStop(1, css(mix(s.irisC, [255, 255, 255], 0.38)));
  g.beginPath();
  g.ellipse(ic[0], ic[1], r * 0.9, r, 0, 0, Math.PI * 2);
  g.fillStyle = grd;
  g.fill();
  g.strokeStyle = css(mul(s.irisC, 0.3), 0.9);
  g.lineWidth = 0.06 * h;
  g.stroke();
  g.beginPath();
  g.ellipse(ic[0], ic[1] + 0.03 * r, r * 0.38, r * 0.46, 0, 0, Math.PI * 2);
  g.fillStyle = css(mul(s.irisC, 0.14));
  g.fill();
  // the shadow the upper lid casts across the eye
  grd = g.createLinearGradient(0, -0.75 * h, 0, -0.1 * h);
  grd.addColorStop(0, 'rgba(40,28,30,0.55)');
  grd.addColorStop(1, 'rgba(40,28,30,0)');
  g.fillStyle = grd;
  g.fillRect(-w, -h, 2 * w, h);
  // highlights: lit from the viewer's upper left on both eyes (undo the mirror for x)
  const hx = -0.32 * r * side;
  g.beginPath();
  g.ellipse(ic[0] + hx, ic[1] - 0.36 * r, 0.2 * r, 0.24 * r, 0, 0, Math.PI * 2);
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.fill();
  dot(g, ic[0] - hx * 0.8, ic[1] + 0.45 * r, 0.08 * r, 'rgba(255,255,255,0.8)');
  g.restore();

  // the upper lash line: heavy, heavier toward the outer corner, with a flick
  g.strokeStyle = lash;
  g.lineWidth = 0.12 * h;
  g.beginPath();
  g.moveTo(I[0] + 0.04 * w, I[1] - 0.05 * h);
  g.bezierCurveTo(...sh.upper[0], ...sh.upper[1], ...O);
  g.stroke();
  g.lineWidth = 0.2 * h;
  g.beginPath();
  g.moveTo(0.05 * w, -0.68 * h - e.tilt * h * 0.4);
  g.bezierCurveTo(0.28 * w, -0.7 * h - e.tilt * h * 0.5, 0.42 * w, -0.4 * h - e.tilt * h, O[0], O[1]);
  g.stroke();
  const flick = s.female ? 1.3 : 0.8;
  g.fillStyle = lash;
  g.beginPath();
  g.moveTo(O[0] - 0.12 * w, O[1] - 0.16 * h);
  g.quadraticCurveTo(O[0] + 0.1 * w * flick, O[1] - 0.18 * h * flick, O[0] + 0.16 * w * flick, O[1] - 0.06 * h);
  g.quadraticCurveTo(O[0] + 0.02 * w, O[1] + 0.06 * h, O[0] - 0.06 * w, O[1] + 0.04 * h);
  g.fill();
  if (s.female) {
    for (const k of [0.18, 0.32]) {
      g.lineWidth = 0.05 * h;
      g.beginPath();
      g.moveTo(O[0] - k * w, O[1] - 0.42 * h + k * 0.6 * h);
      g.lineTo(O[0] - k * w + 0.08 * w, O[1] - 0.58 * h + k * 0.6 * h);
      g.stroke();
    }
  }
  // the lower lash line: thin, on the outer two thirds
  g.strokeStyle = css(mix(s.lashC, s.skinC, 0.45), 0.85);
  g.lineWidth = 0.05 * h;
  g.beginPath();
  g.moveTo(O[0] - 0.02 * w, O[1] + 0.06 * h);
  g.bezierCurveTo(sh.lower[0][0], sh.lower[0][1], -0.05 * w, 0.56 * h, -0.2 * w, 0.54 * h);
  g.stroke();
  // the double-lid crease above
  g.strokeStyle = crease;
  g.lineWidth = 0.045 * h;
  g.beginPath();
  g.moveTo(-0.22 * w, -0.86 * h);
  g.quadraticCurveTo(0.12 * w, -1.04 * h - e.tilt * h * 0.5, 0.42 * w, -0.66 * h - e.tilt * h);
  g.stroke();
  g.restore();
}

function brow(g, s, side) {
  const b = s.brow;
  const x0 = 0.012 + b.gap, x1 = 0.054;
  const z0 = 1.6235 - b.tilt * 0.003, z1 = 1.6235 + 0.0005 + b.tilt * 0.002;
  const t0 = 0.0026 * b.thick, t1 = 0.0007 * b.thick;
  const zm = (z0 + z1) / 2 + 0.003 * b.arch + 0.001;
  const xm = x0 + (x1 - x0) * 0.6;
  g.save();
  g.translate(X(0), 0);
  g.scale(side, 1);
  g.translate(-X(0), 0);
  g.fillStyle = css(mul(mix(s.hairC, s.lashC, 0.4), 0.9), 0.92);
  g.beginPath();
  g.moveTo(X(x0), Y(z0 + t0 / 2));
  g.quadraticCurveTo(X(xm), Y(zm + (t0 + t1) / 3), X(x1), Y(z1 + t1 / 2));
  g.quadraticCurveTo(X(x1 + 0.002), Y(z1 - 0.0005), X(x1), Y(z1 - t1 / 2));
  g.quadraticCurveTo(X(xm), Y(zm - (t0 + t1) / 4), X(x0), Y(z0 - t0 / 2));
  g.closePath();
  g.fill();
  g.restore();
}
