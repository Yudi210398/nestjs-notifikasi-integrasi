import { Injectable } from "@nestjs/common";
import { FonnteWhatsappService } from "./fonnte-whatsapp.service";
import { NotificationLogRepository } from "./notification-log.repository";
import type { NotificationCandidate } from "./notification.service";

export type NotificationDeliveryResult = {
  outcome: "DUPLICATE" | "SUCCESS" | "DEFINITE_FAILURE" | "AMBIGUOUS";
};

@Injectable()
export class NotificationDeliveryService {
  constructor(
    private readonly notificationLogRepository: NotificationLogRepository,
    private readonly fonnteWhatsappService: FonnteWhatsappService,
  ) {}

  async deliver(
    candidate: NotificationCandidate,
    message: string,
  ): Promise<NotificationDeliveryResult> {
    if (!Number.isSafeInteger(candidate.sourceId) || candidate.sourceId <= 0) {
      throw new Error("Notification sourceId must be a positive integer");
    }
    if (
      candidate.type === "ORDER_READY" &&
      candidate.sourceId !== candidate.orderId
    ) {
      throw new Error("Order candidate sourceId must match orderId");
    }

    const notificationKey =
      candidate.type === "ORDER_READY"
        ? `ORDER_READY:${candidate.sourceId}`
        : `FITTING:${candidate.sourceId}`;
    const claim = await this.notificationLogRepository.claimPending({
      notificationKey,
      type: candidate.type,
      sourceId: candidate.sourceId,
    });
    if (!claim.claimed) {
      return { outcome: "DUPLICATE" };
    }

    const result = await this.fonnteWhatsappService.send(
      candidate.phone,
      message,
    );
    switch (result.outcome) {
      case "SUCCESS":
        await this.notificationLogRepository.markSent(claim.id);
        break;
      case "DEFINITE_FAILURE":
        await this.notificationLogRepository.markFailed(
          claim.id,
          result.reason,
        );
        break;
      case "AMBIGUOUS":
        await this.notificationLogRepository.markAmbiguous(
          claim.id,
          result.reason,
        );
        break;
    }
    return { outcome: result.outcome };
  }
}
