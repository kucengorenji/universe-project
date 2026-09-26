import * as THREE from 'three';
import { Quality } from './quality.js';
import { Post } from './post.js';

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
    this.post = new Post(this);
    this.mode = null;
    this.time = performance.now() / 1000; // game clock: stops while paused
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
    this.post?.resize();
    this.mode?.resize?.(width, height);
  }

  /** Draw a mode's scene, through the post-processing chain when it is on. */
  draw(scene, camera) {
    this.post.render(scene, camera);
  }

  setMode(mode) {
    this.mode = mode;
    this.quality.reset();
    const { width, height } = this.size;
    mode?.resize?.(width, height);
  }

  frame(ts) {
    const now = ts * 0.001;
    const dt = Math.min(0.1, now - (this.last || now));
    this.last = now;
    if (!this.mode) {
      this.time += dt;
      return;
    }
    // Paused (menu open): the clock stops and the last frame stays on screen,
    // unless someone is waiting for a frame
    if (this.paused && !this.frameHooks.length) return;
    this.time += this.paused ? 0 : dt;
    const t = this.time;
    this.mode.update(this.paused ? 0 : dt, t, t * 1000);
    this.mode.render();
    this.quality.sample(dt);
    this.audio?.update();
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
