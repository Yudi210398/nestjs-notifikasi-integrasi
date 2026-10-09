import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaClient } from "@prisma/client";
import { databaseUrlFromEnv } from "./database-url";

@Injectable()
export class NotificationLogPrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(configService: ConfigService) {
    const writerUser = configService.get<string>("NOTIFICATION_DB_USER");
    const writerPassword = configService.get<string>(
      "NOTIFICATION_DB_PASSWORD",
    );
    if (!writerUser || !writerPassword) {
      throw new Error("Notification log writer credentials are not configured");
    }

    const databaseUrl = databaseUrlFromEnv({
      DB_HOST: configService.get<string>("DB_HOST"),
      DB_PORT: configService.get<string>("DB_PORT"),
      DB_NAME: configService.get<string>("DB_NAME"),
      DB_USER: writerUser,
      DB_PASSWORD: writerPassword,
    });
    super({ datasourceUrl: databaseUrl });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    await this.notificationLog.findFirst({ select: { id: true } });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
