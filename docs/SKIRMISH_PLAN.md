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

### Polish (grill keempat, 3 Oktober 2026)

- AP ×2,5 (Scout 75 m, Shocktrooper 45, Lancer 38, Engineer 60, Sniper 30, tank 100).
- Peta 2D tetap pas layar (tidak bisa di-drag), tepi memudar transparan di atas meja kayu; UI meja taktis (panel dosir, medali CP, tombol stempel, segel kelas, potret wajah 3D); hover unit menampilkan jangkauan AP.
- Aset dibangun ulang: karung pasir berbentuk bantal, bunker dengan celah tembak dan karung pasir menempel, jembatan batu lengkung, kincir dengan bilah berkisi pada porosnya, menara dengan tangga, roda dan rantai tank, bendera berombak, semak pagar tanpa bunga, pohon musim panas; parit = dinding papan + timbunan tanah + papan lantai; tanah di bawah rumah diratakan.
- Tembakan: bintang moncong, asap, selongsong, getar kamera, dentum rendah; penembak intercept berbalik dan membidik dulu.
- Tentara baru ala VC1 (`soldier_vc.glb`): mulus, proporsi anime, wajah dengan mata besar, 9 karakter unik (rambut/warna), musuh berhelm; klip animasi Blender di AnimationMixer + IK untuk memegang senjata; satu draw call per tentara.

### Detail karakter dan kamera (grill kelima, 4 Oktober 2026)

- Kamera di browser tanpa pointer lock mengikuti gerak mouse langsung (movementX/Y), reticle di tengah, tetap berputar saat kursor mentok di tepi jendela.
- Tentara ±25k segitiga + LOD ±10k (>24 m): tangan berjari menggenggam, kepala dipahat (dagu runcing, batang hidung), mata anime (iris bergradasi, dua highlight, bulu mata, garis kelopak), rambut dari helai pipih melengkung, seragam dengan jahitan, saku bertutup, kancing kuningan, epolet, tali sepatu bot, lipatan celana. Warna palet dikalikan vertex color agar lipatan/gradasi tetap saat diwarnai ulang. GLB 1,7 MB. GPU 7,3 ms per frame di 2560×1600 (M1 Pro).

### Karakter bertekstur ala VC PS3 (grill keenam, 4 Oktober 2026)

- Keputusan: gaya VC dengan desain sendiri (bukan replika Welkin; karakter Sega). Pipeline tetap Blender headless dengan tekstur lukis, ±40k segitiga, garis pensil dan arsiran dilukis di tekstur. Hybrid: atlas bersama + palet untuk badan, wajah unik per karakter. Wajah dilukis di tekstur, tanpa checkpoint (iterasi sendiri dengan render pembanding).
- Kepala di-loft dari profil samping dan lebar. Hidung, bibir, dan dagu hanya mengubah siluet. Normal wajah diambil dari bentuk pipih supaya wajah terang rata seperti lukisan, dan bayangan jatuh di wajah dilemahkan 75%.
- Wajah dilukis di runtime (`facePainter.js`, Canvas 2D) per karakter:
  - mata almond dengan garis bulu mata tebal dan kibasan, iris bergradasi, highlight, kelopak ganda;
  - alis tipis, hidung dan mulut beberapa goresan, rona, bintik/tahi lalat/bekas luka;
  - separuh kanan kanvas berisi mata tertutup (kedip, tumbang);
  - tekstur diproyeksikan dari depan ke bagian `face`.
- Atlas 2048² dibuat `soldier_vc.py`:
  - unwrap otomatis;
  - bake AO, posisi, normal, dan slot;
  - numpy melukis gradasi cat air, jahitan dan jahitan putus-putus, lipatan siku/lutut/selangkangan, piping di ujung rok, kerah, dan manset (warna piping per faksi);
  - helai rambut dengan pita kilau.
- Rambut menempel ke tengkorak, dengan normal dari cangkang halus. Lock mahkota hanya di samping dan belakang; poni tidak rata.
- Sarung tangan menjadi slot palet sendiri (sebagian karakter bertangan kosong).
- Pohon ek: batang dan dahan masuk ke kanopi, tidak lagi melayang (`build_town_space.py`, hanya aset `t_oak_*` yang berubah dan AABB-nya tetap).
- Hasil: model dekat 35,6k / jauh 11,5k segitiga, GLB 2,7 MB + atlas 3,1 MB. GPU 5,2 ms per frame di 2560×1600 (M1 Pro).
- Lanjutan:
  - Bretel kulit dengan garis tengah warna faksi (slot syal) dan emblem di lengan kiri.
  - Rambut lebih berisi dengan ujung tetap runcing; bob jatuh rapat ke wajah; kilau rambut terang tidak lagi memutih.
  - Lari condong 26° dengan jari kaki menggulung; senjata dibawa di dada (`placeWeapon`: ikut posisi dada, sepertiga rotasinya), jadi ikut condong, memantul, dan berayun dengan klip.

