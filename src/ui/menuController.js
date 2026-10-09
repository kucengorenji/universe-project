import { BIOMES, STORAGE_KEY } from '../map/mapGenerator.js';
import { PLANET_TYPES } from '../world/planetTypes.js';
import { cityNavigation } from './cityNavigation.js';
import { t, formatNumber, hasKey } from '../i18n/index.js';
import { TwoStepConfirm } from './twoStep.js';
import { flashToast } from './toast.js';

const MODE_ORDER = ['land', 'sea', 'air'];
const TILE_COUNTS = { 2: 162, 3: 642, 4: 2562, 5: 10242 };

const tileCount = (n) => formatNumber(TILE_COUNTS[n] ?? Number(n));
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

export class MenuController {
  constructor({ onRegenerate, onResetCamera, onToggleAutoRotate, onLandCity, onFocus, mapData, renderer, storageOk = () => true, regenImpact = null }) {
    this.onRegenerate = onRegenerate;
    this.storageOk = storageOk; // false while the home map could not be written to browser storage
    this.regenImpact = regenImpact; // what replacing the world leaves behind, for the confirmation
    this.confirm = new TwoStepConfirm({ ms: 8000 });
    this.onLandCity = onLandCity;
    this.onFocus = onFocus;
    this.onResetCamera = onResetCamera;
    this.onToggleAutoRotate = onToggleAutoRotate;
    this.mapData = mapData;
    this.renderer = renderer;
    this.isOpen = false;
    this.lastTooltipTile = null;

    const $ = (id) => document.getElementById(id);
    this.el = {
      menuToggleBtn: $('menuToggleBtn'),
      panel: $('sidebarDrawer'),
      closeBtn: $('closeSidebarBtn'),
      quickRegenerateBtn: $('quickRegenerateBtn'),
      regenerateBtn: $('regenerateBtn'),
      randomSeedBtn: $('randomSeedBtn'),
      seedInput: $('seedInput'),
      seaLevelSlider: $('seaLevelSlider'),
      seaLevelValue: $('seaLevelValue'),
      mountainSlider: $('mountainSlider'),
      mountainValue: $('mountainValue'),
      subdivisionSlider: $('subdivisionSlider'),
      subdivisionValue: $('subdivisionValue'),
      autoRotateToggle: $('autoRotateToggle'),
      airRouteToggle: $('airRouteToggle'),
      groundRouteToggle: $('groundRouteToggle'),
      seaRouteToggle: $('seaRouteToggle'),
      flatTerrainToggle: $('flatTerrainToggle'),
      gridToggle: $('gridToggle'),
      airRouteMeta: $('airRouteMeta'),
      povEnterBtn: $('povEnterBtn'),
      screenshotBtns: [$('screenshotBtn'), $('screenshotPanelBtn')],
      povHud: $('povHud'),
      povMode: $('povMode'),
      povName: $('povName'),
      povRoute: $('povRoute'),
      povIndex: $('povIndex'),
      povPrevBtn: $('povPrevBtn'),
      povNextBtn: $('povNextBtn'),
      povExitBtn: $('povExitBtn'),
      povModeBtns: [...document.querySelectorAll('.pov__mode')],
      resetCameraBtn: $('resetCameraBtn'),
      clearStorageBtn: $('clearStorageBtn'),
      wallSeed: $('wallSeed'),
      playerTilesBadge: $('playerTilesBadge'),
      systemTilesBadge: $('systemTilesBadge'),
      settlementSummary: $('settlementSummary'),
      landRouteMeta: $('landRouteMeta'),
      seaRouteMeta: $('seaRouteMeta'),
      storageStatusBadge: $('storageStatusBadge'),
      assetStatus: $('assetStatus'),
      tileTooltip: $('tileTooltip'),
      infoCard: $('infoCard'),
      infoCardBody: $('infoCardBody'),
      cityList: $('cityList'),
      factionBtns: [...document.querySelectorAll('[data-focus-faction]')]
    };

    this.bindEvents();
    this.updateUI(mapData);
  }

