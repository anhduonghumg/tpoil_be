import type { ApiResponse, Paginated, PageMeta } from "./http.types";

export const pageMeta = (page: number, limit: number, totalItems: number): PageMeta => ({
  page,
  limit,
  totalItems,
  totalPages: Math.max(1, Math.ceil(totalItems / Math.max(1, limit))),
});
export const paginate = <T>(items: T[], meta: PageMeta): Paginated<T> => ({ items, meta });

export const ok = <T>(data: T, meta?: Record<string, any>): ApiResponse<T> => ({
  statusCode: 200,
  success: true,
  timestamp: new Date().toISOString(),
  data,
  meta,
});
export const created = <T>(data: T): ApiResponse<T> => ({
  statusCode: 201,
  success: true,
  timestamp: new Date().toISOString(),
  data,
});
export const noContent = (): ApiResponse<null> => ({
  statusCode: 204,
  success: true,
  timestamp: new Date().toISOString(),
  data: null,
});
