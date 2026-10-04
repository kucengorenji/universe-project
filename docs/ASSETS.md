# Globe Universe — registry aset

Daftar semua aset game: file yang dikirim ke pemain, sumber pembuatnya, modul yang memuatnya, serta tekstur dan suara yang dibuat dari kode. Aturan tampilan (palet, shading, densitas) ada di [ART_DIRECTION.md](ART_DIRECTION.md). Budget dan rencana produksi jangka panjang ada di [ASSET_ART_AUDIO_PLAN.md](ASSET_ART_AUDIO_PLAN.md).

Diperbarui 29 September 2026. Ukuran dalam byte dari file di disk, sebelum kompresi HTTP. Isi GLB dibaca langsung dari chunk JSON-nya.

## 1. Aturan folder

| Folder | Isi | Dikirim ke pemain? |
|---|---|---|
| `public/models/`, `public/textures/` | Hanya file yang di-fetch game saat runtime. | Ya, disalin apa adanya ke `dist/`. |
| `tools/blender/` | Script generator (`.py`, `.mjs`) dan file sumber `.blend`. | Tidak. |
| `tools/blender/textures/` | Tekstur antara yang hanya dipakai saat build dan sudah tertanam di GLB. | Tidak. |
| `docs/references/` | Gambar referensi dan screenshot review. | Tidak. |

File `*.blend1` (backup otomatis Blender) diabaikan git. Jangan menaruh sumber, referensi, atau hasil antara di `public/`, karena Vite menyalin seluruh isinya ke build.

Di kode, semua URL runtime ada di satu tempat: `src/render/assetManifest.js` (`ASSETS`, `ASSET_FILES`). `tests/asset-manifest.test.js` memeriksa bahwa setiap entri ada di `public/` dan bahwa `public/` tidak berisi file yang tidak dimuat game.

## 2. File runtime

