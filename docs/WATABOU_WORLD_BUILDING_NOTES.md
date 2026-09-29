# Watabou → Globe Universe: catatan procedural world building

Tanggal riset: **26 September 2026**. Baseline Globe: commit `ed3990c` ditambah working tree saat dibaca. Dokumen ini adalah referensi kerja untuk implementasi berikutnya; status implementasi ada di [roadmap](WORLD_BUILDING_ROADMAP.md).

## 1. Arah yang dipilih

Bangun **satu dunia dengan identitas dan konsekuensi yang bertahan saat berganti skala**: space → planet → region → town → district → building → room → object. Empat level yang dialami pemain tetap space, planet, town, dan inside house; region/district/building adalah lapisan data penghubung, tidak wajib menjadi mode layar baru.

Kota pelabuhan harus tumbuh dari lokasi pelabuhannya. Rumah nelayan harus memiliki akses ke jalan, ruang kerja, dan barang yang masuk akal. Nelayan yang terlihat di dermaga adalah orang yang sama saat pulang. Pengiriman dari orbit harus dapat memengaruhi stok toko. Menambah keragaman mesh saja tidak memenuhi sasaran ini.

**Keputusan:** pertahankan Three.js, hexasphere, generator planet, mode lifecycle, aset GLB, instancing, dan pipeline Blender. Tambahkan kontrak data antarskala, denah bangunan, state persisten, serta simulasi ringan. Tidak perlu mengganti engine atau langsung membuat seluruh galaksi.

## 2. Cara membaca bukti

- **[S] Source:** perilaku dijelaskan oleh Watabou di halaman resmi, Procgen Arcana, atau devlog.
- **[K] Kode:** algoritma benar-benar dibaca dari repositori resmi Watabou; berlaku untuk versi source tersebut.
- **[L] Lokal:** kondisi ditemukan dalam source Globe atau dokumen project lokal.
- **[U] Usulan:** sintesis untuk Globe, bukan klaim tentang implementasi internal Watabou.

Riset mencakup katalog publik, dokumentasi generator utama, devlog integrasi, dan source `Model.hx`/`Ward.hx` TownGeneratorOS. Tidak semua generator menyediakan source. Tidak ada klaim bahwa seluruh algoritma privat sudah dipelajari, semua generator sudah dimainkan, atau output JSON sudah diuji round-trip. Fitur yang tertulis sebagai *plans for expansion* tidak dianggap sudah tersedia. Tanggal absolut lebih diutamakan daripada label waktu relatif situs.

## 3. Peta generator utama dan penerapannya

Kolom penerapan di bawah adalah **[U]**. Referensi pada kolom pertama mendukung deskripsi generator, bukan membuktikan usulan Globe sudah ada.

