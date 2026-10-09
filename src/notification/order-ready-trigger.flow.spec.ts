import { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { FonnteWhatsappService } from "./fonnte-whatsapp.service";
import { InternalApiKeyGuard } from "./internal-api-key.guard";
import { LegacyReadRepository } from "./legacy-read.repository";
import { NotificationDeliveryService } from "./notification-delivery.service";
import { NotificationLogRepository } from "./notification-log.repository";
import { NotificationService } from "./notification.service";
import { OrderReadyTriggerController } from "./order-ready-trigger.controller";
import { OrderReadyTriggerService } from "./order-ready-trigger.service";

describe("Order ready HTTP flow", () => {
  let app: INestApplication;
  let url: string;
  const legacy = {
    findOrderById: jest.fn().mockResolvedValue({
      order_id: 123,
      pelanggan_id: 7,
      category_id: 9,
      order_status: "Selesai",
    }),
    findCustomerById: jest.fn().mockResolvedValue({
      pelanggan_id: 7,
      pelanggan_nama: "Budi",
      pelanggan_hp: "test-phone",
    }),
    findCategoryById: jest.fn().mockResolvedValue({
      category_id: 9,
      category_nama: "Jas",
    }),
  };
  const log = {
    claimPending: jest.fn(),
    markSent: jest.fn().mockResolvedValue(undefined),
    markFailed: jest.fn().mockResolvedValue(undefined),
    markAmbiguous: jest.fn().mockResolvedValue(undefined),
    recordSkipped: jest.fn(),
  };
  const fonnte = {
    send: jest.fn().mockResolvedValue({
      outcome: "SUCCESS",
      providerMessageIds: [],
    }),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [OrderReadyTriggerController],
      providers: [
        InternalApiKeyGuard,
        NotificationService,
        NotificationDeliveryService,
        OrderReadyTriggerService,
        {
          provide: ConfigService,
          useValue: { get: () => "test-internal-key" },
        },
        { provide: LegacyReadRepository, useValue: legacy },
        { provide: NotificationLogRepository, useValue: log },
        { provide: FonnteWhatsappService, useValue: fonnte },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    await app.listen(0, "127.0.0.1");
    url = `${await app.getUrl()}/internal/notifications/order-ready`;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    log.claimPending
      .mockResolvedValueOnce({ claimed: true, id: 1 })
      .mockResolvedValue({ claimed: false });
  });

  afterAll(async () => {
    await app.close();
  });

  async function post() {
    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-internal-key",
      },
      body: JSON.stringify({ orderId: 123 }),
    });
  }

  it("membaca ulang legacy DB dan duplicate trigger tidak mengirim dua kali", async () => {
    const first = await post();
    const second = await post();

    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ outcome: "SENT" });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ outcome: "DUPLICATE" });
    expect(legacy.findOrderById).toHaveBeenCalledTimes(2);
    expect(legacy.findOrderById).toHaveBeenCalledWith(123);
    expect(legacy.findCustomerById).toHaveBeenCalledWith(7);
    expect(legacy.findCategoryById).toHaveBeenCalledWith(9);
    expect(log.claimPending).toHaveBeenCalledWith({
      notificationKey: "ORDER_READY:123",
      type: "ORDER_READY",
      sourceId: 123,
    });
    expect(log.markSent).toHaveBeenCalledWith(1);
    expect(fonnte.send).toHaveBeenCalledTimes(1);
    expect(fonnte.send).toHaveBeenCalledWith(
      "test-phone",
      "Halo Budi, hari ini Jas sudah bisa diambil, terima kasih.",
    );
  });

  it("claim database gagal sebelum Fonnte dipanggil", async () => {
    log.claimPending
      .mockReset()
      .mockRejectedValue(new Error("database unavailable"));
    const response = await post();

    expect(response.status).toBe(500);
    expect(fonnte.send).not.toHaveBeenCalled();
  });
});
