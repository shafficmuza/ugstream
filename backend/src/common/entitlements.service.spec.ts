import { EntitlementsService } from './entitlements.service';

/**
 * Access-control core: who can watch a title right now. Prisma is mocked so
 * these are fast, deterministic unit tests of the branching logic.
 */
function makeService(overrides: {
  user?: { role: string; status: string } | null;
  title?: { access: string };
  activeSub?: boolean;
  activePurchase?: boolean;
}) {
  const prisma: any = {
    user: { findUnique: jest.fn().mockResolvedValue(overrides.user ?? { role: 'user', status: 'active' }) },
    title: { findUniqueOrThrow: jest.fn().mockResolvedValue(overrides.title ?? { access: 'subscription' }) },
    subscription: { findFirst: jest.fn().mockResolvedValue(overrides.activeSub ? { id: 1n } : null) },
    purchase: { findFirst: jest.fn().mockResolvedValue(overrides.activePurchase ? { id: 1n } : null) },
  };
  return new EntitlementsService(prisma);
}

describe('EntitlementsService.check', () => {
  it('free titles are always entitled', async () => {
    const r = await makeService({ title: { access: 'free' } }).check(1n, 1n);
    expect(r).toEqual({ entitled: true, reason: 'free' });
  });

  it('banned users are never entitled, even for free titles', async () => {
    const r = await makeService({ user: { role: 'user', status: 'banned' }, title: { access: 'free' } }).check(1n, 1n);
    expect(r.entitled).toBe(false);
  });

  it('staff (admin) get comp access to paid titles without a subscription', async () => {
    const r = await makeService({ user: { role: 'admin', status: 'active' }, title: { access: 'subscription' } }).check(1n, 1n);
    expect(r).toEqual({ entitled: true, reason: 'staff' });
  });

  it('staff (editor) also get comp access', async () => {
    const r = await makeService({ user: { role: 'editor', status: 'active' }, title: { access: 'purchase' } }).check(1n, 1n);
    expect(r).toEqual({ entitled: true, reason: 'staff' });
  });

  it('subscription title: entitled with an active sub', async () => {
    const r = await makeService({ title: { access: 'subscription' }, activeSub: true }).check(1n, 1n);
    expect(r).toEqual({ entitled: true, reason: 'subscription' });
  });

  it('subscription title: NOT entitled without a sub', async () => {
    const r = await makeService({ title: { access: 'subscription' }, activeSub: false }).check(1n, 1n);
    expect(r.entitled).toBe(false);
  });

  it('purchase title: entitled with an active purchase', async () => {
    const r = await makeService({ title: { access: 'purchase' }, activePurchase: true }).check(1n, 1n);
    expect(r).toEqual({ entitled: true, reason: 'purchase' });
  });

  it('sub_or_purchase: a purchase alone suffices', async () => {
    const r = await makeService({ title: { access: 'sub_or_purchase' }, activeSub: false, activePurchase: true }).check(1n, 1n);
    expect(r.entitled).toBe(true);
  });

  it('missing user is not entitled', async () => {
    const r = await makeService({ user: null, title: { access: 'subscription' } }).check(1n, 1n);
    expect(r.entitled).toBe(false);
  });
});
