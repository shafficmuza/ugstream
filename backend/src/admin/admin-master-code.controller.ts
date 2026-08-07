import { Body, Controller, Delete, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { CurrentUser, AuthContext } from '../common/decorators/current-user.decorator';
import { ActivityService } from '../common/activity.service';
import { MasterCodeService } from '../auth/master-code.service';

/**
 * Break-glass sign-in code — issue, inspect, revoke.
 *
 * Exists for the case where the SMS gateway is down or a carrier is dropping
 * messages: per-account recovery codes still work, but they need an admin at a
 * keyboard for every affected user, which does not scale during an outage.
 * One code, read out over the phone or posted to a support channel, does.
 *
 * It is a real backdoor and is treated as one. It expires, it can be revoked
 * in a click, it disables itself under brute force, it refuses privileged
 * accounts, and every issue and every use lands in the activity log.
 */
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/master-code')
export class AdminMasterCodeController {
  constructor(
    private readonly masterCodes: MasterCodeService,
    private readonly activity: ActivityService,
  ) {}

  @Get()
  status() {
    return this.masterCodes.status();
  }

  @Post()
  async issue(@Body('hours') hours: number | undefined, @CurrentUser() admin: AuthContext) {
    const result = await this.masterCodes.issue(admin.userId, hours ? Number(hours) : undefined);
    this.activity.log(
      admin.userId,
      'master_code_issued',
      `Issued a master sign-in code valid for ${result.expiresInHours}h`,
    );
    return result;
  }

  @Delete()
  async revoke(@CurrentUser() admin: AuthContext) {
    const revoked = await this.masterCodes.revoke(admin.userId);
    if (revoked) this.activity.log(admin.userId, 'master_code_revoked', 'Revoked the master sign-in code');
    return { revoked };
  }
}
