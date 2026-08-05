import { BadRequestException, Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { FIREBASE_SERVICE_ACCOUNT } from './push.service';
import { SecretsService } from '../common/secrets.service';
import { SetFirebaseCredentialDto } from './dto/set-firebase-credential.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { StaffGuard } from '../common/guards/staff.guard';
import { CurrentUser, AuthContext } from '../common/decorators/current-user.decorator';
import { BroadcastDto } from './dto/broadcast.dto';

/**
 * Staff can see what has been sent and whether push is reaching anyone.
 * Actually pushing to the entire user base is admin-only (AdminGuard stacks
 * on top, and Nest requires every guard to pass): a broadcast is irreversible
 * and goes to every handset, which is squarely a "critical section" action.
 */
@UseGuards(JwtAuthGuard, StaffGuard)
@Controller('admin/notifications')
export class AdminNotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly secrets: SecretsService,
  ) {}

  @Get()
  history() {
    return this.notifications.history();
  }

  @Get('stats')
  stats() {
    return this.notifications.deviceStats();
  }

  @UseGuards(AdminGuard)
  @Post('broadcast')
  broadcast(@CurrentUser() auth: AuthContext, @Body() dto: BroadcastDto) {
    return this.notifications.broadcast({ ...dto, actorId: auth.userId });
  }

  /** Deliberate re-announcement of a title that was already notified. */
  @UseGuards(AdminGuard)
  @Post('title/:id/resend')
  resend(@CurrentUser() auth: AuthContext, @Param('id') id: string) {
    return this.notifications.announceTitle(BigInt(id), { force: true, actorId: auth.userId });
  }

  /** Whether the Firebase credential is present — never the value itself. */
  @UseGuards(AdminGuard)
  @Get('credentials')
  async credentials() {
    const status = await this.secrets.status([FIREBASE_SERVICE_ACCOUNT]);
    return { keys: [{ key: FIREBASE_SERVICE_ACCOUNT, set: status[FIREBASE_SERVICE_ACCOUNT] }] };
  }

  /**
   * Store the Firebase service-account JSON. Validated here rather than at
   * first send, so a bad paste is rejected while the admin is still looking
   * at the form instead of silently breaking every future notification.
   */
  @UseGuards(AdminGuard)
  @Post('credentials')
  async setCredentials(@Body() body: SetFirebaseCredentialDto) {
    const value = (body.serviceAccount ?? '').trim();
    if (value) {
      let parsed: { project_id?: string; private_key?: string; client_email?: string };
      try {
        parsed = JSON.parse(value);
      } catch {
        throw new BadRequestException('That is not valid JSON — paste the whole service-account file.');
      }
      if (!parsed.project_id || !parsed.private_key || !parsed.client_email) {
        throw new BadRequestException(
          'That JSON is missing project_id, private_key or client_email — it may be the wrong file.',
        );
      }
    }
    await this.secrets.set(FIREBASE_SERVICE_ACCOUNT, value);
    return { ok: true, set: Boolean(value) };
  }
}
