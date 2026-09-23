import { BIOMES, STORAGE_KEY } from '../map/mapGenerator.js';
import { BIOME_PALETTE } from '../render/planetRenderer.js';

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

const OWNER_NAMES = { player: 'New Babylon (pemain)', system: 'Aegis Citadel (sistem)' };
const TILE_COUNTS = { 2: '162', 3: '642', 4: '2.562', 5: '10.242' };

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

export class MenuController {
  constructor({ onRegenerate, onResetCamera, onToggleAutoRotate, mapData, renderer }) {
    this.onRegenerate = onRegenerate;
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
      inspectedTileInfo: $('inspectedTileInfo')
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
    this.renderer.onTileSelect = (tile) => this.handleTileSelect(tile);
    this.renderer.onAssetsStatus = (state) => this.setAssetStatus(state);
    if (this.renderer.assetsState) this.setAssetStatus(this.renderer.assetsState);

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) this.closeSidebar();
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

    if (mapData.subdivision) {
      el.subdivisionSlider.value = mapData.subdivision;
      el.subdivisionValue.textContent = TILE_COUNTS[mapData.subdivision] || mapData.subdivision;
    }
    el.inspectedTileInfo.innerHTML =
      '<p class="panel__note">Klik satu tile di globe untuk melihat bioma, pemilik, dan kotanya di sini.</p>';
  }

  getCity(tile) {
    if (tile.cityIndex === null || tile.cityIndex === undefined) return null;
    return this.mapData?.cities?.[tile.cityIndex] || null;
  }

  swatch(tile) {
    return `<span class="swatch" style="background:${hex(BIOME_PALETTE[tile.biome] ?? 0x888888)}"></span>`;
  }

  handleTileHover(tile, x, y) {
    const tip = this.el.tileTooltip;
    if (!tile) {
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
        <div class="tooltip__title">${this.swatch(tile)}${BIOME_NAMES[tile.biome] || 'Daratan'}</div>
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

  handleTileSelect(tile) {
    if (!tile) return;
    const city = this.getCity(tile);
    const farm = tile.farmIndex !== null && tile.farmIndex !== undefined ? this.mapData?.farms?.[tile.farmIndex] : null;
    const owner = tile.owner
      ? `<span class="owner-dot owner-dot--${tile.owner}"></span>${OWNER_NAMES[tile.owner]}`
      : 'Belum diklaim';
    const rows = [
      ['Pemilik', owner],
      ['Kota', city ? `${escapeHtml(city.name)} (${city.size} tile${city.isPort ? ', pelabuhan' : ''})` : 'Tidak ada'],
      ['Ladang', farm ? `${farm.crop === 'wheat' ? 'Gandum' : 'Sayur'}, ${farm.tiles.length} tile` : 'Tidak ada'],
      ['Jalan', tile.road ? 'Dilewati jalan darat' : 'Tidak ada'],
      ['Sungai', tile.hasRiver ? 'Ada' : 'Tidak ada'],
      ['Elevasi', (tile.elevation * 100).toFixed(1)],
      ['ID tile', `${tile.id}`]
    ];
    this.el.inspectedTileInfo.innerHTML = `
      <div class="inspect-title">${this.swatch(tile)}${BIOME_NAMES[tile.biome] || 'Daratan'}</div>
      <dl class="facts">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
    if (!this.isOpen) this.openSidebar();
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
