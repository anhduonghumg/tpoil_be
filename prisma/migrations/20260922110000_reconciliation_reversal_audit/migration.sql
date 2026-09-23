DROP INDEX "GeneralPaymentReconciliation_paymentId_key";

ALTER TABLE "GeneralPaymentReconciliation"
  ADD COLUMN "reversedAt" TIMESTAMP(3),
  ADD COLUMN "reversedById" UUID,
  ADD COLUMN "reversalReason" TEXT;

CREATE INDEX "GeneralPaymentReconciliation_paymentId_idx"
  ON "GeneralPaymentReconciliation"("paymentId");

CREATE INDEX "GeneralPaymentReconciliation_reversedAt_idx"
  ON "GeneralPaymentReconciliation"("reversedAt");
