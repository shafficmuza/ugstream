import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { PushService } from './push.service';
import { DevicesController } from './devices.controller';
import { AdminNotificationsController } from './admin-notifications.controller';
import { SecretsService } from '../common/secrets.service';

@Module({
  controllers: [DevicesController, AdminNotificationsController],
  providers: [NotificationsService, PushService, SecretsService],
  exports: [NotificationsService, PushService],
})
export class NotificationsModule {}
