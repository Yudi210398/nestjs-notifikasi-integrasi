import { isIP } from "node:net";

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
  const unbracketedHost =
    host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  const ipv6 = isIP(unbracketedHost) === 6;
  const hostname =
    host.length <= 253 &&
    /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(
      host,
    ) &&
    (!/^[0-9.]+$/.test(host) || isIP(host) === 4);
  if (!ipv6 && !hostname) {
    throw new Error("DB_HOST must be a valid hostname or IP address.");
  }

  const port = Number(environment.DB_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("DB_PORT must be an integer from 1 to 65535.");
  }

  const urlHost = ipv6 ? `[${unbracketedHost}]` : host;
  const url = new URL(`mysql://${urlHost}:${port}`);
  url.username = environment.DB_USER!;
  url.password = environment.DB_PASSWORD!;
  url.pathname = `/${encodeURIComponent(environment.DB_NAME!)}`;

  return url.toString();
}
