import { Strategy } from 'passport-local'
import { PassportStrategy } from '@nestjs/passport'
import { Injectable } from '@nestjs/common'
import { AuthService } from '../auth.service'
import { AppException } from 'src/common/errors/app-exception'

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
    constructor(private auth: AuthService) {
        super({ usernameField: 'identifier' })
    }

    async validate(identifier: string, password: string) {
        const user = await this.auth.validateUser(identifier, password)
        if (!user) throw AppException.unauthorized('Invalid credentials', { identifier })
        return user
    }
}
