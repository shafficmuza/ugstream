import { Module } from '@nestjs/common';
import { TitlesController } from './titles.controller';
import { AdminTitlesController } from './admin-titles.controller';
import { TitlesService } from './titles.service';
import { EpisodesModule } from '../episodes/episodes.module';

@Module({
  imports: [EpisodesModule],
  controllers: [TitlesController, AdminTitlesController],
  providers: [TitlesService],
})
export class TitlesModule {}
