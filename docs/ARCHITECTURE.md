# Globe Universe — arsitektur inti

Peta sistem untuk orang yang baru masuk ke repo ini. Isinya menjelaskan bagaimana game dirangkai, di mana data tinggal, dan aturan yang harus dijaga saat menambah fitur. Status fitur per milestone ada di [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md); daftar file aset ada di [ASSETS.md](ASSETS.md).

Diperbarui 29 September 2026 dari pembacaan source di working tree branch `feat/space-planet-town`. Angka baris berasal dari `wc -l` pada tanggal itu.

## 1. Gambaran besar

- Empat level yang dialami pemain: **space → planet → town → interior**. Interior bukan mode tersendiri, melainkan substate `TownMode`.
- Satu canvas WebGL, satu `THREE.WebGLRenderer`, satu render loop, dan tepat satu mode aktif. Mode yang ditinggalkan membuang scene-nya sendiri.
- Stack: three.js r170, Vite 6, JavaScript ES module tanpa framework UI. Test memakai `node --test`. Hosting lewat Firebase Hosting (`firebase.json`, output `dist/`).
- Semua konten diturunkan dari satu seed dunia: tata surya, peta hex tiap planet, tata kota, dan denah rumah. Yang disimpan hanya peta planet rumah dan delta state pemain.

```text
src/
  main.js            boot: Engine, Audio, World, Overlay, Missions, Tips, PauseMenu, Director
  core/              engine, director + router, post, quality, audio, missions, tips, overlay, pauseMenu, firebase
  world/             data kanonik tanpa three.js: World, clock, state store, identity, blueprint, planet types, tata surya
  map/               mapGenerator (biome, sungai, kota, ladang, rute) — juga masih menampung RNG mulberry32
  math/              hexasphere (Goldberg polyhedron), simplex3d
  render/            renderer globe, gunung, rover, backdrop space, loader aset v1/v2, surface atlas
  modes/space/       SpaceMode + bodies, ship, traffic, bake tekstur orbit, hud
  modes/planet/      PlanetMode (membungkus planetRenderer + menuController)
  modes/town/        TownMode + 29 modul layout, render, orang, kendaraan, interior (flat, satu folder)
  ui/                menuController (planet), gauges (minimap, speedometer), cityNavigation
  style.css          seluruh UI (2.505 baris, 26 CSS custom property)
```

## 2. Boot dan siklus hidup mode

`main.js` membuat `Engine`, `Audio`, `World`, `Overlay`, `Missions`, `Tips`, `PauseMenu`, lalu `Director`. Setelah `world.ready`, `director.start()` membaca hash URL.

| Route | Mode |
|---|---|
| `#/space`, `#/space/<planet>` | `SpaceMode` |
| `#/planet/<i>`, `#/planet/<i>/city/<c>` | `PlanetMode` |
| `#/town/<i>/<c>` | `TownMode` (interior di dalamnya) |

`Director.switchTo(route)` (`src/core/director.js`) menjalankan urutan berikut:

1. Import chunk mode baru dan panggil `static prepare(ctx, route)` untuk prefetch aset selama animasi keberangkatan.
2. Mode lama menjalankan `depart(route)` dan mengembalikan `{ cover, arrival }`. Cover berupa `fade`, `snapshot`, atau `clouds`.
3. `exit()` mode lama, lalu `new Mode(ctx, route, arrival)` dan `await enter()` di balik cover.
4. Satu frame digambar di balik cover, cover dibuka, lalu `arrived()` dipanggil.

Kontrak mode (semua opsional kecuali `update`/`render`): `prepare`, `constructor`, `enter`, `arrived`, `update(dt, t)`, `render()`, `resize(w, h)`, `navigate(route)`, `depart(route)`, `exit()`. `ctx` berisi `{ engine, world, overlay, missions, audio, tips, director }`.

Mode baru ditambahkan dengan mendaftarkannya di `MODES` dan `LABELS` pada `director.js`, menambah parser di `router.js`, dan mematuhi kontrak di atas. Mode wajib membuang geometry, material, texture, dan listener miliknya pada `exit()`. Harness `tests/browser/living-town.html` punya pemeriksaan lifecycle untuk mendeteksi resource yang bocor.

## 3. Engine, kualitas, post-processing

