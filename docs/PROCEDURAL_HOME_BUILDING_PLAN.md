# Procedural Home Building — Spesifikasi

Tanggal: 2026-10-04. Rancangan disetujui melalui instruksi **eksekusi**. Implementasi, aset, dan hasil verifikasi dicatat dalam [PROCEDURAL_HOME_BUILDING_QA.md](./PROCEDURAL_HOME_BUILDING_QA.md).

## Tujuan

Tambahkan mode pembangunan rumah yang dibuka dari kavling atau bangunan di kota Globe. Pemain mulai dari peta 2D, memperoleh rumah beserta pekarangan dari seed, dapat mengubah denah, lalu menghasilkan rumah 3D yang bisa diedit dan dijelajahi. Acuan interaksi adalah kebebasan membangun seperti Tiny Glade; arah visualnya stylized cozy.

Mode memakai model dengan detail geometri tinggi, material dan tekstur yang dibuat untuk rumah ini, serta optimasi runtime. Targetnya 60 FPS pada desktop/laptop; hasil pengukuran berlaku pada konfigurasi yang tercantum dalam laporan QA.

## Keputusan yang sudah dipilih

| Pertanyaan | Keputusan |
| --- | --- |
| Q1 — Fungsi peta 2D | Semua: preview seed lengkap, menggambar area rumah/pekarangan, dan menyusun ruangan. |
| Q2 — Edit setelah Generate | Barang/dekorasi, denah 2D, dan struktur langsung di 3D; termasuk tinggi dan bentuk atap. Penataan manual dipertahankan; barang yang terdampak perubahan struktur ditandai. |
| Q3 — Preset gaya | Beberapa preset; masing-masing mengatur bentuk, material, furnitur, dan tanaman. |
| Q4 — Preset pertama | Rumah klasik: bata, atap miring, jendela berbingkai, halaman berpagar. |
| Q5 — Kamera | Diorama/orbit dengan cutaway atap/dinding, dan berjalan orang pertama. |
| Q6 — Perangkat | Desktop/laptop, target 60 FPS. |
| Q7 — Akses | Dari kavling atau bangunan di kota Globe. |
| Q8 — Tingkat bangunan | 1–3 lantai serta loteng, dengan tangga dan penataan barang per lantai. |
| Q9 — Bentuk denah | Siku-siku, garis lurus dengan sudut bebas, dan lengkung; termasuk ruang bundar/menara. |
| Q10 — Perluasan kavling | Boleh mengambil lahan kosong, tidak mengambil jalan atau kavling tetangga. |
| Q11 — Atap | Otomatis sebagai bentuk awal; dapat dibentuk langsung di 3D melalui bubungan, tepi, dan bagian atap. |
| Q12 — Penempatan barang | Snap otomatis ke permukaan yang sesuai: lantai, dinding, meja, atau rak. |
| Q13 — Posisi tidak valid | Ditolak, ditandai merah, dan barang tetap pada posisi valid terakhir. |
| Q14 — Menerapkan ke kota | Draf otomatis disimpan; tombol Terapkan memperbarui rumah di kota. |
| Q15 — Mengganti seed | Seed baru memulai ulang; Variasi mengacak bagian otomatis dan menjaga edit manual. Undo/Redo tersedia untuk kedua aksi. |
| Q16 — Bahasa visual | Stylized cozy: bentuk lembut, warna hangat, detail yang disederhanakan. |

## Alur pemain

