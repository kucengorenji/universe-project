# Dokumentasi Globe Universe

Game eksplorasi prosedural dengan empat level: tata surya (space), globe hex tiap planet, kota skala meter, dan interior bangunan. Semua konten diturunkan dari satu seed dunia. Dibuat dengan three.js dan Vite.

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
| [ART_DIRECTION.md](ART_DIRECTION.md) | Diagnosis visual dan kontrak tampilan | Usulan; menunggu keputusan AD-0 |
| [WORLD_BUILDING_ROADMAP.md](WORLD_BUILDING_ROADMAP.md) | Milestone WB-00–08 | Roadmap aktif |
| [ASSET_ART_AUDIO_PLAN.md](ASSET_ART_AUDIO_PLAN.md) | Milestone AA-00–09, budget, pipeline Blender, musik | Roadmap aktif; arah visual §1 mengikuti ART_DIRECTION setelah disetujui |
| [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) | Status aktual per milestone dan hasil verifikasi | Sumber kebenaran status |
| [REVIEW_2026_09_29.md](REVIEW_2026_09_29.md) | Gap rencana, inkonsistensi, dan urutan perapian | Review titik-waktu |
| [LIVING_TOWNS_IMPLEMENTATION.md](LIVING_TOWNS_IMPLEMENTATION.md) | Log implementasi 27 September | Log bertanggal; tidak diedit ulang |
| [TOWN_REFINEMENT_2026_09_29.md](TOWN_REFINEMENT_2026_09_29.md) | Log implementasi 29 September | Log bertanggal; tidak diedit ulang |
| [WATABOU_WORLD_BUILDING_NOTES.md](WATABOU_WORLD_BUILDING_NOTES.md) | Riset generator Watabou dan audit awal | Riset |
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
