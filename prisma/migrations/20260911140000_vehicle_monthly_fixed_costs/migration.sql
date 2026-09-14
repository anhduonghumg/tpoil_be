CREATE TABLE "VehicleMonthlyFixedCost" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "vehiclePlate" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "depreciationCost" DECIMAL(24,2) NOT NULL DEFAULT 0,
    "driverSalaryCost" DECIMAL(24,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VehicleMonthlyFixedCost_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "VehicleMonthlyFixedCost_vehiclePlate_month_key" ON "VehicleMonthlyFixedCost"("vehiclePlate", "month");
CREATE INDEX "VehicleMonthlyFixedCost_month_idx" ON "VehicleMonthlyFixedCost"("month");
