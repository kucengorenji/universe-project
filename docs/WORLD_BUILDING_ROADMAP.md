# Globe Universe — roadmap dunia prosedural yang hidup

**Plan pendamping aset dan atmosfer:** [Asset, Art & Audio Plan](ASSET_ART_AUDIO_PLAN.md) merinci modern mapping, pelabuhan, pemisahan land-use, model mid-poly bertekstur, variasi vegetasi/NPC, air pantai, relief town dan musik. Milestone AA-00–09 di dokumen itu menyebut dependency WB; keduanya harus memakai blueprint/state yang sama.

Disusun 26 September 2026 dari [riset Watabou](WATABOU_WORLD_BUILDING_NOTES.md) dan pembacaan source Globe. **Implementasi telah dimulai. Status aktual, hasil verifikasi, dan batas fitur ada di [Implementation Status](IMPLEMENTATION_STATUS.md). Checkbox di bawah hanya ditutup setelah acceptance milestone terpenuhi.**

## Keputusan prioritas

**P0: identitas + state → satu alur planet–town–rumah yang konsisten. P1: morphology + rutinitas + perdagangan antarskala. P2: perluasan konten.**

Pertahankan generator dan render yang sudah bekerja. `plan.md` dan `TILES_ROADMAP.md` memuat konteks historis; untuk world building baru, gunakan urutan di sini. Densitas tile, neon, dan kenaikan polygon bukan dependency utama agar dunia terasa hidup.

## Milestone dan dependency

| ID | Prioritas / ukuran relatif | Deliverable | Dependency |
|---|---|---|---|
| WB-00 | P0 / kecil | Baseline, kontrak waktu dan fixture seed | Tidak ada |
| WB-01 | P0 / sedang | Stable IDs, manifest, store delta dan migration | WB-00 |
| WB-02 | P0 / sedang | Kontrak region → town → building → portal | WB-01 |
| WB-03 | P0 / besar | Interior mengikuti footprint dan state bertahan | WB-02 |
| WB-04 | P1 / besar | Village/district/parcel generator dengan akses valid | WB-02; migrasi bangunan dari WB-01 |
| WB-05 | P1 / besar | Household dan rutinitas penduduk | WB-03; graph WB-02, kemudian manfaatkan WB-04 |
| WB-06 | P1 / sedang | Planet region dan POI yang bisa dieksplorasi | WB-02 |
| WB-07 | P1 / besar | Kargo orbit → port → pasar → rumah/toko | WB-05, WB-06 |
| WB-08 | P2 / sedang–besar | Cerita/event, cuaca, detail budaya dan encounter | WB-05–07 |

Ukuran adalah perkiraan kompleksitas, bukan janji durasi. Selesaikan satu vertical slice P0 sebelum memperluas semua planet/kota.

## WB-00 — baseline dan kontrak

- [ ] Tetapkan fixture world seed dan kota: fantasy inland, modern, coastal, desert; tambahkan fixture tepi pentagon untuk proyeksi planet.
- [ ] Catat ukuran blueprint, waktu generate, frame time, memory dan transisi pada device/resolusi/tier yang disebutkan.
- [ ] Tentukan kontrak `pause`, `sleep`, offline catch-up dan local day; uji `World.now()` terhadap menu jeda dan tab background.
- [ ] Rekam snapshot peta, layout dan pintu sebelum generator berubah.

**File utama:** `src/world/world.js`, `src/core/pauseMenu.js`, `src/core/engine.js`, `src/modes/town/sky.js`. Usulan folder fixture: `tests/fixtures/world/` (belum ada dalam scope dokumen ini).

**Selesai jika:** baseline dapat direproduksi dan clock policy tertulis beserta test. Klaim FPS README lama bukan baseline pengukuran baru.

## WB-01 — identitas dan penyimpanan lintas level

- [x] Tambah pure helpers `src/world/identity.js` dan manifest/version registry.
- [ ] Adapter ID untuk planet, city, building dan interactable yang ada; jangan memakai `door.i` sebagai identity jangka panjang.
- [x] Tambah `src/world/stateStore.js`: IndexedDB untuk world manifest/delta; localStorage juga menyimpan journal pemulihan delta kecil.
- [ ] Pisahkan profile achievement dari quest per-world; migrasi `planet_globe_missions` dengan kebijakan eksplisit.
- [ ] Snapshot sebelum migrasi; migration idempotent dan recovery jika write gagal.
- [x] Simpan state interior sebelum scene di-dispose dan restore saat masuk kembali.

