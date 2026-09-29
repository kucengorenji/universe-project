// Town-wide scale constants, shared by layout, builder and billboards.
// Kept in their own module so render modules never import each other for a number.
export const WATER_Y = -0.8; // still-water surface, metres
export const HORIZON_R = 4200; // radius of the horizon ring beyond the playable disc

/** Pavement beside a carriageway, each side (metres). v3 modern towns use a 1.8 m footway. */
export const pavementWidth = (L) => (L.modern ? (L.layoutVersion >= 3 ? 1.8 : 2.4) : 0.6);
