import { Prisma } from "@prisma/client";
import { NotificationLogPrismaService } from "../prisma/notification-log-prisma.service";
import { NotificationLogRepository } from "./notification-log.repository";

function setup() {
  const prisma = {
    notificationLog: {
      create: jest.fn().mockResolvedValue({ id: 7 }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const repository = new NotificationLogRepository(
    prisma as unknown as NotificationLogPrismaService,
  );
  return { prisma, repository };
}

const identity = {
  notificationKey: "ORDER_READY:123",
  type: "ORDER_READY" as const,
  sourceId: 123,
};

function duplicateError() {
  return new Prisma.PrismaClientKnownRequestError("Duplicate key", {
    code: "P2002",
    clientVersion: Prisma.prismaVersion.client,
  });
}

describe("NotificationLogRepository", () => {
  it("claimPending membuat satu row PENDING dengan identity unik", async () => {
    const { prisma, repository } = setup();

    await expect(repository.claimPending(identity)).resolves.toEqual({
      claimed: true,
      id: 7,
    });
    expect(prisma.notificationLog.create).toHaveBeenCalledWith({
      data: { ...identity, status: "PENDING" },
      select: { id: true },
    });
  });

  it("unique conflict P2002 menjadi duplicate", async () => {
    const { prisma, repository } = setup();
    prisma.notificationLog.create.mockRejectedValue(duplicateError());

    await expect(repository.claimPending(identity)).resolves.toEqual({
      claimed: false,
    });
  });

  it("database error selain duplicate diteruskan", async () => {
    const { prisma, repository } = setup();
    prisma.notificationLog.create.mockRejectedValue(
      new Error("connection lost"),
    );

    await expect(repository.claimPending(identity)).rejects.toThrow(
      "connection lost",
    );
  });

  it("recordSkipped menyimpan SKIPPED dan reason tanpa melakukan send", async () => {
    const { prisma, repository } = setup();

    await expect(
      repository.recordSkipped({ ...identity, reason: "PHONE_MISSING" }),
    ).resolves.toEqual({ recorded: true, id: 7 });
    expect(prisma.notificationLog.create).toHaveBeenCalledWith({
      data: { ...identity, reason: "PHONE_MISSING", status: "SKIPPED" },
      select: { id: true },
    });
  });

  it("recordSkipped juga menghormati unique identity", async () => {
    const { prisma, repository } = setup();
    prisma.notificationLog.create.mockRejectedValue(duplicateError());

    await expect(
      repository.recordSkipped({ ...identity, reason: "PHONE_MISSING" }),
    ).resolves.toEqual({ recorded: false });
  });

  it.each([
    ["markSent", "SENT", null],
    ["markFailed", "FAILED", "PROVIDER_REJECTED"],
    ["markAmbiguous", "AMBIGUOUS", "NETWORK_ERROR"],
  ] as const)(
    "%s hanya mengubah PENDING menjadi %s",
    async (method, status, reason) => {
      const { prisma, repository } = setup();

      if (method === "markSent") {
        await repository.markSent(7);
      } else {
        await repository[method](7, reason!);
      }

      expect(prisma.notificationLog.updateMany).toHaveBeenCalledWith({
        where: { id: 7, status: "PENDING" },
        data: { status, reason },
      });
    },
  );

  it("menolak transisi ketika row bukan PENDING", async () => {
    const { prisma, repository } = setup();
    prisma.notificationLog.updateMany.mockResolvedValue({ count: 0 });

    await expect(repository.markSent(7)).rejects.toThrow(
      "NotificationLog PENDING not found",
    );
  });
});
