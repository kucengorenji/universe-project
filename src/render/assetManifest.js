// Every file the game fetches at runtime, in one place. docs/ASSETS.md says what
// each one contains, which script builds it and who loads it; tests/asset-manifest.test.js
// checks that every entry exists under public/.
const env = import.meta.env || {}; // undefined under node --test
const base = env.BASE_URL || '/';

export const ASSET_FILES = {
  planetPack: 'models/assets.glb', // hex-scale props, LOD1 + LOD2
  planetPackLod0: 'models/assets_lod0.glb', // same props, LOD0, streamed later
  townPack: 'models/town.glb', // metre-scale buildings, vehicle kit, rocks
  sceneryPack: 'models/scenery.glb', // textured trees, understory, garden props, docks
  environmentPack: 'models/environment.glb', // B1 environment kit: oak/pine, shrubs, boulders, grass tufts, fence
  furniturePack: 'models/furniture.glb', // interior furniture and loose items
  homePack: 'models/home_cozy.glb', // cozy home editor: textured household kit, LOD0/1/2
  spacePack: 'models/space.glb', // ships and the planet rover
  soldierPack: 'models/soldier_v5_m.glb', // skirmish soldiers: VRoid anime body in a VC1 uniform, hair styles, helmets, class kit, animation clips
  soldierAtlas: 'textures/soldier_v5_m_cloth.png', // skirmish soldiers' cloth atlas (shade, trim piping, pencil ink)
  soldierHead: 'textures/soldier_v5_m_head.png', // skirmish soldiers' head atlas (VRoid face, eyes, hair)
  soldierPackF: 'models/soldier_v5_f.glb', // skirmish soldiers, the women's body (same pieces and clips)
  soldierAtlasF: 'textures/soldier_v5_f_cloth.png', // the women's cloth atlas
  soldierHeadF: 'textures/soldier_v5_f_head.png', // the women's head atlas
  townWalk: 'models/town_walk_m.glb', // UAL Walk_Loop retargeted to the unchanged skirmish rig
  townWalkF: 'models/town_walk_f.glb', // same authored walk, fitted to the women's rig
  soldierAtlasLow: 'textures/soldier_v5_m_cloth_1024.png', // Low tier: the same cloth atlas at 1024 (tools/assets/derive_lowres.mjs)
  soldierHeadLow: 'textures/soldier_v5_m_head_1024.png', // Low tier: the same face atlas at 1024
  soldierAtlasFLow: 'textures/soldier_v5_f_cloth_1024.png', // Low tier, the women's body
  soldierHeadFLow: 'textures/soldier_v5_f_head_1024.png',
  envSurfacesTown: 'textures/skirmish_surfaces_256.png', // the town's painted tiles, already at the 256 it shrinks them to (derived, pixel-identical)
  soldierPortraits: 'textures/soldier_portraits.png', // the nine heroes' painted portraits, 3 x 3 in roster order
  envPack: 'models/skirmish_env.glb', // skirmish environment kit: village houses, trees, hedges, cover (surface ids + baked occlusion)
  envSurfaces: 'textures/skirmish_surfaces.png', // skirmish painted surface tiles, 512² each, stacked (texture array)
  militaryPack: 'models/military.glb', // skirmish kit: weapons, fortifications, camp props, tank, windmill
  townSurfaces: 'textures/town_surfaces.png', // neutral modulation atlas for buildings and ground
  valleyKit: 'models/valley_kit.glb', // farm.html kit: oak, bush, player house, fence, rocks (vertex colour + baked AO)
  valleyActors: 'models/valley_actors.glb', // farm.html semi-chibi actors on the townsfolk rig (player, seller, child, elder)
  valleyAnimals: 'models/valley_animals.glb' // farm.html chibi chicken, cow and dog (pivot bones, rigid parts)
};

export const ASSETS = Object.fromEntries(Object.entries(ASSET_FILES).map(([key, path]) => [key, `${base}${path}`]));
