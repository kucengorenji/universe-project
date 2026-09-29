# Globe Universe — status implementasi

Diperbarui 29 September 2026. Ini adalah catatan implementasi aktual untuk [world building](WORLD_BUILDING_ROADMAP.md) dan [aset/art/audio](ASSET_ART_AUDIO_PLAN.md), bukan daftar fitur yang seluruhnya sudah selesai.

**Checkpoint 26 September: kira-kira 25% dari cakupan gabungan.** Estimasi ini mempertimbangkan deliverable yang sudah terhubung ke game; bukan persentase LOC atau jumlah checkbox. Sistem penduduk, POI, ekonomi dan event masih besar. Validasi visual/performa yang belum dilakukan tidak dihitung sebagai selesai.

**Checkpoint 27 September: kira-kira 30%.** Tambahan utama adalah interior yang mengikuti shell, lantai bertingkat, akses furnitur yang diperiksa, dan pemulihan konteks bangunan. Persentase tetap perkiraan cakupan, bukan ukuran presisi atau janji waktu selesai.

**Lanjutan 27 September — fokus kota hidup:** implementasi vegetasi, ruang publik modern/fantasy, foliage cutout, material bangunan/jembatan dan pack scenery sudah terhubung dan diuji. Detail deliverable, budget dan batasnya ada di [Living Towns Implementation](LIVING_TOWNS_IMPLEMENTATION.md). Angka 30% di atas adalah checkpoint sebelum art pass ini, bukan pengukuran progres terbaru dari seluruh roadmap.

## Revisi 29 September — tata kota dan kontrol

Enam koreksi pengguna diimplementasikan: morphology v2 modern/fantasy, jalan/material berskala meter, foliage palem/jarum/daun lebar, pencahayaan jalan, zoom town tanpa auto-exit, navigasi kota kiri, driving dan gait, serta relief lebih landai. [Catatan implementasi dan QA lengkap](TOWN_REFINEMENT_2026_09_29.md) menjadi rujukan terbaru untuk area ini; checkpoint 27 September di bawah bersifat historis.

24 test lolos, sweep 30 seed lolos, build produksi lolos. Navigasi pejalan kaki telah diuji 180 detik per era/tier; enam penggantian scene stabil setelah cache hangat. Pack scenery terbaru **1.244.892 byte**. Kota dengan interior lama tetap memakai parcel v1; belum ada migrasi layout lama ke v2. Kemajuan ini tidak menandakan seluruh roadmap dunia selesai.

## Revisi 29 September (lanjutan) — struktur, art direction, planner kota

- Struktur kode: `modes/town/` dikelompokkan ke `layout/`, `navigation/`, `render/`, `people/`, `vehicles/`, `interior/`, `planner/`, `ui/`. RNG dipindah ke `math/random.js`, konstanta skala ke `modes/town/scale.js`, dan semua URL aset dikumpulkan di `render/assetManifest.js`. Tidak ada perubahan perilaku; 16 kota asli identik dengan `bc791db`.
- Art direction ([status AD](ART_DIRECTION.md)): palet atap per kota, scenery memakai ramp toon, rumput mengikuti warna tanah, kaca siang dengan mullion, perbaikan alpha `farTrees`, tabrakan kamera jalan kaki, dan lantai marmer berlempeng.
- Planner kota 2D ([rencana generator](TOWN_GENERATION_PLAN.md)): tombol Tata kota, acak ulang yang mempertahankan terrain, kepadatan Jarang/Normal/Padat, dan Terapkan yang membangun ulang town dari layout yang sama.
- Verifikasi: `npm test` 30/30, `GLOBE_SWEEP_SEEDS=30` untuk generation/walk-network lolos, dan `npm run build` lolos. Pemeriksaan visual di in-app browser mencakup overview dan close-up fantasy, peta 2D, reroll, kepadatan, Terapkan, jalan modern tanpa pita horizon, kamera jalan kaki, dan lantai interior (sebelum penurunan kontras).

## Sudah terpasang

