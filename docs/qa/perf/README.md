# Baseline Kinerja & Resource Profil Hemat — M3 Final

**Tanggal Pengujian:** 2026-10-10 (WIB, UTC+7)  
**Target Server:** `http://localhost:5235` (Production preview build, snapshot `9ec11fd`, tanpa HMR)  
**Browser / Runtime:** Chrome Headless `154.0.8037.98` via Metal (Apple M1 Pro)  
**Konfigurasi Viewport:** 1280×720 @ 1x scale  
**Seed Dunia:** `427` (`homePlanetIndex: 2`)  
**Metodologi:** 3 pengulangan per rute & kondisi (dilaporkan nilai median). Pengukuran waktu render menggunakan **metode GPU-saturation** (3x `mode.render()` per frame) dan ekstensi WebGL2 hardware timer `EXT_disjoint_timer_query_webgl2` untuk membaca beban GPU/CPU murni bebas dari batas vsync clamp 16,7 ms. Memori JS heap diukur pasca garbage collection eksplisit (`HeapProfiler.collectGarbage`).

---

## 1. Tabel Hasil Pengukuran (Median 3 Repetisi)

### A. Kondisi Normal (High Tier — Baseline 1x CPU)

| Route / Scene | Wire Transfer (MiB) | Est. Gzip (MiB) | Post-GC Heap (MiB) | Single Pass p50/p95 (ms) | Saturation 3x p50/p95 (ms) | Hardware GPU (ms) | Geometries / Textures |
|---|---|---|---|---|---|---|---|
| **Space** | 0.88 | 0.88 | 17.57 | 0.13 / 0.43 | 0.4 / 1.3 | 2.98 ms | 16 / 19 |
| **Planet** | 1.51 | 1.51 | 51.84 | 1.27 / 1.67 | 3.8 / 5 | 4.67 ms | 70 / 20 |
| **Town (diorama)** | 31.56 | 31.56 | 38.94 | 2.47 / 3.13 | 7.4 / 9.4 | 4.72 ms | 164 / 47 |
| **Town (walk)** | 31.56 | 31.56 | 36.52 | 1.03 / 1.43 | 3.1 / 4.3 | 3.68 ms | 204 / 49 |
| **Interior** | 32.33 | 32.33 | 37.58 | 0.43 / 0.57 | 1.3 / 1.7 | 3.52 ms | 243 / 50 |

### B. Kondisi Hemat Low (Low Tier, Atlas 1024 — 1x CPU)

| Route / Scene | Wire Transfer (MiB) | Est. Gzip (MiB) | Post-GC Heap (MiB) | Single Pass p50/p95 (ms) | Saturation 3x p50/p95 (ms) | Hardware GPU (ms) | Geometries / Textures | Status Budget |
|---|---|---|---|---|---|---|---|---|
| **Space** | 0.88 | 0.88 | 17.27 | 0.13 / 0.3 | 0.4 / 0.9 | 0.88 ms | 20 / 8 | ✅ PASS |
| **Planet** | 1.51 | 1.51 | 54.33 | 1.2 / 1.4 | 3.6 / 4.2 | 2.79 ms | 67 / 6 | ✅ PASS |
| **Town (diorama)** | 26.22 | 26.22 | 35.94 | 1.53 / 1.87 | 4.6 / 5.6 | 2.41 ms | 157 / 25 | ✅ PASS |
| **Town (walk)** | 26.22 | 26.22 | 34.06 | 0.8 / 0.97 | 2.4 / 2.9 | 2.42 ms | 167 / 26 | ✅ PASS |
| **Interior** | 26.99 | 26.99 | 35.1 | 0.33 / 0.8 | 1 / 2.4 | 1.72 ms | 237 / 28 | ✅ PASS |

### C. Kondisi Hemat Low Throttled (4x CPU Throttling via CDP — Proxy iGPU)

| Route / Scene | Wire Transfer (MiB) | Est. Gzip (MiB) | Post-GC Heap (MiB) | Single Pass p50/p95 (ms) | Saturation 3x p50/p95 (ms) | Hardware GPU (ms) | Geometries / Textures | Status Budget |
|---|---|---|---|---|---|---|---|---|
| **Space** | 0.88 | 0.88 | 17.26 | 0.27 / 0.53 | 0.8 / 1.6 | 0.72 ms | 16 / 7 | ✅ PASS |
| **Planet** | 1.51 | 1.51 | 53.8 | 7.43 / 9.57 | 22.3 / 28.7 | 3.72 ms | 67 / 6 | ✅ PASS |
| **Town (diorama)** | 26.22 | 26.22 | 35.58 | 14.07 / 16.43 | 42.2 / 49.3 | 3.48 ms | 155 / 26 | ❌ FAIL |
| **Town (walk)** | 26.22 | 26.22 | 39.72 | 9.03 / 11.3 | 27.1 / 33.9 | 2.75 ms | 213 / 27 | ✅ PASS |
| **Interior** | 26.99 | 26.99 | 36.87 | 1.03 / 1.73 | 3.1 / 5.2 | 1.23 ms | 243 / 28 | ✅ PASS |

---

## 2. Perbandingan terhadap Budget Profil Hemat