**Integrasi:** `world.js`, `mapGenerator.js`, `townLayout.js`, `TownMode.js`, `interior.js`, `missions.js`.

**Selesai jika:** pindah barang, nyalakan lampu, keluar rumah, pergi ke planet lain, reload, kembali—hasilnya tetap ada; world seed lain terisolasi; LRU non-home map tidak menghapus delta. Reload/migration ulang tidak menggandakan barang atau reward.

## WB-02 — satu kontrak ruang antarskala

- [ ] Definisikan descriptor region/settlement dan BuildingBlueprint tanpa renderer.
- [ ] Ambil coast, river, road exit dan port anchors dari map; pertahankan identitas dan orientasinya saat diproyeksikan.
- [x] Bangunan mempunyai footprint meter, transform, floor count, entrance sockets, style dan use melalui adapter shell + metadata town yang ada.
- [ ] Tambah metadata dari `tools/blender/build_town_space.py`; bangunan lama memakai adapter yang terdokumentasi.
- [ ] Bentuk portal graph: street → entrance → interior spawn; uji transform masuk/keluar dua arah.
- [ ] Namespace seed per subsistem dan pisahkan canonical blueprint dari quality detail.

**Integrasi:** `townLayout.js`, `townBuilder.js`, `TownMode.js`, `assetLibrary.js`, `planetRenderer.js`.

**Selesai jika:** pintu menghadap jalan yang dapat dicapai, footprint luar/dalam konsisten, port menghadap air; renderer/minimap/collider mengambil blueprint yang sama; high/low quality memberi ID dan layout gameplay identik.

## WB-03 — rumah benar-benar memiliki denah

- [x] Tambah pure `src/modes/town/interiorLayout.js`; `interior.js` menjadi consumer blueprint dan adapter interaksi.
- [ ] Implementasikan room adjacency dan footprint partition untuk pondok, rumah dua lantai dan rumah-toko.
- [x] Reservasi tangga, pintu dan jalur sirkulasi sebelum furniture placement.
- [x] Furnitur memakai footprint, interaction approach area dan stable IDs.
- [x] Bounded retries; tidak memangkas jumlah lantai ketika furnitur sulit ditempatkan. Seluruh lantai shell mendapat akses tangga; prop tambahan yang tidak muat dilewati.
- [ ] Cache blueprint on-demand; disposal mesh tidak menghapus data.
- [x] Tambahkan restore route/building context; URL lama tetap valid. Interior tetap menjadi substate TownMode, resume ke spawn lantai yang aman.

**Integrasi:** `interior.js`, `TownMode.js`, `colliders.js`, `router.js`, `director.js`, pipeline furniture/architecture Blender.

**Selesai jika:** seluruh ruang wajib terjangkau dari pintu; tangga menghubungkan lantai yang benar; furnitur tidak memblokir portal; posisi keluar tepat; state WB-01 tetap bertahan. Layout memiliki variasi struktur, bukan hanya pergantian warna.

## WB-04 — morphology kota dan desa

- [ ] Pecah logika dalam `townLayout.js` bertahap ke generator archetype, district dan parcel data.
- [ ] Village: jalan → frontage rumah → kebun → ladang. Medieval: district/patch → streets → parcels. Modern: oriented blocks. Colony menjadi archetype berikutnya setelah tiga pertama lolos.
- [ ] Jadikan gate/port/bridge/plaza anchor wajib; sediakan street hierarchy dan ruang terbuka.
- [ ] Tambah role settlement: farming, fishing, trade, administration; kebutuhan role mengatur komposisi bangunan.
- [ ] Constraints parcel: di dalam buildable mask, tidak overlap, frontage dapat dicapai, setback jalan/sungai, ukuran minimum.
- [ ] Graph jalan dipakai bersama oleh ground paint, pedestrian, fleet, minimap dan quest navigation.

**Integrasi:** `townLayout.js`, `groundPaint.js`, `townBuilder.js`, `crowd.js`, `fleet.js`, `src/ui/gauges.js`.

