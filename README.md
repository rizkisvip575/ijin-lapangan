# Izin Lapangan

Aplikasi pengajuan izin sakit, cuti, dan izin lapangan dengan persetujuan berjenjang. Frontend berupa satu halaman statis, backend Express yang berjalan sebagai fungsi serverless di Vercel, dan data disimpan di Supabase (Postgres).

## Cara kerja

| Bagian | Teknologi | Lokasi |
| --- | --- | --- |
| Frontend | HTML + CSS + JS tanpa build framework | `public/` (disalin ke `dist/` saat build) |
| API | Express, satu fungsi serverless | `lib/app.js`, `api/[...path].js` |
| Data | Supabase Postgres lewat PostgREST | `lib/store-supabase.js` |
| Mode lokal | File JSON di `data/` | `lib/store-file.js` |

Server memilih penyimpanan otomatis: jika `SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY` ada, data masuk ke Supabase. Jika tidak, data disimpan di `data/db.json` (hanya untuk mencoba di komputer).

Data dibagi menjadi lima koleksi: `karyawan`, `jabatan`, `pengajuan`, `absensi`, dan `lampiran` (foto/PDF surat, sudah dikompres di browser menjadi data URL kecil).

## Menjalankan di komputer

```bash
npm install
npm start
```

Buka http://localhost:3000. Tanpa konfigurasi Supabase, aplikasi memakai penyimpanan file lokal dan menampilkan label "Tersambung ke server" bila API aktif. Tekan **Muat data contoh** untuk mengisi 769 karyawan dan akun demo.

Untuk mencoba dengan Supabase sungguhan dari komputer:

```bash
cp .env.example .env    # lalu isi dua nilainya
npm start
```

## Deploy ke Vercel + Supabase

### 1. Siapkan Supabase

1. Buat project baru di https://supabase.com/dashboard.
2. Buka **SQL Editor → New query**, tempel seluruh isi `supabase/schema.sql`, lalu **Run**. Skrip ini membuat tabel `documents`, sequence `rev`, trigger, dan mengunci tabel dengan RLS.
3. Buka **Project Settings → API**, catat:
   - **Project URL** → `SUPABASE_URL`
   - **service_role secret** → `SUPABASE_SERVICE_ROLE_KEY`

Service role key hanya boleh dipakai di server. Jangan menaruhnya di kode frontend, dan jangan meng-commit file `.env`.

### 2. Unggah kode ke GitHub

```bash
git add .
git commit -m "Deploy Izin Lapangan ke Vercel dan Supabase"
git push
```

### 3. Impor project di Vercel

1. https://vercel.com/new → pilih repository GitHub ini → **Import**.
2. Framework Preset: **Other**. Build Command dan Output Directory sudah diatur di `vercel.json` (`npm run build` → `dist`).
3. Pada **Environment Variables**, tambahkan (untuk Production, Preview, dan Development):

   | Nama | Nilai |
   | --- | --- |
   | `SUPABASE_URL` | Project URL Supabase |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role key Supabase |

4. **Deploy**. Setelah selesai, buka domain Vercel-nya, tekan **Muat data contoh**, lalu masuk dengan akun demo.

Setiap `git push` ke branch yang terhubung akan men-deploy ulang otomatis.

## Akun demo

| Nama | NIK | Peran |
| --- | --- | --- |
| Super Admin | `SA-001` | Super Admin (semua departemen, import, reset) |
| Admin 1 | `ADM-001` | Admin Produksi-SMD |
| Admin 2 | `ADM-002` | Admin Produksi-OB |
| Admin 3 | `ADM-003` | Admin Produksi-CH |
| Admin 4 | `ADM-004` | Admin Administrasi + 6 departemen lain |

Data contoh juga membuat akun pengawas dan karyawan. Daftar akun demo muncul di halaman login setelah data contoh dimuat.

## API

| Metode | Rute | Keterangan |
| --- | --- | --- |
| GET | `/api/health` | Status server dan jenis penyimpanan (`file` / `supabase`) |
| GET | `/api/changes?since=<rev>` | Koleksi yang berubah sejak `rev` tertentu |
| GET | `/api/collections/:col` | Semua dokumen dalam koleksi |
| POST | `/api/collections/:col` | Simpan banyak dokumen: `{ "docs": [{ "id", "data" }] }` |
| GET | `/api/collections/:col/:id` | Satu dokumen |
| PUT / POST | `/api/collections/:col/:id` | Timpa dokumen |
| PATCH | `/api/collections/:col/:id` | Gabung sebagian field |
| DELETE | `/api/collections/:col/:id` | Hapus dokumen |
| GET | `/api/lampiran` | Daftar id lampiran |
| GET / PUT / DELETE | `/api/lampiran/:id` | Isi lampiran |

`col` adalah salah satu dari `karyawan`, `jabatan`, `pengajuan`, `absensi`.

Pembaruan tampilan memakai polling ringan: browser memanggil `/api/changes` setiap 4 detik dan hanya memuat ulang koleksi yang benar-benar berubah. Ini menggantikan Server-Sent Events agar cocok dengan fungsi serverless.

## Struktur

```
api/[...path].js        Titik masuk fungsi Vercel untuk semua /api/*
lib/app.js              Definisi rute dan pemilihan penyimpanan
lib/store-supabase.js   Driver Supabase (PostgREST)
lib/store-file.js       Driver file JSON untuk pengembangan lokal
server.js               Server lokal (npm start)
scripts/build.js        Menyalin public/ ke dist/ saat build Vercel
public/                 Aplikasi (HTML, CSS, JS, data contoh)
supabase/schema.sql     Tabel, trigger rev, dan kebijakan RLS
vercel.json             Build dan pengaturan fungsi
```

## Catatan

- **Login belum memakai kata sandi.** Siapa pun yang tahu NIK dapat masuk. Karena situs ini publik di internet, pasang autentikasi (misalnya Supabase Auth) sebelum dipakai dengan data sungguhan. Skema RLS saat ini menutup akses langsung dari browser; semua akses lewat API server.
- Import Excel memakai pustaka `xlsx` dari CDN, jadi browser perlu koneksi internet untuk fitur Excel.
- Batas body fungsi Vercel adalah 4,5 MB; lampiran sudah dibatasi sekitar 190 KB (foto) dan 150 KB (PDF), jadi aman.
- Data contoh memuat 769 karyawan dalam beberapa permintaan bulk, jauh di bawah batas waktu fungsi.
- Backup: gunakan **Database → Backups** di Supabase, atau ekspor tabel `documents` lewat SQL Editor.
