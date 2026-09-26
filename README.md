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
│   ├── main.js                 # Entry point: engine, world, director (router mode)
│   ├── style.css               # Styling UI, HUD tiap mode, cover transisi
│   ├── core/                   # engine, director, router, overlay, quality, post, audio, missions, tips, pauseMenu
│   ├── world/                  # world (seed + cache planet), solarSystem, planetTypes, bake worker
│   ├── modes/
│   │   ├── space/              # SpaceMode, benda langit, kapal, HUD, bake tekstur planet
│   │   ├── planet/             # PlanetMode (membungkus planetRenderer + menu)
│   │   └── town/               # TownMode, layout, builder, groundPaint, sky, vehicle, fleet, interior, crowd, HUD
│   ├── math/
│   │   ├── hexasphere.js       # Generator topologi dual bola heksagon (Goldberg Polyhedron)
│   │   └── simplex3d.js        # Seedable 3D Simplex & fBm noise
│   ├── map/
│   │   └── mapGenerator.js     # Logika generasi bioma, sungai, faksi, & LocalStorage
│   ├── render/
│   │   └── planetRenderer.js   # Three.js scene, lighting, border Civ, koneksi 3D, & kamera 75%
│   └── ui/
│       ├── menuController.js   # Kontrol menu toggle kiri atas, slider, & tile inspector
│       └── gauges.js           # Minimap kota dan speedometer
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

---

## Update 7: aset mid-poly + LOD, latar luar angkasa

- **Pipeline Blender profesional** (`tools/blender/build_assets.py`, disimpan juga sebagai `tools/blender/globe_assets.blend`): koleksi `GlobeAssets/` dengan sub-koleksi per kategori (Nature, Farm, Settlement_Fantasy, Settlement_Modern, Infrastructure, Vehicles). Setiap aset berupa Empty dengan anak `<aset>_LOD0/1/2`, dan material diambil dari satu palet `M_<warna>`.
- **LOD0 mid-poly** (rata-rata sekitar 2,9x LOD1): segmen lebih banyak, semua tepi dibevel, dan detail kecil (jendela dan balok bubungan rumah, pucuk dan pangkal pinus, dedaunan tambahan). **LOD2**: model buatan tangan untuk pohon, hasil decimate untuk aset lain.
- **Dua pack**: `assets.glb` (LOD1+LOD2, sekitar 290 KB) dimuat lebih dulu. `assets_lod0.glb` (sekitar 340 KB) menyusul, dan begitu tiba, props serta kendaraan otomatis naik ke LOD0.
- **LOD per chunk**: props dibagi ke 32 chunk (titik dan pusat muka icosahedron). Tiap chunk menampilkan satu LOD sesuai jarak dari kamera: LOD0 di bawah 0,35R, LOD1 di bawah 1,1R, LOD2 selebihnya. Chunk di balik horizon dilewati.
- **Luar angkasa**: latar CSS biru-hitam dengan vignette, bola nebula prosedural di sepanjang pita galaksi, dan sekitar 3.200 bintang dengan variasi ukuran dan warna. Kontrol header memakai permukaan concrete supaya terbaca di langit gelap.

---

## Update 8: tiga mode (space, planet, kota), transisi mulus, aset Blender high-poly

Tiga mode, masing-masing di "halaman" sendiri (URL hash) dan chunk JS sendiri. Hanya mode yang tampil yang dimuat, dirender, dan menyimpan mesh:

| Mode | URL | Isi |
| :--- | :--- | :--- |
| **Space** | `#/space`, `#/space/<planet>` | Tata surya dari seed dunia: bintang, 5–8 planet, bulan, cincin, sabuk asteroid. Kapal bisa terbang bebas (WASD, R/F naik turun, Shift boost) atau autopilot (klik planet / daftar). Tombol M membuka peta sistem. |
| **Planet** | `#/planet/<i>`, `#/planet/<i>/city/<c>` | Globe hex seperti sebelumnya, sekarang untuk setiap planet yang bisa didarati. |
| **Kota** | `#/town/<i>/<c>` | Diorama kota skala meter yang dipotong dari peta hex planet. Bisa jalan kaki (orang ketiga) atau menyetir. |

