# Laporan Pengujian E2E: Perjalanan Pertama / The First Journey (M2-Q1b)

**Tanggal:** 2026-10-10 (WIB, UTC+7)  
**Target Server:** `http://localhost:5234` (Production preview build, tanpa HMR)  
**Snapshot Commit:** `6ec14aa`  
**Browser / Backend:** Chrome Headless (`154.0.8037.98`, Metal WebGL)  
**Hasil Keseluruhan:** ✅ **10/10 LANGKAH LULUS (STAGE: DONE)**

---

## 1. Kronologi Eksekusi Alur Perjalanan (J1 → J6 → Done)

| Langkah | Nama Tahapan | Target / Route | Journey Stage | Status | Screenshot |
|---|---|---|---|---|---|
| **1** | Bootstrap in Space (Stage J1) | `space` | `j1` | ✅ PASS | [`01-space.png`](01-space.png) |
| **2** | Arrive at Home Planet (Stage J2) | `planet` | `j2` | ✅ PASS | [`02-planet.png`](02-planet.png) |
| **3** | Land in Hometown Diorama (Stage J3) | `town (diorama)` | `j3` | ✅ PASS | [`03-town-diorama.png`](03-town-diorama.png) |
| **4** | Approach Starter House Door (Stage J4) | `town (walk)` | `j4` | ✅ PASS | [`04-walk-door.png`](04-walk-door.png) |
| **5** | Inside Starter House (Stage J5) | `town (interior)` | `j5` | ✅ PASS | [`05-interior.png`](05-interior.png) |
| **6** | Turn on Light in House (Stage J6) | `town (interior)` | `j6` | ✅ PASS | [`06-light-on.png`](06-light-on.png) |
| **7** | Return to Space (Away flag noted) | `space` | `j6` | ✅ PASS | [`07-space-away.png`](07-space-away.png) |
| **8** | After Reload in Space (State Persisted) | `space` | `j6` | ✅ PASS | [`08-reload-space.png`](08-reload-space.png) |
| **9** | Return to Hometown Diorama | `town (diorama)` | `j6` | ✅ PASS | [`09-town-return.png`](09-town-return.png) |
| **10** | Trace Restored - Journey Complete (Stage Done) | `town (interior)` | `done` | ✅ PASS | [`10-interior-restored-done.png`](10-interior-restored-done.png) |

---

## 2. Rincian Bukti Verifikasi State & Jejak

- **Identitas Rumah Awal (Starter House):**
  - **Planet / Kota Asal:** Planet index `2`, City index `0`
  - **Building ID:** `town:128420741:building:f_house_tall:3253:-983:24729`
  - **Asset / Tier:** `f_house_tall` (`residential`)
- **Verifikasi Jejak Ruangan (Trace):**
  - **Jenis Jejak (Kind):** `light`
  - **ID Lampu:** `light::-2.150:1.851:0`
  - **Ekspektasi State:** `on === true`
  - **Hasil Pengecekan Ulang (Langkah 10):** Jejak lampu tetap menyala setelah reload & keluar ke angkasa; verifikasi `verifyTrace()` berhasil, kartu selebrasi tampil, stage berubah menjadi `done`.
- **Integritas Runtime:**
  - `engine.lastError`: **null** di seluruh 10 langkah.
  - Page unhandled errors: **0**.
  - Console errors: **0**.

---

## 3. Batasan Pengujian yang Dicatat (Limitations)

1. **Pergerakan Pemain Fisik vs Mode API:** Navigasi ke pintu rumah awal menggunakan `mode.placePlayer(door.x, door.z)` dan `mode.enterBuilding(door)` untuk keandalan eksekusi headless, bukan input penekanan tombol fisik WASD secara kontinu.
2. **Audio Headless:** Sfx transisi dan fanfare selebrasi diverifikasi terpanggil tanpa error; output audio hardware tidak didengar langsung.
3. **Lingkungan Server:** Pengujian dijalankan pada server preview produksi Vite port 5234 (`dist/` ter-compile mandiri, snapshot commit `6ec14aa`).

---

## 4. Cara Mengulang Pengujian

```bash
# Jalankan preview server produksi
npx --prefix /private/tmp/claude-503/-Users-mikelrisyad-Developer-globe/21c2354c-1c80-4abc-9469-7b3a55eb1ef9/scratchpad/qa-m2 vite preview --port 5234 --strictPort

# Jalankan skrip E2E
PLAYWRIGHT_CORE=/Users/mikelrisyad/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core/index.js \
JOURNEY_QA_URL=http://localhost:5234 \
node /Users/mikelrisyad/Developer/globe-studio/tools/qa/journey_e2e.mjs
```

## Catatan lead (10 Okt, 09:10)

Hasil fungsional valid: stage `done`, `verifyTrace()` berhasil setelah kembali ke space dan reload, `engine.lastError` null. **Screenshot run ini belum layak untuk review UX**: kartu intro tidak pernah ditutup oleh harness (tombol "Start journey" tidak diklik), sehingga overlay menutupi HUD tujuan, beacon, panah dan pin (HUD sengaja disembunyikan saat `body[data-overlay]`). Run berikutnya harus menutup intro seperti pemain lalu mengambil ulang semua capture.
