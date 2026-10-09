# Backend dan dashboard

Backend sederhana untuk dashboard game: telemetri, akun Google, cloud save per dunia, pengumuman, dan panel admin. Ditulis 9 Oktober 2026 berdasarkan hasil diskusi desain (sesi "grill-me") di cabang `claude/pensive-hypatia-bvwgyu`.

## 1. Gambaran

```text
aethergate.cloud (Pages project aethergate-globe)
├── /            landing ── GET /api/announcements?surface=landing
├── /play/       game ───── POST /api/telemetry (sendBeacon)
│                           GET/PUT /api/me/worlds/:id  (cloud save, token Firebase)
│                           GET /api/inspect/:token      (mode inspeksi admin)
└── /api/*       Pages Functions (functions/api/[[path]].ts → server/router.ts) ── D1 "aethergate"

dashboard.aethergate.cloud (Pages project aethergate-dashboard, React)
└── fetch https://aethergate.cloud/api/me/*, /api/admin/*  (CORS + Authorization: Bearer <Firebase ID token>)

Firebase Auth (project universe-project-da6af): hanya identitas (Google). Server memverifikasi ID token sendiri.
```

API berada di origin game, jadi telemetri dan pengumuman tidak memakai CORS. Dashboard berada di subdomain sendiri dan memanggil API lewat CORS dengan allowlist `DASHBOARD_ORIGINS`. Karena beda origin, dashboard tidak bisa menulis `localStorage` milik game. Karena itu tombol **Lanjutkan di perangkat ini** membuka `aethergate.cloud/play/?restore=<worldId>`, dan game sendiri yang memuat snapshot setelah pemain menyetujui.

## 2. Keputusan desain

| Topik | Keputusan | Alasan singkat |
|---|---|---|
| Pengguna | Admin (live-ops) dan pemain | Pemain melihat dunia dan datanya; admin melihat statistik dan mengelola |
| Platform | Cloudflare Pages Functions + D1 | Ikut deploy `aethergate-globe` yang sudah ada, satu origin dengan game |
| Login pemain | Anonim (UUID perangkat) + Google opsional | Tidak ada tembok login; Firebase Auth baru dimuat saat dibutuhkan |
| Login admin | Akun Google yang emailnya ada di secret `ADMIN_EMAILS` | Satu sistem login, tanpa setup Zero Trust |
| Cloud save | Snapshot penuh per dunia, gzip, BLOB D1 | Tahan perubahan generator; peta ~148 KB → ~55 KB |
| Sinkron | Otomatis tiap ≤60 detik (hanya bila berubah) + revisi optimistis; pemain ditanya saat bentrok | Dua perangkat tidak saling menimpa diam-diam |
| Telemetri | Sesi + mode, misi, dunia, error + frame rate | Cukup untuk funnel, retensi, dan debugging |
| Privasi | Aktif default, satu baris pemberitahuan di kartu judul, opt-out di menu jeda; tanpa IP; event mentah 90 hari | Ringan tapi jujur |
| Admin | Statistik, pemain, hapus data pemain, pengumuman terjadwal, buka dunia pemain (lihat saja) | Semua tindakan tercatat di `admin_log` |
| Dashboard | React + TypeScript, gaya The1, project Pages kedua | Dipisah dari bundle game |

## 3. Struktur

| Path | Isi |
|---|---|
| `functions/api/[[path]].ts` | Entry Pages Function; meneruskan semua `/api/*` ke `server/router.ts` |
| `server/` | Logika API (TypeScript, tanpa dependensi): router, auth (verifikasi JWT RS256 lewat WebCrypto), telemetry, saves, players, admin, announcements, inspect, maintenance |
| `shared/api.ts` | Tipe kontrak bersama server dan dashboard |
| `migrations/0001_init.sql` | Skema D1 |
| `src/net/` | Klien di game: `telemetry`, `auth` (Firebase lazy), `cloudSave`, `progress`, `inspect`, `announcements`, `accountPanel`, `dialog`, `index` (perakit, chunk terpisah) |
| `dashboard/` | Aplikasi React (package sendiri) |
| `tools/backend/seed-local.mjs` | Isi D1 **lokal** dengan 30 hari data palsu |
| `tests/api/*.test.ts` | Test route dengan migrasi asli di `node:sqlite` |
| `tests/net-client.test.js` | Test klien: batching telemetri, snapshot, alur sinkron/bentrok, inspeksi |

