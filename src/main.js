import './style.css';
import { generateHexasphere } from './math/hexasphere.js';
import { MapGenerator } from './map/mapGenerator.js';
import { PlanetRenderer } from './render/planetRenderer.js';
import { MenuController } from './ui/menuController.js';

class App {
  constructor() {
    this.container = document.getElementById('canvas-container');
    this.subdivision = 5; // 10,242 tiles (10,230 hexagons + 12 pentagons)
    this.planetRadius = 10;

    this.hexasphere = null;
    this.mapGenerator = null;
    this.renderer = null;
    this.menuController = null;
    this.currentMapData = null;

    this.init();
  }

  init() {
    // 1. Generate Hexasphere Topology (Goldberg Polyhedron)
    console.log(`Generating Geodesic Hexasphere (subdivision: ${this.subdivision})...`);
    this.hexasphere = generateHexasphere(this.subdivision, this.planetRadius);
    console.log(`Topology created: ${this.hexasphere.tiles.length} tiles.`);

    // 2. Initialize Map Generator
    this.mapGenerator = new MapGenerator(this.hexasphere);

    // 3. Check LocalStorage for existing map data
    const savedMap = this.mapGenerator.loadFromStorage();
    if (savedMap) {
      if (savedMap.subdivision && savedMap.subdivision !== this.subdivision) {
        this.subdivision = savedMap.subdivision;
        this.hexasphere = generateHexasphere(this.subdivision, this.planetRadius);
        this.mapGenerator.hexasphere = this.hexasphere;
        this.mapGenerator.tiles = this.hexasphere.tiles;
        this.mapGenerator.tileMap = this.hexasphere.tileMap;
      }
      console.log(`Loaded existing procedural map from LocalStorage (seed: ${savedMap.seed})`);
      this.currentMapData = savedMap;
      this.mapGenerator.applyMapData(savedMap);
    } else {
      console.log('No saved map found in LocalStorage. Generating initial world...');
      this.currentMapData = this.mapGenerator.generate();
      this.mapGenerator.saveToStorage(this.currentMapData);
      console.log(`Initial map generated & saved to LocalStorage (seed: ${this.currentMapData.seed})`);
    }

    // 4. Initialize Three.js WebGL Planet Renderer
    this.renderer = new PlanetRenderer(this.container, this.hexasphere);
    this.renderer.buildPlanet(this.currentMapData);

    // 5. Initialize UI Menu Controller
    this.menuController = new MenuController({
      onRegenerate: (seed, options) => this.handleRegenerate(seed, options),
      onResetCamera: () => this.renderer.resetCamera(),
      onToggleAutoRotate: (active) => {
        this.renderer.autoRotate = active;
      },
      mapData: this.currentMapData,
      renderer: this.renderer
    });

    console.log('Planet Globe initialized successfully!');
  }

  handleRegenerate(seed = null, options = {}) {
    console.log('Regenerating procedural planet map with options:', { seed, options });

    const targetSubdivision = options.subdivision !== undefined ? parseInt(options.subdivision, 10) : this.subdivision;
    if (targetSubdivision !== this.subdivision) {
      console.log(`Rebuilding hexasphere topology: level ${this.subdivision} -> ${targetSubdivision}...`);
      this.subdivision = targetSubdivision;
      this.hexasphere = generateHexasphere(this.subdivision, this.planetRadius);
      this.mapGenerator.hexasphere = this.hexasphere;
      this.mapGenerator.tiles = this.hexasphere.tiles;
      this.mapGenerator.tileMap = this.hexasphere.tileMap;
      this.renderer.hexasphere = this.hexasphere;
    }

    // Generate new procedural map
    const newMapData = this.mapGenerator.generate(seed, options);
    this.currentMapData = newMapData;

    // Save to LocalStorage so it persists across page reloads
    this.mapGenerator.saveToStorage(newMapData);

    // Rebuild 3D visual planet
    this.renderer.buildPlanet(newMapData);

    // Update UI panels & badges
    this.menuController.updateUI(newMapData);
  }
}

// Start application when DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  if (import.meta.env.DEV) window.__globe = app; // dev-only handle for debugging in the console
});
