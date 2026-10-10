# Game checklist — Globe Universe (checkpoint 10 Oktober 2026)

Pemilik: globe-lead (ST-03). Status: **final untuk checkpoint**, direkonsiliasi dengan ST-01 dan ST-02. Referensi `G/K/V` dari [ENGINEERING_REVIEW.md](ENGINEERING_REVIEW.md), `DA` dari [DESIGN_ART_REVIEW.md](DESIGN_ART_REVIEW.md).

Kelompok: **A. Bug/gap wajib** (harus ditutup sebelum klaim "siap dinilai/rilis" untuk area terkait), **B. Peluang design** (butuh keputusan pengguna), **C. Sengaja ditunda** (jangan dikerjakan tanpa keputusan baru). Kolom acceptance berisi cara membuktikan, **bukan** klaim bahwa itu sudah dilakukan.

## A. Bug/gap wajib

| ID | Area | Item | Acceptance (bisa diperiksa) | Dependency | Sumber |
|---|---|---|---|---|---|
| A1 | Repo | Trade, Valley, town walk/cozy, QA tools, dan dokumen 9–10 Okt untracked; branch bernama skirmish memuat tiga produk | Rencana commit per produk disetujui PO; `git status` hanya menyisakan WIP sengaja; `.gitignore` untuk `__pycache__/`, `.blend1`, `output/` diputuskan | Izin PO (commit di luar mandat studio) | G-01 |
| A2 | Verifikasi | Tidak ada test/build/runtime segar untuk tree ini; jumlah test di dokumen 15/30/197 | `npm test` + `npm run build` pada commit yang disepakati; satu angka bertanggal + versi Node (V-01, V-02); QA Trade diulang (V-03) | A1 | G-08, K1 |
| A3 | Save | Kontrak versi: `GENERATOR_VERSIONS town:3` vs layout v5; interior schema tak dikenal ditimpa record kosong; Trade schema 1 tanpa jalur migrasi | Satu sumber versi + test yang gagal bila berbeda; record tak dikenal dikarantina, tidak ditimpa; fixture v1–v4 + interior v1/v2/unknown pada subdivision 5 dimuat (V-06) | — | G-03 |
| A4 | Save | worldId bergantung pada satu entri localStorage; gagal simpan hanya `console.warn`; regenerate mengganti dunia tanpa jalur pulih; misi global | Gagal simpan terlihat di UI; regenerate minta konfirmasi; dua seed tidak berbagi progres misi | Keputusan PO soal konfirmasi/ekspor dunia | G-04 |
| A5 | Lifecycle | Kegagalan mode = layar "muat ulang"; `planetPack` tanpa `.catch`; race `enterBuilding`↔`exit()` (belum direproduksi) | Test injeksi gagal per mode kembali ke mode aman tanpa reload; navigasi saat fade tanpa `Interior` yatim (V-05) | — | G-06 |
| A6 | Regresi lintas produk | Town meng-import kode Skirmish dan memuat aset Skirmish; `vcSoldiers.js`/`chunkyPeople.js` berubah tanpa gerbang Town | Daftar modul bersama + pemilik; test statis import/pack; smoke Town (walk → rumah → keluar) setiap modul bersama berubah (V-04) | Keputusan rig (B2) | G-02, K9 |
| A7 | QA gate | Tidak ada CI atau smoke lintas route; Skirmish tanpa QA browser | Satu perintah smoke untuk semua route + `farm.html` + `skirmish.html`, membaca `engine.lastError`/page error/geometry-texture; JSON bertanggal | A1, A2 | G-08, V-10 |
| A8 | Trade robustness | Akumulator tick tanpa batas atas; resume gagal bila fingerprint peta berubah; renderer Trade tidak di-dispose | Batas akumulator/agregasi dengan test jam; resume dari `base` tersimpan; soak tab latar 30 menit (V-09) | Keputusan PO: campaign harus tahan perubahan generator? | G-07 |
| A9 | Perf | Semua angka dari M1 Pro; Low tetap memuat 2 template v5 + 4 atlas 2048²; `interior_atlas.jpg`/`furniture.glb` eager; 1,6 MB aset tanpa pemakai | Baseline per rute (transfer terkompresi, memori) di ≥1 laptop iGPU + M1 Pro (V-07, V-08); manifest punya field "dipakai oleh" + test entri yatim | Target perangkat (PO) | G-05, DA-04, K7, K8 |
| A10 | Docs | 14 kontradiksi; indeks/README tidak memuat Home/Trade/Valley/Skirmish/Pixel/Deploy; hosting ganda | K1–K14 ditutup atau diberi catatan bertanggal; IMPLEMENTATION_STATUS punya baris per produk | A2 (agar angka baru, bukan memindah angka basi) | G-09 |
| A11 | Pipeline | Rebuild humanoid v5 bergantung input VRoid/UAL eksternal; `.blend` v5 tidak ditemukan; Blender MCP tidak tersedia | Registry per pack: status active/legacy/standalone, source path, input eksternal + lisensi, hash ekspor, tanggal QA | — | DA-05 |
| A12 | Bukti pemain | Belum pernah ada playtest manusia (Universe, Trade, Valley) | Sesi formatif bertanggal dengan fixture tercatat (DA-02, V-11) | A2 + pilihan slice (B1) | DA-02 |

