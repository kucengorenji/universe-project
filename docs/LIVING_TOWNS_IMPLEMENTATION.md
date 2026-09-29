# Kota hidup — vegetasi, tata kota, dan material

27 September 2026. Implementasi fokus lanjutan dari [catatan Watabou](WATABOU_WORLD_BUILDING_NOTES.md), [roadmap dunia](WORLD_BUILDING_ROADMAP.md), dan [arah aset](ASSET_ART_AUDIO_PLAN.md).

> **Update 29 September:** morphology v2, perbaikan jalan/pohon/lampu/gerak dan hasil QA terbaru tersedia di [Town Refinement](TOWN_REFINEMENT_2026_09_29.md). Isi di bawah adalah checkpoint 27 September.

## Hasil yang terhubung ke game

| Area | Implementasi |
|---|---|
| Kota modern | Blok dengan deformasi halus dan ukuran efektif bervariasi; orientasi mengikuti akses regional. Jalan dipotong batas kota/daratan. Zoning CBD, komersial, perumahan, suburb dan industri tetap digunakan. Ini masih kota terencana, belum contour-road solver. |
| Kota fantasy | Ward, landmark dan jalan organik tetap menjadi struktur utama. Park ward memakai planner taman bersama dengan modern. |
| Taman | Reservasi area, akses ke jalan, loop jalan kaki, bangku/planter/pergola sebelum pohon, lalu pohon dan bunga. Kandidat yang tidak kering atau tidak punya akses aman dilewati. |
| Halaman | Kelompok pohon/semak/bunga kecil di belakang rumah dan toko; memeriksa jalan, jalur kaki, sungai dan okupansi lot. Dunia lava/barren tidak mendapat halaman hijau otomatis. |
| Hutan | Kelompok spesies menurut biome dan tepian sungai, celah hutan, variasi yaw/skala/siluet. Kanopi boleh beririsan; batang tidak mengambil footprint bangunan. |
| Ladang/batu | Ladang memiliki footprint diputar. Batu besar dan batu kecil diperiksa satu per satu terhadap air, sungai, jalan, ladang dan okupansi; rotasi tiga sumbu/skala/sink tetap dipakai. |
| Navigasi | Jalur taman/frontage masuk daftar polyline pejalan kaki dan exclusion rumput. Kendaraan tetap memakai jalan lebar. Walker menggunakan tinggi permukaan deck pada jembatan/dermaga; line pendek disaring sebelum memilih walker. Ini belum graph perjalanan rumah–kerja. |
| Material bangunan | Bata, plaster, batu, kayu, genteng, slate, metal dan concrete dari atlas modulasi bersama. Warna authored, cat kendaraan, kaca dan emisi malam dipertahankan. Jembatan mendapat koordinat material juga. |
| Pesisir | Dermaga fantasy/modern bertekstur, peti terpisah, permukaan deck. Caustics berupa garis lentur dan glint dikurangi supaya air tidak tampak seperti titik-titik putih yang berulang. |

Urutannya mengikuti prinsip yang diambil dari Watabou: bentuk wilayah dan jaringan akses lebih dahulu, pembagian fungsi/lahan berikutnya, lalu dressing yang tunduk pada struktur itu. Ini adaptasi untuk runtime 3D game; bukan klaim menggunakan source code Watabou.

## Inventaris aset yang dikirim

`public/models/scenery.glb`: **20 asset ID × 3 LOD**, **1.184.656 byte**. Dua material bersama, normal halus, UV dan indeks geometri tetap utuh.

| Keluarga | ID |
|---|---|
| 8 spesies pohon | `t_oak`, `t_birch`, `t_pine`, `t_spruce`, `t_cypress`, `t_palm`, `t_acacia`, `t_fruit` |
| 4 siluet tambahan | `t_oak_v1`, `t_birch_v1`, `t_pine_v1`, `t_fruit_v1` |
| Understory | `b_bush`, `b_flowers` |
| Taman | `m_bench`, `g_planter`, `g_pergola` |
| Pelabuhan | `f_dock`, `m_dock`, `g_crate` |

