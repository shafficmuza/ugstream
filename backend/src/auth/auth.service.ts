import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from './sms.service';
import { ActivityService } from '../common/activity.service';

const OTP_TTL_MINUTES = 5;
const OTP_MAX_ATTEMPTS = 5;
const OTP_REQUESTS_PER_HOUR = 3;
/** Used only if the settings row is somehow missing; the real value is admin-set. */
const DEFAULT_MAX_SESSIONS = 3;
const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL_DAYS = 30;

function randomOtp(): string {
  // 6-digit numeric code, zero-padded.
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

function randomToken(): string {
  return crypto.randomBytes(48).toString('hex');
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly sms: SmsService,
    private readonly activity: ActivityService,
  ) {}

  async requestOtp(phone: string): Promise<{ expiresInSeconds: number }> {
    // The hourly cap exists to stop SMS spam/cost. While no SMS gateway is
    // configured we issue the static test code and send nothing, so the cap
    // only gets in the way of testing — enforce it just for real sends.
    const smsReady = await this.sms.isConfigured();
    if (smsReady) {
      const since = new Date(Date.now() - 60 * 60 * 1000);
      const recentCount = await this.prisma.otpCode.count({
        where: { phone, expiresAt: { gt: since } },
      });
      if (recentCount >= OTP_REQUESTS_PER_HOUR) {
        throw new BadRequestException(
          'Too many codes requested for this number. Try again later.',
        );
      }
    }

    // OTP_STATIC_CODE is a dev/testing bypass (fixed code, no SMS) — a real
    // account-takeover risk if left on in production. It is honoured ONLY
    // while no real SMS gateway is configured; the moment SMS is wired up
    // (see sms.service.ts) we ignore the bypass and always issue a random,
    // SMS-delivered code. So enabling SMS auto-secures login with no code
    // change. To disable the bypass without SMS too, set OTP_STATIC_CODE="".
    const staticCode = this.config.get<string>('OTP_STATIC_CODE');
    const useStatic = !smsReady && !!staticCode;

    const code = useStatic ? staticCode! : randomOtp();
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    await this.prisma.otpCode.create({
      data: { phone, codeHash, expiresAt },
    });

    if (!useStatic) {
      await this.sms.send(phone, `Your verification code is ${code}. It expires in ${OTP_TTL_MINUTES} minutes.`);
    }

    return { expiresInSeconds: OTP_TTL_MINUTES * 60 };
  }

  async verifyOtp(phone: string, code: string, deviceLabel?: string) {
    const otp = await this.prisma.otpCode.findFirst({
      where: { phone, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { id: 'desc' },
    });

    if (!otp) {
      throw new UnauthorizedException('Code expired or not found. Request a new one.');
    }
    if (otp.attempts >= OTP_MAX_ATTEMPTS) {
      throw new UnauthorizedException('Too many incorrect attempts. Request a new code.');
    }

    const valid = await bcrypt.compare(code, otp.codeHash);
    if (!valid) {
      await this.prisma.otpCode.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });
      throw new UnauthorizedException('Incorrect code.');
    }

    await this.prisma.otpCode.update({
      where: { id: otp.id },
      data: { consumedAt: new Date() },
    });

    const user = await this.prisma.user.upsert({
      where: { phone },
      update: {},
      create: { phone },
    });

    if (user.status === 'banned') {
      throw new UnauthorizedException('This account has been suspended.');
    }

    this.activity.log(user.id, 'login', 'Logged in');
    return this.issueSession(user.id, deviceLabel);
  }

  async refresh(refreshToken: string) {
    const candidates = await this.prisma.session.findMany({
      where: { revokedAt: null },
      include: { user: true },
    });

    // Refresh tokens are stored hashed, so we must compare against each
    // active session rather than looking one up directly. Fine at MVP
    // scale; revisit (e.g. store a lookup prefix) if session volume grows.
    for (const session of candidates) {
      if (await bcrypt.compare(refreshToken, session.refreshHash)) {
        if (session.user.status === 'banned') {
          throw new UnauthorizedException('This account has been suspended.');
        }
        await this.prisma.session.update({
          where: { id: session.id },
          data: { lastSeenAt: new Date() },
        });
        return this.issueTokenPair(session.user.id, session.id);
      }
    }

    throw new UnauthorizedException('Invalid or expired refresh token.');
  }

  async logout(sessionId: string) {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueSession(userId: bigint, deviceLabel?: string) {
    const settings = await this.prisma.appSettings.findUnique({ where: { id: 1 } });
    const maxSessions = settings?.maxSessions ?? DEFAULT_MAX_SESSIONS;

    const activeSessions = await this.prisma.session.findMany({
      where: { userId, revokedAt: null },
      orderBy: { lastSeenAt: 'asc' },
    });

    // Enforce a device cap by evicting the least recently used session(s)
    // rather than blocking new logins outright: refusing the sign-in would
    // strand someone whose old handset is lost or wiped. 0 or less disables
    // the cap entirely, for an admin who does not want one.
    if (maxSessions > 0 && activeSessions.length >= maxSessions) {
      const toRevoke = activeSessions.slice(0, activeSessions.length - maxSessions + 1);
      await this.prisma.session.updateMany({
        where: { id: { in: toRevoke.map((s) => s.id) } },
        data: { revokedAt: new Date() },
      });
      // An evicted device is also no longer allowed to hold a stream slot;
      // leaving its lease behind would keep a slot occupied by a session that
      // can no longer play anything.
      await this.prisma.streamLease.updateMany({
        where: { sessionId: { in: toRevoke.map((s) => s.id) }, endedAt: null },
        data: { endedAt: new Date() },
      });
    }

    const refreshToken = randomToken();
    const refreshHash = await bcrypt.hash(refreshToken, 10);
    const session = await this.prisma.session.create({
      data: { userId, refreshHash, deviceLabel },
    });

    const tokens = await this.issueTokenPair(userId, session.id, refreshToken);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return { ...tokens, user: this.toPublicUser(user) };
  }

  private async issueTokenPair(userId: bigint, sessionId: string, existingRefreshToken?: string) {
    const accessToken = await this.jwt.signAsync(
      { sub: userId.toString(), sid: sessionId },
      { expiresIn: ACCESS_TOKEN_TTL, secret: this.config.get('JWT_ACCESS_SECRET') },
    );

    let refreshToken = existingRefreshToken;
    if (!refreshToken) {
      // Rotate the refresh token on every use.
      refreshToken = randomToken();
      const refreshHash = await bcrypt.hash(refreshToken, 10);
      await this.prisma.session.update({
        where: { id: sessionId },
        data: { refreshHash },
      });
    }

    return {
      accessToken,
      refreshToken,
      refreshTokenExpiresInDays: REFRESH_TOKEN_TTL_DAYS,
    };
  }

  private toPublicUser(user: { id: bigint; phone: string; displayName: string | null; role: string }) {
    return {
      id: user.id.toString(),
      phone: user.phone,
      displayName: user.displayName,
      role: user.role,
    };
  }
}
