import { mulberry32 } from '../../math/random.js';
import { DIFFICULTY, GUARDS } from './rules.js';
import { t } from '../../i18n/index.js';

// The player's squad (nine named soldiers, six go into battle), the enemy's order of battle
// for a difficulty, and the briefing: all pure data from a seed.

/** Nine soldiers. face: seed for skin, hair, glasses and beard (soldierLook.personFor). */
export const ROSTER = [
  { id: 'arlen', name: 'Arlen Voss', cls: 'scout', face: 11, get note() { return t('skirmish.note.arlen'); } },
  { id: 'mira', name: 'Mira Halden', cls: 'scout', face: 23, get note() { return t('skirmish.note.mira'); } },
  { id: 'brann', name: 'Brann Keller', cls: 'shocktrooper', face: 37, get note() { return t('skirmish.note.brann'); } },
  { id: 'sela', name: 'Sela Moraine', cls: 'shocktrooper', face: 41, get note() { return t('skirmish.note.sela'); } },
  { id: 'otto', name: 'Otto Riel', cls: 'lancer', face: 52, get note() { return t('skirmish.note.otto'); } },
  { id: 'ines', name: 'Ines Darrow', cls: 'lancer', face: 64, get note() { return t('skirmish.note.ines'); } },
  { id: 'cato', name: 'Cato Weller', cls: 'engineer', face: 75, get note() { return t('skirmish.note.cato'); } },
  { id: 'lio', name: 'Lio Marchetti', cls: 'engineer', face: 86, get note() { return t('skirmish.note.lio'); } },
  { id: 'vesna', name: 'Vesna Orlov', cls: 'sniper', face: 98, get note() { return t('skirmish.note.vesna'); } }
];

export const DEFAULT_SQUAD = ['arlen', 'brann', 'sela', 'otto', 'cato', 'vesna'];
export const MAX_SQUAD = 6;

/** The enemy's infantry by difficulty: a fixed mix that grows with it (index order = priority). */
const ENEMY_MIX = ['scout', 'shocktrooper', 'scout', 'lancer', 'shocktrooper', 'sniper', 'scout', 'engineer', 'shocktrooper', 'scout', 'lancer', 'shocktrooper'];

export function enemyForces(difficulty) {
  const D = DIFFICULTY[difficulty] || DIFFICULTY.normal;
  // the last few hold the base (the leader leads from the front)
  return ENEMY_MIX.slice(0, D.infantry).map((cls, i, all) => ({ id: `imp${i}`, name: t('skirmish.imperialSoldier', { n: i + 1 }), cls, face: 200 + i * 7, leader: i === 0, guard: i >= all.length - GUARDS }));
}

// ---------------------------------------------------------------- briefing
// Operation names pair a noun with an adjective; both lists are translated, the word order lives in 'skirmish.opTitle'
const OP_A = Array.from({ length: 10 }, (_, i) => `skirmish.opNoun.${i}`);
const OP_B = Array.from({ length: 10 }, (_, i) => `skirmish.opAdj.${i}`);
const VILLAGE_A = ['Bram', 'Kessel', 'Lind', 'Moor', 'Vell', 'Ash', 'Ober', 'Rhen', 'Tal', 'Wend'];
const VILLAGE_B = ['dorf', 'hausen', 'brück', 'feld', 'heim', 'wald', 'stein', 'bach'];

export function villageName(seed) {
  const r = mulberry32(seed ^ 0x51a9e);
  return VILLAGE_A[Math.floor(r() * VILLAGE_A.length)] + VILLAGE_B[Math.floor(r() * VILLAGE_B.length)];
}

/** Briefing for a battlefield (generateField output) and setup. Returns { title, paragraphs[], objectives[] }. */
export function briefing(field, { difficulty = 'normal' } = {}) {
  const r = mulberry32(field.seed ^ 0xb1ef);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const noun = t(pick(OP_A)), adj = t(pick(OP_B));
  const title = t('skirmish.opTitle', { noun, adj });
  const village = villageName(field.seed);
  const D = DIFFICULTY[difficulty] || DIFFICULTY.normal;
  const time = t(`skirmish.brief.time.${['day', 'dusk', 'night'].includes(field.params.time) ? field.params.time : 'day'}`);
  const paragraphs = [
    t('skirmish.brief.1', { village, time }),
    field.river
      ? t(field.bridges.length > 1 ? 'skirmish.brief.rivers' : 'skirmish.brief.river', { count: field.bridges.length })
      : t('skirmish.brief.open'),
    t('skirmish.brief.intel', { infantry: D.infantry, bunkers: field.bunkers.length ? t('skirmish.brief.bunkers', { count: field.bunkers.length }) : t('skirmish.brief.noBunkers') })
  ];
  const objectives = [
    t('skirmish.obj.capture'),
    t('skirmish.obj.turns', { count: 20 }),
    t('skirmish.obj.neutral', { village })
  ];
  return { title, village, paragraphs, objectives };
}
