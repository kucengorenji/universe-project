# Handoff M2-Q1b — Verifikasi E2E Perjalanan Pertama (J1–J6 → Done)

**QA Agent:** AGY (globe-qa, Gemini 3.8 Flash High)  
**Tanggal:** 10 Oktober 2026 (WIB, UTC+7)  
**Target Server:** `http://localhost:5234` (Vite production preview, dist snapshot `6ec14aa`, tanpa HMR)  
**Browser / Backend:** Chrome Headless `154.0.8037.98` via Metal WebGL (Apple M1 Pro, 1280×720 @ 1x)  
**Hasil Keseluruhan:** ✅ **10/10 LANGKAH LULUS (STAGE: DONE, CELEBRATED: TRUE)**  
**Artefak:** `docs/qa/journey/journey-2026-10-10.json`, `docs/qa/journey/README.md`, 10 screenshot PNG.

---

## 1. Hasil Singkat

| Acceptance (M2_SLICE_SPEC §2) | Hasil |
|---|---|
| Profil bersih memulai perjalanan di stage J1 | Selesai. Inisialisasi awal di `#/space` menetapkan stage `j1`, membaca planet asal (`homePlanet`) dan kota asal (`homeCity`). |
| Navigasi berurutan J1 → J2 → J3 → J4 → J5 → J6 | Selesai. Transisi mode memicu kenaikan rank secara deterministik tanpa melompati tahap. |
| Jejak ruangan (trace) terkonfirmasi tersimpan | Selesai. Lampu rumah awal dinyalakan, diff trace mencatat `{ kind: 'light', expected: { on: true } }`, status save `idle` (konfirmasi penulisan store berhasil). |
| Keluar ke angkasa menandai flag `away = true` | Selesai. Pemain keluar dari rumah dan kembali ke `#/space`, `record.away` menjadi `true`. |
| Kelangsungan sesi melintasi reload halaman | Selesai. Reload browser penuh dipertahankan; stage tetap `j6` dengan `away = true`. |
| Masuk kembali memverifikasi jejak ruangan → Done | Selesai. Memasuki kembali rumah awal memanggil `verifyTrace()` yang mencocokkan snapshot lampu menyala; stage berubah menjadi `done`, selebrasi aktif, kartu selesai tampil. |
| Integritas runtime | Selesai. `engine.lastError === null` di seluruh 10 langkah; 0 unhandled page error, 0 console error fatal. |

---

## 2. Kronologi Eksekusi 10 Langkah E2E

| Langkah | Nama Tahapan | Mode / View | Stage | Status | File Screenshot |
|---|---|---|---|---|---|
| **1** | Bootstrap Profil Bersih di Space | `space` | `j1` | ✅ PASS | [`01-space.png`](../../qa/journey/01-space.png) |
| **2** | Menuju Planet Asal | `planet` | `j2` | ✅ PASS | [`02-planet.png`](../../qa/journey/02-planet.png) |
| **3** | Mendarat di Kota Asal (Diorama) | `town (diorama)` | `j3` | ✅ PASS | [`03-town-diorama.png`](../../qa/journey/03-town-diorama.png) |
| **4** | Berjalan Mendekati Pintu Rumah Awal (<6m) | `town (walk)` | `j4` | ✅ PASS | [`04-walk-door.png`](../../qa/journey/04-walk-door.png) |
| **5** | Masuk ke Rumah Awal | `town (interior)` | `j5` | ✅ PASS | [`05-interior.png`](../../qa/journey/05-interior.png) |
| **6** | Nyalakan Lampu & Konfirmasi Jejak | `town (interior)` | `j6` | ✅ PASS | [`06-light-on.png`](../../qa/journey/06-light-on.png) |
| **7** | Keluar ke Angkasa (Catat Away) | `space` | `j6` (away: true) | ✅ PASS | [`07-space-away.png`](../../qa/journey/07-space-away.png) |
| **8** | Reload Halaman Penuh di Space | `space` | `j6` (away: true) | ✅ PASS | [`08-reload-space.png`](../../qa/journey/08-reload-space.png) |
| **9** | Kembali ke Kota Asal | `town (diorama)` | `j6` (away: true) | ✅ PASS | [`09-town-return.png`](../../qa/journey/09-town-return.png) |
| **10** | Masuk Rumah Lagi, Verifikasi Jejak → Selesai | `town (interior)` | `done` (celebrated: true) | ✅ PASS | [`10-interior-restored-done.png`](../../qa/journey/10-interior-restored-done.png) |

---

## 3. Rincian Objek Starter Home & Verifikasi Jejak

- **Starter Home:**
  - `planet`: `2`
  - `city`: `0`
  - `buildingId`: `town:98389384:building:f_house_tall:2935:1395:-29863`
  - `asset`: `f_house_tall`
  - `tier`: `residential`
- **Jejak Ruangan (Trace):**
  - `kind`: `light`
  - `id`: `light::-0.922:0.000:0`
  - `floor`: `0`
  - `expected`: `{ on: true }`
  - `status.save`: `idle` (konfirmasi penulisan state ruangan berhasil)
- **Verifikasi Restore:**
  - `verifyTrace()` memvalidasi bahwa `light.on === true` masih aktif saat pemain kembali.
  - State `done` ter-persist ke `WorldStateStore` di bawah key `journey`.

---

## 4. Batasan Pengujian yang Dicatat

1. **Pergerakan Pemain Fisik vs Mode API:** Navigasi ke pintu rumah awal menggunakan kombinasi direct API `placePlayer(door.x, door.z)` dan `enterBuilding(door)` untuk keandalan eksekusi headless, bukan input fisik kursor / tombol WASD berkepanjangan.
2. **Audio Headless:** Sfx saklar lampu (`switch`) dan selebrasi fanfare diverifikasi terpanggil tanpa melempar exception; gelombang audio DAC fisik tidak didengar langsung.
3. **Lingkungan Server:** Pengujian dijalankan pada server preview produksi Vite port 5234 (`dist/` ter-compile mandiri, snapshot commit `6ec14aa`, tanpa intervensi WebSocket HMR).

---

## 5. Cara Mengulang Pengujian

```bash
# Jalankan preview server produksi dari folder snapshot
npx --prefix /private/tmp/claude-503/-Users-mikelrisyad-Developer-globe/21c2354c-1c80-4abc-9469-7b3a55eb1ef9/scratchpad/qa-m2 vite preview --port 5234 --strictPort

# Eksekusi harness E2E
PLAYWRIGHT_CORE=/Users/mikelrisyad/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core/index.js \
JOURNEY_QA_URL=http://localhost:5234 \
node /Users/mikelrisyad/Developer/globe-studio/tools/qa/journey_e2e.mjs
```
