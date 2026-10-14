import { ScheduleModule, SchedulerRegistry } from "@nestjs/schedule";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../app.module";
import { NotificationLogPrismaService } from "../../prisma/notification-log-prisma.service";
import { PrismaService } from "../../prisma/prisma.service";
import { FonnteWhatsappService } from "../services/fonnte-whatsapp.service";

describe("Fitting scheduler module wiring", () => {
  it("AppModule mendaftarkan cron Jakarta dan startup sebelum 11:00 tidak mengirim", async () => {
    jest.useFakeTimers({ now: new Date("2026-10-13T18:00:00Z") });
    const fonnte = { send: jest.fn() };
    const fetch = jest
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Unexpected live HTTP"));
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(NotificationLogPrismaService)
      .useValue({})
      .overrideProvider(FonnteWhatsappService)
      .useValue(fonnte)
      .compile();
    const app = module.createNestApplication({ logger: false });

    try {
      await app.init();
      const registry = app.get(SchedulerRegistry);
      const job = registry.getCronJob("fitting-reminders");
      expect(job.nextDate().toISO()).toBe("2026-10-14T11:00:00.000+07:00");
      expect(fonnte.send).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
      expect(app.get(ScheduleModule)).toBeDefined();
    } finally {
      await app.close();
      jest.restoreAllMocks();
      jest.useRealTimers();
    }
  });
});
