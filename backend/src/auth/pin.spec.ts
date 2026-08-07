import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PinService } from './pin.service';

/**
 * The user's sign-in PIN.
 *
 * The point of it is cost: an OTP becomes a once-per-account expense instead
 * of once-per-sign-in. The risk it introduces is that a four-digit secret now
 * opens an account over a public endpoint, so the lockout is not a detail —
 * without it this feature would be a downgrade, not a saving.
 */
function makeService(userOverrides: Record<string, any> | null = {}) {
  const row: any =
    userOverrides === null
      ? null
      : {
          id: 1n,
          phone: '+256772878614',
          status: 'active',
          pinHash: null,
          pinSetAt: null,
          pinFailures: 0,
          pinLockedUntil: null,
          ...userOverrides,
        };

  const update = jest.fn(async ({ data }: any) => {
    Object.assign(row, data);
    return row;
  });

  const prisma: any = {
    user: {
      findUnique: jest.fn(async () => (row ? { ...row } : null)),
      findUniqueOrThrow: jest.fn(async () => {
        if (!row) throw new Error('not found');
        return { ...row };
      }),
      update,
    },
  };

  return { service: new PinService(prisma), row, update };
}

describe('choosing a PIN', () => {
  it('accepts a reasonable one', async () => {
    const { service, row } = makeService();
    await expect(service.set(1n, '8261')).resolves.toEqual({ pinSet: true });
    await expect(bcrypt.compare('8261', row.pinHash)).resolves.toBe(true);
  });

  it('refuses repeated digits', async () => {
    const { service } = makeService();
    await expect(service.set(1n, '1111')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses simple runs in both directions', async () => {
    const { service } = makeService();
    await expect(service.set(1n, '1234')).rejects.toThrow('too easy to guess');
    await expect(service.set(1n, '4321')).rejects.toThrow('too easy to guess');
  });

  it('refuses anything that is not digits', async () => {
    const { service } = makeService();
    await expect(service.set(1n, 'abcd')).rejects.toThrow('numbers only');
  });

  it('refuses one that is too short', async () => {
    const { service } = makeService();
    await expect(service.set(1n, '821')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('changing a PIN', () => {
  it('requires the current one', async () => {
    // Otherwise a phone left unlocked for a minute is enough to lock its owner
    // out of their own account.
    const { service } = makeService({ pinHash: await bcrypt.hash('8261', 4) });
    await expect(service.set(1n, '9375')).rejects.toThrow('current PIN');
  });

  it('rejects a wrong current one', async () => {
    const { service } = makeService({ pinHash: await bcrypt.hash('8261', 4) });
    await expect(service.set(1n, '9375', '0000')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('replaces it when the current one is right', async () => {
    const { service, row } = makeService({ pinHash: await bcrypt.hash('8261', 4) });
    await service.set(1n, '9375', '8261');
    await expect(bcrypt.compare('9375', row.pinHash)).resolves.toBe(true);
  });

  it('clears any lockout, so a reset is a way back in', async () => {
    const { service, row } = makeService({
      pinHash: await bcrypt.hash('8261', 4),
      pinFailures: 3,
      pinLockedUntil: new Date(Date.now() + 600_000),
    });
    await service.set(1n, '9375', '8261');
    expect(row.pinFailures).toBe(0);
    expect(row.pinLockedUntil).toBeNull();
  });
});

describe('signing in with a PIN', () => {
  it('works', async () => {
    const { service } = makeService({ pinHash: await bcrypt.hash('8261', 4) });
    await expect(service.verify('+256772878614', '8261')).resolves.toMatchObject({ id: 1n });
  });

  it('rejects a wrong one', async () => {
    const { service } = makeService({ pinHash: await bcrypt.hash('8261', 4) });
    await expect(service.verify('+256772878614', '0000')).rejects.toThrow('Incorrect PIN');
  });

  it('gives the same answer for an unknown number as for a wrong PIN', async () => {
    // Any difference turns this endpoint into a subscriber list.
    const { service } = makeService(null);
    await expect(service.verify('+256700000001', '8261')).rejects.toThrow('Incorrect PIN');
  });

  it('gives the same answer for an account with no PIN', async () => {
    const { service } = makeService({ pinHash: null });
    await expect(service.verify('+256772878614', '8261')).rejects.toThrow('Incorrect PIN');
  });

  it('refuses a banned account', async () => {
    const { service } = makeService({ pinHash: await bcrypt.hash('8261', 4), status: 'banned' });
    await expect(service.verify('+256772878614', '8261')).rejects.toThrow('suspended');
  });

  it('clears the failure count on success', async () => {
    const { service, row } = makeService({
      pinHash: await bcrypt.hash('8261', 4),
      pinFailures: 3,
    });
    await service.verify('+256772878614', '8261');
    expect(row.pinFailures).toBe(0);
  });
});

describe('the lockout', () => {
  it('locks the PIN after five wrong attempts', async () => {
    const { service, row } = makeService({ pinHash: await bcrypt.hash('8261', 4) });
    for (let i = 0; i < 4; i++) {
      await expect(service.verify('+256772878614', '0000')).rejects.toThrow('Incorrect PIN');
    }
    await expect(service.verify('+256772878614', '0000')).rejects.toThrow('Too many incorrect PINs');
    expect(row.pinLockedUntil).toBeInstanceOf(Date);
  });

  it('refuses even the correct PIN while locked', async () => {
    const { service } = makeService({
      pinHash: await bcrypt.hash('8261', 4),
      pinLockedUntil: new Date(Date.now() + 600_000),
    });
    await expect(service.verify('+256772878614', '8261')).rejects.toThrow('Too many incorrect PINs');
  });

  it('points a locked-out user at the SMS code rather than a dead end', async () => {
    const { service } = makeService({
      pinHash: await bcrypt.hash('8261', 4),
      pinLockedUntil: new Date(Date.now() + 600_000),
    });
    await expect(service.verify('+256772878614', '8261')).rejects.toThrow('code by SMS');
  });

  it('lets the correct PIN through once the lock has passed', async () => {
    const { service } = makeService({
      pinHash: await bcrypt.hash('8261', 4),
      pinLockedUntil: new Date(Date.now() - 1000),
    });
    await expect(service.verify('+256772878614', '8261')).resolves.toMatchObject({ id: 1n });
  });
});

describe('which sign-in step to offer', () => {
  it('offers the PIN when one is set', async () => {
    const { service } = makeService({ pinHash: 'x' });
    await expect(service.isAvailableFor('+256772878614')).resolves.toBe(true);
  });

  it('falls back to a code when none is set', async () => {
    const { service } = makeService({ pinHash: null });
    await expect(service.isAvailableFor('+256772878614')).resolves.toBe(false);
  });

  it('falls back to a code while the PIN is locked', async () => {
    // Sending someone to a screen that cannot let them in is worse than
    // spending one message.
    const { service } = makeService({
      pinHash: 'x',
      pinLockedUntil: new Date(Date.now() + 600_000),
    });
    await expect(service.isAvailableFor('+256772878614')).resolves.toBe(false);
  });

  it('says nothing different about a number with no account', async () => {
    const { service } = makeService(null);
    await expect(service.isAvailableFor('+256700000001')).resolves.toBe(false);
  });
});
