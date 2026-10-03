# Skirmish — rencana dan status

Halaman terpisah `skirmish.html`: pertempuran regu bergaya Valkyria Chronicles 3 di medan perang prosedural. Tidak memakai `Director`, `World`, atau save universe; memakai ulang `core/engine.js`, `core/quality.js`, rig NPC (`chunkyPeople.js`), dan pack aset. Keputusan diambil dari sesi grill 3 Oktober 2026.

## Keputusan desain

| Aspek | Keputusan |
|---|---|
| Loop | BLiTZ: Command Mode di peta datar (pilih unit, pakai CP), Action Mode third-person |
| CP | 6 per giliran, +1 per leader hidup; memilih unit = 1 CP, unit yang sama boleh dipilih lagi dengan AP berkurang |
| Action Mode | WASD menghabiskan AP; musuh yang melihat melakukan interception fire; klik kanan aim (waktu berhenti, reticle bergoyang); klik kiri tembak 1 burst per aksi; headshot ×2; cover jongkok mengurangi damage; Space mengakhiri aksi |
| Giliran musuh | AI berbasis skor memakai CP; aksi ditampilkan di 3D dengan kamera follow, bisa dipercepat |
| Menang | Rebut base camp musuh atau habisi semua musuh; batas 20 giliran; peringkat A–D |
| Kelas | Scout, Shocktrooper, Lancer, Engineer, Sniper (lihat `src/skirmish/units/soldierLook.js`) |
| Musuh khusus | 1 tank AI (radiator belakang = titik lemah) dan 1–2 bunker |
| Mekanik tambahan | Fog of war/spotting, granat + cover bisa hancur, rumput tinggi dan parit |
| Peta | Generator baru ±200×200 m, pedesaan Eropa 1930-an; parameter ukuran, kepadatan cover, waktu, cuaca, sungai |
| Persiapan | Atur seed + parameter, deploy squad (maks. 6), briefing prosedural |
| Progres | Skirmish lepas, tanpa XP |
| Art | CANVAS: arsiran pensil di bayangan, outline tinta, kertas, tepi frame cat air, onomatope |
| Kontrol | Desktop: pointer lock di Action Mode, Shift lari, C jongkok/tiarap, G granat, Esc jeda |

### Keputusan M1 (grill kedua, 3 Oktober 2026)

| Aspek | Keputusan |
|---|---|
| Gaya | Outline lebih tebal dan arsiran lebih kuat dari look-dev M0 |
| Peta Command Mode | Peta 2D gambar tangan yang sama dengan Prep (zoom/pan, ikon unit); pilih unit lalu kamera terjun ke 3D; minimap saat Action Mode |
| Kamera aksi | Pointer lock; mouse memutar kamera orbit di belakang unit; WASD relatif kamera; klik kanan = over-the-shoulder, waktu berhenti |
| Hit | Setiap peluru raycast dalam kerucut reticle (mengecil saat jongkok/tiarap); tertahan cover, rumah, pohon; kepala ×2; damage turun dengan jarak |
| Navigasi | Collider untuk rumah, cover, pohon, bunker, tank; sungai hanya lewat jembatan; parit bisa dimasuki; AI: grid 1 m + A* dengan peta biaya |
| Roster | 9 karakter bernama (2 SC, 2 ST, 2 LN, 2 EN, 1 SN), pilih maks. 6 di Prep, 1 Leader (+1 CP selama hidup) |
| Stat | SC 240 HP/30 m AP/5×22/45 m · ST 380/18/15×10/20 m · LN 300/15/1×300 AT (40 vs infanteri)/40 m · EN 220/24/4×18/45 m · SN 180/12/1×160/120 m; musuh ×0,9; tank 2400 HP (radiator ×3, meriam ledakan 4 m 120 dmg, MG 20 m); bunker 1500 HP (MG 30 m) |
| Tumbang | 3 giliran untuk diselamatkan kawan (evakuasi); disentuh musuh atau lewat batas = gugur (hanya memengaruhi peringkat) |
| Kesulitan | Mudah/Normal/Sulit: infanteri 6/9/12, CP musuh 4/5/6, akurasi AI 0,7/0,85/1 |
| Intercept | Dua arah: unit yang melihat target bergerak dalam jarak senjata menembak pendek berakurasi rendah; tidak saat membidik, jongkok, atau tiarap |
| Amunisi | Lancer 3, Sniper 6; Engineer mengisi ulang di dekatnya; kelas lain tak terbatas; 1 granat untuk SC/ST/EN (aktif di M3) |
| Look-dev | Tetap tersedia di `skirmish.html?lookdev` |

## Milestone

