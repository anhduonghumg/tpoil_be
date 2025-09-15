import type { Params } from "nestjs-pino";

const redactPaths = ["req.headers.authorization", "req.body.password", "req.body.currentPassword", "req.body.newPassword", "*.accessToken", "*.refreshToken", "*.authorization"];

export const pinoConfig: Params = {
  pinoHttp: {
    level: process.env.LOG_LEVEL ?? "info",
    autoLogging: {
      ignore: req => {
        const u = req.url || "";
        return u.startsWith("/health") || u.startsWith("/docs") || u.startsWith("/favicon");
      },
    },
    customLogLevel(_req, res, err) {
      if (err || res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
    customProps(req) {
      return {
        requestId: (req as any).id,
        userId: (req as any).user?.id ?? (req as any).user?.sub ?? null,
        env: process.env.NODE_ENV ?? "development",
      };
    },
    transport: process.env.NODE_ENV === "production" ? undefined : { target: "pino-pretty", options: { singleLine: true, translateTime: "SYS:standard" } },
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url,
          headers: {
            "user-agent": req.headers["user-agent"],
            "x-request-id": req.headers["x-request-id"],
          },
          params: req.params,
          query: req.query,
        };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
      err(err) {
        return { type: err?.name, message: err?.message };
      },
    },
    redact: { paths: redactPaths, censor: "[REDACTED]" },
  },
};
