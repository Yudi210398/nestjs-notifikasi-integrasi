import "dotenv/config";
import { defineConfig } from "prisma/config";
import { databaseUrlFromEnv } from "./src/prisma/database-url";

const databaseUrl = databaseUrlFromEnv(process.env);
if (databaseUrl) {
  process.env.DATABASE_URL = databaseUrl;
}

export default defineConfig({
  schema: "prisma/schema.prisma",
});
