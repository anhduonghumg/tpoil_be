-- Actual trip data is owned by the transport request, not by the sales order.
-- It is deliberately optional: a sales order remains fully processable while
-- the vehicle manager has not yet entered its actual costs.
CREATE TABLE "SalesOrderTransportActual" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "transportRequestId" UUID NOT NULL,
    "actualVehiclePlate" TEXT,
    "actualDriverName" TEXT,
    "actualTripDate" DATE,
    "fuelConsumedQty" DECIMAL(24,6) NOT NULL DEFAULT 0,
    "fuelUnitPrice" DECIMAL(24,8) NOT NULL DEFAULT 0,
    "tollAndTerminalFee" DECIMAL(24,2) NOT NULL DEFAULT 0,
    "driverAllowance" DECIMAL(24,2) NOT NULL DEFAULT 0,
    "loadingUnloadingFee" DECIMAL(24,2) NOT NULL DEFAULT 0,
    "otherExpense" DECIMAL(24,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesOrderTransportActual_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SalesOrderTransportActual_transportRequestId_key"
    ON "SalesOrderTransportActual"("transportRequestId");

ALTER TABLE "SalesOrderTransportActual"
    ADD CONSTRAINT "SalesOrderTransportActual_transportRequestId_fkey"
    FOREIGN KEY ("transportRequestId") REFERENCES "SalesOrderTransportRequest"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
