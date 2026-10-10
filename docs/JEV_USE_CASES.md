# Jev + Claude: Contoh Use Case dan Langkah Pakai

Panduan praktis memakai **Jev** (model keputusan dari TypeSafe) bersama **Claude Code**, dengan contoh yang
diterapkan ke Aethergate / Globe Universe. Rujukan: *Jev Use Cases Guide* (RoboNuggets, 19 use case).

> Status: dokumen usulan. Belum ada integrasi Jev di kode game, API, atau dashboard. Potongan kode di bawah
> adalah contoh yang belum diuji terhadap API Jev; cek format terbaru di `docs.typesafe.ai` dan halaman model
> `typesafe/jev-1.13` di OpenRouter sebelum dipakai.

---

## 1. Jev itu apa, dan kapan dipakai

Jev adalah model yang **hanya memutuskan**, tidak menulis kalimat. Menurut panduan, Jev bisa sampai 200× lebih
cepat dan 400× lebih murah dari model besar. Jawabannya selalu salah satu dari tiga bentuk:

| Bentuk | Contoh pertanyaan |
|---|---|
| **True / false** | Apakah laporan ini bug? Apakah pesan ini spam? |
| **Pilihan dari menu** | Laporan ini masuk `bug`, `saran`, `pertanyaan`, atau `lainnya`? |
| **Skor** | Dari 1–10, seberapa besar kemungkinan pemain ini berhenti main? |

Pembagian kerja yang paling efektif:

- **Jev memutuskan**: menyortir, memberi skor, memberi tag, memilih. Dijalankan untuk setiap item, ribuan kali.
- **Claude menulis**: membangun kodenya, menulis balasan, merangkum, dan menangani kasus yang butuh kalimat.
- **Manusia** hanya melihat kasus yang Jev ragu.

Aturan cepat: kalau sebuah langkah bisa dijawab dengan "pilih satu dari daftar ini" atau "beri angka", itu
kandidat Jev. Kalau jawabannya harus berupa teks bebas, serahkan ke Claude.

---

## 2. Setup sekali di awal

### Langkah 1 – Buat akun dan API key OpenRouter

1. Daftar di `openrouter.ai`, isi saldo kecil (Jev sangat murah; beberapa dolar cukup untuk eksperimen).
2. Buat API key di menu **Keys**.
3. Nama model Jev di OpenRouter: `typesafe/jev-1.13`.

### Langkah 2 – Simpan key sebagai environment variable

Jangan tulis key di kode atau commit.

```sh
# lokal (macOS/Linux), tambahkan ke ~/.zshrc atau .env yang di-.gitignore
export OPENROUTER_API_KEY="sk-or-..."
```

Untuk Cloudflare Pages Functions (backend Aethergate), simpan sebagai secret:

```sh
npx wrangler pages secret put OPENROUTER_API_KEY
```

Di sesi Claude Code cloud, tambahkan di pengaturan environment (bagian *secrets / environment variables*).

### Langkah 3 – Beri tahu Claude cara memanggil Jev

Setiap prompt di panduan ini diakhiri satu baris:

```
Connect to Jev via openrouter.ai if you don't have it yet.
```

Baris itu cukup: Claude akan membuat helper pemanggil Jev sendiri. Kalau ingin konsisten di seluruh repo,
minta sekali saja:

```
Buat helper kecil `callJev({ question, options, input })` yang memanggil model typesafe/jev-1.13 lewat
OpenRouter dengan OPENROUTER_API_KEY dari env. Jawaban harus dibatasi ke `options` (pakai JSON schema enum),
kembalikan { choice, confidence } kalau Jev menyediakan tingkat keyakinan. Tambahkan test dengan fetch yang
di-mock. Cek docs.typesafe.ai dulu untuk format request yang benar.
```

Gambaran bentuk helper-nya (contoh, sesuaikan dengan dokumentasi resmi):

```js
// tools/jev/callJev.mjs (contoh)
export async function callJev({ question, options, input }) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'typesafe/jev-1.13',
      messages: [
        { role: 'system', content: question },
        { role: 'user', content: input }
      ],
      // Batasi jawaban ke daftar pilihan supaya Jev tidak mengarang kategori.
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'decision',
          strict: true,
          schema: {
            type: 'object',
            properties: { choice: { type: 'string', enum: options } },
            required: ['choice'],
            additionalProperties: false
          }
        }
      }
    })
  });
  if (!res.ok) throw new Error(`Jev ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}
