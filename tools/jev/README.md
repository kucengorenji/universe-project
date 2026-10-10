# Jev (keputusan cepat lewat OpenRouter)

Helper untuk memanggil Jev (`typesafe/jev-1.13`) dan satu contoh: triage feedback pemain.
Panduan lengkap use case: [docs/JEV_USE_CASES.md](../../docs/JEV_USE_CASES.md).

## Setup

1. Buat API key di openrouter.ai (menu Keys) dan isi saldo kecil.
2. Simpan di file `.env` di root repo (sudah di-.gitignore, jangan di-commit):

   ```sh
   OPENROUTER_API_KEY=sk-or-...
   ```

   Untuk backend Cloudflare: `npx wrangler pages secret put OPENROUTER_API_KEY`.
   Untuk sesi Claude Code cloud: tambahkan sebagai environment variable di pengaturan environment,
   dan izinkan domain `openrouter.ai` di Network access.

## Contoh: triage feedback

```sh
node --env-file=.env tools/jev/triage-feedback.mjs tools/jev/example-feedback.csv
```

Setiap baris diberi satu kategori (`bug`, `performa`, `saran`, `pertanyaan`, `spam`, `lainnya`) dan hasilnya
ditulis ke `tools/jev/example-feedback.tagged.csv`. Ganti CSV-nya dengan feedback asli (kolom `id,pesan`).
`example-feedback.csv` berisi pesan contoh, bukan feedback pemain sungguhan.
