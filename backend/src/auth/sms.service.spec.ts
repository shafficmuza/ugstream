import { SmsService } from './sms.service';

/**
 * Routing is a pure cost decision with an expensive failure mode in each
 * direction: routing Uganda to Twilio costs ~30x more per message than the
 * Daily plan grosses, and routing the US to Africa's Talking simply doesn't
 * deliver. Neither shows up as an error in testing, so the table is pinned.
 */
function makeService(configured: { at?: boolean; twilio?: boolean } = {}) {
  const secrets: any = {
    isSet: jest.fn(async (key: string) => {
      if (key.startsWith('SMS_AT_')) return configured.at ?? false;
      if (key.startsWith('SMS_TWILIO_')) return configured.twilio ?? false;
      return false;
    }),
    get: jest.fn(async () => 'x'),
  };
  const prisma: any = { appSettings: { findUnique: jest.fn() } };
  return new SmsService(secrets, prisma);
}

describe('SmsService.routeFor (auto)', () => {
  const service = makeService();

  it('sends East African numbers to Africa’s Talking', () => {
    expect(service.routeFor('+256772878614', 'auto')).toBe('africastalking'); // Uganda
    expect(service.routeFor('+254712345678', 'auto')).toBe('africastalking'); // Kenya
    expect(service.routeFor('+255712345678', 'auto')).toBe('africastalking'); // Tanzania
    expect(service.routeFor('+250788123456', 'auto')).toBe('africastalking'); // Rwanda
  });

  it('sends the diaspora to Twilio, where those numbers are under a cent', () => {
    expect(service.routeFor('+14155550123', 'auto')).toBe('twilio'); // USA
    expect(service.routeFor('+447911123456', 'auto')).toBe('twilio'); // UK
    expect(service.routeFor('+971501234567', 'auto')).toBe('twilio'); // UAE
    expect(service.routeFor('+27821234567', 'auto')).toBe('twilio'); // South Africa
  });

  it('does not confuse country codes that share a prefix', () => {
    // +25 is not a country code; 250/254/255/256 are all distinct, and a
    // sloppy prefix match would send Somalia (+252) or Ethiopia (+251) to a
    // provider that was never chosen for them.
    expect(service.routeFor('+252612345678', 'auto')).toBe('twilio'); // Somalia
    expect(service.routeFor('+251911234567', 'auto')).toBe('twilio'); // Ethiopia
  });

  it('falls back to Twilio for unparseable numbers rather than dropping them', () => {
    expect(service.routeFor('garbage', 'auto')).toBe('twilio');
  });
});

describe('SmsService.routeFor (forced)', () => {
  const service = makeService();

  it('overrides the country code in both directions', () => {
    expect(service.routeFor('+256772878614', 'twilio')).toBe('twilio');
    expect(service.routeFor('+14155550123', 'africastalking')).toBe('africastalking');
  });
});

describe('SmsService.isConfigured', () => {
  it('is false only when neither gateway is usable', async () => {
    expect(await makeService({}).isConfigured()).toBe(false);
  });

  it('is true as soon as any gateway can send', async () => {
    // This is what disables the OTP_STATIC_CODE login bypass, so it must not
    // require *both* providers — one working gateway means real codes are
    // reaching real people and the bypass has to be off.
    expect(await makeService({ at: true }).isConfigured()).toBe(true);
    expect(await makeService({ twilio: true }).isConfigured()).toBe(true);
  });
});

describe('SmsService.send', () => {
  const message = 'Your verification code is 123456.';

  function withProviderSpies(configured: { at?: boolean; twilio?: boolean }) {
    const service = makeService(configured);
    const at = jest.spyOn(service as any, 'sendViaAfricasTalking').mockResolvedValue(undefined);
    const twilio = jest.spyOn(service as any, 'sendViaTwilio').mockResolvedValue(undefined);
    return { service, at, twilio };
  }

  it('uses the routed provider when it is configured', async () => {
    const { service, at, twilio } = withProviderSpies({ at: true, twilio: true });
    await service.send('+256772878614', message);
    expect(at).toHaveBeenCalled();
    expect(twilio).not.toHaveBeenCalled();
  });

  it('pays more rather than dropping a login code when the cheap route is down', async () => {
    // A Ugandan number with only Twilio configured still has to receive its
    // code — an undeliverable OTP is a locked-out paying customer.
    const { service, at, twilio } = withProviderSpies({ twilio: true });
    await service.send('+256772878614', message);
    expect(twilio).toHaveBeenCalled();
    expect(at).not.toHaveBeenCalled();
  });

  it('falls back the other way for international numbers too', async () => {
    const { service, at, twilio } = withProviderSpies({ at: true });
    await service.send('+14155550123', message);
    expect(at).toHaveBeenCalled();
    expect(twilio).not.toHaveBeenCalled();
  });

  it('sends nothing when no gateway is configured', async () => {
    const { service, at, twilio } = withProviderSpies({});
    await service.send('+256772878614', message);
    expect(at).not.toHaveBeenCalled();
    expect(twilio).not.toHaveBeenCalled();
  });
});
