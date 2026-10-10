# Valley — rencana art, aset, dan animasi

Halaman terpisah `farm.html`: lembah pertanian kecil yang terinspirasi *Harvest Moon: Hero of Leaf Valley* (PSP, 2009). Fokusnya art direction, aset 3D, animasi, dan interaksi karakter dengan dunia, bukan sistem permainan. Teknik yang terbukti di sini kemudian dibawa ke Globe Universe (§8). Keputusan diambil dari sesi grill 9 Oktober 2026.

**Batas IP.** Yang ditiru adalah suasana dan teknik, bukan konten. Nama, karakter, logo, musik, dan aset Natsume/Marvelous tidak dipakai. Semua aset dibuat dari skrip di repo ini.

## 1. Keputusan

| Aspek | Keputusan |
|---|---|
| Wadah | `farm.html` berdiri sendiri seperti `skirmish.html`; memakai ulang `core/engine.js`, `core/quality.js`, `createToonMaterial` (`render/assetLibrary.js`), dan `art/palette.js`. Tanpa `Director`, `World`, atau save universe. |
| Proporsi karakter | Semi-chibi **4,5 kepala**. Nantinya menggantikan rig `chunkyPeople` di seluruh universe, termasuk skirmish (§8). |
| Shading | **Hybrid soft-toon + painted**: ramp toon 2 langkah dengan transisi lebar, normal halus, gradien vertex color dan AO yang di-bake, ditambah satu atlas goresan kuas 512 px. Tetap satu keluarga shading dengan kontrak [ART_DIRECTION.md](ART_DIRECTION.md). |
| Kamera | Perspektif 3/4 mengikuti pemain: FOV ~35°, pitch ~40°, yaw 4 snap 90° (Q/E). Aset tetap dimodel 360° supaya bisa dipakai di walk mode globe. Tidak butuh pointer lock. |
| Gameplay | **Interaksi tanpa sistem**: tanpa uang, stamina, inventori, atau save progres. Dunia harus bereaksi. |
| Animasi | **Hybrid**: lokomosi prosedural (turunan `peopleMotion`/`chunkyPeople`), aksi berupa klip keyframe yang ditulis skrip Python Blender, diekspor di GLB, dan di-blend lewat `AnimationMixer`. |
| Produksi aset | Skrip Blender (pola `tools/blender/build_*.py`) + atlas painterly prosedural + decal wajah yang bisa ditukar untuk ekspresi. |
| Layout | Satu lembah ~120×120 m disusun tangan di JSON dari kit modular. Vegetasi, batu, dan bunga di-scatter prosedural dengan seed dan aturan. |
| Prinsip situs | **Situs dulu**: terrain diratakan untuk kit, bukan kit mengikuti terrain. Fitur hanya muncul kalau skor situs lolos (§6). |
| Waktu | Siklus pagi/siang/sore/malam real-time + toggle 4 musim lewat token palet, bukan model terpisah. |
| Target | Laptop desktop di Chrome, 60 fps, memakai tier `core/quality.js`. Mobile menyusul. |

## 2. Art direction

### 2.1 Pilar

1. **Siluet membulat dan terbaca.** Tidak ada sudut tajam di objek alami. Atap, kanopi, dan batu terdiri dari massa besar yang empuk. Detail kecil boleh hilang, siluet tidak.
2. **Hangat dan jenuh di tengah, tenang di permukaan luas.** Rumput dan tanah memakai hue menengah dengan saturasi sedang. Warna jenuh disimpan untuk atap, bunga, pakaian, dan ikon interaksi.
3. **Cahaya dicat, bayangan diwarnai.** Bayangan bergeser ke ungu/biru, tidak menghitam. AO di-bake ke vertex color di setiap sambungan (kaki dinding, pangkal pohon, bawah atap).
4. **Padat dan dekat.** Lembah kecil dengan kerapatan objek tinggi. Tidak ada lapangan kosong lebih dari ~8 m tanpa elemen (pagar, petak bunga, tumpukan kayu, batu).
5. **Semua bergerak sedikit.** Rumput, daun, air, asap cerobong, kain jemuran, ekor hewan. Tidak ada frame yang benar-benar diam.

### 2.2 Palet

- Token baru di `art/palette.js` (`VALLEY_PALETTE`), dibaca skrip Blender lewat JSON yang diekspor dari modul yang sama. Ini melanjutkan sisa AD-1: generator Blender membaca palet yang sama.
- Setiap token punya 4 nilai musim × 2 nilai waktu (siang/malam). Jam lain diinterpolasi.
- Hierarki saturasi: permukaan luas (rumput, tanah, dinding) ≤ 45%, aksen (atap, bunga, pakaian) 55–75%, interaksi/UI ≥ 80%.

### 2.3 Shading