## 4. Data

| Tabel | Isi | Retensi |
|---|---|---|
| `devices` | UUID perangkat, user tertaut, negara, locale | Sampai dihapus |
| `users` | uid Firebase, email, nama | Sampai dihapus |
| `sessions` | Satu baris per page load `/play/`: mulai, terakhir terlihat, mode, preset, browser kasar, FPS, error | 90 hari |
| `events` | `session_start/end`, `mode`, `mission`, `mission_done`, `world`, `error` (heartbeat tidak disimpan sebagai event) | 90 hari |
| `worlds` | Dunia per perangkat dari telemetri (seed bisa sama antar pemain) | Sampai dihapus |
| `snapshots` | Cloud save: `(user_id, world_id)`, `rev`, meta JSON, data gzip | Sampai dihapus |
| `daily_stats` | Ringkasan harian (aktif, sesi, waktu main, perangkat baru, dunia baru, misi, error) | Permanen |
| `announcements`, `admin_log`, `meta` | Pengumuman, jejak tindakan admin, status pemeliharaan | — |

Pages Functions tidak punya cron. Rollup harian dan penghapusan data >90 hari berjalan sekali per hari UTC, dipicu batch telemetri pertama atau saat overview admin dibuka. Rollup selalu berjalan lebih dulu dalam batch yang sama, jadi tidak ada baris yang dihapus sebelum dihitung.

Yang disimpan di snapshot: `planet_globe_map_v5`, `planet_globe_missions`, `planet_globe_clock_offset`, `planet_globe_ship`, entri `planet_globe_progress` untuk dunia itu, dan semua record `WorldStateStore` (rumah, interior, tata kota, lokasi). Preferensi perangkat (grafis, audio, bahasa) tidak ikut.

Kunci browser baru: `planet_globe_device`, `planet_globe_telemetry` (`off` = opt-out), `planet_globe_signed_in`, `planet_globe_sync`, `planet_globe_progress`, `planet_globe_announcements`.

## 5. API

Semua respons JSON. Rute `me` butuh `Authorization: Bearer <Firebase ID token>`. Rute `admin` juga butuh email terverifikasi yang ada di `ADMIN_EMAILS`.

| Method | Path | Fungsi |
|---|---|---|
| POST | `/api/telemetry` | Batch ≤100 event, ≤64 KB; waktu dikoreksi dari umur event dalam batch |
| GET | `/api/announcements?surface=game\|landing` | Pengumuman yang sedang tayang (cache 60 detik) |
| GET | `/api/inspect/:token` | Snapshot untuk link inspeksi (HMAC, 15 menit) |
| GET / DELETE | `/api/me` | Profil + perangkat + `isAdmin` / hapus akun dan semua data |
| GET | `/api/me/export` | Semua data pemain (JSON) |
| POST / DELETE | `/api/me/devices[/:id]` | Tautkan / lepas perangkat |
| GET | `/api/me/worlds` | Daftar cloud save (meta saja) |
| GET / PUT / DELETE | `/api/me/worlds/:worldId` | Baca / simpan (`baseRev`, 409 bila bentrok) / hapus |
| GET | `/api/admin/overview?days=7..180` | KPI, seri harian, funnel misi, mode, preset, error |
| GET / DELETE | `/api/admin/players[/:key]` | Daftar & cari / detail / hapus (`u:<uid>` atau `d:<deviceId>`) |
| GET | `/api/admin/worlds`, `/api/admin/events`, `/api/admin/log` | Dunia, aliran event, jejak admin |
| POST | `/api/admin/inspect` | Link `/play/?inspect=…` untuk satu cloud save |
| GET / POST / PUT / DELETE | `/api/admin/announcements[/:id]` | Kelola pengumuman |

