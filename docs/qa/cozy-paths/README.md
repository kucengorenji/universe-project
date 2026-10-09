# Remake jalan dan path — 8 Oktober 2026

Jalan dunia utama Globe memakai permukaan lembut terinspirasi Animal Crossing: tanah madu, batu krem membulat, bata terracotta, bahu jalan krem, dan tepi path taman yang sedikit berlekuk. Referensi suasana: [Animal Crossing: New Horizons, Nintendo](https://animalcrossing.nintendo.com/new-horizons/explore/). Semua pola texture dibuat sendiri secara prosedural.

## Source dan runtime

- `src/art/palette.js`: palet dan pemetaan jenis jalan.
- `src/render/cozyPaths.js`: source master texture, shader terrain, paving jembatan, dan shader ribbon globe.
- `src/modes/town/render/groundPaint.js`: texture warna/mask untuk persimpangan, path, sidewalk, apron, dan plaza; dipakai kota modern dan fantasy pada semua planet.
- `src/modes/town/render/townBuilder.js`: integrasi terrain dan jembatan; batch marka aspal tidak dipasang lagi.
- `src/modes/town/render/pixelStyle.js`: surface baru mempertahankan palet ketika mode Pixel aktif; deck kayu Pixel yang sudah ada tetap dipakai.
- `src/modes/town/planner/townMapRenderer.js`: warna jalan/path/plaza pada peta mengikuti material dunia.
- `src/render/planetRenderer.js`: rute darat antar-kota memakai warna tanah/batu dan bahu krem dalam dua batch yang sudah ada.

Texture runtime dibuat langsung oleh canvas, lalu diunggah ke Three.js. `surface-master.png` adalah snapshot master data tone dari generator final; bukan albedo berwarna. RGBA, linear/NoColorSpace, 1024², empat slot 512² (earth, stone, brick, slot stone cadangan), repeat 4 meter, mipmaps dan anisotropy 8. Palet warna terpisah di texture terrain dan vertex jembatan. Tidak membutuhkan asset eksternal atau GLB baru.

Lebar navigasi, titik rute, layout, collider, tinggi terrain, ramp, dan analytical deck jembatan tidak diubah. Source rendering bersama langsung memberi tampilan baru pada dunia tersimpan tanpa migrasi layout. Halaman Skirmish terpisah tidak termasuk remake dunia Globe ini.

## Budget dan bukti

| Pemeriksaan | Status | Bukti |
|---|---|---|
| Build produksi | PASS | `npm run build`, Vite 6.4.3 |
| Suite repository | PASS | 162 test, 0 gagal |
| Regresi surface dan Pixel | PASS | 12 test setelah perubahan bridge/Pixel |
| Canvas warna dan mask dekat/jauh | PASS | 35 pemeriksaan deterministik; `report.json` |
| Modern/fantasy/Normal/Pixel | PASS | Render Chrome pada fixture seed 603616; shader gagal 0, `engine.lastError` kosong |
| Jembatan | PASS | 2.732 triangle pada bridge fixture; tinggi pusat 1,782707 m sama pada Normal/Pixel |
| Rute globe | PASS | 2 batch; fantasy 4.176 dan modern 4.500 triangle; geometri ribbon lama dipertahankan |
| Tekstur tambahan | PASS | 1 atlas 1024²; sekitar 5,33 MiB RGBA dengan mipmaps per town aktif |
| Geometri jalan tambahan | PASS | 0; pola dibuat di shader dan texture, batch marka jalan lama dihapus dari runtime |
| GLB round-trip, rig, LOD/collider baru | N/A | Surface procedural; geometri dan collision existing dipertahankan |
| Benchmark FPS/GPU dan browser lain | NOT_RUN | Bukti visual dari Chrome desktop, bukan klaim performa perangkat/mobile |

## Reproduksi

```sh
npm run dev -- --host 127.0.0.1 --port 5193
npm test
npm run build
```

Buka `/play/` lalu jalankan di browser:

```js
const qa = await import('/tools/qa/cozy_paths.js');
qa.validateCozyPathPaint();
```

Fixture memeriksa junction, earth lane, garden path, plaza, lot, grass, dan river crossing pada mode modern/fantasy serta layer near/far. Atlas dibandingkan ulang untuk memastikan generator deterministik. Screenshot actual engine: `modern.png`, `garden.png`, `bridge-close.png`, dan `globe.png`. Status: terverifikasi secara visual dan fungsional pada Chrome desktop; benchmark FPS khusus belum dijalankan.
