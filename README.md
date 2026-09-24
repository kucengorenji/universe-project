# 🌍 Planet Globe 3D — Procedural Hexagon World

Proyek simulasi 3D planet globe dengan daratan berbasis grid heksagon prosedural (*Goldberg Polyhedron*), border wilayah ala Civilization, penyimpanan map di `localStorage`, menu navigasi di kiri atas, dan garis koneksi diplomatik antar-ibukota.

---

## ✨ Fitur Utama

- **Procedural Hexasphere Geometry**:
  - Dibuat dari dual subdivisi icosahedron (*Goldberg Polyhedron*) berukuran 642 tile (630 heksagon + 12 pentagon alami).
  - Setiap heksagon memiliki ketetanggaan (*adjacency*) yang akurat untuk pathfinding dan perbatasan wilayah.
- **Procedural 3D Terrain & Bioma**:
  - Menggunakan 3D Simplex noise fractal Brownian motion (fBm) di permukaan bola unit, menghasilkan peta kontur daratan yang mulus tanpa sambungan kutub.
  - 6 tipe tile dasar:
    1. **🌊 Lautan & Samudra Dalam (Ocean & Deep Ocean)**: Cekung dengan efek kilau air.
    2. **🌾 Padang Rumput Datar (Plains)**: Zona subur hijau untuk ekspansi faksi.
    3. **🌲 Hutan (Forest)**: Gugusan pohon pinus 3D *low-poly* menghadap normal permukaan bola.
    4. **⛰️ Pegunungan (Mountain)**: Bebatuan terjal dengan puncak salju putih (*snow caps*).
    5. **💧 Sungai (River)**: Aliran air berliku yang menuruni kontur daratan menuju laut.
    6. **👑 Kota / Ibukota (City / Capital)**: Benteng citadel, pilar hologram, dan cincin faksi.
- **Penyimpanan Permanen (Local Storage)**:
  - Peta disimpan otomatis di `localStorage` peramban. Pemain tidak perlu membuat ulang peta setiap kali me-refresh halaman.
  - Peta hanya akan diregenerasi jika pemain menekan tombol **"Regenerate New Map"** pada menu.
- **Border Wilayah ala Civilization**:
  - **Player Starter Area**: Wilayah starter pack pemain mengelilingi ibukota *New Babylon*, dibatasi oleh border garis neon *Cyan*.
  - **System (NPC) Area**: Wilayah sistem otonom di benua seberang mengelilingi ibukota *Aegis Citadel*, dibatasi oleh border garis neon *Magenta/Crimson*.
  - **Garis Koneksi Diplomatik**: Kurva busur 3D melayang di atas atmosfer menghubungkan kedua ibukota, lengkap dengan partikel pulsa cahaya perdagangan yang bergerak secara dinamis.
- **Komposisi Visual & Navigasi**:
  - Background biru luar angkasa yang nyaman (*deep cosmic blue*) dengan partikel bintang halus dan lingkaran atmosfer planet (*Fresnel halo*).
  - Jarak kamera dihitung otomatis agar diameter planet mengisi tepat **75% lebar layar secara horizontal** pada resolusi standar 16:9.
  - Rotasi bebas 360° menggunakan mouse/touch, opsi *Auto-Rotate*, dan *Tile Inspector* interaktif saat kursor diarahkan atau diklik pada tile.

---

## 🚀 Cara Menjalankan Proyek

Pastikan Node.js (v18+) sudah terpasang di komputer Anda.

```bash
# 1. Masuk ke folder proyek
cd /Users/mikelrisyad/Developer/globe

# 2. Jalankan mode pengembangan
npm run dev

# 3. Atau lakukan build produksi
npm run build
npm run preview
```

Buka URL yang ditampilkan di terminal (biasanya `http://localhost:5173`) di browser pilihan Anda.

---

## 📁 Struktur Folder

```
globe/
├── index.html                  # Halaman utama dengan markup HUD & sidebar menu
├── package.json                # Dependensi Three.js & Vite
├── TILES_ROADMAP.md            # Catatan rencana generasi aset tile 3D lanjutan
├── src/
│   ├── main.js                 # Entry point inisialisasi aplikasi
│   ├── style.css               # Styling UI glassmorphism, HUD, dan warna faksi
│   ├── math/
│   │   ├── hexasphere.js       # Generator topologi dual bola heksagon (Goldberg Polyhedron)
│   │   └── simplex3d.js        # Seedable 3D Simplex & fBm noise
│   ├── map/
│   │   └── mapGenerator.js     # Logika generasi bioma, sungai, faksi, & LocalStorage
│   ├── render/
│   │   └── planetRenderer.js   # Three.js scene, lighting, border Civ, koneksi 3D, & kamera 75%
│   └── ui/
│       └── menuController.js   # Kontrol menu toggle kiri atas, slider, & tile inspector
```

---

## 🎨 Update: Cartoon Terrain ala Civilization VI

