// Graphics quality: a preset (auto / high / medium / low) plus, in auto, a
// governor that trades resolution for frame rate. Pixel ratio is the one knob
// that scales every mode's cost without touching its content.

const PRESETS = {
  high: { maxRatio: 2, shadows: true, detail: 1 },
  medium: { maxRatio: 1.5, shadows: true, detail: 0.75 },
  low: { maxRatio: 1, shadows: false, detail: 0.5 }
};
const PREF_KEY = 'planet_globe_quality';

export class Quality {
  constructor(engine) {
    this.engine = engine;
    this.listeners = new Set();
    this.mobile = matchMedia('(pointer: coarse)').matches || Math.min(screen.width, screen.height) < 600;
    let saved = 'auto';
    try {
      saved = localStorage.getItem(PREF_KEY) || 'auto';
    } catch {
      /* optional */
    }
    this.setPreset(saved, false);
    this.frames = 0;
    this.acc = 0;
    this.cooldown = 2;
  }

  get tier() {
    if (this.preset !== 'auto') return this.preset;
    return this.mobile ? 'medium' : 'high';
  }

  get settings() {
    return PRESETS[this.tier];
  }

  setPreset(preset, save = true) {
    this.preset = PRESETS[preset] || preset === 'auto' ? preset : 'auto';
    const device = window.devicePixelRatio || 1;
    this.ratio = Math.min(device, this.settings.maxRatio);
    this.floor = Math.min(this.ratio, this.mobile ? 0.75 : 1);
    if (save) {
      try {
        localStorage.setItem(PREF_KEY, this.preset);
      } catch {
        /* optional */
      }
    }
    this.apply();
    this.listeners.forEach((fn) => fn(this));
  }

  apply() {
    const r = this.engine.renderer;
    if (r && Math.abs(r.getPixelRatio() - this.ratio) > 0.01) {
      r.setPixelRatio(this.ratio);
      this.engine.resize();
    }
  }

  /** Called once per frame. In auto, step resolution down (or back up) every few seconds. */
  sample(dt) {
    if (this.preset !== 'auto' || document.hidden) return;
    this.frames++;
    this.acc += dt;
    if (this.acc < 2.5) return;
    const fps = this.frames / this.acc;
    this.frames = 0;
    this.acc = 0;
    if (this.cooldown > 0) {
      this.cooldown--;
      return;
    }
    const target = this.mobile ? 30 : 55;
    const cap = Math.min(window.devicePixelRatio || 1, this.settings.maxRatio);
    if (fps < target && this.ratio > this.floor) {
      this.ratio = Math.max(this.floor, this.ratio - 0.25);
      this.apply();
      this.cooldown = 1;
    } else if (fps > target + 12 && this.ratio < cap) {
      this.ratio = Math.min(cap, this.ratio + 0.25);
      this.apply();
      this.cooldown = 2;
    }
  }

  /** A mode switch changes the load completely: re-measure from the preset. */
  reset() {
    this.frames = 0;
    this.acc = 0;
    this.cooldown = 2;
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
