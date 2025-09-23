import { ErrCode } from "../errors/error-codes";
import { ApiResponse } from "./http.types";

const now = () => new Date().toISOString();

export function success<T>(data: T, message = "OK", statusCode = 200, requestId?: string): ApiResponse<T> {
  return { statusCode, success: true, message, timestamp: now(), requestId, data };
}

export function created<T>(data: T, message = "Created", requestId?: string): ApiResponse<T> {
  return success(data, message, 201, requestId);
}

export function fail(code: ErrCode, message: string, statusCode = 400, details?: any, requestId?: string): ApiResponse {
  return {
    statusCode,
    success: false,
    message,
    timestamp: now(),
    requestId,
    error: { code, details },
  };
}

// Phân trang (tuỳ chọn)
export function paged<T>(
  items: T[],
  page: number,
  pageSize: number,
  total: number,
  message = "OK",
  requestId?: string,
): ApiResponse<{ items: T[]; page: number; pageSize: number; total: number }> {
  return success({ items, page, pageSize, total }, message, 200, requestId);
}
