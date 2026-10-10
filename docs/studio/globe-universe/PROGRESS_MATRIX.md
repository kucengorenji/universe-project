# Progress matrix — Globe Universe (checkpoint review 10 Oktober 2026)

Pemilik: globe-lead (ST-03). Status: **final untuk checkpoint**, direkonsiliasi dengan [ENGINEERING_REVIEW.md](ENGINEERING_REVIEW.md) (ST-01, selesai 01:38) dan [DESIGN_ART_REVIEW.md](DESIGN_ART_REVIEW.md) (ST-02, selesai 01:37). Kode `G-xx`/`K-xx`/`V-xx` merujuk ke ENGINEERING_REVIEW; `DA-xx` merujuk ke DESIGN_ART_REVIEW.

## Definisi status dan batas verifikasi

| Label | Arti |
|---|---|
| **Terverifikasi-source** | Source/artefak dibaca pada 10 Okt dan cocok dengan klaim dokumen. **Bukan** bukti bahwa game berjalan benar hari ini. |
| **QA historis** | Klaim dari laporan/JSON/screenshot bertanggal; tidak dijalankan ulang. |
| **Parsial** | Sebagian klaim terbukti; sebagian belum ada atau bertentangan. |
| **Rencana** | Hanya ada di dokumen. |
| **Belum diverifikasi** | Tidak cukup dibaca atau butuh runtime/playtest baru. |

Checkpoint ini **tidak menjalankan** test, build, server, browser QA, profiling, generator, atau playtest manusia (runtime baru = **tidak ada**; playtest manusia = **belum pernah ada** untuk produk mana pun). Tidak ada persentase agregat; angka 25–30% September tidak berlaku.

## Snapshot working tree yang diaudit

- `feat/skirmish-vc`, HEAD `f95bbbd` (8 Okt, landing). Lead `git -C … status --porcelain` ±01:36: **95 entri**; 42 file tracked termodifikasi (+524/−280).
- **Untracked (belum pernah di-commit):** seluruh Trade (`src/trade/`, `src/modes/trade/`, i18n trade, test, QA tools/report), seluruh Valley (`farm.html`, `src/valley/`, `public/models/valley_*.glb`, `tools/blender/valley/`, test), town walk/cozy (`skirmishPeople.js`, `townWalk.json`, `horseMotion.js`, `cozyPaths.js`, GLB `town_walk_*`), dan dokumen 9–10 Okt. Ini mengonfirmasi daftar `??` yang diminta engineer (G-01).
- Perubahan eksternal saat audit: `output/universe-art-sprint/` (untracked, dibuat 01:16, sebelum bootstrap studio) sedang ditulis proses di luar studio (`.delivery.lock`, `images/` 01:35). Studio tidak menyentuhnya. `src/valley/**` dan `chunkyPeople.js` lebih baru dari report Trade 9 Okt 16:22.
- Deployment publik terakhir (8 Okt, DEPLOYMENT.md) mendahului Trade/Valley/WIP.

## A. Universe utama (eksplorasi)

