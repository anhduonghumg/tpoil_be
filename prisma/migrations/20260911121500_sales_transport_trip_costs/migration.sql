ALTER TYPE "SalesTransportRequestStatus" ADD VALUE IF NOT EXISTS 'COMPLETED';

ALTER TABLE "SalesOrderTransportRequest"
    ADD COLUMN "tripNo" TEXT,
    ADD COLUMN "completedAt" TIMESTAMPTZ(6);

ALTER TABLE "SalesOrderTransportActual"
    ADD COLUMN "tripDistanceKm" DECIMAL(24,3) NOT NULL DEFAULT 0,
    ADD COLUMN "fuelConsumptionPer100" DECIMAL(24,6) NOT NULL DEFAULT 0,
    ADD COLUMN "warehouseEntryFee" DECIMAL(24,2) NOT NULL DEFAULT 0,
    ADD COLUMN "portDeliverySurcharge" DECIMAL(24,2) NOT NULL DEFAULT 0,
    ADD COLUMN "stationAgencyDutyFee" DECIMAL(24,2) NOT NULL DEFAULT 0,
    ADD COLUMN "portTicketFee" DECIMAL(24,2) NOT NULL DEFAULT 0,
    ADD COLUMN "invoiceIssuanceFee" DECIMAL(24,2) NOT NULL DEFAULT 0;

UPDATE "SalesOrderTransportRequest" request
SET "tripNo" = 'CX-' || "SalesOrder"."orderNo"
FROM "SalesOrder"
WHERE "SalesOrder"."id" = request."salesOrderId"
  AND request."tripNo" IS NULL;