- `createValleyMaterial()` dibangun di atas `createToonMaterial` dengan ramp 2 langkah dan lebar transisi ~0,35, warna bayangan dari token (bukan hitam), rim light lembut dari langit, serta modulasi atlas goresan kuas di world-space supaya tidak terlihat seam.
- Atribut per-vertex: `color` (albedo + gradien), `ao` (bake), `wind` (bobot goyang 0–1), `snow` (mask permukaan menghadap atas untuk musim dingin).
- Outline tipis hanya pada karakter dan hewan (inverted hull, ketebalan konstan di layar). Lingkungan tanpa outline.
- Post: bloom lembut, color grading per jam lewat LUT kecil, vignette tipis. Tanpa SSAO.

## 3. Daftar aset

Budget mengacu ke target laptop 60 fps: total scene < 300k tris, < 80 draw call (instancing untuk semua yang berulang).

| Kelompok | Isi slice | Teknik kunci | Budget |
|---|---|---|---|
| **Karakter** | 1 pemain + 3 NPC (penjual, anak, kakek) dari satu body 4,5 kepala, dengan pakaian dan rambut sebagai part terpisah | Kepala ~30% tinggi, mata decal (4 ekspresi × kedip), rambut dari 3–5 massa besar, tangan mitten + jempol | ~4k tris, 1 material, 1 atlas 256 px |
| **Hewan** | Ayam, sapi, anjing | Rig sederhana (6–10 tulang), proporsi chibi, outline | 1–2k tris |
| **Pohon** | Ek bulat, cemara, apel (berbuah), sakura (musim semi) | Kanopi dari 3–6 gumpalan icosphere yang di-displace; normal ditransfer dari bola besar supaya shading empuk; bobot `wind` di ujung | 1,5–3k tris, 3 LOD + impostor |
| **Vegetasi** | Rumput tuft, semak, bunga (3 jenis), tanaman ladang (3 tahap visual) | Rumput: kartu instanced dengan normal mengikuti tanah dan warna dari splat di bawahnya (pelajaran dari `groundCover.js`) | Rumput instanced; densitas per tier |
| **Rumah** | Rumah pemain, kandang, lumbung, toko, 2 rumah warga | Kit modular: dinding papan/plester, atap jerami/sirap tebal yang menjorok, cerobong, jendela kotak-kotak, pot bunga | 2–4k tris per bangunan |
| **Path & tanah** | Jalan tanah, batu pijakan, jalan kerikil, tepi ladang | §5.1 | 1 splat 2048 px |
| **Air** | Sungai kecil + kolam | Shader dengan pinggir busa, ripple dari karakter, gradien kedalaman dari token | 1 mesh |
| **Props** | Pagar kayu, shipping bin, sumur, tumpukan kayu, batu besar/kecil, kotak, jemuran, kotak surat, papan tanda, alat (cangkul, gembor) | Semua bisa diangkat atau bereaksi kecuali yang ditandai statis | < 800 tris |
| **Langit** | Gradien + awan billboard yang bergerak + matahari/bulan | Token per jam dan musim | — |

Skrip: `tools/blender/valley/build_valley_kit.py` (lingkungan, sudah ada sejak V0) dan `build_valley_actors.py` (karakter, hewan, klip; V1). Output `public/models/valley_*.glb`, terdaftar di `src/render/assetManifest.js`. QA mengikuti pola `tools/blender/town/audit_cozy_actors.py` (validasi glTF, jumlah tris, material, nama tulang).

## 4. Animasi

### 4.1 Rig

- Nama tulang memakai set `chunkyPeople` (`hips, spine, chest, neck, head`, lengan, kaki) supaya `peopleMotion` dan look-at bisa dipakai ulang. Tambahan: `hand.L/R.prop` (soket alat), `head.carry` (soket angkat).
- Wajah memakai decal UV-offset, bukan tulang: mata (buka, kedip, senang `^ ^`, kaget), mulut (diam, bicara A/O, senyum).

### 4.2 Prosedural (kode)

- Idle bernapas, jalan, lari, berhenti dengan sedikit overshoot. Chibi butuh langkah lebih pendek, bob lebih besar, dan ayunan kepala yang tertinggal.
- Kaki menapak tanah (IK 2 tulang ke `heightAt`), condong saat berbelok, kepala menoleh ke objek yang bisa diinteraksi dalam radius 3 m.
- Rambut dan kain sekunder lewat spring sederhana pada 1–2 tulang.

### 4.3 Klip keyframe (Blender)

| Klip | Panjang | Event frame |
|---|---|---|
| `hoe` | 0,9 s | `impact` → tanah jadi bedengan, debu |
| `water` | 1,2 s loop | `pour` → tanah basah, partikel air |
| `plant` | 0,8 s | `drop` → biji |
| `harvest` | 0,7 s | `pull` → tanaman lepas ke `head.carry` |
| `lift` / `carry_idle` / `carry_walk` (overlay lengan) / `throw` | 0,5 / loop / loop / 0,6 s | `grab`, `release` |
| `pet` | 1,0 s | `touch` → hewan senang |
| `shake_tree` | 0,8 s | `hit` → pohon berguncang, buah jatuh |
| `talk` | loop | — (mulut dari decal) |
| `happy`, `surprised`, `tired` | 0,6–1,2 s | — |

