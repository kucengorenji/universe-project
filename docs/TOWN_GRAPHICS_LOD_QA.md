# Town graphics dan LOD — implementasi dan QA

Implementasi membawa environment, painted materials, dan lighting Skirmish ke Town. Identitas fantasy/modern, palet planet, footprint bangunan, pintu, collision, dan save tetap dipertahankan. Detail dekat ditingkatkan selektif. Efek CANVAS layar penuh tidak masuk scope.

## Perubahan

- Material Town memakai painted surface tiles Skirmish, variasi pigment, dan pencil shading yang menempel pada objek. Tile diolah menjadi 256 px per layer: seperempat jumlah texel versi 512 px. Detail memudar pada 65–150 m; dinding datar memakai satu projection sample. Roof palette, foliage, dan jendela malam tetap berfungsi.
- Lighting/sky Terran dan grading Town disesuaikan. Palet planet lain tetap digunakan; Town gurun diuji. Perubahan shader dipasang pada material Town.
- Model rumah fantasy mendapat ridge caps, dan rumah modern mendapat solar-cell dividers. Geometri tambahan hanya pada LOD0, memakai permukaan model asli, mempertahankan AABB/atribut asli, dan dibatasi 15% tambahan triangle. Sebelas varian GLB asli diperiksa.
- Grass dibagi per area 128 m dan forest billboards per area 512 m. Frustum/jarak mengurangi instance yang benar-benar dikirim. Density memakai urutan deterministik dengan fade; perubahan view tidak mengunggah ulang atribut statis.
- Fleet memakai geometry LOD0/1/2, compact instance batches, hysteresis, dan shadow batches terpisah. Kendaraan yang dikendarai tetap LOD0; simulation dan identitas kendaraan tetap berjalan.
- Auto quality mengurangi detail jauh → shadow → cosmetic vegetation → DPR. Jangkauan dekat diprioritaskan. Resolution pulih sebelum detail; dua window sehat diperlukan untuk recovery detail. Kualitas ditahan ketika cadence sudah ≥58 FPS, meskipun timer GPU menandai beban tinggi.

## Benchmark pada 7 Oktober 2026

Chrome/ANGLE Metal mengidentifikasi GPU Apple M1 Pro. Reference viewport 1280×800, DPR 2, drawing buffer 2560×1600. Seed 427; Town fantasy planet 2/city 0 mempunyai 470 bangunan dan 8.336 pohon. Baseline adalah snapshot WIP sebelum perubahan ini, bukan Git HEAD.

Baseline dan implementasi dijalankan bergantian; tab yang tidak diukur dipause dan tidak mempunyai frame hooks. Perbandingan High memakai posisi kamera, quaternion, FOV, waktu siang, seed, dan buffer yang sama. Masing-masing tiga pengukuran ×300 frame setelah warm-up. Profil tidak menambah extra GPU renders. Traffic/NPC tetap berjalan.

| High, kamera walk tetap | Sebelum | Sesudah |
|---|---:|---:|
| Rata-rata FPS tiga sampel | 60,05 | 59,98 |
| Frame p95, rentang sampel | 22,6–23,0 ms | 22,1–23,1 ms |
| CPU update+render p50 | 3,2–3,3 ms | 3,7–3,9 ms |
| Triangle semua render passes/frame | 2,36 juta | 2,47 juta |
| Draw calls/frame | 585 | 626–629 |
| Grass instances dikirim | 72.000 | 4.406 |
| Forest cards dikirim | 13.026 | 4.511 |

Grass work turun **93,9%** dan forest cards **65,4%** pada kamera ini. Total triangle High bertambah sekitar **4,5%** dan draw calls bertambah: detail dekat serta spatial batches membawa biaya tambahan. Jangan membaca penghematan vegetasi sebagai penghematan seluruh frame.

