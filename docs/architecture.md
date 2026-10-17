# Architecture

## System Context

The existing PHP application remains the primary application. Its database remains the source of truth. NestJS is an additional service for WhatsApp notifications and does not replace PHP.

## Runtime Flow

Fitting:

```text
Scheduler
→ Legacy DB
→ NotificationService
→ NotificationDeliveryService / notification_log claim
→ Fonnte (provider handles WhatsApp delivery)
→ notification_log final status (provider request outcome)
```

Order ready preferred:

```text
PHP Event
→ NestJS
→ Legacy DB
→ NotificationService
→ NotificationDeliveryService / notification_log claim
→ Fonnte (provider handles WhatsApp delivery)
→ notification_log final status (provider request outcome)
```

N-008A implements the authenticated NestJS order-ready endpoint. N-008B implements fitting reminder scheduling. PHP-side event integration remains future work.

## Module Responsibilities

- `AppModule`: root module and application composition.
- `HealthModule`: health endpoint.
- `NotificationModule`: provides the legacy read repository and `NotificationService`.
- `NotificationService`: reads through `LegacyReadRepository` and returns READY candidates or SKIP reasons without sending messages.
- `FittingReminderScheduler`: when enabled, scans eligible fittings from 11:00 through 20:30 Asia/Jakarta, builds their message, and delegates delivery to N-007.
- `FonnteWhatsappService`: sends caller-provided phone and message through Fonnte and reports accepted, rejected, or uncertain outcomes.
- `NotificationLogRepository`: atomically claims a unique notification identity as PENDING and persists final status or explicit SKIPPED reason.
- `NotificationDeliveryService`: for a READY candidate and caller-provided message, claims before calling Fonnte and maps its result to the log. It never retries.
- `NotificationLogPrismaService`: separate writer connection, configured with `NOTIFICATION_DB_*`; it must not fall back to the legacy reader credential.
- `main.ts`: application bootstrap, Swagger setup, and HTTP listen.
- `ConfigModule`: global environment configuration.
- `PrismaModule`: provides the read-only legacy Prisma connection.
- `PrismaService`: connects when `DB_*` values are configured and reads the table count from `information_schema` at startup.
- `LegacyReadRepository`: reads the required customer, order, and fitting fields with explicit Prisma selects. Missing records return `null`.

## N-004 Legacy Reads

`LegacyReadRepository` is provided by `NotificationModule` and offers `findCustomerById`, `findOrderById`, `findCategoryById`, and `findFittingById`. An order's `category_id` can be passed to `findCategoryById` to read `tbl_category.category_nama` from the source of truth. Fitting lookup reads `tbl_fitting.order_id`, then `tbl_order` for `tgl_coba` and `pelanggan_id`. A caller can use `findCustomerById` with that `pelanggan_id` when customer contact data is needed. If the fitting or its order is missing, fitting lookup returns `null`.

The introspected schema has no Prisma relation between these three tables because the corresponding foreign keys are absent from the legacy database. These lookups therefore use the ID fields explicitly and do not change the Prisma schema or database. The repository returns status strings unchanged.

## N-005 Notification Preparation

`prepareOrderReadyNotification(orderId)` returns READY only when `order_status` is exactly `Selesai`, the customer exists with a nonblank phone, and the category exists. The candidate contains customer and category data read from the legacy database. Other cases return SKIP with a specific reason.

`prepareFittingReminder(fittingId, forDate)` reads the fitting/order again and requires a matching MySQL DATE and exactly NULL fitting status. It reads customer and category from the legacy database and returns the category name in the fitting candidate. Missing fitting/order/date returns `FITTING_DATA_INCOMPLETE`; other fitting reasons include `FITTING_NOT_PENDING`, `FITTING_NOT_DUE`, `CUSTOMER_NOT_FOUND`, `PHONE_MISSING`, and `CATEGORY_NOT_FOUND`. Clock and cron concerns remain in the scheduler. Preparation never sends or writes logs.

## N-006 Fonnte Transport

