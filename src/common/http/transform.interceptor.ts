import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Observable, map } from "rxjs";
import { ApiResponse } from "./http.types";

@Injectable()
export class TransformInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<any> {
    const req = ctx.switchToHttp().getRequest() as any;
    const requestId: string | undefined = req?.id;

    return next.handle().pipe(
      map((payload: any): ApiResponse => {
        // Nếu service đã trả ApiResponse → giữ nguyên
        if (payload && typeof payload === "object" && "success" in payload && "statusCode" in payload) {
          // gắn requestId nếu thiếu
          if (!payload.requestId && requestId) payload.requestId = requestId;
          return payload;
        }
        // Mặc định bọc payload vào success=true
        return {
          statusCode: 200,
          success: true,
          message: "OK",
          timestamp: new Date().toISOString(),
          requestId,
          data: payload,
        };
      }),
    );
  }
}
