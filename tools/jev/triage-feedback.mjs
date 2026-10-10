// Tags each player feedback message with one category using Jev, then writes <input>.tagged.csv.
//   node --env-file=.env tools/jev/triage-feedback.mjs tools/jev/example-feedback.csv
import { readFileSync, writeFileSync } from 'node:fs';
import { callJev } from './callJev.mjs';

export const CATEGORIES = ['bug', 'performa', 'saran', 'pertanyaan', 'spam', 'lainnya'];
export const QUESTION = 'Kamu menyortir feedback pemain game web 3D Aethergate. Pilih satu kategori untuk pesan ini: '
  + 'bug (sesuatu rusak atau salah), performa (lag, FPS rendah, loading lama), saran (ide fitur atau perubahan), '
  + 'pertanyaan (pemain bertanya cara melakukan sesuatu), spam (iklan atau tidak berhubungan), lainnya (tidak cocok dengan semua di atas).';

/** Minimal CSV reader: header row, double-quoted fields may hold commas and "" escapes. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(f => f !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some(f => f !== '')) rows.push(row);
  const [header, ...body] = rows;
  return body.map(r => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ''])));
}

const csvField = v => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;

export async function triage(rows, jev = callJev) {
  const out = [];
  for (const row of rows) {
    try {
      const { choice } = await jev({ question: QUESTION, options: CATEGORIES, input: row.pesan });
      out.push({ ...row, kategori: choice });
    } catch (err) {
      out.push({ ...row, kategori: '', error: err.message });
    }
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const input = process.argv[2];
  if (!input) { console.error('usage: node --env-file=.env tools/jev/triage-feedback.mjs <feedback.csv>'); process.exit(1); }
  if (!process.env.OPENROUTER_API_KEY) { console.error('OPENROUTER_API_KEY belum di-set. Isi .env di root repo, lalu jalankan dengan node --env-file=.env (lihat tools/jev/README.md).'); process.exit(1); }
  const started = Date.now();
  const tagged = await triage(parseCsv(readFileSync(input, 'utf8')));
  const output = input.replace(/\.csv$/, '') + '.tagged.csv';
  writeFileSync(output, ['id,kategori,pesan', ...tagged.map(r => [r.id, r.kategori, r.pesan].map(csvField).join(','))].join('\n') + '\n');
  console.table(tagged.map(r => ({ id: r.id, kategori: r.kategori || `ERROR: ${r.error}`, pesan: r.pesan.slice(0, 60) })));
  const counts = Object.fromEntries(CATEGORIES.map(c => [c, tagged.filter(r => r.kategori === c).length]));
  console.log(counts, `${tagged.length} pesan dalam ${((Date.now() - started) / 1000).toFixed(1)} s → ${output}`);
  if (tagged.some(r => r.error)) process.exitCode = 1;
}
