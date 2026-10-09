// Shared colour tokens for the "painted diorama" look (docs/ART_DIRECTION.md).
// New town colours belong here, not as hex literals inside render modules.
// Values are sRGB hex strings so the same table feeds three.js and canvas 2D.

/**
 * Roof families per planet type. A town takes one dominant family, a secondary
 * one and a little of a third, so a district reads as one place instead of
 * confetti. Fortifications share one sober tone; landmarks keep their authored
 * accent roofs (they are the only blue/bright roofs in town).
 */
export const ROOF_PALETTES = {
  terran: {
    main: ['#a45a43', '#9a5440', '#ad6448', '#8f4f3d'], // terracotta, earthy rather than signal red
    second: ['#8a5b3f', '#7d523a'], // weathered brown tile
    third: ['#5f6671', '#687079'], // slate
    fort: '#5a616c'
  },
  ocean: {
    main: ['#b8603f', '#ad5638', '#c06d48'],
    second: ['#8e6045'],
    third: ['#4f6f7a', '#5a7b84'], // sea-green slate
    fort: '#56646c'
  },
  desert: {
    main: ['#c68a52', '#bb7c47', '#cf9860'], // ochre clay
    second: ['#a8603f'],
    third: ['#d9ccad'], // lime-washed
    fort: '#9c7a57'
  },
  ice: {
    main: ['#4f5864', '#58616d', '#474f5a'], // dark slate sheds snow
    second: ['#6b4f42'],
    third: ['#7a3f36'],
    fort: '#4a515b'
  }
};

/** Share of main / second / third roofs; varies smoothly per district. */
export const ROOF_WEIGHTS = { main: 0.7, second: 0.22 };

/** Which roofs follow the town palette. Anything else keeps its authored colour. */
export const ROOF_CLASS = {
  f_house_small: 'home', f_house: 'home', f_house_tall: 'home', f_townhouse: 'home',
  f_shop: 'home', f_tavern: 'home', f_well: 'home',
  f_wall_tower: 'fort', f_gate: 'fort'
};

/**
 * Room shells in the chunky kitchen-diorama look (the same ROOM palette the
 * furniture pack is built from, tools/blender/chunky/palette.py). Each room
 * kind lists schemes; a room picks one by seed. floor: tiles (checker with a
 * few accent tiles), planks or carpet; a..c are its tones.
 */
export const ROOM_SCHEMES = {
  house: [
    { wall: '#f4dfb4', wainscot: '#2ea98a', trim: '#f2b766', floor: { type: 'tiles', a: '#e0865b', b: '#eea271', c: '#f6ddb8' } },
    { wall: '#f6e3bc', wainscot: '#2f6690', trim: '#f2b766', floor: { type: 'planks', a: '#db9a55', b: '#cf8a48', c: '#e6ac68' } },
    { wall: '#bfe0cf', wainscot: '#2ea98a', trim: '#f6e3bc', floor: { type: 'planks', a: '#e3a764', b: '#d59650', c: '#eeb877' } }
  ],
  cottage: [
    { wall: '#f4dfb4', wainscot: '#8a5533', trim: '#f2b766', floor: { type: 'planks', a: '#c98647', b: '#b8773d', c: '#d8975a' } },
    { wall: '#f6e3bc', wainscot: '#2ea98a', trim: '#f2b766', floor: { type: 'tiles', a: '#e0865b', b: '#eea271', c: '#f6ddb8' } }
  ],
  tavern: [
    { wall: '#ecc896', wainscot: '#8a5533', trim: '#d9923f', floor: { type: 'planks', a: '#b8773d', b: '#a86a3a', c: '#c98647' } },
    { wall: '#f4dfb4', wainscot: '#d8352f', trim: '#f2b766', floor: { type: 'planks', a: '#b8773d', b: '#a86a3a', c: '#c98647' } }
  ],
  shop: [
    { wall: '#f6e3bc', wainscot: '#2f6690', trim: '#f2b766', floor: { type: 'tiles', a: '#f3ece0', b: '#4283b4', c: '#f6d65b' } },
    { wall: '#f4dfb4', wainscot: '#d8352f', trim: '#f6e3bc', floor: { type: 'tiles', a: '#e0865b', b: '#f6ddb8', c: '#cc6f4b' } }
  ],
  apartment: [
    { wall: '#cfe6f2', wainscot: '#4283b4', trim: '#f6e3bc', floor: { type: 'planks', a: '#e3a764', b: '#d59650', c: '#eeb877' } },
    { wall: '#f4dfb4', wainscot: '#2ea98a', trim: '#f2b766', floor: { type: 'tiles', a: '#e0865b', b: '#eea271', c: '#f6ddb8' } }
  ],
  office: [
    { wall: '#ece6d8', wainscot: '#4283b4', trim: '#f6e3bc', floor: { type: 'carpet', a: '#6d8fb3', b: '#62839f', c: '#7a9cc0' } }
  ]
};

/** Backdrop behind the cut-away room, and the plinth the room stands on. */
export const ROOM_STAGE = { day: '#7c7f8c', night: '#1b2130', plinth: '#8a5533', plinthTop: '#f2b766' };

/** Cozy outdoor paths: RGB mask channels select earth, stone and terracotta. */
export const PATH_PALETTE = {
  earth: { fill: '#dfbd83', edge: '#c7a56c', mask: '#f00' },
  stone: { fill: '#d9d2b9', edge: '#bbb59c', mask: '#0f0' },
  brick: { fill: '#dca68a', edge: '#c68d73', mask: '#00f' },
  border: '#e9dcc0',
  verge: '#b7bd84',
  bridge: { deck: '#c8b99a', walk: '#ede0c4', side: '#ddcfb0', beam: '#b3a388', pier: '#bbab8e', rail: '#a79a7e' }
};

export function streetPathStyle(kind) {
  if (kind === 'road' || kind === 'lane') return PATH_PALETTE.earth;
  if (kind === 'residential' || kind === 'ring') return PATH_PALETTE.brick;
  return PATH_PALETTE.stone;
}

/** Tokens for the 2D town plan (Watabou-style map) and future 3D migrations. */
export const MAP_COLORS = {
  meadow: '#a9c48b',
  meadowLight: '#b9d09a',
  meadowDark: '#8fae74',
  contour: 'rgba(52, 78, 44, 0.22)',
  sand: '#e2d3a8',
  waterShallow: '#86c1c6',
  waterDeep: '#4a8aa0',
  waterLine: 'rgba(235, 248, 250, 0.75)',
  road: '#e8dcbc',
  roadEdge: '#6f6452',
  path: '#d9cda9',
  plaza: '#ddd0ad',
  field: '#9d8577',
  fieldLine: '#5e4a40',
  fieldGreen: '#a4ae7a',
  treeDark: '#2f5a44',
  tree: '#4f7f5c',
  treeLight: '#6f9c72',
  outline: '#1f2a24',
  shadow: 'rgba(20, 30, 24, 0.28)',
  wall: '#8e8a80',
  dock: '#9a7a55',
  wallsModern: '#c9c4ba',
  glass: '#6d96a6',
  asphalt: '#6c6e72',
  label: '#1c2320'
};
