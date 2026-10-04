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

These flows describe the planned architecture. They are not implemented in N-003.

## Module Responsibilities

- `AppModule`: root module and application composition.
- `HealthModule`: health endpoint.
- `NotificationModule`: boundary for notification business logic in a later task.
- `main.ts`: application bootstrap, Swagger setup, and HTTP listen.
- `ConfigModule`: global environment configuration.
- `PrismaModule`: provides the local read-only Prisma connection.
- `PrismaService`: connects when local `DB_*` values are configured and reads the table count from `information_schema` at startup.

## Important Design Rules

- The legacy database is the source of truth.
- Do not casually update or delete legacy customer, fitting, or order records.
- Never hardcode credentials or secrets.
- NestJS uses a MySQL user granted `SELECT` only; the Docker root credential is reserved for local dump import.
- Do not add technology without a concrete requirement.
- Future notification business logic belongs in `NotificationService`, not a controller.

## Current Implementation Status

Implemented:

- Application bootstrap
- `ConfigModule`
- `NotificationModule` placeholder
- `HealthModule`
- Swagger
- Local MySQL 8 Compose setup and read-only database user initialization
- Prisma MySQL configuration and NestJS `PrismaModule` / `PrismaService`
- Prisma models introspected from the imported local legacy dump
- Startup read of local database table metadata when credentials are configured

Not implemented:

- Legacy repository or queries against customer, fitting, or order tables
- Fonnte integration
- Notification logic
- Idempotency
- Scheduler
- PHP order-ready event
- NestJS containerization