| Project Watabou | Temuan yang terverifikasi | Penerapan pada Globe |
|---|---|---|
| [Constellations](https://watabou.itch.io/constellations) | [S] Generator konstelasi dengan opsi regenerasi. | Identitas langit per budaya, navigasi visual, observatorium. Orbit dan ekonomi antariksa tetap sistem Globe. |
| [Perilous Shores](https://watabou.github.io/realm.html) | [S] Region berbasis hex yang geometri grid-nya tidak ditonjolkan; permukiman, jalur darat/laut, danger, nama bentang alam, tautan ke generator kota/desa/dungeon. | Lapisan region dan POI di atas planet hex; pelabuhan dan gerbang kota mewarisi rute regional. |
| [Medieval Fantasy City Generator](https://watabou.github.io/city.html) | [S] Konfigurasi elemen kota, warp, nama distrik, integrasi Dwellings, ekspor peta/data. | Kota sebagai distrik fungsional yang dapat diinspeksi, dengan batas dan koneksi eksplisit. |
| [Village Generator](https://watabou.github.io/village.html) | [S] Jalan menjadi dasar desa; rumah jarang di sepanjang jalan, ladang, kebun, pohon, jembatan/dermaga; integrasi Dwellings. | Desa pertanian, kampung nelayan, persimpangan dagang; bukan kota besar yang diperkecil. |
| [Neighbourhood Generator](https://watabou.itch.io/neighbourhood) | [S] Generator lingkungan jalan/bangunan/plaza; devlog mencatat template dan integrasi mansion. | Grammar jaringan jalan per distrik, bukan satu pola radial untuk semua kota fantasi. |
| [Urban Places](https://watabou.itch.io/urban-places/devlog/1061713/112-dwellings-integration-and-other-changes) | [S] Kepadatan, penghijauan, keteraturan gang, ukuran/jarak rumah bervariasi; rumah dapat dibuka di Dwellings. | Pasar, halaman bersama, lorong, taman kecil, frontage toko, dan variasi kepadatan yang terkontrol. |
| [Dwellings](https://watabou.github.io/dwelling.html) | [S] Denah dengan fungsi ruang, beberapa lantai dan tangga, blueprint footprint, serta tampak bangunan. | Interior diturunkan dari footprint, pintu, jumlah lantai, fungsi bangunan, dan household. |
| [Taverns](https://watabou.itch.io/taverns) | [S] Denah tavern/inn dengan lantai dan props; ekspor per lantai atau seluruh bangunan. | Kedai memiliki ruang publik, servis, gudang, kamar inap; menjadi simpul aktivitas dan informasi. |
| [Procgen Mansion](https://watabou.itch.io/procgen-mansion) | [S] Regenerasi varian dengan ground plan yang sama, blueprint, tampilan denah/lantai, style, dekorasi dan cuaca. | Pisahkan struktur bangunan dari gaya, material, cuaca, dan dekorasi. |
| [City Viewer](https://watabou.itch.io/city-viewer) | [S] Membaca JSON generator permukiman untuk ditampilkan dalam 3D; bukan generator kota tersendiri. | Blueprint data yang sama dipakai untuk globe proxy, town mesh, minimap, collider, dan navigasi. |
| [One Page Dungeon](https://watabou.github.io/dungeon.html) | [S] Denah semi-simetris dengan deskripsi singkat lokasi untuk memberi kesan sejarah; beberapa format ekspor. | Reruntuhan, cellar, bunker, atau kapal terlantar dengan fungsi ruang dan petunjuk cerita. |
| [Cave/Glade](https://watabou.github.io/cave.html) | [S] Tata ruang yang sama dapat menjadi gua atau kelompok clearing; air dan jalan antarpintu keluar. | Satu graph encounter untuk gua, hutan rapat, tambang, dan area alien, dengan dressing berbeda. |

**Batas penerapan space:** katalog yang diperiksa tidak menyediakan generator tata surya atau simulasi planet bulat setara Globe. Constellations memberi referensi langit; penerapan prinsip region/route/landmark pada space merupakan ekstrapolasi desain kita.

### Katalog pelengkap

| Project | Kedalaman kajian | Keputusan untuk Globe |
|---|---|---|
| [Sails](https://watabou.itch.io/sails) | [S] Halaman generator: kapal layar, variasi presentasi, layar yang bisa dilipat. | Variasi siluet armada laut mengikuti fungsi kapal dan budaya. Belum ada dasar untuk mengklaim generator interior kapal. |
| [Lighthouses](https://watabou.itch.io/lighthouses) | [S] Halaman generator: mercusuar dan ekspor gambar. | Landmark pesisir terbaca dari jauh; jadikan beacon yang terhubung dengan port. |
| [Castle in The Mist](https://watabou.itch.io/castle-in-the-mist) | [S] Halaman generator: kastil, plan view, nama dan skema warna. | Benteng sebagai landmark unik dan komposisi skyline. |
| [Fantasy Manor](https://watabou.itch.io/fantasy-manor) | [S] Halaman generator: gambar manor dari atas. | Referensi variasi footprint estate; utamakan Dwellings untuk interior. |
| [The Haunting of...](https://watabou.itch.io/the-haunting-of) | [S] Halaman generator: rumah bertema horor. | Kondisi bangunan/cerita mengubah suasana, barang, cahaya dan suara. |
| [Terrarium/Aquarium](https://watabou.itch.io/terrarium) | [S] Halaman generator: palet, gelembung, ikan/kupu-kupu yang dapat ditambahkan. | Kehidupan ambient lokal; bukan bukti adanya simulasi ekosistem penuh. |
| Perilous Icons; Compass Rose Generator | Katalog [Watabou](https://watabou.itch.io/), belum audit algoritma. | Simbol peta dan navigasi; gunakan data landmark yang sama dengan dunia 3D. |
| Tiny Pubs; Winter Mansion; Toy Town | Katalog, belum audit source. | Referensi tambahan kedai, presentasi musim, dan viewer lama; prioritas di bawah Taverns/Dwellings/City Viewer. |
| Winter Trees; Seasonal Wreaths; Antlers | Katalog, belum audit source. | Variasi flora musiman dan detail natural untuk dressing belakangan. |
| Sigil Generator; Rune Generator; Voxel Throne Generator | Katalog, belum audit source. | Identitas budaya, simbol, furnitur landmark; harus terikat pada culture seed. |
| Hair; Stick Figures; Tank Doodles; Procgen Locomotives | Katalog, belum audit source. | Referensi variasi karakter/props/kendaraan; bukan fondasi world generation. |
| Pixel Dungeon; Roguewood; Book Hunter; Dark Clues; Ever-Changing Mansion; Ocean Tribes | Katalog game, belum kajian mekanik/source. | Backlog studi encounter, cerita dan eksplorasi; jangan mengatribusikan algoritma tertentu dari judul saja. |

Judul puzzle/adventure lain di halaman profil tidak diprioritaskan sebagai sistem world building. Cakupan “semua level” dipenuhi dengan desain antarskala; katalog pelengkap tidak disamakan dengan audit menyeluruh semua karya Watabou.

## 4. Proses yang bisa dipelajari secara teknis

### 4.1 Kota: topologi → akses → fungsi → bangunan

[K] Source publik [Model.hx](https://raw.githubusercontent.com/watabou/TownGeneratorOS/master/Source/com/watabou/towngenerator/building/Model.hx) menjalankan urutan `buildPatches → optimizeJunctions → buildWalls → buildStreets → createWards → buildGeometry`. Patch berasal dari titik berdistribusi spiral dan Voronoi; beberapa titik pusat direlaksasi. Jalan menghubungkan gerbang dengan plaza/pusat melalui topologi, kemudian segmen dirapikan. Ward memperoleh fungsi sebelum geometri akhirnya dibangun.

[K] [Ward.hx](https://raw.githubusercontent.com/watabou/TownGeneratorOS/master/Source/com/watabou/towngenerator/wards/Ward.hx) melakukan inset berbeda menurut kelas jalan/tembok. `createAlleys` membagi polygon secara rekursif dengan variasi rasio, sudut dan ukuran; sebagian area boleh kosong. `filterOutskirts` memakai kedekatan ke jalan dan patch kota untuk menipiskan bangunan di pinggir.

[S] [README TownGeneratorOS](https://github.com/watabou/TownGeneratorOS) menyatakan source tertinggal dari generator publik, antara lain untuk waterbodies dan options UI. Karena itu urutan di atas adalah bukti implementasi versi source, bukan spesifikasi lengkap MFCG saat ini. Repositori menampilkan GPL-3.0; izin output di halaman generator tidak sama dengan lisensi source. Rencana Globe mengambil konsep dan membuat implementasi sendiri, tanpa menyalin source Haxe.

[U] Adaptasi praktis: gunakan patch/district hanya pada skala town. Pertahankan graph hex untuk skala planet. Tentukan sungai, garis pantai, gerbang dan jalan antar-kota sebagai constraint tetap sebelum membagi lahan. Setiap parcel harus memiliki akses; plot yang gagal tidak diisi secara paksa. Taman, halaman, dan ruang servis adalah hasil valid.

### 4.2 Desa: jaringan akses mendahului kepadatan

[S] Watabou secara eksplisit membedakan desa yang dibentuk oleh jalan dari kota yang lebih didominasi bangunan. [Village Generator](https://watabou.github.io/village.html)

[U] Pipeline Globe: koneksi regional → jalan mengikuti relief → simpul sumur/pasar/jembatan → rumah menghadap jalan → kebun belakang → ladang → batas hutan. Beri setiap desa mata pencaharian utama. Desa pertanian memiliki gudang dan jalur ke ladang; kampung nelayan memiliki tempat bongkar ikan dan akses ke air. Jangan menambahkan pelabuhan jika water access tidak valid.

### 4.3 Region: struktur besar dan tautan ke detail

[S] Perilous Shores menyimpan permukiman dan danger sebagai tujuan yang dapat dibuka di generator skala lebih kecil. Blueprint mengatur bentuk daratan; style tidak mengharuskan mengganti geografi. [Procgen Arcana: Realm](https://watabou.github.io/realm.html)

[S] Versi 2.0.0 menambahkan pemuatan peta JSON yang sebelumnya diekspor. Ini penting untuk membedakan “seed yang membuat awal dunia” dari “dokumen dunia yang sudah diedit”. [Devlog save/load](https://watabou.itch.io/perilous-shores/devlog/1600069/200-saving-and-loading)

[U] Globe perlu `RegionDescriptor` di antara planet dan town: bentang alam bernama, ekonomi, budaya, hazard, settlement, serta rute. Bentuk coast/river yang diturunkan ke town harus berasal dari identitas fitur planet, bukan noise baru yang tak berkaitan. Simpan perubahan pemain terpisah dari blueprint awal.

### 4.4 Interior: fungsi ruang dan konektivitas

[S] Dwellings memprioritaskan denah bermakna dan fungsi ruang; blueprint dapat menentukan ground plan, dan lantai dihubungkan tangga. [Dwellings overview](https://watabou.github.io/dwelling.html) Devlog juga mencatat JSON export dan pembaruan tangga, tetapi riset ini tidak memvalidasi schema JSON-nya. [Devlog 1.4.0](https://watabou.itch.io/dwellings/devlog/1113590/140-json-export-and-improved-stairs)

[U] Jangan mengasumsikan Dwellings memakai BSP/WFC tanpa source. Untuk Globe, kita memilih sendiri **room adjacency graph + pembagian footprint dengan constraint**:

1. Ambil polygon interior yang sudah dikurangi ketebalan dinding, posisi pintu luar, bukaan, lantai dan style dari bangunan.
2. Tentukan program ruang menurut fungsi dan penghuni: rumah, rumah-toko, kedai, apartemen, kantor.
3. Bentuk graph akses publik → servis → privat. Tentukan tangga terlebih dahulu untuk bangunan bertingkat.
4. Bagi area; nilai kandidat terhadap luas minimum, rasio bentuk, adjacency, bukaan, dan jalur lewat.
5. Pasang pintu/jendela; buktikan jalur dari pintu masuk ke ruang dan lantai wajib.
6. Tempatkan furnitur besar, area interaksi dan swept area pintu; props kecil datang terakhir.
7. Gunakan bounded retries dan fallback denah aman. Jangan biarkan solver mengulang tanpa batas.

Lemari tidak boleh memblokir pintu; kursi butuh titik duduk dan ruang berdiri; tempat tidur butuh titik pendekatan. Lampu, barang, pemilik dan jadwal rumah memakai identitas objek yang persisten.

### 4.5 Satu denah, beberapa representasi

[S] City Viewer memvisualisasikan JSON permukiman; Procgen Mansion menyediakan variasi bangunan dengan ground plan yang sama. [City Viewer](https://watabou.itch.io/city-viewer), [Procgen Mansion](https://watabou.itch.io/procgen-mansion)

[U] Pisahkan `generateBlueprint()` dari `buildScene()`. Outline planet, gedung di town, minimap, collider, nav graph, dan interior harus berasal dari blueprint yang sama. Pergantian material, LOD, kamera atau kualitas tidak boleh mengubah identitas rumah dan isi inventaris.

### 4.6 Tempat memiliki cerita, bukan sekadar dekorasi

[S] One Page Dungeon memakai deskripsi lokasi untuk menimbulkan kesan sejarah; Cave/Glade menunjukkan topologi yang bisa disajikan sebagai dua lingkungan berbeda. [Dungeon](https://watabou.github.io/dungeon.html), [Cave/Glade](https://watabou.github.io/cave.html)

[U] Generator cerita Globe harus memilih fakta lebih dahulu: siapa pemilik, apa pekerjaan, apa yang terjadi, apa akibatnya. Turunkan props, dialog singkat, kondisi bangunan dan mission hook dari fakta tersebut. Contoh: bengkel tutup karena suplai terlambat → rak kosong → pekerja menunggu → permintaan pengiriman. LLM tidak diperlukan untuk konsistensi ini; template deterministik cukup untuk tahap awal.

## 5. Audit kondisi Globe sekarang

Temuan berikut **[L] berdasarkan pembacaan kode**, bukan benchmark atau pengujian runtime baru. Nama file relatif terhadap root Globe.

| Bagian | Fondasi yang sudah ada | Gap yang perlu ditangani |
|---|---|---|
| `src/world/solarSystem.js` | Tata surya 5–8 planet dari seed; zona planet, orbit, bulan, cincin, belt. | Belum menjadi jaringan produksi, port dan perjalanan beridentitas. |
| `src/world/world.js` | Jam bersama, `sunAt`, peta planet on-demand, LRU tiga non-home map; home map tersimpan. | Belum ada store state entitas lintas level; clock memakai waktu nyata + offset. |
| `src/world/planetBake.worker.js` dan `src/modes/space/bake.js` | Bake tampilan orbit dari data planet. | Perlu revision/cache key eksplisit saat blueprint/state visual berubah. |
| `src/map/mapGenerator.js` | Elevation/moisture/noise, biome, sungai, kota, farm, A* darat dan rute laut. | Region bernama, sejarah, specialization dan POI belum menjadi kontrak utama. |
| `src/modes/town/townLayout.js` | Data layout terpisah dari mesh; tangent frame, kota fantasi/modern, street graph, footprint, OBB dan occupancy. | Bangunan yang ditempatkan belum memiliki ID semantik permanen; belum ada household/room graph. |
| `src/modes/town/TownMode.js` | Memasuki pintu, kembali keluar, interaksi interior. | Seed interior memakai `layout.seed * 31 + door.i`; index daftar bukan identitas bangunan stabil. Interior dibuat ulang saat masuk dan di-dispose saat keluar. |
| `src/modes/town/interior.js` | Furnitur, collider, interaction, resident, dollhouse. | `SIZES[kind]` menentukan ukuran tetap; denah belum mengikuti footprint luar; state interaksi tidak dipulihkan melalui store pada alur masuk/keluar yang dibaca. |
| `src/modes/town/crowd.js` | Crowd instanced, pejalan kaki di polyline, reaksi ancaman. | Walker membalik arah di ujung jalur; belum memiliki rumah, pekerjaan, jadwal dan tujuan harian. |
| `src/modes/space/traffic.js` | Kapal kargo/patroli terbang antartarget dan menunggu. | Target berikut dipilih acak; belum ada shipment, stock, atau alasan ekonomi. RNG juga dikonsumsi dalam update frame. |
| `src/core/missions.js` | Empat checklist persisten dengan event lintas mode. | Belum ada quest yang mengacu pada owner/building/shipment/POI; key penyimpanan tidak dipisah per world. |
| `src/core/director.js`, `router.js` | Lazy loading tiga mode dan transisi. | Interior merupakan substate TownMode; deep link belum menyebut building/room. |
| `src/core/quality.js`, builder dan asset library | Quality tier, instancing, LOD, disposal. | Perlu aturan tegas: quality hanya mengubah presentasi, bukan blueprint dan state gameplay. |

**Catatan baseline:** default konstruktor `World` saat ini subdivision 5; README awal dan `plan.md` menyebut baseline lama. Rumus dual subdivisi adalah `10 × 4^k + 2`: k=3 → 642, k=4 → 2.562, k=5 → 10.242. Jangan menjadikan “naik ke 2.562 tile” sebagai prioritas baru tanpa memeriksa world tersimpan dan caller.

**Clock perlu keputusan eksplisit:** README menyebut pause menghentikan waktu game, sedangkan `World.now()` mengikuti `Date.now()` dan offset. Sebelum menambah jadwal, uji kontrak pause, background tab, reload dan sleep. Jangan menganggap animasi yang berhenti berarti jam simulasi juga berhenti.

## 6. Kontrak dunia yang diusulkan

Semua di bagian ini **[U]**, nama modul/schema baru belum diimplementasikan.

```text
WorldManifest (worldId, rootSeed, generatorVersions, options, clockPolicy)
└─ SystemDescriptor
   ├─ OrbitNode / Station / TravelRoute
   └─ PlanetDescriptor
      └─ RegionDescriptor
         ├─ Landmark / POI / Route
         └─ SettlementBlueprint
            └─ District → Parcel → BuildingBlueprint
               └─ Floor → Room → Portal / InteractionAnchor / Object

EntityStateStore (per worldId + entityId)
└─ Household / NPC / inventory / doors / lights / shipments / discoveries
```

### Seed dan identitas

- Turunkan seed bernamespace dari `rootSeed + parentId + generatorDomain + generatorVersion`. Pisahkan stream layout, flora, dekorasi, household, dan cerita.
- `entityId` mengikuti key blueprint stabil; simpan pemetaan ID saat migrasi. Jangan memakai urutan array renderer atau object UUID Three.js.
- Versi generator mengunci cara membangun ulang dunia, bukan memaksa semua entityId berubah pada setiap update. Untuk perubahan struktur, buat mapping migrasi atau pertahankan blueprint lama.
- Panggilan RNG di render loop tidak boleh menentukan hasil ekonomi atau misi. Pilihan simulasi memakai event/tick yang stabil.
- `Math.random()` untuk konfeti tidak perlu dilarang; bedakan efek sementara dari fakta dunia.

### Contoh kontrak bangunan, bukan kode siap pakai

```js
BuildingBlueprint = {
  id, settlementId, parcelId, revision,
  footprintMeters, transformToTown, floorCount, floorHeight,
  use, cultureId, householdId,
  entrances: [{ id, floor, localPosition, outwardNormal, streetNodeId }],
  windows: [{ id, floor, wallId, offset }],
  layoutSeed, decorationSeed
};
InteriorBlueprint = {
  buildingId, revision,
  floors: [{ id, rooms, portals, stairs, furniture, interactionAnchors }]
};
EntityDelta = { worldId, entityId, schemaVersion, revision, changes };
```

`transformToTown` harus mengikuti konvensi yang sudah ada: local +Z merupakan depan bangunan, `rotation.y = -yaw`; town memakai frame U/N/V dari planet. Simpan transform dua arah dan uji round-trip pintu luar/dalam. Jangan menganggap unit orbit, radius globe 10, dan meter town setara.

### Persistence dan migrasi

Gunakan blueprint deterministik + delta state, dengan manifest dan generator version. Non-home map boleh keluar LRU tanpa kehilangan barang, NPC atau progress. Cache geometri boleh dibuang; state gameplay tidak ikut dibuang.

Untuk pertumbuhan data, pilih IndexedDB sebagai store dunia dan localStorage untuk preferensi kecil. Migrasi home map lama harus menyimpan salinan sebelum konversi, bersifat idempotent, dan memiliki rollback. Pisahkan achievement profil dari quest per-world; reset map tidak boleh menghapus preferensi atau menggandakan reward. Bila storage gagal, tampilkan status penyimpanan yang jujur.

### Waktu dan simulasi bertingkat

Satu `WorldClock` mendefinisikan pause dan time skip. Jadwal memakai hari lokal yang dihitung dari planet/city; UI boleh menampilkan fase pagi/siang/malam tanpa memaksakan 24 jam Bumi pada semua planet. Kebijakan offline harus eksplisit, dengan batas catch-up dan perlindungan perubahan jam sistem.

NPC jauh cukup memiliki jadwal/event berikut, bukan mesh. NPC dekat memiliki path dan interaksi. Saat masuk atau meninggalkan rumah, mesh berganti representasi tetapi ID tetap satu. Interior resident tidak boleh muncul sekaligus dengan NPC yang sama di pasar.

## 7. Pipeline per level untuk implementasi

### Space

Input: manifest dunia, sistem seeded yang sudah ada, kebutuhan tiap planet. Proses: planet roles → orbital port/station → graph rute → shipment/patrol schedule → representasi kapal dan landmark. Output: tujuan perjalanan yang dapat dijelaskan.

Sediakan `originPortId`, `destinationPortId`, `cargo`, `departureAt`, `arrivalAt` dan status untuk shipment. Jalur visual menggunakan posisi orbit bergerak; durasi perjalanan game boleh dikompresi tetapi harus konsisten. Jangan membuat lalu lintas pendaratan ke gas giant; gunakan stasiun orbit yang valid.

Imersi: beacon, identitas port, komunikasi singkat terkait shipment, silhouette armada per budaya, dan konstelasi yang juga terlihat dari planet. Ini desain Globe, bukan reproduksi algoritma Constellations.

### Planet dan region

Input: peta hex yang sama dengan bake orbit. Proses: kelompok bentang alam → region → penamaan/budaya → evaluasi settlement → resource dan trade → landmark/POI → metadata untuk town.

Kota baru dinilai dari akses air, kemiringan, jalur dagang dan sumber daya. Untuk save lama, turunkan descriptor dari kota yang sudah ada, jangan memindahkannya otomatis. Port orientation, river crossing dan road exits harus diwariskan saat detail town dibangun.

Tambahkan grammar per planet: desert-water-trade, ocean-port-fishing, ice-sheltered-research, lava-mining-hazard. Kehadiran kota tetap mengikuti aturan inhabited yang ada; outpost di planet ekstrem adalah fitur baru yang memerlukan shelter/life support, bukan rumah biasa yang ditempel.

### Town

Input: settlement descriptor, projected terrain, road/river/port anchors. Proses:

1. Pilih archetype: village, market town, port, fortified town, modern district, colony.
2. Reservasi jalur air, pantai, lereng, gerbang dan jalan regional.
3. Bentuk district dan road graph; tentukan plaza/pasar/port sebagai anchor.
4. Bagi block menjadi parcel dengan frontage dan akses servis.
5. Pilih fungsi bangunan berdasarkan kebutuhan populasi dan ekonomi.
6. Buat BuildingBlueprint, household, workplace dan interaction anchors.
7. Validasi konektivitas, lalu bangun geometri dan dekorasi.

Medieval dapat memakai patch organik; modern memakai block/grid terarah; village mengikuti jalan; colony memakai modul layanan. Voronoi adalah pilihan lokal, bukan satu algoritma wajib untuk semua tempat.

Imersi berasal dari ritme: pasar membuka lapak, porter memindahkan kargo, pekerja menuju tempat kerja, kedai ramai sore, rumah menyala sesuai penghuni. Asset seperti jemuran, sampah atau peti mengikuti lokasi/pekerjaan, bukan disebar merata.

### Inside house

Input: BuildingBlueprint + household + fungsi + waktu lokal. Proses: kebutuhan ruang → adjacency → partition → portals/stairs → furnishing → interaction anchors → state restore → penghuni yang saat itu benar-benar berada di rumah.

MVP: pondok satu lantai, rumah dua lantai, rumah-toko. Berikutnya kedai dengan kamar inap, apartemen per unit, kantor. Tidak perlu membangun interior semua gedung saat town dimuat; generate ketika dibutuhkan dan cache blueprint terpisah dari scene.

Imersi: jumlah tempat tidur sesuai kapasitas household, barang pekerjaan, foto/simbol budaya, makanan/stok terkait kota, jendela dengan arah dunia yang benar, audio luar yang teredam saat masuk, serta kondisi lampu/barang yang bertahan setelah reload.

## 8. Membuat dunia hidup dengan biaya terukur

| Sistem | Bentuk MVP | Dampak yang harus terlihat |
|---|---|---|
| Household | Rumah + pekerjaan + anggota + jadwal fase hari | Pemain bisa mengikuti orang dari rumah ke tempat kerja dan pulang. |
| Ekonomi | Tiga komoditas: makanan, bahan, barang olahan | Pengiriman mengubah stock; port, pasar dan toko menunjukkan aktivitas terkait. |
| Event | Pemicu waktu/cuaca/stok, cooldown, syarat lokasi | Hujan mengurangi aktivitas luar; kedai ramai; kekurangan suplai membuka tugas. |
| Sejarah | Sedikit fakta seeded per settlement dan building | Nama, kondisi bangunan, barang dan cerita pendek konsisten. |
| Misi | Template dengan entityId dan prasyarat akses | Tujuan dapat dicapai, reward idempotent, quest selesai tetap selesai. |
| Audio/lighting | Berbasis ruang, occupancy dan fase hari | Tempat berbeda terasa berbeda tanpa harus menambah mesh besar. |

Jangan memulai dengan simulasi semua penduduk tiap frame. Mulai dengan satu distrik dan beberapa household bernama; crowd dekoratif tetap dapat dipakai, tetapi pisahkan dari NPC persisten dan jangan menjadikannya target quest.

## 9. Kaitan dengan project lokal lain

Selain project Watabou, project lokal berikut diperiksa untuk menemukan ide/pipeline yang relevan. Dokumen ini tidak menganggap mereka sudah berbagi universe atau schema.

| Project | Bukti lokal yang dibaca | Relasi yang dipilih |
|---|---|---|
| **globe** | Source empat level dan roadmap saat ini. | Pemilik implementasi utama. Semua tahapan dalam roadmap ditujukan ke repo ini. |
| **mass effect clone** — `../surprise project/mass-effect-game` | PRD, source inventory/state, surface engine, catatan living-world. | Referensi loop scan → resource → cargo → travel dan ambient per biome. Adaptasi ke shipment dan POI Globe; jangan salin katalog planet hardcoded sebagai generator universal. |
| **mass effect clone**, rencana NPC | `../surprise project/NPC_PLAN.md`. | State machine patrol/aggro/flee berguna kelak untuk encounter. NPC resident Globe membutuhkan home/work/schedule; bukan hanya enemy spawn. |
| **godot test** — `../godot-test` | README dan daftar roadmap/checkpoint. Isi aktualnya generator mobil Blender + viewer Three.js. | Referensi metadata aset, pivot/engsel, interior-eksterior dan validasi GLB. Bukan bukti adanya engine world building Godot. |

Rujukan lokal yang dapat dibuka:

- [Mass Effect PRD](</Users/mikelrisyad/Developer/surprise project/mass-effect-game/PRD.md>), [NPC plan](</Users/mikelrisyad/Developer/surprise project/NPC_PLAN.md>), [living-world pass](</Users/mikelrisyad/Developer/surprise project/mass-effect-game/artifacts/living-world/README.md>).
- [Asset showcase README](/Users/mikelrisyad/Developer/godot-test/README.md), [asset roadmap](/Users/mikelrisyad/Developer/godot-test/ASSET_ROADMAP.md).

Implementasi reusable sebaiknya dimulai sebagai modul data murni di Globe. Ekstrak menjadi package lintas repo hanya setelah ada dua pemakai nyata. Rencana multiplayer dari project lain tidak menjadi dependency fase awal Globe.

## 10. Rencana aset yang mengikuti sistem

Utamakan modular wall/door/window/stair/roof dan metadata socket/footprint, lalu room kits, baru variasi dekoratif. Satu rumah utuh GLB tanpa pintu/footprint metadata sulit dipakai untuk interior yang konsisten.

Metadata yang dibutuhkan: `assetId`, versi, ukuran meter, origin, front axis, footprint, portal sockets, collider sederhana, interaction anchors, LOD, material palette dan culture/style tags. Generator Blender harus mengekspor metadata bersama GLB. Tidak perlu semua collider memakai detail mesh visual.

Kelompok awal: bangunan satu/dua lantai, rumah-toko, pintu dan jendela modular, tangga lurus, kitchen/storage/sleep/work kits, lapak, peti kargo, gudang dan landmark port. Palace, kompleks dungeon, fauna luas dan fleet modular lengkap menyusul setelah alur antarskala terbukti.

## 11. Prosedur untuk agen implementasi berikutnya

1. Baca dokumen ini, [roadmap](WORLD_BUILDING_ROADMAP.md), lalu diff/source terbaru. Baseline riset bisa berubah; jangan menganggap checklist historis sebagai bukti implementasi.
2. Pilih satu milestone yang dependency-nya selesai. Definisikan input, output, ownership state dan acceptance test sebelum mengubah renderer.
3. Buat fixture seed dan snapshot data sebelum mengubah generator. Simpan kegagalan sebagai seed yang dapat direproduksi.
4. Validasi blueprint dengan graph/geometry checks; sesudah itu verifikasi visual di orbit, globe, town dan interior.
5. Catat migration, generator version, perilaku fallback dan performance yang benar-benar diukur.
6. Perbarui status roadmap hanya setelah bukti lolos. Jika mengadopsi API/export Watabou, verifikasi schema dan versi dengan fixture nyata lebih dulu.

**Prinsip kerja:** generate alasan suatu tempat ada → generate hubungan dan aksesnya → generate bentuk → generate aktivitas → tambahkan detail visual. Peta yang indah menjadi dunia yang imersif ketika pemain dapat mempelajari dan mempercayai hubungan tersebut.
