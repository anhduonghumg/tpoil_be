import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from "@nestjs/common";
import { LoggedInGuard } from "./guards/logged-in.guard";
import { LoginDto } from "./dto/login.dto";
import { AuthService } from "./auth.service";
import { AppException } from "src/common/errors/app-exception";
import { AuthGuard } from "@nestjs/passport";
import { PinoLogger } from "nestjs-pino";

@Controller("auth")
export class AuthController {
  constructor(
    private auth: AuthService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AuthController.name);
  }

  @HttpCode(200)
  @UseGuards(AuthGuard("local"))
  @Post("login")
  async login(@Req() req, @Body() dto: LoginDto) {
    await new Promise((resolve, reject) => {
      req.login(req.user, err => {
        if (err) return reject(err);
        resolve(true);
      });
    });

    await this.auth.recordAttempt(dto.email, true, req.ip, req.headers["user-agent"] as string);
    await this.auth.updateLastLogin(req.user.id);
    // this.logger.info({ msg: "Đăng nhập thành công!", userId: req.user.id, email: dto.email });
    return { user: req.user };
  }

  @UseGuards(LoggedInGuard)
  @HttpCode(200)
  @Post("logout")
  async logout(@Req() req) {
    const uid = req.user?.id;
    return new Promise((resolve, reject) => {
      req.logout(err => {
        if (err) return reject(AppException.internal("Đăng xuất thất bại!", { err: String(err) }));
        req.session.destroy(e => {
          if (e) return reject(AppException.internal("Session destroy failed", { err: String(e) }));
          this.logger.info({ msg: "Đăng xuất thành công!", userId: uid });
          resolve({ ok: true });
        });
      });
    });
  }

  @UseGuards(LoggedInGuard)
  @Get("me")
  me(@Req() req) {
    return req.user;
  }
}
