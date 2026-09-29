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

## 2. File runtime

| File | Byte | Isi | Dibuat oleh | Dimuat oleh | Loader |
|---|---:|---|---|---|---|
| `models/assets.glb` | 292.372 | 50 aset skala tile hex, LOD1+LOD2, 59 material, hanya `POSITION` | `build_assets.py` | `planetRenderer.js`; `TownMode.js` sebagai fallback | v1 |
| `models/assets_lod0.glb` | 338.924 | LOD0 untuk 50 aset yang sama, dimuat belakangan | `build_assets.py` | sama seperti di atas | v1 |
| `models/town.glb` | 2.002.156 | 99 aset skala meter (bangunan fantasy/modern, kit kendaraan, kuda, pohon/semak/batu lama), 91 material, 140.752 triangle total LOD, hanya `POSITION` | `build_town_space.py` | `TownMode.js`; `PlanetMode.js` saat tiba lewat jalan dari kota (kit mobil yang sama) | v1 |
| `models/character.glb` | 1.379.572 | Rig `PeopleRig`, 1 skin, 10 outfit vertex color, 7 klip (`idle, walk, run, sit, sleep, drive, panic`) | `build_town_space.py` | `TownMode.js` (GLTFLoader langsung) → `peopleRig.js` | GLTFLoader |
| `models/furniture.glb` | 226.880 | 40 aset `fu_*`/`it_*`, 33 material | `build_town_space.py` | `TownMode.js` saat masuk kota → `interior.js` | v1 |
| `models/space.glb` | 411.588 | 6 aset: `rover`, `ship_cargo`, `ship_freighter`, `ship_frigate`, `ship_interceptor`, `ship_patrol` | `build_town_space.py` | `SpaceMode.js`, `PlanetMode.js` (rover) | v1 |
| `models/scenery.glb` | 1.244.892 | 20 aset × 3 LOD (8 spesies pohon + 4 varian, semak, bunga, bangku, planter, pergola, 2 dermaga, peti), 2 material, 2 tekstur tertanam, normal + UV + index | `build_scenery.py` | `TownMode.js` | v2 |
| `models/scenery.manifest.json` | 26.386 | Laporan build: hash, byte, bounds, triangle per LOD | `report_scenery.mjs` | `tests/scenery-assets.test.js` (tidak di-fetch game) | — |
| `textures/interior_atlas.jpg` | 375.272 | Atlas 4×4 lantai/dinding hasil render node material | `build_town_space.py` | `TownMode.js` saat masuk kota → `interior.js` | TextureLoader |
| `textures/town_surfaces.png` | 107.856 | 512² grayscale, 16 tile modulasi netral | `paint_living_surfaces.py` | `render/townSurfaces.js` | TextureLoader |
| `favicon.svg` | 501 | Ikon tab | manual | `index.html` | — |

Total `public/` **6.406.399 byte** (≈6,1 MiB) setelah dua tekstur antara dipindahkan (§4).

### Beban saat masuk kota

`TownMode.prepare()` memuat delapan file sekaligus: `assets.glb`, `assets_lod0.glb`, `town.glb`, `character.glb`, `furniture.glb`, `interior_atlas.jpg`, `scenery.glb`, dan `town_surfaces.png`, dengan total **5.967.924 byte**. Furnitur dan atlas interior ikut dimuat sebelum pemain masuk bangunan mana pun, padahal [ASSET_ART_AUDIO_PLAN](ASSET_ART_AUDIO_PLAN.md) §5 menargetkan interior yang lazy-loaded. Pack planet ikut dimuat karena town masih memakai fallback dari sana (§6).

## 3. Sumber dan cara build ulang

| Script | Output | Sumber `.blend` | Cara menjalankan |
|---|---|---|---|
| `tools/blender/build_assets.py` (736 baris) | `assets.glb`, `assets_lod0.glb` | `globe_assets.blend` | Lewat Blender MCP: `exec(open('tools/blender/build_assets.py').read(), globals())` |
| `tools/blender/build_town_space.py` (2.815 baris) | `town.glb`, `space.glb`, `furniture.glb`, `character.glb`, `interior_atlas.jpg` | `town_space_assets.blend` | Lewat Blender MCP, dengan pola yang sama |
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
3. Pilih warna material dari palet yang disepakati di [ART_DIRECTION.md](ART_DIRECTION.md). Jangan memakai ulang nama material dengan warna berbeda (§7).
4. Output runtime ditaruh di `public/`, sedangkan hasil antara di `tools/blender/textures/`.
5. Catat file baru di tabel §2 beserta modul yang memuatnya. Untuk pack v2, buat manifest dan tambahkan test ukuran/hash seperti `tests/scenery-assets.test.js`.
6. Periksa di harness `/tests/browser/living-town.html` (tombol *Asset gallery*) dengan lighting game, lalu jalankan `npm test` dan `npm run build`.

