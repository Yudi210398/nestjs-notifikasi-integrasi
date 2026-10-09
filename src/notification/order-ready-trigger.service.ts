import { Injectable } from "@nestjs/common";
import { NotificationDeliveryService } from "./notification-delivery.service";
import { NotificationLogRepository } from "./notification-log.repository";
import { NotificationService } from "./notification.service";

export type OrderReadyTriggerResult =
  | { outcome: "SENT" | "DUPLICATE" | "FAILED" | "AMBIGUOUS" }
  | {
      outcome: "SKIPPED";
      reason:
        | "ORDER_NOT_FOUND"
        | "ORDER_NOT_READY"
        | "CUSTOMER_NOT_FOUND"
        | "PHONE_MISSING"
        | "CATEGORY_NOT_FOUND";
    };

@Injectable()
export class OrderReadyTriggerService {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly deliveryService: NotificationDeliveryService,
    private readonly logRepository: NotificationLogRepository,
  ) {}

  async trigger(orderId: number): Promise<OrderReadyTriggerResult> {
    const preparation =
      await this.notificationService.prepareOrderReadyNotification(orderId);

    if (preparation.decision === "SKIP") {
      if (preparation.reason === "PHONE_MISSING") {
        const result = await this.logRepository.recordSkipped({
          notificationKey: `ORDER_READY:${orderId}`,
          type: "ORDER_READY",
          sourceId: orderId,
          reason: "PHONE_MISSING",
        });
        return result.recorded
          ? { outcome: "SKIPPED", reason: "PHONE_MISSING" }
          : { outcome: "DUPLICATE" };
      }
      if (preparation.reason === "FITTING_DATA_INCOMPLETE") {
        throw new Error("Unexpected fitting result for order trigger");
      }
      return { outcome: "SKIPPED", reason: preparation.reason };
    }

    const candidate = preparation.candidate;
    if (candidate.type !== "ORDER_READY") {
      throw new Error("Unexpected fitting candidate for order trigger");
    }

    const message = `Halo ${candidate.customerName}, hari ini ${candidate.categoryName} sudah bisa diambil, terima kasih.`;
    const delivery = await this.deliveryService.deliver(candidate, message);
    switch (delivery.outcome) {
      case "SUCCESS":
        return { outcome: "SENT" };
      case "DUPLICATE":
        return { outcome: "DUPLICATE" };
      case "DEFINITE_FAILURE":
        return { outcome: "FAILED" };
      case "AMBIGUOUS":
        return { outcome: "AMBIGUOUS" };
    }
  }
}
