import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PUBLIC_SETTINGS_SELECT, SettingsService } from './settings.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';

/**
 * GET /settings is unauthenticated — it is what the web and mobile apps read
 * before anyone signs in — and it is backed by the same row that stores the
 * development sign-in bypass. What is worth testing is therefore not that the
 * branding comes back, but that nothing else does.
 */
function makeService(initial: Record<string, any> = {}) {
  // A stand-in for the real row, including the fields that must never leave
  // the server.
  const row: Record<string, any> = {
    id: 1,
    appName: 'ugstream',
    logoUrl: null,
    tagline: null,
    supportEmail: 'help@muzawatch.com',
    supportPhone: '+256775200443',
    supportWhatsapp: null,
    supportHours: null,
    heroBackgroundUrl: null,
    authBackgroundUrl: null,
    mobileMoneyProvider: 'momo',
    smsProvider: 'auto',
    pushEnabled: true,
    pushAudience: 'all',
    maxSessions: 3,
    maxStreams: 2,
    otpCooldownSeconds: 60,
    otpPerHour: 3,
    otpPerDay: 10,
    devBypassEnabled: true,
    devBypassCodeHash: '$2a$10$notarealhashbutshapedlikeone',
    devBypassPhones: ['+256775200442'],
    devBypassFailures: 0,
    devBypassSetAt: new Date(),
    updatedAt: new Date(),
    ...initial,
  };

  const prisma: any = {
    appSettings: {
      // Mirrors Prisma: `update` writes the given keys (null included, which
      // is the point of the clearing test) and `select` narrows the result.
      upsert: jest.fn(async ({ update, select }: any) => {
        for (const [k, v] of Object.entries(update ?? {})) {
          if (v !== undefined) row[k] = v;
        }
        if (!select) return { ...row };
        return Object.fromEntries(Object.keys(select).map((k) => [k, row[k]]));
      }),
    },
  };

  return { service: new SettingsService(prisma), row, prisma };
}

describe('the public settings response is a whitelist', () => {
  it('never returns the dev sign-in bypass hash or the numbers it opens', async () => {
    const { service } = makeService();
    const res: Record<string, any> = await service.get();

    expect(res).not.toHaveProperty('devBypassCodeHash');
    expect(res).not.toHaveProperty('devBypassPhones');
    expect(res).not.toHaveProperty('devBypassEnabled');
    expect(res).not.toHaveProperty('devBypassFailures');
    expect(JSON.stringify(res)).not.toContain('$2a$10$');
  });

  it('withholds the same fields from the admin PATCH response', async () => {
    const { service } = makeService();
    const res: Record<string, any> = await service.update({ appName: 'Ham Watch' });

    expect(res).not.toHaveProperty('devBypassCodeHash');
    expect(res.appName).toBe('Ham Watch');
  });

  it('still publishes the branding and contact fields the clients read', async () => {
    const { service } = makeService({ supportWhatsapp: '+256775200443', supportHours: 'Mon–Sat, 9am–8pm EAT' });
    const res: any = await service.get();

    expect(res.appName).toBe('ugstream');
    expect(res.supportEmail).toBe('help@muzawatch.com');
    expect(res.supportWhatsapp).toBe('+256775200443');
    expect(res.supportHours).toBe('Mon–Sat, 9am–8pm EAT');
  });

  // The guard against the next field: a select is only default-safe if nobody
  // adds a secret to it, and "devBypass"/"hash" is what a secret has looked
  // like on this model so far.
  it('lists no credential-shaped field', () => {
    const leaky = Object.keys(PUBLIC_SETTINGS_SELECT).filter((k) => /hash|secret|devBypass/i.test(k));
    expect(leaky).toEqual([]);
  });
});

describe('support contacts can be cleared, not just set', () => {
  it('nulls a WhatsApp number that was previously set', async () => {
    const { service, row } = makeService({ supportWhatsapp: '+256775200443' });

    const res: any = await service.update({ supportWhatsapp: null });

    expect(row.supportWhatsapp).toBeNull();
    expect(res.supportWhatsapp).toBeNull();
  });

  it('leaves an omitted field alone', async () => {
    const { service, row } = makeService({ supportWhatsapp: '+256775200443' });

    await service.update({ supportHours: 'Mon–Sat, 9am–8pm EAT' });

    expect(row.supportWhatsapp).toBe('+256775200443');
  });

  it('accepts null through validation, including for the email field', async () => {
    const dto = plainToInstance(UpdateSettingsDto, {
      supportEmail: null,
      supportPhone: null,
      supportWhatsapp: null,
      supportHours: null,
    });

    await expect(validate(dto)).resolves.toEqual([]);
  });

  it('still rejects a malformed value when one is actually given', async () => {
    const dto = plainToInstance(UpdateSettingsDto, { supportEmail: 'not-an-email' });
    const errors = await validate(dto);

    expect(errors.map((e) => e.property)).toEqual(['supportEmail']);
  });
});
