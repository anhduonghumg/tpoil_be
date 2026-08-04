-- Sales GĐ 9: how the outside world spells our master data, plus the quick-entry paste log.
--
-- Driven by the real spreadsheet: "Kho Nghi Sơn" arrives as NGHISON / NSon / ns / apns, but
-- also as "Anh Phát" / "AP" / "Quảng Hưng" — the depot operators. Those can never be derived
-- algorithmically, so an explicit mapping owned by the business is the primary lookup.

CREATE TYPE "SalesAliasSource" AS ENUM ('IMPORTED', 'MANUAL', 'LEARNED');
CREATE TYPE "SalesAliasEntityType" AS ENUM ('PARTY', 'WAREHOUSE', 'PRODUCT');

CREATE TABLE "SalesEntityAlias" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
  "entityType" "SalesAliasEntityType" NOT NULL,
  "partyId" UUID,
  "warehouseId" UUID,
  "productId" UUID,
  "externalName" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "source" "SalesAliasSource" NOT NULL DEFAULT 'MANUAL',
  "note" TEXT,
  "createdById" UUID,
  "validFrom" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "validTo" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "SalesEntityAlias_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SalesEntityAlias_partyId_fkey"
    FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SalesEntityAlias_warehouseId_fkey"
    FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SalesEntityAlias_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- Exactly one target, and it must be the one the entityType names.
  CONSTRAINT "SalesEntityAlias_target_check" CHECK (
    num_nonnulls("partyId", "warehouseId", "productId") = 1
    AND ("entityType" <> 'PARTY' OR "partyId" IS NOT NULL)
    AND ("entityType" <> 'WAREHOUSE' OR "warehouseId" IS NOT NULL)
    AND ("entityType" <> 'PRODUCT' OR "productId" IS NOT NULL)
  ),
  CONSTRAINT "SalesEntityAlias_name_check" CHECK (length(btrim("normalizedName")) > 0)
);

CREATE INDEX "SalesEntityAlias_entityType_normalizedName_idx"
  ON "SalesEntityAlias"("entityType", "normalizedName");
CREATE INDEX "SalesEntityAlias_partyId_idx" ON "SalesEntityAlias"("partyId");
CREATE INDEX "SalesEntityAlias_warehouseId_idx" ON "SalesEntityAlias"("warehouseId");
CREATE INDEX "SalesEntityAlias_productId_idx" ON "SalesEntityAlias"("productId");

-- One live spelling points at one entity: the database refuses a silent overwrite, so a
-- clashing import has to be resolved by a person.
CREATE UNIQUE INDEX "uq_sales_alias_active"
  ON "SalesEntityAlias"("entityType", "normalizedName")
  WHERE "validTo" IS NULL;

CREATE TABLE "SalesQuickEntryLog" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
  "rawText" TEXT NOT NULL,
  "parsed" JSONB,
  "confirmed" JSONB,
  "usedAi" BOOLEAN NOT NULL DEFAULT false,
  "unmatched" JSONB,
  "createdById" UUID,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SalesQuickEntryLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SalesQuickEntryLog_createdAt_idx" ON "SalesQuickEntryLog"("createdAt");
