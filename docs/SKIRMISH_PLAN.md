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

## Milestone

- **M0 look-dev (selesai, branch `feat/skirmish-vc`)**: `soldier.glb` (2 faksi × 5 kelas), `military.glb` (21 aset), generator medan, builder 3D, post CANVAS, langit dan cahaya siang/senja/malam, halaman look-dev dengan preset kamera dan pose (siaga, bidik, jongkok, jalan, lari).
- **M1 loop BLiTZ (greybox)**: peta datar prep + deploy + briefing, Command/Action Mode, AP, tembak dan hit, interception fire, AI musuh, tank, bunker, menang/kalah, collider dan navigasi grid.
- **M2 polish aset**: jembatan batu lengkung, pose tiarap/terkena/tumbang, efek tembakan dan ledakan, onomatope, lampu malam.
- **M3 mekanik lanjutan**: fog of war, granat dan cover hancur, rumput tinggi dan parit sebagai concealment/cover penuh.

## Peta kode

```text
skirmish.html                      halaman + panel look-dev
src/skirmish/main.js               boot: Engine + LookDev
src/skirmish/lookdev.js            scene look-dev (mode engine)
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
