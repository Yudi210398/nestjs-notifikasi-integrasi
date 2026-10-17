# WhatsApp Notification Service

## Tujuan

Aplikasi PHP tetap menjadi aplikasi utama dan database MySQL legacy tetap menjadi sumber data. Service NestJS ini membaca data legacy untuk menentukan serta mengirim notifikasi WhatsApp melalui Fonnte. Tabel bisnis legacy hanya dibaca; `notification_log` adalah tabel milik NestJS yang dapat ditulis.

## Arsitektur dan fitur

```text
PHP (trigger order-ready; wiring aktual belum terverifikasi) / scheduler fitting
  → NestJS → MySQL legacy (SELECT saja)
           → notification_log (klaim unik PENDING)
           → Fonnte (provider menangani pengiriman WhatsApp)
           → notification_log (status hasil request provider)
```

Fitur yang tersedia: notifikasi order siap diambil, pengingat fitting, perlindungan duplikat, transport Fonnte, autentikasi API internal, dan pencatatan hasil. Detail modul dan batas data ada di [docs/architecture.md](docs/architecture.md).

## Order ready

Aplikasi PHP nantinya memanggil `POST /internal/notifications/order-ready` setelah order berubah menjadi tepat `order_status === "Selesai"`. Kirim **hanya** `orderId`:

```http
Authorization: Bearer <INTERNAL_API_KEY>
Content-Type: application/json

{"orderId":123}
```

NestJS membaca ulang order, customer, nomor HP, dan nama category dari database legacy; payload PHP bukan sumber data untuk field tersebut. Setelah data layak, service mengklaim key `ORDER_READY:<orderId>`, memanggil Fonnte satu kali, lalu mencatat hasil. Trigger duplikat tidak mengirim ulang. Order yang belum `Selesai` dikembalikan sebagai `SKIPPED` tanpa mengonsumsi key, sehingga order dapat diproses saat statusnya berubah. Nomor HP yang hilang pada order siap dicatat `SKIPPED` dan tidak dikirim.

Respons bisnis memakai HTTP 200 dengan `outcome` `SENT`, `DUPLICATE`, `SKIPPED`, `FAILED`, atau `AMBIGUOUS`; `SKIPPED` juga membawa `reason`. Body invalid menghasilkan 400, Bearer key hilang/salah 401, key server belum dikonfigurasi 503, dan error internal tak terduga 500. Integrasi pemanggilan dari kode PHP belum ada/terverifikasi dalam repository ini.

## Fitting reminder

Scheduler memakai kalender `Asia/Jakarta` dan hanya memproses fitting dengan `tbl_order.tgl_coba` sama dengan hari ini serta `tbl_fitting.fitting_status IS NULL`. Ia membaca nama category dari database. Jadwal cron berjalan tiap 30 menit mulai 11:00 sampai 20:30; startup/restart juga dapat mengejar fitting **hari ini** dalam window tersebut. Menit 20:30 masih boleh, mulai 20:31 tidak boleh. Fitting kemarin tidak dikejar.

Scan berjalan hanya jika `FITTING_REMINDER_ENABLED` bernilai persis `"true"`. Nilai lain atau env yang tidak ada berarti **disabled**, termasuk saat startup. Key `FITTING:<fittingId>` memastikan satu notifikasi per fitting. Nomor HP hilang dicatat `SKIPPED` tanpa memanggil Fonnte. Tidak ada pengiriman ulang otomatis untuk hasil gagal atau tidak pasti.

## Status notifikasi

| Status | Arti |
|---|---|
| `PENDING` | Key berhasil diklaim; hasil pengiriman belum tersimpan. |
| `SENT` | Fonnte secara eksplisit menerima request; **bukan** bukti pesan telah diterima di WhatsApp. |
| `FAILED` | Fonnte secara eksplisit menolak request. |
| `SKIPPED` | Nomor HP hilang pada kandidat yang layak; alasan disimpan. SKIP lain tidak selalu dicatat. |
| `AMBIGUOUS` | Hasil request tidak pasti, misalnya timeout atau respons tidak terkonfirmasi. |