- **Tile hexagon datar**: semua daratan rata di satu level, laut sedikit lebih rendah dengan tebing pantai dan buih pesisir.
- **Bioma**: laut dalam, laut, pesisir dangkal, pantai, padang rumput, hutan, padang pasir (dune + kaktus), gunung, dan tundra.
- **Pegunungan dinamis** (`src/render/mountainBuilder.js`): tile gunung yang bersebelahan dilebur jadi satu massif heightfield. Tinggi dihitung dari jarak ke tepi range + ridged noise, dengan tudung salju mengikuti inti massif.
- **Kota**: ibukota dan kota kecil 3D dengan banner nama, plus mercusuar di kota pelabuhan.
- **Jalur darat & laut**: jaringan jalan dibuat dengan A* (menghindari gunung dan laut) dan dilalui karavan. Jalur laut putus-putus beranimasi antar pelabuhan dan dilalui kapal. Keduanya punya toggle di menu.
- **Aset 3D Blender**: `tools/blender/build_assets.py` membuat GLB low-poly ke `public/models/` (kota, pohon pinus/bulat/palem, kaktus, batu, kapal, karavan, pelabuhan). Jalankan ulang lewat Blender MCP:
  `exec(open('tools/blender/build_assets.py').read(), globals())`

---

## Update 2: UI The1 + aset v2 + optimasi

- **UI** mengikuti arah desain The1: kanvas concrete `#d9d9d9`, Barlow Condensed (pengganti KH Teka), angka seed sebagai tipografi dinding di belakang globe, tombol pill iron, panel pengaturan flat dengan garis hairline, blok warna faksi (The Green = pemain, The Red = sistem). Tidak ada shadow, glow, atau glass.
- **Kamera default** menampilkan seluruh planet (sekitar 91% sisi layar terpendek).
- **Aset** (`tools/blender/build_assets.py` → `public/models/assets.glb`, 31 aset + 4 LOD, ±108 KB): pohon pinus/bulat/palem/akasia, semak, rumput, batu, mesa gurun, kaktus, balok es, 3 varian rumah, menara, kastil, kuil, tembok, pagar, lumbung, kincir angin, jerami, baris gandum/sayur, dermaga, perahu, kapal, karavan, jembatan, mercusuar.
- **Kombinasi multi-tile**: kota 1 sampai 7 tile (ibukota 7 tile bertembok, kota kecil berpagar), ladang 1 sampai 7 tile dengan baris tanaman yang sejajar antar tile, pagar di keliling ladang, lumbung dan kincir angin. Jembatan muncul otomatis di titik jalan menyeberangi sungai, dan pinus tumbuh di kaki pegunungan.
- **Optimasi**: satu request GLB tanpa normal/UV, props berupa InstancedMesh dibagi 12 chunk dengan horizon culling, LOD pohon saat zoom jauh, props detail (rumput, semak, jerami) hanya tampil saat dekat, ribbon sungai/jalan/rute laut di-merge, pointer diproses sekali per frame, dan penyimpanan localStorage dipadatkan per kolom (sekitar 2 MB menjadi sekitar 150 KB).


---

## Update 3: permukaan rata, terrain natural, dua peradaban, mode POV

- **Toggle "Daratan rata dengan laut"** (panel, bagian Tampilan): mode rata menaruh daratan dan laut di satu level tanpa tebing. Pilihan tersimpan di browser (`planet_globe_prefs`).
- **Terrain lebih natural**: setiap tepi hex dibengkokkan lewat titik tengah bernoise yang dipakai bersama oleh daratan, laut, tebing, buih, grid, gunung, dan border, jadi garis pantai dan batas bioma tidak lagi berbentuk hex sempurna. Warna tile dicampur dengan noise, hutan lebih rapat di tengah dan menipis di tepi, dan pohon "tumpah" ke padang rumput sekitarnya. Ada varian aset (pinus ramping, pohon poplar, semak berbunga, batu berlumut) plus variasi rona, skala, dan kemiringan per instance.
- **Sungai**: berkelok, punya tepian hijau, alang-alang, lembah yang lebih subur, dan berhenti di garis pantai. Pohon dan rumah tidak lagi tumbuh di atas sungai atau jalan.
- **Jembatan** diletakkan di titik jalan benar-benar memotong sungai, searah jalan: jembatan kayu kecil di hulu yang sempit, jembatan batu besar di hilir yang lebar, dan jembatan kabel untuk jalan kota modern.
- **Dua peradaban**: pemain (New Babylon) dan kota di dekatnya bergaya fantasi (kastil, kuil, rumah, tembok), sedangkan sistem (Aegis Citadel) dan kota di dekatnya bergaya modern (menara kaca, apartemen, rumah modern, menara landmark, crane pelabuhan, jalan aspal).
- **Kendaraan**: fantasi memakai karavan, kapal layar, dan balon udara; modern memakai truk kargo, kapal kontainer, dan pesawat. Rute udara dibuat per peradaban.
- **Mode POV**: klik kendaraan di globe atau tombol "Naik kendaraan". HUD di bawah untuk memilih Udara/Darat/Laut dan kendaraan sebelumnya/berikutnya. Keyboard: panah kiri/kanan untuk ganti kendaraan, Esc untuk keluar.