- `core/engine.js`: renderer `alpha: true`, ACES Filmic, exposure 1,05. Loop memanggil `mode.update` dan `mode.render` di dalam try/catch; error terakhir disimpan di `engine.lastError`. `afterFrame()` menunggu satu frame (dipakai untuk capture dan QA). Jam engine berhenti saat menu jeda terbuka.
- `core/quality.js`: preset `auto | high | medium | low`. `high` = pixel ratio ≤2, shadow, `detail: 1`; `medium` = ≤1,5, shadow, `detail: 0.75`; `low` = ≤1, tanpa shadow, `detail: 0.5`. Pada `auto`, pixel ratio naik turun mengikuti FPS. Modul lain membaca `quality.settings.detail`.
- `core/post.js`: MSAA → UnrealBloom → OutputPass (tone mapping) → grade (saturasi, kontras, gain, vinyet). Tampilan per mode ada di tabel `LOOKS` (`space`, `planet`, `town`, `interior`). Tier low mematikan seluruh rantai. Blend bloom dipatch agar tidak menulis alpha di atas canvas transparan.

## 4. Dunia dan state (lapisan data)

Semua modul di `src/world/` bebas three.js, kecuali `planetBake.worker.js`. Pertahankan aturan ini: data kanonik harus bisa dijalankan di Node test dan di worker.

| Modul | Tanggung jawab |
|---|---|
| `world.js` | `World`: hexasphere (default subdivision **5** = 10.242 tile, radius 10), peta rumah di localStorage (`planet_globe_map_v5`), peta planet lain dibuat ulang dari seed dengan LRU tiga peta, `sunAt()`, `worldId = world:<seed>:grid:<subdivision>`. |
| `worldClock.js` | Jam dunia: waktu nyata + offset. Menu jeda membekukan jam, tidur menambah offset. Diuji di `tests/world-foundation.test.js`. |
| `stateStore.js` | `WorldStateStore`: IndexedDB `globe-world-state` per `worldId`, dengan journal pemulihan di localStorage. |
| `identity.js` | `buildingId`, `seedFor` (seed bernamespace per domain). ID tidak bergantung pada urutan array. |
| `buildingBlueprint.js`, `interiorState.js` | Adapter shell bangunan (lantai, pintu, approach) dan state ruangan (lampu, lemari, barang). |
| `townGeneration.js`, `townRelief.js`, `landUsePlan.js` | Versi generator kota per `town-layout:<planet>:<seed>`, relief kota, reservasi lahan. |
| `planetTypes.js` | Arketipe planet: `gen` untuk generator, `look` untuk renderer, dan `TERRAN_PALETTE`. Ini satu-satunya palet bersama saat ini. |
| `solarSystem.js` | Tata surya 5–8 planet dari seed. |

Kunci penyimpanan browser: `planet_globe_map_v5`, `planet_globe_prefs`, `planet_globe_quality`, `planet_globe_post`, `planet_globe_audio`, `planet_globe_missions`, `planet_globe_clock_offset`, `planet_globe_ship`, `planet_globe_tips`, dan IndexedDB `globe-world-state`. Hanya store IndexedDB yang dipisah per dunia. Misi (`planet_globe_missions`) masih global.

## 5. Level planet

- `map/mapGenerator.js` membuat biome, sungai, kota, faksi, ladang, rute darat (A*) dan rute laut dari hexasphere.
- `render/planetRenderer.js` (**3.105 baris**) menggambar terrain hex dengan kontur membulat, gunung (`mountainBuilder.js`), border faksi, props instanced per chunk dengan LOD, jalan/sungai/rute, awan, kamera fokus, dan POV kendaraan. File ini adalah kandidat pemecahan terbesar.
- `modes/planet/PlanetMode.js` membungkus renderer, `ui/menuController.js`, rover (`render/planetRover.js`), dan transisi ke space/town.

## 6. Level space

`SpaceMode` membangun `SystemBodies` dari `solarSystem.js`. Tekstur planet di orbit di-bake di `planetBake.worker.js` dari peta tile yang sama dengan globe (`modes/space/bake.js`), sehingga benuanya identik. Ada juga kapal pemain (`ship.js`), lalu lintas NPC (`traffic.js`), HUD, dan backdrop nebula + bintang (`render/spaceBackdrop.js`).

## 7. Level town

### 7.1 Pipeline

```text
map + cityIndex + footprints (bbox dari town.glb)
  └─ generateTownLayout()            townLayout.js  → data murni, tanpa three.js
       ├─ townPlan.js, wards.js, neighbourhoodPlan.js   jalan, ward, lot (fantasy v2 / modern v2)
       ├─ vegetation.js, townGreenery.js                hutan, batu, taman, halaman
       └─ planStreetLights()                            dari streetLighting.js
  → layout { tiles, streets, buildings, props, trees, parks, paths, walls, docks,
             colliders, walkGraph, driveGraph, rivers, wards, farmCells, bridges, relief, spawn }

TownMode.enter()
  ├─ TownBuilder(layout, packs)      townBuilder.js: terrain, groundPaint, air, instance per chunk/LOD,
  │                                  jembatan, roadMarkings, groundCover, farTrees
  ├─ StreetLighting, TownSky
  ├─ Crowd + Pedestrians             crowd.js, walkNetwork.js, pedestrianRoutes.js
  ├─ RiggedPeople + avatar           peopleRig.js, peopleAppearance.js, peopleMotion.js, personLifecycle.js
  ├─ Fleet + Car + ChaseCamera       fleet.js, vehicle.js, vehicleKit.js, trafficRoute.js
  ├─ Colliders                       colliders.js
  ├─ Interior (saat masuk pintu)     interior.js + interiorLayout.js
  └─ TownHud, Minimap, Speedo        hud.js, ui/gauges.js, ui/cityNavigation.js
```