**Selesai jika:** archetype berbeda dapat dikenali tanpa label; semua pintu gameplay terhubung ke jaringan jalan; sungai/pantai/gerbang tetap sesuai planet. Existing world memakai generator version lama atau migration mapping yang sudah diuji.

## WB-05 — penghuni punya rumah, pekerjaan dan jadwal

- [ ] Tambah `src/world/households.js` dan `src/world/simulation.js` sebagai modul data/simulasi baru.
- [ ] Mulai 8 household bernama dalam satu distrik fixture; jumlah crowd dekoratif tetap mengikuti quality.
- [ ] Jadwal: rumah → kerja/pasar → kedai/ruang sosial → rumah, berdasarkan local day.
- [ ] NPC menempuh graph antar-node dan portals, tidak sekadar berbalik di ujung polyline.
- [ ] Representasi dekat: mesh/path/interaction. Jauh: aktivitas, lokasi logis dan next event. Tidak menjalankan semua NPC tiap frame.
- [ ] Occupancy rumah, toko dan kursi berasal dari state yang sama. Transisi interior/eksterior tidak menduplikasi orang.

**Integrasi:** `crowd.js`, `peopleRig.js`, `TownMode.js`, `interior.js`, `world.js` dan `core/audio.js`.

**Selesai jika:** satu NPC dapat diikuti berangkat kerja dan pulang; sleep/reload/mode switch memperbarui aktivitas secara konsisten; rumah kosong saat semua penghuninya pergi; NPC target misi tidak hilang karena quality rendah.

## WB-06 — planet memiliki region dan tempat tujuan

- [ ] Turunkan region dari data terrain yang ada: nama, budaya, specialization, hazard dan landscape features.
- [ ] Tambah POI sesuai biome dan akses: lookout, ruin, cave, abandoned outpost; bukan scatter bebas.
- [ ] Beri POI entrance anchor, footprint, landmark proxy di planet, dan local encounter blueprint.
- [ ] Gunakan graph ruang kecil untuk cave/clearing/ruin dengan dressing berbeda; tentukan entrance, exit, objective dan fallback.
- [ ] Pertahankan kesamaan fitur besar pada bake orbit, planet dan town; revision key membatalkan cache yang benar saja.

**Integrasi:** `mapGenerator.js`, `planetTypes.js`, `world.js`, `planetBake.worker.js`, `PlanetMode.js`, `planetRover.js`, `menuController.js`.

**Selesai jika:** POI di globe sama dengan lokasi yang dikunjungi; semua objective reachable; cave tidak mengubah topologi planet; landmark belum dikunjungi tetap reproducible dari seed.

## WB-07 — space dan settlement terhubung oleh perdagangan

- [ ] Tambah logical port/station IDs, komoditas dan route graph; batasi MVP pada dua planet inhabited, dua kota port dan tiga komoditas.
- [ ] Shipment memiliki cargo, origin, destination, departure/arrival time dan event ID.
- [ ] `SpaceTraffic` menampilkan shipment/patrol state; keputusan tujuan tidak dikonsumsi dari RNG setiap frame.
- [ ] Kedatangan memperbarui stok port; transport lokal menghubungkan gudang dengan pasar/toko.
- [ ] Tambah satu quest pengiriman dengan prasyarat nyata dan reward idempotent.
- [ ] Konsistensi transaksi: keberangkatan mengurangi origin stock/reservasi; arrival menambah destination sekali; replay event tidak menambah lagi.

**Integrasi:** `solarSystem.js`, `space/traffic.js`, `SpaceMode.js`, `town/fleet.js`, `interior.js`, `missions.js`; usulan `src/world/economy.js`.

**Selesai jika:** pemain dapat melihat perjalanan kargo, tiba di port, dan perubahan stok di toko; reload sebelum/sesudah arrival tidak menduplikasi cargo; kapal tidak memerlukan surface landing di gas giant.

## WB-08 — identitas, cerita dan atmosfer

