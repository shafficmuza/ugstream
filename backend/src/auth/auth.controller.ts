import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
  Post,
} from '@nestjs/common';
import type { Request, Response } from 'express';
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

/**
 * The refresh token also travels as a long-lived httpOnly cookie, not only in
 * localStorage. Safari deletes script-writable storage after ~7 days without
 * a visit, which used to end perfectly healthy web sessions — the product bar
 * is Netflix's "sign in once, stay in for months", and httpOnly cookies are
 * exempt from that purge. The cookie is a fallback copy of the same rotating
 * token, never an independent session.
 */
const REFRESH_COOKIE = 'ugs_rt';
// 400 days — the maximum lifetime Chrome will honour for any cookie.
const REFRESH_COOKIE_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;

export function readRefreshCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === REFRESH_COOKIE) {
      const value = part.slice(eq + 1).trim();
      return value ? decodeURIComponent(value) : null;
    }
  }
  return null;
}

function setRefreshCookie(res: Response, refreshToken: string) {
  res.cookie(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: REFRESH_COOKIE_MAX_AGE_MS,
  });
}

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
  async verifyOtp(@Body() dto: VerifyOtpDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.verifyOtp(dto.phone, dto.code, dto.deviceLabel);
    if (result?.refreshToken) setRefreshCookie(res, result.refreshToken);
    return result;
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
  async pinLogin(@Body() dto: PinLoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.signInWithPin(dto.phone, dto.pin, dto.deviceLabel);
    if (result?.refreshToken) setRefreshCookie(res, result.refreshToken);
    return result;
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
  async refresh(
    @Body() dto: RefreshTokenDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Body first (mobile, and web while its localStorage copy survives), the
    // httpOnly cookie as the fallback that outlives storage purges.
    const token = dto.refreshToken ?? readRefreshCookie(req.headers.cookie);
    if (!token) throw new UnauthorizedException('Missing refresh token.');
    const result = await this.auth.refresh(token);
    if (result?.refreshToken) setRefreshCookie(res, result.refreshToken);
    return result;
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(@CurrentUser() auth: AuthContext, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(auth.sessionId);
    res.clearCookie(REFRESH_COOKIE, { path: '/' });
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
