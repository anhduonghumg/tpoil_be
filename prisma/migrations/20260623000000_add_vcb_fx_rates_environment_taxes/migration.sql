-- CreateTable
CREATE TABLE "VcbFxRate" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "rateDate" DATE NOT NULL,
    "bankCode" TEXT NOT NULL DEFAULT 'VCB',
    "currencyCode" TEXT NOT NULL DEFAULT 'USD',
    "cashBuyRate" DECIMAL(18,6),
    "transferBuyRate" DECIMAL(18,6),
    "sellRate" DECIMAL(18,6) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "fetchedAt" TIMESTAMPTZ,
    "rawPayload" JSONB,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VcbFxRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnvironmentalTaxRate" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "productId" UUID NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "taxVndPerLiter" DECIMAL(18,6) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnvironmentalTaxRate_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "EnvironmentalTaxRate_effective_range_chk" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom"),
    CONSTRAINT "EnvironmentalTaxRate_tax_non_negative_chk" CHECK ("taxVndPerLiter" >= 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "VcbFxRate_rateDate_bankCode_currencyCode_key"
ON "VcbFxRate"("rateDate", "bankCode", "currencyCode");

-- CreateIndex
CREATE INDEX "VcbFxRate_currencyCode_rateDate_idx"
ON "VcbFxRate"("currencyCode", "rateDate");

-- CreateIndex
CREATE INDEX "EnvironmentalTaxRate_productId_effectiveFrom_effectiveTo_idx"
ON "EnvironmentalTaxRate"("productId", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE INDEX "EnvironmentalTaxRate_status_idx"
ON "EnvironmentalTaxRate"("status");

-- AddForeignKey
ALTER TABLE "EnvironmentalTaxRate"
ADD CONSTRAINT "EnvironmentalTaxRate_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
