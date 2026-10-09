# Globe Universe — arsitektur inti

Peta sistem untuk orang yang baru masuk ke repo ini. Isinya menjelaskan bagaimana game dirangkai, di mana data tinggal, dan aturan yang harus dijaga saat menambah fitur. Status fitur per milestone ada di [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md); daftar file aset ada di [ASSETS.md](ASSETS.md).

Diperbarui 29 September 2026 dari pembacaan source di working tree branch `feat/space-planet-town`, setelah restrukturisasi Fase 1 (lihat §13). Integrasi Trade Game diperbarui 9 Oktober 2026. Angka baris historis berasal dari `wc -l` September.

## 1. Gambaran besar

- Empat level yang dialami pemain: **space → planet → town → interior**. Interior bukan mode tersendiri, melainkan substate `TownMode`.
- Satu canvas WebGL, satu `THREE.WebGLRenderer`, satu render loop, dan tepat satu mode aktif. Mode yang ditinggalkan membuang scene-nya sendiri.
- Stack: three.js r170, Vite 6, JavaScript ES module tanpa framework UI. Test memakai `node --test`. Hosting lewat Cloudflare Pages (`wrangler.jsonc`, output `dist/`, lihat [DEPLOYMENT.md](DEPLOYMENT.md)). Firebase hanya dipakai untuk Analytics (`src/core/firebase.js`); `firebase.json` adalah sisa konfigurasi hosting lama.
- Semua konten diturunkan dari satu seed dunia: tata surya, peta hex tiap planet, tata kota, dan denah rumah. Yang disimpan hanya peta planet rumah dan delta state pemain.

```text
src/
  main.js            boot: Engine, Audio, World, Overlay, Missions, Tips, PauseMenu, Director
  core/              engine, director + router, post, quality, audio, missions, tips, overlay, pauseMenu, firebase
  art/               palette.js: token warna bersama (atap per tipe planet, peta 2D)
  world/             data kanonik tanpa three.js: World, clock, state store, identity, blueprint, planet types, tata surya
  map/               mapGenerator (biome, sungai, kota, ladang, rute)
  math/              hexasphere (Goldberg polyhedron), simplex3d, random (mulberry32)
  render/            renderer globe, gunung, terbang di planet, backdrop space, loader aset v1/v2, surface atlas, assetManifest (semua URL aset)
  modes/space/       SpaceMode + bodies, ship, traffic, bake tekstur orbit, hud
  modes/planet/      PlanetMode (membungkus planetRenderer + menuController)
  trade/             catalog, resource/scenario, graph, simulation, session, entry CTA
  modes/trade/       TradeMode, overlay 3D dan HUD/CSS terisolasi
  modes/town/        TownMode.js, scale.js (konstanta skala), dan subfolder:
    layout/          data murni: townLayout, townPlan, wards, neighbourhoodPlan, vegetation, townGreenery,
                     streetJunctions, streetLightPlan, roofPlan
    navigation/      walkNetwork, pedestrianRoutes, trafficRoute, colliders
    render/          townBuilder, groundPaint, groundCover, farTrees, roadMarkings, streetLighting, sky
    people/          crowd, peopleRig, peopleAppearance, peopleMotion, personLifecycle
    vehicles/        vehicle, vehicleKit, fleet
    interior/        interior, interiorLayout
    planner/         townPlanner (UI tata kota 2D), townMapRenderer (peta gaya Watabou)
    ui/              hud
  ui/                menuController (planet), gauges (minimap, speedometer), cityNavigation
  style.css          seluruh UI (2.505 baris, 26 CSS custom property)
```

## 2. Boot dan siklus hidup mode

`main.js` membuat `Engine`, `Audio`, `World`, `TradeSession`, `Overlay`, `Missions`, `Tips`, `PauseMenu`, lalu `Director`. Setelah world dan indeks campaign siap, `director.start()` membaca hash URL.

| Route | Mode |
|---|---|
| `#/space`, `#/space/<planet>` | `SpaceMode` |
| `#/planet/<i>`, `#/planet/<i>/city/<c>` | `PlanetMode` |
| `#/trade/<i>/<campaignId>` | `TradeMode`, namespace campaign terpisah |
| `#/town/<i>/<c>` | `TownMode` (interior di dalamnya) |
| `#/home/<i>/<c>/<homeId>` | `HomeMode`, editor rumah prosedural; rumah yang diterapkan dimasuki dari pintunya di town |

Halaman terpisah tanpa Director/World: `skirmish.html` (`src/skirmish/`) dan `farm.html` (Valley, `src/valley/`). Town memakai sebagian kode dan aset Skirmish (`render/paintedStyle.js`, `people/skirmishPeople.js`).

`Director.switchTo(route)` (`src/core/director.js`) menjalankan urutan berikut:

