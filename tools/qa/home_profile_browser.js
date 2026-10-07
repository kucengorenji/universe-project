/**
 * In an active Vite HomeMode browser tab:
 *   const qa = await import('/tools/qa/home_profile_browser.js');
 *   await qa.runHomeProfile(window.__globe.director.mode);
 *
 * Measures actual engine-driven mode.render calls, including post processing.
 * CPU submission time is not GPU time. This is a measurement, not a 60 FPS pass.
 * No editor commits, draft saves, Apply calls, or quality preferences are written.
 * Keep the tab visible and avoid interacting with the editor during the run.
 */
import * as THREE from 'three';
import { createHomeBlueprint } from '../../src/modes/home/homeBlueprint.js';

const clone = value => structuredClone(value);
const percentile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? null;
};
const rounded = value => value === null ? null : Math.round(value * 1000) / 1000;
const ensure = (condition, message) => { if (!condition) throw new Error(message); };
const restoreProperty = (object, name, descriptor) => {
  if (descriptor) Object.defineProperty(object, name, descriptor);
  else delete object[name];
};

export async function runHomeProfile(mode, { frames = 220, warmupMs = 3500 } = {}) {
  ensure(Number.isInteger(frames) && frames >= 2 && frames <= 2000, 'frames must be an integer from 2 to 2000.');
  ensure(Number.isFinite(warmupMs) && warmupMs >= 0 && warmupMs <= 30000, 'warmupMs must be between 0 and 30000.');
  ensure(mode?.ui?.isConnected && mode.home && mode.ctx.engine.mode === mode, 'Run this in the active HomeMode browser tab.');
  ensure(!document.hidden, 'Keep the profiling browser tab visible.');
  ensure(!mode.planDrag && !mode.sceneDrag && !mode.lookDrag && !mode.applying && !mode.rebuildTimer, 'Finish the active editor transaction first.');
  const engine = mode.ctx.engine, renderer = engine.renderer, quality = engine.quality;
  const saved = {
    bp: clone(mode.bp), obstacles: clone(mode.record.obstacles), floorId: mode.floorId, view: mode.view,
    tool: mode.tool, selected: mode.selected, roomId: mode.roomId, roofSection: mode.roofSection,
    cutaway: mode.cutaway, needsRender: mode.needsRender, keys: new Set(mode.keys),
    camera: { position: mode.camera.position.clone(), quaternion: mode.camera.quaternion.clone(), up: mode.camera.up.clone() },
    orbit: { target: mode.orbit.target.clone(), enabled: mode.orbit.enabled, damping: mode.orbit.enableDamping, autoRotate: mode.orbit.autoRotate },
    preset: quality.preset, ratio: quality.ratio, qualityFloor: quality.floor,
    qualityFrames: quality.frames, qualityAcc: quality.acc, qualityCooldown: quality.cooldown, tooHeavy: new Map(quality.tooHeavy),
    paused: engine.paused, autoReset: renderer.info.autoReset,
    render: Object.getOwnPropertyDescriptor(mode, 'render'),
    inert: mode.ui.inert,
    controls: [...mode.ui.querySelectorAll('[data-field]')].map(el => ({ field: el.dataset.field, value: el.value, checked: el.checked })),
  };
  const report = { status: 'NOT_RUN', restoration: false };
  let measurementError, timer;
  try {
    // Exercise the normal adaptive quality governor, without persisting a
    // preference. Report the actual rendering ratio after it has adapted.
    quality.setPreset('auto', false);
    engine.paused = false;
    mode.ui.inert = true;
    mode.keys.clear();
    mode.bp = createHomeBlueprint({
      id: saved.bp.id, seed: 'home-perf-final', style: 'classic', floors: 3, attic: true,
      plot: [{ x: -15, z: -15 }, { x: 15, z: -15 }, { x: 15, z: 15 }, { x: -15, z: 15 }],
    });
    mode.record.obstacles = [];
    mode.floorId = mode.bp.floors[0].id;
    mode.view = 'orbit'; mode.tool = 'select'; mode.cutaway = false;
    mode.selected = mode.roomId = mode.roofSection = null;
    mode.ui.dataset.view = 'orbit';
    mode.orbit.enabled = false; mode.orbit.enableDamping = false; mode.orbit.autoRotate = false;
    mode.orbit.update(); // consume any pre-existing damping movement
    mode.orbit.target.set(0, 4, 0);
    mode.camera.position.set(-23, 20, -31);
    mode.camera.up.set(0, 1, 0);
    mode.camera.lookAt(mode.orbit.target);
    mode.orbit.update();
    mode.rebuild(); mode.updateUI(); mode.drawPlan();
    await new Promise(resolve => setTimeout(resolve, warmupMs));
    ensure(!document.hidden && engine.mode === mode, 'The active visible mode changed during warmup.');

    const starts = [], cpu = [], calls = [], triangles = [];
    const originalRender = mode.render;
    renderer.info.autoReset = false;
    await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Render collection timed out; keep the tab visible and the engine running.')), Math.max(15000, frames * 150));
      mode.render = function (...args) {
        if (document.hidden || engine.mode !== mode) {
          reject(new Error('The active visible mode changed during collection.'));
          return originalRender.apply(this, args);
        }
        const start = performance.now();
        renderer.info.reset();
        try { originalRender.apply(this, args); }
        catch (error) { reject(error); throw error; }
        cpu.push(performance.now() - start);
        starts.push(start);
        calls.push(renderer.info.render.calls);
        triangles.push(renderer.info.render.triangles);
        if (starts.length >= frames) resolve();
      };
    });
    clearTimeout(timer);
    restoreProperty(mode, 'render', saved.render);
    const intervals = starts.slice(1).map((time, index) => time - starts[index]);
    const duration = starts.at(-1) - starts[0], gl = renderer.getContext();
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const buffer = renderer.getDrawingBufferSize(new THREE.Vector2());
    const gpu = quality.gpu;
    Object.assign(report, {
      status: 'MEASURED', fixture: { seed: mode.bp.seed, style: mode.bp.style, floors: mode.bp.floors.length, attic: true, fullRoof: true, plot: '30 × 30 m' },
      frames: starts.length, intervals: intervals.length, warmupMs,
      cadence: { durationMs: rounded(duration), averageFPS: rounded(intervals.length * 1000 / duration), medianMs: rounded(percentile(intervals, .5)), p95Ms: rounded(percentile(intervals, .95)), maxMs: rounded(Math.max(...intervals)) },
      submitCPUms: { median: rounded(percentile(cpu, .5)), p95: rounded(percentile(cpu, .95)), max: rounded(Math.max(...cpu)) },
      renderWork: { maxCalls: Math.max(...calls), maxTriangles: Math.max(...triangles), counting: 'Manual renderer.info.reset per real mode.render; all render passes included.' },
      recentGPU: {
        averageMs: gpu?.n ? rounded(gpu.sum / gpu.n) : null, sumMs: gpu?.sum ?? null, samples: gpu?.n ?? 0,
        timerSupported: Boolean(quality.timer),
        boundary: 'Recent engine GPU accumulator since its last governor reset; includes delayed query readback. Not a full-run or frame-matched GPU benchmark.',
      },
      device: { renderer: gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER), drawingBuffer: { width: buffer.x, height: buffer.y }, pixelRatio: renderer.getPixelRatio(), devicePixelRatio: window.devicePixelRatio },
      quality: { preset: quality.preset, tier: quality.tier, resolutionRatio: quality.ratio, shadows: renderer.shadowMap.enabled, boundary: 'Normal adaptive quality governor active; actual final ratio reported. setPreset(auto, false) does not persist preferences.' },
      boundary: 'Browser render cadence and CPU submission for a static full-roof home. No 60 FPS certification, physical input, or navigation measurement.',
    });
  } catch (error) {
    measurementError = error;
  } finally {
    clearTimeout(timer);
    const errors = [];
    const restore = fn => { try { fn(); } catch (error) { errors.push(error); } };
    restore(() => restoreProperty(mode, 'render', saved.render));
    restore(() => { renderer.info.autoReset = saved.autoReset; engine.paused = saved.paused; });
    restore(() => {
      Object.assign(mode, { bp: saved.bp, floorId: saved.floorId, view: saved.view, tool: saved.tool, selected: saved.selected, roomId: saved.roomId, roofSection: saved.roofSection, cutaway: saved.cutaway, keys: saved.keys });
      mode.record.obstacles = saved.obstacles;
      mode.ui.dataset.view = saved.view; mode.ui.inert = saved.inert;
      mode.orbit.target.copy(saved.orbit.target);
      mode.orbit.enabled = saved.orbit.enabled; mode.orbit.enableDamping = saved.orbit.damping; mode.orbit.autoRotate = saved.orbit.autoRotate;
      mode.camera.position.copy(saved.camera.position); mode.camera.quaternion.copy(saved.camera.quaternion); mode.camera.up.copy(saved.camera.up);
      mode.camera.updateMatrixWorld(true);
      mode.rebuild(); mode.updateUI(); mode.drawPlan();
      for (const control of saved.controls) {
        const element = mode.ui.querySelector(`[data-field="${control.field}"]`);
        ensure(element, `Cannot restore control ${control.field}.`);
        element.value = control.value; element.checked = control.checked;
      }
      mode.needsRender = saved.needsRender;
    });
    restore(() => {
      quality.setPreset(saved.preset, false);
      Object.assign(quality, { ratio: saved.ratio, floor: saved.qualityFloor, frames: saved.qualityFrames, acc: saved.qualityAcc, cooldown: saved.qualityCooldown, tooHeavy: saved.tooHeavy });
      quality.apply();
      mode.needsRender = saved.needsRender;
    });
    report.restoration = errors.length === 0;
    if (errors.length) throw new AggregateError(measurementError ? [measurementError, ...errors] : errors, 'Home profiling restoration failed.');
  }
  if (measurementError) throw measurementError;
  return report;
}
