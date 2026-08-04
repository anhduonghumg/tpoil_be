-- Sales GĐ 6: output VAT invoices issued through MISA meInvoice
-- (sales-implementation-spec v1.2 §3.7, §10).

CREATE TYPE "SalesInvoiceStatus" AS ENUM ('DRAFT', 'PENDING_ISSUE', 'ISSUED', 'ISSUE_FAILED', 'CANCELLED');
CREATE TYPE "SalesInvoiceDocumentType" AS ENUM ('ORIGINAL', 'ADJUSTMENT', 'REPLACEMENT');

CREATE TABLE "SalesInvoice" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
  "invoiceNoInternal" TEXT NOT NULL,
  "salesOrderId" UUID,
  "withdrawalRequestId" UUID,
  "documentType" "SalesInvoiceDocumentType" NOT NULL DEFAULT 'ORIGINAL',
  "originalInvoiceId" UUID,
  "status" "SalesInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
  "legalEntityId" UUID NOT NULL,
  "customerPartyId" UUID NOT NULL,
  "buyerName" TEXT NOT NULL,
  "buyerTaxCode" TEXT,
  "buyerAddress" TEXT,
  "buyerEmail" TEXT,
  "currency" CHAR(3) NOT NULL,
  "subtotal" DECIMAL(24,4) NOT NULL,
  "discountTotal" DECIMAL(24,4) NOT NULL DEFAULT 0,
  "taxTotal" DECIMAL(24,4) NOT NULL DEFAULT 0,
  "grandTotal" DECIMAL(24,4) NOT NULL,
  "invoiceDate" DATE NOT NULL,
  "paymentTermDays" INTEGER,
  "dueDate" DATE,
  "note" TEXT,
  "misaTransactionId" TEXT,
  "misaInvoiceNo" TEXT,
  "misaTemplateNo" TEXT,
  "misaSerial" TEXT,
  "issuedAt" TIMESTAMPTZ(6),
  "cancelledAt" TIMESTAMPTZ(6),
  "cancelledById" UUID,
  "cancelReason" TEXT,
  "createdById" UUID,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "SalesInvoice_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SalesInvoice_salesOrderId_fkey"
    FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SalesInvoice_withdrawalRequestId_fkey"
    FOREIGN KEY ("withdrawalRequestId") REFERENCES "SalesLotWithdrawalRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SalesInvoice_legalEntityId_fkey"
    FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SalesInvoice_customerPartyId_fkey"
    FOREIGN KEY ("customerPartyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SalesInvoice_originalInvoiceId_fkey"
    FOREIGN KEY ("originalInvoiceId") REFERENCES "SalesInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  -- Exactly one commercial source.
  CONSTRAINT "SalesInvoice_target_check" CHECK (
    ("salesOrderId" IS NOT NULL AND "withdrawalRequestId" IS NULL)
    OR ("salesOrderId" IS NULL AND "withdrawalRequestId" IS NOT NULL)
  ),
  -- A correction always cites the document it corrects; an original never does.
  CONSTRAINT "SalesInvoice_correction_check" CHECK (
    ("documentType" = 'ORIGINAL' AND "originalInvoiceId" IS NULL)
    OR ("documentType" <> 'ORIGINAL' AND "originalInvoiceId" IS NOT NULL)
  ),
  CONSTRAINT "SalesInvoice_amount_check" CHECK ("grandTotal" > 0)
);

CREATE UNIQUE INDEX "SalesInvoice_invoiceNoInternal_key" ON "SalesInvoice"("invoiceNoInternal");
CREATE UNIQUE INDEX "SalesInvoice_misaTransactionId_key" ON "SalesInvoice"("misaTransactionId");
CREATE INDEX "SalesInvoice_customerPartyId_status_invoiceDate_idx"
  ON "SalesInvoice"("customerPartyId", "status", "invoiceDate");
