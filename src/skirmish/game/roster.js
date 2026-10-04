import { mulberry32 } from '../../math/random.js';
import { DIFFICULTY, GUARDS } from './rules.js';

// The player's squad (nine named soldiers, six go into battle), the enemy's order of battle
// for a difficulty, and the briefing: all pure data from a seed.

/** Nine soldiers. face: seed for skin, hair, glasses and beard (soldierLook.personFor). */
export const ROSTER = [
  { id: 'arlen', name: 'Arlen Voss', cls: 'scout', face: 11, note: 'Pandai membaca medan; kandidat leader.' },
  { id: 'mira', name: 'Mira Halden', cls: 'scout', face: 23, note: 'Pelari tercepat di regu.' },
  { id: 'brann', name: 'Brann Keller', cls: 'shocktrooper', face: 37, note: 'Tak pernah mundur dari jarak dekat.' },
  { id: 'sela', name: 'Sela Moraine', cls: 'shocktrooper', face: 41, note: 'Tenang di bawah tembakan.' },
  { id: 'otto', name: 'Otto Riel', cls: 'lancer', face: 52, note: 'Mantan montir tank.' },
  { id: 'ines', name: 'Ines Darrow', cls: 'lancer', face: 64, note: 'Bidikan lance-nya jarang meleset.' },
  { id: 'cato', name: 'Cato Weller', cls: 'engineer', face: 75, note: 'Membawa amunisi untuk semua.' },
  { id: 'lio', name: 'Lio Marchetti', cls: 'engineer', face: 86, note: 'Bisa memperbaiki apa saja.' },
  { id: 'vesna', name: 'Vesna Orlov', cls: 'sniper', face: 98, note: 'Sabar menunggu satu tembakan.' }
];

export const DEFAULT_SQUAD = ['arlen', 'brann', 'sela', 'otto', 'cato', 'vesna'];
export const MAX_SQUAD = 6;

/** The enemy's infantry by difficulty: a fixed mix that grows with it (index order = priority). */
const ENEMY_MIX = ['scout', 'shocktrooper', 'scout', 'lancer', 'shocktrooper', 'sniper', 'scout', 'engineer', 'shocktrooper', 'scout', 'lancer', 'shocktrooper'];

export function enemyForces(difficulty) {
  const D = DIFFICULTY[difficulty] || DIFFICULTY.normal;
  // the last few hold the base (the leader leads from the front)
  return ENEMY_MIX.slice(0, D.infantry).map((cls, i, all) => ({ id: `imp${i}`, name: `Prajurit Imperium ${i + 1}`, cls, face: 200 + i * 7, leader: i === 0, guard: i >= all.length - GUARDS }));
}

// ---------------------------------------------------------------- briefing
const OP_A = ['Fajar', 'Angin', 'Besi', 'Lonceng', 'Gandum', 'Kabut', 'Jembatan', 'Merpati', 'Lentera', 'Batu'];
const OP_B = ['Kelabu', 'Utara', 'Sunyi', 'Terakhir', 'Merah', 'Patah', 'Pertama', 'Senja', 'Panjang', 'Dingin'];
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
  const title = `Operasi ${pick(OP_A)} ${pick(OP_B)}`;
  const village = villageName(field.seed);
  const D = DIFFICULTY[difficulty] || DIFFICULTY.normal;
  const time = { day: 'siang hari', dusk: 'menjelang senja', night: 'di bawah gelap malam' }[field.params.time] || 'siang hari';
  const paragraphs = [
    `Pasukan Imperium menduduki jalan menuju ${village} dan membangun base camp di utara desa. Regu kita bergerak dari selatan ${time}.`,
    field.river
      ? `Sebuah sungai memotong medan; jembatan adalah satu-satunya penyeberangan${field.bridges.length > 1 ? ` (ada ${field.bridges.length})` : ''}. Jangan berdesakan di atasnya.`
      : `Medan terbuka di antara ladang dan pagar tanaman. Manfaatkan rumput tinggi dan karung pasir.`,
    `Intel: sekitar ${D.infantry} infanteri, garis parit dengan kawat berduri, ${field.bunkers.length || 'tanpa'} bunker senapan mesin, dan satu tank berat. Radiator di belakang tank adalah titik lemahnya: serahkan pada Lancer.`
  ];
  const objectives = [
    'Rebut base camp musuh (berdiri di benderanya di akhir aksi), atau lumpuhkan semua pasukan musuh.',
    `Selesaikan dalam ${20} giliran. Base camp kita tidak boleh jatuh.`,
    `Camp netral di alun-alun ${village} bisa direbut lebih dulu.`
  ];
  return { title, village, paragraphs, objectives };
}
