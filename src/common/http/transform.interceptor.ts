import { CallHandler, ExecutionContext, Injectable, NestInterceptor, StreamableFile } from "@nestjs/common";
import { Observable, map } from "rxjs";
import { SKIP_WRAP_KEY } from "./skip-wrap.decorator";
import type { ApiResponse } from "./http.types";
import { Reflector } from "@nestjs/core";

@Injectable()
export class TransformInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<any> {
    const isSkip = this.reflector.getAllAndOverride<boolean>(SKIP_WRAP_KEY, [ctx.getHandler(), ctx.getClass()]);
    const http = ctx.switchToHttp();
    const req = http.getRequest();
    const res = http.getResponse();

    return next.handle().pipe(
      map(body => {
        if (isSkip || body instanceof StreamableFile || Buffer.isBuffer(body) || typeof body === "string" || body?.__raw) return body;

        const statusCode = res.statusCode ?? 200;
        const payload: ApiResponse = {
          statusCode,
          success: statusCode < 400,
          timestamp: new Date().toISOString(),
          requestId: req?.id,
          data: body ?? null,
        };
        return payload;
      }),
    );
  }
}