- **Tipe planet** (`src/world/planetTypes.js`): terran (rumah), samudra, gurun, es, vulkanik, tandus, raksasa gas. Tipe mengatur parameter generator (laut, gurun, tundra, sungai, ada kota atau tidak) dan tampilan (palet, gunung, air/lava, atmosfer, awan, langit, flora). Kota dan faksi hanya ada di terran, samudra, dan gurun. Raksasa gas hanya bisa diorbit.
- **Yang disimpan tetap cuma peta planet rumah** (localStorage, seperti sebelumnya). Planet lain di-generate ulang dari seed-nya masing-masing (sekitar 50 ms) dan di-cache di memori. "Acak dunia" membuat planet rumah baru sekaligus tata surya baru.
- **Transisi**:
  - *Space ke planet*: kapal masuk orbit (autopilot), lalu kamera menukik sampai planet memenuhi layar dengan framing yang persis sama dengan globe. Frame terakhir di-crossfade ke globe, jadi terlihat seperti zoom.
  - *Planet ke kota*: kartu kota punya tombol "Mendarat di kota". Kamera menukik ke kota, masuk awan, lalu keluar di atas diorama.
  - *Balik*: "Lepas landas" (kota ke planet, kembali ke close-up kota di globe) dan "Ke orbit" (planet ke space, kapal naik dari sisi planet yang sedang dilihat).
  - Mode berikutnya dimuat selama animasi keberangkatan. Loading hanya muncul kalau memang perlu (misalnya cold start dari URL).
- **Tekstur planet di space** di-bake di Web Worker dari peta tile yang sama dengan globe (tile hex terdekat per piksel), jadi benuanya identik. Channel alpha dipakai untuk lampu kota di sisi malam dan cahaya lava.
- **Kota**: jalan utama memancar dari plaza, ada ring dan gang, landmark (kastil/kuil/menara), tembok dan gerbang, lapak pasar, sumur, dermaga (kota fantasi). Kota modern dapat grid jalan dengan trotoar, pusat kota bergedung tinggi, taman, lampu jalan, mobil parkir, dan lalu lintas. Sekeliling kota diambil dari tile di sekitarnya: ladang, hutan, gunung, pantai, danau, dan jalan ke kota tetangga. Pejalan kaki digambar instanced (4 draw call untuk seluruh kerumunan).
- **Aset Blender** (`tools/blender/build_town_space.py`, dibangun lewat Blender MCP, disimpan juga sebagai `town_space_assets.blend`):
  - `town.glb` (sekitar 1,6 MB): 47 aset skala meter dengan LOD0/1/2 dan varian. LOD0 total sekitar 100 ribu tris: rumah 1,3–4,4k, kastil 16k.
  - `space.glb`: kapal fregat, 8k tris di LOD0.
  - `character.glb`: penjelajah ber-rig dengan animasi idle, walk, dan run.
- **Performa**: satu konteks WebGL dan satu render loop. Setting grafis Auto/Tinggi/Sedang/Rendah; di Auto, resolusi turun atau naik mengikuti FPS. Tier rendah memperpendek jarak LOD, mengurangi pohon, pejalan kaki, dan resolusi terrain, serta mematikan bayangan. Terukur 75 fps (batas refresh monitor) di ketiga mode di laptop, dan tetap 75 fps pada emulasi HP dengan CPU di-throttle 4×.

---

## Update 9: kota hidup, masuk rumah, misi, dan polish produksi

