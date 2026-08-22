import { AuthController, readRefreshCookie } from './auth.controller';

/**
 * The refresh token's httpOnly-cookie fallback. Safari deletes localStorage
 * after ~7 days without a visit, which used to end healthy web sessions; the
 * cookie copy is what lets a returning visitor be signed back in silently.
 */

describe('readRefreshCookie', () => {
  it('finds the token among other cookies', () => {
    expect(readRefreshCookie('a=1; ugs_rt=look.secret; b=2')).toBe('look.secret');
  });

  it('handles the token being the only cookie, unspaced', () => {
    expect(readRefreshCookie('ugs_rt=tok')).toBe('tok');
  });

  it('decodes percent-encoding', () => {
    expect(readRefreshCookie('ugs_rt=a%2Eb')).toBe('a.b');
  });

  it('ignores lookalike names and empty values', () => {
    expect(readRefreshCookie('xugs_rt=nope')).toBeNull();
    expect(readRefreshCookie('ugs_rt=')).toBeNull();
    expect(readRefreshCookie(undefined)).toBeNull();
    expect(readRefreshCookie('a=1; b=2')).toBeNull();
  });
});

describe('AuthController.refresh source of the token', () => {
  function makeController(refreshMock: jest.Mock) {
    // Four collaborators now: auth, prisma, pins, accounts. Only `refresh`
    // is exercised here; the rest exist so the constructor is satisfiable.
    return new AuthController(
      { refresh: refreshMock } as any,
      {} as any,
      {} as any,
      {} as any,
    );
  }
  const res = () => ({ cookie: jest.fn(), clearCookie: jest.fn() }) as any;

  it('prefers the body token (mobile and healthy web clients)', async () => {
    const refresh = jest.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'next' });
    const r = res();
    await makeController(refresh).refresh(
      { refreshToken: 'from-body' },
      { headers: { cookie: 'ugs_rt=from-cookie' } } as any,
      r,
    );
    expect(refresh).toHaveBeenCalledWith('from-body');
  });

  it('falls back to the cookie when the body has no token (purged localStorage)', async () => {
    const refresh = jest.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'next' });
    const r = res();
    await makeController(refresh).refresh(
      {},
      { headers: { cookie: 'ugs_rt=from-cookie' } } as any,
      r,
    );
    expect(refresh).toHaveBeenCalledWith('from-cookie');
  });

  it('rejects when neither body nor cookie holds a token', async () => {
    const refresh = jest.fn();
    await expect(
      makeController(refresh).refresh({}, { headers: {} } as any, res()),
    ).rejects.toThrow(/refresh token/i);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('re-sets the cookie with the rotated token on success', async () => {
    const refresh = jest.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'rotated' });
    const r = res();
    await makeController(refresh).refresh({ refreshToken: 't' }, { headers: {} } as any, r);
    expect(r.cookie).toHaveBeenCalledWith(
      'ugs_rt',
      'rotated',
      expect.objectContaining({ httpOnly: true, secure: true, sameSite: 'lax' }),
    );
  });
});