## 6. Utang aset yang terukur

| Temuan | Angka | Tindakan yang disarankan |
|---|---|---|
| Pohon/semak lama di `town.glb` tidak pernah digambar | `t_oak, t_birch, t_pine, t_spruce, t_cypress, t_palm, t_fruit, t_acacia, b_bush, b_flowers` = 186.960 byte buffer geometri (9,9% dari buffer `town.glb`), 14.522 triangle. `resolve()` selalu memilih versi `scenery.glb`, dan footprint pohon tidak dibaca dari pack. | Keluarkan koleksi Nature dari export `town.glb` (kecuali `r_rock`, yang masih dipakai). |
| `f_dock`, `m_dock`, `m_bench` di `town.glb` hanya menjadi bbox footprint | 30.144 byte buffer, 2.224 triangle | Pindahkan footprint ke manifest, lalu hapus mesh-nya. |
| Aset skala tile hex dipakai di town lewat `CATALOG` | Di Aegis Citadel: `barn` ×4, `windmill` ×1, `container_ship` ×3, `crop_row` ×203, `wheat_row` ×216. Kode layout juga memasang `boat` (dermaga fantasy), `rock_mesa`, dan `cactus` (gurun). | Buat versi town-scale di `town.glb` atau scenery, lalu hentikan pemuatan pack planet di town. |
| Loader v1 membuang UV dan normal | 4 dari 5 pack GLB | Migrasi bertahap ke v2 (AA-01), dimulai dari bangunan town. |
| Belum ada manifest untuk pack v1 | Hanya `scenery.glb` yang punya manifest dan test | Buat manifest per pack (ID, bounds, footprint, LOD, material). |
| Gedung kaca `m_office_v1` terbaca sebagai kotak polos di siang hari | Kaca berupa satu box `M_glass_teal` (24 vertex) tanpa mullion; pola jendela hanya muncul lewat shader malam | Tambahkan mullion/panel ke model atau pola jendela siang di shader. |
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
| `modes/town/groundPaint.js` | Paint map dekat (1536² atau 2048²) dan jauh (512² atau 1024²), mask permukaan, dan noise detail 256² | Layer dekat mencakup hingga 1.240 m (≈0,6 m per texel pada kota besar), layer jauh 2.200 m. |
| `modes/town/groundCover.js` | Atlas sprite rumput, pakis, alang-alang, bunga, dan kerikil | 14k/36k/72k instance menurut `detail`. |
| `modes/town/farTrees.js` | Atlas billboard pohon jauh | 7k/14k instance; mati di tier low. |
| `modes/town/sky.js` | Tekstur awan 1024×512 | Langit, matahari, dan bintang lewat shader. |
| `modes/town/streetLighting.js` | Sprite genangan cahaya 64² | Satu mesh gabungan per kota. |
| `modes/town/peopleAppearance.js` | Atlas wajah 256×320 | Dipakai bersama semua NPC dekat. |
| `modes/town/townBuilder.js` | Depth map air (dekat dan jauh) | Shader air, props `proto`, dan jembatan juga dibuat di modul ini. |
| `render/assetLibrary.js` | Gradient toon 3×1 (110/185/255) | Dipakai semua `MeshToonMaterial`. |
| `render/spaceBackdrop.js` | Nebula 1024×512, 4.200 titik bintang | |
| `modes/space/bake.js` + `world/planetBake.worker.js` | Tekstur planet di orbit | Dari peta tile yang sama dengan globe. |
| `modes/space/bodies.js` | Glow radial bintang, tekstur cincin planet | |
| `modes/space/ship.js`, `traffic.js` | Sprite glow mesin, sprite kapal NPC | |
| `render/planetRenderer.js` | Sprite label kota, canvas ekspor screenshot | |
| `ui/gauges.js` | Canvas minimap | UI, bukan tekstur 3D. |

## 9. Audio

Tidak ada file audio. Semua suara disintesis dengan Web Audio di `src/core/audio.js`: bed ambience (`space`, `planet`, `town`, `interior`), critter siang/malam, pad chord dan motif town, mesin kendaraan, SFX (`step, door, switch, pickup, drop, sit, ignition, hit, whoosh, land, clunk, jump, tick`), suara UI, fanfare, radio, TV, dan perapian. Jika nanti ada sample audio, taruh file runtime di `public/audio/`, master/sumbernya di luar `public/`, lalu catat keduanya di dokumen ini.