- **M0 look-dev (selesai, branch `feat/skirmish-vc`)**: `soldier.glb` (2 faksi × 5 kelas), `military.glb` (21 aset), generator medan, builder 3D, post CANVAS, langit dan cahaya siang/senja/malam, halaman look-dev dengan preset kamera dan pose (siaga, bidik, jongkok, jalan, lari).
- **M1 loop BLiTZ (selesai)**: `skirmish.html` membuka game; `?lookdev` membuka scene look-dev. Prep (peta 2D, setup, regu 6 dari 9, deploy dengan klik token lalu slot, briefing), Command Mode di peta 2D, Action Mode TPS (pointer lock, AP, lari, jongkok, bidik dengan waktu berhenti, burst peluru fisik, kamera tidak menembus dinding, minimap), tembakan balasan otomatis dua arah (infanteri, tank, bunker), giliran musuh dengan AI dan kamera follow (Space mempercepat), tumbang/evakuasi/gugur, isi ulang amunisi Engineer, capture camp, menang/kalah dan peringkat, main lagi. Dites: `tests/skirmish-battle.test.js` dan autoplay 3 giliran di Chrome headless tanpa error.
  - Belum: Engineer memperbaiki karung pasir, tank musuh jarang bergerak (AI menilai posisinya sudah bagus), suara masih sintetis sederhana, pose aim tangan kiri belum rapi.
- **M2 polish aset**: jembatan batu lengkung, pose tiarap/terkena/tumbang, efek tembakan dan ledakan, onomatope, lampu malam.
- **M3 mekanik lanjutan**: fog of war, granat dan cover hancur, rumput tinggi dan parit sebagai concealment/cover penuh.

### Perbaikan setelah M1 (grill ketiga, 3 Oktober 2026)

- **Kontrol hybrid**: pointer lock bila diizinkan; bila ditolak (mis. browser pane aplikasi Claude, `SecurityError`), otomatis mode kursor: reticle mengikuti kursor, kamera berputar saat kursor di tepi layar, Q/E dan panah memutar kamera. Klik kanan = toggle bidik (tahan juga bisa).
- **HUD**: AP di dalam kartu unit (tidak bertumpuk), petunjuk tombol disembunyikan di jendela sempit, minimap tanpa label, penanda merah di atas musuh yang terlihat.
- **Gaya lebih ringan**: arsiran hanya di bayangan jatuh, outline lebih tipis dan memudar di jarak, warna lebih jenuh, kertas lebih halus.
- **Animasi**: bidik dengan popor di bahu dan dua tangan, recoil, sentakan saat terkena, jatuh (gugur tertelungkup, tumbang telentang), jalan jongkok, langkah saat berputar di tempat.
- **Performa** (Chrome headless, Metal, M1 Pro, 2560×1600): 9,1 → 5,0 ms GPU per frame. Tanpa MSAA bila pixel ratio ≥ 1,75 (−3 ms), shadow map 2048 yang mengikuti aksi (±70 m, di-snap ke texel), preset Grafis di Persiapan (Tinggi: shadow 2048 + supersampling 1,5× di layar 1×; Sedang: 1024, rumput 60%; Rendah: tanpa shadow dan MSAA, rumput 35%). `core/quality.js`: dengan GPU timer, resolusi hanya turun bila GPU memang penuh (fps rendah karena host men-throttle tidak lagi menurunkan resolusi).

## Peta kode

```text
skirmish.html                      halaman + panel look-dev
src/skirmish/main.js               boot: Engine + SkirmishGame (atau LookDev dengan ?lookdev)
src/skirmish/lookdev.js            scene look-dev (mode engine)
src/skirmish/game/                 murni, tanpa three.js:
  rules.js                         angka: stat, senjata, CP, intercept, kesulitan, peringkat
  roster.js                        9 karakter, pasukan musuh per kesulitan, briefing
  arena.js                         rintangan, collider, grid 1 m, garis pandang, raycast peluru
  nav.js                           Dijkstra dalam jangkauan AP, jalur
  battle.js                        state pertempuran: giliran, CP, damage, tumbang, capture, hasil
  ai.js                            AI musuh berbasis utilitas
src/skirmish/play/                 SkirmishGame (fase), ActionControl, EnemyTurn, Combat, UnitViews, Effects, Sound
src/skirmish/ui/                   TacticalMap (peta 2D + minimap), PrepPanel, Hud
src/skirmish/battlefield/
  generateField.js                 generator murni (seed -> data medan), dites di tests/skirmish-field.test.js
  groundPaint.js                   tekstur tanah dari data medan (canvas 2D)
  fieldBuilder.js                  data medan -> scene three (instancing, material toon)
src/skirmish/render/
  canvasStyle.js                   arsiran di MeshToonMaterial (khusus halaman ini) + CanvasPost
  skyLight.js                      kubah langit, matahari, fog per waktu
src/skirmish/units/
  soldierLook.js                   kelas, faksi, kit (data)
  soldiers.js                      template per faksi × kelas, senjata, stance, IK dua tulang
tools/blender/skirmish/            soldier_faceted.py, military_kit.py, preview_soldiers.py
```

## Catatan teknis

- `buildTemplate` (chunkyPeople) mengubah buffer posisi di tempat: setiap template tentara memakai clone geometri.
- Arsiran dipasang dengan menambal `THREE.ShaderLib.toon` sebelum material pertama dikompilasi; game utama tidak memuat modul ini.
- Biaya GPU (Chrome headless, Metal, M1 Pro, 2560×1600, render 3× per frame): ±10–12 ms per frame dengan post, ±5 ms tanpa post. Noise kertas dan goyangan garis diambil dari tekstur 256² yang dibuat sekali; fbm per piksel sebelumnya menghabiskan ±26 ms.
- Rebuild aset: `Blender -b --factory-startup --python tools/blender/skirmish/soldier_faceted.py -- public/models/soldier.glb` (sama untuk `military_kit.py` → `military.glb`).
