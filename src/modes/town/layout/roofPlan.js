import { mulberry32 } from '../../../math/random.js';
import { seedFor } from '../../../world/identity.js';
import { ROOF_PALETTES, ROOF_WEIGHTS, ROOF_CLASS } from '../../../art/palette.js';

// Roof colour is part of the town's appearance data (b.roof, sRGB hex), decided
// once from the seed so the 3D town and the 2D plan paint the same roofs. Its
// own random stream: adding it never moves a house, tree or door.

const DISTRICT_M = 140;

export function planRoofs(L) {
  const pal = ROOF_PALETTES[L.planetType] || ROOF_PALETTES.terran;
  const rng = mulberry32(seedFor(L.seed, 'roofs-v1'));
  // Each district leans a little towards one family, so neighbours match
  const lean = (x, z) => {
    const h = seedFor(L.seed, 'roof-district', Math.floor(x / DISTRICT_M), Math.floor(z / DISTRICT_M));
    return ((h % 1000) / 1000 - 0.5) * 0.3;
  };
  const pick = list => list[Math.floor(rng() * list.length) % list.length];
  for (const list of [L.buildings, L.props]) {
    for (const b of list) {
      const kind = ROOF_CLASS[b.asset];
      if (!kind) continue;
      if (kind === 'fort') {
        b.roof = pal.fort;
        continue;
      }
      const roll = rng();
      const main = ROOF_WEIGHTS.main + lean(b.x, b.z);
      b.roof = roll < main ? pick(pal.main) : roll < main + ROOF_WEIGHTS.second ? pick(pal.second) : pick(pal.third);
    }
  }
}