### Rombak presentasi VC1 (grill ketujuh, 4 Oktober 2026)

Tujuan: game terasa dan terlihat seperti Valkyria Chronicles. Referensi mekaniknya campuran, tampilannya VC1 PS3. Rombakan ini mencakup grafis, HUD, peta, Prep, dan kamera. Mekanik meta (kampanye, HQ, XP, Orders, Potentials, tank pemain) di luar cakupan.

| Aspek | Keputusan |
|---|---|
| CANVAS | VC1 penuh: arsiran pensil di sisi gelap + bayangan jatuh + langit, outline tinta tegas (tidak memudar di dekat kamera), tekstur kertas terlihat, bloom lembut, tepi frame cat air meluber |
| Aset lingkungan | Semuanya dilukis ulang. `town.glb` dan `military.glb` tidak punya UV, jadi skrip Blender mengekspor versi kedua `town_canvas.glb` / `military_canvas.glb` (geometri sama + UV + AO ter-bake + atlas lukis). `town.glb` game utama tetap byte-identik |
| Performa | ≤ 8 ms GPU per frame di 2560×1600 (M1 Pro, Chrome headless Metal); preset Rendah tetap ada |
| HUD | Tata letak VC1, identitas sendiri (tidak menjiplak aset Sega). Wajib: bar AP besar di bawah + kartu unit (potret, HP, amunisi); info target saat bidik (HP musuh, perkiraan damage, tanda kepala/titik lemah, jarak efektif); HP di atas kepala musuh, peringatan masuk pandangan musuh, panah musuh di luar layar; banner PLAYER/ENEMY PHASE, cut-in potret Leader, onomatope tinta |
| Overview map | Tetap 2D dari data medan, didesain ulang: ikon kelas dalam perisai biru/merah dengan arah hadap, kursor pemilih, musuh hanya tampil bila ter-spot |
| Spotting | Masuk sekarang (sebelumnya di M3): musuh tampil bila dilihat unit mana pun; setelah hilang dari pandangan, tampil sebagai posisi terakhir yang diketahui (ikon pudar). Logika di `game/` + test |
| Prep | Dirombak menjadi gaya buku/dosir: peta di kiri, regu dan deploy di kanan dengan kartu karakter, setup lanjut (seed, cuaca, grafis) di laci terpisah |
| Kamera | Terjun dari peta ke unit (dan naik lagi), kamera bidik dramatis (over-the-shoulder, DoF, vignette tinta), kamera giliran musuh sinematik (sudut rendah, cut ke penembak), kill/down cam (gerak lambat singkat + onomatope) |
| Identitas UI | Buku catatan perang: kertas krem, tinta sepia, stempel merah, label mesin ketik, garis pensil, perisai faksi biru/merah; serif kondens untuk judul, monospace untuk label |
| Bahasa | Label militer dalam bahasa Inggris (PLAYER PHASE, COMMAND MODE, TARGET, AP); deskripsi, briefing, dan tombol aksi dalam bahasa Indonesia; onomatope komik Inggris (BLAM!, RATATAT!, BOOM!, CLANG!) |
| Input | Keyboard + mouse saja, tanpa gamepad |
| Peta/misi | Tetap prosedural; template misi (bertahan, hancurkan target) ditunda ke milestone terpisah |
| Kode lama | `hud.js`, `prepPanel.js`, `tacticalMap.js`, `skirmish.css` diganti total (riwayatnya ada di git); `?lookdev` tetap ada dengan gaya baru |
| Referensi | Screenshot VC1 di `docs/references/vc1/`, hanya lokal untuk pembanding, tidak di-ship; setiap iterasi dirender berdampingan |
| Checkpoint | Per milestone: commit di `feat/skirmish-vc`, screenshot berdampingan dengan referensi + angka GPU, lalu tunggu persetujuan |

Milestone:

