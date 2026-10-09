import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

const FONNTE_SEND_URL = "https://api.fonnte.com/send";
const REQUEST_TIMEOUT_MS = 10_000;

export type FonnteSendResult =
  | {
      outcome: "SUCCESS";
      providerRequestId?: number;
      providerMessageIds: string[];
    }
  | {
      outcome: "DEFINITE_FAILURE";
      reason: "PROVIDER_REJECTED";
      providerRequestId?: number;
    }
  | {
      outcome: "AMBIGUOUS";
      reason: "TIMEOUT" | "NETWORK_ERROR" | "UNCONFIRMED_RESPONSE";
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimeout(error: unknown): boolean {
  return (
    isRecord(error) &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

@Injectable()
export class FonnteWhatsappService {
  constructor(private readonly configService: ConfigService) {}

  async send(phone: string, message: string): Promise<FonnteSendResult> {
    const token = this.configService.get<string>("FONNTE_TOKEN")?.trim();
    if (!token) {
      throw new Error("FONNTE_TOKEN is not configured");
    }

    const body = new FormData();
    body.append("target", phone);
    body.append("message", message);

    let response: Response;
    try {
      response = await fetch(FONNTE_SEND_URL, {
        method: "POST",
        headers: { Authorization: token },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      return {
        outcome: "AMBIGUOUS",
        reason: isTimeout(error) ? "TIMEOUT" : "NETWORK_ERROR",
      };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      return {
        outcome: "AMBIGUOUS",
        reason: isTimeout(error) ? "TIMEOUT" : "UNCONFIRMED_RESPONSE",
      };
    }

    if (!isRecord(payload)) {
      return { outcome: "AMBIGUOUS", reason: "UNCONFIRMED_RESPONSE" };
    }

    const providerRequestId =
      typeof payload.requestid === "number" ? payload.requestid : undefined;
    const requestMetadata =
      providerRequestId === undefined ? {} : { providerRequestId };

    if (payload.status === false || payload.Status === false) {
      return {
        outcome: "DEFINITE_FAILURE",
        reason: "PROVIDER_REJECTED",
        ...requestMetadata,
      };
    }

    if (response.ok && payload.status === true) {
      return {
        outcome: "SUCCESS",
        providerMessageIds: Array.isArray(payload.id)
          ? payload.id.filter((id): id is string => typeof id === "string")
          : [],
        ...requestMetadata,
      };
    }

    return { outcome: "AMBIGUOUS", reason: "UNCONFIRMED_RESPONSE" };
  }
}
