# FocusBoard

FocusBoard adalah aplikasi tugas personal berbasis web untuk mengelola tugas berdasarkan kategori, prioritas, dan deadline. Tugas disimpan di PostgreSQL dan dapat dibuka dari perangkat lain menggunakan kode ruang kerja yang sama.

## Menjalankan di Replit

Workflow aplikasi menjalankan server Node pada port `5000`:

```bash
npm start
```

Buka preview Replit untuk menggunakan aplikasi.

## Menjalankan test

```bash
node --test tests/task-utils.test.js
```

## Setup setelah merge

Replit menjalankan `scripts/post-merge.sh` setelah task merge. Script ini melakukan instalasi dependency secara non-interaktif dengan `npm ci`, lalu menjalankan test sebelum workflow direkonsiliasi.

## Fitur

- Membuat, mengedit, menandai selesai, dan menghapus tugas.
- Kategori: Kerja, Pribadi, Belajar, dan Keuangan.
- Prioritas tinggi, sedang, dan rendah.
- Deadline hari ini, 7 hari ke depan, serta penanda terlambat.
- Pencarian dan filter berdasarkan status, kategori, prioritas, dan deadline.
- Statistik ringkasan dan distribusi kategori.
- Data tersimpan otomatis di PostgreSQL.
- Kode ruang kerja dapat digunakan untuk membuka daftar tugas yang sama di perangkat lain.
- `localStorage` digunakan sebagai cache lokal dan untuk migrasi data versi lama.

## Sinkronisasi perangkat

Klik kode **Ruang tersinkron** di header aplikasi. Masukkan kode yang sama pada perangkat lain untuk mengakses ruang tugas yang sama. Kode ruang kerja bukan password; jangan gunakan informasi pribadi sebagai kode.