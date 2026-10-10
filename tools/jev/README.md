# Jev (keputusan cepat lewat OpenRouter)

Helper untuk memanggil Jev (`typesafe/jev-1.13`) lewat endpoint Decisions OpenRouter (`/api/alpha/decisions`,
masih alpha) dan satu contoh: triage feedback pemain. Jev tidak bisa dipakai lewat `chat/completions`.
Panduan lengkap use case: [docs/JEV_USE_CASES.md](../../docs/JEV_USE_CASES.md).

## Setup

1. Buat API key di openrouter.ai (menu Keys) dan isi saldo kecil.
2. Simpan di file `.env` di root repo (sudah di-.gitignore, jangan di-commit):

   ```sh
   OPENROUTER_API_KEY=sk-or-...
   ```

   Untuk backend Cloudflare: `npx wrangler pages secret put OPENROUTER_API_KEY`.
   Untuk sesi Claude Code cloud: tambahkan sebagai environment variable di pengaturan environment,
   dan izinkan domain `openrouter.ai` di Network access.

## Contoh: triage feedback

```sh
node --env-file=.env tools/jev/triage-feedback.mjs tools/jev/example-feedback.csv
```

Setiap baris diberi satu kategori (`bug`, `performa`, `saran`, `pertanyaan`, `spam`, `lainnya`) beserta keyakinan Jev.
Tag dengan keyakinan di bawah 60% (`REVIEW_BELOW`) ditandai `cek_manual`. Hasilnya ditulis ke
`tools/jev/example-feedback.tagged.csv`. Ganti CSV-nya dengan feedback asli (kolom `id,pesan`).
`example-feedback.csv` berisi pesan contoh, bukan feedback pemain sungguhan.

## Hands-on 2: NPC penjaga gerbang yang paham maksud pemain

```sh
node --env-file=.env tools/jev/npc-intent.mjs
node --env-file=.env tools/jev/npc-intent.mjs "aku lapar banget" "mau jual ikan"
```

Pemain menulis bebas, Jev memilih satu tempat di kota (`bakery`, `harbor`, `market`, `smithy`, `inn`,
`townhall`, atau `none`). Kalimat NPC sudah ditulis di `LINES`, jadi tidak ada LLM yang menulis jawaban.
Kalau Jev kurang dari 60% yakin, NPC bertanya balik ("Maksudmu ...?") alih-alih mengirim pemain ke tempat yang salah.

## Hands-on 3: satu panggilan, tiga bentuk jawaban

```sh
node --env-file=.env tools/jev/cek-nama.mjs
node --env-file=.env tools/jev/cek-nama.mjs "Neo Batavia" "Kota Anjing"
```

Untuk setiap nama kota, satu request menanyakan tiga hal sekaligus: `kasar` (noul, ya/tidak dengan
probabilitas), `tema` (choice), dan `kualitas` (score dari 4 level). Nama dengan probabilitas kasar di atas
70% ditolak. Bentuk jawaban `noul` dan `score` belum dipastikan dari dokumentasi resmi; kalau kolomnya berisi
JSON mentah, kirim isinya supaya parser-nya bisa disesuaikan.

## Ranking ide bisnis AI (hasil ke Google Sheets)

```sh
node --env-file=.env tools/jev/rank-ideas.mjs tools/jev/ai-ideas/ideas.csv
```

`ai-ideas/ideas.csv` berisi 25 ide bisnis AI hasil riset web (Oktober 2026), masing-masing dengan data harga
atau pasar dan sumbernya. Untuk setiap ide, satu panggilan Jev menjawab tiga pertanyaan: `kesulitan`
(rendah/sedang/tinggi), `kelayakan` untuk profil di `PROFILE`, dan `profitable` (tidak/mungkin/ya).
Skor 0–100 = 45% profit + 35% kelayakan + 20% kemudahan, memakai probabilitas Jev kalau tersedia.

Hasilnya `ai-ideas/ideas.ranked.csv`, urut dari skor tertinggi. Buka di Google Sheets lewat
File > Import > Upload. Angka ditulis sebagai bilangan bulat supaya tidak bermasalah dengan locale Indonesia.
Ubah `PROFILE` di `rank-ideas.mjs` supaya penilaian kelayakan sesuai kondisi kamu.

Data harga dan pendapatan di `ideas.csv` sebagian besar berasal dari blog vendor dan belum diverifikasi.
Jev menilai berdasarkan teks itu, jadi ranking-nya adalah penyaringan awal, bukan studi kelayakan.
