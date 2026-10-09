# Engineering review — Globe Universe (ST-01)

Reviewer: Claude Sonnet 5.5 (`claude-sonnet-5-5`), effort high. Tanggal review: 10 Oktober 2026. Checkout: `/Users/mikelrisyad/Developer/globe`, branch `feat/skirmish-vc`, HEAD `f95bbbd` (snapshot header sesi). Ini review dokumen, source, dan artifact. Tidak ada test, build, server, generator, atau browser yang dijalankan. Tidak ada file selain dokumen ini yang diubah.

## 1. Ringkasan untuk pemilik proyek

1. **Universe utama dan Trade punya source nyata dan terhubung.** Router, `Director` dan lifecycle mode (space, planet, trade, town, home) ada di source. Trade memakai mode, store, dan route sendiri yang terpisah dari eksplorasi, sesuai keputusan produk.
2. **Valley/Farm dan Skirmish adalah halaman terpisah.** Keduanya punya entry Vite sendiri (`farm.html`, `skirmish.html`). Tetapi Town sudah **meng-import kode dan memuat aset Skirmish** (`paintedStyle.js`, `skirmishPeople.js`). Skirmish bukan lagi "terpisah penuh". Perubahan di sana bisa mengubah Town.
3. **Pekerjaan terbesar belum ada di riwayat git.** Menurut snapshot git di awal sesi, `src/trade/`, `src/modes/trade/`, `src/valley/`, `docs/qa/trade-game/`, dan beberapa test/tool QA berstatus **untracked**. Ada 42 file tracked yang berubah. Commit terakhir (`f95bbbd`) adalah landing page. Ini risiko kehilangan kerja. Keputusan commit ada di pemilik; review ini tidak meng-commit.
4. **Dokumen status banyak yang basi atau saling bertentangan** (angka test 15/30/197, layout v4 vs v5, daftar mode, hosting). Detail di §4.
5. **Save dan migrasi paling berisiko.** Pelindung ada dan teruji: layout lama di-pin dan dites hash. Namun registry versi basi (`town: 3` padahal layout v5), record interior dengan versi tak dikenal ditimpa diam-diam, dan identitas dunia bergantung pada satu entri `localStorage`.
6. **Performa untuk komputer lemah belum terukur.** Masuk Town menarik 17 file senilai **38.077.199 byte** di disk (cocok dengan laporan 9 Oktober). Budget di laporan itu masih usulan. Tidak ada pengukuran runtime baru.
7. **Cakupan QA kuat di unit test, tipis di runtime lintas-mode.** Tidak ada CI (`.github/` tidak ada). QA browser Trade/Valley berupa skrip di `tools/qa/` yang harus dijalankan manual. Skirmish tidak punya folder bukti QA.

Tidak ada persentase progres baru di dokumen ini. Hitungan memakai denominator eksplisit (mis. "5 dari 9 milestone WB berstatus dimulai") dan hanya menyalin klaim dokumen.

## 2. Istilah bukti dan batas kata "terverifikasi"

| Kode | Arti | Dibuat pada review ini? |
|---|---|---|
| **SV** | Source terbaca: saya membaca file/fungsinya dan isinya cocok dengan klaim | Ya, terarah (daftar di §9) |
| **AV** | Artifact terbaca: ukuran byte, mtime, atau daftar file diperiksa read-only | Ya |
| **QA-H** | QA historis: laporan/dokumen bertanggal, tidak dijalankan ulang | Dikutip, bukan dibuktikan ulang |
| **RT** | Runtime baru: test/build/browser dijalankan pada checkout ini | **Tidak dilakukan** |
| **HP** | Playtest manusia | **Belum ada** untuk produk mana pun |

Label status subsystem:

- **Terverifikasi-source**: SV dan AV konsisten dengan klaim dokumen. Ini bukan klaim "berjalan benar sekarang".
- **Parsial**: sebagian klaim terbukti, sebagian belum atau bertentangan.
- **Rencana**: hanya ada di dokumen.
- **Belum diverifikasi**: tidak cukup dibaca pada review ini.

Mtime dipakai sebagai petunjuk urutan waktu, bukan bukti isi. File tersalin atau di-touch bisa berubah mtime tanpa berubah isi.

## 3. Peta progres per subsystem

Tidak ada kolom persen. "Bukti QA-H" adalah laporan yang ada di repo dan tanggal file-nya.

### 3.1 Universe utama

| Subsystem | Status | Bukti source/artifact (SV/AV) | Bukti QA-H | Kekurangan terbukti | Dependency |
|---|---|---|---|---|---|
| Core: router, `Director`, engine | Terverifikasi-source | `director.js` (172 baris): 5 mode di `MODES`, urutan prepare → depart → exit → enter → reveal. `router.js` (50 baris) memvalidasi ID. `engine.js` menyimpan `lastError`. | Enam pergantian scene stabil (Sept 27; Trade report 9 Okt) | Jalur gagal dan race (G-06) | — |
| World, state, save | Parsial | `World`, `WorldStateStore`, `identity.js`, `worldClock.js`; `tests/world-foundation.test.js` (7 test) | Harness `tests/browser/` Sept 27 | Registry versi basi, identitas dunia (G-03, G-04) | — |
| Space | Belum diverifikasi | Hanya struktur file dan dokumen. `SpaceMode.js` tidak dibaca mendalam. | `town-polish/flows.json` (8 Okt) menyebut space → planet | — | Planet |
| Planet | Terverifikasi-source (struktur) | `PlanetMode.js` 459 baris; `planetRenderer.js` **3.168 baris** (dokumen: 3.105) | Trade report: enam pergantian planet↔Trade | File besar tumbuh; internal renderer tidak dibaca | World |
| Town (layout, render, orang, kendaraan, navigasi) | Terverifikasi-source | `TownMode.js` **1.784 baris** (dokumen: 1.286); `TOWN_LAYOUT_VERSION = 5`; 15 file `town-*`/`walk-network` test | Compact QA (7 Okt), town-polish (8 Okt), pixel-town (8 Okt) | Tidak ada runtime setelah perubahan terbaru; coupling ke Skirmish (G-02) | World, aset |
| Town Pixel style | Parsial | `render/pixel*.js`; `tests/town-pixel.test.js` (6 test); `docs/PIXEL_TOWN.md` | `docs/qa/pixel-town/` (8 Okt) | Tidak ada di ARCHITECTURE/README | Town |
| Interior (substate Town) | Terverifikasi-source | `interior.js` 725, `interiorLayout.js`, `roomShell.js`; format `schemaVersion: 2` per lantai; resume lokasi via `playerLocation` | Harness Sept 27: 20 siklus, resume | Fallback record (G-03); item antar lantai belum didukung (dokumen) | Town, save |
| Home (bangun rumah prosedural, `#/home/...`) | Parsial | `HomeMode.js` 364 + `homeBlueprint/Builder/Roof/Furnishing`; 6 file `home-*` test; `home_cozy.glb` 3.791.532 B | `PROCEDURAL_HOME_BUILDING_QA.md` dibuat **4 Okt**, sebelum Town v5 (7 Okt) | Tidak di ARCHITECTURE/README/ASSETS; QA browser lebih tua dari perubahan Town | Town layout pin, aset |

