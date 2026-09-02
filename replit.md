# FocusBoard

FocusBoard adalah aplikasi tugas personal berbasis web untuk mengelola tugas berdasarkan kategori, prioritas, dan deadline. Tugas disimpan di PostgreSQL dan tersedia di semua perangkat melalui akun pengguna.

## Menjalankan di Replit

Workflow aplikasi menjalankan server Node pada port `5000`:

```bash
npm start
```

Buka preview Replit untuk menggunakan aplikasi.

## Menjalankan test

```bash
npm test
```

## Setup setelah merge

Replit menjalankan `scripts/post-merge.sh` setelah task merge. Script ini memasang dependency, menjalankan migrasi database development secara idempoten, lalu menjalankan test sebelum workflow direkonsiliasi.

## Fitur

- Membuat, mengedit, menandai selesai, dan menghapus tugas.
- Kategori: Kerja, Pribadi, Belajar, dan Keuangan.
- Prioritas tinggi, sedang, dan rendah.
- Deadline hari ini, 7 hari ke depan, serta penanda terlambat.
- Pencarian dan filter berdasarkan status, kategori, prioritas, dan deadline.
- Statistik ringkasan dan distribusi kategori.
- Pengguna dapat mendaftar, masuk, dan keluar melalui Clerk Auth.
- Data tersimpan otomatis di PostgreSQL dan dipisahkan berdasarkan akun.
- `localStorage` hanya digunakan sebagai cache per akun dan untuk memindahkan data versi lama sekali.


## Akun dan sinkronisasi perangkat

Masuk dengan akun yang sama pada perangkat lain untuk membuka daftar tugas yang sama. Semua endpoint tugas memerlukan sesi login dan hanya mengembalikan data milik pengguna tersebut.

Tugas lama hanya dipindahkan bila salinannya masih tersedia di `localStorage` browser saat pengguna pertama kali masuk. Baris database lama tanpa `user_id` sengaja tetap tidak dapat diakses dan tidak dapat diklaim menggunakan kode ruang kerja, karena kode lama bukan bukti kepemilikan akun.

## Skema database

`database/migrations/001_user_owned_tasks.sql` adalah sumber skema tugas. Tabel memakai primary key internal dan indeks unik `(user_id, id)`, sehingga dua akun dapat memiliki ID tugas yang sama tanpa bentrok. `scripts/post-merge.sh` menjalankan migrasi pada database development setelah task di-merge; Publish Replit menerapkan perbedaan skema development ke production.
