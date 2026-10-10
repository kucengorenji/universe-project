// Field grid (docs/FARM_PLAN.md §5.1): square cells over a layout field, each tilled or not, wet
// (1 fresh .. 0 dry) and holding a crop stage (0 none, 1 sprout, 2 leafy, 3 ripe). No economy and
// no growth over days: the actions only change what the ground looks like. Pure, DOM-free.

export const CELL = 0.75; // metres
export const DRY_SECONDS = 120; // a watered cell dries back over two minutes

export class FieldState {
  constructor(field, { cell = CELL, planted = [] } = {}) {
    this.cell = cell;
    this.cols = Math.floor(field.w / cell);
    this.rows = Math.floor(field.d / cell);
    this.x0 = field.x - (this.cols * cell) / 2;
    this.z0 = field.z - (this.rows * cell) / 2;
    const n = this.cols * this.rows;
    this.tilled = new Uint8Array(n);
    this.wet = new Float32Array(n);
    this.crop = new Uint8Array(n);
    this.version = 0;
    planted.forEach((row, r) => row.forEach((stage, c) => {
      if (stage && r < this.rows && c < this.cols) {
        this.tilled[r * this.cols + c] = 1;
        this.crop[r * this.cols + c] = stage;
      }
    }));
  }

  /** The cell under a point, or null off the field. */
  cellAt(x, z) {
    const c = Math.floor((x - this.x0) / this.cell), r = Math.floor((z - this.z0) / this.cell);
    return c >= 0 && r >= 0 && c < this.cols && r < this.rows ? { c, r, i: r * this.cols + c } : null;
  }

  center(c, r) {
    return [this.x0 + (c + 0.5) * this.cell, this.z0 + (r + 0.5) * this.cell];
  }

  /** Hoe: breaks the soil of an empty cell. False if a crop is in the way. */
  till(i) {
    if (this.crop[i]) return false;
    this.tilled[i] = 1;
    this.version++;
    return true;
  }

  /** Any field cell takes water; tilled soil shows it best. */
  water(i) {
    this.wet[i] = 1;
    this.version++;
    return true;
  }

  /** Seeds go into tilled, empty cells only. */
  plant(i) {
    if (!this.tilled[i] || this.crop[i]) return false;
    this.crop[i] = 1;
    this.version++;
    return true;
  }

  /** Pull a ripe crop; the soil stays tilled for the next one. */
  harvest(i) {
    if (this.crop[i] !== 3) return false;
    this.crop[i] = 0;
    this.version++;
    return true;
  }

  /** Dry the wet cells; returns true while anything is still drying. */
  update(dt) {
    let drying = false;
    for (let i = 0; i < this.wet.length; i++) {
      if (this.wet[i] <= 0) continue;
      this.wet[i] = Math.max(0, this.wet[i] - dt / DRY_SECONDS);
      drying = true;
    }
    return drying;
  }
}