- [ ] Fakta sejarah ringkas dan culture profile menurunkan nama, simbol, material dan props.
- [ ] Weather/event state memengaruhi rutinitas, lampu, audio dan aktivitas luar—bukan hanya partikel.
- [ ] Room acoustics: audio jalan meredam di dalam, suara hujan lewat bukaan, kegiatan penghuni mengikuti occupancy.
- [ ] Bangun quest dari kebutuhan tempat: kekurangan barang, perbaikan, temuan POI, permintaan penghuni.
- [ ] Tambah seasonal vegetation, signage, mercusuar, fleet variants dan constellation lore setelah core consistency lolos.

**Selesai jika:** event mempunyai penyebab dan akibat yang dapat dilihat pada lebih dari satu skala; dialog dan dressing tidak bertentangan dengan state dunia.

## Vertical slice pertama

Setelah WB-03, demonstrasikan: dari orbit pilih home planet → kunjungi satu kota existing → masuk rumah-toko dengan footprint benar → naik ke ruang tidur → pindah barang/nyalakan lampu → keluar → pindah mode → reload → kembali ke rumah yang sama. Semua state dan orientasi pintu bertahan.

Setelah WB-07, perluas demonstrasi: shipment berangkat → bongkar di port → stok toko bertambah → pemilik pulang ke rumah → pemain mengambil quest untuk kebutuhan toko tersebut. Gunakan fixture yang memenuhi constraint, bukan memilih kota sembarang yang kebetulan bukan port.

## Validasi yang wajib saat implementasi

| Pemeriksaan | Acceptance target |
|---|---|
| Reproducibility | Seed + manifest + versi + options yang sama menghasilkan canonical blueprint hash sama; urutan mengunjungi planet tidak memengaruhi hasil. |
| Stream independence | Menambah variasi bunga tidak menggeser rumah, pintu, household atau quest. |
| Quality independence | Low/high menghasilkan graph gameplay, ID dan inventory sama. |
| Topologi | Semua portal/room/quest target wajib reachable; tidak ada tangga buntu, entrance tertutup atau plot di air. |
| Geometry | Interior contained dalam building envelope; door transforms round-trip dalam toleransi meter yang didefinisikan. |
| State | Save/reload, LRU eviction, reset world, migration ulang, storage error, event replay dan sleep diuji. |
| Clock | Pause/resume/background/offline/time skip konsisten dengan kontrak WB-00; tidak ada catch-up per-frame tak terbatas. |
| Sampling | Mulai setidaknya 100 seed per archetype ditambah fixture coastal, sempit, ekstrem dan pentagon; simpan setiap failure seed. Angka ini target awal, bukan bukti coverage lengkap. |
| Runtime | Smoke test empat level, rute lama, interaksi furnitur, misi lama, vehicle dan mode transitions. |
| Performance | Target awal p95 frame time ≤16,7 ms desktop / ≤33,3 ms mobile referensi; catat device/resolusi/tier. Ini target, belum hasil ukur. |
| Lifecycle | 20 siklus masuk/keluar dan pergantian mode tidak menunjukkan pertumbuhan mesh/listener/memory yang terus-menerus setelah warm-up. |

Bila generation membuat long task, pecah pekerjaan atau gunakan worker; awali dengan pengukuran. Budget simulasi dekat yang diusulkan ≤2 ms/frame desktop, dan update jauh berbasis event. Jangan mencapai target FPS dengan menghapus NPC quest atau mengganti layout.

## Urutan pembaruan file rencana

1. Roadmap ini menjadi checklist aktif; catatan riset menyimpan alasan dan sumber.
2. `plan.md`: tandai konteks 14 September sebagai historis, tautkan milestone baru; jangan mengklaim rencana di sini sudah selesai.
3. `TILES_ROADMAP.md`: arahkan prioritas aset ke footprint, sockets, modular interiors, interaction anchors dan LOD.
4. `README.md`: tautkan dokumen baru; setelah implementasi tiap milestone, tambahkan perilaku yang benar-benar tersedia beserta cara memverifikasinya.

## Ditunda dengan sengaja

Galaksi tanpa batas, simulasi fisika orbital penuh, semua bangunan langsung enterable, port source Watabou, importer JSON universal, multiplayer dan generasi dialog AI real-time. Semuanya menambah cakupan sebelum hubungan antarskala terbukti. Evaluasi kembali setelah vertical slice WB-07 lolos.