Hitungan klaim dokumen (bukan hasil verifikasi): `IMPLEMENTATION_STATUS.md` memuat 9 milestone WB-00…08. Lima berstatus sebagian/terpasang sebagian, empat (WB-05…08) "Belum", dan tidak ada yang berstatus selesai. Dari 10 milestone AA-00…09, tidak ada yang berstatus selesai.

### 3.2 Trade

| Aspek | Status | Bukti |
|---|---|---|
| Mode dan alur masuk | Terverifikasi-source | `TradeMode.js` 160 baris, `entry.js` (CTA planet → dialog setup), route `#/trade/<planet>/<campaignId>`, `director.js:63-66` memvalidasi kampanye |
| Simulasi dan ekonomi | Terverifikasi-source | `simulation.js` (407 baris, `validateState` sangat ketat), `catalog.js`, `routing.js`, `scenario.js`, `resources.js` |
| Save dan multi-tab | Terverifikasi-source | `session.js:45-61` (resume, validasi, pause awal), `:62-78` (Web Locks + lease localStorage), export/import dengan batas 12 MB |
| Test | Ada | `tests/trade-game.test.js`: 15 test top-level. `TRADE_GAME_RUNTIME.md` menyebut 197 test seluruh repo (9 Okt). Tidak dijalankan ulang. |
| QA browser | QA-H | `docs/qa/trade-game/report.json` (9 Okt 16:22), `playthrough.json` (16:14), 14 screenshot. Skrip: `tools/qa/trade_game.mjs`, `trade_campaign.mjs` (di luar `npm test`) |
| Fresh | RT: tidak ada. HP: tidak ada (dokumen sendiri menyatakan belum). |
| Status git | Snapshot: `src/trade/`, `src/modes/trade/`, i18n trade, test, dan QA berstatus untracked (G-01) |

Catatan waktu: tidak ada file di `src/` selain `src/valley/` dan `chunkyPeople.js` yang lebih baru dari `report.json` (dicek dengan `find -newer`). Jadi source Trade, Town, planet, dan core tidak berubah sejak laporan Trade dibuat. Satu pengecualian, `chunkyPeople.js`, dibahas di G-02.

### 3.3 Prototype

| Prototype | Status integrasi | Bukti |
|---|---|---|
| **Valley/Farm** (`farm.html`, `src/valley/`) | **Prototype terpisah, belum terintegrasi ke Universe.** Entri Vite sendiri; tanpa `Director`/`World`/save universe. | `vite.config.js` (input `farm`); `FARM_PLAN.md` menyatakan V0…V5 selesai di prototype. §8 mencantumkan 6 item port (G1…G6) dan tidak ada status port yang dilaporkan selesai. 5 file `valley-*` test + `cozy-actors`. QA-H di `docs/qa/valley/` (8–10 Okt; sesi 10 menit tanpa `lastError`, 60 fps/GPU 5,8–9,7 ms di M1 Pro headless). Draw call sekitar 112 vs target 80 (dokumen sendiri). |
| **Skirmish** (`skirmish.html`, `src/skirmish/`) | **Produk terpisah dengan aset dan kode yang dipakai bersama Town.** | Commit M-A…M-D di git log. 3 file test (`skirmish-battle/field/spotting`). Tidak ada `docs/qa/skirmish*`, tidak ada skrip browser QA di `tools/qa/`. `vcSoldiers.js` berstatus modified (WIP) pada snapshot git. |

Kesimpulan integrasi: Trade terintegrasi di Director dengan route dan store sendiri. Valley belum. Skirmish terintegrasi hanya sebagai penyedia aset/kode untuk Town.

## 4. Kontradiksi dan status basi

