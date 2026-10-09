import { Injectable } from "@nestjs/common";
import { LegacyReadRepository } from "./legacy-read.repository";

type SkipReason =
  | "ORDER_NOT_FOUND"
  | "ORDER_NOT_READY"
  | "CUSTOMER_NOT_FOUND"
  | "PHONE_MISSING"
  | "CATEGORY_NOT_FOUND"
  | "FITTING_DATA_INCOMPLETE";

export type NotificationCandidate =
  | {
      type: "ORDER_READY";
      sourceId: number;
      orderId: number;
      customerId: number;
      customerName: string;
      phone: string;
      categoryName: string;
    }
  | {
      type: "FITTING_REMINDER";
      sourceId: number;
      orderId: number;
      customerId: number;
      customerName: string;
      phone: string;
      fittingDate: Date;
    };

export type NotificationPreparationResult =
  | { decision: "READY"; candidate: NotificationCandidate }
  | { decision: "SKIP"; reason: SkipReason };

@Injectable()
export class NotificationService {
  constructor(private readonly legacyReadRepository: LegacyReadRepository) {}

  async prepareOrderReadyNotification(
    orderId: number,
  ): Promise<NotificationPreparationResult> {
    const order = await this.legacyReadRepository.findOrderById(orderId);
    if (!order) {
      return { decision: "SKIP", reason: "ORDER_NOT_FOUND" };
    }

    if (order.order_status !== "Selesai") {
      return { decision: "SKIP", reason: "ORDER_NOT_READY" };
    }

    const customer = await this.legacyReadRepository.findCustomerById(
      order.pelanggan_id,
    );
    if (!customer) {
      return { decision: "SKIP", reason: "CUSTOMER_NOT_FOUND" };
    }

    const phone = customer.pelanggan_hp;
    if (!phone?.trim()) {
      return { decision: "SKIP", reason: "PHONE_MISSING" };
    }

    const category = await this.legacyReadRepository.findCategoryById(
      order.category_id,
    );
    if (!category) {
      return { decision: "SKIP", reason: "CATEGORY_NOT_FOUND" };
    }

    return {
      decision: "READY",
      candidate: {
        type: "ORDER_READY",
        sourceId: order.order_id,
        orderId: order.order_id,
        customerId: customer.pelanggan_id,
        customerName: customer.pelanggan_nama,
        phone,
        categoryName: category.category_nama,
      },
    };
  }

  async prepareFittingReminder(
    fittingId: number,
  ): Promise<NotificationPreparationResult> {
    const fitting = await this.legacyReadRepository.findFittingById(fittingId);
    if (!fitting?.tgl_coba) {
      return { decision: "SKIP", reason: "FITTING_DATA_INCOMPLETE" };
    }

    const customer = await this.legacyReadRepository.findCustomerById(
      fitting.pelanggan_id,
    );
    if (!customer) {
      return { decision: "SKIP", reason: "CUSTOMER_NOT_FOUND" };
    }

    const phone = customer.pelanggan_hp;
    if (!phone?.trim()) {
      return { decision: "SKIP", reason: "PHONE_MISSING" };
    }

    return {
      decision: "READY",
      candidate: {
        type: "FITTING_REMINDER",
        sourceId: fitting.fitting_id,
        orderId: fitting.order_id,
        customerId: customer.pelanggan_id,
        customerName: customer.pelanggan_nama,
        phone,
        fittingDate: fitting.tgl_coba,
      },
    };
  }
}