```

### Empat kebiasaan yang membuat setiap prompt lebih bagus

1. **Beri Jev jalan keluar.** Selalu tambahkan opsi `Lainnya` / `None`, supaya Jev tidak dipaksa memilih yang salah.
2. **Kirim yang ragu ke manusia.** Tetapkan ambang keyakinan (misalnya 60%); di bawah itu masuk antrean manual.
3. **Uji sebelum percaya.** Bandingkan Jev dengan contoh yang jawabannya sudah kamu tahu (use case 7).
4. **Jev memutuskan, Claude menulis.** Langkah yang butuh kalimat diserahkan ke Claude.

---

## 3. Alur kerja umum dengan Claude Code

Pola ini sama untuk semua use case di bawah.

1. **Tentukan keputusannya.** Tulis satu pertanyaan dan daftar jawabannya. Contoh: "Laporan pemain ini masuk
   `bug`, `performa`, `saran`, `pertanyaan`, atau `lainnya`?"
2. **Siapkan data.** Tunjukkan ke Claude dari mana datanya: file CSV, tabel D1, endpoint API, folder.
3. **Kirim prompt ke Claude Code.** Pakai template di bawah, ganti bagian `[dalam kurung]`.
4. **Uji kecil dulu.** Minta Claude menjalankan ke 10–20 item dan tunjukkan hasilnya sebelum memproses semua.
5. **Validasi.** Bandingkan dengan label manual (use case 7), lalu atur kategori dan ambang keyakinan.
6. **Sambungkan ke alur nyata.** Baru setelah itu jadikan endpoint, cron, tombol dashboard, atau fitur game.

Template prompt:

```
Tugas: [apa yang ingin dibangun].
Data: [lokasi data / format].
Keputusan Jev: [pertanyaan], pilihan: [A, B, C, Lainnya].
Kalau Jev kurang dari [60]% yakin, [kirim ke antrean manual].
Langkah yang butuh teks (balasan, ringkasan) dikerjakan Claude, bukan Jev.
Uji dulu di [10] contoh dan tunjukkan hasilnya sebelum menjalankan semuanya.

Connect to Jev via openrouter.ai if you don't have it yet.
```

---

## 4. Contoh use case untuk Aethergate

Tingkat: 🟢 mudah · 🟡 menengah · 🔴 lanjut.

### 1. 🟢 Triage laporan dan feedback pemain

**Masalah:** laporan pemain menumpuk; sebagian bug serius, sebagian saran, sebagian spam.
**Keputusan Jev:** kategori (menu) + seberapa yakin.

Langkah:

1. Kumpulkan laporan ke satu tempat (misalnya ekspor CSV atau tabel D1 baru `feedback`).
2. Kirim prompt di bawah ke Claude Code.
3. Periksa 20 hasil pertama; perbaiki nama kategori kalau banyak yang jatuh ke `lainnya`.
4. Atur ambang 60% sesuai pengalaman: naikkan kalau terlalu banyak salah, turunkan kalau antrean manual terlalu penuh.
5. Minta Claude menulis draf balasan hanya untuk kategori `pertanyaan`.

Prompt:

```
Buat skrip yang membaca [feedback.csv] (kolom: id, pesan, waktu). Untuk setiap pesan, tanya Jev:
kategori apa — bug, performa, saran, pertanyaan, spam, lainnya — dan seberapa yakin.
Tulis hasilnya ke feedback_tagged.csv. Pesan dengan keyakinan di bawah 60% masuk kolom
"perlu_dicek_manual". Buat 60% gampang diubah. Untuk kategori "pertanyaan", minta Claude menulis
draf balasan singkat dalam bahasa yang sama dengan pesannya.

Connect to Jev via openrouter.ai if you don't have it yet.
```

### 2. 🟢 Mengelompokkan error dari telemetri

**Masalah:** event `error` di `server/telemetry.ts` berisi pesan mentah dari berbagai browser; sulit melihat
mana yang paling sering dan dari subsistem mana.
**Keputusan Jev:** subsistem (menu) untuk setiap pesan error.

Langkah:

1. Ambil event `error` dari D1 (lokal dulu: `npm run db:seed:local`, lalu query lewat wrangler).
2. Tentukan daftar subsistem dari struktur `src/`: `render`, `map`, `world`, `trade`, `skirmish`, `net`, `ui`, `lainnya`.
3. Jalankan prompt; hasilnya tabel jumlah error per subsistem dan contoh pesan.
4. Error yang berulang di satu subsistem diserahkan ke Claude untuk dicari akar masalahnya di kode.

Prompt:

```
Ambil semua event telemetry bertipe "error" dari D1 lokal (lihat server/telemetry.ts untuk skemanya).
Untuk setiap pesan, tanya Jev subsistem mana yang paling mungkin: render, map, world, trade, skirmish,
net, ui, atau lainnya. Buat laporan Markdown: jumlah per subsistem, urutkan dari terbanyak, dengan
3 contoh pesan per subsistem. Jangan kirim data pribadi apa pun ke Jev, cukup teks error-nya.

