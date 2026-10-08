# Landing page: arah desain

Berlaku untuk `index.html`, `src/landing.css`, dan `src/landing.js`. Arahnya sama dengan UI game (`src/style.css`), supaya screenshot di halaman dan halamannya sendiri terbaca sebagai satu produk.

## Design Read

Landing dan manual untuk game 3D di browser, untuk pemain dan pengembang yang penasaran, dengan bahasa visual The1 (Refero style, `refero-design/style/The1`). Dial ENERGY 2 / RHYTHM 2 / MOTION 1.

## Reference lock

- **Sumber utama:** The1. Kanvas concrete `#d9d9d9`, teks `#1f1f1f`, Barlow Condensed sebagai pengganti KH Teka, tanpa bayangan, gradien, glass, dan glow.
- **Dipertahankan:** tipe berskala bangunan (line-height 0.8, tracking negatif), blok warna penuh tanpa radius, garis rambut sebagai pemisah, tombol pill gelap sebagai satu-satunya tombol, radius hanya pada pill.
- **Dipinjam dari game:** `--color-space #070c19` sebagai latar blok screenshot. Itu token game, bukan warna baru.
- **Ditolak:** tema gelap, gradien biru-ungu, grid latar, kartu bergaya glass, titik status berdenyut, badge di atas H1, bento, hitungan statistik besar.

## Decision ledger

| Keputusan | Sumber | Alasan satu baris |
|---|---|---|
| Kanvas terang, bukan gelap | The1 dan R-21 | Game dan screenshot-nya sudah concrete; halaman gelap membuat dua bahasa visual |
| H1 "Dari orbit sampai ruang tamu." | Brief dan isi game | Menyebut rentang skala game secara faktual, tanpa slogan |
| Lima blok warna sebagai indeks level | The1 (Property Identity Card) | Level adalah tempat, dan The1 memakai warna penuh untuk menandai tempat. Tiap blok adalah tautan |
| Orbit memakai `#070c19`, Planet hijau, Kota kuning, Interior pink, Rumah merah | The1 dan token game | Hijau dan merah juga warna faksi di game; di sini keduanya hanya menandai level, tidak pernah status |
| Screenshot ditanam di blok warna level, tepi tajam | The1 (imagery) | Foto dipotong keras di dalam blok warna, tanpa radius dan bayangan |
| Teks di blok hijau berwarna putih | R-25 | `#1f1f1f` di atas `#027b49` hanya 3,1:1; putih 5,3:1 |
| Titik 10px di daftar level | The1 (status dot untuk wayfinding) | Menyamakan entri daftar dengan warna blok levelnya, bukan menandai status |
| Fitur dan manual berupa baris dengan garis rambut, tanpa kartu | Refero anti-slop #2 | Tidak ada kontainer yang perlu diklik, jadi tidak perlu kartu |
| Interior memakai tata letak dua kolom | Dial RHYTHM 2 | Levelnya paling pendek; satu pelanggaran ritme yang disengaja |
| Body 18px dengan line-height 1.25 | Pengecualian dari The1 (maks 1.2) | Paragraf panjang di Barlow Condensed terlalu rapat pada 1.2 |
| Tidak ada animasi scroll, tilt, atau loop | Dial MOTION 1, R-19 | Hanya hover, fokus, dan pergantian tab (fade 150 ms) |
| Tidak ada FAQ, testimoni, logo pelanggan, harga | R-18, R-28, R-38 | Tidak ada datanya |
| Angka (7 tipe planet, 11 kendaraan, 1 sampai 3 lantai) hanya muncul di teks | R-17 | Semuanya dari source, tidak dipajang sebagai kartu statistik |

## Aset

Screenshot diambil dari game yang berjalan lewat `tools/qa/landing_shots.mjs` (dunia seed 42). Tidak ada ilustrasi, ikon, atau logo baru. Wordmark adalah teks.
