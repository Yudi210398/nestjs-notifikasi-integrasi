# WhatsApp Notification Service

## Purpose

This NestJS service is an addition to the existing PHP application. The existing database remains the source of truth, and NestJS does not replace PHP.

## Current Scope

N-002 provides the NestJS scaffold, configuration, health endpoint, and Swagger. N-003 adds a local MySQL 8 setup and Prisma for read-only access to an imported legacy database. N-004 adds repository queries for customer, order, category, and fitting records. N-005 adds `NotificationService` to prepare order-ready and fitting-reminder candidates or return SKIP reasons. N-006 adds `FonnteWhatsappService` as a transport for caller-provided phone and message. N-007 adds a NestJS-owned `notification_log` table, atomic claim, and idempotent delivery orchestration. The legacy Prisma models were introspected from the real dump; the dump and its data are not stored in this repository. N-008A adds the authenticated internal order-ready trigger; fitting scheduling remains outside this scope.

## Requirements

- Node.js (the NestJS 11 CLI requires Node.js 20 or newer)
- npm
- Docker with Compose for the local MySQL setup
- A separate legacy SQL dump for database introspection

## Installation

```sh
npm install
```

## Environment

Copy `.env.example` to `.env` and set values as needed:

```sh
cp .env.example .env
```

`PORT` selects the HTTP port and defaults to `3000`. `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD` configure the local read-only MySQL connection. `NOTIFICATION_DB_USER` and `NOTIFICATION_DB_PASSWORD` configure a separate account with rights only on `notification_log`. The N-003 connection accepts only loopback hosts (`127.0.0.1`, `localhost`, or `::1`) to avoid reaching a remote database. `FONNTE_TOKEN` is required when calling `FonnteWhatsappService.send`; `INTERNAL_API_KEY` authenticates the internal order-ready endpoint. Keep tokens out of logs and version control.

For Docker, also copy `.env.docker.example` to `.env.docker` and set `DB_ROOT_PASSWORD` there. Keep the root password out of the NestJS `.env` file. Both local environment files are ignored by Git.

The full MySQL startup, dump import, and Prisma commands are in [docs/local-database.md](docs/local-database.md).

## Run Development

```sh
npm run start:dev
```

## Build

```sh
npm run build
```

## Test

Jest runs TypeScript `*.spec.ts` files placed under `src/` through `ts-jest`, without building `dist/` first. The N-005 business rules are covered by `src/notification/notification.service.spec.ts` with a mocked repository.

```sh
npm test
npm run test:watch
npm run test:cov
```

The existing N-004 CommonJS tests remain unchanged and are excluded from Jest. Run them separately with `npm run test:legacy`; that command still builds `dist/` first. These tests mock Prisma and do not connect to or modify the legacy database.

With local read-only MySQL configured in `.env`, run `npm run test:smoke` to check the repository against real customer, order, fitting, and category records. The smoke test performs only SELECT queries and prints no customer data.

After provisioning `notification_log`, run `npm run test:notification-log:integration` for the MySQL UNIQUE and concurrent delivery checks. Its Fonnte dependency is mocked, so it cannot send WhatsApp. See [docs/local-database.md](docs/local-database.md) for provisioning and cleanup details.

## Production Start

```sh
npm run start:prod
```

## Health Check

`GET /health` returns HTTP 200:

```json
{"status":"ok"}
```

## Swagger

Open `/docs` while the application is running.

## Architecture

Planned flow:

```text
PHP Application / Scheduler
        ↓
NestJS Notification Service
        ↓
Existing Database
        ↓
Fonnte
        ↓
WhatsApp Customer
```

N-005 prepares notification candidates, N-006 provides the Fonnte transport, and N-007 provides idempotent delivery for a READY candidate plus caller-provided message. N-008A invokes delivery only for an authenticated order-ready trigger. Fitting scheduling is not implemented. See [docs/architecture.md](docs/architecture.md) for the runtime flow and module responsibilities.

## Scope Boundaries

This MVP does not require a frontend, dashboard, Redis, BullMQ, Kafka, RabbitMQ, new user authentication, analytics, or additional microservices.

## Internal Order Ready Trigger (N-008A)

PHP dapat memanggil `POST /internal/notifications/order-ready` dengan header
`Authorization: Bearer <INTERNAL_API_KEY>` dan body JSON `{"orderId":123}`.
Hanya satu field `orderId` yang diterima: bilangan bulat positif yang aman.
Jangan kirim status, customer, nomor telepon, category, atau pesan dari PHP.

NestJS membaca ulang order, customer, dan category dari legacy DB. Order hanya
READY jika `order_status` tepat `Selesai`. Respons bisnis menggunakan HTTP 200
dengan `outcome`: `SENT`, `DUPLICATE`, `SKIPPED`, `FAILED`, atau `AMBIGUOUS`.
`SKIPPED` menyertakan `reason` yang aman. `SENT` berarti Fonnte menerima
pesan untuk diproses, bukan konfirmasi pesan sudah sampai di WhatsApp.
Input invalid mendapat 400, auth invalid 401, konfigurasi key kosong 503,
dan kegagalan internal tak terduga mendapat 500 tanpa detail database.

`ORDER_NOT_READY` dan SKIP sementara lain tidak mengonsumsi key.
`PHONE_MISSING` untuk order yang sudah `Selesai` dicatat sebagai
`SKIPPED` dengan key `ORDER_READY:<orderId>`. Key unik pada
`notification_log` mencegah pengiriman ulang, termasuk saat request bersamaan.
PHP tidak boleh melakukan blind retry untuk respons `FAILED` atau
`AMBIGUOUS`. Endpoint tidak mengubah tabel bisnis legacy.
