-- Cấu hình nhà cung cấp hóa đơn điện tử: đúng một dòng cho cả hệ thống.
CREATE TABLE "InvoiceProviderConfig" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "singleton" BOOLEAN NOT NULL DEFAULT true,
    "provider" TEXT NOT NULL DEFAULT 'MISA',
    "baseUrl" TEXT NOT NULL,
    "taxCode" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "templateNo" TEXT NOT NULL,
    "serial" TEXT NOT NULL,
    "signType" INTEGER NOT NULL DEFAULT 1,
    "paymentMethod" TEXT NOT NULL DEFAULT 'TM/CK',
    "publishMinGapMs" INTEGER NOT NULL DEFAULT 3000,
    "mock" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "InvoiceProviderConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InvoiceProviderConfig_singleton_key" ON "InvoiceProviderConfig"("singleton");
