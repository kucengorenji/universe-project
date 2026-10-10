// Hands-on 3: one call, three answer shapes. Checks a city name a player typed before it shows on the globe:
// is it rude (noul), what theme is it (choice), how good is it as a city name (score).
//   node --env-file=.env tools/jev/cek-nama.mjs
//   node --env-file=.env tools/jev/cek-nama.mjs "Neo Batavia" "Kota Anjing"
import { askJev } from './callJev.mjs';

export const QUESTIONS = {
  kasar: {
    type: 'noul',
    instructions: 'Apakah nama kota ini kasar, menghina, berbau SARA, atau tidak pantas dilihat pemain lain?'
  },
  tema: {
    type: 'choice',
    instructions: 'Nama kota ini paling cocok dengan tema apa?',
    criteria: {
      fantasi: 'Terdengar seperti dunia fantasi atau abad pertengahan.',
      scifi: 'Terdengar futuristik, luar angkasa, atau teknologi.',
      nyata: 'Nama kota dunia nyata atau terdengar seperti kota sungguhan.',
      lelucon: 'Meme, lelucon, atau asal ketik.'
    }
  },
  kualitas: {
    type: 'score',
    instructions: 'Seberapa bagus ini sebagai nama kota di game eksplorasi planet?',
    criteria: [
      'Asal ketik atau tidak terbaca sebagai nama.',
      'Bisa dipakai tapi datar.',
      'Bagus dan mudah diingat.',
      'Sangat bagus, punya karakter dan cocok dengan dunia game.'
    ]
  }
};
// Names Jev thinks are rude above this probability are held back; the player is asked for another name.
export const BLOCK_ABOVE = 0.7;

/** Reads the probability out of a noul answer; tolerates the field names the alpha API may use. */
export const yesProbability = a => a?.noul ?? a?.probability ?? a?.probabilities?.yes ?? a?.probabilities?.true ?? null;

export function verdict(answers) {
  const p = yesProbability(answers.kasar);
  if (p == null) return 'periksa manual (bentuk jawaban noul tidak dikenal)';
  return p > BLOCK_ABOVE ? 'TOLAK, minta nama lain' : 'boleh tampil';
}

const EXAMPLES = ['Aether Prime', 'Kota Tai Kucing', 'Neo Batavia', 'asdfgh', 'Lumenhold', 'Nusantara-7'];

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!process.env.OPENROUTER_API_KEY) { console.error('OPENROUTER_API_KEY belum di-set (lihat tools/jev/README.md).'); process.exit(1); }
  const names = process.argv.length > 2 ? process.argv.slice(2) : EXAMPLES;
  const rows = [];
  for (const name of names) {
    try {
      const a = await askJev({ state: `Nama kota: ${name}`, questions: QUESTIONS });
      const p = yesProbability(a.kasar);
      rows.push({
        nama: name,
        kasar: p == null ? JSON.stringify(a.kasar) : `${Math.round(p * 100)}%`,
        tema: a.tema.choice ?? JSON.stringify(a.tema),
        kualitas: a.kualitas.score ?? JSON.stringify(a.kualitas),
        hasil: verdict(a)
      });
    } catch (err) {
      rows.push({ nama: name, hasil: `ERROR: ${err.message.slice(0, 160)}` });
      process.exitCode = 1;
    }
  }
  console.table(rows);
}
