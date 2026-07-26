import { Module } from '@nestjs/common';
import { EpisodesController } from './episodes.controller';
import { EpisodesService } from './episodes.service';
import { CloudflareStreamService } from './cloudflare-stream.service';
import { TranscodeService } from './transcode.service';
import { EntitlementsService } from '../common/entitlements.service';
import { R2Module } from '../media-storage/r2.module';

@Module({
  imports: [R2Module],
  controllers: [EpisodesController],
  providers: [EpisodesService, CloudflareStreamService, TranscodeService, EntitlementsService],
  exports: [CloudflareStreamService, EpisodesService],
})
export class EpisodesModule {}
