# Cloudflare deployment

## Alamat dan status

- Landing: https://aethergate.cloud/
- Game: https://aethergate.cloud/play/
- Alamat Pages: https://aethergate-globe.pages.dev/
- Deployment yang diverifikasi pada 8 Oktober 2026: https://11e05b91.aethergate-globe.pages.dev
- Cloudflare Pages project: `aethergate-globe`, production branch `main`.
- Account: `739f03f83468d34f88ddf80477cb25b9`.
- Custom domain `aethergate.cloud`, validasi, dan verifikasi Cloudflare semuanya
  **active**. Landing dan `/play/` memberi HTTP 200 melalui HTTPS dengan verifikasi
  sertifikat normal. HTTP dialihkan ke HTTPS dengan status 301.

## DNS domain

Zone `aethergate.cloud` sudah active di account yang sama. Record untuk domain ini:

| Field | Nilai |
| --- | --- |
| Type | CNAME |
| Name | `@` / `aethergate.cloud` |
| Target | `aethergate-globe.pages.dev` |
| Proxy | Proxied |
| TTL | Auto |

Domain sudah diasosiasikan ke Pages terlebih dahulu. Jangan mengubah record email
atau record lain yang tidak berkaitan. Jika ada record A/AAAA/CNAME pada nama yang
sama, periksa kegunaannya sebelum menggantinya.

Login OAuth Wrangler yang digunakan cukup untuk deployment Pages dan pemasangan
custom domain, tetapi akses DNS ditolak Cloudflare dengan HTTP 403. Pengaturan DNS
memerlukan sesi dashboard Cloudflare atau autentikasi yang mempunyai izin DNS Write.

## Memperbarui deployment

`wrangler.jsonc` menunjuk output build ke `dist`. Credential dikelola login resmi
Wrangler; jangan menyimpan token di repository.

```sh
npm test
npm run build
CLOUDFLARE_ACCOUNT_ID=739f03f83468d34f88ddf80477cb25b9 npx --yes wrangler pages deploy dist --project-name aethergate-globe --branch main --commit-dirty=true
```

Jika login sudah kedaluwarsa:

```sh
npx --yes wrangler login --scopes account:read user:read pages:write zone:read
```

Proyek sudah dibuat. Untuk membuat proyek Pages baru pada Wrangler 4.148.0,
`pages project create ... --production-branch main --force` diperlukan karena
command create secara default mengarahkan proyek baru ke Workers. Deployment
berikutnya memakai proyek Pages yang sudah ada tanpa flag tersebut.

Helper `node tools/cloudflare-domain.mjs status` memeriksa zone dan status custom
domain lewat API resmi. Mode `attach` menambahkan domain jika belum ada; mode `dns`
hanya membuat record CNAME, tidak menghapus atau mengganti record yang ada.
Token dari CLI hanya berada di memori dan dikirim ke endpoint Cloudflare.

## Backend (API + D1) dan dashboard

Sejak 9 Oktober 2026 project ini juga menjalankan Pages Functions di `/api/*` dengan
database D1, dan ada project Pages kedua `aethergate-dashboard` untuk
`dashboard.aethergate.cloud`. **Deploy berikutnya butuh setup sekali:** buat database
D1, isi ID-nya di `wrangler.jsonc`, jalankan migrasi, pasang secret `ADMIN_EMAILS`
dan `INSPECT_SECRET`, dan daftarkan domain di Firebase Auth. Langkah lengkap ada di
[BACKEND.md §6](BACKEND.md#6-setup-produksi-sekali).

## Routing dan cache

- `/`: landing statis, tidak memuat engine WebGL atau model game.
- `/play/`: game. Hash route tetap berada di bawah path ini.
- Bookmark lama seperti `/#/space/2` dialihkan ke `/play/#/space/2`.
- `skirmish.html` tetap menjadi entry build tersendiri.
- Asset ber-hash dicache immutable; model dicache satu jam dengan revalidation;
  HTML landing dan game direvalidasi. Aturannya ada di `public/_headers`.
- `/api/*` dilayani Pages Functions (`functions/`); `_routes.json` yang dibuat Wrangler
  hanya memanggil function untuk path itu, jadi aset statis tidak terpengaruh.
- Progres tersimpan di localStorage per origin. Save lokal atau save dari domain
  `pages.dev` tidak otomatis pindah ke custom domain, kecuali lewat cloud save
  (masuk dengan Google, lalu *Lanjutkan di perangkat ini* dari dashboard).
- `public/404.html` membuat Pages menjawab path yang tidak ada dengan HTTP 404
  (tanpa file itu Pages menganggap situs SPA dan mengembalikan landing dengan 200).
  Routing game memakai hash di bawah `/play/`, jadi deep link tidak terpengaruh.

## Mesin pencari

- `public/robots.txt` mengizinkan semua halaman kecuali `/api/` dan menunjuk ke
  `public/sitemap.xml` (landing dan `/play/`; `skirmish` dan `farm` sengaja tidak
  dicantumkan karena tidak ditautkan dari landing).
- Google: verifikasi domain sekali di Search Console (record DNS TXT; OAuth Wrangler
  tidak punya izin DNS), lalu submit `sitemap.xml`.
- Bing/DuckDuckGo/Yahoo: setelah deploy production, `npm run seo:indexnow`. Kunci
  IndexNow di `public/<key>.txt` memang publik.

## Verifikasi

Build produksi dan 154 tes proyek lulus. QA browser pada Pages publik dan custom
domain `aethergate.cloud` masing-masing lulus tujuh
pemeriksaan: landing tanpa engine/model game, tanpa overflow pada lebar 1440, 768,
390, dan 320 px, CTA membuka game yang sudah diinisialisasi, serta redirect bookmark
hash lama. Tidak ada page error yang tercatat.

[Report custom domain](qa/landing-domain/report.json),
[screenshot desktop](qa/landing-domain/landing-1440.png),
[screenshot ponsel](qa/landing-domain/landing-390.png),
[game setelah CTA](qa/landing-domain/play-game.png).
Pengujian sebelumnya pada Pages tersedia di [report Pages](qa/landing-live/report.json).

Untuk mengulang QA terhadap deployment yang sudah ada:

```sh
LANDING_SKIP_CAPTURE=1 LANDING_QA_URL=https://aethergate.cloud/ LANDING_QA_OUTPUT=docs/qa/landing-domain node tools/qa/landing.mjs
```

Isi `PLAYWRIGHT_CORE` dengan module specifier atau file URL instalasi lokal jika
Playwright tidak berada di dependency proyek. Chrome headless memakai profil
terisolasi, bukan profil browser pribadi.
