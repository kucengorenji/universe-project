# Rencana produksi environment

## 1. Batch dan acceptance

| Batch | Cakupan | Syarat lanjut |
|---|---|---|
| B0 kontrak | Scene review, snapshot palet, metadata, model meter, material adapter, fixture | Satu cube ukuran, satu panel UV, warna netral dan cutout tampil benar di Blender dan game |
| B1 proof kit | 12 master, 8 raster texture master, 1 material kanopi berbasis palette | Siluet, skala, 3 LOD, UV/repeat, shared toon dan satu facade modern lolos |
| B2 vertical slice | Modul pelengkap rumah, bridge/bank/shore, deadwood, props minimum dan water maps | Desa–hutan–sungai–pantai tersambung; akses dan collision valid; siang/malam konsisten |
| B3 perluasan | Species, understory, crop stages, barn/windmill, urban paving, harbor, props naratif | Varian menambah fungsi/siluet; payload dan frame time terukur |
| B4 biome/planet | Palm, desert rocks, snow overlays, proxy landmark planet | Identitas tetap sama antar mode, seam/projection lolos; pack dimuat sesuai kebutuhan |

Urutan adalah dependency, bukan estimasi durasi. source/catalog tetap planned sampai artefak dan bukti tersedia. Kompresi, wind shader dan material maps tambahan bukan fitur yang diasumsikan sudah jalan.

### B1: proof kit yang konkret

| Master | Alasan masuk lebih dahulu |
|---|---|
| env_tree_oak | Kanopi berkelompok, trunk, ukuran manusia, audit reuse t_oak |
| env_tree_pine | Siluet species berbeda; audit reuse t_pine |
| env_rock_boulder / env_rock_slab | Dua bentuk batu, bevel, moss terpisah |
| env_grass_tuft / env_shrub_round | Ground tint dan kepadatan kecil |
| env_cliff_straight | Sambungan terrain dan normal |
| env_fence_straight / env_dock_straight | Snap grid, kayu, collision dan walk surface |
| env_wall_door / env_roof_gable | Prototype arsitektur fantasy dan entrance scale |
| env_modern_facade | Validasi gaya di bangunan modern dan UV/material |

B1 belum merupakan kit rumah tertutup lengkap. B2 menambah solid/window/corner walls, foundation, floor, ridge, door dan shutter sebelum merakit cottage pertama. Tidak boleh menyatakan world-building slice lengkap hanya karena 12 item proof selesai.

Delapan texture master B1: ground_grass, ground_dirt, stone_cobble, stone_rock, wood_trim, wood_bark, architecture_trim, modern_trim. foliage_volume memakai vertex/token color dulu. Jangan membuat alpha daun kompleks sebelum kanopi opaque terlihat bagus.

## 2. Reuse sebelum produksi ulang

| Existing | Tindakan |
|---|---|
| scenery.glb: t_oak, t_pine, t_birch, t_fruit, b_bush | Audit silhouette, normals, tint, LOD; refine yang cocok |
| scenery.glb: f_dock, m_dock, m_bench, g_crate | Gunakan sebagai pembanding skala/UV; jangan rename tanpa adapter |
| town.glb | Shell lama tetap runtime selama kit baru belum lengkap |
| assets.glb / assets_lod0.glb | Identitas planet; town-scale barn/boat/crop dibuat dengan kontrak meter sendiri |
| town_surfaces.png | Jalur modulasi netral existing; perlu evaluasi atlas/texel density |
| scenery_atlas.png / flora_cards.png pada source | Audit kualitas/padding sebelum memutuskan menambah atlas |
| character.glb / source NPC | Di luar scope environment; gunakan karakter hanya sebagai penggaris skala |
| furniture.glb / space.glb | Inventaris saja; tidak diproduksi ulang pada batch ini |

Katalog memiliki existingCandidate untuk kandidat yang teridentifikasi. Field null berarti belum dipetakan, bukan bukti tidak ada aset yang dapat digunakan kembali.

## 3. Skala, pivot dan sambungan

Kontrak authoring: meter, Blender Z-up/front -Y. Target game Y-up/front +Z; ekspor dan ukur marker front, bukan mengandalkan asumsi sumbu.

- Referensi orang 1,75–1,8 m. Door clear opening target 1,0 × 2,1 m; floor-to-floor 3 m.
- Grid arsitektur utama 2 m, subgrid 0,25 m. Dinding panjang 2 m, tinggi 3 m, tebal nominal 0,2 m; pivot lower-left-front, socket ujung dicatat dalam koordinat game.
- Kit luar harus sesuai blueprint interior/footprint; pintu tidak sekadar dekorasi. Bevel tidak boleh mengurangi clear opening.
- Naturals pivot ground center. Simpan render bounds, ground footprint, canopy envelope, collider dan clearance terpisah.
- Roof gable prototype untuk footprint 4 × 4 m; overhang detail dicatat di render bounds dan tidak mengubah wall footprint.
- Cliff straight panjang 4 m/tinggi 2 m. Corner/cap B2 melengkapinya; jangan memakai scaling bebas pada sambungan yang harus snap.
- Fence panjang 2 m; bridge/dock modul 2 × 2 m. Metadata menentukan deck elevation, rail offset dan ramp rise. Setiap span yang bisa diinjak punya collider/walk surface.
- Boat pivot pada garis air yang dicatat. Jangan menyamakan origin boat dengan ground-center setelah authoring.
- Collision/portal dimiliki data gameplay dan tidak berubah antar LOD. Sockets bernama entrance, exit, attach_left, attach_right, deck_start, deck_end sesuai kelas.
- River/shore mesh adalah profil lokal yang mengikuti terrain/water spline; bukan tile kotak yang menentukan topology globe.

