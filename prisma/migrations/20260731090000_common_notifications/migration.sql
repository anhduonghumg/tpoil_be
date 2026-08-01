CREATE TYPE "NotificationOutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'DEAD');
CREATE TYPE "NotificationSeverity" AS ENUM ('INFO', 'SUCCESS', 'WARNING', 'ERROR');
CREATE TYPE "NotificationRecipientStatus" AS ENUM ('UNREAD', 'READ', 'ARCHIVED');
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'WEB_SSE', 'MOBILE_PUSH', 'EMAIL');
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'FAILED');
CREATE TYPE "NotificationDevicePlatform" AS ENUM ('WEB', 'IOS', 'ANDROID');
CREATE TYPE "NotificationPushProvider" AS ENUM ('FCM', 'APNS');
CREATE TYPE "NotificationWorkItemStatus" AS ENUM ('OPEN', 'COMPLETED', 'CANCELLED');

CREATE TABLE "NotificationOutbox" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "eventType" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "NotificationOutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMPTZ(6),
    "processedAt" TIMESTAMPTZ(6),
    "error" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "NotificationOutbox_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationTemplate" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "code" TEXT NOT NULL,
    "moduleCode" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "titleTemplate" TEXT NOT NULL,
    "bodyTemplate" TEXT NOT NULL,
    "defaultAction" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "NotificationTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Notification" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "outboxId" UUID NOT NULL,
    "eventType" TEXT NOT NULL,
    "moduleCode" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" "NotificationSeverity" NOT NULL DEFAULT 'INFO',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "action" TEXT,
    "metadata" JSONB,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationRecipient" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "notificationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "NotificationRecipientStatus" NOT NULL DEFAULT 'UNREAD',
    "readAt" TIMESTAMPTZ(6),
    "archivedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "NotificationRecipient_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationPreference" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "userId" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "inAppEnabled" BOOLEAN NOT NULL DEFAULT true,
    "pushEnabled" BOOLEAN NOT NULL DEFAULT true,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT false,
    "muteUntil" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationDevice" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "userId" UUID NOT NULL,
    "platform" "NotificationDevicePlatform" NOT NULL,
    "pushProvider" "NotificationPushProvider",
    "pushToken" TEXT,
    "deviceId" TEXT NOT NULL,
    "appVersion" TEXT,
    "locale" TEXT DEFAULT 'vi-VN',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "NotificationDevice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationDelivery" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "notificationRecipientId" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "deviceId" UUID,
    "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "providerMessageId" TEXT,
    "errorCode" TEXT,
    "sentAt" TIMESTAMPTZ(6),
    "deliveredAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationWorkItem" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "userId" UUID NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "status" "NotificationWorkItemStatus" NOT NULL DEFAULT 'OPEN',
    "dueAt" TIMESTAMPTZ(6),
    "completedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "NotificationWorkItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationOutbox_dedupeKey_key" ON "NotificationOutbox"("dedupeKey");
CREATE INDEX "NotificationOutbox_status_availableAt_idx" ON "NotificationOutbox"("status", "availableAt");
CREATE INDEX "NotificationOutbox_aggregateType_aggregateId_idx" ON "NotificationOutbox"("aggregateType", "aggregateId");
CREATE UNIQUE INDEX "NotificationTemplate_code_key" ON "NotificationTemplate"("code");
CREATE INDEX "NotificationTemplate_moduleCode_category_idx" ON "NotificationTemplate"("moduleCode", "category");
CREATE UNIQUE INDEX "Notification_outboxId_key" ON "Notification"("outboxId");
CREATE INDEX "Notification_moduleCode_category_createdAt_idx" ON "Notification"("moduleCode", "category", "createdAt");
CREATE INDEX "Notification_entityType_entityId_idx" ON "Notification"("entityType", "entityId");
CREATE UNIQUE INDEX "NotificationRecipient_notificationId_userId_key" ON "NotificationRecipient"("notificationId", "userId");
CREATE INDEX "NotificationRecipient_userId_status_createdAt_idx" ON "NotificationRecipient"("userId", "status", "createdAt");
CREATE UNIQUE INDEX "NotificationPreference_userId_category_key" ON "NotificationPreference"("userId", "category");
CREATE UNIQUE INDEX "NotificationDevice_pushToken_key" ON "NotificationDevice"("pushToken");
CREATE UNIQUE INDEX "NotificationDevice_userId_deviceId_key" ON "NotificationDevice"("userId", "deviceId");
CREATE INDEX "NotificationDevice_userId_enabled_idx" ON "NotificationDevice"("userId", "enabled");
CREATE INDEX "NotificationDelivery_status_channel_createdAt_idx" ON "NotificationDelivery"("status", "channel", "createdAt");
CREATE INDEX "NotificationDelivery_notificationRecipientId_idx" ON "NotificationDelivery"("notificationRecipientId");
CREATE UNIQUE INDEX "NotificationWorkItem_userId_sourceType_sourceId_action_key" ON "NotificationWorkItem"("userId", "sourceType", "sourceId", "action");
CREATE INDEX "NotificationWorkItem_userId_status_dueAt_idx" ON "NotificationWorkItem"("userId", "status", "dueAt");

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_outboxId_fkey" FOREIGN KEY ("outboxId") REFERENCES "NotificationOutbox"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NotificationRecipient" ADD CONSTRAINT "NotificationRecipient_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationRecipient" ADD CONSTRAINT "NotificationRecipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationDevice" ADD CONSTRAINT "NotificationDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_notificationRecipientId_fkey" FOREIGN KEY ("notificationRecipientId") REFERENCES "NotificationRecipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "NotificationDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NotificationWorkItem" ADD CONSTRAINT "NotificationWorkItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
