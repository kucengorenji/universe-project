// What each soldier wears and carries: pure data, shared by the 3D soldiers (soldiers.js), the
// flat map and the preview sheet (tools/blender/skirmish/preview_soldiers.py mirrors KITS and
// FACTIONS). Colours are sRGB hex.

/** Class -> gear kept from soldier.glb (kit_<tag>_* meshes), the weapon asset and how it is held. */
export const CLASSES = {
  scout: { label: 'Scout', short: 'SC', kit: ['base', 'pouches', 'pack_small'], weapon: 'w_rifle', hold: 'rifle' },
  shocktrooper: { label: 'Shocktrooper', short: 'ST', kit: ['base', 'mags', 'plate', 'pack_small'], weapon: 'w_smg', hold: 'smg' },
  lancer: { label: 'Lancer', short: 'LN', kit: ['base', 'armor', 'tubes'], weapon: 'w_lance', hold: 'lance' },
  engineer: { label: 'Engineer', short: 'EN', kit: ['base', 'pouches', 'pack_engineer', 'tools'], weapon: 'w_rifle', hold: 'rifle' },
  sniper: { label: 'Sniper', short: 'SN', kit: ['base', 'pouches', 'goggles', 'pack_small'], weapon: 'w_sniper', hold: 'rifle' }
};

/** Faction -> helmet mesh and palette slots (chunkyPeople.js order: skin, hair, top, tie, legs, shoes, cap). */
export const FACTIONS = {
  fed: { label: 'Federasi', helmet: 'hat_fed_helmet', top: '#4f6f8f', scarf: '#c8a23a', legs: '#3d4f63', boots: '#4a3222', helmet_color: '#55705a', flag: '#3f6fb0', ink: '#2f4f7a' },
  imp: { label: 'Imperium', helmet: 'hat_imp_helmet', top: '#45474d', scarf: '#a8322d', legs: '#303236', boots: '#2e2620', helmet_color: '#4a4d52', flag: '#a8322d', ink: '#7a2420' }
};

const SKINS = ['#e0ac84', '#d99b73', '#c9875f', '#a86a45', '#f0c4a0'];
const HAIRS = ['#2e211b', '#4a3222', '#1c1a19', '#8a5a32', '#c9a065'];

/** Every tag a kit_<tag>_* mesh may carry, longest first so pack_small wins over pack. */
const TAGS = [...new Set(Object.values(CLASSES).flatMap((c) => c.kit))].sort((a, b) => b.length - a.length);

/** The kit tag of a mesh name (kit_pack_small_x -> pack_small), or null for other meshes. */
export function kitTag(name) {
  if (!name.startsWith('kit_')) return null;
  const rest = name.slice(4);
  return TAGS.find((t) => rest.startsWith(t)) ?? rest.split('_')[0];
}

/** Face and hair for a soldier from a small integer seed. */
export function personFor(seed) {
  const h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  return { skin: SKINS[h % SKINS.length], hair: HAIRS[(h >>> 8) % HAIRS.length], beard: (h >>> 16) % 5 === 0, glasses: (h >>> 20) % 9 === 0 };
}
