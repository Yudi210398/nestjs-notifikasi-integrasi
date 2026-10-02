import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";

@ApiTags("Health")
@Controller("health")
export class HealthController {
  @Get()
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
