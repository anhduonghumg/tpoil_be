/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from "@nestjs/common";
import { Request, Response } from "express";
import { ApiResponse } from "../http/http.types";

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    let message = "Internal Server Error";
    let code = "INTERNAL_ERROR";
    let details: any;

    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      if (typeof response === "string") {
        message = response;
      } else if (typeof response === "object") {
        const r: any = response;
        message = r.message || message;
        code = r.code || code;
        details = r.details ?? r.errors ?? undefined;
      }
    } else if (exception instanceof Error) {
      message = exception.message || message;
    }

    const body: ApiResponse = {
      statusCode: status,
      success: false,
      message,
      timestamp: new Date().toISOString(),
      requestId: (req as any)?.id,
      error: { code, details },
    };

    res.status(status).json(body);
  }
}
