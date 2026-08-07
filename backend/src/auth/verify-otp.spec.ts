import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';

/**
 * Code verification with more than one code outstanding.
 *
 * A number can legitimately have several live codes at once: a user who taps
 * resend, or an admin-issued recovery code alongside the SMS one. Matching
 * only the newest silently broke both — most importantly the recovery code,
 * which the user's own "Send code" press would shadow, since the sign-in
 * screen requires that press before a code can be entered at all.
 */
async function makeService(
  codes: { id: number; code: string; attempts?: number }[],
  master?: { code: string; user?: Record<string, any> | null },
) {
  const rows = await Promise.all(
    codes.map(async (c) => ({
      id: BigInt(c.id),
      phone: '+256772878614',
      codeHash: await bcrypt.hash(c.code, 4),
      attempts: c.attempts ?? 0,
      consumedAt: null,
      expiresAt: new Date(Date.now() + 300_000),
    })),
  );

  const updateMany = jest.fn(async (_args: any) => ({ count: 1 }));
  const prisma: any = {
    otpCode: {
      findMany: jest.fn(async () => rows),
      updateMany,
    },
    user: {
      upsert: jest.fn(async () => ({
        id: 1n,
        phone: '+256772878614',
        displayName: null,
        role: 'user',
        status: 'active',
      })),
      findUniqueOrThrow: jest.fn(async () => ({
        id: 1n,
        phone: '+256772878614',
        displayName: null,
        role: 'user',
      })),
      // The master-code path looks the account up rather than creating one.
      // `undefined` in the fixture means "this number has no account".
      findUnique: jest.fn(async () =>
        master === undefined
          ? null
          : master.user === undefined
            ? { id: 1n, phone: '+256772878614', role: 'user', status: 'active' }
            : master.user,
      ),
    },
    appSettings: { findUnique: jest.fn(async () => ({ maxSessions: 3 })) },
    session: {
      findMany: jest.fn(async () => []),
      create: jest.fn(async () => ({ id: 'sess-1' })),
      update: jest.fn(async (_a: any) => ({})),
      updateMany: jest.fn(async (_a: any) => ({ count: 0 })),
      findUniqueOrThrow: jest.fn(async () => ({
        refreshHash: 'h',
        refreshLookup: 'l',
        prevRefreshHash: null,
        prevRefreshAt: null,
      })),
    },
    streamLease: { updateMany: jest.fn(async (_a: any) => ({ count: 0 })) },
  };

  const recordFailure = jest.fn(async () => undefined);
  const recordUse = jest.fn(async () => undefined);
  const masterCode: any = {
    matches: jest.fn(async (submitted: string) => master !== undefined && submitted === master.code),
    recordFailure,
    recordUse,
  };

  const service = new AuthService(
    prisma,
    { signAsync: jest.fn(async () => 'access-token') } as any,
    { get: jest.fn(() => 'secret') } as any,
    {} as any,
    { log: jest.fn() } as any,
    masterCode,
    { matches: async () => false, recordFailure: async () => undefined } as any,
    { isAvailableFor: async () => false, verify: async () => { throw new Error('no pin'); } } as any,
  );
  return { service, prisma, updateMany, masterCode, recordFailure, recordUse };
}

describe('verifyOtp with several live codes', () => {
  it('accepts the newest code', async () => {
    const { service } = await makeService([
      { id: 2, code: '222222' },
      { id: 1, code: '111111' },
    ]);
    await expect(service.verifyOtp('0772878614', '222222')).resolves.toBeDefined();
  });

  it('accepts an older code the user typed after tapping resend', async () => {
    const { service } = await makeService([
      { id: 2, code: '222222' },
      { id: 1, code: '111111' },
    ]);
    await expect(service.verifyOtp('0772878614', '111111')).resolves.toBeDefined();
  });

  it('accepts an admin recovery code shadowed by a newer SMS code', async () => {
    // The exact ordering support will hit: the code is issued, then the user
    // presses "Send code" to reach the entry screen, creating a newer row.
    const { service } = await makeService([
      { id: 9, code: '555555' }, // SMS code the user never receives
      { id: 8, code: '424242' }, // admin-issued recovery code
    ]);
    await expect(service.verifyOtp('0772878614', '424242')).resolves.toBeDefined();
  });

  it('consumes every outstanding code once one succeeds', async () => {
    const { service, updateMany } = await makeService([
      { id: 2, code: '222222' },
      { id: 1, code: '111111' },
    ]);
    await service.verifyOtp('0772878614', '111111');
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { phone: '+256772878614', consumedAt: null },
        data: { consumedAt: expect.any(Date) },
      }),
    );
  });

  it('charges a wrong guess against every live code', async () => {
    // Otherwise holding several codes open would multiply the guesses an
    // attacker gets before the attempt cap bites.
    const { service, updateMany } = await makeService([
      { id: 2, code: '222222' },
      { id: 1, code: '111111' },
    ]);
    await expect(service.verifyOtp('0772878614', '999999')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: [2n, 1n] } },
        data: { attempts: { increment: 1 } },
      }),
    );
  });

  it('ignores a code that has already burned its attempts', async () => {
    const { service } = await makeService([{ id: 1, code: '111111', attempts: 5 }]);
    await expect(service.verifyOtp('0772878614', '111111')).rejects.toThrow(
      'Too many incorrect attempts',
    );
  });

  it('rejects when nothing is outstanding', async () => {
    const { service } = await makeService([]);
    await expect(service.verifyOtp('0772878614', '111111')).rejects.toThrow(
      'Code expired or not found',
    );
  });
});