---

## Update 4: transisi di dalam tile, fokus sinematik

- **Hexagon tetap rapi**; yang menyambung antar tile adalah isinya. Warna tanah dihitung per titik berdasarkan jarak ke tiap sisi dan jenis tetangganya: pita pasir di sisi yang menghadap laut (bergelombang), air dangkal di sisi laut, gradasi antar bioma yang bertemu di warna yang sama di tepi, dan kaki bukit yang lebih hijau di dekat gunung.
- **Hutan** diambil sampel di seluruh hex dan hanya menipis ke arah tetangga non-hutan, jadi hutan beberapa tile terbaca sebagai satu hutan. Jenis pohon mengikuti medan noise lintas tile, dan pohon "tumpah" ke padang rumput di tepinya. Palem dan batu tumbuh di pita pasir pantai.
- **Ladang** direncanakan sebagai satu estate: 1-2 petak per tile, tiap petak punya tanaman (gandum, sayur, bajak, padang) dan arah alur sendiri, menyeberangi tepi hex.
- **Kota** memakai satu grid jalan untuk seluruh wilayahnya, dengan jalan, taman, dan skyline yang meninggi ke pusat (modern).
- **Fokus**: klik blok faksi, daftar kota di panel, label kota, atau tile kota di globe. Kamera terbang dengan lengkung (globe tampak berputar), mendarat miring, lalu orbit di sekitar titik itu. Wilayah faksi diberi warna, kota diberi outline. Info tampil di kartu kiri (bottom sheet di ponsel) dan globe bergeser ke ruang yang kosong. "Kembali ke globe" atau Esc untuk keluar, dan "Naik kendaraan dari sini" untuk langsung ke mode POV.
- **Garis hexagon** bisa disembunyikan (toggle di baris judul "Dunia"). Hover tile berupa pita putus-putus dua warna. Border faksi terdiri dari garis warna faksi, keyline terang di luar, dan pita warna yang memudar ke dalam wilayah.

---

## Update 5: garis halus, globe tidak kopong, awan & atmosfer, screenshot

- **Garis hexagon** sekarang berupa pita tipis abu-abu dengan tepi lembut (bukan garis GL 1px hitam): abu hangat di darat, abu kebiruan di laut. Tetap bisa disembunyikan lewat toggle.
- **Globe tidak lagi tembus**: near plane kamera mengikuti ketinggian di atas permukaan, jadi zoom dekat tidak memotong terrain. Transisi POV (masuk, ganti kendaraan, ganti mode, keluar) terbang melengkung di atas permukaan, tidak menembus planet.
- **Hover dan border** menempel datar di tanah: satu warna dengan dua opacity berdampingan (luar pekat, dalam lembut). Hover abu-abu, outline kota dan border faksi memakai warna faksi.
- **Screenshot**: tombol "Simpan gambar" di header (dan di panel untuk ponsel) mengunduh PNG tampilan saat ini (`planet-globe-<seed>-<tanggal-jam>.png`).
- **Awan dan atmosfer**: 70 gumpalan cumulus low-poly yang melayang perlahan dan memudar saat kamera mendekat, cincin atmosfer di luar planet, dan kabut kebiruan di tepi terrain.

---

## Update 6: garis pantai dan kedalaman laut membulat

- Grid tetap hexagon (klik, wilayah, jalur tetap per tile), tapi **batas yang digambar** mengikuti kontur yang dibulatkan: tiap sudut hex di-fillet lalu dihaluskan dengan spline (`ContourField` di `planetRenderer.js`, jarak bertanda ke kontur).
- **Kedalaman laut & danau**: laut dalam, laut, dan pesisir dangkal berbaur mengikuti lengkungan halus. Air toska dangkal memeluk garis pantai yang membulat, dan danau satu tile tampil bulat.
- **Pantai**: tile di garis pantai dipotong dengan marching triangles di sepanjang kontur. Sudut darat yang menonjol dipangkas jadi laut, sudut yang menjorok diisi jadi darat. Tebing (mode relief), pita pasir, dan buih ombak (satu pita mulus) ikut lengkungan itu. Tile gunung tetap berbentuk hex, karena mesh gunungnya memang hex.
- Props (pohon, rumah, baris ladang, alang-alang) tidak ditempatkan di sudut darat yang sudah jadi laut. Border, highlight, dan hover memakai tinggi permukaan yang sama.
- Biaya: bangun ulang terrain sekitar 1,2 detik (saat load, acak dunia, atau toggle rata/tebing). Render tetap sekitar 76 fps.
