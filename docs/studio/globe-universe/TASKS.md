# Studio tasks

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

## M1 — fondasi aman — berjalan

| ID | Owner | Deliverable | Dependency | Acceptance | Status |
|---|---|---|---|---|---|
| M1-E1 | Sonnet engineer | Kontrak versi save: satu sumber versi generator (`identity.js` vs `TOWN_LAYOUT_VERSION`), karantina record interior/home schema tak dikenal (bukan ditimpa), fixture save lintas versi pada subdivision 5 | — | Test baru gagal sebelum perbaikan dan lulus sesudah; tidak ada penimpaan diam-diam (G-03, V-06) | **Done** (handoff M1-E1.md; 215 test lolos; diterima lead) |
| M1-E2 | Sonnet engineer | Identitas dunia & misi: gagal simpan peta terlihat di UI, misi/tips per dunia dengan migrasi key lama, konfirmasi regenerate | M1-E1 | Test dua seed tidak berbagi misi; kegagalan storage ter-surface (G-04) | **Done** (handoff M1-E2.md; 226 test lolos; diterima lead. Keputusan: intro sekali per perangkat → M2-E1) |
| M1-E3 | Sonnet engineer | Jalur gagal Director/TownMode: pemulihan ke mode aman tanpa reload, `planetPack` non-fatal, batalkan enter/exitBuilding saat `exit()` | M1-E1 | Test injeksi gagal per mode + race fade (G-06, V-05) | Dispatched (setelah E2) |
| M1-Q1 | AGY QA | `tools/qa/smoke_routes.mjs`: semua route (`#/space`, planet, town, interior, `#/home`, `#/trade`, `farm.html`, `skirmish.html`), baca `engine.lastError`/page error/geometry-texture sebelum-sesudah 6 siklus; output JSON bertanggal | — | Skrip jalan pada server lokal; report di `docs/qa/smoke/` (G-08, V-04, V-10) | Dispatched |
| M1-A1 | Sol artist | `ART_BOOK_GAP.md`: kajian art sprint + ART_DIRECTION/FARM_PLAN → apa yang harus dilengkapi art direction book agar dunia hidup, dan peta implementasinya ke modul/aset | — | Gap list dengan prioritas, acceptance, dependency; catat versi sprint (jumlah gambar/tanggal) yang dikaji | **Done** (ART_BOOK_GAP.md diterima lead) |
| M1-L1 | Lead | Rekonsiliasi registry docs (K1–K14), integrasi, QA akhir, commit M1 | E1–E3, Q1 | Semua acceptance M1 di STUDIO.md | Pending |

## M2 — slice Universe end-to-end — persiapan

Spesifikasi: [M2_SLICE_SPEC.md](M2_SLICE_SPEC.md).

| ID | Owner | Deliverable | Dependency | Acceptance | Status |
|---|---|---|---|---|---|
| M2-A0 | Sol artist | M2_UX_SPEC.md: copy ID/EN + key i18n, spesifikasi visual wayfinding, checklist review screenshot | M2_SLICE_SPEC | Teks lengkap J1–J6 + tip home + pesan save; spesifikasi beacon/panah/pin/sorot | Dispatched |
| M2-E1 | Sonnet engineer | journey.js + starterHome.js + objectiveHud + waypoint; pecah TownMode bagian portal/marker | M1 selesai, M2-A0 | Acceptance 1 & 4 di spesifikasi | Queued |
| M2-Q1 | AGY QA | journey_e2e.mjs + perf_routes.mjs | M2-E1 | Acceptance 2 & 3 | Queued |
