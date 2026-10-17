import { databaseUrlFromEnv } from "./database-url";

const databaseEnvironment = {
  DB_HOST: "localhost",
  DB_PORT: "3306",
  DB_NAME: "legacy_local",
  DB_USER: "legacy_reader",
  DB_PASSWORD: "local-password",
};

describe("databaseUrlFromEnv", () => {
  it.each([
    ["localhost", "localhost"],
    ["127.0.0.1", "127.0.0.1"],
    ["mysql", "mysql"],
    ["db.internal.company", "db.internal.company"],
    ["10.10.1.5", "10.10.1.5"],
    ["::1", "[::1]"],
    ["2001:db8::1", "[2001:db8::1]"],
    ["[2001:db8::1]", "[2001:db8::1]"],
  ])("accepts DB_HOST %s", (host, urlHost) => {
    const url = databaseUrlFromEnv({ ...databaseEnvironment, DB_HOST: host });

    expect(url).toBe(
      `mysql://legacy_reader:local-password@${urlHost}:3306/legacy_local`,
    );
  });

  it.each([
    "http://mysql",
    "https://mysql",
    "mysql://mysql",
    "user:password@mysql",
    "mysql/path",
    "mysql?query",
    "mysql#fragment",
    "mysql:3306",
    "mysql host",
    " mysql",
    "mysql\n",
    "",
    "999.999.999.999",
    "-mysql",
    "mysql..internal",
  ])("rejects invalid DB_HOST %j", (host) => {
    expect(() =>
      databaseUrlFromEnv({ ...databaseEnvironment, DB_HOST: host }),
    ).toThrow();
  });

  it("retains DB_PORT validation", () => {
    expect(() =>
      databaseUrlFromEnv({ ...databaseEnvironment, DB_PORT: "65536" }),
    ).toThrow("DB_PORT must be an integer from 1 to 65535.");
  });

  it("retains credential URL encoding", () => {
    expect(
      databaseUrlFromEnv({
        ...databaseEnvironment,
        DB_PASSWORD: "p@ss/word",
      }),
    ).toBe("mysql://legacy_reader:p%40ss%2Fword@localhost:3306/legacy_local");
  });
});