| File | Byte | Isi | Dibuat oleh | Dimuat oleh | Loader |
|---|---:|---|---|---|---|
| `models/assets.glb` | 292.372 | 50 aset skala tile hex, LOD1+LOD2, 59 material, hanya `POSITION` | `build_assets.py` | `planetRenderer.js`; `TownMode.js` sebagai fallback | v1 |
| `models/assets_lod0.glb` | 338.924 | LOD0 untuk 50 aset yang sama, dimuat belakangan | `build_assets.py` | sama seperti di atas | v1 |
| `models/town.glb` | 2.002.152 | 99 aset skala meter (bangunan fantasy/modern, kit kendaraan, kuda, pohon/semak/batu lama), 91 material, 140.752 triangle total LOD, hanya `POSITION` | `build_town_space.py` | `TownMode.js`; `PlanetMode.js` saat tiba lewat jalan dari kota (kit mobil yang sama) | v1 |
| `models/character.glb` | 1.379.572 | Rig `PeopleRig`, 1 skin, 10 outfit vertex color, 7 klip (`idle, walk, run, sit, sleep, drive, panic`) | `build_town_space.py` | `TownMode.js` (GLTFLoader langsung) → `peopleRig.js` | GLTFLoader |
| `models/furniture.glb` | 801.628 | 45 aset `fu_*`/`it_*` gaya chunky (bevel tebal, palet ROOM dari referensi dapur diorama), termasuk dekor dinding `fu_window`, `fu_wall_shelf`, `fu_picture_v0/v1`, `fu_clock`; hanya LOD0, 67.992 triangle, satu material per token palet, hanya `POSITION` | `build_furniture.py` (`chunky/props.py`) | `TownMode.js` saat masuk kota → `interior.js` | v1 + `crease` (normal halus dibangun saat load) + peta `glow` |
| `models/space.glb` | 411.588 | 6 aset: `rover`, `ship_cargo`, `ship_freighter`, `ship_frigate`, `ship_interceptor`, `ship_patrol` | `build_town_space.py` | `SpaceMode.js`, `PlanetMode.js` (kapal terbang di planet) | v1 |
| `models/scenery.glb` | 1.244.892 | 20 aset × 3 LOD (8 spesies pohon + 4 varian, semak, bunga, bangku, planter, pergola, 2 dermaga, peti), 2 material, 2 tekstur tertanam, normal + UV + index | `build_scenery.py` | `TownMode.js` | v2 |
| `models/environment.glb` | 3.355.532 | Kit environment B1: 25 varian × 3 LOD (oak ×3, pine ×3, boulder ×4, slab ×3, grass tuft ×3, shrub ×3, cliff, fence, dock, wall, gable roof, modern facade), 18 material palet, 5 tekstur netral tertanam | `tools/blender/environment/scripts/build_b1.py` (salinan `exports/staging/b1/environment_b1_v001.glb`) | `TownMode.js` → `loadTexturedPack(..., { mergeShades: true })`; pemetaan nama layout di `render/environmentKit.js` | v2 + gabung shade |
| `models/npc.glb` | 338.792 | NPC v1 C01 (gaya chunky, ±1,76 m): 36 mesh kaku di bawah 18 pivot, 20 material flat, tanpa skin/klip | `docs/art-direction/npc-v1/blender/c01_overcooked.py` | `TownMode.js` → `people/chunkyPeople.js` (digabung jadi 1 SkinnedMesh rigid, pose dari kode) | GLTFLoader |
| `models/soldier_v5_m.glb` | 5.971.600 | Tentara skirmish v5, badan laki-laki: badan, wajah, dan rambut dari model VRoid CC0 (rambut 4 hero dicangkok dari donor + rambut pendek dasar), seragam VC1 dimodel di Blender (tunik, rok tunik, kerah, manset, celana, bot, sarung tangan, plaket, saku, epolet, harness Y, syal), kit kelas (`kit_*`), helm `helm_fed`/`helm_imp`; satu mesh dekat (±78k segitiga untuk semua piece) + `soldier_lod1` (±23k); rig humanoid 52 tulang menghadap +Z dengan rest identitas; `TEXCOORD_0` = atlas kepala/kain, `TEXCOORD_1` = slot palet + piece (extras `pieces`), extras `clip_speed`; 9 klip mocap Quaternius ter-retarget | `tools/blender/skirmish/soldier_v5.py --body m` | `skirmish/units/vcSoldiers.js` (index buffer per prajurit, AnimationMixer + IK, genggaman, LOD) | GLTFLoader |
| `models/soldier_v5_f.glb` | 6.039.076 | Sama untuk badan perempuan (4 hero, tonjolan dada dihaluskan, tanpa saku dada) | `soldier_v5.py --body f` | `vcSoldiers.js` | GLTFLoader |
| `textures/soldier_v5_m_cloth.png`, `textures/soldier_v5_f_cloth.png` | 2.843.008 / 2.810.200 | Atlas kain 2048² (data): R gelap-terang (AO ter-bake, bercak, cahaya dari atas), G piping faksi, B tinta pensil (jahitan, lipatan, tepi, arsiran) | `soldier_v5.py --atlas` | `vcSoldiers.js` | TextureLoader |
| `textures/soldier_v5_m_head.png`, `textures/soldier_v5_f_head.png` | 989.759 / 923.634 | Atlas kepala 2048² (warna sRGB + alpha): tekstur wajah, mata, alis, mulut VRoid; rambut, alis, dan iris jadi kecerahan untuk diwarnai per hero | `soldier_v5.py --head` | `vcSoldiers.js` | TextureLoader |
| `textures/soldier_portraits.png` | 978.317 | Potret lukis 9 hero (3 × 3, 384² per sel, urutan roster): EEVEE toon + Kuwahara + tinta Freestyle di atas kertas | `soldier_v5.py --portraits` (kedua build mengisi selnya) | `vcSoldiers.loadPortraits` → kartu Prep, HUD, cut-in | ImageLoader |
| `models/military.glb` | 206.888 | 23 aset skirmish (termasuk `p_bridge` jembatan batu lengkung dan `p_hedge` semak pagar): senjata `w_*` (+ empty `_support`, `_muzzle`), karung pasir, barikade, hedgehog, kawat, peti, drum, bendera camp (`M_paint`), tenda, menara jaga, bunker, reruntuhan, tank (`p_tank_hull` + `p_tank_turret`, radiator `M_radiator` menyala), kincir angin | `tools/blender/skirmish/military_kit.py` | `skirmish/battlefield/fieldBuilder.js`, `skirmish/units/soldiers.js` | `loadAssetPack` |
| `models/scenery.manifest.json` | 26.386 | Laporan build: hash, byte, bounds, triangle per LOD | `report_scenery.mjs` | `tests/scenery-assets.test.js` (tidak di-fetch game) | — |
| `textures/interior_atlas.jpg` | 375.272 | Atlas 4×4 lantai/dinding hasil render node material | `build_town_space.py` | `TownMode.js` saat masuk kota; sejak 30 September tidak dibaca `interior.js` (lantai dan dinding prosedural di `roomShell.js`), kandidat untuk dihapus dari pipeline | TextureLoader |
| `textures/town_surfaces.png` | 107.856 | 512² grayscale, 16 tile modulasi netral | `paint_living_surfaces.py` | `render/townSurfaces.js` | TextureLoader |
| `favicon.svg` | 501 | Ikon tab | manual | `index.html` | — |

