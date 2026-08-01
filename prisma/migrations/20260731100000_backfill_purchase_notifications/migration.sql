-- Seed only current actionable states. Historical completed actions are deliberately
-- excluded so users do not receive a flood of old notifications after deployment.

INSERT INTO "NotificationOutbox" (
    "id", "eventType", "aggregateType", "aggregateId", "dedupeKey",
    "payload", "status", "attempts", "availableAt", "createdAt", "updatedAt"
)
SELECT
    uuid_generate_v7(),
    'purchase.order.pending_approval',
    'COMMERCIAL_PURCHASE',
    po."id"::text,
    'purchase.order.pending_approval:' || po."id"::text,
    jsonb_build_object(
        'entityType', 'COMMERCIAL_PURCHASE',
        'entityId', po."id"::text,
        'orderNo', po."orderNo",
        'actionRequired', true,
        'recipientPermissionCodes', jsonb_build_array('purchases.approve')
    ),
    'PENDING'::"NotificationOutboxStatus",
    0,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "PurchaseOrder" po
WHERE po."orderType" = 'LOT'
  AND po."bizType" = 'COMMERCIAL'
  AND po."status" = 'DRAFT'
ON CONFLICT ("dedupeKey") DO NOTHING;

INSERT INTO "NotificationOutbox" (
    "id", "eventType", "aggregateType", "aggregateId", "dedupeKey",
    "payload", "status", "attempts", "availableAt", "createdAt", "updatedAt"
)
SELECT
    uuid_generate_v7(),
    'purchase.invoice.posted',
    'COMMERCIAL_PURCHASE_INVOICE',
    inv."id"::text,
    'purchase.invoice.posted:' || inv."id"::text,
    jsonb_build_object(
        'entityType', 'COMMERCIAL_PURCHASE',
        'entityId', po."id"::text,
        'orderNo', po."orderNo",
        'invoiceNo', inv."invoiceNo",
        'recipientUserIds',
            CASE WHEN po."createdById" IS NULL
                THEN '[]'::jsonb
                ELSE jsonb_build_array(po."createdById"::text)
            END,
        'recipientPermissionPrefixes', jsonb_build_array('purchases.')
    ),
    'PENDING'::"NotificationOutboxStatus",
    0,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "SupplierInvoice" inv
JOIN "PurchaseOrder" po ON po."id" = inv."purchaseOrderId"
WHERE po."orderType" = 'LOT'
  AND po."bizType" = 'COMMERCIAL'
  AND inv."status" = 'POSTED'
  AND NOT EXISTS (
      SELECT 1
      FROM "PurchaseTermPaymentRequest" pr
      WHERE pr."supplierInvoiceId" = inv."id"
        AND pr."status" <> 'CANCELLED'
  )
ON CONFLICT ("dedupeKey") DO NOTHING;

INSERT INTO "NotificationOutbox" (
    "id", "eventType", "aggregateType", "aggregateId", "dedupeKey",
    "payload", "status", "attempts", "availableAt", "createdAt", "updatedAt"
)
SELECT
    uuid_generate_v7(),
    'purchase.payment.approval_requested',
    'COMMERCIAL_PURCHASE_PAYMENT',
    pr."id"::text,
    'purchase.payment.approval_requested:' || pr."id"::text,
    jsonb_build_object(
        'entityType', 'COMMERCIAL_PURCHASE',
        'entityId', po."id"::text,
        'workItemSourceType', 'COMMERCIAL_PURCHASE_PAYMENT',
        'workItemSourceId', pr."id"::text,
        'orderNo', po."orderNo",
        'requestNo', pr."requestNo",
        'actionRequired', true,
        'recipientPermissionCodes', jsonb_build_array('purchases.payment_requests.approve')
    ),
    'PENDING'::"NotificationOutboxStatus",
    0,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "PurchaseTermPaymentRequest" pr
JOIN "PurchaseOrder" po ON po."id" = pr."purchaseOrderId"
WHERE po."orderType" = 'LOT'
  AND po."bizType" = 'COMMERCIAL'
  AND pr."supplierInvoiceId" IS NOT NULL
  AND pr."status" = 'PENDING_DIRECTOR_APPROVAL'
ON CONFLICT ("dedupeKey") DO NOTHING;

INSERT INTO "NotificationOutbox" (
    "id", "eventType", "aggregateType", "aggregateId", "dedupeKey",
    "payload", "status", "attempts", "availableAt", "createdAt", "updatedAt"
)
SELECT
    uuid_generate_v7(),
    'purchase.payment.approved',
    'COMMERCIAL_PURCHASE_PAYMENT',
    pr."id"::text,
    'purchase.payment.approved:' || pr."id"::text || ':backfill',
    jsonb_build_object(
        'entityType', 'COMMERCIAL_PURCHASE',
        'entityId', po."id"::text,
        'workItemSourceType', 'COMMERCIAL_PURCHASE_PAYMENT',
        'workItemSourceId', pr."id"::text,
        'orderNo', po."orderNo",
        'requestNo', pr."requestNo",
        'recipientPermissionPrefixes', jsonb_build_array('banking.')
    ),
    'PENDING'::"NotificationOutboxStatus",
    0,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "PurchaseTermPaymentRequest" pr
JOIN "PurchaseOrder" po ON po."id" = pr."purchaseOrderId"
WHERE po."orderType" = 'LOT'
  AND po."bizType" = 'COMMERCIAL'
  AND pr."supplierInvoiceId" IS NOT NULL
  AND pr."status" = 'SUBMITTED'
ON CONFLICT ("dedupeKey") DO NOTHING;

INSERT INTO "NotificationOutbox" (
    "id", "eventType", "aggregateType", "aggregateId", "dedupeKey",
    "payload", "status", "attempts", "availableAt", "createdAt", "updatedAt"
)
SELECT
    uuid_generate_v7(),
    CASE
        WHEN pr."status" = 'DIRECTOR_REJECTED' THEN 'purchase.payment.rejected'
        ELSE 'purchase.payment.bank_returned'
    END,
    'COMMERCIAL_PURCHASE_PAYMENT',
    pr."id"::text,
    CASE
        WHEN pr."status" = 'DIRECTOR_REJECTED'
            THEN 'purchase.payment.rejected:' || pr."id"::text || ':backfill'
        ELSE 'purchase.payment.bank_returned:' || pr."id"::text || ':backfill'
    END,
    jsonb_build_object(
        'entityType', 'COMMERCIAL_PURCHASE',
        'entityId', po."id"::text,
        'workItemSourceType', 'COMMERCIAL_PURCHASE_PAYMENT',
        'workItemSourceId', pr."id"::text,
        'orderNo', po."orderNo",
        'requestNo', pr."requestNo",
        'returnedReason', COALESCE(pr."returnedReason", pr."approvalNote", 'Vui lòng kiểm tra lại đề nghị thanh toán.'),
        'actionRequired', true,
        'recipientUserIds',
            CASE WHEN po."createdById" IS NULL
                THEN '[]'::jsonb
                ELSE jsonb_build_array(po."createdById"::text)
            END
    ),
    'PENDING'::"NotificationOutboxStatus",
    0,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "PurchaseTermPaymentRequest" pr
JOIN "PurchaseOrder" po ON po."id" = pr."purchaseOrderId"
WHERE po."orderType" = 'LOT'
  AND po."bizType" = 'COMMERCIAL'
  AND pr."supplierInvoiceId" IS NOT NULL
  AND pr."status" IN ('DIRECTOR_REJECTED', 'BANK_RETURNED')
ON CONFLICT ("dedupeKey") DO NOTHING;
