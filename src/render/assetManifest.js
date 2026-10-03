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
  spacePack: 'models/space.glb', // ships and the planet rover
  soldierPack: 'models/soldier_vc.glb', // skirmish soldiers: skinned anime-style figure, hair styles, helmets, class kit, animation clips
  militaryPack: 'models/military.glb', // skirmish kit: weapons, fortifications, camp props, tank, windmill
  interiorAtlas: 'textures/interior_atlas.jpg', // floor and wall tiles
  townSurfaces: 'textures/town_surfaces.png' // neutral modulation atlas for buildings and ground
};

export const ASSETS = Object.fromEntries(Object.entries(ASSET_FILES).map(([key, path]) => [key, `${base}${path}`]));
