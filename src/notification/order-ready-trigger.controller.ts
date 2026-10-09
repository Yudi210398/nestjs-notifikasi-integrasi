import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiTags } from "@nestjs/swagger";
import { InternalApiKeyGuard } from "./internal-api-key.guard";
import { OrderReadyTriggerService } from "./order-ready-trigger.service";

@ApiTags("Internal notifications")
@ApiBearerAuth()
@UseGuards(InternalApiKeyGuard)
@Controller("internal/notifications")
export class OrderReadyTriggerController {
  constructor(private readonly triggerService: OrderReadyTriggerService) {}

  @Post("order-ready")
  @HttpCode(HttpStatus.OK)
  @ApiBody({
    schema: {
      type: "object",
      required: ["orderId"],
      additionalProperties: false,
      properties: { orderId: { type: "integer", minimum: 1 } },
    },
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
