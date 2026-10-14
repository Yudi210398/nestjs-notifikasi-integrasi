import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { NotificationLogPrismaService } from "../prisma/notification-log-prisma.service";
import { FonnteWhatsappService } from "./services/fonnte-whatsapp.service";
import { InternalApiKeyGuard } from "./guards/internal-api-key.guard";
import { LegacyReadRepository } from "./repositories/legacy-read.repository";
import { NotificationDeliveryService } from "./services/notification-delivery.service";
import { NotificationLogRepository } from "./repositories/notification-log.repository";
import { NotificationService } from "./services/notification.service";
import { OrderReadyTriggerController } from "./controllers/order-ready-trigger.controller";
import { OrderReadyTriggerService } from "./services/order-ready-trigger.service";
import { FittingReminderScheduler } from "./schedulers/fitting-reminder.scheduler";

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
    FittingReminderScheduler,
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
