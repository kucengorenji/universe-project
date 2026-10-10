import { parseRoute, formatRoute, isSafeHomeId } from './router.js';
import { isSupportedHomeRecord } from '../world/savedRecords.js';
import { flashToast } from '../ui/toast.js';
import { contextKey } from './tipPolicy.js';
import { markRoute } from './resourceBytes.js';
import { t } from '../i18n/index.js';

// Each mode is its own chunk: only the code (and assets) of the mode on screen
// are ever loaded, and the next one is fetched while the current one plays its
// departure animation.
const MODES = {
  space: () => import('../modes/space/SpaceMode.js'),
  planet: () => import('../modes/planet/PlanetMode.js'),
  trade: () => import('../modes/trade/TradeMode.js'),
  town: () => import('../modes/town/TownMode.js'),
  home: () => import('../modes/home/HomeMode.js')
};

const openTradeSetupLazily = async (...args) => (await import('../trade/entry.js')).openTradeSetup(...args);

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
 *
 * A mode that fails to load or enter never leaves a dead screen: the player is put back
 * where they were (or on the planet, or in space) with a notice, and can carry on without
 * reloading. Only when even those fail does the cover stay up with a reload message.
 *
 * `modes`, `notify` and `openTradeSetup` can be replaced (tests use fake modes).
 */
export class Director {
  constructor({ engine, world, overlay, missions, audio, tips, trade, journey = null }, { modes = MODES, notify = flashToast, openTradeSetup = openTradeSetupLazily } = {}) {
    this.engine = engine;
    this.world = world;
    this.overlay = overlay;
    this.missions = missions;
    this.modes = modes;
    this.notify = notify;
    this.openTradeSetup = openTradeSetup;
    this.mode = null;
    this.route = null;
    this.busy = false;
    this.pending = null;
    this.listeners = new Set(); // called with each route reached (mode switches and in-mode navigation)
    this.ctx = { engine, world, overlay, missions, audio, tips, trade, journey, director: this };
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
    await this.world.ready;
    await this.ctx?.trade?.ready;
    const r = this.sanitize(parseRoute(location.hash)) || { mode: 'space', planet: this.world.homeIndex };
    const locationState = this.world.state.get('playerLocation');
    await this.go(r, { replace: true });
    await this.mode?.restoreInteriorLocation?.(locationState);
  }

