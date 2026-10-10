# Dokumentasi Globe Universe

Game eksplorasi prosedural dengan empat level: tata surya (space), globe hex tiap planet, kota skala meter, dan interior bangunan, ditambah editor rumah (Home). Semua konten diturunkan dari satu seed dunia. Dibuat dengan three.js dan Vite.

Produk dan prototype lain di repo yang sama: **Trade Game** (mode campaign ekonomi terpisah dari CTA planet), **Skirmish** (`skirmish.html`, taktik), dan **Valley** (`farm.html`, look-dev art/animasi). Ketiganya punya status sendiri di [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).

```sh
npm install
npm run dev      # server pengembangan, biasanya http://localhost:5173
npm test         # test unit dan regresi (node --test)
npm run build    # build produksi ke dist/
```

## Urutan baca untuk kontributor baru

1. [ARCHITECTURE.md](ARCHITECTURE.md): cara game dirangkai, lapisan data vs render, konvensi, dan utang struktural.
2. [ASSETS.md](ASSETS.md): semua file aset, sumber pembuatnya, modul yang memuatnya, dan cara build ulang.
3. [ART_DIRECTION.md](ART_DIRECTION.md): kontrak tampilan (palet, shading, skala, komposisi).
4. [WORLD_BUILDING_ROADMAP.md](WORLD_BUILDING_ROADMAP.md) dan [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md): arah pengembangan dan status aktualnya.

## Status tiap dokumen

