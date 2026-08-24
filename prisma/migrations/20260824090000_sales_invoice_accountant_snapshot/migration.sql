ALTER TABLE "SalesInvoice"
ADD COLUMN "accountantEmployeeId" UUID;

ALTER TABLE "SalesInvoice"
ADD CONSTRAINT "SalesInvoice_accountantEmployeeId_fkey"
FOREIGN KEY ("accountantEmployeeId") REFERENCES "Employee"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "SalesInvoice_accountantEmployeeId_status_invoiceDate_idx"
ON "SalesInvoice"("accountantEmployeeId", "status", "invoiceDate");
