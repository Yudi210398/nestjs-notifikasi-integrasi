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

## 5. Provision N-007 NotificationLog

`notification_log` is a new NestJS-owned table in the same MySQL database. It has no foreign keys to legacy tables. Configure `NOTIFICATION_DB_USER=notification_writer` and a separate random **alphanumeric** `NOTIFICATION_DB_PASSWORD` in the ignored `.env` file. Keep `DB_USER` as the existing legacy reader. The passwords must differ. The writer account is granted `SELECT`, `INSERT`, `UPDATE`, and `DELETE` on `notification_log` only. `DELETE` is used by the synthetic integration test cleanup; application delivery only inserts and updates.

For a **new empty local MySQL volume**, Compose runs `docker/mysql/provision-notification-log.sh` at initialization. For the existing local volume, initialization scripts do not run again. Apply the script explicitly after updating the Compose configuration:

```sh
docker compose --env-file .env --env-file .env.docker up -d --no-deps mysql
docker compose --env-file .env --env-file .env.docker exec -T mysql sh /docker-entrypoint-initdb.d/02-notification-log.sh
npx prisma generate
npm run test:notification-log:integration
```

The first command may recreate the local container but preserves the named `mysql_data` volume; it must never use `down -v`. The provisioning script creates only `notification_log` and a separate writer account. It does not alter or delete legacy tables. Do not run `prisma db pull` after adding the manual NotificationLog model unless you review the resulting schema changes; `prisma generate` alone is enough.

The integration test uses synthetic `ORDER_READY:<id>` keys and a mocked Fonnte service. It removes only the rows whose keys it created. It verifies the UNIQUE constraint, two concurrent claims, one provider call, duplicate blocking for every status, and grants without attempting any legacy UPDATE. If the test aborts before cleanup, inspect and remove only its synthetic rows from `notification_log`.

For production, a database administrator should review the same table DDL in `docker/mysql/provision-notification-log.sh`, create the table and dedicated writer account in the target MySQL database, and grant only `SELECT`, `INSERT`, and `UPDATE` on `notification_log`. The local script grants `DELETE` solely for integration test cleanup; runtime delivery never deletes rows. Verify `SHOW GRANTS` for both accounts. Do not give the writer privileges on legacy tables or change the reader's SELECT-only grant. Production deployment and credential distribution are outside N-007.
