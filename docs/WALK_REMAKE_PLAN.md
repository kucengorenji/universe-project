# Remake town walk mengikuti Aethergate

Status: plan, disusun 25 November 2026 dari sesi grilling dengan pemilik proyek. Belum ada kode yang diubah.
Sumber: `D:\developer\games\aethergate-project` (mode valley `/play`, `src/game/japanese/`, `src/game/systems/`).

## 1. Ringkasan

View `walk` di town (tombol 2) dibuat ulang agar terasa dan terlihat seperti valley Aethergate: kamera over-the-shoulder dengan mouse look, locomotion Rapier, hero Sorcerer, dan look painted (cel + garis tinta + bloom + grade) untuk seluruh town.
Kode Aethergate tidak disalin mentah. Logika dan konstantanya di-port ke modul JS gaya Universe, karena Aethergate memakai TS + ECS + fixed-step dan Universe memakai JS + mixin `TownMode`.
Look painted bisa dibawa tanpa migrasi renderer: valley Aethergate berjalan di `WebGLRenderer` + GLSL (`src/game/japanese/painted/`, MIT/CC0), sama seperti Universe.

## 2. Keputusan

| # | Topik | Keputusan |
|---|---|---|
| D1 | Scope | Hanya view `walk` di town. Walk first-person di Home tetap seperti sekarang. |
| D2 | Kamera | TPS over-the-shoulder + pointer lock ala `tps-camera.ts` / `look.ts`. Tidak ada lagi Pixel walk. |
| D3 | Platform | Desktop saja. Semua mode HP dihapus dari seluruh game (track T0). |
| D4 | Fisika | `@dimforge/rapier3d` 0.21.0, kinematic character controller seperti Aethergate. |
| D5 | Mekanik | Pace walk/jog/run (Z/X toggle), jump lengkap (buffer, coyote, air control, double jump), dodge (Shift), roll (Alt). Tanpa combat dan lock-on. |
| D6 | Karakter | Satu hero tetap: Sorcerer (`assets/models/player.glb` + `assets/animations/library.json` dari Aethergate). |
| D7 | Art scope | Look painted untuk seluruh town: walk, diorama, drive, dan interior. |
| D8 | Pixel | Style Pixel dihapus total. |
| D9 | Bahasa kode | Modul JS baru di `src/modes/town/walk/`, gaya Universe, tanpa ECS. Setiap fungsi hasil port diberi komentar sumber `aethergate: file`. |
| D10 | Three.js | Naik dari 0.170 ke 0.186.1, sama dengan Aethergate. |
| D11 | Terrain | Geometri dan layout town tetap jadi sumber kebenaran. Shader painted (ground, grass, flowers) dipasang di atasnya dengan mask untuk jalan, bangunan, dan air. Sky, clouds, dan horizon painted menggantikan langit town. |
| D12 | Interior | Kamera TPS yang sama, ditarik mendekat oleh kolisi kamera (raycast Rapier, `resolveEye`). |
| D13 | Tombol | Default tetap tanpa menu rebind: WASD/panah, Space, Z, X, Shift dodge, Alt roll, E interact (F dihapus), Esc kembali ke diorama. |
| D14 | Waktu | Siklus siang-malam town tetap, ditambah cuaca painted (mendung, hujan/badai, petir). |
| D15 | NPC | Model dibuat ulang dalam gaya Aethergate: satu rig (pria/wanita), 6–8 look. |
| D16 | Kendaraan | Model tetap, material diganti cel + ink. |
| D17 | Timestep | dt variabel (bukan fixed-step 60 Hz). Lihat risiko R1. |
| D18 | Kecepatan | Rumus Aethergate, angka disetel untuk skala town di satu `walkConfig.js`. |
| D19 | Perf | 60 fps di iGPU, 1080p. |
| D20 | QA | Play-test manual oleh pemilik proyek per fase, dengan checklist di bawah. |

## 3. Peta port

