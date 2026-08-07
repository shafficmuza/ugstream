import { Body, Controller, Delete, Get, Param, UseGuards, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { PinLoginDto, SetPinDto, SignInMethodDto } from './dto/pin.dto';
import { PinService } from './pin.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, AuthContext } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
    private readonly pins: PinService,
  ) {}

  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('otp/request')
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.auth.requestOtp(dto.phone);
  }

  @Post('otp/verify')
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyOtp(dto.phone, dto.code, dto.deviceLabel);
  }

  /**
   * Which sign-in step to show for this number: 'pin' or 'otp'.
   *
   * Throttled despite answering nothing sensitive — it is the one endpoint a
   * client hits before any other, so it is the cheapest place for someone to
   * hammer the database from.
   */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('sign-in-method')
  signInMethod(@Body() dto: SignInMethodDto) {
    return this.auth.signInMethod(dto.phone);
  }

  /**
   * Sign in with a PIN. No SMS is sent, so this costs nothing — which is the
   * whole reason it exists.
   *
   * The per-IP throttle here is a coarse backstop only; the real protection is
   * the per-account lockout in PinService, since an attacker working through
   * one account's PIN space would otherwise just rotate addresses.
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('pin/login')
  pinLogin(@Body() dto: PinLoginDto) {
    return this.auth.signInWithPin(dto.phone, dto.pin, dto.deviceLabel);
  }

  /** Set or change the caller's own PIN. Changing requires the current one. */
  @UseGuards(JwtAuthGuard)
  @Post('pin')
  setPin(@CurrentUser() auth: AuthContext, @Body() dto: SetPinDto) {
    return this.pins.set(auth.userId, dto.pin, dto.currentPin);
  }

  /** Remove the PIN, returning this account to SMS codes only. */
  @UseGuards(JwtAuthGuard)
  @Delete('pin')
  clearPin(@CurrentUser() auth: AuthContext) {
    return this.pins.clear(auth.userId);
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(@CurrentUser() auth: AuthContext) {
    await this.auth.logout(auth.sessionId);
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Get('sessions')
  async listSessions(@CurrentUser() auth: AuthContext) {
    const sessions = await this.prisma.session.findMany({
      where: { userId: auth.userId, revokedAt: null },
      orderBy: { lastSeenAt: 'desc' },
    });
    return sessions.map((s) => ({
      id: s.id,
      deviceLabel: s.deviceLabel,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      current: s.id === auth.sessionId,
    }));
  }

  @UseGuards(JwtAuthGuard)
  @Delete('sessions/:id')
  async revokeSession(@CurrentUser() auth: AuthContext, @Param('id') id: string) {
    // Scoped to the caller's own sessions only.
    await this.prisma.session.updateMany({
      where: { id, userId: auth.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  }
}
