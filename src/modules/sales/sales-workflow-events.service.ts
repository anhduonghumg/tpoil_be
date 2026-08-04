import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'

export type SalesWorkflowEntityType =
    | 'SALES_ORDER'
    | 'SALES_APPROVAL'
    | 'SALES_WITHDRAWAL'
    | 'SALES_DELIVERY'
    | 'SALES_INVOICE'
    | 'SALES_RECONCILIATION'

export type SalesWorkflowEventInput = {
    entityType: SalesWorkflowEntityType
    entityId: string
    eventType: string
    fromStatus?: string | null
    toStatus?: string | null
    actorId?: string | null
    reason?: string | null
    version?: number | null
    cycle?: number | null
    metadata?: Prisma.InputJsonObject
}

/**
 * Append-only business audit. Must be called with the SAME transaction client as the
 * state transition it records (spec v1.2 §3.10) — the HTTP AuditService uses its own
 * connection and cannot guarantee atomicity.
 */
@Injectable()
export class SalesWorkflowEventsService {
    record(tx: Pick<Prisma.TransactionClient, 'salesWorkflowEvent'>, input: SalesWorkflowEventInput) {
        return tx.salesWorkflowEvent.create({
            data: {
                entityType: input.entityType,
                entityId: input.entityId,
                eventType: input.eventType,
                fromStatus: input.fromStatus ?? null,
                toStatus: input.toStatus ?? null,
                actorId: input.actorId ?? null,
                reason: input.reason ?? null,
                version: input.version ?? null,
                cycle: input.cycle ?? null,
                metadata: input.metadata,
            },
        })
    }
}
