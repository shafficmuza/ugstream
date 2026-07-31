import { Module } from '@nestjs/common';
import { AdminUsersController } from './admin-users.controller';
import { AdminStatsController } from './admin-stats.controller';
import { AdminActivityController } from './admin-activity.controller';

@Module({ controllers: [AdminUsersController, AdminStatsController, AdminActivityController] })
export class AdminModule {}
