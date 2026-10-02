import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaClient } from "@prisma/client";
import { databaseUrlFromEnv } from "./database-url";

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private readonly databaseConfigured: boolean;

  constructor(configService: ConfigService) {
    const databaseUrl = databaseUrlFromEnv({
      DB_HOST: configService.get<string>("DB_HOST"),
      DB_PORT: configService.get<string>("DB_PORT"),
      DB_NAME: configService.get<string>("DB_NAME"),
      DB_USER: configService.get<string>("DB_USER"),
      DB_PASSWORD: configService.get<string>("DB_PASSWORD"),
    });

    super(databaseUrl ? { datasourceUrl: databaseUrl } : {});
    this.databaseConfigured = Boolean(databaseUrl);
  }

  async onModuleInit(): Promise<void> {
    if (!this.databaseConfigured) {
      this.logger.warn(
        "Local database is not configured; skipping Prisma connection.",
      );
      return;
    }

    await this.$connect();

    const tables = await this.$queryRaw<Array<{ tableCount: bigint }>>`
      SELECT COUNT(*) AS tableCount
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
    `;
    const tableCount = Number(tables[0]?.tableCount ?? 0);

    if (tableCount === 0) {
      this.logger.warn(
        "Local database is empty; import the legacy SQL dump before introspection.",
      );
    } else {
      this.logger.log(
        `Local legacy database is readable (${tableCount} tables).`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