| ID | Klaim dokumen | Fakta source/artifact | Sumber bukti | Tindakan yang disarankan |
|---|---|---|---|---|
| K1 | `IMPLEMENTATION_STATUS.md` §Verifikasi: "15 test lolos". `ARCHITECTURE.md` §12: 30 test (29 Sep). `TRADE_GAME_RUNTIME.md`: 197 test (9 Okt). | `tests/` berisi 39 file `*.test.js`. Jumlah test aktual tidak diketahui tanpa menjalankan. | AV (`ls`) | Satu angka bertanggal dari run baru (V-01). Jangan campur angka. |
| K2 | `IMPLEMENTATION_STATUS.md` baris 21: "belum ada migrasi layout lama ke v2". `TOWN_PLAN_V3.md`: layout v4 di cabang ini. | `TOWN_LAYOUT_VERSION = 5` (`townGeneration.js:7`). Ada mekanisme pin `townGenerationVersion()` dan tes hash v1–v4 (`town-compact-generation.test.js`). | SV | Perbarui status. Layout lama tidak dimigrasi, tetapi di-pin. |
| K3 | `ARCHITECTURE.md` §2: tabel route tanpa `#/home/...`; "Interior bukan mode tersendiri". | `director.js:12` mendaftarkan `home`; `router.js:27-32` mem-parse `#/home/<i>/<c>/<id>`. | SV | Tambah Home dan Pixel ke ARCHITECTURE. |
| K4 | `ARCHITECTURE.md` §1: hosting Firebase. | `DEPLOYMENT.md` dan `wrangler.jsonc`: Cloudflare Pages. `firebase.json` masih ada. | SV, AV | Tentukan satu hosting kanonik; catat sisa Firebase. |
| K5 | `ARCHITECTURE.md` §10: teks UI Indonesia ditulis langsung di JS/HTML. | `src/i18n/` (locale `id` dan `en`), `docs/I18N.md`, `tests/i18n.test.js`. | AV | Perbarui §10. |
| K6 | `ARCHITECTURE.md` §13: `planetRenderer.js` 3.105, `TownMode.js` 1.286 baris. | Sekarang 3.168 dan 1.784 (`wc -l`). Dokumen sendiri menyebut "kandidat pemecahan". | AV | Catat bahwa utang struktural bertambah (+39% pada `TownMode`). |
| K7 | `ASSETS.md`: total `public/` 6.406.399 B, lalu 10.100.723 B. Tidak mencantumkan `home_cozy.glb`, `valley_*`. | Manifest 27 file = **55.798.604 B** (dihitung sekarang). `ASSETS.md` baris `character.glb` dan `npc.glb` menyatakan dimuat oleh `peopleRig.js`/`chunkyPeople.js`, tetapi tidak ada pemakai `ASSETS.characterPack`/`npcPack` di `src/`. | AV, SV (grep literal) | Sinkronkan registry. Tandai dua pack itu sebagai kandidat hapus. |
| K8 | `ASSETS.md` baris `interior_atlas.jpg`: tidak dibaca `interior.js` sejak 30 Sep. | `TownMode.js:46-51,59` tetap memuat atlas ini di `packs()` setiap masuk Town (375.272 B). | SV | Hapus dari `packs()` atau jelaskan fungsinya. |
| K9 | `SKIRMISH_PLAN.md` catatan teknis: "game utama tidak memuat modul ini" (arsiran). | `paintedStyle.js:2-3` mengimpor `skirmish/battlefield/envKit.js` dan `skirmish/render/canvasStyle.js`. `skirmishPeople.js:5-6` mengimpor `vcSoldiers.js` dan `heroLooks.json`. | SV | Perbarui dan catat kontrak bersama (G-02). |
| K10 | `FARM_PLAN.md` §8 G5: badan 4,5 kepala menggantikan `chunkyPeople` di Town, Home, dan Skirmish. | `docs/qa/cozy-actors/README.md` (8 Okt): Town memakai langsung model Skirmish v5, menggantikan desain chibi percobaan. | AV (dokumen) | **Keputusan produk untuk pemilik.** Dua dokumen menggambarkan arah rig yang berbeda. |
| K11 | `docs/README.md` indeks: tidak memuat `FARM_PLAN`, `SKIRMISH_PLAN`, `DEPLOYMENT`, `PIXEL_TOWN`, `PROCEDURAL_HOME_*`, `TOWN_COMPACT_ASSETS_QA`, `TOWN_GRAPHICS_LOD_QA`, `I18N`, `LANDING_DESIGN`, `studio/`. Intro: "empat level". | Dokumen-dokumen itu ada di `docs/` (listing). | AV | Lengkapi indeks. Sebut Trade, Home, dan prototype. |
| K12 | `GENERATOR_VERSIONS = { planet: 5, town: 3, interior: 2, identity: 1 }` ditulis ke manifest dunia. | `TOWN_LAYOUT_VERSION = 5`. `generatorVersions` tidak dibaca di mana pun di `src/` (grep). | SV | Satu sumber versi, atau hapus field yang tidak dipakai (G-03). |
| K13 | `WEBGAME_RESOURCE_PERFORMANCE_REPORT` (9 Okt): manifest 55.754.488 B. | Sekarang 55.798.604 B (+44.116 B). `valley_kit.glb` dan `valley_actors.glb` bermtime 10 Okt 00:45–00:46, sesudah laporan. Rincian Town 38.077.199 B **cocok** (dihitung ulang). | AV | Beri tanggal pada setiap angka dan tulis cara ukurnya. |
| K14 | `TOWN_GRAPHICS_LOD_QA.md` (7 Okt) memuat benchmark yang dirujuk ke file JSON. | Laporan performa 9 Okt menyatakan JSON tersebut tidak ditemukan di lokasi tautan. Tidak saya cek ulang. | Dikutip | Perlakukan angka itu sebagai catatan historis. |

Dokumen yang sudah konsisten dengan source pada hal yang saya cek: `TRADE_GAME_RUNTIME.md` (fitur, route, lease, batas v1), `FARM_PLAN.md` (struktur `src/valley/`, tidak ada klaim integrasi), `ASSETS.md` untuk `town.glb` (5.867.392 B cocok) dan `scenery.glb` (1.244.892 B cocok).

## 5. Audit arsitektur

### 5.1 Arsitektur dan batas modul

- Pemisahan data (`world/`, `modes/town/layout/`, `navigation/`) dari render dipertahankan di Town, sesuai ARCHITECTURE §7.2. Jalur `world/homeState.js` mengimpor dari `modes/town/scale.js` dan `layout/townPlan.js`. Itu masih di sisi data, tetapi lapisan `world/` bergantung ke `modes/`.
- **Coupling lintas produk**: Town ⇄ Skirmish (G-02). `chunkyPeople.js` dipakai bersama oleh interior Town, Skirmish (`soldiers.js`, `soldierLook.js`), dan Valley (`actors.js`, `villagers.js`, `clips.js`).
- Trade tidak masuk lapisan Town: renderer planet pribadi (`TradeMode.js:11-21`), store campaign sendiri, dan `TradeSession` hidup di app shell (`session.js:15-21`). Pemisahan ini sesuai mandat "Trade sebagai mode terpisah".
- Dua `PlanetRenderer` singleton ada: satu di `PlanetMode` (`getShared`), satu di `TradeMode` (`shared`). Keduanya `suspend()` saat tidak dipakai; yang di Trade tidak pernah di-dispose. Berat resident setelah kunjungan pertama tidak diukur (G-05).
- Dependensi runtime: `three` 0.170 dan `firebase` ^12.19 (`package.json`). Pemakaian `firebase` di `src/core/firebase.js` tidak saya telusuri; relevan dengan K4.

