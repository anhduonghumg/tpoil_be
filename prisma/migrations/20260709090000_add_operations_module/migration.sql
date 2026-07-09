-- CreateEnum
CREATE TYPE "public"."OperationalPartyRole" AS ENUM ('SHIP_OWNER', 'SEA_CARRIER', 'SURVEYOR', 'SHIPPING_AGENT', 'INSURER', 'STORAGE_LESSOR', 'ROAD_CARRIER');

-- CreateEnum
CREATE TYPE "public"."ShipCharterOrderSourceType" AS ENUM ('DIRECT', 'FROM_TERM');

-- CreateEnum
CREATE TYPE "public"."ShipCharterOrderStatus" AS ENUM ('DRAFT', 'WAITING_CONFIRMATION', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."OperationRegistrationStatus" AS ENUM ('DRAFT', 'REGISTERED', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."InspectionType" AS ENUM ('QUANTITY', 'QUALITY', 'BOTH');

-- CreateEnum
CREATE TYPE "public"."StorageRentalContractStatus" AS ENUM ('DRAFT', 'ACTIVE', 'EXPIRED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "public"."WarehouseOwnerType" AS ENUM ('INTERNAL', 'CUSTOMER', 'SUPPLIER');

-- CreateEnum
CREATE TYPE "public"."AvailabilityLedgerSourceType" AS ENUM ('GOODS_RECEIPT', 'EXPECTED_INVENTORY', 'RESERVATION', 'WAREHOUSE_TRANSFER', 'MANUAL');

-- CreateEnum
CREATE TYPE "public"."ExpectedInventorySourceType" AS ENUM ('PURCHASE_ORDER', 'SHIP_CHARTER_ORDER', 'WAREHOUSE_TRANSFER', 'MANUAL');

-- CreateEnum
CREATE TYPE "public"."ExpectedInventoryStatus" AS ENUM ('OPEN', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."WarehouseReservationSourceType" AS ENUM ('SALES_ORDER', 'MANUAL');

-- CreateEnum
CREATE TYPE "public"."WarehouseReservationStatus" AS ENUM ('ACTIVE', 'RELEASED', 'CONSUMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."WarehouseTransferStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'IN_TRANSIT', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."VehicleDocumentType" AS ENUM ('REGISTRATION', 'INSPECTION', 'INSURANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."DriverDocumentType" AS ENUM ('DRIVER_LICENSE', 'ID_CARD', 'TRAINING_CERTIFICATE', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."VehicleDispatchSourceType" AS ENUM ('DIRECT', 'PURCHASE_ORDER', 'SALES_ORDER', 'GOODS_RECEIPT', 'WAREHOUSE_TRANSFER');

-- CreateEnum
CREATE TYPE "public"."VehicleDispatchStatus" AS ENUM ('DRAFT', 'ASSIGNED', 'LOADING', 'IN_TRANSIT', 'DELIVERED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."OperationalCostSourceType" AS ENUM ('SHIP_CHARTER_FREIGHT', 'SHIP_CHARTER_INSURANCE', 'SHIP_CHARTER_INSPECTION', 'SHIPPING_AGENT', 'STORAGE_RENTAL', 'STORAGE_LOSS');

-- AlterEnum
ALTER TYPE "public"."InventoryLedgerSourceType" ADD VALUE 'WAREHOUSE_TRANSFER';
ALTER TYPE "public"."TermLogisticsCostType" ADD VALUE 'LOSS';

-- AlterTable
ALTER TABLE "public"."SupplierLocation" ADD COLUMN     "isOperationalWarehouse" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "warehouseType" TEXT;

-- AlterTable
ALTER TABLE "public"."TermLogisticsCostLine" ADD COLUMN     "operationsSourceId" UUID,
ADD COLUMN     "operationsSourceType" "public"."OperationalCostSourceType";

-- AlterTable
ALTER TABLE "public"."TermShipment" ADD COLUMN     "vesselId" UUID;

-- CreateTable
CREATE TABLE "public"."CustomerOperationalRole" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "customerId" UUID NOT NULL,
    "role" "public"."OperationalPartyRole" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerOperationalRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Vessel" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "name" TEXT NOT NULL,
    "ownerCustomerId" UUID NOT NULL,
    "imoNo" TEXT,
    "nationality" TEXT,
    "deadweightTonnage" DECIMAL(18,3),
    "capacity" DECIMAL(18,3),
    "length" DECIMAL(12,3),
    "width" DECIMAL(12,3),
    "draft" DECIMAL(12,3),
    "allowedCargoTypes" JSONB,
    "documentFileUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vessel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ShipCharterContract" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "contractNo" TEXT NOT NULL,
    "ownerCustomerId" UUID NOT NULL,
    "signedDate" DATE NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "fileUrl" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipCharterContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ShipCharterAppendix" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "contractId" UUID NOT NULL,
    "appendixNo" TEXT NOT NULL,
    "appendixDate" DATE NOT NULL,
    "vesselId" UUID,
    "cargoName" TEXT,
    "plannedQty" DECIMAL(18,3),
    "qtyTolerancePercent" DECIMAL(7,4),
    "loadingPort" TEXT,
    "dischargePort" TEXT,
    "laycanFrom" DATE,
    "laycanTo" DATE,
    "freightRateVndPerLiter" DECIMAL(18,6),
    "lossRatePercent" DECIMAL(7,4),
    "fileUrl" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipCharterAppendix_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ShipCharterOrder" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "charterOrderNo" TEXT NOT NULL,
    "sourceType" "public"."ShipCharterOrderSourceType" NOT NULL DEFAULT 'DIRECT',
    "purchaseOrderId" UUID,
    "termShipmentId" UUID,
    "appendixId" UUID,
    "ownerCustomerId" UUID,
    "vesselId" UUID,
    "laycanFrom" DATE,
    "laycanTo" DATE,
    "cargoName" TEXT,
    "plannedQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "loadingPort" TEXT,
    "dischargePort" TEXT,
    "freightRateVndPerLiter" DECIMAL(18,6),
    "lossRatePercent" DECIMAL(7,4),
    "status" "public"."ShipCharterOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "appendixFileUrl" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipCharterOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ShipCharterInsurance" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "charterOrderId" UUID NOT NULL,
    "insuranceCompanyId" UUID NOT NULL,
    "policyNo" TEXT,
    "policyDate" DATE,
    "insuredValue" DECIMAL(18,2),
    "premiumAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "effectiveFrom" DATE,
    "effectiveTo" DATE,
    "fileUrl" TEXT,
    "status" "public"."OperationRegistrationStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipCharterInsurance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ShipCharterInspection" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "charterOrderId" UUID NOT NULL,
    "inspectionCompanyId" UUID NOT NULL,
    "inspectionType" "public"."InspectionType" NOT NULL DEFAULT 'BOTH',
    "registeredDate" DATE,
    "plannedInspectionDate" DATE,
    "certificateNo" TEXT,
    "feeAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "fileUrl" TEXT,
    "status" "public"."OperationRegistrationStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipCharterInspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ShippingAgentRegistration" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "charterOrderId" UUID NOT NULL,
    "agentCustomerId" UUID NOT NULL,
    "registeredDate" DATE,
    "agencyFee" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "fileUrl" TEXT,
    "status" "public"."OperationRegistrationStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingAgentRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ShipFreightRate" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "ownerCustomerId" UUID,
    "vesselId" UUID,
    "loadingPort" TEXT NOT NULL,
    "dischargePort" TEXT NOT NULL,
    "productGroup" TEXT,
    "freightRateVndPerLiter" DECIMAL(18,6) NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipFreightRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."StorageRentalContract" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "contractNo" TEXT NOT NULL,
    "lessorCustomerId" UUID NOT NULL,
    "effectiveFrom" DATE,
    "effectiveTo" DATE,
    "currency" TEXT NOT NULL DEFAULT 'VND',
    "status" "public"."StorageRentalContractStatus" NOT NULL DEFAULT 'DRAFT',
    "fileName" TEXT,
    "fileUrl" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorageRentalContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."StorageRentalContractLocation" (
    "contractId" UUID NOT NULL,
    "supplierLocationId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StorageRentalContractLocation_pkey" PRIMARY KEY ("contractId","supplierLocationId")
);

-- CreateTable
CREATE TABLE "public"."StorageRentalLossRate" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "contractId" UUID NOT NULL,
    "productGroup" TEXT NOT NULL,
    "storageLossRatePercent" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "issueLossRatePercent" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorageRentalLossRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."StorageRentalFeeTier" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "contractId" UUID NOT NULL,
    "conditionText" TEXT NOT NULL,
    "unitPriceVndPerLiter" DECIMAL(18,6) NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'VND/LITER',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorageRentalFeeTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WarehouseAvailabilityBalance" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "supplierLocationId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "ownerType" "public"."WarehouseOwnerType" NOT NULL,
    "ownerKey" TEXT NOT NULL,
    "ownerCustomerId" UUID,
    "availableQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "reservedQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "inTransitQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "expectedQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarehouseAvailabilityBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WarehouseAvailabilityLedger" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "supplierLocationId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "ownerType" "public"."WarehouseOwnerType" NOT NULL,
    "ownerKey" TEXT NOT NULL,
    "ownerCustomerId" UUID,
    "deltaAvailableQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "deltaReservedQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "deltaInTransitQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "deltaExpectedQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "afterAvailableQty" DECIMAL(18,3) NOT NULL,
    "afterReservedQty" DECIMAL(18,3) NOT NULL,
    "afterInTransitQty" DECIMAL(18,3) NOT NULL,
    "afterExpectedQty" DECIMAL(18,3) NOT NULL,
    "sourceType" "public"."AvailabilityLedgerSourceType" NOT NULL,
    "sourceId" UUID NOT NULL,
    "sourceAction" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehouseAvailabilityLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ExpectedInventory" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "sourceType" "public"."ExpectedInventorySourceType" NOT NULL,
    "sourceId" UUID NOT NULL,
    "supplierLocationId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "ownerType" "public"."WarehouseOwnerType" NOT NULL,
    "ownerKey" TEXT NOT NULL,
    "ownerCustomerId" UUID,
    "expectedQty" DECIMAL(18,3) NOT NULL,
    "receivedQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "expectedDate" DATE,
    "status" "public"."ExpectedInventoryStatus" NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpectedInventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ExpectedInventoryReceiptAllocation" (
    "expectedInventoryId" UUID NOT NULL,
    "goodsReceiptId" UUID NOT NULL,
    "allocatedQty" DECIMAL(18,3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpectedInventoryReceiptAllocation_pkey" PRIMARY KEY ("expectedInventoryId","goodsReceiptId")
);

-- CreateTable
CREATE TABLE "public"."WarehouseReservation" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "reservationNo" TEXT NOT NULL,
    "supplierLocationId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "customerId" UUID,
    "sourceType" "public"."WarehouseReservationSourceType" NOT NULL DEFAULT 'MANUAL',
    "sourceId" UUID,
    "reservedQty" DECIMAL(18,3) NOT NULL,
    "status" "public"."WarehouseReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiredAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarehouseReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WarehouseTransfer" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "transferNo" TEXT NOT NULL,
    "fromSupplierLocationId" UUID NOT NULL,
    "toSupplierLocationId" UUID NOT NULL,
    "transferDate" DATE NOT NULL,
    "expectedArrivalDate" DATE,
    "actualArrivalDate" DATE,
    "transportMode" "public"."TermTransportMode" NOT NULL DEFAULT 'ROAD',
    "vehicleId" UUID,
    "driverId" UUID,
    "ownerType" "public"."WarehouseOwnerType" NOT NULL DEFAULT 'INTERNAL',
    "ownerKey" TEXT NOT NULL DEFAULT 'INTERNAL',
    "ownerCustomerId" UUID,
    "status" "public"."WarehouseTransferStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarehouseTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WarehouseTransferLine" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "transferId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,
    "qtyV15" DECIMAL(18,3),
    "pendingDocQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "postedQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarehouseTransferLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."VehicleDocument" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "vehicleId" UUID NOT NULL,
    "documentType" "public"."VehicleDocumentType" NOT NULL,
    "documentNo" TEXT,
    "issuedDate" DATE,
    "expiredDate" DATE,
    "fileUrl" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DriverDocument" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "driverId" UUID NOT NULL,
    "documentType" "public"."DriverDocumentType" NOT NULL,
    "documentNo" TEXT,
    "issuedDate" DATE,
    "expiredDate" DATE,
    "fileUrl" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."VehicleDispatchOrder" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "dispatchNo" TEXT NOT NULL,
    "sourceType" "public"."VehicleDispatchSourceType" NOT NULL DEFAULT 'DIRECT',
    "sourceId" UUID,
    "warehouseTransferId" UUID,
    "vehicleId" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "fromLocationText" TEXT NOT NULL,
    "toLocationText" TEXT NOT NULL,
    "fromSupplierLocationId" UUID,
    "toSupplierLocationId" UUID,
    "productId" UUID,
    "plannedQty" DECIMAL(18,3),
    "actualQty" DECIMAL(18,3),
    "plannedStartAt" TIMESTAMP(3) NOT NULL,
    "actualStartAt" TIMESTAMP(3),
    "actualEndAt" TIMESTAMP(3),
    "transportFeeVnd" DECIMAL(18,2),
    "status" "public"."VehicleDispatchStatus" NOT NULL DEFAULT 'DRAFT',
    "fileUrl" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleDispatchOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerOperationalRole_role_isActive_idx" ON "public"."CustomerOperationalRole"("role", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerOperationalRole_customerId_role_key" ON "public"."CustomerOperationalRole"("customerId", "role");

-- CreateIndex
CREATE INDEX "Vessel_ownerCustomerId_isActive_idx" ON "public"."Vessel"("ownerCustomerId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Vessel_ownerCustomerId_name_key" ON "public"."Vessel"("ownerCustomerId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Vessel_imoNo_key" ON "public"."Vessel"("imoNo");

-- CreateIndex
CREATE UNIQUE INDEX "ShipCharterContract_contractNo_key" ON "public"."ShipCharterContract"("contractNo");

-- CreateIndex
CREATE INDEX "ShipCharterContract_ownerCustomerId_idx" ON "public"."ShipCharterContract"("ownerCustomerId");

-- CreateIndex
CREATE INDEX "ShipCharterContract_effectiveFrom_effectiveTo_idx" ON "public"."ShipCharterContract"("effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE INDEX "ShipCharterAppendix_vesselId_idx" ON "public"."ShipCharterAppendix"("vesselId");

-- CreateIndex
CREATE INDEX "ShipCharterAppendix_laycanFrom_laycanTo_idx" ON "public"."ShipCharterAppendix"("laycanFrom", "laycanTo");

-- CreateIndex
CREATE UNIQUE INDEX "ShipCharterAppendix_contractId_appendixNo_key" ON "public"."ShipCharterAppendix"("contractId", "appendixNo");

-- CreateIndex
CREATE UNIQUE INDEX "ShipCharterOrder_charterOrderNo_key" ON "public"."ShipCharterOrder"("charterOrderNo");

-- CreateIndex
CREATE INDEX "ShipCharterOrder_purchaseOrderId_idx" ON "public"."ShipCharterOrder"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "ShipCharterOrder_termShipmentId_idx" ON "public"."ShipCharterOrder"("termShipmentId");

-- CreateIndex
CREATE INDEX "ShipCharterOrder_ownerCustomerId_idx" ON "public"."ShipCharterOrder"("ownerCustomerId");

-- CreateIndex
CREATE INDEX "ShipCharterOrder_vesselId_idx" ON "public"."ShipCharterOrder"("vesselId");

-- CreateIndex
CREATE INDEX "ShipCharterOrder_status_laycanFrom_idx" ON "public"."ShipCharterOrder"("status", "laycanFrom");

-- CreateIndex
CREATE INDEX "ShipCharterInsurance_charterOrderId_status_idx" ON "public"."ShipCharterInsurance"("charterOrderId", "status");

-- CreateIndex
CREATE INDEX "ShipCharterInsurance_insuranceCompanyId_idx" ON "public"."ShipCharterInsurance"("insuranceCompanyId");

-- CreateIndex
CREATE INDEX "ShipCharterInspection_charterOrderId_status_idx" ON "public"."ShipCharterInspection"("charterOrderId", "status");

-- CreateIndex
CREATE INDEX "ShipCharterInspection_inspectionCompanyId_idx" ON "public"."ShipCharterInspection"("inspectionCompanyId");

-- CreateIndex
CREATE INDEX "ShippingAgentRegistration_charterOrderId_status_idx" ON "public"."ShippingAgentRegistration"("charterOrderId", "status");

-- CreateIndex
CREATE INDEX "ShippingAgentRegistration_agentCustomerId_idx" ON "public"."ShippingAgentRegistration"("agentCustomerId");

-- CreateIndex
CREATE INDEX "ShipFreightRate_loadingPort_dischargePort_effectiveFrom_idx" ON "public"."ShipFreightRate"("loadingPort", "dischargePort", "effectiveFrom");

-- CreateIndex
CREATE INDEX "ShipFreightRate_ownerCustomerId_idx" ON "public"."ShipFreightRate"("ownerCustomerId");

-- CreateIndex
CREATE INDEX "ShipFreightRate_vesselId_idx" ON "public"."ShipFreightRate"("vesselId");

-- CreateIndex
CREATE UNIQUE INDEX "StorageRentalContract_contractNo_key" ON "public"."StorageRentalContract"("contractNo");

-- CreateIndex
CREATE INDEX "StorageRentalContract_lessorCustomerId_status_idx" ON "public"."StorageRentalContract"("lessorCustomerId", "status");

-- CreateIndex
CREATE INDEX "StorageRentalContract_effectiveFrom_effectiveTo_idx" ON "public"."StorageRentalContract"("effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE INDEX "StorageRentalContractLocation_supplierLocationId_idx" ON "public"."StorageRentalContractLocation"("supplierLocationId");

-- CreateIndex
CREATE UNIQUE INDEX "StorageRentalLossRate_contractId_productGroup_key" ON "public"."StorageRentalLossRate"("contractId", "productGroup");

-- CreateIndex
CREATE INDEX "StorageRentalFeeTier_contractId_sortOrder_idx" ON "public"."StorageRentalFeeTier"("contractId", "sortOrder");

-- CreateIndex
CREATE INDEX "WarehouseAvailabilityBalance_ownerType_ownerCustomerId_idx" ON "public"."WarehouseAvailabilityBalance"("ownerType", "ownerCustomerId");

-- CreateIndex
CREATE INDEX "WarehouseAvailabilityBalance_productId_idx" ON "public"."WarehouseAvailabilityBalance"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseAvailabilityBalance_supplierLocationId_productId_o_key" ON "public"."WarehouseAvailabilityBalance"("supplierLocationId", "productId", "ownerKey");

-- CreateIndex
CREATE INDEX "WarehouseAvailabilityLedger_supplierLocationId_productId_ow_idx" ON "public"."WarehouseAvailabilityLedger"("supplierLocationId", "productId", "ownerKey", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseAvailabilityLedger_sourceType_sourceId_sourceActio_key" ON "public"."WarehouseAvailabilityLedger"("sourceType", "sourceId", "sourceAction", "supplierLocationId", "productId", "ownerKey");

-- CreateIndex
CREATE INDEX "ExpectedInventory_supplierLocationId_status_expectedDate_idx" ON "public"."ExpectedInventory"("supplierLocationId", "status", "expectedDate");

-- CreateIndex
CREATE INDEX "ExpectedInventory_productId_idx" ON "public"."ExpectedInventory"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ExpectedInventory_sourceType_sourceId_supplierLocationId_pr_key" ON "public"."ExpectedInventory"("sourceType", "sourceId", "supplierLocationId", "productId", "ownerKey");

-- CreateIndex
CREATE INDEX "ExpectedInventoryReceiptAllocation_goodsReceiptId_idx" ON "public"."ExpectedInventoryReceiptAllocation"("goodsReceiptId");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseReservation_reservationNo_key" ON "public"."WarehouseReservation"("reservationNo");

-- CreateIndex
CREATE INDEX "WarehouseReservation_supplierLocationId_productId_status_idx" ON "public"."WarehouseReservation"("supplierLocationId", "productId", "status");

-- CreateIndex
CREATE INDEX "WarehouseReservation_customerId_status_idx" ON "public"."WarehouseReservation"("customerId", "status");

-- CreateIndex
CREATE INDEX "WarehouseReservation_expiredAt_idx" ON "public"."WarehouseReservation"("expiredAt");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseTransfer_transferNo_key" ON "public"."WarehouseTransfer"("transferNo");

-- CreateIndex
CREATE INDEX "WarehouseTransfer_fromSupplierLocationId_status_idx" ON "public"."WarehouseTransfer"("fromSupplierLocationId", "status");

-- CreateIndex
CREATE INDEX "WarehouseTransfer_toSupplierLocationId_status_idx" ON "public"."WarehouseTransfer"("toSupplierLocationId", "status");

-- CreateIndex
CREATE INDEX "WarehouseTransfer_vehicleId_idx" ON "public"."WarehouseTransfer"("vehicleId");

-- CreateIndex
CREATE INDEX "WarehouseTransferLine_productId_idx" ON "public"."WarehouseTransferLine"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseTransferLine_transferId_productId_key" ON "public"."WarehouseTransferLine"("transferId", "productId");

-- CreateIndex
CREATE INDEX "VehicleDocument_vehicleId_documentType_idx" ON "public"."VehicleDocument"("vehicleId", "documentType");

-- CreateIndex
CREATE INDEX "VehicleDocument_expiredDate_idx" ON "public"."VehicleDocument"("expiredDate");

-- CreateIndex
CREATE INDEX "DriverDocument_driverId_documentType_idx" ON "public"."DriverDocument"("driverId", "documentType");

-- CreateIndex
CREATE INDEX "DriverDocument_expiredDate_idx" ON "public"."DriverDocument"("expiredDate");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleDispatchOrder_dispatchNo_key" ON "public"."VehicleDispatchOrder"("dispatchNo");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleDispatchOrder_warehouseTransferId_key" ON "public"."VehicleDispatchOrder"("warehouseTransferId");

-- CreateIndex
CREATE INDEX "VehicleDispatchOrder_vehicleId_status_plannedStartAt_idx" ON "public"."VehicleDispatchOrder"("vehicleId", "status", "plannedStartAt");

-- CreateIndex
CREATE INDEX "VehicleDispatchOrder_driverId_status_plannedStartAt_idx" ON "public"."VehicleDispatchOrder"("driverId", "status", "plannedStartAt");

-- CreateIndex
CREATE INDEX "VehicleDispatchOrder_status_plannedStartAt_idx" ON "public"."VehicleDispatchOrder"("status", "plannedStartAt");

-- CreateIndex
CREATE INDEX "VehicleDispatchOrder_sourceType_sourceId_idx" ON "public"."VehicleDispatchOrder"("sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "TermLogisticsCostLine_operationsSourceType_operationsSource_key" ON "public"."TermLogisticsCostLine"("operationsSourceType", "operationsSourceId");

-- CreateIndex
CREATE INDEX "TermShipment_vesselId_idx" ON "public"."TermShipment"("vesselId");

-- AddForeignKey
ALTER TABLE "public"."CustomerOperationalRole" ADD CONSTRAINT "CustomerOperationalRole_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TermShipment" ADD CONSTRAINT "TermShipment_vesselId_fkey" FOREIGN KEY ("vesselId") REFERENCES "public"."Vessel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Vessel" ADD CONSTRAINT "Vessel_ownerCustomerId_fkey" FOREIGN KEY ("ownerCustomerId") REFERENCES "public"."Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ShipCharterContract" ADD CONSTRAINT "ShipCharterContract_ownerCustomerId_fkey" FOREIGN KEY ("ownerCustomerId") REFERENCES "public"."Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ShipCharterAppendix" ADD CONSTRAINT "ShipCharterAppendix_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "public"."ShipCharterContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ShipCharterAppendix" ADD CONSTRAINT "ShipCharterAppendix_vesselId_fkey" FOREIGN KEY ("vesselId") REFERENCES "public"."Vessel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ShipCharterOrder" ADD CONSTRAINT "ShipCharterOrder_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "public"."PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ShipCharterOrder" ADD CONSTRAINT "ShipCharterOrder_termShipmentId_fkey" FOREIGN KEY ("termShipmentId") REFERENCES "public"."TermShipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ShipCharterOrder" ADD CONSTRAINT "ShipCharterOrder_appendixId_fkey" FOREIGN KEY ("appendixId") REFERENCES "public"."ShipCharterAppendix"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ShipCharterOrder" ADD CONSTRAINT "ShipCharterOrder_ownerCustomerId_fkey" FOREIGN KEY ("ownerCustomerId") REFERENCES "public"."Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ShipCharterOrder" ADD CONSTRAINT "ShipCharterOrder_vesselId_fkey" FOREIGN KEY ("vesselId") REFERENCES "public"."Vessel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ShipCharterInsurance" ADD CONSTRAINT "ShipCharterInsurance_charterOrderId_fkey" FOREIGN KEY ("charterOrderId") REFERENCES "public"."ShipCharterOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ShipCharterInsurance" ADD CONSTRAINT "ShipCharterInsurance_insuranceCompanyId_fkey" FOREIGN KEY ("insuranceCompanyId") REFERENCES "public"."Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ShipCharterInspection" ADD CONSTRAINT "ShipCharterInspection_charterOrderId_fkey" FOREIGN KEY ("charterOrderId") REFERENCES "public"."ShipCharterOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ShipCharterInspection" ADD CONSTRAINT "ShipCharterInspection_inspectionCompanyId_fkey" FOREIGN KEY ("inspectionCompanyId") REFERENCES "public"."Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ShippingAgentRegistration" ADD CONSTRAINT "ShippingAgentRegistration_charterOrderId_fkey" FOREIGN KEY ("charterOrderId") REFERENCES "public"."ShipCharterOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ShippingAgentRegistration" ADD CONSTRAINT "ShippingAgentRegistration_agentCustomerId_fkey" FOREIGN KEY ("agentCustomerId") REFERENCES "public"."Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ShipFreightRate" ADD CONSTRAINT "ShipFreightRate_ownerCustomerId_fkey" FOREIGN KEY ("ownerCustomerId") REFERENCES "public"."Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ShipFreightRate" ADD CONSTRAINT "ShipFreightRate_vesselId_fkey" FOREIGN KEY ("vesselId") REFERENCES "public"."Vessel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StorageRentalContract" ADD CONSTRAINT "StorageRentalContract_lessorCustomerId_fkey" FOREIGN KEY ("lessorCustomerId") REFERENCES "public"."Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StorageRentalContractLocation" ADD CONSTRAINT "StorageRentalContractLocation_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "public"."StorageRentalContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StorageRentalContractLocation" ADD CONSTRAINT "StorageRentalContractLocation_supplierLocationId_fkey" FOREIGN KEY ("supplierLocationId") REFERENCES "public"."SupplierLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StorageRentalLossRate" ADD CONSTRAINT "StorageRentalLossRate_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "public"."StorageRentalContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StorageRentalFeeTier" ADD CONSTRAINT "StorageRentalFeeTier_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "public"."StorageRentalContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WarehouseAvailabilityBalance" ADD CONSTRAINT "WarehouseAvailabilityBalance_supplierLocationId_fkey" FOREIGN KEY ("supplierLocationId") REFERENCES "public"."SupplierLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WarehouseAvailabilityBalance" ADD CONSTRAINT "WarehouseAvailabilityBalance_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WarehouseAvailabilityBalance" ADD CONSTRAINT "WarehouseAvailabilityBalance_ownerCustomerId_fkey" FOREIGN KEY ("ownerCustomerId") REFERENCES "public"."Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WarehouseAvailabilityLedger" ADD CONSTRAINT "WarehouseAvailabilityLedger_supplierLocationId_fkey" FOREIGN KEY ("supplierLocationId") REFERENCES "public"."SupplierLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WarehouseAvailabilityLedger" ADD CONSTRAINT "WarehouseAvailabilityLedger_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WarehouseAvailabilityLedger" ADD CONSTRAINT "WarehouseAvailabilityLedger_ownerCustomerId_fkey" FOREIGN KEY ("ownerCustomerId") REFERENCES "public"."Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ExpectedInventory" ADD CONSTRAINT "ExpectedInventory_supplierLocationId_fkey" FOREIGN KEY ("supplierLocationId") REFERENCES "public"."SupplierLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ExpectedInventory" ADD CONSTRAINT "ExpectedInventory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ExpectedInventory" ADD CONSTRAINT "ExpectedInventory_ownerCustomerId_fkey" FOREIGN KEY ("ownerCustomerId") REFERENCES "public"."Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ExpectedInventoryReceiptAllocation" ADD CONSTRAINT "ExpectedInventoryReceiptAllocation_expectedInventoryId_fkey" FOREIGN KEY ("expectedInventoryId") REFERENCES "public"."ExpectedInventory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ExpectedInventoryReceiptAllocation" ADD CONSTRAINT "ExpectedInventoryReceiptAllocation_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "public"."GoodsReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WarehouseReservation" ADD CONSTRAINT "WarehouseReservation_supplierLocationId_fkey" FOREIGN KEY ("supplierLocationId") REFERENCES "public"."SupplierLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WarehouseReservation" ADD CONSTRAINT "WarehouseReservation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WarehouseReservation" ADD CONSTRAINT "WarehouseReservation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WarehouseTransfer" ADD CONSTRAINT "WarehouseTransfer_fromSupplierLocationId_fkey" FOREIGN KEY ("fromSupplierLocationId") REFERENCES "public"."SupplierLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WarehouseTransfer" ADD CONSTRAINT "WarehouseTransfer_toSupplierLocationId_fkey" FOREIGN KEY ("toSupplierLocationId") REFERENCES "public"."SupplierLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WarehouseTransfer" ADD CONSTRAINT "WarehouseTransfer_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "public"."Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WarehouseTransfer" ADD CONSTRAINT "WarehouseTransfer_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "public"."Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WarehouseTransfer" ADD CONSTRAINT "WarehouseTransfer_ownerCustomerId_fkey" FOREIGN KEY ("ownerCustomerId") REFERENCES "public"."Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WarehouseTransferLine" ADD CONSTRAINT "WarehouseTransferLine_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "public"."WarehouseTransfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WarehouseTransferLine" ADD CONSTRAINT "WarehouseTransferLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."VehicleDocument" ADD CONSTRAINT "VehicleDocument_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "public"."Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DriverDocument" ADD CONSTRAINT "DriverDocument_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "public"."Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."VehicleDispatchOrder" ADD CONSTRAINT "VehicleDispatchOrder_warehouseTransferId_fkey" FOREIGN KEY ("warehouseTransferId") REFERENCES "public"."WarehouseTransfer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."VehicleDispatchOrder" ADD CONSTRAINT "VehicleDispatchOrder_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "public"."Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."VehicleDispatchOrder" ADD CONSTRAINT "VehicleDispatchOrder_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "public"."Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."VehicleDispatchOrder" ADD CONSTRAINT "VehicleDispatchOrder_fromSupplierLocationId_fkey" FOREIGN KEY ("fromSupplierLocationId") REFERENCES "public"."SupplierLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."VehicleDispatchOrder" ADD CONSTRAINT "VehicleDispatchOrder_toSupplierLocationId_fkey" FOREIGN KEY ("toSupplierLocationId") REFERENCES "public"."SupplierLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."VehicleDispatchOrder" ADD CONSTRAINT "VehicleDispatchOrder_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Business invariants
ALTER TABLE "public"."WarehouseAvailabilityBalance"
ADD CONSTRAINT "WarehouseAvailabilityBalance_non_negative_check"
CHECK (
    "availableQty" >= 0 AND
    "reservedQty" >= 0 AND
    "inTransitQty" >= 0 AND
    "expectedQty" >= 0 AND
    "availableQty" >= "reservedQty"
);

ALTER TABLE "public"."WarehouseAvailabilityBalance"
ADD CONSTRAINT "WarehouseAvailabilityBalance_owner_check"
CHECK (
    ("ownerType" = 'INTERNAL' AND "ownerCustomerId" IS NULL AND "ownerKey" = 'INTERNAL') OR
    ("ownerType" <> 'INTERNAL' AND "ownerCustomerId" IS NOT NULL)
);

ALTER TABLE "public"."ExpectedInventory"
ADD CONSTRAINT "ExpectedInventory_quantity_check"
CHECK ("expectedQty" > 0 AND "receivedQty" >= 0 AND "receivedQty" <= "expectedQty");

ALTER TABLE "public"."WarehouseReservation"
ADD CONSTRAINT "WarehouseReservation_quantity_check"
CHECK ("reservedQty" > 0);

ALTER TABLE "public"."WarehouseTransfer"
ADD CONSTRAINT "WarehouseTransfer_locations_check"
CHECK ("fromSupplierLocationId" <> "toSupplierLocationId");

ALTER TABLE "public"."WarehouseTransferLine"
ADD CONSTRAINT "WarehouseTransferLine_quantity_check"
CHECK (
    "qty" > 0 AND
    "pendingDocQty" >= 0 AND
    "postedQty" >= 0 AND
    "pendingDocQty" + "postedQty" <= "qty"
);

-- Initialize the business view from current operational physical stock.
INSERT INTO "public"."WarehouseAvailabilityBalance" (
    "id", "supplierLocationId", "productId", "ownerType", "ownerKey",
    "availableQty", "reservedQty", "inTransitQty", "expectedQty", "createdAt", "updatedAt"
)
SELECT
    uuid_generate_v7(), ib."supplierLocationId", ib."productId", 'INTERNAL', 'INTERNAL',
    ib."physicalQty", 0, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "public"."InventoryBalance" ib
ON CONFLICT ("supplierLocationId", "productId", "ownerKey") DO NOTHING;

INSERT INTO "public"."WarehouseAvailabilityLedger" (
    "id", "supplierLocationId", "productId", "ownerType", "ownerKey",
    "deltaAvailableQty", "deltaReservedQty", "deltaInTransitQty", "deltaExpectedQty",
    "afterAvailableQty", "afterReservedQty", "afterInTransitQty", "afterExpectedQty",
    "sourceType", "sourceId", "sourceAction", "occurredAt", "note", "createdAt"
)
SELECT
    uuid_generate_v7(), b."supplierLocationId", b."productId", b."ownerType", b."ownerKey",
    b."availableQty", 0, 0, 0,
    b."availableQty", 0, 0, 0,
    'MANUAL', b.id, 'MIGRATION_BACKFILL', CURRENT_TIMESTAMP,
    'Khởi tạo tồn kinh doanh từ InventoryBalance.physicalQty', CURRENT_TIMESTAMP
FROM "public"."WarehouseAvailabilityBalance" b
WHERE NOT EXISTS (
    SELECT 1
    FROM "public"."WarehouseAvailabilityLedger" l
    WHERE l."sourceType" = 'MANUAL'
      AND l."sourceId" = b.id
      AND l."sourceAction" = 'MIGRATION_BACKFILL'
);

-- RBAC module and permissions
INSERT INTO "public"."Module" ("id", "code", "name", "createdAt", "updatedAt")
VALUES (uuid_generate_v7(), 'operations', 'Vận hành', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name", "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "public"."Permission" ("id", "code", "name", "moduleId", "createdAt", "updatedAt")
SELECT uuid_generate_v7(), p.code, p.name, m.id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "public"."Module" m
CROSS JOIN (
    VALUES
        ('operations.view', 'Xem phân hệ vận hành'),
        ('operations.charter.manage', 'Quản lý thuê tàu và bảo hiểm'),
        ('operations.warehouse.manage', 'Quản lý kho vận hành'),
        ('operations.road.manage', 'Quản lý xe và điều xe'),
        ('operations.partners.manage', 'Quản lý vai trò đối tác vận hành'),
        ('operations.term_costs.post', 'Đưa chi phí vận hành vào giá vốn TERM')
) AS p(code, name)
WHERE m.code = 'operations'
ON CONFLICT ("code") DO UPDATE
SET "name" = EXCLUDED."name", "moduleId" = EXCLUDED."moduleId", "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "public"."RolePermission" ("roleId", "permissionId")
SELECT r.id, p.id
FROM "public"."Role" r
CROSS JOIN "public"."Permission" p
WHERE r.code = 'system-admin' AND p.code LIKE 'operations.%'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