1. Pilih kavling/bangunan di kota, lalu buka **Bangun Rumah**. Draf sebelumnya dapat dilanjutkan.
2. Lihat peta 2D dengan batas kavling, jalan, rumah tetangga, rumah, ruangan, dan zona pekarangan. Seed membuat denah lengkap. Pemain bisa menggambar area, mengatur pembagian ruangan, dan memilih lantai/loteng.
3. **Generate** membuat bangunan, atap, tangga, bukaan, furnitur, dan pekarangan dari denah yang sedang ditampilkan.
4. Dalam diorama, pilih dan geser/putar/tambah/hapus barang. Barang mengikuti snap ke permukaan yang sesuai. Lantai terpilih dan cutaway menjaga interior terlihat.
5. Tarik struktur di 3D, termasuk dinding, tinggi lantai/bangunan, dan bentuk atap. Denah 2D dan model 3D berasal dari blueprint yang sama, sehingga berpindah tampilan mempertahankan hasil edit.
6. Beralih ke orang pertama untuk menjelajahi rumah dan pekarangan, termasuk lantai atas serta loteng melalui tangga.
7. Draf disimpan otomatis. **Terapkan** memvalidasi hasil lalu memperbarui rumah, pekarangan, pintu, collider, dan akses di kota. Bentuk rumah yang terlihat di kota mengikuti hasil edit pada semua LOD.

## Pelengkap yang disetujui bersama rancangan

Bagian berikut melengkapi jawaban sesi wawancara dan termasuk dalam implementasi yang disetujui.

- Tiga preset: **Klasik**, **Cottage**, dan **Modern Tropis**. Klasik dikerjakan dan divalidasi dahulu; semuanya memakai bahasa visual stylized cozy.
- Seed awal menghasilkan rumah berperabot berdasarkan fungsi ruangan: ruang tamu, kamar tidur, dapur, kamar mandi, dan sirkulasi/tangga. Fungsi ruangan dapat diubah pada denah.
- Pekarangan awal memuat jalur ke pintu, pagar/gate, tanaman, serta area duduk sesuai gaya dan luas lahan. Pemain dapat menata kembali komponennya.
- Simpan draf dan hasil Terapkan di penyimpanan dunia yang sudah ada di browser. UI menyatakan keberhasilan/kegagalan penyimpanan; tidak mengklaim tersimpan ketika write gagal.
- Perubahan struktur yang membuat barang lama tidak valid menandai barang tersebut dan menahan Terapkan sampai barang diperbaiki atau perubahan di-Undo. Barang tidak dipindah atau dihapus diam-diam.
- Lahan kosong untuk perluasan juga mengecualikan air, trotoar, taman/plaza, dan fasilitas bersama. Batas ini menjaga akses serta tata kota.
- Seed baru hanya mengganti draf sampai pemain menekan Terapkan. Variasi mempertahankan elemen authored; perubahan elemen otomatis yang bergantung padanya tetap harus menghasilkan geometri dan akses yang valid.

## Fondasi teknis

### Mode dan blueprint

Usulan mode `home` di `src/modes/home/`, di-load terpisah melalui Director yang sudah ada. Route membawa planet, kota, dan ID rumah tetap. Editor 2D, generator 3D, validasi, riwayat edit, dan representasi rumah di kota membaca blueprint yang sama.

Blueprint memuat versi schema/generator, seed, style, polygon kavling, lantai, ruang, segmen dinding lurus/lengkung, bukaan, graph atap, tangga, item, serta elemen pekarangan. Setiap elemen mempunyai ID tetap dan status/provenance perubahan manual. Furnitur menyimpan transform dan anchor permukaan; snap serta collision memakai bounds/collider sederhana, tidak mesh render detail.

Atap otomatis dibentuk per volume bangunan dan disambungkan pada pertemuannya. Dinding lengkung ditessellate menurut kebutuhan detail; atap untuk volume bundar/lengkung diturunkan dari bentuk yang sama. Kontrol atap mengubah graph/parameter geometri, lalu memvalidasi sambungan dan bentuk. Bentuk yang self-intersect atau volume yang tidak valid diberi feedback sebelum diterapkan.

Generator deterministik memakai seed turunan per elemen. Edit lokal membangun ulang bagian yang terdampak dan dependensinya, dengan ID serta edit manual tetap dipertahankan. Pekerjaan geometri yang berat dipindah ke worker jika profiling menunjukkan main thread tersendat.