| Aethergate (sumber) | Universe (tujuan) | Catatan |
|---|---|---|
| `src/game/systems/locomotion.ts` | `walk/locomotion.js` | Tanpa cabang combat (melee, move lunge, cast). Dodge dan roll tetap. |
| `src/game/systems/jump-phase.ts` | `walk/jumpPhase.js` | Fase naik/udara/mendarat untuk animasi. |
| `src/game/systems/look.ts` | `walk/look.js` | Hanya mouse look tanpa lock-on. `yawBasis`, `clampPitch`, `wrapAngle`. |
| `src/game/systems/tps-camera.ts`, `combat/camera-rig.ts` | `walk/camera.js` | `cameraRig` + `resolveEye`. Shake opsional untuk mendarat dari tempat tinggi. |
| `src/engine/physics.ts` | `walk/physics.js` | Init Rapier async, world, character controller. |
| `src/engine/input.ts`, `controls/actions.ts` | `walk/input.js` | Tabel aksi tetap (D13) + pointer lock + `pendingLook`. |
| `src/game/systems/player-animation.ts`, `entities/hero-clips.ts`, `entities/animation-library.ts` | `walk/heroAnimation.js` | Pilih clip Sorcerer dari library.json: idle, walk, jog, sprint, strafe, jump phases, dodge, roll. |
| `src/game/entities/player-model.ts` | `walk/hero.js` | Load `player.glb`, material Sorcerer, dagger tersarung, staff di punggung. |
| `src/game/systems/footsteps.ts` | ganti `footsteps()` di `townInput.js` | Pakai fase clip, bukan `p.phase`. |
| `src/game/config.ts` (`player`, `look`, `japanese`) | `walk/walkConfig.js` | Lihat §4. |
| `src/game/japanese/painted/` (lib + valley) | `src/render/painted/` | Disalin apa adanya dengan `LICENSE` + README asal. Perubahan Universe ditandai `Universe:`. |
| `src/game/japanese/cel.ts` | `src/render/painted/cel.js` | Untuk hero, NPC, bangunan, dan kendaraan. |
| `src/game/japanese/ground.ts`, `grass-cull.ts`, `lod.ts` | `src/modes/town/render/paintedGround.js` | Ground dan grass di atas mesh terrain town, dengan mask (D11). |

`colliders.resolve` 2D tidak lagi dipakai oleh walk. Collider Rapier dibangun dari data yang sama: heightfield dari `builder.heightAt`, cuboid dari `type: 'box'`, cylinder dari `type: 'circle'`, dan dinding interior dari `interior.rects`. NPC dan `walkNetwork` tetap memakai `Colliders` 2D.

## 4. Angka awal (`walkConfig.js`)

Struktur dari Aethergate, angka disetel untuk town (D18). Semuanya di-tune saat play-test.

| Kunci | Aethergate valley | Awal untuk town |
|---|---|---|
| jog (default) | 6.9 m/s | 4.0 m/s |
| walk factor | 0.36 | 0.40 (1.6 m/s) |
| run factor | 1.6 | 1.6 (6.4 m/s) |
| backSpeedFactor | 0.7 | 0.7 |
| acceleration | 40 m/s² | 40 m/s² |
| gravity | 25 m/s² | 25 m/s² |
| maxFallSpeed | 30 m/s | 30 m/s |
| jumpHeight | 1.25 m | 1.0 m |
| doubleJumpHeight | 1.15 m | 0.9 m |
| coyoteTime | 0.12 s | 0.12 s |
| jumpBuffer, airControl | dari `config.japanese` | sama |
| look sensitivity | 0.0022 | 0.0022 |
| pitch | −0.75 … 0.9 | −0.75 … 0.9 |
| dodge / roll distance | `config.dodge`, `config.roll` | sama |

## 5. Fase

Setiap fase bisa di-merge dan dimainkan sendiri. Urutannya disusun supaya fondasi (versi three, fisika) tidak berubah lagi setelah look dibangun.

### T0. Desktop only (PR terpisah, sebelum P1)

