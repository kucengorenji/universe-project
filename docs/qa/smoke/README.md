# Smoke Test Routes & Resource Stability Report

**Tanggal:** 2026-10-10 (WIB (UTC+7))  
**Target URL:** `http://localhost:5233`  
**Browser:** Chrome Headless (`154.0.8037.98`) via Metal  
**Hasil Keseluruhan:** ⚠️ **PERIKSA TEMUAN**

---

## 1. Ringkasan Pengujian Route

Setiap route diverifikasi dengan syarat: (1) mode/view aktif sesuai rute, (2) overlay cover selesai transisi, (3) `renderer.info.render.calls` stabil ter-render selama beberapa frame, (4) `engine.lastError === null`, dan (5) 0 unhandled page error.

| Route / Scene | Path | Status | Mode / View | `engine.lastError` | Geometries | Textures | Draw Calls |
|---|---|---|---|---|---|---|---|
| Space | `#/space` | ✅ PASS | `space` | null | 17 | 20 | 1 |
| Planet | `#/planet/<home>` | ✅ PASS | `planet` | null | 67 | 21 | 1 |
| Town (Diorama) | `#/town/<home>/<city>` | ✅ PASS | `town (diorama)` | null | 278 | 48 | 1 |
| Town (Walk) | `#/town` (walk view) | ✅ PASS | `town (walk)` | null | 331 | 49 | 1 |
| Interior | Town House Interior | ✅ PASS | `town (interior)` | null | 446 | 51 | 1 |
| Home Editor | `#/home/<homeId>` | ✅ PASS | `home` | null | 258 | 31 | 1 |
| Trade | `#/trade/<campaign>` | ✅ PASS | `trade` | null | 245 | 34 | 1 |
| Farm (Valley) | `farm.html` | ✅ PASS | `valley` | null | 48 | 28 | 93 |
| Skirmish | `skirmish.html` | ✅ PASS | `skirmish (command)` | null | 0 | 0 | 0 |

---

## 2. Uji Kebocoran Memori (6 Siklus Pergantian Mode)

Siklus pergantian: `space → planet → town → home → trade → space` diulang 6 kali berturut-turut untuk mengamati alokasi geometry dan texture:

| Siklus | Geometries | Textures | Draw Calls | Triangles | `engine.lastError` |
|---|---|---|---|---|---|
| Baseline (Space Awal) | 246 | 38 | 1 | 1 | null |
| Siklus 1 | 247 | 38 | 1 | 1 | null |
| Siklus 2 | 247 | 38 | 1 | 1 | null |
| Siklus 3 | 247 | 38 | 1 | 1 | null |
| Siklus 4 | 248 | 38 | 1 | 1 | null |
| Siklus 5 | 250 | 39 | 1 | 1 | null |
| Siklus 6 | 252 | 39 | 1 | 1 | null |

**Analisis Stabilitas Sumber Daya:**
- **Δ Geometries (Siklus 6 vs Siklus 1):** `5`
- **Δ Textures (Siklus 6 vs Siklus 1):** `1`
- **Kesimpulan Stabilitas:** ⚠️ Terdeteksi pertumbuhan memori.

---

## 3. Batas yang Belum Bisa Diuji (Limitations)

1. **Pointer lock fisik**: walk view memakai API mode internal (`setView('walk')`) dan input sintetis; `requestPointerLock` di headless tidak menguji kursor perangkat.
2. **Audio**: hanya lifecycle; kualitas suara/mixing belum didengar.
3. **Draw calls**: `renderer.info.render.calls` = 1 karena post-processing mereset counter per pass; angka ini **bukan** jumlah draw call per frame. Profil draw call memakai harness `tests/browser/living-town.html` (autoReset dimatikan).
4. **Skirmish**: renderer Skirmish tidak diekspos ke harness, sehingga geometry/texture tercatat 0; PASS hanya berarti fase `command` aktif tanpa error.
5. **Pertumbuhan resource**: siklus 1–3 stabil (247/38), siklus 4–6 naik ke 252/39. Kecil, tetapi menjadi item pantau untuk soak 30 menit (M2 perf).
6. **Perangkat target**: Chrome headless di Apple Metal (M1 Pro). Belum ada iGPU / RAM 8 GB nyata.

Catatan lead (10 Okt): batas di atas dikoreksi lead; versi AGY sebelumnya menyebut multiplayer dan `tests/api/` yang tidak ada di branch ini.