Total `public/` **6.406.399 byte** (≈6,1 MiB) setelah dua tekstur antara dipindahkan (§4).

Dengan `environment.glb` dan `npc.glb` (29 September 2026, layout v3) total bertambah 3.694.324 byte menjadi **10.100.723 byte** (≈9,6 MiB). Keduanya dimuat bersama pack town lain; bila salah satu gagal dimuat, town jatuh kembali ke `scenery.glb`/`town.glb` dan ke `character.glb`.

### Beban saat masuk kota

`TownMode.prepare()` memuat delapan file sekaligus: `assets.glb`, `assets_lod0.glb`, `town.glb`, `character.glb`, `furniture.glb`, `interior_atlas.jpg`, `scenery.glb`, dan `town_surfaces.png`, dengan total **5.967.924 byte**. Furnitur dan atlas interior ikut dimuat sebelum pemain masuk bangunan mana pun, padahal [ASSET_ART_AUDIO_PLAN](ASSET_ART_AUDIO_PLAN.md) §5 menargetkan interior yang lazy-loaded. Pack planet ikut dimuat karena town masih memakai fallback dari sana (§6).

## 3. Sumber dan cara build ulang

| Script | Output | Sumber `.blend` | Cara menjalankan |
|---|---|---|---|
| `tools/blender/build_assets.py` (736 baris) | `assets.glb`, `assets_lod0.glb` | `globe_assets.blend` | Lewat Blender MCP: `exec(open('tools/blender/build_assets.py').read(), globals())` |
| `tools/blender/build_town_space.py` (2.815 baris) | `town.glb`, `space.glb`, `character.glb`, `interior_atlas.jpg` (koleksi Furniture lama masih dibangun, tidak diekspor lagi) | `town_space_assets.blend` | Lewat Blender MCP, dengan pola yang sama |
| `tools/blender/build_furniture.py` + `tools/blender/chunky/` | `furniture.glb`; `--preview` juga merender `tools/blender/qa/furniture_lineup.png` | — (dibangun dari kode) | `GLOBE_ROOT=<root> blender -b --factory-startup --python tools/blender/build_furniture.py [-- --preview]` |
| `tools/blender/paint_living_surfaces.py` | `public/textures/town_surfaces.png`, `tools/blender/textures/flora_cards.png` | — | `python3 tools/blender/paint_living_surfaces.py` (butuh Pillow; Python sistem di mesin ini belum punya Pillow) |
| `tools/blender/build_scenery.py` | `scenery.glb`, `tools/blender/textures/scenery_atlas.png` | `scenery_assets.blend` | `blender --background --python tools/blender/build_scenery.py` (proses Blender baru, karena script menghapus semua objek scene) |
| `tools/blender/report_scenery.mjs` | `public/models/scenery.manifest.json` | — | `node tools/blender/report_scenery.mjs` |

Urutan untuk pack scenery: `paint_living_surfaces.py` → `build_scenery.py` → `report_scenery.mjs` → `npm test`. Test membandingkan hash manifest dengan GLB, jadi manifest wajib dibuat ulang setelah GLB berubah.

## 4. Tekstur antara (tidak dikirim)