/**
 * The break-glass master code.
 *
 * It exists for an SMS outage, so the case that matters most is the one where
 * the user never received anything: no live code, nothing outstanding, and the
 * master code still has to work. Everything else here is a guard rail.
 */
describe('verifyOtp with the master sign-in code', () => {
  it('signs in when no code was ever received', async () => {
    const { service } = await makeService([], { code: '424242' });
    await expect(service.verifyOtp('0772878614', '424242')).resolves.toMatchObject({
      accessToken: 'access-token',
    });
  });

  it('signs in even when a real code is also outstanding', async () => {
    const { service } = await makeService([{ id: 1, code: '111111' }], { code: '424242' });
    await expect(service.verifyOtp('0772878614', '424242')).resolves.toMatchObject({
      accessToken: 'access-token',
    });
  });

  it('retires any outstanding real code once it is used', async () => {
    const { service, updateMany } = await makeService([{ id: 1, code: '111111' }], {
      code: '424242',
    });
    await service.verifyOtp('0772878614', '424242');
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { phone: '+256772878614', consumedAt: null } }),
    );
  });

  it('prefers a real code over the master code when both match', async () => {
    // Not a contrived collision: the master code is six digits and so is every
    // OTP, so one number in a million shares them. The real code must win, or
    // that user's sign-in would be logged as a master-code use.
    const { service, masterCode } = await makeService([{ id: 1, code: '424242' }], {
      code: '424242',
    });
    await service.verifyOtp('0772878614', '424242');
    expect(masterCode.matches).not.toHaveBeenCalled();
  });

  it('refuses an account that does not exist yet', async () => {
    // A leaked code must not be a signup generator.
    const { service } = await makeService([], { code: '424242', user: null });
    await expect(service.verifyOtp('0772878614', '424242')).rejects.toThrow('Incorrect code');
  });

  it('refuses a privileged account', async () => {
    const { service } = await makeService([], {
      code: '424242',
      user: { id: 9n, phone: '+256772878614', role: 'admin', status: 'active' },
    });
    await expect(service.verifyOtp('0772878614', '424242')).rejects.toThrow(
      'cannot be opened with a master code',
    );
  });

  it('refuses a banned account', async () => {
    const { service } = await makeService([], {
      code: '424242',
      user: { id: 9n, phone: '+256772878614', role: 'user', status: 'banned' },
    });
    await expect(service.verifyOtp('0772878614', '424242')).rejects.toThrow('suspended');
  });

  it('charges a wrong code against the master code, so it cannot be brute forced', async () => {
    const { service, recordFailure } = await makeService([], { code: '424242' });
    await expect(service.verifyOtp('0772878614', '999999')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(recordFailure).toHaveBeenCalled();
  });

  it('does not charge the master code when a real code matched', async () => {
    const { service, recordFailure } = await makeService([{ id: 1, code: '111111' }], {
      code: '424242',
    });
    await service.verifyOtp('0772878614', '111111');
    expect(recordFailure).not.toHaveBeenCalled();
  });

  it('counts a use only when the sign-in actually succeeded', async () => {
    // The counter is what an admin watches during an incident to see how far
    // the code has spread. Counting refusals — a wrong account, a privileged
    // account — would overstate it and hide the real number.
    const { service, recordUse } = await makeService([], {
      code: '424242',
      user: { id: 9n, phone: '+256772878614', role: 'admin', status: 'active' },
    });
    await expect(service.verifyOtp('0772878614', '424242')).rejects.toThrow(UnauthorizedException);
    expect(recordUse).not.toHaveBeenCalled();

    const ok = await makeService([], { code: '424242' });
    await ok.service.verifyOtp('0772878614', '424242');
    expect(ok.recordUse).toHaveBeenCalledTimes(1);
  });
});
