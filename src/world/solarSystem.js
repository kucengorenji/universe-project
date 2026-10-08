import { mulberry32 } from '../math/random.js';
import { PLANET_TYPES } from './planetTypes.js';
import { t } from '../i18n/index.js';

// One star system per world seed. The terran home world (the globe the player
// already knows, same seed) always sits in the habitable zone; the rest are
// drawn from zone-appropriate archetypes. Everything is derived from the seed,
// so nothing but the seed ever needs saving.

const SYLLABLES = ['ar', 'be', 'cal', 'dor', 'el', 'fa', 'gor', 'hel', 'is', 'ka', 'lor', 'mi', 'nov', 'or', 'pra', 'qu', 'ri', 'sol', 'ter', 'um', 'va', 'xe', 'yor', 'zan', 'the', 'ron', 'sa', 'ne', 'ia', 'lu'];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
const STAR_CLASSES = [
  { cls: 'G', get label() { return t('star.G'); }, color: 0xffe2a8, glow: 0xffb45a, light: 0xfff1dc },
  { cls: 'K', get label() { return t('star.K'); }, color: 0xffc48a, glow: 0xff8a3a, light: 0xffe0c0 },
  { cls: 'F', get label() { return t('star.F'); }, color: 0xf4f1ff, glow: 0xa8c4ff, light: 0xf2f4ff }
];

function makeName(rng, min = 2, max = 3) {
  const n = min + Math.floor(rng() * (max - min + 1));
  let s = '';
  for (let i = 0; i < n; i++) s += SYLLABLES[Math.floor(rng() * SYLLABLES.length)];
  return s[0].toUpperCase() + s.slice(1);
}

/** Zone -> weighted archetypes (home world is placed separately). */
const ZONES = {
  inner: [['lava', 3], ['barren', 2], ['desert', 1]],
  habitable: [['ocean', 3], ['desert', 3]],
  outer: [['gas', 4], ['ice', 3], ['barren', 1]]
};

function pickWeighted(rng, list) {
  const total = list.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [key, w] of list) if ((r -= w) <= 0) return key;
  return list[0][0];
}

export function generateSystem(seed) {
  const rng = mulberry32((seed ^ 0x5bd1e995) >>> 0);
  const star = { ...STAR_CLASSES[Math.floor(rng() * STAR_CLASSES.length)], name: makeName(rng, 2, 2), radius: 16 };
  const count = 5 + Math.floor(rng() * 4); // 5..8
  const homeSlot = 1 + Math.floor(rng() * 2); // 2nd or 3rd planet
  const planets = [];
  let orbit = 58;
  let prevReach = 0;
  for (let i = 0; i < count; i++) {
    const zone = i < homeSlot ? 'inner' : i <= homeSlot + 1 ? 'habitable' : 'outer';
    const home = i === homeSlot;
    let type = home ? 'terran' : pickWeighted(rng, ZONES[zone]);
    // Avoid a monotonous run of three gas giants
    if (type === 'gas' && planets.length >= 2 && planets.slice(-2).every((p) => p.type === 'gas')) type = 'ice';
    const gas = type === 'gas';
    const radius = gas ? 8 + rng() * 3 : type === 'terran' ? 4.2 : 2.6 + rng() * 1.6;
    // Clearance for this planet's moon system and the previous one's
    const reach = gas ? radius * 3.2 : radius * 2.4;
    orbit += i === 0 ? 0 : 24 + rng() * 18 + prevReach + reach;
    prevReach = reach;
    const name = home ? `${star.name} Prime` : rng() < 0.5 ? makeName(rng) : `${star.name} ${ROMAN[i]}`;
    const moons = [];
    const moonCount = gas ? 1 + Math.floor(rng() * 3) : rng() < 0.35 ? 1 : 0;
    for (let m = 0; m < moonCount; m++) {
      moons.push({
        radius: 0.5 + rng() * (gas ? 1.1 : 0.5),
        distance: radius * (1.8 + m * 0.5 + rng() * 0.25),
        speed: 0.12 + rng() * 0.2,
        phase: rng() * Math.PI * 2,
        tint: 0.75 + rng() * 0.2
      });
    }
    const def = PLANET_TYPES[type];
    planets.push({
      index: i,
      name,
      type,
      home,
      seed: home ? seed : Math.floor(rng() * 900000 + 100000),
      radius,
      orbit,
      // A year spans many days (the town's day/night comes from spin, not orbit),
      // and the system still visibly turns while you fly
      orbitSpeed: (0.0025 / Math.sqrt(orbit / 58)) * (0.8 + rng() * 0.4),
      phase: rng() * Math.PI * 2,
      // One day lasts 8-17 minutes: slow enough for a town to have its evening
      spin: (0.03 + rng() * 0.04) * 0.2 * (rng() < 0.15 ? -1 : 1),
      moons,
      ring: gas && rng() < 0.6 ? { inner: radius * 1.35, outer: radius * (1.9 + rng() * 0.5), tilt: (rng() - 0.5) * 0.5 } : null,
      bands: gas ? Array.from({ length: 4 }, () => rng()) : null,
      landable: def.landable,
      inhabited: def.inhabited
    });
    // Colonies name their capitals after the world they stand on
    if (!home && def.inhabited) planets[i].capitalNames = [`Port ${name}`, `${name} Citadel`];
  }
  // Asteroid belt between the habitable zone and the gas giants
  const beltAfter = Math.min(count - 2, homeSlot + 1);
  const belt = {
    inner: planets[beltAfter].orbit + 12,
    outer: planets[beltAfter].orbit + 12 + 10 + rng() * 6,
    count: 900
  };
  if (belt.outer > planets[beltAfter + 1].orbit - 14) belt.outer = planets[beltAfter + 1].orbit - 14;
  return { seed, name: star.name, star, planets, belt, homeIndex: homeSlot };
}
