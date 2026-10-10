import * as THREE from 'three';
import { Quality } from './quality.js';
import { Post } from './post.js';

const MAX_FPS = 60;

// Soft shadow edges from 9 depth taps (quadratic B-spline weights over 3x3 texels) instead of
// three's 16: nearly the same softness, at about half the cost on every pixel that receives shadow
const PCF_SOFT = /(#elif defined\( SHADOWMAP_TYPE_PCF_SOFT \))[\s\S]*?(#elif defined\( SHADOWMAP_TYPE_VSM \))/;
THREE.ShaderChunk.shadowmap_pars_fragment = THREE.ShaderChunk.shadowmap_pars_fragment.replace(PCF_SOFT, `$1
      vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
      vec2 p = shadowCoord.xy * shadowMapSize - 0.5;
      vec2 c = floor( p + 0.5 );
      vec2 t = p - c;
      vec2 w0 = 0.5 * ( 0.5 - t ) * ( 0.5 - t );
      vec2 w1 = 0.75 - t * t;
      vec2 w2 = 0.5 * ( 0.5 + t ) * ( 0.5 + t );
      vec2 uv = ( c + 0.5 ) * texelSize;
      float z = shadowCoord.z;
      float dx = texelSize.x;
      float dy = texelSize.y;
      shadow =
        w0.y * ( w0.x * texture2DCompare( shadowMap, uv + vec2( -dx, -dy ), z ) + w1.x * texture2DCompare( shadowMap, uv + vec2( 0.0, -dy ), z ) + w2.x * texture2DCompare( shadowMap, uv + vec2( dx, -dy ), z ) ) +
        w1.y * ( w0.x * texture2DCompare( shadowMap, uv + vec2( -dx, 0.0 ), z ) + w1.x * texture2DCompare( shadowMap, uv, z ) + w2.x * texture2DCompare( shadowMap, uv + vec2( dx, 0.0 ), z ) ) +
        w2.y * ( w0.x * texture2DCompare( shadowMap, uv + vec2( -dx, dy ), z ) + w1.x * texture2DCompare( shadowMap, uv + vec2( 0.0, dy ), z ) + w2.x * texture2DCompare( shadowMap, uv + vec2( dx, dy ), z ) );
    $2`);

/**
 * One WebGL context for the whole app, one render loop. Exactly one mode is
 * active at a time; the engine only drives it (update + render) and forwards
 * resizes. Modes own their scenes and dispose them on exit, so memory and GPU
 * work never add up across modes.
 */
export class Engine {
  constructor(container) {
    this.container = container;
    this.quality = new Quality(this);
    this.post = new Post(this);
    // The post chain antialiases its own target: a multisampled canvas under it would only cost memory
    this.renderer = new THREE.WebGLRenderer({ antialias: !this.post.enabled, alpha: true, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);
    this.quality.attach(this.renderer);
    this.renderer.setPixelRatio(this.quality.ratio);
    this.mode = null;
    this.time = performance.now() / 1000; // game clock: stops while paused
    this.last = 0;
    this.lastDraw = -Infinity;
    this.nextDraw = 0;
    this.frameHooks = [];
    this.drawCount = 0; // frames drawn; telemetry samples the frame rate from it
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
    this.trade?.pump();
    // 120 Hz displays would draw every scene twice as often for little gain: at most 60 frames a second
    if (ts + 0.5 < this.nextDraw) return;
    // Carry the scheduled deadline forward: resetting it to each drawn frame
    // halves the rate on 75/90 Hz displays even when the GPU has ample headroom.
    this.nextDraw += 1000 / MAX_FPS;
    if (this.nextDraw < ts) this.nextDraw = ts + 1000 / MAX_FPS;
    this.lastDraw = ts;
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
    // A mode that throws must not stop the loop (three.js drops the loop on an uncaught error)
    try {
      this.mode.update(this.paused ? 0 : dt, t, t * 1000);
      this.quality.beginGpu();
      this.mode.render();
      this.quality.endGpu();
      this.drawCount++;
    } catch (err) {
      this.quality.endGpu();
      if (!this.lastError || this.lastError.message !== err.message) console.error(err);
      this.lastError = err;
    }
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