### Integrasi kota dan penyimpanan

Kode sekarang memberi `buildingId` berdasarkan asset, posisi, dan yaw. ID tersebut tidak boleh dihitung ulang menjadi identitas rumah ketika shell diedit. Tambahkan ID rumah/kavling immutable dan simpan locator bangunan dasar, seed/variant/version layout, serta polygon claim.

Tambahkan record home pada `WorldStateStore`, dengan draf dan revisi yang sudah diterapkan terpisah. Journal localStorage dan IndexedDB yang tersedia menjadi fondasi penyimpanan. Undo/Redo mencatat transaksi pengguna; menyimpan draf tidak menerapkan perubahan ke kota.

Kota belum mempunyai registry polygon pekarangan per rumah. Tambahkan registry claim berdasarkan footprint bangunan, area jalan/trotoar, kavling tetangga, fasilitas, dan outline kota. Perluasan harus lolos validasi batas dan tidak membuat pintu/akses rumah tetangga tertutup.

Migrasi/regenerasi kota harus mengenali home records. Pengaman yang ada baru mengenali `interior:*`; draf dan rumah authored tidak boleh kehilangan lokasi saat generator kota berubah. Planner kota harus mempertahankan claim rumah atau menampilkan konflik yang perlu diselesaikan sebelum menerapkan layout baru.

Rumah yang diedit diganti dari batch shell kota standar dengan representasi LOD yang diturunkan dari blueprint yang sama. Collider, pintu, approach, dan jaringan berjalan diperbarui bersama geometri; perubahan bukan sekadar penggantian mesh visual.

## Produksi aset dan tekstur

Bangunan utama tetap procedural agar sesuai dengan denah dan edit struktur. Kit detail berulang memakai instance/modul; furnitur khas memakai aset 3D authored.

- **Kit klasik:** bata/plaster, genteng, ridge/eave, kusen, pintu/jendela, chimney, railing, teras, tangga, pagar dan gate.
- **Furnitur inti:** sofa, kursi, meja, tempat tidur, lemari, rak, kabinet dapur, lampu, karpet, dan dekorasi. Tambahkan toilet, wastafel, bathtub/shower serta kebutuhan kamar mandi yang belum ada pada katalog yang diaudit.
- **Pekarangan:** tanaman, bunga, batu, planter, bangku, serta detail pagar/jalur. Aset lingkungan yang ada boleh dipakai setelah lulus pengecekan visual dan runtime untuk gaya rumah ini.
- **Bahasa visual:** bevel yang terlihat dari dekat, silhouette lembut, painted texture dengan variasi warna halus, kayu/bata/genteng yang mudah dibaca, dan pencahayaan hangat. Detail permukaan mengikuti stylized cozy.

Setiap aset baru menyediakan source `.blend` dan script/seed bila procedural, master texture lossless, UV/normal yang benar, GLB runtime, LOD0/1/2, pivot/skala, bounds/collider, surface sockets bila diperlukan, dan manifest. Sumber high poly dipertahankan. Detail silhouette penting tetap berupa geometri pada LOD0; detail kecil dapat dibake untuk LOD lebih jauh.

Furnitur lama dapat menjadi fondasi fungsi tetapi tidak memenuhi seluruh target akhir: GLB yang diaudit mempunyai LOD0 tanpa UV/tekstur. Loader dasar juga membuang atribut tersebut. Pack rumah memakai jalur textured yang menjaga UV/index/normal/albedo. Jika normal/AO map dipakai, dukung secara eksplisit pada material rumah karena konversi toon saat ini belum menjaga map tambahan itu.

Source dan intermediate berada di `tools/blender/`; hanya runtime yang masuk `public/` dan terdaftar di asset manifest. Pack detail rumah di-load ketika diperlukan. Produksi staging tidak boleh menimpa pack/version yang ada; script Blender harus menerima root output staging secara eksplisit.

