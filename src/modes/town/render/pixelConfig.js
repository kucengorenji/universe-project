export const PIXEL_STYLE_KEY = 'planet_globe_town_style';
export const PIXEL_YAW = Math.PI / 4;
export const PIXEL_ELEVATION = Math.PI / 4;
export const PIXEL_ZOOM_LABELS = ['Dekat', 'Normal', 'Jauh'];

export function readTownStyle(storage) {
  try { return (storage ?? globalThis.localStorage)?.getItem(PIXEL_STYLE_KEY) === 'pixel' ? 'pixel' : 'normal'; }
  catch { return 'normal'; }
}

export function saveTownStyle(style, storage) {
  const value = style === 'pixel' ? 'pixel' : 'normal';
  try { (storage ?? globalThis.localStorage)?.setItem(PIXEL_STYLE_KEY, value); } catch { /* preference is optional */ }
  return value;
}

export function pixelResolution(width, height) {
  // Choose whole display pixels independently of the adaptive quality DPR.
  const scale = Math.max(2, Math.ceil(height / 400));
  return { width: Math.max(1, Math.ceil(width / scale)), height: Math.max(1, Math.ceil(height / scale)), scale };
}

export function pixelViewSpan(view, level, cityRadius = 100) {
  const presets = view === 'drive' ? [28, 44, 72]
    : view === 'walk' ? [20, 32, 52] : [48, 96, Math.max(160, cityRadius * 2.7)];
  return presets[Math.max(0, Math.min(2, level))];
}

/** Equivalent radius/distance scale used by the town's perspective LOD thresholds. */
export function orthographicLodScale(camera) {
  return camera.isOrthographicCamera ? 2 * Math.tan(27.5 * Math.PI / 180) * camera.zoom / (camera.top - camera.bottom) : 0;
}
