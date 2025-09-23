import { NestFactory, Reflector } from "@nestjs/core";
import { AppModule } from "./app.module";
import { Logger } from "nestjs-pino";
import { ValidationPipe } from "@nestjs/common";
import { TransformInterceptor } from "./common/http/transform.interceptor";
import { HttpExceptionFilter } from "./common/http/http-exception.filter";

import session from "express-session";
import passport from "passport";
import helmet from "helmet";
import pgSession from "connect-pg-simple";
import { Pool } from "pg";

import "dotenv/config";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.setGlobalPrefix("api");

  app.enableCors({
    origin: ["http://localhost:5173"],
    credentials: true,
  });

  app.useLogger(app.get(Logger));
  app.use(helmet());
  const PgSession = pgSession(session);
  const pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // ssl: { rejectUnauthorized: false },
  });
  app.use(
    session({
      name: "sid",
      secret: process.env.SESSION_SECRET!,
      resave: false,
      saveUninitialized: false,
      store: new PgSession({
        pool: pgPool,
        tableName: "session",
        schemaName: "public",
        createTableIfMissing: true,
        pruneSessionInterval: 60 * 10,
      }),
      cookie: {
        httpOnly: true,
        secure: false, //process.env.NODE_ENV === "production"
        sameSite: "lax", //process.env.NODE_ENV === "production" ? "none" : "lax",
        maxAge: 1000 * 60 * 60 * 8,
      },
    }),
  );

  app.use(passport.initialize());
  app.use(passport.session());

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalInterceptors(new TransformInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());

  await app.listen(process.env.PORT ?? 3000);
}

bootstrap();