### 5.2 Navigasi, portal, interior

- Route Trade, Home, dan Town divalidasi di `Director.sanitize()` (`director.js:58-73`): ID tak dikenal turun ke mode induk, bukan error.
- `go()` hanya menyimpan **satu** permintaan tertunda (`pending`, `director.js:88-91`). Permintaan ketiga menimpa yang kedua.
- Portal pintu: `walkNetwork.js:56-71` memberi tiap pintu `reason` (`blocked-door`, `no-safe-access`, `isolated-path`) dan test menutupnya (`walk-network.test.js:34-51`). Namun `TownMode.findDoors()` (`:654-683`) membuat daftar pintu dari footprint tanpa memeriksa `reason`. Hasilnya: pintu yang "tidak aman" untuk pejalan NPC tetap bisa dimasuki pemain. Itu tidak masalah saat ini karena belum ada warga yang memakai portal (WB-05 "Belum"). Jumlah portal tidak aman per seed tidak tercatat di dokumen mana pun yang saya baca.
- Masuk rumah buatan pemain: `enterBuilding()` (`:700-702`) mengalihkan ke `#/home/...`. Pintu rumah-home dihitung dari `homeRecord.applied` (`:659-674`).
- Interior: record disimpan per bangunan per lantai (`interior:<planet>:<buildingId>`); `playerLocation` global untuk resume (`:879-887`). `exitBuilding()` dan `exit()` keduanya mengosongkan `playerLocation`.

### 5.3 Save, migrasi, lifecycle

Yang kuat dan terbukti di source:

- Journal sinkron di `localStorage` plus IndexedDB, merge per transaksi (`stateStore.js:47-78`). Dua tab yang menyimpan kunci berbeda tidak saling menimpa, selama kunci berbeda. Kunci sama: last-writer-wins.
- Layout kota di-pin per kota selama ada interior/home (`townGeneration.js:13-31`). Ada 6 hash emas untuk v1…v4 (`town-compact-generation.test.js:42-59`).
- Home menolak reroll layout yang akan mengorphankan rumah (`saveTownPlanChoice`, `townGeneration.js:61-69`).
- Trade memvalidasi seluruh save dan import (`validateState`, `session.js:45-61,135-152`) dan memakai lease untuk satu penulis.
- `TownMode.exit()` membuang builder, crowd, fleet, interior, sky, HUD, dan listener (`:1756-1783`).

Yang lemah, dengan bukti di §6.

### 5.4 Resource dan performa

- Baris dasar yang terverifikasi AV: 27 file di `ASSET_FILES` = 55.798.604 B. Pack Skirmish saja 33.491.132 B, Valley 4.002.724 B, pack planet 631.296 B.
- Masuk Town memanggil `packs()` (`TownMode.js:52-64`) dan `loadTownPeople()` yang menarik pack tentara m **dan** f beserta atlas. Total **38.077.199 B** (17 file, dihitung ulang dan cocok dengan laporan 9 Okt).
- `furniture.glb` (801.628 B) dan `interior_atlas.jpg` (375.272 B) ikut dimuat sebelum pemain menyentuh pintu. Ini masih target P0 laporan performa.
- `Promise.all` di `packs()`: sebagian pack punya `.catch(() => null)`, tetapi `planetPack` tidak. Kegagalan pack planet menggagalkan masuk Town (lihat G-06).
- Semua angka FPS/GPU/RAM di dokumen adalah QA-H dari M1 Pro lokal. Tidak ada pengukuran perangkat lemah. Budget "Hemat" di laporan 9 Okt berlabel usulan.

### 5.5 Cakupan QA

| Area | Unit/Node test (ada di `npm test`) | Browser/runtime (di luar `npm test`) | Catatan |
|---|---|---|---|
| Town generation, walk, planner | 15 file | `tests/browser/living-town.html` (manual) | Hash emas hanya subdivision 3, 2 seed |
| Interior, home | `interior-layout`, `home-*` (6 file), `world-foundation` | `tests/browser/index.html` (manual); QA home 4 Okt | QA home lebih tua dari Town v5 |
| Trade | `trade-game.test.js` (15) | `tools/qa/trade_game.mjs` (Chrome + playwright manual) | Termasuk lintas mode dan multi-tab |
| Valley | 5 file `valley-*` | `tools/qa/valley_*.mjs` | GIF, sesi 10 menit |
| Skirmish | 3 file | **Tidak ada** | Tidak ada folder bukti QA |
| Director, mode switch | `director-resume.test.js` (1 test, memakai mock) | Hanya tersirat di skrip QA Trade | Tidak ada test jalur gagal |
| CI | **Tidak ada** (`.github/` tidak ada) | — | Semua gerbang manual |

## 6. Gap berdampak (diurutkan)

Setiap gap memuat bukti, dampak, dependency, acceptance check, dan risiko. Acceptance memakai verifikasi yang **belum** dijalankan; rencananya ada di §7.

### G-01 (P0) Pekerjaan utama belum masuk riwayat git

- **Bukti.** Snapshot git di awal sesi: `?? src/trade/`, `?? src/modes/trade/`, `?? src/render/cozyPaths.js`, `?? farm.html`, `?? docs/FARM_PLAN.md`, `?? docs/TRADE_GAME_*.md`, `?? public/models/valley_*.glb` dan lainnya; 42 file tracked berstatus `M`. Daftar `??` untuk `src/valley/`, `tests/trade-game.test.js`, `tests/valley-*.test.js`, `tools/qa/trade_*.mjs`, dan `tools/blender/valley/` berasal dari output perintah git yang oleh lead dilaporkan dibatalkan tetapi tetap terkirim; perlakukan sebagai petunjuk dan minta lead mengonfirmasi. `git log` menunjukkan 5 commit terakhir tidak menyentuh Trade/Valley.
- **Dampak.** Satu kesalahan `git clean`/`checkout`/disk rusak menghapus Trade v1, Valley, dan banyak QA. Status "terpasang" di dokumen tidak punya titik pemulihan.
- **Dependency.** Izin eksplisit pemilik untuk commit/branch (di luar mandat ini). Aturan global: jangan commit ke `main`.
- **Acceptance.** `git status` bersih untuk path produk (sesudah keputusan pemilik tentang `output/`, `artifacts/`, `__pycache__`); satu branch non-main memuat Trade dan Valley; `.gitignore` mengecualikan `__pycache__/` dan `.blend1`.
- **Risiko.** Commit besar sekaligus mencampur tiga produk. Disarankan dipecah per produk (Trade, Valley, perubahan Town/landing).

