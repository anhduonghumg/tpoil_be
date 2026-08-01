ALTER TABLE "public"."PurchaseTermPaymentRequest"
ADD COLUMN "supplierInvoiceId" UUID;

ALTER TABLE "public"."PurchaseTermPaymentRequest"
ADD CONSTRAINT "PurchaseTermPaymentRequest_supplierInvoiceId_fkey"
FOREIGN KEY ("supplierInvoiceId") REFERENCES "public"."SupplierInvoice"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "PurchaseTermPaymentRequest_supplierInvoiceId_key"
ON "public"."PurchaseTermPaymentRequest"("supplierInvoiceId");
