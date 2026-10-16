import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron } from "@nestjs/schedule";
import { LegacyReadRepository } from "../repositories/legacy-read.repository";
import { NotificationLogRepository } from "../repositories/notification-log.repository";
import { NotificationDeliveryService } from "../services/notification-delivery.service";
import { NotificationService } from "../services/notification.service";

const jakartaFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jakarta",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

@Injectable()
export class FittingReminderScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(FittingReminderScheduler.name);
  private running = false;

  constructor(
    private readonly legacyReadRepository: LegacyReadRepository,
    private readonly notificationService: NotificationService,
    private readonly deliveryService: NotificationDeliveryService,
    private readonly logRepository: NotificationLogRepository,
    private readonly configService: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    void this.run();
  }

  @Cron("0 0,30 11-20 * * *", {
    name: "fitting-reminders",
    timeZone: "Asia/Jakarta",
  })
  async run(): Promise<void> {
    if (this.configService.get<string>("FITTING_REMINDER_ENABLED") !== "true")
      return;
    if (this.running) return;
    this.running = true;

    try {
      const today = this.jakartaNow();
      if (!this.isWithinSendWindow(today)) return;

      const fittings = await this.legacyReadRepository.findDueFittingsForDate(
        today.date,
      );
      for (const fitting of fittings) {
        try {
          const preparation =
            await this.notificationService.prepareFittingReminder(
              fitting.fitting_id,
              today.date,
            );
          const current = this.jakartaNow();
          if (
            this.configService.get<string>("FITTING_REMINDER_ENABLED") !==
              "true" ||
            !this.isWithinSendWindow(current) ||
            current.date.getTime() !== today.date.getTime()
          ) {
            break;
          }

          if (preparation.decision === "SKIP") {
            if (preparation.reason === "PHONE_MISSING") {
              await this.logRepository.recordSkipped({
                notificationKey: `FITTING:${fitting.fitting_id}`,
                type: "FITTING_REMINDER",
                sourceId: fitting.fitting_id,
                reason: "PHONE_MISSING",
              });
            }
            continue;
          }

          const candidate = preparation.candidate;
          const message = `Halo Pak/Bu ${candidate.customerName}, hari ini ada fitting ${candidate.categoryName}. Toko buka jam 11.00 - 20.30. Terima kasih.`;
          await this.deliveryService.deliver(candidate, message);
        } catch {
          this.logger.error(
            `Fitting reminder processing failed for fittingId=${fitting.fitting_id}`,
          );
        }
      }
    } catch {
      this.logger.error("Fitting reminder scan failed");
    } finally {
      this.running = false;
    }
  }

  private jakartaNow() {
    const parts = jakartaFormatter.formatToParts(new Date());
    const value = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === type)?.value);

    // UTC midnight mewakili nilai kalender MySQL DATE, bukan waktu event.
    return {
      date: new Date(Date.UTC(value("year"), value("month") - 1, value("day"))),
      hour: value("hour"),
      minute: value("minute"),
    };
  }

  private isWithinSendWindow(now: { hour: number; minute: number }): boolean {
    return (
      now.hour >= 11 &&
      (now.hour < 20 || (now.hour === 20 && now.minute <= 30))
    );
  }
}
