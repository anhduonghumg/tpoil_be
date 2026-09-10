ALTER TABLE "SalesOrder"
ADD COLUMN "salesOwnerEmpId" UUID;

ALTER TABLE "SalesOrder"
ADD CONSTRAINT "SalesOrder_salesOwnerEmpId_fkey"
FOREIGN KEY ("salesOwnerEmpId") REFERENCES "Employee"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "SalesOrder_salesOwnerEmpId_orderDate_idx"
ON "SalesOrder"("salesOwnerEmpId", "orderDate");

-- Existing orders get the current owner once. New orders snapshot it at creation time.
UPDATE "SalesOrder" AS so
SET "salesOwnerEmpId" = p."salesOwnerEmpId"
FROM "Party" AS p
WHERE p."id" = so."customerPartyId"
  AND so."salesOwnerEmpId" IS NULL;
