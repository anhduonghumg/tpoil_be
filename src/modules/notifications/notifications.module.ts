import { Global, Module } from '@nestjs/common'
import { PrismaModule } from 'src/infra/prisma/prisma.module'
import { NotificationEventBus } from './notification-event-bus.service'
import { NotificationOutboxProcessor } from './notification-outbox.processor'
import { NotificationOutboxService } from './notification-outbox.service'
import { NotificationRecipientResolver } from './notification-recipient-resolver.service'
import { NotificationTemplateService } from './notification-template.service'
import { NotificationsController } from './notifications.controller'
import { NotificationsService } from './notifications.service'

@Global()
@Module({
    imports: [PrismaModule],
    controllers: [NotificationsController],
    providers: [
        NotificationsService,
        NotificationOutboxService,
        NotificationTemplateService,
        NotificationRecipientResolver,
        NotificationEventBus,
        NotificationOutboxProcessor,
    ],
    exports: [NotificationOutboxService],
})
export class NotificationsModule {}
