# Trade Game — implementasi v1

9 Oktober 2026. Implementasi lokal pada working tree; belum commit atau deploy. Acuan keputusan: [plan yang disetujui](TRADE_GAME_IMPLEMENTATION_PLAN.md). Registry status: [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).

## Mulai bermain

Jalankan `npm run dev`, buka `/play/?lang=id`, lalu masuk planet Terran. Klik **Trade Game → Mulai bermain**. Campaign dimulai dalam keadaan jeda: satu kota pemain, dua mitra, satu ladang dan satu karavan gratis.

1. **Bangun** Bakery dekat Hearth; tile valid memiliki ring hijau. Hover memberi biaya total termasuk konektor dan material lokal. Klik tile untuk memulai konstruksi.
2. **Rute**: pilih Hearth, pilih Ironvale, muatan roti, satu karavan, cadangan empat unit. Preview menampilkan koneksi di globe, biaya koneksi/kendaraan, waktu, kapasitas dan estimasi kas. Muatan balik tools membeli kebutuhan pembangunan dari NPC.
3. Klik **Jalankan**. Ladang menghasilkan gandum; Bakery memakai gandum dan mengirim roti ke gudang. Karavan membawa surplus ke pembeli; pembayaran tiba ketika barang sampai.
4. Tambahkan rute produktif kedua. Gudang menambah ruang, Depot membuka slot kendaraan, logging/quarry menyediakan material. Upgrade produksi ketika suplai menjadi bottleneck. Cadangan, input, demand, kas, kapasitas, budget pembeli dan antrean mempunyai diagnosis berbeda.
5. Setelah milestone jaringan, bangun kota baru dan pasok pangan/material dengan rute. Farm lokal dapat menjaga pangan setelah materialnya benar-benar tiba. Pelabuhan pada pantai kering membuka kapal; jalur air harus menghubungkan kedua port.
6. Terima kontrak jika jaringan sanggup memenuhi deadline; hadiah bersifat opsional. Lima milestone berakhir pada tiga kota stabil, produksi tools dan arus kas positif, kemudian sandbox terus berjalan.

Trade tidak mengubah daftar kota/town/home eksplorasi. Tombol **Eksplorasi planet** mengembalikan UI normal. Ekonomi campaign aktif tetap berjalan ketika aplikasi terbuka, termasuk di TownMode dan SpaceMode. Reload membekukan progres pada checkpoint dan membuka campaign dalam keadaan jeda; tidak ada progres offline. Tidur pada dunia eksplorasi tidak melompati jam ekonomi.

| Input | Aksi |
|---|---|
| Drag / wheel | Orbit / zoom globe |
| B / R | Catalog bangunan / wizard rute |
| Space | Jeda ekonomi |
| 1 / 2 / 4 | Kecepatan simulasi |
| F | Fokus pilihan |
| Esc | Batal tool; saat idle membuka menu pause |
| P | Menu pause aplikasi |

Shortcut tidak aktif ketika mengetik atau berada di dialog. `B` diprioritaskan untuk pembangunan dalam Trade, sehingga tidak men-toggle mute global.

## Sistem yang terpasang

