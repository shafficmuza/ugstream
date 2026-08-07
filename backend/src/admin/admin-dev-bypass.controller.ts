import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { CurrentUser, AuthContext } from '../common/decorators/current-user.decorator';
import { ActivityService } from '../common/activity.service';
import { DevBypassService } from '../auth/dev-bypass.service';

/**
 * The development sign-in bypass — switch, code and number list.
 *
 * The code is write-only: it is stored hashed and never returned, so this
 * endpoint cannot be used to read it back out of a compromised admin session.
 * An admin who has forgotten it sets a new one.
 */
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/dev-bypass')
export class AdminDevBypassController {
  constructor(
    private readonly devBypass: DevBypassService,
    private readonly activity: ActivityService,
  ) {}

  @Get()
  status() {
    return this.devBypass.status();
  }

  @Patch()
  async configure(
    @Body() body: { enabled?: boolean; code?: string; phones?: string[] },
    @CurrentUser() admin: AuthContext,
  ) {
    const status = await this.devBypass.configure(body);

    if (body.code !== undefined) {
      this.activity.log(admin.userId, 'dev_bypass_code_set', 'Set the development sign-in code');
    }
    if (body.phones !== undefined) {
      this.activity.log(
        admin.userId,
        'dev_bypass_phones_set',
        `Development sign-in code now applies to ${status.phones.join(', ') || 'no numbers'}`,
      );
    }
    if (body.enabled !== undefined) {
      this.activity.log(
        admin.userId,
        body.enabled ? 'dev_bypass_enabled' : 'dev_bypass_disabled',
        body.enabled
          ? `Enabled the development sign-in code for ${status.phones.join(', ')}`
          : 'Disabled the development sign-in code',
      );
    }
    return status;
  }
}