Ukuran dalam katalog adalah target blockout. Bounding box aktual harus diukur setelah export, termasuk rotation/scale apply.

## 4. Tekstur dari referensi

### Alur

1. Pilih reference ID dan motif spesifik. Simpan prompt/model/tool/job ID serta input yang benar-benar dipakai.
2. Generate **satu permukaan per gambar** atau atlas dengan layout eksplisit; tidak meminta seluruh contact sheet sebagai texture siap pakai.
3. Hasil mentah → textures/generated/<set>/<job>/. Hasil mentah bukan master final.
4. Rapikan perspektif, color/value range, seam dan detail. Buat tile/trim asli berdasarkan motif; hilangkan lighting directional.
5. Simpan master lossless dan metadata di textures/masters/<set>/. Preview berwarna dipisah dari data modulasi.
6. Generate/bake map yang benar-benar dipakai: modulation, alpha/mask; normal hanya untuk shader yang memakainya. Height tidak otomatis menjadi normal yang benar.
7. Uji offset wrap, grid repeat 4×4, skala meter, mip jauh dan oblique camera. Simpan gambar QA.
8. Bake/pack atlas ke textures/baked; periksa padding/dilation. Ekspor kandidat ke staging, baru promosi setelah runtime QA.

### Kontrak per tipe

| Tipe | Ketentuan |
|---|---|
| Tile grass/dirt/rock/paving | 512² awal untuk span 2 m, sekitar 256 px/m; ukur ulang pada kamera jalan kaki |
| Trim kayu/bark/building | 1024² awal untuk referensi span 4 m; UV band dan axis repeat ditulis per band |
| Cutout foliage/crop | Maks 1024² awal; alpha test, edge dilation, coverage mip; hanya jika opaque mesh tidak cukup |
| Circular plaza | Decal/UV lokal atau mesh plaza khusus, bukan tile seamless jalan umum |
| Foam mask | Scalar data, arah/animasi shader; hindari busa garis seragam |
| Water normal | Data non-color, konvensi tangent dan repeat dikonfirmasi shader |
| Preview albedo berwarna | sRGB, berlabel preview; tidak boleh tertukar dengan modulation |

Bata target panjang sekitar 0,2–0,3 m; cobble sekitar 0,15–0,3 m sebagai starting scale, lalu periksa terhadap sepatu NPC. Motif herringbone harus bertemu pada repeat; stone irregular tetap punya ritme ukuran. Pattern harus terbaca tanpa outline hitam dominan.

Untuk sheet 1024 awal gunakan gutter/dilation 16 px sebagai titik awal, **bukan jaminan seluruh mip aman**. Uji sampai mip yang terlihat; tambah padding/ubah layout/clamp penggunaan mip bila bleeding muncul. Trim repeat bands butuh penanganan tepi sendiri.

### Material game

Target utama: base color dari palette × modulation netral, ditambah toon lighting runtime. AO hanya kontak ringan, tidak menanam matahari tetap. Opaque canopy cukup vertex color dulu.

Loader v2 saat audit mempertahankan map dan alphaTest, tetapi belum otomatis melaksanakan mapping material token, data modulation, semua map PBR, channel packing atau wind. B0 harus memperjelas adapter:
- colored albedo map → sRGB;
- scalar modulation/mask → NoColorSpace dan jalur shader yang sesuai;
- air → shader water dengan bindings eksplisit;
- emissive/glass/cutout → render-state terpisah yang benar.

Normal/roughness yang tidak dikonsumsi tidak masuk payload. Shader dan generator tidak boleh mempunyai dua palet authoritative.

## 5. Pipeline 3D dari gambar

1. Periksa Blender MCP/scene aktif ketika produksi dimulai. Dalam sesi perencanaan ini tidak ada Blender MCP callable.
2. Buka scene baru khusus environment atau collection khusus; simpan sumber versi baru. Jangan menghapus scene kerja task lain.
3. Import reference planes dengan ukuran acuan. Bentuk volume harus dibuat/ditinjau di 3D; satu gambar tidak menentukan sisi belakang.
4. Blockout silhouette, skala, pivot, sockets, collider dan placement envelope terlebih dahulu.
5. Author mesh, bevel, normals, UV dan material. Model yang dibuat lewat image-to-3D tetap memerlukan cleanup/remesh, UV dan pemeriksaan sisi tak terlihat.
6. Buat varian struktural yang berbagi material. Rotation/recolor bukan varian geometri.
7. LOD0/1/2 mempertahankan bounds penting, root socket dan silhouette. Kurangi kelompok/detail secara terarah; jangan hanya decimate otomatis.
8. Bake data yang dibutuhkan dan export GLB kandidat; parent roots mengikuti pola <variant>_LOD0/1/2.
9. Validasi ulang GLB yang diekspor, lalu review di game. Render Blender saja tidak membuktikan shader/runtime setara.