Klip berlaku di tubuh atas dengan mask (kecuali `hoe`/`throw`, yang seluruh tubuh dengan kaki dikunci), lalu di-blend 0,15 s di atas lokomosi. Event frame menggerakkan reaksi dunia, jadi timing visual dan efeknya tidak bisa melenceng.

Hewan memakai klip pendek seperti makan, menoleh, kabur, senang (melompat kecil), dan tidur.

## 5. Interaksi dan reaksi dunia

### 5.1 Tanah: cangkul dan basah

- Splat map 2048 px untuk 120 m (≈6 cm/texel) dengan kanal rumput/tanah/jalan/ladang. Tepinya tidak rata (noise + lobus, pola `gardenEdges` di `groundPaint.js`) dan dihiasi tuft rumput dan kerikil hasil scatter.
- Grid ladang 0,5 m. Mencangkul menulis kanal `tilled` (normal map alur bedengan) dan sedikit menaikkan mesh petak. Menyiram menulis kanal `wet`: albedo lebih gelap dan specular kecil, lalu kering perlahan (~2 menit real-time) lewat pass decay di GPU.
- Jejak kaki samar di tanah basah dan jalan tanah, memudar.

### 5.2 Vegetasi bereaksi

- Shader rumput, bunga, dan tanaman menerima hingga 8 "pendorong" (karakter, hewan, objek yang dilempar) sebagai uniform. Kartu melengkung menjauh lalu kembali dengan pegas.
- Semak bergoyang saat ditabrak. Pohon berguncang dengan klip `shake_tree` dan dari tabrakan; daun beterbangan dan buah jatuh (pohon apel).
- Angin global dengan hembusan yang bergerak melintasi lembah (noise world-space), memakai bobot `wind`.

### 5.3 Angkat dan lempar

- Objek bertanda `liftable` (batu kecil, kayu, kotak, hasil panen, ayam) diangkat ke `head.carry` ala HM. Saat membawa, lokomosi melambat dan lengan memakai overlay `carry_*`.
- Lemparan mengikuti busur balistik sederhana (bukan physics engine), lalu memantul 1–2 kali dengan debu. Ayam mengepak dan mendarat sendiri.
- Hasil panen yang dilempar ke shipping bin menghasilkan efek kilau, tanpa uang.

### 5.4 Hewan dan NPC

- **Ayam**: berkeliaran dan mematuk. Kabur kalau pemain berlari mendekat, mendekat kalau pemain diam membawa benih.
- **Sapi**: menoleh ke pemain. `pet` memunculkan ikon hati dan ekor bergoyang.
- **Anjing**: mengikuti pemain dan menggonggong ke ayam.
- **NPC**: rutinitas berdasarkan jam (buka toko, menyapu, duduk di bangku, pulang malam). Saat didekati, NPC menoleh, berhenti, dan menampilkan balon dialog pendek yang berubah per jam dan musim. Ekspresi memakai decal.
- Semua reaksi memakai ikon di atas kepala (hati, tanda seru, not musik, zzz) bergaya painted, sebagai bahasa umpan balik yang konsisten.

## 6. Layout lembah dan prinsip situs dulu

Isi lembah: rumah pemain, ladang 8×6 petak, kandang ayam, kandang sapi, sumur, sungai dengan satu jembatan, jalan ke alun-alun mini (toko, 2 rumah warga, bangku, pohon besar), tepi hutan, dan bukit di belakang.

`src/valley/world/layout.json` berisi kit, posisi, rotasi, jalur, zona scatter, dan ladang. Loader menerapkan aturan berikut, yang juga akan menjadi aturan generator town (§8):

1. **Terrain mengikuti kit.** Setiap footprint bangunan, ladang, dan plaza diratakan ke satu tinggi dengan tepi miring yang dihaluskan (*pad*) sebelum mesh terrain dibuat. Tidak ada bangunan yang mengambang atau tenggelam.
2. **Jembatan adalah prefab.** Panjangnya 6, 9, atau 12 m. Jembatan hanya ditempatkan di ruas sungai yang lurus dan cukup sempit, tegak lurus arus (±10°). Kedua abutment diratakan ke **tinggi yang sama**, dan jalan menyesuaikan ke abutment. Ini kebalikan dari `townBuilder.js:498-521` sekarang, yang memakai tinggi tebing apa adanya (`hA` ≠ `hB`) dan sudut jalan apa adanya.
3. **Fitur bersyarat.** Plaza, pasar, taman, dan dermaga punya skor situs (kerataan, akses jalan, jarak ke air/pusat). Fitur hanya dibuat kalau skornya lolos. Tidak ada fitur wajib di tengah.
4. **Scatter beraturan.** Bunga dan tuft di tepi jalan dan pagar, batu di tepi air dan kaki bukit, semak di sudut bangunan. Tidak ada scatter acak merata.