- Hapus joystick dan prompt touch di `modes/town/ui/hud.js`, cabang `joy` di `townInput.js`, dan aturan touch/`coarse` di CSS (`src/style.css`, `ui/gauges.js`, `core/quality.js`, `skirmish/render/canvasStyle.js`, `valley/world/kit.js`, `render/planetRenderer.js`, dan file lain dari `grep -i "joystick|touch|coarse|isMobile"`).
- Perangkat touch-only mendapat layar "Game ini untuk desktop" di landing dan `/play/`.
- Selesai bila: tidak ada lagi listener `touch*` atau UI joystick, dan semua mode tetap bisa dimainkan dengan mouse + keyboard.

### P1. Fondasi

1. Naikkan `three` ke 0.186.1 dan perbaiki breaking change di semua mode (planet, space, home, town, skirmish, valley, trade, farm, sandbox, experiment).
2. Hapus style Pixel: `render/pixel*.js`, `ui/pixel.css`, `controllers/townStyle.js` (bagian pixel), toggle Normal/Pixel di HUD, `planet_globe_town_style` di localStorage, string i18n, dan `docs/PIXEL_TOWN.md` (beri catatan di `IMPLEMENTATION_STATUS.md`).
3. Tambah `@dimforge/rapier3d` 0.21.0 dan `walk/physics.js`. Bangun world Rapier dari data town saat town dimuat. Debug view collider di belakang flag `?physics`.
- Selesai bila: semua mode berjalan seperti sebelum bump, town tidak punya jejak Pixel, dan debug view memperlihatkan collider yang menutupi bangunan, pohon, dan terrain.

### P2. Controller walk (feel)

1. `walk/input.js`: tabel aksi D13, pointer lock saat masuk walk (klik canvas untuk mengunci, Esc melepas lalu kembali ke diorama).
2. `walk/look.js` + `walk/camera.js`: kamera TPS dengan collision eye. FOV walk diambil dari Aethergate.
3. `walk/locomotion.js` + `walk/jumpPhase.js`: pace, jump, dodge, roll di atas character controller (step-up, snap, lereng). Gantikan `updateWalk` di `townInput.js`.
4. Tetap bekerja: interact E (pintu, kendaraan, objek interior), prompt, minimap, transisi diorama ↔ walk ↔ drive, masuk/keluar interior (D12), larangan masuk air dalam dan keluar tepi diorama.
5. Sementara masih memakai avatar town lama dengan clip yang ada.
- Play-test: berjalan, jog, run, dan berhenti terasa seperti Aethergate; lompat naik ke tangga dan trotoar; double jump; dodge dan roll tidak menembus dinding; kamera tidak masuk ke dalam dinding di gang sempit dan di interior; E ke mobil dan pintu tetap bekerja; 60 dan 144 Hz terasa sama (R1).

### P3. Hero Sorcerer

1. Salin `player.glb` dan subset `library.json` (clip locomotion, jump, dodge, roll, interact) ke `public/models/` dan `public/animations/` lewat script `tools/assets/import_aethergate_hero.mjs` (menyalin dan mencatat hash sumber), bukan salin manual.
2. `walk/hero.js` + `walk/heroAnimation.js`: blend idle/walk/jog/run, strafe dan mundur, fase jump, dodge, roll, interact. Staff dan dagger dalam posisi tersarung.
3. Footsteps dari clip.
- Play-test: tidak ada foot sliding di tiap pace, transisi tidak meletup, dan siluet terbaca dari kamera TPS.

### P4. Look painted seluruh town

