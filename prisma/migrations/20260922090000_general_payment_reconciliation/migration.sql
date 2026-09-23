CREATE TABLE "GeneralPaymentReconciliation" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
  "bankTransactionId" UUID NOT NULL,
  "paymentId" UUID NOT NULL,
  "reconciledById" UUID,
  "reconciledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "note" TEXT,
  CONSTRAINT "GeneralPaymentReconciliation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GeneralPaymentReconciliation_bankTransactionId_key" ON "GeneralPaymentReconciliation"("bankTransactionId");
CREATE UNIQUE INDEX "GeneralPaymentReconciliation_paymentId_key" ON "GeneralPaymentReconciliation"("paymentId");
CREATE INDEX "GeneralPaymentReconciliation_reconciledAt_idx" ON "GeneralPaymentReconciliation"("reconciledAt");

ALTER TABLE "GeneralPaymentReconciliation"
  ADD CONSTRAINT "GeneralPaymentReconciliation_bankTransactionId_fkey"
  FOREIGN KEY ("bankTransactionId") REFERENCES "BankTransaction"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GeneralPaymentReconciliation"
  ADD CONSTRAINT "GeneralPaymentReconciliation_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "GeneralPaymentRequestPayment"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