Daun memakai bent cards dengan alpha test 0,45, bukan transparansi berlapis yang memerlukan sorting. Variasi musim memengaruhi daun tanpa mewarnai batang. Gerakan angin kecil diterapkan pada material daun. LOD jauh mempertahankan tinggi/siluet kanopi; kualitas grafis tidak mengubah posisi batang, collider, rumah atau jalur.

`scenery.manifest.json` berisi hash pack, ukuran byte, family, bounds dalam meter, jumlah triangle/primitive dan material untuk setiap LOD. Ini laporan dari GLB yang dikirim, bukan estimasi dari source Blender. Collider gameplay tetap milik layout; bounds kanopi bukan collider batang.

## Tekstur dan budget

| Tekstur | Resolusi | Pemakaian |
|---|---|---|
| `scenery_atlas.png` | 256² | Kayu, batu, metal, massa daun; tertanam di GLB. |
| `flora_cards.png` | 512² RGBA | Semprotan daun dan bunga original; tertanam di GLB. |
| `town_surfaces.png` | 512² grayscale, 107.856 byte | 16 tile modulasi netral: plain, plaster, brick, timber, stone, roof, slate, metal, bark, cobble, paving, earth, grass, sand, cloth, concrete. |
| Ground paint | Canvas runtime | Permukaan jalan, tepi, junction, jalur taman, turf taman dan marking kota. |
| Ground cover | Atlas canvas runtime | Rumput, fern, reeds, bunga, pebbles dan variasi kecil. |

Semua raster baru dibuat dengan kode original. Gambar referensi pengguna hanya untuk arah visual. Tile earth/grass/sand tersedia dalam atlas; terrain saat ini tetap memakai field color + ground paint/detail, tidak diklaim sudah berganti ke seluruh tile itu.

Pack scenery + atlas bangunan yang dimuat runtime berjumlah **1.292.512 byte (sekitar 1,23 MiB)**, sebelum HTTP compression. PNG sumber scenery/foliage tidak dimuat lagi secara terpisah. Manifest tidak diperlukan oleh loop render. Ini bukan ukuran seluruh game. Belum menggunakan KTX2 atau meshopt; jangan menyebut payload sudah minimum absolut.

Mesh/material dibagi antarkota melalui cache. Instancing dan chunk LOD dipertahankan. Material wind clone dimiliki scene dan dibuang saat keluar kota; texture dan geometry cache dimiliki library.

Atlas bangunan disimpan sebagai grayscale PNG tanpa mengubah satu pun piksel RGB hasil decoding: 174.258 → 107.856 byte. Pemeriksaan byte piksel dan hash source foliage memastikan optimasi ini tidak mengubah art atau atlas yang tertanam di pack.

Stress test menemukan resource lama yang tertinggal: wrapper geometry kendaraan (termasuk buffer paint) dan bone texture skeleton NPC/avatar/resident. Disposal sekarang mengikuti pemilik resource dan tidak membuang outfit/face atlas bersama. Unit test memeriksa isolasi dua karakter; browser menguji penggantian scene sesungguhnya.

## Peta implementasi

- `townLayout.js`, `townPlan.js`: struktur kota, reservasi park, footprint dan data jalan.
- `townGreenery.js`: jalur taman, akses frontage, furniture taman dan pocket gardens, memakai seed terpisah.
- `vegetation.js`: habitat, forest gaps, rocky groups dan farm exclusion.
- `groundPaint.js`, `groundCover.js`: surface path/turf dan pengosongan rumput di jalur kaki.
- `townSurfaces.js`, `assetLibrary.js`: pemilihan tile dari material authored dan planar UV dalam ruang model.
- `texturedAssetLibrary.js`, `townBuilder.js`: GLB bertekstur, material, instancing, wind, jembatan/dermaga dan air.
- `TownMode.js`, `crowd.js`: loading dan pemakaian jalur publik oleh walker.
- `PlanetMode.js`: navigasi langsung ke kota pada planet lain memakai fade; tidak membaca city index dari planet yang sedang ditinggalkan.

