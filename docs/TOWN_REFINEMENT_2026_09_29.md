# Revisi kota, pohon, jalan, dan kontrol — 29 September 2026

Implementasi untuk enam koreksi visual/interaksi pengguna. Melanjutkan [catatan Watabou](WATABOU_WORLD_BUILDING_NOTES.md), [kota hidup](LIVING_TOWNS_IMPLEMENTATION.md), dan [status roadmap](IMPLEMENTATION_STATUS.md).

## Yang berubah

| Permintaan | Implementasi yang terhubung ke game |
|---|---|
| Fantasy terlalu seperti sarang lebah | Generator v2 memakai kepadatan ward bervariasi, tanpa Lloyd relaxation seragam; mempertahankan jaringan yang terhubung sambil menghapus sebagian loop jalan pembatas sel. Jalan melengkung ringan, gang lebih sempit, dan frontage bangunan berjalan menerus mengikuti jalan, melintasi batas sel. Taman direservasi sebelum rumah. |
| Modern terlalu kotak | Generator v2 memakai jalan regional, kolektor melengkung dengan radius/offset berbeda, cabang perumahan dan simpang T, serta zoning menurut jarak dari pusat. Tidak memakai satu grid untuk seluruh kota. Ini belum solver jalan yang mengikuti kontur elevasi. |
| Jalan/texture | Atlas netral 512² yang dipakai bangunan juga dipakai terrain: cobble 2,4 m per repeat, paving 4 m, campuran grain aspal, tanah dan rumput. Detail tetap dalam meter dunia; ukuran kota tidak memperbesar batu. RGB mask membedakan aspal/batu/paving, warna dasar tetap di paint map; marka memakai satu batch geometri tipis mengikuti terrain agar tajam pada kamera berkendara. Sambungan jalan menyatu; marka berhenti sebelum simpang organik dan zebra crossing mengikuti arah ruas. Resolusi paint dekat minimum 1536², medium/high 2048². |
| Pohon | Kanopi daun lebar dibuat sedikit asimetris; leaf cards bersiluet daun bergerigi, konifer memakai needle spray tersendiri, palem memakai frond berpinnate dengan mesh melengkung dan batang bertaper. LOD jauh mempertahankan envelope. 20 ID scenery × 3 LOD; 8 spesies utama, bukan 20 spesies pohon baru. |
| Lampu malam | Model lampu fantasy/modern yang sudah ada kini tersebar juga pada gang/kolektor/perumahan. Satu merged mesh untuk pool cahaya di tanah dan maksimum empat PointLight tanpa shadow dekat kamera; bukan ratusan shadow lights. Siang meredup otomatis. |
| Zoom town | OrbitControls membatasi jarak; scroll tidak lagi memicu lepas landas. Tombol Lepas landas tetap tersedia. |
| Pindah kota | List dan tombol sebelumnya/berikutnya pada panel kiri town dan kartu info kota di planet. Versi sempit tetap menyediakan navigasi; urutan mengikuti daftar kota, bukan jarak geografis terdekat. |
| Kendaraan | Akselerasi lebih responsif, drag berkurang, steering kembali lebih cepat dengan batas laju putar menurut kecepatan. Physics substep hingga 120 Hz; collision tidak lagi menambahkan putaran acak. Chase camera lebih tenang. Permukaan deck dipakai pada pemeriksaan penghalang air. NPC mengikuti tangent jalan kontinu dan memutar di ujung jalan tanpa meloncat lajur. |
| Gunung | Frekuensi/noise relief diturunkan, puncak direndahkan dan foothill diperlebar. Data pegunungan masih berasal dari konteks planet. |
| Jalan/lari manusia | Player/NPC dekat memakai phase langkah bersama saat blend walk/run; tempo mengikuti kecepatan dan tinggi karakter, ayunan lengan/hips dikurangi. Animasi player memakai gerak aktual setelah collision, sehingga tidak terus berlari penuh saat tertahan. NPC menghaluskan yaw. Crowd jauh diberi bob/ayunan lebih kecil. Ini belum foot IK. |

