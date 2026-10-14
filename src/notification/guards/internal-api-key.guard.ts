import { timingSafeEqual } from "node:crypto";
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class InternalApiKeyGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.configService.get<string>("INTERNAL_API_KEY")?.trim();
    if (!expected) {
      throw new ServiceUnavailableException(
        "Internal authentication unavailable",
      );
    }

    const authorization = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
    }>().headers.authorization;
    const match = /^Bearer ([^\s]+)$/.exec(authorization ?? "");
    if (!match) {
      throw new UnauthorizedException();
    }

    const actualKey = Buffer.from(match[1]);
    const expectedKey = Buffer.from(expected);
    if (
      actualKey.length !== expectedKey.length ||
      !timingSafeEqual(actualKey, expectedKey)
    ) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