## 7. Milestone

| ID | Isi | Verifikasi |
|---|---|---|
| **V0** look-dev | `farm.html` + entry Vite, kamera 3/4, terrain dari layout, `createValleyMaterial`, 1 pohon + 1 rumah + rumput + path. Bandingkan pagi/siang/sore/malam. | Screenshot 4 jam × 2 yaw di `docs/qa/valley/`; persetujuan look oleh pemilik proyek sebelum lanjut. |
| **V1** karakter | Body 4,5 kepala, decal wajah, 1 pemain + 3 NPC, lokomosi prosedural, outline. | Turnaround 4 arah; audit rig (nama tulang = set chunkyPeople); 60 fps dengan 10 karakter. |
| **V2** kit lingkungan | Semua pohon, vegetasi, rumah, props, air, langit; scatter beraturan; aturan situs 1–4; LOD. | Audit tris/draw call; uji jembatan: kedua ujung dek setinggi abutment (selisih < 2 cm), sudut terhadap arus ≤ 10°. |
| **V3** klip dan interaksi | Semua klip §4.3, event frame, tanah cangkul/basah, angkat-lempar. | `node --test` untuk grid ladang, busur lempar, dan decay basah; GIF tiap interaksi. |
| **V4** dunia hidup | Vegetasi bereaksi, angin, hewan, rutinitas dan dialog NPC, ikon reaksi. | Sesi 10 menit tanpa `engine.lastError`; GIF ayam kabur, sapi dielus, NPC menoleh. |
| **V5** musim | Token 4 musim, mask salju, varian bunga/daun/tanaman, toggle. | Grid screenshot 4 musim × 2 jam. |

### Status V0 (9 Oktober 2026)

Sudah dibangun dan menunggu persetujuan look:
- `farm.html` + `src/valley/`: `ValleyLookDev.js`, material soft-toon (`render/valleyMaterial.js`), langit dan cahaya per jam (`render/valleySky.js`), height field dengan pad (`world/valleyGround.js`), tanah yang dicat (`world/terrain.js`), rumput dan bunga beraturan (`world/grass.js`), loader kit (`world/kit.js`), figur skala 4,5 kepala (`world/scaleFigure.js`). Palet tunggal di `src/valley/valleyPalette.json`, dibaca juga oleh skrip Blender.
- Kit: oak, semak, rumah pemain (atap jerami berjenjang), pagar, 2 batu, batu pijakan. Rumah 4,7k segitiga, di atas target awal 2–4k. Budget di test sementara dilonggarkan ke 5k.
- QA: `tools/qa/valley_lookdev.mjs` menghasilkan 11 screenshot di `docs/qa/valley/` (4 waktu × 2 yaw + rumah, ladang, wide). Scene: 66 draw call, 226k segitiga termasuk shadow pass, tanpa error. `tests/valley-ground.test.js` menguji pad rata (< 1 cm), referensi layout, dan budget kit.
- Belum: FPS dan GPU ms belum diukur; air masih bidang datar tanpa busa tepi; kanopi masih sedikit poligonal dari jarak dekat.

### Status V1 (9 Oktober 2026)

- **Kamera** (`render/valleyCamera.js`), atas permintaan pemilik proyek: drag kiri untuk orbit bebas (pitch 18–74°), drag kanan/tengah atau Shift + drag untuk geser, scroll/pinch untuk zoom, Q/E snap 90°, F untuk kembali ke pemain. Geseran kembali sendiri saat pemain berjalan. Gerakan WASD mengikuti arah kamera. Ini menggantikan keputusan "yaw 4 snap" di §1.
- **Karakter** (`tools/blender/valley/build_valley_actors.py` → `public/models/valley_actors.glb`): empat arketipe (player, seller, child, elder), 1,35 m, 4,5 kepala, 2,8–3,5k segitiga. Hierarki pivot dan nama tulangnya sama dengan `npc.glb`, sehingga `buildTemplate`/`animateNpc` town (gait, lirikan, kedip) dipakai langsung. `chunkyPeople.js` mendapat dua opsi opt-in: `buildTemplate(gltf, { measureLegs })` mengukur kaki dari pivot, dan `makeNpc(t, { gradientMap, pixels })` untuk ramp lembut tanpa noise piksel. Default town tidak berubah, dan ada tesnya.
- **Wajah**: tidak memakai decal UV seperti rencana §4.1, tapi sistem ekspresi town (`expr_<fitur>_<varian>`, satu varian per fitur digambar), dengan mata besar ber-highlight, alis, mulut, dan blush. Hasilnya sama-sama bisa ditukar per ekspresi, dan langsung kompatibel dengan G5.
- **Outline** tinta inverted hull (`world/actors.js`), mengikuti skeleton dan pieces yang disembunyikan.
- **Penduduk V1** (`world/villagers.js`): penjual diam di gerbang ladang, kakek bolak-balik di jalan, anak berlari mengitari pohon. `?crowd=N` menambah penduduk acak.
- **QA**: turnaround depan/samping/belakang, 4 ekspresi, pose jalan dan lari (input keyboard sungguhan), drag orbit/pan/zoom (input mouse sungguhan). 10 karakter: 59,6 fps, GPU 6,7–7,1 ms (timer query, M1 Pro headless; nilai atas karena GPU bisa turun clock), 67 draw call, 314k segitiga termasuk shadow pass. Tes: `tests/valley-actors.test.js`.
- **Belum**: klip aksi (V3), NPC menoleh/bicara ke pemain (V4), lengan istirahat masih lurus ke bawah.

