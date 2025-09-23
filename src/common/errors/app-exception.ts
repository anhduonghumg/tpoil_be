import { HttpException, HttpStatus } from "@nestjs/common";
import { ErrCode } from "./error-codes";

export type AppErrorDetails = unknown;

export class AppException extends HttpException {
  constructor(
    message: string,
    public readonly code: string,
    status: number = HttpStatus.BAD_REQUEST,
    public readonly details?: any,
  ) {
    super({ message, code, details }, status);
  }

  // ======= Factory helpers (ngắn gọn – dễ dùng) =======
  static badRequest(message = "Bad request", details?: AppErrorDetails) {
    return new AppException(ErrCode.BAD_REQUEST, message, HttpStatus.BAD_REQUEST, details);
  }
  static validation(details?: AppErrorDetails, message = "Validation failed") {
    return new AppException(ErrCode.VALIDATION, message, HttpStatus.BAD_REQUEST, details);
  }
  static unauthorized(message = "Unauthorized", details?: AppErrorDetails) {
    return new AppException(ErrCode.UNAUTHORIZED, message, HttpStatus.UNAUTHORIZED, details);
  }
  static forbidden(message = "Forbidden", details?: AppErrorDetails) {
    return new AppException(ErrCode.FORBIDDEN, message, HttpStatus.FORBIDDEN, details);
  }
  static notFound(message = "Not found", details?: AppErrorDetails) {
    return new AppException(ErrCode.NOT_FOUND, message, HttpStatus.NOT_FOUND, details);
  }
  static conflict(message = "Conflict", details?: AppErrorDetails) {
    return new AppException(ErrCode.CONFLICT, message, HttpStatus.CONFLICT, details);
  }
  static rateLimit(message = "Too many requests", details?: AppErrorDetails) {
    return new AppException(ErrCode.RATE_LIMIT, message, HttpStatus.TOO_MANY_REQUESTS, details);
  }
  static internal(message = "Internal error", details?: AppErrorDetails) {
    return new AppException(ErrCode.INTERNAL, message, HttpStatus.INTERNAL_SERVER_ERROR, details);
  }
}
