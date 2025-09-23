import { Module } from "@nestjs/common";
import { PassportModule } from "@nestjs/passport";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { LocalStrategy } from "./strategies/local.strategy";
import { SessionSerializer } from "./session.serializer";
import { PrismaModule } from "src/infra/prisma/prisma.module";

@Module({
  imports: [PrismaModule, PassportModule.register({ session: true })],
  providers: [AuthService, LocalStrategy, SessionSerializer],
  controllers: [AuthController],
  exports: [AuthService, PassportModule],
})
export class AuthModule {}
