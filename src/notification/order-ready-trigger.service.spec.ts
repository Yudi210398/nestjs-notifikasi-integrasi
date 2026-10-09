import { NotificationDeliveryService } from "./notification-delivery.service";
import { NotificationLogRepository } from "./notification-log.repository";
import { NotificationService } from "./notification.service";
import { OrderReadyTriggerService } from "./order-ready-trigger.service";

const candidate = {
  type: "ORDER_READY" as const,
  sourceId: 123,
  orderId: 123,
  customerId: 7,
  customerName: "Budi",
  phone: "test-phone",
  categoryName: "Jas",
};

function setup() {
  const notification = {
    prepareOrderReadyNotification: jest.fn().mockResolvedValue({
      decision: "READY",
      candidate,
    }),
  };
  const delivery = {
    deliver: jest.fn().mockResolvedValue({ outcome: "SUCCESS" }),
  };
  const log = {
    recordSkipped: jest.fn().mockResolvedValue({ recorded: true, id: 1 }),
  };
  const service = new OrderReadyTriggerService(
    notification as unknown as NotificationService,
    delivery as unknown as NotificationDeliveryService,
    log as unknown as NotificationLogRepository,
  );
  return { service, notification, delivery, log };
}

describe("OrderReadyTriggerService", () => {
  it("menyiapkan order lalu mengirim pesan dari data legacy sekali", async () => {
    const { service, notification, delivery } = setup();

    await expect(service.trigger(123)).resolves.toEqual({ outcome: "SENT" });
    expect(notification.prepareOrderReadyNotification).toHaveBeenCalledWith(
      123,
    );
    expect(delivery.deliver).toHaveBeenCalledTimes(1);
    expect(delivery.deliver).toHaveBeenCalledWith(
      candidate,
      "Halo Budi, hari ini Jas sudah bisa diambil, terima kasih.",
    );
  });

  it.each([
    "ORDER_NOT_FOUND",
    "ORDER_NOT_READY",
    "CUSTOMER_NOT_FOUND",
    "CATEGORY_NOT_FOUND",
  ])("SKIP %s tidak memakai key dan tidak mengirim", async (reason) => {
    const { service, notification, delivery, log } = setup();
    notification.prepareOrderReadyNotification.mockResolvedValue({
      decision: "SKIP",
      reason,
    });

    await expect(service.trigger(123)).resolves.toEqual({
      outcome: "SKIPPED",
      reason,
    });
    expect(log.recordSkipped).not.toHaveBeenCalled();
    expect(delivery.deliver).not.toHaveBeenCalled();
  });

  it("PHONE_MISSING pada order Selesai dicatat SKIPPED tanpa mengirim", async () => {
    const { service, notification, delivery, log } = setup();
    notification.prepareOrderReadyNotification.mockResolvedValue({
      decision: "SKIP",
      reason: "PHONE_MISSING",
    });

    await expect(service.trigger(123)).resolves.toEqual({
      outcome: "SKIPPED",
      reason: "PHONE_MISSING",
    });
    expect(log.recordSkipped).toHaveBeenCalledWith({
      notificationKey: "ORDER_READY:123",
      type: "ORDER_READY",
      sourceId: 123,
      reason: "PHONE_MISSING",
    });
    expect(delivery.deliver).not.toHaveBeenCalled();
  });

  it("PHONE_MISSING yang sudah tercatat menjadi DUPLICATE", async () => {
    const { service, notification, delivery, log } = setup();
    notification.prepareOrderReadyNotification.mockResolvedValue({
      decision: "SKIP",
      reason: "PHONE_MISSING",
    });
    log.recordSkipped.mockResolvedValue({ recorded: false });

    await expect(service.trigger(123)).resolves.toEqual({
      outcome: "DUPLICATE",
    });
    expect(delivery.deliver).not.toHaveBeenCalled();
  });

  it.each([
    ["DUPLICATE", "DUPLICATE"],
    ["DEFINITE_FAILURE", "FAILED"],
    ["AMBIGUOUS", "AMBIGUOUS"],
  ] as const)(
    "delivery %s menjadi response %s tanpa retry",
    async (deliveryOutcome, outcome) => {
      const { service, delivery } = setup();
      delivery.deliver.mockResolvedValue({ outcome: deliveryOutcome });

      await expect(service.trigger(123)).resolves.toEqual({ outcome });
      expect(delivery.deliver).toHaveBeenCalledTimes(1);
    },
  );

  it("gagal claim DB tidak mencoba delivery ulang", async () => {
    const { service, delivery } = setup();
    delivery.deliver.mockRejectedValue(new Error("database unavailable"));

    await expect(service.trigger(123)).rejects.toThrow("database unavailable");
    expect(delivery.deliver).toHaveBeenCalledTimes(1);
  });
});
