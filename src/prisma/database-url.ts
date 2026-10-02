const databaseKeys = [
  "DB_HOST",
  "DB_PORT",
  "DB_NAME",
  "DB_USER",
  "DB_PASSWORD",
] as const;

type DatabaseKey = (typeof databaseKeys)[number];
type DatabaseEnvironment = Partial<Record<DatabaseKey, string | undefined>>;

export function databaseUrlFromEnv(
  environment: DatabaseEnvironment,
): string | undefined {
  const configuredKeys = databaseKeys.filter((key) => environment[key]);

  if (configuredKeys.length === 0) {
    return undefined;
  }

  const missingKeys = databaseKeys.filter((key) => !environment[key]);
  if (missingKeys.length > 0) {
    throw new Error(
      `Missing database configuration: ${missingKeys.join(", ")}`,
    );
  }

  const host = environment.DB_HOST!;
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)) {
    throw new Error("DB_HOST must point to local MySQL for N-003.");
  }

  const port = Number(environment.DB_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("DB_PORT must be an integer from 1 to 65535.");
  }

  const localHost = host === "::1" ? "[::1]" : host;
  const url = new URL(`mysql://${localHost}:${port}`);
  url.username = environment.DB_USER!;
  url.password = environment.DB_PASSWORD!;
  url.pathname = `/${encodeURIComponent(environment.DB_NAME!)}`;

  return url.toString();
}
