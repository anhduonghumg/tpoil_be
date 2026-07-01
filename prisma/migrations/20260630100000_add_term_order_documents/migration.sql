DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TermOrderDocumentSourceType') THEN
        CREATE TYPE "TermOrderDocumentSourceType" AS ENUM ('ESTIMATE_PRICING', 'DIRECT');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TermOrderDocumentStatus') THEN
        CREATE TYPE "TermOrderDocumentStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'CANCELLED');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "PurchaseTermOrderDocument" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "purchaseOrderId" UUID NOT NULL,
    "sourceType" "TermOrderDocumentSourceType" NOT NULL,
    "sourcePricingStageId" UUID,
    "documentNo" TEXT NOT NULL,
    "documentDate" DATE NOT NULL,
    "buyerName" TEXT NOT NULL,
    "buyerAddress" TEXT,
    "buyerPhone" TEXT,
    "buyerFax" TEXT,
    "supplierName" TEXT NOT NULL,
    "supplierAddress" TEXT,
    "supplierPhone" TEXT,
    "contractNo" TEXT,
    "appendixNo" TEXT,
    "deliveryTimeText" TEXT,
    "deliveryLocation" TEXT,
    "paymentMethodText" TEXT,
    "priceBasisNote" TEXT,
    "officialPriceNote" TEXT,
    "includedTaxNote" TEXT,
    "totalQtyLiter" DECIMAL(18, 3) NOT NULL DEFAULT 0,
    "unitPriceVndPerLiter" DECIMAL(18, 6) NOT NULL DEFAULT 0,
    "amountVnd" DECIMAL(18, 2) NOT NULL DEFAULT 0,
    "vatRate" DECIMAL(5, 2) NOT NULL DEFAULT 0,
    "totalAmountVnd" DECIMAL(18, 2) NOT NULL DEFAULT 0,
    "status" "TermOrderDocumentStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "sourceHash" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PurchaseTermOrderDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PurchaseTermOrderDocumentLine" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "documentId" UUID NOT NULL,
    "productId" UUID,
    "productCode" TEXT,
    "productName" TEXT NOT NULL,
    "qtyLiter" DECIMAL(18, 3) NOT NULL,
    "unitPriceVndPerLiter" DECIMAL(18, 6) NOT NULL,
    "amountVnd" DECIMAL(18, 2) NOT NULL,
    "vatRate" DECIMAL(5, 2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PurchaseTermOrderDocumentLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PurchaseTermOrderDocument_purchaseOrderId_status_idx" ON "PurchaseTermOrderDocument"("purchaseOrderId", "status");
CREATE INDEX IF NOT EXISTS "PurchaseTermOrderDocument_documentNo_idx" ON "PurchaseTermOrderDocument"("documentNo");
CREATE INDEX IF NOT EXISTS "PurchaseTermOrderDocument_sourcePricingStageId_idx" ON "PurchaseTermOrderDocument"("sourcePricingStageId");
CREATE INDEX IF NOT EXISTS "PurchaseTermOrderDocument_createdAt_idx" ON "PurchaseTermOrderDocument"("createdAt");
CREATE INDEX IF NOT EXISTS "PurchaseTermOrderDocumentLine_documentId_idx" ON "PurchaseTermOrderDocumentLine"("documentId");
CREATE INDEX IF NOT EXISTS "PurchaseTermOrderDocumentLine_productId_idx" ON "PurchaseTermOrderDocumentLine"("productId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'PurchaseTermOrderDocumentLine_documentId_fkey'
    ) THEN
        ALTER TABLE "PurchaseTermOrderDocumentLine"
        ADD CONSTRAINT "PurchaseTermOrderDocumentLine_documentId_fkey"
        FOREIGN KEY ("documentId") REFERENCES "PurchaseTermOrderDocument"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
