# Architecture

## System Context

The existing PHP application remains the primary application. Its database remains the source of truth. NestJS is an additional service for WhatsApp notifications and does not replace PHP.

## Planned Runtime Flow

Fitting:

```text
Scheduler
→ Legacy DB
→ NotificationService
→ Fonnte
→ WhatsApp Customer
```

Order ready preferred:

```text
PHP Event
→ NestJS
→ Legacy DB
→ NotificationService
→ Fonnte
→ WhatsApp Customer
```

N-008A implements the authenticated NestJS order-ready endpoint. PHP integration and the fitting scheduler remain future work.

## Module Responsibilities

- `AppModule`: root module and application composition.
- `HealthModule`: health endpoint.
- `NotificationModule`: provides the legacy read repository and `NotificationService`.
- `NotificationService`: reads through `LegacyReadRepository` and returns READY candidates or SKIP reasons without sending messages.
- `FonnteWhatsappService`: sends caller-provided phone and message through Fonnte and reports accepted, rejected, or uncertain outcomes.
- `NotificationLogRepository`: atomically claims a unique notification identity as PENDING and persists final status or explicit SKIPPED reason.
- `NotificationDeliveryService`: for a READY candidate and caller-provided message, claims before calling Fonnte and maps its result to the log. It never retries.
- `NotificationLogPrismaService`: separate writer connection, configured with `NOTIFICATION_DB_*`; it must not fall back to the legacy reader credential.
- `main.ts`: application bootstrap, Swagger setup, and HTTP listen.
- `ConfigModule`: global environment configuration.
- `PrismaModule`: provides the local read-only Prisma connection.
- `PrismaService`: connects when local `DB_*` values are configured and reads the table count from `information_schema` at startup.
- `LegacyReadRepository`: reads the required customer, order, and fitting fields with explicit Prisma selects. Missing records return `null`.

## N-004 Legacy Reads

`LegacyReadRepository` is provided by `NotificationModule` and offers `findCustomerById`, `findOrderById`, `findCategoryById`, and `findFittingById`. An order's `category_id` can be passed to `findCategoryById` to read `tbl_category.category_nama` from the source of truth. Fitting lookup reads `tbl_fitting.order_id`, then `tbl_order` for `tgl_coba` and `pelanggan_id`. A caller can use `findCustomerById` with that `pelanggan_id` when customer contact data is needed. If the fitting or its order is missing, fitting lookup returns `null`.

The introspected schema has no Prisma relation between these three tables because the corresponding foreign keys are absent from the legacy database. These lookups therefore use the ID fields explicitly and do not change the Prisma schema or database. The repository returns status strings unchanged.

## N-005 Notification Preparation

`prepareOrderReadyNotification(orderId)` returns READY only when `order_status` is exactly `Selesai`, the customer exists with a nonblank phone, and the category exists. The candidate contains customer and category data read from the legacy database. Other cases return SKIP with a specific reason.

`prepareFittingReminder(fittingId)` returns READY when the fitting has an order with `tgl_coba` and a customer with a nonblank phone. It does not decide when the reminder is due or interpret `fitting_status`. The repository returns `null` for both missing fittings and fittings whose order is missing, so both produce `FITTING_DATA_INCOMPLETE`; this result cannot distinguish those cases. No message text, provider call, persistence, retry, or duplicate protection is part of N-005.

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
- Prisma MySQL configuration and NestJS `PrismaModule` / `PrismaService`
- Prisma models introspected from the imported local legacy dump
- Startup read of local database table metadata when credentials are configured
- N-004 read-only customer, order, category, and fitting repository queries with unit tests
- N-007 NotificationLog schema, atomic claim, status updates, explicit SKIPPED capability, and delivery orchestration
- N-008A internal order-ready endpoint, API key guard, message construction, and delivery trigger

Not implemented:

- Scheduler
- PHP-side order-ready event call
- NestJS containerization

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
tetap error server. Tidak ada scheduler fitting, retry, atau perubahan
pada tabel bisnis legacy.
