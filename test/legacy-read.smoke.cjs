const assert = require("node:assert/strict");
const { ConfigService } = require("@nestjs/config");
require("dotenv").config({ quiet: true });
const { PrismaService } = require("../dist/prisma/prisma.service");
const {
  LegacyReadRepository,
} = require("../dist/notification/legacy-read.repository");

async function main() {
  const prisma = new PrismaService(new ConfigService());
  const repository = new LegacyReadRepository(prisma);

  try {
    await prisma.$connect();

    const customerId = await prisma.tbl_pelanggan.findFirst({
      select: { pelanggan_id: true },
    });
    const orderId = await prisma.tbl_order.findFirst({
      select: { order_id: true },
    });
    const [fittingCounts] = await prisma.$queryRaw`
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN o.order_id IS NULL THEN 1 ELSE 0 END) AS orphaned
      FROM tbl_fitting AS f
      LEFT JOIN tbl_order AS o ON o.order_id = f.order_id
    `;
    const [fittingId] = await prisma.$queryRaw`
      SELECT f.fitting_id
      FROM tbl_fitting AS f
      INNER JOIN tbl_order AS o ON o.order_id = f.order_id
      LIMIT 1
    `;
    const [orphanFittingId] = await prisma.$queryRaw`
      SELECT f.fitting_id
      FROM tbl_fitting AS f
      LEFT JOIN tbl_order AS o ON o.order_id = f.order_id
      WHERE o.order_id IS NULL
      LIMIT 1
    `;

    assert.ok(customerId, "Tidak ada customer untuk smoke test");
    assert.ok(orderId, "Tidak ada order untuk smoke test");
    assert.ok(fittingId, "Tidak ada fitting untuk smoke test");

    const customer = await repository.findCustomerById(customerId.pelanggan_id);
    const order = await repository.findOrderById(orderId.order_id);
    const fitting = await repository.findFittingById(fittingId.fitting_id);

    assert.ok(customer, "Customer valid tidak terbaca");
    assert.ok(order, "Order valid tidak terbaca");
    assert.ok(fitting, "Fitting valid atau order terkait tidak terbaca");
    assert.ok(
      await repository.findOrderById(fitting.order_id),
      "Order fitting tidak terbaca",
    );
    assert.ok(
      await repository.findCustomerById(fitting.pelanggan_id),
      "Customer fitting tidak terbaca",
    );
    assert.equal(await repository.findCustomerById(-1), null);
    assert.equal(await repository.findOrderById(-1), null);
    assert.equal(await repository.findFittingById(-1), null);
    if (orphanFittingId) {
      assert.equal(
        await repository.findFittingById(orphanFittingId.fitting_id),
        null,
      );
    }

    const category = await repository.findCategoryById(order.category_id);
    assert.ok(category, "Category order tidak terbaca");
    assert.equal(await repository.findCategoryById(-1), null);

    console.log("customer: valid terbaca; invalid null");
    console.log("order: valid terbaca; invalid null");
    console.log("fitting: valid terbaca; invalid null");
    console.log("relasi fitting -> order -> customer: terbaca");
    console.log(
      `fitting lokal: total ${Number(fittingCounts.total)}, tanpa order ${Number(fittingCounts.orphaned)}`,
    );
    console.log("category order: valid terbaca; invalid null");
    console.log(`contoh nama category dari DB: ${category.category_nama}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  const detail =
    error instanceof assert.AssertionError ? error.message : error.name;
  console.error(`Smoke test gagal: ${detail}`);
  process.exitCode = 1;
});
