import "dotenv/config";
import { randomInt } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { databaseUrlFromEnv } from "../prisma/database-url";
import { NotificationLogPrismaService } from "../prisma/notification-log-prisma.service";
import { FonnteWhatsappService } from "./fonnte-whatsapp.service";
import { NotificationDeliveryService } from "./notification-delivery.service";
import { NotificationLogRepository } from "./notification-log.repository";
import type { NotificationCandidate } from "./notification.service";

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
});
