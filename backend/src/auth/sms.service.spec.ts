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
    // Keyed rather than blanket, so a provider the test did not configure does
    // not read as configured. A blanket 'x' made the custom gateway look set up
    // in every test and quietly captured the fallbacks.
    get: jest.fn(async (key: string) => (key === 'SMS_CUSTOM_URL' ? null : 'x')),
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

/**
 * The configurable gateway. It exists so a new SMS provider can be added from
 * the admin screen without a deploy and, crucially, without a new mobile build
 * — the apps only ever call our own endpoint, so which gateway carries the
 * message is invisible to them.
 *
 * The parts worth pinning are the ones that fail silently: a template that
 * mangles a message containing & or ", and a gateway that answers 200 with a
 * failure in the body. Both look like a delivered code and are not.
 */
function makeCustomService(settings: Record<string, string>, fetchImpl: any) {
  const secrets: any = {
    isSet: jest.fn(async (key: string) => key in settings),
    get: jest.fn(async (key: string) => settings[key] ?? null),
  };
  const prisma: any = {
    appSettings: { findUnique: jest.fn(async () => ({ smsProvider: 'custom' })) },
  };
  const service = new SmsService(secrets, prisma);
  (global as any).fetch = fetchImpl;
  return service;
}

describe('SmsService custom gateway', () => {
  const realFetch = global.fetch;
  afterEach(() => { (global as any).fetch = realFetch; });

  it('is considered configured once a URL is set, and not before', async () => {
    expect(await makeCustomService({}, jest.fn()).isProviderConfigured('custom')).toBe(false);
    expect(
      await makeCustomService({ SMS_CUSTOM_URL: 'https://g/send' }, jest.fn())
        .isProviderConfigured('custom'),
    ).toBe(true);
  });

  it('substitutes the number and text into the body template', async () => {
    const fetchMock = jest.fn(async () => ({ ok: true, status: 200, text: async () => 'OK' }));
    const service = makeCustomService(
      { SMS_CUSTOM_URL: 'https://gateway.test/send', SMS_CUSTOM_BODY: 'num={to}&txt={message}' },
      fetchMock,
    );
    await service.send('+256700000001', 'Your code is 123456.');

    const [url, init] = fetchMock.mock.calls[0] as any;
    expect(url).toBe('https://gateway.test/send');
    expect(init.method).toBe('POST');
    expect(init.body).toContain('num=%2B256700000001');
    expect(init.body).toContain('txt=Your%20code%20is%20123456.');
  });

  it('url-encodes a message that would otherwise corrupt a form body', async () => {
    const fetchMock = jest.fn(async () => ({ ok: true, status: 200, text: async () => 'OK' }));
    const service = makeCustomService({ SMS_CUSTOM_URL: 'https://g/send' }, fetchMock);
    await service.send('+256700000001', 'A & B = C');

    const body = (fetchMock.mock.calls[0] as any)[1].body;
    // The bare & would otherwise start a new form field and truncate the text.
    expect(body).not.toContain('A & B');
    expect(body).toContain('A%20%26%20B');
  });

  it('escapes a message for a JSON body rather than breaking the document', async () => {
    const fetchMock = jest.fn(async () => ({ ok: true, status: 200, text: async () => 'OK' }));
    const service = makeCustomService(
      {
        SMS_CUSTOM_URL: 'https://g/send',
        SMS_CUSTOM_CONTENT_TYPE: 'application/json',
        SMS_CUSTOM_BODY: '{"to":"{to}","text":"{message}"}',
      },
      fetchMock,
    );
    await service.send('+256700000001', 'He said "hi"');

    const body = (fetchMock.mock.calls[0] as any)[1].body;
    expect(() => JSON.parse(body)).not.toThrow();
    expect(JSON.parse(body).text).toBe('He said "hi"');
  });

  it('puts the payload in the query string for a GET gateway', async () => {
    const fetchMock = jest.fn(async () => ({ ok: true, status: 200, text: async () => 'OK' }));
    const service = makeCustomService(
      { SMS_CUSTOM_URL: 'https://g/send?key=abc', SMS_CUSTOM_METHOD: 'GET' },
      fetchMock,
    );
    await service.send('+256700000001', 'code');

    const [url, init] = fetchMock.mock.calls[0] as any;
    expect(url).toContain('https://g/send?key=abc&to=%2B256700000001');
    expect(init.body).toBeUndefined();
  });

  it('treats a 200 containing the failure text as a failure', async () => {
    // Several local gateways answer 200 with an error inside the body. Without
    // this check that reads as a delivered code and the user waits for an SMS
    // that was never sent.
    const fetchMock = jest.fn(async () => ({
      ok: true, status: 200, text: async () => '{"status":"FAILED","reason":"no credit"}',
    }));
    const service = makeCustomService(
      { SMS_CUSTOM_URL: 'https://g/send', SMS_CUSTOM_SUCCESS_CONTAINS: '"status":"SENT"' },
      fetchMock,
    );
    const errors: string[] = [];
    (service as any).logger = { error: (m: string) => errors.push(m), warn: () => {} };

    await service.send('+256700000001', 'code');
    expect(errors.join(' ')).toMatch(/failed/i);
  });

  it('does not throw when the gateway is unreachable', async () => {
    const fetchMock = jest.fn(async () => { throw new Error('ECONNREFUSED'); });
    const service = makeCustomService({ SMS_CUSTOM_URL: 'https://g/send' }, fetchMock);
    (service as any).logger = { error: () => {}, warn: () => {} };
    await expect(service.send('+256700000001', 'code')).resolves.toBeUndefined();
  });
});