### Status V2 (9 Oktober 2026)

- **Kit** (34 aset, `public/models/valley_kit.glb`, 3,2 MB): pohon ek, apel (berbuah), sakura, cemara, masing-masing dengan versi `_far`; semak dan semak berbunga; rumah pemain, 2 rumah warga (atap sirap merah/biru), toko (atap hijau, kanopi bergaris, papan nama), kandang sapi (dinding papan, pintu X, loteng jerami), kandang ayam; tanaman 3 tahap; shipping bin, sumur, tumpukan kayu, peti, tong, papan arah, kotak surat, bangku; jembatan 6/9/12 m; pagar, batu, batu pijakan. Rumah dibangun dari satu generator `cottage(...)` berparameter.
- **Rule 2 jembatan** (`planBridge` di `world/valleyGround.js`): mencari ruas sungai paling lurus dalam 12 m dari titik silang jalan, memasang bentang terpendek yang cukup (`bridges.json`) tegak lurus arus, meratakan kedua abutment ke satu tinggi, lalu merutekan ulang jalan lewat dek. Kurva dek yang sama dipakai Blender (model) dan game (`surfaceAt`, jalan di atas dek). Hasil: 9 m, lengkung ruas 0,0°, kedua abutment −0,050 m.
- **Rule 3 fitur bersyarat**: alun-alun 24×18 m dinilai di 3 kandidat (rata 0,5, akses 0,3, jauh dari air 0,2). Hanya kandidat terbaik dengan skor ≥ 0,6 yang dipakai: (−1, 27) dengan skor 0,71; dua kandidat lain 0,47 dan 0,54. Kalau tidak ada yang lolos, alun-alun tidak dibuat dan tanahnya tidak diratakan (ada tesnya). Jalur cabang ke jalan terdekat dibuat otomatis.
- **Rule 4 scatter** (`world/scatter.js`): cincin hutan (cemara di lereng, ek di bawah, jarak ≥ 4,5 m), batu di tepi sungai dan kaki bukit, semak di dua sudut tiap bangunan (tidak di depan pintu). Semuanya menghindari jalan, pad, dan dek.
- **Air** (`world/water.js`): mesh hanya di sel yang tergenang. Kedalaman dibaca dari tekstur height field, sehingga busa mengikuti kontur halus, dengan riak dan gradasi ke biru tua. **Awan** fbm di kubah langit, warnanya mengikuti jam.
- **Performa**: props statis digabung jadi satu mesh per material (`mergeKit`), dan pohon memakai LOD dekat/jauh (26 m, pohon jauh tanpa bayangan). Pemandangan normal: 49–55 draw call. Dengan 10 karakter: 67 draw call, 60 fps, GPU 6,4 ms. Segitiga: sekitar 290k di pass scene, sekitar 370–440k termasuk shadow pass. Target 300k dari §3 hanya tercapai untuk pass scene.
- **Tes**: rule 2 (abutment setara, dek rata dengan abutment < 2 cm, sudut ≤ 10°, jalan tersambung ke dek), rule 3 (memilih kandidat terbaik, dilewati kalau tidak lolos), rule 4 (tidak di jalan/pad, jarak pohon, batu tepi sungai), dan budget kit.
- **Belum**: siluet tepi tanah di garis air masih mengikuti grid 1 m (perlu terrain adaptif di dekat air); generator town globe belum memakai aturan ini (G2).

### Status V3 (9 Oktober 2026)

