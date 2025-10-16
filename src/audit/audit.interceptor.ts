import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common'
import { Observable, catchError, of, switchMap, tap, throwError } from 'rxjs'
import { AuditService } from './audit.service'
import { Reflector } from '@nestjs/core'
import { MODULE_KEY } from '../common/decorators/module-name.decorator'
import { PrismaService } from 'src/infra/prisma/prisma.service'

function actionFrom(method: string) {
    switch (method) {
        case 'POST':
            return 'create'
        case 'PATCH':
            return 'update'
        case 'DELETE':
            return 'delete'
        default:
            return null
    }
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
    constructor(
        private readonly audit: AuditService,
        private readonly prisma: PrismaService,
        private readonly reflector: Reflector,
    ) {}

    intercept(ctx: ExecutionContext, next: CallHandler): Observable<any> {
        const req = ctx.switchToHttp().getRequest<any>()
        const res = ctx.switchToHttp().getResponse<any>()

        const method = req.method as string
        const action = actionFrom(method)
        if (!action) return next.handle()

        // Lấy moduleCode từ decorator
        const moduleCode = this.reflector.get<string>(MODULE_KEY, ctx.getHandler()) ?? this.reflector.get<string>(MODULE_KEY, ctx.getClass())
        if (!moduleCode) return next.handle()

        // Lấy trước dữ liệu "before" nếu có id
        const id: string | undefined = req.params?.id
        const before$ = id ? this.pickBefore(moduleCode, id) : Promise.resolve(null)

        return of(before$).pipe(
            switchMap((before) =>
                next.handle().pipe(
                    tap(async (result) => {
                        await this.audit.write({
                            requestId: req.id || res.getHeader?.('x-request-id'),
                            userId: req.user?.id ?? null,
                            ip: req.ip,
                            ua: req.headers['user-agent'],
                            method,
                            path: req.originalUrl || req.url,
                            statusCode: res.statusCode ?? 200,

                            moduleCode,
                            action,
                            entityId: (id || result?.id) ?? null,

                            before,
                            after: action === 'delete' ? null : result,
                        })
                    }),
                    catchError((err) => {
                        const status = err?.status ?? 500
                        this.audit
                            .write({
                                requestId: req.id || res.getHeader?.('x-request-id'),
                                userId: req.user?.id ?? null,
                                ip: req.ip,
                                ua: req.headers['user-agent'],
                                method,
                                path: req.originalUrl || req.url,
                                statusCode: status,

                                moduleCode,
                                action,
                                entityId: id ?? undefined,

                                before,
                                after: null,
                                error: { name: err?.name, message: err?.message },
                            })
                            .catch(() => void 0)
                        return throwError(() => err)
                    }),
                ),
            ),
        )
    }

    // Tối giản: chỉ cần case department cho module hiện tại.
    private async pickBefore(moduleCode: string, id: string) {
        if (moduleCode === 'department') {
            return this.prisma.department.findUnique({ where: { id } })
        } else if (moduleCode === 'employee') {
            return this.prisma.employee.findUnique({ where: { id } })
        }
        return null
    }
}
