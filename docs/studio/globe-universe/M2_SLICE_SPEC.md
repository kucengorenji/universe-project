# M2 — Slice Universe end-to-end: "Perjalanan Pertama"

Ditetapkan lead (globe-lead), 10 Oktober 2026, berdasarkan keputusan pengguna Opsi B dan proposal DESIGN_ART_REVIEW §7. Prinsip: **pakai sistem yang sudah ada**, satu tujuan jelas, tanpa household/POI/ekonomi baru, tanpa membawa barang antar lantai.

## Tujuan pemain

"Temukan rumahmu di kota asal, tinggalkan jejak, dan pastikan rumah itu tetap seperti yang kamu tinggalkan."

| Langkah | Event (sumber) | Kondisi selesai |
|---|---|---|
| J1 Terbang ke planet asal | `land` / masuk `PlanetMode` dengan `planet === homePlanet` | Pemain berada di planet asal |
| J2 Mendarat di kota asal | `visit_town` dengan `city === homeCity` | TownMode kota asal aktif |
| J3 Temukan rumahmu | jarak pemain (walk/drive) ke pintu rumah awal < 6 m | Marker tujuan tercapai |
| J4 Masuk | `enter_house` pada `buildingId === starterHome` | Interior rumah awal aktif |
| J5 Tinggalkan jejak | `light_on` atau `place_item` di rumah awal | State interior tersimpan (journal sukses) |
| J6 Pulang lagi | keluar ke orbit/space, lalu kembali (atau reload) dan masuk rumah awal lagi | State J5 dipulihkan sama persis → selebrasi "Rumah ini milikmu" + petunjuk Home editor (opsional, tidak wajib) |

Kota asal = kota indeks deterministik di planet asal (`world.homeMap`); rumah awal = bangunan residensial enterable terdekat dari spawn yang portal-nya aman (`walkNetwork` `reason === null`), dipilih fungsi murni dan disimpan per dunia agar tidak berubah.

## Kontrak teknis

| Bagian | Modul (usulan) | Catatan |
|---|---|---|
| State perjalanan | `src/core/journey.js` (state machine murni + adapter) | Disimpan di `WorldStateStore` key `journey` dengan `schemaVersion: 1` (ikuti `world/versions.js` dan karantina M1-E1). Mendengar bus event yang sama dengan `Missions.emit`. |
| Pemilihan rumah awal | `src/world/starterHome.js` | Fungsi murni `(layout, walkNetwork, spawn) → buildingId`; test determinisme lintas seed; fallback bila tidak ada portal aman. |
| HUD tujuan | `src/ui/objectiveHud.js` | Satu baris tujuan aktif + jarak/arah; ID/EN via i18n; tidak menutupi prompt interaksi; hormati `prefers-reduced-motion`. |
| Wayfinding | `src/modes/town/ui/waypoint.js` + pin minimap | Beacon di pintu rumah awal, panah layar saat di luar pandangan, pin minimap. Planet: sorot kota asal; Space: sorot planet asal. |
| Onboarding | `core/tips.js` | Tambah tip `home` yang hilang; intro menyebut tujuan perjalanan. |
| Struktur | pecah `TownMode.js` yang disentuh slice (portal/interior/marker) ke modul kecil | Target: TownMode turun dan tidak bertambah. |

Checklist misi lama tetap ada sebagai tujuan sekunder.

## Acceptance M2

1. Node test: state machine journey (urutan, idempoten, persist/restore, schema), `starterHome` deterministik + portal aman pada ≥10 seed sweep.
2. E2E browser (`tools/qa/journey_e2e.mjs`, AGY): profil bersih → Space → planet asal → kota asal → rumah → nyalakan lampu → kembali ke space → reload → masuk lagi → lampu masih menyala → journey `done`; `engine.lastError` null di setiap langkah; screenshot per langkah di `docs/qa/journey/`.
3. Baseline perf (AGY, `tools/qa/perf_routes.mjs`): 1280×720, DPR 1, Low; per rute Space/Planet/Town/Interior: transfer cold (CDP, terkompresi), heap JS, frame p50/p95/p99 setelah warm-up; ulang dengan throttling CPU 4× sebagai proxy. **Dicatat jelas sebagai M1 Pro + proxy, bukan iGPU nyata.**
4. `npm test` + build lolos; smoke M1 tetap 0 error.
5. Artist: review copy/UX tujuan + wayfinding dari screenshot e2e (`handoff/M2-A.md`).
6. Playtest manusia oleh pengguna saat review (belum dapat dilakukan studio).
