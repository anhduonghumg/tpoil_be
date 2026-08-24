ALTER TABLE "SalesOrderLine"
ADD COLUMN "preferredSupplierPartyId" UUID;

ALTER TABLE "SalesOrderLine"
ADD CONSTRAINT "SalesOrderLine_preferredSupplierPartyId_fkey"
FOREIGN KEY ("preferredSupplierPartyId") REFERENCES "Party"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "SalesOrderLine_preferredSupplierPartyId_idx"
ON "SalesOrderLine"("preferredSupplierPartyId");
