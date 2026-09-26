import * as THREE from 'three';
import { Quality } from './quality.js';

/**
 * One WebGL context for the whole app, one render loop. Exactly one mode is
 * active at a time; the engine only drives it (update + render) and forwards
 * resizes. Modes own their scenes and dispose them on exit, so memory and GPU
 * work never add up across modes.
 */
export class Engine {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);
    this.quality = new Quality(this);
    this.renderer.setPixelRatio(this.quality.ratio);
    this.mode = null;
    this.time = 0;
    this.last = 0;
    this.frameHooks = [];
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.renderer.setAnimationLoop((ts) => this.frame(ts));
  }

  get size() {
    return { width: this.container.clientWidth || window.innerWidth, height: this.container.clientHeight || window.innerHeight };
  }

  resize() {
    const { width, height } = this.size;
    this.renderer.setSize(width, height);
    this.mode?.resize?.(width, height);
  }

  setMode(mode) {
    this.mode = mode;
    this.quality.reset();
    const { width, height } = this.size;
    mode?.resize?.(width, height);
  }

  frame(ts) {
    const t = ts * 0.001;
    const dt = Math.min(0.1, t - (this.last || t));
    this.last = t;
    this.time = t;
    if (!this.mode) return;
    this.mode.update(dt, t, ts);
    this.mode.render();
    this.quality.sample(dt);
    if (this.frameHooks.length) {
      const hooks = this.frameHooks;
      this.frameHooks = [];
      hooks.forEach((fn) => fn());
    }
  }

  /** Resolve right after the next frame was drawn (e.g. to capture it). */
  afterFrame(fn) {
    return new Promise((resolve) =>
      this.frameHooks.push(() => {
        fn?.();
        resolve();
      })
    );
  }
}
