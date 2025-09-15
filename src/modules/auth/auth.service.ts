import { Injectable } from "@nestjs/common";
import * as bcrypt from "bcrypt";
import { PinoLogger } from "nestjs-pino";
import { AppException } from "src/common/errors/app-exception";
import { PrismaService } from "src/infra/prisma/prisma.service";

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AuthService.name);
  }

  async validateUser(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) return null;
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return null;
    return { id: user.id, email: user.email, name: user.fullname };
  }

  async findUserById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, fullname: true, isActive: true },
    });
    if (!user) throw AppException.notFound("Không tìm thấy thông tin tài khoản trên hệ thống!", { id });
    if (!user.isActive) throw AppException.forbidden("User inactive", { id });
    return user;
  }

  async recordAttempt(email: string, ok: boolean, ip?: string, ua?: string) {
    try {
      await this.prisma.loginAttempt.create({ data: { email, ok, ip, ua } });
    } catch (e) {
      this.logger.warn({ msg: "record_attempt_failed", email, err: e?.message });
    }
  }

  async updateLastLogin(userId: string) {
    try {
      await this.prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
    } catch (e) {
      this.logger.warn({ msg: "update_last_login_failed", userId, err: e?.message });
    }
  }
}
