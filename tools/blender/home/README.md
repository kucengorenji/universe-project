# Cozy home kit

21 aset rumah klasik bergaya cozy: sofa, chair, table, bed, wardrobe, shelf, kitchen, sink, toilet, bath, lamp, rug, plant, picture, bench, planter, window, door, chimney, fence, dan vase. Seluruh geometri dan atlas dibuat di workspace ini; tidak ada model pihak ketiga atau layanan generator berbayar.

## File

- Runtime: `public/models/home_cozy.glb`, didaftarkan sebagai `ASSETS.homePack`.
- Source editable: `source/home_cozy.blend`; collection per tipe, ketiga LOD, material, image packed, dan scene studio.
- Master albedo lossless: `textures/home_painted_atlas.png`.
- Kontrak penempatan: `catalog.json`, dengan bounds/dimensions tiap LOD, surface socket, dan box collider.
- Inspeksi export: `qa/export.json`; import ulang: `qa/roundtrip.json`; game loader: `qa/browser.json`.
- Preview source: `qa/home_gallery.png`; preview GLB aktual: `qa/home_runtime_gallery.png`; thumbnail: `qa/thumbnails/`.
- Viewer toon game: `/tools/blender/home/qa/viewer.html`, lewat Vite. Screenshot tiap LOD, wireframe, collider, dan malam ada di `qa/runtime_*.png`.

## Kontrak runtime

Meter, +Y up, depan +Z, pivot berada pada lantai di pusat footprint nominal. Overhang detail tertentu tidak simetris terhadap origin; gunakan `collider.center` dan bounds aktual untuk overlap. Semua minY adalah nol. Nama root katalog adalah `sofa` dan seterusnya; mesh anak `sofa_LOD0`, `sofa_LOD1`, `sofa_LOD2`.

Full kit: **47.688 / 22.910 / 7.192 segitiga** pada LOD0/1/2. GLB **3.791.532 byte**. Semua mesh indexed, memiliki NORMAL dan TEXCOORD_0; tidak ada segitiga berluas nol. Satu atlas PNG 1024² embedded digunakan bersama seluruh LOD. Perkiraan alokasi RGBA8 beserta mipmaps 5,33 MiB, terpisah dari ukuran file. Detail dimensi dan exported vertices ada di report.

Atlas 4×4 berisi grain kertas, wood/plank, linen/weave, ceramic, brick/mortar, roof, foliage, stone, paper, dan trim. RGB adalah pengali albedo netral sRGB; warna berasal dari baseColorFactor palette. Tidak mengandung AO studio. Normal/AO/roughness map tidak digunakan karena target material toon mengutamakan bentuk/bevel dan albedo painted. Tiap slot memiliki padding 8 piksel; UV overlap antarbagian disengaja untuk atlas reuse.

Muat dengan `loadTexturedPack(ASSETS.homePack, { mergeShades: true })`. Gabungan shade menghasilkan satu primitive runtime per tipe/LOD; UV, normal, index, dan albedo dipertahankan. Geometry/material milik cache library dan tidak boleh di-dispose oleh instance editor. Material palette sebagian besar opaque; kaca digambarkan sebagai permukaan painted biru, tidak memakai alpha blend.

Surface sockets tersedia pada meja, kitchen, sink, lemari, shelf, dan bench. Metadata box collider adalah proxy penempatan dan navigasi kasar; tidak otomatis memasang physics body. Window, picture, dan door dikategorikan untuk penempatan dinding. Bentuk wall/roof struktural masih tugas generator rumah; chimney/window/door/fence di sini adalah props pendamping.

## Reproduksi

Dari root repo, Blender 5.1.2 dan Node tersedia pada mesin produksi:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --threads 4 --python tools/blender/home/build_home.py -- --render
node tools/blender/home/inspect_home.mjs
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --threads 4 --python tools/blender/home/roundtrip_home.py
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --threads 4 --python tools/blender/home/render_home.py -- --thumbs
node --test tests/home-assets.test.js tests/asset-manifest.test.js
npm run dev -- --host 127.0.0.1 --port 5192
node tools/blender/home/browser_qa.mjs
```

`HOME_QA_URL` mengganti URL Vite. `HOME_QA_PLAYWRIGHT` dapat menunjuk instalasi `playwright-core`; default script memakai runtime cache lokal mesin ini. Viewer langsung memakai dependency Three.js proyek tanpa CDN. Build script menimpa hanya file kit ini dan runtime `home_cozy.glb`.

## QA dan batas bukti

PASS: inspeksi posisi/normal/UV finite, triangle/index/bounds, 63 LOD, floor pivot, atlas embedded dan palette tint; import ulang Blender memastikan seluruh UV/normal/scale/material/image utuh. PASS: tests manifest dan contract asset. Bukti loader, semua LOD, wireframe, box proxy, siang/malam, dan frame profile dicatat oleh browser QA.

Browser QA pada Chrome 154, GPU Apple M1 Pro via ANGLE Metal, viewport 1600×1000 dan DPR 1: fixture seluruh 21 aset LOD0 memakai **22 main draw calls** termasuk lantai, 47.690 segitiga termasuk lantai, median frame **16,7 ms**, p95 **17,8 ms** selama 120 frame. Halaman visible, UV tetap ada, tiap tipe/LOD menghasilkan satu merged part, dan tidak ada console/page error. Screenshot LOD0/LOD2, sofa dekat, dan malam diperiksa visual. Frame profile mengikuti refresh 60 Hz dan hanya mengukur fixture galeri.

N/A: rig, animasi, skinning, lightmap UV, dan normal bake untuk kit static toon ini. NOT_RUN: validator Khronos tidak tersedia lokal; inspeksi struktural sendiri dan round-trip telah dijalankan. Collider, penempatan, persistence, Apply ke kota, geometri, dan profil rumah utuh telah diperiksa dalam [QA integrasi mode rumah](../../../docs/PROCEDURAL_HOME_BUILDING_QA.md). Profil galeri aset tidak menjadi bukti rumah lengkap mencapai 60 FPS; laporan integrasi mencantumkan hasil dan batas pengukuran build akhir.
