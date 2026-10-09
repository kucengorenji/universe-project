# Checkpoint 1 — Review Globe Universe (10 Oktober 2026)

Status: **READY — menunggu keputusan pengguna.** Lead: globe-lead (Opus 5.5 medium). Input: [ENGINEERING_REVIEW.md](ENGINEERING_REVIEW.md) (ST-01, Sonnet 5.5 high), [DESIGN_ART_REVIEW.md](DESIGN_ART_REVIEW.md) (ST-02, Sol 6.1 high). Output gabungan: [PROGRESS_MATRIX.md](PROGRESS_MATRIX.md), [GAME_CHECKLIST.md](GAME_CHECKLIST.md), [ROADMAP.md](ROADMAP.md).

**Batas checkpoint:** review source/artefak dan QA historis saja. Tidak ada test, build, server, browser QA, profiling, generator, atau playtest manusia yang dijalankan. Tidak ada source, aset, atau dokumen lama yang diubah, dan tidak ada commit.

## Temuan terpenting

1. **Pekerjaan terbesar belum masuk git.** Seluruh Trade v1, Valley/Farm, town walk/cozy actors, QA tools, dan dokumen 9–10 Okt berstatus untracked di branch `feat/skirmish-vc`. Commit terakhir hanya berisi landing (8 Okt). Ini risiko kehilangan kerja nomor satu (G-01).
2. **Produk nyata ada tiga, dan statusnya berbeda.**
   - **Universe** (space→planet→town→interior/home) terhubung di Director dan terverifikasi di source, tetapi **belum punya tujuan pemain terarah**: loop-nya masih sandbox ditambah checklist.
   - **Trade v1** adalah loop paling lengkap: 15/15 check browser lolos pada 9 Okt, dan satu strategi mencapai target. Belum ada playtest manusia.
   - **Valley** adalah prototype look-dev yang belum terintegrasi.
   - **Skirmish** adalah eksperimen terpisah, tetapi kode dan asetnya sudah dipakai Town.
3. **Save adalah risiko teknis terbesar.**
   - Versi generator tidak sinkron (`town:3` vs layout v5).
   - Record interior dengan schema tak dikenal ditimpa diam-diam.
   - Identitas dunia bertumpu pada satu entri localStorage yang gagal simpan tanpa pesan.
   - Trade tidak punya jalur migrasi (G-03, G-04, G-07).
4. **Tidak ada gerbang regresi.**
   - Tidak ada CI dan tidak ada smoke lintas route.
   - Skirmish tidak punya QA browser.
   - Town bergantung pada modul Skirmish/`chunkyPeople` yang sedang berubah tanpa test pengaman (G-02, G-08).
5. **Komputer lemah belum terbukti sama sekali.**
   - Jalur masuk Town = 38,08 MB di disk (dihitung ulang, cocok dengan laporan 9 Okt).
   - Low tetap memuat dua template v5 + empat atlas 2048².
   - Semua angka FPS dari M1 Pro. Budget "Hemat" masih usulan.
6. **Dokumen status tidak bisa dipercaya sebagai sumber kebenaran.** Ada 14 kontradiksi (jumlah test 15/30/197, layout v4 vs v5, hosting Firebase vs Cloudflare, README "empat level" tanpa Home/Trade/Valley/Skirmish).
7. **Arah karakter bertentangan antar dokumen:** Town memakai humanoid v5 (8 Okt), sedangkan FARM_PLAN G5 ingin semi-chibi 4,5 kepala untuk seluruh Universe. Ini keputusan pengguna, bukan keputusan audit.

## Yang masih belum diketahui

- Apakah working tree saat ini lolos test/build, dan berapa jumlah test sebenarnya.
- Perilaku runtime semua mode setelah WIP 9–10 Okt (`chunkyPeople.js` dan `src/valley/` berubah setelah QA Trade terakhir).
- Performa, memori, dan transfer di laptop iGPU / RAM 8 GB.
- Apakah ada mode yang **menyenangkan dan dapat dipahami** pemain baru. Belum ada playtest manusia untuk produk mana pun.
- Internal `SpaceMode`, `menuController` (apakah regenerate memberi peringatan), bagian dalam `planetRenderer`, pemakaian runtime `firebase`.
- Lokasi/kelengkapan source authoring humanoid v5 (input VRoid/UAL eksternal; `.blend` v5 tidak ditemukan) dan kesiapan Blender bridge untuk produksi.
- Proses eksternal yang sedang menulis `output/universe-art-sprint/`. Folder ini bukan milik studio dan bukan bagian audit.

## Opsi milestone berikutnya (pilih satu)

Ketiga opsi diawali gerbang yang sama: **P0-1 rencana commit** (butuh izin Anda) dan **P0-2 baseline segar**. Tanpa keduanya, opsi apa pun dibangun di atas kerja yang belum aman.

| Opsi | Isi | Kelebihan | Risiko / biaya |
|---|---|---|---|
| **A. Stabilisasi saja** | P0 penuh (commit, baseline, kontrak save, jalur gagal + smoke, docs). Tanpa slice baru. | Risiko teknis turun paling cepat; dokumen kembali bisa dipercaya | Belum menjawab "apakah game ini menyenangkan"; tidak ada bukti pemain |
| **B. Slice Universe terukur** *(rekomendasi)* | Gerbang P0-1/P0-2 + P0-3 (keputusan) + P0-4 save; lalu P1-1 slice "satu planet, satu kota, satu rumah, satu perubahan persisten" dengan 3 pemain baru, P1-2 parity visual, P1-3 baseline perangkat | Menguji produk inti dengan sistem yang sudah ada; menghasilkan bukti pemain + perangkat sekaligus; save yang diperkuat langsung dipakai slice | Butuh izin runtime/QA dan perangkat iGPU; scope harus ketat (tanpa port Valley/rig baru) |
| **C. Slice Trade** | Gerbang P0-1/P0-2 + playtest Trade + P1-5 ketahanan (tick, resume, soak) + tuning | Loop paling matang; hasil cepat; tidak menyentuh Town | Produk inti Universe tetap tanpa tujuan; risiko save Universe tetap terbuka |

**Rekomendasi lead: Opsi B.** Universe adalah identitas proyek, dan kedua review sepakat bahwa sistemnya cukup untuk dirangkai menjadi satu perjalanan yang bisa dinilai tanpa fitur WB-05–08. Kontrak save (P0-4) wajib karena slice bergantung pada perubahan persisten. Pilih C bila prioritas Anda saat ini adalah kedalaman keputusan ekonomi. Pilih A bila Anda ingin mengamankan repo dulu sebelum menilai gameplay.

## Keputusan yang dibutuhkan dari Anda

1. Opsi milestone: A, B, atau C.
2. Izin dan cara commit pekerjaan 8–10 Okt: siapa yang commit, branch apa, pemecahan per produk (P0-1).
3. Arah rig kanonik: Town v5 humanoid vs semi-chibi Valley, dan cakupan port Valley.
4. Perangkat target minimum (usulan: laptop iGPU, RAM 8 GB, 30 FPS profil Hemat).
5. Mandat baru untuk menjalankan test/build/server/browser QA, karena mandat sekarang hanya review.

Studio berhenti di sini. Tidak ada implementasi atau agent tambahan sampai Anda memutuskan.
