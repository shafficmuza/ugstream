import { HttpException } from '@nestjs/common';
import { AuthService } from './auth.service';

/**
 * Per-number OTP limits. These exist to cap spend under SMS-pumping abuse,
 * where the per-IP throttle on the endpoint provides no protection at all,
 * so the branches that decide whether a message is paid for are worth
 * testing directly.
 */
/** No master code in play — these tests are about the ordinary OTP path. */
const noMasterCode = () =>
  ({ matches: async () => false, recordFailure: async () => undefined, recordUse: async () => undefined }) as any;

/** Nor a development bypass. */
const noDevBypass = () =>
  ({ matches: async () => false, recordFailure: async () => undefined }) as any;

/**
 * Nor Twilio Verify: these are Ugandan numbers, which Verify never handles,
 * and `isConfigured` false keeps the limits keyed on the SMS gateways alone.
 */
const noTwilioVerify = () =>
  ({ isConfigured: async () => false, shouldUseFor: async () => false, start: async () => false }) as any;

/** Nor a PIN — these accounts sign in by code. */
const noPins = () => ({ isAvailableFor: async () => false }) as any;

function makeService(opts: {
  cooldown?: number;
  perHour?: number;
  perDay?: number;
  lastSentSecondsAgo?: number;
  countsByWindow?: { hour?: number; day?: number };
  smsReady?: boolean;
} = {}) {
  const counts = opts.countsByWindow ?? {};
  const HOUR_MS = 60 * 60 * 1000;

  const count = jest.fn(async ({ where }: any) => {
    // Distinguish the hour window from the day window by the cutoff passed in.
    const ageMs = Date.now() - where.createdAt.gt.getTime();
    return ageMs > HOUR_MS * 2 ? (counts.day ?? 0) : (counts.hour ?? 0);
  });

  const findFirst = jest.fn(async () =>
    opts.lastSentSecondsAgo === undefined
      ? null
      : { createdAt: new Date(Date.now() - opts.lastSentSecondsAgo * 1000) },
  );

  const create = jest.fn(async () => ({}));

  const prisma: any = {
    appSettings: {
      findUnique: jest.fn(async () => ({
        otpCooldownSeconds: opts.cooldown ?? 60,
        otpPerHour: opts.perHour ?? 3,
        otpPerDay: opts.perDay ?? 10,
      })),
    },
    otpCode: { count, findFirst, create },
  };

  const sms = {
    isConfigured: jest.fn(async () => opts.smsReady ?? true),
    send: jest.fn(async () => undefined),
  };
  const config = { get: jest.fn(() => undefined) };
  const activity = { log: jest.fn() };

  const service = new AuthService(
    prisma,
    {} as any,
    config as any,
    sms as any,
    activity as any,
    noMasterCode(),
    noDevBypass(),
    noPins(),
    noTwilioVerify(),
  );
  return { service, sms, create, count, findFirst };
}

describe('requestOtp rate limiting', () => {
  it('allows a request when every limit has headroom', async () => {
    const { service, sms } = makeService({ lastSentSecondsAgo: 300, countsByWindow: { hour: 1, day: 4 } });
    await expect(service.requestOtp('0772878614')).resolves.toEqual({ expiresInSeconds: 300 });
    expect(sms.send).toHaveBeenCalled();
  });

  it('rejects a resend inside the cooldown without sending', async () => {
    const { service, sms } = makeService({ cooldown: 60, lastSentSecondsAgo: 10 });
    await expect(service.requestOtp('0772878614')).rejects.toBeInstanceOf(HttpException);
    expect(sms.send).not.toHaveBeenCalled();
  });

  it('tells the caller how long to wait', async () => {
    const { service } = makeService({ cooldown: 60, lastSentSecondsAgo: 10 });
    await expect(service.requestOtp('0772878614')).rejects.toMatchObject({
      response: { error: 'OtpRateLimited', retryAfterSeconds: expect.any(Number) },
    });
  });

  it('enforces the hourly cap', async () => {
    const { service, sms } = makeService({
      lastSentSecondsAgo: 3000,
      countsByWindow: { hour: 3, day: 3 },
      perHour: 3,
    });
    await expect(service.requestOtp('0772878614')).rejects.toBeInstanceOf(HttpException);
    expect(sms.send).not.toHaveBeenCalled();
  });

  it('enforces the daily cap even when the hour looks quiet', async () => {
    // The attack this catches: pacing requests to stay under the hourly limit
    // while still burning a full day's worth of messages.
    const { service, sms } = makeService({
      lastSentSecondsAgo: 3000,
      countsByWindow: { hour: 0, day: 10 },
      perHour: 3,
      perDay: 10,
    });
    await expect(service.requestOtp('0772878614')).rejects.toBeInstanceOf(HttpException);
    expect(sms.send).not.toHaveBeenCalled();
  });

  it('treats each limit of 0 as disabled', async () => {
    const { service, sms } = makeService({
      cooldown: 0,
      perHour: 0,
      perDay: 0,
      lastSentSecondsAgo: 0,
      countsByWindow: { hour: 999, day: 999 },
    });
    await expect(service.requestOtp('0772878614')).resolves.toBeDefined();
    expect(sms.send).toHaveBeenCalled();
  });

  it('does not rate-limit while no gateway is configured', async () => {
    // Nothing is being paid for, so the caps would only obstruct testing.
    const { service, count, findFirst } = makeService({
      smsReady: false,
      lastSentSecondsAgo: 0,
      countsByWindow: { hour: 999, day: 999 },
    });
    await expect(service.requestOtp('0772878614')).resolves.toBeDefined();
    expect(count).not.toHaveBeenCalled();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('rate-limits the number, not the spelling of it', async () => {
    // Without normalisation an attacker rotates 0772…/+256772…/256772… and
    // gets a fresh quota for each, defeating the cap entirely.
    const { service, create } = makeService({ lastSentSecondsAgo: 300 });
    await service.requestOtp('0772878614');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ phone: '+256772878614' }) }),
    );
  });
});
