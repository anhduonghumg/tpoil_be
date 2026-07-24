-- Required by all UUID primary-key defaults in this baseline.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.uuid_generate_v7()
RETURNS uuid AS $$
DECLARE
    timestamp_ms bigint;
    internal_uuid bytea;
BEGIN
    timestamp_ms := (extract(epoch FROM clock_timestamp()) * 1000)::bigint;
    internal_uuid := decode(lpad(to_hex(timestamp_ms), 12, '0'), 'hex');
    internal_uuid := internal_uuid || gen_random_bytes(10);
    internal_uuid := set_byte(internal_uuid, 6, (get_byte(internal_uuid, 6) & 15) | 112);
    internal_uuid := set_byte(internal_uuid, 8, (get_byte(internal_uuid, 8) & 63) | 128);
    RETURN encode(internal_uuid, 'hex')::uuid;
END;
$$ LANGUAGE plpgsql VOLATILE;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."BackgroundJobType" AS ENUM ('PRICE_BULLETIN_IMPORT_PDF', 'SUPPLIER_INVOICE_IMPORT_PDF', 'PURCHASE_ORDER_PRINT_BATCH');

-- CreateEnum
CREATE TYPE "public"."BackgroundJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."PriceBulletinStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'VOID');

-- CreateEnum
CREATE TYPE "public"."PaymentTermType" AS ENUM ('SAME_DAY', 'NET_DAYS');

-- CreateEnum
CREATE TYPE "public"."QtyBasis" AS ENUM ('ACTUAL', 'V15');

-- CreateEnum
CREATE TYPE "public"."PricingStageType" AS ENUM ('ESTIMATE', 'BILL_NORMALIZE', 'FINAL', 'BOSS_SHEET');

-- CreateEnum
CREATE TYPE "public"."PricingSheetRowType" AS ENUM ('PRICE_DAY', 'INPUT', 'FORMULA', 'COST', 'TAX', 'RESULT', 'NOTE');

-- CreateEnum
CREATE TYPE "public"."PricingSheetValueType" AS ENUM ('NUMBER', 'MONEY', 'PERCENT', 'TEXT', 'DATE');

-- CreateEnum
CREATE TYPE "public"."FxStage" AS ENUM ('ESTIMATE', 'OFFICIAL');

-- CreateEnum
CREATE TYPE "public"."CostLayerStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "public"."PriceSource" AS ENUM ('PLATTS', 'MOPS', 'ARGUS', 'MANUAL');

