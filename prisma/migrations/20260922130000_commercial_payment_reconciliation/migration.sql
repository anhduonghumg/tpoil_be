-- Ghép lần chi Mua TM với dòng tiền ra trên sao kê. Có số tiền trên từng dòng ghép:
-- một lần chi có thể trả từ nhiều tài khoản, một lệnh chuyển có thể gộp nhiều lần chi.
CREATE TABLE "CommercialPaymentReconciliation" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
  "bankTransactionId" UUID NOT NULL,
  "paymentId" UUID NOT NULL,
  "amountVnd" DECIMAL(18,2) NOT NULL,
  "reconciledById" UUID,
  "reconciledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "note" TEXT,
  "reversedAt" TIMESTAMP(3),
  "reversedById" UUID,
  "reversalReason" TEXT,
  CONSTRAINT "CommercialPaymentReconciliation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommercialPaymentReconciliation_amount_positive" CHECK ("amountVnd" > 0)
);

CREATE INDEX "CommercialPaymentReconciliation_bankTransactionId_idx" ON "CommercialPaymentReconciliation"("bankTransactionId");
CREATE INDEX "CommercialPaymentReconciliation_paymentId_idx" ON "CommercialPaymentReconciliation"("paymentId");
CREATE INDEX "CommercialPaymentReconciliation_reversedAt_idx" ON "CommercialPaymentReconciliation"("reversedAt");

ALTER TABLE "CommercialPaymentReconciliation"
  ADD CONSTRAINT "CommercialPaymentReconciliation_bankTransactionId_fkey"
  FOREIGN KEY ("bankTransactionId") REFERENCES "BankTransaction"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CommercialPaymentReconciliation"
  ADD CONSTRAINT "CommercialPaymentReconciliation_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "PaymentRequestPayment"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
