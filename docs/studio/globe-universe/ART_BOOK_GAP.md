# Art book — gap dunia hidup dan peta implementasi

**Task M1-A1 · kajian 10 Oktober 2026 · untuk globe-lead.** Mandat: [STUDIO, Fase 2](STUDIO.md#fase-2--keputusan-pengguna-10-oktober-2026-setelah-checkpoint-1). Dokumen ini menyusun spesifikasi untuk dipertimbangkan lead; tidak mengubah source, aset, sprint, board, atau status milestone.

## 1. Kesimpulan dan batas bukti

Sprint sudah memberi fondasi painted 3D yang kuat: lima keluarga visual, proporsi dewasa, bahasa material, skala relatif, gestur, dressing, dan variasi cahaya/musim. Agar dunia terasa hidup, art book perlu menjelaskan **apa yang bergerak, pemicunya, kapan bereaksi, kapan berhenti, serta bagaimana perilaku itu bertahan saat detail diturunkan**. Jumlah gambar selesai tidak menjawab kontrak tersebut.

Prioritas untuk slice ialah tempat tujuan yang mudah dikenali, akses rumah yang jelas, satu warga dengan aktivitas bermakna, satu reaksi terhadap pemain, dan perubahan rumah yang masih terlihat setelah kembali. Animasi seluruh kota, kalender penuh, koloni, dan seluruh roster baru tidak perlu menjadi syarat M2. Implementasi dunia hidup M3 tetap menunggu M2 dan selesainya sprint sesuai mandat lead.

| Jenis bukti | Yang dikaji | Batas kesimpulan |
|---|---|---|
| **Fakta source/artifact** | Dokumen worktree, source terarah Town/Valley/Skirmish/render/audio, manifest sprint, prompt, delapan PNG yang dilihat langsung. | Membuktikan kontrak kode dan isi artefak; tidak membuktikan gerak, performa, atau kenyamanan bermain pada build berjalan. |
| **QA historis** | Bukti yang dirangkum [review ST-02](DESIGN_ART_REVIEW.md), log Valley 9–10 Oktober dalam [FARM_PLAN](../../FARM_PLAN.md), baseline M0 yang dicatat lead. | Capture September dan QA Oktober memakai tanggal/fixture berbeda. Diagnosis ART_DIRECTION 29 September bukan daftar cacat visual terkini. Hasil Valley/M1 Pro bukan sertifikasi iGPU minimum. |
| **Runtime/playtest baru** | Tidak dilakukan dalam M1-A1. | Tidak ada klaim slice, retarget, cuaca, audio, atau Hemat sudah lolos. Blender, Blender MCP, ekspor/kompresi dan tool produksi juga **belum diuji pada kajian ini**. |

Sumber keputusan: [ART_DIRECTION](../../ART_DIRECTION.md), [FARM_PLAN](../../FARM_PLAN.md), [ASSET_ART_AUDIO_PLAN](../../ASSET_ART_AUDIO_PLAN.md), [README dokumentasi](../../README.md), [registry aset](../../ASSETS.md), serta [review ST-02](DESIGN_ART_REVIEW.md). Fase 2 menggantikan status “proposal hardware” dalam review ST-02: **laptop iGPU, RAM 8 GB, profil Hemat 30 FPS kini disetujui**. Batas resource rinci di §6 masih kandidat, bukan persetujuan otomatis.

## 2. Snapshot sprint yang dikaji — perlu refresh

Folder sumber eksternal worktree: `/Users/mikelrisyad/Developer/globe/output/universe-art-sprint/`, seluruhnya read-only. Snapshot berikut adalah titik baca **10 Oktober 2026, 02:29:06 WIB / 9 Oktober 19:29:06 UTC**. Sprint terus berjalan; angka ini bukan klaim status produksi terakhir saat dokumen dibaca kemudian.

| Artefak | Versi/status pada snapshot | SHA-256 |
|---|---|---|
| [PLAN.md](/Users/mikelrisyad/Developer/globe/output/universe-art-sprint/PLAN.md) | Tanggal rencana 10 Oktober; target 80 PNG, 76 baru + 4 reuse. Teks “produksi baru belum dimulai” tertinggal dari manifest delivery. | `1bc1ac35d4f829b1e2db44f29179a6f07afea47259c940b39a7836de65b02e0f` |
| [asset-plan.json](/Users/mikelrisyad/Developer/globe/output/universe-art-sprint/asset-plan.json) | schema 1, `review_ready_plan`; 76 `planned`, 4 `available_pending_style_review`. Ini backlog, bukan status delivery. | `84d578dc87bef34eb449839cf1ee6cda70f1101703ec621725a5acf6500fbda5` |
| [delivery-manifest.json](/Users/mikelrisyad/Developer/globe/output/universe-art-sprint/delivery-manifest.json) | schema 1, `in_production`, target 80, **produced 60 / remaining 20**; 8 `reviewed_concept`, 52 `produced_pending_visual_review`. mtime 02:29:00 WIB. | `31ee2b40d4c319350c8a9593958ef677c91ce333adcdd8a98ba5bc081817c699` |

Remaining pada snapshot: **U053, U054, U055, U061, U062, U063, U064, U065, U067, U068, U069, U070, U071, U074, U075, U076, U077, U078, U079, U080**. `produced` menghitung PNG delivery, bukan mesh, objek individual, rig, animasi, audio, maupun approval runtime. U072 menyatakan versi 1; jangan memberi nomor versi buatan pada item yang field versinya tidak dicantumkan.

### Pemeriksaan visual langsung

Hash file delapan PNG berikut cocok dengan `sha256` manifest pada titik baca. Prompt U004/U005/U012/U072 juga dibaca. Semua adalah **gambar sprint Oktober**, bukan screenshot gameplay atau fixture September. Item selain delapan ini dibaca sebagai brief/metadata; belum diperiksa visual secara individual.

| Sheet / ukuran asli | Yang terlihat dan berguna | Yang belum dibuktikan |
|---|---|---|
| U001 art bible · 1774×887 | Fantasy, modern, sci-fi, farm, military; palet hangat, brush, edge soft/chamfer/sharp sparse, siluet. | Material/shader final, aturan gerak dan nilai detail pada kamera game. |
| U003 cahaya · 2172×724 | Komposisi farm pembanding day/dusk/night; malam memadukan ambient biru dengan pintu/jendela hangat. | Angka exposure, lampu, transisi temporal, keterbacaan objektif pada Hemat. |
| U004 skala · 1774×887 | Pembanding umur, pintu/kursi/meja/tangga dan rover/hatch. | Ukuran meter, lebar bahu, tinggi duduk, collider dan clearance produksi. |
| U005 tubuh · 1536×1024 | Depan/belakang/profil dua tubuh dewasa, A-pose, variasi umur. Prompt menargetkan 4,75 kepala. | Rasio mesh terukur, bind pose, topology, weights, rentang sendi. Label gambar bukan hasil pengukuran. |
| U012 gestur · 1536×1024 | Ekspresi dan pose farmer: menyapa, membawa, mencangkul, berbicara. | Durasi, kurva, blend/mask, event frame, interupsi dan klip runtime. |
| U035 dekorasi · 1774×887 | Lampu, bangku, pagar, bin, papan arah, planter, awning, stall; inset siluet/skala. | Kapan/di mana ditempatkan, kepadatan district, socket duduk, collider dan jalan bebas. |
| U047 musim · 1774×887 | Orchard/hedge/field edge empat musim, perubahan daun/bunga/salju. | Kalender, kelayakan biome, perubahan collider, aturan buah/panen. Buah pada ilustrasi winter tidak membuktikan mekanik hasil panen winter. |
| U072 roster v1 · 1536×1024 | Sembilan hero dalam grid 3×3; identitas dan perlengkapan kelas terbaca. | Sembilan turnaround lengkap, deformasi, bidik, grip, hitbox, portrait parity. |

U078 efek dan U079 cuaca belum delivered pada snapshot; U080 panorama juga belum. U053–055 harbor belum delivered. U060/U066 sudah tercatat produced, tetapi berlabel **future**, bukan fitur docking/gua yang tersedia. Ice/lava/barren tidak diberi warga atau flora liar oleh perluasan dressing; gas giant tetap non-landable. Jangan memperlakukan panorama/future sheet sebagai world canon baru.

## 3. Isi art book yang perlu dilengkapi

Bagian berikut adalah **proposal guideline**, bukan diagnosis visual baru. P0 = diperlukan untuk mengunci kontrak slice/pipeline; P1 = paket dunia hidup M3; P2 = perluasan setelah paket dasar lolos. Art book dapat menambahkan teks, diagram state, tabel dan capture; tidak semua gap membutuhkan PNG baru.

| Gap / prioritas | Tambahan guideline yang dibutuhkan | Dasar yang tersedia | Acceptance usulan |
|---|---|---|---|
| **AB-01 Gerak dan reaksi / P0** | State idle–walk–stop–look–talk–sit; gaya gait per tubuh/profesi, kecepatan vs panjang langkah, anticipation/contact/recovery, mask, interrupt priority, socket dan satu event ID. Bedakan gerak ambience dan akibat gameplay. | U005/U012; Town walk/mixer; Valley `ClipPlayer` dan reaksi dunia. | Satu lembar timing + video runtime jalan→berhenti→menoleh→interaksi→lanjut; tanpa sliding/pose snap, event akibat tepat sekali, tetap benar pada 30 FPS dan saat pause/reload. |
| **AB-02 Kepadatan dan dressing / P0** | Resep per district/biome: massa utama, kelompok pendukung, ruang bernapas; area terlarang untuk pintu, trotoar, kendaraan, visibility target. Jejak pemakaian tempat: kayu dekat pekerja, barang dekat toko, tanaman di halaman. | U028–035/U043–050; layout/greenery/reservations yang ada. | Tiga capture fixture yang sama (ramai, tenang, Hemat) + berjalan ke pintu; target mudah ditemukan, tak ada clutter di clearance. Quality hanya menurunkan dekorasi. |
| **AB-03 Warga dan hewan / P1** | Tiga warga bernama dahulu: rumah, tempat kerja/istirahat, rute dan slot interaksi; jadwal, gagal-rute, sapaan/cooldown, variasi dialog. Hewan punya habitat, makan/istirahat/reaksi jarak, bukan wander ke semua biome. | Valley `ROUTINES`, greeting hysteresis, nav, ayam/sapi/anjing; Town ambient walkers. | Empat waktu pada fixture sama; setiap warga mencapai anchor atau fallback valid, greeting tak berulang tiap frame, identitas tak berubah ketika pool/LOD/reload. |
| **AB-04 Jam, musim, cuaca / P0 kontrak; P1 visual** | Satu clock policy per planet; rate/pause/reload, batas siang/malam, season eligibility, weather transition/duration. Tabel nilai cahaya/palet/material basah/angin/ambience, indikator aktivitas yang berubah. | U003/U047; U079 menunggu; Valley waktu/musim manual dan token. | Orbit/planet/town/interior membawa waktu/identitas yang konsisten; malam pintu/target tetap terbaca. Perubahan musim tidak memindahkan jalan/rumah/nav. Rain/snow tidak menyebar ke biome tanpa aturan. |
| **AB-05 VFX dan feedback / P1** | Bentuk painted, warna semantik, ukuran world vs screen, lifetime, alpha/depth, emission/cooldown/cap; kategori ambient, contact, objective. Translucency dan halo dievaluasi pada latar terang/gelap. | U078 menunggu; Valley pool `Effects`, ikon reaksi; water/shore Town. | Efek kontak mengikuti event; pemain mengerti sebabnya tanpa menutup avatar/prompt. Hemat mempertahankan feedback penting dengan partikel minimum, tanpa bloom/refraction wajib. |
| **AB-06 Audio cue / P0 daftar event; P1 soundscape** | Cue sheet scene/district/material: event, posisi, jarak, envelope, cooldown, cap voice, mix priority, ducking. Motif town berlanjut ke interior; silence/quiet slots; mute/pause/background. | `core/audio.js` synth ambience/music/engines/SFX; AA-08. Tidak ada bank audio di sprint PNG. | Mendengar 10 menit lintas route termasuk sebelum/selepas audio unlock: tak ada click, chord ganda, lonjakan volume, cue ganda, suara saat mute; tujuan tetap jelas tanpa suara. |
| **AB-07 Skala, siluet dan LOD / P0** | Ukuran meter, bagian proporsi dewasa, pivot/front, socket, footprint/collider; detail yang dipertahankan dekat/menengah/jauh dan ambang screen size + hysteresis. Landmark sama pada tiga skala, bukan mesh town dipaksakan ke globe. | U004/U005/U035/U056/U072; kit LOD/collider/footprint existing. | Adult 4,5–5 kepala diukur pada mesh; pose netral dan kontak lolos. Siluet kelas/tujuan tetap terbaca pada buffer Hemat; transisi LOD tidak melompat atau menggeser socket. |
| **AB-08 Kontrak produksi / P0** | Reference ID→asset ID→source editable→export→loader→profil→QA; spesifikasi UV/maps/rig/clip/audio dan versi. PNG concept, texture candidate dan runtime-ready diberi status berbeda. | Sprint manifests; registry/assetManifest; AA pipeline. | Satu aset per jalur dapat ditelusuri dan dibangun ulang dari source, semua resource tercatat, ukuran/rig/LOD diperiksa di engine sebelum rollout. |
| **AB-09 Profil Hemat / P0** | Batas resident resource dan peak, jumlah rig aktif/animasi/partikel/audio, texture variants, loading/cache ownership; daftar detail yang dikurangi. Palet/feedback/siluet minimum tidak tergantung pass mahal. | Hardware target Fase 2, `quality.js`, Town detail budget, laporan resource 9 Oktober. | Baseline dan sesudah pada iGPU nyata/RAM 8 GB, cold/warm traversal M2, 30 FPS dan uji stabilitas; hasil N/A ditulis bila counter unavailable. |

### Aturan hidup yang bisa ditinjau sebelum implementasi

**Gerak:** idle harus tenang; pilih satu penekanan (napas/lirikan/pergeseran berat), hindari setiap properti bergerak terus. Wind memberi arah/fase bersama pada daun/rumput/awning; fase individu mencegah sinkron penuh. Dorongan lokal lebih kuat daripada idle wind, lalu kembali ke rest pose. Gait berbeda menurut panjang kaki dan berat alat, bukan sekadar mempercepat klip.

**Reaksi:** contoh kontrak sapaan ialah `approach` → kepala menoleh → badan berhenti di titik aman → gesture singkat → prompt dialog → kembali rutinitas ketika pemain menjauh. Tetapkan radius masuk/keluar berbeda, cooldown dan priority; dialog aktif mengalahkan wander, tetapi tidak menahan jalan pemain. Untuk aksi alat, satu event kontak mengubah state dunia, memicu VFX dan audio; efek hanya presentasi dari state, bukan sumber simpanan. Durasi 0,9 s `hoe` dan blend 0,15 s dalam FARM_PLAN merupakan rujukan prototype, perlu validasi pada tubuh baru.

**Kepadatan:** pakai satu landmark tujuan, satu cluster aktivitas, satu cluster jejak pemakaian dan satu area tenang sepanjang lintasan slice. Props harus menjelaskan fungsi lokasi. Tentukan occupancy dalam luas lot/jalur dan jarak pandang, bukan menghitung objek dari ilustrasi atau menerapkan aturan lembah kecil ke seluruh planet. Hindari pengisian ruang kosong yang disengaja seperti lapangan/akses pantai. Stream RNG dressing terpisah; mengurangi rumput tidak boleh mengganti identitas warga atau seed layout.

**Rutinitas:** warga bernama punya tujuan, bukan teleport hilang hanya untuk menyatakan “pulang”. Hiding di rumah boleh menjadi tingkat simulasi awal bila doorway/anchor dan waktunya konsisten; interior household penuh perlu scope tersendiri. Hewan dekat farm dipakai dahulu; tidak menambahkan kawanan global demi animasi. Town saat ini ambient walkers, sehingga jadwal Valley adalah pola port, bukan fitur household Town yang sudah ada. Reaksi terhadap kendaraan bukan kewajiban physics/flee baru: desain Town yang mengizinkan lewat orang tidak diperlakukan sebagai bug.

**Waktu/cuaca:** ubah cahaya, aktivitas dan suara secara bertahap. Daun/jalur/salju harus memakai biome policy. Hujan awal cukup material wet ringan, emitter lokal sekitar kamera, ambience dan rutinitas berlindung; wetness/panen menjadi state gameplay hanya bila disetujui. Kalender panen, musim otomatis, dampak badai dan rutinitas lintas kota tetap pertanyaan produk, bukan konsekuensi otomatis U047/U079.

**VFX/audio:** kontak dan keberhasilan lebih jelas daripada ambience. Hati/! /zzz dan cue dialog tidak boleh bersaing dengan prompt utama. Di Hemat, kurangi garnish/particle count, update dekorasi jauh lebih jarang, pertahankan event penting. Cue berulang memakai variasi dan jeda; suara dekat menjelaskan aktivitas warga, sementara ruang tenang membuat tempat berbeda. Pilihan synth/sample ditentukan hasil dengar dan budget, bukan kebutuhan memakai layanan generator.

## 4. Dewasa 4,5–5 kepala: kontrak migrasi dan sembilan hero

**Keputusan tetap:** sprint mengunci tubuh **dewasa 4,5–5 kepala**; prompt foundation memilih 4,75 sebagai anchor. Jangan menyamakan proporsi ini dengan karakter anak. Batas umur/variasi bentuk boleh berbeda, tetapi rasio dewasa tidak dibuka ulang. Tinggi meter belum dipastikan oleh sheet. Uniform scaling rig v5 tidak mengubah rasio kepala terhadap tubuh; diperlukan fitting bentuk dan rest pose, kemudian skin/retarget ulang.

Fakta source: [Town people](../../../src/modes/town/people/skirmishPeople.js) memuat template pria/wanita melalui [vcSoldiers](../../../src/skirmish/units/vcSoldiers.js), lalu memasang klip `town_walk` tersendiri. Rig v5 memakai pieces/material slots pada UV kedua, dua-bone IK tangan dan penempatan senjata. Town juga memiliki pose sit/drive/sleep dengan offset hips `0,48 × bodyScale`; v5 memiliki normalisasi berbasis tinggi joint head terhadap `1,545`. Nilai ini merupakan asumsi implementasi, bukan ukuran untuk dipakai langsung pada tubuh baru. Valley [actors](../../../src/valley/world/actors.js) memakai `chunkyPeople.buildTemplate` dari pivot; compatibility nama tulang saja tidak membuat kedua jalur setara.

| Area terdampak | Yang harus ditentukan/diubah pada produksi nanti | Fixture dan acceptance usulan |
|---|---|---|
| **Tubuh/rig Town v5** | Master pria/wanita dewasa, rasio terukur, rest pose, joint axes/names, skala tangan/kaki/leher, skin weights, modular compatibility; kontrak UV/pieces v5 dipertahankan atau adapter berversi. | Turnaround dengan pengukuran crown-to-sole/head; idle/walk/run/turn/jump dan close-up muka pada cahaya game. Mata/pakaian stabil, kaki tidak sliding, look-at tidak mematahkan leher. |
| **Kursi/meja/tempat tidur** | Seat/feet/back/hand sockets; pose duduk/berbaring, jarak lutut/meja, radius berdiri, hold prop. Offset lama tidak jadi standar baru. | Kursi, bangku dan sofa dari kit interior + tempat tidur; telapak/pinggul menapak, lutut tidak menembus meja, kepala tidak menembus sandaran, keluar duduk kembali walk valid. |
| **Pintu/tangga/interior/Home** | Tinggi/width clearance berdasarkan mesh + margin; approach, langkah tangga, eye height/kamera dan furniture circulation. `doorClearance.js` sekarang membersihkan dressing, bukan memvalidasi tinggi kepala. | Satu rumah existing dan satu applied Home: masuk/keluar, tangga, cutaway/walk; kepala/bahu/kamera aman, collider/portal tidak bergeser setelah quality switch/save. Home walk memakai eye height 1,6 m di source; review relevansinya tanpa mengubah dimensi bangunan global otomatis. |
| **Kendaraan** | Driver pelvis/feet/hand sockets, seat height, dashboard/wheel reach, headroom/roof/hatch; rover dan cart/sedan perlu fitting terpisah. | Duduk/drive/keluar pada kendaraan Universe dan Town; kepala tidak menembus atap, tangan mencapai kemudi, spawn keluar bisa berjalan. Fleet recipe dan physics tidak diubah sekadar untuk proporsi. |
| **Aksi/ekspresi Valley** | Pilih retarget humanoid atau adapter pivot; ukur kembali langkah, target hoe/water/lift/pet, carry socket, face regions. | Event `grab/release/impact/touch` tetap tepat, alat mengenai target, barang tidak menembus kepala. Runtime pivot/klip data bukan bukti exported animation baru. |
| **Skirmish** | Semua class kit dan hair/headgear di-fit; grip/support/muzzle, aim/IK reach, crouch/kneel/hit/fall. Pisahkan bentuk visual dari combat rules/hitbox/cover; setiap perubahan gameplay harus eksplisit. | Semua sembilan hero, lima kelas, dua faksi; bergerak, bidik, tembak, cover rendah, kneel, jatuh; portrait/Prep/HUD/cut-in terbaca dan identity parity disetujui. Tank/rear weakpoint diperiksa ketika U075 tersedia. |

### Checklist identitas roster

Sumber ID/kelas: [roster.js](../../../src/skirmish/game/roster.js); appearance: [heroLooks.json](../../../src/skirmish/units/heroLooks.json); senjata/kit: [soldierLook.js](../../../src/skirmish/units/soldierLook.js). U072 v1 mempertahankan identitas sambil mengubah proporsi; satu grid lineup tidak menggantikan pengujian berikut.

| Hero | Kelas / kontrak silhouette & identity yang dijaga | Risiko kontak utama |
|---|---|---|
| Arlen Voss | Scout; rambut cokelat, iris biru; rifle, pack kecil. | Rifle shoulder/support grip, walk dan look-at; juga anchor tampilan avatar Town saat ini. |
| Mira Halden | Scout; rambut orange-brown, iris hijau, scarf; rifle. | Rambut/scarf terhadap bahu/head-turn dan rifle. |
| Brann Keller | Shocktrooper; rambut gelap, kulit tan, iris cokelat, helmet; SMG, mags/plate. | Helmet terhadap kepala yang membesar, cheek/shoulder aim, crouch. |
| Sela Moraine | Shocktrooper; bob auburn, iris ungu; SMG. | Bob terhadap leher, armor/upper-arm dan support hand. |
| Otto Riel | Lancer; rambut ash-blond, iris slate-blue, kulit pucat; lance, armor/tubes. | Senjata besar terhadap lengan pendek, tubes saat kneel/turn. |
| Ines Darrow | Lancer; twin pony blue-black, iris deep-blue; lance. | Rambut terhadap pack/tubes, lance grip dan crouch. |
| Cato Weller | Engineer; rambut copper bob, iris hijau, scarf; rifle/tools/pack engineer. | Tools/pack dan scarf saat sit/kneel serta aiming. |
| Lio Marchetti | Engineer; rambut dark-brown asym bob, iris cokelat, kulit hangat; rifle/tools. | Tool sockets, pack silhouette, asym hair saat look-at. |
| Vesna Orlov | Sniper; rambut blond panjang, iris biru, kulit pucat; sniper/goggles. | Scope-to-eye, cheek/stock, rear hair dan kneeling aim. |

**Usulan urutan aman:** satu body proof + sipil Town → satu senjata rifle → satu senjata lance/kit besar → variasi pria/wanita → seluruh sembilan hero dan dua faksi. Migration flag/adapter dapat menjaga jalur existing sampai parity diterima. Jangan mengganti shared v5 global sebelum kedua konsumennya lolos. M2 dapat memakai rig existing sebagai baseline transisi bila lead menyetujui; arah proporsi final tetap terkunci, migrasi bukan precondition yang diam-diam memperbesar M2.

## 5. Kontrak PNG → source editable → runtime

Sprint adalah reference delivery. Delapan texture mentah U020–027 adalah kandidat permukaan; lima atlas referensi U002/U036/U042/U055/U064 bukan atlas UV siap pakai. Teks, lighting dan susunan swatch pada sheet tidak dimasukkan ke texture mesh. PNG effect juga bukan flipbook, klip atau simulasi.

| Tahap/status usulan | Kontrak minimum | Gate sebelum lanjut |
|---|---|---|
| **Reference-reviewed** | Sprint ID, versi/hash, brief, image/prompt, rights/provenance, coverage current/mixed/future; catatan acceptance visual. | Gambar disetujui untuk fungsi yang dimaksud. `reviewed_concept` tidak diubah maknanya menjadi runtime-ready. |
| **Production-spec** | Asset ID stabil/family, meter/bounds, front/pivot, footprint vs visual bounds, collider/portal/socket, material family, target profile, deps. Untuk karakter: ratio/age, bind pose/bones, weights, parts, expressions, clip/event contract. | Ukuran dan kontak disepakati pada graybox/rig proof, bukan diperkirakan dari label PNG. |
| **Editable-master** | `.blend` atau generator/data deterministik yang benar-benar cukup untuk regenerasi; seed/params/tool version dan input dependencies. Sculpt/paint master, UV, rig/actions bila digunakan. | Source tersedia dan dapat dibuka/dibangun ulang. Input VRoid/UAL/scratch yang dibutuhkan pipeline v5 harus tercatat ketersediaan/provenance-nya; keberadaan script saja belum menjamin reproduksi. |
| **Texture-candidate** | Albedo/emissive sRGB; normal/roughness/masks data; channel packing/material semantics, alpha mode, texel density, gutter/dilation/mips. Uji repeat 4×4 untuk tile. | Seam/lighting baked tak sesuai/halo diperbaiki. Normal bukan otomatis dibuat dari warna albedo; pilihan map dibuktikan pada material engine. Master lossless terpisah runtime compressed. |
| **Export-staged** | Indexed mesh, UV/normals/tangents sesuai material, skin/clip/event IDs, LOD bounds/sockets stabil, measured tris/material calls/bytes/maps; collision terpisah dari decimation. | Loader mempertahankan atribut; bake node Blender yang tidak didukung glTF. Meshopt/KTX2 adalah kandidat yang perlu diuji, bukan tersedia karena disebut plan. |
| **Runtime-verified** | Registry `ASSET_FILES`, loader/module, profile variants, ownership cache/dispose, hashes/source provenance dan fixture QA. | Capture/video engine siang/malam, Hemat/normal, loading/save/revisit/LOD, timing/resource terukur; tidak hanya Blender render. |
| **Audio-ready** | Cue ID→synth patch/data atau master→sample export, gain/envelope/loop points, codec/rate/channels, compressed/decoded bytes, scene/load/dispose. | Listening/unlock/mute/transition/voice cap lolos. Sprint PNG tidak memiliki hasil audio; synth yang ada tetap jalur valid. |

Sumber registry existing: [assetManifest.js](../../../src/render/assetManifest.js), [ASSETS](../../ASSETS.md), `tools/blender/town/refresh_manifest.json`, [texturedAssetLibrary.js](../../../src/render/texturedAssetLibrary.js). Family authoring: generator town/refresh/scenery, `tools/blender/home/`, `tools/blender/valley/`, `tools/blender/skirmish/soldier_v5.py`, serta `build_town_walk.py` dan source `town_walk_m/f.blend`. Ini peta artefak/source yang ada, bukan klaim tool sudah dijalankan. Jangan menjalankan `build_town_space.py` dari studio tanpa audit root output; mandat menyebut risiko menulis checkout utama.

## 6. Profil Hemat: persetujuan, kandidat budget, dan cara membuktikan

**Disetujui:** laptop iGPU, RAM sistem 8 GB, 30 FPS, profil Hemat. RAM sistem bukan alokasi tab 8 GB. Model iGPU/browser/resolusi uji belum dipastikan. **Fakta source:** Low mematikan shadow dan membatasi DPR, tetapi loader Town tetap meminta template v5 dua tubuh beserta atlas/walk pack; Low bukan asset variant Hemat yang telah dibuktikan. `quality.js` masih memakai budget 60 FPS dan `TownDetailBudget` threshold sekitar 58 FPS; governor perlu policy 30 FPS supaya degradasi/recovery tidak memakai sasaran yang salah.

Empat atlas 2048² RGBA8 setara 64 MiB base / sekitar 85,33 MiB dengan mip penuh, sebelum resource lain. Ini kalkulasi format dari review ST-02, **bukan telemetry VRAM**. Perubahan ukuran PNG di disk tidak membuktikan penurunan resident texture. Target AA tambahan texture ≤32/64 MiB dan delta slice ≤7 MiB adalah batas tambahan historis, bukan total seluruh mode yang sudah tercapai.

| Kandidat untuk keputusan lead, bukan angka yang sudah disetujui/tercapai | Acceptance / cara ukur |
|---|---|
| Buffer internal hingga sekitar 1280×720; 30 FPS; p95 ≤40 ms, p99 ≤50 ms setelah warmup. | Visible traversal M2 pada laptop iGPU/RAM 8 GB. Catat frame CPU/GPU bila tersedia, input delay/stall dan drawing buffer; jangan hanya mean FPS. |
| Tab steady ≤500 MiB, peak ≤750 MiB; estimasi resource GPU steady ≤160 MiB, peak ≤256 MiB. | Bedakan heap/tab/process, texture/render target/geometry estimate dan shared browser resource. Bila counter unavailable tulis N/A dengan metode pengganti, jangan mengklaim VRAM terukur. |
| Transfer sebelum playable ≤10 MiB compressed; tambahan Town ≤15 MiB cold cache. | Network per route termasuk decoder, texture, interior dan runtime dependency; bukan sum seluruh folder `public/` atau disk GLB. |
| 30 menit + 20 perpindahan mode; stall >100 ms ditelusuri, kandidat ≤1/menit traversal. | Resource plateau setelah siklus, cue/rig tidak berlipat; cold/warm dan dispose/cache ownership dicatat. |
| Delta visual slice ≤7 MiB dan tambahan sample bank ≤1–2 MiB compressed / decoded ≤12 MiB dari AA plan. | Resource tambahan terhadap baseline bertanggal; jangan menjumlahkannya dengan ceiling total secara sembarang. Synth juga dihitung CPU/voice. |
| Kandidat adult Hemat ≤6k tris dekat, ≤2k menengah, proxy jauh; atlas family 512–1024² jika keterbacaan lolos. | Pilih setelah proof, bukan downgrade semua karakter otomatis. Head/face/alat/class silhouette tetap terbaca; shared maps dihitung sekali, modular draw calls/outline/overdraw ikut diukur. |
| Kandidat slice 4 NPC skinned dekat + avatar, hewan maksimal 3 dekat; pool VFX 128 dengan maksimal 32 partikel kontak per event; suara positional maksimal 8 bersamaan. | Mulai dari scene kecil, ukur CPU/GPU/audio dan persepsi kepadatan. Angka ini eksperimen authoring, bukan klaim populasi Town saat ini atau kewajiban global. Gameplay state tidak dihapus saat pool penuh; garnish boleh ditolak. |

Prinsip fallback yang perlu masuk book: kurangi micro detail, shadow, outline tambahan, vegetasi/partikel ambient dan update dekorasi jauh; pertahankan landmark, avatar/alat, prompt, kontak, nav/portal/collider/ID/save. Pakai variant texture/body sungguhan bila baseline menunjukkan asset residency dominan. Interior/bank biome di-load saat perlu; cap tidak mengganti state/layout. Jangan menyalin scene Valley utuh: log/capture historis memuat sekitar 112 calls pada versi look-dev, di atas target plan <80; itu bukan bukti port lebih murah.

## 7. Peta implementasi dan dependency

Tabel ini adalah **proposal urutan untuk lead**, bukan dispatch atau perubahan board. M1-A1 menghasilkan kajian ini; engineering/source/produksi aset tetap memerlukan task tersendiri. G1–G6 FARM_PLAN merupakan referensi teknik; G5 harus direkonsiliasi karena Town sekarang memakai v5, bukan sekadar `chunkyPeople`.

| Urutan / milestone | Modul dan aset existing yang menjadi titik kerja | Dependency | Acceptance yang perlu dilampirkan |
|---|---|---|---|
| **1 · M1 kontrak/registry** | Art book AB-01/04/07/08/09; `assetManifest.js`, ASSETS; sprint U001–006/U012/U072. | Identitas/save/version M1; snapshot sprint dan pilihan physical scale/clock. | Daftar resource/source/profile dengan status bukti, satu contoh event/socket; gap/risiko tercatat. Tidak menutup acceptance M1 engineering dari laporan ini. |
| **2 · M2 satu lintasan** | `core/director.js`, `TownMode.js`, interior, `HomeMode.js`; `buildingBlueprint`, `doorClearance`, onboarding. Kit town/furniture/home existing; U004/U028–041 sebagai arah. | Save/identity/failure paths M1; satu tujuan dan rumah fixture dipilih lead. | Pemain Space→Planet→Town→rumah→perubahan persisten→reload→kembali; tujuan/pintu terbaca. Capture empat skala dan tabel perf Hemat; playtest manusia terpisah dari replay. |
| **3 · M3 proof material/scale/rig** | `render/texturedAssetLibrary.js`, `town/render/paintedStyle.js`, `homeBuilder.js`; `skirmishPeople`, `vcSoldiers`, `townWalk.json`; Valley actors/clips sebagai referensi. | M2 + sprint selesai; production spec ukuran/rig/source; AA-00/01 baseline. | Satu material dan adult body proof diputar dalam engine; gait/door/seat/drive lolos sebelum swap global. Satu family shader, bukan mengganti global ramp semua mode tanpa parity. |
| **4 · M3 dressing berdasarkan situs** | `world/landUsePlan.js`, `world/townRelief.js`, `town/layout/townLayout.js`, `townGreenery.js`, `fieldEdges.js`, `doorClearance.js`, `town/render/environmentKit.js`. Kit scenery/environment/town; U013–035/U043–050. | Tahap 2/3; reservations/footprint/terrain/nav. G2/AA-02 bila mengubah layout. | Flat/coastal/hillside sesuai fixture, pintu/road/farm/water tak tertutup; quality parity. Bila placement deterministik/layout berubah: versi/migrasi dan old save gate; visual-only garnish tidak reroll kota. |
| **5 · M3 reaksi lokal** | `town/render/groundCover.js`, `farTrees.js`, `environmentKit.js`; referensi Valley `grass.js`, `effects.js`, `icons.js`, `anim/clips.js`; U012/U078. | Event/coordinate policy, material proof, VFX budget. | Avatar→rumput/prop/feedback bereaksi pada fixture; contact event sekali; pool penuh/pause/exit aman. G3 bertahap; jejak persistent tidak diasumsikan sudah ada. |
| **6 · M3 rutinitas kecil** | `town/navigation/PedestrianRoutes.js`, `town/people/skirmishPeople.js`, appearance/pool; Valley `villagers.js`, `nav.js`, `animals.js` sebagai pola. U007–012/U046. | IDs/clock/nav/anchors, body/seat contact; household WB-05 hanya jika scope disetujui. | Tiga warga/four time slots + hewan farm dekat; greetings/rute/interaksi/revisit valid; Town pool tak mengganti identitas. Jangan copy koordinat/nav Valley ke town procedural. |
| **7 · M3 jam/musim dan soundscape** | `render/planetRenderer.js`, Town lighting/sky/paintedStyle; `valleyPalette.json`, ValleyLookDev/valleySky sebagai referensi; `core/audio.js`. U003/U047/U078–079. | Clock/biome/product policy, event IDs, occupancy bila tersedia; AA-08 dapat paralel setelah kontrak clock. | Siang/senja/malam konsisten pada lintasan; satu biome seasonal/weather proof, audio transisi/mute/unlock 10 menit. Material wet/partikel murah, bukan weather simulation penuh. |
| **8 · M3 gate Hemat dan rollout** | `core/quality.js`, `core/engine.js`, `town/render/detailBudget.js`, loaders/cache/pools; resource pack variants dan QA fixtures. | Baseline M2; tahap 3–7 per pack. Instrumentasi/budget dimulai tahap 2, bukan ditunda ke akhir. | Policy 30 FPS, cold/warm/per-route bytes + p95/p99/resource +30 menit/20 switches; parity visual/gameplay. Lead memutus jumlah/variant dari bottleneck aktual. |
| **9 · setelah proof, migrasi Skirmish terisolasi** | `skirmish/units/vcSoldiers.js`, `soldiers.js`, `heroLooks.json`, `soldierLook.js`, roster/portraits, military kit; U072–077. | Rig proof tahap 3, seluruh weapon/kit refs selesai/review, flag/adapter; fixture combat tersendiri. | Sembilan hero/lima kelas/dua faksi dan portrait parity, aim/IK/clip/cover/hitbox; tidak memblokir M2 Universe. U075 tank/rear weakpoint harus ikut visual acceptance. |

Kontinuitas tiap skala perlu capture pasangan, bukan kesamaan nama saja: peta/benua Space↔Planet, landmark/arah akses Planet↔Town, shell/pintu dan fungsi ruangan Town↔Interior. Art book menentukan identitas yang dipertahankan dan abstraksi skala yang diperbolehkan. Trade tetap melalui CTA terpisah, Valley dan Skirmish tetap produk/prototype terpisah; gaya yang sama tidak memberi izin mengintegrasikan ekonominya atau combat ke loop Universe.

## 8. Pertanyaan produk dan blocker untuk lead

Tidak perlu menghentikan M1 untuk semua pertanyaan berikut; kontrak yang berdampak source/produksi harus ditetapkan sebelum tahap terkait.

| Pertanyaan / keputusan tertunda | Dampak dan kapan harus terjawab |
|---|---|
| **Tujuan pemain dan fixture rumah M2 yang dipilih?** Apa satu perubahan persisten yang memberi alasan kembali? | Menentukan landmark, cue, furnishing dan feedback; sebelum skrip/onboarding M2. Pilih aksi existing; jangan mensyaratkan barang antar lantai atau farming economy yang belum tersedia. |
| **Tinggi meter adult, variasi tubuh/umur, standar seat/eye/clearance?** | Rasio 4,5–5 sudah final, tetapi tinggi fisik dan kontak belum; sebelum mesh/rig baru dan fitting kendaraan. Belum ada angka meter produksi yang dapat disahkan hanya dari PNG. |
| **Clock global/per-planet, pause/background/reload dan kalender?** Musim manual look-dev atau berjalan otomatis? | Menentukan schedule/persistence/transisi. World clock tidak boleh diam-diam mengikuti jam OS; jawab sebelum tahap 6/7. |
| **Rutinitas dekoratif atau penghuni persisten yang benar-benar masuk rumah?** Hewan farm saja atau juga kota tertentu? | Memisahkan paket ambient kecil dari household simulation/save; sebelum port G5/WB-05. |
| **Cuaca hanya presentasi atau mengubah panen/nav/resource?** | Visual ringan dapat diproof dahulu; gameplay wetness/kalender/ekonomi memerlukan keputusan eksplisit. |
| **Perangkat iGPU acuan dan ceiling rinci Hemat mana yang diterima?** | Menentukan fixture/resolusi/pool/texture variant dan metode ukuran; sebelum menyatakan profil lolos. Persetujuan minimum 8 GB/30 FPS tidak dibuka ulang. |
| **Jalur reproduksi v5 dan batas reuse eksternal tersedia?** | Script/GLB existing tidak menggantikan ketersediaan seluruh input authoring. Tool Blender/MCP, retarget dan export belum diverifikasi; sebelum produksi, bukan blocker dokumen ini. |

**Blocker klaim selesai, bukan blocker kajian:** sprint belum lengkap/review visual mayoritas pending; runtime/retarget baru belum dilakukan; fixture hardware minimum belum ada bukti; physical scale/clock dan scope household/cuaca belum dikunci. Book final perlu satu contoh lengkap dari reference sampai engine QA. Peta di §7 dapat dipakai lead untuk membuat task setelah dependency terpenuhi.

## 9. Yang harus dicek ulang saat sprint berubah

1. **Setiap refresh:** baca produced/remaining/status, `version`, hash, replacements dan timestamp dari delivery; jangan menggunakan status `planned` asset-plan sebagai kemajuan. Catat titik baca baru; jangan lock/edit sprint yang sedang diproduksi.
2. **U004/U005/U006/U012 berubah:** ukur ulang master adult, rest pose, sockets, ekspresi/gait/contact. Jika rasionya masih 4,5–5 tetapi bentuk berubah, rig/seat/weapon parity tetap perlu diperiksa.
3. **U072–077 bertambah/revisi:** periksa identitas sembilan hero, class/faction loadout, weapon support/muzzle dan tank weakpoint; jangan menyatakan grid roster sebagai sembilan rig-ready turnarounds.
4. **U053–055/U064 tersedia:** review harbor/material atlas dan footprint/coast/socket/LOD; future-only station/koloni/POI tetap di luar slice kecuali lead mengubah scope.
5. **U078/U079/U080 tersedia:** periksa bentuk efek, weather/season lighting dan family continuity. Tetap lengkapi timing/caps/audio/biome eligibility secara tekstual dan buktikan di engine.
6. **Texture raw/atlas diganti atau native size berubah:** repeat/alpha/normal/color-space/texel-density dan memory dihitung lagi. Approval concept tidak otomatis mengesahkan runtime compression.
7. **Studio/source berubah selama M1/M2:** baca ulang loader, rig, clock/save dan QA yang disentuh. Review ini bertanggal; hasil test/build/playtest baru dari engineering/QA dicatat terpisah oleh pemiliknya.

**Serah-terima M1-A1:** kajian tidak menjalankan test/build/browser/playtest, generator, install, commit/push/deploy atau layanan berbayar. Checkout utama dan seluruh sprint hanya dibaca. Satu output yang dimaksud adalah dokumen ini; lead menentukan prioritas task, acceptance final dan milestone berikutnya.
