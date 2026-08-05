import { Body, Controller, Delete, Param, Post, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, AuthContext } from '../common/decorators/current-user.decorator';
import { RegisterDeviceDto } from './dto/register-device.dto';

/**
 * Push-token registration for the mobile apps.
 *
 * Behind auth deliberately: an open endpoint would let anyone flood the
 * device table with junk tokens, and every user signs in with an OTP before
 * using the app anyway, so requiring a session costs no real reach.
 */
@UseGuards(JwtAuthGuard)
@Controller('devices')
export class DevicesController {
  constructor(private readonly notifications: NotificationsService) {}

  @Post()
  register(@CurrentUser() auth: AuthContext, @Body() dto: RegisterDeviceDto) {
    return this.notifications.registerDevice({
      token: dto.token,
      platform: dto.platform,
      userId: auth.userId,
      appVersion: dto.appVersion,
    });
  }

  /** Called on sign-out so the handset stops receiving that user's pushes. */
  @Delete(':token')
  unregister(@Param('token') token: string) {
    return this.notifications.unregisterDevice(token);
  }
}