## B. Peluang design (butuh keputusan pengguna)

| ID | Item | Acceptance bila disetujui | Dependency |
|---|---|---|---|
| B1 | **Pilih pengalaman yang dinilai pertama:** slice Universe "satu planet, satu kota, satu rumah, satu perubahan persisten" atau slice Trade | Brief alur + fixture + pertanyaan evaluasi disetujui; target awal 2 dari 3 pemain baru menyelesaikan alur dasar tanpa bantuan verbal | Keputusan PO (DA-01) |
| B2 | **Arah rig kanonik:** Town v5 humanoid vs semi-chibi 4,5 kepala Valley (G5) | Keputusan tertulis + matriks kompatibilitas rig (pintu, kursi, kendaraan, 9 hero) sebelum port | Keputusan PO (K10) |
| B3 | Port teknik Valley (G1 shading, G2 situs dulu, G3 dunia bereaksi, G4 ruang terisi, G6 musim) | Satu proof per keluarga dengan budget draw call, parity collider/portal/save; G2 butuh `layoutVersion` naik + migrasi | B2, A3, A9 |
| B4 | Parity visual lintas skala: landmark planet↔town, rumah Home↔town, hierarki material siang/malam | Pasangan capture fixture yang sama, high/low siang/malam (DA-03) | B1 |
| B5 | Profil Hemat (paket aset ringan, lazy interior, cache berbatas) vs presentasi 2D/impostor | Budget rute/perangkat tercapai tanpa merusak keterbacaan tujuan (DA-06) | A9 |
| B6 | Hubungan Trade ↔ ekonomi eksplorasi (WB-07) dan landing ke kota Trade | Keputusan tertulis: tetap terpisah / berbagi data / integrasi | Hasil playtest Trade |
| B7 | Audio/animasi: listening pass 10 menit dan locomotion/action pass | Rekaman tanpa click/lonjakan volume; foot contact/seat/event frame terekam (DA-07) | B1 |

## C. Sengaja ditunda (tidak dikerjakan tanpa keputusan)

| ID | Item | Alasan |
|---|---|---|
| C1 | WB-05 household, WB-06 POI, WB-07 ekonomi eksplorasi, WB-08 event/cuaca | Butuh core loop (B1) dan kontrak versi save (A3) dulu |
| C2 | Seluruh port G1–G6 sekaligus, rig global baru, katalog tekstur TX-01–22 | DA: bukan dependency slice pertama |
| C3 | Rewrite WASM/WebGPU/Rust | Perf report 9 Okt: belum ada bukti hemat; ukur dulu (A9) |
| C4 | Trade multi-planet, udara/antarplanet, multiplayer/cloud save, landing kota Trade | Batas v1 eksplisit |
| C5 | Valley farming progression (uang/stamina/inventori/save) | Keputusan FARM_PLAN: interaksi tanpa sistem |
| C6 | Skirmish M-F (kamera sinematik, kill cam) | Prototype terpisah; M-E belum selesai |
| C7 | Deploy build baru | Di luar mandat; butuh A1 + A2 |
| C8 | Membawa barang antar lantai interior | Fitur roadmap, bukan cacat (G-10); jangan dijadikan objective slice |
