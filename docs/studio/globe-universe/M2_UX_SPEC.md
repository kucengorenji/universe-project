# M2 UX — Perjalanan Pertama

**M2-A0 · spesifikasi copy/visual · 10 Oktober 2026 · untuk globe-lead.** Acuan: [M2_SLICE_SPEC](M2_SLICE_SPEC.md), [ART_BOOK_GAP](ART_BOOK_GAP.md) AB-05/AB-07 dan [STUDIO Fase 2](STUDIO.md#fase-2--keputusan-pengguna-10-oktober-2026-setelah-checkpoint-1). Output ini siap menjadi acuan engineering dan review screenshot; tidak mengubah source maupun mengklaim runtime sudah memenuhi spesifikasi.

Keputusan lead dipakai: tujuan **Perjalanan Pertama**, jejak berupa **lampu menyala atau barang diletakkan di rumah awal**, world clock existing, tanpa musim otomatis M2. Tinggi dewasa dan rutinitas warga tetap M3. Checklist lama menjadi tujuan sekunder; Home editor opsional setelah perjalanan.

## 1. Kontrak pengalaman dan copy

Pemain melihat satu tujuan aktif. Urutan J1–J6 mengikuti identitas planet/kota/rumah awal yang dipilih dan disimpan per dunia; memasuki rumah lain atau menyalakan lampu di rumah lain tidak menyelesaikan tujuan. Penanda menunjukkan **pintu masuk**, bukan pusat mesh rumah atau lantai di atasnya.

| Tahap | Baris HUD utama | Bantuan kontekstual / kapan berganti |
|---|---|---|
| J1 | `journey.j1` dengan `{planet}` | `journey.j1.hint`: planet asal ditandai di daftar Space; kontrol autopilot/Mendarat existing. Setelah Planet asal aktif → J2. |
| J2 | `journey.j2` dengan `{city}` | `journey.j2.hint`: pilih kota asal dan gunakan Mendarat existing. Town kota lain tidak memajukan tahap. |
| J3 | `journey.j3` + jarak pintu | Diorama: `journey.j3.diorama`; walk/drive: `journey.j3.hint`. J3 tercapai saat pemain/driver berjarak **<6 m** dari pintu, bukan ketika kamera mendekat atau marker diklik. |
| J4 | `journey.j4` | Jalan kaki: `journey.j4.hint`; drive: `journey.j4.drive`. Dekat <6 m belum berarti prompt masuk tersedia; E mengikuti jangkauan interaksi existing. Interior rumah awal aktif → J5. |
| J5 | `journey.j5` | `journey.j5.hint`. Bila membawa barang, boleh gunakan `journey.j5.carry`. Nyalakan lampu adalah jalur e2e utama; barang memakai permukaan valid di lantai yang sama. |
| J6, masih kunjungan awal | `journey.j6` | `journey.j6.leave`. Perubahan tersimpan dahulu; masuk kembali dalam kunjungan yang sama tidak langsung merayakan. |
| J6, Space/Planet/kota lain | Tetap `journey.j6` | `journey.j6.return` dengan `{city}`, `{planet}`; sorot tujuan asal kembali. Tahap tidak mundur menjadi J1/J2. |
| J6, Town asal | Tetap `journey.j6` + jarak pintu | `journey.j6.door`. Setelah masuk kembali atau restore setelah reload yang memenuhi kontrak lead, tampilkan `journey.j6.verify` selama pemeriksaan. |
| Done | `journey.complete.eyebrow`, kemudian HUD selesai diringkas | Selebrasi sekali sesudah state J5 dipulihkan cocok. Tidak dipicu hanya karena rumah tampil, reload terjadi, atau event `enter_house` datang. |

**Simpan:** tampilkan `journey.save.pending` selama hasil tulis belum diketahui. “Tersimpan” dan kemajuan J5 membutuhkan hasil simpan yang jelas untuk perubahan interior serta pencatatan progres yang terkait. Promise yang resolve, animasi lampu atau toast misi lama bukan bukti journal berhasil. Jika rumah sudah aman tetapi progres gagal, gunakan pesan khusus `journey.progress.failed`; jangan menyebut perubahan rumah hilang. Jika statusnya belum jelas, jangan mengklaim berhasil.

**Pemulihan:** bandingkan state persistennya—ID rumah/lantai serta lampu/item dan transform yang direkam—bukan kesamaan pixel gambar. World clock dapat membuat cahaya ruangan berbeda setelah kembali. Jika state tidak cocok atau masuk karantina, jangan menampilkan “Rumah ini milikmu”; gunakan pesan pemulihan/karantina yang sesuai. Pengulangan event atau reload setelah `done` tidak memunculkan selebrasi kedua.

**Bahasa:** gaya existing memakai kalimat pendek, kata kerja langsung, sapaan “kamu” secara hemat, key datar dan placeholder `{name}`. Nama planet/kota tidak diterjemahkan; nama barang berasal dari `interior.item.*`. Gunakan `t(key, params)`/`formatNumber`, tampilkan nama dinamis dengan textContent atau escaping existing. Jangan memasukkan HTML, warna, keycap markup, nama contoh fixture atau rincian journal/schema ke string produk.

### Copy final ID — siap disalin

Tujuan file: `src/i18n/locales/id/core.js`. **Ganti nilai key existing** `intro.*`, `pause.save.*` dan `save.quarantined` yang tercantum; **tambahkan** `tips.home.*` dan `journey.*`. Blok berupa anggota dictionary `export default { ... }`, bukan file pengganti. Jangan menduplikasi key existing. `journey.*` tetap terpisah dari `mission.home.*`.

```js
'intro.eyebrow': 'Perjalanan Pertama',
'intro.lead': 'Temukan rumahmu di kota asal. Nyalakan lampu atau taruh barang, lalu kembali untuk melihat perubahanmu.',
'intro.space': 'Luar angkasa',
'intro.space.text': 'Ikuti tanda rumah ke planet asal, lalu mendarat.',
'intro.planet': 'Planet',
'intro.planet.text': 'Pilih kota asal yang ditandai, lalu mendarat di sana.',
'intro.town': 'Kota',
'intro.town.text': 'Masuk ke rumahmu, buat satu perubahan, lalu kunjungi lagi.',
'intro.hint': 'Ikuti tujuan di layar. Misi tambahan ada di J, menu dan pengaturan di P.',
'intro.start': 'Mulai perjalanan',

'tips.home.title': 'Rancang rumahmu',
'tips.home.text': 'Susun denah dan barang, lalu klik Generate rumah 3D untuk melihat hasilnya. Klik Terapkan ke kota agar rancangan muncul di kota.',

'journey.title': 'Perjalanan Pertama',
'journey.objective': 'Tujuan perjalanan',
'journey.progress': 'Langkah {step}/{total}',
'journey.distance': '{distance} m ke pintu',
'journey.j1': 'Terbang ke {planet}',
'journey.j1.hint': 'Pilih planet bertanda rumah di daftar, lalu tekan Mendarat.',
'journey.j2': 'Mendarat di {city}',
'journey.j2.hint': 'Pilih kota bertanda rumah, lalu tekan Mendarat.',
'journey.j3': 'Temukan rumahmu',
'journey.j3.hint': 'Ikuti pin rumah ke pintu masuk.',
'journey.j3.diorama': 'Tekan 2 untuk jalan kaki, lalu ikuti pin rumah.',
'journey.j4': 'Masuk ke rumahmu',
'journey.j4.hint': 'Dekati pintu. Tekan E saat Masuk rumah muncul.',
'journey.j4.drive': 'Tekan E untuk turun, lalu dekati pintu rumah.',
'journey.j5': 'Nyalakan lampu atau taruh barang',
'journey.j5.hint': 'Dekati lampu, lalu tekan E. Tunggu konfirmasi simpan sebelum pergi.',
'journey.j5.carry': 'Dekati meja, lalu tekan E saat Taruh {item} muncul.',
'journey.j6': 'Kembali ke rumahmu',
'journey.j6.leave': 'Kembali ke luar angkasa, lalu kunjungi rumah ini lagi.',
'journey.j6.return': 'Kembali ke {city} di {planet}, lalu masuk ke rumahmu.',
'journey.j6.door': 'Masuk lagi untuk melihat perubahan yang kamu simpan.',
'journey.j6.verify': 'Memeriksa perubahan rumah…',

'journey.toast.j1': 'Planet asal ditemukan.',
'journey.toast.j2': 'Kamu tiba di kota asal.',
'journey.toast.j3': 'Itu rumahmu.',
'journey.toast.j4': 'Selamat datang di rumahmu.',
'journey.toast.j5': 'Perubahan tersimpan di browser ini.',
'journey.save.pending': 'Menyimpan perubahan…',
'journey.save.failed': 'Perubahan belum tersimpan. Tetap di sesi ini dan buka menu sebelum pergi atau memuat ulang.',
'journey.progress.failed': 'Rumah tersimpan, tetapi progres perjalanan belum tersimpan. Buka menu sebelum memuat ulang.',
'journey.save.openMenu': 'Buka menu',
'journey.restore.failed': 'Perubahanmu belum berhasil dipulihkan. Perjalanan belum selesai. Buka menu untuk memeriksa status simpan.',
'journey.quarantined': 'Data perjalanan ini belum dapat dibaca. Salinannya disimpan terpisah, dan perjalanan dimulai dari awal.',
'journey.quarantine.failed': 'Data lama belum dapat dibaca, dan salinannya belum berhasil disimpan. Tetap di sesi ini dan buka menu.',
'journey.home.unavailable': 'Tujuan rumah belum tersedia di kota ini. Kamu tetap bisa menjelajah.',

'journey.complete.eyebrow': 'Perjalanan selesai',
'journey.complete.title': 'Rumah ini milikmu',
'journey.complete.text': 'Perubahan yang kamu simpan masih ada. Selamat datang kembali.',
'journey.complete.close': 'Lanjut menjelajah',
'journey.complete.homeHint': 'Ingin merancang rumah? Kembali ke kota dan pilih Bangun Rumah.',

'journey.marker.home': 'Rumahmu',
'journey.marker.planet': 'Planet asal: {planet}',
'journey.marker.city': 'Kota asal: {city}',
'journey.marker.offscreen': 'Arah ke rumahmu',
'journey.marker.occluded': 'Ikuti jalan menuju pin rumah.',

'pause.save.error': 'Perubahan belum tersimpan. Penyimpanan browser penuh atau tidak tersedia. Hindari memuat ulang sebelum status simpan pulih.',
'pause.save.ok': 'Perubahan rumah tersimpan di browser ini.',
'pause.save.mapError': 'Dunia ini belum tersimpan di browser. Jika dimuat ulang, dunia bisa berubah. Tetap di sesi ini untuk menjaga perubahanmu.',
'pause.save.alert': 'Perubahan belum tersimpan. Buka menu untuk detailnya.',
'pause.save.quarantine': 'Ada {n} simpanan yang belum dapat dibaca. Salinannya disimpan terpisah.',
'save.quarantined': 'Data ruangan ini belum dapat dibaca. Salinannya disimpan terpisah, dan ruangan dibuka dari awal.',
```

### Copy final EN — siap disalin

Tujuan file: `src/i18n/locales/en/core.js`; aturan replace/add sama seperti ID. English tetap source/default locale existing. String ID/EN di bawah mempunyai key dan placeholder yang sama.

```js
'intro.eyebrow': 'First Journey',
'intro.lead': 'Find your home in your hometown. Switch on a light or put down an item, then come back to see your changes.',
'intro.space': 'Space',
'intro.space.text': 'Follow the home marker to your home planet, then land.',
'intro.planet': 'Planet',
'intro.planet.text': 'Select the marked hometown, then land there.',
'intro.town': 'Town',
'intro.town.text': 'Enter your home, make one change, then visit again.',
'intro.hint': 'Follow the objective on screen. Extra missions are on J; the menu and settings are on P.',
'intro.start': 'Start journey',

'tips.home.title': 'Design your home',
'tips.home.text': 'Arrange the floor plan and items, then click Generate 3D house to see the result. Click Apply to town to bring the design into the town.',

'journey.title': 'First Journey',
'journey.objective': 'Journey objective',
'journey.progress': 'Step {step}/{total}',
'journey.distance': '{distance} m to the door',
'journey.j1': 'Fly to {planet}',
'journey.j1.hint': 'Select the planet with the home marker in the list, then press Land.',
'journey.j2': 'Land in {city}',
'journey.j2.hint': 'Select the town with the home marker, then press Land.',
'journey.j3': 'Find your home',
'journey.j3.hint': 'Follow the home pin to the entrance.',
'journey.j3.diorama': 'Press 2 to walk, then follow the home pin.',
'journey.j4': 'Enter your home',
'journey.j4.hint': 'Approach the door. Press E when Enter house appears.',
'journey.j4.drive': 'Press E to get out, then approach the house door.',
'journey.j5': 'Switch on a light or put down an item',
'journey.j5.hint': 'Approach a light, then press E. Wait for save confirmation before leaving.',
'journey.j5.carry': 'Approach a table, then press E when Put down {item} appears.',
'journey.j6': 'Return to your home',
'journey.j6.leave': 'Return to space, then visit this home again.',
'journey.j6.return': 'Return to {city} on {planet}, then enter your home.',
'journey.j6.door': 'Go inside again to see the changes you saved.',
'journey.j6.verify': 'Checking your house changes…',

'journey.toast.j1': 'Home planet found.',
'journey.toast.j2': 'You arrived in your hometown.',
'journey.toast.j3': 'That is your home.',
'journey.toast.j4': 'Welcome home.',
'journey.toast.j5': 'Changes saved in this browser.',
'journey.save.pending': 'Saving changes…',
'journey.save.failed': 'Changes are not saved. Stay in this session and open the menu before leaving or reloading.',
'journey.progress.failed': 'Your home is saved, but journey progress is not. Open the menu before reloading.',
'journey.save.openMenu': 'Open menu',
'journey.restore.failed': 'Your changes could not be restored. The journey is not complete. Open the menu to check save status.',
'journey.quarantined': 'This journey data cannot be read yet. A copy was saved separately, and the journey starts fresh.',
'journey.quarantine.failed': 'The old data cannot be read yet, and a copy could not be saved. Stay in this session and open the menu.',
'journey.home.unavailable': 'A home destination is not available in this town yet. You can keep exploring.',

'journey.complete.eyebrow': 'Journey complete',
'journey.complete.title': 'This home is yours',
'journey.complete.text': 'The changes you saved are still here. Welcome back.',
'journey.complete.close': 'Keep exploring',
'journey.complete.homeHint': 'Want to design a house? Return to the town and choose Build House.',

'journey.marker.home': 'Your home',
'journey.marker.planet': 'Home planet: {planet}',
'journey.marker.city': 'Hometown: {city}',
'journey.marker.offscreen': 'Direction to your home',
'journey.marker.occluded': 'Follow the road toward the home pin.',

'pause.save.error': 'Changes are not saved. Browser storage is full or unavailable. Avoid reloading until saving works again.',
'pause.save.ok': 'House changes are saved in this browser.',
'pause.save.mapError': 'This world is not saved in the browser yet. Reloading could change the world. Stay in this session to keep your changes.',
'pause.save.alert': 'Changes are not saved. Open the menu for details.',
'pause.save.quarantine': 'There are {n} saved records that cannot be read yet. Copies were saved separately.',
'save.quarantined': 'This room data cannot be read yet. A copy was saved separately, and the room opens fresh.',
```

### Placeholder dan pemakaian

`{planet}`/`{city}` = display name tujuan asal, bukan route yang sedang dipilih; `{item}` = label barang terlokalisasi melalui `interior.item.*`; `{step}`/`{total}` = angka tahap 1–6/6; `{distance}` = angka meter bulat, diformat i18n; `{n}` = jumlah salinan quarantine yang penyimpanannya sudah dikonfirmasi. Placeholder tidak diisi dengan string HTML atau data debug. Helpers memakai label tombol existing; engineering memilih key berdasarkan konteks, tidak menggabungkan semua bantuan menjadi satu paragraf.

### Pemakaian dan kasus gagal

| Status | Copy / perilaku final | Gate dan prioritas |
|---|---|---|
| Intro pertama | `intro.*` existing; judul produk **Planet Globe** tetap. | Tampil sekali per dunia sesuai seen state. Menutup intro tidak menyelesaikan J1. Intro tidak muncul di setiap reload. |
| Tip Home | `tips.home.*`, key badges `key.click` dan `key.drag` existing. | Tambahkan entri `home` pada peta TIPS; hook Director existing memanggil tip berdasarkan route. Tip ini untuk **editor**, bukan saat J4 memasuki interior. Nama tombol mengikuti `home.generateHome`/`home.apply`; bila tombol diterjemahkan ulang, tip ikut direkonsiliasi. |
| Toast J1–J4 | `journey.toast.j1`–`j4`; sekitar 2,8 s, satu toast aktif. | Hanya saat transisi nyata; restore state tidak memutar semua toast lama. Gabungkan/tunda toast checklist agar satu tindakan tidak menghasilkan dua pesan yang bersaing. |
| J5 sukses | `journey.toast.j5` sekitar 4 s; tanda centang sederhana. | Setelah perubahan valid di rumah awal dan hasil simpan terkait dikonfirmasi. UI pending berganti, kemudian J6 aktif. |
| J5 belum aman | `journey.save.pending`, lalu `journey.save.failed` bila gagal. | Error tidak auto-dismiss; pertahankan J5. Tombol `journey.save.openMenu` membuka menu P existing. Tidak membuat tombol Retry/Reset/New world yang belum ada. |
| Rumah aman, progres gagal | `journey.progress.failed`. | Hanya jika interior terbukti tersimpan. Kemajuan belum dinyatakan persisted; engineering memulihkan/retry sesuai kontrak save, bukan meminta pemain mengulang seluruh dunia. |
| Peta dunia gagal tersimpan | `pause.save.mapError`, indikator menu error. | Prioritas tertinggi: identitas dunia saat reload belum aman. Jangan menyarankan reload sebagai perbaikan atau menampilkan selebrasi persisten ketika identitas belum terjamin. |
| Quarantine journey/room | `journey.quarantined` / `save.quarantined`; ringkasan menu `pause.save.quarantine`. | Sebut “salinan disimpan” **hanya setelah penyimpanan salinan terkonfirmasi**. Unsupported/malformed data bukan kesalahan pemain. Copy generic mencakup data rusak maupun schema lain; tidak menjanjikan restore UI atau cloud backup. |
| Quarantine belum berhasil disimpan | `journey.quarantine.failed`; menu error. | Tidak memakai copy sukses backup. Status jangan tertutup toast arrival; jangan otomatis menghapus/menimpa data untuk menyelesaikan perjalanan. |
| J6 mismatch | `journey.restore.failed`; status J6 tetap belum done. | Bukti state yang diharapkan tidak cocok; tampilkan status simpan. Perubahan world clock saja bukan mismatch. Jangan menimpa hasil load dengan snapshot lama demi membuat tes lolos. |
| Tidak ada rumah/portal aman | `journey.home.unavailable`. | Tujuan berstatus unavailable, tidak menunjuk rumah tak bisa dimasuki. Tombol eksplorasi existing tetap dapat digunakan; tidak memilih rumah lain diam-diam setelah ID rumah awal tersimpan. |

**Catatan implementasi yang perlu diperiksa:** `WorldStateStore.set()` pada source yang dibaca menyimpan di memory, mencoba journal, kemudian antre commit; error dapat ditangkap tanpa Promise reject. `saveStatus` mengutamakan mapError/error/notice/ok. Engineering perlu memberikan hasil persist yang tegas ke Journey/HUD, termasuk saat salinan quarantine gagal. Ini dependency UX, bukan source yang diperbaiki oleh task ini. Penggantian `pause.save.*`/`save.quarantined` berdampak ke UI existing; copy suksesnya harus dipakai bersama gate di atas.

### Selebrasi dan hierarki HUD

- HUD memakai `journey.objective` sebagai accessible label, `journey.progress` (`step` 1–6, `total` 6), lalu **satu baris tujuan aktif**. Jarak hanya di Town asal saat pintu valid. Angka adalah jarak horizontal pemain/driver ke pintu, dibulatkan ke meter; bukan jarak kamera, panjang rute, atau ETA. Pada 0–1 m boleh tampil `1 m`; di luar Town tidak menampilkan meter town untuk skala orbit.
- Letakkan objective di tengah atas, 12 CSS px di bawah topbar aktual; lebar maksimum 440 px, minimum height 44 px, padding 12 px. Sisakan sekurangnya 12 px dari kartu/controls. Baris tindakan tetap terbaca; nama panjang boleh ellipsis dengan nama penuh pada accessible label dan kartu tujuan existing. Jangan memotong “Nyalakan lampu atau taruh barang” menjadi teks tanpa pilihan aksi.
- Bantuan tahap memakai area hint/tip kontekstual, tidak menggantikan prompt interaksi. Prompt E tetap di tempat existing dengan label `interior.enter.house`, `interior.light.on/off`, `interior.take/put`. Jangan membuat prompt E dari jarak 6 m atau mengubah “Matikan lampu” menjadi “Nyalakan” setelah lampu aktif.
- Toast berada 8 px di bawah objective dan tidak mengambil fokus. Error persisten tampil di area ini dengan akses menu; batasi satu pesan prioritas. Intro/pause/celebration menyembunyikan cue navigasi yang bersaing; status simpan tetap tersedia di menu.
- Saat done terkonfirmasi: card dengan `journey.complete.*`, satu tombol **Lanjut menjelajah / Keep exploring**, serta Home hint opsional. “Rumah ini milikmu” adalah judul selebrasi sesuai lead, bukan sistem claim/ekonomi baru. Jangan menjanjikan tombol langsung membuka editor rumah awal: tidak semua rumah enterable memenuhi syarat editor.
- Selebrasi satu kali: fade 180–220 ms, checkmark/ikon rumah statis, fanfare existing sekali bila audio unlocked/unmuted. Tidak membutuhkan confetti/bloom/zoom paksa. Reduced motion: tampil langsung tanpa pulse/bounce; tombol menerima fokus, penutupan mengembalikan fokus ke kontrol sebelumnya. Toast memakai `role=status`, error baru `role=alert` sekali, perubahan jarak tidak dibacakan setiap frame.

## 2. Wayfinding painted 3D

Ini spesifikasi **implementasi nanti**, bukan aset/warna export baru yang sudah tersedia. Rujukan visual ialah art sprint U001/U003/U004/U035 yang dikaji di ART_BOOK_GAP: permukaan krem/ochre, bentuk lembut/chamfer, outline gelap tipis, lampu hangat; tanpa kebutuhan efek hologram atau image generator. M2 tidak bergantung selesainya sheet efek U078 untuk menggambar indikator geometri sederhana.

### Token warna yang benar-benar tersedia

Sumber [src/art/palette.js](../../../src/art/palette.js). Nama role berikut adalah **alias usulan**, belum export existing. Engineering dapat memusatkan alias di palet; jangan menambah literal hex tersebar ke modul marker.

| Role usulan | Token existing / nilai | Pemakaian |
|---|---|---|
| `target` | `ROOM_SCHEMES.house[0].trim` · `#f2b766` | Ochre/emas hangat untuk face/beacon/outline tujuan. |
| `paper` | `ROOM_SCHEMES.house[1].wall` · `#f6e3bc` | Permukaan pill/plaque dan label. |
| `ink` | `MAP_COLORS.label` · `#1c2320` | Teks dan detail ikon; tetap gelap pada day/night. |
| `outline` | `MAP_COLORS.outline` · `#1f2a24` | Stroke 2 CSS px pada marker screen; pemisah terhadap latar. |
| `edge` | `PATH_PALETTE.border` · `#e9dcc0` | Rim tipis dan tepi dasar beacon. |
| `quiet` | `MAP_COLORS.roadEdge` · `#6f6452` | Status sekunder/outline inactive; teks utama tetap ink. |
| `success` | `MAP_COLORS.tree` · `#4f7f5c` | Centang/icon setelah save; tidak menjadi teks kecil di atas paper. |
| `error` | `ROOM_SCHEMES.tavern[1].wainscot` · `#d8352f` | Icon/status error; pesan juga memakai kata dan outline, tidak warna saja. |

Emas pada krem membutuhkan stroke gelap; jangan memakai emas sebagai teks kecil. Target teks normal minimal contrast 4,5:1, glyph/stroke/controls 3:1 terhadap latar yang dipakai. Nilai ini acceptance yang harus diperiksa pada UI final, bukan klaim hasil pengukuran screenshot saat ini. Shape rumah dan label tetap membedakan tujuan pada grayscale.

### Beacon pintu rumah awal

| Aspek | Spesifikasi |
|---|---|
| **Anchor** | Pintu/approach exterior dari starterHome + portal aman existing, mengikuti yaw dan terrain. Tidak melekat ke pusat bounding box rumah. Beacon visual tidak memiliki collider, tidak menambah obstacle atau mengubah door/seat/rig. |
| **Bentuk world** | Plaque kecil dengan silhouette **atap + badan rumah**, tepi chamfer dan face paper/target; dua sapuan/arc pendek di tanah menandai ambang masuk. Hindari kolom cahaya tinggi yang menutup rumah. Bentuk boleh dibuat geometry/code existing pipeline; tidak memerlukan PNG baru. |
| **Ukuran world awal** | Plaque sekitar 0,32 m lebar × 0,34 m tinggi, tebal ≤0,03 m; anchor 0,25 m di atas bagian atas pintu. Arc ambang radius sekitar 0,70 m, strip 0,035 m; tunduk pada terrain dan tidak memotong pintu. Ini ukuran indikator, **bukan keputusan tinggi karakter dewasa**. Review kontak pada rig existing M2. |
| **Ukuran screen** | Ikon house overlay 28 CSS px, stroke 2 px, label `journey.marker.home` font 13–14 px di pill paper. Size screen tetap saat DPR/internal buffer berubah. Plaque world tidak diskalakan tanpa batas untuk mengejar pixel: saat terlalu kecil di diorama, overlay house menjadi cue utama. Near label tidak menutupi kunci E. |
| **Normal/siang** | Face matte berwarna palet, outline/ground mark tetap terbaca di tanah terang. World geometry memakai depth test; marker bukan lubang tembus dinding. Ikon overlay sebagai locator diberi aturan occlusion di bawah. |
| **Malam** | Aksen hangat/emissive ringan pada face atau material indikator yang tidak tergantung pencahayaan; tidak menambahkan point light/shadow pass. Pill/outline screen mempertahankan kontras. Cahaya dekoratif beacon bukan state lampu J5; lampu rumah yang dinyalakan pemain harus tetap dapat dibedakan. |
| **Gerak** | Pilihan normal: pulse opacity kecil 0,85–1,00 sepanjang 2,4 s; tidak mengubah ukuran/posisi. Tidak berkedip atau berputar. Hemat dan reduced-motion: statis. Marker hanya memberi arah; event tujuan berasal dari state/jarak/interaksi. |
| **Hemat** | Satu marker aktif, geometry/material shared, ≤3 draw calls tambahan untuk beacon world; tanpa texture unik besar, particle, bloom, shadow atau full-screen pass. Overlay/minimap tidak dibuat sebagai render target 3D kedua. Catat delta aktual, bukan menganggap budget otomatis tercapai. |
| **Lifecycle** | Aktif J3/J4 pada Town asal, disembunyikan selama interior J5. J6 mengaktifkannya saat Town asal kembali. Setelah done, berhenti pulse dan arah aktif; pin rumah boleh tetap statis sebagai lokasi dikenal. Loading/invalid portal/unavailable tidak menampilkan beacon di koordinat default (0,0). |

### Visibility, panah luar layar dan pin minimap

- **Terlihat:** satu badge house dengan stem pendek ke pintu dan label; world plaque tetap depth-tested. Ketika pintu di layar tetapi terhalang bangunan, locator screen menggunakan outline/stem putus-putus dan hint `journey.marker.occluded` saat diperlukan. Ini tanda tujuan terhalang, bukan prompt masuk. Akses mengikuti jalan dan clearance existing; indikator arah tidak membuat rute lurus menembus dinding.
- **Di luar viewport/di belakang kamera:** ganti locator dengan panah tepi berisi house icon 20 px + chevron 12 px dalam pill sekitar 44 px; label Rumahmu/Your home atau jarak sebagai teks pendamping bila ruang cukup. Arah dihitung dari target dalam ruang kamera; target di belakang kamera tidak diproyeksikan sebagai badge di depan. Panah menunjukkan arah relatif kamera dan tidak menyatakan path nav atau ETA.
- **Safe area panah:** inset minimum 24 CSS px dari viewport, di bawah topbar/objective dan di atas HUD bawah; exclude rect aktual minimap, joystick, prompt E, tombol pause dan kartu terbuka dengan jarak 12 px. Geser posisi sepanjang tepi jika bertabrakan, pertahankan arah chevron ke target. Tidak memakai posisi tetap yang menutupi tombol pada viewport kecil.
- **Pergantian:** gunakan margin/hysteresis sekitar 16 CSS px agar near-edge tidak bolak-balik badge/panah; normal crossfade 120 ms, reduced-motion langsung. Occlusion dapat disampling sekitar 10 Hz terhadap volume penghalang yang relevan, bukan raycast seluruh scene setiap frame. Engineering mengukur delta CPU; panah update tidak memengaruhi simulasi.
- **Minimap:** pin house 16 CSS px (stroke 2 px) di koordinat pintu, berbeda dari titik kecil pintu biasa dan panah pemain. Tetap upright ketika peta berputar; tidak berubah menjadi pin mobil saat drive. Jika di luar radius peta, clamp pin kecil ke rim di arah tujuan dan beri chevron; jangan menghapus tujuan. Player/camera heading tetap terlihat dan pin tidak menutup simbol pemain ketika dekat—offset label, pertahankan stem ke posisi nyata.
- **Kapan minimap:** gunakan minimap existing di walk/drive; diorama memakai beacon + locator/objective, tanpa memaksa sistem minimap baru. Interior tidak menampilkan pin outdoor. Pada drive J4, bantuan turun ditampilkan; marker tidak memerintahkan E masuk rumah ketika E masih berarti keluar kendaraan.
- Overlay dekoratif tidak menangkap click/pointer dan tidak memindahkan fokus. Accessible label house/arah ada di objective/label DOM, bukan hanya canvas. Jika kemudian marker menjadi tombol, minimum hit area 44 CSS px dan fungsi harus memakai aksi existing; M2-A0 tidak mensyaratkan click-to-teleport atau autoroute baru.

### Planet dan Space: satu identitas tujuan

| Tampilan | Highlight yang harus terlihat | Seleksi dan aksi |
|---|---|---|
| **Space, J1 / J6 kembali** | House badge 16 px + outline target 2 px pada row **planet asal**, label `journey.marker.planet` dengan nama. Locator pada planet 24 px ketika di layar; orbit ring existing boleh diberi aksen hangat ringan bila murah. Warna biome planet tetap ada. | Highlight tujuan bertahan saat pemain memilih planet lain; selected state tetap berbeda. Klik row/autopilot dan Mendarat existing menentukan perjalanan, bukan highlight. Gas giant tak mendapat CTA land palsu. |
| **Planet asal, J2 / J6 kembali** | Pin house 24 px di kota asal pada globe, highlight row/card kota asal, label `journey.marker.city`. Pin mengikuti city/tile anchor existing, tidak memakai meter Town untuk skala planet. | Putaran globe tetap bebas. Kota di sisi belakang tidak diberi badge solid tembus planet: tujuan tetap ditandai pada daftar/kartu, dan kontrol focus existing dapat membawanya ke depan. Jangan auto-rotate yang merebut kamera pemain tiap frame. |
| **Planet lain / kota lain** | HUD tetap menunjuk nama tujuan asal dan bantuan return; panel Space/list tujuan memberi konteks asal. | Tidak mengganti homePlanet/homeCity/starterHome karena pilihan atau route berubah; perjalanan boleh dilanjutkan setelah kembali. |
| **Town asal** | Pin/house badge yang sama pindah ke pintu rumah awal; label Rumahmu/Your home. | City marker tidak tetap mengambang di samping marker rumah. Satu target aktif per skala. |

Sorot planet/kota asal merupakan overlay visual ke identitas existing, bukan recolor seluruh terrain, perubahan layout, atau produksi landmark baru. J6 mempertahankan tahap return walau berpindah skala. Jika tujuan tidak tersedia, gunakan pesan unavailable; tidak menggambar highlight pada index kota lain sebagai fallback palsu.

## 3. Checklist screenshot e2e untuk review artist

Output QA yang diharapkan: `docs/qa/journey/`, sesuai M2_SLICE_SPEC. Nama capture di bawah **usulan kontrak handoff**, belum file yang dibuat. Primary run lampu memakai 1280×720, DPR 1, Low/Normal; simpan ID dan EN terpisah. Hemat tetap target iGPU 8 GB/30 FPS, tetapi run M2 di M1 Pro/CPU throttle 4× ditulis jelas sebagai **proxy**, bukan sertifikasi perangkat minimum.

Setiap capture memiliki sidecar/log: waktu capture, build/revisi, world ID/seed/subdivision, planet/city/building/floor ID, layout/schema version, J-state, aksi/event, camera pose, world-clock time, language, CSS viewport/drawing buffer, preset/style/reduced-motion, storage baru/existing dan status save. Simpan `engine.lastError`, page errors, expected/restored snapshot dan hasil persist di log terpisah; tidak membocorkan credential atau menumpuk debug overlay ke screenshot produk.

| Capture / langkah | Yang harus terlihat untuk review copy/visual | Bukti nonvisual pasangan yang diperlukan |
|---|---|---|
| **00-intro** | Perjalanan Pertama/First Journey, tujuan rumah/perubahan/kembali, tiga skala dan tombol Mulai perjalanan; teks utuh dan fokus tombol. | Profil bersih; intro hanya sekali per dunia; menutupnya belum menyelesaikan journey. |
| **01-j1-space** | HUD Terbang ke nama planet asal; row house badge berbeda dari selected row; CTA Mendarat pada planet yang benar. Tidak menutup flight HUD/controls. | homePlanet ID sama dengan tujuan; klik planet lain tidak memajukan J1. |
| **02-j2-planet** | HUD Mendarat di nama kota asal; pin/row/card kota asal dan CTA mendarat terlihat. Nama planet/kota sesuai capture Space. | Planet asal aktif; kota asal dipilih dengan ID stabil. Capture tambahan far-side membuktikan pin tidak tembus globe. |
| **03-j3-town-wide** | Diorama: rumah target dikenali lewat badge pintu, objective dan bantuan Tekan 2; bentuk rumah/akses tidak tertutup beam atau clutter. | Town kota asal aktif; zoom kamera atau klik marker saja tidak menutup J3. |
| **03b-j3-offscreen** | Pintu di luar layar: panah house menunjuk arah yang benar, minimap rim pin masih tampak saat walk/drive; prompt/joystick/menu aman. | Posisi target di kamera depan/belakang direkam. Arrow bukan bukti route walkability. |
| **04-j4-door** | HUD Masuk ke rumahmu, pintu dan approach aman, avatar berada di luar pintu, prompt E Masuk rumah terbaca tanpa tertimpa badge/jarak. | J3 jarak pemain <6 m; prompt memakai jangkauan interaksi actual; starterHome buildingId benar. Drive variant menunjukkan E turun dahulu. |
| **05-j5-before** | Interior rumah awal, HUD Nyalakan lampu atau taruh barang, lampu **mati** yang dipilih dan prompt E Nyalakan lampu terlihat. Outdoor marker/minimap tidak bocor. | Catat light/item ID dan snapshot awal; fixture harus menyediakan aksi yang mengubah state. Lampu sudah menyala bukan bukti perubahan baru. |
| **05b-j5-saving / failure fixture** | Status Menyimpan… jika cukup lama untuk ditangkap; pada fault, pesan gagal persisten dan akses menu, tanpa toast sukses/selebrasi. | Uji fault yang nyata di harness; bila pending terlalu singkat, log timing cukup—jangan menambah delay produk demi screenshot. J5 tidak maju sebelum sukses. |
| **06-j5-saved** | Lampu menyala, prompt beralih Matikan lampu, toast Perubahan tersimpan di browser ini, J6 aktif/bantuan pergi. | Durable journal/hasil save + snapshot expected; screenshot lampu menyala saja tidak membuktikan save. |
| **07-j6-space-before-reload** | J6 Kembali ke rumahmu; planet asal tetap ditandai, bantuan kota/planet sesuai; bukan J1 baru. | Perpindahan keluar dari kunjungan awal tercatat; J5 snapshot tersimpan dan identitas dunia tetap. |
| **08-j6-after-reload** | World/tujuan yang sama, J6 tetap aktif tanpa intro/toast langkah lama; kota/planet asal masih ditandai. | Restore Journey dan world ID cocok; `engine.lastError` null. Alternatif reload langsung di interior dicatat sebagai fixture berbeda. |
| **09-j6-reenter** | Pintu/rumah yang sama, kemudian interior dengan lampu masih on. Kamera pembanding memperlihatkan fixture yang dapat dikenali. | State light/item/transform cocok dengan expected J5; clock/time boleh berbeda. Pending verify belum menampilkan done. |
| **10-done** | Judul Rumah ini milikmu/This home is yours, teks perubahan masih ada, tombol lanjut, Home hint opsional; tidak menutupi error simpan. | `journey.done`, save/identity/restore valid; event ganda/reload sesudah done tidak merayakan ulang. |
| **11-home-optional** | Jika editor diuji: tip Rancang rumahmu/Design your home, tombol Generate rumah 3D/Generate 3D house dan Terapkan ke kota/Apply to town sesuai copy. | Membuka Home bukan syarat done; tip muncul pada route Home, bukan interior. Rumah yang tidak eligible editor tidak dijadikan kegagalan slice utama. |

### Capture pelengkap wajib sebelum visual acceptance

- **Day/night, Low/post off:** door wide + door dekat + interior sebelum/sesudah lampu. Beacon tidak bergantung bloom, tampak pada tanah terang/gelap, tidak terlihat sebagai lampu yang memenuhi J5. Clock tetap world clock; jangan memaksakan season baru untuk capture.
- **Occluded/on-edge/behind-camera:** satu pintu terhalang, satu di rim viewport, satu di belakang kamera. Bedakan locator terhalang dan panah; jangan tembus dinding/globe sebagai indikator interactable. Pindah target ke depan tidak menimbulkan dua marker aktif.
- **ID/EN + nama panjang:** cek seluruh key/placeholder terisi, aksi tidak terpotong, nama tujuan accessible utuh, jarak terformat, prompt/keycap tidak terjemahannya tercampur. Primary desktop 1280×720; tambahan viewport 800×600 untuk overlap/wrap, tidak berarti sudah melakukan QA mobile.
- **Save error/map error/quarantine:** pesan sesuai kasus, akses menu tetap terlihat, tidak ada sukses backup bila salinan gagal, tidak ada instruksi reload yang bertentangan dengan status. Capture quarantine journey dan room dipisah dari fresh profile; jangan menggabungkan bukti fixture tersebut.
- **Item alternatif:** catat item ID/lantai/transform, tangan sebelum placement, prompt Taruh/Put down, posisi sesudah, dan posisi setelah restore. Tidak membawa barang antar lantai. Uji ini tambahan terhadap primary lamp path, bukan mengubah acceptance e2e lead.
- **Reduced motion + selesai ulang:** marker/selebrasi statis, tidak ada pulse/bounce atau fanfare saat mute. Screenshot memeriksa tampilan; timing/interupsi/fokus/selebrasi berulang memerlukan log atau video singkat.

**Rubrik artist:** blocker/P0 bila salah target, J5/J6 sukses palsu, pesan gagal tertutup, placeholder/key bocor, prompt masuk tidak terbaca, atau marker mengarahkan ke portal tak aman. P1 bila cue tidak konsisten lintas skala, beacon tak terbaca malam/Low, arrow/pin hilang, atau overlap kontrol. P2 untuk fine-tune material, stroke dan timing setelah correctness lolos. Semua temuan menyebut file capture, bahasa, langkah, fixture dan expected/actual; jangan mengutip diagnosis September sebagai cacat build M2.

## 4. Handoff dan status verifikasi

Engineering: pindahkan copy sesuai replace/add, bind placeholder dan state/context, tambah tip Home, lalu implementasikan marker/occlusion/layout tanpa mengubah home identity atau gameplay. QA: rekam urutan primary lead, simpan state/log dan capture pelengkap; artist berikutnya menilai hasil screenshot dalam `handoff/M2-A.md` sebagaimana M2_SLICE_SPEC. Task ini tidak membuat atau mengubah file handoff tersebut.

Source yang dibaca terarah: i18n ID/EN core/town/home dan index, `tips.js`, `missions.js`, `director.js`, `TownMode.js`, HUD Town/Space, `PlanetMode.js`, `gauges.js`, `HomeMode.js`, palette, `stateStore.js`, `savedRecords.js`, `saveStatus.js`, pause menu, world/worldClock. Source studio sedang berkembang; kontrak persist/hook perlu dicek lagi saat implementasi. Referensi sprite/art sprint berasal dari kajian ART_BOOK_GAP bertanggal, tidak ada generate/edit/lock sprint pada M2-A0.

**Belum dilakukan:** perubahan i18n/source, test/build, browser e2e, capture/review screenshot M2, playtest pengguna, benchmark iGPU atau produksi aset. Copy dan ukuran/warna di sini adalah spesifikasi final M2-A0 untuk implementasi; visual acceptance baru diberikan setelah bukti QA tersedia. Satu output task ini: `M2_UX_SPEC.md`.

**Verifikasi dokumen:** kedua fragmen dictionary dapat diparse; 63 key ID/EN cocok, tidak ada key duplikat atau placeholder berbeda; empat tautan lokal valid. Pemeriksaan ini hanya memvalidasi artefak spesifikasi, bukan test i18n proyek atau acceptance runtime.