`FonnteWhatsappService.send(phone, message)` posts `target` and `message` to Fonnte with the device token from `FONNTE_TOKEN`. It forwards the phone unchanged; Fonnte documents a default `countryCode` of `62` when that optional parameter is omitted, so final phone-format policy remains undecided. `SUCCESS` means Fonnte explicitly accepted the request into its queue, not that WhatsApp delivery is confirmed. Explicit provider rejection returns `DEFINITE_FAILURE`. Timeout, network interruption, or an unconfirmed response returns `AMBIGUOUS`; the service never retries automatically because the request may already have been accepted. A missing token raises a configuration error before any HTTP call. The service does not read the legacy database, log message content, or persist outcomes.

## N-007 Idempotent Delivery

For a READY candidate, `NotificationDeliveryService.deliver(candidate, message)` builds `ORDER_READY:<orderId>` or `FITTING:<fittingId>`, then asks `NotificationLogRepository` to INSERT PENDING. The database UNIQUE index on `notification_key` is the final concurrency guard. P2002 means duplicate; every existing status blocks automatic send. Other claim errors stop delivery. No application-level pre-read is used as the guard.

After the PENDING insert commits, delivery calls Fonnte once. SUCCESS becomes SENT, DEFINITE_FAILURE becomes FAILED with reason, and AMBIGUOUS becomes AMBIGUOUS with reason. `recordSkipped` can explicitly create SKIPPED with reason, but N-007 does not persist N-005 SKIP results automatically. In particular, ORDER_NOT_READY must not consume an order's notification identity before it becomes ready.

The HTTP request runs outside any DB transaction. A crash after claim can leave PENDING; a successful provider response followed by DB update failure can also leave PENDING. An unexpected transport exception likewise leaves PENDING. All of these block automatic resend and need future manual reconciliation. FAILED and AMBIGUOUS do not trigger retries. This accepts possible missed notifications to avoid duplicate WhatsApp messages.

The new `notification_log` table belongs to NestJS, in the same MySQL schema as legacy data but without relations to it. `DB_USER` retains SELECT-only rights. The dedicated writer has SELECT/INSERT/UPDATE/DELETE on this table only; DELETE supports integration test cleanup. No legacy business table is written. No phone, message text, or Fonnte token is stored in the log.

## Important Design Rules

- The legacy database is the source of truth.
- Do not casually update or delete legacy customer, fitting, or order records.
- Never hardcode credentials or secrets.
- Legacy reads use a MySQL user granted `SELECT` only; the separate notification writer is scoped to `notification_log`. Docker root is reserved for local provisioning and dump import.
- Do not add technology without a concrete requirement.
- Notification business logic belongs in `NotificationService`, not a controller.

## Current Implementation Status

Implemented:

- Application bootstrap
- `ConfigModule`
- `NotificationModule` and `NotificationService` preparation methods
- `FonnteWhatsappService` transport with mocked HTTP unit tests
- `HealthModule`
- Swagger
- Local MySQL 8 Compose setup and read-only database user initialization
- Optional local NestJS container (`app` Compose profile); it uses the existing MySQL service over the Compose network
- Prisma MySQL configuration and NestJS `PrismaModule` / `PrismaService`
- Prisma models introspected from the imported local legacy dump
- Startup read of local database table metadata when credentials are configured
- N-004 read-only customer, order, category, and fitting repository queries with unit tests
- N-007 NotificationLog schema, atomic claim, status updates, explicit SKIPPED capability, and delivery orchestration
- N-008A internal order-ready endpoint, API key guard, message construction, and delivery trigger
- N-008B fitting reminder scheduler with Jakarta calendar selection, startup catch-up, and N-007 delivery

Not implemented:

- PHP-side order-ready event call
- Production server deployment and PHP-side network integration

## N-010 Local Docker Boundary

The `app` Compose profile packages NestJS for local verification. It uses `DB_HOST=mysql`, separate reader/writer credentials, and the already-provisioned local `notification_log`. It forces `FITTING_REMINDER_ENABLED=false` and omits the real Fonnte token. The image contains compiled JavaScript and the generated Prisma Client; secrets are injected at runtime. `/health` is HTTP liveness only, while both database connections are checked during startup.