  /** Clamp a route to something that exists in the current system. */
  sanitize(r) {
    if (!r || !Object.hasOwn(this.modes ?? MODES, r.mode)) return null;
    const p = r.planet !== null && r.planet !== undefined ? this.world.planet(r.planet) : null;
    if (r.mode === 'space') return { mode: 'space', planet: p ? r.planet : null };
    if (!p || !p.landable) return { mode: 'space', planet: p ? r.planet : null };
    if (r.mode === 'trade') {
      const c = this.ctx.trade?.items.find(c => c.id === r.campaign && c.planet === r.planet && c.worldId === this.world.worldId);
      if (!c) return { mode: 'planet', planet: r.planet, city: null };
    }
    if (r.mode === 'town' || r.mode === 'home') {
      const map = this.world.mapFor(r.planet);
      if (!map?.cities?.[r.city]) return { mode: 'planet', planet: r.planet, city: null };
      if (r.mode === 'home' && (!isSafeHomeId(r.home) || !isSupportedHomeRecord(this.world.state.get(`home:${r.planet}:${r.city}:${r.home}`)))) return { mode: 'town', planet: r.planet, city: r.city };
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
    await this.world.ready;
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
        this.listeners.forEach((fn) => fn(route));
        return;
      }
      await this.switchTo(route);
      if (!fromHash) this.setHash(route, replace || !this.route);
      else if (formatRoute(route) !== location.hash) this.setHash(route, true);
      this.route = route;
      this.listeners.forEach((fn) => fn(route));
    } catch (err) {
      console.error('Mode switch failed:', err);
      try { await this.recover(route, err); } catch (recoveryError) { console.error('Recovery failed:', recoveryError); }
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

  /** Start fetching a mode and what it needs; failures surface when the swap awaits them. */
  load(route) {
    const modPromise = this.modes[route.mode]();
    const prepPromise = modPromise.then((m) => m.default.prepare?.(this.ctx, route));
    prepPromise.catch(() => {}); // surfaced by swap()
    return { modPromise, prepPromise };
  }

  async switchTo(route) {
    const { engine, overlay } = this;
    markRoute(route.mode); // QA: bytes fetched from here until the next route belong to this one
    const { modPromise, prepPromise } = this.load(route);

    // 1. The old mode flies toward the new one, then the cover goes up on its last frame
    let handoff = null;
    if (this.mode) {
      handoff = (await this.mode.depart?.(route)) || null;
      const kind = handoff?.cover || 'fade';
      if (kind === 'snapshot') await engine.afterFrame(() => overlay.capture(engine.renderer.domElement));
      await overlay.cover(kind);
    }
    await this.swap(route, handoff, modPromise, prepPromise);
  }

  /**
   * 2. Swap (may block the main thread: only compositor animations run now), 3. reveal.
   * Fails with `this.mode` still set while nothing has been torn down yet, and with
   * `this.mode === null` once the old mode is gone: recover() relies on that.
   */
  async swap(route, handoff, modPromise, prepPromise) {
    const { engine, overlay } = this;
    overlay.showLoading(t(`loading.${route.mode}`));
    const [mod] = await Promise.all([modPromise, prepPromise]);
    if (this.mode) {
      const old = this.mode;
      this.mode = null;
      engine.setMode(null);
      try { old.exit(); } catch (error) { console.error('Leaving the previous mode failed:', error); }
    }
    this.ctx.tips?.setContext(contextKey(route.mode)); // the old place's tip leaves now; a town refines this to its view
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    let mode = null;
    try {
      mode = new mod.default(this.ctx, route, handoff?.arrival ?? null);
      engine.post.configure(route.mode === 'trade' ? 'planet' : route.mode, { boost: 0 });
      this.ctx.audio?.setScene(route.mode === 'town' ? null : route.mode === 'trade' ? 'planet' : route.mode); // the town sets its own bed (it knows the era)
      await mode.enter();
    } catch (error) {
      try { mode?.exit?.(); } catch (cleanup) { console.error('Cleaning up a half-built mode failed:', cleanup); }
      throw error;
    }
    this.mode = mode;
    engine.setMode(mode);
    this.ctx.journey?.modeEntered(route);
    // Draw once behind the cover so the reveal starts on a finished frame
    await engine.afterFrame();

    // Reveal
    overlay.hideLoading();
    const revealing = overlay.reveal();
    mode.arrived?.(); // arrival camera moves while the cover fades
    await revealing;
    // First visit: the title card, then the tip for this place
    if (route.mode !== 'trade') {
      this.ctx.tips?.intro();
      this.ctx.tips?.show(route.mode);
    }
  }

  /**
   * A switch failed. Before the swap the old mode is still on screen: lift the cover and
   * stay. After it, rebuild the previous place, else the planet, else space.
   */
  async recover(target, error) {
    const { overlay } = this;
    const previous = this.route;
    overlay.hideLoading();
    if (target.mode === 'trade' && this.ctx.trade) this.ctx.trade.loadError = error?.message;
    if (this.mode) {
      if (previous) this.setHash(previous, true);
      this.notify(t('loading.recovered.stay'));
      await overlay.reveal();
    } else if (!(await this.fallBack(this.fallbackRoutes(target, previous)))) {
      overlay.setProgress(null, t('loading.failed')); // nothing could be built: the player has to reload
      return;
    }
    if (target.mode === 'trade' && this.ctx.trade) {
      try { await this.openTradeSetup(this.ctx, target.planet, this.world.mapFor(target.planet), { forceDialog: true }); }
      catch (setupError) { console.error('Trade setup could not open:', setupError); }
    }
  }

  /** Places to try, best first: where the player was, the planet, space. A failed Trade goes to its planet first. */
  fallbackRoutes(target, previous) {
    const planet = target.planet ?? previous?.planet ?? this.world.homeIndex;
    const planetRoute = { mode: 'planet', planet, city: null };
    const chain = target.mode === 'trade' ? [planetRoute, previous] : [previous, planetRoute];
    chain.push({ mode: 'space', planet: this.world.planet(planet) ? planet : null });
    const seen = new Set([formatRoute(target)]);
    return chain.map((r) => r && this.sanitize(r)).filter((r) => {
      if (!r) return false;
      const key = formatRoute(r);
      return !seen.has(key) && seen.add(key);
    });
  }

  async fallBack(routes) {
    for (const route of routes) {
      try {
        const { modPromise, prepPromise } = this.load(route);
        await this.swap(route, null, modPromise, prepPromise);
        this.route = route;
        this.setHash(route, true);
        this.notify(t('loading.recovered.fallback'));
        return route;
      } catch (error) {
        console.error(`Falling back to ${formatRoute(route)} failed:`, error);
      }
    }
    return null;
  }
}
