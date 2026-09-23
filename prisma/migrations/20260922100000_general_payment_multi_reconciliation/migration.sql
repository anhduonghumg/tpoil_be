DROP INDEX "GeneralPaymentReconciliation_bankTransactionId_key";

CREATE INDEX "GeneralPaymentReconciliation_bankTransactionId_idx"
  ON "GeneralPaymentReconciliation"("bankTransactionId");
