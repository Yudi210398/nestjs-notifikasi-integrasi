import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { NotificationLogPrismaService } from "../prisma/notification-log-prisma.service";
import type { NotificationCandidate } from "./notification.service";

export type NotificationIdentity = {
  notificationKey: string;
  type: NotificationCandidate["type"];
  sourceId: number;
};

type ClaimResult = { claimed: true; id: number } | { claimed: false };
type SkippedResult = { recorded: true; id: number } | { recorded: false };

function isDuplicateKey(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

@Injectable()
export class NotificationLogRepository {
  constructor(private readonly prisma: NotificationLogPrismaService) {}

  async claimPending(identity: NotificationIdentity): Promise<ClaimResult> {
    try {
      const log = await this.prisma.notificationLog.create({
        data: { ...identity, status: "PENDING" },
        select: { id: true },
      });
      return { claimed: true, id: log.id };
    } catch (error) {
      if (isDuplicateKey(error)) {
        return { claimed: false };
      }
      throw error;
    }
  }

  async recordSkipped(
    identity: NotificationIdentity & { reason: string },
  ): Promise<SkippedResult> {
    try {
      const log = await this.prisma.notificationLog.create({
        data: { ...identity, status: "SKIPPED" },
        select: { id: true },
      });
      return { recorded: true, id: log.id };
    } catch (error) {
      if (isDuplicateKey(error)) {
        return { recorded: false };
      }
      throw error;
    }
  }

  markSent(id: number): Promise<void> {
    return this.markFinalStatus(id, "SENT", null);
  }

  markFailed(id: number, reason: string): Promise<void> {
    return this.markFinalStatus(id, "FAILED", reason);
  }

  markAmbiguous(id: number, reason: string): Promise<void> {
    return this.markFinalStatus(id, "AMBIGUOUS", reason);
  }

  private async markFinalStatus(
    id: number,
    status: "SENT" | "FAILED" | "AMBIGUOUS",
    reason: string | null,
  ): Promise<void> {
    const result = await this.prisma.notificationLog.updateMany({
      where: { id, status: "PENDING" },
      data: { status, reason },
    });
    if (result.count !== 1) {
      throw new Error("NotificationLog PENDING not found");
    }
  }
}