- **Kontrol**: 1–3 memilih alat (cangkul, gembor, benih), Spasi memakai alat di petak depan, E untuk aksi kontekstual (angkat, lempar, panen, goyang pohon/semak), Z/C putar 90° (Q/E dipindah karena E sekarang interaksi), T ganti waktu. HUD menampilkan alat aktif dan apa yang akan dilakukan E.
- **Klip** (`src/valley/anim/clips.js`): hoe, water, plant, harvest, lift, carry (overlay lengan), throw, shake, pet, happy, surprised, tired, masing-masing dengan event frame. **Berbeda dari §4.3**: keyframe ditulis sebagai data di kode, bukan skrip Blender. Tulang rig dibuat saat runtime dari pivot, dan pose klip memakai Euler yang sama dengan gait prosedural, jadi klip langsung di-blend di atas jalan. Ekspor action multi-objek di Blender 5 (slotted actions) rapuh untuk kasus ini. Data di kode bisa dites dan di-review.
- **Ladang** (`world/fieldState.js`, `world/fieldView.js`): petak 0,75 m. Petak yang dicangkul jadi gundukan tanah, petak yang disiram gelap lalu kering dalam 120 detik, dan benih hanya bisa ditanam di tanah tergarap. Lobak matang bisa dipanen dan langsung dibawa. Kursor menandai petak di depan pemain.
- **Barang** (`world/pickups.js`): batu, kayu, apel, dan lobak diangkat ke atas kepala lalu dilempar dalam lintasan balistik, memantul dengan debu. Barang yang masuk shipping bin memunculkan kilau dan ikut terhitung. Barang yang jatuh ke sungai menimbulkan cipratan lalu tenggelam.
- **Reaksi**: rumput, bunga, dan tanaman tersibak oleh kaki pemain dan penduduk serta barang yang terbang (`uPushers`). Pohon dan semak bergoyang lalu tenang kembali. Daun (atau kelopak sakura) berguguran, dan pohon apel menjatuhkan apel. Partikel debu, tetes air, cipratan, daun, dan kilau (`world/effects.js`).
- **QA** (`tools/qa/valley_actions.mjs`): delapan aksi dijalankan dengan tombol sungguhan dan dicek terhadap state dunia (tergarap, basah > 0,9, ada tanaman, membawa lobak, terkirim 1, membawa batu, batu mendarat, apel jatuh). Masing-masing direkam sebagai GIF di `docs/qa/valley/actions/`. Jam game dijeda dan dimajukan manual selama perekaman. Tes: `tests/valley-actions.test.js` (grid, aturan ladang, proses kering, busur lempar terhadap rumus analitik, event klip, aturan kunci gerak).
- **Performa**: 10 karakter, 60 fps, GPU 6,9 ms. Draw call naik ke sekitar 90 (target 80) karena barang (satu mesh per barang), semak yang bisa digoyang, dan ladang.
- **Belum**: jejak kaki (§5.1) belum ada; menaruh barang tanpa melempar belum ada; NPC dan hewan bereaksi masuk V4.

### Status V4 (9 Oktober 2026)

- **Hewan** (`tools/blender/valley/build_valley_animals.py` → `public/models/valley_animals.glb`; `world/animals.js`): ayam (494 segitiga), sapi (1,3k), anjing (668), masing-masing 9 tulang dari pivot. Part kaku digabung jadi satu mesh ber-skin per hewan, ditambah outline tinta. Pose prosedural: langkah, mematuk/merumput, kepak sayap, kibas ekor, menoleh, lompat senang, tidur.
  - Ayam: berkeliaran di dekat kandang, kabur (ikon !) dari pemain yang berlari, mendekat (ikon not) ke pemain yang diam memegang benih, bisa diangkat dan dilempar (mengepak saat terbang lalu lari).
  - Sapi: merumput di depan kandang dan menoleh mengikuti pemain. Saat dielus muncul ikon hati, ekornya bergoyang, dan kepalanya menyundul.
  - Anjing: mengikuti pemain (lari untuk menyusul, trot di samping), duduk di dekat pemain, menggonggong dan mengusir ayam, senang saat dielus.
  - Malam: semuanya pulang dan tidur (ikon zzz).
