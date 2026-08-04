import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaLibraryController } from './media-library.controller';

@Module({ controllers: [MediaController, MediaLibraryController] })
export class MediaModule {}
