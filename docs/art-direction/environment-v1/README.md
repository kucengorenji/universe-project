# Environment asset plan — painted diorama

29 September 2026 · **B1 sudah dibuat: 2 concept sheets, 8 texture master, 25 varian 3D / 75 LOD mesh.** Masih kandidat staging; belum dipasang ke world generator. [Buka hasil produksi B1](../../../tools/blender/environment/B1_DELIVERY.md).

Kelanjutan dari [ART_DIRECTION](../../ART_DIRECTION.md), [registry aset](../../ASSETS.md), dan [budget produksi](../../ASSET_ART_AUDIO_PLAN.md). Paket ini menerjemahkan tujuh referensi baru menjadi brief produksi yang konsisten dengan proyek. NPC tetap menjadi pekerjaan terpisah.

## Keputusan arah

**Painted diorama yang hangat dan dapat dijelajahi:** mid-poly dekat kamera, massa besar dan warna tertata dari jauh. Pohon berkanopi berkelompok, batu berbidang lebar dengan bevel seperlunya, rumah modular dengan atap dominan satu keluarga, serta tekstur permukaan yang tidak menyaingi siluet.

- Bentuk mengikuti gambar pohon/batu; komposisi mengikuti desa dan forest kit.
- Keteraturan modular mengambil prinsip kit gambar 7. Motif, logo, dan desain spesifik pack tidak menjadi aset game.
- Paving/bata dipakai sebagai panduan pola. Gambar contact sheet tidak dianggap tileable atau material PBR.
- Aturan shading/palet yang sudah ada tetap utama. Ini bukan pergantian ke clay render mengilap atau PBR realistis.

## Buka dari sini

| Dokumen | Kegunaan |
|---|---|
| [STYLE_GUIDE.md](STYLE_GUIDE.md) | Cara membaca referensi, bentuk, material, palet, dan tema environment |
| [PRODUCTION_PLAN.md](PRODUCTION_PLAN.md) | Urutan batch, kit, skala, pipeline texture/model, QA dan integrasi |
| [Reference board](../../references/environment-v1/README.md) | Tujuh gambar asli yang sudah disalin dari cache |
| [Folder authoring](../../../tools/blender/environment/README.md) | Lokasi source, texture, export kandidat dan bukti QA |
| [Katalog produksi](../../../tools/blender/environment/catalog/production-plan.json) | 56 master desain, target 124 varian geometri, 20 material set |
| [Daftar aset yang mudah dibaca](../../../tools/blender/environment/catalog/README.md) | Seluruh master, ukuran target, varian dan kandidat reuse per batch |
| [Inventaris aktual](../../../tools/blender/environment/catalog/existing-inventory.json) | Nama root, ukuran dan hash 7 pack GLB saat audit |
| [Recipe world-building](../../../tools/blender/environment/recipes/world-kits.json) | Aturan pemilihan aset per tema dan kondisi placement |
| [Template job generasi](../../../tools/blender/environment/templates/generation-job.json) | Input, seed, versi, output dan pencatatan generasi |

Jumlah di katalog adalah cakupan backlog, **bukan janji membuat semuanya sekaligus**. Satu master dapat memiliki beberapa varian; 3 LOD dan recolor tidak dihitung sebagai aset unik. Material foliage_volume memakai warna vertex/token tanpa file texture.

## Langkah produksi pertama

**B0:** buat scene review, exporter palet dari sumber yang ada, dan kontrak material pada loader.  
**B1:** proof kit 12 master + 8 texture master + material kanopi tanpa texture.  
**B2:** rakit satu potongan desa–hutan–sungai–pantai yang dapat dilalui.  
**B3:** perluas props, ladang, landmark, paving dan urban kit.  
**B4:** varian biome dan proxy planet yang tetap punya identitas sama.

Batch pertama meliputi oak, pine, dua batu, grass, shrub, cliff, fence, dock, wall-door, roof dan satu facade modern. Facade modern disertakan untuk membuktikan gaya ini bekerja pada kedua budaya kota, bukan hanya desa fantasy.

## Temuan repo yang memengaruhi rencana

- Sudah ada 7 pack GLB. Scenery memiliki 20 aset dengan tiga LOD; mulai dengan audit/reuse oak, pine, shrubs, dock dan props yang sesuai.
- Loader lama di src/render/assetLibrary.js membuang UV dan atribut authored selain posisi sebelum membuat warna vertex dan normals baru.
- src/render/texturedAssetLibrary.js mempertahankan indexed geometry, UV, normal, map dan alpha cutout, lalu mengonversi material ke keluarga toon bersama.
- Konversi tersebut belum meneruskan normal/roughness/emissive map. Jangan memproduksi seluruh PBR stack sebelum ada jalur pemakaian yang diuji.
- src/render/townSurfaces.js sudah memakai atlas modulasi netral dengan NoColorSpace. Jangan memperlakukan data ini sebagai albedo berwarna.
- src/art/palette.js saat audit memuat roof palettes dan map colors; token environment 3D lengkap belum tersedia.
- Sumber lama berada di tools/blender; file runtime berada di public. Struktur baru meneruskan pemisahan itu.

Audit ini membaca source/file, bukan pengujian visual game baru. Working tree sedang dikerjakan task lain; inventaris dapat berubah. Dokumen runtime bersama dan aset NPC tidak diedit oleh paket ini.