## 6. Setup produksi (sekali)

Langkah 1–3 **wajib sebelum deploy berikutnya**: `wrangler.jsonc` kini berisi binding D1 dengan ID placeholder, dan deploy akan gagal sampai ID asli diisi.

1. **Buat database D1** (login Wrangler seperti di [DEPLOYMENT.md](DEPLOYMENT.md)):
   ```sh
   CLOUDFLARE_ACCOUNT_ID=739f03f83468d34f88ddf80477cb25b9 npx wrangler d1 create aethergate
   CLOUDFLARE_ACCOUNT_ID=739f03f83468d34f88ddf80477cb25b9 npx wrangler d1 create aethergate-preview
   ```
   Salin `database_id` masing-masing ke `wrangler.jsonc` (ganti `REPLACE_WITH_PRODUCTION_D1_ID` dan `REPLACE_WITH_PREVIEW_D1_ID`).
2. **Jalankan migrasi:** `npm run db:migrate:remote` dan `npm run db:migrate:preview`.
3. **Secret** untuk project `aethergate-globe` (production; ulangi dengan `--env preview` bila preview juga dipakai):
   ```sh
   npx wrangler pages secret put ADMIN_EMAILS --project-name aethergate-globe     # email admin, pisahkan dengan koma
   openssl rand -base64 32 | npx wrangler pages secret put INSPECT_SECRET --project-name aethergate-globe
   ```
   Jangan pernah mengisi `DEV_AUTH` di production.
4. **Firebase console** → Authentication: aktifkan provider **Google**. Di *Settings → Authorized domains*, tambahkan `aethergate.cloud`, `dashboard.aethergate.cloud`, `aethergate-globe.pages.dev`, dan `aethergate-dashboard.pages.dev` (`localhost` sudah ada).
5. **Deploy game + API** seperti biasa (`npm test`, `npm run build`, `wrangler pages deploy dist …`). Wrangler ikut membundel `functions/` dari root repo.
6. **Dashboard** (project Pages kedua):
   ```sh
   CLOUDFLARE_ACCOUNT_ID=739f03f83468d34f88ddf80477cb25b9 npx wrangler pages project create aethergate-dashboard --production-branch main
   npm --prefix dashboard install && npm run dashboard:build
   cd dashboard && CLOUDFLARE_ACCOUNT_ID=739f03f83468d34f88ddf80477cb25b9 npx wrangler pages deploy dist --project-name aethergate-dashboard --branch main
   ```
   Lalu pasang custom domain `dashboard.aethergate.cloud` di project itu (dashboard Cloudflare → Pages → Custom domains). Build production otomatis memakai `https://aethergate.cloud` sebagai API (`VITE_API_BASE` / `VITE_GAME_URL` bisa menimpanya).
7. **Disarankan:** satu aturan WAF Rate Limiting untuk `POST /api/telemetry` (misalnya 30 permintaan per menit per IP). Endpoint ini publik; server sudah membatasi ukuran batch, tapi tidak menghitung frekuensi.

Kuota D1 gratis (100 ribu baris ditulis per hari) cukup untuk ratusan jam main per hari: satu batch menulis 2 baris + jumlah event, dan heartbeat tidak menjadi baris event.

## 7. Development lokal

```sh
npm install && npm --prefix dashboard install
npm run build                                  # dist/ untuk wrangler pages dev
npm run db:migrate:local
npm run db:seed:local                          # opsional: 64 pemain palsu, 30 hari
printf 'DEV_AUTH=1\nADMIN_EMAILS=admin@example.com\nINSPECT_SECRET=local\nGAME_ORIGIN=http://localhost:8788\n' > .dev.vars
npm run api:dev                                # game + API + D1 lokal di http://localhost:8788
VITE_DEV_AUTH=1 npm run dashboard:dev          # dashboard di http://localhost:5174 (proxy /api ke :8788)
```