-- CreateEnum
CREATE TYPE "public"."PurchaseCostType" AS ENUM ('INSURANCE', 'INSPECTION', 'TRANSPORT', 'STORAGE', 'LOSS', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."ContractKind" AS ENUM ('SALES', 'PURCHASE');

-- CreateEnum
CREATE TYPE "public"."PartyType" AS ENUM ('CUSTOMER', 'SUPPLIER', 'INTERNAL');

-- CreateEnum
CREATE TYPE "public"."EmployeeStatus" AS ENUM ('active', 'inactive', 'suspended', 'probation', 'terminated');

-- CreateEnum
CREATE TYPE "public"."Gender" AS ENUM ('male', 'female', 'other');

-- CreateEnum
CREATE TYPE "public"."DepartmentType" AS ENUM ('board', 'office', 'group', 'branch');

-- CreateEnum
CREATE TYPE "public"."ManagerRole" AS ENUM ('head', 'deputy', 'acting');

-- CreateEnum
CREATE TYPE "public"."ScopeType" AS ENUM ('global', 'department', 'site', 'employee');

-- CreateEnum
CREATE TYPE "public"."ExportFormat" AS ENUM ('csv', 'xlsx', 'pdf');

-- CreateEnum
CREATE TYPE "public"."JobStatus" AS ENUM ('queued', 'running', 'done', 'failed', 'partial');

-- CreateEnum
CREATE TYPE "public"."ImportMode" AS ENUM ('append', 'upsert', 'replace');

-- CreateEnum
CREATE TYPE "public"."CustomerType" AS ENUM ('B2B', 'B2C', 'Distributor', 'Other');

-- CreateEnum
CREATE TYPE "public"."CustomerRole" AS ENUM ('Agent', 'Retail', 'Wholesale', 'Other');

-- CreateEnum
CREATE TYPE "public"."CustomerStatus" AS ENUM ('Active', 'Inactive', 'Blacklisted');

-- CreateEnum
CREATE TYPE "public"."TaxSource" AS ENUM ('Sepay', 'Manual', 'Other');

-- CreateEnum
CREATE TYPE "public"."ContractStatus" AS ENUM ('Draft', 'Pending', 'Active', 'Terminated', 'Cancelled');

-- CreateEnum
CREATE TYPE "public"."PricingRunStatus" AS ENUM ('DRAFT', 'ESTIMATED', 'NORMALIZED', 'FINAL_READY', 'POSTED');

-- CreateEnum
CREATE TYPE "public"."RiskLevel" AS ENUM ('Low', 'Medium', 'High');

-- CreateEnum
CREATE TYPE "public"."AttachmentCategory" AS ENUM ('ScanSigned', 'Draft', 'Appendix', 'Other');

-- CreateEnum
CREATE TYPE "public"."RiskSource" AS ENUM ('Manual', 'AutoRule', 'Overdue');

-- CreateEnum
CREATE TYPE "public"."CronJobType" AS ENUM ('CONTRACT_EXPIRY_DAILY');

-- CreateEnum
CREATE TYPE "public"."CronJobStatus" AS ENUM ('SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."QtyUom" AS ENUM ('LITER', 'KG', 'UNIT');

-- CreateEnum
CREATE TYPE "public"."PurchaseOrderType" AS ENUM ('SINGLE', 'LOT');

-- CreateEnum
CREATE TYPE "public"."PurchaseOrderStatus" AS ENUM ('DRAFT', 'APPROVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."SalesOrderStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'PARTIALLY_RESERVED', 'RESERVED', 'PARTIALLY_DELIVERED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."SalesDeliveryStatus" AS ENUM ('DRAFT', 'READY', 'POSTED', 'VOIDED');

-- CreateEnum
CREATE TYPE "public"."TermOrderDocumentSourceType" AS ENUM ('ESTIMATE_PRICING', 'DIRECT');

-- CreateEnum
CREATE TYPE "public"."TermOrderDocumentStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."TermPurchaseFlowType" AS ENUM ('ESTIMATE_FIRST', 'DIRECT_ORDER');

-- CreateEnum
CREATE TYPE "public"."TermPaymentRequestStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'IN_BATCH', 'SENT_TO_BANK', 'PARTIALLY_PAID', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."TermBankInstructionStatus" AS ENUM ('DRAFT', 'SENT', 'MATCHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."TermSettlementAdjustmentType" AS ENUM ('ADDITIONAL_PAYMENT', 'REFUND', 'NO_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "public"."TermSettlementAdjustmentStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."TermPaymentBatchStatus" AS ENUM ('DRAFT', 'SENT_TO_BANK', 'PARTIALLY_PAID', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."TermPaymentBatchItemStatus" AS ENUM ('PENDING', 'SENT', 'PARTIALLY_PAID', 'PAID', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."TermPaymentBatchFileType" AS ENUM ('EXPORTED_LIST', 'BANK_RETURN', 'UNC', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."PaymentMode" AS ENUM ('PREPAID', 'POSTPAID');

-- CreateEnum
CREATE TYPE "public"."GoodsReceiptStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'VOID');

-- CreateEnum
CREATE TYPE "public"."BankTxnDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "public"."BankImportStatus" AS ENUM ('QUEUED', 'PROCESSING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."BankTxnMatchStatus" AS ENUM ('UNMATCHED', 'AUTO_MATCHED', 'MANUAL_MATCHED', 'PARTIAL_MATCHED');

-- CreateEnum
CREATE TYPE "public"."SettlementType" AS ENUM ('ADVANCE', 'PAYABLE');

-- CreateEnum
CREATE TYPE "public"."CounterpartyType" AS ENUM ('SUPPLIER', 'CUSTOMER', 'INTERNAL', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."PurchaseBizType" AS ENUM ('COMMERCIAL', 'TERM');

-- CreateEnum
CREATE TYPE "public"."TermTransportMode" AS ENUM ('PIPELINE', 'SEA', 'ROAD');

-- CreateEnum
CREATE TYPE "public"."PurchaseShipmentStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'VOID');

-- CreateEnum
CREATE TYPE "public"."TermLogisticsCostStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'ALLOCATED', 'POSTED', 'VOID');

-- CreateEnum
CREATE TYPE "public"."TermLogisticsCostType" AS ENUM ('FREIGHT', 'INSURANCE', 'INSPECTION', 'PORT_FEE', 'HANDLING', 'PIPELINE_FEE', 'STORAGE', 'LOSS', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."TermCostAllocationBasis" AS ENUM ('BY_ACTUAL_QTY', 'BY_V15_QTY', 'BY_VALUE', 'MANUAL');

-- CreateEnum
CREATE TYPE "public"."OperationalPartyRole" AS ENUM ('SHIP_OWNER', 'SEA_CARRIER', 'SURVEYOR', 'SHIPPING_AGENT', 'INSURER', 'STORAGE_LESSOR', 'ROAD_CARRIER');

-- CreateEnum
CREATE TYPE "public"."VesselDocumentType" AS ENUM ('VESSEL_REGISTRATION', 'VESSEL_INSPECTION', 'FIRE_SAFETY_CERTIFICATE', 'TANK_CALIBRATION_BAREM', 'H_AND_M_INSURANCE', 'P_AND_I_INSURANCE', 'PIPELINE_SYSTEM_DOCUMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."ShipCharterOrderSourceType" AS ENUM ('DIRECT', 'FROM_TERM');

-- CreateEnum
CREATE TYPE "public"."ShipCharterOrderStatus" AS ENUM ('DRAFT', 'WAITING_CONFIRMATION', 'CONFIRMED', 'APPENDIX_CREATED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."ShipCharterContractStatus" AS ENUM ('DRAFT', 'ACTIVE', 'EXPIRED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "public"."ShipFreightRateSourceType" AS ENUM ('CONTRACT', 'APPENDIX', 'MANUAL');

-- CreateEnum
CREATE TYPE "public"."ShipFreightRateStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "public"."OperationRegistrationStatus" AS ENUM ('DRAFT', 'REGISTERED', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."InspectionType" AS ENUM ('QUANTITY', 'QUALITY', 'BOTH');

-- CreateEnum
CREATE TYPE "public"."StorageRentalContractStatus" AS ENUM ('DRAFT', 'ACTIVE', 'EXPIRED', 'TERMINATED');

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

-- CreateEnum
CREATE TYPE "public"."PartyKind" AS ENUM ('ORGANIZATION', 'INDIVIDUAL');

-- CreateEnum
CREATE TYPE "public"."PartyRoleType" AS ENUM ('CUSTOMER', 'SUPPLIER', 'INTERNAL_COMPANY', 'INVENTORY_OWNER', 'WAREHOUSE_OPERATOR', 'WAREHOUSE_LESSOR', 'SHIP_OWNER', 'SEA_CARRIER', 'ROAD_CARRIER', 'SURVEYOR', 'SHIPPING_AGENT', 'INSURER', 'STORAGE_LESSOR');

-- CreateEnum
CREATE TYPE "public"."MasterStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "public"."QuantityUom" AS ENUM ('LITER', 'KILOGRAM', 'UNIT');

-- CreateEnum
CREATE TYPE "public"."WarehousePartyRole" AS ENUM ('OPERATOR', 'LESSOR');

-- CreateEnum
CREATE TYPE "public"."ExpectedSupplyStatus" AS ENUM ('OPEN', 'PARTIALLY_FULFILLED', 'FULFILLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."InventoryPostingKind" AS ENUM ('RECEIPT', 'MOVEMENT_DISPATCH', 'MOVEMENT_ARRIVAL', 'OWNERSHIP_TRANSFER', 'ADJUSTMENT', 'SALES_ISSUE', 'REVERSAL');

-- CreateEnum
CREATE TYPE "public"."InventoryPostingStatus" AS ENUM ('POSTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "public"."ReservationStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PARTIALLY_RELEASED', 'CONSUMED', 'RELEASED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "public"."ReservationEventType" AS ENUM ('ACTIVATE', 'RELEASE', 'CONSUME', 'CANCEL', 'EXPIRE');

-- CreateEnum
CREATE TYPE "public"."RestrictionStatus" AS ENUM ('ACTIVE', 'PARTIALLY_RELEASED', 'RELEASED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."RestrictionEventType" AS ENUM ('ACTIVATE', 'RELEASE', 'CANCEL');

-- CreateEnum
CREATE TYPE "public"."InventoryMovementType" AS ENUM ('WAREHOUSE_TRANSFER', 'TEMPORARY_ISSUE_INSPECTION', 'TEMPORARY_ISSUE_PROCESSING', 'CUSTOMER_DELIVERY', 'RETURN');

-- CreateEnum
CREATE TYPE "public"."InventoryMovementStatus" AS ENUM ('DRAFT', 'READY', 'IN_TRANSIT', 'PARTIALLY_ARRIVED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."InventoryDocumentStatus" AS ENUM ('DRAFT', 'POSTED', 'VOIDED');

-- CreateEnum
CREATE TYPE "public"."ReconciliationStatus" AS ENUM ('DRAFT', 'IMPORTING', 'READY_TO_MAP', 'COMPARING', 'REVIEWING', 'CLOSED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."ReconciliationScope" AS ENUM ('PRODUCT_TOTAL', 'OWNER_DETAIL');

-- CreateEnum
CREATE TYPE "public"."ReconciliationRowStatus" AS ENUM ('RAW', 'MAPPED', 'INVALID', 'IGNORED');

-- CreateEnum
CREATE TYPE "public"."ReconciliationVarianceStatus" AS ENUM ('OPEN', 'EXPLAINED', 'RESOLVED', 'ACCEPTED');

-- CreateEnum
CREATE TYPE "public"."CostDocumentStatus" AS ENUM ('DRAFT', 'POSTED', 'VOIDED');

-- CreateEnum
CREATE TYPE "public"."CostLayerEntryType" AS ENUM ('OPEN_PROVISIONAL', 'FINALIZE', 'LANDED_COST', 'SALES_ISSUE', 'RETURN', 'REVALUATION', 'REVERSAL');

-- CreateEnum
CREATE TYPE "public"."SupplierInvoiceStatus" AS ENUM ('DRAFT', 'POSTED', 'VOIDED');

-- CreateEnum
CREATE TYPE "public"."PayableOpenItemStatus" AS ENUM ('OPEN', 'PARTIALLY_SETTLED', 'SETTLED', 'VOIDED');

-- CreateEnum
CREATE TYPE "public"."PayableEntryType" AS ENUM ('OPEN', 'PAYMENT', 'CREDIT_NOTE', 'FX_DIFFERENCE', 'REVERSAL');

-- CreateEnum
CREATE TYPE "public"."PayableAllocationStatus" AS ENUM ('ACTIVE', 'REVERSED');

-- CreateTable
CREATE TABLE "public"."DocumentSequence" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "moduleCode" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "currentNo" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CronJob" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "type" "public"."CronJobType" NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CronJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CronJobRun" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "jobId" UUID NOT NULL,
    "runDate" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "status" "public"."CronJobStatus" NOT NULL,
    "metrics" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CronJobRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BackgroundJob" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "type" "public"."BackgroundJobType" NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackgroundJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BackgroundJobRun" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "jobId" UUID NOT NULL,
    "status" "public"."BackgroundJobStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "metrics" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackgroundJobRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."JobArtifact" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "runId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "storage" TEXT NOT NULL DEFAULT 'DB',
    "content" JSONB,
    "fileUrl" TEXT,
    "checksum" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."User" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Employee" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "code" TEXT NOT NULL,
    "userId" UUID,
    "fullName" TEXT,
    "phone" TEXT,
    "workEmail" TEXT,
    "personalEmail" TEXT,
    "status" "public"."EmployeeStatus" NOT NULL DEFAULT 'active',
    "gender" "public"."Gender",
    "nationality" TEXT,
    "maritalStatus" TEXT,
    "title" TEXT,
    "grade" TEXT,
    "floor" INTEGER,
    "desk" TEXT,
    "siteId" UUID,
    "managerId" UUID,
    "dob" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3),
    "leftAt" TIMESTAMP(3),
    "avatarUrl" TEXT,
    "accessCardId" TEXT,
    "addressPermanent" TEXT,
    "addressCurrent" TEXT,
    "banking" JSONB,
    "citizen" JSONB,
    "emergency" JSONB,
    "tax" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Area" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Area_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Site" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "areaId" UUID,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Department" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "public"."DepartmentType" NOT NULL,
    "parentId" UUID,
    "siteId" UUID,
    "costCenter" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedBy" TEXT,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."EmployeeDepartment" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "employeeId" UUID NOT NULL,
    "departmentId" UUID NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeDepartment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DepartmentManager" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "departmentId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "role" "public"."ManagerRole" NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DepartmentManager_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Module" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Module_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Permission" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "moduleId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Role" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "desc" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RolePermission" (
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "public"."UserRoleBinding" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "scopeType" "public"."ScopeType" NOT NULL,
    "scopeId" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserRoleBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CustomerGroup" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "code" TEXT NOT NULL,
    "name" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CustomerAddress" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "customerId" UUID NOT NULL,
    "addressLine" TEXT NOT NULL,
    "validFrom" DATE NOT NULL,
    "validTo" DATE,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ContactPerson" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "customerId" UUID NOT NULL,
    "fullName" TEXT NOT NULL,
    "position" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ContactPerson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Contract" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "customerId" UUID,
    "contractTypeId" UUID NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "public"."ContractStatus" NOT NULL DEFAULT 'Draft',
    "paymentTermDays" INTEGER,
    "creditLimitOverride" DECIMAL(65,30),
    "sla" JSONB,
    "deliveryScope" JSONB,
    "riskLevel" "public"."RiskLevel" NOT NULL DEFAULT 'Low',
    "approvalRequestId" TEXT,
    "kind" "public"."ContractKind" NOT NULL DEFAULT 'SALES',
    "renewalOfId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ContractType" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ContractType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ContractAttachment" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "contractId" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT,
    "externalUrl" TEXT,
    "category" "public"."AttachmentCategory" NOT NULL,

    CONSTRAINT "ContractAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ContractItem" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "contractId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "uom" TEXT NOT NULL,
    "price" DECIMAL(65,30) NOT NULL,
    "minQty" DECIMAL(65,30),
    "maxQty" DECIMAL(65,30),
    "discount" DECIMAL(65,30),
    "taxRate" DECIMAL(65,30),
    "note" TEXT,

    CONSTRAINT "ContractItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ContractAppendix" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "contractId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "changeSummary" TEXT,
    "docUrl" TEXT,

    CONSTRAINT "ContractAppendix_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CreditLimitHistory" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "customerId" UUID NOT NULL,
    "oldLimit" DECIMAL(65,30),
    "newLimit" DECIMAL(65,30),
    "tempLimit" DECIMAL(65,30),
    "tempFrom" TIMESTAMP(3),
    "tempTo" TIMESTAMP(3),
    "reason" TEXT,
    "changedBy" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditLimitHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RiskFlag" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "customerId" UUID NOT NULL,
    "level" "public"."RiskLevel" NOT NULL,
    "source" "public"."RiskSource" NOT NULL,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "RiskFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Vehicle" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "supplierCustomerId" UUID NOT NULL,
    "licensePlate" TEXT NOT NULL,
    "type" TEXT,
    "capacity" DECIMAL(18,3),
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Driver" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "supplierCustomerId" UUID NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "idCard" TEXT,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Driver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Product" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameMisa" TEXT,
    "uom" "public"."QtyUom" NOT NULL DEFAULT 'LITER',
    "status" "public"."MasterStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProductAlias" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "productId" UUID NOT NULL,
    "partyId" UUID,
    "externalCode" TEXT,
    "externalName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "validFrom" DATE NOT NULL,
    "validTo" DATE,

    CONSTRAINT "ProductAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PurchaseOrder" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "legalEntityId" UUID NOT NULL,
    "orderNo" TEXT NOT NULL,
    "supplierCustomerId" UUID NOT NULL,
    "priceRegionId" UUID,
    "bizType" "public"."PurchaseBizType" NOT NULL DEFAULT 'COMMERCIAL',
    "orderType" "public"."PurchaseOrderType" NOT NULL,
    "status" "public"."PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "paymentMode" "public"."PaymentMode" NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'VND',
    "paymentTermType" "public"."PaymentTermType" NOT NULL DEFAULT 'SAME_DAY',
    "paymentTermDays" INTEGER,
    "allowPartialPayment" BOOLEAN NOT NULL DEFAULT true,
    "orderDate" TIMESTAMP(3) NOT NULL,
    "expectedDate" TIMESTAMP(3),
    "paymentNote" TEXT,
    "note" TEXT,
    "contractNo" TEXT,
    "contractId" UUID,
    "deliveryLocation" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TermPurchaseProfile" (
    "purchaseOrderId" UUID NOT NULL,
    "premiumUsdPerBbl" DECIMAL(24,8),
    "transportMode" "public"."TermTransportMode" NOT NULL,
    "charterRequired" BOOLEAN NOT NULL DEFAULT false,
    "flowType" "public"."TermPurchaseFlowType" NOT NULL DEFAULT 'ESTIMATE_FIRST',

    CONSTRAINT "TermPurchaseProfile_pkey" PRIMARY KEY ("purchaseOrderId")
);

-- CreateTable
CREATE TABLE "public"."PurchaseOrderLine" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "purchaseOrderId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "productId" UUID NOT NULL,
    "receivingWarehouseId" UUID,
    "orderedQty" DECIMAL(18,3) NOT NULL,
    "unitPrice" DECIMAL(18,2),
    "taxRate" DECIMAL(5,2),
    "discountAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PurchaseTermOrderDocument" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "purchaseOrderId" UUID NOT NULL,
    "sourceType" "public"."TermOrderDocumentSourceType" NOT NULL,
    "sourcePricingStageId" UUID,
    "documentNo" TEXT NOT NULL,
    "documentDate" DATE NOT NULL,
    "buyerName" TEXT NOT NULL,
    "buyerAddress" TEXT,
    "buyerPhone" TEXT,
    "buyerFax" TEXT,
    "supplierName" TEXT NOT NULL,
    "supplierAddress" TEXT,
    "supplierPhone" TEXT,
    "contractNo" TEXT,
    "appendixNo" TEXT,
    "deliveryTimeText" TEXT,
    "deliveryLocation" TEXT,
    "paymentMethodText" TEXT,
    "priceBasisNote" TEXT,
    "officialPriceNote" TEXT,
    "includedTaxNote" TEXT,
    "totalQtyLiter" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "unitPriceVndPerLiter" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "amountVnd" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "totalAmountVnd" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" "public"."TermOrderDocumentStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "sourceHash" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseTermOrderDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PurchaseTermOrderDocumentLine" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "documentId" UUID NOT NULL,
    "productId" UUID,
    "productCode" TEXT,
    "productName" TEXT NOT NULL,
    "qtyLiter" DECIMAL(18,3) NOT NULL,
    "unitPriceVndPerLiter" DECIMAL(18,6) NOT NULL,
    "amountVnd" DECIMAL(18,2) NOT NULL,
    "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseTermOrderDocumentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PurchaseTermPaymentRequest" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "purchaseOrderId" UUID NOT NULL,
    "orderDocumentId" UUID,
    "sourcePricingStageId" UUID,
    "requestNo" TEXT NOT NULL,
    "requestDate" DATE NOT NULL,
    "supplierName" TEXT NOT NULL,
    "content" TEXT,
    "amountVnd" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'VND',
    "paymentDeadline" DATE,
    "status" "public"."TermPaymentRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseTermPaymentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TermPaymentBatch" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "batchNo" TEXT NOT NULL,
    "batchDate" DATE NOT NULL,
    "bankAccountId" UUID,
    "totalAmountVnd" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "status" "public"."TermPaymentBatchStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TermPaymentBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TermPaymentBatchItem" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "batchId" UUID NOT NULL,
    "paymentRequestId" UUID NOT NULL,
    "purchaseOrderId" UUID NOT NULL,
    "bankTransactionId" UUID,
    "supplierName" TEXT NOT NULL,
    "amountVnd" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "paidAmountVnd" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "beneficiaryName" TEXT,
    "beneficiaryBankAccount" TEXT,
    "beneficiaryBankName" TEXT,
    "transferContent" TEXT,
    "status" "public"."TermPaymentBatchItemStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TermPaymentBatchItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TermPaymentBatchFile" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "batchId" UUID NOT NULL,
    "fileType" "public"."TermPaymentBatchFileType" NOT NULL DEFAULT 'OTHER',
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileChecksum" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TermPaymentBatchFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PurchaseTermBankInstruction" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "purchaseOrderId" UUID NOT NULL,
    "paymentRequestId" UUID,
    "bankTransactionId" UUID,
    "instructionNo" TEXT,
    "instructionDate" DATE,
    "amountVnd" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "beneficiaryName" TEXT,
    "beneficiaryBankAccount" TEXT,
    "beneficiaryBankName" TEXT,
    "content" TEXT,
    "status" "public"."TermBankInstructionStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseTermBankInstruction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PurchaseTermSettlementAdjustment" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "purchaseOrderId" UUID NOT NULL,
    "finalPricingStageId" UUID,
    "adjustmentType" "public"."TermSettlementAdjustmentType" NOT NULL,
    "amountVnd" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "reason" TEXT,
    "status" "public"."TermSettlementAdjustmentStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseTermSettlementAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PurchaseShipment" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "shipmentNo" TEXT NOT NULL,
    "purchaseOrderId" UUID NOT NULL,
    "transportMode" "public"."TermTransportMode" NOT NULL DEFAULT 'SEA',
    "vesselName" TEXT,
    "voyageNo" TEXT,
    "blNo" TEXT,
    "loadingPort" TEXT,
    "dischargePort" TEXT,
    "etd" TIMESTAMP(3),
    "eta" TIMESTAMP(3),
    "surveyorName" TEXT,
    "note" TEXT,
    "status" "public"."PurchaseShipmentStatus" NOT NULL DEFAULT 'DRAFT',
    "vesselId" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PurchaseShipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PurchaseShipmentLine" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "shipmentId" UUID NOT NULL,
    "purchaseOrderLineId" UUID NOT NULL,
    "plannedActualQty" DECIMAL(24,6) NOT NULL,
    "plannedV15Qty" DECIMAL(24,6),

    CONSTRAINT "PurchaseShipmentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SalesOrder" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "legalEntityId" UUID NOT NULL,
    "orderNo" TEXT NOT NULL,
    "customerPartyId" UUID NOT NULL,
    "status" "public"."SalesOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "orderDate" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "SalesOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SalesOrderLine" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "salesOrderId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "productId" UUID NOT NULL,
    "orderedActualQty" DECIMAL(24,6) NOT NULL,
    "orderedV15Qty" DECIMAL(24,6),
    "unitPrice" DECIMAL(24,8) NOT NULL,
    "taxRate" DECIMAL(9,6),
    "note" TEXT,

    CONSTRAINT "SalesOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SalesDelivery" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "deliveryNo" TEXT NOT NULL,
    "salesOrderId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "status" "public"."SalesDeliveryStatus" NOT NULL DEFAULT 'DRAFT',
    "plannedAt" TIMESTAMPTZ(6),
    "deliveredAt" TIMESTAMPTZ(6),
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "SalesDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SalesDeliveryLine" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "salesDeliveryId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "salesOrderLineId" UUID NOT NULL,
    "ownerPartyId" UUID NOT NULL,
    "actualQty" DECIMAL(24,6) NOT NULL,
    "v15Qty" DECIMAL(24,6),

    CONSTRAINT "SalesDeliveryLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TermLogisticsCost" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "purchaseOrderId" UUID NOT NULL,
    "shipmentId" UUID,
    "vendorCustomerId" UUID,
    "documentNo" TEXT,
    "documentDate" DATE,
    "currency" TEXT NOT NULL DEFAULT 'VND',
    "fxRate" DECIMAL(18,6),
    "totalBeforeVat" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalVat" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalAfterVat" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" "public"."TermLogisticsCostStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TermLogisticsCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TermLogisticsCostLine" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "logisticsCostId" UUID NOT NULL,
    "costType" "public"."TermLogisticsCostType" NOT NULL,
    "productId" UUID,
    "purchaseOrderLineId" UUID,
    "goodsReceiptId" UUID,
    "allocationBasis" "public"."TermCostAllocationBasis" NOT NULL DEFAULT 'BY_ACTUAL_QTY',
    "amountBeforeVat" DECIMAL(18,2) NOT NULL,
    "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "vatAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amountAfterVat" DECIMAL(18,2) NOT NULL,
    "amountVndBeforeVat" DECIMAL(18,2),
    "isCapitalizedToCost" BOOLEAN NOT NULL DEFAULT true,
    "operationsSourceType" "public"."OperationalCostSourceType",
    "operationsSourceId" UUID,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TermLogisticsCostLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PurchaseOrderPaymentPlan" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "purchaseOrderId" UUID NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrderPaymentPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."GoodsReceipt" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "receiptNo" TEXT NOT NULL,
    "supplierCustomerId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "receiptDate" TIMESTAMPTZ(6) NOT NULL,
    "receiptDocumentTemplate" TEXT,
    "sourceFileName" TEXT,
    "sourceFileUrl" TEXT,
    "sourceFileMimeType" TEXT,
    "sourceFileSizeBytes" INTEGER,
    "sourceFileChecksum" TEXT,
    "note" TEXT,
    "vehicleId" UUID,
    "driverId" UUID,
    "shippingFee" DECIMAL(18,2) DEFAULT 0,
    "status" "public"."GoodsReceiptStatus" NOT NULL DEFAULT 'DRAFT',
    "purchaseOrderId" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "GoodsReceipt_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "public"."VesselDocument" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "vesselId" UUID NOT NULL,
    "documentType" "public"."VesselDocumentType" NOT NULL,
    "documentNo" TEXT,
    "issuedDate" DATE,
    "expiredDate" DATE,
    "fileUrl" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VesselDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ShipCharterContract" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "contractNo" TEXT NOT NULL,
    "ownerCustomerId" UUID NOT NULL,
    "signedDate" DATE,
    "effectiveFrom" DATE,
    "effectiveTo" DATE,
    "qtyBasis" TEXT NOT NULL DEFAULT 'V15',
    "freightVatIncluded" BOOLEAN NOT NULL DEFAULT false,
    "defaultLaytimeHours" DECIMAL(10,2),
    "demurrageRatePerDay" DECIMAL(18,2),
    "paymentTermDays" INTEGER,
    "paymentTermText" TEXT,
    "status" "public"."ShipCharterContractStatus" NOT NULL DEFAULT 'DRAFT',
    "fileUrl" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipCharterContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ShipCharterContractLossRate" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "contractId" UUID NOT NULL,
    "productGroup" TEXT NOT NULL,
    "lossRatePercent" DECIMAL(7,4) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipCharterContractLossRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ShipCharterAppendix" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "contractId" UUID NOT NULL,
    "appendixNo" TEXT NOT NULL,
    "appendixDate" DATE NOT NULL,
    "vesselId" UUID,
    "purchaseOrderId" UUID,
    "productId" UUID,
    "receivingWarehouseId" UUID,
    "cargoName" TEXT,
    "plannedQty" DECIMAL(18,3),
    "plannedQtyUnit" TEXT NOT NULL DEFAULT 'LITER',
    "qtyTolerancePercent" DECIMAL(7,4),
    "loadingPort" TEXT,
    "dischargePort" TEXT,
    "laycanFrom" DATE,
    "laycanTo" DATE,
    "freightRateVndPerLiter" DECIMAL(18,6),
    "qtyBasis" TEXT NOT NULL DEFAULT 'V15',
    "vatIncluded" BOOLEAN NOT NULL DEFAULT false,
    "vatRate" DECIMAL(7,4),
    "lossRatePercent" DECIMAL(7,4),
    "deliveryMethod" TEXT,
    "paymentTermText" TEXT,
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
    "shipmentId" UUID,
    "appendixId" UUID,
    "contractId" UUID,
    "ownerCustomerId" UUID,
    "vesselId" UUID,
    "receivingWarehouseId" UUID,
    "productId" UUID,
    "laycanFrom" DATE,
    "laycanTo" DATE,
    "cargoName" TEXT,
    "plannedQty" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "plannedQtyUnit" TEXT NOT NULL DEFAULT 'LITER',
    "qtyTolerancePercent" DECIMAL(7,4),
    "loadingPort" TEXT,
    "dischargePort" TEXT,
    "freightRateVndPerLiter" DECIMAL(18,6),
    "qtyBasis" TEXT NOT NULL DEFAULT 'V15',
    "vatIncluded" BOOLEAN NOT NULL DEFAULT false,
    "vatRate" DECIMAL(7,4),
    "lossRatePercent" DECIMAL(7,4),
    "insuranceRequired" BOOLEAN NOT NULL DEFAULT false,
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
    "rateCode" TEXT NOT NULL,
    "ownerCustomerId" UUID,
    "vesselId" UUID,
    "contractId" UUID,
    "appendixId" UUID,
    "sourceType" "public"."ShipFreightRateSourceType" NOT NULL DEFAULT 'MANUAL',
    "loadingPort" TEXT NOT NULL,
    "dischargePort" TEXT NOT NULL,
    "routeName" TEXT,
    "productGroup" TEXT,
    "productId" UUID,
    "qtyBasis" TEXT NOT NULL DEFAULT 'V15',
    "freightRateVndPerLiter" DECIMAL(18,6) NOT NULL,
    "rateUnit" TEXT NOT NULL DEFAULT 'VND_PER_LITER',
    "currency" TEXT NOT NULL DEFAULT 'VND',
    "vatIncluded" BOOLEAN NOT NULL DEFAULT false,
    "vatRate" DECIMAL(7,4),
    "allowedLossRatePercent" DECIMAL(7,4),
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "status" "public"."ShipFreightRateStatus" NOT NULL DEFAULT 'ACTIVE',
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
    "inventoryMovementId" UUID,
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

-- CreateTable
CREATE TABLE "public"."PurchasePricingRunReceipt" (
    "runId" UUID NOT NULL,
    "goodsReceiptId" UUID NOT NULL,
    "qtyActualUsed" DECIMAL(18,3),
    "qtyV15Used" DECIMAL(18,3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchasePricingRunReceipt_pkey" PRIMARY KEY ("runId","goodsReceiptId")
);

-- CreateTable
CREATE TABLE "public"."BankTransactionPurpose" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "direction" "public"."BankTxnDirection",
    "module" TEXT,
    "counterpartyType" "public"."CounterpartyType",
    "affectsDebt" BOOLEAN NOT NULL DEFAULT false,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankTransactionPurpose_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BankAccount" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "bankCode" TEXT NOT NULL,
    "bankName" TEXT,
    "accountNo" TEXT NOT NULL,
    "accountName" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'VND',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BankImportTemplate" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "bankCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "columnMap" JSONB NOT NULL,
    "normalizeRule" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankImportTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BankStatementImport" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "bankAccountId" UUID NOT NULL,
    "templateId" UUID,
    "status" "public"."BankImportStatus" NOT NULL DEFAULT 'QUEUED',
    "fileUrl" TEXT NOT NULL,
    "fileChecksum" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "importedCount" INTEGER NOT NULL DEFAULT 0,
    "duplicatedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,

    CONSTRAINT "BankStatementImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BankTransaction" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "bankAccountId" UUID NOT NULL,
    "importId" UUID,
    "txnDate" TIMESTAMP(3) NOT NULL,
    "direction" "public"."BankTxnDirection" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "description" TEXT NOT NULL,
    "counterpartyName" TEXT,
    "counterpartyAcc" TEXT,
    "externalRef" TEXT,
    "fingerprint" TEXT NOT NULL,
    "documentCode" TEXT,
    "purposeRaw" TEXT,
    "purposeId" UUID,
    "counterpartyType" "public"."CounterpartyType",
    "counterpartyId" UUID,
    "note" TEXT,
    "matchStatus" "public"."BankTxnMatchStatus" NOT NULL DEFAULT 'UNMATCHED',
    "raw" JSONB,
    "postedDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "confirmedAt" TIMESTAMP(3),
    "confirmedBy" UUID,

    CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CommodityPriceQuote" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "productId" UUID NOT NULL,
    "quoteDate" DATE NOT NULL,
    "source" "public"."PriceSource" NOT NULL DEFAULT 'PLATTS',
    "priceUsdPerBbl" DECIMAL(18,6) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommodityPriceQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ExchangeRate" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "rateDate" DATE NOT NULL,
    "base" TEXT NOT NULL DEFAULT 'USD',
    "quote" TEXT NOT NULL DEFAULT 'VND',
    "stage" "public"."FxStage" NOT NULL DEFAULT 'ESTIMATE',
    "rate" DECIMAL(18,6) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."VcbFxRate" (
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
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VcbFxRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."EnvironmentalTaxRate" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "productId" UUID NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "taxVndPerLiter" DECIMAL(18,6) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnvironmentalTaxRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SupplierPricingTemplate" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "supplierCustomerId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "qtyBasisDefault" "public"."QtyBasis" NOT NULL DEFAULT 'ACTUAL',
    "useBillNormalize" BOOLEAN NOT NULL DEFAULT false,
    "useReconcile" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierPricingTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PurchasePricingRun" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "purchaseOrderId" UUID NOT NULL,
    "supplierCustomerId" UUID NOT NULL,
    "billDate" DATE,
    "qtyBasisSelected" "public"."QtyBasis",
    "qtyBasisLocked" BOOLEAN NOT NULL DEFAULT false,
    "qtyActualTotal" DECIMAL(18,3),
    "qtyV15Total" DECIMAL(18,3),
    "status" "public"."PricingRunStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "supersedesRunId" UUID,
    "inputHash" TEXT,
    "postedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchasePricingRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PurchasePricingStage" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "runId" UUID NOT NULL,
    "stageType" "public"."PricingStageType" NOT NULL,
    "inputSnapshot" JSONB NOT NULL DEFAULT '{}',
    "resultSnapshot" JSONB NOT NULL DEFAULT '{}',
    "mopsAvgUsdPerBbl" DECIMAL(18,6),
    "premiumUsdPerBbl" DECIMAL(18,6),
    "unitUsdPerBbl" DECIMAL(18,6),
    "amountUsd" DECIMAL(18,6),
    "fxRateDate" DATE,
    "fxStage" "public"."FxStage" NOT NULL DEFAULT 'ESTIMATE',
    "fxRate" DECIMAL(18,6),
    "insuranceAmountVnd" DECIMAL(18,2),
    "shippingFeeVnd" DECIMAL(18,2),
    "otherFeeVnd" DECIMAL(18,2),
    "envTaxAmountVnd" DECIMAL(18,2),
    "vatAmountVnd" DECIMAL(18,2),
    "amountVndBeforeTax" DECIMAL(18,2),
    "totalAmountVnd" DECIMAL(18,2),
    "unitVndPerLiter" DECIMAL(18,6),
    "specialConsumptionTaxUsdPerBbl" DECIMAL(18,6),
    "billBarrelQty" DECIMAL(18,6),
    "tankQtyLiter" DECIMAL(18,3),
    "insuranceRate" DECIMAL(18,6),
    "transportLossRate" DECIMAL(18,6),
    "inspectionFeeVnd" DECIMAL(18,2),
    "transportFeeVnd" DECIMAL(18,2),
    "storageFeeVnd" DECIMAL(18,2),
    "envTaxVndPerLiter" DECIMAL(18,6),
    "extraCostVndPerLiter" DECIMAL(18,6),
    "retailPriceVndPerLiter" DECIMAL(18,6),
    "paymentAmountUsd" DECIMAL(18,6),
    "transportLossAmountVnd" DECIMAL(18,2),
    "transportDeductionVnd" DECIMAL(18,2),
    "billTotalVnd" DECIMAL(18,2),
    "tankUnitPriceVndPerLiter" DECIMAL(18,6),
    "sellingUnitPriceVndPerLiter" DECIMAL(18,6),
    "temporaryAmountVnd" DECIMAL(18,2),
    "fundAdjustmentVndPerLiter" DECIMAL(18,6),
    "fundAdjustmentAmountVnd" DECIMAL(18,2),
    "discountVndPerLiter" DECIMAL(18,6),
    "contractPaymentRate" DECIMAL(18,6),
    "contractPaymentAmountVnd" DECIMAL(18,2),
    "bankGuaranteeRate" DECIMAL(18,6),
    "bankGuaranteeFeeVnd" DECIMAL(18,2),
    "note" TEXT,

    CONSTRAINT "PurchasePricingStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PurchasePricingStageLine" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "stageId" UUID NOT NULL,
    "purchaseOrderLineId" UUID,
    "productId" UUID NOT NULL,
    "supplierLocationId" UUID,
    "qtyActual" DECIMAL(18,3),
    "qtyV15" DECIMAL(18,3),
    "unitVndPerLiter" DECIMAL(18,6),
    "amountVnd" DECIMAL(18,2),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchasePricingStageLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PurchasePricingStageCost" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "stageId" UUID NOT NULL,
    "name" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "costType" "public"."PurchaseCostType" NOT NULL,
    "amountVnd" DECIMAL(18,2) NOT NULL,
    "sourceDocNo" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchasePricingStageCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PurchasePricingPriceDay" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "stageId" UUID NOT NULL,
    "quoteDate" DATE NOT NULL,
    "priceUsdPerBbl" DECIMAL(18,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchasePricingPriceDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PriceRegion" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceRegion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PurchasePricingSheetRow" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "stageId" UUID NOT NULL,
    "rowNo" INTEGER NOT NULL,
    "code" TEXT,
    "label" TEXT NOT NULL,
    "rowType" "public"."PricingSheetRowType" NOT NULL,
    "valueType" "public"."PricingSheetValueType" NOT NULL DEFAULT 'NUMBER',
    "inputValue" DECIMAL(18,6),
    "calculatedValue" DECIMAL(18,6),
    "displayValue" TEXT,
    "unit" TEXT,
    "formula" TEXT,
    "note" TEXT,
    "isInput" BOOLEAN NOT NULL DEFAULT false,
    "isResult" BOOLEAN NOT NULL DEFAULT false,
    "isBold" BOOLEAN NOT NULL DEFAULT false,
    "isHighlighted" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchasePricingSheetRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PriceBulletin" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "status" "public"."PriceBulletinStatus" NOT NULL DEFAULT 'PUBLISHED',
    "publishedAt" TIMESTAMPTZ NOT NULL,
    "effectiveFrom" TIMESTAMPTZ NOT NULL,
    "effectiveTo" TIMESTAMPTZ,
    "source" TEXT,
    "fileUrl" TEXT,
    "fileChecksum" TEXT,
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceBulletin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PriceBulletinItem" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "bulletinId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "regionId" UUID NOT NULL,
    "price" DECIMAL(18,2) NOT NULL,
    "note" TEXT,

    CONSTRAINT "PriceBulletinItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AuditLog" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "requestId" UUID,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" UUID,
    "ip" TEXT,
    "ua" TEXT,
    "method" TEXT,
    "path" TEXT,
    "statusCode" INTEGER,
    "moduleCode" TEXT,
    "permission" TEXT,
    "action" TEXT,
    "entityId" UUID,
    "scopeType" "public"."ScopeType",
    "scopeId" UUID,
    "before" JSONB,
    "after" JSONB,
    "diff" JSONB,
    "error" JSONB,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ExportJob" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "moduleCode" TEXT NOT NULL,
    "format" "public"."ExportFormat" NOT NULL,
    "filter" JSONB,
    "status" "public"."JobStatus" NOT NULL DEFAULT 'queued',
    "fileUrl" TEXT,
    "error" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ExportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ImportJob" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "moduleCode" TEXT NOT NULL,
    "mode" "public"."ImportMode" NOT NULL,
    "mapping" JSONB,
    "status" "public"."JobStatus" NOT NULL DEFAULT 'queued',
    "total" INTEGER,
    "success" INTEGER,
    "failed" INTEGER,
    "srcFileUrl" TEXT,
    "reportUrl" TEXT,
    "error" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LoginAttempt" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "username" TEXT,
    "email" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "ip" TEXT,
    "ua" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Party" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "taxCode" TEXT,
    "taxVerified" BOOLEAN NOT NULL DEFAULT false,
    "taxSource" "public"."TaxSource",
    "taxSyncedAt" TIMESTAMP(3),
    "kind" "public"."PartyKind" NOT NULL DEFAULT 'ORGANIZATION',
    "type" "public"."CustomerType" NOT NULL DEFAULT 'B2B',
    "customerRoles" "public"."CustomerRole"[],
    "status" "public"."CustomerStatus" NOT NULL DEFAULT 'Active',
    "masterStatus" "public"."MasterStatus" NOT NULL DEFAULT 'ACTIVE',
    "groupId" UUID,
    "billingAddress" TEXT,
    "shippingAddress" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "creditLimit" DECIMAL(24,4),
    "tempLimit" DECIMAL(24,4),
    "tempFrom" TIMESTAMP(3),
    "tempTo" TIMESTAMP(3),
    "paymentTermDays" INTEGER,
    "note" TEXT,
    "salesOwnerEmpId" UUID,
    "accountingOwnerEmpId" UUID,
    "legalOwnerEmpId" UUID,
    "documentOwnerEmpId" UUID,
    "defaultPurchaseContractNo" TEXT,
    "defaultDeliveryLocation" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "Party_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PartyRole" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "partyId" UUID NOT NULL,
    "role" "public"."PartyRoleType" NOT NULL,
    "validFrom" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" DATE,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartyRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LegalEntity" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "code" TEXT NOT NULL,
    "partyId" UUID NOT NULL,
    "baseCurrency" CHAR(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Warehouse" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "legalEntityId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameInvoice" TEXT,
    "address" TEXT,
    "warehouseType" TEXT,
    "isOperationalWarehouse" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
    "status" "public"."MasterStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WarehousePartyAssignment" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "warehouseId" UUID NOT NULL,
    "partyId" UUID NOT NULL,
    "role" "public"."WarehousePartyRole" NOT NULL,
    "validFrom" DATE NOT NULL,
    "validTo" DATE,

    CONSTRAINT "WarehousePartyAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."GoodsReceiptLine" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "goodsReceiptId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "purchaseOrderLineId" UUID,
    "productId" UUID NOT NULL,
    "ownerPartyId" UUID NOT NULL,
    "actualQty" DECIMAL(24,6) NOT NULL,
    "v15Qty" DECIMAL(24,6),
    "temperatureC" DECIMAL(8,3),
    "density" DECIMAL(14,8),
    "billQty" DECIMAL(24,6),
    "tankQty" DECIMAL(24,6),
    "temporaryWithdrawQty" DECIMAL(24,6),
    "billToTankLossQty" DECIMAL(24,6),
    "sourceLineRef" TEXT,

    CONSTRAINT "GoodsReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InventoryLot" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "lotNo" TEXT NOT NULL,
    "receiptLineId" UUID,
    "productId" UUID NOT NULL,
    "originOwnerPartyId" UUID NOT NULL,
    "receivedActualQty" DECIMAL(24,6) NOT NULL,
    "receivedV15Qty" DECIMAL(24,6),
    "receivedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InventoryPosting" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "postingNo" TEXT NOT NULL,
    "kind" "public"."InventoryPostingKind" NOT NULL,
    "status" "public"."InventoryPostingStatus" NOT NULL DEFAULT 'POSTED',
    "idempotencyKey" TEXT NOT NULL,
    "effectiveAt" TIMESTAMPTZ(6) NOT NULL,
    "postedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postedById" UUID,
    "reversalOfId" UUID,
    "goodsReceiptId" UUID,
    "movementDispatchId" UUID,
    "movementArrivalId" UUID,
    "ownershipTransferId" UUID,
    "stockAdjustmentId" UUID,
    "salesDeliveryId" UUID,

    CONSTRAINT "InventoryPosting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InventoryLedgerEntry" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "postingId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "warehouseId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "ownerPartyId" UUID NOT NULL,
    "inventoryLotId" UUID NOT NULL,
    "actualQtyDelta" DECIMAL(24,6) NOT NULL,
    "v15QtyDelta" DECIMAL(24,6),
    "effectiveAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."StockBalance" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "warehouseId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "ownerPartyId" UUID NOT NULL,
    "inventoryLotId" UUID NOT NULL,
    "actualQty" DECIMAL(24,6) NOT NULL DEFAULT 0,
    "v15Qty" DECIMAL(24,6),
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "StockBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InventoryReservation" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "reservationNo" TEXT NOT NULL,
    "legalEntityId" UUID NOT NULL,
    "customerPartyId" UUID,
    "salesOrderId" UUID,
    "manualReference" TEXT,
    "status" "public"."ReservationStatus" NOT NULL DEFAULT 'DRAFT',
    "reservedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(6),
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "InventoryReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InventoryReservationLine" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "reservationId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "warehouseId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "ownerPartyId" UUID NOT NULL,
    "inventoryLotId" UUID,
    "requestedActualQty" DECIMAL(24,6) NOT NULL,
    "requestedV15Qty" DECIMAL(24,6),
    "activeActualQty" DECIMAL(24,6) NOT NULL DEFAULT 0,
    "activeV15Qty" DECIMAL(24,6),
    "releasedActualQty" DECIMAL(24,6) NOT NULL DEFAULT 0,
    "releasedV15Qty" DECIMAL(24,6),
    "consumedActualQty" DECIMAL(24,6) NOT NULL DEFAULT 0,
    "consumedV15Qty" DECIMAL(24,6),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InventoryReservationLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InventoryReservationEvent" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "reservationLineId" UUID NOT NULL,
    "type" "public"."ReservationEventType" NOT NULL,
    "actualQty" DECIMAL(24,6) NOT NULL,
    "v15Qty" DECIMAL(24,6),
    "idempotencyKey" TEXT NOT NULL,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL,
    "actorId" UUID,
    "reason" TEXT,

    CONSTRAINT "InventoryReservationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InventoryPendingRelease" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "pendingNo" TEXT NOT NULL,
    "warehouseId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "ownerPartyId" UUID NOT NULL,
    "inventoryLotId" UUID NOT NULL,
    "goodsReceiptLineId" UUID,
    "reasonCode" TEXT NOT NULL,
    "originalActualQty" DECIMAL(24,6) NOT NULL,
    "originalV15Qty" DECIMAL(24,6),
    "activeActualQty" DECIMAL(24,6) NOT NULL,
    "activeV15Qty" DECIMAL(24,6),
    "status" "public"."RestrictionStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryPendingRelease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InventoryPendingReleaseEvent" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "pendingReleaseId" UUID NOT NULL,
    "type" "public"."RestrictionEventType" NOT NULL,
    "actualQty" DECIMAL(24,6) NOT NULL,
    "v15Qty" DECIMAL(24,6),
    "idempotencyKey" TEXT NOT NULL,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL,
    "actorId" UUID,
    "reason" TEXT,

    CONSTRAINT "InventoryPendingReleaseEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InventoryBlock" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "blockNo" TEXT NOT NULL,
    "warehouseId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "ownerPartyId" UUID NOT NULL,
    "inventoryLotId" UUID,
    "reconciliationVarianceId" UUID,
    "reasonCode" TEXT NOT NULL,
    "originalActualQty" DECIMAL(24,6) NOT NULL,
    "originalV15Qty" DECIMAL(24,6),
    "activeActualQty" DECIMAL(24,6) NOT NULL,
    "activeV15Qty" DECIMAL(24,6),
    "status" "public"."RestrictionStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InventoryBlockEvent" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "blockId" UUID NOT NULL,
    "type" "public"."RestrictionEventType" NOT NULL,
    "actualQty" DECIMAL(24,6) NOT NULL,
    "v15Qty" DECIMAL(24,6),
    "idempotencyKey" TEXT NOT NULL,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL,
    "actorId" UUID,
    "reason" TEXT,

    CONSTRAINT "InventoryBlockEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InventoryAvailabilityBalance" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "warehouseId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "ownerPartyId" UUID NOT NULL,
    "onHandActualQty" DECIMAL(24,6) NOT NULL DEFAULT 0,
    "reservedActualQty" DECIMAL(24,6) NOT NULL DEFAULT 0,
    "pendingActualQty" DECIMAL(24,6) NOT NULL DEFAULT 0,
    "blockedActualQty" DECIMAL(24,6) NOT NULL DEFAULT 0,
    "onHandV15Qty" DECIMAL(24,6),
    "reservedV15Qty" DECIMAL(24,6),
    "pendingV15Qty" DECIMAL(24,6),
    "blockedV15Qty" DECIMAL(24,6),
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "InventoryAvailabilityBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InventoryMovement" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "movementNo" TEXT NOT NULL,
    "legalEntityId" UUID NOT NULL,
    "type" "public"."InventoryMovementType" NOT NULL,
    "fromWarehouseId" UUID,
    "toWarehouseId" UUID,
    "vehicleId" UUID,
    "driverId" UUID,
    "transportMode" "public"."TermTransportMode" NOT NULL DEFAULT 'ROAD',
    "status" "public"."InventoryMovementStatus" NOT NULL DEFAULT 'DRAFT',
    "plannedAt" TIMESTAMPTZ(6),
    "expectedArrivalAt" TIMESTAMPTZ(6),
    "actualArrivalAt" TIMESTAMPTZ(6),
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InventoryMovementLine" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "movementId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "productId" UUID NOT NULL,
    "ownerPartyId" UUID NOT NULL,
    "inventoryLotId" UUID NOT NULL,
    "plannedActualQty" DECIMAL(24,6) NOT NULL,
    "plannedV15Qty" DECIMAL(24,6),
    "note" TEXT,

    CONSTRAINT "InventoryMovementLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InventoryDispatch" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "dispatchNo" TEXT NOT NULL,
    "movementId" UUID NOT NULL,
    "status" "public"."InventoryDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "dispatchedAt" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "InventoryDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InventoryDispatchLine" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "dispatchId" UUID NOT NULL,
    "movementLineId" UUID NOT NULL,
    "actualQty" DECIMAL(24,6) NOT NULL,
    "v15Qty" DECIMAL(24,6),

    CONSTRAINT "InventoryDispatchLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InventoryArrival" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "arrivalNo" TEXT NOT NULL,
    "movementId" UUID NOT NULL,
    "status" "public"."InventoryDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "arrivedAt" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "InventoryArrival_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InventoryArrivalLine" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "arrivalId" UUID NOT NULL,
    "dispatchLineId" UUID NOT NULL,
    "actualQty" DECIMAL(24,6) NOT NULL,
    "v15Qty" DECIMAL(24,6),

    CONSTRAINT "InventoryArrivalLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OwnershipTransfer" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "transferNo" TEXT NOT NULL,
    "warehouseId" UUID NOT NULL,
    "fromOwnerPartyId" UUID NOT NULL,
    "toOwnerPartyId" UUID NOT NULL,
    "status" "public"."InventoryDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "effectiveAt" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "OwnershipTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OwnershipTransferLine" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "transferId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "productId" UUID NOT NULL,
    "inventoryLotId" UUID NOT NULL,
    "actualQty" DECIMAL(24,6) NOT NULL,
    "v15Qty" DECIMAL(24,6),

    CONSTRAINT "OwnershipTransferLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."StockAdjustment" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "adjustmentNo" TEXT NOT NULL,
    "warehouseId" UUID NOT NULL,
    "status" "public"."InventoryDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "reasonCode" TEXT NOT NULL,
    "effectiveAt" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "StockAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."StockAdjustmentLine" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "adjustmentId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "productId" UUID NOT NULL,
    "ownerPartyId" UUID NOT NULL,
    "inventoryLotId" UUID,
    "actualQtyDelta" DECIMAL(24,6) NOT NULL,
    "v15QtyDelta" DECIMAL(24,6),
    "explanation" TEXT NOT NULL,

    CONSTRAINT "StockAdjustmentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ExpectedSupply" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "expectedNo" TEXT NOT NULL,
    "warehouseId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "ownerPartyId" UUID NOT NULL,
    "purchaseOrderLineId" UUID,
    "shipmentLineId" UUID,
    "movementLineId" UUID,
    "manualReference" TEXT,
    "expectedActualQty" DECIMAL(24,6) NOT NULL,
    "expectedV15Qty" DECIMAL(24,6),
    "fulfilledActualQty" DECIMAL(24,6) NOT NULL DEFAULT 0,
    "fulfilledV15Qty" DECIMAL(24,6),
    "expectedAt" TIMESTAMPTZ(6),
    "status" "public"."ExpectedSupplyStatus" NOT NULL DEFAULT 'OPEN',
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ExpectedSupply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ExpectedSupplyAllocation" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "expectedSupplyId" UUID NOT NULL,
    "receiptLineId" UUID NOT NULL,
    "actualQty" DECIMAL(24,6) NOT NULL,
    "v15Qty" DECIMAL(24,6),
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpectedSupplyAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ReconciliationTemplate" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "supplierPartyId" UUID,
    "columnMapping" JSONB NOT NULL,
    "normalizeRules" JSONB NOT NULL,
    "status" "public"."MasterStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReconciliationTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WarehouseReconciliation" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "sessionNo" TEXT NOT NULL,
    "warehouseId" UUID NOT NULL,
    "reconciliationPartyId" UUID NOT NULL,
    "asOfAt" TIMESTAMPTZ(6) NOT NULL,
    "scope" "public"."ReconciliationScope" NOT NULL,
    "status" "public"."ReconciliationStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "closedAt" TIMESTAMPTZ(6),
    "closedById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehouseReconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ReconciliationFile" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "sessionId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "templateId" UUID,
    "replacedFileId" UUID,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" BIGINT,
    "checksumSha256" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "uploadedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedById" UUID,

    CONSTRAINT "ReconciliationFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ReconciliationRawRow" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "fileId" UUID NOT NULL,
    "sheetName" TEXT,
    "rowNo" INTEGER NOT NULL,
    "rawData" JSONB NOT NULL,
    "parseError" TEXT,
    "status" "public"."ReconciliationRowStatus" NOT NULL DEFAULT 'RAW',

    CONSTRAINT "ReconciliationRawRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ReconciliationNormalizedLine" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "rawRowId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "ownerPartyId" UUID,
    "externalProductCode" TEXT,
    "externalOwnerCode" TEXT,
    "actualQty" DECIMAL(24,6) NOT NULL,
    "v15Qty" DECIMAL(24,6),
    "mappingNote" TEXT,

    CONSTRAINT "ReconciliationNormalizedLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ReconciliationSnapshotLine" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "sessionId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "ownerPartyId" UUID,
    "actualQty" DECIMAL(24,6) NOT NULL,
    "v15Qty" DECIMAL(24,6),
    "ledgerCutoffAt" TIMESTAMPTZ(6) NOT NULL,
    "ledgerCutoffId" UUID,

    CONSTRAINT "ReconciliationSnapshotLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ReconciliationVariance" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "sessionId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "ownerPartyId" UUID,
    "supplierActualQty" DECIMAL(24,6) NOT NULL,
    "erpActualQty" DECIMAL(24,6) NOT NULL,
    "varianceActualQty" DECIMAL(24,6) NOT NULL,
    "supplierV15Qty" DECIMAL(24,6),
    "erpV15Qty" DECIMAL(24,6),
    "varianceV15Qty" DECIMAL(24,6),
    "status" "public"."ReconciliationVarianceStatus" NOT NULL DEFAULT 'OPEN',
    "explanation" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ReconciliationVariance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ReconciliationResolution" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "varianceId" UUID NOT NULL,
    "stockAdjustmentId" UUID,
    "movementId" UUID,
    "resolutionType" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "resolvedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedById" UUID,

    CONSTRAINT "ReconciliationResolution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LandedCostDocument" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "documentNo" TEXT NOT NULL,
    "legalEntityId" UUID NOT NULL,
    "vendorPartyId" UUID,
    "purchaseOrderId" UUID,
    "shipmentId" UUID,
    "currency" CHAR(3) NOT NULL,
    "documentDate" DATE NOT NULL,
    "status" "public"."CostDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "postedAt" TIMESTAMPTZ(6),
    "postedById" UUID,

    CONSTRAINT "LandedCostDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LandedCostLine" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "documentId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "costType" TEXT NOT NULL,
    "amountBeforeTax" DECIMAL(24,4) NOT NULL,
    "taxRate" DECIMAL(12,10) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "capitalizable" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "LandedCostLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LandedCostAllocation" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "landedCostLineId" UUID NOT NULL,
    "inventoryLotId" UUID NOT NULL,
    "actualQtyBasis" DECIMAL(24,6),
    "allocatedAmount" DECIMAL(24,4) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "productId" UUID,

    CONSTRAINT "LandedCostAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InventoryCostLayer" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "inventoryLotId" UUID NOT NULL,
    "ownerPartyId" UUID NOT NULL,
    "status" "public"."CostLayerStatus" NOT NULL DEFAULT 'OPEN',
    "originalActualQty" DECIMAL(24,6) NOT NULL,
    "remainingActualQty" DECIMAL(24,6) NOT NULL,
    "remainingValue" DECIMAL(24,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "isProvisional" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 0,
    "openedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "InventoryCostLayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CostLayerEntry" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "costLayerId" UUID NOT NULL,
    "type" "public"."CostLayerEntryType" NOT NULL,
    "actualQtyDelta" DECIMAL(24,6) NOT NULL DEFAULT 0,
    "valueDelta" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "pricingStageLineId" UUID,
    "landedCostAllocationId" UUID,
    "salesDeliveryLineId" UUID,
    "reversalOfId" UUID,
    "idempotencyKey" TEXT NOT NULL,
    "effectiveAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostLayerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SupplierInvoice" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "legalEntityId" UUID NOT NULL,
    "supplierCustomerId" UUID NOT NULL,
    "purchaseOrderId" UUID,
    "invoiceNo" TEXT NOT NULL,
    "invoiceSymbol" TEXT NOT NULL DEFAULT '',
    "invoiceTemplate" TEXT,
    "invoiceDate" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'VND',
    "status" "public"."SupplierInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "totalAmount" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "sourceFileId" TEXT,
    "sourceFileUrl" TEXT,
    "sourceFileName" TEXT,
    "sourceFileChecksum" TEXT,
    "postedAt" TIMESTAMPTZ(6),
    "postedById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "SupplierInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SupplierInvoiceLine" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "invoiceId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "productId" UUID,
    "purchaseOrderLineId" UUID,
    "receiptLineId" UUID,
    "landedCostLineId" UUID,
    "actualQty" DECIMAL(24,6),
    "unitPrice" DECIMAL(24,8) NOT NULL,
    "netAmount" DECIMAL(24,4) NOT NULL,
    "taxRate" DECIMAL(12,10) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(24,4) NOT NULL DEFAULT 0,

    CONSTRAINT "SupplierInvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PayableOpenItem" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "supplierInvoiceId" UUID,
    "legalEntityId" UUID NOT NULL,
    "supplierPartyId" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "originalAmount" DECIMAL(24,4) NOT NULL,
    "outstandingAmount" DECIMAL(24,4) NOT NULL,
    "dueDate" DATE,
    "settlementType" "public"."SettlementType" NOT NULL DEFAULT 'PAYABLE',
    "note" TEXT,
    "status" "public"."PayableOpenItemStatus" NOT NULL DEFAULT 'OPEN',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PayableOpenItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PayableLedgerEntry" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "openItemId" UUID NOT NULL,
    "type" "public"."PayableEntryType" NOT NULL,
    "amountDelta" DECIMAL(24,4) NOT NULL,
    "allocationId" UUID,
    "reversalOfId" UUID,
    "idempotencyKey" TEXT NOT NULL,
    "effectiveAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayableLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PayableAllocation" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "bankTransactionId" UUID NOT NULL,
    "openItemId" UUID NOT NULL,
    "amountInBankCurrency" DECIMAL(24,4) NOT NULL,
    "amountInItemCurrency" DECIMAL(24,4) NOT NULL,
    "fxRate" DECIMAL(24,10),
    "status" "public"."PayableAllocationStatus" NOT NULL DEFAULT 'ACTIVE',
    "reversalOfId" UUID,
    "idempotencyKey" TEXT NOT NULL,
    "allocatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PayableAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentSequence_moduleCode_period_key" ON "public"."DocumentSequence"("moduleCode", "period");

-- CreateIndex
CREATE UNIQUE INDEX "CronJob_type_key" ON "public"."CronJob"("type");

-- CreateIndex
CREATE INDEX "CronJobRun_jobId_runDate_idx" ON "public"."CronJobRun"("jobId", "runDate");

-- CreateIndex
CREATE UNIQUE INDEX "BackgroundJob_type_key" ON "public"."BackgroundJob"("type");

-- CreateIndex
CREATE INDEX "BackgroundJobRun_jobId_queuedAt_idx" ON "public"."BackgroundJobRun"("jobId", "queuedAt");

-- CreateIndex
CREATE INDEX "BackgroundJobRun_status_queuedAt_idx" ON "public"."BackgroundJobRun"("status", "queuedAt");

-- CreateIndex
CREATE INDEX "JobArtifact_runId_kind_idx" ON "public"."JobArtifact"("runId", "kind");

-- CreateIndex
CREATE INDEX "JobArtifact_kind_createdAt_idx" ON "public"."JobArtifact"("kind", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "public"."User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_code_key" ON "public"."Employee"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_userId_key" ON "public"."Employee"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_personalEmail_key" ON "public"."Employee"("personalEmail");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_accessCardId_key" ON "public"."Employee"("accessCardId");

-- CreateIndex
CREATE INDEX "Employee_status_idx" ON "public"."Employee"("status");

-- CreateIndex
CREATE INDEX "Employee_deletedAt_idx" ON "public"."Employee"("deletedAt");

-- CreateIndex
CREATE INDEX "Employee_code_idx" ON "public"."Employee"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Area_code_key" ON "public"."Area"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Site_code_key" ON "public"."Site"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Department_code_key" ON "public"."Department"("code");

-- CreateIndex
CREATE INDEX "Department_parentId_idx" ON "public"."Department"("parentId");

-- CreateIndex
CREATE INDEX "Department_siteId_idx" ON "public"."Department"("siteId");

-- CreateIndex
CREATE INDEX "Department_deletedAt_idx" ON "public"."Department"("deletedAt");

-- CreateIndex
CREATE INDEX "EmployeeDepartment_employeeId_isPrimary_idx" ON "public"."EmployeeDepartment"("employeeId", "isPrimary");

-- CreateIndex
CREATE INDEX "EmployeeDepartment_departmentId_startDate_endDate_idx" ON "public"."EmployeeDepartment"("departmentId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "EmployeeDepartment_employeeId_startDate_endDate_idx" ON "public"."EmployeeDepartment"("employeeId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "DepartmentManager_departmentId_startDate_endDate_idx" ON "public"."DepartmentManager"("departmentId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "DepartmentManager_employeeId_startDate_endDate_idx" ON "public"."DepartmentManager"("employeeId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "DepartmentManager_departmentId_role_startDate_endDate_idx" ON "public"."DepartmentManager"("departmentId", "role", "startDate", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "Module_code_key" ON "public"."Module"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_code_key" ON "public"."Permission"("code");

-- CreateIndex
CREATE INDEX "Permission_moduleId_idx" ON "public"."Permission"("moduleId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_code_key" ON "public"."Role"("code");

-- CreateIndex
CREATE INDEX "RolePermission_permissionId_idx" ON "public"."RolePermission"("permissionId");

-- CreateIndex
CREATE INDEX "UserRoleBinding_userId_idx" ON "public"."UserRoleBinding"("userId");

-- CreateIndex
CREATE INDEX "UserRoleBinding_roleId_idx" ON "public"."UserRoleBinding"("roleId");

-- CreateIndex
CREATE INDEX "UserRoleBinding_scopeType_scopeId_idx" ON "public"."UserRoleBinding"("scopeType", "scopeId");

-- CreateIndex
CREATE INDEX "UserRoleBinding_startAt_endAt_idx" ON "public"."UserRoleBinding"("startAt", "endAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerGroup_code_key" ON "public"."CustomerGroup"("code");

-- CreateIndex
CREATE INDEX "CustomerGroup_code_idx" ON "public"."CustomerGroup"("code");

-- CreateIndex
CREATE INDEX "CustomerGroup_name_idx" ON "public"."CustomerGroup"("name");

-- CreateIndex
CREATE INDEX "CustomerAddress_customerId_validFrom_idx" ON "public"."CustomerAddress"("customerId", "validFrom");

-- CreateIndex
CREATE INDEX "CustomerAddress_customerId_validTo_idx" ON "public"."CustomerAddress"("customerId", "validTo");

-- CreateIndex
CREATE INDEX "CustomerAddress_customerId_idx" ON "public"."CustomerAddress"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Contract_code_key" ON "public"."Contract"("code");

-- CreateIndex
CREATE INDEX "Contract_customerId_kind_idx" ON "public"."Contract"("customerId", "kind");

-- CreateIndex
CREATE INDEX "Contract_status_idx" ON "public"."Contract"("status");

-- CreateIndex
CREATE INDEX "Contract_startDate_endDate_idx" ON "public"."Contract"("startDate", "endDate");

-- CreateIndex
CREATE INDEX "Contract_renewalOfId_idx" ON "public"."Contract"("renewalOfId");

-- CreateIndex
CREATE UNIQUE INDEX "ContractType_code_key" ON "public"."ContractType"("code");

-- CreateIndex
CREATE INDEX "Vehicle_licensePlate_idx" ON "public"."Vehicle"("licensePlate");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_supplierCustomerId_licensePlate_key" ON "public"."Vehicle"("supplierCustomerId", "licensePlate");

-- CreateIndex
CREATE INDEX "Driver_fullName_idx" ON "public"."Driver"("fullName");

-- CreateIndex
CREATE INDEX "Driver_phone_idx" ON "public"."Driver"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "Product_code_key" ON "public"."Product"("code");

-- CreateIndex
CREATE INDEX "Product_name_idx" ON "public"."Product"("name");

-- CreateIndex
CREATE INDEX "ProductAlias_productId_validFrom_validTo_idx" ON "public"."ProductAlias"("productId", "validFrom", "validTo");

-- CreateIndex
CREATE INDEX "ProductAlias_partyId_externalCode_idx" ON "public"."ProductAlias"("partyId", "externalCode");

-- CreateIndex
CREATE UNIQUE INDEX "ProductAlias_partyId_normalizedName_validFrom_key" ON "public"."ProductAlias"("partyId", "normalizedName", "validFrom");

-- CreateIndex
CREATE INDEX "PurchaseOrder_supplierCustomerId_orderDate_idx" ON "public"."PurchaseOrder"("supplierCustomerId", "orderDate");

-- CreateIndex
CREATE INDEX "PurchaseOrder_status_idx" ON "public"."PurchaseOrder"("status");

-- CreateIndex
CREATE INDEX "PurchaseOrder_priceRegionId_idx" ON "public"."PurchaseOrder"("priceRegionId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_bizType_idx" ON "public"."PurchaseOrder"("bizType");

-- CreateIndex
CREATE INDEX "PurchaseOrder_contractId_idx" ON "public"."PurchaseOrder"("contractId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_legalEntityId_orderNo_key" ON "public"."PurchaseOrder"("legalEntityId", "orderNo");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_purchaseOrderId_idx" ON "public"."PurchaseOrderLine"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_productId_idx" ON "public"."PurchaseOrderLine"("productId");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_receivingWarehouseId_productId_idx" ON "public"."PurchaseOrderLine"("receivingWarehouseId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrderLine_purchaseOrderId_lineNo_key" ON "public"."PurchaseOrderLine"("purchaseOrderId", "lineNo");

-- CreateIndex
CREATE INDEX "PurchaseTermOrderDocument_purchaseOrderId_status_idx" ON "public"."PurchaseTermOrderDocument"("purchaseOrderId", "status");

-- CreateIndex
CREATE INDEX "PurchaseTermOrderDocument_documentNo_idx" ON "public"."PurchaseTermOrderDocument"("documentNo");

-- CreateIndex
CREATE INDEX "PurchaseTermOrderDocument_sourcePricingStageId_idx" ON "public"."PurchaseTermOrderDocument"("sourcePricingStageId");

-- CreateIndex
CREATE INDEX "PurchaseTermOrderDocument_createdAt_idx" ON "public"."PurchaseTermOrderDocument"("createdAt");

-- CreateIndex
CREATE INDEX "PurchaseTermOrderDocumentLine_documentId_idx" ON "public"."PurchaseTermOrderDocumentLine"("documentId");

-- CreateIndex
CREATE INDEX "PurchaseTermOrderDocumentLine_productId_idx" ON "public"."PurchaseTermOrderDocumentLine"("productId");

-- CreateIndex
CREATE INDEX "PurchaseTermPaymentRequest_purchaseOrderId_status_idx" ON "public"."PurchaseTermPaymentRequest"("purchaseOrderId", "status");

-- CreateIndex
CREATE INDEX "PurchaseTermPaymentRequest_orderDocumentId_idx" ON "public"."PurchaseTermPaymentRequest"("orderDocumentId");

-- CreateIndex
CREATE INDEX "PurchaseTermPaymentRequest_sourcePricingStageId_idx" ON "public"."PurchaseTermPaymentRequest"("sourcePricingStageId");

-- CreateIndex
CREATE INDEX "PurchaseTermPaymentRequest_requestNo_idx" ON "public"."PurchaseTermPaymentRequest"("requestNo");

-- CreateIndex
CREATE INDEX "PurchaseTermPaymentRequest_requestDate_idx" ON "public"."PurchaseTermPaymentRequest"("requestDate");

-- CreateIndex
CREATE UNIQUE INDEX "TermPaymentBatch_batchNo_key" ON "public"."TermPaymentBatch"("batchNo");

-- CreateIndex
CREATE INDEX "TermPaymentBatch_batchDate_idx" ON "public"."TermPaymentBatch"("batchDate");

-- CreateIndex
CREATE INDEX "TermPaymentBatch_bankAccountId_status_idx" ON "public"."TermPaymentBatch"("bankAccountId", "status");

-- CreateIndex
CREATE INDEX "TermPaymentBatch_status_createdAt_idx" ON "public"."TermPaymentBatch"("status", "createdAt");

-- CreateIndex
CREATE INDEX "TermPaymentBatchItem_paymentRequestId_status_idx" ON "public"."TermPaymentBatchItem"("paymentRequestId", "status");

-- CreateIndex
CREATE INDEX "TermPaymentBatchItem_purchaseOrderId_status_idx" ON "public"."TermPaymentBatchItem"("purchaseOrderId", "status");

-- CreateIndex
CREATE INDEX "TermPaymentBatchItem_bankTransactionId_idx" ON "public"."TermPaymentBatchItem"("bankTransactionId");

-- CreateIndex
CREATE INDEX "TermPaymentBatchItem_status_idx" ON "public"."TermPaymentBatchItem"("status");

-- CreateIndex
CREATE UNIQUE INDEX "TermPaymentBatchItem_batchId_paymentRequestId_key" ON "public"."TermPaymentBatchItem"("batchId", "paymentRequestId");

-- CreateIndex
CREATE INDEX "TermPaymentBatchFile_batchId_fileType_idx" ON "public"."TermPaymentBatchFile"("batchId", "fileType");

-- CreateIndex
CREATE INDEX "TermPaymentBatchFile_fileChecksum_idx" ON "public"."TermPaymentBatchFile"("fileChecksum");

-- CreateIndex
CREATE INDEX "PurchaseTermBankInstruction_purchaseOrderId_status_idx" ON "public"."PurchaseTermBankInstruction"("purchaseOrderId", "status");

-- CreateIndex
CREATE INDEX "PurchaseTermBankInstruction_paymentRequestId_idx" ON "public"."PurchaseTermBankInstruction"("paymentRequestId");

-- CreateIndex
CREATE INDEX "PurchaseTermBankInstruction_bankTransactionId_idx" ON "public"."PurchaseTermBankInstruction"("bankTransactionId");

-- CreateIndex
CREATE INDEX "PurchaseTermBankInstruction_instructionNo_idx" ON "public"."PurchaseTermBankInstruction"("instructionNo");

-- CreateIndex
CREATE INDEX "PurchaseTermBankInstruction_instructionDate_idx" ON "public"."PurchaseTermBankInstruction"("instructionDate");

-- CreateIndex
CREATE INDEX "PurchaseTermSettlementAdjustment_purchaseOrderId_status_idx" ON "public"."PurchaseTermSettlementAdjustment"("purchaseOrderId", "status");

-- CreateIndex
CREATE INDEX "PurchaseTermSettlementAdjustment_finalPricingStageId_idx" ON "public"."PurchaseTermSettlementAdjustment"("finalPricingStageId");

-- CreateIndex
CREATE INDEX "PurchaseTermSettlementAdjustment_adjustmentType_idx" ON "public"."PurchaseTermSettlementAdjustment"("adjustmentType");

-- CreateIndex
CREATE INDEX "PurchaseShipment_purchaseOrderId_idx" ON "public"."PurchaseShipment"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "PurchaseShipment_transportMode_idx" ON "public"."PurchaseShipment"("transportMode");

-- CreateIndex
CREATE INDEX "PurchaseShipment_status_idx" ON "public"."PurchaseShipment"("status");

-- CreateIndex
CREATE INDEX "PurchaseShipment_eta_idx" ON "public"."PurchaseShipment"("eta");

-- CreateIndex
CREATE INDEX "PurchaseShipment_vesselId_idx" ON "public"."PurchaseShipment"("vesselId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseShipment_purchaseOrderId_shipmentNo_key" ON "public"."PurchaseShipment"("purchaseOrderId", "shipmentNo");

-- CreateIndex
CREATE INDEX "PurchaseShipmentLine_purchaseOrderLineId_idx" ON "public"."PurchaseShipmentLine"("purchaseOrderLineId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseShipmentLine_shipmentId_purchaseOrderLineId_key" ON "public"."PurchaseShipmentLine"("shipmentId", "purchaseOrderLineId");

-- CreateIndex
CREATE INDEX "SalesOrder_customerPartyId_status_orderDate_idx" ON "public"."SalesOrder"("customerPartyId", "status", "orderDate");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_legalEntityId_orderNo_key" ON "public"."SalesOrder"("legalEntityId", "orderNo");

-- CreateIndex
CREATE INDEX "SalesOrderLine_productId_idx" ON "public"."SalesOrderLine"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrderLine_salesOrderId_lineNo_key" ON "public"."SalesOrderLine"("salesOrderId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "SalesDelivery_deliveryNo_key" ON "public"."SalesDelivery"("deliveryNo");

-- CreateIndex
CREATE INDEX "SalesDelivery_salesOrderId_status_idx" ON "public"."SalesDelivery"("salesOrderId", "status");

-- CreateIndex
CREATE INDEX "SalesDelivery_warehouseId_status_plannedAt_idx" ON "public"."SalesDelivery"("warehouseId", "status", "plannedAt");

-- CreateIndex
CREATE INDEX "SalesDeliveryLine_salesOrderLineId_idx" ON "public"."SalesDeliveryLine"("salesOrderLineId");

-- CreateIndex
CREATE INDEX "SalesDeliveryLine_ownerPartyId_idx" ON "public"."SalesDeliveryLine"("ownerPartyId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesDeliveryLine_salesDeliveryId_lineNo_key" ON "public"."SalesDeliveryLine"("salesDeliveryId", "lineNo");

-- CreateIndex
CREATE INDEX "TermLogisticsCost_purchaseOrderId_idx" ON "public"."TermLogisticsCost"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "TermLogisticsCost_shipmentId_idx" ON "public"."TermLogisticsCost"("shipmentId");

-- CreateIndex
CREATE INDEX "TermLogisticsCost_vendorCustomerId_idx" ON "public"."TermLogisticsCost"("vendorCustomerId");

-- CreateIndex
CREATE INDEX "TermLogisticsCost_documentDate_idx" ON "public"."TermLogisticsCost"("documentDate");

-- CreateIndex
CREATE INDEX "TermLogisticsCost_status_idx" ON "public"."TermLogisticsCost"("status");

-- CreateIndex
CREATE INDEX "TermLogisticsCostLine_logisticsCostId_idx" ON "public"."TermLogisticsCostLine"("logisticsCostId");

-- CreateIndex
CREATE INDEX "TermLogisticsCostLine_costType_idx" ON "public"."TermLogisticsCostLine"("costType");

-- CreateIndex
CREATE INDEX "TermLogisticsCostLine_productId_idx" ON "public"."TermLogisticsCostLine"("productId");

-- CreateIndex
CREATE INDEX "TermLogisticsCostLine_purchaseOrderLineId_idx" ON "public"."TermLogisticsCostLine"("purchaseOrderLineId");

-- CreateIndex
CREATE INDEX "TermLogisticsCostLine_goodsReceiptId_idx" ON "public"."TermLogisticsCostLine"("goodsReceiptId");

-- CreateIndex
CREATE UNIQUE INDEX "TermLogisticsCostLine_operationsSourceType_operationsSource_key" ON "public"."TermLogisticsCostLine"("operationsSourceType", "operationsSourceId");

-- CreateIndex
CREATE INDEX "PurchaseOrderPaymentPlan_purchaseOrderId_idx" ON "public"."PurchaseOrderPaymentPlan"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "PurchaseOrderPaymentPlan_dueDate_idx" ON "public"."PurchaseOrderPaymentPlan"("dueDate");

-- CreateIndex
CREATE INDEX "PurchaseOrderPaymentPlan_purchaseOrderId_sortOrder_idx" ON "public"."PurchaseOrderPaymentPlan"("purchaseOrderId", "sortOrder");

-- CreateIndex
CREATE INDEX "GoodsReceipt_supplierCustomerId_receiptDate_idx" ON "public"."GoodsReceipt"("supplierCustomerId", "receiptDate");

-- CreateIndex
CREATE INDEX "GoodsReceipt_warehouseId_receiptDate_idx" ON "public"."GoodsReceipt"("warehouseId", "receiptDate");

-- CreateIndex
CREATE INDEX "GoodsReceipt_status_receiptDate_idx" ON "public"."GoodsReceipt"("status", "receiptDate");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_supplierCustomerId_receiptNo_key" ON "public"."GoodsReceipt"("supplierCustomerId", "receiptNo");

-- CreateIndex
CREATE INDEX "Vessel_ownerCustomerId_isActive_idx" ON "public"."Vessel"("ownerCustomerId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Vessel_ownerCustomerId_name_key" ON "public"."Vessel"("ownerCustomerId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Vessel_imoNo_key" ON "public"."Vessel"("imoNo");

-- CreateIndex
CREATE INDEX "VesselDocument_vesselId_idx" ON "public"."VesselDocument"("vesselId");

-- CreateIndex
CREATE INDEX "VesselDocument_vesselId_documentType_idx" ON "public"."VesselDocument"("vesselId", "documentType");

-- CreateIndex
CREATE INDEX "VesselDocument_expiredDate_idx" ON "public"."VesselDocument"("expiredDate");

-- CreateIndex
CREATE UNIQUE INDEX "ShipCharterContract_contractNo_key" ON "public"."ShipCharterContract"("contractNo");

-- CreateIndex
CREATE INDEX "ShipCharterContract_ownerCustomerId_idx" ON "public"."ShipCharterContract"("ownerCustomerId");

-- CreateIndex
CREATE INDEX "ShipCharterContract_effectiveFrom_effectiveTo_idx" ON "public"."ShipCharterContract"("effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE INDEX "ShipCharterContractLossRate_contractId_idx" ON "public"."ShipCharterContractLossRate"("contractId");

-- CreateIndex
CREATE UNIQUE INDEX "ShipCharterContractLossRate_contractId_productGroup_key" ON "public"."ShipCharterContractLossRate"("contractId", "productGroup");

-- CreateIndex
CREATE INDEX "ShipCharterAppendix_vesselId_idx" ON "public"."ShipCharterAppendix"("vesselId");

-- CreateIndex
CREATE INDEX "ShipCharterAppendix_purchaseOrderId_idx" ON "public"."ShipCharterAppendix"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "ShipCharterAppendix_productId_idx" ON "public"."ShipCharterAppendix"("productId");

-- CreateIndex
CREATE INDEX "ShipCharterAppendix_receivingWarehouseId_idx" ON "public"."ShipCharterAppendix"("receivingWarehouseId");

-- CreateIndex
CREATE INDEX "ShipCharterAppendix_laycanFrom_laycanTo_idx" ON "public"."ShipCharterAppendix"("laycanFrom", "laycanTo");

-- CreateIndex
CREATE UNIQUE INDEX "ShipCharterAppendix_contractId_appendixNo_key" ON "public"."ShipCharterAppendix"("contractId", "appendixNo");

-- CreateIndex
CREATE UNIQUE INDEX "ShipCharterOrder_charterOrderNo_key" ON "public"."ShipCharterOrder"("charterOrderNo");

-- CreateIndex
CREATE INDEX "ShipCharterOrder_purchaseOrderId_idx" ON "public"."ShipCharterOrder"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "ShipCharterOrder_shipmentId_idx" ON "public"."ShipCharterOrder"("shipmentId");

-- CreateIndex
CREATE INDEX "ShipCharterOrder_contractId_idx" ON "public"."ShipCharterOrder"("contractId");

-- CreateIndex
CREATE INDEX "ShipCharterOrder_ownerCustomerId_idx" ON "public"."ShipCharterOrder"("ownerCustomerId");

-- CreateIndex
CREATE INDEX "ShipCharterOrder_vesselId_idx" ON "public"."ShipCharterOrder"("vesselId");

-- CreateIndex
CREATE INDEX "ShipCharterOrder_receivingWarehouseId_idx" ON "public"."ShipCharterOrder"("receivingWarehouseId");

-- CreateIndex
CREATE INDEX "ShipCharterOrder_productId_idx" ON "public"."ShipCharterOrder"("productId");

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
CREATE UNIQUE INDEX "ShipFreightRate_rateCode_key" ON "public"."ShipFreightRate"("rateCode");

-- CreateIndex
CREATE INDEX "ShipFreightRate_loadingPort_dischargePort_effectiveFrom_idx" ON "public"."ShipFreightRate"("loadingPort", "dischargePort", "effectiveFrom");

-- CreateIndex
CREATE INDEX "ShipFreightRate_ownerCustomerId_idx" ON "public"."ShipFreightRate"("ownerCustomerId");

-- CreateIndex
CREATE INDEX "ShipFreightRate_vesselId_idx" ON "public"."ShipFreightRate"("vesselId");

-- CreateIndex
CREATE INDEX "ShipFreightRate_contractId_idx" ON "public"."ShipFreightRate"("contractId");

-- CreateIndex
CREATE INDEX "ShipFreightRate_appendixId_idx" ON "public"."ShipFreightRate"("appendixId");

-- CreateIndex
CREATE INDEX "ShipFreightRate_productId_idx" ON "public"."ShipFreightRate"("productId");

-- CreateIndex
CREATE INDEX "ShipFreightRate_status_effectiveFrom_effectiveTo_idx" ON "public"."ShipFreightRate"("status", "effectiveFrom", "effectiveTo");

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
CREATE UNIQUE INDEX "VehicleDispatchOrder_inventoryMovementId_key" ON "public"."VehicleDispatchOrder"("inventoryMovementId");

-- CreateIndex
CREATE INDEX "VehicleDispatchOrder_vehicleId_status_plannedStartAt_idx" ON "public"."VehicleDispatchOrder"("vehicleId", "status", "plannedStartAt");

-- CreateIndex
CREATE INDEX "VehicleDispatchOrder_driverId_status_plannedStartAt_idx" ON "public"."VehicleDispatchOrder"("driverId", "status", "plannedStartAt");

-- CreateIndex
CREATE INDEX "VehicleDispatchOrder_status_plannedStartAt_idx" ON "public"."VehicleDispatchOrder"("status", "plannedStartAt");

-- CreateIndex
CREATE INDEX "VehicleDispatchOrder_sourceType_sourceId_idx" ON "public"."VehicleDispatchOrder"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "PurchasePricingRunReceipt_goodsReceiptId_idx" ON "public"."PurchasePricingRunReceipt"("goodsReceiptId");

-- CreateIndex
CREATE UNIQUE INDEX "BankTransactionPurpose_code_key" ON "public"."BankTransactionPurpose"("code");

-- CreateIndex
CREATE INDEX "BankTransactionPurpose_isActive_sortOrder_idx" ON "public"."BankTransactionPurpose"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "BankAccount_isActive_idx" ON "public"."BankAccount"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "BankAccount_bankCode_accountNo_key" ON "public"."BankAccount"("bankCode", "accountNo");

-- CreateIndex
CREATE INDEX "BankImportTemplate_bankCode_isActive_idx" ON "public"."BankImportTemplate"("bankCode", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "BankImportTemplate_bankCode_name_version_key" ON "public"."BankImportTemplate"("bankCode", "name", "version");

-- CreateIndex
CREATE INDEX "BankStatementImport_bankAccountId_status_idx" ON "public"."BankStatementImport"("bankAccountId", "status");

-- CreateIndex
CREATE INDEX "BankStatementImport_createdAt_idx" ON "public"."BankStatementImport"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BankStatementImport_bankAccountId_fileChecksum_key" ON "public"."BankStatementImport"("bankAccountId", "fileChecksum");

-- CreateIndex
CREATE INDEX "BankTransaction_bankAccountId_txnDate_idx" ON "public"."BankTransaction"("bankAccountId", "txnDate");

-- CreateIndex
CREATE INDEX "BankTransaction_matchStatus_idx" ON "public"."BankTransaction"("matchStatus");

-- CreateIndex
CREATE INDEX "BankTransaction_externalRef_idx" ON "public"."BankTransaction"("externalRef");

-- CreateIndex
CREATE INDEX "BankTransaction_fingerprint_idx" ON "public"."BankTransaction"("fingerprint");

-- CreateIndex
CREATE INDEX "BankTransaction_documentCode_idx" ON "public"."BankTransaction"("documentCode");

-- CreateIndex
CREATE INDEX "BankTransaction_purposeId_idx" ON "public"."BankTransaction"("purposeId");

-- CreateIndex
CREATE INDEX "BankTransaction_counterpartyId_idx" ON "public"."BankTransaction"("counterpartyId");

-- CreateIndex
CREATE UNIQUE INDEX "BankTransaction_bankAccountId_externalRef_key" ON "public"."BankTransaction"("bankAccountId", "externalRef");

-- CreateIndex
CREATE UNIQUE INDEX "BankTransaction_bankAccountId_fingerprint_key" ON "public"."BankTransaction"("bankAccountId", "fingerprint");

-- CreateIndex
CREATE INDEX "CommodityPriceQuote_productId_quoteDate_idx" ON "public"."CommodityPriceQuote"("productId", "quoteDate");

-- CreateIndex
CREATE UNIQUE INDEX "CommodityPriceQuote_productId_quoteDate_source_key" ON "public"."CommodityPriceQuote"("productId", "quoteDate", "source");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeRate_rateDate_base_quote_stage_key" ON "public"."ExchangeRate"("rateDate", "base", "quote", "stage");

-- CreateIndex
CREATE INDEX "VcbFxRate_currencyCode_rateDate_idx" ON "public"."VcbFxRate"("currencyCode", "rateDate");

-- CreateIndex
CREATE UNIQUE INDEX "VcbFxRate_rateDate_bankCode_currencyCode_key" ON "public"."VcbFxRate"("rateDate", "bankCode", "currencyCode");

-- CreateIndex
CREATE INDEX "EnvironmentalTaxRate_productId_effectiveFrom_effectiveTo_idx" ON "public"."EnvironmentalTaxRate"("productId", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE INDEX "EnvironmentalTaxRate_status_idx" ON "public"."EnvironmentalTaxRate"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPricingTemplate_supplierCustomerId_productId_key" ON "public"."SupplierPricingTemplate"("supplierCustomerId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchasePricingRun_supersedesRunId_key" ON "public"."PurchasePricingRun"("supersedesRunId");

-- CreateIndex
CREATE INDEX "PurchasePricingRun_purchaseOrderId_idx" ON "public"."PurchasePricingRun"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "PurchasePricingRun_supplierCustomerId_billDate_idx" ON "public"."PurchasePricingRun"("supplierCustomerId", "billDate");

-- CreateIndex
CREATE INDEX "PurchasePricingRun_status_idx" ON "public"."PurchasePricingRun"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PurchasePricingRun_purchaseOrderId_version_key" ON "public"."PurchasePricingRun"("purchaseOrderId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "PurchasePricingRun_purchaseOrderId_inputHash_key" ON "public"."PurchasePricingRun"("purchaseOrderId", "inputHash");

-- CreateIndex
CREATE UNIQUE INDEX "PurchasePricingStage_runId_stageType_key" ON "public"."PurchasePricingStage"("runId", "stageType");

-- CreateIndex
CREATE INDEX "PurchasePricingStageLine_stageId_idx" ON "public"."PurchasePricingStageLine"("stageId");

-- CreateIndex
CREATE INDEX "PurchasePricingStageLine_productId_idx" ON "public"."PurchasePricingStageLine"("productId");

-- CreateIndex
CREATE INDEX "PurchasePricingStageLine_purchaseOrderLineId_idx" ON "public"."PurchasePricingStageLine"("purchaseOrderLineId");

-- CreateIndex
CREATE INDEX "PurchasePricingStageLine_supplierLocationId_productId_idx" ON "public"."PurchasePricingStageLine"("supplierLocationId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchasePricingStageLine_stageId_purchaseOrderLineId_key" ON "public"."PurchasePricingStageLine"("stageId", "purchaseOrderLineId");

-- CreateIndex
CREATE INDEX "PurchasePricingStageCost_stageId_idx" ON "public"."PurchasePricingStageCost"("stageId");

-- CreateIndex
CREATE INDEX "PurchasePricingStageCost_costType_idx" ON "public"."PurchasePricingStageCost"("costType");

-- CreateIndex
CREATE INDEX "PurchasePricingPriceDay_stageId_quoteDate_idx" ON "public"."PurchasePricingPriceDay"("stageId", "quoteDate");

-- CreateIndex
CREATE UNIQUE INDEX "PriceRegion_code_key" ON "public"."PriceRegion"("code");

-- CreateIndex
CREATE INDEX "PriceRegion_isActive_idx" ON "public"."PriceRegion"("isActive");

-- CreateIndex
CREATE INDEX "PurchasePricingSheetRow_stageId_idx" ON "public"."PurchasePricingSheetRow"("stageId");

-- CreateIndex
CREATE INDEX "PurchasePricingSheetRow_stageId_code_idx" ON "public"."PurchasePricingSheetRow"("stageId", "code");

-- CreateIndex
CREATE INDEX "PurchasePricingSheetRow_stageId_sortOrder_idx" ON "public"."PurchasePricingSheetRow"("stageId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "PurchasePricingSheetRow_stageId_rowNo_key" ON "public"."PurchasePricingSheetRow"("stageId", "rowNo");

-- CreateIndex
CREATE INDEX "PriceBulletin_status_effectiveFrom_idx" ON "public"."PriceBulletin"("status", "effectiveFrom");

-- CreateIndex
CREATE INDEX "PriceBulletin_publishedAt_idx" ON "public"."PriceBulletin"("publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PriceBulletin_publishedAt_key" ON "public"."PriceBulletin"("publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PriceBulletin_fileChecksum_key" ON "public"."PriceBulletin"("fileChecksum");

-- CreateIndex
CREATE INDEX "PriceBulletinItem_productId_regionId_idx" ON "public"."PriceBulletinItem"("productId", "regionId");

-- CreateIndex
CREATE UNIQUE INDEX "PriceBulletinItem_bulletinId_productId_regionId_key" ON "public"."PriceBulletinItem"("bulletinId", "productId", "regionId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_at_idx" ON "public"."AuditLog"("userId", "at");

-- CreateIndex
CREATE INDEX "AuditLog_moduleCode_action_at_idx" ON "public"."AuditLog"("moduleCode", "action", "at");

-- CreateIndex
CREATE INDEX "AuditLog_entityId_idx" ON "public"."AuditLog"("entityId");

-- CreateIndex
CREATE INDEX "ExportJob_moduleCode_status_createdBy_createdAt_idx" ON "public"."ExportJob"("moduleCode", "status", "createdBy", "createdAt");

-- CreateIndex
CREATE INDEX "ImportJob_moduleCode_status_createdBy_createdAt_idx" ON "public"."ImportJob"("moduleCode", "status", "createdBy", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Party_code_key" ON "public"."Party"("code");

-- CreateIndex
CREATE INDEX "Party_name_idx" ON "public"."Party"("name");

-- CreateIndex
CREATE INDEX "Party_taxCode_idx" ON "public"."Party"("taxCode");

-- CreateIndex
CREATE INDEX "Party_groupId_idx" ON "public"."Party"("groupId");

-- CreateIndex
CREATE INDEX "Party_salesOwnerEmpId_idx" ON "public"."Party"("salesOwnerEmpId");

-- CreateIndex
CREATE INDEX "Party_accountingOwnerEmpId_idx" ON "public"."Party"("accountingOwnerEmpId");

-- CreateIndex
CREATE INDEX "Party_legalOwnerEmpId_idx" ON "public"."Party"("legalOwnerEmpId");

-- CreateIndex
CREATE INDEX "Party_documentOwnerEmpId_idx" ON "public"."Party"("documentOwnerEmpId");

-- CreateIndex
CREATE INDEX "Party_masterStatus_idx" ON "public"."Party"("masterStatus");

-- CreateIndex
CREATE INDEX "PartyRole_role_validFrom_validTo_idx" ON "public"."PartyRole"("role", "validFrom", "validTo");

-- CreateIndex
CREATE UNIQUE INDEX "PartyRole_partyId_role_validFrom_key" ON "public"."PartyRole"("partyId", "role", "validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "LegalEntity_code_key" ON "public"."LegalEntity"("code");

-- CreateIndex
CREATE UNIQUE INDEX "LegalEntity_partyId_key" ON "public"."LegalEntity"("partyId");

-- CreateIndex
CREATE INDEX "LegalEntity_partyId_idx" ON "public"."LegalEntity"("partyId");

-- CreateIndex
CREATE INDEX "Warehouse_status_name_idx" ON "public"."Warehouse"("status", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_legalEntityId_code_key" ON "public"."Warehouse"("legalEntityId", "code");

-- CreateIndex
CREATE INDEX "WarehousePartyAssignment_warehouseId_role_validFrom_validTo_idx" ON "public"."WarehousePartyAssignment"("warehouseId", "role", "validFrom", "validTo");

-- CreateIndex
CREATE UNIQUE INDEX "WarehousePartyAssignment_warehouseId_partyId_role_validFrom_key" ON "public"."WarehousePartyAssignment"("warehouseId", "partyId", "role", "validFrom");

-- CreateIndex
CREATE INDEX "GoodsReceiptLine_purchaseOrderLineId_idx" ON "public"."GoodsReceiptLine"("purchaseOrderLineId");

-- CreateIndex
CREATE INDEX "GoodsReceiptLine_productId_ownerPartyId_idx" ON "public"."GoodsReceiptLine"("productId", "ownerPartyId");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceiptLine_goodsReceiptId_lineNo_key" ON "public"."GoodsReceiptLine"("goodsReceiptId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryLot_lotNo_key" ON "public"."InventoryLot"("lotNo");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryLot_receiptLineId_key" ON "public"."InventoryLot"("receiptLineId");

-- CreateIndex
CREATE INDEX "InventoryLot_productId_receivedAt_idx" ON "public"."InventoryLot"("productId", "receivedAt");

-- CreateIndex
CREATE INDEX "InventoryLot_originOwnerPartyId_productId_idx" ON "public"."InventoryLot"("originOwnerPartyId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryPosting_postingNo_key" ON "public"."InventoryPosting"("postingNo");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryPosting_idempotencyKey_key" ON "public"."InventoryPosting"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryPosting_reversalOfId_key" ON "public"."InventoryPosting"("reversalOfId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryPosting_goodsReceiptId_key" ON "public"."InventoryPosting"("goodsReceiptId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryPosting_movementDispatchId_key" ON "public"."InventoryPosting"("movementDispatchId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryPosting_movementArrivalId_key" ON "public"."InventoryPosting"("movementArrivalId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryPosting_ownershipTransferId_key" ON "public"."InventoryPosting"("ownershipTransferId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryPosting_stockAdjustmentId_key" ON "public"."InventoryPosting"("stockAdjustmentId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryPosting_salesDeliveryId_key" ON "public"."InventoryPosting"("salesDeliveryId");

-- CreateIndex
CREATE INDEX "InventoryPosting_effectiveAt_id_idx" ON "public"."InventoryPosting"("effectiveAt", "id");

-- CreateIndex
CREATE INDEX "InventoryPosting_status_postedAt_idx" ON "public"."InventoryPosting"("status", "postedAt");

-- CreateIndex
CREATE INDEX "InventoryLedgerEntry_warehouseId_productId_ownerPartyId_inv_idx" ON "public"."InventoryLedgerEntry"("warehouseId", "productId", "ownerPartyId", "inventoryLotId", "effectiveAt");

-- CreateIndex
CREATE INDEX "InventoryLedgerEntry_inventoryLotId_effectiveAt_idx" ON "public"."InventoryLedgerEntry"("inventoryLotId", "effectiveAt");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryLedgerEntry_postingId_lineNo_key" ON "public"."InventoryLedgerEntry"("postingId", "lineNo");

-- CreateIndex
CREATE INDEX "StockBalance_warehouseId_productId_ownerPartyId_idx" ON "public"."StockBalance"("warehouseId", "productId", "ownerPartyId");

-- CreateIndex
CREATE INDEX "StockBalance_ownerPartyId_productId_idx" ON "public"."StockBalance"("ownerPartyId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "StockBalance_warehouseId_productId_ownerPartyId_inventoryLo_key" ON "public"."StockBalance"("warehouseId", "productId", "ownerPartyId", "inventoryLotId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryReservation_reservationNo_key" ON "public"."InventoryReservation"("reservationNo");

-- CreateIndex
CREATE INDEX "InventoryReservation_status_expiresAt_idx" ON "public"."InventoryReservation"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "InventoryReservation_customerPartyId_status_idx" ON "public"."InventoryReservation"("customerPartyId", "status");

-- CreateIndex
CREATE INDEX "InventoryReservation_salesOrderId_status_idx" ON "public"."InventoryReservation"("salesOrderId", "status");

-- CreateIndex
CREATE INDEX "InventoryReservationLine_warehouseId_productId_ownerPartyId_idx" ON "public"."InventoryReservationLine"("warehouseId", "productId", "ownerPartyId");

-- CreateIndex
CREATE INDEX "InventoryReservationLine_inventoryLotId_idx" ON "public"."InventoryReservationLine"("inventoryLotId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryReservationLine_reservationId_lineNo_key" ON "public"."InventoryReservationLine"("reservationId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryReservationEvent_idempotencyKey_key" ON "public"."InventoryReservationEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "InventoryReservationEvent_reservationLineId_occurredAt_idx" ON "public"."InventoryReservationEvent"("reservationLineId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryPendingRelease_pendingNo_key" ON "public"."InventoryPendingRelease"("pendingNo");

-- CreateIndex
CREATE INDEX "InventoryPendingRelease_warehouseId_productId_ownerPartyId__idx" ON "public"."InventoryPendingRelease"("warehouseId", "productId", "ownerPartyId", "status");

-- CreateIndex
CREATE INDEX "InventoryPendingRelease_inventoryLotId_status_idx" ON "public"."InventoryPendingRelease"("inventoryLotId", "status");

-- CreateIndex
CREATE INDEX "InventoryPendingRelease_goodsReceiptLineId_idx" ON "public"."InventoryPendingRelease"("goodsReceiptLineId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryPendingReleaseEvent_idempotencyKey_key" ON "public"."InventoryPendingReleaseEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "InventoryPendingReleaseEvent_pendingReleaseId_occurredAt_idx" ON "public"."InventoryPendingReleaseEvent"("pendingReleaseId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryBlock_blockNo_key" ON "public"."InventoryBlock"("blockNo");

-- CreateIndex
CREATE INDEX "InventoryBlock_warehouseId_productId_ownerPartyId_status_idx" ON "public"."InventoryBlock"("warehouseId", "productId", "ownerPartyId", "status");

-- CreateIndex
CREATE INDEX "InventoryBlock_reconciliationVarianceId_idx" ON "public"."InventoryBlock"("reconciliationVarianceId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryBlockEvent_idempotencyKey_key" ON "public"."InventoryBlockEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "InventoryBlockEvent_blockId_occurredAt_idx" ON "public"."InventoryBlockEvent"("blockId", "occurredAt");

-- CreateIndex
CREATE INDEX "InventoryAvailabilityBalance_ownerPartyId_productId_idx" ON "public"."InventoryAvailabilityBalance"("ownerPartyId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryAvailabilityBalance_warehouseId_productId_ownerPar_key" ON "public"."InventoryAvailabilityBalance"("warehouseId", "productId", "ownerPartyId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryMovement_movementNo_key" ON "public"."InventoryMovement"("movementNo");

-- CreateIndex
CREATE INDEX "InventoryMovement_fromWarehouseId_status_idx" ON "public"."InventoryMovement"("fromWarehouseId", "status");

-- CreateIndex
CREATE INDEX "InventoryMovement_toWarehouseId_status_idx" ON "public"."InventoryMovement"("toWarehouseId", "status");

-- CreateIndex
CREATE INDEX "InventoryMovementLine_productId_ownerPartyId_inventoryLotId_idx" ON "public"."InventoryMovementLine"("productId", "ownerPartyId", "inventoryLotId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryMovementLine_movementId_lineNo_key" ON "public"."InventoryMovementLine"("movementId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryDispatch_dispatchNo_key" ON "public"."InventoryDispatch"("dispatchNo");

-- CreateIndex
CREATE INDEX "InventoryDispatch_movementId_status_idx" ON "public"."InventoryDispatch"("movementId", "status");

-- CreateIndex
CREATE INDEX "InventoryDispatchLine_movementLineId_idx" ON "public"."InventoryDispatchLine"("movementLineId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryDispatchLine_dispatchId_movementLineId_key" ON "public"."InventoryDispatchLine"("dispatchId", "movementLineId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryArrival_arrivalNo_key" ON "public"."InventoryArrival"("arrivalNo");

-- CreateIndex
CREATE INDEX "InventoryArrival_movementId_status_idx" ON "public"."InventoryArrival"("movementId", "status");

-- CreateIndex
CREATE INDEX "InventoryArrivalLine_dispatchLineId_idx" ON "public"."InventoryArrivalLine"("dispatchLineId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryArrivalLine_arrivalId_dispatchLineId_key" ON "public"."InventoryArrivalLine"("arrivalId", "dispatchLineId");

-- CreateIndex
CREATE UNIQUE INDEX "OwnershipTransfer_transferNo_key" ON "public"."OwnershipTransfer"("transferNo");

-- CreateIndex
CREATE INDEX "OwnershipTransfer_warehouseId_effectiveAt_idx" ON "public"."OwnershipTransfer"("warehouseId", "effectiveAt");

-- CreateIndex
CREATE INDEX "OwnershipTransferLine_productId_inventoryLotId_idx" ON "public"."OwnershipTransferLine"("productId", "inventoryLotId");

-- CreateIndex
CREATE UNIQUE INDEX "OwnershipTransferLine_transferId_lineNo_key" ON "public"."OwnershipTransferLine"("transferId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "StockAdjustment_adjustmentNo_key" ON "public"."StockAdjustment"("adjustmentNo");

-- CreateIndex
CREATE INDEX "StockAdjustment_warehouseId_status_effectiveAt_idx" ON "public"."StockAdjustment"("warehouseId", "status", "effectiveAt");

-- CreateIndex
CREATE INDEX "StockAdjustmentLine_productId_ownerPartyId_inventoryLotId_idx" ON "public"."StockAdjustmentLine"("productId", "ownerPartyId", "inventoryLotId");

-- CreateIndex
CREATE UNIQUE INDEX "StockAdjustmentLine_adjustmentId_lineNo_key" ON "public"."StockAdjustmentLine"("adjustmentId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "ExpectedSupply_expectedNo_key" ON "public"."ExpectedSupply"("expectedNo");

-- CreateIndex
CREATE INDEX "ExpectedSupply_warehouseId_productId_ownerPartyId_status_ex_idx" ON "public"."ExpectedSupply"("warehouseId", "productId", "ownerPartyId", "status", "expectedAt");

-- CreateIndex
CREATE INDEX "ExpectedSupply_purchaseOrderLineId_status_idx" ON "public"."ExpectedSupply"("purchaseOrderLineId", "status");

-- CreateIndex
CREATE INDEX "ExpectedSupply_shipmentLineId_status_idx" ON "public"."ExpectedSupply"("shipmentLineId", "status");

-- CreateIndex
CREATE INDEX "ExpectedSupply_movementLineId_status_idx" ON "public"."ExpectedSupply"("movementLineId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ExpectedSupplyAllocation_idempotencyKey_key" ON "public"."ExpectedSupplyAllocation"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ExpectedSupplyAllocation_receiptLineId_idx" ON "public"."ExpectedSupplyAllocation"("receiptLineId");

-- CreateIndex
CREATE UNIQUE INDEX "ExpectedSupplyAllocation_expectedSupplyId_receiptLineId_key" ON "public"."ExpectedSupplyAllocation"("expectedSupplyId", "receiptLineId");

-- CreateIndex
CREATE INDEX "ReconciliationTemplate_supplierPartyId_status_idx" ON "public"."ReconciliationTemplate"("supplierPartyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationTemplate_code_version_key" ON "public"."ReconciliationTemplate"("code", "version");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseReconciliation_sessionNo_key" ON "public"."WarehouseReconciliation"("sessionNo");

-- CreateIndex
CREATE INDEX "WarehouseReconciliation_warehouseId_asOfAt_idx" ON "public"."WarehouseReconciliation"("warehouseId", "asOfAt");

-- CreateIndex
CREATE INDEX "WarehouseReconciliation_reconciliationPartyId_status_idx" ON "public"."WarehouseReconciliation"("reconciliationPartyId", "status");

-- CreateIndex
CREATE INDEX "ReconciliationFile_checksumSha256_idx" ON "public"."ReconciliationFile"("checksumSha256");

-- CreateIndex
CREATE INDEX "ReconciliationFile_replacedFileId_idx" ON "public"."ReconciliationFile"("replacedFileId");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationFile_sessionId_version_key" ON "public"."ReconciliationFile"("sessionId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationFile_sessionId_checksumSha256_key" ON "public"."ReconciliationFile"("sessionId", "checksumSha256");

-- CreateIndex
CREATE INDEX "ReconciliationRawRow_fileId_status_idx" ON "public"."ReconciliationRawRow"("fileId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationRawRow_fileId_sheetName_rowNo_key" ON "public"."ReconciliationRawRow"("fileId", "sheetName", "rowNo");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationNormalizedLine_rawRowId_key" ON "public"."ReconciliationNormalizedLine"("rawRowId");

-- CreateIndex
CREATE INDEX "ReconciliationNormalizedLine_productId_ownerPartyId_idx" ON "public"."ReconciliationNormalizedLine"("productId", "ownerPartyId");

-- CreateIndex
CREATE INDEX "ReconciliationSnapshotLine_productId_ownerPartyId_idx" ON "public"."ReconciliationSnapshotLine"("productId", "ownerPartyId");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationSnapshotLine_sessionId_productId_ownerPartyId_key" ON "public"."ReconciliationSnapshotLine"("sessionId", "productId", "ownerPartyId");

-- CreateIndex
CREATE INDEX "ReconciliationVariance_status_varianceActualQty_idx" ON "public"."ReconciliationVariance"("status", "varianceActualQty");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationVariance_sessionId_productId_ownerPartyId_key" ON "public"."ReconciliationVariance"("sessionId", "productId", "ownerPartyId");

-- CreateIndex
CREATE INDEX "ReconciliationResolution_varianceId_resolvedAt_idx" ON "public"."ReconciliationResolution"("varianceId", "resolvedAt");

-- CreateIndex
CREATE INDEX "ReconciliationResolution_stockAdjustmentId_idx" ON "public"."ReconciliationResolution"("stockAdjustmentId");

-- CreateIndex
CREATE INDEX "ReconciliationResolution_movementId_idx" ON "public"."ReconciliationResolution"("movementId");

-- CreateIndex
CREATE UNIQUE INDEX "LandedCostDocument_documentNo_key" ON "public"."LandedCostDocument"("documentNo");

-- CreateIndex
CREATE INDEX "LandedCostDocument_purchaseOrderId_status_idx" ON "public"."LandedCostDocument"("purchaseOrderId", "status");

-- CreateIndex
CREATE INDEX "LandedCostDocument_shipmentId_status_idx" ON "public"."LandedCostDocument"("shipmentId", "status");

-- CreateIndex
CREATE INDEX "LandedCostDocument_vendorPartyId_documentDate_idx" ON "public"."LandedCostDocument"("vendorPartyId", "documentDate");

-- CreateIndex
CREATE UNIQUE INDEX "LandedCostLine_documentId_lineNo_key" ON "public"."LandedCostLine"("documentId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "LandedCostAllocation_idempotencyKey_key" ON "public"."LandedCostAllocation"("idempotencyKey");

-- CreateIndex
CREATE INDEX "LandedCostAllocation_inventoryLotId_idx" ON "public"."LandedCostAllocation"("inventoryLotId");

-- CreateIndex
CREATE UNIQUE INDEX "LandedCostAllocation_landedCostLineId_inventoryLotId_key" ON "public"."LandedCostAllocation"("landedCostLineId", "inventoryLotId");

-- CreateIndex
CREATE INDEX "InventoryCostLayer_ownerPartyId_status_openedAt_idx" ON "public"."InventoryCostLayer"("ownerPartyId", "status", "openedAt");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryCostLayer_inventoryLotId_ownerPartyId_key" ON "public"."InventoryCostLayer"("inventoryLotId", "ownerPartyId");

-- CreateIndex
CREATE UNIQUE INDEX "CostLayerEntry_reversalOfId_key" ON "public"."CostLayerEntry"("reversalOfId");

-- CreateIndex
CREATE UNIQUE INDEX "CostLayerEntry_idempotencyKey_key" ON "public"."CostLayerEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CostLayerEntry_costLayerId_effectiveAt_idx" ON "public"."CostLayerEntry"("costLayerId", "effectiveAt");

-- CreateIndex
CREATE INDEX "CostLayerEntry_pricingStageLineId_idx" ON "public"."CostLayerEntry"("pricingStageLineId");

-- CreateIndex
CREATE INDEX "CostLayerEntry_landedCostAllocationId_idx" ON "public"."CostLayerEntry"("landedCostAllocationId");

-- CreateIndex
CREATE INDEX "CostLayerEntry_salesDeliveryLineId_idx" ON "public"."CostLayerEntry"("salesDeliveryLineId");

-- CreateIndex
CREATE INDEX "SupplierInvoice_supplierCustomerId_status_invoiceDate_idx" ON "public"."SupplierInvoice"("supplierCustomerId", "status", "invoiceDate");

-- CreateIndex
CREATE INDEX "SupplierInvoice_purchaseOrderId_idx" ON "public"."SupplierInvoice"("purchaseOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierInvoice_legalEntityId_supplierCustomerId_invoiceSym_key" ON "public"."SupplierInvoice"("legalEntityId", "supplierCustomerId", "invoiceSymbol", "invoiceNo");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierInvoice_legalEntityId_sourceFileChecksum_key" ON "public"."SupplierInvoice"("legalEntityId", "sourceFileChecksum");

-- CreateIndex
CREATE INDEX "SupplierInvoiceLine_receiptLineId_idx" ON "public"."SupplierInvoiceLine"("receiptLineId");

-- CreateIndex
CREATE INDEX "SupplierInvoiceLine_purchaseOrderLineId_idx" ON "public"."SupplierInvoiceLine"("purchaseOrderLineId");

-- CreateIndex
CREATE INDEX "SupplierInvoiceLine_landedCostLineId_idx" ON "public"."SupplierInvoiceLine"("landedCostLineId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierInvoiceLine_invoiceId_lineNo_key" ON "public"."SupplierInvoiceLine"("invoiceId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "PayableOpenItem_supplierInvoiceId_key" ON "public"."PayableOpenItem"("supplierInvoiceId");

-- CreateIndex
CREATE INDEX "PayableOpenItem_supplierPartyId_status_dueDate_idx" ON "public"."PayableOpenItem"("supplierPartyId", "status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "PayableLedgerEntry_allocationId_key" ON "public"."PayableLedgerEntry"("allocationId");

-- CreateIndex
CREATE UNIQUE INDEX "PayableLedgerEntry_reversalOfId_key" ON "public"."PayableLedgerEntry"("reversalOfId");

-- CreateIndex
CREATE UNIQUE INDEX "PayableLedgerEntry_idempotencyKey_key" ON "public"."PayableLedgerEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PayableLedgerEntry_openItemId_effectiveAt_idx" ON "public"."PayableLedgerEntry"("openItemId", "effectiveAt");

-- CreateIndex
CREATE UNIQUE INDEX "PayableAllocation_reversalOfId_key" ON "public"."PayableAllocation"("reversalOfId");

-- CreateIndex
CREATE UNIQUE INDEX "PayableAllocation_idempotencyKey_key" ON "public"."PayableAllocation"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PayableAllocation_bankTransactionId_status_idx" ON "public"."PayableAllocation"("bankTransactionId", "status");

-- CreateIndex
CREATE INDEX "PayableAllocation_openItemId_status_idx" ON "public"."PayableAllocation"("openItemId", "status");

-- AddForeignKey
ALTER TABLE "public"."CronJobRun" ADD CONSTRAINT "CronJobRun_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "public"."CronJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BackgroundJobRun" ADD CONSTRAINT "BackgroundJobRun_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "public"."BackgroundJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Employee" ADD CONSTRAINT "Employee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Employee" ADD CONSTRAINT "Employee_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "public"."Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Employee" ADD CONSTRAINT "Employee_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "public"."Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Site" ADD CONSTRAINT "Site_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "public"."Area"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Department" ADD CONSTRAINT "Department_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "public"."Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Department" ADD CONSTRAINT "Department_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "public"."Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."EmployeeDepartment" ADD CONSTRAINT "EmployeeDepartment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "public"."Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."EmployeeDepartment" ADD CONSTRAINT "EmployeeDepartment_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "public"."Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DepartmentManager" ADD CONSTRAINT "DepartmentManager_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "public"."Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DepartmentManager" ADD CONSTRAINT "DepartmentManager_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "public"."Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Permission" ADD CONSTRAINT "Permission_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "public"."Module"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "public"."Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "public"."Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserRoleBinding" ADD CONSTRAINT "UserRoleBinding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserRoleBinding" ADD CONSTRAINT "UserRoleBinding_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "public"."Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CustomerAddress" ADD CONSTRAINT "CustomerAddress_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ContactPerson" ADD CONSTRAINT "ContactPerson_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Contract" ADD CONSTRAINT "Contract_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Contract" ADD CONSTRAINT "Contract_contractTypeId_fkey" FOREIGN KEY ("contractTypeId") REFERENCES "public"."ContractType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Contract" ADD CONSTRAINT "Contract_renewalOfId_fkey" FOREIGN KEY ("renewalOfId") REFERENCES "public"."Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ContractAttachment" ADD CONSTRAINT "ContractAttachment_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "public"."Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ContractItem" ADD CONSTRAINT "ContractItem_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "public"."Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ContractAppendix" ADD CONSTRAINT "ContractAppendix_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "public"."Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CreditLimitHistory" ADD CONSTRAINT "CreditLimitHistory_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RiskFlag" ADD CONSTRAINT "RiskFlag_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Vehicle" ADD CONSTRAINT "Vehicle_supplierCustomerId_fkey" FOREIGN KEY ("supplierCustomerId") REFERENCES "public"."Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Driver" ADD CONSTRAINT "Driver_supplierCustomerId_fkey" FOREIGN KEY ("supplierCustomerId") REFERENCES "public"."Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProductAlias" ADD CONSTRAINT "ProductAlias_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProductAlias" ADD CONSTRAINT "ProductAlias_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "public"."Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierCustomerId_fkey" FOREIGN KEY ("supplierCustomerId") REFERENCES "public"."Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "public"."LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_priceRegionId_fkey" FOREIGN KEY ("priceRegionId") REFERENCES "public"."PriceRegion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "public"."Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TermPurchaseProfile" ADD CONSTRAINT "TermPurchaseProfile_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "public"."PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_receivingWarehouseId_fkey" FOREIGN KEY ("receivingWarehouseId") REFERENCES "public"."Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "public"."PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchaseTermOrderDocument" ADD CONSTRAINT "PurchaseTermOrderDocument_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "public"."PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchaseTermOrderDocument" ADD CONSTRAINT "PurchaseTermOrderDocument_sourcePricingStageId_fkey" FOREIGN KEY ("sourcePricingStageId") REFERENCES "public"."PurchasePricingStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchaseTermOrderDocumentLine" ADD CONSTRAINT "PurchaseTermOrderDocumentLine_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "public"."PurchaseTermOrderDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchaseTermPaymentRequest" ADD CONSTRAINT "PurchaseTermPaymentRequest_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "public"."PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchaseTermPaymentRequest" ADD CONSTRAINT "PurchaseTermPaymentRequest_orderDocumentId_fkey" FOREIGN KEY ("orderDocumentId") REFERENCES "public"."PurchaseTermOrderDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchaseTermPaymentRequest" ADD CONSTRAINT "PurchaseTermPaymentRequest_sourcePricingStageId_fkey" FOREIGN KEY ("sourcePricingStageId") REFERENCES "public"."PurchasePricingStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TermPaymentBatch" ADD CONSTRAINT "TermPaymentBatch_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "public"."BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TermPaymentBatchItem" ADD CONSTRAINT "TermPaymentBatchItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "public"."TermPaymentBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TermPaymentBatchItem" ADD CONSTRAINT "TermPaymentBatchItem_paymentRequestId_fkey" FOREIGN KEY ("paymentRequestId") REFERENCES "public"."PurchaseTermPaymentRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TermPaymentBatchItem" ADD CONSTRAINT "TermPaymentBatchItem_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "public"."PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TermPaymentBatchItem" ADD CONSTRAINT "TermPaymentBatchItem_bankTransactionId_fkey" FOREIGN KEY ("bankTransactionId") REFERENCES "public"."BankTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TermPaymentBatchFile" ADD CONSTRAINT "TermPaymentBatchFile_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "public"."TermPaymentBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchaseTermBankInstruction" ADD CONSTRAINT "PurchaseTermBankInstruction_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "public"."PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchaseTermBankInstruction" ADD CONSTRAINT "PurchaseTermBankInstruction_paymentRequestId_fkey" FOREIGN KEY ("paymentRequestId") REFERENCES "public"."PurchaseTermPaymentRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchaseTermBankInstruction" ADD CONSTRAINT "PurchaseTermBankInstruction_bankTransactionId_fkey" FOREIGN KEY ("bankTransactionId") REFERENCES "public"."BankTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchaseTermSettlementAdjustment" ADD CONSTRAINT "PurchaseTermSettlementAdjustment_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "public"."PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchaseTermSettlementAdjustment" ADD CONSTRAINT "PurchaseTermSettlementAdjustment_finalPricingStageId_fkey" FOREIGN KEY ("finalPricingStageId") REFERENCES "public"."PurchasePricingStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchaseShipment" ADD CONSTRAINT "PurchaseShipment_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "public"."PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchaseShipment" ADD CONSTRAINT "PurchaseShipment_vesselId_fkey" FOREIGN KEY ("vesselId") REFERENCES "public"."Vessel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchaseShipmentLine" ADD CONSTRAINT "PurchaseShipmentLine_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "public"."PurchaseShipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchaseShipmentLine" ADD CONSTRAINT "PurchaseShipmentLine_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "public"."PurchaseOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SalesOrder" ADD CONSTRAINT "SalesOrder_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "public"."LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SalesOrder" ADD CONSTRAINT "SalesOrder_customerPartyId_fkey" FOREIGN KEY ("customerPartyId") REFERENCES "public"."Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SalesOrderLine" ADD CONSTRAINT "SalesOrderLine_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "public"."SalesOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SalesOrderLine" ADD CONSTRAINT "SalesOrderLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SalesDelivery" ADD CONSTRAINT "SalesDelivery_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "public"."SalesOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SalesDelivery" ADD CONSTRAINT "SalesDelivery_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "public"."Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SalesDeliveryLine" ADD CONSTRAINT "SalesDeliveryLine_salesDeliveryId_fkey" FOREIGN KEY ("salesDeliveryId") REFERENCES "public"."SalesDelivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SalesDeliveryLine" ADD CONSTRAINT "SalesDeliveryLine_salesOrderLineId_fkey" FOREIGN KEY ("salesOrderLineId") REFERENCES "public"."SalesOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SalesDeliveryLine" ADD CONSTRAINT "SalesDeliveryLine_ownerPartyId_fkey" FOREIGN KEY ("ownerPartyId") REFERENCES "public"."Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TermLogisticsCost" ADD CONSTRAINT "TermLogisticsCost_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "public"."PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TermLogisticsCost" ADD CONSTRAINT "TermLogisticsCost_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "public"."PurchaseShipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TermLogisticsCost" ADD CONSTRAINT "TermLogisticsCost_vendorCustomerId_fkey" FOREIGN KEY ("vendorCustomerId") REFERENCES "public"."Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TermLogisticsCostLine" ADD CONSTRAINT "TermLogisticsCostLine_logisticsCostId_fkey" FOREIGN KEY ("logisticsCostId") REFERENCES "public"."TermLogisticsCost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TermLogisticsCostLine" ADD CONSTRAINT "TermLogisticsCostLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TermLogisticsCostLine" ADD CONSTRAINT "TermLogisticsCostLine_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "public"."PurchaseOrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TermLogisticsCostLine" ADD CONSTRAINT "TermLogisticsCostLine_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "public"."GoodsReceipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchaseOrderPaymentPlan" ADD CONSTRAINT "PurchaseOrderPaymentPlan_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "public"."PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_supplierCustomerId_fkey" FOREIGN KEY ("supplierCustomerId") REFERENCES "public"."Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "public"."Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "public"."Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "public"."Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "public"."PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Vessel" ADD CONSTRAINT "Vessel_ownerCustomerId_fkey" FOREIGN KEY ("ownerCustomerId") REFERENCES "public"."Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."VesselDocument" ADD CONSTRAINT "VesselDocument_vesselId_fkey" FOREIGN KEY ("vesselId") REFERENCES "public"."Vessel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ShipCharterContract" ADD CONSTRAINT "ShipCharterContract_ownerCustomerId_fkey" FOREIGN KEY ("ownerCustomerId") REFERENCES "public"."Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ShipCharterContractLossRate" ADD CONSTRAINT "ShipCharterContractLossRate_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "public"."ShipCharterContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ShipCharterAppendix" ADD CONSTRAINT "ShipCharterAppendix_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "public"."ShipCharterContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ShipCharterAppendix" ADD CONSTRAINT "ShipCharterAppendix_vesselId_fkey" FOREIGN KEY ("vesselId") REFERENCES "public"."Vessel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ShipCharterAppendix" ADD CONSTRAINT "ShipCharterAppendix_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "public"."PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ShipCharterAppendix" ADD CONSTRAINT "ShipCharterAppendix_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ShipCharterAppendix" ADD CONSTRAINT "ShipCharterAppendix_receivingWarehouseId_fkey" FOREIGN KEY ("receivingWarehouseId") REFERENCES "public"."Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ShipCharterOrder" ADD CONSTRAINT "ShipCharterOrder_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "public"."PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ShipCharterOrder" ADD CONSTRAINT "ShipCharterOrder_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "public"."PurchaseShipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ShipCharterOrder" ADD CONSTRAINT "ShipCharterOrder_appendixId_fkey" FOREIGN KEY ("appendixId") REFERENCES "public"."ShipCharterAppendix"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ShipCharterOrder" ADD CONSTRAINT "ShipCharterOrder_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "public"."ShipCharterContract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ShipCharterOrder" ADD CONSTRAINT "ShipCharterOrder_ownerCustomerId_fkey" FOREIGN KEY ("ownerCustomerId") REFERENCES "public"."Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ShipCharterOrder" ADD CONSTRAINT "ShipCharterOrder_vesselId_fkey" FOREIGN KEY ("vesselId") REFERENCES "public"."Vessel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ShipCharterOrder" ADD CONSTRAINT "ShipCharterOrder_receivingWarehouseId_fkey" FOREIGN KEY ("receivingWarehouseId") REFERENCES "public"."Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ShipCharterOrder" ADD CONSTRAINT "ShipCharterOrder_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ShipCharterInsurance" ADD CONSTRAINT "ShipCharterInsurance_charterOrderId_fkey" FOREIGN KEY ("charterOrderId") REFERENCES "public"."ShipCharterOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ShipCharterInsurance" ADD CONSTRAINT "ShipCharterInsurance_insuranceCompanyId_fkey" FOREIGN KEY ("insuranceCompanyId") REFERENCES "public"."Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ShipCharterInspection" ADD CONSTRAINT "ShipCharterInspection_charterOrderId_fkey" FOREIGN KEY ("charterOrderId") REFERENCES "public"."ShipCharterOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ShipCharterInspection" ADD CONSTRAINT "ShipCharterInspection_inspectionCompanyId_fkey" FOREIGN KEY ("inspectionCompanyId") REFERENCES "public"."Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ShippingAgentRegistration" ADD CONSTRAINT "ShippingAgentRegistration_charterOrderId_fkey" FOREIGN KEY ("charterOrderId") REFERENCES "public"."ShipCharterOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ShippingAgentRegistration" ADD CONSTRAINT "ShippingAgentRegistration_agentCustomerId_fkey" FOREIGN KEY ("agentCustomerId") REFERENCES "public"."Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ShipFreightRate" ADD CONSTRAINT "ShipFreightRate_ownerCustomerId_fkey" FOREIGN KEY ("ownerCustomerId") REFERENCES "public"."Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ShipFreightRate" ADD CONSTRAINT "ShipFreightRate_vesselId_fkey" FOREIGN KEY ("vesselId") REFERENCES "public"."Vessel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ShipFreightRate" ADD CONSTRAINT "ShipFreightRate_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "public"."ShipCharterContract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ShipFreightRate" ADD CONSTRAINT "ShipFreightRate_appendixId_fkey" FOREIGN KEY ("appendixId") REFERENCES "public"."ShipCharterAppendix"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ShipFreightRate" ADD CONSTRAINT "ShipFreightRate_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StorageRentalContract" ADD CONSTRAINT "StorageRentalContract_lessorCustomerId_fkey" FOREIGN KEY ("lessorCustomerId") REFERENCES "public"."Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StorageRentalContractLocation" ADD CONSTRAINT "StorageRentalContractLocation_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "public"."StorageRentalContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StorageRentalContractLocation" ADD CONSTRAINT "StorageRentalContractLocation_supplierLocationId_fkey" FOREIGN KEY ("supplierLocationId") REFERENCES "public"."Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StorageRentalLossRate" ADD CONSTRAINT "StorageRentalLossRate_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "public"."StorageRentalContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StorageRentalFeeTier" ADD CONSTRAINT "StorageRentalFeeTier_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "public"."StorageRentalContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."VehicleDocument" ADD CONSTRAINT "VehicleDocument_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "public"."Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DriverDocument" ADD CONSTRAINT "DriverDocument_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "public"."Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."VehicleDispatchOrder" ADD CONSTRAINT "VehicleDispatchOrder_inventoryMovementId_fkey" FOREIGN KEY ("inventoryMovementId") REFERENCES "public"."InventoryMovement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."VehicleDispatchOrder" ADD CONSTRAINT "VehicleDispatchOrder_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "public"."Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."VehicleDispatchOrder" ADD CONSTRAINT "VehicleDispatchOrder_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "public"."Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."VehicleDispatchOrder" ADD CONSTRAINT "VehicleDispatchOrder_fromSupplierLocationId_fkey" FOREIGN KEY ("fromSupplierLocationId") REFERENCES "public"."Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."VehicleDispatchOrder" ADD CONSTRAINT "VehicleDispatchOrder_toSupplierLocationId_fkey" FOREIGN KEY ("toSupplierLocationId") REFERENCES "public"."Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."VehicleDispatchOrder" ADD CONSTRAINT "VehicleDispatchOrder_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchasePricingRunReceipt" ADD CONSTRAINT "PurchasePricingRunReceipt_runId_fkey" FOREIGN KEY ("runId") REFERENCES "public"."PurchasePricingRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchasePricingRunReceipt" ADD CONSTRAINT "PurchasePricingRunReceipt_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "public"."GoodsReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BankStatementImport" ADD CONSTRAINT "BankStatementImport_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "public"."BankAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BankStatementImport" ADD CONSTRAINT "BankStatementImport_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "public"."BankImportTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BankTransaction" ADD CONSTRAINT "BankTransaction_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "public"."BankAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BankTransaction" ADD CONSTRAINT "BankTransaction_importId_fkey" FOREIGN KEY ("importId") REFERENCES "public"."BankStatementImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BankTransaction" ADD CONSTRAINT "BankTransaction_purposeId_fkey" FOREIGN KEY ("purposeId") REFERENCES "public"."BankTransactionPurpose"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CommodityPriceQuote" ADD CONSTRAINT "CommodityPriceQuote_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."EnvironmentalTaxRate" ADD CONSTRAINT "EnvironmentalTaxRate_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SupplierPricingTemplate" ADD CONSTRAINT "SupplierPricingTemplate_supplierCustomerId_fkey" FOREIGN KEY ("supplierCustomerId") REFERENCES "public"."Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SupplierPricingTemplate" ADD CONSTRAINT "SupplierPricingTemplate_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchasePricingRun" ADD CONSTRAINT "PurchasePricingRun_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "public"."PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchasePricingRun" ADD CONSTRAINT "PurchasePricingRun_supplierCustomerId_fkey" FOREIGN KEY ("supplierCustomerId") REFERENCES "public"."Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchasePricingRun" ADD CONSTRAINT "PurchasePricingRun_supersedesRunId_fkey" FOREIGN KEY ("supersedesRunId") REFERENCES "public"."PurchasePricingRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchasePricingStage" ADD CONSTRAINT "PurchasePricingStage_runId_fkey" FOREIGN KEY ("runId") REFERENCES "public"."PurchasePricingRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchasePricingStageLine" ADD CONSTRAINT "PurchasePricingStageLine_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "public"."PurchasePricingStage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchasePricingStageLine" ADD CONSTRAINT "PurchasePricingStageLine_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "public"."PurchaseOrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchasePricingStageLine" ADD CONSTRAINT "PurchasePricingStageLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchasePricingStageLine" ADD CONSTRAINT "PurchasePricingStageLine_supplierLocationId_fkey" FOREIGN KEY ("supplierLocationId") REFERENCES "public"."Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchasePricingStageCost" ADD CONSTRAINT "PurchasePricingStageCost_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "public"."PurchasePricingStage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchasePricingPriceDay" ADD CONSTRAINT "PurchasePricingPriceDay_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "public"."PurchasePricingStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PurchasePricingSheetRow" ADD CONSTRAINT "PurchasePricingSheetRow_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "public"."PurchasePricingStage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PriceBulletinItem" ADD CONSTRAINT "PriceBulletinItem_bulletinId_fkey" FOREIGN KEY ("bulletinId") REFERENCES "public"."PriceBulletin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PriceBulletinItem" ADD CONSTRAINT "PriceBulletinItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PriceBulletinItem" ADD CONSTRAINT "PriceBulletinItem_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "public"."PriceRegion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Party" ADD CONSTRAINT "Party_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."CustomerGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Party" ADD CONSTRAINT "Party_salesOwnerEmpId_fkey" FOREIGN KEY ("salesOwnerEmpId") REFERENCES "public"."Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Party" ADD CONSTRAINT "Party_accountingOwnerEmpId_fkey" FOREIGN KEY ("accountingOwnerEmpId") REFERENCES "public"."Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Party" ADD CONSTRAINT "Party_legalOwnerEmpId_fkey" FOREIGN KEY ("legalOwnerEmpId") REFERENCES "public"."Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Party" ADD CONSTRAINT "Party_documentOwnerEmpId_fkey" FOREIGN KEY ("documentOwnerEmpId") REFERENCES "public"."Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PartyRole" ADD CONSTRAINT "PartyRole_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "public"."Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LegalEntity" ADD CONSTRAINT "LegalEntity_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "public"."Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Warehouse" ADD CONSTRAINT "Warehouse_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "public"."LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WarehousePartyAssignment" ADD CONSTRAINT "WarehousePartyAssignment_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "public"."Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WarehousePartyAssignment" ADD CONSTRAINT "WarehousePartyAssignment_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "public"."Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "public"."GoodsReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "public"."PurchaseOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_ownerPartyId_fkey" FOREIGN KEY ("ownerPartyId") REFERENCES "public"."Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryLot" ADD CONSTRAINT "InventoryLot_receiptLineId_fkey" FOREIGN KEY ("receiptLineId") REFERENCES "public"."GoodsReceiptLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryLot" ADD CONSTRAINT "InventoryLot_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryLot" ADD CONSTRAINT "InventoryLot_originOwnerPartyId_fkey" FOREIGN KEY ("originOwnerPartyId") REFERENCES "public"."Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryPosting" ADD CONSTRAINT "InventoryPosting_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "public"."InventoryPosting"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryPosting" ADD CONSTRAINT "InventoryPosting_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "public"."GoodsReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryPosting" ADD CONSTRAINT "InventoryPosting_movementDispatchId_fkey" FOREIGN KEY ("movementDispatchId") REFERENCES "public"."InventoryDispatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryPosting" ADD CONSTRAINT "InventoryPosting_movementArrivalId_fkey" FOREIGN KEY ("movementArrivalId") REFERENCES "public"."InventoryArrival"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryPosting" ADD CONSTRAINT "InventoryPosting_ownershipTransferId_fkey" FOREIGN KEY ("ownershipTransferId") REFERENCES "public"."OwnershipTransfer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryPosting" ADD CONSTRAINT "InventoryPosting_stockAdjustmentId_fkey" FOREIGN KEY ("stockAdjustmentId") REFERENCES "public"."StockAdjustment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryPosting" ADD CONSTRAINT "InventoryPosting_salesDeliveryId_fkey" FOREIGN KEY ("salesDeliveryId") REFERENCES "public"."SalesDelivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryLedgerEntry" ADD CONSTRAINT "InventoryLedgerEntry_postingId_fkey" FOREIGN KEY ("postingId") REFERENCES "public"."InventoryPosting"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryLedgerEntry" ADD CONSTRAINT "InventoryLedgerEntry_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "public"."Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryLedgerEntry" ADD CONSTRAINT "InventoryLedgerEntry_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryLedgerEntry" ADD CONSTRAINT "InventoryLedgerEntry_ownerPartyId_fkey" FOREIGN KEY ("ownerPartyId") REFERENCES "public"."Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryLedgerEntry" ADD CONSTRAINT "InventoryLedgerEntry_inventoryLotId_fkey" FOREIGN KEY ("inventoryLotId") REFERENCES "public"."InventoryLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StockBalance" ADD CONSTRAINT "StockBalance_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "public"."Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StockBalance" ADD CONSTRAINT "StockBalance_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StockBalance" ADD CONSTRAINT "StockBalance_ownerPartyId_fkey" FOREIGN KEY ("ownerPartyId") REFERENCES "public"."Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StockBalance" ADD CONSTRAINT "StockBalance_inventoryLotId_fkey" FOREIGN KEY ("inventoryLotId") REFERENCES "public"."InventoryLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryReservation" ADD CONSTRAINT "InventoryReservation_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "public"."LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryReservation" ADD CONSTRAINT "InventoryReservation_customerPartyId_fkey" FOREIGN KEY ("customerPartyId") REFERENCES "public"."Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryReservation" ADD CONSTRAINT "InventoryReservation_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "public"."SalesOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryReservationLine" ADD CONSTRAINT "InventoryReservationLine_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "public"."InventoryReservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryReservationLine" ADD CONSTRAINT "InventoryReservationLine_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "public"."Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryReservationLine" ADD CONSTRAINT "InventoryReservationLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryReservationLine" ADD CONSTRAINT "InventoryReservationLine_ownerPartyId_fkey" FOREIGN KEY ("ownerPartyId") REFERENCES "public"."Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryReservationLine" ADD CONSTRAINT "InventoryReservationLine_inventoryLotId_fkey" FOREIGN KEY ("inventoryLotId") REFERENCES "public"."InventoryLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryReservationEvent" ADD CONSTRAINT "InventoryReservationEvent_reservationLineId_fkey" FOREIGN KEY ("reservationLineId") REFERENCES "public"."InventoryReservationLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryPendingRelease" ADD CONSTRAINT "InventoryPendingRelease_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "public"."Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryPendingRelease" ADD CONSTRAINT "InventoryPendingRelease_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryPendingRelease" ADD CONSTRAINT "InventoryPendingRelease_ownerPartyId_fkey" FOREIGN KEY ("ownerPartyId") REFERENCES "public"."Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryPendingRelease" ADD CONSTRAINT "InventoryPendingRelease_inventoryLotId_fkey" FOREIGN KEY ("inventoryLotId") REFERENCES "public"."InventoryLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryPendingRelease" ADD CONSTRAINT "InventoryPendingRelease_goodsReceiptLineId_fkey" FOREIGN KEY ("goodsReceiptLineId") REFERENCES "public"."GoodsReceiptLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryPendingReleaseEvent" ADD CONSTRAINT "InventoryPendingReleaseEvent_pendingReleaseId_fkey" FOREIGN KEY ("pendingReleaseId") REFERENCES "public"."InventoryPendingRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryBlock" ADD CONSTRAINT "InventoryBlock_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "public"."Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryBlock" ADD CONSTRAINT "InventoryBlock_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryBlock" ADD CONSTRAINT "InventoryBlock_ownerPartyId_fkey" FOREIGN KEY ("ownerPartyId") REFERENCES "public"."Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryBlock" ADD CONSTRAINT "InventoryBlock_inventoryLotId_fkey" FOREIGN KEY ("inventoryLotId") REFERENCES "public"."InventoryLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryBlock" ADD CONSTRAINT "InventoryBlock_reconciliationVarianceId_fkey" FOREIGN KEY ("reconciliationVarianceId") REFERENCES "public"."ReconciliationVariance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryBlockEvent" ADD CONSTRAINT "InventoryBlockEvent_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "public"."InventoryBlock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryAvailabilityBalance" ADD CONSTRAINT "InventoryAvailabilityBalance_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "public"."Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryAvailabilityBalance" ADD CONSTRAINT "InventoryAvailabilityBalance_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryAvailabilityBalance" ADD CONSTRAINT "InventoryAvailabilityBalance_ownerPartyId_fkey" FOREIGN KEY ("ownerPartyId") REFERENCES "public"."Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryMovement" ADD CONSTRAINT "InventoryMovement_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "public"."LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryMovement" ADD CONSTRAINT "InventoryMovement_fromWarehouseId_fkey" FOREIGN KEY ("fromWarehouseId") REFERENCES "public"."Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryMovement" ADD CONSTRAINT "InventoryMovement_toWarehouseId_fkey" FOREIGN KEY ("toWarehouseId") REFERENCES "public"."Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryMovement" ADD CONSTRAINT "InventoryMovement_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "public"."Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryMovement" ADD CONSTRAINT "InventoryMovement_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "public"."Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryMovementLine" ADD CONSTRAINT "InventoryMovementLine_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "public"."InventoryMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryMovementLine" ADD CONSTRAINT "InventoryMovementLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryMovementLine" ADD CONSTRAINT "InventoryMovementLine_ownerPartyId_fkey" FOREIGN KEY ("ownerPartyId") REFERENCES "public"."Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryMovementLine" ADD CONSTRAINT "InventoryMovementLine_inventoryLotId_fkey" FOREIGN KEY ("inventoryLotId") REFERENCES "public"."InventoryLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryDispatch" ADD CONSTRAINT "InventoryDispatch_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "public"."InventoryMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryDispatchLine" ADD CONSTRAINT "InventoryDispatchLine_dispatchId_fkey" FOREIGN KEY ("dispatchId") REFERENCES "public"."InventoryDispatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryDispatchLine" ADD CONSTRAINT "InventoryDispatchLine_movementLineId_fkey" FOREIGN KEY ("movementLineId") REFERENCES "public"."InventoryMovementLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryArrival" ADD CONSTRAINT "InventoryArrival_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "public"."InventoryMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryArrivalLine" ADD CONSTRAINT "InventoryArrivalLine_arrivalId_fkey" FOREIGN KEY ("arrivalId") REFERENCES "public"."InventoryArrival"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryArrivalLine" ADD CONSTRAINT "InventoryArrivalLine_dispatchLineId_fkey" FOREIGN KEY ("dispatchLineId") REFERENCES "public"."InventoryDispatchLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OwnershipTransfer" ADD CONSTRAINT "OwnershipTransfer_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "public"."Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OwnershipTransfer" ADD CONSTRAINT "OwnershipTransfer_fromOwnerPartyId_fkey" FOREIGN KEY ("fromOwnerPartyId") REFERENCES "public"."Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OwnershipTransfer" ADD CONSTRAINT "OwnershipTransfer_toOwnerPartyId_fkey" FOREIGN KEY ("toOwnerPartyId") REFERENCES "public"."Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OwnershipTransferLine" ADD CONSTRAINT "OwnershipTransferLine_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "public"."OwnershipTransfer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OwnershipTransferLine" ADD CONSTRAINT "OwnershipTransferLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OwnershipTransferLine" ADD CONSTRAINT "OwnershipTransferLine_inventoryLotId_fkey" FOREIGN KEY ("inventoryLotId") REFERENCES "public"."InventoryLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StockAdjustment" ADD CONSTRAINT "StockAdjustment_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "public"."Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StockAdjustmentLine" ADD CONSTRAINT "StockAdjustmentLine_adjustmentId_fkey" FOREIGN KEY ("adjustmentId") REFERENCES "public"."StockAdjustment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StockAdjustmentLine" ADD CONSTRAINT "StockAdjustmentLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StockAdjustmentLine" ADD CONSTRAINT "StockAdjustmentLine_ownerPartyId_fkey" FOREIGN KEY ("ownerPartyId") REFERENCES "public"."Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StockAdjustmentLine" ADD CONSTRAINT "StockAdjustmentLine_inventoryLotId_fkey" FOREIGN KEY ("inventoryLotId") REFERENCES "public"."InventoryLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ExpectedSupply" ADD CONSTRAINT "ExpectedSupply_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "public"."Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ExpectedSupply" ADD CONSTRAINT "ExpectedSupply_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ExpectedSupply" ADD CONSTRAINT "ExpectedSupply_ownerPartyId_fkey" FOREIGN KEY ("ownerPartyId") REFERENCES "public"."Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ExpectedSupply" ADD CONSTRAINT "ExpectedSupply_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "public"."PurchaseOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ExpectedSupply" ADD CONSTRAINT "ExpectedSupply_shipmentLineId_fkey" FOREIGN KEY ("shipmentLineId") REFERENCES "public"."PurchaseShipmentLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ExpectedSupply" ADD CONSTRAINT "ExpectedSupply_movementLineId_fkey" FOREIGN KEY ("movementLineId") REFERENCES "public"."InventoryMovementLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ExpectedSupplyAllocation" ADD CONSTRAINT "ExpectedSupplyAllocation_expectedSupplyId_fkey" FOREIGN KEY ("expectedSupplyId") REFERENCES "public"."ExpectedSupply"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ExpectedSupplyAllocation" ADD CONSTRAINT "ExpectedSupplyAllocation_receiptLineId_fkey" FOREIGN KEY ("receiptLineId") REFERENCES "public"."GoodsReceiptLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReconciliationTemplate" ADD CONSTRAINT "ReconciliationTemplate_supplierPartyId_fkey" FOREIGN KEY ("supplierPartyId") REFERENCES "public"."Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WarehouseReconciliation" ADD CONSTRAINT "WarehouseReconciliation_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "public"."Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WarehouseReconciliation" ADD CONSTRAINT "WarehouseReconciliation_reconciliationPartyId_fkey" FOREIGN KEY ("reconciliationPartyId") REFERENCES "public"."Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReconciliationFile" ADD CONSTRAINT "ReconciliationFile_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "public"."WarehouseReconciliation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReconciliationFile" ADD CONSTRAINT "ReconciliationFile_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "public"."ReconciliationTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReconciliationFile" ADD CONSTRAINT "ReconciliationFile_replacedFileId_fkey" FOREIGN KEY ("replacedFileId") REFERENCES "public"."ReconciliationFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReconciliationRawRow" ADD CONSTRAINT "ReconciliationRawRow_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "public"."ReconciliationFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReconciliationNormalizedLine" ADD CONSTRAINT "ReconciliationNormalizedLine_rawRowId_fkey" FOREIGN KEY ("rawRowId") REFERENCES "public"."ReconciliationRawRow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReconciliationNormalizedLine" ADD CONSTRAINT "ReconciliationNormalizedLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReconciliationNormalizedLine" ADD CONSTRAINT "ReconciliationNormalizedLine_ownerPartyId_fkey" FOREIGN KEY ("ownerPartyId") REFERENCES "public"."Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReconciliationSnapshotLine" ADD CONSTRAINT "ReconciliationSnapshotLine_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "public"."WarehouseReconciliation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReconciliationSnapshotLine" ADD CONSTRAINT "ReconciliationSnapshotLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReconciliationSnapshotLine" ADD CONSTRAINT "ReconciliationSnapshotLine_ownerPartyId_fkey" FOREIGN KEY ("ownerPartyId") REFERENCES "public"."Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReconciliationVariance" ADD CONSTRAINT "ReconciliationVariance_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "public"."WarehouseReconciliation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReconciliationVariance" ADD CONSTRAINT "ReconciliationVariance_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReconciliationVariance" ADD CONSTRAINT "ReconciliationVariance_ownerPartyId_fkey" FOREIGN KEY ("ownerPartyId") REFERENCES "public"."Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReconciliationResolution" ADD CONSTRAINT "ReconciliationResolution_varianceId_fkey" FOREIGN KEY ("varianceId") REFERENCES "public"."ReconciliationVariance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReconciliationResolution" ADD CONSTRAINT "ReconciliationResolution_stockAdjustmentId_fkey" FOREIGN KEY ("stockAdjustmentId") REFERENCES "public"."StockAdjustment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReconciliationResolution" ADD CONSTRAINT "ReconciliationResolution_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "public"."InventoryMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LandedCostDocument" ADD CONSTRAINT "LandedCostDocument_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "public"."LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LandedCostDocument" ADD CONSTRAINT "LandedCostDocument_vendorPartyId_fkey" FOREIGN KEY ("vendorPartyId") REFERENCES "public"."Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LandedCostDocument" ADD CONSTRAINT "LandedCostDocument_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "public"."PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LandedCostDocument" ADD CONSTRAINT "LandedCostDocument_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "public"."PurchaseShipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LandedCostLine" ADD CONSTRAINT "LandedCostLine_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "public"."LandedCostDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LandedCostAllocation" ADD CONSTRAINT "LandedCostAllocation_landedCostLineId_fkey" FOREIGN KEY ("landedCostLineId") REFERENCES "public"."LandedCostLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LandedCostAllocation" ADD CONSTRAINT "LandedCostAllocation_inventoryLotId_fkey" FOREIGN KEY ("inventoryLotId") REFERENCES "public"."InventoryLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LandedCostAllocation" ADD CONSTRAINT "LandedCostAllocation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryCostLayer" ADD CONSTRAINT "InventoryCostLayer_inventoryLotId_fkey" FOREIGN KEY ("inventoryLotId") REFERENCES "public"."InventoryLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InventoryCostLayer" ADD CONSTRAINT "InventoryCostLayer_ownerPartyId_fkey" FOREIGN KEY ("ownerPartyId") REFERENCES "public"."Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CostLayerEntry" ADD CONSTRAINT "CostLayerEntry_costLayerId_fkey" FOREIGN KEY ("costLayerId") REFERENCES "public"."InventoryCostLayer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CostLayerEntry" ADD CONSTRAINT "CostLayerEntry_pricingStageLineId_fkey" FOREIGN KEY ("pricingStageLineId") REFERENCES "public"."PurchasePricingStageLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CostLayerEntry" ADD CONSTRAINT "CostLayerEntry_landedCostAllocationId_fkey" FOREIGN KEY ("landedCostAllocationId") REFERENCES "public"."LandedCostAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CostLayerEntry" ADD CONSTRAINT "CostLayerEntry_salesDeliveryLineId_fkey" FOREIGN KEY ("salesDeliveryLineId") REFERENCES "public"."SalesDeliveryLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CostLayerEntry" ADD CONSTRAINT "CostLayerEntry_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "public"."CostLayerEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "public"."LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_supplierCustomerId_fkey" FOREIGN KEY ("supplierCustomerId") REFERENCES "public"."Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "public"."PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SupplierInvoiceLine" ADD CONSTRAINT "SupplierInvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "public"."SupplierInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SupplierInvoiceLine" ADD CONSTRAINT "SupplierInvoiceLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SupplierInvoiceLine" ADD CONSTRAINT "SupplierInvoiceLine_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "public"."PurchaseOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SupplierInvoiceLine" ADD CONSTRAINT "SupplierInvoiceLine_receiptLineId_fkey" FOREIGN KEY ("receiptLineId") REFERENCES "public"."GoodsReceiptLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SupplierInvoiceLine" ADD CONSTRAINT "SupplierInvoiceLine_landedCostLineId_fkey" FOREIGN KEY ("landedCostLineId") REFERENCES "public"."LandedCostLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PayableOpenItem" ADD CONSTRAINT "PayableOpenItem_supplierInvoiceId_fkey" FOREIGN KEY ("supplierInvoiceId") REFERENCES "public"."SupplierInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PayableOpenItem" ADD CONSTRAINT "PayableOpenItem_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "public"."LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PayableOpenItem" ADD CONSTRAINT "PayableOpenItem_supplierPartyId_fkey" FOREIGN KEY ("supplierPartyId") REFERENCES "public"."Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PayableLedgerEntry" ADD CONSTRAINT "PayableLedgerEntry_openItemId_fkey" FOREIGN KEY ("openItemId") REFERENCES "public"."PayableOpenItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PayableLedgerEntry" ADD CONSTRAINT "PayableLedgerEntry_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "public"."PayableAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PayableLedgerEntry" ADD CONSTRAINT "PayableLedgerEntry_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "public"."PayableLedgerEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PayableAllocation" ADD CONSTRAINT "PayableAllocation_bankTransactionId_fkey" FOREIGN KEY ("bankTransactionId") REFERENCES "public"."BankTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PayableAllocation" ADD CONSTRAINT "PayableAllocation_openItemId_fkey" FOREIGN KEY ("openItemId") REFERENCES "public"."PayableOpenItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PayableAllocation" ADD CONSTRAINT "PayableAllocation_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "public"."PayableAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain invariants not expressible in Prisma schema.
ALTER TABLE "public"."PartyRole"
    ADD CONSTRAINT "PartyRole_valid_period_check" CHECK ("validTo" IS NULL OR "validTo" >= "validFrom");
ALTER TABLE "public"."WarehousePartyAssignment"
    ADD CONSTRAINT "WarehousePartyAssignment_valid_period_check" CHECK ("validTo" IS NULL OR "validTo" >= "validFrom");
ALTER TABLE "public"."ProductAlias"
    ADD CONSTRAINT "ProductAlias_valid_period_check" CHECK ("validTo" IS NULL OR "validTo" >= "validFrom");

ALTER TABLE "public"."PurchaseOrder"
    ADD CONSTRAINT "PurchaseOrder_payment_term_check" CHECK (
        ("paymentTermType" = 'SAME_DAY' AND "paymentTermDays" IS NULL)
        OR ("paymentTermType" = 'NET_DAYS' AND "paymentTermDays" > 0)
    );
ALTER TABLE "public"."PurchaseOrderLine"
    ADD CONSTRAINT "PurchaseOrderLine_quantity_amount_check" CHECK (
        "orderedQty" > 0
        AND ("unitPrice" IS NULL OR "unitPrice" >= 0)
        AND ("taxRate" IS NULL OR ("taxRate" >= 0 AND "taxRate" <= 100))
        AND "discountAmount" >= 0
    );
ALTER TABLE "public"."PurchaseShipmentLine"
    ADD CONSTRAINT "PurchaseShipmentLine_quantity_check" CHECK (
        "plannedActualQty" > 0 AND ("plannedV15Qty" IS NULL OR "plannedV15Qty" > 0)
    );
ALTER TABLE "public"."SalesOrderLine"
    ADD CONSTRAINT "SalesOrderLine_quantity_amount_check" CHECK (
        "orderedActualQty" > 0
        AND ("orderedV15Qty" IS NULL OR "orderedV15Qty" > 0)
        AND "unitPrice" >= 0
        AND ("taxRate" IS NULL OR ("taxRate" >= 0 AND "taxRate" <= 1))
    );
ALTER TABLE "public"."SalesDeliveryLine"
    ADD CONSTRAINT "SalesDeliveryLine_quantity_check" CHECK (
        "actualQty" > 0 AND ("v15Qty" IS NULL OR "v15Qty" > 0)
    );

ALTER TABLE "public"."GoodsReceiptLine"
    ADD CONSTRAINT "GoodsReceiptLine_quantity_check" CHECK (
        "actualQty" > 0
        AND ("v15Qty" IS NULL OR "v15Qty" >= 0)
        AND ("density" IS NULL OR "density" > 0)
        AND ("billQty" IS NULL OR "billQty" >= 0)
        AND ("tankQty" IS NULL OR "tankQty" >= 0)
        AND ("temporaryWithdrawQty" IS NULL OR "temporaryWithdrawQty" >= 0)
    );
ALTER TABLE "public"."InventoryLot"
    ADD CONSTRAINT "InventoryLot_quantity_check" CHECK (
        "receivedActualQty" > 0 AND ("receivedV15Qty" IS NULL OR "receivedV15Qty" >= 0)
    );

ALTER TABLE "public"."InventoryPosting"
    ADD CONSTRAINT "InventoryPosting_source_kind_check" CHECK (
        num_nonnulls(
            "reversalOfId", "goodsReceiptId", "movementDispatchId", "movementArrivalId",
            "ownershipTransferId", "stockAdjustmentId", "salesDeliveryId"
        ) = 1
        AND CASE "kind"
            WHEN 'RECEIPT' THEN "goodsReceiptId" IS NOT NULL
            WHEN 'MOVEMENT_DISPATCH' THEN "movementDispatchId" IS NOT NULL
            WHEN 'MOVEMENT_ARRIVAL' THEN "movementArrivalId" IS NOT NULL
            WHEN 'OWNERSHIP_TRANSFER' THEN "ownershipTransferId" IS NOT NULL
            WHEN 'ADJUSTMENT' THEN "stockAdjustmentId" IS NOT NULL
            WHEN 'SALES_ISSUE' THEN "salesDeliveryId" IS NOT NULL
            WHEN 'REVERSAL' THEN "reversalOfId" IS NOT NULL
            ELSE false
        END
    );
ALTER TABLE "public"."InventoryLedgerEntry"
    ADD CONSTRAINT "InventoryLedgerEntry_nonzero_check" CHECK (
        "actualQtyDelta" <> 0 OR COALESCE("v15QtyDelta", 0) <> 0
    );
ALTER TABLE "public"."StockBalance"
    ADD CONSTRAINT "StockBalance_nonnegative_check" CHECK (
        "actualQty" >= 0 AND ("v15Qty" IS NULL OR "v15Qty" >= 0)
    );

ALTER TABLE "public"."InventoryReservation"
    ADD CONSTRAINT "InventoryReservation_source_check" CHECK (
        num_nonnulls("salesOrderId", NULLIF(btrim("manualReference"), '')) = 1
    );
ALTER TABLE "public"."InventoryReservationLine"
    ADD CONSTRAINT "InventoryReservationLine_quantity_check" CHECK (
        "requestedActualQty" > 0
        AND "activeActualQty" >= 0
        AND "releasedActualQty" >= 0
        AND "consumedActualQty" >= 0
        AND "activeActualQty" + "releasedActualQty" + "consumedActualQty" <= "requestedActualQty"
        AND (
            ("requestedV15Qty" IS NULL
                AND COALESCE("activeV15Qty", 0) = 0
                AND COALESCE("releasedV15Qty", 0) = 0
                AND COALESCE("consumedV15Qty", 0) = 0)
            OR ("requestedV15Qty" > 0
                AND COALESCE("activeV15Qty", 0) >= 0
                AND COALESCE("releasedV15Qty", 0) >= 0
                AND COALESCE("consumedV15Qty", 0) >= 0
                AND COALESCE("activeV15Qty", 0) + COALESCE("releasedV15Qty", 0) + COALESCE("consumedV15Qty", 0) <= "requestedV15Qty")
        )
    );
ALTER TABLE "public"."InventoryReservationEvent"
    ADD CONSTRAINT "InventoryReservationEvent_quantity_check" CHECK (
        "actualQty" > 0 AND ("v15Qty" IS NULL OR "v15Qty" > 0)
    );

ALTER TABLE "public"."InventoryPendingRelease"
    ADD CONSTRAINT "InventoryPendingRelease_quantity_check" CHECK (
        "originalActualQty" > 0
        AND "activeActualQty" >= 0
        AND "activeActualQty" <= "originalActualQty"
        AND (("originalV15Qty" IS NULL AND "activeV15Qty" IS NULL)
            OR ("originalV15Qty" >= 0 AND COALESCE("activeV15Qty", 0) >= 0 AND COALESCE("activeV15Qty", 0) <= "originalV15Qty"))
    );
ALTER TABLE "public"."InventoryBlock"
    ADD CONSTRAINT "InventoryBlock_quantity_check" CHECK (
        "originalActualQty" > 0
        AND "activeActualQty" >= 0
        AND "activeActualQty" <= "originalActualQty"
        AND (("originalV15Qty" IS NULL AND "activeV15Qty" IS NULL)
            OR ("originalV15Qty" >= 0 AND COALESCE("activeV15Qty", 0) >= 0 AND COALESCE("activeV15Qty", 0) <= "originalV15Qty"))
    );
ALTER TABLE "public"."InventoryPendingReleaseEvent"
    ADD CONSTRAINT "InventoryPendingReleaseEvent_quantity_check" CHECK (
        "actualQty" > 0 AND ("v15Qty" IS NULL OR "v15Qty" > 0)
    );
ALTER TABLE "public"."InventoryBlockEvent"
    ADD CONSTRAINT "InventoryBlockEvent_quantity_check" CHECK (
        "actualQty" > 0 AND ("v15Qty" IS NULL OR "v15Qty" > 0)
    );
ALTER TABLE "public"."InventoryAvailabilityBalance"
    ADD CONSTRAINT "InventoryAvailabilityBalance_nonnegative_check" CHECK (
        "onHandActualQty" >= 0
        AND "reservedActualQty" >= 0
        AND "pendingActualQty" >= 0
        AND "blockedActualQty" >= 0
        AND "reservedActualQty" + "pendingActualQty" + "blockedActualQty" <= "onHandActualQty"
        AND (
            ("onHandV15Qty" IS NULL AND "reservedV15Qty" IS NULL AND "pendingV15Qty" IS NULL AND "blockedV15Qty" IS NULL)
            OR (COALESCE("onHandV15Qty", 0) >= 0
                AND COALESCE("reservedV15Qty", 0) >= 0
                AND COALESCE("pendingV15Qty", 0) >= 0
                AND COALESCE("blockedV15Qty", 0) >= 0
                AND COALESCE("reservedV15Qty", 0) + COALESCE("pendingV15Qty", 0) + COALESCE("blockedV15Qty", 0) <= COALESCE("onHandV15Qty", 0))
        )
    );

ALTER TABLE "public"."InventoryMovementLine"
    ADD CONSTRAINT "InventoryMovementLine_quantity_check" CHECK (
        "plannedActualQty" > 0 AND ("plannedV15Qty" IS NULL OR "plannedV15Qty" > 0)
    );
ALTER TABLE "public"."InventoryDispatchLine"
    ADD CONSTRAINT "InventoryDispatchLine_quantity_check" CHECK (
        "actualQty" > 0 AND ("v15Qty" IS NULL OR "v15Qty" > 0)
    );
ALTER TABLE "public"."InventoryArrivalLine"
    ADD CONSTRAINT "InventoryArrivalLine_quantity_check" CHECK (
        "actualQty" > 0 AND ("v15Qty" IS NULL OR "v15Qty" > 0)
    );
ALTER TABLE "public"."OwnershipTransferLine"
    ADD CONSTRAINT "OwnershipTransferLine_quantity_check" CHECK (
        "actualQty" > 0 AND ("v15Qty" IS NULL OR "v15Qty" > 0)
    );
ALTER TABLE "public"."StockAdjustmentLine"
    ADD CONSTRAINT "StockAdjustmentLine_nonzero_check" CHECK (
        "actualQtyDelta" <> 0 OR COALESCE("v15QtyDelta", 0) <> 0
    );

ALTER TABLE "public"."ExpectedSupply"
    ADD CONSTRAINT "ExpectedSupply_source_quantity_check" CHECK (
        num_nonnulls("purchaseOrderLineId", "shipmentLineId", "movementLineId", NULLIF(btrim("manualReference"), '')) = 1
        AND "expectedActualQty" > 0
        AND "fulfilledActualQty" >= 0
        AND "fulfilledActualQty" <= "expectedActualQty"
        AND (("expectedV15Qty" IS NULL AND COALESCE("fulfilledV15Qty", 0) = 0)
            OR ("expectedV15Qty" > 0 AND COALESCE("fulfilledV15Qty", 0) >= 0 AND COALESCE("fulfilledV15Qty", 0) <= "expectedV15Qty"))
    );
ALTER TABLE "public"."ExpectedSupplyAllocation"
    ADD CONSTRAINT "ExpectedSupplyAllocation_quantity_check" CHECK (
        "actualQty" > 0 AND ("v15Qty" IS NULL OR "v15Qty" > 0)
    );

ALTER TABLE "public"."InventoryCostLayer"
    ADD CONSTRAINT "InventoryCostLayer_balance_check" CHECK (
        "originalActualQty" > 0
        AND "remainingActualQty" >= 0
        AND "remainingActualQty" <= "originalActualQty"
        AND "remainingValue" >= 0
    );
ALTER TABLE "public"."CostLayerEntry"
    ADD CONSTRAINT "CostLayerEntry_source_quantity_check" CHECK (
        ("actualQtyDelta" <> 0 OR "valueDelta" <> 0)
        AND num_nonnulls("pricingStageLineId", "landedCostAllocationId", "salesDeliveryLineId", "reversalOfId") <= 1
        AND ("type" <> 'SALES_ISSUE'
            OR ("salesDeliveryLineId" IS NOT NULL AND "actualQtyDelta" < 0 AND "valueDelta" <= 0))
        AND ("type" <> 'REVERSAL' OR "reversalOfId" IS NOT NULL)
    );

ALTER TABLE "public"."SupplierInvoice"
    ADD CONSTRAINT "SupplierInvoice_total_check" CHECK ("totalAmount" >= 0);
ALTER TABLE "public"."SupplierInvoiceLine"
    ADD CONSTRAINT "SupplierInvoiceLine_amount_check" CHECK (
        ("actualQty" IS NULL OR "actualQty" > 0)
        AND "unitPrice" >= 0
        AND "netAmount" >= 0
        AND "taxRate" >= 0 AND "taxRate" <= 1
        AND "taxAmount" >= 0
    );
ALTER TABLE "public"."PayableOpenItem"
    ADD CONSTRAINT "PayableOpenItem_balance_check" CHECK (
        "originalAmount" >= 0 AND "outstandingAmount" >= 0 AND "outstandingAmount" <= "originalAmount"
    );
ALTER TABLE "public"."PayableLedgerEntry"
    ADD CONSTRAINT "PayableLedgerEntry_nonzero_check" CHECK ("amountDelta" <> 0);
ALTER TABLE "public"."PayableAllocation"
    ADD CONSTRAINT "PayableAllocation_amount_check" CHECK (
        "amountInBankCurrency" > 0
        AND "amountInItemCurrency" > 0
        AND ("fxRate" IS NULL OR "fxRate" > 0)
    );

-- Keep append-only ledgers and domain events immutable after insertion.
CREATE OR REPLACE FUNCTION public.reject_immutable_change()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "InventoryLedgerEntry_immutable"
    BEFORE UPDATE OR DELETE ON "public"."InventoryLedgerEntry"
    FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();
CREATE TRIGGER "InventoryReservationEvent_immutable"
    BEFORE UPDATE OR DELETE ON "public"."InventoryReservationEvent"
    FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();
CREATE TRIGGER "InventoryPendingReleaseEvent_immutable"
    BEFORE UPDATE OR DELETE ON "public"."InventoryPendingReleaseEvent"
    FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();
CREATE TRIGGER "InventoryBlockEvent_immutable"
    BEFORE UPDATE OR DELETE ON "public"."InventoryBlockEvent"
    FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();
CREATE TRIGGER "ExpectedSupplyAllocation_immutable"
    BEFORE UPDATE OR DELETE ON "public"."ExpectedSupplyAllocation"
    FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();
CREATE TRIGGER "CostLayerEntry_immutable"
    BEFORE UPDATE OR DELETE ON "public"."CostLayerEntry"
    FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();
CREATE TRIGGER "PayableLedgerEntry_immutable"
    BEFORE UPDATE OR DELETE ON "public"."PayableLedgerEntry"
    FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

-- Enforce aggregate boundaries that span more than one foreign key.
CREATE OR REPLACE FUNCTION public.validate_purchase_order_line_scope()
RETURNS trigger AS $$
DECLARE
    order_entity uuid;
    warehouse_entity uuid;
BEGIN
    IF NEW."receivingWarehouseId" IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT "legalEntityId" INTO order_entity FROM "public"."PurchaseOrder" WHERE "id" = NEW."purchaseOrderId";
    SELECT "legalEntityId" INTO warehouse_entity FROM "public"."Warehouse" WHERE "id" = NEW."receivingWarehouseId";
    IF order_entity IS NULL OR warehouse_entity IS NULL OR order_entity <> warehouse_entity THEN
        RAISE EXCEPTION 'Purchase order line warehouse must belong to the purchase legal entity' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PurchaseOrderLine_scope"
    BEFORE INSERT OR UPDATE ON "public"."PurchaseOrderLine"
    FOR EACH ROW EXECUTE FUNCTION public.validate_purchase_order_line_scope();

CREATE OR REPLACE FUNCTION public.validate_purchase_shipment_line_scope()
RETURNS trigger AS $$
DECLARE
    shipment_order uuid;
    line_order uuid;
BEGIN
    SELECT "purchaseOrderId" INTO shipment_order FROM "public"."PurchaseShipment" WHERE "id" = NEW."shipmentId";
    SELECT "purchaseOrderId" INTO line_order FROM "public"."PurchaseOrderLine" WHERE "id" = NEW."purchaseOrderLineId";
    IF shipment_order IS NULL OR line_order IS NULL OR shipment_order <> line_order THEN
        RAISE EXCEPTION 'Shipment line must reference a line of the same purchase order' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PurchaseShipmentLine_scope"
    BEFORE INSERT OR UPDATE ON "public"."PurchaseShipmentLine"
    FOR EACH ROW EXECUTE FUNCTION public.validate_purchase_shipment_line_scope();

CREATE OR REPLACE FUNCTION public.validate_goods_receipt_scope()
RETURNS trigger AS $$
DECLARE
    order_supplier uuid;
    order_entity uuid;
    warehouse_entity uuid;
BEGIN
    IF NEW."purchaseOrderId" IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT "supplierCustomerId", "legalEntityId" INTO order_supplier, order_entity
    FROM "public"."PurchaseOrder" WHERE "id" = NEW."purchaseOrderId";
    SELECT "legalEntityId" INTO warehouse_entity FROM "public"."Warehouse" WHERE "id" = NEW."warehouseId";
    IF order_supplier IS NULL OR order_entity IS NULL OR warehouse_entity IS NULL
        OR order_supplier <> NEW."supplierCustomerId" OR order_entity <> warehouse_entity THEN
        RAISE EXCEPTION 'Goods receipt supplier and warehouse must match its purchase order' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "GoodsReceipt_scope"
    BEFORE INSERT OR UPDATE ON "public"."GoodsReceipt"
    FOR EACH ROW EXECUTE FUNCTION public.validate_goods_receipt_scope();

CREATE OR REPLACE FUNCTION public.validate_goods_receipt_line_scope()
RETURNS trigger AS $$
DECLARE
    receipt_order uuid;
    line_order uuid;
    line_product uuid;
BEGIN
    IF NEW."purchaseOrderLineId" IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT "purchaseOrderId" INTO receipt_order FROM "public"."GoodsReceipt" WHERE "id" = NEW."goodsReceiptId";
    SELECT "purchaseOrderId", "productId" INTO line_order, line_product
    FROM "public"."PurchaseOrderLine" WHERE "id" = NEW."purchaseOrderLineId";
    IF receipt_order IS NULL OR line_order IS NULL OR receipt_order <> line_order OR NEW."productId" <> line_product THEN
        RAISE EXCEPTION 'Goods receipt line must match the receipt purchase order and product' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "GoodsReceiptLine_scope"
    BEFORE INSERT OR UPDATE ON "public"."GoodsReceiptLine"
    FOR EACH ROW EXECUTE FUNCTION public.validate_goods_receipt_line_scope();

CREATE OR REPLACE FUNCTION public.validate_sales_delivery_scope()
RETURNS trigger AS $$
DECLARE
    order_entity uuid;
    warehouse_entity uuid;
BEGIN
    SELECT "legalEntityId" INTO order_entity FROM "public"."SalesOrder" WHERE "id" = NEW."salesOrderId";
    SELECT "legalEntityId" INTO warehouse_entity FROM "public"."Warehouse" WHERE "id" = NEW."warehouseId";
    IF order_entity IS NULL OR warehouse_entity IS NULL OR order_entity <> warehouse_entity THEN
        RAISE EXCEPTION 'Sales delivery warehouse must belong to the sales legal entity' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SalesDelivery_scope"
    BEFORE INSERT OR UPDATE ON "public"."SalesDelivery"
    FOR EACH ROW EXECUTE FUNCTION public.validate_sales_delivery_scope();

CREATE OR REPLACE FUNCTION public.validate_sales_delivery_line_scope()
RETURNS trigger AS $$
DECLARE
    delivery_order uuid;
    line_order uuid;
BEGIN
    SELECT "salesOrderId" INTO delivery_order FROM "public"."SalesDelivery" WHERE "id" = NEW."salesDeliveryId";
    SELECT "salesOrderId" INTO line_order FROM "public"."SalesOrderLine" WHERE "id" = NEW."salesOrderLineId";
    IF delivery_order IS NULL OR line_order IS NULL OR delivery_order <> line_order THEN
        RAISE EXCEPTION 'Sales delivery line must reference a line of the same sales order' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SalesDeliveryLine_scope"
    BEFORE INSERT OR UPDATE ON "public"."SalesDeliveryLine"
    FOR EACH ROW EXECUTE FUNCTION public.validate_sales_delivery_line_scope();

CREATE OR REPLACE FUNCTION public.validate_inventory_reservation_scope()
RETURNS trigger AS $$
DECLARE
    order_entity uuid;
    order_customer uuid;
BEGIN
    IF NEW."salesOrderId" IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT "legalEntityId", "customerPartyId" INTO order_entity, order_customer
    FROM "public"."SalesOrder" WHERE "id" = NEW."salesOrderId";
    IF order_entity IS NULL OR order_entity <> NEW."legalEntityId"
        OR NEW."customerPartyId" IS DISTINCT FROM order_customer THEN
        RAISE EXCEPTION 'Inventory reservation must match its sales order legal entity and customer' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "InventoryReservation_scope"
    BEFORE INSERT OR UPDATE ON "public"."InventoryReservation"
    FOR EACH ROW EXECUTE FUNCTION public.validate_inventory_reservation_scope();

CREATE OR REPLACE FUNCTION public.validate_inventory_lot_product()
RETURNS trigger AS $$
DECLARE
    lot_product uuid;
BEGIN
    IF NEW."inventoryLotId" IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT "productId" INTO lot_product FROM "public"."InventoryLot" WHERE "id" = NEW."inventoryLotId";
    IF lot_product IS NULL OR lot_product <> NEW."productId" THEN
        RAISE EXCEPTION 'Inventory lot must belong to the referenced product' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "InventoryLedgerEntry_lot_product"
    BEFORE INSERT OR UPDATE ON "public"."InventoryLedgerEntry"
    FOR EACH ROW EXECUTE FUNCTION public.validate_inventory_lot_product();
CREATE TRIGGER "StockBalance_lot_product"
    BEFORE INSERT OR UPDATE ON "public"."StockBalance"
    FOR EACH ROW EXECUTE FUNCTION public.validate_inventory_lot_product();
CREATE TRIGGER "InventoryReservationLine_lot_product"
    BEFORE INSERT OR UPDATE ON "public"."InventoryReservationLine"
    FOR EACH ROW EXECUTE FUNCTION public.validate_inventory_lot_product();
CREATE TRIGGER "InventoryPendingRelease_lot_product"
    BEFORE INSERT OR UPDATE ON "public"."InventoryPendingRelease"
    FOR EACH ROW EXECUTE FUNCTION public.validate_inventory_lot_product();
CREATE TRIGGER "InventoryBlock_lot_product"
    BEFORE INSERT OR UPDATE ON "public"."InventoryBlock"
    FOR EACH ROW EXECUTE FUNCTION public.validate_inventory_lot_product();
CREATE TRIGGER "InventoryMovementLine_lot_product"
    BEFORE INSERT OR UPDATE ON "public"."InventoryMovementLine"
    FOR EACH ROW EXECUTE FUNCTION public.validate_inventory_lot_product();
CREATE TRIGGER "OwnershipTransferLine_lot_product"
    BEFORE INSERT OR UPDATE ON "public"."OwnershipTransferLine"
    FOR EACH ROW EXECUTE FUNCTION public.validate_inventory_lot_product();
CREATE TRIGGER "StockAdjustmentLine_lot_product"
    BEFORE INSERT OR UPDATE ON "public"."StockAdjustmentLine"
    FOR EACH ROW EXECUTE FUNCTION public.validate_inventory_lot_product();

