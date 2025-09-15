/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from "@nestjs/common";
// import { ValidationError } from "class-validator";
import type { ApiResponse } from "./http.types";
import { AppException } from "../errors/app-exception";
import { ErrCode } from "../errors/error-codes";

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest();
    const res = ctx.getResponse();

    // ===== 1) Mặc định =====
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: string = ErrCode.INTERNAL;
    let message = "Internal Server Error";
    let details: any;

    // ===== 2) AppException của chúng ta =====
    if (exception instanceof AppException) {
      const body = exception.getResponse() as any;
      status = exception.getStatus();
      code = body?.code ?? exception.code ?? ErrCode.INTERNAL;
      message = body?.message ?? message;
      details = body?.details;
    }
    // ===== 3) HttpException khác (Nest mặc định) =====
    else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();

      if (typeof body === "string") {
        message = body;
        code = status === 404 ? ErrCode.NOT_FOUND : status === 401 ? ErrCode.UNAUTHORIZED : ErrCode.BAD_REQUEST;
      } else if (body && typeof body === "object") {
        const r: any = body;

        // Nest ValidationPipe thường trả { message: string[] | string, error: 'Bad Request' }
        const msg = Array.isArray(r.message) ? "Validation failed" : (r.message ?? r.error ?? message);
        message = msg;

        // Nếu có mảng lỗi -> map thành details và set code VALIDATION
        if (Array.isArray(r.message)) {
          code = ErrCode.VALIDATION;
          details = { errors: r.message };
        } else {
          code =
            status === 404
              ? ErrCode.NOT_FOUND
              : status === 401
                ? ErrCode.UNAUTHORIZED
                : status === 403
                  ? ErrCode.FORBIDDEN
                  : status === 409
                    ? ErrCode.CONFLICT
                    : status === 429
                      ? ErrCode.RATE_LIMIT
                      : ErrCode.BAD_REQUEST;
          details = r.details ?? r.errors ?? undefined;
        }
      }
    }
    // ===== 4) Lỗi runtime khác =====
    else if (exception instanceof Error) {
      message = exception.message || message;
    }

    const payload: ApiResponse = {
      statusCode: status,
      success: false,
      message,
      timestamp: new Date().toISOString(),
      requestId: req?.id,
      error: { code, details },
    };

    res.status(status).json(payload);
  }
}
