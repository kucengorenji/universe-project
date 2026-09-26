// Planet archetypes shared by every mode: the map generator reads `gen`, the
// globe renderer and the space-mode texture baker read `look`. Terran keeps
// the renderer's built-in palette (look: null) so the home world is unchanged.

// Cartoon (Civ VI-like) terrain palette of the terran home world, keyed by biome code
export const TERRAN_PALETTE = {
  ocean_deep: 0x1c4f9c,
  ocean: 0x2479c9,
  coast: 0x3fc2d6,
  beach: 0xefd690,
  plains: 0x93c24c,
  forest: 0x62993a,
  desert: 0xe8bf5f,
  mountain: 0x8f8a5a,
  tundra: 0xeaf2f7
};

export const PLANET_TYPES = {
  terran: {
    label: 'Terran',
    desc: 'Benua hijau dan laut biru, dihuni dua peradaban.',
    landable: true,
    inhabited: true,
    gen: {},
    look: null
  },
  ocean: {
    label: 'Samudra',
    desc: 'Kepulauan tropis di tengah laut luas. Kota pelabuhan di tiap pulau.',
    landable: true,
    inhabited: true,
    gen: { seaLevel: 0.16, mountainThreshold: 0.42, forestMoisture: 0.0 },
    look: {
      palette: { ocean_deep: 0x124f93, ocean: 0x1b83c9, coast: 0x38d2d2, beach: 0xf3e0a2, plains: 0x86c653, forest: 0x3f9d47, desert: 0xe6cf85, mountain: 0x7f8b60, tundra: 0xeaf2f7 },
      col: { shallows: 0x6fe6dc },
      clouds: { count: 110 }
    }
  },
  desert: {
    label: 'Gurun',
    desc: 'Lautan pasir, mesa merah dan oasis langka. Koloni tangguh bertahan di sini.',
    landable: true,
    inhabited: true,
    gen: { seaLevel: -0.42, ridgeFloor: 0.12, moistureShift: -0.25, desertMoisture: 0.12, desertLat: 0.78, forestMoisture: 0.3, tundraLat: 0.93 },
    look: {
      palette: { ocean_deep: 0x1d5f7a, ocean: 0x2b8aa0, coast: 0x5fc9c0, beach: 0xe9cf8a, plains: 0xd6b56e, forest: 0x8f9c4c, desert: 0xe9b95c, mountain: 0xa9744a, tundra: 0xf0e6d6 },
      col: { sand: 0xf0d59a, wetSand: 0xd6b778, foothill: 0xc09058, verge: 0xc9ab66 },
      mountain: { foothill: 0xc99c60, rock: 0xb77b4b, rockDark: 0x8b5a3a, cliff: 0x6e4630, snow: 0xe2bf86 },
      skirt: [0xb07a48, 0x87572f],
      atmosphere: [0xffd9a0, 0xe8a060],
      haze: 0xffd9a8,
      clouds: { count: 18 },
      sky: 0xe6cfa6,
      flora: 'dry'
    }
  },
  ice: {
    label: 'Es',
    desc: 'Dunia beku dengan laut gelap dan hutan bersalju. Belum dihuni.',
    landable: true,
    inhabited: false,
    gen: { seaLevel: -0.08, tundraLat: 0.32, forestMoisture: 0.05, mountainThreshold: 0.34, rivers: false },
    look: {
      palette: { ocean_deep: 0x14335a, ocean: 0x295b8c, coast: 0x78b4d4, beach: 0xd3e0e8, plains: 0xc6d7e4, forest: 0x5b7e7b, desert: 0xdfe8ef, mountain: 0x8a9bb0, tundra: 0xf1f6fa },
      col: { sand: 0xdce7ee, wetSand: 0xb9cbd8, iceShore: 0xe8f1f6, shallows: 0x9fd6e6, foothill: 0xa7b8c8, verge: 0xc4d4e0 },
      mountain: { foothill: 0xaebfcf, rock: 0x8d9db3, rockDark: 0x66758c, cliff: 0x55607a, snow: 0xffffff },
      skirt: [0x8fa3b8, 0x5f7088],
      atmosphere: [0xcfe8ff, 0x8fb8f0],
      haze: 0xd8ecff,
      clouds: { count: 80 },
      sky: 0xcfe3f2,
      flora: 'snow',
      floes: 0.1
    }
  },
  lava: {
    label: 'Vulkanik',
    desc: 'Kerak basal retak di atas lautan lava. Terlalu panas untuk koloni.',
    landable: true,
    inhabited: false,
    gen: { seaLevel: -0.02, forestMoisture: 9, desertMoisture: 0.05, desertLat: 1, tundraLat: 2, mountainThreshold: 0.3, rivers: false },
    look: {
      palette: { ocean_deep: 0xff8f24, ocean: 0xe8521a, coast: 0x9c2c16, beach: 0x2c2327, plains: 0x3d3539, forest: 0x3d3539, desert: 0x564843, mountain: 0x4a3c3c, tundra: 0x6b6166 },
      col: { sand: 0x2e2529, wetSand: 0x241c1f, iceShore: 0x2e2529, quay: 0x2e2529, shallows: 0x6a2616, foothill: 0x4d4145, verge: 0x453b3f },
      mountain: { foothill: 0x4a3f42, rock: 0x3f3538, rockDark: 0x2b2426, cliff: 0x1f1a1b, snow: 0xff8a3d },
      skirt: [0x3a2c2a, 0x221816],
      core: 0x5a1405,
      water: { unlit: true },
      grid: [0x140f10, 0x5a1405],
      atmosphere: [0xffa070, 0xd8441c],
      haze: 0xff8a50,
      clouds: { count: 45, color: 0x5d5458 },
      sky: 0x5a3028,
      dune: 0x3a3033,
      foam: 0xffc15a,
      flora: 'none'
    }
  },
  barren: {
    label: 'Tandus',
    desc: 'Batu abu-abu tanpa udara, penuh kawah. Cocok untuk tambang.',
    landable: true,
    inhabited: false,
    gen: { seaLevel: -9, ridgeFloor: 0.02, forestMoisture: 9, desertMoisture: 0.0, desertLat: 1, tundraLat: 0.9, mountainThreshold: 0.33, rivers: false },
    look: {
      palette: { ocean_deep: 0x4a4744, ocean: 0x55504c, coast: 0x6a6560, beach: 0xa39d95, plains: 0x9c978f, forest: 0x8a857f, desert: 0xb6afa5, mountain: 0x77726d, tundra: 0xe4e2de },
      col: { foothill: 0x8f8a84, verge: 0x96918a },
      mountain: { foothill: 0x8f8a84, rock: 0x7c7771, rockDark: 0x5e5a56, cliff: 0x4a4643, snow: 0xe8e6e3 },
      skirt: [0x6d6863, 0x4f4b48],
      atmosphere: null,
      clouds: null,
      sky: 0x15161b,
      dune: 0xa8a198,
      flora: 'none'
    }
  },
  gas: {
    label: 'Raksasa gas',
    desc: 'Badai abadi berlapis awan. Tidak ada permukaan untuk mendarat.',
    landable: false,
    inhabited: false,
    gen: null,
    look: null
  }
};

export const typeOf = (key) => PLANET_TYPES[key] || PLANET_TYPES.terran;
