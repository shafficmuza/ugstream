import { AuthService } from './auth.service';
import { TWILIO_VERIFY_PROVIDER } from './twilio-verify.service';

/**
 * Twilio Verify as the last resort when every cheap gateway refuses.
 *
 * Route Mobile and BulkSMS carry almost all traffic because they are a
 * fraction of Verify's per-verification fee. But a code no gateway will carry
 * costs an entire sign-in, which is dearer than any message — so an exhausted
 * chain escalates rather than giving up.
 *
 * The subtle part is the row. A local code was already written and hashed
 * before the send was attempted; once Twilio issues its own code, that hash
 * refers to a code nobody will ever type. It has to be converted in place,
 * not joined by a second row, or the limits count twice and verifyOtp can
 * match a stale hash.
 */

const noMasterCode = () =>
  ({ matches: async () => false, recordFailure: async () => undefined, recordUse: async () => undefined }) as any;
const noDevBypass = () => ({ matches: async () => false, recordFailure: async () => undefined }) as any;
const noPins = () => ({ isAvailableFor: async () => false }) as any;

function makeService(opts: {
  smsDelivered: boolean;
  verifyConfigured?: boolean;
  verifyHandlesNumber?: boolean;
  verifyStarts?: boolean;
}) {
  const create = jest.fn(async ({ data }: any) => ({ id: 77n, ...data }));
  const update = jest.fn(async () => ({}));

  const prisma: any = {
    appSettings: {
      findUnique: jest.fn(async () => ({ otpCooldownSeconds: 0, otpPerHour: 99, otpPerDay: 99 })),
    },
    otpCode: { count: jest.fn(async () => 0), findFirst: jest.fn(async () => null), create, update },
  };

  const sms = {
    isConfigured: jest.fn(async () => true),
    send: jest.fn(async () => opts.smsDelivered),
  };

  const start = jest.fn(async () => opts.verifyStarts ?? true);
  const twilioVerify: any = {
    isConfigured: jest.fn(async () => opts.verifyConfigured ?? true),
    shouldUseFor: jest.fn(async () => opts.verifyHandlesNumber ?? false),
    start,
  };

  const service = new AuthService(
    prisma,
    {} as any,
    { get: jest.fn(() => undefined) } as any,
    sms as any,
    { log: jest.fn() } as any,
    noMasterCode(),
    noDevBypass(),
    noPins(),
    twilioVerify,
  );
  (service as any).logger = { warn: () => {}, error: () => {}, log: () => {} };
  return { service, sms, start, create, update };
}

describe('Twilio Verify escalation when the SMS chain is exhausted', () => {
  it('hands the code to Verify when no gateway accepted it', async () => {
    const { service, start, update } = makeService({ smsDelivered: false });

    await service.requestOtp('+447911123456');

    expect(start).toHaveBeenCalledWith('+447911123456');
    expect(update).toHaveBeenCalledWith({
      where: { id: 77n },
      data: { codeHash: '', provider: TWILIO_VERIFY_PROVIDER },
    });
  });

  it('leaves the local code alone when a gateway did accept it', async () => {
    const { service, start, update } = makeService({ smsDelivered: true });

    await service.requestOtp('+447911123456');

    // Verify is the expensive path. A delivered message must never trigger it.
    expect(start).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('does not bill Verify twice when it already refused this number', async () => {
    // +1 routes to Verify first. If that refusal is what pushed the request
    // onto SMS, asking again after the SMS also fails is a second charge for
    // an answer we already have.
    const { service, start, update } = makeService({
      smsDelivered: false,
      verifyHandlesNumber: true,
      verifyStarts: false,
    });

    await service.requestOtp('+12243730803');

    expect(start).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });

  it('gives up quietly when Verify has no credentials', async () => {
    const { service, start, update } = makeService({ smsDelivered: false, verifyConfigured: false });

    await service.requestOtp('+447911123456');

    expect(start).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('still answers the caller normally when everything fails', async () => {
    // The response must not leak which gateway worked: an attacker learning
    // that a number is undeliverable is a number-enumeration oracle.
    const { service } = makeService({ smsDelivered: false, verifyStarts: false });

    await expect(service.requestOtp('+447911123456')).resolves.toEqual({ expiresInSeconds: 300 });
  });
});
