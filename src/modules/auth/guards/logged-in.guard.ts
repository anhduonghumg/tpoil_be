import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common'
import { Observable } from 'rxjs'

@Injectable()
export class LoggedInGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
        const req = context.switchToHttp().getRequest()
        if (req.isAuthenticated?.() === true) return true
        throw new UnauthorizedException({ code: 'SESSION_EXPIRED', message: 'Phiên làm việc đã hết hạn' })
    }
}