**Kota tanpa kedip dan tabrakan**
- Gedung ditempatkan dari footprint asli aset (bukan kotak kira-kira), jadi tidak lagi saling tembus. Jalan, marka, zebra cross, dan ladang dicat ke tekstur tanah (`groundPaint.js`), bukan pita geometri, jadi tidak ada z-fighting.
- Langit (`sky.js`) mengikuti tipe planet dan jam dunia yang sebenarnya (posisi planet di orbit + rotasinya): pagi, senja, malam dengan bintang dan bulan. Batas dunia: cincin horizon sampai 4,2 km dengan kabut hybrid, air dengan riak, buih, dan kilau.
- Malam hari: jendela gedung kaca menyala acak per lantai, lampu jalan dan jendela rumah bersinar (bloom).

**Nyetir ala GTA di semua mode**
- Mobil (`vehicle.js`): grip lateral, rem tangan untuk drift, suspensi, tabrakan memantul, kamera chase yang tertinggal di tikungan. 11 tipe (sedan, hatchback, SUV, van, bus, sport, pikap, polisi, kereta kuda, wagon, karavan).
- Semua kendaraan bisa dinaiki: dekati lalu tekan E. Mobil yang sedang jalan bisa diambil alih (sopirnya kabur). Ada lalu lintas di jalan besar.
- Luar angkasa: 3 kapal di hangar (fregat, interceptor, freighter) dan kapal NPC yang lalu-lalang. Di planet: tombol "Nyetir rover" untuk menjelajah permukaan.

**Masuk rumah** (`interior.js`)
- Rumah, pondok, apartemen, toko, kedai, dan kantor bisa dimasuki (E di depan pintu). Ruangan dibuat prosedural dengan tampilan dollhouse (dinding yang menghalangi kamera disembunyikan), perabot dari `furniture.glb`, dan tekstur lantai/dinding dari atlas.
- Interaksi: duduk, tidur sampai pagi (jam dunia maju), buka/tutup lemari dan kulkas, nyalakan lampu, TV, radio, dan perapian, ambil dan taruh barang.

**Misi** (`core/missions.js`, tombol J)
- Empat checklist lintas mode: Rumah pertama, Malam santai, Penjelajah, Pilot. Tiap tugas tercentang otomatis. Kalau satu misi lengkap, muncul popup dengan confetti dan fanfare.

**Polish**
- *Post-processing* (`core/post.js`): MSAA, bloom setengah resolusi, tone mapping ACES, color grading dan vinyet per mode. Otomatis mati di tier Rendah.
- *Audio* (`core/audio.js`): semuanya Web Audio, tanpa file. Suasana per tempat (dengung luar angkasa, angin, burung siang, jangkrik malam, dengung kota), musik pad generatif, suara mesin dengan perpindahan gigi, ban berdecit, langkah kaki, pintu, saklar, radio lo-fi, TV, dan perapian.
- *HUD*: minimap kota yang berputar mengikuti kamera (pintu yang bisa dimasuki ditandai kuning), speedometer dengan gigi, prompt interaksi yang bisa di-tap.
- *Menu jeda* (P atau tombol bulat kanan bawah): kualitas grafis, efek visual, volume utama/musik/efek, bisu (B), daftar kontrol, tampilkan tips lagi, reset misi. Waktu game berhenti selama jeda.
- *Onboarding*: kartu judul di kunjungan pertama, lalu satu tip singkat saat pertama kali berada di tiap tempat atau cara bergerak.

**Kontrol ringkas**

| Tempat | Tombol |
| :--- | :--- |
| Luar angkasa | W/S dorong, A/D belok, Q/E geser, R/F naik turun, Shift boost, L mendarat, M peta sistem |
| Planet | Seret putar, klik kota, O kembali ke orbit; rover: WASD, Spasi drift, Esc keluar |
| Kota | 1/2/3 diorama/jalan/nyetir, WASD, Shift lari/ngebut, Spasi lompat/rem tangan, E masuk atau pakai, Esc keluar |
| Umum | J misi, P menu, B bisu |
