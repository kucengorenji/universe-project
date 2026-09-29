import { parseRoute, formatRoute } from './router.js';

// Each mode is its own chunk: only the code (and assets) of the mode on screen
// are ever loaded, and the next one is fetched while the current one plays its
// departure animation.
const MODES = {
  space: () => import('../modes/space/SpaceMode.js'),
  planet: () => import('../modes/planet/PlanetMode.js'),
  town: () => import('../modes/town/TownMode.js')
};

const LABELS = {
  space: 'Menyiapkan tata surya',
  planet: 'Mendarat',
  town: 'Memasuki kota'
};

/**
 * Mode lifecycle (all optional except update/render):
 *   static prepare(ctx, route)  fetch what the mode needs; runs during the old mode's departure
 *   new Mode(ctx, route, arrival)
 *   enter()                     build the scene (may block: the cover is up)
 *   arrived()                   the cover is gone, input may start
 *   update(dt, t) / render() / resize(w, h)
 *   navigate(route)             same-mode route change, return true if handled
 *   depart(route)               animate toward the next mode, resolve { cover, arrival }
 *   exit()                      dispose everything
 */
export class Director {
  constructor({ engine, world, overlay, missions, audio, tips }) {
    this.engine = engine;
    this.world = world;
    this.overlay = overlay;
    this.missions = missions;
    this.mode = null;
    this.route = null;
    this.busy = false;
    this.pending = null;
    this.ctx = { engine, world, overlay, missions, audio, tips, director: this };
    window.addEventListener('hashchange', () => {
      if (this.ignoreHash === location.hash) {
        this.ignoreHash = null;
        return;
      }
      const r = parseRoute(location.hash);
      if (r) this.go(r, { fromHash: true });
    });
  }

  async start() {
    const r = this.sanitize(parseRoute(location.hash)) || { mode: 'space', planet: this.world.homeIndex };
    const locationState = this.world.state.get('playerLocation');
    await this.go(r, { replace: true });
    await this.mode?.restoreInteriorLocation?.(locationState);
  }

  /** Clamp a route to something that exists in the current system. */
  sanitize(r) {
    if (!r) return null;
    const p = r.planet !== null && r.planet !== undefined ? this.world.planet(r.planet) : null;
    if (r.mode === 'space') return { mode: 'space', planet: p ? r.planet : null };
    if (!p || !p.landable) return { mode: 'space', planet: p ? r.planet : null };
    if (r.mode === 'town') {
      const map = this.world.mapFor(r.planet);
      if (!map?.cities?.[r.city]) return { mode: 'planet', planet: r.planet, city: null };
    }
    return r;
  }

  setHash(r, replace) {
    const hash = formatRoute(r);
    if (location.hash === hash) return;
    this.ignoreHash = hash;
    if (replace) history.replaceState(null, '', hash);
    else location.hash = hash;
    if (replace) this.ignoreHash = null;
  }

  async go(target, { replace = false, fromHash = false } = {}) {
    const route = this.sanitize(target);
    if (!route) return;
    if (this.busy) {
      this.pending = { route, replace, fromHash };
      return;
    }
    this.busy = true;
    try {
      if (this.mode && this.route?.mode === route.mode && this.mode.navigate?.(route)) {
        this.route = route;
        if (!fromHash) this.setHash(route, replace);
        return;
      }
      await this.switchTo(route);
      if (!fromHash) this.setHash(route, replace || !this.route);
      else if (formatRoute(route) !== location.hash) this.setHash(route, true);
      this.route = route;
    } catch (err) {
      console.error('Mode switch failed:', err);
      this.overlay.setProgress(null, 'Gagal memuat. Muat ulang halaman untuk mencoba lagi.');
    } finally {
      this.busy = false;
      if (this.pending) {
        const p = this.pending;
        this.pending = null;
        this.go(p.route, p);
      }
    }
  }

  /** Mode-internal route updates (e.g. focusing a city) that should not rebuild anything. */
  replaceRoute(route) {
    this.route = route;
    this.setHash(route, true);
  }

  async switchTo(route) {
    const { engine, overlay } = this;
    const modPromise = MODES[route.mode]();
    const prepPromise = modPromise.then((m) => m.default.prepare?.(this.ctx, route));
    prepPromise.catch(() => {}); // surfaced below

    // 1. The old mode flies toward the new one, then the cover goes up on its last frame
    let handoff = null;
    if (this.mode) {
      handoff = (await this.mode.depart?.(route)) || null;
      const kind = handoff?.cover || 'fade';
      if (kind === 'snapshot') await engine.afterFrame(() => overlay.capture(engine.renderer.domElement));
      await overlay.cover(kind);
    }

    // 2. Swap (may block the main thread: only compositor animations run now)
    overlay.showLoading(LABELS[route.mode]);
    const [mod] = await Promise.all([modPromise, prepPromise]);
    if (this.mode) {
      this.mode.exit();
      this.mode = null;
      engine.setMode(null);
    }
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    const mode = new mod.default(this.ctx, route, handoff?.arrival ?? null);
    engine.post.configure(route.mode, { boost: 0 });
    this.ctx.audio?.setScene(route.mode === 'town' ? null : route.mode); // the town sets its own bed (it knows the era)
    await mode.enter();
    this.mode = mode;
    engine.setMode(mode);
    // Draw once behind the cover so the reveal starts on a finished frame
    await engine.afterFrame();

    // 3. Reveal
    overlay.hideLoading();
    const revealing = overlay.reveal();
    mode.arrived?.(); // arrival camera moves while the cover fades
    await revealing;
    // First visit: the title card, then the tip for this place
    this.ctx.tips?.intro();
    this.ctx.tips?.show(route.mode);
  }
}
