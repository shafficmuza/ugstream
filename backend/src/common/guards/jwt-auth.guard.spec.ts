import { JwtAuthGuard } from './jwt-auth.guard';

/**
 * Session activity tracking.
 *
 * The device cap evicts the least recently *seen* session. Before this,
 * lastSeenAt moved only on token refresh, so a phone streaming a film looked
 * idle for the whole film and was the first thing any new sign-in evicted —
 * the user reached the credits and was thrown back to the login screen. These
 * cover the branch that keeps an active device's place in that order.
 */
let sidCounter = 0;
/** The touch throttle is module-scoped, so each test needs its own session. */
const freshSid = () => `sess-${++sidCounter}`;

function makeGuard(opts: { status?: string; sid?: string } = {}) {
  const sid = opts.sid ?? freshSid();
  const updateMany = jest.fn(async (_args: any) => ({ count: 1 }));
  const prisma: any = {
    user: {
      findUnique: jest.fn(async () => ({ id: 1n, role: 'user', status: opts.status ?? 'active' })),
    },
    session: { updateMany },
  };
  const jwt: any = { verifyAsync: jest.fn(async () => ({ sub: '1', sid })) };
  const config: any = { get: jest.fn(() => 'secret') };

  const req: any = { headers: { authorization: 'Bearer token' } };
  const ctx: any = { switchToHttp: () => ({ getRequest: () => req }) };

  return { guard: new JwtAuthGuard(jwt, config, prisma), ctx, req, updateMany, sid };
}

/** The write is fire-and-forget, so let the microtask queue drain. */
const settle = () => new Promise((r) => setImmediate(r));

describe('marking a session as seen', () => {
  it('records activity on an authenticated request', async () => {
    const { guard, ctx, updateMany, sid } = makeGuard();
    await guard.canActivate(ctx);
    await settle();

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: sid, revokedAt: null }),
        data: { lastSeenAt: expect.any(Date) },
      }),
    );
  });

  it('does not write again for the same session straight away', async () => {
    // Otherwise a playback heartbeat every few seconds becomes a write every
    // few seconds, per viewer.
    const { guard, ctx, updateMany } = makeGuard();
    await guard.canActivate(ctx);
    await guard.canActivate(ctx);
    await guard.canActivate(ctx);
    await settle();

    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it('only overwrites a lastSeenAt that is actually stale', async () => {
    const { guard, ctx, updateMany } = makeGuard();
    await guard.canActivate(ctx);
    await settle();

    expect(updateMany.mock.calls[0][0].where.lastSeenAt.lt).toBeInstanceOf(Date);
  });

  it('leaves a revoked session revoked', async () => {
    // Touching one would resurrect a device the cap deliberately evicted.
    const { guard, ctx, updateMany } = makeGuard();
    await guard.canActivate(ctx);
    await settle();

    expect(updateMany.mock.calls[0][0].where.revokedAt).toBeNull();
  });

  it('still authorises when the write fails', async () => {
    const { guard, ctx, updateMany } = makeGuard();
    updateMany.mockRejectedValueOnce(new Error('db down') as never);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    await settle();
  });

  it('skips tokens minted before sessions carried an id', async () => {
    const updateMany = jest.fn(async (_args: any) => ({ count: 1 }));
    const guard = new JwtAuthGuard(
      { verifyAsync: jest.fn(async () => ({ sub: '1' })) } as any,
      { get: () => 'secret' } as any,
      {
        user: { findUnique: jest.fn(async () => ({ id: 1n, role: 'user', status: 'active' })) },
        session: { updateMany },
      } as any,
    );
    const req: any = { headers: { authorization: 'Bearer token' } };
    const ctx: any = { switchToHttp: () => ({ getRequest: () => req }) };

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    await settle();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('does not touch anything for a banned account', async () => {
    const { guard, ctx, updateMany } = makeGuard({ status: 'banned' });
    await expect(guard.canActivate(ctx)).rejects.toThrow('suspended');
    await settle();
    expect(updateMany).not.toHaveBeenCalled();
  });
});
