import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";
import { Observable, tap } from "rxjs";

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: PinoLogger) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<any> {
    const started = Date.now();
    const req = ctx.switchToHttp().getRequest();
    const { method, url } = req;

    this.logger.debug({ msg: "HTTP start", method, url });

    return next.handle().pipe(
      tap({
        next: () => this.logger.info({ msg: "HTTP completed", method, url, duration_ms: Date.now() - started }),
        error: err =>
          this.logger.error({
            msg: "HTTP failed",
            method,
            url,
            duration_ms: Date.now() - started,
            err: { name: err?.name, message: err?.message },
          }),
      }),
    );
  }
}
