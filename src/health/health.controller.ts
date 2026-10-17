import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";

@ApiTags("Health")
@Controller("health")
export class HealthController {
  @Get()
  @ApiOperation({
    summary: "Check service health",
    description: "Checks whether the NestJS notification service is running.",
  })
  @ApiOkResponse({
    description: "Service is running.",
    schema: {
      example: { status: "ok" },
    },
  })
  check() {
    return { status: "ok" };
  }
}
