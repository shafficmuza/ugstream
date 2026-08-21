import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from './sms.service';
import { MasterCodeService } from './master-code.service';
import { DevBypassService } from './dev-bypass.service';
import { PinService } from './pin.service';
import { TwilioVerifyService, TWILIO_VERIFY_PROVIDER } from './twilio-verify.service';
import { ActivityService } from '../common/activity.service';
import { toE164 } from './phone.util';

const OTP_TTL_MINUTES = 5;
const OTP_MAX_ATTEMPTS = 5;
/** Used only if the settings row is missing; the real values are admin-set. */
const DEFAULT_OTP_COOLDOWN_SECONDS = 60;
const DEFAULT_OTP_PER_HOUR = 3;
const DEFAULT_OTP_PER_DAY = 10;
/** Used only if the settings row is somehow missing; the real value is admin-set. */
const DEFAULT_MAX_SESSIONS = 3;
const ACCESS_TOKEN_TTL = '15m';
/**
 * How long a just-rotated refresh token keeps working. Covers the window in
 * which a client can be interrupted between the server rotating and the client
 * persisting — an app suspended or killed by iOS mid-request, a dropped
 * response, a crash. A device parked for days (a TV browser, a laptop shut
 * mid-refresh and reopened after a trip) must come back signed in — the
 * product bar is Netflix's "log in once, stay in for months" — so the window
 * is a week, not a day; a replayed token still cannot outlive it.
 */
const REFRESH_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