- **M-A vertical slice (selesai)**: CANVAS penuh + HUD Action Mode baru (termasuk info target, penanda bahaya, banner, onomatope).
  - Arsiran pensil dari tekstur hatch 256² (guratan miring, guratan silang, noda pigmen) yang diproyeksikan dari dunia pada sumbu yang paling dihadap permukaan (pada tentara: dari pose diam, jadi ikut bergerak dengan badan). Ukurannya mengikuti besar piksel di permukaan (`fwidth`) dalam oktaf ×2 yang di-blend, sehingga guratan selalu ±5 px di layar tapi tetap menempel ke permukaan. Guratan tipis di semua permukaan, lebih rapat di sisi gelap, silang di bayangan jatuh. Rumput tinggi dikecualikan (`CANVAS_PLAIN`).
  - Langit lebih biru dengan guratan pensil; warna fog dipisah dari horizon.
  - Post: outline lebih tebal yang tidak memudar di dekat kamera; salinan blur ¼ resolusi (2 pass) untuk glow lembut dan DoF saat membidik; vignette tinta saat membidik; tepi frame berubah jadi kertas (warna habis, garis pensil tetap, pigmen menggenang di batas).
  - HUD baru (`ui/hud.js`, `ui/actionHud.js`, `ui/hud.css`, `ui/emblems.js`): strip TURN/PHASE/CP, kartu unit, gauge AP bergaris per 5 m dengan chip (sikap, lari, serangan, SPOTTED ×n), panel TARGET (HP dengan potongan perkiraan damage dari `Battle.estimate`, zona kepala/titik lemah/armor, jarak efektif), tag HP di atas musuh terlihat dengan ikon mata bila musuh bisa intercept, panah musuh di luar layar, vignette merah saat bergerak di bawah ancaman, kilat merah saat terkena, banner PLAYER/ENEMY PHASE, cut-in Leader, laporan operasi dengan stempel rank. Onomatope komik (BLAM!, RATATAT!, CRACK!, FWOOSH!, BOOM!, CLANG!).
  - GPU (Chrome headless Metal, M1 Pro, 2560×1600, Action Mode): 5,6 → 7,2–7,5 ms per frame.
  - Referensi VC1 hanya dilihat lewat browser (tidak diunduh); belum ada salinan lokal di `docs/references/vc1/`.
- **M-B**: overview map baru + spotting + kamera terjun peta → unit.
- **M-C**: Prep gaya buku/dosir.
- **M-D**: `town_canvas.glb` / `military_canvas.glb` dengan atlas lukis.
- **M-E**: kamera sinematik giliran musuh, kill/down cam, dan sisa polish.

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
src/skirmish/ui/                   TacticalMap (peta 2D + minimap), PrepPanel, Hud (hud.js shell, actionHud.js Action Mode,
                                   hud.css gaya buku catatan perang, emblems.js perisai SVG)
src/skirmish/battlefield/
  generateField.js                 generator murni (seed -> data medan), dites di tests/skirmish-field.test.js
  groundPaint.js                   tekstur tanah dari data medan (canvas 2D)
  fieldBuilder.js                  data medan -> scene three (instancing, material toon)
src/skirmish/render/
  canvasStyle.js                   arsiran pensil berjangkar dunia di MeshToonMaterial (khusus halaman ini) + CanvasPost (glow, DoF, tepi kertas)
  skyLight.js                      kubah langit, matahari, fog per waktu
src/skirmish/units/
  soldierLook.js                   kelas, faksi, kit (data)
  soldiers.js                      senjata, pegangan, IK dua tulang (dipakai vcSoldiers)
  vcSoldiers.js                    tentara VC: material (palet, atlas, wajah), klip, LOD, potret
  facePainter.js                   wajah lukis per karakter (Canvas 2D), mata buka/tutup
tools/blender/skirmish/            soldier_vc.py (tentara + atlas), military_kit.py, soldier_faceted.py, preview_soldiers.py
```

## Catatan teknis

- `buildTemplate` (chunkyPeople) mengubah buffer posisi di tempat: setiap template tentara memakai clone geometri.
- Arsiran dipasang dengan menambal `THREE.ShaderLib.toon` sebelum material pertama dikompilasi; game utama tidak memuat modul ini.
- Biaya GPU (Chrome headless, Metal, M1 Pro, 2560×1600, render 3× per frame): ±10–12 ms per frame dengan post, ±5 ms tanpa post. Noise kertas dan goyangan garis diambil dari tekstur 256² yang dibuat sekali; fbm per piksel sebelumnya menghabiskan ±26 ms.
- Rebuild aset: `Blender -b --factory-startup --python tools/blender/skirmish/soldier_faceted.py -- public/models/soldier.glb` (sama untuk `military_kit.py` → `military.glb`).
