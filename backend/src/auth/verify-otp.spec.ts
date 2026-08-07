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
async function makeService(codes: { id: number; code: string; attempts?: number }[]) {
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

  const service = new AuthService(
    prisma,
    { signAsync: jest.fn(async () => 'access-token') } as any,
    { get: jest.fn(() => 'secret') } as any,
    {} as any,
    { log: jest.fn() } as any,
  );
  return { service, prisma, updateMany };
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
