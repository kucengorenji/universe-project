// Graphics quality: a preset (auto / high / medium / low) plus, in auto, a
// governor that trades resolution for frame rate. Pixel ratio is the one knob
// that scales every mode's cost without touching its content.

const PRESETS = {
  high: { maxRatio: 2, shadows: true, detail: 1 },
  medium: { maxRatio: 1.5, shadows: true, detail: 0.75 },
  low: { maxRatio: 1, shadows: false, detail: 0.5 }
};
const PREF_KEY = 'planet_globe_quality';
// The engine draws at most 60 frames a second (engine.js): the GPU budget per frame
const BUDGET_MS = 1000 / 60;

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
    this.gpu = { sum: 0, n: 0, query: null, open: false };
    this.tooHeavy = new Map(); // ratio -> time it was stepped down from
  }

  get tier() {
    if (this.preset !== 'auto') return this.preset;
    return this.mobile ? 'medium' : 'high';
  }

  get settings() {
    return PRESETS[this.tier];
  }

  /** GPU timer queries, where the browser has them: the governor then knows the real headroom. */
  attach(renderer) {
    const gl = renderer.getContext();
    this.gl = gl;
    this.timer = gl.getExtension?.('EXT_disjoint_timer_query_webgl2') || null;
  }

  setPreset(preset, save = true) {
    this.preset = PRESETS[preset] || preset === 'auto' ? preset : 'auto';
    const device = window.devicePixelRatio || 1;
    this.ratio = Math.min(device, this.settings.maxRatio);
    this.floor = Math.min(this.ratio, this.mobile ? 0.75 : 1);
    this.tooHeavy?.clear();
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

  /** Time the GPU work of a frame; one query in flight, read back a few frames later. */
  beginGpu() {
    const g = this.gpu;
    if (!this.timer || this.preset !== 'auto' || g.open) return;
    const gl = this.gl;
    if (g.query) {
      if (!gl.getQueryParameter(g.query, gl.QUERY_RESULT_AVAILABLE)) return;
      if (!gl.getParameter(this.timer.GPU_DISJOINT_EXT)) {
        g.sum += gl.getQueryParameter(g.query, gl.QUERY_RESULT) / 1e6;
        g.n++;
      }
    } else g.query = gl.createQuery();
    gl.beginQuery(this.timer.TIME_ELAPSED_EXT, g.query);
    g.open = true;
  }

  endGpu() {
    if (!this.gpu.open) return;
    this.gl.endQuery(this.timer.TIME_ELAPSED_EXT);
    this.gpu.open = false;
  }

  /** Called once per frame. In auto, step resolution down (or back up) every few seconds. */
  sample(dt) {
    if (this.preset !== 'auto' || document.hidden) return;
    this.frames++;
    this.acc += dt;
    if (this.acc < 2.5) return;
    const fps = this.frames / this.acc;
    const g = this.gpu;
    const gpuMs = g.n >= 3 ? g.sum / g.n : null;
    this.frames = 0;
    this.acc = 0;
    g.sum = 0;
    g.n = 0;
    if (this.cooldown > 0) {
      this.cooldown--;
      return;
    }
    const target = this.mobile ? 30 : 55;
    const cap = Math.min(window.devicePixelRatio || 1, this.settings.maxRatio);
    const now = performance.now();
    // With GPU timings, resolution only steps down when the GPU is the bottleneck: a low frame rate
    // with GPU time to spare comes from elsewhere (CPU, or a host that throttles the frame loop)
    const heavy = gpuMs !== null ? gpuMs > BUDGET_MS * 0.9 : fps < target;
    if (heavy && this.ratio > this.floor) {
      this.tooHeavy.set(this.ratio, now);
      this.ratio = Math.max(this.floor, this.ratio - 0.25);
      this.apply();
      this.cooldown = 1;
      return;
    }
    if (this.ratio >= cap) return;
    const next = Math.min(cap, this.ratio + 0.25);
    // Measured: the GPU cost grows with the pixel count. Unmeasured: only retry a heavier ratio after a while
    const fits = gpuMs !== null ? gpuMs * (next / this.ratio) ** 2 < BUDGET_MS * 0.7 : fps > target + 3 && now - (this.tooHeavy.get(next) ?? -Infinity) > 60000;
    if (fits) {
      this.ratio = next;
      this.apply();
      this.cooldown = 2;
    }
  }

  /** A mode switch changes the load completely: re-measure from the preset. */
  reset() {
    this.frames = 0;
    this.acc = 0;
    this.cooldown = 2;
    this.gpu.sum = 0;
    this.gpu.n = 0;
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
