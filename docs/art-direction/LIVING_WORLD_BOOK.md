# Living World Book — Globe Universe

**Draft v0.1 · task M3-A1 · 10 Oktober 2026 · untuk globe-lead dan engineer M3.** Buku ini menetapkan kontrak P0 agar dunia terasa dihuni, bereaksi dan tetap terbaca pada perangkat minimum. Ini spesifikasi untuk implementasi berikutnya, bukan laporan bahwa fitur telah selesai.

Acuan: [ART_BOOK_GAP](../studio/globe-universe/ART_BOOK_GAP.md), [ART_DIRECTION](../ART_DIRECTION.md), [ASSET_ART_AUDIO_PLAN](../ASSET_ART_AUDIO_PLAN.md), [FARM_PLAN](../FARM_PLAN.md), [M2_SLICE_SPEC](../studio/globe-universe/M2_SLICE_SPEC.md), [M2_UX_SPEC](../studio/globe-universe/M2_UX_SPEC.md), dan [STUDIO Fase 2](../studio/globe-universe/STUDIO.md#fase-2--keputusan-pengguna-10-oktober-2026-setelah-checkpoint-1).

## 1. Status keputusan dan batas pemakaian

Label berlaku untuk **isi kontrak**, terpisah dari status implementasi. **Disetujui** = arahan pengguna/ART_DIRECTION. **Keputusan sementara lead** = pilihan kerja yang telah diberikan lead, dapat direvisi lead. **Usulan** = parameter/urutan/acceptance dalam draft ini yang belum disahkan atau dibuktikan. Angka usulan tidak otomatis menjadi minimum resmi hanya karena tercantum dalam tabel.

| Status | Kontrak | Dasar / batas |
|---|---|---|
| **Disetujui** | Painted diorama/painted 3D: massa dan siluet utama, palet terarah, detail kuas/modulasi, satu keluarga respons material; fantasy/modern/sci-fi/farm/military berbagi bahasa visual. | ART_DIRECTION AD-0, 29 September; keputusan Fase 2 mengikuti sprint Codex GUI. Diagnosis screenshot September tetap historis, bukan daftar cacat build kini. |
| **Disetujui** | Karakter **dewasa 4,5–5 kepala**, bukan karakter anak; U005/prompt foundation menargetkan 4,75 sebagai anchor. | Sprint/FARM_PLAN dan mandat lead. Rasio mesh harus diukur; label PNG belum merupakan ukuran mesh. Tinggi meter belum disetujui. |
| **Disetujui** | Laptop iGPU, RAM sistem **8 GB**, profil **Hemat 30 FPS**. | Fase 2. Tidak berarti tab boleh memakai 8 GB, dan tidak berarti Low existing sudah merupakan profil Hemat tervalidasi. |
| **Keputusan sementara lead** | Pertahankan **world clock existing**; musim/cuaca sebagai **presentasi**, tanpa kalender musim otomatis atau konsekuensi gameplay baru dalam paket ini. | Arahan M2-A0/M3-A1. Tidak mengubah kebijakan offline/menu pause existing. |
| **Keputusan sementara lead** | Slice Perjalanan Pertama; lampu/barang rumah awal sebagai perubahan persisten; Home opsional. | M2_SLICE_SPEC. M3 menjaga identitas, portal dan hasil simpan M2. Household, farming economy dan combat Universe bukan konsekuensi art book. |
| **Usulan** | Tinggi nominal adult **1,65 m**, state/timing/event registry, resep dressing, daftar cue, LOD/contact rules dan ceiling resource di bawah. | Dibutuhkan untuk proof dan keputusan produksi. Uji kontak/visual/performa dahulu; tidak mengganti rig/layout global dari dokumen ini. |
| **Usulan** | Tiga proof awal tanpa file aset baru: rumput bereaksi, satu warga bernama menyapa, malam/wayfinding terbaca. | §10. Pakai rig/material/atlas/audio existing; bukan port Valley utuh atau produksi karakter baru. |

Fakta source/artifact yang dibaca terarah: Town menggunakan template Skirmish v5 dan walk pack khusus Town; Valley memakai rig runtime dari pivot dan clip data; groundCover Town sudah mempunyai wind; world clock, sunAt, sky/audio night factor, clearance pintu, palet dan audio synth tersedia. Ini tidak membuktikan kontrak baru telah dijalankan. QA historis tetap terpisah; **tidak ada runtime/playtest/benchmark M3 baru pada task ini**. Blender/MCP/retarget/export/kompresi juga belum diuji di sini.

## 2. Snapshot art sprint dan daftar referensi

Sprint `/Users/mikelrisyad/Developer/globe/output/universe-art-sprint/` dibaca tanpa edit/lock/generate. Titik baca manifest: **10 Oktober 2026, 08:14:39 WIB / 01:14:39 UTC**.

- `delivery-manifest.json`: schema 1, `in_production`, target 80; **produced 77 / remaining 3**. Status: **7 reviewed_concept / 70 produced_pending_visual_review**. Remaining: **U071, U077, U080**. SHA-256 `dfc2aeb87cd387da7e67e0967ab14186cdf064f2a82e39b7584a3c5f4c158dfb`.
- `PLAN.md`: SHA-256 `1bc1ac35d4f829b1e2db44f29179a6f07afea47259c940b39a7836de65b02e0f`; `asset-plan.json`: `84d578dc87bef34eb449839cf1ee6cda70f1101703ec621725a5acf6500fbda5`. Keduanya backlog/rencana; status `planned` bukan kemajuan delivery.
- U001 kini tercatat versi 1/pending review meski hash PNG sama dengan kajian sebelumnya. Jangan menganggap status concept-reviewed selalu bertambah atau mengganti nomor versi yang tidak dicantumkan.
- U005, U078 v1 dan U079 v1 dilihat langsung pada kajian ini; hash file cocok dengan manifest yang dibaca. U001/U003/U004/U012/U035/U047/U072 pernah dilihat dalam ART_BOOK_GAP; pada buku ini dipakai sebagai rujukan bertanggal. ID lain di tabel adalah brief/metadata referensi, **belum review visual individual baru**.

| Kontrak | Referensi sprint / fungsi | Batas rujukan |
|---|---|---|
| AB-01 | U005 tubuh, U010 face/hair, U012 ekspresi/gestur. | Pose sheet bukan klip, timing, blend atau event frame. |
| AB-02 | U028–035 bangunan/jalan/dressing, U043–050 farm/industri, U053–055 harbor. | Kit/ilustrasi tidak menentukan kepadatan town procedural atau akses nav. |
| AB-04 | U003 day/dusk/night, U047 orchard musim, U079 cuaca/empat musim. | U079 v1, 1774×887, memperlihatkan tempat farm yang sama dengan variasi musim/cuaca/cahaya; bukan kalender atau weather engine. |
| AB-05 pendukung | U078 v1, 1536×1024 RGBA: debu, batu, air, percikan, hati, !, not, zzz. | Shape painted dengan glow/gradasi bukan particle system/flipbook/sprite runtime; alpha/gutter/mips perlu QA jika kelak diekstrak. Proof awal memakai feedback existing. |
| AB-06 | U003/U035/U046/U050/U056 memberi konteks tempat/aktivitas. | Tidak ada audio delivery dari PNG sprint. Cue audio adalah spesifikasi terpisah. |
| AB-07 | U004 skala, U005/U006 adult/farmer, U035 furnitur jalan, U037–041 interior, U056/U059 kendaraan, U072–075 military. | U005 dilihat ulang, 1536×1024: depan/belakang/profil pria/wanita dan variasi umur; ukuran meter/rasio final belum diukur. U072 lineup bukan sembilan rig-ready turnaround. |
| AB-08/09 | U002/U036/U042/U055/U064 atlas; U020–027 texture candidates. | Atlas referensi bukan UV atlas; PNG kecil bukan bukti RAM/VRAM/payload rendah. |

Refresh sebelum produksi: catat manifest hash/timestamp, produced/remaining, status/versi dan replacement per ID. Perubahan U004/U005/U012 mengulang gate rig/contact; U072–075 mengulang class/weapon/portrait gate; U078/U079 mengulang alpha/feedback/lighting. Sheet **future** (station, koloni, gua/POI/budaya tertentu) tetap konsep ekspansi. Gas giant non-landable; tidak menambah flora/warga pada ice/lava/barren tanpa world/biome policy. Produksi PNG selesai tidak sama dengan art approval, runtime-ready atau milestone M3 selesai.

Tautan gambar utama read-only: [U001 — art bible](/Users/mikelrisyad/Developer/globe/output/universe-art-sprint/images/U001-art-bible-universe.png), [U003 — cahaya](/Users/mikelrisyad/Developer/globe/output/universe-art-sprint/images/U003-cahaya-dan-atmosfer-dasar.png), [U004 — skala](/Users/mikelrisyad/Developer/globe/output/universe-art-sprint/images/U004-panduan-skala-lintas-mode.png), [U005 — body](/Users/mikelrisyad/Developer/globe/output/universe-art-sprint/images/U005-badan-dasar-dan-proporsi.png), [U012 — gestur](/Users/mikelrisyad/Developer/globe/output/universe-art-sprint/images/U012-ekspresi-dan-gestur-interaksi.png), [U035 — dressing](/Users/mikelrisyad/Developer/globe/output/universe-art-sprint/images/U035-street-furniture-dan-dekorasi.png), [U047 — orchard/musim](/Users/mikelrisyad/Developer/globe/output/universe-art-sprint/images/U047-orchard-dan-variasi-musim-farm.png), [U072 — hero](/Users/mikelrisyad/Developer/globe/output/universe-art-sprint/images/U072-roster-sembilan-hero.png), [U078 — feedback](/Users/mikelrisyad/Developer/globe/output/universe-art-sprint/images/U078-shape-efek-dan-feedback.png), [U079 — cuaca](/Users/mikelrisyad/Developer/globe/output/universe-art-sprint/images/U079-cuaca-dan-empat-musim.png). Path ini sumber sprint yang berubah berkala, bukan salinan aset di studio.

## 3. AB-01 — gerak, reaksi dan event

**Status parameter berikut: usulan.** Prinsip painted: gerak mempunyai sebab; warga tenang saat idle, berhenti sebelum menyapa, bereaksi lebih kuat terhadap kontak daripada wind. Jangan membuat seluruh properti bergerak seragam. Gunakan animasi existing/prosedural dahulu; exported clip baru mengikuti gate AB-08.

### State machine dan timing

State di bawah adalah state perilaku yang terlihat. `look`/`talk` dapat menjadi overlay saat `sit`, tetapi locomotion dan seat ownership tetap satu sumber. Jangan memakai dua controller untuk menulis root/bone yang sama tanpa mask/urutan yang jelas.

| State | Masuk → keluar | Timing / pose / event usulan |
|---|---|---|
| `idle` | Spawn/selesai stop/recovery → walk, look, talk atau sit request. | Napas sangat kecil; bob torso ≤0,01 m; jeda lirikan bervariasi 3–7 s. Tidak memicu audio/gesture setiap frame. |
| `walk` | Tujuan nav valid dan tidak seated → stop bila tujuan/interaksi/obstacle. | Kecepatan warga biasa 1,0–1,4 m/s, ramp awal/akhir 0,18–0,30 s. Phase gait berdasarkan jarak aktual dan panjang langkah; `lw.actor.step.contact` pada kontak kaki. Run existing tidak diganti paksa oleh batas warga. |
| `stop` | Walk harus berhenti → idle/look/talk; walk kembali bila aman. | Deceleration 0,20–0,35 s; speed ≤0,05 m/s sebelum body turn sapaan. Stop tidak teleport root ke anchor. Tidak ada footstep setelah kaki berhenti. |
| `look` | Pemain masuk radius sapaan atau fokus valid → talk/idle/walk. | Blend masuk 0,18 s, keluar 0,25 s; kepala yaw maksimal ±35°, pitch ±12°, body follow maksimal 120°/s. Hold 0,8–1,4 s jika tanpa dialog. Jika target di belakang, putar badan di titik aman; jangan memelintir leher. |
| `talk` | Greeting/dialog disahkan setelah stop/look → state sebelumnya ketika selesai/interrupted. | Satu sapaan 2,4 s; dialog aktif mengikuti UI, bukan timer paksa. Upper-body ringan, tidak wajib mouth animation bila rig existing tidak mendukung. `lw.actor.greet` sekali; `lw.actor.talk.start/end` untuk lifecycle. |
| `sit` | Seat socket/approach/stand point aman dan slot didapat → stay/talk overlay → stand lalu idle/walk. | Duduk 0,45 s; `lw.actor.seat.contact` pada 65% transisi. Berdiri 0,40 s; release slot setelah feet/stand point valid. Jika seat/stand path tidak aman, batalkan request sebelum bergerak. Offset hips lama bukan standar fitting tubuh baru. |

Transisi minimum: `idle→walk→stop→look→talk→idle/walk`; `idle/stop→sit→idle/walk`. Sit tidak diwajibkan pada proof warga pertama. Kembalikan rest/clip pose sebelum overlay; jangan mengalikan bone quaternion secara kumulatif sehingga pose drift. Town `animateTownPerson` sudah memisahkan clip pose dan rest overlays; adapter baru perlu menjaga urutan tersebut.

**Sapaan awal:** radius masuk 2,3 m, keluar 3,6 m; cooldown 15 s **waktu aktif sesi**, satu sapaan per approach. Setelah meninggalkan radius exit, approach baru dapat menyapa jika cooldown selesai. Gunakan hysteresis agar berjalan di tepi radius tidak spam. Sapaan tidak mengintersep prompt E pintu/perabot; pada proof pertama cukup greeting bubble otomatis. Drive tidak memicu sapaan dekat yang membuat NPC mengejar kendaraan.

### Interrupt priority

| Prioritas, lebih tinggi menang | Aturan |
|---|---|
| 100 — scene exit/dispose/invalid actor | Hentikan visual/audio, lepas seat/target reference. Jangan membatalkan write save yang sudah dimulai atau mengulangnya sebagai reaksi. |
| Pause/background gate | Bekukan timer pose/interaksi pendek dan audio; tidak menjalankan antrean sapaan/footstep selama tidak aktif. Bukan state locomotion baru dan tidak mengganti clock offline existing. |
| 90 — input/route utama pemain | Tindakan pemain dan masuk/keluar rumah mengalahkan greeting kosmetik. NPC tidak menahan perpindahan mode. |
| 85 — keselamatan nav/anchor | Footing/seat/stand point invalid → stop/fallback. Tidak memaksa pose masuk collider demi timing. |
| 80 — interaksi dialog/sit yang disahkan | Mengalahkan ambient look/wander; dialog boleh selesai/cancel sesuai UI. |
| 40 — greeting proximity | Stop/look/talk singkat; pemain menjauh → release halus. |
| 20 — rute ambient | Lanjut ke tujuan valid setelah reaksi; tidak mereset identitas/outfit karena berganti pool. |
| 10 — idle look/wind | Garnish; dapat dikurangi Hemat tanpa perubahan state permainan. |

Interrupt **sebelum** contact event tidak memberi akibat kontak. Interrupt **sesudah** contact tidak mengulang/menarik balik state gameplay yang sudah diterapkan. Benturan kendaraan bukan izin menambahkan damage/flee simulation; preserve perilaku Town yang sudah dipilih.

### Registry event dan payload

Semua ID `lw.*` berikut **usulan baru**, bukan export/event yang diklaim sudah ada. Event misi existing (`enter_house`, `light_on`, `place_item`, dll.) tetap ada. Adapter hanya memetakan aksi nyata ke feedback; tidak memanggil misi lagi karena animasi dimainkan.

| Event ID usulan | Makna / emission gate | Konsumen |
|---|---|---|
| `lw.actor.state.enter` | Perubahan state, bukan tick setiap frame. | Trace/QA; tidak otomatis bunyi. |
| `lw.actor.step.contact` | Kaki melewati fase contact berdasarkan gerak aktual. | Footstep, jejak kosmetik bila ada. |
| `lw.actor.greet` | Greeting disahkan; satu `interactionId` per approach yang lolos cooldown. | Bubble, gesture/look, cue ringan opsional. |
| `lw.actor.talk.start` / `lw.actor.talk.end` | Awal/akhir interaksi dan alasan end: selesai/cancel/exit. | Ducking/pose/UI lifecycle. |
| `lw.actor.seat.contact` / `lw.actor.seat.release` | Kontak seat/berdiri valid; bukan setiap frame sit. | Pose/cue sit/slot lifecycle. |
| `lw.env.grass.contact` / `lw.env.prop.contact` | Mulai kontak lokal dengan vegetation/prop eligible. | Push/bend/recovery; tidak mengubah collider/resources. |
| `lw.env.contact.recovered` | Properti kembali ke rest band setelah kontak. | QA; tidak wajib audio. |
| `lw.object.action.contact` | Kontak grab/release/switch/door dari aksi existing yang berhasil. | One-shot/VFX; aksi gameplay tetap milik modul asal. |
| `lw.scene.enter` / `lw.scene.exit` | Route transition committed/dispose, bukan setiap frame load. | Ambience/music ownership. |
| `lw.presentation.time.changed` / `lw.presentation.weather.changed` | Preset/phase presentation berubah. | Palet/ambience; bukan panen/economy tick. |
| `lw.save.confirmed` / `lw.save.failed` | Hasil persist yang eksplisit, bukan resolve Promise saja. | Status UI/cue; detail gate mengikuti M2_UX_SPEC. |
| `lw.journey.completed` | Restore J6 benar dan done disahkan. | Selebrasi/fanfare sekali. |

Payload minimum: `eventId`, `instanceId` unik, `worldId`, `sceneId`, `actorId`/`targetId` jika relevan, `interactionId`, `phase`, `worldTime`, `position` `{x,y,z}` dalam meter **Town-local**, `surface`/`action` bila diperlukan. `sceneId` membedakan lifecycle kunjungan; jangan hanya mengandalkan nomor frame. Sequence lokal per emitter cukup untuk dedup sesi; token persisted Journey tetap milik Journey. Event tak punya actor memakai actorId null secara eksplisit.

Event contact memakai crossing fase (`previous < contact ≤ current`), tidak pemeriksaan `frame === N`. Pada 30/60 FPS event tetap sekali walau frame melompati titik kontak. Setelah pause/reload/time skip, pulihkan state lalu mulai animasi pendek baru bila perlu; jangan memutar semua efek yang terlewat. Gameplay contact punya owner tunggal; penerima audio/VFX tidak menulis save.

**Gate AB-01:** replay 30 dan 60 FPS, 20 approach/exit, interrupt sebelum/sesudah contact, pause 10 s, route exit dan reload. Nol event contact/celebration ganda, nol greeting di luar gate; contact timing berbeda maksimal satu frame 30 FPS (≈33 ms). Ukur foot sliding saat planted stance ≤0,03 m dan tidak ada snap root >0,05 m yang bukan teleport route existing. Video + event trace diperlukan; screenshot saja tidak membuktikan timing.

## 4. AB-02 — resep district dan clearance

**Status: usulan**, dengan prinsip situs/akses dan palet dari ART_DIRECTION. Site reservations, jalan, bangunan/portal/nav canonical diproses dahulu, kemudian dressing. “Padat” berarti fungsi lokasi mudah dibaca, bukan menutup setiap ruang kosong. Aturan lembah “tidak ada kosong >8 m” tidak diterapkan ke seluruh kota/planet.

Unit resep: **100 m² area yang boleh didress**, setelah footprint bangunan, jalan/akses, air dan protected reservations dikurangi. Cluster = 2–4 props kecil bertema, dengan footprint visual gabungan terukur. Angka bukan jumlah mesh wajib; kandidat yang tak lolos situs dihilangkan dengan bounded retries, bukan dipaksa masuk.

| District | Resep awal per 100 m² eligible | Komposisi/warna / batas |
|---|---|---|
| Residential rural/fantasy | 1–2 cluster: pot/bunga + kayu/alat; 1 massa pohon/semak bila tapak muat; ≤20% coverage footprint dressing. | Pagar/kebun mengikuti batas lot; pintu terlihat, atap dominan terakota, bunga aksen terbatas. U028/U035/U038/U043. |
| Residential modern | 1 cluster: planter/bin/bangku; 1 massa pohon atau hedge; ≤15% coverage. | Fasad/lajur akses tenang, satu aksen per blok. Tidak menempel kayu/farm props pada semua apartemen. U030/U032/U035/U039. |
| Retail/pasar | 2–3 cluster: stall/display/bin/awning, ≤25% coverage. | Cluster melekat frontage atau edge plaza, pusat sirkulasi bebas; storefront/tujuan terlihat. U029/U031/U035/U048. |
| Civic/plaza/taman | 1 focal cluster per pocket; 1–2 bangku/planter dan 1 massa canopy bila eligible; ≤20% coverage. | Sisakan ruang bernapas dan sightline landmark. Plaza hanya jika situs generator menyediakannya; bukan plaza wajib baru. U029/U031/U035. |
| Harbor/logistik | 1–2 cluster crate/barrel/rope/warehouse trace, ≤20% coverage. | Bongkar-muat di tepi fasilitas; pier, akses air/darat dan lane kendaraan bebas. Tidak scatter cargo ke air/ramp. U050/U052–055. |
| Farm/orchard | 1 cluster alat/hay/fence-edge; tanaman mengikuti field/orchard estate existing, ≤15% coverage untuk **props tambahan**. | Field row/crop bukan dressing RNG umum. Footpath, shipping/akses alat jelas; tidak menghitung seluruh ladang sebagai clutter prop. U043–047. |
| Industri/extraction | 1–2 cluster bahan/alat/crate, ≤15% coverage. | Barang berhubungan dengan fasilitas/material lokal; jalur kerja dan truck turning envelope bebas. U048–050. |
| Outskirts/ruang tenang | 0–1 cluster, ≤10% coverage; jarak massa vegetasi lebih renggang. | Lapangan, pantai dan bukaan horizon boleh kosong. Vegetasi hanya pada biome/slope/moisture yang mendukung. U013–018. |

Density diturunkan Hemat pada garnish/vegetasi, bukan frontage fungsi, pintu, pohon/prop yang punya collider canonical atau identity. Stream RNG per domain/district; rendering cap tidak mengonsumsi stream yang menentukan layout/rute/warga. Palette family memakai token; jumlah warna aksen dibatasi, bukan tint acak tiap objek.

### Area terlarang

| Reservation / clearance | Kontrak |
|---|---|
| **Approach pintu** | Pertahankan kapsul clearance existing dari approach ke titik 2,5 m di depan pintu, radius 0,75 m (`doorClearance.js`). Dilarang props/vegetasi padat di dalamnya; footprint visual juga dicek, bukan pivot saja. Ini safety corridor, bukan radius fisik kepala/mesh adult. |
| **Pedestrian network/footway** | Pertahankan swept volume walker/nav existing + margin kosmetik 0,10 m di tepinya. Tidak menganggap lebar texture jalan sebagai clearance collider. `pavementWidth` existing modern 1,8 m/rural 0,6 m tidak diubah global dalam proof. |
| **Kendaraan** | Lane, wheel/body sweep, simpang dan turning envelope existing bebas; clearance driver exit/stand point juga dilindungi. Parked vehicle bukan alasan menutup pintu rumah awal. |
| **Seat/interaksi** | Seat footprint, approach serta stand point diberi reservation; usulan stand pocket radius 0,65 m bila sesuai collider aktual. Tidak scatter planter di depan kursi atau meja yang dipakai. |
| **Air/relief/infrastruktur** | Waterbody, pier/deck alignment, abutment, ramp/tangga, retaining wall, field/farm reservations dan landmark sightline dilindungi. Mask biome/slope diperiksa sebelum spawn. |
| **Tujuan M2** | Marker/arc ambang adalah overlay visual; tidak menjadi obstacle. Dalam 6 m sekitar rumah awal, target pintu dan prompt harus terlihat pada kamera e2e; jangan meletakkan canopy/awning yang menutup seluruh entrance view. |

Gate AB-02: seed sweep minimal 10 fixture nyata yang dibangun jalur Town, termasuk flat/coastal/hillside yang tersedia; **0 overlap** dressing baru dengan reservations terlarang, **0 portal/rute M2 putus**. Normal/Hemat memiliki ID/footprint/collider/route sama. Kamera/seed/time sama untuk capture sebelum/sesudah. Bila layout/collider canonical berubah, perlu versi/migrasi + old-save fixture; garnish visual-only tidak reroll kota.

## 5. AB-04 — clock, cahaya, musim dan cuaca

**Keputusan sementara lead:** pakai [WorldClock](../../src/world/worldClock.js) dan `world.now()` existing. Fakta source: waktu real-time terus maju ketika sesi tertutup, menu pause membekukan world clock, skip tidur menambah offset tersimpan. `world.sunAt(planet, frame)` memakai clock/rotasi planet; Town sky menghasilkan `night` dan audio menerima `setNight`. Buku ini tidak membuat jam lokal persistent baru untuk tiap mode.

| Domain | Kontrak usulan yang menjaga clock existing |
|---|---|
| **Waktu dunia** | Clock tunggal untuk posisi orbit/sunAt dan identitas fase tempat. Route reload tidak mereset dawn. Planet dengan lokasi/rotasi berbeda boleh punya arah matahari berbeda pada worldTime yang sama. |
| **Timing pose pendek** | Gunakan elapsed aktif dari dt untuk blend/contact/cooldown sapaan. Ini timer aksi kosmetik, bukan world calendar baru. Pause/background membekukan aksi pendek; resume mereset catch-up cosmetic. |
| **Fase siang/malam** | Turunkan dari sun elevation/night factor existing, bukan membagi jam OS menjadi pagi/siang. Usulan label night aktif ≥0,60, keluar ≤0,40 untuk hysteresis; lighting factor tetap kontinu. Dawn/dusk mengikuti arah perubahan sun elevation. |
| **Visual transition** | Palet/layer cosmetic blend 2–4 s saat preset berubah; underlying sun/clock tetap otoritatif. Look-dev manual override hanya fixture/debug dengan label eksplisit, tidak diam-diam menulis clock pemain. |
| **Musim** | Preset presentasi per biome—palet daun/bunga/ground/sky; default tidak berubah otomatis. Tidak memindahkan parcel/nav, menambah kalender panen, mengubah demand Trade atau umur warga. Collider pohon tetap jika bentuk canopy presentasi berubah. |
| **Cuaca** | Preset clear/rain/fog/snow hanya jika eligible; material wet/tint/wind/particle/ambience ringan. Tidak memberi slippery physics, flood, resource regeneration atau crop watering gameplay tanpa task/keputusan baru. |
| **Kembali/reload/skip waktu** | Evaluasi current worldTime lalu tampilkan keadaan sekarang. Tidak mensimulasikan semua greeting/partikel/audio yang terlewat. State lampu J5 tetap on/off tersimpan; brightness alami yang berubah bukan gagal restore. |

Eligibility awal **usulan**: Terran temperate boleh empat palet musim dan clear/rain/fog; ocean tropis memakai wet/dry visual dan tidak otomatis winter snow; desert dry/wind/dust tanpa orchard universal; ice boleh snow/fog; lava/barren tidak diberi bunga/warga/farm karena sheet contoh; gas hanya atmosfer/orbit. Eligibility final mengikuti biome/planet rules, bukan warna semata. Paket pertama belum menambahkan season/weather scheduler.

Gate AB-04: injected/test clock pause 10 s → worldTime delta ≤0,01 s; simulasi offline gap 30 s → waktu maju sesuai kebijakan existing, tanpa burst replay; route switch dengan waktu fixture sama → sun/local phase konsisten. Capture siang/senja/malam pada rumah M2; pintu/prompt tetap terbaca Low/post off. Preset season/weather tidak mengubah hash data layout/nav/ID/save gameplay.

## 6. AB-06 — event audio cue dan mix

**Usulan kontrak cue**, memakai [core/audio.js](../../src/core/audio.js) yang sudah mensintesis ambience, motif musik, SFX dan kendaraan. Rujukan PNG hanya konteks visual. Tidak mensyaratkan voice acting, sample baru, paid generator atau bank lagu baru.

Prioritas mix: aksi/prompt penting pemain → dialog/sapaan → mesin/aktivitas dekat → ambience → musik. UI mute/pause/audio unlock existing dihormati. Posisi audio Town-local memerlukan transform/listener adapter yang eksplisit; SFX existing tidak diklaim sudah spatial/voice-capped hanya karena memiliki nama.

| Event / cue ID usulan | Mapping existing atau fallback | Envelope/jarak/cooldown awal usulan |
|---|---|---|
| `lw.actor.step.contact` → `cue.step.<surface>` | `sfx('step', {surface, run})`. Grass/wood tersedia; permukaan lain fallback generic. | Foot-contact cadence; minimum 0,12 s per actor. Near audible sampai 12 m, attenuation dari 2 m. Jika footsteps existing sudah dipanggil, adapter tidak memanggil kedua kali. |
| `lw.object.action.contact`, door → `cue.door` | `sfx('door')`. | Satu per interaksi sukses, cooldown 0,4 s, sampai 10 m. Failed enter tidak membuat door success cue. |
| Switch lampu → `cue.switch` | `sfx('switch')`. | Kontak switch, cooldown 0,15 s, sampai 6 m. Cue aksi bukan konfirmasi save. |
| Grab/release item → `cue.pickup` / `cue.drop` | `sfx('pickup')` / `sfx('drop')`. | Setelah aksi valid, cooldown 0,15 s per target; sampai 8 m. Tidak berbunyi saat placement ditolak. |
| `lw.actor.seat.contact` → `cue.sit` | `sfx('sit')`. | Sekali saat kontak, sampai 6 m, cooldown 0,5 s. |
| Driver entry/engine → `cue.carDoor` / `cue.ignition` | `sfx('carDoor')`, `sfx('ignition')`, voice engine existing. | Sesuai entry/start nyata; continuous engine punya satu owner sampai exit. Tidak membuat mesin tambahan untuk setiap frame drive. |
| `lw.actor.greet` → `cue.greet` | Opsional `sfx('tick')` sangat pelan; **diam adalah fallback yang sah**. Tidak memakai efek pickup sebagai suara ucapan. | Maksimal sekali per approach/cooldown 15 s, sampai 5 m. Bubble tetap memberi informasi tanpa suara; tidak menjanjikan suara manusia. |
| Grass/prop contact → `cue.contact` | Reuse grass footstep; bush rustle baru boleh synth proof kemudian. | Tidak menambah rustle setiap frame deformasi; coalesce per actor/pocket ≥0,3 s. Proof rumput boleh tanpa suara tambahan. |
| `lw.scene.enter/exit` → `cue.scene.<kind>` | `setScene(space/planet/town/interior)` existing. | Crossfade kandidat 0,4–0,8 s; town→interior motif/chord phase dipertahankan, bukan restart lagu setiap pintu. |
| `lw.presentation.time.changed` → `cue.ambience.day/night` | `setNight` / critter ambience existing. | Birds/crickets dengan jarak/interval, kandidat random 8–20 s per zone. Jangan mengubah musik tiap hover tile. |
| Weather preset → `cue.weather.<preset>` | Modifikasi noise/wind bed synth bila dibutuhkan; jika belum tersedia gunakan bed existing. | Fade 2–4 s; satu bed/scene. Tidak menambah sample rain yang diunduh untuk proof awal. |
| `lw.save.confirmed/failed` → `cue.save` / `cue.error` | Tidak wajib suara; visual M2 primer. Tick lembut hanya bila tidak menduplikasi cue switch. | Sekali per hasil write yang baru; tidak menyembunyikan error dengan fanfare. |
| `lw.journey.completed` → `cue.complete` | Fanfare existing melalui lifecycle selebrasi. | Sekali per done yang disahkan; tidak dimainkan lagi pada reload/replayed event. |

Kandidat Hemat: maksimum **8 one-shot/positional voice bersamaan**, terpisah **1 ambience bed + 1 music arrangement + 1 engine aktif**; node oscillator/layer internal dicatat juga, bukan dihitung sebagai satu node saja. Priority voice yang ditolak hanya mengurangi garnish, tidak menolak state gameplay. Duck musik sekitar −6 dB saat dialog aktif, attack 0,10 s/release 0,35 s; batasi master peak ≤−1 dBFS dengan metering, tanpa clipping. Reset/stop voices saat scene dispose; jangan memainkan antrean cue lama setelah audio unlock.

Gate AB-06: listening pass 10 menit lintas Space/Planet/Town/Interior, dengan 20 door/scene transitions; nol cue ganda/click/voice leak dan nol suara ketika muted/paused. Periksa sebelum dan sesudah unlock, background/resume serta close/revisit. AudioContext clock untuk scheduling musik, bukan dt frame. Subtitle/prompt tetap cukup saat mute. Semua batas envelope/mix merupakan usulan dan perlu uji dengar, bukan loudness final yang sudah diverifikasi.

## 7. AB-07 — skala, siluet, pivot, socket dan LOD

### Usulan tinggi meter: 1,65 m nominal adult

**Disetujui:** rasio dewasa 4,5–5 kepala. **Usulan:** height body nominal **1,65 m**, variasi adult awal **1,55–1,75 m** yang tetap rig-compatible, bukan label pria/wanita yang wajib lebih tinggi/rendah. Ukur tegak netral dari sole ke crown kepala anatomis; hair/headgear tercatat terpisah sebagai visual envelope. Head unit diukur crown→chin, bukan tinggi bounding box rambut. Pada anchor 4,75, head unit nominal ≈**0,347 m** (1,65 / 4,75); angka ini matematis, bukan hasil pengukuran U005.

Alasan: cukup mendekati referensi karakter sekitar 1,8 m pada ART_DIRECTION lama untuk menjaga lingkungan meter, tetapi memberi massa kepala lebih besar dan tubuh kompak tanpa menjadikan seluruh kota miniatur. Valley mencatat prototype 1,35 m; itu tidak otomatis menjadi tinggi adult seluruh Universe. Pilihan 1,65 m mengurangi selisih dengan skala bangunan existing sambil membuka uji fitting. Ini titik awal art, bukan antropometri realistis dan **belum disahkan lead/pengguna**.

Usulan eye height 1,45–1,50 m, shoulder width 0,48–0,56 m untuk body proof netral; keduanya ditentukan ulang dari mesh final. Home walk camera existing 1,6 m dan asumsi v5 `head / 1,545`/hips offset `0,48×bodyScale` perlu audit saat migrasi, bukan disalin sebagai proporsi baru. Uniform scaling rig v5 tidak mengubah head/body ratio. Tiga proof §10 tetap menggunakan ukuran rig existing; fitting adult baru adalah task produksi terpisah.

### Pivot/socket dan kontak

Usulan standar runtime meter, **+Y up, +Z forward**, origin di tengah footprint/sole plane untuk actor dan prop yang berdiri. Blender/glTF conversion ditulis eksplisit; tidak menganggap authoring axis selalu sama. Root controller dipisah dari hips bone; apply transform tidak menggandakan scale. Setiap socket menyimpan local position + orientation + semantic owner dan diuji setelah transform/LOD.

| Family | Pivot/socket minimum usulan | Ukuran/contact gate usulan |
|---|---|---|
| Actor | Root-ground, hips/rest bones, `eye`, `hand.L/R.grip`, `foot.L/R.contact`; optional carry socket sesuai jenis aksi. | Stance foot-ground error ≤0,02 m pada fixture; ukuran/envelope measured. Prop tidak menembus kepala/tangan. Carry di atas kepala adalah pilihan aksi Valley, bukan default semua warga. |
| Door/building | Footprint vs visual bounds terpisah; `door.threshold`, `door.approach`, front yaw, portal plane/clear volume. | Target baru opening clear ≈2,10 m tinggi dan 0,95–1,10 m lebar; **bukan klaim ukuran semua pintu existing**. Harus ≥envelope actor + head margin 0,10 m dan shoulder margin 0,12 m tiap sisi, serta memenuhi proxy/portal actual yang mungkin lebih besar. Jangan mengecilkan collider/nav global agar angka nominal lolos. |
| Chair/bench/sofa | `seat.pelvis`, `seat.forward`, foot targets, approach/stand point. | Target seat surface 0,42–0,48 m; pelvis-seat gap/penetration ≤0,02 m; foot contact ≤0,02 m, lutut tak menembus meja/sandaran. Postur di-fit per seat, bukan satu lift offset untuk semua kit. |
| Table/tool | Surface anchor, `hand.grab`, item place/clear zone; tool handle/contact tip. | Target tabletop 0,70–0,78 m sebagai awal fitting; hand-grip error ≤0,03 m; placement tidak menutup pintu. Perubahan dimensi props existing perlu gate sendiri. |
| Bed | Lying pelvis/head/feet dan stand point terpisah. | Actor envelope muat tanpa head/foot clipping >0,02 m; bangun punya titik aman. Tidak masuk paket proof awal. |
| Vehicle | Body origin/forward existing, axle/wheel axis, driver pelvis/feet/hand-wheel/eye, entry/exit, roof/hatch envelope. | Seated headroom ≥0,05 m dari envelope; tangan ke kemudi ≤0,03 m, kaki ke footwell/pedal valid. Sedan/cart/rover berbeda socket; recipe/wheel/physics tetap sebelum fitting disetujui. |
| Military/hero | Hand grip/support/muzzle, head/helmet/hair, class kit/pack, stance roots. | Semua 9 hero, 5 kelas, 2 faksi: aim/crouch/kneel/fall/cover dan portraits. Visual proporsi tidak mengubah hitbox/weakpoint/combat rules tanpa keputusan eksplisit. U072–075 adalah referensi, bukan rig siap swap. |

Semua ukuran di atas untuk proof/authoring baru; inventory measured existing menjadi pembanding. Actual portal walkthrough tetap acceptance, karena envelope ukuran saja tidak membuktikan navigasi/camera aman. Uji paling sedikit satu pintu rumah awal, satu applied Home, chair/bench/sofa, sedan/cart/rover sebelum migrasi body global. Ambil front/profile/3⁄4 untuk melihat kontak; render model berdiri saja tidak cukup.

### Siluet/LOD dan kontinuitas ruang

**Usulan bands awal**, ukuran **pixel pada drawing buffer** dan bbox projected object; jangan menyamakan dengan CSS px marker. Actor near ≥96 px tinggi, mid 40–96 px, far <40 px; hysteresis 15%, minimum residence 0,25 s. Avatar dan actor interaksi boleh dipin near selama interaksi dengan budget jelas. Jarak meter cadangan perlu menyesuaikan FOV/orthographic camera, bukan satu angka universal.

| Family | Near / mid / far yang harus dipertahankan |
|---|---|
| Adult/NPC | Near: face/gesture/hand contact; mid: hair/outfit/body ratio dan arah kepala; far: body/outfit silhouette dan movement. Proxy far adalah kandidat baru; Town pool logical existing tidak diklaim sudah menampilkan seluruh crowd jauh. |
| Bangunan | Atap/volume/entrance/landmark tetap; trim/bevel/interior garnish turun. Collider/portal tidak mengikuti decimation. |
| Vegetasi | Canopy/trunk dan biome mass tetap; leaves/grass density/shadow turun. Collider pohon dan farm row tidak pindah. Contact bend hanya dekat, rest silhouette jauh sama. |
| Kendaraan/kelas military | Body/roof/wheels/kelas-weapon/pack silhouette dan driver sockets tetap; detail panel/trim kecil turun. Weakpoint tank dan cover affordance tetap sesuai gameplay. |
| Wayfinding | House shape/label/arah tidak hilang: 28 CSS px door badge, 16 px minimap pin, warna/stroke dari M2_UX_SPEC. Marker UI bukan LOD mesh actor. |

LOD0/1/2 baru membawa bounds/pivot/socket/collider yang stabil; silhouette width/height delta target ≤5% pada camera pembanding. Tempat yang sama mempertahankan identitas landmark, coast/access dan arah pintu Space→Planet→Town→Interior. Globe boleh memakai abstraksi hex-scale; tidak memaksa meter Town ke orbit. Gate: capture pasangan empat skala, Normal/Hemat siang/malam, orbit camera/zoom crossing bands tanpa thrash atau socket jump; resource/pool assignment tidak mengubah appearance actorId.

## 8. AB-08 — rantai reference sampai QA

**Usulan kontrak handoff per asset family.** Source editable dapat berupa `.blend` atau generator/data yang benar-benar cukup untuk regenerasi. PNG concept belum merupakan mesh/rig/texture runtime. Atlas sheet dengan swatch/label tidak dipakai sebagai UV atlas; texture candidates U020–027 perlu repeat/lighting/map QA.

| Tahap / status | Fields dan artefak yang wajib dibawa | Gate |
|---|---|---|
| `reference-reviewed` | Sprint ID/version/hash, image/prompt, provenance/rights, coverage current/mixed/future, approval note. | Concept review untuk fungsi yang dimaksud, bukan approval runtime. |
| `production-spec` | Stable assetId/family, meter/bounds, pivot/front/socket/footprint/collider, material role, profile, dependencies; actor ratio/bind/parts/clip-event contract. | Shape/size/contact proof accepted sebelum membangun seluruh batch. |
| `editable-master` | Source path + hash, tool version, generator parameters/seed, seluruh input master/paint/rig/actions. | Buka/build ulang dari sumber lengkap; input eksternal VRoid/UAL/scratch yang dibutuhkan v5 dicatat, tidak dianggap tersedia karena script ada. Blender/tool belum diverifikasi pada task ini. |
| `export-staged` | Runtime path/hash, GLB mesh attributes/UV/normals/skin/clips/material slots/maps, measured tris/LOD/bytes; audio codec/channels/rate/loop jika sample. | Node materials dibake sesuai loader; indexed mesh dan warna/alpha/data-map semantics tidak hilang. |
| `loader-integrated` | `ASSET_FILES`/registry, loader/module, profile variants, cache/refcount/dispose ownership, fallback. | Albedo/emissive sRGB; normal/masks/data non-color, v5 cloth palette-data jangan diperlakukan albedo. Alpha/gutters/mips/repeat 4×4 lolos. KTX2/meshopt perlu transcode/decode proof, bukan klaim dari nama format. |
| `runtime-verified` | Fixture IDs/camera/time/tier/device/build, screenshots/video, events, transfer/resident/peak/perf dan regeneration evidence. | Engine scene siang/malam/Low, contact/LOD, save/revisit, 20 switches; visual/source/QA historis/runtime baru dipisah. |

Contoh **existing chain yang perlu ditelusuri, bukan perintah build**: U005/U012 reference → calon family `town-adult` → v5/generator/rig inputs atau adapter yang dipilih → `soldier_v5_m/f.glb` + cloth/head maps + `town_walk_m/f.glb` → [assetManifest](../../src/render/assetManifest.js) → [skirmishPeople](../../src/modes/town/people/skirmishPeople.js)/[vcSoldiers](../../src/skirmish/units/vcSoldiers.js) → door/seat/drive/hero QA. PNG tidak otomatis mengganti file-file ini. Source walk `.blend` tersendiri membantu editable animation, bukan bukti semua body input sudah direproduksi.

Existing family lain: town refresh/scenery/environment kit → textured/asset loaders; Home generator/kit → `homeBuilder`; Valley generators/pivot GLB → `actors`/runtime `chunkyPeople` + `anim/clips.js`; synth cue parameters → `core/audio.js`. Catat modifier runtime yang membentuk rig/normal/material agar ekspor mentah tidak disalahartikan sebagai hasil engine.

Proof tanpa aset baru memakai chain **reference ID → feature ID/version → source module → existing asset dependencies → runtime QA**; tahap export dapat ditandai **tidak berlaku, file aset unchanged** dengan hash dependency. Ini tidak menghapus kebutuhan mencatat build/fixture. Jangan menjalankan generator lintas root: `build_town_space.py` memiliki risiko output ke checkout utama menurut mandat studio.

## 9. AB-09 — budget Hemat kandidat

**Disetujui:** minimum iGPU/RAM 8 GB/30 FPS. **Seluruh ceiling rinci di bawah: usulan.** [Laporan resource 9 Oktober](../WEBGAME_RESOURCE_PERFORMANCE_REPORT_2026_10_09.md) dan AA plan memberi starting point, bukan bukti tercapai. Empat atlas v5 RGBA8 2048² setara 64 MiB base / ≈85,33 MiB bermip menurut kalkulasi format ST-02, bukan telemetry VRAM. Low/Pixel tidak otomatis mengecilkan seluruh graph aset atau loader.

| Kandidat ceiling | Cara ukur / minimum kualitas |
|---|---|
| Internal buffer hingga sekitar 1280×720, target 30 FPS; frame p95 ≤40 ms/p99 ≤50 ms setelah warmup. | Traversal visible per route, catat CPU/GPU/present cadence dan input. Governor yang masih memakai budget 60 FPS harus mendapat policy Hemat; jangan degrade terus hanya karena 30 FPS sudah tercapai. |
| Tab steady ≤500 MiB, peak ≤750 MiB; estimated resource GPU steady ≤160 MiB, peak ≤256 MiB. | Pisahkan heap JS/process/shared browser dan estimate texture/geometry/render targets. Counter unavailable → N/A + metode, bukan fabricated VRAM. |
| Cold sebelum playable ≤10 MiB compressed, tambahan Town ≤15 MiB. | Network actual per route termasuk decoder/maps/interior, bukan ukuran semua `public/`. |
| Adult candidate ≤6k tris near, ≤2k mid, proxy far; shared atlas 512–1024² bila face/kelas lolos. | Produksi body baru kemudian. Rig existing pada proof awal tidak di-decimate/di-resize tanpa gate; nominal ceiling bukan klaim jumlah tris saat ini. |
| Pool awal avatar + maksimum 4 NPC skinned near; maksimal 3 hewan near jika kelak dipakai. | Named actor memakai slot existing, bukan tambahan crowd tak terukur. Logical state/ID tetap ada saat tak dirender. |
| Contact pushers maksimal 4 Hemat, emitter lokal; VFX pool kandidat 128, ≤32 particle/contact event. | Prioritaskan pemain dan feedback penting; garnish boleh ditolak saat penuh. Proof awal tidak memerlukan particle pool baru. |
| 8 one-shot voices + ambience/music/engine ownership seperti AB-06. | Ukur synth node count dan CPU; priority drop bukan hapus gameplay. Sampel baru kelak ≤1–2 MiB compressed / decoded ≤12 MiB kandidat AA. |
| Tambahan visual slice ≤7 MiB dari baseline; tambahan texture resident kandidat ≤32 MiB untuk paket Hemat baru. | Bedakan delta vs total. Reference master tidak dikirim runtime, shared maps dihitung sekali; GPU compression dipilih setelah visual QA. |
| Stabilitas 30 menit +20 route switches. | Resource plateau, tidak ada growing listeners/voices/rig/material. Telusuri stall >100 ms, target kandidat ≤1/menit traversal. |

Kualitas wajib: pintu/target/label/avatar/alat/class silhouette dan feedback kontak terbaca tanpa bloom/shadow; worldId/layout/nav/collider/save sama lintas tier. Hemat menurunkan micro detail/outline tambahan/alpha overdraw, shadow, garnish dan cadence dekorasi jauh dahulu. Scene tidak dianggap murah hanya karena triangle sedikit atau PNG kecil. Valley log historis melewati target <80 calls; port seluruh look-dev tidak dijanjikan menghemat.

Fixture pengukuran: seed/subdivision/world/planet/city/building IDs, layout/schema/build, route, camera, worldTime, CSS viewport/drawing buffer/DPR, tier/style, browser/hardware, cold/warm cache, duration. M2 M1 Pro + throttle CPU 4× adalah **proxy**, bukan iGPU nyata. Benchmark visible dan playtest manusia terpisah. Acceptance perangkat minimum memerlukan laptop iGPU 8 GB nyata yang diidentifikasi; jika belum ada, tulis gate hardware belum diverifikasi.

## 10. Paket M3 pertama yang direkomendasikan

**Status: usulan, maksimum tiga proof.** Lead memilih dispatch setelah baseline M2 siap; produksi PNG/mesh/rig/audio baru bukan dependency proof. Setiap proof berada di belakang flag/setting eksperimen agar regresi bisa diisolasi. Jangan mengubah generatorVersion/layout atau rig bersama global demi proof visual.

### Proof 1 — rumput dekat tersibak oleh pemain

**Modul:** `town/render/groundCover.js` dan adapter posisi player; referensi Valley `world/grass.js`, U012/U078. Gunakan atlas/instanced sprites existing. GroundCover sudah wind-driven; tambahkan local bend yang mengikuti kontak pemain, bukan sistem rumput baru.

**Scope:** satu pocket vegetasi yang sudah ada sepanjang lintasan rumah M2. Radius pendorong awal 0,55 m, bend maksimum 25°/offset ujung ≤0,20 m, root tetap. Response attack 0,10 s, recovery menuju rest sekitar 0,8–1,2 s. Bounds culling menampung tambahan bend. Hanya vegetation eligible, bukan batu/jamur rigid atau seluruh pohon. Tidak menulis state wetness/crop/footprint.

**Acceptance:** pada walk di 30/60 FPS, displacement terlihat ≤100 ms setelah kontak; ≥80% rest pulih ≤0,8 s dan ≥95% ≤1,2 s setelah keluar. Uji 20 lintasan/pause/route switch: no residual bend/no missing sprites akibat culling, nol perubahan collider/layout/ID/save. **0 file/model/texture/audio baru, 0 draw calls tambahan** untuk bend pada batch existing; p95 update CPU delta ≤0,30 ms dan GPU delta ≤1,0 ms pada fixture pembanding (atau GPU N/A). Low tetap punya contoh kontak yang terlihat; reduced motion boleh mengurangi wind ambient, bukan menghilangkan feedback penting. Audio tambahan tidak wajib.

### Proof 2 — satu warga bernama menyapa

**Modul:** `town/navigation/PedestrianRoutes.js` + `town/people/skirmishPeople.js`/appearance/pool + overlay sapaan ringan. Referensi Valley `villagers.js`/`nav.js`, U007/U008/U012. Gunakan template/outfit/hair existing; satu slot NPC existing dipin ke identitas deterministik.

**Scope:** satu actorId stabil per dunia/kota/proof slot dan nama **usulan “Damar”** pada fixture Terran awal, bukan warga existing yang diklaim telah ada. Look dari seed actor, bukan seed pool. Anchor pada jaringan jalan valid di dekat lintasan M2 tetapi di luar clearance pintu/vehicle exit. Idle atau rute pendek existing; stop→look→sapaan ketika pemain walk mendekat. Bubble: **“Halo! Selamat datang di kota ini.”** Nama/kalimat masuk i18n saat implementasi. Tidak ada household/job/calendar atau claimed relationship persisten baru; reload mengembalikan identitas deterministik dan pose idle aman. Full dialogue/seat/face animation tidak diperlukan.

**Acceptance:** masuk 2,3 m → stop/look mulai ≤0,35 s, satu bubble 2,4 s; keluar 3,6 m → reaksi selesai/route dapat lanjut ≤0,5 s. Pada 20 approach/exit, jumlah greet sesuai cooldown 15 s dan tanpa double emit; actor/name/look sama sebelum/sesudah pool reassignment dan reload. Head yaw tidak melewati ±35°, tidak blocking prompt pintu/E. Named NPC menggunakan satu slot dari cap existing, **0 file aset baru**, model calls tidak bertambah dibanding NPC yang diganti; p95 update CPU delta ≤0,50 ms. Low, template-load failure dan scene exit tidak membuat floating bubble atau error yang memblokir Universe. Identity/restorasi actor bukan bukti household simulation.

### Proof 3 — malam hangat dan tujuan rumah tetap terbaca

**Modul:** `town/render/sky.js`, `paintedStyle.js`, `streetLighting.js`/environment uniforms, `src/art/palette.js` dan waypoint/HUD hasil M2 bila sudah tersedia. Referensi U003/U035/U079; desain marker mengikuti M2_UX_SPEC. Reuse material/geometry/pin existing; jangan mengganti shader semua mode sekaligus.

**Scope:** satu house-route fixture, day/dusk/night dari world clock/sunAt existing. Palet ambient malam dingin lembut dan entrance/window hangat, tetap satu painted family. Target memakai `ROOM_SCHEMES.house[0].trim` (`#f2b766`), paper `ROOM_SCHEMES.house[1].wall` (`#f6e3bc`), ink `MAP_COLORS.label` (`#1c2320`) dan outline `MAP_COLORS.outline` (`#1f2a24`). Nilai sRGB diproses color management existing; tidak dipakai sebagai linear RGB mentah. Tidak menambah lampu shadow/reflection pass, bloom wajib, season/weather scheduler atau blanket recolor semua building.

**Acceptance:** capture day/dusk/night pada camera fixture sama, 1280×720/DPR1/Low/post off. Door badge tetap 28 CSS px, outline 2 px, label teks contrast ≥4,5:1 dan glyph ≥3:1 pada pill; target terlihat, prompt E tidak tertutup, city/planet/door ID sama. Lampu J5 on/off dapat dibedakan dari beacon dekoratif dan restore M2 tetap benar. Panah/occlusion/minimap per spec M2 tidak regress. Tambahan maksimum **3 world draw calls** bila marker belum ada dalam baseline; jika sudah ada, target delta 0 untuk tuning warna. **0 file aset baru, 0 render pass/texture unik baru**, GPU p95 delta ≤0,5 ms atau N/A dengan frame timing. Pulse dimatikan Hemat/reduced-motion; waktu tidak direset tiap route.

### Gate gabungan dan urutan

Urutan usulan: **baseline/feature flags → Proof 1 → Proof 2 → Proof 3 → replay slice/perf/listening**. Bila M2 waypoint belum ada, Proof 3 dimulai dari palet/entrance existing dan integrasi marker menunggu modul M2; jangan membuat marker kedua yang bersaing. Proof 2 membutuhkan pool/actorId contract; bukan import koordinat Valley. AB-02/AB-07 menjadi guards, bukan alasan memproduksi batch dressing/body baru sebelum proof.

Gate gabungan pada fixture sama: p95 update CPU delta **≤1,0 ms**, GPU delta **≤2,0 ms** bila counter tersedia, frame p95 ≤40 ms/p99 ≤50 ms sebagai kandidat Hemat; nol page error dan `engine.lastError === null`, nol save/identity/portal regression, resource stabil setelah 20 switches. Jika baseline sendiri melampaui ceiling, laporkan baseline dan delta terpisah; jangan mengklaim certified Hemat dari proxy. Catat bytes kode tambahan dan resource dependency; **delta unduhan file aset = 0**, tetap ukur bundle karena source baru dapat menambah byte/compile cost.

Human review menilai: pemain melihat hubungan kontak→reaksi, warga menyapa tanpa menghalangi, dan rumah asal mudah dikenali malam. Capture/video/event trace, bukan diagnosis September atau FPS Valley, menjadi bukti M3. Lead menentukan final milestone/acceptance dan meng-commit; buku ini tidak mengubah board, RUNTIME atau membuat task ke pane lain.

## 11. Keputusan yang masih perlu disahkan dan serah-terima

Sebelum produksi body baru: sahkan 1,65 m/rentang adult, eye/collision envelope, rig/adapter dan contact fixtures. Sebelum perluasan dunia hidup: sahkan resep density, biome presentation eligibility dan actor/sound caps dari baseline. Paket proof awal dapat berjalan dengan rig/layout/clock existing; keputusan tinggi meter tidak dijadikan blocker tersembunyi bagi tiga proof.

Source/artefak dapat berubah selama studio bekerja; refresh snapshot sprint serta modul yang disentuh saat dispatch. Status test/build/QA M1/M2 dari lead tidak dicatat sebagai run oleh artist. Task M3-A1 hanya membaca dokumen/source/bukti terarah dan menulis buku ini; tidak membuat aset/gambar/model, membuka paid generator, menguji Blender, mengubah source/sprint/checkout utama, menjalankan build/playtest atau commit/push/deploy.
