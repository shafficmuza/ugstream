import { Global, Module } from '@nestjs/common';
import { ActivityService } from './activity.service';

// Global so any feature module (episodes, titles, …) can log activity.
@Global()
@Module({
  providers: [ActivityService],
  exports: [ActivityService],
})
export class ActivityModule {}