| File | Dipakai oleh | Catatan |
|---|---|---|
| `tools/blender/textures/flora_cards.png` | `build_scenery.py` (tekstur daun/bunga, tertanam di `scenery.glb`) | Dipindah dari `public/textures/` pada 29 September 2026; hash tidak berubah. |
| `tools/blender/textures/scenery_atlas.png` | Ditulis `build_scenery.py`, tertanam di `scenery.glb` | Dipindah dari `public/textures/` pada 29 September 2026; hash tidak berubah. |

Sebelum dipindah, keduanya ikut tersalin ke `dist/textures/` padahal tidak pernah di-fetch game.

## 5. Menambah atau mengganti aset

1. Tulis atau perluas generator di `tools/blender/`. Simpan `.blend` sumbernya dan gunakan seed tetap.
2. Ikuti konvensi penamaan: Empty `<asset>`, anak `<asset>_LOD0|1|2`, varian `<asset>_v<n>`, material `M_<nama>`. Model town dibuat dalam meter, depan +Z, dan alas di y = 0.
3. Pilih warna material dari palet di `src/art/palette.js` ([ART_DIRECTION.md](ART_DIRECTION.md)). Jangan memakai ulang nama material dengan warna berbeda (§7). Atap rumah fantasy (`M_roof_*`) diwarnai ulang oleh palet kota lewat atribut `roof`; warna authored di Blender hanya menjadi fallback.
4. Output runtime ditaruh di `public/`, sedangkan hasil antara di `tools/blender/textures/`.
5. Daftarkan file runtime baru di `src/render/assetManifest.js` dan catat di tabel §2 beserta modul yang memuatnya. Untuk pack v2, buat manifest dan tambahkan test ukuran/hash seperti `tests/scenery-assets.test.js`.
6. Periksa di harness `/tests/browser/living-town.html` (tombol *Asset gallery*) dengan lighting game, lalu jalankan `npm test` dan `npm run build`.

## 6. Utang aset yang terukur

| Temuan | Angka | Tindakan yang disarankan |
|---|---|---|
| Pohon/semak lama di `town.glb` tidak pernah digambar | `t_oak, t_birch, t_pine, t_spruce, t_cypress, t_palm, t_fruit, t_acacia, b_bush, b_flowers` = 186.960 byte buffer geometri (9,9% dari buffer `town.glb`), 14.522 triangle. `resolve()` selalu memilih versi `scenery.glb`, dan footprint pohon tidak dibaca dari pack. | Keluarkan koleksi Nature dari export `town.glb` (kecuali `r_rock`, yang masih dipakai). |
| `f_dock`, `m_dock`, `m_bench` di `town.glb` hanya menjadi bbox footprint | 30.144 byte buffer, 2.224 triangle | Pindahkan footprint ke manifest, lalu hapus mesh-nya. |
| Aset skala tile hex dipakai di town lewat `CATALOG` | Di Aegis Citadel: `barn` ×4, `windmill` ×1, `container_ship` ×3, `crop_row` ×203, `wheat_row` ×216. Kode layout juga memasang `boat` (dermaga fantasy), `rock_mesa`, dan `cactus` (gurun). | Buat versi town-scale di `town.glb` atau scenery, lalu hentikan pemuatan pack planet di town. |
| Loader v1 membuang UV dan normal | 4 dari 5 pack GLB | Migrasi bertahap ke v2 (AA-01), dimulai dari bangunan town. |
| Belum ada manifest untuk pack v1 | Hanya `scenery.glb` yang punya manifest dan test | Buat manifest per pack (ID, bounds, footprint, LOD, material). |
| Toko modern `m_shop_v1` terbaca sebagai kotak putih dari samping/belakang | Sisi ±X: ±141 m² dinding dan ±2 m² kaca, tinggi 12,7 m | Tambahkan jendela samping/belakang dan pintu servis di `build_town_space.py`, lalu ekspor ulang `town.glb`. (Versi awal dokumen ini salah menyebut `m_office_v1`.) |
| Kit environment B1 lebih berat dari scenery lama | Oak B1 LOD0 5.132 triangle (scenery `t_oak` 1.348). Shade digabung per gambar saat load: oak 2 draw call, batu 1. | Ukur frame time di kota hutan pada tier medium; bila perlu, bake LOD0 yang lebih ringan (target ≤2.500) di `build_b1.py` v002. |
| NPC v1 baru satu karakter (C01) | 18.994 triangle per orang, pool 24/14/6. Variasi dari warna 7 slot + 4 aksesori + crown rambut. | Bangun C02–C10 dari `catalog.json` dengan script yang sama; turunkan triangle kepala/tangan untuk LOD pool. |
| Interior dimuat terlalu awal | `furniture.glb` + `interior_atlas.jpg` = 602.152 byte saat masuk kota | Muat saat pemain mendekati pintu atau saat pertama kali masuk bangunan. |

