import "dotenv/config";
import { randomInt } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { ConfigService } from "@nestjs/config";
import { databaseUrlFromEnv } from "../../prisma/database-url";
import { NotificationLogPrismaService } from "../../prisma/notification-log-prisma.service";
import { PrismaService } from "../../prisma/prisma.service";
import { FonnteWhatsappService } from "../services/fonnte-whatsapp.service";
import { NotificationDeliveryService } from "../services/notification-delivery.service";
import { NotificationLogRepository } from "./notification-log.repository";
import { NotificationService } from "../services/notification.service";
import type {
  NotificationCandidate,
  FittingReminderPreparationResult,
} from "../services/notification.service";
import { LegacyReadRepository } from "./legacy-read.repository";
import { FittingReminderScheduler } from "../schedulers/fitting-reminder.scheduler";

function databaseUrl(user: string | undefined, password: string | undefined) {
  if (!user || !password) {
    throw new Error("Local database credentials are missing");
  }
  return databaseUrlFromEnv({
    DB_HOST: process.env.DB_HOST,
    DB_PORT: process.env.DB_PORT,
    DB_NAME: process.env.DB_NAME,
    DB_USER: user,
    DB_PASSWORD: password,
  });
}

const writer = new PrismaClient({
  datasourceUrl: databaseUrl(
    process.env.NOTIFICATION_DB_USER,
    process.env.NOTIFICATION_DB_PASSWORD,
  ),
});
const secondWriter = new PrismaClient({
  datasourceUrl: databaseUrl(
    process.env.NOTIFICATION_DB_USER,
    process.env.NOTIFICATION_DB_PASSWORD,
  ),
});
const reader = new PrismaClient({
  datasourceUrl: databaseUrl(process.env.DB_USER, process.env.DB_PASSWORD),
});

const repository = new NotificationLogRepository(
  writer as NotificationLogPrismaService,
);
const secondRepository = new NotificationLogRepository(
  secondWriter as NotificationLogPrismaService,
);
const createdTestRowIds: number[] = [];

function identity() {
  const sourceId = randomInt(1_000_000_000, 2_000_000_000);
  const notificationKey = `ORDER_READY:${sourceId}`;
  return { notificationKey, type: "ORDER_READY" as const, sourceId };
}

function candidate(sourceId: number): NotificationCandidate {
  return {
    type: "ORDER_READY",
    sourceId,
    orderId: sourceId,
    customerId: 1,
    customerName: "Synthetic test only",
    phone: "synthetic-phone",
    categoryName: "Synthetic category",
  };
}

async function grants(client: PrismaClient): Promise<string> {
  const rows =
    await client.$queryRawUnsafe<Array<Record<string, string>>>("SHOW GRANTS");
  return rows.flatMap((row) => Object.values(row)).join("\n");
}

beforeAll(async () => {
  await Promise.all([
    writer.$connect(),
    secondWriter.$connect(),
    reader.$connect(),
  ]);
});

afterAll(async () => {
  try {
    if (createdTestRowIds.length > 0) {
      await writer.notificationLog.deleteMany({
        where: { id: { in: createdTestRowIds } },
      });
    }
  } finally {
    await Promise.all([
      writer.$disconnect(),
      secondWriter.$disconnect(),
      reader.$disconnect(),
    ]);
  }
});

