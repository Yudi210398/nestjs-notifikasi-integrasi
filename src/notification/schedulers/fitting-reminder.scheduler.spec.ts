import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { LegacyReadRepository } from "../repositories/legacy-read.repository";
import { NotificationLogRepository } from "../repositories/notification-log.repository";
import { FonnteWhatsappService } from "../services/fonnte-whatsapp.service";
import { NotificationDeliveryService } from "../services/notification-delivery.service";
import { NotificationService } from "../services/notification.service";
import { FittingReminderScheduler } from "./fitting-reminder.scheduler";

const fittingDay = new Date("2026-10-14T00:00:00.000Z");
const fitting = {
  fitting_id: 44,
  order_id: 11,
  fitting_status: null,
  pelanggan_id: 22,
  category_id: 33,
  tgl_coba: fittingDay,
};
const customer = {
  pelanggan_id: 22,
  pelanggan_nama: "Budi",
  pelanggan_hp: "test-phone",
};

function setup(enabled: string | undefined = "true") {
  const config = {
    get: jest.fn().mockReturnValue(enabled),
  };
  const legacy = {
    findDueFittingsForDate: jest.fn().mockResolvedValue([{ fitting_id: 44 }]),
    findFittingById: jest.fn().mockImplementation(async (id: number) => ({
      ...fitting,
      fitting_id: id,
    })),
    findCustomerById: jest.fn().mockResolvedValue(customer),
    findCategoryById: jest.fn().mockResolvedValue({
      category_id: 33,
      category_nama: "Celana",
    }),
  };
  const claimedKeys = new Set<string>();
  const log = {
    claimPending: jest.fn().mockImplementation(async ({ notificationKey }) => {
      if (claimedKeys.has(notificationKey)) return { claimed: false };
      claimedKeys.add(notificationKey);
      return { claimed: true, id: 1 };
    }),
    recordSkipped: jest.fn().mockImplementation(async ({ notificationKey }) => {
      if (claimedKeys.has(notificationKey)) return { recorded: false };
      claimedKeys.add(notificationKey);
      return { recorded: true, id: 1 };
    }),
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
  const notification = new NotificationService(
    legacy as unknown as LegacyReadRepository,
  );
  const delivery = new NotificationDeliveryService(
    log as unknown as NotificationLogRepository,
    fonnte as unknown as FonnteWhatsappService,
  );
  const makeScheduler = () =>
    new FittingReminderScheduler(
      legacy as unknown as LegacyReadRepository,
      notification,
      delivery,
      log as unknown as NotificationLogRepository,
      config as unknown as ConfigService,
    );
  return {
    scheduler: makeScheduler(),
    makeScheduler,
    legacy,
    notification,
    log,
    fonnte,
    claimedKeys,
    config,
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-10-14T04:00:00.000Z"));
  jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("FittingReminderScheduler", () => {
  it.each(["false", "TRUE", " true "])(
    "switch %j menonaktifkan scan dan pengiriman",
    async (enabled) => {
      const { scheduler, legacy, log, fonnte } = setup(enabled);

      await scheduler.run();

      expect(legacy.findDueFittingsForDate).not.toHaveBeenCalled();
      expect(log.claimPending).not.toHaveBeenCalled();
      expect(fonnte.send).not.toHaveBeenCalled();
    },
  );

  it("switch yang tidak tersedia menonaktifkan scan", async () => {
    const { scheduler, legacy, fonnte, config } = setup();
    config.get.mockReturnValue(undefined);

    await scheduler.run();

    expect(legacy.findDueFittingsForDate).not.toHaveBeenCalled();
    expect(fonnte.send).not.toHaveBeenCalled();
  });

  it("sebelum 11:00 Jakarta tidak membaca fitting atau mengirim", async () => {
    jest.setSystemTime(new Date("2026-10-14T03:59:59.000Z"));
    const { scheduler, legacy, fonnte } = setup();

    await scheduler.run();

    expect(legacy.findDueFittingsForDate).not.toHaveBeenCalled();
    expect(fonnte.send).not.toHaveBeenCalled();
  });

  it.each(["2026-10-14T04:00:00Z", "2026-10-14T05:15:00Z"])(
    "pada timestamp %s memproses fitting hari ini yang statusnya NULL",
    async (time) => {
      jest.setSystemTime(new Date(time));
      const { scheduler, legacy, log, fonnte } = setup();

      await scheduler.run();

      expect(legacy.findDueFittingsForDate).toHaveBeenCalledWith(fittingDay);
      expect(log.claimPending).toHaveBeenCalledWith({
        notificationKey: "FITTING:44",
        type: "FITTING_REMINDER",
        sourceId: 44,
      });
      expect(fonnte.send).toHaveBeenCalledTimes(1);
      expect(log.markSent).toHaveBeenCalledWith(1);
    },
  );

  it.each(["2026-10-14T13:30:00Z", "2026-10-14T13:30:59Z"])(
    "pada batas %s WIB masih memproses fitting hari ini",
    async (time) => {
      jest.setSystemTime(new Date(time));
      const { scheduler, legacy, fonnte } = setup();

      await scheduler.run();

      expect(legacy.findDueFittingsForDate).toHaveBeenCalledWith(fittingDay);
      expect(fonnte.send).toHaveBeenCalledTimes(1);
    },
  );

  it("pukul 20:31 Jakarta tidak membaca fitting atau mengirim", async () => {
    jest.setSystemTime(new Date("2026-10-14T13:31:00Z"));
    const { scheduler, legacy, fonnte } = setup();

    await scheduler.run();

    expect(legacy.findDueFittingsForDate).not.toHaveBeenCalled();
    expect(fonnte.send).not.toHaveBeenCalled();
  });

  it("jika preparation melewati 20:30, tidak mengklaim atau mengirim", async () => {
    jest.setSystemTime(new Date("2026-10-14T13:30:59Z"));
    const { scheduler, notification, log, fonnte } = setup();
    const prepare = notification.prepareFittingReminder.bind(notification);
    jest
      .spyOn(notification, "prepareFittingReminder")
      .mockImplementationOnce(async (id, date) => {
        const result = await prepare(id, date);
        jest.setSystemTime(new Date("2026-10-14T13:31:00Z"));
        return result;
      });

    await scheduler.run();

    expect(log.claimPending).not.toHaveBeenCalled();
    expect(fonnte.send).not.toHaveBeenCalled();
  });

  it.each(["2026-10-13", "2026-10-15"])(
    "tanggal fitting yang berubah ke %s tidak dikirim",
    async (date) => {
      const { scheduler, legacy, log, fonnte } = setup();
      legacy.findFittingById.mockResolvedValue({
        ...fitting,
        tgl_coba: new Date(date),
      });

      await scheduler.run();

      expect(legacy.findFittingById).toHaveBeenCalledWith(44);
      expect(log.claimPending).not.toHaveBeenCalled();
      expect(log.recordSkipped).not.toHaveBeenCalled();
      expect(fonnte.send).not.toHaveBeenCalled();
    },
  );

  it.each(["Selesai", ""])(
    "status fitting %j tidak dianggap unfinished",
    async (status) => {
      const { scheduler, legacy, log, fonnte } = setup();
      legacy.findFittingById.mockResolvedValue({
        ...fitting,
        fitting_status: status,
      });

      await scheduler.run();

      expect(legacy.findFittingById).toHaveBeenCalledWith(44);
      expect(log.claimPending).not.toHaveBeenCalled();
      expect(log.recordSkipped).not.toHaveBeenCalled();
      expect(fonnte.send).not.toHaveBeenCalled();
    },
  );

  it("pesan memakai nama customer dan category dinamis beserta jam toko", async () => {
    const { scheduler, fonnte } = setup();

    await scheduler.run();

    expect(fonnte.send).toHaveBeenCalledWith(
      "test-phone",
      "Halo Pak/Bu Budi, hari ini ada fitting Celana. Toko buka jam 11.00 - 20.30. Terima kasih.",
    );
  });

  it("dua run tetap menghasilkan satu Fonnte call", async () => {
    const { scheduler, fonnte } = setup();

    await scheduler.run();
    await scheduler.run();

    expect(fonnte.send).toHaveBeenCalledTimes(1);
  });

  it("dua instance concurrent memakai atomic claim yang sama", async () => {
    const { scheduler, makeScheduler, fonnte, log } = setup();

    await Promise.all([scheduler.run(), makeScheduler().run()]);

    expect(log.claimPending).toHaveBeenCalledTimes(2);
    expect(fonnte.send).toHaveBeenCalledTimes(1);
  });

  it("run overlapping pada satu instance tidak menggandakan scan", async () => {
    const { scheduler, legacy, fonnte } = setup();
    let release!: (value: Array<{ fitting_id: number }>) => void;
    legacy.findDueFittingsForDate.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );

    const first = scheduler.run();
    await scheduler.run();
    expect(legacy.findDueFittingsForDate).toHaveBeenCalledTimes(1);
    release([{ fitting_id: 44 }]);
    await first;

    expect(fonnte.send).toHaveBeenCalledTimes(1);
  });

  it.each([null, "", " \t "])(
    "phone %j dicatat SKIPPED dan tidak dikirim",
    async (phone) => {
      const { scheduler, legacy, log, fonnte } = setup();
      legacy.findCustomerById.mockResolvedValue({
        ...customer,
        pelanggan_hp: phone,
      });

      await scheduler.run();
      legacy.findCustomerById.mockResolvedValue(customer);
      await scheduler.run();

      expect(log.recordSkipped).toHaveBeenCalledWith({
        notificationKey: "FITTING:44",
        type: "FITTING_REMINDER",
        sourceId: 44,
        reason: "PHONE_MISSING",
      });
      expect(fonnte.send).not.toHaveBeenCalled();
    },
  );

  it("category yang hilang tidak mengirim dan tidak mengonsumsi key", async () => {
    const { scheduler, legacy, log, fonnte } = setup();
    legacy.findCategoryById.mockResolvedValue(null);

    await scheduler.run();

    expect(log.recordSkipped).not.toHaveBeenCalled();
    expect(log.claimPending).not.toHaveBeenCalled();
    expect(fonnte.send).not.toHaveBeenCalled();
  });

  it.each([
    ["AMBIGUOUS", "TIMEOUT", "markAmbiguous"],
    ["DEFINITE_FAILURE", "PROVIDER_REJECTED", "markFailed"],
  ] as const)(
    "hasil %s disimpan tanpa send ulang pada run berikutnya",
    async (outcome, reason, method) => {
      const { scheduler, fonnte, log } = setup();
      fonnte.send.mockResolvedValue({ outcome, reason });

      await scheduler.run();
      await scheduler.run();

      expect(log[method]).toHaveBeenCalledWith(1, reason);
      expect(fonnte.send).toHaveBeenCalledTimes(1);
    },
  );

  it("catch-up startup setelah 11:00 memproses fitting hari ini", async () => {
    jest.setSystemTime(new Date("2026-10-14T05:00:00Z"));
    const { scheduler, fonnte } = setup();
    const run = jest.spyOn(scheduler, "run");

    scheduler.onApplicationBootstrap();
    expect(run).toHaveBeenCalledTimes(1);
    await run.mock.results[0].value;

    expect(fonnte.send).toHaveBeenCalledTimes(1);
  });

  it("catch-up startup pukul 20:00 masih mengirim fitting hari ini", async () => {
    jest.setSystemTime(new Date("2026-10-14T13:00:00Z"));
    const { scheduler, fonnte } = setup();
    const run = jest.spyOn(scheduler, "run");

    scheduler.onApplicationBootstrap();
    await run.mock.results[0].value;

    expect(fonnte.send).toHaveBeenCalledTimes(1);
  });

  it("restart pukul 21:00 tidak scan atau mengirim", async () => {
    jest.setSystemTime(new Date("2026-10-14T14:00:00Z"));
    const { scheduler, legacy, fonnte } = setup();
    const run = jest.spyOn(scheduler, "run");

    scheduler.onApplicationBootstrap();
    await run.mock.results[0].value;

    expect(legacy.findDueFittingsForDate).not.toHaveBeenCalled();
    expect(fonnte.send).not.toHaveBeenCalled();
  });

  it("boundary UTC mengikuti hari Jakarta dan tetap menunggu 11:00 WIB", async () => {
    jest.setSystemTime(new Date("2026-10-13T18:00:00Z"));
    const { scheduler, legacy, fonnte } = setup();
    await scheduler.run();
    expect(legacy.findDueFittingsForDate).not.toHaveBeenCalled();
    expect(fonnte.send).not.toHaveBeenCalled();

    jest.setSystemTime(new Date("2026-10-14T04:00:00Z"));
    await scheduler.run();
    expect(legacy.findDueFittingsForDate).toHaveBeenCalledWith(fittingDay);
  });

  it("scan yang melewati tengah malam Jakarta berhenti sebelum claim/send", async () => {
    jest.setSystemTime(new Date("2026-10-14T16:59:59Z"));
    const { scheduler, notification, fonnte, log } = setup();
    const prepare = notification.prepareFittingReminder.bind(notification);
    jest
      .spyOn(notification, "prepareFittingReminder")
      .mockImplementationOnce(async (id, date) => {
        const result = await prepare(id, date);
        jest.setSystemTime(new Date("2026-10-14T17:00:00Z"));
        return result;
      });

    await scheduler.run();

    expect(log.claimPending).not.toHaveBeenCalled();
    expect(fonnte.send).not.toHaveBeenCalled();
  });

  it("legacy scan gagal tidak mengirim dan melepas guard run untuk scan berikutnya", async () => {
    const { scheduler, legacy, fonnte } = setup();
    legacy.findDueFittingsForDate.mockRejectedValueOnce(
      new Error("private read detail"),
    );

    await scheduler.run();
    expect(fonnte.send).not.toHaveBeenCalled();
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      "Fitting reminder scan failed",
    );
    await scheduler.run();
    expect(fonnte.send).toHaveBeenCalledTimes(1);
  });

  it("legacy read satu fitting gagal tidak mengirim fitting itu dan melanjutkan yang lain", async () => {
    const { scheduler, legacy, log, fonnte } = setup();
    legacy.findDueFittingsForDate.mockResolvedValue([
      { fitting_id: 44 },
      { fitting_id: 45 },
    ]);
    legacy.findFittingById.mockRejectedValueOnce(
      new Error("private read detail"),
    );

    await scheduler.run();

    expect(log.claimPending).toHaveBeenCalledTimes(1);
    expect(log.claimPending).toHaveBeenCalledWith({
      notificationKey: "FITTING:45",
      type: "FITTING_REMINDER",
      sourceId: 45,
    });
    expect(fonnte.send).toHaveBeenCalledTimes(1);
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      "Fitting reminder processing failed for fittingId=44",
    );
  });

  it("DB claim gagal tidak memanggil Fonnte", async () => {
    const { scheduler, log, fonnte } = setup();
    log.claimPending.mockRejectedValueOnce(new Error("private claim detail"));

    await scheduler.run();

    expect(fonnte.send).not.toHaveBeenCalled();
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      "Fitting reminder processing failed for fittingId=44",
    );
  });

  it("gagal final-status write tidak memicu pengiriman ulang", async () => {
    const { scheduler, log, fonnte } = setup();
    log.markSent.mockRejectedValueOnce(new Error("private write detail"));

    await scheduler.run();
    await scheduler.run();

    expect(fonnte.send).toHaveBeenCalledTimes(1);
    expect(log.markSent).toHaveBeenCalledTimes(1);
  });
});
