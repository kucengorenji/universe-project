// Hands-on 2: a town gatekeeper NPC that understands what the player means, with zero LLM calls.
// Jev only picks a destination from the town's own places; every line the NPC says is written here.
//   node --env-file=.env tools/jev/npc-intent.mjs
//   node --env-file=.env tools/jev/npc-intent.mjs "aku lapar banget" "mau jual ikan"
import { callJev } from './callJev.mjs';

export const PLACES = {
  bakery: 'Toko roti. Makanan, lapar, sarapan, kue.',
  harbor: 'Pelabuhan. Kapal, berlayar, ikan, pergi ke pulau atau kota lain lewat laut.',
  market: 'Pasar. Jual beli barang dagangan, harga, trade.',
  smithy: 'Pandai besi. Alat, senjata, memperbaiki perkakas.',
  inn: 'Penginapan. Tidur, istirahat, menginap, menyimpan progres.',
  townhall: 'Balai kota. Misi, izin membangun, urusan wali kota.',
  none: 'Tidak ada tempat yang cocok, atau pemain cuma ngobrol.'
};

export const LINES = {
  bakery: 'Toko roti ada di alun-alun, ikuti bau rotinya.',
  harbor: 'Pelabuhan di ujung jalan menurun ke arah laut.',
  market: 'Pasar buka sampai sore, belok kiri setelah air mancur.',
  smithy: 'Pandai besi di dekat tembok timur, dengar saja suara palunya.',
  inn: 'Penginapan yang lampunya kuning itu, kamar masih kosong.',
  townhall: 'Balai kota di tengah, gedung paling tinggi.',
  none: 'Hmm, aku penjaga gerbang. Kalau butuh tempat, tanya saja.'
};
// Below this the NPC asks again instead of sending the player somewhere wrong.
export const ASK_BELOW = 0.6;

export function reply({ choice, confidence }) {
  if (confidence != null && confidence < ASK_BELOW && choice !== 'none') {
    return `Maksudmu ${choice}? ${LINES[choice]} Kalau bukan, coba jelaskan lagi.`;
  }
  return LINES[choice];
}

const EXAMPLES = [
  'aku lapar banget dari tadi belum makan',
  'kapal ke pulau seberang berangkat jam berapa?',
  'pedangku patah waktu lawan serigala',
  'mau nitip barang dagangan, siapa yang mau beli?',
  'capek, pengen rebahan',
  'boleh nggak aku bangun rumah di bukit itu?',
  'cuacanya bagus ya hari ini',
  'ada yang jual ikan segar?'
];

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!process.env.OPENROUTER_API_KEY) { console.error('OPENROUTER_API_KEY belum di-set (lihat tools/jev/README.md).'); process.exit(1); }
  const said = process.argv.length > 2 ? process.argv.slice(2) : EXAMPLES;
  const question = 'Pemain berbicara ke penjaga gerbang kota. Ke tempat mana pemain ini sebenarnya ingin pergi?';
  for (const text of said) {
    const started = Date.now();
    try {
      const answer = await callJev({ question, options: PLACES, input: text });
      const pct = answer.confidence == null ? '?' : `${Math.round(answer.confidence * 100)}%`;
      console.log(`\nPemain : ${text}\nJev    : ${answer.choice} (${pct}, ${Date.now() - started} ms)\nNPC    : ${reply(answer)}`);
    } catch (err) {
      console.log(`\nPemain : ${text}\nERROR  : ${err.message}`);
      process.exitCode = 1;
    }
  }
}