View di dalam town: `diorama` (OrbitControls), `walk` (orang ketiga), `drive` (chase camera), dan `interior`. Tombol 1/2/3 berpindah view; Esc kembali ke diorama.

### 7.2 Lapisan data vs render

| Tanpa three.js (bisa diuji di Node) | Memakai three.js |
|---|---|
| `townLayout`, `townPlan`, `wards`, `neighbourhoodPlan`, `vegetation`, `townGreenery`, `walkNetwork`, `pedestrianRoutes`, `trafficRoute`, `streetJunctions`, `colliders`, `interiorLayout`, `personLifecycle` | `TownMode`, `townBuilder`, `groundPaint`, `groundCover`, `farTrees`, `roadMarkings`, `streetLighting`, `sky`, `crowd`, `peopleRig`, `peopleAppearance`, `peopleMotion`, `fleet`, `vehicle`, `vehicleKit`, `interior` |

`hud.js` tidak memakai three.js, tetapi membutuhkan DOM.

Aturannya: kualitas grafis hanya boleh mengubah presentasi. Layout, ID, graph jalan, dan collider harus identik di semua tier. Sweep seed di `tests/town-generation.test.js` dan harness navigasi memeriksa aturan ini.

### 7.3 Resolusi aset di town

`TownBuilder.resolve(name, variant)` mencari model dengan urutan berikut:

1. `scenery.glb` (v2, bertekstur): pohon, semak, bunga, bangku, planter, pergola, dermaga, peti.
2. `town.glb` (v1) memakai `<name>_v<variant % jumlahVarian>`.
3. `proto`: geometri primitif di `townBuilder.js` (sumur, lapak, obor, lampu jalan, bangku).
4. Fallback `planetPack` (`assets.glb` + `assets_lod0.glb`, aset skala tile hex) yang diskalakan lewat tabel `CATALOG`.

Urutan ini menyebabkan tiga gaya aset tampil dalam satu scene. Detailnya ada di [ART_DIRECTION.md](ART_DIRECTION.md).

## 8. Material dan loader

- **Loader v1** `render/assetLibrary.js`: node `_LOD0/1/2` di-bake menjadi geometry non-indexed dengan warna material sebagai vertex color, flat normal, atribut `emissive`, `paint`, dan koordinat `surface`. Dipakai `assets*.glb`, `town.glb`, `furniture.glb`, `space.glb`.
- **Loader v2** `render/texturedAssetLibrary.js`: mempertahankan UV, index, smooth normal, dan material glTF. Saat ini hanya dipakai `scenery.glb`.
- Satu gradient toon tiga langkah (`getToonGradient`: 110/185/255) dipakai `MeshToonMaterial` untuk bangunan, props, terrain, dan orang.
- Material props town (`TownBuilder.makePropMaterial`): toon + vertex color + modulasi atlas `town_surfaces.png` + jendela malam prosedural. Material ground (`makeTerrainMaterial`): toon + paint map + grain + tile atlas. Foliage scenery: material glTF yang di-clone, alpha test 0,45, dan angin di vertex shader.
- `render/townSurfaces.js` memetakan nama material `M_*` ke tile atlas (plaster, brick, timber, stone, roof, slate, metal, bark, cloth, concrete).

## 9. Audio

Seluruh suara disintesis di `core/audio.js` (satu kelas `Audio`, 786 baris), tanpa file audio. Isinya:

- mixer dengan preferensi master/music/sfx/mute (`planet_globe_audio`) serta unlock dan suspend;
- bed ambience per scene (`space`, `planet`, `town`, `interior`), critter siang/malam, dan pad chord + motif town;
- suara mesin kendaraan;
- SFX one-shot `step, door, switch, pickup, drop, sit, ignition, hit, whoosh, land, clunk, jump, tick`;
- suara UI, fanfare misi, radio, TV, dan perapian.

Scene audio diatur Director (`setScene`), sedangkan town memilih bed sesuai era.

## 10. UI

