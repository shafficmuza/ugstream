import { Module } from '@nestjs/common';
import { TitlesController } from './titles.controller';
import { AdminTitlesController } from './admin-titles.controller';
import { MyListController } from './my-list.controller';
import { TitlesService } from './titles.service';
import { EpisodesModule } from '../episodes/episodes.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [EpisodesModule, NotificationsModule],
  controllers: [TitlesController, AdminTitlesController, MyListController],
  providers: [TitlesService],
})
export class TitlesModule {}
