-- Commercial lot payments created before the payable-settlement integration
-- have a PaymentRequestPayment row but no payable ledger entry. Backfill only
-- invoices whose full legacy payment total is still available on the open item.
WITH legacy_payments AS (
  SELECT
    payment."id" AS payment_id,
    invoice_item."id" AS open_item_id,
    payment."amountVnd" AS amount_vnd,
    payment."paidAt" AS paid_at
  FROM "public"."PaymentRequestPayment" payment
  INNER JOIN "public"."PurchaseTermPaymentRequest" request
    ON request."id" = payment."paymentRequestId"
  INNER JOIN "public"."PayableOpenItem" invoice_item
    ON invoice_item."supplierInvoiceId" = request."supplierInvoiceId"
  WHERE request."supplierInvoiceId" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM "public"."PayableLedgerEntry" entry
      WHERE entry."idempotencyKey" = CONCAT('commercial-lot-payment:', payment."id")
    )
),
eligible_payments AS (
  SELECT legacy_payments.*
  FROM legacy_payments
  INNER JOIN (
    SELECT open_item_id, SUM(amount_vnd) AS total_amount
    FROM legacy_payments
    GROUP BY open_item_id
  ) totals ON totals.open_item_id = legacy_payments.open_item_id
  INNER JOIN "public"."PayableOpenItem" invoice_item
    ON invoice_item."id" = legacy_payments.open_item_id
  WHERE totals.total_amount <= invoice_item."outstandingAmount"
),
created_entries AS (
  INSERT INTO "public"."PayableLedgerEntry" (
    "openItemId",
    "type",
    "amountDelta",
    "idempotencyKey",
    "effectiveAt"
  )
  SELECT
    open_item_id,
    'PAYMENT'::"public"."PayableEntryType",
    -amount_vnd,
    CONCAT('commercial-lot-payment:', payment_id),
    paid_at::timestamp with time zone
  FROM eligible_payments
  RETURNING "openItemId", "amountDelta"
),
applied_amounts AS (
  SELECT "openItemId", -SUM("amountDelta") AS amount_vnd
  FROM created_entries
  GROUP BY "openItemId"
)
UPDATE "public"."PayableOpenItem" invoice_item
SET
  "outstandingAmount" = invoice_item."outstandingAmount" - applied_amounts.amount_vnd,
  "status" = CASE
    WHEN invoice_item."outstandingAmount" - applied_amounts.amount_vnd = 0
      THEN 'SETTLED'::"public"."PayableOpenItemStatus"
    ELSE 'PARTIALLY_SETTLED'::"public"."PayableOpenItemStatus"
  END,
  "version" = invoice_item."version" + 1,
  "updatedAt" = CURRENT_TIMESTAMP
FROM applied_amounts
WHERE invoice_item."id" = applied_amounts."openItemId";