### G-02 (P0) Coupling Town ⇄ Skirmish ⇄ Valley tanpa gerbang regresi

- **Bukti.**
  - `TownMode.js:21,63`, `paintedStyle.js:2-3`, dan `skirmishPeople.js:5-6` mengimpor kode Skirmish; `interior.js:5` memakainya lewat `skirmishPeople.js`.
  - Town menarik `skirmish_surfaces.png` (6.004.882 B) dan tentara m/f beserta empat atlas (19.577.277 B gabungan) lewat `packs()`/`loadTownPeople()`.
  - `chunkyPeople.js` (dipakai interior Town, Skirmish, Valley) bermtime **setelah** `report.json` Trade. `FARM_PLAN.md` V1 menyatakan perubahannya opt-in (`measureLegs`, `pixels`, `vertexShade`) dengan test default.
  - `vcSoldiers.js` berstatus modified (WIP) pada snapshot git dan dipakai Town untuk pemain, NPC, dan penghuni interior (`ASSETS.md`).
  - K9 dan K10: dokumen saling bertentangan tentang arah rig.
- **Dampak.** Mengubah tentara Skirmish atau `chunkyPeople` dapat mengubah wajah, animasi, dan memori Town tanpa test yang gagal. Runtime Town setelah perubahan itu tidak terbukti (RT: tidak ada).
- **Dependency.** Keputusan pemilik tentang K10 (rig kanonik); daftar modul bersama.
- **Acceptance.**
  1. Dokumen kontrak: daftar modul/aset yang dipakai lintas produk, pemilik, dan siapa yang wajib menjalankan QA Town saat modul itu berubah.
  2. Test statis yang gagal bila Town mengimpor modul Skirmish di luar daftar, atau bila `packs()` memuat file di luar daftar.
  3. Satu smoke Town (walk + masuk rumah + keluar) di browser, dijalankan setelah perubahan modul bersama (V-04).
- **Risiko.** Memisahkan paksa kode bersama memakan waktu dan bertabrakan dengan keputusan produk K10.

### G-03 (P0) Kontrak versi dan migrasi save belum lengkap

- **Bukti.**
  - `identity.js:12` `GENERATOR_VERSIONS` (`town: 3`) vs `TOWN_LAYOUT_VERSION = 5`; field itu ditulis di manifest (`World.openState`) dan tidak dibaca di tempat lain.
  - `TownMode.js:713`: `saved?.schemaVersion === 2 ? saved : { schemaVersion: 2, floors: {} }`. Record dengan versi lain selain 1 dan 2 (misalnya versi masa depan atau record rusak) diganti record kosong, lalu `saveInterior()` menimpa data lama pada penyimpanan berikutnya (`:1747-1754`).
  - Hash emas hanya untuk subdivision 3, seed 17/427, 6 kombinasi (`town-compact-generation.test.js:42-59`). Game memakai subdivision 5 (`ARCHITECTURE.md` §4, `World` default).
  - `townGenerationVersion()` menulis ke store saat dibaca (`state.set(key, …)`, `townGeneration.js:25,29`): kunjungan pertama mem-pin versi, dan town tanpa interior/home yang dikunjungi sebelum v5 naik otomatis ke v5 (`:23-26`). Ini sengaja (dokumen: "tidak ada migrasi"), tetapi tidak ada catatan ke pemain.
  - Trade: `state.schema === 1` dan export `version === 1` hanya divalidasi sama dengan 1 (`simulation.js:357`, `session.js:138`); tidak ada fungsi migrasi.
  - `WB-01` di `IMPLEMENTATION_STATUS.md` sendiri menyebut migration registry belum ada.
- **Dampak.** Versi berikutnya (layout v6, interior v3, Trade schema 2) tidak punya jalur upgrade yang teruji. Save lama bisa hilang atau ditimpa tanpa pesan.
- **Dependency.** Keputusan format registry (satu modul versi). Tidak butuh perubahan produk.
- **Acceptance.**
  1. Satu sumber versi; test gagal bila `GENERATOR_VERSIONS` ≠ konstanta di kode.
  2. Record dengan `schemaVersion` tak dikenal tidak ditimpa; UI menampilkan peringatan atau record dikarantina.
  3. Fixture save v1…v4 + interior v1/v2 + home v1 pada subdivision 5 memuat tanpa error di Node (V-06).
  4. Trade: test migrasi `schema 1 → 2` ada sebelum schema 2 dibuat.
- **Risiko.** Menambah hash emas membekukan perilaku generator; perubahan sah berikutnya harus sadar regenerasi fixture.

### G-04 (P1) Identitas dunia dan penyimpanan bertumpu pada satu entri `localStorage`

- **Bukti.**
  - `worldId = world:<homeMap.seed>:grid:<subdivision>` (`World.openState`); `homeMap` dibaca dari `planet_globe_map_v5`. `saveToStorage()` mengembalikan `false` saat gagal dan hanya `console.warn` (`mapGenerator.js:721-729`); pemanggil di konstruktor `World` dan `regenerateHome()` mengabaikan hasilnya.
  - Bila penyimpanan gagal atau diblokir (mode privat, kuota), reload membuat seed acak baru (`generate(null, …)`) → `worldId` baru → seluruh IndexedDB lama tidak terjangkau tanpa pesan.
  - `regenerateHome()` mengganti `worldId`; state lama tidak dihapus dan tidak ada UI untuk melihat atau memulihkannya. Campaign Trade lama dikategorikan "arsip" (hanya ekspor).
  - `planet_globe_missions` masih global (`ARCHITECTURE.md` §13; `missions.js:8`).
  - `WorldStateStore` tidak punya `delete`/`clear` (`stateStore.js` seluruhnya) dan semua record satu dunia disimpan di **satu** entri IndexedDB `worldId` (`:70`). Ukuran terbesar entri itu tidak diketahui.
  - Belum dibuka: apakah `menuController` memperingatkan pemain sebelum "regenerate" (hanya `PlanetMode.regenerate` yang saya baca). **Belum diverifikasi.**
