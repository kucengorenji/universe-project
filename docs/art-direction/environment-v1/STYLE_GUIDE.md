# Style guide environment v1

Status: aturan produksi usulan yang mengoperasionalkan painted diorama proyek. Prioritas bila ada konflik: keputusan pengguna → docs/ART_DIRECTION.md → kontrak batch yang sudah lolos QA → brief ini.

## Tujuh referensi, tujuh peran

| Ref | Ambil | Batasi |
|---|---|---|
| REF-01 canopy | Kanopi asimetris, kelompok massa besar, trunk bercabang, celah antarmassa | Bola identik, daun berbintil seperti spons, semua pohon sama lebar |
| REF-02 village | Hirarki jalan–rumah–ladang–sungai, landmark, transisi vegetasi | Bayangan baked, semua warna autumn dipakai serentak, pulau kotak dijadikan topology dunia |
| REF-03 rocks | Bidang lebar, outline jelas, pecahan dan bevel terpilih | Batu putih murni; highlight/shadow ungu permanen; tanaman menyatu wajib dengan setiap batu |
| REF-04 paving | Running bond, cobble, herringbone, stone irregular, motif plaza | Memakai contact sheet langsung; pola lingkaran diulang pada seluruh jalan |
| REF-05 brick | Nat terbaca dan tepi sedikit rounded | Oranye jenuh universal; outline gelap tebal pada setiap brick; sembilan pola sekaligus satu distrik |
| REF-06 forest | Pohon dominan, sapling, deadwood, stones, understory yang saling mendukung | Scatter merata; faceting kasar sebagai batas kualitas objek dekat |
| REF-07 modular kit | Pemisahan terrain/architecture/props, socket, variasi modular | Logo/branding atau desain khas pack disalin; semua isi gambar otomatis masuk backlog |

Gambar adalah acuan visual, bukan instruksi teknis atau bukti sebuah UV/mesh telah tersedia.

## Bentuk dan detail

- **Pohon:** trunk tapered dengan root flare, cabang menahan massa kanopi. Untuk proof, 3–5 massa utama berbeda ukuran, pecah menjadi beberapa submassa; sisakan celah. Opaque canopy utama, cards hanya untuk siluet yang membutuhkan. Bentuk species harus terbaca tanpa label.
- **Batu:** 3–7 bidang utama, satu orientasi/bentuk dominan, bevel selektif. Boulder, slab, wedge, pebble dan cliff punya peran berbeda. Moss dan tanaman ditempatkan terpisah berdasarkan orientasi/kelembapan.
- **Bangunan:** fondasi, dinding, rangka, bukaan, roof edge dan chimney terbaca dalam tiga skala. Roof slope dan overhang konsisten per budaya; detail kecil memakai trim/texture.
- **Props:** tebal kayu, pegangan, roda dan tali sedikit diperjelas agar terbaca. Pintu, kursi dan alat mengikuti ukuran manusia; landmark boleh membesar melalui aturan khusus.
- **Ground:** bidang tenang dengan detail lokal dekat kamera. Transisi dirt/grass/stone memakai mask/edge yang mengikuti bentuk jalan, tidak membuat bingkai sama di tiap tile.
- **Air:** bentuk dan warna kedalaman utama, ripple halus dan foam terputus di kontak pantai. Hindari garis caustic seragam di seluruh air.

## Shading dan warna

Semua opaque/cutout mengikuti keluarga toon bersama. Normal smooth untuk volume kanopi, bidang batu/arsitektur memakai hard edge yang dipilih. Jangan flat-shade seluruh mesh hanya karena stilisasi. Detail material memakai modulasi netral lembut; tidak menanam arah matahari atau cast shadow di texture.

Sumber warna runtime tetap src/art/palette.js. Warna berikut adalah **swatch kerja**, belum token 3D baru yang diimplementasikan:

| Peran | Swatch awal | Sumber/status |
|---|---|---|
| Meadow | #a9c48b | MAP_COLORS.meadow, token 2D; kandidat adaptasi 3D |
| Canopy mid/dark | #6f9c72 / #4f7f5c | MAP_COLORS.treeLight/tree; kandidat 3D |
| Sand | #e2d3a8 | MAP_COLORS.sand |
| Path | #d9cda9 | MAP_COLORS.path |
| Rock neutral | #8e8a80 | MAP_COLORS.wall; kandidat stone |
| Warm timber | #9a7a55 | MAP_COLORS.dock |
| Terracotta | #a45a43 / #9a5440 | ROOF_PALETTES.terran.main |
| Slate | #5f6671 | ROOF_PALETTES.terran.third |
| Shallow/deep water | #86c1c6 / #4a8aa0 | MAP_COLORS water; shader calibration diperlukan |
| Modern facade/glass | #c9c4ba / #6d96a6 | MAP_COLORS wallsModern/glass |

Tidak ada salinan palet authoritative di folder aset. Job produksi mencatat hash sumber palet dan menghasilkan snapshot build. Perluasan token diajukan sebagai perubahan sumber yang sama pada fase integrasi.

Aturan komposisi awal: sekitar 70% massa netral/dominan, 20–25% secondary, sisanya aksen. Ini panduan frame/distrik, bukan distribusi RNG setiap objek. Warna atap mengikuti planner yang sudah ada; bunga/faction/banner boleh lebih jenuh karena areanya kecil. Vegetasi autumn adalah preset musim, bukan warna acak per pohon.

## Tema environment yang kompatibel

| Kit | Bentuk / material utama | Karakter |
|---|---|---|
| Meadow village | Oak, batu hangat, kayu, plaster, terracotta, dirt/cobble | Hangat, berpenghuni, kebun berfungsi |
| Conifer ridge | Pine, slab dan cliff, understory lebih jarang | Vertikal, celah pandang, batu lebih dominan |
| River farm | River bank, reeds, bridge, crop rows, fence | Lembap, pola tanam teratur, akses menuju air |
| Coastal hamlet | Sand, low rock, dock, weathered wood, boat | Ruang lebih terbuka, transisi basah-kering |
| Civic / town edge | Paving, planter, bench, facade netral, kaca tertata | Rapi, frontage dan jalan terbaca |
| Seasonal overlays | Autumn / dry / snow | Mengubah material/dressing sesuai biome; bukan kit seni baru |

Variasi dari seed harus memilih spesies, material family dan kepadatan yang sesuai tema. Jangan mengunci semua dunia menjadi medieval hanya karena referensi 7; modern memakai bahasa bentuk/palet yang sama.

## Keterbacaan lintas skala

Review setiap aset pada kamera dekat, jalan kaki, dan overview. Detail yang hanya terbaca di closeup tidak boleh mendominasi biaya crowd scenery. Proxy planet memakai outline, warna atap, landmark dan spesies yang sesuai kota; bukan model town yang sekadar diperkecil.

Tile planet dan meter town memiliki kontrak berbeda. Jangan menetapkan regular hex seragam sebagai aturan seluruh bola: proyeksi, pentagon/transition cells dan junction mengikuti generator aktual.

