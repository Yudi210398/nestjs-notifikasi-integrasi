import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class LegacyReadRepository {
  constructor(private readonly prisma: PrismaService) {}

  findCustomerById(pelangganId: number) {
    return this.prisma.tbl_pelanggan.findUnique({
      where: { pelanggan_id: pelangganId },
      select: {
        pelanggan_id: true,
        pelanggan_nama: true,
        pelanggan_hp: true,
      },
    });
  }

  findOrderById(orderId: number) {
    return this.prisma.tbl_order.findUnique({
      where: { order_id: orderId },
      select: {
        order_id: true,
        pelanggan_id: true,
        category_id: true,
        order_status: true,
        tgl_coba: true,
        tgl_selesai: true,
        qty: true,
      },
    });
  }

  findCategoryById(categoryId: number) {
    return this.prisma.tbl_category.findUnique({
      where: { category_id: categoryId },
      select: {
        category_id: true,
        category_nama: true,
      },
    });
  }

  async findDueFittingsForDate(forDate: Date) {
    const orders = await this.prisma.tbl_order.findMany({
      where: { tgl_coba: forDate },
      select: { order_id: true },
    });
    if (orders.length === 0) {
      return [];
    }

    return this.prisma.tbl_fitting.findMany({
      where: {
        order_id: { in: orders.map((order) => order.order_id) },
        fitting_status: null,
      },
      select: { fitting_id: true },
      orderBy: { fitting_id: "asc" },
    });
  }

  async findFittingById(fittingId: number) {
    const fitting = await this.prisma.tbl_fitting.findUnique({
      where: { fitting_id: fittingId },
      select: {
        fitting_id: true,
        order_id: true,
        fitting_status: true,
      },
    });

    if (!fitting) {
      return null;
    }

    const order = await this.prisma.tbl_order.findUnique({
      where: { order_id: fitting.order_id },
      select: {
        pelanggan_id: true,
        tgl_coba: true,
        category_id: true,
      },
    });

    return order ? { ...fitting, ...order } : null;
  }
}
