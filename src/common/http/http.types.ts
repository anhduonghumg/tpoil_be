export interface ApiResponse<T = unknown> {
  statusCode: number;
  success: boolean;
  message?: string;
  requestId?: string;
  timestamp: string;
  data?: T;
  error?: { code: string; details?: any };
  meta?: Record<string, any>;
}
export interface PageMeta {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
}
export interface Paginated<T> {
  items: T[];
  meta: PageMeta;
}
