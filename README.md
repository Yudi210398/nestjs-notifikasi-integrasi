# WhatsApp Notification Service

## Purpose

This NestJS service is an addition to the existing PHP application. The existing database remains the source of truth, and NestJS does not replace PHP.

## Current Scope

N-002 provides the NestJS scaffold, configuration, health endpoint, and Swagger. N-003 adds a local MySQL 8 setup and Prisma for read-only access to an imported legacy database. The legacy schema is not included in this repository; Prisma models must come from `prisma db pull` after importing the real dump. Fonnte and notification logic are not implemented.

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

`PORT` selects the HTTP port and defaults to `3000`. `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD` configure the local read-only MySQL connection. Fill `DB_PASSWORD` before using Prisma. The N-003 connection accepts only loopback hosts (`127.0.0.1`, `localhost`, or `::1`) to avoid reaching a remote database. `FONNTE_TOKEN` and `INTERNAL_API_KEY` remain unused.

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

N-003 prepares local database access, but the planned notification flow remains unimplemented. See [docs/architecture.md](docs/architecture.md) for the planned runtime flows and module responsibilities.

## Scope Boundaries

This MVP does not require a frontend, dashboard, Redis, BullMQ, Kafka, RabbitMQ, new user authentication, analytics, or additional microservices.