1. Salin `painted/` ke `src/render/painted/` (D9 tidak berlaku: kode pihak ketiga dibiarkan JS asal agar bisa dibandingkan dan di-update). Tambah ke `THIRD_PARTY_NOTICES` dan `docs/ASSETS.md`.
2. Frame pass: ink dari nomor part di alpha, bloom quarter-res, grade. Gantikan `core/post.js` untuk town.
3. `cel.js` untuk hero, bangunan, props, dan kendaraan (D16). Gantikan `MeshToonMaterial` dan `paintedStyle.js` (paint Skirmish) di town, beserta `scenery.glb` yang masih memakai PBR (lihat `ART_DIRECTION.md` §2.1).
4. Ground, grass, dan flowers painted di atas terrain town dengan mask jalan, bangunan, dan air. Hapus `groundCover.js`, `groundPaint.js`, dan `farTrees` yang tergantikan.
5. Sky, clouds, dan horizon painted, digerakkan oleh waktu town (`townEnvironment.js`). Malam: grade gelap biru, lampu jalan dan jendela sebagai sumber bloom.
6. Cuaca (D14): mendung, hujan/badai, petir dari `sky.weather`. Pemicunya (acak per hari atau mengikuti biome planet) diputuskan di awal fase ini.
7. Perbarui `ART_DIRECTION.md`: arah *painted diorama* diganti look painted valley.
- Play-test: diorama, walk, drive, dan interior memakai satu look; siang, senja, malam, dan badai terbaca; tidak ada objek PBR atau toon lama yang tersisa.

### P5. NPC gaya Aethergate

1. Script Blender `tools/blender/town/resident_v2.py` (ikuti `blender-director` dan pipeline cel Aethergate): satu rig pria/wanita, 6–8 look lewat slot palet, rambut, dan pakaian, dengan atribut `_PART` untuk ink.
2. Clip: idle, walk, sit, talk, plus clip yang sekarang dipakai `peopleMotion.js` (walk, run, panic).
3. Ganti `skirmishPeople.js` / `chunkyPeople.js` di crowd, LOD dan instancing dipertahankan.
- Play-test: crowd terbaca sebagai satu dunia dengan hero; tidak ada drop fps di plaza ramai.

### P6. Performa dan polish

- Capai D19 di iGPU 1080p pada kota terbesar (Aegis Citadel) dan plaza ramai: quality tier town, donut culling grass, LOD NPC, bloom/ink di tier rendah.
- Tune `walkConfig.js` dari catatan play-test semua fase.
- Hapus kode walk lama yang tidak terpakai lagi (`updateWalk`, `follow` untuk walk, `animateTownPerson` untuk player).

## 6. Risiko

| # | Risiko | Mitigasi |
|---|---|---|
| R1 | dt variabel (D17) membuat lompat, dodge, dan kontak Rapier berbeda di 60 vs 144 Hz atau saat frame drop. | Clamp dt ke 1/30, dan step Rapier dengan sub-step tetap 1/60 di dalam frame. Bila play-test P2 masih merasakan beda, pertimbangkan ulang fixed-step untuk walk saja. |
| R2 | Bump three 0.170 → 0.186 merusak shader custom (30 file `ShaderMaterial`/`onBeforeCompile`) dan loader. | Dikerjakan pertama di P1, dengan QA per mode sebelum fitur baru masuk. |
| R3 | Look painted untuk seluruh town (bangunan, jalan, kendaraan) belum pernah ada di Aethergate; valley tidak punya kota. | Mulai P4 dengan satu kota kecil sebagai look-dev, baru diperluas. |
| R4 | Painted grass di town besar plus NPC banyak melewati budget iGPU. | Mask grass memotong area jalan dan bangunan; tier rendah mematikan flowers dan mengurangi ring grass. |
| R5 | Hero Sorcerer membawa staff di kota damai, dan `player.glb` 1.4 MB. | Senjata tersarung. Ekspor subset clip dan kompres (meshopt) lewat script import P3. |
| R6 | Kode Aethergate terus berubah. | Komentar sumber per fungsi dan hash di script import, supaya bisa dibandingkan ulang. |

## 7. Pertanyaan yang masih terbuka

- Pemicu cuaca (P4.6).
- Daftar clip NPC final dan apakah hero bisa duduk atau berinteraksi dengan objek town selain pintu dan kendaraan.
- Apakah Home walk menyusul dengan controller yang sama setelah remake ini.
