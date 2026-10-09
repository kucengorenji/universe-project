# Globe Universe — studio dan checkpoint pertama

Konfigurasi disubmit pengguna 10 Oktober 2026. Root: `/Users/mikelrisyad/Developer/globe`; branch saat bootstrap `feat/skirmish-vc`. Checkout memiliki WIP pengguna; audit memakai kondisi working tree aktual, tanpa stash/reset/worktree yang kehilangan WIP.

## Mandat

Tahap pertama: review proyek, membaca dokumentasi, memetakan progres yang benar-benar terbukti, checklist game yang kurang, dan roadmap berikutnya. Pengguna memilih lead + checkpoint dan maksimal tiga agent produk aktif. Implementasi fitur, perombakan visual, commit, push, deploy, layanan/API berbayar, serta perubahan global configuration belum termasuk mandat.

Pengguna adalah product owner/director. Lead membantu sebagai producer/principal dan integrator; perubahan arah gameplay, scope, stack, atau art direction kembali ke pengguna. Pertahankan eksplorasi normal dan Trade sebagai mode terpisah; jangan mengubah keputusan produk dari audit saja.

## Tim

| Role | Model | Effort | Ownership output |
|---|---|---|---|
| Lead/principal | Claude Opus 5.5 (`claude-opus-5-5`) | Medium | TASKS, PROGRESS_MATRIX, GAME_CHECKLIST, ROADMAP, CHECKPOINT; RUNTIME setelah handover |
| Engineering | Claude Sonnet 5.5 (`claude-sonnet-5-5`) | High | ENGINEERING_REVIEW.md |
| Design/technical artist | Codex GPT-6.1 Sol (`gpt-6.1-sol`) | High | DESIGN_ART_REVIEW.md |

Tidak ada AGY, Sonnet subagent tambahan, atau reviewer permanen pada milestone ini. Model/effort dan ID aktual dicatat di RUNTIME.json. Maksimal tiga role studio aktif; bootstrap bukan worker permanen dan menyerahkan dispatch kepada satu lead.

## Batas file dan tools

- Semua role boleh membaca dokumen dan source yang relevan secara terarah. Jangan membaca `.env*`, credential, API keys, atau token. Jangan memindai seluruh repo sekaligus; mulai dari indeks docs dan route ke file yang relevan.
- Source game, aset, generator, test, dokumen existing, dan konfigurasi global tetap read-only. Hanya file output role di `docs/studio/globe-universe/` yang boleh ditulis. Lead satu-satunya pemilik board dan output gabungan; worker tidak mengedit hasil worker lain.
- Boleh menjalankan pemeriksaan read-only yang terarah, serta mengambil metadata ukuran/hash file aset. Tahap ini tidak menjalankan generator Blender, rebuild aset, install dependensi, server QA, atau paid inference/image/3D services. Jika suatu status membutuhkan runtime/playtest baru, tulis belum diverifikasi dan rencana pengukurannya.
- Dokumen/test/QA report yang ada adalah bukti historis. Bedakan reviewed source, recorded QA, fresh runtime verification, dan human playtest. Jangan mengklaim test/build/performa terbaru hanya dari log lama.
- Source editable/GLB yang tersedia tidak membuktikan Blender MCP tersedia. Design/technical artist harus mengecek pipeline dan batas tool sebelum mengusulkan produksi, bukan membuat aset baru sekarang.

## Sumber awal

Mulai dari `docs/README.md`, `docs/IMPLEMENTATION_STATUS.md`, `docs/ARCHITECTURE.md`, `docs/ASSETS.md`, `docs/ART_DIRECTION.md`, `docs/WORLD_BUILDING_ROADMAP.md`, `docs/ASSET_ART_AUDIO_PLAN.md`, `docs/TRADE_GAME_RUNTIME.md`, `docs/FARM_PLAN.md`, dan `docs/WEBGAME_RESOURCE_PERFORMANCE_REPORT_2026_10_09.md`. Ikuti hanya tautan yang relevan. Dokumen asset/art yang diperbarui sebagian mungkin masih berisi angka atau diagnosis lama.

Petakan Universe utama (space/planet/town/interior/home bila relevan), Trade Game, serta prototype seperti Valley/Farm dan Skirmish sebagai produk/eksperimen berbeda sampai integrasinya terbukti. Jangan mengubah seluruh proyek menjadi prosentase 25–30% checkpoint September.

## Acceptance checkpoint pertama

1. Matriks per subsystem: tujuan, status (terverifikasi/parsial/rencana/belum diverifikasi), bukti file/tanggal, kekurangan, owner dan dependency. Definisikan batas kata terverifikasi: source/artifact vs runtime terbaru.
2. Engineering review mencocokkan docs dengan kode/test/artifact, membedakan prototype dan integrasi, serta memetakan risiko save/migration/navigation/lifecycle/resource/QA.
3. Design/technical-art review menilai pengalaman pemain/core loop/onboarding/progression, kontrak visual dan aset/rig/animasi/audio; rencana lama bukan cacat visual terkini tanpa bukti.
4. Checklist memisahkan bug/gap wajib, peluang design, dan fitur yang sengaja ditunda. Tiap item mempunyai acceptance dan dependency yang bisa diperiksa.
5. Roadmap P0/P1/P2 berisi deliverable, owner/reviewer, dependency, bukti selesai dan checkpoint pengguna. Jangan memberi jadwal presisi atau menambah scope tanpa dasar.
6. CHECKPOINT.md menyampaikan temuan terpenting, apa yang masih tidak diketahui, serta paling banyak tiga pilihan milestone berikutnya dengan rekomendasi.

