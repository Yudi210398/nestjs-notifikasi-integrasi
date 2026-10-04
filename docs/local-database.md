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

Keep the dump outside this repository. Inspect it for `CREATE DATABASE`, `USE`, or qualified table names before importing so it cannot select another database. The inspected `php-native-lords.sql` dump has none of those target switches. Replace the example Windows path with its actual path:

```sh
docker compose --env-file .env --env-file .env.docker cp "C:\path\to\php-native-lords.sql" mysql:/tmp/php-native-lords.sql
docker compose --env-file .env --env-file .env.docker exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql --user=root --database="$MYSQL_DATABASE" --init-command="SET SESSION innodb_strict_mode=OFF" --binary-mode=1 < /tmp/php-native-lords.sql'
```

The `php-native-lords.sql` dump needs `innodb_strict_mode=OFF` during import into MySQL 8 because the legacy `tbl_ukuran` definition triggers error 1118 (row size check). The command changes the setting only for the import connection. Do not change the server-wide setting or edit the source dump. A compressed dump must be decompressed first. Do not use the read-only app user for import.

If an import already failed partway through, start again with a fresh **local** volume only after confirming it contains no data to preserve, then rerun the two import commands above:

```sh
docker compose --env-file .env --env-file .env.docker down -v
docker compose --env-file .env --env-file .env.docker up -d mysql
```

Check that the import exits successfully before running Prisma commands. The app's `legacy_reader` account remains SELECT-only.

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
