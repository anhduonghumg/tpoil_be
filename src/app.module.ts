import { PrismaModule } from "./infra/prisma/prisma.module";
import { AuthModule } from "./modules/auth/auth.module";
import { AuthController } from "./modules/auth/auth.controller";
import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { AppLoggingModule } from "./infra/logging/logging.module";
import { LoggingInterceptor } from "./common/interceptors/logging.interceptor";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";

@Module({
  imports: [PrismaModule, AuthModule, AppLoggingModule],
  controllers: [AuthController, AppController],
  providers: [AppService, LoggingInterceptor, AllExceptionsFilter],
})
export class AppModule {}
