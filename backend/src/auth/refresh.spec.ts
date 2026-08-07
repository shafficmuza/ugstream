import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';

/**
 * Refresh-token durability.
 *
 * The bug these cover, reported from the iOS app: the server rotated the
 * refresh token, the phone was suspended before it could persist the new one,
 * and the next request signed the user out mid-film. A session must survive
 * a client that misses a rotation, and must still end when a long-dead token
 * is replayed.
 */
/** No master code in play — these tests are about refresh, not sign-in. */
const noMasterCode = () =>
  ({ matches: async () => false, recordFailure: async () => undefined, recordUse: async () => undefined }) as any;

/** Nor a development bypass. */
const noDevBypass = () =>
  ({ matches: async () => false, recordFailure: async () => undefined }) as any;

/** Nor a PIN — these accounts sign in by code. */
const noPins = () => ({ isAvailableFor: async () => false }) as any;

async function makeService(sessionOverrides: Record<string, any> = {}) {
  const secret = 'verifier-secret';
  const lookup = 'abc123';
  const session: any = {
    id: 'sess-1',
    userId: 1n,
    refreshLookup: lookup,
    refreshHash: await bcrypt.hash(secret, 4),
    prevRefreshHash: null,
    prevRefreshAt: null,
    revokedAt: null,
    user: { id: 1n, status: 'active' },
    ...sessionOverrides,
  };

  // The mock applies writes to the row, so a token issued by one call is
  // looked up against the state that call actually left behind. A mock that
  // ignores updates hides exactly the class of bug these tests exist to
  // catch — an earlier version rotated the lookup half on every refresh,
  // orphaning the previous token, and every assertion here still passed.
  const update = jest.fn(async ({ data }: any) => {
    Object.assign(session, data);
    return session;
  });
  const updateMany = jest.fn(async (_args: any) => ({ count: 1 }));
  const prisma: any = {
    session: {
      findUnique: jest.fn(async ({ where }: any) =>
        where.refreshLookup && where.refreshLookup === session.refreshLookup ? session : null,
      ),
      findUniqueOrThrow: jest.fn(async () => session),
      findMany: jest.fn(async () => []),
      update,
      updateMany,
    },
  };

  const jwt = { signAsync: jest.fn(async () => 'access-token') };
  const config = { get: jest.fn(() => 'secret') };
  const service = new AuthService(prisma, jwt as any, config as any, {} as any, {} as any, noMasterCode(), noDevBypass(), noPins());
  return { service, session, secret, lookup, update, updateMany, prisma };
}

describe('refresh with the current token', () => {
  it('renews the session and issues a new token', async () => {
    const { service, secret, lookup } = await makeService();
    const out = await service.refresh(`${lookup}.${secret}`);
    expect(out.accessToken).toBe('access-token');
    expect(out.refreshToken).toContain('.');
    expect(out.refreshToken).not.toBe(`${lookup}.${secret}`);
  });

  it('retains the outgoing token as the previous one', async () => {
    // This is what makes recovery possible: without it, a rotation the client
    // misses is unrecoverable.
    const { service, secret, lookup, session, update } = await makeService();
    const outgoingHash = session.refreshHash;
    await service.refresh(`${lookup}.${secret}`);
    const written = update.mock.calls.at(-1)![0].data;
    expect(written.prevRefreshHash).toBe(outgoingHash);
    expect(written.prevRefreshAt).toBeInstanceOf(Date);
  });

  it('finds the session by indexed lookup, not by scanning every session', async () => {
    // A bcrypt compare per live session makes refresh slower as the platform
    // grows, and a slow refresh widens exactly the race being fixed here.
    const { service, secret, lookup, prisma } = await makeService();
    await service.refresh(`${lookup}.${secret}`);
    expect(prisma.session.findUnique).toHaveBeenCalled();
    expect(prisma.session.findMany).not.toHaveBeenCalled();
  });
});

