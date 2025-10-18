import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { Logger } from 'nestjs-pino'
import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { TransformInterceptor } from './common/http/transform.interceptor'
import { HttpExceptionFilter } from './common/http/http-exception.filter'

import session from 'express-session'
import passport from 'passport'
import helmet from 'helmet'
import pgSession from 'connect-pg-simple'
import { Pool } from 'pg'

import 'dotenv/config'

async function bootstrap() {
    const app = await NestFactory.create(AppModule, { bufferLogs: true })
    app.setGlobalPrefix('api')

    app.enableCors({
        origin: ['http://localhost:5173'],
        credentials: true,
    })

    app.useLogger(app.get(Logger))
    app.use(helmet())
    const PgSession = pgSession(session)
    const pgPool = new Pool({
        connectionString: process.env.DATABASE_URL,
        // ssl: { rejectUnauthorized: false },
    })
    app.use(
        session({
            name: 'sid',
            secret: process.env.SESSION_SECRET!,
            store: new PgSession({
                pool: pgPool,
                tableName: 'session',
                schemaName: 'public',
                createTableIfMissing: true,
                pruneSessionInterval: 60 * 10,
                ttl: 60 * 60 * 8,
            }),
            resave: false,
            saveUninitialized: false,
            rolling: true,
            cookie: {
                httpOnly: true,
                secure: false, //process.env.NODE_ENV === "production"
                sameSite: 'lax', //process.env.NODE_ENV === "production" ? "none" : "lax",
                maxAge: 30 * 60 * 1000,
            },
        }),
    )

    app.use(passport.initialize())
    app.use(passport.session())

    app.useGlobalPipes(
        new ValidationPipe({
            whitelist: true,
            transform: true,
            exceptionFactory: (errors) => {
                const messages: string[] = []
                const fields: string[] = []
                for (const e of errors) {
                    fields.push(e.property)
                    if (e.constraints) messages.push(...Object.values(e.constraints))
                }
                return new BadRequestException({
                    code: 'VALIDATION_ERROR',
                    message: 'Dữ liệu không hợp lệ',
                    details: { messages, fields },
                })
            },
        }),
    )
    app.useGlobalInterceptors(new TransformInterceptor())
    app.useGlobalFilters(new HttpExceptionFilter())

    app.use(helmet())

    await app.listen(process.env.PORT ?? 3000)
}

bootstrap()