## Reproduksi

```sh
# Gunakan Python yang mempunyai Pillow.
python3 tools/blender/paint_living_surfaces.py
blender --background --python tools/blender/build_scenery.py
node tools/blender/report_scenery.mjs
npm test
GLOBE_SWEEP_SEEDS=100 node --test tests/town-generation.test.js
npm run build
git diff --check
```

Blender 5.1.2 lokal dipakai lewat CLI karena MCP Blender tidak tersedia pada sesi ini. Source editable: `tools/blender/scenery_assets.blend`. Generator tidak mengubah `town_space_assets.blend`.

## Verifikasi

- 15 test lolos: termasuk atlas/GLB/hash/budget, LOD, gameplay lintas detail tier, footprint, interior dan persistence.
- Build produksi Vite dan `git diff --check` lolos.
- Sweep 100 seed mencakup kota modern/fantasy, bangunan, jalan, semua tree/rock instance dan collider identik antar detail tier, akses park, farm kering serta rock exclusion. Tidak berarti setiap kemungkinan seed bebas semua overlap visual.
- QA visual memakai `/tests/browser/living-town.html`: modern/fantasy, park, frontage, dermaga dan galeri LOD0. Harness punya matahari siang tetap untuk pembandingan; tidak menyimpan offset world clock.
- Profil awal fantasy: viewport 767×703, tier high, pixel ratio 1, 120 frame; median 13,3 ms, p95 14,8 ms; 751 draw calls rata-rata seluruh frame, 152 geometry dan 38 texture. Angka ini snapshot lokal saat sweep seed juga berjalan, bukan janji FPS semua perangkat. Counter `autoReset` dimatikan sementara agar post-processing tidak menyembunyikan jumlah draw calls.
- Profil modern pada kondisi sama: median 13,3 ms, p95 14,5 ms, 676 draw calls/frame. Profil ini dilakukan sebelum perbaikan disposal; waktu render adalah baseline lokal, bukan klaim angka frame yang dijamin.
- Enam penggantian scene setelah perbaikan disposal: fantasy 158 → 195 → 195 geometry; modern 210 → 210 → 210. Texture fantasy 43 → 43 → 43, modern 40 → 40 → 40. Kenaikan awal mengisi cache pack; sesudah warmup tidak bertambah. Tidak ada error render.
- Modern pada malam hari dan kualitas low diperiksa secara visual: emisi jendela tetap aktif, atlas termuat, layout tetap 118 bangunan / 7.031 tree+rock+understory instance / 3 park aktif / 120 path; tidak ada error render.
- Runtime fixture seed 993910, planet 2: 20 siklus rumah, lampu, IndexedDB reconstruction, lantai/tangga/resume, modern town dan langsung interior → planet → space lolos. Kamera interior juga diperiksa visual; tidak ada layar hitam.

## Batas kompatibilitas dan cakupan

Layout modern yang berubah bisa memindahkan lot, sehingga building ID berbasis koordinat ikut berubah. Record interior lama tidak dihapus, tetapi belum ada migrasi otomatis ke lot pengganti. Rumah dengan ID yang sama tetap memulihkan state. Jangan mereset database untuk menguji art; harness interior menggunakan namespace `qa-*`.

Pembaruan ini menutup fokus art/vegetasi/tata ruang publik yang terhubung ke game. Simulasi household, jadwal kerja, port economy, POI, cuaca, retaining wall lengkap, terrain-contour roads dan kit NPC modular penuh masih berada di roadmap besar. Tangga/interior diuji sebagai regresi, bukan diklaim menjadi bagian baru dari art pass ini.