1. Import chunk mode baru dan panggil `static prepare(ctx, route)` untuk prefetch aset selama animasi keberangkatan.
2. Mode lama menjalankan `depart(route)` dan mengembalikan `{ cover, arrival }`. Cover berupa `fade`, `snapshot`, atau `clouds`.
3. `exit()` mode lama, lalu `new Mode(ctx, route, arrival)` dan `await enter()` di balik cover.
4. Satu frame digambar di balik cover, cover dibuka, lalu `arrived()` dipanggil.

Kontrak mode (semua opsional kecuali `update`/`render`): `prepare`, `constructor`, `enter`, `arrived`, `update(dt, t)`, `render()`, `resize(w, h)`, `navigate(route)`, `depart(route)`, `exit()`. `ctx` berisi `{ engine, world, overlay, missions, audio, tips, trade, director }`.

Trade memakai renderer WebGL bersama tetapi topologi hex private dan snapshot terrain campaign. `TradeSession` hidup pada app shell, bukan lifecycle scene: timer dan engine mem-pump clock monotonic yang sama, tick 1 detik, paling banyak 120 tick per chunk. Waktu aplikasi terbuka tetap dihitung saat berada di planet/town/space; reload tidak menghitung downtime. Menu pause dan dialog memakai pause/hold terpisah. Store `trade:index` memuat slot, `trade:<id>` menyimpan base sekali dan checkpoint ekonomi berkala. Web Locks (fallback lease localStorage) memberi satu writer. Rincian dan QA ada di [TRADE_GAME_RUNTIME.md](TRADE_GAME_RUNTIME.md).

Mode baru ditambahkan dengan mendaftarkannya di `MODES` dan `LABELS` pada `director.js`, menambah parser di `router.js`, dan mematuhi kontrak di atas. Mode wajib membuang geometry, material, texture, dan listener miliknya pada `exit()`. Harness `tests/browser/living-town.html` punya pemeriksaan lifecycle untuk mendeteksi resource yang bocor.

## 3. Engine, kualitas, post-processing

- `core/engine.js`: renderer `alpha: true`, ACES Filmic, exposure 1,05. Loop memanggil `mode.update` dan `mode.render` di dalam try/catch; error terakhir disimpan di `engine.lastError`. `afterFrame()` menunggu satu frame (dipakai untuk capture dan QA). Jam engine berhenti saat menu jeda terbuka.
- `core/quality.js`: preset `auto | high | medium | low`. `high` = pixel ratio ≤2, shadow, `detail: 1`; `medium` = ≤1,5, shadow, `detail: 0.75`; `low` = ≤1, tanpa shadow, `detail: 0.5`. Pada `auto`, pixel ratio naik turun mengikuti FPS dan, bila browser punya `EXT_disjoint_timer_query_webgl2`, waktu GPU per frame (turun di atas 90% anggaran 16,7 ms, naik bila perkiraan rasio berikutnya di bawah 70%). Engine menggambar paling banyak 60 frame per detik (layar 120 Hz tidak menggandakan beban GPU). Modul lain membaca `quality.settings.detail`.
- `core/post.js`: scene dirender sekali ke target MSAA (HalfFloat; 2 sampel di layar Retina, 4 di high biasa), bloom dibuat dari target itu di seperempat resolusi tanpa ditulis balik, lalu satu pass akhir menambahkan bloom, tone mapping, sRGB, dan grade (saturasi, kontras, gain, vinyet) langsung ke layar. Tampilan per mode ada di tabel `LOOKS` (`space`, `planet`, `town`, `interior`). Tier low mematikan seluruh rantai; canvas hanya memakai MSAA bawaan bila rantai mati saat start. Bloom hanya menambah warna, tidak menulis alpha di atas canvas transparan. `core/engine.js` juga mengganti kernel PCFSoft three (16 tap) dengan B-spline 9 tap.

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

- `map/mapGenerator.js` membuat biome, sungai, kota, faksi, ladang, rute darat (A*) dan rute laut dari hexasphere. RNG deterministik ada di `math/random.js`.
- `render/planetRenderer.js` (**3.105 baris**) menggambar terrain hex dengan kontur membulat, gunung (`mountainBuilder.js`), border faksi, props instanced per chunk dengan LOD, jalan/sungai/rute, awan, kamera fokus, dan POV kendaraan. File ini adalah kandidat pemecahan terbesar.
- `modes/planet/PlanetMode.js` membungkus renderer, `ui/menuController.js`, terbang di langit planet dengan kapal space (`render/planetFlight.js`), dan transisi ke space/town.

## 6. Level space

