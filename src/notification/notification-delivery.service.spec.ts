import { FonnteWhatsappService } from "./fonnte-whatsapp.service";
import { NotificationDeliveryService } from "./notification-delivery.service";
import { NotificationLogRepository } from "./notification-log.repository";
import { NotificationCandidate } from "./notification.service";

const orderCandidate: NotificationCandidate = {
  type: "ORDER_READY",
  sourceId: 123,
  orderId: 123,
  customerId: 8,
  customerName: "Contoh",
  phone: "test-phone",
  categoryName: "Jas",
};

const fittingCandidate: NotificationCandidate = {
  type: "FITTING_REMINDER",
  sourceId: 456,
  orderId: 123,
  customerId: 8,
  customerName: "Contoh",
  phone: "test-phone",
  fittingDate: new Date("2026-10-10"),
};

function setup() {
  const repository = {
    claimPending: jest.fn().mockResolvedValue({ claimed: true, id: 1 }),
    markSent: jest.fn().mockResolvedValue(undefined),
    markFailed: jest.fn().mockResolvedValue(undefined),
    markAmbiguous: jest.fn().mockResolvedValue(undefined),
  };
  const fonnte = {
    send: jest.fn().mockResolvedValue({
      outcome: "SUCCESS",
      providerMessageIds: [],
    }),
  };
  const service = new NotificationDeliveryService(
    repository as unknown as NotificationLogRepository,
    fonnte as unknown as FonnteWhatsappService,
  );
  return { service, repository, fonnte };
}

describe("NotificationDeliveryService", () => {
  it("mengklaim ORDER_READY:123 sebelum mengirim sekali dan menyimpan SENT", async () => {
    const { service, repository, fonnte } = setup();

    await expect(
      service.deliver(orderCandidate, "test-message"),
    ).resolves.toEqual({
      outcome: "SUCCESS",
    });

    expect(repository.claimPending).toHaveBeenCalledWith({
      notificationKey: "ORDER_READY:123",
      type: "ORDER_READY",
      sourceId: 123,
    });
    expect(fonnte.send).toHaveBeenCalledTimes(1);
    expect(fonnte.send).toHaveBeenCalledWith("test-phone", "test-message");
    expect(repository.markSent).toHaveBeenCalledWith(1);
    expect(repository.claimPending.mock.invocationCallOrder[0]).toBeLessThan(
      fonnte.send.mock.invocationCallOrder[0],
    );
  });

  it("menggunakan identity FITTING:<fittingId>", async () => {
    const { service, repository } = setup();

    await service.deliver(fittingCandidate, "test-message");

    expect(repository.claimPending).toHaveBeenCalledWith({
      notificationKey: "FITTING:456",
      type: "FITTING_REMINDER",
      sourceId: 456,
    });
  });

  it("duplicate key berhenti sebelum memanggil Fonnte", async () => {
    const { service, repository, fonnte } = setup();
    repository.claimPending.mockResolvedValue({ claimed: false });

    await expect(
      service.deliver(orderCandidate, "test-message"),
    ).resolves.toEqual({
      outcome: "DUPLICATE",
    });
    expect(fonnte.send).not.toHaveBeenCalled();
  });

  it("DEFINITE_FAILURE menyimpan FAILED beserta reason", async () => {
    const { service, repository, fonnte } = setup();
    fonnte.send.mockResolvedValue({
      outcome: "DEFINITE_FAILURE",
      reason: "PROVIDER_REJECTED",
    });

    await expect(
      service.deliver(orderCandidate, "test-message"),
    ).resolves.toEqual({
      outcome: "DEFINITE_FAILURE",
    });
    expect(repository.markFailed).toHaveBeenCalledWith(1, "PROVIDER_REJECTED");
    expect(fonnte.send).toHaveBeenCalledTimes(1);
  });

  it("AMBIGUOUS menyimpan reason dan tidak retry", async () => {
    const { service, repository, fonnte } = setup();
    fonnte.send.mockResolvedValue({
      outcome: "AMBIGUOUS",
      reason: "NETWORK_ERROR",
    });

    await expect(
      service.deliver(orderCandidate, "test-message"),
    ).resolves.toEqual({
      outcome: "AMBIGUOUS",
    });
    expect(repository.markAmbiguous).toHaveBeenCalledWith(1, "NETWORK_ERROR");
    expect(fonnte.send).toHaveBeenCalledTimes(1);
  });

  it("gagal claim database tidak memanggil Fonnte", async () => {
    const { service, repository, fonnte } = setup();
    repository.claimPending.mockRejectedValue(
      new Error("database unavailable"),
    );

    await expect(
      service.deliver(orderCandidate, "test-message"),
    ).rejects.toThrow("database unavailable");
    expect(fonnte.send).not.toHaveBeenCalled();
  });

  it("gagal menyimpan SENT tidak mengirim ulang", async () => {
    const { service, repository, fonnte } = setup();
    repository.markSent.mockRejectedValue(new Error("database unavailable"));

    await expect(
      service.deliver(orderCandidate, "test-message"),
    ).rejects.toThrow("database unavailable");
    expect(fonnte.send).toHaveBeenCalledTimes(1);
  });

  it("transport exception meninggalkan PENDING tanpa retry", async () => {
    const { service, repository, fonnte } = setup();
    fonnte.send.mockRejectedValue(new Error("transport exception"));

    await expect(
      service.deliver(orderCandidate, "test-message"),
    ).rejects.toThrow("transport exception");
    expect(fonnte.send).toHaveBeenCalledTimes(1);
    expect(repository.markSent).not.toHaveBeenCalled();
    expect(repository.markFailed).not.toHaveBeenCalled();
    expect(repository.markAmbiguous).not.toHaveBeenCalled();
  });

  it("menolak order candidate dengan sourceId berbeda dari orderId", async () => {
    const { service, repository, fonnte } = setup();

    await expect(
      service.deliver({ ...orderCandidate, sourceId: 999 }, "test-message"),
    ).rejects.toThrow("Order candidate sourceId must match orderId");
    expect(repository.claimPending).not.toHaveBeenCalled();
    expect(fonnte.send).not.toHaveBeenCalled();
  });
});
