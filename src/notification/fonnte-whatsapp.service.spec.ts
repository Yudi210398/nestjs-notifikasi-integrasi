import { ConfigService } from "@nestjs/config";
import { FonnteWhatsappService } from "./fonnte-whatsapp.service";

function setup(token: string | null = "test-token") {
  const config = { get: jest.fn().mockReturnValue(token) };
  return new FonnteWhatsappService(config as unknown as ConfigService);
}

function providerResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}

afterEach(() => jest.restoreAllMocks());

describe("FonnteWhatsappService", () => {
  it("mengirim POST sesuai kontrak Fonnte dan mengembalikan SUCCESS saat diterima provider", async () => {
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(
      providerResponse({
        status: true,
        detail: "success! message in queue",
        id: ["message-1"],
        requestid: 123,
        process: "pending",
        target: ["test-target"],
      }),
    );

    const result = await setup().send("test-target", "test-message");

    expect(result).toEqual({
      outcome: "SUCCESS",
      providerRequestId: 123,
      providerMessageIds: ["message-1"],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.fonnte.com/send");
    expect(options?.method).toBe("POST");
    expect(options?.headers).toEqual({ Authorization: "test-token" });
    expect(options?.signal).toBeDefined();
    expect(options?.body).toBeInstanceOf(FormData);
    const form = options?.body as FormData;
    expect(form.get("target")).toBe("test-target");
    expect(form.get("message")).toBe("test-message");
  });

  it("mengembalikan DEFINITE_FAILURE saat provider menolak request", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        providerResponse({
          status: false,
          reason: "target invalid",
          requestid: 456,
        }),
      );

    await expect(setup().send("test-target", "test-message")).resolves.toEqual({
      outcome: "DEFINITE_FAILURE",
      reason: "PROVIDER_REJECTED",
      providerRequestId: 456,
    });
  });

  it("menerima bentuk Status false yang juga muncul di dokumentasi resmi", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        providerResponse({ Status: false, reason: "token invalid" }, false),
      );

    await expect(setup().send("test-target", "test-message")).resolves.toEqual({
      outcome: "DEFINITE_FAILURE",
      reason: "PROVIDER_REJECTED",
    });
  });

  it("tidak memanggil HTTP ketika FONNTE_TOKEN tidak ada", async () => {
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("unexpected HTTP"));

    await expect(
      setup(null).send("test-target", "test-message"),
    ).rejects.toThrow("FONNTE_TOKEN is not configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("mengembalikan AMBIGUOUS tanpa retry saat jaringan gagal", async () => {
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new TypeError("network interrupted"));

    await expect(setup().send("test-target", "test-message")).resolves.toEqual({
      outcome: "AMBIGUOUS",
      reason: "NETWORK_ERROR",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("mengembalikan AMBIGUOUS tanpa retry saat timeout", async () => {
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new DOMException("request timed out", "TimeoutError"));

    await expect(setup().send("test-target", "test-message")).resolves.toEqual({
      outcome: "AMBIGUOUS",
      reason: "TIMEOUT",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("tidak menyebut SUCCESS untuk respons provider yang tidak pasti", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(providerResponse({ detail: "unknown" }));

    await expect(setup().send("test-target", "test-message")).resolves.toEqual({
      outcome: "AMBIGUOUS",
      reason: "UNCONFIRMED_RESPONSE",
    });
  });

  it("mengembalikan AMBIGUOUS jika body respons tidak dapat dibaca", async () => {
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: jest.fn().mockRejectedValue(new SyntaxError("invalid JSON")),
    } as unknown as Response);

    await expect(setup().send("test-target", "test-message")).resolves.toEqual({
      outcome: "AMBIGUOUS",
      reason: "UNCONFIRMED_RESPONSE",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("tidak menyebut SUCCESS untuk HTTP gagal tanpa penolakan eksplisit", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(providerResponse({ status: true }, false));

    await expect(setup().send("test-target", "test-message")).resolves.toEqual({
      outcome: "AMBIGUOUS",
      reason: "UNCONFIRMED_RESPONSE",
    });
  });
});
