import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaLibraryController } from './media-library.controller';
import { ArtworkController } from './artwork.controller';
import { ArtworkService } from './artwork.service';
import { TmdbService } from './tmdb.service';
import { R2Module } from '../media-storage/r2.module';

@Module({
  imports: [R2Module],
  controllers: [MediaController, MediaLibraryController, ArtworkController],
  providers: [ArtworkService, TmdbService],
})
export class MediaModule {}