## Koordinasi

Bootstrap membuat layout, start/verify session, dan dispatch brief awal sesuai board. Setelah lead menerima handover, lead satu-satunya controller dispatch. Worker melapor ringkas di sesi masing-masing dan menyimpan review miliknya; lead membaca artefaknya dan memperbarui TASKS. Jangan men-spawn agent/subagent baru atau mengirim tugas ke sesi lain di luar studio.

Saat worker blocked/unknown, lead memeriksa status/output dan laporkan kebutuhan nyata kepada pengguna; jangan menjawab dialog permission secara otomatis. Gunakan skill Herdr terpasang di `~/.agents/skills/herdr/SKILL.md`, ID/nama eksplisit, wait berbatas, dan jangan close pane/session yang tidak dibuat studio. Jika quota/model unavailable, jangan mengganti model diam-diam; simpan handoff dan laporkan.

Sesudah semua output checkpoint siap, hentikan pekerjaan pada rekomendasi roadmap dan tunggu keputusan pengguna. Tidak lanjut implementasi hanya karena audit selesai.

## Fase 2 — keputusan pengguna 10 Oktober 2026 (setelah checkpoint 1)

Keputusan: (1) **Opsi B** — slice Universe terukur; (2) commit dirapikan, dan selanjutnya **lead meng-commit setiap milestone tercapai** (branch non-main, tanpa atribusi AI, tanpa push/deploy kecuali diminta); (3) arah art direction mengikuti sprint Codex GUI di `/Users/mikelrisyad/Developer/globe/output/universe-art-sprint/` (diperbarui berkala; read-only bagi studio); (4) target minimum laptop iGPU, RAM 8 GB, 30 FPS profil Hemat **disetujui**; (5) **AGY Gemini 3.8 Flash High** ditambahkan untuk QA paralel di akhir milestone, tidak boleh menjadi bottleneck. Goal fase: **struktur kode rapi dan gameplay jalan end-to-end**. Lead menentukan milestone.

Mandat fase 2 mengizinkan perubahan source/test/docs, `npm ci`/test/build, server dev lokal dan browser QA headless di worktree studio. Tetap dilarang: `.env*`/credential, push/deploy, layanan berbayar, mengubah konfigurasi global, commit ke `main`, dan mengubah folder art sprint.

### Lokasi kerja

Checkout utama `/Users/mikelrisyad/Developer/globe` dipakai sesi lain (branch `claude/pensive-hypatia-bvwgyu`) — **jangan diubah**. Studio bekerja di worktree **`/Users/mikelrisyad/Developer/globe-studio`** (branch `feat/skirmish-vc`). Tool Blender `build_town_space.py` menulis ke checkout utama kecuali `GLOBE_ROOT` diset; jangan jalankan generator tanpa persetujuan lead. Gunakan path absolut / `git -C` / `npm --prefix` (cd bermasalah di profil gvm).

### Tim fase 2 (maksimal tiga worker aktif)

| Role | Model | Ownership |
|---|---|---|
| Lead | Claude Opus 5.5 medium | Board, milestone, integrasi, commit, dokumen gabungan |
| Engineering | Claude Sonnet 5.5 high | Source/test milestone yang di-dispatch |
| Design/technical artist | Codex GPT-6.1 Sol high | Kajian art book + spesifikasi slice/onboarding; tidak mengedit source tanpa task |
| QA | AGY Gemini 3.8 Flash High | Harness QA di `tools/qa/` + run QA akhir milestone; laporan di `docs/qa/` dan `docs/studio/globe-universe/qa/` |

### Milestone (ditetapkan lead)

| ID | Tujuan | Selesai bila |
|---|---|---|
| **M0** Repo rapi + baseline | Pecah commit besar per produk; baseline segar | **Selesai 10 Okt**: commit `968939c` Town, `36e7fa1` Trade, `57860e2` Valley, `0beb9c9` Docs; tiap snapshot build lolos; `npm test` 202/202 (Node 22.23.1). Backup `backup/skirmish-vc-5033bd3`. |
| **M1** Fondasi aman | Save/versi, identitas dunia, jalur gagal, smoke lintas route, registry docs | Test baru untuk G-03/G-04/G-06 lulus; smoke semua route 0 error (`engine.lastError` + page error); `npm test` + build lulus; docs K1–K14 direkonsiliasi; QA AGY lulus; lead commit |
| **M2** Slice Universe end-to-end | Satu tujuan pemain Space → Planet → Town → rumah → perubahan persisten → reload → kembali; onboarding/wayfinding; pemecahan TownMode yang disentuh slice; baseline perf Hemat | Skrip e2e slice lulus; playtest pengguna; tabel perf per rute; lead commit |
| **M3** Dunia hidup + Hemat | Implementasi bertahap art book (hasil kajian artist + sprint) dan profil Hemat | Ditentukan setelah M2 dan art sprint selesai |