- **Dampak.** Kehilangan dunia terjadi diam-diam pada kondisi browser tertentu.
- **Dependency.** Keputusan produk: apakah dunia boleh ditimpa tanpa konfirmasi; dukungan ekspor/impor dunia eksplorasi (Trade sudah punya).
- **Acceptance.** (1) Kegagalan simpan peta ditampilkan sebagai status yang terlihat (pola "Belum tersimpan" di Trade). (2) Regenerasi meminta konfirmasi dan menyebut jumlah dunia/campaign yang terdampak. (3) Ukuran entri `worldId` terbesar diukur pada sesi bermain panjang (V-07).
- **Risiko.** Mengubah format simpan peta menyentuh `planet_globe_map_v5`; perlu migrasi.

### G-05 (P1) Payload dan resource untuk komputer lemah belum terbukti

- **Bukti.**
  - Town: 38.077.199 B di disk dari 17 file (dihitung ulang). Manifest total 55.798.604 B (§5.4).
  - Aset terkirim tanpa pemakai kode: `npc.glb` 227.016 B + `character.glb` 1.379.572 B = **1.606.588 B**. Pencarian hanya literal `npcPack`/`characterPack`; pemakaian dinamis lewat `ASSETS[...]` tidak diperiksa. `tests/asset-manifest.test.js` hanya menguji manifest ↔ `public/`, bukan manifest ↔ pemakai kode.
  - `interior_atlas.jpg` dan `furniture.glb` dimuat eager (K8).
  - Laporan 9 Okt: puncak RAM/VRAM/energi tidak diukur; budget "Hemat" berlabel usulan.
  - Dua `PlanetRenderer` singleton (§5.1) tidak diukur.
- **Dampak.** Klaim "bisa jalan di laptop RAM 8 GB iGPU" tidak punya dasar. Pemain pertama menunggu puluhan MB sebelum Town.
- **Dependency.** Keputusan target perangkat (pemilik); hasil V-07/V-08.
- **Acceptance.** Tabel byte per rute (Space, Planet, Town, Home, Trade) dengan metode (transfer terkompresi, bukan byte disk); baseline memori per rute; manifest memiliki field "dipakai oleh" dan test gagal untuk entri yatim; jalur cold Town ≤ budget yang disetujui.
- **Risiko.** Mengganti loader atau kompresi (KTX2) menambah pipeline Blender dan mengubah tampilan; perlu persetujuan visual.

### G-06 (P1) Jalur gagal dan race di Director/TownMode

- **Bukti.**
  - `director.js:103-111`: kegagalan mode selain Trade hanya `overlay.setProgress(null, t('loading.failed'))` (`id/core.js`: "Muat ulang halaman"). Cover sudah naik (`switchTo` langkah 1) dan tidak ada langkah pemulihan. Jika `enter()` gagal sesudah `this.mode.exit()` (`:146-150`), `this.mode` = `null` dan mesin kosong sampai reload.
  - `TownMode.enterBuilding()` (`:698-759`) dan `exitBuilding()` (`:761-796`) menunggu fade lalu mengubah `this.interior`/`this.hud`. `exit()` (`:1756`) tidak membatalkan operasi yang sedang menunggu. Jika `Director` memanggil `exit()` saat `enterBuilding` menunggu `overlay.cover`, kelanjutannya memakai HUD yang sudah di-dispose dan membuat `Interior` yang tidak pernah dibuang. **Plausibel dari pembacaan source; belum direproduksi.**
  - `packs()`: `loadAssetPack(ASSETS.planetPack)` tanpa `.catch` (`:54`); satu aset hilang atau jaringan putus menggagalkan seluruh Town.
  - `director-resume.test.js` memakai mock dan tidak menguji jalur gagal.
- **Dampak.** Pemain dengan jaringan buruk atau yang menekan back/forward saat transisi bisa berakhir di layar gagal atau state setengah jadi.
- **Dependency.** Tidak ada.
- **Acceptance.** (1) Test dengan `prepare()`/`enter()` yang dipaksa gagal untuk tiap mode: UI kembali ke mode sebelumnya atau ke Planet dengan pesan, tanpa reload. (2) Test navigasi hash saat fade interior: tanpa `engine.lastError`, tanpa `Interior` yatim (hitung geometry/texture sebelum dan sesudah). (3) Pemuatan `planetPack` tidak fatal bila fallback tersedia.
- **Risiko.** Pengerasan jalur gagal menyentuh `Director` yang dipakai semua mode; butuh regresi lintas mode.

### G-07 (P1) Ketahanan Trade pada waktu panjang dan perubahan generator

- **Bukti.**
  - `session.js:97-110`: `accumulator += elapsed * speed`, maksimum 120 tick per `pump` (interval 250 ms), tanpa batas atas akumulator. `run()` melempar `trade.error.catchup` selama `accumulator ≥ 1` (`:113`). Setelah tab tersembunyi lama (timer browser dibatasi), antrean bisa panjang dan perintah pemain ditolak sampai habis. `TRADE_GAME_RUNTIME.md` mengakui throttling latar belakang berjam-jam **belum** diuji.
  - `session.js:53` dan `resources.js:21-24`: campaign hanya bisa dilanjutkan bila `fingerprint(mapFor(planet))` sama persis. Perubahan generator peta yang mengubah biome/elevasi/kelembapan/sungai untuk planet Terran non-rumah (dibuat ulang dari seed) menjadikan campaign `trade.error.world` walau `base` tersimpan lengkap (sekitar 183 KB di `campaign-export.json`). Planet rumah disimpan di `localStorage` sehingga lebih aman.
  - Tidak ada migrasi untuk `schema: 1` (G-03).
  - Renderer planet Trade tidak pernah di-dispose (`TradeMode.js:11-21`).
  - Skrip QA hanya manual (`tools/qa/trade_game.mjs`, butuh `PLAYWRIGHT_CORE`).
