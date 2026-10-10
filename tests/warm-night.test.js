import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { JOURNEY_PALETTE, WARM_NIGHT, ROOM_STAGE, MAP_COLORS } from '../src/art/palette.js';
import { applyWarmNight } from '../src/modes/town/render/warmNight.js';
import { TownSky } from '../src/modes/town/render/sky.js';
import { TownWaypoint } from '../src/modes/town/ui/waypoint.js';
import { resetExperiments } from '../src/core/experiments.js';
import { proofMetrics } from '../src/core/proofMetrics.js';

// WCAG relative luminance and contrast of two sRGB hex colours
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const P = JOURNEY_PALETTE;

test('the home label and badge colours meet the contrast targets, from tokens only', () => {
  assert.ok(contrast(P.ink, P.paper) >= 4.5, `label text on the pill: ${contrast(P.ink, P.paper).toFixed(2)}`);
  assert.ok(contrast(P.outline, P.paper) >= 4.5, 'outline against the pill');
  assert.ok(contrast(P.target, P.outline) >= 3, `gold glyph against its outline: ${contrast(P.target, P.outline).toFixed(2)}`);
  assert.ok(contrast(P.outline, MAP_COLORS.road) >= 3, 'outline against the lightest ground it can sit on by day');
  assert.ok(contrast(P.paper, ROOM_STAGE.night) >= 3, `pill against the night backdrop: ${contrast(P.paper, ROOM_STAGE.night).toFixed(2)}`);
  assert.ok(contrast(P.target, ROOM_STAGE.night) >= 3, 'the gold beacon against the night backdrop');
  assert.ok(contrast(P.error, P.paper) >= 3, 'error icon on paper (always with words)');
  assert.ok(contrast(P.success, P.paper) >= 3, 'check mark on paper');
  // gold on paper is weak, which is why every gold shape carries a dark outline and gold is never small text
  assert.ok(contrast(P.target, P.paper) < 3);
  for (const hex of Object.values(P)) assert.match(hex, /^#[0-9a-f]{6}$/);
  assert.equal(P.target, '#f2b766');
  assert.equal(P.paper, '#f6e3bc');
  assert.equal(P.ink, '#1c2320');
  assert.equal(P.outline, '#1f2a24');
  assert.equal(WARM_NIGHT.tint, P.paper, 'the night warmth is the same paper colour as the marker');
});

const light = (night) => ({
  night, hemiSky: new THREE.Color(0x3a4f86), sunColor: new THREE.Color(0.55, 0.66, 1), sunIntensity: 0.3, hemiIntensity: 0.55, ambient: 0.12
});

test('warm night changes nothing by day and approaches its caps at full night', () => {
  const day = light(0), reference = light(0);
  applyWarmNight(day);
  assert.deepEqual([day.hemiSky.getHex(), day.sunColor.getHex(), day.hemiIntensity, day.ambient], [reference.hemiSky.getHex(), reference.sunColor.getHex(), 0.55, 0.12]);
  const night = applyWarmNight(light(1));
  assert.ok(Math.abs(night.hemiIntensity - (0.55 + WARM_NIGHT.hemiBoost)) < 1e-9);
  assert.ok(Math.abs(night.ambient - WARM_NIGHT.ambientFloor) < 1e-9, 'the ambient floor');
  assert.ok(night.hemiSky.getHex() !== 0x3a4f86, 'the fill picked up some warmth');
  assert.ok(night.hemiSky.b > night.hemiSky.r, 'but it is still a cool, blue night');
  assert.ok(night.sunColor.b > night.sunColor.r, 'and the moonlight is still cool');
  const dim = light(1); dim.ambient = 0.4;
  assert.equal(applyWarmNight(dim).ambient, 0.4, 'a floor, never a cap');
});

test('warm night is continuous and only ever adds light, a little at a time', () => {
  let previous = null;
  for (let n = 0; n <= 1.0001; n += 0.05) {
    const l = applyWarmNight(light(n));
    const lum = l.hemiSky.r * 0.2126 + l.hemiSky.g * 0.7152 + l.hemiSky.b * 0.0722;
    if (previous) {
      assert.ok(lum >= previous.lum - 1e-9 && l.hemiIntensity >= previous.hemi - 1e-9 && l.ambient >= previous.ambient - 1e-9, `night ${n}`);
      assert.ok(l.hemiIntensity - previous.hemi < 0.02 && l.ambient - previous.ambient < 0.02, 'no jumps');
    }
    previous = { lum, hemi: l.hemiIntensity, ambient: l.ambient };
  }
  const clamped = applyWarmNight(light(3));
  assert.ok(clamped.hemiIntensity <= 0.55 + WARM_NIGHT.hemiBoost + 1e-9, 'a night factor above 1 is treated as 1');
});

test('the sky applies it only when the experiment is on, and by day is identical either way', () => {
  const sun = (y) => new THREE.Vector3(0, y, Math.sqrt(1 - y * y));
  const sample = (flag) => {
    resetExperiments({ search: flag ? '' : '?off=night' });
    const sky = new TownSky('terran', 0xfff1dc, { clouds: false });
    const out = {};
    for (const [name, y] of [['day', 0.8], ['dusk', 0.0], ['night', -0.5]]) {
      const l = sky.update(sun(y), 0.016);
      out[name] = { hemi: l.hemiSky.getHex(), intensity: l.hemiIntensity, ambient: l.ambient, night: l.night, moon: l.sunColor.getHex() };
    }
    out.metrics = proofMetrics().night;
    sky.dispose();
    return out;
  };
  const on = sample(true), off = sample(false);
  assert.deepEqual(on.day, off.day, 'noon is untouched');
  assert.ok(on.night.intensity > off.night.intensity && on.night.ambient > off.night.ambient, 'night is a little brighter');
  assert.ok(on.night.hemi !== off.night.hemi);
  assert.ok(on.dusk.intensity >= off.dusk.intensity);
  assert.equal(on.metrics.enabled, true);
  assert.equal(off.metrics.enabled, false);
  assert.equal(proofMetrics().night, undefined, 'the metric goes away with the sky');
  resetExperiments();
});

test('the beacon ground arcs turn from pale edge to gold as the night comes, with no extra mesh', () => {
  const fake = { material: { arcs: { color: new THREE.Color() } } };
  TownWaypoint.prototype.setNight.call(fake, 0);
  assert.equal(`#${fake.material.arcs.color.getHexString()}`, P.edge);
  TownWaypoint.prototype.setNight.call(fake, 1);
  assert.equal(`#${fake.material.arcs.color.getHexString()}`, P.target);
  TownWaypoint.prototype.setNight.call(fake, 0.5);
  const mid = fake.material.arcs.color;
  assert.ok(mid.getHex() !== new THREE.Color(P.edge).getHex() && mid.getHex() !== new THREE.Color(P.target).getHex());
  const m = TownWaypoint.prototype.metrics.call({ group: { visible: true }, pin: { hidden: false }, arrow: { hidden: true }, night: 1, material: { arcs: fake.material.arcs, face: { opacity: 0.95 } } });
  assert.deepEqual([m.visible, m.badge, m.arrow, m.calls], [true, true, false, 3], 'three world draw calls, as budgeted');
});