  bindEvents() {
    const el = this.el;
    el.menuToggleBtn.addEventListener('click', () => this.toggleSidebar());
    el.closeBtn.addEventListener('click', () => this.closeSidebar());

    this.seedManuallyEdited = false;
    el.seedInput.addEventListener('input', () => (this.seedManuallyEdited = true));

    el.regenerateBtn.addEventListener('click', () => {
      const typed = parseInt(el.seedInput.value.trim(), 10);
      const seed = this.seedManuallyEdited && !isNaN(typed) ? typed : this.randomSeed();
      this.confirmRegenerate(el.regenerateBtn, () => this.regenerate(seed));
    });
    el.quickRegenerateBtn.addEventListener('click', () => this.confirmRegenerate(el.quickRegenerateBtn, () => this.regenerate(this.randomSeed())));

    el.randomSeedBtn.addEventListener('click', () => {
      el.seedInput.value = this.randomSeed();
      this.seedManuallyEdited = true;
    });

    el.seaLevelSlider.addEventListener('input', (e) => {
      el.seaLevelValue.textContent = `${Math.round((parseFloat(e.target.value) + 0.5) * 100)}%`;
    });
    el.mountainSlider.addEventListener('input', (e) => {
      el.mountainValue.textContent = `${Math.round((1.0 - parseFloat(e.target.value)) * 100)}%`;
    });
    el.subdivisionSlider.addEventListener('input', (e) => {
      el.subdivisionValue.textContent = tileCount(e.target.value);
    });

    el.autoRotateToggle.addEventListener('change', (e) => this.onToggleAutoRotate(e.target.checked));
    el.airRouteToggle.addEventListener('change', (e) => this.renderer.setAirRouteVisible(e.target.checked));
    el.groundRouteToggle.addEventListener('change', (e) => this.renderer.setGroundRouteVisible(e.target.checked));
    el.seaRouteToggle.addEventListener('change', (e) => this.renderer.setSeaRouteVisible(e.target.checked));

    el.gridToggle.checked = this.renderer.showGrid;
    el.gridToggle.addEventListener('change', (e) => this.renderer.setGridVisible(e.target.checked));

    el.flatTerrainToggle.checked = this.renderer.terrainMode === 'flat';
    el.flatTerrainToggle.addEventListener('change', (e) => {
      this.renderer.setTerrainMode(e.target.checked ? 'flat' : 'relief');
      this.flashStatus(t(e.target.checked ? 'planet.flat.on' : 'planet.flat.off'));
    });

    // Screenshot: the panel closes first so only the world is captured
    el.screenshotBtns.forEach((btn) =>
      btn.addEventListener('click', async () => {
        if (this.isOpen) this.closeSidebar();
        const seed = this.mapData?.seed ?? 'world';
        const ok = await this.renderer.saveScreenshot(`planet-globe-${seed}`);
        this.flashStatus(t(ok ? 'planet.shot.ok' : 'planet.shot.fail'));
      })
    );

    // Ride-along (POV)
    el.povEnterBtn.addEventListener('click', () => {
      const mode = MODE_ORDER.find((m) => this.renderer.moversOf(m).length);
      if (!mode) return this.flashStatus(t('planet.pov.none'));
      this.closeSidebar();
      this.renderer.setPovMode(mode);
    });
    el.povPrevBtn.addEventListener('click', () => this.renderer.cyclePov(-1));
    el.povNextBtn.addEventListener('click', () => this.renderer.cyclePov(1));
    el.povExitBtn.addEventListener('click', () => this.renderer.exitPov());
    el.povModeBtns.forEach((b) =>
      b.addEventListener('click', () => {
        if (!this.renderer.setPovMode(b.dataset.mode)) this.flashStatus(t(`planet.pov.no.${b.dataset.mode}`));
      })
    );
    this.renderer.onPovChange = (info) => this.renderPov(info);

    el.resetCameraBtn.addEventListener('click', () => {
      this.onResetCamera();
      this.flashStatus(t('planet.camera.reset'));
    });

    el.clearStorageBtn.addEventListener('click', () => {
      try {
        localStorage.removeItem(STORAGE_KEY);
        el.storageStatusBadge.textContent = t('planet.storage.none');
        this.flashStatus(t('planet.storage.cleared'));
      } catch (err) {
        this.flashStatus(t('planet.storage.denied'));
      }
    });

    this.renderer.onTileHover = (tile, x, y) => this.handleTileHover(tile, x, y);
    this.renderer.onFocusChange = (spec) => this.renderInfoCard(spec);

    // Focus: faction blocks, city list and the card's own buttons
    const narrow = () => window.innerWidth < 900;
    el.factionBtns.forEach((b) =>
      b.addEventListener('click', () => {
        if (narrow()) this.closeSidebar();
        this.renderer.focusOn({ type: 'faction', owner: b.dataset.focusFaction });
      })
    );
    el.cityList.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-focus-city]');
      if (!btn) return;
      if (narrow()) this.closeSidebar();
      this.renderer.focusOn({ type: 'city', index: Number(btn.dataset.focusCity) });
    });
    el.infoCard.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      if (btn.dataset.action === 'close') this.renderer.clearFocus();
      else if (btn.dataset.action === 'land') this.onLandCity?.(Number(btn.dataset.city));
      else if (btn.dataset.action === 'ride' && !this.renderer.povFromCity(Number(btn.dataset.city))) {
        this.flashStatus(t('planet.ride.none'));
      } else if (btn.dataset.focusCity !== undefined) this.renderer.focusOn({ type: 'city', index: Number(btn.dataset.focusCity) });
    });
    this.renderer.onAssetsStatus = (state) => this.setAssetStatus(state);
    if (this.renderer.assetsState) this.setAssetStatus(this.renderer.assetsState);

    window.addEventListener('keydown', (e) => {
      if (this.renderer.suspended || e.target.matches?.('input, textarea')) return;
      if (e.key === 'Escape') {
        if (this.isOpen) this.closeSidebar();
        else if (this.renderer.pov) this.renderer.exitPov();
        else if (this.renderer.focus) this.renderer.clearFocus();
      } else if (this.renderer.pov && e.key === 'ArrowRight') this.renderer.cyclePov(1);
      else if (this.renderer.pov && e.key === 'ArrowLeft') this.renderer.cyclePov(-1);
    });
  }

  randomSeed() {
    return Math.floor(Math.random() * 900000 + 100000);
  }

  /** Replacing the world is not undone by a click: the first press says what it leaves behind, a second one confirms. */
  confirmRegenerate(button, run) {
    const confirmed = this.confirm.press(button.id);
    clearTimeout(this.armTimer);
    this.restoreRegenerateLabel();
    if (confirmed) return run();
    this.armedButton = [button, button.textContent];
    button.textContent = t('planet.regen.confirmBtn');
    this.flashStatus(t('planet.regen.confirm', this.regenImpact?.() ?? { seed: this.mapData?.seed ?? '', rooms: 0, homes: 0, campaigns: 0, missions: 0 }), 8000);
    this.armTimer = setTimeout(() => { this.confirm.cancel(); this.restoreRegenerateLabel(); }, 8000);
  }

  restoreRegenerateLabel() {
    if (!this.armedButton) return;
    const [button, label] = this.armedButton;
    button.textContent = label;
    this.armedButton = null;
  }

  regenerate(seed) {
    const el = this.el;
    el.seedInput.value = seed;
    const options = {
      seaLevel: parseFloat(el.seaLevelSlider.value),
      mountainThreshold: parseFloat(el.mountainSlider.value),
      subdivision: parseInt(el.subdivisionSlider.value, 10)
    };
    // Let the button state paint before the synchronous rebuild blocks the thread
    [el.regenerateBtn, el.quickRegenerateBtn].forEach((b) => (b.disabled = true));
    el.storageStatusBadge.textContent = t('planet.building');
    requestAnimationFrame(() =>
      setTimeout(() => {
        try {
          this.onRegenerate(seed, options);
          if (!this.storageOk()) this.flashStatus(t('pause.save.mapError'), 7000);
        } catch (err) {
          console.error(err);
          this.flashStatus(t('planet.build.failed'));
        } finally {
          [el.regenerateBtn, el.quickRegenerateBtn].forEach((b) => (b.disabled = false));
        }
      }, 0)
    );
  }

  renderPov(info) {
    const el = this.el;
    document.body.classList.toggle('is-pov', info.active);
    el.povHud.hidden = !info.active;
    el.povModeBtns.forEach((b) => {
      const n = info.counts[b.dataset.mode] || 0;
      b.querySelector('[data-count]').textContent = n;
      b.disabled = n === 0;
      b.setAttribute('aria-pressed', String(info.active && info.mode === b.dataset.mode));
    });
    if (!info.active) return;
    el.tileTooltip.classList.remove('visible');
    el.povMode.textContent = t('planet.pov.mode', { mode: t(`planet.mode.${info.mode}`), style: t(info.style === 'modern' ? 'planet.style.modern' : 'planet.style.fantasy') });
    el.povName.textContent = info.name;
    el.povRoute.textContent = info.route;
    el.povIndex.textContent = `${info.index + 1} / ${info.total}`;
    const single = info.total < 2;
    el.povPrevBtn.disabled = single;
    el.povNextBtn.disabled = single;
  }

  setAssetStatus(state) {
    const s = this.el.assetStatus;
    if (!s) return;
    s.dataset.state = state;
    s.textContent =
      state === 'error' ? t('planet.assets.error') : state === 'ready' ? t('planet.assets.ready') : t('planet.assets.loading');
  }

  toggleSidebar() {
    this.isOpen ? this.closeSidebar() : this.openSidebar();
  }

  openSidebar() {
    this.isOpen = true;
    this.el.panel.classList.add('open');
    this.el.panel.setAttribute('aria-hidden', 'false');
    this.el.menuToggleBtn.setAttribute('aria-expanded', 'true');
    this.el.closeBtn.focus({ preventScroll: true });
  }

  closeSidebar() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.panel.classList.remove('open');
    this.el.panel.setAttribute('aria-hidden', 'true');
    this.el.menuToggleBtn.setAttribute('aria-expanded', 'false');
    this.el.menuToggleBtn.focus({ preventScroll: true });
  }

  updateUI(mapData) {
    this.mapData = mapData;
    this.seedManuallyEdited = false;
    if (!mapData) return;
    const el = this.el;
    const type = PLANET_TYPES[mapData.planetType || 'terran'];
    document.body.classList.toggle('is-colony', !!mapData.planetType && mapData.planetType !== 'terran');
    document.body.classList.toggle('is-wild', !type?.inhabited);

    el.seedInput.value = mapData.seed;
    el.wallSeed.textContent = mapData.seed;
    el.playerTilesBadge.textContent = t('planet.tiles', { count: mapData.player?.claimedTileCount ?? 0 });
    el.systemTilesBadge.textContent = t('planet.tiles', { count: mapData.system?.claimedTileCount ?? 0 });
    const saved = this.storageOk();
    el.storageStatusBadge.textContent = t(saved ? 'planet.storage.saved' : 'planet.storage.none');
    el.storageStatusBadge.title = saved ? '' : t('pause.save.mapError');

    const cities = mapData.cities || [];
    const farms = mapData.farms || [];
    const ports = cities.filter((c) => c.isPort).length;
    el.settlementSummary.textContent = cities.length
      ? t('planet.settlement', { cities: cities.length, ports, farms: farms.length })
      : t('planet.settlement.none');

    const land = mapData.landRoutes?.length ?? 0;
    const sea = mapData.seaRoutes?.length ?? 0;
    el.landRouteMeta.textContent = land ? t('planet.routes.land', { count: land }) : t('planet.routes.land.none');
    el.seaRouteMeta.textContent = sea ? t('planet.routes.sea', { count: sea }) : t('planet.routes.sea.none');
    const air = mapData.airRoutes?.length ?? 0;
    el.airRouteMeta.textContent = air ? t('planet.routes.air', { count: air }) : t('planet.routes.air.none');

    if (mapData.subdivision) {
      el.subdivisionSlider.value = mapData.subdivision;
      el.subdivisionValue.textContent = tileCount(mapData.subdivision);
    }
    el.cityList.innerHTML = cities
      .map(
        (c) => `<li><button type="button" class="city-row" data-focus-city="${c.index}">
          <span class="city-row__mark city-row__mark--${c.owner || 'neutral'}"></span>
          <span class="city-row__name">${escapeHtml(c.name)}</span>
          <span class="city-row__meta">${t(c.type === 'capital' ? 'planet.city.meta.capital' : 'planet.city.meta', { style: t(c.style === 'modern' ? 'planet.style.modern' : 'planet.style.fantasy'), size: c.size })}</span>
        </button></li>`
      )
      .join('');
  }

  /** Focus card: city, faction or tile details, kept apart from the settings panel. */
  renderInfoCard(spec) {
    const card = this.el.infoCard;
    const body = this.el.infoCardBody;
    document.body.classList.toggle('has-card', !!spec);
    this.onFocus?.(spec);
    // On wide screens the globe re-centres into the space right of the card
    // The globe re-centres into the space the card leaves free (beside it on desktop, above it on phones)
    const inset = () =>
      window.innerWidth >= 900 ? { left: card.offsetLeft + card.offsetWidth } : { bottom: card.offsetHeight };
    if (!spec) {
      card.hidden = true;
      this.renderer.setInset();
      return;
    }
    const d = this.mapData;
    const close = `<button type="button" class="menu-circle menu-circle--close menu-circle--small" data-action="close" aria-label="${t('planet.card.closeAria')}"><span></span><span></span></button>`;
    const facts = (rows) => `<dl class="facts">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
    let html = '';

    if (spec.type === 'city') {
      const c = d.cities[spec.index];
      const involves = (r) => r.from === c.index || r.to === c.index;
      const farms = (d.farms || []).filter((f) => f.city === c.index);
      const air = (d.airRoutes || []).filter(involves).length;
      const tone = c.owner === 'player' ? 'green' : c.owner === 'system' ? 'red' : 'iron';
      html = `
        <header class="card-block card-block--${tone}">
          <span class="card-block__eyebrow">${t(`planet.card.${c.type === 'capital' ? 'capital' : 'city'}.${c.style === 'modern' ? 'modern' : 'fantasy'}`)}</span>
          <h2 class="card-block__title">${escapeHtml(c.name)}</h2>
          ${close}
        </header>
        <div class="info-card__content">
          ${facts([
            [t('planet.fact.size'), t('planet.tiles', { count: c.size })],
            [t('planet.fact.port'), t(c.isPort ? 'planet.yes' : 'planet.no')],
            [t('planet.fact.farms'), farms.length ? t('planet.fact.farms.value', { count: farms.length, tiles: farms.reduce((n, f) => n + f.tiles.length, 0) }) : t('planet.none')],
            [t('planet.fact.roads'), t('planet.routes.count', { count: (d.landRoutes || []).filter(involves).length })],
            [t('planet.fact.sea'), t('planet.routes.count', { count: (d.seaRoutes || []).filter(involves).length })],
            [t('planet.fact.air'), t('planet.routes.count', { count: air }) + (air ? t(c.style === 'modern' ? 'planet.fact.air.planes' : 'planet.fact.air.balloons') : '')]
          ])}
          <div class="info-card__actions">
            <button type="button" class="pill pill--landing" data-action="land" data-city="${c.index}"><span class="arrow-down" aria-hidden="true"></span>${t('planet.card.land')}</button>
            <button type="button" class="pill pill--ghost" data-action="ride" data-city="${c.index}">${t('planet.card.ride')}</button>
            <button type="button" class="pill pill--ghost" data-action="close">${t('planet.card.back')}</button>
          </div>
          ${cityNavigation(d.cities,c.index)}
        </div>`;
    } else if (spec.type === 'faction') {
      const info = d[spec.owner];
      const style = spec.owner === 'system' ? 'modern' : 'fantasy';
      const towns = (d.cities || []).filter((c) => c.style === style);
      html = `
        <header class="card-block card-block--${spec.owner === 'player' ? 'green' : 'red'}">
          <span class="card-block__eyebrow">${t(spec.owner === 'player' ? 'planet.faction.player' : 'planet.faction.system')}</span>
          <h2 class="card-block__title">${spec.owner === 'player' ? 'New Babylon' : 'Aegis Citadel'}</h2>
          ${close}
        </header>
        <div class="info-card__content">
          ${facts([
            [t('planet.fact.territory'), t('planet.tiles', { count: info?.claimedTileCount ?? 0 })],
            [t('planet.fact.civilization'), t(style === 'modern' ? 'planet.civ.modern' : 'planet.civ.fantasy')],
            [t('planet.fact.cities'), t('planet.cities', { count: towns.length })]
          ])}
          <ul class="city-list city-list--card">${towns
            .map(
              (c) => `<li><button type="button" class="city-row" data-focus-city="${c.index}">
                <span class="city-row__name">${escapeHtml(c.name)}</span>
                <span class="city-row__meta">${t(c.type === 'capital' ? 'planet.city.size.capital' : 'planet.city.size', { size: c.size })}</span>
              </button></li>`
            )
            .join('')}</ul>
          <div class="info-card__actions">
            <button type="button" class="pill pill--ghost" data-action="close">${t('planet.card.back')}</button>
          </div>
        </div>`;
    } else {
      const tile = this.renderer.hexasphere.tileMap.get(spec.tileId);
      if (!tile) return;
      const farm = tile.farmIndex !== null && tile.farmIndex !== undefined ? d.farms?.[tile.farmIndex] : null;
      html = `
        <header class="info-card__head">
          <span class="card-block__eyebrow">${t('planet.tile', { id: tile.id })}</span>
          <h2 class="info-card__title">${this.swatch(tile)}${this.biomeName(tile.biome)}</h2>
          ${close}
        </header>
        <div class="info-card__content">
          ${facts([
            [t('planet.fact.owner'), tile.owner ? `<span class="owner-dot owner-dot--${tile.owner}"></span>${t(`planet.owner.${tile.owner}`)}` : t('planet.unclaimed')],
            [t('planet.fact.farm'), farm ? t('planet.tiles', { count: farm.tiles.length }) : t('planet.none')],
            [t('planet.fact.road'), tile.road ? t('planet.road.yes') : t('planet.none')],
            [t('planet.fact.river'), t(tile.hasRiver ? 'planet.river.yes' : 'planet.river.no')],
            [t('planet.fact.elevation'), (tile.elevation * 100).toFixed(1)]
          ])}
        </div>`;
    }
    body.innerHTML = html;
    card.hidden = false;
    this.renderer.setInset(inset());
  }

  getCity(tile) {
    if (tile.cityIndex === null || tile.cityIndex === undefined) return null;
    return this.mapData?.cities?.[tile.cityIndex] || null;
  }

  swatch(tile) {
    return `<span class="swatch" style="background:${hex(this.renderer.palette?.[tile.biome] ?? 0x888888)}"></span>`;
  }

  biomeName(biome) {
    const specific = `planet.biome.${this.mapData?.planetType}.${biome}`;
    return hasKey(specific) ? t(specific) : hasKey(`planet.biome.${biome}`) ? t(`planet.biome.${biome}`) : t('planet.biome.land');
  }

  handleTileHover(tile, x, y) {
    const tip = this.el.tileTooltip;
    if (!tile || this.renderer.pov) {
      tip.classList.remove('visible');
      this.lastTooltipTile = null;
      return;
    }
    // Rebuild the content only when the hovered tile changes
    if (tile !== this.lastTooltipTile) {
      this.lastTooltipTile = tile;
      const city = this.getCity(tile);
      const parts = [];
      if (city) parts.push(`${escapeHtml(city.name)}, ${t('planet.tiles', { count: city.size })}`);
      if (tile.farmIndex !== null && tile.farmIndex !== undefined) parts.push(t('planet.tip.farm'));
      if (tile.road) parts.push(t('planet.tip.road'));
      if (tile.hasRiver) parts.push(t('planet.tip.river'));
      if (tile.owner) parts.push(t(tile.owner === 'player' ? 'planet.tip.player' : 'planet.tip.system'));
      tip.innerHTML = `
        <div class="tooltip__title">${this.swatch(tile)}${this.biomeName(tile.biome)}</div>
        <div class="tooltip__meta">${parts.length ? parts.join(' / ') : t('planet.tip.empty')}</div>`;
    }
    const w = tip.offsetWidth || 220;
    const h = tip.offsetHeight || 60;
    tip.style.transform = `translate(${Math.min(window.innerWidth - w - 10, x + 16)}px, ${Math.min(
      window.innerHeight - h - 10,
      y + 16
    )}px)`;
    tip.classList.add('visible');
  }

  flashStatus(message, ms = 2800) {
    flashToast(message, ms);
  }

}
