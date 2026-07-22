import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { PaymentsModule } from '../payments/payments.module';
import { EpisodesModule } from '../episodes/episodes.module';

@Module({
  imports: [PaymentsModule, EpisodesModule],
  controllers: [WebhooksController],
})
export class WebhooksModule {}