Production must run the NestJS container against the existing company MySQL over a private address. This repository's MySQL Compose service and root provisioning script are for local development. A DBA provisions `notification_log` and restricted grants separately; NestJS runtime does not migrate legacy tables. Limit `/docs` and the internal endpoint through network controls. Production server access, grants, PHP trigger wiring, and a controlled live Fonnte check remain unverified.

## N-008A Internal Order Ready Trigger

`POST /internal/notifications/order-ready` menerima hanya `orderId`
setelah guard memverifikasi Bearer `INTERNAL_API_KEY`. Controller memvalidasi
input; `OrderReadyTriggerService` memanggil `NotificationService` yang
membaca ulang legacy DB melalui `LegacyReadRepository`. Kandidat READY
menghasilkan pesan sederhana dari nama customer dan category, lalu
`NotificationDeliveryService` melakukan claim unik, panggilan Fonnte,
dan finalisasi `notification_log`.

SKIP selain `PHONE_MISSING` dikembalikan tanpa klaim key. `PHONE_MISSING`
dicatat dengan `recordSkipped`; konflik key menjadi `DUPLICATE`.
Hasil bisnis memakai HTTP 200 agar PHP tidak mengulang otomatis hasil
`FAILED` atau `AMBIGUOUS`. Kesalahan sebelum outcome pasti diketahui
tetap error server. Endpoint order-ready tidak melakukan retry atau perubahan
pada tabel bisnis legacy.

## N-008B Fitting Reminder Scheduler

`ScheduleModule.forRoot()` didaftarkan sekali di `AppModule`.
`FittingReminderScheduler` hanya scan jika `FITTING_REMINDER_ENABLED` bernilai
persis `true`; env tidak ada atau nilai lain membuatnya disabled. Saat enabled,
scan berjalan pada application bootstrap dan cron `0 0,30 11-20 * * *` dengan
`timeZone: Asia/Jakarta`. Window inklusif menit 11:00-20:30; mulai 20:31
tidak scan. Sebelum klaim kandidat, scheduler memeriksa ulang tanggal, waktu,
dan switch. Flag lokal mencegah
overlap scan pada satu instance; UNIQUE `notification_log` tetap menjadi
pengaman final untuk beberapa instance.

`Intl.DateTimeFormat` dengan timezone Jakarta menentukan tahun, bulan, hari,
jam, dan menit sekarang. Hari tersebut diwakili sebagai UTC midnight untuk kolom
Prisma `DateTime @db.Date`; ini nilai kalender, bukan waktu event UTC.
Repository memilih ID order dengan `tgl_coba` tepat tanggal tersebut lalu
ID fitting dengan `order_id` terkait dan `fitting_status: null`. Ketiadaan
foreign key tidak memerlukan perubahan schema. Preparation membaca ulang
tanggal/status sebelum membuat kandidat. Scan yang melewati tengah malam
Jakarta atau melewati 20:30 berhenti sebelum claim kandidat berikutnya.

Kandidat READY dikirim secara berurutan melalui `NotificationDeliveryService`.
Nomor kosong dicatat SKIPPED melalui `recordSkipped` pada `FITTING:<id>`;
SKIP lain tidak dicatat permanen. Gagal scan/read/claim tidak melakukan send
untuk fitting itu. Error satu fitting tidak menghentikan fitting lain, dan log
error hanya memuat kode pesan umum serta fitting ID, tanpa PII atau exception raw.

SENT/FAILED/AMBIGUOUS tetap mengikuti N-006/N-007. Crash setelah PENDING
atau gagal final-status write dapat meninggalkan PENDING dan memblokir resend.
Fitting kemarin tidak diproses setelah downtime melewati hari Jakarta.
Production flow hanya INSERT/UPDATE `notification_log`; integration test
membersihkan hanya row sintetisnya dengan DELETE.