## Performa dan verifikasi

Perangkat awal yang ditemukan: MacBook Pro, Apple M1 Pro 8-core, RAM 16 GB. Gunakan ini sebagai benchmark awal. Laporan mencatat browser, viewport, resolusi render, DPR, kualitas, seed, jumlah item, dan fitur pencahayaan. Target desktop/laptop 60 FPS tidak berarti sudah terverifikasi untuk semua GPU.

Optimasi mencakup LOD, instancing detail berulang, material/atlas bersama, indexed geometry, culling ruang/lantai dan frustum, bayangan terkontrol, disposal resource, serta kualitas/resolusi adaptif yang sudah tersedia. Tetapkan budget segitiga, draw call, tekstur, dan GPU setelah benchmark rumah representatif; jangan menyebut aset ringan berdasarkan poly count saja.

Fixture minimum: rumah klasik sederhana, rumah angled 3 lantai + loteng, rumah dengan bagian lengkung/menara, dan pekarangan padat. Ukur diorama, interior, berjalan antar lantai, drag barang/struktur/atap, Generate/Variasi, serta transisi kota ↔ editor. Laporkan median/p95 frame time, FPS, GPU timing jika tersedia, draw call, dan resource/memory. Periksa `engine.lastError` selain console.

Verifikasi kode memakai `npm test` dan `npm run build`. Tambahkan tes yang bermakna untuk determinisme, geometri lurus/angled/lengkung, atap dan bukaan, akses/tangga, snap/collision, batas claim, pelestarian edit manual, Undo/Redo, draf/Terapkan, penyimpanan reload, dan migrasi town/home. Browser QA harus menjalankan interaksi sebenarnya.

Verifikasi aset memakai inspection GLB, preview LOD0/1/2, wireframe/collider, dan round-trip import GLB ke Blender untuk membandingkan skala/pivot, mesh, UV, normal, material, serta gambar. Viewer lingkungan dan harness `tests/browser/living-town.html` yang tersedia menjadi fondasi; pemeriksa B1 perlu diperluas untuk home pack.

## Urutan pengerjaan menuju cakupan lengkap

1. Blueprint/ID/claim/persistence, pemilihan rumah dari kota, editor 2D, seed deterministik, dan validasi dasar.
2. Rumah procedural lengkap 1–3 lantai + loteng, denah lurus/angled/lengkung, atap otomatis, bukaan, tangga, perabot, dan pekarangan; preset klasik menjadi fixture pertama.
3. Edit langsung struktur dan atap di 3D, snap serta penolakan posisi tidak valid, diorama/cutaway dan first-person, Variasi yang menjaga edit manual, Undo/Redo, draf dan Terapkan.
4. Kit aset/tekstur detail, LOD serta integrasi hasil edit kembali ke kota; lengkapi preset tambahan yang disetujui.
5. Profiling dan optimasi, regresi dunia tersimpan, transisi mode dan disposal, round-trip aset, serta bukti browser/render yang mencakup seluruh keputusan di atas.

Tahap-tahap ini adalah urutan kerja untuk target lengkap, bukan penghapusan fitur denah lengkung, atap manual, interior, atau integrasi kota dari cakupan.

## Definisi selesai

Pemain dapat memilih lokasi di kota, membuat atau mengedit denah rumah/pekarangan, menghasilkan rumah lengkap, mengubah struktur dan atap, menata barang dengan snap yang valid, menjelajahi semua lantai, mencoba variasi tanpa kehilangan edit manual, memakai Undo/Redo, menutup/membuka kembali draf, dan menerapkan hasil ke kota dengan bentuk serta akses yang konsisten. Aset dan tekstur akhir tersedia beserta source, LOD, dan laporan QA. Target performa dibuktikan pada konfigurasi yang dilaporkan; bagian yang belum diuji dinyatakan apa adanya.
