# Izin Lapangan (Node.js)

Aplikasi pengajuan izin sakit, cuti, dan izin lainnya untuk karyawan lapangan, dengan persetujuan berjenjang 0 → 1 → 2 → 3 → 4. Ini adalah versi Node.js dari artifact HTML `Izin_Lapangan_mandiri_Rev_Fix Kali.html`: tampilan, aturan bisnis, dan data contohnya sama, tetapi data sekarang disimpan di server sehingga dipakai bersama oleh semua pengguna dan diperbarui langsung di semua perangkat.

## Menjalankan

Butuh Node.js 18 atau lebih baru.

```bash
npm install
npm start
```

Buka http://localhost:3000.

Untuk pengembangan dengan restart otomatis:

```bash
npm run dev
```

Port dapat diganti lewat variabel lingkungan `PORT` (misalnya `PORT=8080 npm start`). Server mendengarkan di `0.0.0.0` agar bisa diakses dari ponsel di jaringan yang sama.

## Pertama kali dipakai

1. Buka aplikasi. Jika belum ada data, tekan **Muat data contoh** untuk mengisi 5 akun pengelola, 764 karyawan contoh, dan beberapa pengajuan.
2. Masuk memakai nama lengkap dan NIK. Akun contoh:
   - `Super Admin` / `SA-001`
   - `Admin 1` / `ADM-001` (akses Produksi-SMD)
   - `Admin 2` / `ADM-002` (akses Produksi-OB)
   - `Admin 3` / `ADM-003` (akses Produksi-CH)
   - `Admin 4` / `ADM-004` (akses Administrasi, CMS, NSID, Produksi-SMC, SHE, Workshop & Logistic)
3. Tombol akun demo di halaman masuk mengisi nama dan NIK secara otomatis.

Alternatif tanpa data contoh: **Mulai tanpa data contoh**, lalu buat Super Admin pertama. Data asli bisa dimuat lewat **Pengaturan → Import Data Excel** atau **Sinkron manpower dari Excel** (khusus Super Admin).

## Login dan hak akses

Login memakai nama persis seperti data HR dan NIK, tanpa kata sandi. Ini mengikuti perilaku versi HTML aslinya: aplikasi ditujukan untuk jaringan internal, bukan internet publik. Siapa pun yang bisa membuka server dapat membaca dan mengubah data. Jika akan dipublikasikan, tambahkan autentikasi (misalnya reverse proxy dengan SSO) di depan aplikasi.

Peran ditentukan oleh jabatan:

- **Karyawan** mengajukan izin.
- **Pengawas** (Foreman/Supervisor/Leader/Officer/Koordinator, Superintendent/Penanggung Jawab/Kabag/HC, Deputy PM, PJO) menyetujui atau menolak.
- **Admin** melihat data sesuai departemen yang diberikan.
- **Super Admin** melihat semua departemen dan dapat mengelola jabatan, approver, import, serta reset data.

## Penyimpanan data

Data ditulis ke folder `data/`:

- `data/db.json` — koleksi `karyawan`, `jabatan`, `pengajuan`, dan `absensi`.
- `data/lampiran/<id>.json` — lampiran surat (foto/PDF) dalam bentuk data URL.

Folder dan file dibuat otomatis saat pertama kali menulis. Hentikan server lalu salin folder `data/` untuk mencadangkan, dan kembalikan folder itu untuk memulihkan. File data tidak masuk Git (lihat `.gitignore`).

Penyimpanan ini berbasis file JSON dan cocok untuk satu proses server. Jangan menjalankan beberapa instance terhadap folder data yang sama.

## API

Semua endpoint mengembalikan JSON.

| Metode | Endpoint | Keterangan |
| --- | --- | --- |
| GET | `/api/health` | Cek server |
| GET | `/api/collections/:col` | Daftar dokumen (`karyawan`, `jabatan`, `pengajuan`, `absensi`) |
| PUT/POST | `/api/collections/:col/:id` | Simpan/timpa dokumen |
| PATCH | `/api/collections/:col/:id` | Ubah sebagian field |
| DELETE | `/api/collections/:col/:id` | Hapus dokumen |
| GET | `/api/lampiran` | Daftar id lampiran |
| GET/PUT/DELETE | `/api/lampiran/:id` | Baca, simpan, atau hapus lampiran |
| GET | `/api/events` | Server-Sent Events; mengirim `{ "col": "..." }` setiap ada perubahan |

Batas ukuran body request adalah 12 MB.

## Struktur proyek

```
server.js              Server Express: API, penyimpanan JSON, SSE, file statis
public/index.html      Kerangka halaman
public/styles.css      Seluruh tampilan (tema terang/gelap)
public/js/db.js        Adaptor browser: REST + SSE untuk data bersama
public/js/app.js       Logika aplikasi (UI, alur persetujuan, laporan, import)
public/js/seed-data.js Data contoh: departemen dan jabatan
public/js/seed-rows.js, seed-rows-2.js, seed-rows-3.js  Baris karyawan contoh
```

## Catatan

- Fitur Excel (unduh laporan, template import, manpower) memakai pustaka `xlsx` dari CDN, jadi browser perlu koneksi internet saat memakai fitur tersebut.
- Semua keputusan persetujuan, absensi otomatis, pembatalan, dan laporan berjalan di browser seperti versi aslinya; server hanya menyimpan data dan menyiarkan perubahan.
- Belum ada unggahan file multipart: lampiran dikirim sebagai data URL dan disimpan sebagai JSON, sama seperti format data di HTML aslinya.