- Barang: gandum, roti, kayu, batu, bijih dan tools. Sembilan fasilitas: farm, Bakery, logging, quarry, mine, workshop, warehouse, depot, port. Recipes/biaya/material/upkeep ada di `src/trade/catalog.js`.
- Resource procedural berasal dari seed independen dan biome/river/deposit. Terrain/RNG dan kota normal dipertahankan. Scenario memilih lokasi dengan pangan, lahan kerja dan kayu, serta dua partner yang terhubung. Terrain tidak cocok ditolak dengan pesan; tidak dipindahkan diam-diam.
- Mine/quarry memakai akses darat dekat deposit; gunung tetap tidak dapat dilalui. Catchment, occupancy, resource dan dry footprint renderer membatasi placement. Konektor shortest path dibuat dari adjacency hex/pentagon; jalur v1 memiliki biaya perjalanan per tile seragam.
- Stok per kota, buffer lokal, konsumsi pangan, pajak, produksi NPC terbatas target, demand curve dan budget pasar. Uang menggunakan integer sen. Import dan transfer pemain tidak dihitung sebagai pendapatan penjualan.
- Dispatch mengurangi stok dan meng-escrow budget NPC pada keberangkatan. Pembayaran/reward terjadi sekali pada arrival. Incoming cargo mereservasi kapasitas dan demand. Perubahan manifest berlaku pada keberangkatan berikutnya; pause menyelesaikan trip, return dan muatan yang sudah berjalan.
- Karavan 8 unit/trip; kapal 24. Upgrade koneksi menyingkat perjalanan dan antrean. Port memiliki antrean loading bersama. Prioritas rute memakai bobot dan umur sejak dispatch terakhir agar rute rendah tetap dilayani. Depot menyediakan slot per kota; warehouse menyediakan ruang. Gudang penuh tidak diselesaikan dengan menambah kendaraan.
- Pembangunan dan convoy pendiri memiliki countdown; kendaraan/convoy mengikuti progress di globe. Penutupan rute menunggu cargo/return selesai. Bongkar memberi refund parsial; material konstruksi yang belum dipakai kembali sejauh kapasitas gudang tersedia. Trip kosong darurat dapat kembali ketika kas habis, sehingga kendaraan tidak tertahan permanen.
- Kontrak, tiga event sementara, bantuan pemulihan 250 kredit sekali, hadiah milestone dan mode sandbox. Tidak ada combat atau kehilangan cargo acak.
- HUD: topbar ekonomi/clock; rail kota/rute/kontrak/milestone/masalah; kartu tujuan; satu inspector kanan; dock aksi/overlay/save. Panel scroll mempertahankan kontrol pada desktop kecil. CTA/setup dan bangunan mahal menggunakan dialog native dengan focus kembali.
- Campaign index/base/checkpoint memakai `WorldStateStore` dengan IndexedDB dan journal lokal. Modal/menu memakai hold terpisah dari manual pause. Catch-up terbatas per chunk; status sinkronisasi terlihat. Writer Web Locks, fallback localStorage lease, takeover checkpoint, export/import JSON versioned dengan pemeriksaan nilai/ID/topologi. Arsip seed lain dapat diekspor dari setup. Save error menampilkan **Belum tersimpan**.

## Verifikasi

`npm test`: **197 test lolos**, termasuk determinisme, sweep grid 2–5, migrasi save, command invalid tanpa biaya parsial, reserve/demand/escrow, arrival/reward sekali, transfer internal, port/kapal, recovery, prioritas tanpa starvation, depot/refund, malformed checkpoint dan clock/reload. `npm run build` berhasil.

`node tools/qa/trade_campaign.mjs`: playthrough menggunakan command dan tick normal, tanpa mengubah uang/material/unlock. Seed 123456 mencapai produksi pada 45 detik, penjualan pada 46, jaringan pada 91, kota kedua pada 445 dan target akhir pada **1.480 detik simulasi**. Tiga kota mendapat pangan; semua barang diproduksi; arus operasi akhir sekitar **59 kredit/menit**. Ini bukti ketercapaian satu strategi, bukan penilaian bahwa balancing semua strategi sudah final.

`tools/qa/trade_game.mjs`: Chrome lokal headless, macOS, Node 22.23.1, seed sama/grid 3. Bootstrap, placement Bakery, wizard/manifest, kontrak, port dan wizard laut memakai klik/input UI nyata. Playthrough penuh memutar ulang strategi command normal melalui app session agar waktu panjang dapat diperiksa deterministik. Pemeriksaan juga mencakup reload saat transit, ekonomi di planet/town/space, pause, tab kedua/takeover, quota dan import invalid, layout 1440×900/1280×720/1024×768 serta viewport 720×450 sebagai kondisi zoom sempit. Bukti: [report.json](qa/trade-game/report.json) dan screenshot pada folder [qa/trade-game](qa/trade-game/).

Enam pergantian planet↔Trade setelah warm-up mempertahankan satu HUD/listener session dan jumlah geometry/texture yang stabil. `engine.lastError` dan page errors diperiksa, bukan console saja. Screenshot diperiksa visual; viewport kecil menggunakan rail ringkas dan panel scroll.

Perintah ulang browser QA:

```sh
TRADE_QA_URL=http://127.0.0.1:5201 \
PLAYWRIGHT_CORE=/path/to/playwright-core/index.mjs \
node tools/qa/trade_game.mjs
```

## Batas v1

Terran, desktop keyboard/mouse, satu campaign aktif. Maksimum 12 kota pemain, 24 rute, 64 kendaraan dan tiga level upgrade. Model fasilitas memakai ulang kit planet; tidak ada detail bangunan TownMode, landing pada kota Trade, udara/antarplanet, multiplayer/cloud save atau depletion resource. Routing memakai adjacency dan biaya uniform; chart ekonomi historis rinci belum ada. Milestone dan basic sandbox tersedia.

Belum ada klaim FPS 60 pada semua perangkat, pengujian semua kombinasi seed/options/strategi, pemeriksaan live browser background throttling berjam-jam, atau playtest fun dengan manusia. Jam tertunda diuji menggunakan monotonic clock terkontrol; browser QA melakukan lintas mode nyata. Parameter dapat dituning setelah memainkan build ini tanpa mengubah pemisahan mode/save.
