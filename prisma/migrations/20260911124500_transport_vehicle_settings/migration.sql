CREATE TABLE "TransportVehicleSetting" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "vehiclePlate" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "fuelConsumptionPer100" DECIMAL(24,6) NOT NULL DEFAULT 0,
    "fuelUnitPrice" DECIMAL(24,8) NOT NULL DEFAULT 0,
    "defaultTripAllowance" DECIMAL(24,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TransportVehicleSetting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TransportVehicleSetting_vehiclePlate_effectiveFrom_key"
    ON "TransportVehicleSetting"("vehiclePlate", "effectiveFrom");
CREATE INDEX "TransportVehicleSetting_vehiclePlate_effectiveFrom_idx"
    ON "TransportVehicleSetting"("vehiclePlate", "effectiveFrom");