Untuk wind: rencanakan root weight 0, branch weight dan leaf weight, deterministic phase per instance, serta amplitude kecil. Simpan atribut/mask hanya setelah jalur export + loader + instancing dipastikan mempertahankannya. Batang utama dan root tidak boleh bergeser. Ini fitur B3 opsional, bukan syarat B1.

## 6. Aturan world-building

Recipes di world-kits.json adalah input rencana, belum consumer runtime.

- Gunakan seed terpisah untuk layout gameplay dan decorative scatter. Mengubah detail foliage tidak boleh memindahkan rumah/pintu/jalan.
- Species dipilih dari biome/moisture/slope/light, kemudian ukuran/varian. Semua pohon tidak diberi peluang sama.
- Terapkan cluster–gap: satu rumpun rapat, understory di sebagian tepi, ruang kosong/jalur pandang di antaranya.
- Batu besar dapat menjadi anchor rumpun; moss mengikuti upward surface/moisture, bukan berputar asal bersama seluruh batu.
- Tempatkan reeds di wet band; crops pada field mask; fence sepanjang boundary; dock menghadap water anchor.
- Collider dan walkway clearance memakai bounds aktual. Reservasi entrance/road/bridge sebelum scatter.
- Roof family mengikuti distrik existing; aksen landmark dibatasi. Prop story seperti cart/crate hadir dekat fungsi yang relevan.
- Percobaan penempatan dibatasi (starting cap 16/instance); jika gagal, kurangi dekorasi dan catat skip. Jangan memaksa overlap untuk memenuhi jumlah.
- LOD dan quality mengubah detail visual, bukan seed identitas atau konektivitas gameplay.

## 7. Budget dan QA

Budget katalog mengikuti ceiling awal dokumen proyek: pohon 6k/2k/400 triangle; batu 1,5k/500/100; rumah lengkap 12k/4k/800; panel dinding 800/300/80. Landmark khusus perlu budget terukur sendiri.

Target awal tambahan payload mempertahankan plan existing: common material ≤1 MiB; environment town ≤2 MiB; architecture/harbor ≤2 MiB. Ini target tambahan kompresi paket, bukan ukuran source PNG/Blend. Jika gagal, kurangi scope/atlas atau dokumentasikan revisi, jangan mengklaim sudah memenuhi.

QA minimum:
- [ ] Ukuran, axis, pivot, transforms dan normals.
- [ ] Bounds render vs collision/footprint; portal/sockets align.
- [ ] Nama root/LOD dikenali loader; UV/material tetap ada setelah export.
- [ ] Day/noon, sunset, night dan grayscale review dengan fixture lighting identik.
- [ ] Close, walking, overview; tier high/low dan pergantian LOD.
- [ ] 4×4 texture repeat, oblique minification, alpha halos, atlas bleeding.
- [ ] Collision tidak menutup jalan/pintu; deck bridge/dock bisa dilalui.
- [ ] Count triangle/draw-call, download bytes, GPU texture estimate, p95 frame time dan perangkat uji dicatat.
- [ ] Identity/palette antar planet dan town sesuai.
- [ ] Screenshot dan laporan di qa; hasil gagal tetap dicatat.

Baseline scene review yang direncanakan: seed 290926, bidang 32 × 32 m, ruler 1 m, proxy manusia 1,8 m, arah matahari/jam terkunci, kamera close (3–5 m), walking eye height 1,65 m dan overview. Fixture ini belum dibuat. Scene slice B2 lebih besar sesuai kebutuhan; review tidak harus memakai kota produksi acak.

Tidak mengklaim FPS atau frame budget tercapai tanpa rekaman perangkat/viewport/tier. Target draw calls awal mengikuti plan existing (delta sekitar ≤25% baseline), namun keputusan akhir memakai p95 frame time dan memory aktual.

## 8. Promosi runtime

Staging bukan public. Sebelum promosi:
1. Semua source dan metadata terhubung, QA lulus pada GLB hasil export.
2. Tentukan family pack dan loader consumer, pertahankan UV/normal/index/material.
3. Integrasikan registry di src/render/assetManifest.js, consumer dan asset manifest check; jangan menyalin kandidat tak terpakai ke public.
4. Palette/token integration di sumber existing, bukan literal warna baru di setiap generator.
5. Uji manifest, build dan browser fixture yang relevan.
6. Simpan rollback pack lama sampai parity terbukti; jangan rename/move source lama sembarangan.

Folder baru ini tidak mengubah runtime, dependencies, layout generator atau pekerjaan NPC.