| Subsystem | Tujuan | Status | Bukti (file / tanggal) | Kekurangan utama | Owner berikut | Dependency |
|---|---|---|---|---|---|---|
| Core: router, Director, engine | Lifecycle 5 mode (space/planet/town/home/trade) | Terverifikasi-source | `director.js` 172 baris, `router.js`; ST-01 §3.1 | Jalur gagal tanpa pemulihan; `this.mode=null` bila `enter()` gagal; race `enterBuilding`↔`exit()` plausibel, belum direproduksi (G-06) | Eng | — |
| World, state, save | Seed → dunia; IndexedDB + journal; namespace | Parsial | `stateStore.js`, `identity.js`; `world-foundation.test.js` (7 test); harness browser 27 Sep (QA historis) | `GENERATOR_VERSIONS town:3` vs layout v5 dan tak dibaca (K12); interior schema tak dikenal ditimpa diam-diam; worldId bergantung pada satu entri localStorage yang gagal simpan diam-diam; misi global `planet_globe_missions` (G-03, G-04) | Eng | — |
| Space | Tata surya → planet | Belum diverifikasi (hanya struktur) | `town-polish/flows.json` 8 Okt (QA historis) | Tidak ada tujuan di space; internal tidak dibaca | Eng | — |
| Planet | Globe hex, CTA town/Trade | Terverifikasi-source (struktur) | `PlanetMode.js` 459; `planetRenderer.js` **3.168** baris (doc: 3.105) | File monolit tumbuh; landmark planet↔town belum terbukti setara (AD-6, ST-02 §3) | Eng + Art | — |
| Town (layout v5, render, LOD, orang, kendaraan) | Kota fantasy/modern prosedural, painted diorama | Terverifikasi-source + QA historis | `TOWN_LAYOUT_VERSION = 5`; `TownMode.js` **1.784** baris; 15 test town/walk; QA compact 7 Okt, town-polish 8 Okt, graphics/LOD 7 Okt | Tidak ada runtime setelah WIP terbaru; **coupling ke kode/aset Skirmish** tanpa gerbang regresi (G-02); benchmark 7 Okt JSON hilang (K14) | Eng + Art | G-01 |
| Pixel Town | Gaya tampilan alternatif | Prototype — Parsial | `render/pixel*.js`, `town-pixel.test.js` (6); `docs/qa/pixel-town` 8 Okt | Bukan profil hemat; tidak tercatat di ARCHITECTURE/README | Eng | — |
| Interior (substate Town) | Interior sesuai shell, multi-lantai, state per lantai | Terverifikasi-source + QA historis | `interior.js` 725, `interiorLayout.js`, schema v2; harness 27 Sep | Barang antar lantai belum; record schema tak dikenal ditimpa (G-03); fungsi ruang belum punya tujuan pemain (ST-02) | Eng + Design | — |
| Home (mode `#/home/...`) | Rancang → Apply → kunjungi rumah | Parsial | `HomeMode.js` 364 + modul home; 6 test `home-*`; `home_cozy.glb` 3,79 MB; QA **4 Okt** | QA lebih tua dari Town v5/Pixel; tidak tercatat di ARCHITECTURE/ASSETS; tip onboarding `home` tidak ada | Eng + Design | — |
| Onboarding & progresi | Tips, misi/checklist | Parsial | `tips.js`, `missions.js` (ST-02 §2) | Mengajarkan tombol, belum tujuan; misi/tips global; **tidak ada core loop eksplorasi** yang terarah | Design | Keputusan PO (DA-01) |
| Navigasi/portal | Walk/drive, portal pintu | Terverifikasi-source | `walkNetwork.js` reason pintu; `walk-network.test.js` | `findDoors()` mengabaikan `reason` (aman selama belum ada warga) (§5.2) | Eng | WB-05 |
| WB-05 household, WB-06 POI, WB-07 ekonomi eksplorasi, WB-08 event | Dunia hidup | Rencana | IMPLEMENTATION_STATUS "Belum" | Seluruhnya. **Trade bukan WB-07.** | — | Core loop (DA-01) |
| Audio | Musik/ambient per level | Parsial — QA historis | `core/audio.js` (ST-02 §5) | Belum ada listening pass 10 menit; Home tanpa ambience; Valley tanpa suara | Design/TA | — |
| Art direction | Painted diorama (disetujui 29 Sep) | Parsial — observasi artefak | Refresh 7–8 Okt: fasad/kendaraan/jalan membaik (ST-02 §3–4) | Shading Home vs Town berbeda (belum terbukti cacat); **arah rig bertentangan**: Town v5 humanoid (cozy-actors 8 Okt) vs FARM_PLAN G5 semi-chibi (K10) | Art | Keputusan PO |
| Pipeline aset | Source editable → export → loader | Parsial | Metadata GLB + hash (ST-02 §5) | Rebuild v5 butuh input VRoid/UAL eksternal, `.blend` v5 tidak ditemukan; Blender MCP tidak tersedia; `npc.glb`+`character.glb` (1,6 MB) tanpa pemakai literal; `interior_atlas.jpg` dimuat eager tapi registry bilang tak dipakai (K7, K8) | TA + Eng | — |
| Performa/resource | Jalan di laptop lemah | Belum diverifikasi | Manifest 27 file = **55.798.604 B**; jalur Town 17 file = **38.077.199 B** (dihitung ulang 10 Okt, cocok dengan laporan 9 Okt) | Low tetap memuat 2 template v5 + 4 atlas 2048² (≈64 MiB base); semua FPS dari M1 Pro; budget Hemat masih usulan (G-05) | Eng + TA | Target perangkat (PO) |
| QA gate | Deteksi regresi | Parsial | 39 file `*.test.js`; tidak ada `.github/` CI; QA browser manual per fitur | Tidak ada smoke lintas route; jumlah test aktual tidak diketahui (15/30/197 di dokumen, K1) (G-08) | Eng | G-01 |
| Dokumentasi | Satu sumber kebenaran status | Parsial | 14 kontradiksi K1–K14 | README "empat level", indeks tidak memuat Home/Trade/Valley/Skirmish/Pixel/Deploy; hosting Firebase vs Cloudflare (K4) | Lead | — |
| Deploy/landing | Situs publik | QA historis | DEPLOYMENT.md 8 Okt | Build publik tidak berisi WIP 9–10 Okt | PO | G-01 |

