// src/employees/dto/date.transform.ts
import { Transform } from 'class-transformer'
import dayjs from 'dayjs'

export const DMYtoDate = () =>
    Transform(({ value }) => {
        if (!value) return undefined
        if (value instanceof Date) return value
        const dmy = dayjs(value, 'DD-MM-YYYY', true)
        if (dmy.isValid()) return dmy.toDate()
        const iso = dayjs(value)
        return iso.isValid() ? iso.toDate() : undefined
    })