- Identitas bangunan deterministik, namespace seed, world manifest dan IndexedDB dengan journal pemulihan localStorage. Transaksi menggabungkan delta agar dua tab yang menyimpan ruangan berbeda tidak saling menimpa seluruh dunia.
- State lampu, kabinet, media, api dan posisi barang dipulihkan setelah interior dibuang dan dibuat ulang. Dunia berbeda mempunyai namespace penyimpanan berbeda.
- Menu pause membekukan world clock; waktu offline tetap berjalan; tidur menambah offset waktu.
- Pemeriksaan footprint kering pada placement bangunan, parcel modern/fantasy dan landmark. Ladang mengecek sungai, jalan dan okupansi; exclusion vegetasi memakai persegi panjang ladang yang diputar.
- Paket `scenery.glb`: 8 spesies pohon + 4 siluet tambahan, 2 understory, 3 prop taman, 2 dermaga dan peti modular; **20 asset ID**, masing-masing 3 LOD. Ukuran **1.184.656 byte**, atlas surface 256² + foliage 512², dua material. Atlas bangunan bersama 512² berukuran **107.856 byte**. Loader mempertahankan UV, normal dan indeks geometri; manifest memuat bounds, triangle count dan hash pack. Dibuat memakai Blender CLI karena MCP Blender tidak tersedia.
- Warna kulit/rambut/atasan/bawahan/sepatu dan wajah NPC dekat memakai seed. Pool rig memilih outfit yang sama untuk walker yang sama. Atlas wajah dibagi bersama. Bentuk rambut dan potongan pakaian masih berasal dari outfit authored, belum kit mesh terpisah.
- Air town mendapat caustics dangkal dan breaker foam. Musik town/interior mendapat motif tambahan; pergantian scene mempertahankan urutan frase. Belum ada listening pass 10 menit.
- Relief town kondisional berdasarkan pegunungan sekitar dari planet, permukaan bergelombang panjang dan pad fondasi. Ini belum contour-road planner atau sistem retaining wall lengkap.
- Pijakan deck dermaga/jembatan dipakai dalam pemeriksaan berjalan; kapal dekoratif hanya dipasang bila footprint-nya berada di air.

## Penambahan 27 September

- `buildingBlueprint.js` mengadaptasi ukuran shell, jumlah lantai dan posisi pintu dari generator Blender. Transform pintu menggunakan posisi/rotasi/skala yang sama dengan bangunan.
- `interiorLayout.js` menghasilkan denah per lantai. Dimensi dalam dibatasi shell, area sirkulasi dan tangga direservasi dahulu, furnitur menggunakan bounding box mesh, lalu keterjangkauan titik interaksi diperiksa dengan flood fill beradius pemain.
- Interior renderer mengonsumsi blueprint, termasuk partisi, tangga, titik interaksi dan indikator lantai.
- Tangga berpindah lantai lewat interaksi dan transisi singkat. State disimpan per lantai. Membawa barang melewati tangga belum didukung; barang harus ditaruh terlebih dahulu.
- Save interior format lama tetap memakai generator lama; format baru menggunakan container `schemaVersion: 2` dengan snapshot per lantai. Tidak ada konversi diam-diam yang menggeser barang lama.
- Saat game dibuka pada route kota yang sama, bangunan dan lantai terakhir dipulihkan ke titik spawn yang aman. Ini belum menyimpan posisi berjalan atau pose duduk persis. Keluar rumah atau pindah mode menghapus titik resume.
- Kamera interior mereset near plane dan menghentikan tween town, sehingga masuk langsung dari diorama tidak menghasilkan layar hitam. Lepas landas dari interior menggunakan fade karena loop kamera town tidak berjalan di dalam rumah.
- Penghuni dekoratif tetap tersedia pada sebagian lantai dasar dengan tampilan deterministik dan kursi yang direservasi. Ini belum household, occupancy berbasis jadwal, atau simulasi warga WB-05.
- Modern menggunakan grid terdeformasi yang mengikuti arah akses regional; fantasy tetap memakai wards. Keduanya mendapat akses taman, loop jalan kaki, furniture taman yang direservasi sebelum pohon, serta halaman kecil pada rumah/toko.
- Jalur kaki masuk navigasi walker dan exclusion ground cover. Pohon/batu/collider deterministik lintas detail tier. Walker memakai deck height pada jembatan/dermaga. Randomisasi ukuran pohon tidak lagi tertimpa footprint model bawaan.
- Material atlas dimodulasikan pada warna authored bangunan, rumah, toko dan jembatan. Daun alpha-tested bergerak pelan; autumn tint terpisah dari batang; kanopi jauh menjaga tinggi dan siluet.
- Pergantian planet → kota di planet berbeda memakai fade, menghindari pembacaan city index pada map planet sebelumnya.
- Uji antarkota menemukan leak wrapper geometry kendaraan dan bone texture NPC/avatar/resident; keduanya sekarang dibuang sesuai kepemilikan. Enam penggantian scene memperlihatkan jumlah geometry/texture stabil setelah cache hangat. Atlas bangunan diperkecil lossless menjadi grayscale PNG dengan hasil piksel identik.

## Status per milestone