| Dokumen | Isi | Status |
|---|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Peta sistem inti | Aktif; perbarui saat menambah modul atau mode |
| [ASSETS.md](ASSETS.md) | Registry aset runtime, sumber, tekstur prosedural, audio | Aktif; perbarui setiap kali aset berubah |
| [BACKEND.md](BACKEND.md) | API Pages Functions + D1, telemetri, cloud save, dashboard React, setup produksi | Aktif; perbarui saat API atau skema berubah |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Cloudflare Pages, domain, deploy | Aktif |
| [ART_DIRECTION.md](ART_DIRECTION.md) | Diagnosis visual, kontrak tampilan, status migrasi | Aktif; arah disetujui 29 September |
| [TOWN_GENERATION_PLAN.md](TOWN_GENERATION_PLAN.md) | Planner kota 2D, reroll, kepadatan, usulan generator ala Watabou (TG-1–6) | Aktif |
| [WEBGAME_RESOURCE_PERFORMANCE_REPORT_2026_10_09.md](WEBGAME_RESOURCE_PERFORMANCE_REPORT_2026_10_09.md) | Opsi teknologi, audit aset dan build, budget resource, serta prioritas untuk komputer lemah | Analisis 9 Oktober 2026; target hardware belum divalidasi |
| [WORLD_BUILDING_ROADMAP.md](WORLD_BUILDING_ROADMAP.md) | Milestone WB-00–08 | Roadmap aktif |
| [TRADE_GAME_IMPLEMENTATION_PLAN.md](TRADE_GAME_IMPLEMENTATION_PLAN.md) | Gameplay ekonomi, flow masuk melalui CTA planet, layout desktop, resource procedural, save, dan tahapan TG-0–7 | Implementasi v1 terpasang; hasil runtime di TRADE_GAME_RUNTIME |
| [TRADE_GAME_RUNTIME.md](TRADE_GAME_RUNTIME.md) | Cara bermain, sistem ekonomi aktual, batas v1 dan bukti QA | Implementasi 9 Oktober 2026 |
| [ASSET_ART_AUDIO_PLAN.md](ASSET_ART_AUDIO_PLAN.md) | Milestone AA-00–09, budget, pipeline Blender, musik | Roadmap aktif; arah visual §1 mengikuti ART_DIRECTION setelah disetujui |
| [PROCEDURAL_HOME_BUILDING_PLAN.md](PROCEDURAL_HOME_BUILDING_PLAN.md), [PROCEDURAL_HOME_BUILDING_QA.md](PROCEDURAL_HOME_BUILDING_QA.md) | Editor rumah (Home): spesifikasi dan QA | QA 4 Oktober; lebih tua dari layout v5 |
| [PIXEL_TOWN.md](PIXEL_TOWN.md) | Gaya tampilan Pixel untuk town | Prototype playable |
| [TOWN_COMPACT_ASSETS_QA.md](TOWN_COMPACT_ASSETS_QA.md), [TOWN_GRAPHICS_LOD_QA.md](TOWN_GRAPHICS_LOD_QA.md) | Layout v5 compact, refresh aset, painted/LOD | QA 7 Oktober; JSON benchmark tidak ada di repo |
| [SKIRMISH_PLAN.md](SKIRMISH_PLAN.md) | Skirmish: keputusan, milestone M-A–M-F, peta kode | Aktif; M-E berjalan |
| [FARM_PLAN.md](FARM_PLAN.md) | Valley/Farm: art, aset, animasi, rencana port G1–G6 | Prototype V0–V5; port belum dimulai |
| [I18N.md](I18N.md) | Lokalisasi ID/EN | Aktif |
| [LANDING_DESIGN.md](LANDING_DESIGN.md), [DEPLOYMENT.md](DEPLOYMENT.md) | Landing page dan deploy Cloudflare Pages | Deploy terverifikasi 8 Oktober |
| [studio/globe-universe/](studio/globe-universe/) | Studio Herdr: review checkpoint, milestone, board | Aktif sejak 10 Oktober |
| [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) | Status aktual per milestone dan hasil verifikasi | Sumber kebenaran status |
| [REVIEW_2026_09_29.md](REVIEW_2026_09_29.md) | Gap rencana, inkonsistensi, dan urutan perapian | Review titik-waktu |
| [LIVING_TOWNS_IMPLEMENTATION.md](LIVING_TOWNS_IMPLEMENTATION.md) | Log implementasi 27 September | Log bertanggal; tidak diedit ulang |
| [TOWN_REFINEMENT_2026_09_29.md](TOWN_REFINEMENT_2026_09_29.md) | Log implementasi 29 September | Log bertanggal; tidak diedit ulang |
| [TOWN_PLAN_V3.md](TOWN_PLAN_V3.md) | Tata kota blok (dokumen menulis layout v4; kode sekarang `TOWN_LAYOUT_VERSION = 5`, lihat TOWN_COMPACT_ASSETS_QA): template dan blok dibelah ala Neighbourhood, parameter kepadatan, versi save | Aktif; perbarui saat generator kota berubah |
| [WATABOU_WORLD_BUILDING_NOTES.md](WATABOU_WORLD_BUILDING_NOTES.md) | Riset generator Watabou dan audit awal | Riset |
| [JEV_USE_CASES.md](JEV_USE_CASES.md) | Contoh use case Jev + Claude, setup OpenRouter, langkah dan prompt | Usulan; belum ada integrasi di kode |
| [`../README.md`](../README.md) | Changelog Update 1–9 | Riwayat; beberapa angka sudah basi (lihat review §2.4) |
| [`../plan.md`](../plan.md), [`../TILES_ROADMAP.md`](../TILES_ROADMAP.md) | Rencana 14 September dan upgrade tile | Historis; jangan dipakai sebagai acuan |

## Gambar referensi

- `references/asset-direction/`: referensi pohon, permukaan jalan, dan air pantai dari pemilik proyek (26 September). Hanya untuk arah visual dan tidak disalin ke tekstur runtime.
- `references/historical/new-dawn-protocol.png`: referensi *New Dawn Protocol* yang dipakai `plan.md` (14 September).
- `references/review-2026-09-29/`: screenshot bukti untuk review dan ART_DIRECTION.

## Aturan dokumen

- Satu topik per dokumen. Status milestone hanya dicatat di IMPLEMENTATION_STATUS; dokumen lain menautkannya.
- Log implementasi bertanggal tidak diedit ulang. Koreksi dicatat di log atau status yang lebih baru.
- Angka (byte, triangle, FPS, jumlah test) ditulis bersama tanggal dan cara mengukurnya.
- Saat menambah modul, mode, atau aset, perbarui ARCHITECTURE atau ASSETS dalam commit yang sama.
