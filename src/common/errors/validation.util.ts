import { ValidationError } from 'class-validator'

export function flattenValidationErrors(errors: ValidationError[]) {
    const out: Record<string, string[]> = {}

    const walk = (err: ValidationError, path = err.property) => {
        if (err.constraints) {
            out[path] = Object.values(err.constraints)
        }
        if (err.children?.length) {
            err.children.forEach((c) => walk(c, `${path}.${c.property}`))
        }
    }

    errors.forEach((e) => walk(e))
    return out
}
