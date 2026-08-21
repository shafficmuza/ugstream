import { TwilioVerifyService } from './twilio-verify.service';

/**
 * Twilio Verify is deliberately confined to +1.
 *
 * Both directions of that boundary are expensive. Letting it take Ugandan
 * numbers would charge a per-verification fee on the market where a whole
 * day's subscription grosses UGX 1,000 — the same arithmetic that keeps plain
 * Twilio SMS out of Uganda. Refusing +1 would put North American sign-ins back
 * on a gateway we cannot test delivery from. Neither shows up as an error, so
 * the table is pinned.
 */
function makeService(configured = true) {
  const secrets: any = {
    isSet: jest.fn(async () => configured),
    get: jest.fn(async (key: string) => (configured ? `value-for-${key}` : undefined)),
  };
  const prisma: any = { appSettings: { findUnique: jest.fn(async () => ({ smsProvider: 'auto' })) } };
  return new TwilioVerifyService(secrets, prisma);
}

describe('TwilioVerifyService.handles (auto)', () => {
  const service = makeService();

  it('takes USA, Canada and the Caribbean', () => {
    expect(service.handles('+14155550123', 'auto')).toBe(true); // USA
    expect(service.handles('+16475550123', 'auto')).toBe(true); // Canada
    expect(service.handles('+18761234567', 'auto')).toBe(true); // Jamaica
  });

  it('leaves Uganda exactly where it was', () => {
    // Airtel and MTN alike stay on RouteMobile/BulkSMS. This is the assertion
    // that stops a routing change from quietly repricing the home market.
    expect(service.handles('+256752478186', 'auto')).toBe(false);
    expect(service.handles('+256772878614', 'auto')).toBe(false);
  });

  it('leaves the rest of the world on BulkSMS', () => {
    expect(service.handles('+447911123456', 'auto')).toBe(false); // UK
    expect(service.handles('+254712345678', 'auto')).toBe(false); // Kenya
    expect(service.handles('+971501234567', 'auto')).toBe(false); // UAE
  });
});

describe('TwilioVerifyService.handles (forced)', () => {
  const service = makeService();

  it('takes every number when the admin forces Verify', () => {
    expect(service.handles('+256772878614', 'twilioverify')).toBe(true);
    expect(service.handles('+14155550123', 'twilioverify')).toBe(true);
  });

  it('stands aside entirely when the admin forces a plain gateway', () => {
    // Forcing a gateway is an outage tool. If the admin has pinned one, +1
    // must follow the message path's own coverage rules rather than being
    // captured here.
    for (const mode of ['bulksms', 'routemobile', 'twilio', 'africastalking', 'custom']) {
      expect(service.handles('+14155550123', mode)).toBe(false);
    }
  });
});

describe('TwilioVerifyService.start', () => {
  afterEach(() => {
    (global.fetch as any) = undefined;
  });

  it('reports success only on a pending verification', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 201,
      text: async () => JSON.stringify({ sid: 'VE1', status: 'pending' }),
    })) as any;
    await expect(makeService().start('+14155550123')).resolves.toBe(true);
  });

  it('reports failure when Twilio accepts but does not send', async () => {
    // A 200 carrying a non-pending status would otherwise read as delivered,
    // and the user would sit on a code-entry screen forever.
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ status: 'max_attempts_reached' }),
    })) as any;
    await expect(makeService().start('+14155550123')).resolves.toBe(false);
  });

  it('reports failure rather than throwing when Twilio is unreachable', async () => {
    // The caller falls back to an ordinary SMS code on false. Throwing here
    // would turn a Verify outage into a sign-in outage for North America.
    global.fetch = jest.fn(async () => {
      throw new Error('ECONNRESET');
    }) as any;
    await expect(makeService().start('+14155550123')).resolves.toBe(false);
  });

  it('does nothing without credentials', async () => {
    global.fetch = jest.fn() as any;
    await expect(makeService(false).start('+14155550123')).resolves.toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('TwilioVerifyService.check', () => {
  afterEach(() => {
    (global.fetch as any) = undefined;
  });

  it('approves only an approved status', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ status: 'approved', valid: true }),
    })) as any;
    await expect(makeService().check('+14155550123', '123456')).resolves.toBe(true);
  });

  it('refuses a still-pending check', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ status: 'pending', valid: false }),
    })) as any;
    await expect(makeService().check('+14155550123', '000000')).resolves.toBe(false);
  });

  it('treats a 404 as an expired code, not an error', async () => {
    // Twilio deletes the verification once approved, expired or out of
    // attempts, and answers 404 for all three. That is an ordinary wrong-code
    // outcome and must not surface as a 500.
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 404,
      text: async () => '{"code":20404}',
    })) as any;
    await expect(makeService().check('+14155550123', '123456')).resolves.toBe(false);
  });

  it('refuses when Twilio is unreachable', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('ETIMEDOUT');
    }) as any;
    await expect(makeService().check('+14155550123', '123456')).resolves.toBe(false);
  });
});
