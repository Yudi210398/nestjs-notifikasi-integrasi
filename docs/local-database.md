# Local Legacy Database Setup

Use this setup independently on each development computer. The production database must not be used for N-003.

## 1. Configure local credentials

Copy `.env.example` to `.env` and `.env.docker.example` to `.env.docker`. Fill `DB_PASSWORD` in `.env` and `DB_ROOT_PASSWORD` in `.env.docker` with different local passwords. Adjust `DB_PORT` if port 3306 is occupied. Keep `DB_HOST=127.0.0.1` for the NestJS process running on the host.

The app reads `.env` only. Docker Compose combines both files. The MySQL initialization script creates `DB_USER` with `SELECT` on `DB_NAME` and no write grants. The root password is for local initialization and dump import only.

## 2. Start MySQL

```sh
docker compose --env-file .env --env-file .env.docker up -d mysql
docker compose --env-file .env --env-file .env.docker ps
```

The database files live in the Docker named volume `mysql_data`, outside the repository. Initialization scripts run only when that volume is first created. Changing the database name or credentials later does not re-run the initialization script; use a fresh local volume or update the local MySQL users manually.

## 3. Import the real legacy dump

Keep the dump outside this repository. Replace the example Windows path with the actual path to your `.sql` file:

```sh
docker compose --env-file .env --env-file .env.docker cp "C:\path\to\legacy.sql" mysql:/tmp/legacy.sql
docker compose --env-file .env --env-file .env.docker exec -T mysql sh -c 'mysql --user=root --password="$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE" < /tmp/legacy.sql'
```

Check whether the dump contains its own `CREATE DATABASE` or `USE` statements before importing; it should populate the local `DB_NAME`. A compressed dump must be decompressed first. Do not use the read-only app user for import.

## 4. Introspect and generate the client

After the local database contains the imported legacy tables, stop any running NestJS process before generating the client (Windows can lock the Prisma engine DLL):

```sh
npx prisma db pull
npx prisma validate
npx prisma generate
npm run build
npm run start:dev
```

`prisma db pull` reads the local database schema and writes models into `prisma/schema.prisma`. It does not change the database. `prisma generate` generates the client in `node_modules`. On startup, `PrismaService` connects with the read-only user and logs the number of tables visible in the local database. If the count is zero, the dump has not populated the configured database.

Do not run Prisma migrations or `prisma db push` against the legacy database.
