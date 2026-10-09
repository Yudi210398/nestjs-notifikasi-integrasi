import { LegacyReadRepository } from "./legacy-read.repository";
import { NotificationService } from "./notification.service";

const order = {
  order_id: 11,
  pelanggan_id: 22,
  category_id: 33,
  order_status: "Selesai",
  tgl_coba: null,
  tgl_selesai: new Date("2026-10-10"),
  qty: 1,
};
const customer = {
  pelanggan_id: 22,
  pelanggan_nama: "Customer contoh",
  pelanggan_hp: "phone-token",
};
const category = { category_id: 33, category_nama: "Jas" };
const fitting = {
  fitting_id: 44,
  order_id: 11,
  fitting_status: null,
  pelanggan_id: 22,
  tgl_coba: new Date("2026-10-09"),
};

function setup() {
  const repository = {
    findOrderById: jest.fn().mockResolvedValue(order),
    findCustomerById: jest.fn().mockResolvedValue(customer),
    findCategoryById: jest.fn().mockResolvedValue(category),
    findFittingById: jest.fn().mockResolvedValue(fitting),
  };
  const service = new NotificationService(
    repository as unknown as LegacyReadRepository,
  );
  return { repository, service };
}

describe("NotificationService order ready", () => {
  it("SKIP ketika order tidak ditemukan", async () => {
    const { repository, service } = setup();
    repository.findOrderById.mockResolvedValue(null);

    await expect(service.prepareOrderReadyNotification(11)).resolves.toEqual({
      decision: "SKIP",
      reason: "ORDER_NOT_FOUND",
    });
  });

  it.each([null, "", "2/5", "selesai", " Selesai"])(
    "SKIP ketika status order bukan tepat Selesai: %s",
    async (status) => {
      const { repository, service } = setup();
      repository.findOrderById.mockResolvedValue({
        ...order,
        order_status: status,
      });

      await expect(service.prepareOrderReadyNotification(11)).resolves.toEqual({
        decision: "SKIP",
        reason: "ORDER_NOT_READY",
      });
      expect(repository.findCustomerById).not.toHaveBeenCalled();
    },
  );

  it("SKIP ketika customer order tidak ditemukan", async () => {
    const { repository, service } = setup();
    repository.findCustomerById.mockResolvedValue(null);

    await expect(service.prepareOrderReadyNotification(11)).resolves.toEqual({
      decision: "SKIP",
      reason: "CUSTOMER_NOT_FOUND",
    });
  });

  it.each([null, undefined, "", " \t "])(
    "SKIP ketika nomor HP customer tidak tersedia: %s",
    async (phone) => {
      const { repository, service } = setup();
      repository.findCustomerById.mockResolvedValue({
        ...customer,
        pelanggan_hp: phone,
      });

      await expect(service.prepareOrderReadyNotification(11)).resolves.toEqual({
        decision: "SKIP",
        reason: "PHONE_MISSING",
      });
    },
  );

  it("SKIP ketika category order tidak ditemukan", async () => {
    const { repository, service } = setup();
    repository.findCategoryById.mockResolvedValue(null);

    await expect(service.prepareOrderReadyNotification(11)).resolves.toEqual({
      decision: "SKIP",
      reason: "CATEGORY_NOT_FOUND",
    });
  });

  it("READY dengan customer dan nama category dari repository", async () => {
    const { repository, service } = setup();

    await expect(service.prepareOrderReadyNotification(11)).resolves.toEqual({
      decision: "READY",
      candidate: {
        type: "ORDER_READY",
        sourceId: 11,
        orderId: 11,
        customerId: 22,
        customerName: "Customer contoh",
        phone: "phone-token",
        categoryName: "Jas",
      },
    });
    expect(repository.findOrderById).toHaveBeenCalledWith(11);
    expect(repository.findCustomerById).toHaveBeenCalledWith(22);
    expect(repository.findCategoryById).toHaveBeenCalledWith(33);
  });

  it("memakai nama category yang dikembalikan repository", async () => {
    const { repository, service } = setup();
    repository.findCategoryById.mockResolvedValue({
      ...category,
      category_nama: "Celana",
    });

    const result = await service.prepareOrderReadyNotification(11);
    expect(result).toMatchObject({
      decision: "READY",
      candidate: { categoryName: "Celana" },
    });
  });
});

describe("NotificationService fitting reminder", () => {
  it("SKIP ketika fitting tidak ada atau order terkait yatim", async () => {
    const { repository, service } = setup();
    repository.findFittingById.mockResolvedValue(null);

    await expect(service.prepareFittingReminder(44)).resolves.toEqual({
      decision: "SKIP",
      reason: "FITTING_DATA_INCOMPLETE",
    });
  });

  it("SKIP ketika tanggal coba tidak tersedia", async () => {
    const { repository, service } = setup();
    repository.findFittingById.mockResolvedValue({
      ...fitting,
      tgl_coba: null,
    });

    await expect(service.prepareFittingReminder(44)).resolves.toEqual({
      decision: "SKIP",
      reason: "FITTING_DATA_INCOMPLETE",
    });
  });

  it("SKIP ketika customer fitting tidak ditemukan", async () => {
    const { repository, service } = setup();
    repository.findCustomerById.mockResolvedValue(null);

    await expect(service.prepareFittingReminder(44)).resolves.toEqual({
      decision: "SKIP",
      reason: "CUSTOMER_NOT_FOUND",
    });
  });

  it.each([null, undefined, "", " \t "])(
    "SKIP ketika nomor HP fitting tidak tersedia: %s",
    async (phone) => {
      const { repository, service } = setup();
      repository.findCustomerById.mockResolvedValue({
        ...customer,
        pelanggan_hp: phone,
      });

      await expect(service.prepareFittingReminder(44)).resolves.toEqual({
        decision: "SKIP",
        reason: "PHONE_MISSING",
      });
    },
  );

  it("READY dengan tanggal fitting tanpa keputusan timing", async () => {
    const { repository, service } = setup();

    await expect(service.prepareFittingReminder(44)).resolves.toEqual({
      decision: "READY",
      candidate: {
        type: "FITTING_REMINDER",
        sourceId: 44,
        orderId: 11,
        customerId: 22,
        customerName: "Customer contoh",
        phone: "phone-token",
        fittingDate: new Date("2026-10-09"),
      },
    });
    expect(repository.findFittingById).toHaveBeenCalledWith(44);
    expect(repository.findCustomerById).toHaveBeenCalledWith(22);
  });
});
