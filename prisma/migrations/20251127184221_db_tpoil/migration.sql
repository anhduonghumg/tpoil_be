/*
  Warnings:

  - The `requestId` column on the `AuditLog` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `userId` column on the `AuditLog` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `entityId` column on the `AuditLog` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `scopeId` column on the `AuditLog` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
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
CREATE TYPE "public"."RiskLevel" AS ENUM ('Low', 'Medium', 'High');

-- CreateEnum
CREATE TYPE "public"."AttachmentCategory" AS ENUM ('ScanSigned', 'Draft', 'Appendix', 'Other');

-- CreateEnum
CREATE TYPE "public"."RiskSource" AS ENUM ('Manual', 'AutoRule', 'Overdue');

-- CreateEnum
CREATE TYPE "public"."CronJobType" AS ENUM ('CONTRACT_EXPIRY_DAILY');

-- CreateEnum
CREATE TYPE "public"."CronJobStatus" AS ENUM ('SUCCESS', 'FAILED');

-- AlterTable
ALTER TABLE "public"."AuditLog" DROP COLUMN "requestId",
ADD COLUMN     "requestId" UUID,
DROP COLUMN "userId",
ADD COLUMN     "userId" UUID,
DROP COLUMN "entityId",
ADD COLUMN     "entityId" UUID,
DROP COLUMN "scopeId",
ADD COLUMN     "scopeId" UUID;

-- AlterTable
ALTER TABLE "public"."Employee" ADD COLUMN     "workEmail" TEXT;

-- CreateTable
CREATE TABLE "public"."CronJob" (
    "id" TEXT NOT NULL,
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
    "id" TEXT NOT NULL,
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
CREATE TABLE "public"."Customer" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "taxCode" TEXT,
    "taxVerified" BOOLEAN NOT NULL DEFAULT false,
    "taxSource" "public"."TaxSource",
    "taxSyncedAt" TIMESTAMP(3),
    "roles" "public"."CustomerRole"[],
    "type" "public"."CustomerType" NOT NULL,
    "billingAddress" TEXT,
    "shippingAddress" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "creditLimit" DECIMAL(65,30),
    "tempLimit" DECIMAL(65,30),
    "tempFrom" TIMESTAMP(3),
    "tempTo" TIMESTAMP(3),
    "paymentTermDays" INTEGER,
    "status" "public"."CustomerStatus" NOT NULL DEFAULT 'Active',
    "note" TEXT,
    "salesOwnerEmpId" UUID,
    "accountingOwnerEmpId" UUID,
    "legalOwnerEmpId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ContactPerson" (
    "id" TEXT NOT NULL,
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
    "id" TEXT NOT NULL,
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
    "renewalOfId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ContractType" (
    "id" TEXT NOT NULL,
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
    "id" TEXT NOT NULL,
    "contractId" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT,
    "externalUrl" TEXT,
    "category" "public"."AttachmentCategory" NOT NULL,

    CONSTRAINT "ContractAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ContractItem" (
    "id" TEXT NOT NULL,
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
    "id" TEXT NOT NULL,
    "contractId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "changeSummary" TEXT,
    "docUrl" TEXT,

    CONSTRAINT "ContractAppendix_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CreditLimitHistory" (
    "id" TEXT NOT NULL,
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
    "id" TEXT NOT NULL,
    "customerId" UUID NOT NULL,
    "level" "public"."RiskLevel" NOT NULL,
    "source" "public"."RiskSource" NOT NULL,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "RiskFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CronJob_type_key" ON "public"."CronJob"("type");

-- CreateIndex
CREATE INDEX "CronJobRun_jobId_runDate_idx" ON "public"."CronJobRun"("jobId", "runDate");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_code_key" ON "public"."Customer"("code");

-- CreateIndex
CREATE INDEX "Customer_name_idx" ON "public"."Customer"("name");

-- CreateIndex
CREATE INDEX "Customer_taxCode_idx" ON "public"."Customer"("taxCode");

-- CreateIndex
CREATE INDEX "Customer_salesOwnerEmpId_idx" ON "public"."Customer"("salesOwnerEmpId");

-- CreateIndex
CREATE INDEX "Customer_accountingOwnerEmpId_idx" ON "public"."Customer"("accountingOwnerEmpId");

-- CreateIndex
CREATE INDEX "Customer_legalOwnerEmpId_idx" ON "public"."Customer"("legalOwnerEmpId");

-- CreateIndex
CREATE UNIQUE INDEX "Contract_code_key" ON "public"."Contract"("code");

-- CreateIndex
CREATE INDEX "Contract_customerId_idx" ON "public"."Contract"("customerId");

-- CreateIndex
CREATE INDEX "Contract_status_idx" ON "public"."Contract"("status");

-- CreateIndex
CREATE INDEX "Contract_startDate_endDate_idx" ON "public"."Contract"("startDate", "endDate");

-- CreateIndex
CREATE INDEX "Contract_renewalOfId_idx" ON "public"."Contract"("renewalOfId");

-- CreateIndex
CREATE UNIQUE INDEX "ContractType_code_key" ON "public"."ContractType"("code");

-- CreateIndex
CREATE INDEX "AuditLog_userId_at_idx" ON "public"."AuditLog"("userId", "at");

-- CreateIndex
CREATE INDEX "AuditLog_entityId_idx" ON "public"."AuditLog"("entityId");

-- AddForeignKey
ALTER TABLE "public"."CronJobRun" ADD CONSTRAINT "CronJobRun_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "public"."CronJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Customer" ADD CONSTRAINT "Customer_salesOwnerEmpId_fkey" FOREIGN KEY ("salesOwnerEmpId") REFERENCES "public"."Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Customer" ADD CONSTRAINT "Customer_accountingOwnerEmpId_fkey" FOREIGN KEY ("accountingOwnerEmpId") REFERENCES "public"."Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Customer" ADD CONSTRAINT "Customer_legalOwnerEmpId_fkey" FOREIGN KEY ("legalOwnerEmpId") REFERENCES "public"."Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ContactPerson" ADD CONSTRAINT "ContactPerson_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Contract" ADD CONSTRAINT "Contract_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Contract" ADD CONSTRAINT "Contract_contractTypeId_fkey" FOREIGN KEY ("contractTypeId") REFERENCES "public"."ContractType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Contract" ADD CONSTRAINT "Contract_renewalOfId_fkey" FOREIGN KEY ("renewalOfId") REFERENCES "public"."Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ContractAttachment" ADD CONSTRAINT "ContractAttachment_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "public"."Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ContractItem" ADD CONSTRAINT "ContractItem_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "public"."Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ContractAppendix" ADD CONSTRAINT "ContractAppendix_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "public"."Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CreditLimitHistory" ADD CONSTRAINT "CreditLimitHistory_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RiskFlag" ADD CONSTRAINT "RiskFlag_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
