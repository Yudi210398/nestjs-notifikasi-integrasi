import { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { InternalApiKeyGuard } from "./internal-api-key.guard";
import { OrderReadyTriggerController } from "./order-ready-trigger.controller";
import { OrderReadyTriggerService } from "./order-ready-trigger.service";

describe("POST /internal/notifications/order-ready", () => {
  let app: INestApplication;
  let url: string;
  const trigger = jest.fn().mockResolvedValue({ outcome: "SENT" });
  let key: string | undefined = "test-internal-key";

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [OrderReadyTriggerController],
      providers: [
        InternalApiKeyGuard,
        { provide: OrderReadyTriggerService, useValue: { trigger } },
        { provide: ConfigService, useValue: { get: () => key } },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    await app.listen(0, "127.0.0.1");
    url = `${await app.getUrl()}/internal/notifications/order-ready`;
  });

  afterEach(() => {
    key = "test-internal-key";
    trigger.mockClear();
  });

  afterAll(async () => {
    await app.close();
  });

  async function post(body: unknown, authorization?: string) {
    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authorization ? { Authorization: authorization } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  it("key valid dan orderId valid menjalankan business flow", async () => {
    const response = await post({ orderId: 123 }, "Bearer test-internal-key");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: "SENT" });
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveBeenCalledWith(123);
  });

  it.each([undefined, "Basic test-internal-key", "Bearer", "Bearer wrong-key"])(
    "auth %s ditolak sebelum business flow",
    async (authorization) => {
      const response = await post({ orderId: 123 }, authorization);

      expect(response.status).toBe(401);
      expect(trigger).not.toHaveBeenCalled();
    },
  );

  it("key server yang tidak dikonfigurasi menolak sebelum business flow", async () => {
    key = undefined;
    const response = await post({ orderId: 123 }, "Bearer test-internal-key");

    expect(response.status).toBe(503);
    expect(trigger).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { orderId: null },
    { orderId: "123" },
    { orderId: 0 },
    { orderId: -1 },
    { orderId: 1.5 },
    { orderId: Number.MAX_SAFE_INTEGER + 1 },
    { orderId: 123, phone: "untrusted" },
  ])("body invalid %j ditolak", async (body) => {
    const response = await post(body, "Bearer test-internal-key");

    expect(response.status).toBe(400);
    expect(trigger).not.toHaveBeenCalled();
  });

  it.each(["FAILED", "AMBIGUOUS", "DUPLICATE", "SKIPPED"])(
    "hasil bisnis %s tetap 200 agar tidak memicu blind retry",
    async (outcome) => {
      const result =
        outcome === "SKIPPED"
          ? { outcome, reason: "ORDER_NOT_READY" }
          : { outcome };
      trigger.mockResolvedValueOnce(result);
      const response = await post({ orderId: 123 }, "Bearer test-internal-key");

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(result);
      expect(trigger).toHaveBeenCalledTimes(1);
    },
  );

  it("exception internal memberi 500 tanpa rincian database", async () => {
    trigger.mockRejectedValueOnce(new Error("secret database detail"));
    const response = await post({ orderId: 123 }, "Bearer test-internal-key");

    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain(
      "secret database detail",
    );
  });
});