Markup ada di `index.html`, gaya di `src/style.css` (arah "The1": permukaan concrete, Barlow Condensed, pill, blok warna faksi, tanpa glow). Panel per mode: `ui/menuController.js` (planet), `modes/town/hud.js`, `modes/space/hud.js`. Komponen bersama: `ui/gauges.js`, `ui/cityNavigation.js`, `core/pauseMenu.js`, `core/tips.js`, `core/missions.js`, `core/overlay.js`. Semua teks UI berbahasa Indonesia dan ditulis langsung di JS/HTML.

## 11. Konvensi

- **Satuan:** globe beradius 10 unit. Town dalam meter. Space memakai unit sistem sendiri. Jangan menganggap ketiganya setara.
- **Sumbu town:** +Y ke atas, depan model +Z, `rotation.y = -yaw`. Frame U/N/V town diturunkan dari titik kota di planet.
- **Seed:** `seedFor(seed, 'domain')` untuk stream terpisah (layout, vegetasi, dekorasi, penghuni). RNG deterministik memakai `mulberry32`. `Math.random()` hanya untuk efek sementara.
- **Aset:** `<asset>_LOD0|1|2` di bawah Empty bernama aset; varian `<asset>_v<n>`; material `M_<nama>`; prefix town `f_` (fantasy), `m_` (modern), `t_` (pohon), `b_` (understory), `g_` (taman), `va_/vb_/vw_/vh_` (kit kendaraan), `fu_/it_` (furnitur/barang).
- **Debug:** di mode dev, `window.__globe = { engine, world, director, missions, audio, three }`.

## 12. Test dan QA

- `npm test`: 24 test unit/regresi (29 September 2026).
- `GLOBE_SWEEP_SEEDS=100 node --test tests/town-generation.test.js`: sweep layout multi-seed.
- `npm run build`: build produksi.
- Harness browser: `/tests/browser/index.html` (interior, IndexedDB, 20 siklus) dan `/tests/browser/living-town.html` (overview, close-up, galeri aset, profil, navigasi, lifecycle).
- Tab browser otomatis sering `document.hidden`, sehingga RAF berhenti. Pakai screenshot hanya untuk memeriksa render, dan uji logika dengan memanggil sistem secara langsung.

## 13. Utang struktural yang diketahui

| Temuan | Bukti | Dampak |
|---|---|---|
| File sangat besar | `planetRenderer.js` 3.105, `TownMode.js` 1.286, `townBuilder.js` 1.097, `style.css` 2.505 baris | Sulit direview, konflik merge, onboarding lambat. |
| `modes/town/` datar | 30 file dalam satu folder tanpa pengelompokan | Batas layout/render/orang/kendaraan/interior tidak terlihat dari struktur. |
| RNG di tempat yang salah | `mulberry32` di-import dari `map/mapGenerator.js` oleh 17 modul | Modul town dan space bergantung pada generator peta planet. |
| Import sirkular | `townBuilder.js` ↔ `farTrees.js` (hanya untuk `WATER_Y`, `HORIZON_R`) | Rawan urutan inisialisasi. |
| Data mengimpor modul render | `townLayout.js` mengambil `planStreetLights` dari `streetLighting.js`, yang juga berisi renderer three.js | Lapisan data ikut menarik three.js. |
| URL aset tersebar | Konstanta URL ada di `TownMode.js`, `PlanetMode.js`, `SpaceMode.js`, `assetLibrary.js` | Tidak ada satu daftar aset runtime di kode. |
| Warna hard-coded | 601 literal warna (454 unik) di 28 file JS, 337 di `modes/town/` | Palet tidak bisa diatur dari satu tempat. |
| Dua loader aset | v1 (flat, vertex color) dan v2 (glTF bertekstur) berjalan bersamaan | Dua model shading dalam satu scene. |
| Misi global | `planet_globe_missions` tidak dipisah per dunia | Tercatat sebagai sisa WB-01. |

Urutan perbaikan yang disarankan ada di [REVIEW_2026_09_29.md](REVIEW_2026_09_29.md) §7.

## 14. Resep singkat

- **Sistem town baru:** taruh logika data di modul tanpa three.js yang dipanggil dari `generateTownLayout`, lalu buat renderer terpisah yang membaca data itu di `TownMode.enter()`. Tambah test Node untuk data dan pastikan hasilnya sama di semua tier kualitas.
- **Aset baru:** ikuti [ASSETS.md](ASSETS.md) §5. Generator Blender di `tools/blender/`, output runtime di `public/`, dan catat file serta pemakainya di registry.
- **Tipe planet baru:** tambah entri di `PLANET_TYPES` (`gen` dan `look`), lalu periksa bake orbit, globe, dan town.
- **Warna baru:** jangan tambah literal hex baru di modul render. Selama palet terpusat belum ada ([ART_DIRECTION.md](ART_DIRECTION.md) AD-1), taruh warna di `planetTypes.js` atau di tabel palet modul, bukan di dalam fungsi.
