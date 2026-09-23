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