`SpaceMode` membangun `SystemBodies` dari `solarSystem.js`. Tekstur planet di orbit di-bake di `planetBake.worker.js` dari peta tile yang sama dengan globe (`modes/space/bake.js`), sehingga benuanya identik. Ada juga kapal pemain (`ship.js`), lalu lintas NPC (`traffic.js`), HUD, dan backdrop nebula + bintang (`render/spaceBackdrop.js`).

## 7. Level town

### 7.1 Pipeline

```text
map + cityIndex + footprints (bbox dari town.glb) + variant + options.density
  └─ generateTownLayout()            layout/townLayout.js → data murni, tanpa three.js
       ├─ townPlan, wards, neighbourhoodPlan   jalan, ward, lot (fantasy v2 / modern v2)
       ├─ vegetation, townGreenery             hutan, batu, taman, halaman
       ├─ streetLightPlan                      tiang lampu
       └─ roofPlan                             warna atap dari art/palette.js (b.roof)
  → layout { tiles, streets, buildings, props, trees, parks, paths, walls, docks,
             colliders, walkGraph, driveGraph, rivers, wards, farmCells, bridges, relief, spawn }

TownMode.enter()
  ├─ TownBuilder(layout, packs)      townBuilder.js: terrain, groundPaint, air, instance per chunk (LOD per item menurut ukuran di layar),
  │                                  jembatan, roadMarkings, groundCover, farTrees
  ├─ StreetLighting, TownSky
  ├─ Crowd + Pedestrians             crowd.js, walkNetwork.js, pedestrianRoutes.js
  ├─ RiggedPeople + avatar           peopleRig.js, peopleAppearance.js, peopleMotion.js, personLifecycle.js
  ├─ Fleet + Car + ChaseCamera       fleet.js, vehicle.js, vehicleKit.js, trafficRoute.js
  ├─ Colliders                       colliders.js
  ├─ Interior (saat masuk pintu)     interior.js + interiorLayout.js
  ├─ TownHud, Minimap, Speedo        ui/hud.js, ui/gauges.js, ui/cityNavigation.js
  └─ TownPlanner (tombol Tata kota)  planner/: peta 2D, acak ulang, kepadatan; Terapkan membangun ulang mode
```

Pilihan rencana kota (`variant`, `density`) disimpan per kota di `town-layout:<planet>:<seed>` (`world/townGeneration.js`). Varian 0 dengan kepadatan 1 adalah kota asli. Relief memakai seed dasar kota, sehingga reroll tidak memindahkan bukit. Detail: [TOWN_GENERATION_PLAN.md](TOWN_GENERATION_PLAN.md).

View di dalam town: `diorama` (OrbitControls), `walk` (orang ketiga), `drive` (chase camera), dan `interior`. Tombol 1/2/3 berpindah view; Esc kembali ke diorama.

### 7.2 Lapisan data vs render

| Tanpa three.js (bisa diuji di Node) | Memakai three.js |
|---|---|
| `layout/*` (termasuk `streetLightPlan`, `roofPlan`), `navigation/*`, `interiorLayout`, `personLifecycle` | `TownMode`, `townBuilder`, `groundPaint`, `groundCover`, `farTrees`, `roadMarkings`, `streetLighting`, `sky`, `crowd`, `peopleRig`, `peopleAppearance`, `peopleMotion`, `fleet`, `vehicle`, `vehicleKit`, `interior` |

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
- **Loader v2** `render/texturedAssetLibrary.js`: mempertahankan UV, index, smooth normal, dan texture map; material PBR glTF dikonversi ke ramp toon bersama. Saat ini hanya dipakai `scenery.glb`.
- Satu gradient toon tiga langkah (`getToonGradient`: 110/185/255) dipakai `MeshToonMaterial` untuk bangunan, props, terrain, dan orang.
- Material props town (`TownBuilder.makePropMaterial`): toon + vertex color + modulasi atlas `town_surfaces.png` + jendela malam prosedural. Atap (`roof` dari loader) diwarnai per instance dengan `aRoof` dari `b.roof`; kaca lebih gelap di siang hari dan curtain wall mendapat mullion. Material ground (`makeTerrainMaterial`): toon + paint map + grain + tile atlas. Foliage scenery: material glTF yang di-clone, alpha test 0,45, dan angin di vertex shader.
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

Markup ada di `index.html`, gaya di `src/style.css` (arah "The1": permukaan concrete, Barlow Condensed, pill, blok warna faksi, tanpa glow). Panel per mode: `ui/menuController.js` (planet), `modes/town/ui/hud.js`, `modes/space/hud.js`. Komponen bersama: `ui/gauges.js`, `ui/cityNavigation.js`, `core/pauseMenu.js`, `core/tips.js`, `core/missions.js`, `core/overlay.js`. Teks UI melalui `src/i18n/` (locale `id` dan `en`, lihat [I18N.md](I18N.md)); jangan menulis string UI langsung di JS/HTML.

## 11. Konvensi

