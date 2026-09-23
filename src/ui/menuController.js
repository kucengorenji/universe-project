import { BIOMES, STORAGE_KEY } from '../map/mapGenerator.js';

export class MenuController {
  constructor({
    onRegenerate,
    onResetCamera,
    onToggleAutoRotate,
    mapData,
    renderer
  }) {
    this.onRegenerate = onRegenerate;
    this.onResetCamera = onResetCamera;
    this.onToggleAutoRotate = onToggleAutoRotate;
    this.mapData = mapData;
    this.renderer = renderer;

    this.isOpen = false;
    this.autoRotateActive = false;

    this.elements = {
      menuToggleBtn: document.getElementById('menuToggleBtn'),
      sidebar: document.getElementById('sidebarDrawer'),
      closeBtn: document.getElementById('closeSidebarBtn'),
      regenerateBtn: document.getElementById('regenerateBtn'),
      randomSeedBtn: document.getElementById('randomSeedBtn'),
      seedInput: document.getElementById('seedInput'),
      seaLevelSlider: document.getElementById('seaLevelSlider'),
      seaLevelValue: document.getElementById('seaLevelValue'),
      mountainSlider: document.getElementById('mountainSlider'),
      mountainValue: document.getElementById('mountainValue'),
      subdivisionSlider: document.getElementById('subdivisionSlider'),
      subdivisionValue: document.getElementById('subdivisionValue'),
      autoRotateToggle: document.getElementById('autoRotateToggle'),
      airRouteToggle: document.getElementById('airRouteToggle'),
      groundRouteToggle: document.getElementById('groundRouteToggle'),
      resetCameraBtn: document.getElementById('resetCameraBtn'),
      clearStorageBtn: document.getElementById('clearStorageBtn'),
      // Stats elements
      seedBadge: document.getElementById('seedBadge'),
      playerTilesBadge: document.getElementById('playerTilesBadge'),
      systemTilesBadge: document.getElementById('systemTilesBadge'),
      storageStatusBadge: document.getElementById('storageStatusBadge'),
      // Tile tooltip & detail
      tileTooltip: document.getElementById('tileTooltip'),
      inspectedTileInfo: document.getElementById('inspectedTileInfo')
    };

    this.bindEvents();
    this.updateUI(mapData);
  }