Connect to Jev via openrouter.ai if you don't have it yet.
```

### 3. 🟢 Skor risiko pemain berhenti main (churn)

**Masalah:** ingin tahu pemain mana yang mulai menghilang sebelum benar-benar pergi.
**Keputusan Jev:** skor 1–10, lalu kelompok `Sehat` / `Perlu perhatian` / `Berisiko`.

Langkah:

1. Minta Claude menyusun ringkasan per pemain dari tabel sesi dan event: tanggal daftar, sesi terakhir,
   jumlah sesi 7 hari, misi selesai.
2. Jev memberi skor per pemain.
3. Tampilkan di dashboard (`dashboard/src/pages`) sebagai tabel yang diurutkan dari paling berisiko.
4. Untuk pemain berisiko, Claude bisa menyusun ide announcement (lihat `server/announcements.ts`).

Prompt:

```
Dari data sesi dan event di D1, buat satu baris ringkasan per pemain: tanggal pertama main, sesi
terakhir, jumlah sesi 7 hari terakhir, jumlah mission_done. Pakai Jev untuk memberi skor 1–10
kemungkinan pemain berhenti main, lalu kelompokkan: Sehat (1–3), Perlu perhatian (4–6), Berisiko (7–10).
Tambahkan halaman di dashboard yang menampilkan daftar ini, yang berisiko paling atas.

Connect to Jev via openrouter.ai if you don't have it yet.
```

### 4. 🟡 Memilih jenis NPC/ikon dari teks bebas pemain

Mirip use case 17 di panduan ("smart features for any app").
**Masalah:** pemain mengetik nama bangunan atau toko sendiri ("kedai kopi pelabuhan"), dan game perlu memilih
model/ikon yang cocok dari aset yang sudah ada.
**Keputusan Jev:** satu ID aset dari daftar, atau `none`.

Langkah:

1. Ambil daftar ID aset/ikon dari registry aset (lihat `docs/ASSETS.md`).
2. Buat endpoint kecil di backend yang menerima teks pemain dan mengembalikan ID aset pilihan Jev.
3. Jika Jev memilih `none` atau tidak yakin, pakai ikon bawaan.
4. Cache hasil per teks supaya teks yang sama tidak memanggil Jev dua kali.

Prompt:

```
Saat pemain memberi nama bangunan di mode kota, kirim namanya ke Jev bersama daftar ID ikon bangunan
dari registry aset, dan pakai ikon yang dipilih. Tambahkan opsi "none" untuk saat tidak ada yang cocok,
dan pakai ikon bawaan untuk itu. Panggil Jev dari endpoint backend (server/), jangan dari browser, supaya
API key tidak bocor. Cache jawaban per nama.

Connect to Jev via openrouter.ai if you don't have it yet.
```

### 5. 🟡 Jev memilih skill atau model untuk Claude Code

Use case 9 dan 10 di panduan.
**Masalah:** repo ini punya banyak dokumen dan skill (`.claude/`, `.agents/`); Claude kadang memuat yang tidak
relevan, dan tugas kecil tidak perlu model paling mahal.
**Keputusan Jev:** skill mana yang dimuat, atau tingkat tugas (`ringan` / `sedang` / `berat`).

Langkah:

1. Minta Claude membuat daftar skill dan deskripsinya.
2. Pasang hook/command yang mengirim tugas ke Jev sebelum skill dimuat.
3. Uji di 10 tugas lama; bandingkan pilihan Jev dengan skill yang seharusnya dipakai.
4. Log setiap pilihan supaya bisa dievaluasi.

Prompt:

```
Sebelum memuat skill, kirim tugas saya plus daftar nama dan deskripsi skill di repo ini ke Jev sebagai
pertanyaan pilihan, dan muat skill yang dipilih. Tambahkan opsi None. Uji pada 10 tugas saya sebelumnya
dan tunjukkan tabel: tugas, pilihan Jev, pilihan yang benar menurut kamu.

Connect to Jev via openrouter.ai if you don't have it yet.
```

### 6. 🟡 Filter email/pesan sebelum agen Claude membalas

Use case 11 di panduan.
**Masalah:** inbox support berisi campuran pertanyaan pemain, tawaran kerja sama, dan penipuan.
**Keputusan Jev:** tiga pertanyaan true/false per pesan: perlu dibalas? tawaran kerja sama? penipuan?

Langkah:

1. Hubungkan sumber pesan (email, Discord, form kontak).
2. Jev menjawab tiga pertanyaan untuk setiap pesan baru.
3. Hanya pesan "perlu dibalas" dan bukan penipuan yang diteruskan ke Claude untuk dibuatkan draf.
4. Tawaran kerja sama masuk label tersendiri untuk dibaca manual.

Prompt:

```
Sebelum agen email saya membuat draf apa pun, kirim setiap email baru ke Jev dengan tiga pertanyaan
true/false: perlu dibalas? tawaran kerja sama? penipuan? Hanya teruskan yang perlu dibalas dan bukan
penipuan ke Claude untuk dibuatkan draf. Tawaran kerja sama beri label "partnership".

