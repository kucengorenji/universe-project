import { BIOMES, STORAGE_KEY } from '../map/mapGenerator.js';
import { PLANET_TYPES } from '../world/planetTypes.js';
import { cityNavigation } from './cityNavigation.js';

const BIOME_NAMES = {
  [BIOMES.OCEAN_DEEP]: 'Laut dalam',
  [BIOMES.OCEAN]: 'Laut',
  [BIOMES.COAST]: 'Pesisir dangkal',
  [BIOMES.BEACH]: 'Pantai',
  [BIOMES.PLAINS]: 'Padang rumput',
  [BIOMES.FOREST]: 'Hutan',
  [BIOMES.DESERT]: 'Padang pasir',
  [BIOMES.MOUNTAIN]: 'Pegunungan',
  [BIOMES.TUNDRA]: 'Tundra salju'
};

// Same biome codes, different ground on other worlds
const TYPE_BIOME_NAMES = {
  ocean: {},
  desert: { [BIOMES.PLAINS]: 'Stepa kering', [BIOMES.FOREST]: 'Oasis', [BIOMES.MOUNTAIN]: 'Mesa merah' },
  ice: { [BIOMES.OCEAN]: 'Laut beku', [BIOMES.OCEAN_DEEP]: 'Laut beku dalam', [BIOMES.PLAINS]: 'Stepa beku', [BIOMES.FOREST]: 'Taiga salju', [BIOMES.DESERT]: 'Dataran es', [BIOMES.BEACH]: 'Pantai es' },
  lava: { [BIOMES.OCEAN]: 'Lautan lava', [BIOMES.OCEAN_DEEP]: 'Inti lava', [BIOMES.COAST]: 'Kerak lava', [BIOMES.BEACH]: 'Pantai obsidian', [BIOMES.PLAINS]: 'Dataran basal', [BIOMES.DESERT]: 'Padang abu', [BIOMES.MOUNTAIN]: 'Gunung api' },
  barren: { [BIOMES.PLAINS]: 'Regolit', [BIOMES.DESERT]: 'Padang debu', [BIOMES.MOUNTAIN]: 'Pegunungan batu', [BIOMES.TUNDRA]: 'Es kutub' }
};

const OWNER_NAMES = { player: 'New Babylon (pemain)', system: 'Aegis Citadel (sistem)' };
const MODE_NAMES = { air: 'udara', land: 'darat', sea: 'laut' };
const MODE_ORDER = ['land', 'sea', 'air'];
const TILE_COUNTS = { 2: '162', 3: '642', 4: '2.562', 5: '10.242' };

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

