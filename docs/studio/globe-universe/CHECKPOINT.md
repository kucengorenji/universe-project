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

---

# Checkpoint fase 2 — status otomatis (diperbarui lead, 10 Okt 2026 ±07:50 WIB)

Pengguna memilih Opsi B dan meminta lead bekerja otomatis sampai M3, lalu berhenti di checkpoint terdekat bila sumber daya habis.

## Selesai dan ter-commit (branch `feat/skirmish-vc`, worktree `/Users/mikelrisyad/Developer/globe-studio`, belum di-push)

| Milestone | Commit | Bukti |
|---|---|---|
| M0 repo rapi | `968939c` Town, `36e7fa1` Trade, `57860e2` Valley, `0beb9c9` Docs (menggantikan commit besar `5033bd3`; backup `backup/skirmish-vc-5033bd3`) | Tiap snapshot build lolos; 202/202 test |
| M1 fondasi aman | `d787415` kode, `2e21fed` docs, `5cc57ea` smoke QA | 244/244 test, build lolos; smoke 9/9 route PASS, 0 error (docs/qa/smoke) |

## Sedang berjalan (M2 "Perjalanan Pertama")

- Spesifikasi: [M2_SLICE_SPEC.md](M2_SLICE_SPEC.md) (lead) dan [M2_UX_SPEC.md](M2_UX_SPEC.md) (artist, copy ID/EN + wayfinding).
- Engineer: `journey.js`, `starterHome.js` sudah ada sebagai WIP belum ter-commit; HUD/waypoint/test belum selesai.
- AGY: baseline perf `tools/qa/perf_routes.mjs` (berjalan).
- Kajian art book: [ART_BOOK_GAP.md](ART_BOOK_GAP.md) selesai (AB-01…AB-09).

## Hambatan nyata

- **Mac tidur berulang** (baterai, lid kemungkinan tertutup): sejak ±04:45 tiap respons worker terputus "computer went to sleep", sehingga M2 hanya maju beberapa menit per jam. `caffeinate -i` tidak cukup saat lid tertutup/baterai. Untuk kerja otomatis yang lancar: colokkan charger dan biarkan lid terbuka.
- Quota: Codex 5 jam 17% (pukul 04:40), Claude tidak terbaca lokal, AGY tidak tersedia. Bukan penghambat saat ini.

## Keputusan sementara lead (bisa Anda ubah saat review)

- Kartu intro sekali per perangkat; misi/tips per dunia.
- Perubahan persisten slice = nyalakan lampu/taruh barang di rumah awal.
- Clock tetap world clock existing; musim otomatis, tinggi fisik dewasa, rutinitas warga ditunda ke M3.
- Arah karakter mengikuti art sprint (dewasa 4,5–5 kepala); swap rig hanya setelah proof M3.
