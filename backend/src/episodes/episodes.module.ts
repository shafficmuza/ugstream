import { Module } from '@nestjs/common';
import { EpisodesController } from './episodes.controller';
import { EpisodeThumbnailController } from './episode-thumbnail.controller';
import { EpisodesService } from './episodes.service';
import { CloudflareStreamService } from './cloudflare-stream.service';
import { TranscodeService } from './transcode.service';
import { ThumbnailPickerService } from './thumbnail-picker.service';
import { EntitlementsService } from '../common/entitlements.service';
import { R2Module } from '../media-storage/r2.module';
import { PlaybackModule } from '../playback/playback.module';

@Module({
  imports: [R2Module, PlaybackModule],
  controllers: [EpisodesController, EpisodeThumbnailController],
  providers: [
    EpisodesService,
    CloudflareStreamService,
    TranscodeService,
    ThumbnailPickerService,
    EntitlementsService,
  ],
  exports: [CloudflareStreamService, EpisodesService],
})
export class EpisodesModule {}
