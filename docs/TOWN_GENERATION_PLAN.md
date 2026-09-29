# Rencana generator kota — belajar dari Watabou Village Generator

29 September 2026. Rujukan: [Village Generator](https://watabou.itch.io/village-generator) dan catatan riset di [WATABOU_WORLD_BUILDING_NOTES.md](WATABOU_WORLD_BUILDING_NOTES.md). Implementasi di repo ini adalah adaptasi sendiri. Source Watabou tidak disalin.

## 1. Yang sudah terpasang

**Planner 2D.** Tombol **Tata kota** di kanan atas town (hanya di view diorama) membuka peta 2D bergaya Watabou dengan fitur berikut:

- **Acak ulang** (Enter) membuat ulang permukiman di atas tanah yang sama. Relief memakai seed dasar kota, sedangkan pantai, sungai, dan jalan antarkota berasal dari planet. Perilaku ini sama dengan *Reroll village* di Watabou, yang juga mempertahankan terrain.
- **Kepadatan** Jarang/Normal/Padat meniru tag *isolated/dense*. Kepadatan tidak mengubah jalan. Pada "Jarang", sebagian frontage dibiarkan menjadi kebun dan lot kosong lebih sering muncul. Pada "Padat", rumah dirapatkan dan rumah sempit lebih diutamakan. Hasil ukur di tiga seed fixture: Jarang 25–55% lebih sedikit bangunan, Padat 5–10% lebih banyak.
- **Sebelumnya** (Backspace) kembali ke hasil acak sebelumnya dalam sesi ini, dan **Kembali ke kota asli** memilih varian 0.
- **Terapkan** menyimpan `{variant, density}` per kota (`town-layout:<planet>:<seed>` di store dunia), lalu membangun ulang town 3D dari layout yang sama persis dengan preview. Warna atap ikut sama, karena ditentukan di data layout (`b.roof`).
- Kota asli (varian 0, kepadatan 1) identik dengan generator sebelumnya. Hal ini diverifikasi dengan membandingkan 16 kota dari 4 seed dengan commit `bc791db`.
- Kota yang punya interior tersimpan dari generator v1 tetap memakai v1 sampai pemain memilih rencana baru. Memilih "Kembali ke kota asli" mengembalikan v1, sehingga isi rumah lama muncul lagi.

File:

- `src/modes/town/planner/townPlanner.js`: UI dan state planner.
- `src/modes/town/planner/townMapRenderer.js`: renderer peta 2D.
- `src/modes/town/layout/roofPlan.js`: warna atap.
- `src/world/townGeneration.js`: penyimpanan pilihan rencana.
- Parameter `variant`/`options` di `generateTownLayout`.
- Test: `tests/town-planner.test.js`.

## 1b. Layout v3 (29 September 2026)

`TOWN_LAYOUT_VERSION` naik ke 3. Kota yang pernah dikunjungi di v2 ikut naik ke v3, kecuali ada ruangan tersimpan di kota itu; ruangan memakai ID bangunan berbasis koordinat, jadi kota tersebut tetap di v2 (`townGenerationVersion`). Kota dengan interior v1 tetap v1 seperti sebelumnya.

| Perubahan | File | Hasil terukur (4 seed fixture, `hexasphere(3, 10)`) |
|---|---|---|
| **Arketipe desa (TG-1).** Kota fantasy 1 tile (bukan ibu kota) tumbuh sebagai desa jalanan: rute antarkota menjadi jalan utama yang menembus pusat, green + sumur, 2–5 lane buntu, rumah berderet di dua sisi, dan tavern di green. Bila tanah tidak cukup untuk jalan utama, rencana ward mengambil alih. | `layout/villagePlan.js` | Panjang jalan per bangunan 25,7 → 7,4 m. Aspal per bangunan 97 → 36 m². Polyline jalan 58 → 4 per desa. |
| **Croft dan furlong (TG-2).** Strip ladang 26–52 m ditarik tegak lurus dari belakang deret rumah, dan blok 2–4 strip berada di luarnya. Alur tanam mengikuti panjang strip. Plot acak di tile ladang dimatikan untuk desa. | `layout/villagePlan.js`, `planSurroundings` | Ladang per desa 2 → 9. |
| **Hedgerow dan pagar (bagian TG-3).** Tepi ladang dibatasi semak, dengan celah gerbang dan sesekali oak. Ladang dekat rumah memakai pagar kayu yang punya collider. Tiap batas dicatat di `L.hedges`. | `layout/fieldEdges.js` | 10–79 batas per kota yang punya ladang. |
| **Bunga dalam drift.** 260 patch acak diganti 26–50 drift memanjang di meadow (satu warna per drift). Batu mendapat rumpun grass tuft di kakinya. | `layout/fieldEdges.js`, `layout/vegetation.js` | >90% bunga berada di drift, taman, atau kebun. |
| **Lebar jalan praktis.** Modern: arteri 13/16 → 8/10 m, kolektor 9 → 7 m, residensial 6,5–8 → 5,5–6 m, trotoar 2,4 → 1,8 m, dan alun-alun r 14 → 10 m. Fantasy: jalan utama ward 7 → 6 m. Kolektor modern ikut dipakai lalu lintas karena graf mobil sekarang mengikuti jenis jalan. | `neighbourhoodPlan.js`, `townPlan.js`, `scale.js` | Aspal per bangunan modern 443 → 186 m² (−58%). |
| **Hamlet modern.** Kota modern 1 tile memakai 2 arteri (bukan 4), tanpa ring kolektor, cabang lebih rapat, dan tanpa menara/kantor. | `neighbourhoodPlan.js` | Cakupan frontage 48–61% → 77–86%. |
| **Ground cover berkelompok** (renderer, semua versi). Sprite disebar per rumpun: pusat + anggota Gaussian, satu tanaman dominan per rumpun. Di dalam kota rumpun hanya ada di tepi halaman (dekat dinding/pagar). Rumput tinggi dan gulma berderet di kaki hedge/pagar. | `render/groundCover.js` | Lapangan kota tidak lagi ditaburi rata. |

## 2. Perbandingan dengan Village Generator (setelah v3)

| Aspek | Watabou village | Globe v2 | Globe v3 |
|---|---|---|---|
| Kerangka jalan | 1–2 jalan utama mengikuti medan, cabang pendek | Jaring lane Voronoi untuk semua ukuran; desa 29 rumah punya ±58 polyline jalan | Desa: jalan utama dari rute planet + beberapa lane buntu. Kota ≥2 tile tetap ward. |
| Rumah | Berderet rapat di dua sisi jalan, menghadap jalan | Mengisi tepi setiap lane, sehingga rumah tersebar di labirin | Berderet di jalan utama dan lane; tavern di green |
| Ladang | Strip di belakang rumah, sektor searah jalan | Poligon Voronoi besar di luar kota, arah acak | Croft di belakang tiap deret, furlong di luarnya, semuanya tegak lurus jalan |
| Batas lahan | Hedgerow, pagar | Tidak ada | Hedgerow bercelah gerbang dan oak; pagar dekat rumah |
| Hutan | Massa rapat berlekuk | Rumpun per habitat (sudah berkelompok) | Sama. Massa hutan berlekuk dan clearing masih TG-3. |
| Bunga/rumput | Tidak digambar per batang | Tersebar merata di seluruh disc | Drift di meadow, rumpun di tepi, garis di kaki hedge |
| Lebar jalan | Tipis, jalan desa | Modern 13–16 m + trotoar 2,4 m | Modern 8–10 m + 1,8 m; desa 6 m / lane 3,4 m |
| Tag lingkungan | Dipilih pemain | Dari planet | Masih dari planet (TG-4) |

Yang masih berbeda: kota fantasy 2–4 tile tetap memakai ward Voronoi (cocok untuk kota berdinding, tetapi tidak untuk "kota pasar" tanpa dinding), hutan belum membentuk massa dengan tepi berlekuk, planner belum menggambar bunga/drift, dan belum ada opsi gaya atau ekspor (TG-5).

## 2a. Catatan awal (sebelum v3)


| Watabou village | Globe sekarang | Dampak |
|---|---|---|
| Desa dibentuk jalan: satu atau dua jalan utama mengikuti medan, rumah berderet di kedua sisi, cabang pendek | Kota fantasy memakai ward Voronoi (gaya MFCG) untuk semua ukuran, termasuk kota satu tile | Kota kecil terasa seperti kota besar yang diperkecil |
| Ladang berbentuk sektor dan strip di belakang rumah, arah alur mengikuti jalan/rumah | `farmCells` berupa poligon Voronoi besar di luar kota, arah alur acak per sel | Ladang tidak terbaca sebagai milik rumah terdekat |
| Hutan berupa massa rapat dengan tepi berlekuk dan pagar tanaman di antara ladang | Pohon disebar per habitat; tidak ada hedgerow | Batas ladang kurang jelas |
| Tag lingkungan (coast, river, estuary, grove, highway, island) | Semua berasal dari planet; pemain tidak bisa memilih | Sudah benar untuk konsistensi dunia, tetapi perlu fitur yang *terbaca* (dermaga, jembatan, jalan besar) |
| Gaya visual bisa diatur (warna tanah, lebar jalan, kepadatan pohon, mode malam) | Satu gaya | Opsional |
| Ekspor PNG/SVG/JSON | Belum | Berguna untuk debug dan berbagi |

## 3. Usulan tahap berikutnya

Urutan ini mengikuti dependensi. Durasi tidak dijanjikan.

| ID | Usulan | Isi | Bukti selesai |
|---|---|---|---|
| TG-1 ✅ v3 | Arketipe desa | Kota dengan satu tile atau kurang memakai grammar desa: jalan utama mengikuti jalan regional/pantai, frontage rumah di dua sisi, cabang pendek, sumur/pasar di simpul. Kota besar tetap memakai ward. Aktif hanya untuk rencana baru (varian > 0), supaya kota asli tidak berubah. | Di planner, kota kecil terbaca sebagai desa jalanan; sweep seed lolos. |
| TG-2 ✅ v3 (desa) | Ladang milik rumah | Strip ladang dan kebun ditarik tegak lurus dari belakang deret rumah (sektor seperti di Watabou); arah alur mengikuti jalan terdekat. `farmCells` hanya untuk sisa lahan jauh. | Peta 2D dan 3D memperlihatkan ladang yang menempel di belakang rumah. |
| TG-3 ◐ hedgerow selesai | Hedgerow dan massa hutan | Deret pohon/semak di batas ladang, tepi hutan yang berlekuk, dan clearing. | Kepadatan pohon terbaca sebagai massa, bukan taburan. |
| TG-4 | Tag bermakna dari planet | Turunkan label *coast/river/highway/estuary* dari data planet dan tampilkan di panel planner. Tag menentukan komposisi: kampung nelayan punya dermaga dan gudang, persimpangan dagang punya pasar dan kedai. Terkait peran settlement di WB-04. | Panel menampilkan tag; komposisi bangunan berbeda per tag. |
| TG-5 | Opsi planner tambahan | Kerapatan pohon, lebar jalan, dan tombol ekspor PNG/JSON dari canvas planner. | Opsi tersimpan per kota; ekspor bisa dibuka ulang. |
| TG-6 | Modern | Planner sudah bekerja untuk kota modern. Selanjutnya: blok perumahan dengan cul-de-sac, zona komersial di jalan kolektor, dan dermaga industri. | Overview modern tidak lagi didominasi aspal kosong. |

## 4. Aturan yang harus dijaga

- Varian 0 dan kepadatan 1 harus selalu menghasilkan kota asli *untuk versi generator kota itu*. Test `town-planner.test.js` dan skrip perbandingan menjaga aturan ini. Perubahan tata letak baru masuk lewat `layoutVersion` (v3 ke atas), jangan mengubah keluaran v1/v2.
- Opsi baru hanya boleh mengambil angka acak bila opsinya tidak bernilai default, agar urutan RNG kota asli tidak bergeser.
- Data yang ditampilkan planner dan town 3D harus berasal dari layout yang sama. Jangan menghitung warna atau posisi terpisah di renderer.
- Kualitas grafis tidak boleh mengubah layout; sweep `GLOBE_SWEEP_SEEDS` memeriksanya.
