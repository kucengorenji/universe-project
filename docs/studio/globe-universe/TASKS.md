# Studio tasks

## Status sekarang (10 Okt 2026, 11:35 WIB) — baca ini dulu

**M0 Repo rapi** ✅ selesai
- [x] Commit besar dipecah per produk (Town/Trade/Valley/Docs), backup `backup/skirmish-vc-5033bd3`
- [x] Baseline: build lolos, 202/202 test

**M1 Fondasi aman** ✅ selesai — commit `d787415`, `2e21fed`, `5cc57ea`
- [x] Kontrak versi save + karantina record tak dikenal (E1)
- [x] Misi/tips per dunia, gagal simpan terlihat, konfirmasi regenerate (E2)
- [x] Pemulihan mode gagal tanpa reload, transisi interior aman (E3)
- [x] Smoke semua route 9/9 PASS, 0 error (Q1)
- [x] Docs registry dikoreksi (hosting, route Home, indeks, status per produk)
- [x] 244/244 test

**M2 Slice "Perjalanan Pertama"** 🟡 kode selesai, QA belum — commit `9a970aa`, `6ec14aa`
- [x] Spesifikasi slice (lead) + UX/copy ID-EN (artist)
- [x] Journey J1–J6, rumah awal, HUD tujuan, beacon/panah/pin, sorot planet & kota asal
- [x] 281/281 test, build lolos, probe browser engineer J1→selesai + reload tanpa error
- [x] Baseline perf (build produksi, 6ec14aa): awal sampai Space 0,88 MiB, Planet 1,51 MiB (✓ budget 10); Town 36,95 MiB (✗ → diperbaiki M3-E2). Catatan run 2 dev server: **transfer cold Town ≈45 MiB** (budget 10+15) = gap terbesar; heap Planet ≈254 MiB (anomali, telusuri); frame 16,7 ms terkunci vsync → belum informatif; throttled walk/interior + soak belum tercatat. Perlu run ulang di build produksi (vite preview) + metode GPU-saturation
- [x] E2E journey resmi: **10/10 langkah lolos** di build produksi, trace bertahan setelah reload (commit `ea7d8c3`)
- [x] Screenshot diambil ulang dengan intro ditutup dan direview artist (lihat M3)
- [ ] Playtest oleh Anda

**M3 Dunia hidup + Hemat** 🟡 berjalan — commit `ff058fe` (proof 1–3 + lazy interior)
- [x] Kajian art book (ART_BOOK_GAP) + draft LIVING_WORLD_BOOK (77/80 gambar sprint dikaji)
- [x] Proof 1 rumput tersibak pemain
- [x] Proof 2 warga bernama "Damar" menyapa
- [x] Proof 3 malam hangat, rumah tetap terbaca
- [x] Hemat quick wins: furniture/interior lazy, aset yatim tidak dimuat
- [x] Hemat bytes (commit `9ec11fd`): masuk Town 36,9 → **22,6 MB** Normal / **19,7 MB** Low (disk; estimasi gzip 11,9 / 9,3 MiB = di bawah budget 15 MiB), heap Planet 240 → **62 MiB**, pin rumah tak lagi tertutup panel; 333 test
- [x] QA penutup M3 di build produksi `9ec11fd`: smoke **9/9 PASS** ✓; e2e ulang **done** + screenshot HUD/beacon/malam ✓; proof capture (Damar menyapa, rumput, malam, lazy) ✓; perf: Low + CPU 4× Town p95 16,4 / p99 19,9 ms (**✓ budget 40/50**, proxy M1 Pro), heap 35–55 MiB ✓, transfer Town tanpa kompresi 31,6 (Normal) / 26,2 MiB (Low) — angka terkompresi nyata belum diukur; soak 20× plateau, tetapi **texture +1 per putaran** (kebocoran kecil, perlu diperbaiki)
- [x] Review visual artist (M3-A2): **belum lolos visual penuh** → 6 perbaikan kecil R1–R6 (tumpukan tip/prompt/toast, notifikasi menutup objective, **kota asal tak terlihat di Planet (J2)**, panah menutup strip kontrol, bukti aksi lampu via E, modal selesai)
- [x] Kebocoran texture diperbaiki (shadow map lampu interior tak di-dispose); texture stabil di semua putaran; 340 test (commit `428a789`*)
- [ ] R1–R6 perbaikan UI (sebagian R1/R2 sudah di `428a789`; sisanya engineer M3-E4, berjalan)
- [x] Struktur rapi (commit `de7c37f`): TownMode 1.743 → **392 baris** + 7 controller (<400 baris), 339 test, test lama tidak diubah
- [ ] Smoke + e2e ulang setelah refactor, commit M3

**Butuh keputusan Anda saat review:** tinggi dewasa 1,65 m (usulan artist), budget Hemat rinci, intro sekali per perangkat (keputusan sementara lead).
**Hambatan:** Mac sempat tidur berulang (04:45–08:00). Limit Claude habis ±10:40–11:30 (lead + engineer berhenti). Codex 5 jam 97% (reset 13:08) → artist ditahan.

