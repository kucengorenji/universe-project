const LEVELS = Object.freeze([
  { lod: 1, shadow: 1, vegetation: 1 },
  { lod: 0.72, shadow: 1, vegetation: 1 },
  { lod: 0.6, shadow: 0.65, vegetation: 1 },
  { lod: 0.55, shadow: 0.5, vegetation: 0.65 },
  { lod: 0.45, shadow: 0.4, vegetation: 0.35 }
].map(Object.freeze));

/** Runtime budgets are reversible; layout, collisions and simulation never change. */
export class TownDetailBudget {
  constructor() { this.reset(); }

  reset() { this.level = 0; this.healthy = 0; }

  get current() { return LEVELS[this.level]; }

  sample({ heavy, fps, gpuMs, resolutionFull = true }) {
    if (heavy) {
      // Keep the current quality when the measured cadence already meets the
      // target. A GPU budget signal alone must not keep lowering a smooth town.
      if (fps >= 58) { this.healthy = 0; return true; }
      this.healthy = 0;
      if (this.level === LEVELS.length - 1) return false;
      this.level++;
      return true;
    }
    // Resolution recovers first. Two clean measurement windows prevent oscillation.
    const headroom = gpuMs !== null ? gpuMs < 10.5 : fps > 58;
    if (!resolutionFull || !headroom || this.level === 0) { this.healthy = 0; return false; }
    if (++this.healthy < 2) return false;
    this.level--;
    this.healthy = 0;
    return true;
  }
}
