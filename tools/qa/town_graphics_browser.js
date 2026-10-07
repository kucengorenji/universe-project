const percentile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
};
const mean = values => values.reduce((a, b) => a + b, 0) / values.length;
const round = n => n == null ? null : Math.round(n * 100) / 100;

export async function townFixture({ modern = false, view = 'diorama', night = false, city = null } = {}) {
  const a = window.__globe;
  if (!a || a.director.busy) throw Error('Wait for the app to finish loading');
  const map = a.world.mapFor(a.world.homeIndex);
  city ??= map.cities.findIndex(c => (c.style === 'modern') === modern);
  a.world.sunAt = () => night ? { x: .2, y: -.7, z: .4 } : { x: .5, y: .75, z: .4 };
  if (a.director.mode?.route?.planet !== a.world.homeIndex || a.director.mode?.route?.city !== city || a.director.mode?.constructor.name !== 'TownMode') {
    await a.director.go({ mode: 'town', planet: a.world.homeIndex, city });
  }
  const t = a.director.mode;
  if (!t?.builder) throw Error('Town fixture did not load');
  t.tween = null;
  if (view === 'diorama') {
    t.setView('diorama');
    t.tween = null;
    const p = t.dioramaPose({});
    t.camera.position.copy(p.pos); t.orbit.target.copy(p.target); t.camera.lookAt(p.target);
  } else {
    t.setView('walk');
    for (let i = 0; i < 240 && (t.tween || t.transfer); i++) await a.engine.afterFrame();
    t.placePlayer(t.layout.spawn.x, t.layout.spawn.z);
    t.player.yaw = 0;
    t.follow.yaw = Math.PI; t.follow.pitch = .25; t.follow.dist = 6.5;
    if (view === 'drive') {
      const vehicle = t.fleet.vehicles.find(v => v.mode === 'parked' && !v.hidden) || t.fleet.vehicles[0];
      const door = t.doorOf(vehicle.car, vehicle.spec);
      t.placePlayer(door.x, door.z);
      t.enterVehicle(vehicle);
    }
    for (let i = 0; i < 240 && (t.tween || t.transfer || (view === 'drive' && !t.drive)); i++) await a.engine.afterFrame();
    if (t.view !== view) throw Error(`Failed to enter ${view}`);
  }
  for (let i = 0; i < 90; i++) await a.engine.afterFrame();
  if (a.engine.lastError) throw a.engine.lastError;
  return { planet: t.route.planet, city, view: t.view, modern: t.layout.modern, night, buildings: t.layout.buildings.length };
}

/** Steady render cadence, CPU submission and all-pass geometry work. */
export async function townProfile({ frames = 240, gpuFrames = 0 } = {}) {
  const a = window.__globe, e = a.engine, t = a.director.mode;
  if (!t?.builder || document.hidden || !e.size.width || !e.size.height) throw Error('A visible, nonzero town canvas is required');
  const intervals = [], cpu = [], calls = [], triangles = [];
  const info = e.renderer.info, oldReset = info.autoReset;
  const oldUpdate = t.update, oldRender = t.render;
  let updateMs = 0, renderMs = 0, last = performance.now();
  t.update = function(...args) { const start = performance.now(); try { return oldUpdate.apply(this, args); } finally { updateMs = performance.now() - start; } };
  t.render = function(...args) { const start = performance.now(); try { return oldRender.apply(this, args); } finally { renderMs = performance.now() - start; } };
  info.autoReset = false; info.reset();
  try {
    for (let i = 0; i < frames + 30; i++) await e.afterFrame(() => {
      const now = performance.now();
      if (i >= 30) { intervals.push(now - last); cpu.push(updateMs + renderMs); calls.push(info.render.calls); triangles.push(info.render.triangles); }
      last = now; info.reset();
    });
  } finally { t.update = oldUpdate; t.render = oldRender; info.autoReset = oldReset; info.reset(); }
  const result = {
    seed: a.world.homeMap.seed, planet: t.route.planet, city: t.route.city, modern: t.layout.modern,
    view: t.view, night: round(t.night), buildings: t.layout.buildings.length, trees: t.layout.trees.length,
    frames, viewport: e.size, pixelRatio: e.renderer.getPixelRatio(), devicePixelRatio: window.devicePixelRatio,
    drawingBuffer: { width: e.renderer.domElement.width, height: e.renderer.domElement.height },
    camera: { position: t.camera.position.toArray().map(round), quaternion: t.camera.quaternion.toArray().map(round), fov: t.camera.fov },
    fps: round(1000 / mean(intervals)), frameMs: { p50: round(percentile(intervals, .5)), p95: round(percentile(intervals, .95)), p99: round(percentile(intervals, .99)) },
    cpuMs: { p50: round(percentile(cpu, .5)), p95: round(percentile(cpu, .95)) },
    drawCalls: round(mean(calls)), triangles: round(mean(triangles)), memory: { ...info.memory },
    grass: t.builder.groundCover?.activeCount ?? t.builder.groundCover?.mesh.count,
    forest: t.builder.farTrees?.activeCount ?? t.builder.farTrees?.mesh.geometry.instanceCount,
    fleet: t.fleet.lodStats ?? null, budget: t.detailBudget?.current ?? null, error: e.lastError?.message ?? null
  };
  if (gpuFrames) result.gpu = await gpuProfile(gpuFrames);
  return result;
}

/** Extra untimed renders hold GPU clocks up; time only the final render. */
export async function gpuProfile(frames = 90) {
  const { engine: e } = window.__globe, gl = e.renderer.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  if (!ext) return { supported: false, p50: null, p95: null };
  const timer = e.quality.timer, sample = e.quality.sample, samples = [], pending = [];
  e.quality.endGpu(); e.quality.timer = null; e.quality.sample = () => {};
  try {
    for (let i = 0; i < frames + 12; i++) await e.afterFrame(() => {
      while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
        const q = pending.shift();
        if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) samples.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
        gl.deleteQuery(q);
      }
      if (i < frames) {
        e.mode.render(); e.mode.render();
        const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); e.mode.render(); gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(q);
      }
    });
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return { supported: true, samples: samples.length, p50: round(percentile(samples, .5)), p95: round(percentile(samples, .95)), renderer: gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER), method: 'two extra warm renders; GPU query around final scene+post render only' };
  } finally { pending.forEach(q => gl.deleteQuery(q)); e.quality.timer = timer; e.quality.sample = sample; }
}
