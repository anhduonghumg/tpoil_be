import { Injectable, NestMiddleware } from "@nestjs/common";
import { v4 as uuid } from "uuid";

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: any, res: any, next: () => void) {
    const rid = (req.headers["x-request-id"] as string) || uuid();
    req.id = rid;
    res.setHeader("x-request-id", rid);
    next();
  }
}