export class MenuController {
  constructor({ onRegenerate, onResetCamera, onToggleAutoRotate, onLandCity, onFocus, mapData, renderer }) {
    this.onRegenerate = onRegenerate;
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
      this.regenerate(seed);
    });
    el.quickRegenerateBtn.addEventListener('click', () => this.regenerate(this.randomSeed()));

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
      el.subdivisionValue.textContent = TILE_COUNTS[e.target.value] || e.target.value;
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
      this.flashStatus(e.target.checked ? 'Daratan dan laut kini satu level' : 'Daratan kembali bertebing di atas laut');
    });

    // Screenshot: the panel closes first so only the world is captured
    el.screenshotBtns.forEach((btn) =>
      btn.addEventListener('click', async () => {
        if (this.isOpen) this.closeSidebar();
        const seed = this.mapData?.seed ?? 'dunia';
        const ok = await this.renderer.saveScreenshot(`planet-globe-${seed}`);
        this.flashStatus(ok ? 'Gambar tersimpan ke folder unduhan' : 'Browser menolak membuat gambar, coba lagi');
      })
    );

    // Ride-along (POV)
    el.povEnterBtn.addEventListener('click', () => {
      const mode = MODE_ORDER.find((m) => this.renderer.moversOf(m).length);
      if (!mode) return this.flashStatus('Belum ada kendaraan. Tunggu model 3D selesai dimuat.');
      this.closeSidebar();
      this.renderer.setPovMode(mode);
    });
    el.povPrevBtn.addEventListener('click', () => this.renderer.cyclePov(-1));
    el.povNextBtn.addEventListener('click', () => this.renderer.cyclePov(1));
    el.povExitBtn.addEventListener('click', () => this.renderer.exitPov());
    el.povModeBtns.forEach((b) =>
      b.addEventListener('click', () => {
        if (!this.renderer.setPovMode(b.dataset.mode)) this.flashStatus(`Tidak ada kendaraan ${MODE_NAMES[b.dataset.mode]} di dunia ini`);
      })
    );
    this.renderer.onPovChange = (info) => this.renderPov(info);

    el.resetCameraBtn.addEventListener('click', () => {
      this.onResetCamera();
      this.flashStatus('Kamera kembali ke posisi awal');
    });

    el.clearStorageBtn.addEventListener('click', () => {
      try {
        localStorage.removeItem(STORAGE_KEY);
        el.storageStatusBadge.textContent = 'Belum tersimpan';
        this.flashStatus('Peta tersimpan dihapus. Muat ulang halaman untuk dunia baru.');
      } catch (err) {
        this.flashStatus('Browser menolak akses penyimpanan, peta tidak bisa dihapus.');
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
        this.flashStatus('Belum ada kendaraan yang melayani kota ini');
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
    el.storageStatusBadge.textContent = 'Membangun dunia';
    requestAnimationFrame(() =>
      setTimeout(() => {
        try {
          this.onRegenerate(seed, options);
        } catch (err) {
          console.error(err);
          this.flashStatus('Gagal membangun dunia. Coba seed lain.');
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
    el.povMode.textContent = `POV ${MODE_NAMES[info.mode]}, kota ${info.style === 'modern' ? 'modern' : 'fantasi'}`;
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
      state === 'error'
        ? 'Model 3D gagal dimuat. Terrain tetap tampil, kota dan pohon tidak. Muat ulang halaman untuk mencoba lagi.'
        : state === 'ready'
        ? 'Model 3D siap'
        : 'Memuat model 3D';
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
    el.playerTilesBadge.textContent = `${mapData.player?.claimedTileCount ?? 0} tile`;
    el.systemTilesBadge.textContent = `${mapData.system?.claimedTileCount ?? 0} tile`;
    el.storageStatusBadge.textContent = 'Tersimpan di browser';

    const cities = mapData.cities || [];
    const farms = mapData.farms || [];
    const ports = cities.filter((c) => c.isPort).length;
    el.settlementSummary.textContent = cities.length
      ? `${cities.length} kota (${ports} pelabuhan), ${farms.length} ladang.`
      : 'Belum ada pemukiman di dunia ini.';

    const land = mapData.landRoutes?.length ?? 0;
    const sea = mapData.seaRoutes?.length ?? 0;
    el.landRouteMeta.textContent = land ? `${land} jalan, dilewati karavan` : 'Tidak ada jalan di dunia ini';
    el.seaRouteMeta.textContent = sea ? `${sea} rute kapal antar pelabuhan` : 'Tidak ada rute laut di dunia ini';
    const air = mapData.airRoutes?.length ?? 0;
    el.airRouteMeta.textContent = air ? `${air} rute, balon udara dan pesawat` : 'Tidak ada rute udara di dunia ini';

    if (mapData.subdivision) {
      el.subdivisionSlider.value = mapData.subdivision;
      el.subdivisionValue.textContent = TILE_COUNTS[mapData.subdivision] || mapData.subdivision;
    }
    el.cityList.innerHTML = cities
      .map(
        (c) => `<li><button type="button" class="city-row" data-focus-city="${c.index}">
          <span class="city-row__mark city-row__mark--${c.owner || 'neutral'}"></span>
          <span class="city-row__name">${escapeHtml(c.name)}</span>
          <span class="city-row__meta">${c.type === 'capital' ? 'Ibukota, ' : ''}${c.style === 'modern' ? 'modern' : 'fantasi'}, ${c.size} tile</span>
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
    const close = `<button type="button" class="menu-circle menu-circle--close menu-circle--small" data-action="close" aria-label="Tutup dan kembali ke globe"><span></span><span></span></button>`;
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
          <span class="card-block__eyebrow">${c.type === 'capital' ? 'Ibukota' : 'Kota'} ${c.style === 'modern' ? 'modern' : 'fantasi'}</span>
          <h2 class="card-block__title">${escapeHtml(c.name)}</h2>
          ${close}
        </header>
        <div class="info-card__content">
          ${facts([
            ['Ukuran', `${c.size} tile`],
            ['Pelabuhan', c.isPort ? 'Ya' : 'Tidak'],
            ['Ladang', farms.length ? `${farms.length} ladang, ${farms.reduce((n, f) => n + f.tiles.length, 0)} tile` : 'Tidak ada'],
            ['Jalan darat', `${(d.landRoutes || []).filter(involves).length} rute`],
            ['Rute laut', `${(d.seaRoutes || []).filter(involves).length} rute`],
            ['Rute udara', `${air} rute${air ? (c.style === 'modern' ? ', pesawat' : ', balon udara') : ''}`]
          ])}
          <div class="info-card__actions">
            <button type="button" class="pill" data-action="land" data-city="${c.index}">Mendarat di kota</button>
            <button type="button" class="pill pill--ghost" data-action="ride" data-city="${c.index}">Naik kendaraan dari sini</button>
            <button type="button" class="pill pill--ghost" data-action="close">Kembali ke globe</button>
          </div>
          ${cityNavigation(d.cities,c.index)}
        </div>`;
    } else if (spec.type === 'faction') {
      const info = d[spec.owner];
      const style = spec.owner === 'system' ? 'modern' : 'fantasy';
      const towns = (d.cities || []).filter((c) => c.style === style);
      html = `
        <header class="card-block card-block--${spec.owner === 'player' ? 'green' : 'red'}">
          <span class="card-block__eyebrow">${spec.owner === 'player' ? 'Faksi pemain' : 'Faksi sistem'}</span>
          <h2 class="card-block__title">${spec.owner === 'player' ? 'New Babylon' : 'Aegis Citadel'}</h2>
          ${close}
        </header>
        <div class="info-card__content">
          ${facts([
            ['Wilayah', `${info?.claimedTileCount ?? 0} tile`],
            ['Peradaban', style === 'modern' ? 'Modern: truk, kapal kontainer, pesawat' : 'Fantasi: karavan, kapal layar, balon udara'],
            ['Kota', `${towns.length} kota`]
          ])}
          <ul class="city-list city-list--card">${towns
            .map(
              (c) => `<li><button type="button" class="city-row" data-focus-city="${c.index}">
                <span class="city-row__name">${escapeHtml(c.name)}</span>
                <span class="city-row__meta">${c.type === 'capital' ? 'Ibukota, ' : ''}${c.size} tile</span>
              </button></li>`
            )
            .join('')}</ul>
          <div class="info-card__actions">
            <button type="button" class="pill pill--ghost" data-action="close">Kembali ke globe</button>
          </div>
        </div>`;
    } else {
      const tile = this.renderer.hexasphere.tileMap.get(spec.tileId);
      if (!tile) return;
      const farm = tile.farmIndex !== null && tile.farmIndex !== undefined ? d.farms?.[tile.farmIndex] : null;
      html = `
        <header class="info-card__head">
          <span class="card-block__eyebrow">Tile ${tile.id}</span>
          <h2 class="info-card__title">${this.swatch(tile)}${this.biomeName(tile.biome)}</h2>
          ${close}
        </header>
        <div class="info-card__content">
          ${facts([
            ['Pemilik', tile.owner ? `<span class="owner-dot owner-dot--${tile.owner}"></span>${OWNER_NAMES[tile.owner]}` : 'Belum diklaim'],
            ['Ladang', farm ? `${farm.tiles.length} tile` : 'Tidak ada'],
            ['Jalan', tile.road ? 'Dilewati jalan darat' : 'Tidak ada'],
            ['Sungai', tile.hasRiver ? 'Ada' : 'Tidak ada'],
            ['Elevasi', (tile.elevation * 100).toFixed(1)]
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
    return TYPE_BIOME_NAMES[this.mapData?.planetType]?.[biome] || BIOME_NAMES[biome] || 'Daratan';
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
      if (city) parts.push(`${escapeHtml(city.name)}, ${city.size} tile`);
      if (tile.farmIndex !== null && tile.farmIndex !== undefined) parts.push('Ladang');
      if (tile.road) parts.push('Jalan');
      if (tile.hasRiver) parts.push('Sungai');
      if (tile.owner) parts.push(tile.owner === 'player' ? 'Wilayah pemain' : 'Wilayah sistem');
      tip.innerHTML = `
        <div class="tooltip__title">${this.swatch(tile)}${this.biomeName(tile.biome)}</div>
        <div class="tooltip__meta">${parts.length ? parts.join(' / ') : 'Belum dihuni'}</div>`;
    }
    const w = tip.offsetWidth || 220;
    const h = tip.offsetHeight || 60;
    tip.style.transform = `translate(${Math.min(window.innerWidth - w - 10, x + 16)}px, ${Math.min(
      window.innerHeight - h - 10,
      y + 16
    )}px)`;
    tip.classList.add('visible');
  }

  flashStatus(message) {
    let toast = document.getElementById('toastNotice');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toastNotice';
      toast.className = 'toast';
      toast.setAttribute('role', 'status');
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
  }
}
