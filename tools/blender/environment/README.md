# Environment authoring workspace

Folder produksi untuk painted diorama. Mulai dari [rencana](../../../docs/art-direction/environment-v1/README.md).

**Status terbaru:** [B1 sudah diproduksi](B1_DELIVERY.md): gambar setup, texture master, source Blender, model GLB dan render QA. Artefak masih kandidat staging; B2–B4 dan integrasi world tetap belum selesai.

```text
docs/art-direction/environment-v1/        brief dan rencana produksi
docs/references/environment-v1/           7 referensi asli + provenance/hash
tools/blender/environment/
  catalog/
    production-plan.json                 master backlog; status planned
    existing-inventory.json              snapshot pack yang sudah ada
  recipes/world-kits.json                 aturan world-building
  templates/
    generation-job.json                  input, seed, versi, output
    asset-metadata.json                  metadata per varian hasil produksi
    texture-metadata.json                layout, ruang warna, map, tile QA
    GENERATION_BRIEFS.md                  format prompt model/texture
  source/
    nature/ terrain/ architecture/
    infrastructure/ props/ biomes/       sumber Blender per keluarga
  textures/
    generated/                           hasil mentah tool, belum dipakai game
    masters/                             gambar lossless yang sudah diedit
    baked/                               map/atlas hasil bake
  exports/staging/                        kandidat GLB/texture untuk review
  qa/renders/                            turnaround, close/overview, repeat grids
  qa/reports/                            hasil ukur dan keputusan QA
public/models/                           hanya export yang lulus + terdaftar
public/textures/                         hanya texture runtime yang dimuat
```

## Nama dan lifecycle

Saat mulai satu master, buat source/<family>/<assetId>/; misalnya source/nature/env_tree_oak/. Isinya dapat berupa env_tree_oak_v001.blend, build.py, params.json, serta metadata per varian. Folder per master dibuat saat pekerjaan dimulai, bukan ratusan folder kosong sekarang.

Nama root varian tetap env_tree_oak_a. Anak LOD bernama env_tree_oak_a_LOD0/1/2 agar sesuai pola loader textured yang sekarang. Versi masuk filename/metadata, bukan identitas gameplay. Versioning bukan sinonim varian: _a/_b adalah bentuk berbeda; v001/v002 adalah revisi aset yang sama.

Contoh:
- textures/generated/stone_cobble/job-001/output.png
- textures/masters/stone_cobble/stone_cobble_v001_mod.png
- source/nature/env_tree_oak/env_tree_oak_v001.blend
- exports/staging/environment_nature_v001.glb
- qa/renders/env_tree_oak_a/v001/front.png
- qa/reports/env_tree_oak_a_v001.json

Status: planned → concept → blockout → authored → exported → qa_passed → integrated. rejected kembali ke tahap yang relevan. Suatu folder atau nama file yang direncanakan tidak menjadi bukti status authored.

Semua source lama di tools/blender tetap di lokasi semula. Inventory mencatatnya sebagai baseline. Refine pack existing lewat salinan source bernama baru, lalu catat provenance/replaces; jangan memindahkan file yang masih dipakai script lama.

## Pemisahan file

- Reference contact sheet tidak masuk texture masters atau public.
- Hasil ImageGen selalu masuk generated terlebih dahulu; hasil model yang dibuat dari gambar perlu cleanup dan QA sebelum staging.
- Bakes/exports harus dapat ditelusuri ke source, parameters, tool version, seed jika didukung, dan palette hash.
- .gitkeep hanya menjaga folder kosong. Hapus saat folder berisi artefak sebenarnya.
- Tidak ada runtime registration otomatis dari template. Promosi ke public harus disertai loader/manifest dan QA.
