import { Global, MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";
import { pinoConfig } from "./pino.config";
import { RequestIdMiddleware } from "./request-id.middleware";

@Global()
@Module({
  imports: [LoggerModule.forRoot(pinoConfig)],
  exports: [LoggerModule],
})
export class AppLoggingModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes("*");
  }
}