- **Penduduk** (`world/villagers.js`, `world/nav.js`): rutinitas untuk 4 waktu, dengan rute lewat graf jaringan jalan (Dijkstra). Mereka berdiri di depan toko, gerbang ladang, atau ujung jembatan, duduk di bangku (klip `sit`), berjalan di lingkar jalan, berlari mengitari pohon, berkeliaran di dekat kandang ayam atau sumur, dan pulang (tidak terlihat) di malam hari. Dalam 2,3 m mereka berhenti, berbalik, menatap pemain, dan menyapa lewat balon dialog. E untuk mengobrol (baris per waktu, klip `talk`, wajah tertawa). Nama: Bu Sari (penjual), Kakek Darma, dan Tia.
- **Ikon reaksi** (`world/icons.js`): hati, !, not, zzz, dan titik-titik, digambar di kanvas dengan gelembung krem dan pinggiran tinta. Ikon muncul memantul, melayang, lalu memudar.
- **Kamera**: tidak lagi menembus bangunan. Kamera menelusuri garis fokus→kamera, berhenti di depan volume bangunan (footprint × tinggi bubungan), lalu mundur kembali dengan halus.
- **QA** (`tools/qa/valley_life.mjs`, GIF di `docs/qa/valley/life/`): ayam kabur, ayam mendekat ke benih (0,89 m), ayam diangkat dan dilempar, sapi dielus, anjing mengikuti (2,4 m), NPC menyapa, mengobrol, rutinitas 4 waktu (semua sampai, malam semua pulang), dan **sesi 10 menit waktu game** (pemain berkeliling dan beraksi, jam berganti tiap 2,5 menit): tanpa `lastError`, update terburuk 0,4 ms. Tes: `tests/valley-life.test.js` (rute mengikuti jalan, setiap rutinitas punya tempat dan dialog, template hewan dan budget).
- **Performa**: 10 orang + 5 hewan, 60 fps, GPU 7,6 ms. Draw call sekitar 106, di atas target 80. Yang bisa dioptimasi berikutnya: outline per karakter dan hewan (+1 call masing-masing), barang, dan semak.
- **Belum**: dialog bergantung musim (V5), ekspresi NPC saat mendengar (selain tertawa), suara.

### Fine-tune tampilan ala HoLV (9 Oktober 2026)

Teknik visual HoLV (PSP) ditiru dari pengetahuan umum tentang tampilannya. Tidak ada aset, tekstur, atau data game asli yang diekstrak.
- **Shading karakter dicat**: AO di-bake Cycles ke COLOR_0 (bawah dagu, ketiak, lipatan) dengan warna gelap ungu hangat. Baju menggelap ke arah keliman, dan rambut punya pita kilau ("angel ring"). `buildTemplate(gltf, { vertexShade })` mengalikan warna palet dengan COLOR_0. Opsinya opt-in, jadi town dan skirmish tidak berubah (`npc.glb` memang tidak punya COLOR_0).
- **Mata**: mata gelap besar dengan iris hangat di separuh bawah, kilau besar di atas dan kilau kecil di bawah, serta bulu mata atas yang lembut.
- **Hewan**: AO dan gradien, mata berkilau, pipi merona (ayam, anjing), badan lebih halus (ayam 1,2k, sapi 1,7k, anjing 1,3k segitiga).
- **Outline berwarna** (warna lokal × gelap) dan lebih tipis (8,5–9 mm), tidak lagi tinta cokelat seragam.
- **Pinggiran daun**: kartu daun bersilang berdiri keluar dari kanopi dan semak (tekstur daun prosedural, alpha tanpa tepi gelap), memakai warna dan normal kanopi. Kartu tidak membuat bayangan.
- **Blob shadow** lembut di bawah orang, hewan, dan barang. **AO tanah** dicat di pangkal pohon, semak, batu, dan bangunan.
- **Cahaya**: ambient lebih terang, bayangan lebih lembut (0,5), bloom sedikit lebih kuat, saturasi 1,1. **Kilau** di air.

### Status V5 musim (9 Oktober 2026)

- **4 musim** (Semi, Panas, Gugur, Dingin) hanya lewat token palet (`valleyPalette.json` → `seasons`). Tombol di panel atau Y, dan `?season=`.
- Tanah dicat ulang dengan warna rumput, bukit, dan jalan musim itu. Tuft rumput mengambil warna baru, dan porsi serta warna bunga berubah (100%, 70%, 30%, 0%). Tinggi rumput (1; 1,12; 0,85; 0,45).
- **Daun** di shader (`foliage`): warna musim dengan terang-gelap yang tetap dipertahankan. Sakura merah muda hanya di musim semi, buah apel tidak ikut berubah.
- **Salju** di shader: semua permukaan menghadap atas memutih dalam bentuk timbunan yang dipecah oleh goresan kuas, dengan warna salju kebiruan. Karakter, hewan, partikel, dan air tidak terkena.
- **Langit dan kabut** diberi tint per musim. **Partikel suasana**: kelopak (semi), kunang-kunang di malam musim panas, daun gugur, dan salju turun.
- **Dialog**: satu baris tambahan per musim untuk tiap NPC.
- **QA** `tools/qa/valley_seasons.mjs`: 4 musim × 2 waktu × 2 sudut, ditambah malam dingin dan malam panas, dan lembar perbandingan `docs/qa/valley/seasons/sheet.jpg`. Tanpa error shader maupun `lastError`. Tes: `tests/valley-seasons.test.js`.
- **Performa** setelah fine-tune dan V5: 10 karakter + 5 hewan, 60 fps, GPU 5,8–9,7 ms (bervariasi antar run karena clock GPU). Draw call sekitar 112, di atas target 80; optimasi draw call masih menjadi pekerjaan terbuka sebelum port.
- **Belum**: tanaman per musim, air membeku di musim dingin, transisi musim bertahap (sekarang langsung).

