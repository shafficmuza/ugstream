import { Module } from '@nestjs/common';
import { AdminUsersController } from './admin-users.controller';
import { AdminStatsController } from './admin-stats.controller';
import { AdminActivityController } from './admin-activity.controller';
import { AdminMasterCodeController } from './admin-master-code.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [
    AdminUsersController,
    AdminStatsController,
    AdminActivityController,
    AdminMasterCodeController,
  ],
})
export class AdminModule {}
