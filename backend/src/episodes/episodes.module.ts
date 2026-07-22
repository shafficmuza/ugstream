import { Module } from '@nestjs/common';
import { EpisodesController } from './episodes.controller';
import { EpisodesService } from './episodes.service';
import { CloudflareStreamService } from './cloudflare-stream.service';
import { EntitlementsService } from '../common/entitlements.service';

@Module({
  controllers: [EpisodesController],
  providers: [EpisodesService, CloudflareStreamService, EntitlementsService],
  exports: [CloudflareStreamService, EpisodesService],
})
export class EpisodesModule {}