## B. Trade Game (mode terpisah dari CTA planet)

| Subsystem | Tujuan | Status | Bukti | Kekurangan | Owner | Dependency |
|---|---|---|---|---|---|---|
| Trade v1 (Terran, desktop) | Campaign ekonomi: 6 barang, 9 fasilitas, rute, kontrak, 5 milestone, sandbox | Terverifikasi-source + QA historis | `TradeMode.js` 160, `simulation.js` 407, `session.js` (lease/Web Locks); `trade-game.test.js` (15 test top-level); `report.json` 9 Okt 16:22: **15/15 check pass, 0 error**; `playthrough.json`: 1 strategi mencapai target dalam 1.480 detik simulasi | **Untracked**; tanpa playtest manusia; balancing 1 strategi; antrean tick tanpa batas atas setelah tab latar; campaign gagal dimuat bila fingerprint peta berubah; schema 1 tanpa migrasi (G-07) | Design (playtest) + Eng | G-01 |

## C. Prototype / eksperimen (terpisah sampai integrasi terbukti)

| Prototype | Tujuan | Status integrasi | Bukti | Kekurangan | Owner | Dependency |
|---|---|---|---|---|---|---|
| Valley/Farm (`farm.html`) | Look-dev art/animasi + reaksi dunia; sumber port G1–G6 | Prototype terpisah, **belum terintegrasi** | FARM_PLAN V0–V5 (9–10 Okt); `docs/qa/valley/*.json`; 5 test `valley-*`; `lookdev.json`: ~59,6 FPS, 112 draw call (target <80) | Untracked; tanpa progres/save (sesuai keputusan); port G1–G6 belum dimulai; G5 bertentangan dengan arah rig Town (K10) | Art + Eng | Persetujuan look + cakupan port (PO) |
| Skirmish (`skirmish.html`) | Taktik ala VC | M-A..M-D di-commit 4 Okt; M-E berjalan | 3 test `skirmish-*`; git log | **Tidak ada QA browser/folder bukti**; `vcSoldiers.js` WIP dan dipakai Town (G-02) | Eng + Art | — |
| Cozy actors / town walk | Aktor dan gait Town | Sudah dipakai Town (WIP), belum di-commit | `docs/qa/cozy-actors` 8 Okt; `cozy-actors.test.js` (untracked) | Belum tercatat di IMPLEMENTATION_STATUS | Eng + Art | G-01 |
