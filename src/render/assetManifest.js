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
  npcPack: 'models/npc.glb', // NPC v1 faceted townsfolk (rigid parts, posed in code)
  characterPack: 'models/character.glb', // shared rig, outfits, clips
  furniturePack: 'models/furniture.glb', // interior furniture and loose items
  homePack: 'models/home_cozy.glb', // cozy home editor: textured household kit, LOD0/1/2
  spacePack: 'models/space.glb', // ships and the planet rover
  soldierPack: 'models/soldier_v5_m.glb', // skirmish soldiers: VRoid anime body in a VC1 uniform, hair styles, helmets, class kit, animation clips
  soldierAtlas: 'textures/soldier_v5_m_cloth.png', // skirmish soldiers' cloth atlas (shade, trim piping, pencil ink)
  soldierHead: 'textures/soldier_v5_m_head.png', // skirmish soldiers' head atlas (VRoid face, eyes, hair)
  soldierPackF: 'models/soldier_v5_f.glb', // skirmish soldiers, the women's body (same pieces and clips)
  soldierAtlasF: 'textures/soldier_v5_f_cloth.png', // the women's cloth atlas
  soldierHeadF: 'textures/soldier_v5_f_head.png', // the women's head atlas
  soldierPortraits: 'textures/soldier_portraits.png', // the nine heroes' painted portraits, 3 x 3 in roster order
  envPack: 'models/skirmish_env.glb', // skirmish environment kit: village houses, trees, hedges, cover (surface ids + baked occlusion)
  envSurfaces: 'textures/skirmish_surfaces.png', // skirmish painted surface tiles, 512² each, stacked (texture array)
  militaryPack: 'models/military.glb', // skirmish kit: weapons, fortifications, camp props, tank, windmill
  interiorAtlas: 'textures/interior_atlas.jpg', // floor and wall tiles
  townSurfaces: 'textures/town_surfaces.png' // neutral modulation atlas for buildings and ground
};

export const ASSETS = Object.fromEntries(Object.entries(ASSET_FILES).map(([key, path]) => [key, `${base}${path}`]));
