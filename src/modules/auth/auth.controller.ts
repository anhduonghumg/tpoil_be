import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common'
import { LoggedInGuard } from './guards/logged-in.guard'
import { LoginDto } from './dto/login.dto'
import { AuthService } from './auth.service'
import { AuthGuard } from '@nestjs/passport'
import { PinoLogger } from 'nestjs-pino'
// import path from 'path'

@Controller('auth')
export class AuthController {
    constructor(
        private auth: AuthService,
        private readonly logger: PinoLogger,
    ) {
        this.logger.setContext(AuthController.name)
    }

    @HttpCode(200)
    @UseGuards(AuthGuard('local'))
    @Post('login')
    async login(@Req() req, @Body() dto: LoginDto) {
        await new Promise((resolve, reject) => {
            req.login(req.user, (err) => {
                if (err) return reject(err)
                resolve(true)
            })
        })

        await this.auth.recordAttempt(dto.email, true, req.ip, req.headers['user-agent'] as string)
        await this.auth.updateLastLogin(req.user.id)
        // this.logger.info({ msg: "Đăng nhập thành công!", userId: req.user.id, email: dto.email });

        try {
            const authSession = await this.auth.buildAuthSession(req.user.id)
            if (req.session) {
                req.session.auth = authSession
            }
        } catch (e) {
            this.logger.error({ msg: 'build_auth_session_failed', userId: req.user.id, err: e?.message })
            throw e
        }

        return { user: req.user }
    }

    @HttpCode(200)
    @Post('logout')
    async logout(@Req() req, @Res({ passthrough: true }) res) {
        const sidName = 'sid'
        await new Promise<void>((resolve) => req.logout(() => resolve()))
        await new Promise<void>((resolve) => req.session?.destroy(() => resolve()))
        // Xoá cookie phía client (khớp option trong main.ts)
        res?.clearCookie(sidName, { httpOnly: true, sameSite: 'lax', secure: false })
        return { ok: true }
    }

    @UseGuards(LoggedInGuard)
    @Get('me')
    me(@Req() req) {
        return req.user
    }
}
