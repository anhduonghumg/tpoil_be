DELETE FROM "SalesOrderPaymentPlan";

ALTER TABLE "SalesOrderPaymentPlan"
ADD COLUMN "dueDate" DATE NOT NULL,
DROP COLUMN "dueDays";

ALTER TABLE "ReceivableOpenItem"
ADD COLUMN "installmentNo" INTEGER NOT NULL DEFAULT 1;

DROP INDEX IF EXISTS "ReceivableOpenItem_salesInvoiceId_key";

CREATE UNIQUE INDEX "ReceivableOpenItem_salesInvoiceId_installmentNo_key"
ON "ReceivableOpenItem"("salesInvoiceId", "installmentNo");
