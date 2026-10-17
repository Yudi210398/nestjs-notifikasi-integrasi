import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { InternalApiKeyGuard } from "../guards/internal-api-key.guard";
import { OrderReadyTriggerService } from "../services/order-ready-trigger.service";

@ApiTags("Internal notifications")
@ApiBearerAuth()
@UseGuards(InternalApiKeyGuard)
@Controller("internal/notifications")
export class OrderReadyTriggerController {
  constructor(private readonly triggerService: OrderReadyTriggerService) {}

  @Post("order-ready")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Trigger an internal order-ready notification",
    description:
      'Call after the legacy order becomes exactly order_status = "Selesai". Send only orderId; NestJS rereads order, customer, phone, and category from the legacy database. A unique notification key prevents duplicate WhatsApp sends.',
  })
  @ApiBody({
    description:
      "Legacy order ID only. Customer data is read from the database.",
    schema: {
      type: "object",
      required: ["orderId"],
      additionalProperties: false,
      properties: {
        orderId: {
          type: "integer",
          minimum: 1,
          example: 123,
          description: "Legacy tbl_order.order_id (positive safe integer).",
        },
      },
    },
  })
  @ApiOkResponse({
    description:
      "SENT: Fonnte accepted the request, not confirmed WhatsApp delivery. DUPLICATE: identity already claimed. SKIPPED: not eligible or phone missing. FAILED: explicit provider rejection. AMBIGUOUS: delivery outcome uncertain; no automatic retry.",
    schema: {
      oneOf: [
        {
          type: "object",
          required: ["outcome"],
          additionalProperties: false,
          properties: {
            outcome: {
              type: "string",
              enum: ["SENT", "DUPLICATE", "FAILED", "AMBIGUOUS"],
              example: "SENT",
            },
          },
        },
        {
          type: "object",
          required: ["outcome", "reason"],
          additionalProperties: false,
          properties: {
            outcome: { type: "string", enum: ["SKIPPED"] },
            reason: {
              type: "string",
              enum: [
                "ORDER_NOT_FOUND",
                "ORDER_NOT_READY",
                "CUSTOMER_NOT_FOUND",
                "PHONE_MISSING",
                "CATEGORY_NOT_FOUND",
              ],
              example: "ORDER_NOT_READY",
            },
          },
        },
      ],
    },
  })
  @ApiBadRequestResponse({
    description: "Body must contain only a positive orderId.",
  })
  @ApiUnauthorizedResponse({
    description: "Authorization Bearer key is missing or invalid.",
  })
  @ApiServiceUnavailableResponse({
    description: "INTERNAL_API_KEY is not configured on the server.",
  })
  @ApiInternalServerErrorResponse({
    description:
      "Unexpected internal error before a business outcome is available.",
  })
  trigger(@Body() body: unknown) {
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new BadRequestException(
        "Body must contain only a positive orderId",
      );
    }

    const input = body as Record<string, unknown>;
    const orderId = input.orderId;
    if (
      Object.keys(input).length !== 1 ||
      typeof orderId !== "number" ||
      !Number.isSafeInteger(orderId) ||
      orderId <= 0
    ) {
      throw new BadRequestException(
        "Body must contain only a positive orderId",
      );
    }

    return this.triggerService.trigger(orderId);
  }
}
