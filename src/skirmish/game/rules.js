// Skirmish rules: numbers only (docs/SKIRMISH_PLAN.md, "Keputusan M1"). Pure data and small
// pure functions, shared by the battle state, the AI, the HUD and the tests.

export const TURN_LIMIT = 20;
export const BASE_CP = 6; // player CP per turn, +1 per living leader
export const DOWN_TURNS = 3; // turns a downed unit can still be rescued
export const CAPTURE_RADIUS = 3; // ending an action this close to a camp flag captures it
export const TOUCH_RADIUS = 1.6; // reaching a downed unit (rescue or finish)
export const RESELECT_AP = 0.75; // each extra selection of a unit in the same turn: AP x this
export const MIN_AP_SHARE = 0.3;
export const WALK_SPEED = 3.2; // m/s
export const RUN_SPEED = 5.2;
export const RUN_AP_COST = 1.3; // AP metres per metre when running
export const CROUCH_DAMAGE = 0.8; // damage taken while crouched (on top of what cover stops)
export const HEADSHOT = 2;
export const ENEMY_SCALE = 0.9; // enemy HP and damage

/**
 * Weapons. spread: half-angle of the reticle cone (degrees) standing / crouched; interval:
 * seconds between rounds of a burst; vsArmor: damage to tanks and bunkers per hit
 * (infantry rounds only ping off); splash: blast radius (m).
 */
export const WEAPONS = {
  rifle: { shots: 5, damage: 22, range: 45, spread: [2.2, 1.4], interval: 0.12, vsArmor: 0, intercept: true },
  rifle_eng: { shots: 4, damage: 18, range: 45, spread: [2.4, 1.6], interval: 0.13, vsArmor: 0, intercept: true },
  smg: { shots: 15, damage: 10, range: 20, spread: [4.5, 3.5], interval: 0.07, vsArmor: 0, intercept: true },
  lance: { shots: 1, damage: 40, range: 40, spread: [1.2, 0.8], interval: 0.3, vsArmor: 300, splash: 2, intercept: false, ammo: 3 },
  sniper: { shots: 1, damage: 160, range: 120, spread: [0.35, 0.2], interval: 0.3, vsArmor: 0, intercept: false, ammo: 6, scope: true },
  tank_cannon: { shots: 1, damage: 120, range: 70, spread: [1.0, 1.0], interval: 0.5, vsArmor: 200, splash: 4 },
  tank_mg: { shots: 3, damage: 8, range: 20, spread: [3, 3], interval: 0.1, vsArmor: 0, intercept: true },
  bunker_mg: { shots: 3, damage: 12, range: 30, spread: [2.5, 2.5], interval: 0.1, vsArmor: 0, intercept: true }
};

/** Classes: HP, AP (metres of movement per action), weapon. */
export const STATS = {
  scout: { hp: 240, ap: 30, weapon: 'rifle' },
  shocktrooper: { hp: 380, ap: 18, weapon: 'smg' },
  lancer: { hp: 300, ap: 15, weapon: 'lance' },
  engineer: { hp: 220, ap: 24, weapon: 'rifle_eng', resupply: true },
  sniper: { hp: 180, ap: 12, weapon: 'sniper' },
  tank: { hp: 2400, ap: 40, weapon: 'tank_cannon', intercept: 'tank_mg', cp: 2, armor: true, weakpoint: 3 },
  bunker: { hp: 1500, ap: 0, weapon: null, intercept: 'bunker_mg', armor: true }
};

/** Interception: a short, loose burst every so often at a moving enemy in range and sight. */
export const INTERCEPT = { every: 0.7, shots: 2, spread: 2.5, damage: 0.6 };

export const DIFFICULTY = {
  easy: { label: 'Mudah', infantry: 6, cp: 4, accuracy: 0.7 },
  normal: { label: 'Normal', infantry: 9, cp: 5, accuracy: 0.85 },
  hard: { label: 'Sulit', infantry: 12, cp: 6, accuracy: 1 }
};

/** Damage of one hit at distance d (full to 60% of range, then down to 40% at range, 20% beyond). */
export function falloff(weapon, d) {
  const r = weapon.range;
  if (d <= r * 0.6) return 1;
  if (d <= r) return 1 - 0.6 * ((d - r * 0.6) / (r * 0.4));
  return 0.2;
}

/** Rank from the turns taken and the losses: A <= 6 turns, B <= 10, C <= 15, else D; any death costs a grade. */
export function rankFor(turns, deaths) {
  const grades = ['A', 'B', 'C', 'D'];
  let g = turns <= 6 ? 0 : turns <= 10 ? 1 : turns <= 15 ? 2 : 3;
  if (deaths > 0) g = Math.min(3, g + 1);
  return grades[g];
}