Connect to Jev via openrouter.ai if you don't have it yet.
```

### 7. 🟢 Validasi Jev sebelum dipercaya (wajib untuk use case lain)

Use case 8 di panduan.

Langkah:

1. Labeli sekitar 200 contoh secara manual (misalnya feedback dari use case 1).
2. Bagi dua: separuh untuk mengatur kategori dan instruksi, separuh lagi hanya untuk mengukur.
3. Bandingkan jawaban Jev dengan label manusia.
4. Lihat di mana Jev paling sering salah, lalu perbaiki nama atau deskripsi kategori.
5. Pilih ambang keyakinan dari tabel akurasi per tingkat keyakinan.

Prompt:

```
Saya punya [labelled.csv] berisi sekitar 200 feedback yang sudah saya kategorikan sendiri. Bagi dua:
separuh pertama untuk mengatur kategori dan instruksi, separuh kedua hanya untuk laporan skor.
Jalankan setiap baris ke Jev, taruh jawaban dan keyakinannya di samping label saya, lalu tunjukkan
seberapa sering cocok, di mana paling sering berbeda, dan akurasi Jev di setiap tingkat keyakinan.

Connect to Jev via openrouter.ai if you don't have it yet.
```

### 8. 🔴 Halaman landing yang menyusun diri sendiri

Use case 18 di panduan.
**Masalah:** landing (`index.html`, `src/landing.js`) menampilkan bagian yang sama ke semua pengunjung.
**Keputusan Jev:** pilih 4 dari daftar section berdasarkan konteks pengunjung (bahasa, perangkat, pernah main atau belum).

Langkah:

1. Pecah landing menjadi section yang bisa ditukar: hero, screenshot level, manual, Trade Game, Skirmish, login.
2. Buat endpoint yang menerima konteks pengunjung (tanpa data pribadi) dan mengembalikan urutan section pilihan Jev.
3. Siapkan urutan bawaan kalau Jev lambat atau gagal, supaya halaman tidak pernah kosong.
4. Ukur lewat telemetri apakah klik **Play Game** naik.

Prompt:

```
Ubah landing page supaya menyusun diri sendiri. Section yang ada: hero, screenshot level, manual,
Trade Game, Skirmish, login. Saat pengunjung datang, kirim konteks yang kita tahu (bahasa, mobile atau
desktop, pernah main atau belum) ke Jev lewat endpoint backend, minta Jev memilih 4 section dan
urutannya, lalu tampilkan. Kalau Jev gagal atau lebih dari 300 ms, pakai urutan bawaan.
Catat event telemetry untuk urutan yang ditampilkan dan klik Play Game.

Connect to Jev via openrouter.ai if you don't have it yet.
```

### 9. 🔴 Mencari use case Jev sendiri

Use case 19 di panduan.

Langkah:

1. Buka `shipwithjev.com` untuk melihat daftar use case per kategori.
2. Berikan ke Claude bersama penjelasan tentang proyek dan bisnismu.
3. Minta Claude memeriksa sesi-sesi sebelumnya untuk menemukan langkah yang bisa digantikan panggilan Jev.

Prompt:

```
Ini shipwithjev.com dan docs/README.md tentang proyek saya. Berdasarkan yang kamu tahu tentang
Aethergate, lima build Jev mana yang paling membantu? Lalu lihat 20 sesi terakhir saya dan daftar
langkah yang sebenarnya cukup dijawab dengan satu panggilan Jev cepat.
```

---

## 5. Hal yang perlu dijaga

- **API key hanya di server.** Panggil Jev dari `server/` atau skrip lokal, jangan dari kode browser.
- **Jangan kirim data pribadi.** Kirim teks seperlunya (isi pesan, pesan error), bukan email, IP, atau deviceId.
- **Selalu ada fallback.** Fitur game harus tetap jalan kalau Jev gagal: ikon bawaan, urutan bawaan, antrean manual.
- **Ukur dulu.** Jalankan use case 7 sebelum hasil Jev dipakai untuk keputusan yang berdampak ke pemain.
- **Jev tidak menulis.** Kalau hasil yang dibutuhkan berupa kalimat, itu tugas Claude.

## Rujukan

- *Jev Use Cases Guide*, RoboNuggets (19 use case, satu prompt per use case).
- Skill suggestion cookbook: `docs.typesafe.ai/cookbooks/skill_suggestion`
- Daftar use case per kategori: `shipwithjev.com`
- Model di OpenRouter: `typesafe/jev-1.13`
