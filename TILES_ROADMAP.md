# Roadmap Generasi Model Tile 3D & Aset Lanjutan

> **Catatan Pengembangan**: Implementasi saat ini menggunakan representasi 3D geometris *low-poly procedural* (prisma heksagonal, kubah pohon pinus, puncak gunung bersalju, kurva sungai *tube*, dan benteng ibukota dengan *holographic beacon*).
> File ini merangkum rancangan untuk meng-upgrade aset tile ke model 3D berkulitas tinggi di iterasi berikutnya.

---

## 1. Tipe Tile Saat Ini (Current Procedural State)

| Tipe Tile | Representasi Visual Saat Ini | Elevasi Relatif | Detail Geometri |
| :--- | :--- | :--- | :--- |
| **Lautan (Ocean & Deep Ocean)** | Biru samudra dalam (`#0e2f56` & `#1a588b`), specular tinggi | $-0.025$ s/d $-0.015$ | Cekung ke dalam inti planet, permukaan rata dengan *specular highlight*. |
| **Padang Rumput (Plains)** | Hijau cerah (`#4a8c38`), prisma heksagonal | $0.00$ s/d $+0.04$ | Dasar daratan rata untuk ekspansi kota dan jalur perdagangan. |
| **Hutan (Forest)** | Hijau kanopi (`#235e2c`), gugusan pohon pinus | $+0.01$ s/d $+0.05$ | Kluster 3-5 kerucut pohon pinus low-poly yang diorientasikan terhadap vektor normal bola. |
| **Pegunungan (Mountain)** | Bebatuan abu-abu abu vulkanik (`#73695f`) | $+0.025$ s/d $+0.12$ | 1-2 puncak gunung kerucut runcing dengan topi salju putih (`#eef2f7`). |
| **Sungai (River)** | Biru cerah (`#29a4e8`), alur pipa kurva air | Mengikuti terrain | Jalur kurva *quadratic bezier tube* yang mengalir dari elevasi tinggi ke laut. |
| **Kota / Ibukota (City / Capital)** | Menara benteng + cincin lambang + berkas cahaya neon | $+0.02$ s/d $+0.15$ | *Keep* utama diapit 3 menara bastion, cincin faksi, dan pilar cahaya vertikal (Cyan untuk Player, Magenta untuk Sistem). |

---

## 2. Rencana Upgrade Model 3D Menggunakan Generative AI (Meshy MCP & Blender)

Untuk mengganti bentuk geometri sederhana menjadi model 3D detail (*Civilization VI / Humankind style*), pipeline berikut disiapkan:

### A. Prompt Generasi Meshy 3D (`meshy_text_to_3d`)
1. **Hex Forest Tile**:
   - *Prompt*: `"Stylized low poly pine forest hex tile, video game asset, Civilization VI style, hand painted texture, clean base, isometric 3d"`
2. **Hex Mountain Range Tile**:
   - *Prompt*: `"Stylized low poly snowy mountain peaks hex tile, sharp rocky cliffs, alpine snow cap, game ready asset, GLTF format"`
3. **Hex City Citadel Tile**:
   - *Prompt*: `"Stylized medieval fantasy city citadel on hexagonal tile base, tiny houses, stone walls, watchtowers, Civ style"`
4. **Hex Coastal / Reef Tile**:
   - *Prompt*: `"Tropical coastal hex tile with sandy beach, shallow turquoise water, tiny palm trees, stylized 3d"`

### B. Otomatisasi Blender MCP
- Model hasil Meshy di-import ke Blender via MCP tool.
- Normalisasi *bounding box* dan pemangkasan alas agar presisi dengan ukuran heksagon standar ($R = 10$, radius heksagon $\approx 0.75$).
- Pembuatan *LOD (Level of Detail)*: LOD0 (detail penuh saat zoom dekat) dan LOD1 (ringan saat zoom out tampilan penuh bola dunia).
- Ekspor ke `.glb` berbobot ringan (< 150 KB per tile).

---

## 3. Fitur Lanjutan yang Disiapkan di Arsitektur Kode

1. **Custom Shader Air Laut Dinamis**:
   - Penambahan efek ombak *Gerstner waves* atau busa pantai (*coastal foam*) di perbatasan heksagon daratan dan lautan.
2. **Lapisan Atmosfer & Awan Bergerak**:
   - Menambahkan lapisan bola transparan di atas planet dengan tekstur awan prosedural yang berputar perlahan dengan kecepatan berbeda dari rotasi daratan.
3. **Mekanisme Perluasan Wilayah (*Territory Expansion*)**:
   - Border Civilization saat ini sudah dinamis mendeteksi tetangga (`tile.owner !== neighbor.owner`). Cukup mengubah properti `tile.owner = 'player'` dan memanggil `buildTerritoryBorders()`, border neon akan otomatis mengembang secara instan.
4. **Unit Perdagangan / Konvoi Diplomatik**:
   - Jalur koneksi antar-ibukota sudah memiliki kurva 3D (`CatmullRomCurve3`). Karavan unta/kapal laut/pesawat kargo dapat dengan mudah dianimasikan menyusuri lintasan ini.

---
*Dokumen ini dibuat otomatis sebagai referensi teknis tahap lanjutan pembangunan Planet Globe 3D.*
