import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { NotificationLogPrismaService } from "../prisma/notification-log-prisma.service";
import { FonnteWhatsappService } from "./fonnte-whatsapp.service";
import { InternalApiKeyGuard } from "./internal-api-key.guard";
import { LegacyReadRepository } from "./legacy-read.repository";
import { NotificationDeliveryService } from "./notification-delivery.service";
import { NotificationLogRepository } from "./notification-log.repository";
import { NotificationService } from "./notification.service";
import { OrderReadyTriggerController } from "./order-ready-trigger.controller";
import { OrderReadyTriggerService } from "./order-ready-trigger.service";

@Module({
  imports: [PrismaModule],
  controllers: [OrderReadyTriggerController],
  providers: [
    LegacyReadRepository,
    NotificationService,
    FonnteWhatsappService,
    NotificationLogPrismaService,
    NotificationLogRepository,
    NotificationDeliveryService,
    OrderReadyTriggerService,
    InternalApiKeyGuard,
  ],
  exports: [
    LegacyReadRepository,
    NotificationService,
    FonnteWhatsappService,
    NotificationLogRepository,
    NotificationDeliveryService,
  ],
})
export class NotificationModule {}