describe("NotificationLog MySQL integration", () => {
  it("dua claim concurrent pada unique key yang sama hanya menghasilkan satu row", async () => {
    const key = identity();

    const results = await Promise.all([
      repository.claimPending(key),
      secondRepository.claimPending(key),
    ]);
    const winner = results.find((result) => result.claimed);
    if (winner?.claimed) {
      createdTestRowIds.push(winner.id);
    }

    expect(results.filter((result) => result.claimed)).toHaveLength(1);
    expect(results.filter((result) => !result.claimed)).toHaveLength(1);
    expect(
      await writer.notificationLog.count({
        where: { notificationKey: key.notificationKey },
      }),
    ).toBe(1);
  });

  it("dua delivery concurrent menghasilkan maksimal satu Fonnte call", async () => {
    const key = identity();
    const fonnte = {
      send: jest.fn().mockResolvedValue({
        outcome: "SUCCESS",
        providerMessageIds: [],
      }),
    } as unknown as FonnteWhatsappService;
    const first = new NotificationDeliveryService(repository, fonnte);
    const second = new NotificationDeliveryService(secondRepository, fonnte);

    const results = await Promise.all([
      first.deliver(candidate(key.sourceId), "synthetic message"),
      second.deliver(candidate(key.sourceId), "synthetic message"),
    ]);

    expect(results.map((result) => result.outcome).sort()).toEqual([
      "DUPLICATE",
      "SUCCESS",
    ]);
    expect(fonnte.send).toHaveBeenCalledTimes(1);
    const log = await writer.notificationLog.findUnique({
      where: { notificationKey: key.notificationKey },
      select: { id: true, status: true },
    });
    if (log && results.some((result) => result.outcome === "SUCCESS")) {
      createdTestRowIds.push(log.id);
    }
    expect(log?.status).toBe("SENT");
  });

  it.each(["PENDING", "SENT", "FAILED", "AMBIGUOUS", "SKIPPED"])(
    "existing %s tetap memblokir send",
    async (status) => {
      const key = identity();
      const log = await writer.notificationLog.create({
        data: { ...key, status },
      });
      createdTestRowIds.push(log.id);
      const fonnte = { send: jest.fn() } as unknown as FonnteWhatsappService;
      const service = new NotificationDeliveryService(repository, fonnte);

      await expect(
        service.deliver(candidate(key.sourceId), "synthetic message"),
      ).resolves.toEqual({ outcome: "DUPLICATE" });
      expect(fonnte.send).not.toHaveBeenCalled();
    },
  );

  it("recordSkipped menyimpan reason pada tabel NestJS", async () => {
    const key = identity();

    const result = await repository.recordSkipped({
      ...key,
      reason: "PHONE_MISSING",
    });
    if (result.recorded) {
      createdTestRowIds.push(result.id);
    }
    expect(result.recorded).toBe(true);
    expect(
      await writer.notificationLog.findUnique({
        where: { notificationKey: key.notificationKey },
        select: { status: true, reason: true },
      }),
    ).toEqual({ status: "SKIPPED", reason: "PHONE_MISSING" });
  });

  it("reader hanya memiliki SELECT dan writer hanya memiliki hak pada notification_log", async () => {
    await reader.tbl_order.findFirst({ select: { order_id: true } });
    const readerGrants = await grants(reader);
    const writerGrants = await grants(writer);

    expect(readerGrants).toMatch(/SELECT/);
    expect(readerGrants).not.toMatch(
      /ALL PRIVILEGES|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP/,
    );
    expect(writerGrants).toMatch(/notification_log/);
    expect(writerGrants).not.toMatch(/ALL PRIVILEGES/);
    expect(writerGrants).not.toMatch(
      /tbl_order|tbl_pelanggan|tbl_fitting|tbl_category/,
    );
    expect(writerGrants).not.toMatch(/ON\s+[`\w]+\.\*/i);
    for (const grant of writerGrants.split("\n")) {
      if (grant.includes("ON *.*")) {
        expect(grant).toMatch(/^GRANT USAGE /);
      }
    }
  });

  it("due fitting query sesuai JOIN MySQL DATE dan fitting_status IS NULL tanpa write legacy", async () => {
    const sample = await reader.tbl_order.findFirst({
      where: { tgl_coba: { not: null } },
      select: { tgl_coba: true },
    });
    if (!sample?.tgl_coba)
      throw new Error("Local legacy date sample is missing");
    expect(sample.tgl_coba.toISOString().slice(11)).toBe("00:00:00.000Z");
    const legacy = new LegacyReadRepository(reader as PrismaService);
    const expected = await reader.$queryRaw<Array<{ fitting_id: number }>>`
      SELECT f.fitting_id
      FROM tbl_fitting AS f
      INNER JOIN tbl_order AS o ON o.order_id = f.order_id
      WHERE o.tgl_coba = ${sample.tgl_coba}
        AND f.fitting_status IS NULL
      ORDER BY f.fitting_id ASC
    `;

    await expect(
      legacy.findDueFittingsForDate(sample.tgl_coba),
    ).resolves.toEqual(expected);
  });
});

function fittingPreparation(
  sourceId: number,
): FittingReminderPreparationResult {
  return {
    decision: "READY",
    candidate: {
      type: "FITTING_REMINDER",
      sourceId,
      orderId: sourceId,
      customerId: 1,
      customerName: "Synthetic test only",
      phone: "synthetic-phone",
      categoryName: "Synthetic category",
      fittingDate: new Date("2026-10-14T00:00:00Z"),
    },
  };
}

function fittingScheduler(
  log: NotificationLogRepository,
  sourceId: number,
  fonnte: FonnteWhatsappService,
  preparation = fittingPreparation(sourceId),
) {
  const legacy = {
    findDueFittingsForDate: jest
      .fn()
      .mockResolvedValue([{ fitting_id: sourceId }]),
  } as unknown as LegacyReadRepository;
  const notification = {
    prepareFittingReminder: jest.fn().mockResolvedValue(preparation),
  } as unknown as NotificationService;
  const delivery = new NotificationDeliveryService(log, fonnte);
  const config = {
    get: (key: string) =>
      key === "FITTING_REMINDER_ENABLED" ? "true" : undefined,
  } as ConfigService;
  return new FittingReminderScheduler(
    legacy,
    notification,
    delivery,
    log,
    config,
  );
}

describe("Fitting scheduler MySQL integration", () => {
  beforeEach(() => {
    jest.useFakeTimers({
      now: new Date("2026-10-14T05:00:00Z"),
      doNotFake: [
        "hrtime",
        "nextTick",
        "performance",
        "queueMicrotask",
        "setImmediate",
        "clearImmediate",
        "setInterval",
        "clearInterval",
        "setTimeout",
        "clearTimeout",
      ],
    });
  });

  afterEach(() => jest.useRealTimers());

  it("dua scheduler concurrent hanya mengklaim FITTING satu kali dan mengirim sekali", async () => {
    const sourceId = identity().sourceId;
    const fonnte = {
      send: jest
        .fn()
        .mockResolvedValue({ outcome: "SUCCESS", providerMessageIds: [] }),
    };
    const first = fittingScheduler(
      repository,
      sourceId,
      fonnte as unknown as FonnteWhatsappService,
    );
    const second = fittingScheduler(
      secondRepository,
      sourceId,
      fonnte as unknown as FonnteWhatsappService,
    );

    await Promise.all([first.run(), second.run()]);
    const log = await writer.notificationLog.findUnique({
      where: { notificationKey: `FITTING:${sourceId}` },
      select: { id: true, status: true, type: true },
    });
    if (log) createdTestRowIds.push(log.id);

    expect(log).toMatchObject({ status: "SENT", type: "FITTING_REMINDER" });
    expect(fonnte.send).toHaveBeenCalledTimes(1);
  });

  it("timeout fitting menjadi AMBIGUOUS dan scheduler berikutnya tidak send lagi", async () => {
    const sourceId = identity().sourceId;
    const fonnte = {
      send: jest
        .fn()
        .mockResolvedValue({ outcome: "AMBIGUOUS", reason: "TIMEOUT" }),
    };
    const scheduler = fittingScheduler(
      repository,
      sourceId,
      fonnte as unknown as FonnteWhatsappService,
    );

    await scheduler.run();
    await scheduler.run();
    const log = await writer.notificationLog.findUnique({
      where: { notificationKey: `FITTING:${sourceId}` },
      select: { id: true, status: true, reason: true },
    });
    if (log) createdTestRowIds.push(log.id);

    expect(log).toMatchObject({ status: "AMBIGUOUS", reason: "TIMEOUT" });
    expect(fonnte.send).toHaveBeenCalledTimes(1);
  });

  it("PHONE_MISSING fitting menyimpan SKIPPED pada identity unik tanpa Fonnte", async () => {
    const sourceId = identity().sourceId;
    const fonnte = { send: jest.fn() };
    const scheduler = fittingScheduler(
      repository,
      sourceId,
      fonnte as unknown as FonnteWhatsappService,
      { decision: "SKIP", reason: "PHONE_MISSING" },
    );

    await scheduler.run();
    await scheduler.run();
    const log = await writer.notificationLog.findUnique({
      where: { notificationKey: `FITTING:${sourceId}` },
      select: { id: true, status: true, reason: true },
    });
    if (log) createdTestRowIds.push(log.id);

    expect(log).toMatchObject({ status: "SKIPPED", reason: "PHONE_MISSING" });
    expect(fonnte.send).not.toHaveBeenCalled();
  });
});