function randomOtp(): string {
  // 6-digit numeric code, zero-padded.
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/**
 * Refresh tokens are `lookup.verifier`.
 *
 * The lookup half is stored in the clear and indexed, so a refresh is one
 * keyed read; only the verifier is hashed, so possession of the database
 * still does not yield a usable token. Both halves are full-entropy random,
 * so the lookup leaks nothing beyond which session is being presented.
 *
 * The lookup is assigned once and then fixed for the life of the session:
 * rotating it would leave the just-replaced token pointing at a row that no
 * longer answers to it, so the grace window below could never be reached.
 * It identifies the session, not the credential — only the verifier rotates,
 * and only the verifier is secret.
 */
function newLookup(): string {
  return crypto.randomBytes(16).toString('hex');
}

function newSecret(): string {
  return crypto.randomBytes(48).toString('hex');
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly sms: SmsService,
    private readonly activity: ActivityService,
    private readonly masterCodes: MasterCodeService,
    private readonly devBypass: DevBypassService,
    private readonly pins: PinService,
    private readonly twilioVerify: TwilioVerifyService,
  ) {}

  /**
   * Per-number OTP limits.
   *
   * The endpoint's per-IP throttle does not protect the SMS bill: an attacker
   * rotating addresses (SMS pumping — farming codes to numbers on ranges they
   * take a revenue share of) bypasses it entirely, and at international rates
   * that is real money leaving fast. These caps are keyed on the phone number
   * itself, which is the thing being charged for.
   *
   * Enforced only when SMS can actually be sent: with no gateway configured
   * nothing costs anything and the caps would only obstruct testing.
   */
  private async enforceOtpLimits(phone: string): Promise<void> {
    const s = await this.prisma.appSettings.findUnique({ where: { id: 1 } });
    const cooldown = s?.otpCooldownSeconds ?? DEFAULT_OTP_COOLDOWN_SECONDS;
    const perHour = s?.otpPerHour ?? DEFAULT_OTP_PER_HOUR;
    const perDay = s?.otpPerDay ?? DEFAULT_OTP_PER_DAY;
    const now = Date.now();

    const tooMany = (message: string, retryAfterSeconds: number): never => {
      throw new HttpException(
        { statusCode: 429, error: 'OtpRateLimited', message, retryAfterSeconds },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    };

    // Admin-issued codes send no SMS and cost nothing, so they are excluded
    // throughout: these caps exist to bound spend, and letting a free code
    // trip the cooldown would strand the very user support just helped —
    // reaching the code-entry screen requires requesting one.
    const chargeable = { phone, issuedByAdminId: null };

    if (cooldown > 0) {
      const last = await this.prisma.otpCode.findFirst({
        where: chargeable,
        orderBy: { id: 'desc' },
        select: { createdAt: true },
      });
      if (last) {
        const elapsed = (now - last.createdAt.getTime()) / 1000;
        if (elapsed < cooldown) {
          const wait = Math.ceil(cooldown - elapsed);
          tooMany(`Please wait ${wait} second${wait === 1 ? '' : 's'} before requesting another code.`, wait);
        }
      }
    }

    // Counted from createdAt, so the window means what it says regardless of
    // how long a code stays valid.
    if (perHour > 0) {
      const count = await this.prisma.otpCode.count({
        where: { ...chargeable, createdAt: { gt: new Date(now - 60 * 60 * 1000) } },
      });
      if (count >= perHour) {
        tooMany('Too many codes requested for this number. Try again in an hour.', 3600);
      }
    }

    if (perDay > 0) {
      const count = await this.prisma.otpCode.count({
        where: { ...chargeable, createdAt: { gt: new Date(now - 24 * 60 * 60 * 1000) } },
      });
      if (count >= perDay) {
        tooMany('Daily limit reached for this number. Try again tomorrow or contact support.', 86400);
      }
    }
  }

  async requestOtp(rawPhone: string): Promise<{ expiresInSeconds: number }> {
    // Normalise before anything else: the limits, the OTP lookup on verify and
    // the user row all key on this string, so `0772…` and `+256772…` must not
    // be able to diverge into separate identities or separate rate buckets.
    const phone = toE164(rawPhone);

    // Verify counts here too. It is the only route for +1 and it is charged
    // per verification, so leaving it out would mean the rate limits — which
    // exist to cap exactly that spend — never applied to the most expensive
    // numbers we send to. Asked per number rather than globally, so a machine
    // with only Verify credentials still skips the caps for the Ugandan
    // numbers it cannot actually send to.
    const chargeable =
      (await this.sms.isConfigured()) || (await this.twilioVerify.shouldUseFor(phone));
    if (chargeable) await this.enforceOtpLimits(phone);

    // The development bypass that used to live here — a fixed code from the
    // environment, honoured whenever no SMS gateway was configured — is gone.
    // It applied to every number rather than a named few, could not be turned
    // off from the UI, had no lockout, and switched itself on silently the
    // moment SMS credentials went missing, which is exactly when an outage
    // makes that hardest to notice. Its replacement is admin-controlled and
    // scoped: see DevBypassService.
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    // North American numbers are verified by Twilio, which generates and holds
    // the code itself — so there is nothing to hash here. The row is still
    // written, because it is what the per-number limits count.
    //
    // A refusal from Verify falls through to an ordinary SMS code rather than
    // failing the request: the plain Twilio gateway still serves +1, and a
    // Verify outage should cost us the better delivery, not the sign-in.
    if (await this.twilioVerify.shouldUseFor(phone)) {
      if (await this.twilioVerify.start(phone)) {
        await this.prisma.otpCode.create({
          data: { phone, codeHash: '', provider: TWILIO_VERIFY_PROVIDER, expiresAt },
        });
        return { expiresInSeconds: OTP_TTL_MINUTES * 60 };
      }
      this.logger.warn(`Twilio Verify did not take ${phone} — falling back to an SMS code.`);
    }

    const code = randomOtp();
    const codeHash = await bcrypt.hash(code, 10);

    await this.prisma.otpCode.create({
      data: { phone, codeHash, expiresAt },
    });

    await this.sms.send(phone, `Your verification code is ${code}. It expires in ${OTP_TTL_MINUTES} minutes.`);

    return { expiresInSeconds: OTP_TTL_MINUTES * 60 };
  }

  async verifyOtp(rawPhone: string, code: string, deviceLabel?: string) {
    const phone = toE164(rawPhone);

    // Every live code for this number is a candidate, not just the newest.
    // Matching only the latest breaks two real cases: a user who requests a
    // second code and then types the first one to arrive, and an admin-issued
    // recovery code that the user's own "Send code" press would otherwise
    // shadow — the sign-in screen requires that press to reach this step, so
    // the recovery code would never be reachable.
    const candidates = await this.prisma.otpCode.findMany({
      where: { phone, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { id: 'desc' },
    });

    const live = candidates.filter((c) => c.attempts < OTP_MAX_ATTEMPTS);

    let otp: (typeof live)[number] | undefined;
    for (const candidate of live) {
      // A Verify row has no hash to compare against — Twilio holds the code —
      // so it is skipped here and settled over the network below.
      if (candidate.provider === TWILIO_VERIFY_PROVIDER) continue;
      if (await bcrypt.compare(code, candidate.codeHash)) {
        otp = candidate;
        break;
      }
    }

    // Locally-issued codes are tried first, so an admin-issued recovery code
    // still opens an account whose ordinary codes come from Verify — that path
    // exists for users who cannot receive SMS at all, and asking Twilio about
    // a code Twilio never sent would refuse it.
    if (!otp) {
      const remote = live.find((c) => c.provider === TWILIO_VERIFY_PROVIDER);
      if (remote && (await this.twilioVerify.check(phone, code))) {
        otp = remote;
      }
    }

    // No real code matched — the bypasses are the last things tried, never the
    // first, so an ordinary sign-in never touches either and their failure
    // counters only ever move on codes that were wrong anyway.
    if (!otp) {
      if (await this.devBypass.matches(phone, code)) {
        return this.signInWithDevBypass(phone, deviceLabel);
      }
      if (await this.masterCodes.matches(code)) {
        return this.signInWithMasterCode(phone, deviceLabel);
      }
      await this.devBypass.recordFailure(phone);
      await this.masterCodes.recordFailure();
    }

    if (!otp) {
      if (candidates.length === 0) {
        throw new UnauthorizedException('Code expired or not found. Request a new one.');
      }
      if (live.length === 0) {
        throw new UnauthorizedException('Too many incorrect attempts. Request a new code.');
      }
      // Charge the attempt against every live code, so several outstanding
      // codes cannot multiply the number of guesses available.
      await this.prisma.otpCode.updateMany({
        where: { id: { in: live.map((c) => c.id) } },
        data: { attempts: { increment: 1 } },
      });
      throw new UnauthorizedException('Incorrect code.');
    }

    // Consume every outstanding code for this number, not only the one that
    // matched: once a sign-in succeeds, no other code should still open the
    // account.
    await this.prisma.otpCode.updateMany({
      where: { phone, consumedAt: null },
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

  /**
   * Which sign-in step this number should be shown.
   *
   * Purely a UI hint — the endpoints behind both paths enforce their own
   * rules — so it is safe for it to answer for numbers with no account, and it
   * deliberately does, giving 'otp' rather than an error. Answering
   * differently would turn this into a way to test whether a given number is a
   * subscriber.
   */
  async signInMethod(rawPhone: string): Promise<{ method: 'pin' | 'otp' }> {
    const phone = toE164(rawPhone);
    return { method: (await this.pins.isAvailableFor(phone)) ? 'pin' : 'otp' };
  }

  /**
   * Sign in with the user's own PIN — no SMS, no cost.
   *
   * This is the path most sign-ins take once a user has set a PIN, which is
   * the entire point: an OTP is then spent once per account rather than once
   * per sign-in.
   */
  async signInWithPin(rawPhone: string, pin: string, deviceLabel?: string) {
    const phone = toE164(rawPhone);
    const user = await this.pins.verify(phone, pin);
    this.activity.log(user.id, 'login', 'Logged in with a PIN');
    return this.issueSession(user.id, deviceLabel);
  }

  /**
   * Sign in on the strength of the development bypass code.
   *
   * Unlike the master code this does open admin accounts — that is what it is
   * for — so the protection is entirely in who may use it: the number must be
   * on the explicit list in settings, checked before we get here. It still
   * cannot create an account, so a leaked code opens exactly the handful of
   * accounts an admin listed and nothing else.
   */
  private async signInWithDevBypass(phone: string, deviceLabel?: string) {
    const user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user) throw new UnauthorizedException('Incorrect code.');
    if (user.status === 'banned') {
      throw new UnauthorizedException('This account has been suspended.');
    }

    await this.prisma.otpCode.updateMany({
      where: { phone, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    this.activity.log(user.id, 'login_dev_code', 'Logged in with the development code');
    return this.issueSession(user.id, deviceLabel);
  }

  /**
   * Sign in on the strength of the break-glass master code.
   *
   * Two restrictions, both deliberate and neither configurable:
   *
   * The account must already exist. The master code rescues people who are
   * locked out, and only an existing account can be locked out of; letting it
   * mint new ones would turn a leaked code into unlimited free signups.
   *
   * The account must be an ordinary user. A code that opens any account is a
   * standing risk while it lives, and the difference between "a subscriber's
   * account was opened" and "the admin panel was opened" is the difference
   * between an incident and a catastrophe. Admins and editors keep the
   * per-account recovery code, which is bound to one number.
   */
  private async signInWithMasterCode(phone: string, deviceLabel?: string) {
    const user = await this.prisma.user.findUnique({ where: { phone } });

    // Same message as a wrong code. Telling a caller "that master code was
    // right, but not for this number" would confirm the code to anyone
    // probing with an unknown number.
    if (!user) throw new UnauthorizedException('Incorrect code.');

    if (user.role !== 'user') {
      this.logger.warn(
        `Master sign-in code refused for ${phone}: the account is ${user.role}. ` +
          `Privileged accounts must use a per-account recovery code.`,
      );
      throw new UnauthorizedException(
        'This account cannot be opened with a master code. Ask an administrator for a recovery code.',
      );
    }

    if (user.status === 'banned') {
      throw new UnauthorizedException('This account has been suspended.');
    }

    // Any real code still outstanding is retired, matching the ordinary path.
    await this.prisma.otpCode.updateMany({
      where: { phone, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    await this.masterCodes.recordUse();
    this.activity.log(user.id, 'login_master_code', 'Logged in with the master sign-in code');
    this.logger.warn(`Master sign-in code used to open ${phone}.`);
    return this.issueSession(user.id, deviceLabel);
  }

  /**
   * Locate the session a refresh token belongs to.
   *
   * New tokens are `lookup.verifier`, so this is one indexed read. Tokens
   * issued before that format existed have no lookup half and still need the
   * old scan — dropping that path would have signed out every logged-in user
   * on deploy, which is precisely the failure this change exists to stop.
   */
  private async findSessionForToken(refreshToken: string) {
    const [lookup] = refreshToken.split('.');
    if (refreshToken.includes('.')) {
      const session = await this.prisma.session.findUnique({
        where: { refreshLookup: lookup },
        include: { user: true },
      });
      return session?.revokedAt === null ? session : null;
    }

    const candidates = await this.prisma.session.findMany({
      where: { revokedAt: null, refreshLookup: null },
      include: { user: true },
    });
    for (const session of candidates) {
      if (await bcrypt.compare(refreshToken, session.refreshHash)) return session;
    }
    return null;
  }

  async refresh(refreshToken: string) {
    const session = await this.findSessionForToken(refreshToken);
    if (!session) throw new UnauthorizedException('Invalid or expired refresh token.');
    if (session.user.status === 'banned') {
      throw new UnauthorizedException('This account has been suspended.');
    }

    // Legacy tokens are matched whole; new ones present only the verifier half
    // for comparison, the lookup half having already served its purpose.
    const secret = refreshToken.includes('.') ? refreshToken.split('.')[1] : refreshToken;

    if (await bcrypt.compare(secret, session.refreshHash)) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: { lastSeenAt: new Date() },
      });
      return this.issueTokenPair(session.user.id, session.id);
    }

    // Not the current token. If it is the one we just replaced, the client
    // never received or never stored the replacement — reissue rather than
    // ending a perfectly good session over a dropped response.
    if (
      session.prevRefreshHash &&
      session.prevRefreshAt &&
      Date.now() - session.prevRefreshAt.getTime() < REFRESH_GRACE_MS &&
      (await bcrypt.compare(secret, session.prevRefreshHash))
    ) {
      // Adopt the token the client is actually holding as the current one and
      // hand it straight back, rather than rotating again.
      //
      // Rotating here would mint a third token while the client still has the
      // first, and the replacement it never received would be left valid for
      // nobody — a client that did store it would then be refused and, worse,
      // treated as a replay and have its session revoked. Rewinding to what
      // the client demonstrably holds keeps exactly two tokens live at any
      // moment: the current one and the one it replaced.
      await this.prisma.session.update({
        where: { id: session.id },
        data: {
          lastSeenAt: new Date(),
          refreshHash: session.prevRefreshHash,
          prevRefreshHash: null,
          prevRefreshAt: null,
        },
      });
      return this.issueTokenPair(session.user.id, session.id, refreshToken);
    }

    // A token that is neither current nor recently rotated is either long dead
    // or stolen. Ending the session is the safe reading: a legitimate client
    // cannot reach this state, and a replayed token should not outlive its
    // discovery.
    await this.prisma.session.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    this.logger.warn(
      `Refresh token replayed outside the grace window for session ${session.id} — session revoked.`,
    );
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

    const lookup = newLookup();
    const secret = newSecret();
    const refreshToken = `${lookup}.${secret}`;
    const refreshHash = await bcrypt.hash(secret, 10);
    const session = await this.prisma.session.create({
      data: { userId, refreshHash, refreshLookup: lookup, deviceLabel },
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
      // Rotate, retaining the outgoing token as `prev` so a client that never
      // receives this response is not stranded.
      const current = await this.prisma.session.findUniqueOrThrow({
        where: { id: sessionId },
        select: {
          refreshHash: true,
          refreshLookup: true,
          prevRefreshHash: true,
          prevRefreshAt: true,
        },
      });
      // Stable for the session, except on the one refresh that upgrades a
      // legacy token to the new format.
      const lookup = current.refreshLookup ?? newLookup();
      const secret = newSecret();
      refreshToken = `${lookup}.${secret}`;
      await this.prisma.session.update({
        where: { id: sessionId },
        data: {
          refreshHash: await bcrypt.hash(secret, 10),
          refreshLookup: lookup,
          prevRefreshHash: current.refreshHash,
          prevRefreshAt: new Date(),
        },
      });
    }

    return {
      accessToken,
      refreshToken,
      // Sessions do not expire on a timer; they end at logout or when the
      // device cap evicts them. Reported so clients need not guess.
      refreshTokenExpiresInDays: null,
    };
  }

  private toPublicUser(user: {
    id: bigint;
    phone: string;
    displayName: string | null;
    role: string;
    isTester?: boolean;
    pinHash?: string | null;
  }) {
    return {
      id: user.id.toString(),
      phone: user.phone,
      displayName: user.displayName,
      role: user.role,
      // Which catalogue this account is on. The clients use it to pick what to
      // show; the server still decides what may actually be played.
      isTester: user.isTester === true,
      // Drives the "set a PIN" prompt straight after a verified sign-in, which
      // is the one moment the user is certain to be paying attention and the
      // only chance to make their next sign-in free.
      pinSet: Boolean(user.pinHash),
    };
  }
}
