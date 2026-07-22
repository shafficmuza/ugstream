import { Module } from '@nestjs/common';
import { AdminUsersController } from './admin-users.controller';
import { AdminStatsController } from './admin-stats.controller';

@Module({ controllers: [AdminUsersController, AdminStatsController] })
export class AdminModule {}
