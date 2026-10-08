# Pixel Town — prototype playable

Pixel adalah pilihan tampilan untuk town yang sama. Layout, identitas bangunan, collider,
kendaraan, interaksi, dan penyimpanan dunia tetap memakai sistem town yang ada.
Preferensi `Normal` / `Pixel` disimpan terpisah di browser melalui
`planet_globe_town_style`.

## Coba prototype

Jalankan `npm run dev`, buka `/play/` lewat tombol **Play Game** di landing page,
masuk ke salah satu kota, lalu pilih **Pixel** di toolbar.
Pilih **Diorama**, **Jalan kaki**, atau **Nyetir**; tombol zoom menyediakan
**Dekat**, **Normal**, dan **Jauh** yang diingat terpisah untuk tiap cara melihat kota.

- Diorama: seret atau WASD untuk menggeser; scroll mengganti tingkat zoom.
- Jalan kaki: WASD, Shift lari, Spasi lompat, E interaksi, Esc kembali ke diorama.
- Nyetir: W gas, S rem/mundur, A/D belok, Spasi rem tangan, E turun.

Kamera pixel memakai sudut tetap 45° dengan proyeksi ortografis. Interior dan Home
memakai tampilan normal. Kembali ke eksterior mengembalikan pilihan Pixel.

## Implementasi

| Modul | Tanggung jawab |
| --- | --- |
| `render/pixelConfig.js` | Preferensi lokal, resolusi sumber, zoom, skala LOD ortografis |
| `render/pixelCamera.js` | Kamera ortografis, follow, pembulatan posisi dalam ruang kamera |
| `render/pixelRenderer.js` | Render target resolusi rendah dan pembesaran nearest-neighbor |
| `render/pixelAssets.js` | Sprite pohon/semak dan atlas permukaan yang dibuat deterministik dari kode |
| `render/pixelBridge.js` | Papan kayu kosmetik mengikuti ketinggian jembatan yang ada |
| `render/pixelOcclusion.js` | Uji segmen terhadap volume bangunan untuk siluet karakter |
| `render/pixelStyle.js` | Material, vegetasi sesuai biome, dither foliage, siluet, pemulihan dan disposal |
| `ui/pixel.css` | HUD retro dan font lokal Pixelify Sans dengan lisensi SIL OFL |

Render pixel mempunyai target tersendiri sehingga tetap bekerja saat kualitas grafis
rendah atau post effects dimatikan. Kamera sebenarnya juga dipakai untuk hit testing
bangunan dan pemilihan LOD; jarak mata ortografis tidak menentukan detail objek.
Material asli dikembalikan saat memilih Normal, memasuki interior, atau keluar dari town.

Vegetasi foreground memakai dither hanya dalam radius karakter yang diikuti. Bangunan
yang menutupi karakter memicu siluet dengan depth test. Model khusus dunia kering,
seperti palem dan akasia, tetap memakai model biome yang ada. Detail di tepian sungai
bersifat kosmetik dan tidak menambah collider.

## Verifikasi

```sh
npm test
npm run build
```

QA browser memakai Chrome headless dan profil baru yang terisolasi. Jalankan dev server
di port 5198 (runner membuka `/play/`), lalu:

```sh
node tools/qa/pixel_town.mjs
```

Jika `playwright-core` berada di luar dependency proyek, isi `PLAYWRIGHT_CORE` dengan
module specifier atau file URL instalasi lokal. Variabel opsional `PIXEL_QA_URL` dan
`PIXEL_QA_OUTPUT` mengubah alamat server dan folder hasil.

Runner mencari kota fantasi yang mempunyai sungai/jembatan pada beberapa seed fixture,
lalu mencatat seed dan kota aktual di [report.json](qa/pixel-town/report.json).
Profil desktop menggunakan 1440×900, DPR 1; pemeriksaan layar sempit menggunakan
390×844 dan nama kota/planet panjang.

15 pemeriksaan mencakup kesamaan state/collider, gerak karakter/kendaraan, arah kamera,
ketinggian jembatan, siluet, perubahan pixel dither dalam radius karakter, tiga zoom,
kualitas rendah, interior, pergantian style berulang tanpa pertumbuhan resource setelah
pemanasan, pemulihan Normal, kontrol sempit yang tidak tertutup, nama panjang,
perpindahan planet, dan preferensi setelah reload. FPS dalam report adalah sampel lokal
90 frame, bukan jaminan performa untuk semua perangkat atau kota.

Screenshot: [diorama](qa/pixel-town/pixel-diorama.png),
[jalan kaki](qa/pixel-town/pixel-walk.png),
[siluet](qa/pixel-town/pixel-silhouette.png),
[foliage](qa/pixel-town/pixel-foliage.png),
[nyetir](qa/pixel-town/pixel-drive.png),
[layar sempit](qa/pixel-town/pixel-narrow.png).

## Batas milestone

Ini fondasi visual yang bisa dimainkan untuk review arah seni. Referensi dipakai untuk
warna hijau/mint, kayu, daun bertingkat, dan keterbacaan sudut miring; art masih
prosedural. Komposisi hutan, kabut, refleksi sinematik, variasi aset yang lebih kaya,
dan pengujian visual menyeluruh semua biome masih merupakan pekerjaan lanjutan setelah
review prototype. Layar sentuh fisik belum diuji.
