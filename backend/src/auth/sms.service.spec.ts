import { SmsService } from './sms.service';

/**
 * Routing is a pure cost decision with an expensive failure mode in each
 * direction: routing Uganda to Twilio costs ~30x more per message than the
 * Daily plan grosses, and routing the US to Africa's Talking simply doesn't
 * deliver. Neither shows up as an error in testing, so the table is pinned.
 */
function makeService(
  configured: { at?: boolean; twilio?: boolean; bulksms?: boolean; rml?: boolean } = {},
) {
  const secrets: any = {
    isSet: jest.fn(async (key: string) => {
      if (key.startsWith('SMS_AT_')) return configured.at ?? false;
      if (key.startsWith('SMS_TWILIO_')) return configured.twilio ?? false;
      if (key.startsWith('SMS_BULKSMS_')) return configured.bulksms ?? false;
      if (key.startsWith('SMS_RML_')) return configured.rml ?? false;
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

  it('sends Ugandan Airtel numbers to RouteMobile', () => {
    // Proven on a handset 2026-08-15. 70/74/75 are Airtel UG.
    expect(service.routeFor('+256752478186', 'auto')).toBe('routemobile');
    expect(service.routeFor('+256701234567', 'auto')).toBe('routemobile');
    expect(service.routeFor('+256742345678', 'auto')).toBe('routemobile');
  });

  it('keeps Ugandan MTN numbers OFF RouteMobile', () => {
    // The whole point of the split: RouteMobile answered 1701 (success) for
    // MTN and delivered nothing. Routing MTN there again would break every
    // MTN sign-in with no error anywhere to show for it.
    expect(service.routeFor('+256775200442', 'auto')).toBe('bulksms');
    expect(service.routeFor('+256772878614', 'auto')).toBe('bulksms');
    expect(service.routeFor('+256782345678', 'auto')).toBe('bulksms');
  });

  it('sends Uganda and the rest of the world to BulkSMS', () => {
    expect(service.routeFor('+256772878614', 'auto')).toBe('bulksms'); // Uganda MTN
    expect(service.routeFor('+254712345678', 'auto')).toBe('bulksms'); // Kenya
    expect(service.routeFor('+447911123456', 'auto')).toBe('bulksms'); // UK
    expect(service.routeFor('+971501234567', 'auto')).toBe('bulksms'); // UAE
    expect(service.routeFor('+27821234567', 'auto')).toBe('bulksms'); // South Africa
  });

  it('keeps USA and Canada on Twilio, which BulkSMS does not deliver to', () => {
    // Both are +1. A number routed to a gateway that does not serve it gets an
    // accepted API response and no message, so this is pinned rather than left
    // to the fallback chain to notice.
    expect(service.routeFor('+14155550123', 'auto')).toBe('twilio'); // USA
    expect(service.routeFor('+16475550123', 'auto')).toBe('twilio'); // Canada
  });

  it('does not confuse country codes that share a prefix', () => {
    // +25 is not a country code; 250/254/255/256 are all distinct, and a
    // sloppy prefix match would send Somalia (+252) or Ethiopia (+251) to a
    // provider that was never chosen for them.
    expect(service.routeFor('+252612345678', 'auto')).toBe('bulksms'); // Somalia
    expect(service.routeFor('+251911234567', 'auto')).toBe('bulksms'); // Ethiopia
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
    expect(await makeService({ bulksms: true }).isConfigured()).toBe(true);
    // This is what disables the OTP_STATIC_CODE login bypass, so it must not
    // require *both* providers — one working gateway means real codes are
    // reaching real people and the bypass has to be off.
    expect(await makeService({ at: true }).isConfigured()).toBe(true);
    expect(await makeService({ twilio: true }).isConfigured()).toBe(true);
  });
});

describe('SmsService.send', () => {
  const message = 'Your verification code is 123456.';

  function withProviderSpies(configured: {
    at?: boolean;
    twilio?: boolean;
    bulksms?: boolean;
    rml?: boolean;
  }) {
    const service = makeService(configured);
    const at = jest.spyOn(service as any, 'sendViaAfricasTalking').mockResolvedValue(true);
    const twilio = jest.spyOn(service as any, 'sendViaTwilio').mockResolvedValue(true);
    const bulk = jest.spyOn(service as any, 'sendViaBulkSms').mockResolvedValue(true);
    const rml = jest.spyOn(service as any, 'sendViaRouteMobile').mockResolvedValue(true);
    return { service, at, twilio, bulk, rml };
  }

  it('uses the routed provider when it is configured', async () => {
    const { service, bulk, twilio } = withProviderSpies({ bulksms: true, twilio: true });
    await service.send('+256772878614', message);
    expect(bulk).toHaveBeenCalled();
    expect(twilio).not.toHaveBeenCalled();
  });

  it('never sends a US number via BulkSMS, even when BulkSMS is the only gateway', async () => {
    // Coverage, not preference: with nothing else configured the right answer
    // is to send nothing and log it, not to hand the message to a gateway that
    // will accept it and drop it.
    const { service, bulk, twilio } = withProviderSpies({ bulksms: true });
    await service.send('+14155550123', message);
    expect(bulk).not.toHaveBeenCalled();
    expect(twilio).not.toHaveBeenCalled();
  });

  it('sends a US number via Twilio while Uganda still goes to BulkSMS', async () => {
    const { service, bulk, twilio } = withProviderSpies({ bulksms: true, twilio: true });
    await service.send('+14155550123', message);
    expect(twilio).toHaveBeenCalled();
    await service.send('+256772878614', message);
    expect(bulk).toHaveBeenCalled();
  });

  it('uses Africa’s Talking only when nothing else can carry the message', async () => {
    // AT is last, not first. It accepts messages that never arrive, so it is
    // the gateway of last resort rather than the cheap default it used to be.
    const { service, at, bulk } = withProviderSpies({ at: true });
    await service.send('+256772878614', message);
    expect(at).toHaveBeenCalled();
    expect(bulk).not.toHaveBeenCalled();
  });

  it('prefers BulkSMS over Africa’s Talking when both are available', async () => {
    // The ordering bug that cost a real sign-in: RouteMobile refused an
    // Airtel number, the chain fell through to AT because it was cheapest,
    // and the code was accepted and dropped while BulkSMS sat unused.
    const { service, at, bulk, rml } = withProviderSpies({ at: true, bulksms: true, rml: true });
    rml.mockResolvedValue(false);
    await service.send('+256752478186', message);
    expect(bulk).toHaveBeenCalled();
    expect(at).not.toHaveBeenCalled();
  });

  it('pays more rather than dropping a login code when the cheap route is down', async () => {
    // A Ugandan number with only Twilio configured still has to receive its
    // code — an undeliverable OTP is a locked-out paying customer.
    const { service, at, twilio } = withProviderSpies({ twilio: true });
    await service.send('+256772878614', message);
    expect(twilio).toHaveBeenCalled();
    expect(at).not.toHaveBeenCalled();
  });

  it('does not send a US number via Africa’s Talking, which cannot deliver it', async () => {
    // This previously fell back to AT and silently dropped the code. Coverage
    // is now checked on the fallback too, so nothing is sent at all.
    const { service, at, twilio } = withProviderSpies({ at: true });
    await service.send('+14155550123', message);
    expect(at).not.toHaveBeenCalled();
    expect(twilio).not.toHaveBeenCalled();
  });

  it('retries on the next gateway when the primary fails to deliver', async () => {
    // The case this exists for: BulkSMS out of credit or its token revoked.
    // The gateway is configured and reachable, it just refuses the message —
    // so nothing about "is it configured" catches it, and without a retry
    // every user is locked out of their account with no visible error.
    const { service, bulk, at, twilio } = withProviderSpies({
      bulksms: true,
      at: true,
      twilio: true,
    });
    bulk.mockResolvedValue(false);
    await service.send('+256772878614', message);
    expect(bulk).toHaveBeenCalled();
    // Twilio, not Africa's Talking: paying 30x is the right trade against a
    // gateway that accepts the message and drops it.
    expect(twilio).toHaveBeenCalled();
    expect(at).not.toHaveBeenCalled();
  });

  it('stops at the first gateway that accepts the message', async () => {
    // The corollary: no double-sending, and no paying Twilio when the cheap
    // gateway already delivered.
    const { service, bulk, twilio } = withProviderSpies({ bulksms: true, twilio: true });
    await service.send('+256772878614', message);
    expect(bulk).toHaveBeenCalledTimes(1);
    expect(twilio).not.toHaveBeenCalled();
  });

  it('does not retry a US number on a gateway that cannot serve it', async () => {
    // Failover must still respect coverage, or a Twilio failure would fall
    // through to BulkSMS and be silently dropped.
    const { service, bulk, twilio } = withProviderSpies({ bulksms: true, twilio: true });
    twilio.mockResolvedValue(false);
    await service.send('+14155550123', message);
    expect(twilio).toHaveBeenCalled();
    expect(bulk).not.toHaveBeenCalled();
  });

  it('never falls back to RouteMobile for an MTN number', async () => {
    // Coverage is checked on the fallback too, so a BulkSMS outage cannot
    // quietly divert MTN traffic onto the route that drops it.
    const { service, bulk, rml, twilio } = withProviderSpies({ bulksms: true, rml: true });
    bulk.mockResolvedValue(false);
    await service.send('+256775200442', message);
    expect(bulk).toHaveBeenCalled();
    expect(rml).not.toHaveBeenCalled();
    expect(twilio).not.toHaveBeenCalled(); // twilio isn't configured here
  });

  it('falls back to BulkSMS when RouteMobile drops an Airtel message', async () => {
    const { service, rml, bulk } = withProviderSpies({ rml: true, bulksms: true });
    rml.mockResolvedValue(false);
    await service.send('+256752478186', message);
    expect(rml).toHaveBeenCalled();
    expect(bulk).toHaveBeenCalled();
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

/**
 * The sender ID is the field most likely to take the whole sign-in path down.
 * An unregistered one is rejected outright — Africa's Talking did exactly that
 * with AFRICASTKNG — so what matters is that it is sent when set and OMITTED
 * entirely when not, never sent empty.
 */
describe('SmsService BulkSMS sender ID', () => {
  function makeBulkService(settings: Record<string, string>, fetchImpl: any) {
    const secrets: any = {
      isSet: jest.fn(async (key: string) => key in settings),
      get: jest.fn(async (key: string) => settings[key] ?? null),
    };
    const prisma: any = {
      appSettings: { findUnique: jest.fn(async () => ({ smsProvider: 'bulksms' })) },
    };
    (global as any).fetch = fetchImpl;
    return new SmsService(secrets, prisma);
  }

  const creds = {
    SMS_BULKSMS_TOKEN_ID: 'id',
    SMS_BULKSMS_TOKEN_SECRET: 'secret',
  };
  const ok = () =>
    jest.fn(async () => ({ ok: true, status: 201, text: async () => '[{"type":"SENT"}]' }));

  it('sends the registered sender ID as `from`', async () => {
    const fetchMock = ok();
    const service = makeBulkService({ ...creds, SMS_BULKSMS_SENDER_ID: 'PROMEDIA' }, fetchMock);
    await service.send('+256772878614', 'code 123456');

    const body = JSON.parse((fetchMock.mock.calls[0] as any)[1].body);
    expect(body.from).toBe('PROMEDIA');
    expect(body.to).toBe('+256772878614');
  });

  it('omits `from` entirely when no sender ID is set', async () => {
    // Not an empty string: that is a different request, and the shared numeric
    // pool is the route that always works.
    const fetchMock = ok();
    const service = makeBulkService({ ...creds }, fetchMock);
    await service.send('+256772878614', 'code 123456');

    const body = JSON.parse((fetchMock.mock.calls[0] as any)[1].body);
    expect(body).not.toHaveProperty('from');
  });

  it('reports a rejected send as a failure so the chain can retry', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: false,
      status: 400,
      text: async () => '{"detail":"Invalid sender id"}',
    }));
    const service = makeBulkService({ ...creds, SMS_BULKSMS_SENDER_ID: 'NOPE' }, fetchMock);
    const sent = await (service as any).sendViaBulkSms('+256772878614', 'code');
    expect(sent).toBe(false);
  });
});
