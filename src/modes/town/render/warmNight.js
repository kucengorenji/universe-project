import * as THREE from 'three';
import { WARM_NIGHT } from '../../../art/palette.js';

const tint = new THREE.Color(WARM_NIGHT.tint);

/**
 * Soften the night light of a sky update in place. `light` is the object TownSky.update returns
 * (night 0..1 with hemiSky, sunColor, hemiIntensity, ambient). At night = 0 nothing changes, so
 * the day is exactly what it was; it is continuous in between, and it adds no light, pass or texture.
 */
export function applyWarmNight(light) {
  const n = THREE.MathUtils.clamp(light.night, 0, 1);
  if (n <= 0) return light;
  light.hemiSky.lerp(tint, WARM_NIGHT.fillMix * n);
  light.sunColor.lerp(tint, WARM_NIGHT.moonMix * n);
  light.hemiIntensity += WARM_NIGHT.hemiBoost * n;
  light.ambient += Math.max(0, WARM_NIGHT.ambientFloor - light.ambient) * n; // a floor, approached smoothly
  return light;
}