- **Dampak.** Campaign panjang bisa terasa membeku atau tidak bisa dimuat setelah update game.
- **Dependency.** Keputusan produk: apakah campaign harus tahan terhadap perubahan generator peta (memakai `base` tersimpan sebagai sumber kebenaran).
- **Acceptance.** (1) Batas atas akumulator atau mode simulasi agregat, dengan test jam terkontrol. (2) `resume()` memakai `base` tersimpan; fingerprint hanya memperingatkan. (3) Soak tab latar 30 menit di browser nyata dengan angka tick yang tercatat (V-09).
- **Risiko.** Mengubah semantik waktu menyentuh determinisme yang diuji `tools/qa/trade_campaign.mjs`.

### G-08 (P1) Tidak ada gerbang QA terpadu

- **Bukti.** `.github/` tidak ada; `npm test` hanya Node (`package.json`); semua QA browser dijalankan manual per fitur; Skirmish tanpa QA browser; QA Home tertanggal 4 Okt, sebelum Town v5 dan Pixel (7–8 Okt); satu-satunya laporan runtime terbaru memakai tanggal 9 Okt 16:22 (Trade), dan sesudahnya ada perubahan `chunkyPeople.js` dan seluruh `src/valley/`.
- **Dampak.** Tidak ada cara cepat menjawab "apa yang rusak sejak kemarin" selain menjalankan semua skrip manual.
- **Dependency.** G-01 (commit) dan keputusan hosting CI (di luar mandat).
- **Acceptance.** Satu perintah smoke yang memeriksa semua route (`#/space`, `#/planet`, `#/town`, `#/home`, `#/trade`, `farm.html`, `skirmish.html`) membaca `engine.lastError`, page error, dan hitung geometry/texture; hasilnya JSON bertanggal di `docs/qa/`.
- **Risiko.** Browser headless tidak mewakili pemain nyata (tab latar, pointer lock, DPR); jangan mengganti playtest.

### G-09 (P1) Kebenaran dokumen dan pemilik status

- **Bukti.** K1…K14 (§4). `docs/README.md` menyatakan `IMPLEMENTATION_STATUS.md` adalah "Sumber kebenaran status", padahal isinya memuat angka September yang tidak dikoreksi (K1, K2) dan checkpoint 25–30% yang dimaksudkan historis.
- **Dampak.** Siapa pun yang membaca README mendapat gambaran proyek yang salah (empat level; tanpa Trade/Home/Valley/Skirmish).
- **Dependency.** Lead (pemilik board). Dokumen existing read-only pada milestone ini.
- **Acceptance.** Satu tabel status bertanggal dengan sumber; setiap angka punya tanggal dan cara ukur (aturan `docs/README.md` sendiri); K1…K14 ditutup atau diberi catatan.
- **Risiko.** Koreksi dokumen tanpa run baru hanya memindahkan angka basi.

### G-10 (P2) Navigasi/portal dan interior: fitur yang belum ada, bukan cacat

- **Bukti.** Dokumen: WB-05 (warga bernama, jadwal), WB-06 (POI), WB-07 (ekonomi port), WB-08 (event) "Belum"; interior belum mendukung membawa barang antar lantai; portal terhalang/terisolasi hanya ditandai di graph (`walkNetwork.js`) dan belum dikonsumsi (§5.2).
- **Dampak.** Ini adalah isi roadmap, bukan bug. Tidak ada klaim di dokumen yang bertentangan dengan source.
- **Dependency.** Keputusan roadmap pemilik; bergantung pada G-03 bila menambah household ke save.
- **Acceptance.** Diputuskan di ROADMAP lead. Bila dikerjakan, tambah diagnosis per seed (jumlah portal `reason ≠ null`).
- **Risiko.** Fitur warga/jadwal menambah state kanonik yang harus ber-versi (lihat G-03).

## 7. Rencana verifikasi yang belum ada atau belum dijalankan

Tidak satu pun dijalankan pada checkpoint ini. Urutan mengikuti dependency.

| ID | Pemeriksaan | Metode (tanpa asumsi) | Bukti selesai | Mencakup |
|---|---|---|---|---|
| V-01 | Baseline test | `npm test` pada commit/branch yang diputuskan; catat jumlah lulus/gagal/lewati dan versi Node | Log bertanggal; satu angka menggantikan K1 | G-08, G-09 |
| V-02 | Baseline build | `npm run build` ke direktori sementara; catat byte chunk dan aset di `dist/` | Tabel byte per chunk dan per file | G-05 |
| V-03 | Ulang QA Trade | `tools/qa/trade_game.mjs` dan `trade_campaign.mjs` (butuh `PLAYWRIGHT_CORE`, Chrome) pada tree saat ini | `report.json` baru; bandingkan tanggal 9 Okt | G-07, G-08 |
| V-04 | Smoke lintas route | Skrip baru atau harness `tests/browser/`: tiap route, baca `engine.lastError`, page error, geometry/texture sebelum dan sesudah 6 siklus | JSON hasil, nol error, hitungan stabil | G-02, G-06, G-08 |
| V-05 | Injeksi kegagalan | Blokir satu aset (mis. `assets.glb`), putuskan jaringan di tengah transisi, tekan back saat fade interior | Pemulihan tanpa reload atau pesan jelas; tanpa `Interior` yatim | G-06 |
| V-06 | Fixture save | Siapkan IndexedDB dengan `town-layout` v1…v4 (subdivision 5), interior schema 1/2/unknown, home record, Trade schema 1; muat di Node dan browser | Hasil tabel: dimuat / dikarantina / ditimpa; tidak ada penimpaan diam-diam | G-03 |
| V-07 | Soak memori | 20 pergantian mode (Space → Planet → Town → Interior → Home → Trade), 30 menit traversal; catat heap JS, geometry/texture three, ukuran entri IndexedDB `worldId` | Grafik plateau; angka puncak | G-04, G-05 |
| V-08 | Perangkat lemah | Minimal satu iGPU lama dan satu laptop baru, plus M1 Pro sebagai pembanding (sesuai laporan 9 Okt); p95/p99, transfer terkompresi aktual | Tabel per perangkat; tidak ada klaim tanpa perangkat | G-05 |
| V-09 | Trade tab latar | Campaign berjalan 30 menit di tab tersembunyi pada kecepatan 4×, lalu kembali | Jumlah tick dan durasi `trade.error.catchup` | G-07 |
| V-10 | Skirmish smoke | Satu skrip yang memuat `skirmish.html`, menjalankan satu giliran, membaca error | Laporan di `docs/qa/skirmish/` | G-08 |
| V-11 | Playtest manusia | Pemilik atau tester memainkan loop inti Universe, Trade, Valley sesuai skenario yang disusun role design | Catatan playtest bertanggal | Semua; diperlukan sebelum klaim "menyenangkan" |

