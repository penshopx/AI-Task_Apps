# FocusBoard

FocusBoard adalah aplikasi tugas personal berbasis web untuk mengelola tugas berdasarkan kategori, prioritas, dan deadline.

## Menjalankan di Replit

Workflow aplikasi menjalankan server statis pada port `5000`:

```bash
python3 -m http.server 5000 --bind 0.0.0.0
```

Buka preview Replit untuk menggunakan aplikasi.

## Fitur

- Membuat, mengedit, menandai selesai, dan menghapus tugas.
- Kategori: Kerja, Pribadi, Belajar, dan Keuangan.
- Prioritas tinggi, sedang, dan rendah.
- Deadline hari ini, 7 hari ke depan, serta penanda terlambat.
- Pencarian dan filter berdasarkan status, kategori, prioritas, dan deadline.
- Statistik ringkasan dan distribusi kategori.
- Data tersimpan otomatis di `localStorage` browser.