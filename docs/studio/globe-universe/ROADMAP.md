# Roadmap — Globe Universe (usulan checkpoint 10 Oktober 2026)

Pemilik: globe-lead (ST-03). Status: **final untuk checkpoint; menunggu keputusan pengguna** (lihat [CHECKPOINT.md](CHECKPOINT.md)). Usulan, bukan jadwal: tidak ada tanggal presisi. Item checklist dirujuk ke [GAME_CHECKLIST.md](GAME_CHECKLIST.md).

Role: **Lead** (Opus 5.5), **Eng** (Sonnet 5.5), **Art** = design/technical artist (Sol 6.1), **PO** = pengguna (product owner/director). Semua langkah yang menulis source, commit, menjalankan server/test/QA, atau memakai Blender membutuhkan **mandat baru dari PO**; mandat sekarang hanya review.

## P0 — Amankan, ukur ulang, dan putuskan arah

| ID | Deliverable | Owner / reviewer | Dependency | Acceptance (bukti selesai) | Checkpoint pengguna |
|---|---|---|---|---|---|
| P0-1 | Rencana commit per produk (Trade / Valley / Town+cozy+landing / docs) + keputusan `.gitignore` untuk `output/`, `__pycache__`, `.blend1` | Eng / Lead; commit oleh PO atau atas izin eksplisit, di branch non-main | — | Daftar file per commit; `git status` bersih kecuali WIP sengaja (A1) | **Ya:** PO menyetujui rencana dan siapa yang commit |
| P0-2 | Baseline segar: `npm test`, `npm run build`, ulang `tools/qa/trade_game.mjs` + `trade_campaign.mjs` | Eng / Lead | P0-1 | Log bertanggal, jumlah test + versi Node, `report.json` Trade baru dibandingkan dengan 9 Okt (V-01–V-03; A2) | Ringkasan hasil |
| P0-3 | Keputusan produk: slice yang dinilai pertama (Universe atau Trade), arah rig kanonik, target perangkat minimum | PO; Lead + Art menyiapkan brief | Review ST-01/ST-02 (selesai) | Satu brief alur + fixture + pertanyaan evaluasi; keputusan rig dan perangkat tertulis (B1, B2, DA-01) | **Ya:** keputusan PO |
| P0-4 | Kontrak versi & save: satu sumber versi, karantina record tak dikenal, fixture save lintas versi, misi per dunia, gagal-simpan terlihat | Eng / Lead | P0-1 | Test fixture V-06 lulus; tidak ada penimpaan diam-diam (A3, A4) | Demo + hasil test |
| P0-5 | Jalur gagal & smoke lintas route: injeksi gagal per mode, navigasi saat fade, satu perintah smoke semua route termasuk `farm.html`/`skirmish.html` | Eng / Lead | P0-2 | V-04, V-05, V-10 lulus; JSON bertanggal di `docs/qa/` (A5, A7) | Ringkasan |
| P0-6 | Rekonsiliasi registry docs: IMPLEMENTATION_STATUS per produk, indeks docs, ARCHITECTURE (Home, Pixel, i18n, hosting), ASSETS | Lead / Eng | P0-2 (angka baru) | K1–K14 tertutup atau dicatat; tiap angka punya tanggal dan cara ukur (A10) | Review singkat |

## P1 — Validasi pengalaman dan target perangkat

| ID | Deliverable | Owner / reviewer | Dependency | Acceptance | Checkpoint pengguna |
|---|---|---|---|---|---|
| P1-1 | **Slice terpilih + playtest formatif** (default: perjalanan Universe 4 skala + satu perubahan persisten; alternatif: slice Trade) | Art (design) + Eng / Lead; PO menilai | P0-3, P0-2; P0-4 bila Universe | 3 pemain baru, fixture tercatat; target awal 2/3 selesai tanpa bantuan verbal; daftar friksi diprioritaskan (DA-02, A12) | **Ya:** PO menilai rasa permainan |
| P1-2 | Parity visual lintas skala untuk fixture slice (landmark, pintu, interior, Home, siang/malam, high/low) | Art / PO | P1-1 fixture | Pasangan capture + daftar perbaikan kecil berbasis bukti (DA-03, B4) | Review visual |
| P1-3 | Baseline perangkat: ≥1 iGPU lama, 1 laptop baru, M1 Pro; transfer terkompresi per rute, p95/p99, memori, soak 30 menit/20 pergantian mode | Eng + Art / Lead | P0-3 (perangkat), P0-2 | Tabel per perangkat; N/A dijelaskan (V-07, V-08, DA-04, A9) | **Ya:** PO menetapkan budget Hemat |
| P1-4 | Kontrak modul bersama Town⇄Skirmish⇄Valley + test statis import/pack | Eng / Art | P0-3 (rig), P0-5 | Daftar modul/aset + pemilik + QA wajib saat berubah (A6) | — |
| P1-5 | Ketahanan Trade: batas akumulator, resume dari `base`, soak tab latar | Eng / Lead | P0-2; keputusan PO soal toleransi perubahan generator | V-09 + test jam terkontrol (A8) | Bila slice Trade dipilih |
| P1-6 | Registry pipeline aset (active/legacy/standalone, source, input eksternal + lisensi, hash) | Art / Eng | — | Tiap pack aktif punya rantai source → export → loader → QA (A11, DA-05) | — |
| P1-7 | Listening pass audio + pass locomotion/action pada slice | Art / Eng | P1-1 | 10 menit tanpa click/lonjakan; foot contact/seat/event frame terekam (B7, DA-07) | — |

## P2 — Ekspansi setelah keputusan P1

| ID | Deliverable | Owner / reviewer | Dependency | Acceptance | Checkpoint pengguna |
|---|---|---|---|---|---|
| P2-1 | Profil Hemat: body/texture ringan untuk Low, lazy interior, buang aset yatim, cache berbatas | Eng + Art / Design | P1-3 | Budget rute/perangkat terpilih tercapai; parity siluet/gameplay lulus (DA-06, B5) | Hasil ukur sebelum/sesudah |
| P2-2 | Port Valley bertahap: satu keluarga material/aset/rig sebagai proof | Art + Eng / PO | P0-3 (rig), P1-2, P1-3, P0-4 (untuk G2) | Proof diterima dengan budget; collider/portal/hero/save tetap benar (DA-08, B3) | Per keluarga |
| P2-3 | Iterasi core loop dari hasil slice (household/POI hanya sejauh dibutuhkan loop) | Art + Eng / Lead | P1-1 | Loop kedua lulus playtest; state baru ber-versi (C1) | Playtest PO |
| P2-4 | Iterasi Trade (tuning, strategi QA tambahan, keputusan B6) | Art + Eng / Lead | P1-1/P1-5 | Sesuai keputusan PO | PO |
| P2-5 | Pemecahan file monolit (`planetRenderer.js`, `TownMode.js`) bila menghambat P1/P2 | Eng / Lead | P0-5 smoke sebagai pengaman | Perilaku identik (hash/fixture), smoke lulus | — |

## Urutan dependency ringkas

`P0-1 → P0-2 → (P0-4, P0-5, P0-6)`; `P0-3` paralel dan menjadi gerbang `P1-1/P1-3/P1-4`; P2 hanya setelah checkpoint P1 disetujui PO.
