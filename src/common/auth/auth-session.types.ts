// src/common/auth/auth-session.types.ts
import { ScopeType } from '@prisma/client'

export type EffectiveScope = {
    type: ScopeType
    scopeId?: string | null
}

export type AuthRole = {
    id: string
    code: string
    name: string
}

export type AuthSessionData = {
    userId: string
    username: string
    email: string
    employeeId?: string | null
    roles: AuthRole[]
    permissions: string[]
    scopes: EffectiveScope[]
}
