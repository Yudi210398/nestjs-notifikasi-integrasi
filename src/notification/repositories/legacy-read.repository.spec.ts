import { PrismaService } from "../../prisma/prisma.service";
import { LegacyReadRepository } from "./legacy-read.repository";

const forDate = new Date("2026-10-14T00:00:00.000Z");

function setup() {
  const prisma = {
    tbl_order: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ order_id: 11 }, { order_id: 12 }]),
    },
    tbl_fitting: {
      findMany: jest.fn().mockResolvedValue([{ fitting_id: 44 }]),
    },
  };
  const repository = new LegacyReadRepository(
    prisma as unknown as PrismaService,
  );
  return { repository, prisma };
}

describe("LegacyReadRepository due fittings", () => {
  it("memfilter tanggal tepat dan fitting_status NULL melalui dua SELECT", async () => {
    const { repository, prisma } = setup();

    await expect(repository.findDueFittingsForDate(forDate)).resolves.toEqual([
      { fitting_id: 44 },
    ]);
    expect(prisma.tbl_order.findMany).toHaveBeenCalledWith({
      where: { tgl_coba: forDate },
      select: { order_id: true },
    });
    expect(prisma.tbl_fitting.findMany).toHaveBeenCalledWith({
      where: { order_id: { in: [11, 12] }, fitting_status: null },
      select: { fitting_id: true },
      orderBy: { fitting_id: "asc" },
    });
  });

  it("tanpa order untuk tanggal itu tidak mencari fitting", async () => {
    const { repository, prisma } = setup();
    prisma.tbl_order.findMany.mockResolvedValue([]);

    await expect(repository.findDueFittingsForDate(forDate)).resolves.toEqual(
      [],
    );
    expect(prisma.tbl_fitting.findMany).not.toHaveBeenCalled();
  });

  it("gagal membaca order menghentikan query fitting", async () => {
    const { repository, prisma } = setup();
    prisma.tbl_order.findMany.mockRejectedValue(new Error("read unavailable"));

    await expect(repository.findDueFittingsForDate(forDate)).rejects.toThrow(
      "read unavailable",
    );
    expect(prisma.tbl_fitting.findMany).not.toHaveBeenCalled();
  });

  it("gagal membaca fitting meneruskan kegagalan ke scheduler", async () => {
    const { repository, prisma } = setup();
    prisma.tbl_fitting.findMany.mockRejectedValue(
      new Error("read unavailable"),
    );

    await expect(repository.findDueFittingsForDate(forDate)).rejects.toThrow(
      "read unavailable",
    );
  });
});