describe('a client that misses a rotation, played out in sequence', () => {
  // The reported iOS failure, end to end: refresh succeeds server-side, the
  // app is suspended before it stores the result, and the token it still
  // holds must keep working. Verified live before it was believed.
  it('keeps the session alive when the replacement never arrives', async () => {
    const { service, secret, lookup } = await makeService();
    const original = `${lookup}.${secret}`;

    // Several responses in a row never reach the phone. Each attempt must
    // leave the session usable, however many times it repeats.
    for (let i = 0; i < 3; i++) {
      await expect(service.refresh(original)).resolves.toBeDefined();
    }

    // This one arrives and is stored, so the session continues on it.
    const landed = await service.refresh(original);
    await expect(service.refresh(landed.refreshToken)).resolves.toBeDefined();
  });

  it('retires the stranded token once the client demonstrably moves on', async () => {
    // Presenting the current token proves the replacement was received, so
    // the one being carried for recovery is no longer needed and should stop
    // working — otherwise a token could stay valid for the whole grace window
    // after it was superseded.
    const { service, secret, lookup, updateMany } = await makeService();
    const original = `${lookup}.${secret}`;

    const landed = await service.refresh(original);
    await service.refresh(landed.refreshToken);

    await expect(service.refresh(original)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(updateMany).toHaveBeenCalled(); // and the replay ends the session
  });

  it('keeps the session addressable — the lookup half never rotates', async () => {
    const { service, secret, lookup, session } = await makeService();
    await service.refresh(`${lookup}.${secret}`);
    expect(session.refreshLookup).toBe(lookup);
  });
});

describe('refresh with a token the client failed to replace', () => {
  it('still works inside the grace window', async () => {
    const stale = 'previous-secret';
    const { service, lookup } = await makeService({
      prevRefreshHash: await bcrypt.hash(stale, 4),
      prevRefreshAt: new Date(Date.now() - 60 * 60 * 1000), // an hour ago
    });
    const out = await service.refresh(`${lookup}.${stale}`);
    expect(out.accessToken).toBe('access-token');
  });

  it('hands the same token back rather than minting a third', async () => {
    // Rotating here would leave the replacement the client never received
    // valid for nobody, and would refuse — and revoke — a client that had in
    // fact stored it.
    const stale = 'previous-secret';
    const { service, lookup } = await makeService({
      prevRefreshHash: await bcrypt.hash(stale, 4),
      prevRefreshAt: new Date(Date.now() - 60 * 60 * 1000),
    });
    const presented = `${lookup}.${stale}`;
    const out = await service.refresh(presented);
    expect(out.refreshToken).toBe(presented);
  });

  it('adopts the presented token as the current one', async () => {
    const stale = 'previous-secret';
    const prevRefreshHash = await bcrypt.hash(stale, 4);
    const { service, lookup, session } = await makeService({
      prevRefreshHash,
      prevRefreshAt: new Date(Date.now() - 60 * 60 * 1000),
    });
    await service.refresh(`${lookup}.${stale}`);
    expect(session.refreshHash).toBe(prevRefreshHash);
    expect(session.prevRefreshHash).toBeNull();
  });

  it('does not revoke the session', async () => {
    const stale = 'previous-secret';
    const { service, lookup, updateMany } = await makeService({
      prevRefreshHash: await bcrypt.hash(stale, 4),
      prevRefreshAt: new Date(Date.now() - 60 * 60 * 1000),
    });
    await service.refresh(`${lookup}.${stale}`);
    expect(updateMany).not.toHaveBeenCalled();
  });
});

describe('refresh with a token that should no longer work', () => {
  it('rejects and revokes once the grace window has passed', async () => {
    const stale = 'previous-secret';
    const { service, lookup, updateMany } = await makeService({
      prevRefreshHash: await bcrypt.hash(stale, 4),
      prevRefreshAt: new Date(Date.now() - 48 * 60 * 60 * 1000), // two days ago
    });
    await expect(service.refresh(`${lookup}.${stale}`)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ revokedAt: expect.any(Date) }) }),
    );
  });

  it('rejects an unknown token without touching any session', async () => {
    const { service, updateMany } = await makeService();
    await expect(service.refresh('nosuch.token')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('rejects a banned user even with a valid token', async () => {
    const { service, secret, lookup } = await makeService({
      user: { id: 1n, status: 'banned' },
    });
    await expect(service.refresh(`${lookup}.${secret}`)).rejects.toThrow('suspended');
  });
});

describe('tokens issued before the lookup format existed', () => {
  it('are still accepted, so a deploy does not sign everyone out', async () => {
    const legacy = 'legacy-opaque-token';
    const legacySession: any = {
      id: 'sess-legacy',
      userId: 1n,
      refreshLookup: null,
      refreshHash: await bcrypt.hash(legacy, 4),
      prevRefreshHash: null,
      prevRefreshAt: null,
      revokedAt: null,
      user: { id: 1n, status: 'active' },
    };
    const prisma: any = {
      session: {
        findUnique: jest.fn(async () => null),
        findUniqueOrThrow: jest.fn(async () => legacySession),
        findMany: jest.fn(async () => [legacySession]),
        update: jest.fn(async (_args: any) => legacySession),
        updateMany: jest.fn(async (_args: any) => ({ count: 1 })),
      },
    };
    const service = new AuthService(
      prisma,
      { signAsync: jest.fn(async () => 'access-token') } as any,
      { get: jest.fn(() => 'secret') } as any,
      {} as any,
      {} as any,
      noMasterCode(),
      noDevBypass(),
      noPins(),
    );

    const out = await service.refresh(legacy);
    expect(out.accessToken).toBe('access-token');
    // and it is upgraded to the new format on the way out
    expect(out.refreshToken).toContain('.');
    expect(prisma.session.update.mock.calls.at(-1)![0].data.refreshLookup).toEqual(expect.any(String));
  });
});

describe('session lifetime', () => {
  it('reports no expiry — sessions end at logout or eviction', async () => {
    const { service, secret, lookup } = await makeService();
    const out = await service.refresh(`${lookup}.${secret}`);
    expect(out.refreshTokenExpiresInDays).toBeNull();
  });
});