- **Satuan:** globe beradius 10 unit. Town dalam meter. Space memakai unit sistem sendiri. Jangan menganggap ketiganya setara.
- **Sumbu town:** +Y ke atas, depan model +Z, `rotation.y = -yaw`. Frame U/N/V town diturunkan dari titik kota di planet.
- **Seed:** `seedFor(seed, 'domain')` untuk stream terpisah (layout, vegetasi, dekorasi, penghuni, atap). RNG deterministik memakai `mulberry32` dari `math/random.js`. Opsi generator baru hanya boleh mengambil angka acak bila nilainya bukan default, supaya kota lama tidak bergeser. `Math.random()` hanya untuk efek sementara.
- **Aset:** `<asset>_LOD0|1|2` di bawah Empty bernama aset; varian `<asset>_v<n>`; material `M_<nama>`; prefix town `f_` (fantasy), `m_` (modern), `t_` (pohon), `b_` (understory), `g_` (taman), `va_/vb_/vw_/vh_` (kit kendaraan), `fu_/it_` (furnitur/barang).
- **Debug:** di mode dev, `window.__globe = { engine, world, director, missions, audio, three }`.

## 12. Test dan QA

- `npm test`: 202 test lolos pada 10 Oktober 2026 (Node 22.23.1, studio M0), mencakup world/save, town, home, interior, Trade, Valley, Skirmish dan manifest aset. Angka lama (15/30/197) adalah snapshot historis.
- `GLOBE_SWEEP_SEEDS=100 node --test tests/town-generation.test.js`: sweep layout multi-seed.
- `npm run build`: build produksi.
- Harness browser: `/tests/browser/index.html` (interior, IndexedDB, 20 siklus) dan `/tests/browser/living-town.html` (overview, close-up, galeri aset, profil, navigasi, lifecycle).
- Tab browser otomatis sering `document.hidden`, sehingga RAF berhenti. Pakai screenshot hanya untuk memeriksa render, dan uji logika dengan memanggil sistem secara langsung.

## 13. Utang struktural yang diketahui

| Temuan | Bukti | Dampak |
|---|---|---|
| ~~`modes/town/` datar~~ | Selesai 29 September: 30 file dikelompokkan ke 7 subfolder | — |
| ~~RNG di tempat yang salah~~ | Selesai: `math/random.js`, 18 import diperbarui | — |
| ~~Import sirkular `townBuilder` ↔ `farTrees`~~ | Selesai: konstanta di `modes/town/scale.js` | — |
| ~~Data mengimpor modul render~~ | Selesai: `layout/streetLightPlan.js` dipisah dari `render/streetLighting.js` | — |
| ~~URL aset tersebar~~ | Selesai: `render/assetManifest.js` + test | — |
| File sangat besar | `planetRenderer.js` 3.105, `TownMode.js` 1.286, `townBuilder.js` 1.097, `style.css` 2.505 baris | Sulit direview, konflik merge, onboarding lambat. |
| Warna hard-coded | 601 literal warna (454 unik) di 28 file JS, 337 di `modes/town/` | Palet baru mulai terpusat di `art/palette.js` (atap, peta 2D); sisanya dimigrasi bertahap (ART_DIRECTION AD-1). |
| Dua loader aset | v1 (flat, vertex color) dan v2 (glTF bertekstur) berjalan bersamaan | Dua model shading dalam satu scene. |
| Misi global | `planet_globe_missions` tidak dipisah per dunia | Tercatat sebagai sisa WB-01. |

Urutan perbaikan yang disarankan ada di [REVIEW_2026_09_29.md](REVIEW_2026_09_29.md) §7.

## 14. Resep singkat

- **Sistem town baru:** taruh logika data di modul tanpa three.js yang dipanggil dari `generateTownLayout`, lalu buat renderer terpisah yang membaca data itu di `TownMode.enter()`. Tambah test Node untuk data dan pastikan hasilnya sama di semua tier kualitas.
- **Aset baru:** ikuti [ASSETS.md](ASSETS.md) §5. Generator Blender di `tools/blender/`, output runtime di `public/`, dan catat file serta pemakainya di registry.
- **Tipe planet baru:** tambah entri di `PLANET_TYPES` (`gen` dan `look`), lalu periksa bake orbit, globe, dan town.
- **Warna baru:** jangan tambah literal hex baru di modul render. Tambahkan token di `src/art/palette.js` ([ART_DIRECTION.md](ART_DIRECTION.md)).
- **Opsi generator kota:** teruskan lewat `options` di `generateTownLayout`, simpan di `world/townGeneration.js`, tampilkan di `planner/townPlanner.js`, dan pastikan nilai default menghasilkan kota asli ([TOWN_GENERATION_PLAN.md](TOWN_GENERATION_PLAN.md) §4).
