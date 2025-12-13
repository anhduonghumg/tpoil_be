// src/common/auth/permissions.guard.ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Request } from 'express'
import { Session } from 'express-session'
import { PERMISSIONS_KEY } from './permissions.decorator'
import { AuthSessionData } from './auth-session.types'
interface RequestWithSessionAuth extends Request {
    session: Session & { auth?: AuthSessionData }
}

@Injectable()
export class PermissionsGuard implements CanActivate {
    constructor(private readonly reflector: Reflector) {}

    canActivate(context: ExecutionContext): boolean {
        const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [context.getHandler(), context.getClass()])

        // Nếu route không gắn @RequirePermissions => cho qua
        if (!requiredPermissions || requiredPermissions.length === 0) {
            return true
        }

        const request = context.switchToHttp().getRequest<RequestWithSessionAuth>()
        const auth = request.session?.auth

        if (!auth) {
            throw new ForbiddenException('Phiên đăng nhập không hợp lệ hoặc đã hết hạn')
        }

        const granted = new Set(auth.permissions)

        const ok = requiredPermissions.some((perm) => granted.has(perm))

        if (!ok) {
            throw new ForbiddenException('Bạn không có quyền thực hiện chức năng này')
        }

        return true
    }
}