  bindEvents() {
    // Menu toggle
    this.elements.menuToggleBtn?.addEventListener('click', () => this.toggleSidebar());
    this.elements.closeBtn?.addEventListener('click', () => this.closeSidebar());

    this.seedManuallyEdited = false;
    this.elements.seedInput?.addEventListener('input', () => {
      this.seedManuallyEdited = true;
    });

    // Regenerate Map
    this.elements.regenerateBtn?.addEventListener('click', () => {
      let seed = null;
      if (this.seedManuallyEdited && this.elements.seedInput?.value.trim()) {
        seed = parseInt(this.elements.seedInput.value.trim(), 10);
      } else {
        seed = Math.floor(Math.random() * 900000 + 100000);
        if (this.elements.seedInput) {
          this.elements.seedInput.value = seed;
        }
      }

      const seaLevel = parseFloat(this.elements.seaLevelSlider?.value ?? -0.05);
      const mountainThreshold = parseFloat(this.elements.mountainSlider?.value ?? 0.38);
      const subdivision = parseInt(this.elements.subdivisionSlider?.value ?? 5, 10);

      const label = this.formatSubdivisionLabel(subdivision);
      this.flashStatus(`Generating ${label} world (Seed #${seed})...`);
      this.onRegenerate(seed, { seaLevel, mountainThreshold, subdivision });
    });

    // Randomize Seed
    this.elements.randomSeedBtn?.addEventListener('click', () => {
      const newSeed = Math.floor(Math.random() * 900000 + 100000);
      if (this.elements.seedInput) {
        this.elements.seedInput.value = newSeed;
      }
      this.seedManuallyEdited = true;
    });

    // Sliders
    this.elements.seaLevelSlider?.addEventListener('input', (e) => {
      if (this.elements.seaLevelValue) {
        const val = parseFloat(e.target.value);
        this.elements.seaLevelValue.textContent = `${Math.round((val + 0.5) * 100)}%`;
      }
    });

    this.elements.mountainSlider?.addEventListener('input', (e) => {
      if (this.elements.mountainValue) {
        const val = parseFloat(e.target.value);
        this.elements.mountainValue.textContent = `${Math.round((1.0 - val) * 100)}%`;
      }
    });

    this.elements.subdivisionSlider?.addEventListener('input', (e) => {
      if (this.elements.subdivisionValue) {
        const val = parseInt(e.target.value, 10);
        this.elements.subdivisionValue.textContent = this.formatSubdivisionLabel(val);
      }
    });

    // Auto Rotate
    this.elements.autoRotateToggle?.addEventListener('change', (e) => {
      this.autoRotateActive = e.target.checked;
      this.onToggleAutoRotate(this.autoRotateActive);
    });

    // Air Route Toggle
    this.elements.airRouteToggle?.addEventListener('change', (e) => {
      this.renderer.setAirRouteVisible(e.target.checked);
      this.flashStatus(`Jalur Udara: ${e.target.checked ? 'Ditampilkan' : 'Disembunyikan'}`);
    });

    // Ground Route Toggle
    this.elements.groundRouteToggle?.addEventListener('change', (e) => {
      this.renderer.setGroundRouteVisible(e.target.checked);
      this.flashStatus(`Jalur Darat: ${e.target.checked ? 'Ditampilkan' : 'Disembunyikan'}`);
    });

    // Reset Camera Framing
    this.elements.resetCameraBtn?.addEventListener('click', () => {
      this.onResetCamera();
      this.flashStatus('Camera reset to 75% horizontal frame');
    });

    // Clear Storage
    this.elements.clearStorageBtn?.addEventListener('click', () => {
      try {
        localStorage.removeItem(STORAGE_KEY);
        this.flashStatus('Local Storage cache cleared');
      } catch (err) {
        console.warn(err);
      }
    });

    // Wire renderer tile events
    this.renderer.onTileHover = (tile, screenX, screenY) => this.handleTileHover(tile, screenX, screenY);
    this.renderer.onTileSelect = (tile) => this.handleTileSelect(tile);

    // Close on Escape
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        this.closeSidebar();
      }
    });
  }

  toggleSidebar() {
    this.isOpen = !this.isOpen;
    if (this.isOpen) {
      this.elements.sidebar?.classList.add('open');
      this.elements.menuToggleBtn?.classList.add('active');
    } else {
      this.elements.sidebar?.classList.remove('open');
      this.elements.menuToggleBtn?.classList.remove('active');
    }
  }

  closeSidebar() {
    this.isOpen = false;
    this.elements.sidebar?.classList.remove('open');
    this.elements.menuToggleBtn?.classList.remove('active');
  }

  updateUI(mapData) {
    this.mapData = mapData;
    this.seedManuallyEdited = false;
    if (!mapData) return;

    if (this.elements.seedInput) {
      this.elements.seedInput.value = mapData.seed;
    }
    if (this.elements.seedBadge) {
      this.elements.seedBadge.textContent = `#${mapData.seed}`;
    }
    if (this.elements.playerTilesBadge) {
      this.elements.playerTilesBadge.textContent = `${mapData.player?.claimedTileCount || 9} Hex Tiles`;
    }
    if (this.elements.systemTilesBadge) {
      this.elements.systemTilesBadge.textContent = `${mapData.system?.claimedTileCount || 9} Hex Tiles`;
    }
    if (this.elements.storageStatusBadge) {
      this.elements.storageStatusBadge.textContent = 'Saved in LocalStorage';
    }
    if (mapData.subdivision && this.elements.subdivisionSlider) {
      this.elements.subdivisionSlider.value = mapData.subdivision;
      if (this.elements.subdivisionValue) {
        this.elements.subdivisionValue.textContent = this.formatSubdivisionLabel(mapData.subdivision);
      }
    }
  }

  formatSubdivisionLabel(level) {
    switch (level) {
      case 2:
        return '162 Tiles (Retro)';
      case 3:
        return '642 Tiles (Classic)';
      case 4:
        return '2.562 Tiles (High)';
      case 5:
        return '10.242 Tiles (Ultra)';
      default:
        return `${level} Level`;
    }
  }

  handleTileHover(tile, screenX, screenY) {
    const tooltip = this.elements.tileTooltip;
    if (!tooltip) return;

    if (!tile) {
      tooltip.classList.remove('visible');
      return;
    }

    const biomeName = this.formatBiomeName(tile.biome);
    const ownerBadge = tile.owner
      ? `<span class="tag tag-${tile.owner}">${tile.owner === 'player' ? '👤 Player Starter' : '🤖 System NPC'}</span>`
      : '<span class="tag tag-neutral">Unclaimed Wilds</span>';

    const capitalBadge = tile.isCapital
      ? `<span class="tag tag-capital">★ ${tile.capitalOf === 'player' ? 'New Babylon' : 'Aegis Citadel'} (Capital)</span>`
      : '';

    const riverBadge = tile.hasRiver ? '<span class="tag tag-river">💧 Fresh River</span>' : '';

    tooltip.innerHTML = `
      <div class="tooltip-header">
        <span class="tooltip-icon">${this.getBiomeIcon(tile.biome)}</span>
        <strong>${biomeName}</strong>
      </div>
      <div class="tooltip-tags">
        ${capitalBadge}
        ${ownerBadge}
        ${riverBadge}
      </div>
      <div class="tooltip-stats">
        <span>Elev: ${(tile.elevation * 100).toFixed(0)}m</span>
        <span>Moist: ${(tile.moisture * 100).toFixed(0)}%</span>
        <span>Tile ID: #${tile.id}</span>
      </div>
    `;

    // Position tooltip near cursor
    const x = Math.min(window.innerWidth - 220, Math.max(15, screenX + 16));
    const y = Math.min(window.innerHeight - 130, Math.max(15, screenY + 16));
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
    tooltip.classList.add('visible');
  }

  handleTileSelect(tile) {
    if (!tile || !this.elements.inspectedTileInfo) return;

    const biomeName = this.formatBiomeName(tile.biome);
    this.elements.inspectedTileInfo.innerHTML = `
      <div class="inspector-card">
        <div class="inspector-row">
          <span class="label">Tipe Tile:</span>
          <span class="value">${this.getBiomeIcon(tile.biome)} ${biomeName}</span>
        </div>
        <div class="inspector-row">
          <span class="label">Wilayah / Owner:</span>
          <span class="value">${
            tile.owner === 'player'
              ? '👑 Player Starter Area'
              : tile.owner === 'system'
              ? '🛡️ System NPC Territory'
              : '🌍 Netral / Wilderness'
          }</span>
        </div>
        <div class="inspector-row">
          <span class="label">Status Kota:</span>
          <span class="value">${tile.isCapital ? '★ Ibukota Utama' : 'Standard Hex'}</span>
        </div>
        <div class="inspector-row">
          <span class="label">Aliran Sungai:</span>
          <span class="value">${tile.hasRiver ? '💧 Ada sungai' : 'Tidak ada'}</span>
        </div>
        <div class="inspector-row">
          <span class="label">Elevasi / Lembah:</span>
          <span class="value">${(tile.elevation * 100).toFixed(1)} m</span>
        </div>
        <div class="inspector-row">
          <span class="label">Tetangga Hexagon:</span>
          <span class="value">${tile.neighbors.length} Hex</span>
        </div>
      </div>
    `;

    // Open sidebar if closed
    if (!this.isOpen) {
      this.toggleSidebar();
    }
  }

  formatBiomeName(biome) {
    switch (biome) {
      case BIOMES.OCEAN_DEEP:
        return 'Palung Samudra (Deep Ocean)';
      case BIOMES.OCEAN:
        return 'Lautan (Ocean)';
      case BIOMES.PLAINS:
        return 'Padang Rumput Datar (Plains)';
      case BIOMES.FOREST:
        return 'Hutan Pinus/Rimbun (Forest)';
      case BIOMES.MOUNTAIN:
        return 'Pegunungan Plum / Bersalju (Mountain)';
      case BIOMES.SAVANNAH:
        return 'Sabana Emas / Gurun (Savannah)';
      case BIOMES.TUNDRA:
        return 'Tundra / Gletser Es (Tundra)';
      case BIOMES.RIVER:
        return 'Lembah Sungai (River)';
      default:
        return 'Daratan';
    }
  }

  getBiomeIcon(biome) {
    switch (biome) {
      case BIOMES.OCEAN_DEEP:
        return '🌊';
      case BIOMES.OCEAN:
        return '🌊';
      case BIOMES.PLAINS:
        return '🌾';
      case BIOMES.FOREST:
        return '🌲';
      case BIOMES.MOUNTAIN:
        return '⛰️';
      case BIOMES.SAVANNAH:
        return '🏜️';
      case BIOMES.TUNDRA:
        return '❄️';
      case BIOMES.RIVER:
        return '💧';
      default:
        return '🌐';
    }
  }

  flashStatus(message) {
    let toast = document.getElementById('toastNotice');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toastNotice';
      toast.className = 'toast-notice';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 2800);
  }
}
