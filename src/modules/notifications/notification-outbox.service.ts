import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'

export type NotificationEventInput = {
    eventType: string
    aggregateType: string
    aggregateId: string
    dedupeKey: string
    payload: Prisma.InputJsonObject
}

type OutboxClient = Pick<Prisma.TransactionClient, 'notificationOutbox'>

@Injectable()
export class NotificationOutboxService {
    constructor(private readonly prisma: PrismaService) {}

    emit(input: NotificationEventInput, tx?: OutboxClient) {
        const client = tx ?? this.prisma
        return client.notificationOutbox.upsert({
            where: { dedupeKey: input.dedupeKey },
            create: {
                eventType: input.eventType,
                aggregateType: input.aggregateType,
                aggregateId: input.aggregateId,
                dedupeKey: input.dedupeKey,
                payload: input.payload,
            },
            update: {},
        })
    }
}

