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