CREATE INDEX "SalesInvoice_salesOrderId_idx" ON "SalesInvoice"("salesOrderId");
CREATE INDEX "SalesInvoice_withdrawalRequestId_idx" ON "SalesInvoice"("withdrawalRequestId");
CREATE INDEX "SalesInvoice_originalInvoiceId_idx" ON "SalesInvoice"("originalInvoiceId");

-- Chống phát hành trùng: một hóa đơn gốc còn hiệu lực cho mỗi chứng từ thương mại.
CREATE UNIQUE INDEX "uq_sales_invoice_original_order"
  ON "SalesInvoice"("salesOrderId")
  WHERE "documentType" = 'ORIGINAL' AND "status" <> 'CANCELLED' AND "salesOrderId" IS NOT NULL;
CREATE UNIQUE INDEX "uq_sales_invoice_original_withdrawal"
  ON "SalesInvoice"("withdrawalRequestId")
  WHERE "documentType" = 'ORIGINAL' AND "status" <> 'CANCELLED' AND "withdrawalRequestId" IS NOT NULL;

CREATE TABLE "SalesInvoiceLine" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
  "salesInvoiceId" UUID NOT NULL,
  "lineNo" INTEGER NOT NULL,
  "salesOrderLineId" UUID NOT NULL,
  "salesDeliveryLineId" UUID,
  "productId" UUID NOT NULL,
  "description" TEXT NOT NULL,
  "uom" TEXT NOT NULL,
  "qty" DECIMAL(24,6) NOT NULL,
  "unitPrice" DECIMAL(24,8) NOT NULL,
  "discountAmount" DECIMAL(24,4) NOT NULL DEFAULT 0,
  "taxRate" DECIMAL(9,6),
  "netAmount" DECIMAL(24,4) NOT NULL,
  "taxAmount" DECIMAL(24,4) NOT NULL DEFAULT 0,
  "lineTotal" DECIMAL(24,4) NOT NULL,

  CONSTRAINT "SalesInvoiceLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SalesInvoiceLine_salesInvoiceId_fkey"
    FOREIGN KEY ("salesInvoiceId") REFERENCES "SalesInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SalesInvoiceLine_salesOrderLineId_fkey"
    FOREIGN KEY ("salesOrderLineId") REFERENCES "SalesOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SalesInvoiceLine_salesDeliveryLineId_fkey"
    FOREIGN KEY ("salesDeliveryLineId") REFERENCES "SalesDeliveryLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SalesInvoiceLine_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SalesInvoiceLine_qty_check" CHECK ("qty" > 0)
);

CREATE UNIQUE INDEX "SalesInvoiceLine_salesInvoiceId_lineNo_key"
  ON "SalesInvoiceLine"("salesInvoiceId", "lineNo");
CREATE INDEX "SalesInvoiceLine_salesOrderLineId_idx" ON "SalesInvoiceLine"("salesOrderLineId");
CREATE INDEX "SalesInvoiceLine_salesDeliveryLineId_idx" ON "SalesInvoiceLine"("salesDeliveryLineId");

CREATE TABLE "SalesInvoiceIssuance" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
  "salesInvoiceId" UUID NOT NULL,
  "attempt" INTEGER NOT NULL,
  "action" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "requestPayload" JSONB,
  "responsePayload" JSONB,
  "httpStatus" INTEGER,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "startedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMPTZ(6),

  CONSTRAINT "SalesInvoiceIssuance_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SalesInvoiceIssuance_salesInvoiceId_fkey"
    FOREIGN KEY ("salesInvoiceId") REFERENCES "SalesInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "SalesInvoiceIssuance_salesInvoiceId_startedAt_idx"
  ON "SalesInvoiceIssuance"("salesInvoiceId", "startedAt");

-- Receivables can now point at the invoice that raised them (column existed from GĐ 5).
ALTER TABLE "ReceivableOpenItem"
  ADD CONSTRAINT "ReceivableOpenItem_salesInvoiceId_fkey"
  FOREIGN KEY ("salesInvoiceId") REFERENCES "SalesInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