| Sampel implementasi setelah warm-up | FPS rata-rata | Buffer | Frame p95 |
|---|---:|---:|---:|
| Walk dengan input, 300 frame / sekitar 12,4 m | 59,94 | 2560×1600 | 22,2 ms |
| Drive dengan input, 300 frame / sekitar 12,5 m | 59,99 | 2560×1600 | 22,8 ms |
| Fantasy diorama, 300 frame | 59,89 | 2560×1600 | 24,2 ms |
| Modern diorama malam, 300 frame | 60,02 | 2560×1600 | 23,0 ms |

Pengukuran awal saat beban tinggi mencapai sekitar 27–47 FPS pada High. Auto menangani kasus tersebut; tiga sampel ×600 frame pada kamera walk berat menghasilkan 59,99–60,01 FPS dengan buffer 1280×800, budget level 4, dan sekitar 1,14 juta triangle/frame. Ini menggunakan budget/DPR berbeda dari High. Pengukuran view selama penyesuaian kualitas juga disimpan, termasuk FPS yang belum kembali ke target.

Hasil membuktikan rata-rata sekitar 60 FPS pada sampel tersebut, termasuk pergerakan pendek. P95 masih melampaui 16,67 ms; ini bukan jaminan setiap frame 60 FPS, semua seed, atau traversal panjang. Driver/shader warm-up dan beban mesin memengaruhi hasil; full resolution dapat turun saat Auto membutuhkan headroom.

## Verifikasi

- `npm test`: **137/137 lulus**.
- `npm run build`: **lulus**.
- `git diff --check`: **lulus**.
- Runtime: walk/drive dengan input, driven LOD0, masuk rumah tiga lantai, pindah lantai 0→1, keluar interior, Home walk, Apply ke Town, dan membuka lagi rumah yang diterapkan; tidak ada engine error.
- Low→High→Auto memulihkan shadow flags dan map size. Feedback terkontrol membuktikan urutan budget, DPR terakhir, dan recovery; ini pengujian mekanisme, bukan benchmark FPS.
- Rotasi kamera ke atas mengubah grass 4.406→1.382 dan forest 4.511→0; kembali ke kamera awal memulihkan jumlah persis. Version atribut statis tidak berubah.
- Sepuluh perpindahan fantasy/modern: texture counts per kota tetap. Counter geometry naik +2 tiap kembali, dan pola +2 juga terlihat pada baseline. 386 dispose events dari 536 geometry scene teramati; sisa cache belum seluruhnya diklasifikasikan. Plateau memory sesi panjang belum dibuktikan.
- Tidak ada console error saat pemeriksaan akhir. Warning multiple Three.js imports pernah muncul dalam sesi QA dan baseline awal; perubahan ini tidak menyelesaikan warning tersebut.

## Artefak

- Walk, kamera sama: [sebelum](../artifacts/town-graphics/before-walk.png) · [sesudah](../artifacts/town-graphics/after-walk.png).
- [Fantasy diorama](../artifacts/town-graphics/after-diorama.png), [modern malam](../artifacts/town-graphics/after-modern-night.png), [modern diorama malam](../artifacts/town-graphics/after-modern-night-diorama.png).
- Data High: [baseline](../artifacts/town-graphics/benchmark-before.json) · [implementasi](../artifacts/town-graphics/benchmark-final-high.json).
- Data: [motion](../artifacts/town-graphics/benchmark-final-motion.json), [diorama](../artifacts/town-graphics/benchmark-final-diorama.json), [modern malam](../artifacts/town-graphics/benchmark-final-modern-night.json), [Auto walk berat](../artifacts/town-graphics/benchmark-final-auto-walk.json), [view saat adaptasi](../artifacts/town-graphics/benchmark-final-views.json), [runtime checks](../artifacts/town-graphics/runtime-checks.json).
- Fixture/profiler: [town_graphics_browser.js](../tools/qa/town_graphics_browser.js); `townFixture()` dan `townProfile()` dipanggil melalui browser QA. `gpuProfile()` adalah diagnostic terpisah dengan extra warm renders; hasilnya tidak dipakai untuk tabel High di atas.