\* `428a789` (11:25) **bukan dibuat lead/worker studio** — kemungkinan sesi lain atau Anda saat limit; isinya sah (fix texture, sebagian R1/R2, artefak QA) dan dibiarkan apa adanya.

---


Board ditulis hanya oleh lead (globe-lead). Worktree kerja: `/Users/mikelrisyad/Developer/globe-studio`. Milestone dan aturan: [STUDIO.md](STUDIO.md) §Fase 2.

## Checkpoint 1 (review) — selesai

| ID | Owner | Deliverable | Status |
|---|---|---|---|
| ST-01 | Sonnet engineer | ENGINEERING_REVIEW.md | Done |
| ST-02 | Sol artist | DESIGN_ART_REVIEW.md | Done |
| ST-03 | Opus lead | PROGRESS_MATRIX, GAME_CHECKLIST, ROADMAP, CHECKPOINT | Done; pengguna memilih Opsi B |

## M0 — repo rapi + baseline — selesai

| ID | Owner | Deliverable | Status |
|---|---|---|---|
| M0-1 | Lead | 4 commit per produk menggantikan `5033bd3` (tree identik + `.gitignore`) | Done: `968939c`, `36e7fa1`, `57860e2`, `0beb9c9` |
| M0-2 | Lead | Baseline: build per snapshot, `npm test` | Done: 202/202 lolos, build lolos |

## M1 — fondasi aman — **selesai 10 Okt**

| ID | Owner | Deliverable | Dependency | Acceptance | Status |
|---|---|---|---|---|---|
| M1-E1 | Sonnet engineer | Kontrak versi save: satu sumber versi generator (`identity.js` vs `TOWN_LAYOUT_VERSION`), karantina record interior/home schema tak dikenal (bukan ditimpa), fixture save lintas versi pada subdivision 5 | — | Test baru gagal sebelum perbaikan dan lulus sesudah; tidak ada penimpaan diam-diam (G-03, V-06) | **Done** (handoff M1-E1.md; 215 test lolos; diterima lead) |
| M1-E2 | Sonnet engineer | Identitas dunia & misi: gagal simpan peta terlihat di UI, misi/tips per dunia dengan migrasi key lama, konfirmasi regenerate | M1-E1 | Test dua seed tidak berbagi misi; kegagalan storage ter-surface (G-04) | **Done** (handoff M1-E2.md; 226 test lolos; diterima lead. Keputusan: intro sekali per perangkat → M2-E1) |
| M1-E3 | Sonnet engineer | Jalur gagal Director/TownMode: pemulihan ke mode aman tanpa reload, `planetPack` non-fatal, batalkan enter/exitBuilding saat `exit()` | M1-E1 | Test injeksi gagal per mode + race fade (G-06, V-05) | **Done** (244 test; commit d787415) |
| M1-Q1 | AGY QA | `tools/qa/smoke_routes.mjs`: semua route (`#/space`, planet, town, interior, `#/home`, `#/trade`, `farm.html`, `skirmish.html`), baca `engine.lastError`/page error/geometry-texture sebelum-sesudah 6 siklus; output JSON bertanggal | — | Skrip jalan pada server lokal; report di `docs/qa/smoke/` (G-08, V-04, V-10) | **Done** (9/9 PASS; commit 5cc57ea) |
| M1-A1 | Sol artist | `ART_BOOK_GAP.md`: kajian art sprint + ART_DIRECTION/FARM_PLAN → apa yang harus dilengkapi art direction book agar dunia hidup, dan peta implementasinya ke modul/aset | — | Gap list dengan prioritas, acceptance, dependency; catat versi sprint (jumlah gambar/tanggal) yang dikaji | **Done** (ART_BOOK_GAP.md diterima lead) |
| M1-L1 | Lead | Rekonsiliasi registry docs (K1–K14), integrasi, QA akhir, commit M1 | E1–E3, Q1 | Semua acceptance M1 di STUDIO.md | **Done** (commit d787415, 2e21fed, 5cc57ea) |

## M2 — slice Universe end-to-end — persiapan

Spesifikasi: [M2_SLICE_SPEC.md](M2_SLICE_SPEC.md).

| ID | Owner | Deliverable | Dependency | Acceptance | Status |
|---|---|---|---|---|---|
| M2-A0 | Sol artist | M2_UX_SPEC.md: copy ID/EN + key i18n, spesifikasi visual wayfinding, checklist review screenshot | M2_SLICE_SPEC | Teks lengkap J1–J6 + tip home + pesan save; spesifikasi beacon/panah/pin/sorot | Dispatched |
| M2-E1 | Sonnet engineer | journey.js + starterHome.js + objectiveHud + waypoint; pecah TownMode bagian portal/marker | M1 selesai, M2-A0 | Acceptance 1 & 4 di spesifikasi | Dispatched |
| M2-Q1 | AGY QA | journey_e2e.mjs + perf_routes.mjs | M2-E1 | Acceptance 2 & 3 | Queued |