Referensi bentuk: [Medieval Fantasy City Generator](https://watabou.itch.io/medieval-fantasy-city-generator) dan [Neighbourhood](https://watabou.itch.io/neighbourhood). Halaman resmi ditinjau kembali; algoritme di repo adalah adaptasi sendiri untuk game 3D. Tidak mengklaim menyalin implementasi internal Watabou. Gambar atlas pengguna dipakai sebagai arah visual, bukan disalin menjadi texture runtime.

## Navigasi dan kompatibilitas save

- Jalan, jalur taman/frontage dan approach pintu menjadi graph; crossing/T junction/overlap disambung, segmen tidak aman dipotong. Walker memilih cabang, bisa berhenti di pintu/taman, dan flee tetap di jalur aman.
- Titik interaksi pintu dipindahkan ke luar envelope model (termasuk porch/eaves); socket arsitektur tetap mengikuti facade asli.
- `town-layout:<planet>:<seed>` menyimpan versi parcel. Kota yang sudah memiliki state interior lama tetap memakai generator v1 untuk menjaga ID bangunan dan isi ruangan. Kota baru memakai v2. Material, pohon, lampu dan kontrol diperbarui pada kedua versi.
- **Batas:** belum ada migrasi parcel/ID yang aman untuk memindahkan save interior v1 ke tata kota v2. Tidak menghapus save atau menebak rumah pengganti. Portal yang terhalang tetap ditandai tidak aman, bukan dipaksakan dapat dilalui. Household/jadwal kerja belum diimplementasikan.

## Aset dan reproduksi

- `public/models/scenery.glb`: **1.244.892 byte**, dua material, dua gambar embedded; 20 asset ID, masing-masing 3 LOD. Hash dan bounds/triangle count ada pada `scenery.manifest.json`.
- `public/textures/town_surfaces.png`: **107.856 byte**, grayscale 512²; 16 material bersama. `flora_cards.png`: 512² RGBA. Ukuran file tidak sama dengan penggunaan VRAM; paint map per kota dibuat di runtime.
- Source: `tools/blender/build_scenery.py` dan `paint_living_surfaces.py`; `.blend` tersimpan. Blender MCP tidak tersedia pada sesi ini, maka build memakai Blender CLI 5.1.2 dalam proses background terpisah. Pack town asli tidak diregenerasi untuk lampu karena modelnya sudah tersedia.
- `node --test tests/*.test.js`: **24 test lolos**, termasuk acceleration/brake/reverse, stabilitas 30/60/120 Hz, corner/U-turn continuity, clip rig asli, approach pintu, kompatibilitas save dan simpang organik.
- `GLOBE_SWEEP_SEEDS=30 node --test tests/town-generation.test.js tests/walk-network.test.js`: **5 test lolos**, sweep layout dua era di 30 seed. Ini pengujian properti, bukan bukti bahwa setiap sudut dunia bebas cacat visual.
- `node node_modules/vite/bin/vite.js build` dan `git diff --check` untuk build/whitespace.
- Shell sesi ini tidak menyediakan `npm`/`node` pada PATH. Verifikasi memakai binary Node bundled Codex; perintah di atas tetap bisa digunakan dengan Node lokal biasa.

## Bukti runtime

Harness `/tests/browser/living-town.html` menyediakan overview, street/park/harbor close-up, galeri aset, walk/run preview, night/day, kontrol, graph dan lifecycle checks.

- Fantasy fixture: 347 bangunan, 13 taman berakses, 224 lampu. Graph: 2.507 node / 2.490 edge; 323 dari 340 portal punya akses aman (14 terhalang, 3 terisolasi).
- Modern fixture: 109 bangunan, 6 taman berakses, 112 lampu. Graph: 896 node / 919 edge; 107 dari 108 portal punya akses aman.
- Masing-masing era diuji selama **180 detik simulasi** pada high dan low. Graph identik lintas kualitas, walker berpindah ruas, seluruh posisi yang diuji aman dari air/collider. Ini tidak berarti seluruh portal sudah dapat dicapai.
- Physics car dengan terrain/collider runtime bergerak 11,34 m dalam 1,5 detik, kecepatan akhir 13,95 m/s di kedua fixture. 80 input zoom keluar tidak mengganti mode. `engine.lastError` kosong.
- Visual diperiksa pada overview fantasy/modern, close-up jalan malam dua era, pohon/props dan preview animasi. Pengujian animasi memakai clip GLB asli, tidak hanya stub.

- Enam pergantian scene lolos tanpa pertumbuhan resource setelah cache hangat: run akhir pada kualitas low: fantasy 168 geometry / 18 texture; modern 178 / 19, termasuk batch marka tajam. Angka adalah hitungan renderer pada fixture lokal, bukan ukuran byte VRAM.

- Tombol kota berikutnya diverifikasi dari panel town dan kartu planet (New Babylon → Aegis Citadel), dilanjutkan pendaratan ke kota pilihan. Scroll keluar berulang tetap berada di mode town; batas kamera dipersempit agar tepi bidang air tidak mendominasi tampilan.
- Profil modern akhir (120 frame): viewport render 1280×702, kualitas low, pixel ratio 1, median **8,4 ms**, p95 **9,3 ms**, **380 draw call/frame** seluruh pass. Snapshot mesin lokal ini tidak menjamin angka yang sama pada perangkat lain.
- Smoke test rumah modern mencapai lantai 2, near plane 0,1, tanpa `engine.lastError`; rumah tetap terlihat dan interaksi tangga tersedia.