| Milestone | Status aktual | Pekerjaan tersisa utama |
|---|---|---|
| WB-00 | Sebagian | Baseline frame time/memory pada device dan kualitas tertentu; bukti lifecycle lengkap. |
| WB-01 | Sebagian besar fondasi | Quest per-world, migration registry lintas versi generator dan recovery UI yang lebih lengkap. |
| WB-02 | Graph jalan dan approach portal terpasang | Portal yang terhalang/terisolasi masih ditandai tidak aman; port anchor planet belum lengkap. |
| WB-03 | Sebagian besar fondasi | Room adjacency yang lebih kaya, cache blueprint, membawa item antar lantai; floor plan saat ini memakai zona dan partisi sederhana. |
| WB-04 | Morphology v2 dan ruang publik terpasang | Fantasy frontage/jaringan ward dan modern kolektor/cabang; solver kontur dan migrasi parcel save lama belum. |
| WB-05 | Belum | Household bernama, perjalanan ke kerja, occupancy dan simulasi jauh. |
| WB-06 | Belum | Region/POI yang benar-benar bisa dikunjungi. |
| WB-07 | Belum | Shipment, stok toko, port economy dan delivery quest idempotent. |
| WB-08 | Belum | Event, cuaca, budaya dan cerita berbasis state. |
| AA-00 | Sebagian | Baseline aset baru ada, budget seluruh aplikasi belum diprofilkan. |
| AA-01 | Sebagian | Jalur material v2 + pack pertama; kompresi KTX2/mesh dan migrasi pack lain belum. |
| AA-02 | Sebagian | Constraint lahan/OBB; kelas laut/danau/kolam serta occupancy tunggal belum penuh. |
| AA-03 | Sebagian | Conditional relief dan pads; contour roads/retaining walls belum. |
| AA-04 | Sebagian | Dua model dock dan clearance; kit bongkar-muat/akses jalan/marine simulation belum. |
| AA-05 | Pack vegetasi/material terpasang | Leaf cards, siluet/LOD, taman dan material bangunan/jalur sudah masuk game. Terrain masih field color + paint; seluruh TX inventory dan kompresi lanjut belum. |
| AA-06 | Sebagian | Efek air dasar; flow sungai, lake-specific waves dan wet sand belum. |
| AA-07 | Sebagian | Palette + ekspresi; body/hair/clothing mesh modular penuh belum. |
| AA-08 | Sebagian | Motif dan kontinuitas frase; ambient zones/arrangement penuh/listening QA belum. |
| AA-09 | Berjalan | Test/build tersedia; visual empat level, lifecycle dan profiling belum seluruhnya ditutup. |

## Verifikasi dan reproduksi

- `npm test`: 15 test unit/regression lolos, termasuk atlas material, hash pack, siluet LOD, tree/collider/path lintas kualitas, identitas, clock, persistence, startup resume dan interior. Fixture interior mencakup 10 jenis shell, skala lot 0,78–1,218 / 0,8–1,18, lantai dasar dan teratas; 228 denah memakai bounding box dari `furniture.glb` asli dan 190 memakai fallback ukuran.
- `GLOBE_SWEEP_SEEDS=100 node --test tests/town-generation.test.js`: versi akhir art pass lolos pada 27 September, sekitar 124 detik. Itu membuktikan properti yang diuji, bukan bahwa seluruh geometri di 100 dunia bebas cacat.
- `npm run build`: build produksi Vite.
- Jalankan server dev lalu buka `/tests/browser/`: integrasi rumah/IndexedDB/tangga, 20 siklus, modern town, planet dan space. Pengujian terbaru memakai namespace store `qa-interior-v2:*`.
- Run penuh versi akhir pada in-app browser lolos: state lampu, rekonstruksi IndexedDB, tangga, resume bangunan/lantai, 20 siklus rumah, modern town, langsung interior → planet → space. Fixture seed **993910**, planet **2**, kota fantasy **0**, 232 bangunan. `engine.lastError` kosong. Visual interior diperiksa ulang dan tidak hitam.
- Visual taman fantasy/modern, frontage, galeri aset dan pesisir sudah diperiksa langsung. Profil high pada viewport 767×703, pixel ratio 1: fantasy median/p95 **13,3/14,8 ms**; modern **13,3/14,5 ms**. Ini snapshot perangkat lokal, bukan target lintas perangkat.
- Angka draw calls pada harness interior hanya smoke check post-processing. Profil `/tests/browser/living-town.html` mematikan `info.autoReset` sementara untuk menjumlah seluruh pass; hasilnya 751 draw/frame fantasy dan 676 modern pada snapshot tersebut.

## Urutan berikutnya

1. Perkaya room graph dan lengkapi cache/transfer barang antar lantai; pertahankan kompatibilitas save lama.
2. Tambahkan household/occupancy di atas identitas bangunan/pintu yang sudah stabil.
3. Hubungkan graph navigasi yang sudah ada ke tujuan household dan jadwal warga; selesaikan approach yang terhalang.
4. Implementasikan POI dan port economy sebagai vertical slice sebelum memperluas konten.
5. Tutup inventory texture/material, art polish dan performance gate per pack.
