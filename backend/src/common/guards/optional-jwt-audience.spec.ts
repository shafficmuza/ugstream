import { OptionalJwtGuard } from './optional-jwt.guard';

/**
 * The website's catalogue pages are server-rendered, so they reach the API
 * with no Authorization header at all. That made every one of them ask as an
 * anonymous visitor and be answered with the live catalogue — a signed-in
 * tester saw published titles on the web while the phone app, which does send
 * its token, correctly showed them the test catalogue.
 *
 * The audience cookie was added to close exactly that gap but was only ever
 * written, never read. These cover the reading half.
 */
describe('OptionalJwtGuard audience resolution', () => {
  const ctx = (headers: Record<string, string>) => {
    const req: any = { headers };
    return {
      req,
      ctx: { switchToHttp: () => ({ getRequest: () => req }) } as any,
    };
  };

  const makeGuard = (user?: any) =>
    new OptionalJwtGuard(
      { verifyAsync: jest.fn().mockResolvedValue({ sub: '7', sid: 'sess-1' }) } as any,
      { get: jest.fn() } as any,
      { user: { findUnique: jest.fn().mockResolvedValue(user) } } as any,
    );

  it('serves the test catalogue to an anonymous request carrying the tester cookie', async () => {
    const { req, ctx: c } = ctx({ cookie: 'ugs_aud=test' });

    await makeGuard().canActivate(c);

    expect(req.audience).toEqual({ isTester: true });
    expect(req.auth).toBeUndefined(); // display-only: never an identity
  });

  it('leaves a live-catalogue cookie as an ordinary viewer', async () => {
    const { req, ctx: c } = ctx({ cookie: 'ugs_aud=live' });
    await makeGuard().canActivate(c);
    expect(req.audience).toBeNull();
  });

  it('ignores an unrelated cookie jar', async () => {
    const { req, ctx: c } = ctx({ cookie: 'ugs_rt=abc; other=1' });
    await makeGuard().canActivate(c);
    expect(req.audience).toBeNull();
  });

  it('finds the hint among other cookies', async () => {
    const { req, ctx: c } = ctx({ cookie: 'ugs_rt=abc; ugs_aud=test; x=1' });
    await makeGuard().canActivate(c);
    expect(req.audience).toEqual({ isTester: true });
  });

  it('has no audience at all when nothing identifies the caller', async () => {
    const { req, ctx: c } = ctx({});
    await makeGuard().canActivate(c);
    expect(req.audience).toBeNull();
  });

  it("the account's own flags beat the cookie", async () => {
    // A token that resolves to a NON-tester must not be dragged onto the test
    // catalogue by a stale or forged cookie.
    const { req, ctx: c } = ctx({ authorization: 'Bearer good', cookie: 'ugs_aud=test' });

    await makeGuard({ id: 7n, role: 'user', status: 'active', isTester: false, canPreviewAll: false })
      .canActivate(c);

    expect(req.audience).toBe(req.auth);
    expect(req.audience.isTester).toBe(false);
  });

  it('falls back to the cookie when the token does not resolve to an account', async () => {
    const { req, ctx: c } = ctx({ authorization: 'Bearer stale', cookie: 'ugs_aud=test' });
    await makeGuard(null).canActivate(c);
    expect(req.audience).toEqual({ isTester: true });
  });
});