Unique key pada `notification_log` mencegah pengiriman kedua untuk identitas yang sudah tercatat, apa pun statusnya. Tidak ada blind retry; `PENDING` atau `AMBIGUOUS` memerlukan pemeriksaan manual sebelum keputusan mengirim lagi.

## Environment

Salin [.env.example](.env.example) menjadi `.env`, lalu isi sesuai lingkungan lokal. Jangan commit `.env` atau mencetak credential. Variabel yang dipakai:

| Nama | Kegunaan |
|---|---|
| `PORT` | Port HTTP NestJS. |
| `DB_HOST`, `DB_PORT`, `DB_NAME` | Lokasi dan nama database legacy lokal. |
| `DB_USER`, `DB_PASSWORD` | Akun pembaca legacy dengan hak SELECT saja. |
| `NOTIFICATION_DB_USER`, `NOTIFICATION_DB_PASSWORD` | Akun writer yang dibatasi ke `notification_log`. |
| `FONNTE_TOKEN` | Token device Fonnte untuk transport WhatsApp. |
| `INTERNAL_API_KEY` | Bearer key untuk endpoint order-ready internal. |
| `FITTING_REMINDER_ENABLED` | Switch scan fitting; hanya string persis `"true"` yang mengaktifkan. |

Untuk MySQL lokal, `.env.docker.example` menyediakan `DB_ROOT_PASSWORD` bagi provisioning; simpan di `.env.docker`, bukan `.env` NestJS. Langkah database dan Prisma ada di [docs/local-database.md](docs/local-database.md).

## Menjalankan lokal

Butuh Node.js 20+, npm, dan MySQL lokal yang telah disiapkan sesuai dokumentasi database.

```sh
npm install
npm run start:dev
```

Build dan jalankan hasil build dengan `npm run build` lalu `npm run start:prod`. Pastikan scheduler tetap disabled di lokal kecuali memang sedang melakukan pengujian terkontrol dengan provider mock.

## Test

```sh
npm run check-all
```

Perintah itu menjalankan Jest, test legacy CommonJS, integration test MySQL, lint, build, dan pemeriksaan diff/status. Integration test memerlukan database lokal serta akun notification writer; test membuat dan membersihkan hanya row sintetis di `notification_log`.

Perintah terpisah: `npm test` untuk unit/flow Jest, `npm run test:legacy` untuk repository test lama, dan `npm run test:notification-log:integration` untuk klaim unik dan persistensi MySQL. Fonnte **di-mock** pada semua automated test tersebut. `npm run test:smoke` adalah pemeriksaan READ-ONLY repository terhadap MySQL lokal; tidak mengirim WhatsApp.

Live Fonnte smoke test berbeda dari automated test: jalankan secara manual dan eksplisit ke nomor milik developer, maksimal satu send, tanpa retry otomatis jika hasilnya tidak pasti. Jangan gunakan nomor customer legacy.

## Dokumentasi API dan keamanan demo

Saat service berjalan, buka `http://localhost:<PORT>/docs`. Swagger menjelaskan `/health` dan endpoint order-ready internal. Endpoint order-ready memakai `Authorization: Bearer <INTERNAL_API_KEY>`; Swagger bukan sistem login/JWT.

- Jangan menulis data bisnis legacy; aksesnya READ-ONLY.
- Jangan menjalankan live Fonnte test dengan data customer.
- Jangan menjalankan `docker compose down -v` kecuali memang ingin menghancurkan database lokal.
- Jangan commit `.env` atau credential lain.
- Akses production ke `/docs` dan endpoint internal perlu dibatasi oleh jaringan/deployment saat N-010.

## Batas implementasi saat ini

Sisi endpoint NestJS telah diuji, tetapi wiring pemanggilan **PHP → NestJS** belum terverifikasi. Live Fonnte smoke test tetap manual. Docker/deployment production dan verifikasi environment production termasuk pekerjaan berikutnya, bukan bagian dari fitur yang sudah terbukti di repository ini.