## 8. Hal yang tidak diketahui atau belum dibuka

- Isi runtime semua mode pada tree saat ini (RT tidak dilakukan).
- Jumlah test aktual dan apakah semuanya lulus (K1).
- `SpaceMode.js`, `menuController.js`, `planetRenderer.js` bagian dalam, internal `simulation.js` di luar `validateState`, internal Skirmish dan Valley hanya terbaca pada tingkat struktur. Klaim dokumen tentang bagian tersebut tidak saya verifikasi.
- Dokumen yang tidak dibaca isinya: `TRADE_GAME_IMPLEMENTATION_PLAN.md` (49 KB), `ART_DIRECTION.md`, `WORLD_BUILDING_ROADMAP.md`, `ASSET_ART_AUDIO_PLAN.md`, `TOWN_GENERATION_PLAN.md`, `TOWN_PLAN_V3.md`, `WATABOU_WORLD_BUILDING_NOTES.md`, `PIXEL_TOWN.md` dan `docs/qa/pixel-town/`. Penilaian visual, desain, dan arah seni ada di ranah review design/art.
- Apakah `firebase` dipakai di runtime (K4).
- Apakah `chunkyPeople.js` berubah perilaku untuk Town. Saya hanya mengandalkan klaim `FARM_PLAN.md` (opt-in, ada tes default) dan mtime.
- Status git: output `git status` dan `git log` berasal dari header sesi dan satu perintah awal yang lead nyatakan dibatalkan. Tidak ada git tambahan yang dijalankan. Perlakukan daftar `??` yang tidak ada di header sebagai petunjuk.

## 9. Lampiran: apa yang dibaca dan angka yang dihitung

Dokumen dibaca penuh: `STUDIO.md`, `TASKS.md`, `docs/README.md`, `IMPLEMENTATION_STATUS.md`, `ARCHITECTURE.md`, `TRADE_GAME_RUNTIME.md`, `WEBGAME_RESOURCE_PERFORMANCE_REPORT_2026_10_09.md`, `ASSETS.md` (baris 1–120), `FARM_PLAN.md`. Sebagian: `SKIRMISH_PLAN.md`, `PROCEDURAL_HOME_BUILDING_QA.md`, `TOWN_COMPACT_ASSETS_QA.md`, `TOWN_GRAPHICS_LOD_QA.md`, `docs/qa/cozy-actors/README.md`, `docs/qa/town-polish/README.md` (hanya bagian awal), `DEPLOYMENT.md`.

Source dibaca: `core/director.js`, `core/router.js`, `world/stateStore.js`, `world/townGeneration.js`, `world/homeState.js`, `world/identity.js`, `world/buildingBlueprint.js`, `world/world.js`, `trade/session.js`, `trade/entry.js`, `trade/resources.js`, `trade/simulation.js` (`validateState`), `modes/trade/TradeMode.js`, `modes/town/TownMode.js` (baris 1–270, 650–910, 1715–1784), `modes/planet/PlanetMode.js` (bagian awal dan `regenerate`), `render/assetManifest.js`, `package.json`, `vite.config.js`, `firebase.json`, `wrangler.jsonc`. Dicari dengan grep: pemakaian `layoutVersion`, `GENERATOR_VERSIONS`, `ASSETS.*`, import Skirmish, `portal`/`reason` di `walkNetwork.js`, tes `generateTownLayout`. Test dibaca: `director-resume`, `asset-manifest`, bagian `town-compact-generation`, daftar nama `trade-game`, `world-foundation`, `home-state`.

Angka yang dihitung read-only pada review ini (10 Okt 2026, `stat -f%z`):

| Ukuran | Byte |
|---|---:|
| 27 file `ASSET_FILES` | 55.798.604 |
| 17 file jalur Town (daftar `town_prepare_dependency_keys`) | 38.077.199 |
| Pack Skirmish (10 file: tentara m/f, atlas, potret, env, military) | 33.491.132 |
| Pack Valley (3 file) | 4.002.724 |
| Pack planet (`assets.glb` + `assets_lod0.glb`) | 631.296 |
| `npc.glb` + `character.glb` (tanpa pemakai literal di `src/`) | 1.606.588 |
| `town.glb` | 5.867.392 |
| `home_cozy.glb` | 3.791.532 |

Baris kode (`wc -l`, 10 Okt): `TownMode.js` 1.784; `planetRenderer.js` 3.168; `PlanetMode.js` 459; `interior.js` 725; `director.js` 172; `session.js` 159; `simulation.js` 407; `TradeMode.js` 160. Berkas test: 39 file `*.test.js`.

Metode `find -newer` terhadap `docs/qa/trade-game/report.json` (9 Okt 16:22) menghasilkan file `src/valley/**`, `public/models/valley_*.glb`, `tests/valley-*.test.js`, `tools/qa/valley_*.mjs`, dan `src/modes/town/people/chunkyPeople.js`. Di `docs/` hanya `FARM_PLAN.md`, `README.md`, dan laporan performa yang lebih baru.
