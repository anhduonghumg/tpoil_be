import { Injectable } from '@nestjs/common'
import * as bcrypt from 'bcrypt'
import { PinoLogger } from 'nestjs-pino'
import { AppException } from 'src/common/errors/app-exception'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { AuthSessionData } from 'src/common/auth/auth-session.types'
import { RbacService } from '../rbac/rbac.service'

@Injectable()
export class AuthService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbacService: RbacService,
        private readonly logger: PinoLogger,
    ) {
        this.logger.setContext(AuthService.name)
    }

    /**
     * Được LocalStrategy gọi để validate tài khoản đăng nhập
     */
    // async validateUser(identifier: string, password: string): Promise<{ id: string; email: string; name: string | null } | null> {
    //     const user = await this.prisma.user.findUnique({ where: { identifier } })

    //     if (!user || !user.isActive) {
    //         return null
    //     }

    //     const ok = await bcrypt.compare(password, user.password)
    //     if (!ok) {
    //         return null
    //     }

    //     // Chỉ trả thông tin cơ bản cho Passport, không nhét quyền vào đây
    //     return { id: user.id, email: user.email, name: user.name }
    // }

    async validateUser(identifier: string, password: string): Promise<{ id: string; email: string; name: string | null } | null> {
        const idf = identifier?.trim()
        if (!idf) return null

        const user = await this.prisma.user.findFirst({
            where: {
                OR: [{ email: idf }, { username: idf }],
            },
            select: { id: true, email: true, username: true, name: true, password: true, isActive: true },
        })

        if (!user || !user.isActive) return null

        const ok = await bcrypt.compare(password, user.password)
        if (!ok) return null

        // Passport session: trả tối thiểu
        return { id: user.id, email: user.email, name: user.name }
    }

    async findUserById(id: string) {
        const user = await this.prisma.user.findUnique({
            where: { id },
            select: { id: true, email: true, name: true, isActive: true },
        })

        if (!user) {
            throw AppException.notFound('Không tìm thấy thông tin tài khoản trên hệ thống!', { id })
        }

        if (!user.isActive) {
            throw AppException.forbidden('User inactive', { id })
        }

        return user
    }

    async recordAttempt(email: string, ok: boolean, username: string, ip?: string, ua?: string): Promise<void> {
        try {
            await this.prisma.loginAttempt.create({ data: { email, ok, ip, ua, username } })
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e)
            this.logger.warn({ msg: 'record_attempt_failed', email, err: message })
        }
    }

    // async recordAttempt(identifier: string, ok: boolean, ip?: string, ua?: string): Promise<void> {
    //     try {
    //         await this.prisma.loginAttempt.create({
    //             data: {
    //                 username: identifier,
    //                 email: identifier,
    //                 ok,
    //                 ip,
    //                 ua,
    //             },
    //         })
    //     } catch (e: unknown) {
    //         const message = e instanceof Error ? e.message : String(e)
    //         this.logger.warn({ msg: 'record_attempt_failed', identifier, err: message })
    //     }
    // }

    async updateLastLogin(userId: string): Promise<void> {
        try {
            await this.prisma.user.update({
                where: { id: userId },
                data: { lastLoginAt: new Date() },
            })
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e)
            this.logger.warn({ msg: 'update_last_login_failed', userId, err: message })
        }
    }

    /**
     * Build AuthSessionData (roles + permissions + scopes) từ userId
     */
    async buildAuthSession(userId: string): Promise<AuthSessionData> {
        const auth = await this.rbacService.buildAuthSession(userId)

        if (!auth) {
            throw AppException.forbidden('Tài khoản không có quyền hoặc đã bị vô hiệu hoá', { userId })
        }

        return auth
    }
}
