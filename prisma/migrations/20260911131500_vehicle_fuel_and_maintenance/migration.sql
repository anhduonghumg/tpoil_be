CREATE TABLE "VehicleFuelLog" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "vehiclePlate" TEXT NOT NULL,
    "fueledAt" DATE NOT NULL,
    "odometerKm" DECIMAL(24,3),
    "liters" DECIMAL(24,6) NOT NULL,
    "unitPrice" DECIMAL(24,8) NOT NULL,
    "amount" DECIMAL(24,2) NOT NULL,
    "fueledBy" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VehicleFuelLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "VehicleFuelLog_vehiclePlate_fueledAt_idx" ON "VehicleFuelLog"("vehiclePlate", "fueledAt");

CREATE TABLE "VehicleMaintenanceExpense" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "vehiclePlate" TEXT NOT NULL,
    "documentDate" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "amountBeforeTax" DECIMAL(24,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(24,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(24,2) NOT NULL DEFAULT 0,
    "invoiceStatus" TEXT,
    "supplierName" TEXT,
    "allocationMonths" INTEGER NOT NULL DEFAULT 1,
    "odometerKm" DECIMAL(24,3),
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VehicleMaintenanceExpense_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "VehicleMaintenanceExpense_vehiclePlate_documentDate_idx" ON "VehicleMaintenanceExpense"("vehiclePlate", "documentDate");
