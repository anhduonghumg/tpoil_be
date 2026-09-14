-- Notification-center classification, retention, and the link from a work item to its source notification.
ALTER TABLE "Notification"
    ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'UPDATE',
    ADD COLUMN "tab" TEXT NOT NULL DEFAULT 'GENERAL',
    ADD COLUMN "expiresAt" TIMESTAMPTZ(6);

ALTER TABLE "NotificationRecipient"
    ADD COLUMN "actionRequired" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "NotificationWorkItem"
    ADD COLUMN "notificationId" UUID;

CREATE INDEX "Notification_tab_kind_expiresAt_idx"
    ON "Notification"("tab", "kind", "expiresAt");
CREATE INDEX "NotificationWorkItem_notificationId_idx"
    ON "NotificationWorkItem"("notificationId");

ALTER TABLE "NotificationWorkItem"
    ADD CONSTRAINT "NotificationWorkItem_notificationId_fkey"
    FOREIGN KEY ("notificationId") REFERENCES "Notification"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Notification" DROP CONSTRAINT "Notification_outboxId_fkey";
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_outboxId_fkey"
    FOREIGN KEY ("outboxId") REFERENCES "NotificationOutbox"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