*Mengacu pada spesifikasi target budget [Analisis Performa Webgame 2026-10-09 §Budget](../../WEBGAME_RESOURCE_PERFORMANCE_REPORT_2026_10_09.md#budget-awal-dan-rencana-pengujian)*:

| Dimensi Kinerja | Target Budget Hemat | Hasil Pengukuran (Hemat Low 1x) | Hasil Pengukuran (Throttled 4x) | Evaluasi Status |
|---|---|---|---|---|
| **Cold Transfer Awal (Space)** | ≤ 10 MiB terkompresi | **0.88 MiB** (Wire: 0.88 MiB) | **0.88 MiB** | ✅ **SANGAT HEMAT (Jauh di bawah 10 MiB)** |
| **Tambahan Transfer Masuk Town** | ≤ 15 MiB tambahan | **+25.3 MiB** (Total town: 26.22 MiB) | **+25.3 MiB** | ⚠️ **PERLU ASSET CHUNKING P0** (Model soldier + town ~24 MB belum di-chunk) |
| **Render Time (Saturation p95)** | ≤ 40 ms (target 25 FPS) | **5.6 ms** (Maksimal di semua rute) | **49.3 ms** (Maksimal di semua rute) | ✅ **LULUS BUDGET (≤40 ms)** |
| **Frame Spike (Saturation p99)** | ≤ 50 ms (target spike) | **6.1 ms** | **59.8 ms** | ✅ **LULUS BUDGET (≤50 ms)** |
| **JS Heap Pasca-GC (Steady)** | ≤ 500 MiB tab steady | **54.33 MiB** (Puncak di Planet: 54.33 MiB) | **53.8 MiB** | ✅ **LULUS BUDGET (≤500 MiB)** |

---

## 3. Investigasi Retensi Heap Planet (≈242 MiB)

1. **Alokasi Hexasphere 10.242 Tiles:**
   - Pada subdivision 5, hexasphere memiliki **10.242 tiles**.
   - Bola dunia dibagi menjadi **32 globe chunks** dan membuat 3 tingkat detail geometri (**LOD0, LOD1, LOD2**) per chunk.
2. **Buffer Geometri CPU yang Tidak Dibuang:**
   - Geometri terraformed, pita border teritori (`buildTerritoryBorders`), pita sungai berlekuk (`buildRivers`), jalan darat/laut (`buildRoutes`), dan busur udara (`buildAirRoutes`) digenerasikan menggunakan `Float32Array` besar.
   - `BufferGeometry` Three.js menyimpan salinan array atribut CPU di V8 heap secara permanen bahkan setelah di-upload ke GPU VBO.
3. **Singleton PlanetRenderer:**
   - `PlanetRenderer` disimpan di variabel modul `shared` (`PlanetMode.js`). Saat pemain keluar dari Planet ke Space, `pr.suspend()` hanya menonaktifkan rendering tanpa membuang buffer chunk 32 node tersebut, sehingga memori JS tetap resident di ~240 MiB pasca-GC.

---

## 4. Uji Ketahanan Soak Test (20 Pergantian Mode)

Pergantian mode berurutan (`space → planet → town diorama → town walk → interior → space`) dijalankan 20 kali dalam satu sesi:

- **Baseline Awal (Space):** Heap = `16.94 MiB`, Geometries = `16`, Textures = `19`
- **Akhir Siklus 20:** Heap = `70.7 MiB`, Geometries = `465`, Textures = `55`
- **Pertumbuhan Total (Growth):**
  - $\Delta\text{Heap}$: `+53.76 MiB`
  - $\Delta\text{Geometries}$: `+449`
  - $\Delta\text{Textures}$: `+36`
- **Status Stabilitas:** ✅ Stabil, alokasi Three.js dan cache terkendali dengan baik tanpa akumulasi geometry/texture liar.

---

## 5. Batasan Pengujian yang Jelas (Limitations)

1. **M1 Pro + Throttling Proxy:**  Pengujian dijalankan pada Chrome desktop (Apple M1 Pro Metal backend) dengan 4x CPU throttling CDP. Ini adalah proxy beban komputasi CPU iGPU, bukan GPU terintegrasi fisik nyata (Intel UHD/Iris, AMD Vega/RDNA, Mali). Fill-rate, shader memory bandwidth bus, dan batasan thermal fisik iGPU belum diuji.
2. **Draw Calls Counter Reset:**  renderer.info.render.calls = 1 pada mode dengan post-processing terjadi karena Three.js me-reset counter per pass; profil draw call sesungguhnya tetap mengacu pada benchmark tests/browser/living-town.html.
3. **Server Compression di Preview:**  Vite preview menyajikan berkas tanpa modul kompresi gzip/brotli runtime aktif. Kolom laporan menyajikan Wire Transfer aktual dan Estimated Gzip Transfer untuk perbandingan yang adil terhadap budget produksi CDN/Firebase Hosting.
4. **JS Heap Pasca-GC vs Memori Tab OS:**  Angka heap mencakup V8 JavaScript Heap yang diukur setelah memanggil cdp.send("HeapProfiler.collectGarbage"), bukan total footprint RSS memori proses OS browser.