## 7. Palet material di pack

Empat pack flat (`assets`, `town`, `furniture`, `space`) berisi **136 warna dasar material yang berbeda**. Sebanyak 45 nama material dipakai lebih dari satu pack, dan 5 di antaranya punya warna berbeda:

| Material | Warna per pack |
|---|---|
| `M_glass` | assets `#6f9ec7`, town `#405f7f` |
| `M_glass_dark` | assets `#405f7f`, town `#334b66`, space `#334b66` |
| `M_timber` | assets `#6b462a`, town `#5e3d27` |
| `M_hull` | assets `#794b2e` (kayu kapal), space `#e8ebef` (logam kapal) |
| `M_hull_dark` | assets `#5a3825`, space `#3d4351` |

Nama yang sama dengan arti berbeda membuat palet tidak bisa diatur dari satu tempat. [ART_DIRECTION.md](ART_DIRECTION.md) AD-1 mengusulkan nama material yang dipetakan ke token palet.

## 8. Tekstur dan sprite yang dibuat dari kode

Tekstur berikut tidak ada sebagai file. Semuanya dibuat saat runtime dengan canvas 2D atau `DataTexture`:

| Modul | Tekstur | Catatan |
|---|---|---|
| `modes/town/render/groundPaint.js` | Paint map dekat (1536² atau 2048²) dan jauh (512² atau 1024²), mask permukaan, dan noise detail 256² | Layer dekat mencakup hingga 1.240 m (≈0,6 m per texel pada kota besar), layer jauh 2.200 m. |
| `modes/town/render/groundCover.js` | Atlas sprite rumput, pakis, alang-alang, bunga, dan kerikil | 14k/36k/72k instance menurut `detail`. Sejak v3 disebar per rumpun (pusat + anggota Gaussian) dan berderet di kaki hedge/pagar; di kota hanya di tepi halaman. |
| `modes/town/render/farTrees.js` | Atlas billboard pohon jauh | 7k/14k instance; mati di tier low. |
| `modes/town/render/sky.js` | Tekstur awan 1024×512 | Langit, matahari, dan bintang lewat shader. |
| `modes/town/render/streetLighting.js` | Sprite genangan cahaya 64² | Satu mesh gabungan per kota. |
| `modes/town/people/peopleAppearance.js` | Atlas wajah 256×320 | Dipakai bersama semua NPC dekat. |
| `modes/town/render/townBuilder.js` | Depth map air (dekat dan jauh) | Shader air, props `proto`, dan jembatan juga dibuat di modul ini. |
| `render/assetLibrary.js` | Gradient toon 3×1 (110/185/255) | Dipakai semua `MeshToonMaterial`. |
| `render/spaceBackdrop.js` | Nebula 1024×512, 4.200 titik bintang | |
| `modes/space/bake.js` + `world/planetBake.worker.js` | Tekstur planet di orbit | Dari peta tile yang sama dengan globe. |
| `modes/space/bodies.js` | Glow radial bintang, tekstur cincin planet | |
| `modes/space/ship.js`, `traffic.js` | Sprite glow mesin, sprite kapal NPC | |
| `render/planetRenderer.js` | Sprite label kota, canvas ekspor screenshot | |
| `ui/gauges.js` | Canvas minimap | UI, bukan tekstur 3D. |

## 9. Audio

Tidak ada file audio. Semua suara disintesis dengan Web Audio di `src/core/audio.js`: bed ambience (`space`, `planet`, `town`, `interior`), critter siang/malam, pad chord dan motif town, mesin kendaraan, SFX (`step, door, switch, pickup, drop, sit, ignition, hit, whoosh, land, clunk, jump, tick`), suara UI, fanfare, radio, TV, dan perapian. Jika nanti ada sample audio, taruh file runtime di `public/audio/`, master/sumbernya di luar `public/`, lalu catat keduanya di dokumen ini.
