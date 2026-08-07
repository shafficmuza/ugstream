import { BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { DevBypassService, DEV_BYPASS_MAX_FAILURES } from './dev-bypass.service';

/**
 * The development sign-in bypass.
 *
 * A fixed, memorable code that opens named accounts without an SMS. It is a
 * deliberate hole, so what is worth testing is the walls around it: that it is
 * off unless switched on, that it is confined to the listed numbers, and above
 * all that it cannot be guessed — a four-digit code against an endpoint taking
 * hundreds of requests a minute is otherwise a minute's work.
 */
function makeService(initial: Record<string, any> = {}) {
  const row: Record<string, any> = {
    id: 1,
    devBypassEnabled: false,
    devBypassCodeHash: null,
    devBypassPhones: [],
    devBypassFailures: 0,
    devBypassSetAt: null,
    ...initial,
  };

  const prisma: any = {
    appSettings: {
      findUnique: jest.fn(async () => ({ ...row })),
      // Writes land on the row, so a test can assert on what the next read sees
      // rather than on the arguments of a call that went nowhere.
      update: jest.fn(async ({ data }: any) => {
        for (const [k, v] of Object.entries<any>(data)) {
          row[k] = v && typeof v === 'object' && 'increment' in v ? row[k] + v.increment : v;
        }
        return { ...row };
      }),
    },
  };

  return { service: new DevBypassService(prisma), row, prisma };
}

async function enabledService(code = '1234', phones = ['+256775200442']) {
  return makeService({
    devBypassEnabled: true,
    devBypassCodeHash: await bcrypt.hash(code, 4),
    devBypassPhones: phones,
  });
}

describe('the bypass is off unless deliberately switched on', () => {
  it('matches nothing by default', async () => {
    const { service } = makeService();
    await expect(service.matches('+256775200442', '1234')).resolves.toBe(false);
  });

  it('matches nothing when a code is set but the switch is off', async () => {
    const { service } = makeService({
      devBypassCodeHash: await bcrypt.hash('1234', 4),
      devBypassPhones: ['+256775200442'],
      devBypassEnabled: false,
    });
    await expect(service.matches('+256775200442', '1234')).resolves.toBe(false);
  });

  it('refuses to switch on with no code set', async () => {
    const { service } = makeService({ devBypassPhones: ['+256775200442'] });
    await expect(service.configure({ enabled: true })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to switch on with no numbers listed', async () => {
    // An unscoped fixed code opens every account on the platform.
    const { service } = makeService({ devBypassCodeHash: await bcrypt.hash('1234', 4) });
    await expect(service.configure({ enabled: true })).rejects.toThrow('at least one phone number');
  });
});

describe('the bypass is confined to the listed numbers', () => {
  it('opens a listed number', async () => {
    const { service } = await enabledService();
    await expect(service.matches('+256775200442', '1234')).resolves.toBe(true);
  });

  it('does nothing for a number that is not listed', async () => {
    const { service } = await enabledService();
    await expect(service.matches('+256700000001', '1234')).resolves.toBe(false);
  });

  it('normalises numbers as they are saved', async () => {
    // The verify path compares against E.164, so a local-format number in this
    // list would silently never match — the bypass would appear simply broken.
    const { service, row } = makeService({ devBypassCodeHash: 'x' });
    await service.configure({ phones: ['0775200442', '+1 415 555 0123'] });
    expect(row.devBypassPhones).toEqual(['+256775200442', '+14155550123']);
  });

  it('rejects a code short enough to guess instantly', async () => {
    const { service } = makeService();
    await expect(service.configure({ code: '12' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('the bypass cannot be brute forced', () => {
  it('switches itself off after enough wrong codes', async () => {
    const { service, row } = await enabledService();
    for (let i = 0; i < DEV_BYPASS_MAX_FAILURES; i++) {
      await service.recordFailure('+256775200442');
    }
    expect(row.devBypassEnabled).toBe(false);
    await expect(service.matches('+256775200442', '1234')).resolves.toBe(false);
  });

  it('ignores failures from numbers that could not have used it anyway', async () => {
    // Otherwise any stranger typing a wrong code could switch off the team's
    // access at will.
    const { service, row } = await enabledService();
    for (let i = 0; i < DEV_BYPASS_MAX_FAILURES * 2; i++) {
      await service.recordFailure('+256700000001');
    }
    expect(row.devBypassFailures).toBe(0);
    expect(row.devBypassEnabled).toBe(true);
  });

  it('clears the count on a successful use', async () => {
    // A long session of occasional typos must not accumulate into a lockout.
    const { service, row } = await enabledService();
    await service.recordFailure('+256775200442');
    await service.recordFailure('+256775200442');
    await service.matches('+256775200442', '1234');
    expect(row.devBypassFailures).toBe(0);
  });

  it('clears the count when the code is rotated', async () => {
    // Guessing against the old code says nothing about the new one.
    const { service, row } = await enabledService();
    await service.recordFailure('+256775200442');
    await service.configure({ code: '987654' });
    expect(row.devBypassFailures).toBe(0);
  });
});

describe('the code is never readable once set', () => {
  it('stores it hashed', async () => {
    const { service, row } = makeService();
    await service.configure({ code: '1234' });
    expect(row.devBypassCodeHash).not.toBe('1234');
    await expect(bcrypt.compare('1234', row.devBypassCodeHash)).resolves.toBe(true);
  });

  it('reports only that one is set', async () => {
    const { service } = makeService();
    await service.configure({ code: '1234' });
    const status = await service.status();
    expect(status.codeSet).toBe(true);
    expect(JSON.stringify(status)).not.toContain('1234');
  });

  it('leaves the code alone when only the switch is changed', async () => {
    // The UI toggles this without resending the code; losing it on every
    // toggle would make the switch useless.
    const { service, row } = await enabledService();
    const hash = row.devBypassCodeHash;
    await service.configure({ enabled: false });
    expect(row.devBypassCodeHash).toBe(hash);
  });
});
