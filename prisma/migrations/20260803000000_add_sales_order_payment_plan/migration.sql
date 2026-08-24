-- Lịch thanh toán của đơn bán trả chậm (50% / 100% / số tiền tự đặt).
CREATE TABLE "SalesOrderPaymentPlan" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "salesOrderId" UUID NOT NULL,
    "dueDays" INTEGER NOT NULL,
    "percent" DECIMAL(6,3),
    "amount" DECIMAL(18,2),
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesOrderPaymentPlan_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SalesOrderPaymentPlan_salesOrderId_sortOrder_idx"
    ON "SalesOrderPaymentPlan"("salesOrderId", "sortOrder");

ALTER TABLE "SalesOrderPaymentPlan"
    ADD CONSTRAINT "SalesOrderPaymentPlan_salesOrderId_fkey"
    FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
