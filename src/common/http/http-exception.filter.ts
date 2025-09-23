/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from "@nestjs/common";
import type { ApiResponse } from "./http.types";
import { AppException } from "../errors/app-exception";
import { ErrCode } from "../errors/error-codes";
import { Prisma } from "@prisma/client";

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest() as any;
    const res = ctx.getResponse() as any;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: string = ErrCode.INTERNAL;
    let message = "Internal Server Error";
    let details: any;

    // 1) AppException của chúng ta
    if (exception instanceof AppException) {
      const body = exception.getResponse() as any;
      status = exception.getStatus();
      code = body?.code ?? exception.code ?? ErrCode.INTERNAL;
      message = body?.message ?? message;
      details = body?.details;
    }
    // 2) HttpException khác (Nest)
    else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();

      if (typeof body === "string") {
        message = body;
        code =
          status === 404
            ? ErrCode.NOT_FOUND
            : status === 401
              ? ErrCode.UNAUTHORIZED
              : status === 403
                ? ErrCode.FORBIDDEN
                : status === 429
                  ? ErrCode.RATE_LIMIT
                  : ErrCode.BAD_REQUEST;
      } else if (body && typeof body === "object") {
        const r: any = body;
        const msg = Array.isArray(r.message) ? "Validation failed" : (r.message ?? r.error ?? message);
        message = msg;

        if (Array.isArray(r.message)) {
          code = ErrCode.VALIDATION;
          details = { errors: r.message, source: "ValidationPipe" };
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
    // 3) Prisma known errors
    else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      status = HttpStatus.BAD_REQUEST;
      switch (exception.code) {
        case "P2002": // unique
          code = ErrCode.DB_DUPLICATE;
          message = "Duplicate value violates unique constraint";
          details = { target: (exception as any).meta?.target };
          break;
        case "P2003": // FK
          code = ErrCode.DB_FK;
          message = "Foreign key constraint failed";
          details = { field: (exception as any).meta?.field_name };
          break;
        case "P2025": // not found
          status = HttpStatus.NOT_FOUND;
          code = ErrCode.DB_NOT_FOUND;
          message = "Record not found";
          break;
        default:
          code = ErrCode.BAD_REQUEST;
          message = exception.message;
      }
    }
    // 4) Lỗi runtime khác
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