Dengan `VITE_DEV_AUTH=1`, halaman masuk dashboard punya form "Masuk (dev) sebagai" yang mengirim token `dev:<email>`. API hanya menerimanya bila `DEV_AUTH=1` **dan** host-nya localhost. `.dev.vars` dan `.wrangler/` di-gitignore.

Untuk mengembangkan game dengan HMR sambil memakai API, jalankan `npm run api:dev` lalu `API_PROXY=http://localhost:8788 npm run dev`: Vite meneruskan `/api` ke wrangler sehingga tetap satu origin. Bila API tidak ada, game tetap jalan; telemetri dan pengumuman gagal tanpa suara.

## 8. Perilaku penting

- **Telemetri** dikirim tiap 30 detik, saat tab disembunyikan, dan saat `pagehide`. Browser otomatis (`navigator.webdriver`) tidak pernah mengirim, jadi QA Playwright terhadap production tidak mengotori data.
- **Bentrok sinkron:** bila cloud punya revisi lebih baru, game bertanya *Pakai versi cloud / Pakai perangkat ini / Putuskan nanti*. "Nanti" menghentikan upload otomatis sampai pemain menekan *Sinkron sekarang*.
- **Dunia dihapus dari dashboard** tidak diunggah ulang diam-diam. Panel akun menampilkan *Unggah lagi*.
- **Mode inspeksi** (`/play/?inspect=…`) menukar `localStorage` dengan salinan di memori dan mematikan IndexedDB sebelum dunia dibuat. Dunia admin sendiri tidak tersentuh, dan telemetri/sinkron mati.
- **Hapus akun** menghapus semua baris milik akun dan perangkat tertautnya. Akun Firebase-nya ikut dihapus bila Google mengizinkan tanpa login ulang; datanya sudah hilang dalam kedua kasus. Perangkat yang terus bermain akan muncul lagi sebagai pemain anonim baru (kecuali opt-out).
- Halaman admin hanya berbahasa Indonesia; halaman pemain berbahasa Indonesia dan Inggris (label misi diambil dari file i18n game).

## 9. Test dan QA

- Butuh Node 22.18 atau lebih baru: test API ditulis dalam TypeScript dan dijalankan langsung oleh Node (type stripping), dan memakai `node:sqlite`.
- `npm test` menjalankan test game, `tests/net-client.test.js`, dan `tests/api/*.test.ts` (route API dengan D1 tiruan di atas `node:sqlite`, memakai migrasi asli). Pada 9 Oktober 2026: 202 test, 200 lulus. Dua yang gagal (`tests/town-compact-generation.test.js`, hash geometri v1–v4/v5) sudah gagal sebelum pekerjaan ini dan tidak berkaitan dengan backend.
- `npm run typecheck` (server) dan `npm run dashboard:build` (termasuk `tsc`) bersih.
- QA browser pada 9 Oktober 2026 terhadap `wrangler pages dev` dengan D1 lokal:
  - Game: 26/26 pemeriksaan lulus. Mencakup banner landing, kartu pengumuman di game, panel akun, telemetri sampai D1, opt-out, mode inspeksi yang tidak menyentuh dunia admin, link inspeksi kedaluwarsa, dan restore yang meminta login.
  - Dashboard: 27/27 lulus. Mencakup halaman pemain, ekspor, bahasa, larangan `/admin` untuk pemain, overview admin dengan tooltip dan keyboard, filter rentang, pemain, detail, dunia dan inspect, event, pengumuman, log, mode gelap, dan lebar 390 px tanpa overflow.
- Belum diuji: login Google sungguhan (butuh domain terdaftar di Firebase) dan deploy ke Cloudflare (butuh akun pemilik).
