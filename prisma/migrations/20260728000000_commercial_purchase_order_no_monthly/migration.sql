-- Commercial order numbers reset for each supplier every month, so the same
-- display number can legitimately recur in a later month.
DROP INDEX IF EXISTS "public"."PurchaseOrder_legalEntityId_orderNo_key";

CREATE INDEX "PurchaseOrder_legalEntityId_orderNo_idx"
ON "public"."PurchaseOrder"("legalEntityId", "orderNo");
