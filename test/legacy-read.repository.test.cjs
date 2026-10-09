const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  LegacyReadRepository,
} = require("../dist/notification/legacy-read.repository");

function repositoryWith(responses) {
  const calls = [];
  const prisma = Object.fromEntries(
    ["tbl_pelanggan", "tbl_order", "tbl_fitting", "tbl_category"].map(
      (table) => [
        table,
        {
          findUnique: async (query) => {
            calls.push({ table, query });
            return responses[table] ?? null;
          },
        },
      ],
    ),
  );
  return { repository: new LegacyReadRepository(prisma), calls };
}

test("customer dibaca berdasarkan ID dengan hanya nama dan HP", async () => {
  const customer = {
    pelanggan_id: 7,
    pelanggan_nama: "Ayu",
    pelanggan_hp: "08123456789",
  };
  const { repository, calls } = repositoryWith({ tbl_pelanggan: customer });

  assert.deepEqual(await repository.findCustomerById(7), customer);
  assert.deepEqual(calls, [
    {
      table: "tbl_pelanggan",
      query: {
        where: { pelanggan_id: 7 },
        select: {
          pelanggan_id: true,
          pelanggan_nama: true,
          pelanggan_hp: true,
        },
      },
    },
  ]);
});

test("customer yang tidak ada menghasilkan null", async () => {
  const { repository } = repositoryWith({});
  assert.equal(await repository.findCustomerById(99), null);
});

test("order dibaca berdasarkan ID dengan field minimum tanpa menafsirkan status", async () => {
  const order = {
    order_id: 10,
    pelanggan_id: 7,
    category_id: 3,
    order_status: "Selesai",
    tgl_coba: new Date("2026-10-07"),
    tgl_selesai: new Date("2026-10-09"),
    qty: 2,
  };
  const { repository, calls } = repositoryWith({ tbl_order: order });

  assert.deepEqual(await repository.findOrderById(10), order);
  assert.deepEqual(calls, [
    {
      table: "tbl_order",
      query: {
        where: { order_id: 10 },
        select: {
          order_id: true,
          pelanggan_id: true,
          category_id: true,
          order_status: true,
          tgl_coba: true,
          tgl_selesai: true,
          qty: true,
        },
      },
    },
  ]);
});

test("order yang tidak ada menghasilkan null", async () => {
  const { repository } = repositoryWith({});
  assert.equal(await repository.findOrderById(99), null);
});

test("nama category dibaca berdasarkan category_id dari database", async () => {
  const category = { category_id: 3, category_nama: "Jas" };
  const { repository, calls } = repositoryWith({ tbl_category: category });

  assert.deepEqual(await repository.findCategoryById(3), category);
  assert.deepEqual(calls, [
    {
      table: "tbl_category",
      query: {
        where: { category_id: 3 },
        select: { category_id: true, category_nama: true },
      },
    },
  ]);
});

test("category yang tidak ada menghasilkan null", async () => {
  const { repository } = repositoryWith({});
  assert.equal(await repository.findCategoryById(99), null);
});

test("fitting dibaca bersama tanggal coba dan ID customer dari order", async () => {
  const fitting = { fitting_id: 4, order_id: 10, fitting_status: "apa saja" };
  const order = { pelanggan_id: 7, tgl_coba: new Date("2026-10-07") };
  const { repository, calls } = repositoryWith({
    tbl_fitting: fitting,
    tbl_order: order,
  });

  assert.deepEqual(await repository.findFittingById(4), {
    ...fitting,
    ...order,
  });
  assert.deepEqual(calls, [
    {
      table: "tbl_fitting",
      query: {
        where: { fitting_id: 4 },
        select: { fitting_id: true, order_id: true, fitting_status: true },
      },
    },
    {
      table: "tbl_order",
      query: {
        where: { order_id: 10 },
        select: { pelanggan_id: true, tgl_coba: true },
      },
    },
  ]);
});

test("fitting atau order terkait yang tidak ada menghasilkan null", async () => {
  const missingFitting = repositoryWith({});
  assert.equal(await missingFitting.repository.findFittingById(99), null);
  assert.deepEqual(
    missingFitting.calls.map(({ table }) => table),
    ["tbl_fitting"],
  );

  const missingOrder = repositoryWith({
    tbl_fitting: { fitting_id: 4, order_id: 99, fitting_status: null },
  });
  assert.equal(await missingOrder.repository.findFittingById(4), null);
});
