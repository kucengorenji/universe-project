// Ranks business ideas with Jev: one call per idea asks three choice questions (difficulty, feasibility,
// profitability) about the idea plus its researched evidence, then combines them into one score.
// The output CSV imports straight into Google Sheets (File > Import > Upload).
//   node --env-file=.env tools/jev/rank-ideas.mjs tools/jev/ai-ideas/ideas.csv
import { readFileSync, writeFileSync } from 'node:fs';
import { askJev } from './callJev.mjs';
import { parseCsv } from './triage-feedback.mjs';

// Who is judging feasibility for. Change this to match your own situation.
export const PROFILE = 'Developer solo di Indonesia yang bisa membuat web app dan memakai API AI, modal di bawah Rp20 juta, '
  + 'ingin pendapatan pertama dalam 3 bulan.';

const LEVELS = { rendah: 0, sedang: 0.5, tinggi: 1 };
export const QUESTIONS = {
  kesulitan: {
    type: 'choice',
    instructions: 'Seberapa sulit membangun dan menjalankan ide bisnis ini secara teknis dan operasional?',
    criteria: {
      rendah: 'Bisa dimulai dengan tool yang sudah ada dalam hitungan minggu; tanpa data khusus atau izin.',
      sedang: 'Butuh produk yang dibangun sendiri, integrasi, atau keahlian domain tertentu.',
      tinggi: 'Butuh data sensitif, izin regulator, model khusus, atau tim besar.'
    }
  },
  kelayakan: {
    type: 'choice',
    instructions: `Seberapa layak ide ini dijalankan oleh: ${PROFILE}`,
    criteria: {
      rendah: 'Hampir mustahil untuk profil ini dalam setahun.',
      sedang: 'Mungkin, tapi butuh mitra, modal tambahan, atau waktu lebih lama.',
      tinggi: 'Realistis dimulai sendiri dengan modal dan waktu yang ada.'
    }
  },
  profit: {
    type: 'choice',
    instructions: 'Berdasarkan harga dan data pasar yang disebut, apakah ide ini kemungkinan besar menguntungkan dalam 12 bulan?',
    criteria: {
      tidak: 'Margin tipis, pasar terlalu ramai, atau pembeli enggan membayar.',
      mungkin: 'Bisa menguntungkan jika eksekusi dan pemasaran bagus.',
      ya: 'Ada bukti orang membayar dengan harga yang sehat dan permintaan berulang.'
    }
  }
};
const PROFIT = { tidak: 0, mungkin: 0.5, ya: 1 };

/** Expected value of an answer over its label scale; falls back to the picked label when probabilities are missing. */
export function level(answer, scale) {
  const p = answer?.probabilities;
  if (p && typeof p === 'object') {
    let sum = 0, total = 0;
    for (const [label, value] of Object.entries(scale)) { const w = Number(p[label]) || 0; sum += w * value; total += w; }
    if (total > 0) return sum / total;
  }
  return scale[answer?.choice] ?? null;
}

// Weights for the final score (0–100). Profit counts most, then whether you can actually do it, then ease.
export const WEIGHTS = { profit: 0.45, kelayakan: 0.35, mudah: 0.2 };

export function score(answers) {
  const profit = level(answers.profit, PROFIT), kelayakan = level(answers.kelayakan, LEVELS), sulit = level(answers.kesulitan, LEVELS);
  if ([profit, kelayakan, sulit].some(v => v == null)) return null;
  return Math.round(100 * (WEIGHTS.profit * profit + WEIGHTS.kelayakan * kelayakan + WEIGHTS.mudah * (1 - sulit)));
}

const pct = v => v == null ? '' : String(Math.round(v * 100));
const csvField = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export async function rank(ideas, ask = askJev) {
  const rows = [];
  for (const idea of ideas) {
    const state = `Ide: ${idea.ide}\nKategori: ${idea.kategori}\nDeskripsi: ${idea.deskripsi}\nHarga atau data pasar: ${idea.harga_atau_data}`;
    try {
      const a = await ask({ state, questions: QUESTIONS });
      rows.push({
        ...idea,
        kesulitan: a.kesulitan.choice, yakin_kesulitan: pct(a.kesulitan.confidence),
        kelayakan: a.kelayakan.choice, yakin_kelayakan: pct(a.kelayakan.confidence),
        profitable: a.profit.choice, yakin_profit: pct(a.profit.confidence),
        skor: score(a)
      });
    } catch (err) {
      rows.push({ ...idea, skor: null, error: err.message.slice(0, 200) });
    }
  }
  rows.sort((x, y) => (y.skor ?? -1) - (x.skor ?? -1));
  rows.forEach((r, i) => { r.rank = r.skor == null ? '' : i + 1; });
  return rows;
}

export const COLUMNS = ['rank', 'skor', 'ide', 'kategori', 'kesulitan', 'kelayakan', 'profitable',
  'yakin_kesulitan', 'yakin_kelayakan', 'yakin_profit', 'deskripsi', 'harga_atau_data', 'sumber', 'error'];

if (import.meta.url === `file://${process.argv[1]}`) {
  const input = process.argv[2];
  if (!input) { console.error('usage: node --env-file=.env tools/jev/rank-ideas.mjs <ideas.csv>'); process.exit(1); }
  if (!process.env.OPENROUTER_API_KEY) { console.error('OPENROUTER_API_KEY belum di-set (lihat tools/jev/README.md).'); process.exit(1); }
  const started = Date.now();
  const rows = await rank(parseCsv(readFileSync(input, 'utf8')));
  const output = input.replace(/\.csv$/, '') + '.ranked.csv';
  writeFileSync(output, [COLUMNS.join(','), ...rows.map(r => COLUMNS.map(c => csvField(r[c])).join(','))].join('\n') + '\n');
  console.table(rows.map(r => r.error
    ? { rank: '', skor: 'ERROR', ide: r.ide.slice(0, 45), info: r.error.slice(0, 80) }
    : { rank: r.rank, skor: r.skor, ide: r.ide.slice(0, 45), sulit: r.kesulitan, layak: r.kelayakan, profit: r.profitable }));
  console.log(`${rows.length} ide dalam ${((Date.now() - started) / 1000).toFixed(1)} s → ${output}`);
  console.log('Buka di Google Sheets: File > Import > Upload, pilih file ini, "Replace spreadsheet".');
  if (rows.some(r => r.error)) process.exitCode = 1;
}