### Penyesuaian ke sheet referensi (10 Oktober 2026)

Pemain mengikuti turnaround "Farmer" milik pemilik proyek. Screenshot HoLV hanya dipakai sebagai acuan gaya; desain tokoh HoLV tidak disalin.
- **Pemain** (6,4k segitiga): topi 6 panel dengan lidah kuning pendek melengkung, emblem daun, tali belakang, dan jambul kecil. Kepala elips lebih lebar, mata lebih rendah dengan iris besar, pupil, dan dua kilau. Rambut runcing berlapis lebih tebal. Kaos tanpa lengan, overall dengan saku, pengait kuningan, dan tali silang X. Sabuk, tas kanvas, sarung tangan berjari dengan manset merah, bot kulit bertali. Proporsi anak dengan lengan sampai paha. Pola kain di shader (twill denim, serat katun, bintik kulit). Lembar perbandingan: `tools/qa/valley_turnaround.mjs` → `docs/qa/valley/turnaround/`.
- **Rumah pemain** mengikuti sheet arsitektur (6,8k): kabin papan horizontal di atas alas batu, atap genteng oranye berselang, gable krem dengan rangka kayu, teras beratap dengan pagar, tangga, dan lentera. `cottage(..., boards, porch)` dan atap `shingle` bisa dipakai bangunan lain.
- **Alat** mengikuti sheet props: cangkul dengan bilah baja di soket, gembor biru dengan pegangan melengkung dan rose, karung benih goni dengan tali dan gambar tunas. **Props baru**: ember kayu, milk pail, hay bale, gerobak (di kandang sapi, sumur, dan dekat ladang).
- **Belum**: sheet interior dan vegetasi (pakis, ilalang, tunggul, kayu tumbang, batu berlumut) belum dibuat; rumah warga dan kandang belum diubah ke gaya kabin papan; draw call masih sekitar 112.

## 8. Membawa ke Globe Universe

Urutan berdasarkan masalah yang dilaporkan: dunia diam, ruang kosong, karakter tanpa ekspresi, warna dan cahaya datar, dan layout yang dipaksakan (plaza wajib, jembatan miring).

| ID | Port | Menyentuh |
|---|---|---|
| **G1** shading dan palet | `createValleyMaterial` menggantikan ramp 3 langkah di town dan home; token musim dan jam di `palette.js` dipakai per biome planet. Ini menutup sisa AD-1 dan AD-2 (eksposur pucat). | `render/assetLibrary.js`, `art/palette.js`, `modes/town/render/*` |
| **G2** situs dulu | Aturan §6 di generator town: pad bangunan, jembatan prefab dengan abutment setara, plaza dan pasar bersyarat skor situs. Perlu `layoutVersion` naik + migrasi karena dunia tersimpan memakai layout lama. | `modes/town/layout/*`, `townBuilder.js` (`bridgeHeight`, perhitungan `hA`/`hB`) |
| **G3** dunia bereaksi | Shader pendorong rumput, angin, pohon berguncang, jejak dan debu di walk mode. | `groundCover.js`, `environmentKit.js`, `farTrees.js` |
| **G4** ruang terisi | Aturan scatter beraturan + props valley (pagar, petak bunga, tumpukan kayu, kebun kecil) di lot dan alun-alun. | `townGreenery.js`, `vegetation.js`, `fieldEdges.js` |
| **G5** satu rig | Body 4,5 kepala menggantikan `chunkyPeople` di town, home, dan skirmish; decal ekspresi; NPC menoleh dan bicara. Cek skala pintu (`doorClearance.js`), kursi, kendaraan, dan 9 hero skirmish. | `modes/town/people/*`, `skirmish/units/*` |
| **G6** musim di planet | Musim berjalan di level planet dan diwariskan ke town. | `planetRenderer.js`, `modes/town` |

## 9. Risiko

| Risiko | Mitigasi |
|---|---|
| Klip keyframe dari skrip Python terasa kaku | Pose kunci sedikit dengan overshoot dan follow-through yang dihitung skrip; review GIF di V3 sebelum menambah klip. |
| Chibi 4,5 kepala terlihat aneh di kota skala meter | Uji di V1: tempatkan karakter di samping rumah town sekarang. Kalau gagal, skala props town disesuaikan di G5, bukan karakternya. |
| Splat runtime 2048 px terlalu mahal di tier rendah | Tier rendah: 1024 px dan decay di CPU per petak. |
| Mengganti rig skirmish merusak 9 hero yang sudah jadi | G5 terakhir; skirmish dimigrasi di belakang flag sampai visual parity disetujui. |
| Dunia tersimpan rusak setelah G2 | Bump `layoutVersion` + migrasi (lihat memori proyek). |
